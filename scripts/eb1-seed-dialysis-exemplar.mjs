#!/usr/bin/env node
/**
 * EB1 — seed `market_brief_facts` from the dialysis market-brief exemplar.
 *
 * Source: docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md. Facts are
 * hand-transcribed here (not parsed from the markdown at runtime) because the
 * exemplar is prose with inline citation markers, not structured data — a
 * markdown parser would be guessing at fact boundaries the same way an LLM
 * summarizer would, which is exactly what the living-brief design (spec §1)
 * exists to avoid. Every fact below carries the exemplar's own source
 * citation verbatim.
 *
 * WHAT IS EXCLUDED, DELIBERATELY: every claim the exemplar itself marks
 * [UNVERIFIED] (a 2026 FMC rating action, USRC's Moody's timing, IRC M&A
 * activity, a dialysis-specific cap-rate average, GLP-1 demand impact) is NOT
 * loaded as a fact. The prompt is explicit about this ("Its 'unverified' items
 * are not loaded as facts") and it matches the standing never-fabricate rule:
 * an unverified claim is not a fact merely because a research draft wrote it
 * down.
 *
 * TTLs per spec §3, mapped onto the market_brief_facts.section vocabulary:
 *   operators        -> 100 days (quarterly operator results)
 *   policy           -> 45 days  (CMS ESRD PPS cadence)
 *   capital_markets  -> the rates/Fed facts get 2 days (daily-moving), the
 *                        broker cap-rate survey facts get 100 days (quarterly)
 *   trades           -> 30 days  (our comps / trades TTL)
 *   implications     -> NULL (opinion, "tied to inputs" per spec — no clock
 *                        TTL computable at seed time; a future synthesizer
 *                        rebuild is what actually retires these, not a timer)
 *
 * IDEMPOTENT: relies on the migration's own unique index
 * uq_mbf_source_identity (lane, section, source_url, source_date, claim_text)
 * via `Prefer: resolution=ignore-duplicates` — a second run inserts 0 new
 * rows. Every fact here carries a source_url + source_date, so all of them
 * fall inside that index (nothing here needs a second dedupe key).
 *
 * DRY RUN BY DEFAULT. Usage (repo root, reads .env.local):
 *   node scripts/eb1-seed-dialysis-exemplar.mjs            # dry run, prints the plan
 *   node scripts/eb1-seed-dialysis-exemplar.mjs --apply    # writes to market_brief_facts
 *
 * REVERSAL:
 *   delete from market_brief_facts
 *    where lane = 'dialysis' and origin = 'web_research'
 *      and metadata_batch_tag = 'eb1_dialysis_exemplar_20260911';
 *   -- (batch tag rides in claim provenance only via this script's own log;
 *   --  there is no metadata column on market_brief_facts to tag rows with,
 *   --  so a real reversal keys on the (lane, source_url) set printed by a
 *   --  dry run instead — see PRINTED PLAN below.)
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Env loading (matches scripts/feed-gov-ownership-transitions.mjs).
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
    return f;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure. Returns the exemplar's facts as plain objects — no clock, no env, no
 * network — so it is directly unit-testable for idempotency and content
 * (test/eb1-seed-exemplar.test.mjs calls this twice and asserts the two
 * calls are deep-equal, and that no [UNVERIFIED] claim leaked through).
 *
 * @returns {Array<object>} fact specs, each missing only `fetched_at` /
 *   `stale_after` (computed by buildRowsForWrite(), which needs a clock).
 */
export function buildDialysisExemplarFacts() {
  const EX = {
    title: 'Dialysis Net-Lease Market Brief: Q3 2026',
    url: 'docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md',
  };
  const src = (title, url, date) => ({ source_title: title, source_url: url, source_date: date });

  const S1 = src(
    'Fresenius Medical Care Q2 2026 slides: margins soar despite volume pressure',
    'https://www.investing.com/news/company-news/fresenius-medical-care-q2-2026-slides-margins-soar-despite-volume-pressure-93CH-4833292',
    '2026-08-04',
  );
  const S3 = src(
    'DaVita Inc. 2nd Quarter 2026 Results',
    'https://investors.davita.com/2026-08-04-davita-inc-2nd-quarter-2026-results/',
    '2026-08-04',
  );
  const S5 = src(
    'CY 2027 ESRD PPS Proposed Rule fact sheet',
    'https://www.cms.gov/newsroom/fact-sheets/calendar-year-cy-2027-end-stage-renal-disease-esrd-prospective-payment-system-proposed-rule',
    '2026-06-24',
  );
  const S6 = src(
    'CMS Proposes 1.1 Percent Payment Increase for ESRD Facilities in CY 2027',
    'https://www.appliedpolicy.com/cms-proposes-1-1-percent-payment-increase-for-esrd-facilities-in-cy-2027/',
    '2026-06-29',
  );
  const S7 = src(
    'CY 2026 ESRD PPS Final Rule fact sheet',
    'https://www.cms.gov/newsroom/fact-sheets/calendar-year-cy-2026-end-stage-renal-disease-esrd-prospective-payment-system-final-rule',
    '2025-11-20',
  );
  const S8 = src(
    'US 10-Year Treasury Note Yield',
    'https://tradingeconomics.com/united-states/government-bond-yield',
    '2026-09-11',
  );
  const S10 = src(
    'Net Lease Cap Rates Tick Upward in Q2 2026 (Boulder Group data)',
    'https://www.connectcre.com/stories/net-lease-cap-rates-tick-upward-in-q2-2026/',
    '2026-07-13',
  );
  const S12 = src(
    "Moody's and S&P change Fresenius Medical Care's rating outlook to stable",
    'https://freseniusmedicalcare.com/en/media/newsroom/moody-s-and-s-amp-p-change-fresenius-medical-care-s-rating-outlook-to-stable/',
    '2024-05-23',
  );
  const S13 = src(
    'DaVita Credit Rating & NNN Cap Rate',
    'https://investmentgrade.com/davita-credit-rating-nnn-cap-rate/',
    '2026-06-14',
  );
  const S17 = src(
    'Net-Leased DaVita Dialysis Property Trades in the Bronx',
    'https://www.connectcre.com/stories/net-leased-davita-dialysis-property-trades-in-the-bronx/',
    '2025-08-07',
  );

  const facts = [
    // -- operators (reported, 100-day TTL) ----------------------------------
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: "Fresenius Medical Care's U.S. same-market treatments fell 0.9% year over year in Q2 2026.",
      value: -0.9, unit: 'percent', ...S1,
    },
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: 'Fresenius Medical Care exited about 100 U.S. clinics under portfolio optimization in Q2 2026; total clinics fell 4% to 3,513.',
      value: null, unit: null, ...S1,
    },
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: 'DaVita reported normalized non-acquired treatment growth of +0.3% and 2,671 U.S. outpatient centers in Q2 2026, and reaffirmed 2026 guidance.',
      value: 0.3, unit: 'percent', ...S3,
    },
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: "DaVita's Q2 2026 revenue was $3.554B, operating income $579M, adjusted EPS $4.02.",
      value: 3.554, unit: 'billion_usd', ...S3,
    },
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: "Fresenius Medical Care is rated Baa3 (Moody's) / BBB- (S&P), outlook stable since May 2024.",
      value: null, unit: null, ...S12,
    },
    {
      section: 'operators', fact_kind: 'reported', ttl_days: 100,
      claim_text: 'DaVita is rated BB+/Ba2, stable, per a third-party broker page.',
      value: null, unit: null, ...S13,
    },

    // -- policy (reported, 45-day TTL — CMS ESRD PPS cadence) ---------------
    {
      section: 'policy', fact_kind: 'reported', ttl_days: 45,
      claim_text: "CMS's CY2027 ESRD PPS proposed rule (released 6/24/2026) sets a base rate of $299.55, up from $281.71.",
      value: 299.55, unit: 'usd', ...S5,
    },
    {
      section: 'policy', fact_kind: 'reported', ttl_days: 45,
      claim_text: 'Under the CY2027 proposed rule, total ESRD PPS payments rise about 1.1% for freestanding facilities (about $6.2B to about 7,600 facilities).',
      value: 1.1, unit: 'percent', ...S6,
    },
    {
      section: 'policy', fact_kind: 'reported', ttl_days: 45,
      claim_text: '$15.96 of the CY2027 base-rate increase comes from folding phosphate binders out of TDAPA and into the base rate.',
      value: 15.96, unit: 'usd', ...S6,
    },
    {
      section: 'policy', fact_kind: 'reported', ttl_days: 45,
      claim_text: "CMS's ETC (End-Stage Renal Disease Treatment Choices) model ended 12/31/2025 for missing its home-dialysis and savings targets.",
      value: null, unit: null, ...S7,
    },

    // -- capital_markets: rates/Fed (reported, 2-day TTL) -------------------
    {
      section: 'capital_markets', fact_kind: 'reported', ttl_days: 2,
      claim_text: 'The 10-year Treasury yield was 4.94% on 9/11/2026, up 24 bps over one month and 87 bps year over year.',
      value: 4.94, unit: 'percent', ...S8,
    },

    // -- capital_markets: broker cap-rate surveys (reported, 100-day TTL) ---
    {
      section: 'capital_markets', fact_kind: 'reported', ttl_days: 100,
      claim_text: "Boulder Group's overall net-lease cap rate was 6.82% in Q2 2026, up 2 bps from 6.80% in Q1 2026.",
      value: 6.82, unit: 'percent', ...S10,
    },
    {
      section: 'capital_markets', fact_kind: 'reported', ttl_days: 100,
      claim_text: 'Investment Grade Income Property quotes DaVita NNN cap rates in a range of 5.50%-6.75% (a broker marketing figure, not a transaction index).',
      value: null, unit: null, ...S13,
    },

    // -- trades (reported, 30-day TTL) ---------------------------------------
    {
      section: 'trades', fact_kind: 'reported', ttl_days: 30,
      claim_text: 'A net-leased DaVita dialysis property in the Bronx, NY traded for $4.2M (14,110 SF) on 8/7/2025, with multiple offers above asking within 10 days; cap rate not disclosed.',
      value: 4.2, unit: 'million_usd', ...S17,
    },

    // -- implications (opinion, no clock TTL — "tied to inputs", spec §3) ---
    {
      section: 'implications', fact_kind: 'opinion', ttl_days: null,
      claim_text: "Buyers will underwrite each dialysis site on its own merits (market share, patient census, lease term, rent versus market), separating Fresenius sites at risk of closure from gaining DaVita sites.",
      value: null, unit: null,
      source_title: EX.title, source_url: EX.url, source_date: '2026-09-11',
    },
    {
      section: 'implications', fact_kind: 'opinion', ttl_days: null,
      claim_text: 'Sellers of long-term, well-performing dialysis clinics should move before any further rise in rates; short-term Fresenius leases in overlapping markets face the widest bid-ask spreads.',
      value: null, unit: null,
      source_title: EX.title, source_url: EX.url, source_date: '2026-09-11',
    },
  ];

  return facts.map((f) => ({
    lane: 'dialysis',
    origin: 'web_research',
    confidence: f.fact_kind === 'opinion' ? 0.6 : 0.9,
    ...f,
  }));
}

/**
 * Pure. Attaches fetched_at (the moment this seed runs) and stale_after
 * (fetched_at + ttl_days, or null) to each fact spec — the ONE place ttl_days
 * is converted into a clock instant, matching the migration's own rule that
 * stale_after is computed by the WRITER at insert time.
 */
export function buildRowsForWrite(facts, nowIso = new Date().toISOString()) {
  const now = new Date(nowIso);
  return facts.map(({ ttl_days, ...f }) => ({
    ...f,
    fetched_at: nowIso,
    stale_after: ttl_days == null ? null : new Date(now.getTime() + ttl_days * DAY_MS).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const envFile = loadEnvLocal();
  const APPLY = process.argv.includes('--apply');

  const OPS_URL = process.env.OPS_SUPABASE_URL;
  const OPS_KEY = process.env.OPS_SUPABASE_KEY;

  const facts = buildDialysisExemplarFacts();
  const rows = buildRowsForWrite(facts);

  const bySection = {};
  for (const r of rows) bySection[r.section] = (bySection[r.section] || 0) + 1;

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — EB1 dialysis exemplar seed`);
  console.log(`  facts to write: ${rows.length}`);
  console.log(`  by section: ${JSON.stringify(bySection)}`);
  console.log(`  by fact_kind: reported=${rows.filter((r) => r.fact_kind === 'reported').length}, `
            + `opinion=${rows.filter((r) => r.fact_kind === 'opinion').length}`);
  console.log('  unverified exemplar items excluded (not loaded): 5 '
            + '(FMC 2026 rating action, USRC Moody\'s timing, IRC M&A, dialysis-specific cap-rate '
            + 'average, GLP-1 demand impact)');

  if (!APPLY) {
    console.log('\nDry run — no rows written. Re-run with --apply to write.');
    console.log('\nPlanned rows (claim_text, section, source_url):');
    for (const r of rows) {
      console.log(`  [${r.section}] ${r.claim_text.slice(0, 90)}${r.claim_text.length > 90 ? '…' : ''}`);
      console.log(`      ${r.source_url || '(no source_url — implications rows cite the exemplar itself)'}`);
    }
    return;
  }

  if (!OPS_URL || !OPS_KEY) {
    console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY.');
    console.error(envFile ? `Read ${envFile} but those keys were not in it.` : 'No .env.local found.');
    process.exit(1);
  }

  // Idempotent via the migration's uq_mbf_source_identity unique index —
  // ignore-duplicates means a re-run of this exact seed inserts 0 new rows.
  const url = `${OPS_URL}/rest/v1/market_brief_facts`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: OPS_KEY,
      Authorization: `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=ignore-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error(`POST failed: ${r.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }
  const written = await r.json().catch(() => []);
  console.log(`\nWrote ${Array.isArray(written) ? written.length : '?'} rows `
            + `(of ${rows.length} planned — the delta is rows ignore-duplicates skipped on a re-run).`);
}

// Guard per CLAUDE.md's Windows-safe main-guard rule (OCR1): never a
// string-built file:// compare.
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
