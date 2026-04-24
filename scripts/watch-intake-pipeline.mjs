#!/usr/bin/env node
// ============================================================================
// scripts/watch-intake-pipeline.mjs
//
// Real-time pipeline monitor. Polls staged_intake_items for new rows and
// tracks each one through: extraction → match → promotion. Prints status
// transitions so you can trigger a flow (email, sidebar, copilot) in
// another window and watch the pipeline fire in real time.
//
// Columns per intake:
//   intake_id (8-char)  src  state  extract  match  promotion  elapsed
//
//   src         = source_type (email / copilot / manual)
//   state       = staged_intake_items.status
//   extract     = latest extraction's document_type or '—' if none yet
//   match       = 'matched/reason' or 'needs_review' or '—'
//   promotion   = 'yes' or '—'
//
// Usage:
//   node scripts/watch-intake-pipeline.mjs               # poll every 5s, last 30 min
//   node scripts/watch-intake-pipeline.mjs --since 5     # last 5 minutes
//   node scripts/watch-intake-pipeline.mjs --interval 2  # poll every 2s
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const SINCE_MIN = (() => {
  const i = argv.indexOf('--since');
  if (i === -1) return 30;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();
const POLL_MS = (() => {
  const i = argv.indexOf('--interval');
  if (i === -1) return 5000;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n >= 1 ? n * 1000 : 5000;
})();

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS creds'); process.exit(1); }

async function ops(method, path) {
  const res = await fetch(`${OPS_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: OPS_KEY, Authorization: `Bearer ${OPS_KEY}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { ok: res.ok, data: text ? JSON.parse(text) : null }; }
  catch { return { ok: res.ok, data: text }; }
}

// Track state per intake to show transitions
const state = new Map();

function fmtIntake(row) {
  return {
    intake_id: row.intake_id,
    src:       row.source_type || '?',
    state:     row.status || '?',
    extract:   row.extract_doctype || '—',
    match:     row.match_status || '—',
    promotion: row.has_promotion ? 'yes' : '—',
    age_s:     row.age_s,
  };
}

function diffAndPrint(intakeId, curr) {
  const prev = state.get(intakeId);
  if (!prev) {
    console.log(`[NEW ] ${curr.intake_id.slice(0,8)}  ${curr.src.padEnd(7)}  state=${curr.state.padEnd(16)}  ex=${curr.extract.padEnd(12)}  match=${curr.match.padEnd(28)}  prom=${curr.promotion}  (age=${curr.age_s}s)`);
  } else {
    const changed = [];
    for (const k of ['state', 'extract', 'match', 'promotion']) {
      if (prev[k] !== curr[k]) changed.push(`${k}: ${prev[k]} → ${curr[k]}`);
    }
    if (changed.length) {
      console.log(`[STEP] ${curr.intake_id.slice(0,8)}  ${changed.join(' | ')}`);
    }
  }
  state.set(intakeId, curr);
}

async function scan() {
  const sinceIso = new Date(Date.now() - SINCE_MIN * 60000).toISOString();
  const list = await ops('GET',
    `staged_intake_items?created_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=intake_id,source_type,status,created_at` +
    `&order=created_at.desc&limit=50`
  );
  if (!list.ok) { console.error('fetch failed'); return; }

  const now = Date.now();
  for (const item of list.data || []) {
    const intakeId = item.intake_id;

    // Latest extraction?
    const ex = await ops('GET',
      `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=document_type&order=created_at.desc&limit=1`
    );
    const extract = (ex.ok && ex.data?.[0]?.document_type) || '—';

    // Latest match?
    const mt = await ops('GET',
      `staged_intake_matches?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=decision,reason,confidence&order=created_at.desc&limit=1`
    );
    let match = '—';
    if (mt.ok && mt.data?.length) {
      const m = mt.data[0];
      match = `${m.decision}/${m.reason || '?'}/${m.confidence ?? '?'}`;
    }

    // Promotion?
    const pr = await ops('GET',
      `staged_intake_promotions?intake_id=eq.${encodeURIComponent(intakeId)}&select=promoted_at&limit=1`
    );
    const has_promotion = pr.ok && pr.data?.length > 0;

    const ageMs = now - new Date(item.created_at).getTime();
    diffAndPrint(intakeId, fmtIntake({
      intake_id: item.intake_id,
      source_type: item.source_type,
      status: item.status,
      extract_doctype: extract,
      match_status: match,
      has_promotion,
      age_s: Math.round(ageMs / 1000),
    }));
  }
}

async function main() {
  console.log(`[watch-intake-pipeline] since=${SINCE_MIN}m  poll=${POLL_MS}ms  (Ctrl+C to stop)\n`);
  await scan();
  setInterval(scan, POLL_MS);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
