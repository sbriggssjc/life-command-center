#!/usr/bin/env node
// ============================================================================
// scripts/audit-stuck-intakes.mjs
//
// Diagnostic for Task #72: intakes stuck at review_required, never promoted.
// Reports each stuck intake's drop-out point in the pipeline:
//   - no_extraction       — extractor never ran (staged_intake_extractions missing)
//   - no_match_row        — extracted, but matcher never wrote a result row
//   - matcher_needs_review — matcher ran, decision=needs_review
//   - matched_not_promoted — matcher auto_matched, promoter never ran
//
// Usage:
//   node scripts/audit-stuck-intakes.mjs              # last 14 days
//   node scripts/audit-stuck-intakes.mjs --days 7
//   node scripts/audit-stuck-intakes.mjs --limit 20
//   node scripts/audit-stuck-intakes.mjs --all-statuses   # not just review_required
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env  = loadEnvForScripts();
const argv = process.argv.slice(2);
const DAYS = (() => {
  const i = argv.indexOf('--days');
  if (i === -1) return 14;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
})();
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  if (i === -1) return 50;
  const n = parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
})();
const ALL_STATUSES = argv.includes('--all-statuses');

const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS_SUPABASE_URL / OPS_SUPABASE_KEY'); process.exit(1); }

async function rest(method, path, body) {
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

function truncate(s, n) {
  if (s == null) return null;
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

async function main() {
  const sinceIso = new Date(Date.now() - DAYS * 86400000).toISOString();
  console.log(`[audit-stuck-intakes] since=${sinceIso} limit=${LIMIT} all_statuses=${ALL_STATUSES}`);

  // Schema-correct columns: intake_id, workspace_id, source_type, status, raw_payload, created_at
  const statusFilter = ALL_STATUSES
    ? ''
    : `&status=in.(queued,processing,review_required,failed)`;

  const listPath =
    `staged_intake_items` +
    `?created_at=gte.${encodeURIComponent(sinceIso)}` +
    statusFilter +
    `&select=intake_id,workspace_id,status,source_type,internet_message_id,created_at,raw_payload` +
    `&order=created_at.desc&limit=${LIMIT}`;

  const list = await rest('GET', listPath);
  if (!list.ok) { console.error('fetch failed', list.status, list.data); process.exit(1); }

  const rows = list.data || [];
  console.log(`found ${rows.length} intake rows\n`);

  const stats = {
    total:               rows.length,
    no_extraction:       0,
    no_match_row:        0,
    needs_review:        0,
    matched_not_promoted:0,
    promoted:            0,
  };

  const statusCounts = {};

  for (const r of rows) {
    const intakeId = r.intake_id;
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

    // Latest extraction? snapshot is JSONB
    const ex = await rest('GET',
      `staged_intake_extractions?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=id,document_type,extraction_snapshot,created_at` +
      `&order=created_at.desc&limit=1`
    );
    const hasExtraction = ex.ok && ex.data?.length > 0;
    const extraction = hasExtraction ? ex.data[0] : null;
    const snap = extraction?.extraction_snapshot || {};

    // First artifact for file_name
    const art = await rest('GET',
      `staged_intake_artifacts?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=file_name,mime_type&limit=1`
    );
    const artifact = (art.ok && art.data?.length > 0) ? art.data[0] : null;

    // Latest match?
    const mt = await rest('GET',
      `staged_intake_matches?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=decision,reason,domain,property_id,confidence,created_at` +
      `&order=created_at.desc&limit=1`
    );
    const hasMatch = mt.ok && mt.data?.length > 0;
    const match = hasMatch ? mt.data[0] : null;

    // Promotion?
    const pr = await rest('GET',
      `staged_intake_promotions?intake_id=eq.${encodeURIComponent(intakeId)}` +
      `&select=promoted_at,entity_id&limit=1`
    );
    const hasPromotion = pr.ok && pr.data?.length > 0;

    // Drop-out classification
    let dropOut;
    if (!hasExtraction) { dropOut = 'no_extraction';        stats.no_extraction++; }
    else if (!hasMatch) { dropOut = 'no_match_row';         stats.no_match_row++; }
    else if (match.decision === 'needs_review')    { dropOut = 'matcher_needs_review';    stats.needs_review++; }
    else if (match.decision === 'auto_matched' && !hasPromotion) { dropOut = 'matched_not_promoted'; stats.matched_not_promoted++; }
    else { dropOut = 'promoted'; stats.promoted++; }

    const tag    = intakeId.slice(0, 8);
    const date   = r.created_at?.slice(0, 10);
    const addr   = snap.address ? `${snap.address} ${snap.state || ''}` : '—';
    const tenant = snap.tenant_name || '—';
    const docType = extraction?.document_type || snap.document_type || '—';
    const mdec   = match
      ? `${match.decision}/${match.reason || '?'}/${match.confidence ?? '?'}${match.domain ? ' ' + match.domain : ''}`
      : 'NONE';

    console.log(
      `${tag}  ${date}  [${dropOut.padEnd(22)}]  ` +
      `status=${(r.status || '').padEnd(16)}  ` +
      `ex=${hasExtraction ? docType : '✗'}  match=${mdec}`
    );
    console.log(`           file=${truncate(artifact?.file_name, 60) || '—'}   src=${r.source_type}`);
    if (extraction) {
      console.log(`           addr=${truncate(addr, 60)}   tenant=${truncate(tenant, 40)}`);
    }
    console.log('');
  }

  console.log('\n[audit-stuck-intakes] status counts', statusCounts);
  console.log('[audit-stuck-intakes] drop-out stats', stats);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
