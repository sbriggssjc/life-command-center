#!/usr/bin/env node
// ============================================================================
// scripts/availability-checker-acceptance.mjs
//
// Runs the live acceptance check for the availability-checker Edge Function
// (Round 76ej.g). Targets the deployed Edge Function's debug endpoint, so
// no DB writes happen — this is purely a "do the parsers see what we
// expect for these URLs" smoke test.
//
// Usage:
//   node scripts/availability-checker-acceptance.mjs --samples samples.json
//
// Sample file format (JSON array):
//   [
//     { "label": "active-1",  "url": "https://www.crexi.com/...", "expected": "active" },
//     { "label": "sold-1",    "url": "https://www.crexi.com/...", "expected": "sold"   },
//     ...
//   ]
//
// Recognized `expected` values:
//   "active" → outcome must be 'still_available'
//   "sold"   → outcome must be 'off_market' or 'off_market_sold_hint'
//   "gone"   → outcome must be 'off_market', 'off_market_sold_hint', or
//              'unreachable' (any "not on the market right now" verdict)
//
// Required env (.env.local or process):
//   EDGE_BASE       e.g. https://xengecqvemvfknjvbvrq.supabase.co/functions/v1
//   LCC_API_KEY     for Authorization: Bearer ...
//
// Pre-build the sample file from PostgREST:
//   See docs/availability_checker_acceptance.md for the SQL queries.
// ============================================================================

import fs from 'node:fs';
import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);

const samplesPath = (() => {
  const i = argv.indexOf('--samples');
  if (i === -1 || !argv[i + 1]) {
    console.error('--samples <path> is required');
    process.exit(2);
  }
  return argv[i + 1];
})();

const EDGE_BASE = (env.EDGE_BASE || '').replace(/\/+$/, '');
if (!EDGE_BASE) {
  console.error('EDGE_BASE not set (e.g. https://<ops-ref>.supabase.co/functions/v1)');
  process.exit(2);
}
const API_KEY = env.LCC_API_KEY || env.LCC_CRON_KEY || '';
if (!API_KEY) {
  console.error('LCC_API_KEY not set');
  process.exit(2);
}

const samples = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));
if (!Array.isArray(samples) || samples.length === 0) {
  console.error('Sample file must be a non-empty JSON array');
  process.exit(2);
}

// Map an `expected` label to the set of outcomes that satisfy it. We're
// deliberately tolerant on `sold` / `gone` because the worker correctly
// downgrades sold-flavored markers to off_market_sold_hint (worker never
// writes status='sold' on its own — that's the sales_transactions watcher's
// job), and a 404 on a known-removed listing is still a correct verdict.
const ACCEPTABLE = {
  active: new Set(['still_available']),
  sold:   new Set(['off_market', 'off_market_sold_hint']),
  gone:   new Set(['off_market', 'off_market_sold_hint', 'unreachable']),
};

async function checkOne(sample) {
  const t0 = Date.now();
  const resp = await fetch(`${EDGE_BASE}/availability-checker?action=check_url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ url: sample.url }),
  });
  const ms = Date.now() - t0;
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  const outcome = body?.parsed?.outcome || 'error';
  const ok = ACCEPTABLE[sample.expected]?.has(outcome) || false;
  return {
    label: sample.label || sample.url,
    expected: sample.expected,
    outcome,
    parser: body?.parsed?.parser,
    matched: body?.parsed?.matched,
    http_status: body?.http_status ?? body?.parsed?.http_status,
    final_url: body?.final_url,
    pass: ok,
    duration_ms: ms,
    raw: body,
  };
}

console.log(`Running ${samples.length} acceptance checks against ${EDGE_BASE} ...\n`);

const results = [];
for (const s of samples) {
  process.stdout.write(`  ${(s.label || s.url).padEnd(40)} ... `);
  const r = await checkOne(s);
  results.push(r);
  process.stdout.write(
    `${r.pass ? 'PASS' : 'FAIL'}  ` +
    `outcome=${r.outcome.padEnd(22)}  ` +
    `parser=${(r.parser || '-').padEnd(10)}  ` +
    `http=${r.http_status ?? '-'}\n`,
  );
  if (!r.pass) {
    console.log(`        expected=${r.expected}  matched=${r.matched ?? '-'}`);
    console.log(`        final_url=${r.final_url ?? '-'}`);
  }
}

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
const ratio = `${pass}/${results.length}`;
console.log(`\n${ratio} matched. (${fail} failures)`);

// Write a JSON report so the operator can attach it to the round notes.
const outPath = samplesPath.replace(/\.json$/, '') + '.results.json';
fs.writeFileSync(outPath, JSON.stringify({
  edge_base: EDGE_BASE,
  ran_at: new Date().toISOString(),
  pass,
  fail,
  ratio,
  results,
}, null, 2));
console.log(`Detailed report: ${outPath}`);

// Acceptance bar from the runbook: ≥8/10. Exit 1 if we miss it so CI can
// gate on this if desired.
const ACCEPTANCE_PCT = 0.8;
process.exit(pass / results.length >= ACCEPTANCE_PCT ? 0 : 1);
