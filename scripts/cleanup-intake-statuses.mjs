#!/usr/bin/env node
// ============================================================================
// scripts/cleanup-intake-statuses.mjs
//
// One-off cleanup after fixing the intake pipeline bugs on 2026-04-24.
// Two passes:
//
//   PASS A — flip to 'finalized': staged_intake_items.status='review_required'
//            that have a corresponding staged_intake_promotions row. These
//            are intakes where the pipeline fully succeeded but the status
//            flip was missing (fixed in today's promoter patch for future
//            runs; this cleans up historicals).
//
//   PASS B — flip to 'discarded': intakes with no real document content —
//            signature images (outlook-logo*, image001.png, UUID.png),
//            extractor-classified 'unknown' with no address/tenant, and
//            test PDFs (test.pdf, e2e-test.pdf). These correctly never
//            promoted; moving them out of 'review_required' cleans the queue.
//
// Usage:
//   node scripts/cleanup-intake-statuses.mjs               # dry run, 14 days
//   node scripts/cleanup-intake-statuses.mjs --apply
//   node scripts/cleanup-intake-statuses.mjs --apply --days 30
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DAYS = (() => {
  const i = argv.indexOf('--days');
  if (i === -1) return 14;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
})();

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS creds'); process.exit(1); }

async function ops(method, path, body) {
  const res = await fetch(`${OPS_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: OPS_KEY,
      Authorization: `Bearer ${OPS_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const SIGNATURE_PATTERNS = [
  /^image\d+\.(png|jpg|jpeg|gif)$/i,
  /^outlook-logo/i,
  /^signature/i,
  /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\.(png|jpg|jpeg)$/i,
];
const TEST_PATTERNS = [
  /^test\.pdf$/i,
  /^e2e-test\.pdf$/i,
  /^document\.pdf$/i,
];

function isSignature(fileName) {
  return SIGNATURE_PATTERNS.some(re => re.test(String(fileName || '').trim()));
}
function isTestFile(fileName) {
  return TEST_PATTERNS.some(re => re.test(String(fileName || '').trim()));
}

async function main() {
  const sinceIso = new Date(Date.now() - DAYS * 86400000).toISOString();
  console.log(`[cleanup-intake-statuses] apply=${APPLY}  since=${sinceIso}\n`);

  const list = await ops('GET',
    `staged_intake_items?created_at=gte.${encodeURIComponent(sinceIso)}` +
    `&status=eq.review_required` +
    `&select=intake_id,status,source_type,created_at,raw_payload` +
    `&order=created_at.desc&limit=500`
  );
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  const rows = list.data || [];
  const toFinalize = [];
  const toDiscard  = [];
  const keep       = [];

  for (const r of rows) {
    // Has promotion row?
    const pr = await ops('GET',
      `staged_intake_promotions?intake_id=eq.${encodeURIComponent(r.intake_id)}&select=intake_id&limit=1`
    );
    if (pr.ok && pr.data?.length) { toFinalize.push(r); continue; }

    // Has real content?
    const ex = await ops('GET',
      `staged_intake_extractions?intake_id=eq.${encodeURIComponent(r.intake_id)}` +
      `&select=document_type,extraction_snapshot&order=created_at.desc&limit=1`
    );
    const art = await ops('GET',
      `staged_intake_artifacts?intake_id=eq.${encodeURIComponent(r.intake_id)}&select=file_name,mime_type&limit=1`
    );
    const fileName = art.ok && art.data?.length ? art.data[0].file_name : null;
    const mime     = art.ok && art.data?.length ? art.data[0].mime_type : null;

    // Discard criteria
    if (isSignature(fileName))                             { toDiscard.push({ r, reason: 'signature_image' }); continue; }
    if (isTestFile(fileName))                              { toDiscard.push({ r, reason: 'test_file' }); continue; }
    if (String(mime || '').toLowerCase().startsWith('image/')) {
      toDiscard.push({ r, reason: 'image_mime' }); continue;
    }

    const snap = ex.ok && ex.data?.length ? (ex.data[0].extraction_snapshot || {}) : {};
    const docType = ex.ok && ex.data?.length ? (ex.data[0].document_type || snap.document_type) : null;

    // Unknown doctype + no address/tenant = junk
    if ((!docType || docType === 'unknown') && !snap.address && !snap.tenant_name) {
      toDiscard.push({ r, reason: 'unknown_no_content', file: fileName });
      continue;
    }

    keep.push(r);
  }

  console.log(`PASS A — flip to 'finalized' (has promotion row): ${toFinalize.length}`);
  for (const r of toFinalize) {
    console.log(`  ${r.intake_id.slice(0, 8)}…  created=${r.created_at?.slice(0, 10)}`);
  }

  console.log(`\nPASS B — flip to 'discarded' (noise): ${toDiscard.length}`);
  for (const { r, reason, file } of toDiscard) {
    console.log(`  ${r.intake_id.slice(0, 8)}…  [${reason}]  ${file || ''}`);
  }

  console.log(`\nKept as review_required (has content, no promotion): ${keep.length}`);
  for (const r of keep) {
    console.log(`  ${r.intake_id.slice(0, 8)}…  created=${r.created_at?.slice(0, 10)}`);
  }

  if (!APPLY) {
    console.log('\n[cleanup-intake-statuses] Dry run — re-run with --apply to PATCH');
    return;
  }

  console.log('\nApplying...');
  let okCount = 0, errCount = 0;

  for (const r of toFinalize) {
    const res = await ops('PATCH',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(r.intake_id)}`,
      { status: 'finalized', updated_at: new Date().toISOString() },
      { 'Prefer': 'return=minimal' }
    );
    if (res.ok) okCount++;
    else { errCount++; console.warn(`  err on ${r.intake_id.slice(0, 8)}: ${res.status}`); }
  }
  for (const { r } of toDiscard) {
    const res = await ops('PATCH',
      `staged_intake_items?intake_id=eq.${encodeURIComponent(r.intake_id)}`,
      { status: 'discarded', updated_at: new Date().toISOString() },
      { 'Prefer': 'return=minimal' }
    );
    if (res.ok) okCount++;
    else { errCount++; console.warn(`  err on ${r.intake_id.slice(0, 8)}: ${res.status}`); }
  }

  console.log(`\n[cleanup-intake-statuses] done  ok=${okCount}  err=${errCount}`);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
