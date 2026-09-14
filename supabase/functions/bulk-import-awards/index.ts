// ============================================================================
// bulk-import-awards — bulk upsert into gov.federal_lease_awards
// Project: government (scknotsqkcheojiaewwh)
//
// Synced to this repo 2026-09-07 (DRIFT1 Unit 2) from the live deployment
// (version 4) via Supabase MCP `get_edge_function`. Had NO committed source
// before this sync — see docs/architecture/edge-function-deploy-drift.md.
//
// Accepts a compact/abbreviated award payload (short keys `i/a/d/s/e/g/u/n/
// r/t/c/x/h` alongside the long field names, for a smaller wire payload from
// whatever client posts to it — no such client lives in this repo) and
// upserts into `federal_lease_awards` on `generated_unique_award_id`, in
// batches of 500. Narrow, idempotent, single-table write. No cron.job entry
// on gov references it and no caller was found in this repo or via GitHub
// code search — it is likely driven by a script in the `government-lease`
// repo's USASpending ingestion path (`src/ingest_usaspending.py`), which this
// repo does not have access to. See the census in
// docs/architecture/edge-function-deploy-drift.md for what "commit, liveness
// unknown" means here.
//
// Before redeploying this file, re-diff it against the live deployment
// (Supabase MCP `get_edge_function`, project scknotsqkcheojiaewwh, slug
// bulk-import-awards).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const awards = body.awards || [];

    if (!awards.length) {
      return new Response(JSON.stringify({ error: 'no awards provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const rows = awards.map((a: any) => ({
      generated_unique_award_id: a.i || a.generated_unique_award_id,
      award_type: 'Lease',
      total_obligation: a.a || a.total_obligation || null,
      description: (a.d || a.description || '').slice(0, 500),
      period_of_performance_start: a.s || a.period_of_performance_start || null,
      period_of_performance_end: a.e || a.period_of_performance_end || null,
      awarding_agency: a.g || a.awarding_agency || '',
      awarding_sub_agency: a.u || a.awarding_sub_agency || '',
      recipient_name: a.n || a.recipient_name || '',
      recipient_uei: a.r || a.recipient_uei || null,
      place_of_performance_state: a.t || a.place_of_performance_state || null,
      place_of_performance_city: a.c || a.place_of_performance_city || null,
      naics_code: a.x || a.naics_code || '531120',
      data_hash: a.h || a.data_hash || '',
    }));

    let inserted = 0;
    let errors: string[] = [];
    const batchSize = 500;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase
        .from('federal_lease_awards')
        .upsert(batch, { onConflict: 'generated_unique_award_id' });

      if (error) {
        errors.push(`Batch ${i}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      inserted,
      total_submitted: awards.length,
      errors: errors.length ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
