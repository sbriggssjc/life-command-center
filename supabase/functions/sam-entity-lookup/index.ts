// ============================================================================
// sam-entity-lookup — SAM.gov Entity Lookup Pipeline v3
// Project: government (scknotsqkcheojiaewwh)
//
// Synced to this repo 2026-09-07 (DRIFT1 Unit 2) from the live deployment
// (version 5) via Supabase MCP `get_edge_function`. Had NO committed source
// before this sync — see docs/architecture/edge-function-deploy-drift.md.
//
// LIVE: gov `cron.job` jobid 9 ("sam-entity-enrichment", `15 */2 * * *`) runs
// `SELECT public.call_sam_batch_lookup()`, which does a `net.http_get` against
// `.../functions/v1/sam-entity-lookup?mode=batch&limit=50`. Companion cron
// jobid 19 ("sam-propagate-to-owners") consumes what this writes. See gov
// CLAUDE.md §18/§25 and docs/history/EDGE_FUNCTION_AUDIT.md for the full
// history, including the rate-limit correction: the API key is valid, but a
// non-federal personal key with no role gets ~10 lookups/day from SAM.gov,
// not the 1,000/day the batch size assumes — most 2-hourly runs quota out on
// the first owner (see `RateLimitError` below and the batch response's
// `rate_limited` field).
//
// WRITES: upserts `sam_entities` (on `uei`), and via
// `sam_lookup_candidates`/`sam_mark_owner_checked` RPCs, marks
// `recorded_owners`/`true_owners` as SAM-checked.
//
// Before redeploying this file, re-diff it against the live deployment
// (Supabase MCP `get_edge_function`, project scknotsqkcheojiaewwh, slug
// sam-entity-lookup).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * SAM.gov Entity Lookup Pipeline v3 (feed-widened 2026-07-29, W1.4)
 *
 * Queries SAM.gov Entity Management API v3 to enrich owners with registration
 * data (UEI, address, points-of-contact, NAICS codes).
 *
 * Modes:
 *   ?mode=batch     — Process next N un-checked owners (default 10, cap 50)
 *   ?mode=uei       — Look up specific UEI: ?uei=XXXXX
 *   ?mode=name      — Search by name: ?name=COMPANY+LLC
 *   ?mode=stats     — Return enrichment progress stats
 *
 * BATCH candidate selection (v3): delegated to the gov SQL RPC
 * `sam_lookup_candidates(p_limit)`, which returns BOTH recorded_owners and
 * true_owners not yet SAM-checked, value-ranked by max property gross_rent,
 * GSA-lessor-linked deferred-llc_research_queue owners FIRST. Each candidate
 * carries its owner_kind so the match stores on the correct FK and the owner is
 * marked checked on the correct table.
 *
 * Requires SAM_GOV_API_KEY in Supabase secrets. Rate limit: 1000/day. Cron 50/2h.
 */

const SAM_API_BASE = 'https://api.sam.gov/entity-information/v3/entities';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function extractAddress(addr: any) {
  if (!addr) return null;
  return {
    line1: addr.addressLine1 || null,
    line2: addr.addressLine2 || null,
    city: addr.city || null,
    state: addr.stateOrProvinceCode || null,
    zip: addr.zipCode || addr.zipCodePlus4 || null,
    country: addr.countryCode || 'USA',
  };
}

function extractContacts(contacts: any) {
  if (!contacts) return null;
  const result: any[] = [];
  for (const key of Object.keys(contacts)) {
    const c = contacts[key];
    if (c && (c.firstName || c.lastName)) {
      result.push({
        type: key,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        title: c.title || null,
        phone: c.USPhone || c.nonUSPhone || null,
        email: c.email || null,
      });
    }
  }
  return result.length ? result : null;
}

function isRealSamUEI(uei: string): boolean {
  if (!uei) return false;
  const cleaned = uei.replace(/-C$/, '').trim();
  return /^[A-Z0-9]{12}$/i.test(cleaned);
}

class RateLimitError extends Error {
  nextAccessTime: string;
  constructor(msg: string, nextTime: string) {
    super(msg);
    this.nextAccessTime = nextTime;
  }
}

async function callSamApi(apiKey: string, params: Record<string, string>): Promise<any[]> {
  const searchParams = new URLSearchParams({
    api_key: apiKey,
    ...params,
    includeSections: 'entityRegistration,coreData,pointsOfContact',
  });

  const resp = await fetch(`${SAM_API_BASE}?${searchParams}`, {
    headers: { Accept: 'application/json' },
  });

  if (resp.status === 429) {
    const body = await resp.json().catch(() => ({}));
    throw new RateLimitError(
      `SAM API rate limited: ${body.description || 'quota exceeded'}`,
      body.nextAccessTime || 'unknown'
    );
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SAM API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return (data.entityData || []).map((e: any) => ({
    ...e.entityRegistration,
    ...e.coreData,
    pointsOfContact: e.pointsOfContact,
  }));
}

async function upsertSamEntity(
  supabase: any,
  entity: any,
  ownerKind: string | null,
  ownerId: string | null,
  confidence: number
) {
  const row = {
    uei: entity.ueiSAM || null,
    legal_business_name: entity.legalBusinessName || null,
    dba_name: entity.dbaName || null,
    physical_address: extractAddress(entity.physicalAddress),
    mailing_address: extractAddress(entity.mailingAddress),
    entity_structure: entity.entityStructureDesc || null,
    registration_status: entity.registrationStatus || null,
    registration_date: entity.registrationDate || null,
    expiration_date: entity.registrationExpirationDate || null,
    cage_code: entity.cageCode || null,
    naics_codes: entity.naicsCode ? [entity.naicsCode] : null,
    psc_codes: entity.pscCode ? [entity.pscCode] : null,
    entity_url: entity.entityURL || null,
    points_of_contact: extractContacts(entity.pointsOfContact),
    true_owner_id: ownerKind === 'true' ? ownerId : null,
    recorded_owner_id: ownerKind === 'recorded' ? ownerId : null,
    match_confidence: confidence,
    raw_data: entity,
    updated_at: new Date().toISOString(),
  };

  return await supabase
    .from('sam_entities')
    .upsert(row, { onConflict: 'uei' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') || 'stats';
  const apiKey = Deno.env.get('SAM_GOV_API_KEY');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    if (mode === 'stats') {
      const { data: stats } = await supabase.rpc('sam_enrichment_stats');
      return new Response(JSON.stringify({
        api_key_configured: !!apiKey,
        stats,
        usage: 'Modes: ?mode=batch&limit=10, ?mode=uei&uei=XXX, ?mode=name&name=XXX, ?mode=stats',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'SAM_GOV_API_KEY not configured',
        instructions: 'Get API key from https://sam.gov/profile/details, then add as Supabase secret',
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'uei') {
      const uei = url.searchParams.get('uei');
      if (!uei) throw new Error('Missing ?uei= parameter');

      const entities = await callSamApi(apiKey, { ueiSAM: uei });
      const results = [];
      for (const e of entities) {
        const { error } = await upsertSamEntity(supabase, e, null, null, 1.0);
        results.push({ uei: e.ueiSAM, name: e.legalBusinessName, error: error?.message });
      }

      return new Response(JSON.stringify({ found: entities.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'name') {
      const name = url.searchParams.get('name');
      if (!name) throw new Error('Missing ?name= parameter');

      const entities = await callSamApi(apiKey, { legalBusinessName: name, registrationStatus: 'A' });
      const results = [];
      for (const e of entities) {
        const { error } = await upsertSamEntity(supabase, e, null, null, 0.9);
        results.push({
          uei: e.ueiSAM,
          name: e.legalBusinessName,
          address: extractAddress(e.physicalAddress),
          error: error?.message,
        });
      }

      return new Response(JSON.stringify({ query: name, found: entities.length, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'batch') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

      const { data: owners, error: candErr } = await supabase
        .rpc('sam_lookup_candidates', { p_limit: limit });

      if (candErr) throw new Error(`candidate rpc failed: ${candErr.message}`);

      if (!owners?.length) {
        return new Response(JSON.stringify({ processed: 0, message: 'No un-checked owners in candidate universe' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const results = [];
      let matched = 0;
      let apiCalls = 0;
      let rateLimited = false;
      let recordedProcessed = 0;
      let trueProcessed = 0;

      for (const owner of owners) {
        if (rateLimited) break;
        const ownerKind = owner.owner_kind === 'recorded' ? 'recorded' : 'true';
        if (ownerKind === 'recorded') recordedProcessed++; else trueProcessed++;

        try {
          let entities: any[] = [];
          const uei = owner.uei;

          if (uei && isRealSamUEI(uei)) {
            entities = await callSamApi(apiKey, { ueiSAM: uei.replace(/-C$/, '') });
            apiCalls++;
          }

          if (!entities.length) {
            entities = await callSamApi(apiKey, {
              legalBusinessName: owner.name,
              registrationStatus: 'A',
            });
            apiCalls++;
          }

          await supabase.rpc('sam_mark_owner_checked', {
            p_owner_kind: ownerKind,
            p_owner_id: owner.owner_id,
            p_match_count: entities.length,
          });

          if (entities.length > 0) {
            const best = entities[0];
            const confidence = (uei && isRealSamUEI(uei)) ? 0.95 : 0.85;
            await upsertSamEntity(supabase, best, ownerKind, owner.owner_id, confidence);
            matched++;
            results.push({
              owner_kind: ownerKind,
              tier: owner.priority_tier,
              owner: owner.name,
              sam_name: best.legalBusinessName,
              uei: best.ueiSAM,
              address: extractAddress(best.physicalAddress),
              contacts: extractContacts(best.pointsOfContact)?.length || 0,
              confidence,
            });
          } else {
            results.push({ owner_kind: ownerKind, tier: owner.priority_tier, owner: owner.name, sam_name: null, uei: null });
          }

          await new Promise(r => setTimeout(r, 600));

        } catch (err) {
          if (err instanceof RateLimitError) {
            rateLimited = true;
            results.push({
              owner: owner.name,
              error: 'Rate limited — stopping batch',
              next_access: err.nextAccessTime,
            });
          } else {
            results.push({ owner: owner.name, error: String(err) });
          }
        }
      }

      return new Response(JSON.stringify({
        processed: results.length,
        recorded_processed: recordedProcessed,
        true_processed: trueProcessed,
        matched,
        api_calls: apiCalls,
        rate_limited: rateLimited,
        results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({
        error: 'SAM.gov daily quota exceeded',
        next_access: err.nextAccessTime,
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
