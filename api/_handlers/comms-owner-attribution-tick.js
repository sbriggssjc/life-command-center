// api/_handlers/comms-owner-attribution-tick.js
// ============================================================================
// W9.6 (Prompt 102) — the correspondence → owner-LLC attribution tick.
// See supabase/migrations/20260829120000_lcc_w9_6_comms_owner_attribution.sql
// and docs/audits/W9_6_comms_owner_attribution_dryrun_2026-08-13.md.
//
// Route: GET|POST /api/comms-owner-attribution-tick (X-LCC-Key / session auth via
//   requireLccAuth, mounted in server.js). Scheduled by pg_cron
//   `comms-owner-attribution-tick` (05:05 UTC, after the W9.2 chain) → lcc_cron_post.
//
//   GET  /api/comms-owner-attribution-tick            -> dry-run pool counts
//   GET  /api/comms-owner-attribution-tick?score=1&n= -> dry-run + inline proposals
//                                                        (both paths; NO writes)
//   POST /api/comms-owner-attribution-tick            -> apply: build + write
//                                                        proposals (flag-gated; no-op OFF)
//
// The two attribution PATHS come from the SECURITY-INVOKER SQL joins
// (lcc_w9_6_path_a_candidates / lcc_w9_6_path_b_candidates); this handler is the
// value-gate + known-exclusion + proposal-shaping + write layer. Deterministic-
// first (Path A arithmetic owns-edge; Path B verbatim person-match with the
// shared-token false-bridge guard). Proposal-only — a human verdict applies the
// deterministic writer (admin.js). NEVER auto-writes; NEVER fabricates.
// Never throws — always returns 200 with a JSON envelope.
// ============================================================================
import { opsQuery } from '../_shared/ops-db.js';
import * as COA from '../_shared/comms-owner-attribution.js';

const truthy = (v) => v === '1' || v === 'true' || v === true;

function maxTargetsFromEnv() {
  const n = parseInt(process.env.COA_MAX_TARGETS || '200', 10);
  return Math.min(500, Math.max(1, Number.isFinite(n) ? n : 200));
}

function attributionEnabled(flagRow) {
  const env = String(process.env.W9_6_COMMS_OWNER_ATTRIBUTION || '').toLowerCase();
  if (['on', '1', 'true', 'yes', 'enabled'].includes(env)) return true;
  return String(flagRow?.state || '').toLowerCase() === 'on';
}

async function fetchFlag() {
  try {
    const r = await opsQuery('GET', 'feature_flags_registry?flag=eq.W9_6_COMMS_OWNER_ATTRIBUTION&select=flag,state&limit=1', undefined, { countMode: 'none' });
    return r.ok && Array.isArray(r.data) ? r.data[0] : null;
  } catch (_e) { return null; }
}

function errDetail(data) {
  if (data == null) return null;
  if (typeof data === 'string') return data.slice(0, 200);
  try { return JSON.stringify(data).slice(0, 200); } catch (_e) { return String(data).slice(0, 200); }
}

// Exclusion set: subject_refs already in comms_owner_attribution_review (any
// status) — a decided/proposed card is never re-proposed. Paged at 1000.
async function fetchKnownSubjects() {
  const set = new Set();
  const PAGE = 1000;
  try {
    for (let off = 0; ; off += PAGE) {
      const r = await opsQuery('GET', 'comms_owner_attribution_review?select=subject_ref&order=review_id.asc&limit=' + PAGE + '&offset=' + off);
      if (!r.ok) break;
      const rows = Array.isArray(r.data) ? r.data : [];
      for (const x of rows) if (x.subject_ref) set.add(String(x.subject_ref));
      if (rows.length < PAGE) break;
    }
  } catch (_e) { /* best-effort */ }
  return set;
}

// Pull both path candidate sets from the SQL joins. Loud errors, never throws.
async function fetchCandidates(cap) {
  const errors = [];
  let a = [];
  let b = [];
  try {
    const r = await opsQuery('POST', 'rpc/lcc_w9_6_path_a_candidates', { p_limit: cap });
    if (r.ok && Array.isArray(r.data)) a = r.data;
    else if (!r.ok) errors.push({ source: 'path_a', status: r.status || null, detail: errDetail(r.data) });
  } catch (e) { errors.push({ source: 'path_a', detail: e?.message || String(e) }); }
  try {
    const r = await opsQuery('POST', 'rpc/lcc_w9_6_path_b_candidates', { p_limit: cap });
    if (r.ok && Array.isArray(r.data)) b = r.data;
    else if (!r.ok) errors.push({ source: 'path_b', status: r.status || null, detail: errDetail(r.data) });
  } catch (e) { errors.push({ source: 'path_b', detail: e?.message || String(e) }); }
  return { a, b, errors };
}

// Build proposals from the raw candidates: value-gate → shape (planner) → exclude
// known. Returns { proposals, counts } where counts are honest per-path.
function buildProposals({ a, b }, known, meta) {
  const counts = {
    path_a: { candidates: a.length, proposed: 0, already_known: 0, dropped: 0 },
    path_b: { candidates: b.length, proposed: 0, already_known: 0, dropped: 0, false_bridge_rejected: 0 },
  };
  const proposals = [];
  for (const c of COA.valueGateCandidates(a)) {
    const p = COA.buildPathAProposal(c, meta);
    if (!p) { counts.path_a.dropped += 1; continue; }
    if (known.has(p.subject_ref)) { counts.path_a.already_known += 1; continue; }
    counts.path_a.proposed += 1;
    proposals.push(p);
  }
  for (const c of COA.valueGateCandidates(b)) {
    const p = COA.buildPathBProposal(c, meta);
    if (!p) {
      // a null from Path B is either a missing field or a false-bridge rejection;
      // distinguish the false-bridge case (the guard's honest count).
      if (c && c.tie_kind === 'relationship' && !COA.looksLikeEmail(c.correspondent_email)
          && COA.sharedTokenOnly(c.correspondent_name, c.owner_name)) counts.path_b.false_bridge_rejected += 1;
      else counts.path_b.dropped += 1;
      continue;
    }
    if (known.has(p.subject_ref)) { counts.path_b.already_known += 1; continue; }
    counts.path_b.proposed += 1;
    proposals.push(p);
  }
  return { proposals, counts };
}

function proposalToRow(p) {
  return {
    subject_ref: p.subject_ref, path: p.path, domain: p.domain,
    corr_entity_id: p.corr_entity_id, owner_entity_id: p.owner_entity_id,
    target_owner_id: p.target_owner_id, owner_name: p.owner_name || null,
    corr_entity_name: p.corr_entity_name || null, tie_kind: p.tie_kind || null,
    correspondent_name: p.correspondent_name || null, correspondent_email: p.correspondent_email || null,
    thread_count: p.thread_count != null ? Number(p.thread_count) : null,
    sample_activity_id: p.sample_activity_id || null,
    evidence_quote: p.evidence_quote || null, evidence_source: p.evidence_source || null,
    confidence: Number(p.confidence) || 0, reason: p.reason || null,
    rank_value: p.rank_value != null ? Number(p.rank_value) : null,
    seeder: 'w9_6_comms_owner_attribution', provenance_source: COA.COA_PROVENANCE_SOURCE,
    source_run_id: p.source_run_id, scan_batch_id: p.scan_batch_id || null,
    status: 'proposed',
  };
}

async function recordHealth({ status, count, lastError, details }) {
  try {
    await opsQuery('POST', 'rpc/lcc_record_health_event', {
      p_source: 'comms_owner_attribution', p_check_name: 'correspondence_owner_attribution',
      p_status: status, p_count: count || 0, p_last_error: lastError || null,
      p_external_url: null, p_details: details || {},
    });
  } catch (_e) { /* health is best-effort */ }
}

export async function handleCommsOwnerAttributionTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET/POST only' });
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const flag = await fetchFlag();
  const enabled = attributionEnabled(flag);
  const cap = Math.min(500, Math.max(1, parseInt(q.limit || q.n || String(maxTargetsFromEnv()), 10) || maxTargetsFromEnv()));
  const sourceRunId = 'coa:' + new Date().toISOString();

  try {
    // ---- GET dry-run --------------------------------------------------------
    if (req.method === 'GET') {
      const { a, b, errors } = await fetchCandidates(cap);
      const known = await fetchKnownSubjects();
      const { proposals, counts } = buildProposals({ a, b }, known, { sourceRunId: 'dry' });
      const out = {
        ok: errors.length === 0, dry_run: true, flag_state: flag?.state || 'off', enabled,
        counts, scan_errors: errors.slice(0, 20),
        note: 'Dry-run — NO rows written. PATH A (property_bridge) is arithmetic (owns-edge join, confidence 1.0, bulk-confirmable); PATH B (person_match) carries the correspondent VERBATIM header and rejects a shared-token-only bridge. Confirm attributes the thread to the owner (appends owner ops entity to metadata.linked_entity_ids). Review, then POST (with the flag ON).',
      };
      if (truthy(q.score)) {
        const n = Math.min(60, Math.max(1, parseInt(q.n || '10', 10) || 10));
        out.sample = proposals.slice(0, n).map((p) => ({
          subject_ref: p.subject_ref, path: p.path, domain: p.domain, tie_kind: p.tie_kind,
          owner_name: p.owner_name, corr_entity_name: p.corr_entity_name,
          correspondent_name: p.correspondent_name, correspondent_email: p.correspondent_email,
          thread_count: p.thread_count, confidence: p.confidence, rank_value: p.rank_value,
          evidence_quote: p.evidence_quote, reason: p.reason,
        }));
        out.would_propose = proposals.length;
      }
      return res.status(200).json(out);
    }

    // ---- POST apply: flag-gated. No-op (honest health) while OFF. ------------
    if (!enabled) {
      await recordHealth({ status: 'amber', count: 0, lastError: 'W9_6_COMMS_OWNER_ATTRIBUTION feature flag is off', details: { flag_state: flag?.state || 'off' } });
      return res.status(200).json({
        ok: true, skipped: 'flag_off', flag_state: flag?.state || 'off',
        hint: 'Set W9_6_COMMS_OWNER_ATTRIBUTION on (feature_flags_registry) to enable; the GET dry-run (?score=1&n=) reports proposals without writing.',
      });
    }

    // Batch ledger first (the run record exists before any write).
    let scanBatchId = null;
    try {
      const led = await opsQuery('POST', 'comms_owner_attribution_batch',
        { source_run_id: sourceRunId, status: 'open', details: { cap } },
        { headers: { Prefer: 'return=representation' } });
      const rec = Array.isArray(led.data) ? led.data[0] : led.data;
      scanBatchId = rec?.batch_id || null;
    } catch (_e) { /* ledger best-effort; writes still keyed by source_run_id */ }

    const { a, b, errors } = await fetchCandidates(cap);
    const known = await fetchKnownSubjects();
    const { proposals, counts } = buildProposals({ a, b }, known, { sourceRunId, scanBatchId });

    let written = 0;
    const writeErrors = [];
    // Chunked idempotent upsert (merge-duplicates on subject_ref).
    const chunk = (arr, size) => { const o = []; for (let i = 0; i < arr.length; i += size) o.push(arr.slice(i, i + size)); return o; };
    for (const group of chunk(proposals.map(proposalToRow), 100)) {
      try {
        const r = await opsQuery('POST', 'comms_owner_attribution_review?on_conflict=subject_ref', group,
          { headers: { Prefer: 'return=minimal,resolution=merge-duplicates' } });
        if (r.ok) written += group.length;
        else writeErrors.push({ status: r.status || null, detail: errDetail(r.data) });
      } catch (e) { writeErrors.push({ detail: e?.message || String(e) }); }
    }

    const allErrors = errors.concat(writeErrors);
    const ok = allErrors.length === 0;
    // Close the batch ledger with the honest counts.
    if (scanBatchId != null) {
      await opsQuery('PATCH', 'comms_owner_attribution_batch?batch_id=eq.' + scanBatchId,
        { status: 'closed', details: { cap, counts, written, scan_errors: allErrors.slice(0, 20) } }).catch(() => null);
    }
    await recordHealth({
      status: ok ? 'green' : 'amber', count: written,
      lastError: allErrors.length ? errDetail(allErrors[0]) : null,
      details: { counts, written, flag_state: flag?.state || 'off' },
    });

    console.log(`[comms-owner-attribution-tick] ok=${ok} pathA=${counts.path_a.proposed}/${counts.path_a.candidates} ` +
      `pathB=${counts.path_b.proposed}/${counts.path_b.candidates}(fb_reject=${counts.path_b.false_bridge_rejected}) ` +
      `written=${written} errors=${allErrors.length}`);

    return res.status(200).json({ ok, source_run_id: sourceRunId, scan_batch_id: scanBatchId, written, counts, scan_errors: allErrors.slice(0, 20) });
  } catch (e) {
    await recordHealth({ status: 'red', count: 0, lastError: String(e?.message || e).slice(0, 200), details: {} });
    console.error('[comms-owner-attribution-tick] threw:', e?.message || e);
    return res.status(200).json({ ok: false, reason: 'attribution_tick_error', detail: String(e?.message || e).slice(0, 300) });
  }
}
