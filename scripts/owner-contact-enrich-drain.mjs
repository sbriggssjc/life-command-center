#!/usr/bin/env node
// ============================================================================
// owner-contact-enrich drain (workstation one-shot) — Life Command Center
//
// ORE Phase 1 Unit A wired ~729 named SOS-manager decision-makers into
// owner_contact_pivot. The owner-contact-enrich worker attaches them (+ links the
// person + seeds a value-gated cadence) and now selects VALUE-RANKED — highest
// rank_value first (v_owner_contact_enrich_queue) — so the few high-value owners
// drain BEFORE the long tail. The */daily cron drains this over time at ~32/tick;
// this script loops the SAME endpoint with gentle pacing to drain the one-time
// backlog ON DEMAND.
//
// It is a thin caller — every guard / attach / cadence-seed / idempotency runs
// SERVER-SIDE in the worker. The value-ranked order is inherited from Unit 1, so
// the highest-value owners attach first regardless of how many ticks it takes.
//
// FLOW: loop POST /api/owner-contact-enrich-tick?limit=<limit> until processed=0
//       (or --max-ticks), pausing --delay-ms between ticks to stay gentle on the
//       60-connection LCC Opps tier.
//
// SAFETY: --dry-run issues a GET (the worker's read-only dry-run) and stops after
//   one tick. The real drain is idempotent + capped per tick; re-running is safe
//   (an attached owner leaves the candidate set; a non-attach advances updated_at).
//
// ENV / ARGS:
//   --base / LCC_BASE_URL   the live LCC origin (Railway)
//   --key  / LCC_API_KEY    X-LCC-Key
//   --limit                 rows per tick (default 50; the worker also wall-clock-caps)
//   --delay-ms              pause between ticks (default 1500)
//   --max-ticks             safety cap on iterations (default 200)
//   --dry-run               one GET dry-run, no writes
//
// USAGE:
//   LCC_BASE_URL=https://<app> LCC_API_KEY=… node scripts/owner-contact-enrich-drain.mjs --dry-run
//   LCC_BASE_URL=https://<app> LCC_API_KEY=… node scripts/owner-contact-enrich-drain.mjs --limit 50
// ============================================================================

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv);
const BASE = (args.base || process.env.LCC_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = args.key || process.env.LCC_API_KEY || '';
const LIMIT = Math.min(parseInt(args.limit, 10) || 50, 200);
const DELAY_MS = parseInt(args['delay-ms'], 10) || 1500;
const MAX_TICKS = parseInt(args['max-ticks'], 10) || 200;
const DRY_RUN = !!args['dry-run'];

const ENDPOINT = `${BASE}/api/owner-contact-enrich-tick?limit=${LIMIT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!BASE || !API_KEY) {
    console.error('ERROR: --base/LCC_BASE_URL and --key/LCC_API_KEY are required.');
    process.exit(1);
  }
  const headers = { 'X-LCC-Key': API_KEY, 'content-type': 'application/json' };

  if (DRY_RUN) {
    const res = await fetch(ENDPOINT, { headers });
    const body = await res.json().catch(() => ({}));
    console.log(`[dry-run] ${res.status}`, JSON.stringify(body));
    return;
  }

  const totals = { ticks: 0, processed: 0, attached: 0, drillthrough: 0, failed: 0, skipped: 0 };
  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const res = await fetch(ENDPOINT, { method: 'POST', headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`[tick ${tick}] FAILED ${res.status}`, JSON.stringify(body));
      process.exit(1);
    }
    totals.ticks = tick;
    totals.processed += body.processed || 0;
    totals.attached += body.attached || 0;
    totals.drillthrough += body.drillthrough || 0;
    totals.failed += body.failed || 0;
    totals.skipped += body.skipped || 0;
    console.log(`[tick ${tick}] processed=${body.processed} attached=${body.attached} `
      + `drillthrough=${body.drillthrough} failed=${body.failed} skipped=${body.skipped}`);
    if (!body.processed) { console.log('[done] candidate queue drained.'); break; }
    await sleep(DELAY_MS);
  }
  console.log('[totals]', JSON.stringify(totals));
}

main().catch((e) => { console.error(e); process.exit(1); });
