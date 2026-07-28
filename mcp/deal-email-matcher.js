// ============================================================================
// deal-email-matcher.js — Deal-Email Matcher (Spine #3), v2: frequency-adaptive recall.
// Place in mcp/deal-email-matcher.js (engine deploy context).
//
//   import { makeDealEmailMatcherRoute } from './deal-email-matcher.js';
//   const matcher = makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/match-deal-emails', authenticate, matcher.match);
//
// TB deals have no structured SF party roster (see deal-party-roster-source.md), so this attributes
// the Outlook emails (which resolve to PERSON entities) to DEALS by STRONG SIGNALS.
//
// v2 recall (see matcher-recall-design.md): the v1 rule "full tenant segment AND city, both verbatim"
// missed two ways — suffix noise ("Innovative Renal Care MOB" never appears verbatim) and city omission
// (that deal's threads never say "Milwaukee"). v2:
//   * CORE TENANT = tenant segment with generic descriptors stripped (MOB/Dialysis/Center/Care/…).
//   * FREQUENCY-ADAPTIVE mode per deal:
//       - tenant_alone : core tenant is DISTINCTIVE (few corpus hits, <= maxTenantAlone) AND unique among
//                        in-scope deals AND != city  ->  match on tenant alone (recovers city-omitted threads).
//       - tenant_city  : high-frequency operator (DaVita 1051, Fresenius 506) or a core tenant shared by
//                        >=2 in-scope deals  ->  require tenant + city (v1 behavior; preserves precision).
//   * ?dry_run=1 (query or body): compute + report per-deal {core_tenant, mode, N, would_attribute} and
//     WRITE NOTHING — validate precision on real data before a live run. maxTenantAlone tunable (default 25).
//
// On a live match it (unchanged): (1) writes a deal-attributed activity_events row on the ASSET, idempotent
// by (entity_id, external_id); (2) writes the email's person as an 'email_derived' deal_party edge.
// Scope = in-scope open Team Briggs deals (owned OR partnership OR explicit include).
// ============================================================================

const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001';
const REL = 'deal_party';
const CAND_LIMIT = 1200;   // per-deal candidate cap (core-tenant hits); city filter runs in memory
const DEFAULT_MAX_TENANT_ALONE = 25;   // corpus-hit ceiling for a core tenant to be "distinctive"

// Generic descriptor tokens stripped to get the distinctive core of a tenant. Order-independent; applied
// as a word filter. Kept conservative — we never strip below 4 chars (fall back to the full tenant).
const GENERIC = new Set([
  'mob', 'dialysis', 'clinic', 'clinics', 'center', 'centers', 'health', 'group', 'urgent',
  'care', 'medical', 'portfolio', 'anchored', 'inc', 'llc', 'the', 'ii', 'iii', 'iv', 'i',
  'trust', 'company', 'co', 'corp', 'lp', 'ltd', 'associates', 'partners',
]);

function tenantSegment(name) {
  return String(name || '').split(/\s+-\s+/)[0].replace(/\(.*\)/g, '').trim();
}
function cityBaseOf(city) {
  return String(city || '').replace(/\(.*\)/g, '').trim();
}
// Distinctive core: strip generic descriptor words + standalone numbers. Never over-strip.
function coreTenantOf(tenantSeg) {
  const words = String(tenantSeg || '').replace(/[&/]/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => {
    const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!bare) return false;
    if (GENERIC.has(bare)) return false;
    if (/^\d+$/.test(bare)) return false;   // standalone numbers ("2", "Portfolio 2")
    return true;
  });
  const core = kept.join(' ').trim();
  return core.length >= 4 ? core : tenantSeg;   // fall back rather than strip to noise
}

export function makeDealEmailMatcherRoute({ opsQuery, enc, WORKSPACE_ID }) {
  return {
    match: async (req, res) => {
      try {
        const q = { ...(req.query || {}), ...(req.body || {}) };
        const dryRun = q.dry_run === 1 || q.dry_run === '1' || q.dry_run === true || q.dry_run === 'true';
        const maxTenantAlone = Number(q.max_tenant_alone) > 0 ? Number(q.max_tenant_alone) : DEFAULT_MAX_TENANT_ALONE;

        // 1. In-scope open deals (same scope rule as cadence-scan).
        const [tbRes, oppRes, edgeRes] = await Promise.all([
          opsQuery('GET', 'lcc_users?select=lcc_user_id&active=eq.true'),
          opsQuery('GET',
            `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=not.is.null&is_open=eq.true` +
            `&select=entity_id,sf_opp_id,owner_user_id,metadata`),
          opsQuery('GET',
            `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&relationship_type=eq.deal_party` +
            `&metadata->>source=eq.sf_opp_team&select=from_entity_id`),
        ]);
        const tbUsers = new Set((tbRes.data || []).map(r => r.lcc_user_id));
        const tbTeamAssets = new Set((edgeRes.data || []).map(r => r.from_entity_id));
        const inScope = (oppRes.data || []).filter(d =>
          (d.owner_user_id && tbUsers.has(d.owner_user_id)) ||
          tbTeamAssets.has(d.entity_id) ||
          d.metadata?.team_briggs_include === true);

        // 2. Entity name/city for each in-scope deal.
        const ids = [...new Set(inScope.map(d => d.entity_id).filter(Boolean))];
        const nameById = new Map();
        if (ids.length) {
          const er = await opsQuery('GET',
            `entities?id=in.(${ids.map(x => enc(x)).join(',')})&select=id,name,city,state`);
          for (const e of (er.data || [])) nameById.set(e.id, e);
        }

        // 2b. Core-tenant uniqueness across in-scope deals (a core tenant shared by >=2 deals must use city).
        const coreCount = new Map();
        for (const d of inScope) {
          const e = nameById.get(d.entity_id);
          if (!e) continue;
          const core = coreTenantOf(tenantSegment(e.name)).toLowerCase();
          coreCount.set(core, (coreCount.get(core) || 0) + 1);
        }

        const summary = {
          version: 'v2', dry_run: dryRun, max_tenant_alone: maxTenantAlone,
          deals_scanned: 0, deals_with_matches: 0, emails_attributed: 0,
          already_attributed: 0, roster_edges: 0, skipped_thin_tokens: 0,
          tenant_alone_deals: 0, tenant_city_deals: 0, errors: [],
        };
        const dryDeals = [];

        for (const d of inScope) {
          const e = nameById.get(d.entity_id);
          if (!e) { summary.skipped_thin_tokens++; continue; }
          const tSeg = tenantSegment(e.name);
          const cityBase = cityBaseOf(e.city);
          const core = coreTenantOf(tSeg);
          const cl = cityBase.toLowerCase();
          const coreL = core.toLowerCase();
          // Precision guard: need a distinctive core and a city, and the core must not just be the city.
          if (core.length < 4 || cityBase.length < 3 || coreL === cl) {
            summary.skipped_thin_tokens++; continue;
          }
          summary.deals_scanned++;

          // Candidate emails that mention the CORE tenant; city filter (if needed) applied in memory.
          const cand = await opsQuery('GET',
            `activity_events?source_type=eq.outlook` +
            `&or=(title.ilike.${enc('*' + core + '*')},body.ilike.${enc('*' + core + '*')})` +
            `&select=id,entity_id,title,body,occurred_at,external_id,domain&limit=${CAND_LIMIT}`);
          const all = cand.data || [];
          const N = all.length;
          const unique = (coreCount.get(coreL) || 0) <= 1;
          const capped = N >= CAND_LIMIT;
          // Distinctive => tenant-alone is safe. Otherwise fall back to tenant+city (v1).
          const tenantAlone = unique && !capped && N <= maxTenantAlone;
          const mode = tenantAlone ? 'tenant_alone' : 'tenant_city';
          const matches = tenantAlone
            ? all
            : all.filter(m => `${m.title || ''} ${m.body || ''}`.toLowerCase().includes(cl));
          if (mode === 'tenant_alone') summary.tenant_alone_deals++; else summary.tenant_city_deals++;
          if (matches.length) summary.deals_with_matches++;

          if (dryRun) {
            dryDeals.push({
              sf_opp_id: d.sf_opp_id, deal: e.name, core_tenant: core, city: cityBase,
              unique_in_scope: unique, corpus_hits: capped ? `>=${CAND_LIMIT}` : N,
              mode, would_attribute: matches.length,
              sample_titles: matches.slice(0, 4).map(m => (m.title || '').slice(0, 80)),
            });
            continue;   // never write in dry-run
          }

          for (const m of matches) {
            const key = m.external_id || m.id;   // idempotency key for the deal-attributed row
            try {
              // 2a. Deal-attributed activity row on the asset (idempotent by entity_id + external_id).
              const ex = await opsQuery('GET',
                `activity_events?entity_id=eq.${enc(d.entity_id)}&external_id=eq.${enc(key)}&category=eq.email&select=id&limit=1`);
              if (ex.data?.[0]?.id) {
                summary.already_attributed++;
              } else {
                const ins = await opsQuery('POST', 'activity_events', {
                  workspace_id: WORKSPACE_ID, actor_id: SYSTEM_ACTOR, entity_id: d.entity_id,
                  category: 'email', title: m.title || null, body: m.body || null,
                  occurred_at: m.occurred_at || null, external_id: key,
                  source_type: 'lcc:deal_match', domain: m.domain || null,
                  metadata: { matched_by: mode, core_tenant: core, city: cityBase,
                              source_email_id: m.id, source_entity_id: m.entity_id },
                });
                if (ins.ok === false) {
                  if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, detail: ins.data });
                } else {
                  summary.emails_attributed++;
                }
              }
              // 2b. Email-derived roster edge (deal -> the email's person).
              if (m.entity_id && m.entity_id !== d.entity_id) {
                const exr = await opsQuery('GET',
                  `entity_relationships?workspace_id=eq.${enc(WORKSPACE_ID)}&from_entity_id=eq.${enc(d.entity_id)}` +
                  `&to_entity_id=eq.${enc(m.entity_id)}&relationship_type=eq.${REL}&select=id&limit=1`);
                if (!exr.data?.[0]?.id) {
                  const insr = await opsQuery('POST', 'entity_relationships', {
                    workspace_id: WORKSPACE_ID, from_entity_id: d.entity_id, to_entity_id: m.entity_id,
                    relationship_type: REL, metadata: { role: 'correspondent', source: 'email_derived' },
                  });
                  if (insr.ok !== false) summary.roster_edges++;
                }
              }
            } catch (inner) {
              if (summary.errors.length < 50) summary.errors.push({ sf_opp_id: d.sf_opp_id, error: String(inner?.message || inner) });
            }
          }
        }

        if (dryRun) {
          dryDeals.sort((a, b) => (b.would_attribute || 0) - (a.would_attribute || 0));
          return res.status(200).json({ ok: true, ...summary, deals: dryDeals });
        }
        return res.status(200).json({ ok: true, ...summary });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },
  };
}
