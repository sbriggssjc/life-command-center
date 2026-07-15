// api/_handlers/owner-reconcile-engine.js
// ============================================================================
// ORE — multi-signal, authority-weighted owner reconciliation ENGINE worker.
// (Scott's core doctrine, 2026-07-15 — ORE_REALIGNMENT_first_principles §7)
// ----------------------------------------------------------------------------
// The layer UNDERNEATH the two-tier routing: it runs across ALL owners and
// resolves identity from the AGREEMENT of multiple weighted signals — the human
// move. For each owner it calls the SQL resolver `lcc_reconcile_owner` (gather
// evidence → cluster same-party candidates by authority-weighted agreement →
// verdict), then:
//   same_party  → CONSOLIDATE the confident duplicate via lcc_merge_entity
//                 (reversible; merging fans one contact across the cluster).
//   review      → RECORD the evidence + FLAG (surface, never guess).
//   distinct    → RECORD (a conflicting high-authority signal, e.g. two
//                 different SF accounts, holds two shells apart).
// Every decision writes an EVIDENCE TRACE (which signals agreed, at what weight)
// to lcc_owner_reconcile_evidence — grounded + traceable + reversible.
//
//   GET  → dry-run: run the resolver over the value-ranked owner universe (or the
//          Unit-4 queue), tally the verdicts, sample the mergeable + review sets,
//          and surface the true_owner noise. NO writes.
//   POST → drain: refresh the evidence cache (optional), consolidate the confident
//          merges, record the evidence, mark the queue drained. Bounded by `limit`
//          + a wall-clock budget.
//
// Boundaries: LCC-Opps only (no dia/gov writes). The auto-merge subset is the
// SMALL high-confidence class (a name-core VARIANT corroborated to threshold, no
// conflicting SF account) — the "case-dups merge on name-core" rule. Everything
// else is surfaced, never merged. Reversible: undo a merge via the
// merged_into_entity_id tombstone; drop the evidence/queue tables → zero trace.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';

const WALL_CLOCK_MS = 20000;

/**
 * Pure per-candidate action from the resolver verdict. The auto-merge subset is
 * verdict==='same_party' (the resolver already gates that on threshold + a
 * name-core variant + no conflict). 'review' surfaces; 'distinct' records only.
 */
export function classifyReconcilePair(pair) {
  if (!pair || !pair.verdict) return 'skip';
  if (pair.high_authority_conflict) return 'record_distinct';
  if (pair.verdict === 'same_party') return 'merge';
  if (pair.verdict === 'review') return 'flag_review';
  return 'record_distinct';
}

/**
 * Pick the merge winner for a same-party cluster: prefer the SF-linked entity
 * (preserving the authoritative CRM link), else the value-ranked target. Pure.
 * @param targetId the value-ranked owner
 * @param members  [{entity_id, sf_account, rank}] the cluster (target + candidates)
 * @returns winner entity_id
 */
export function pickMergeWinner(targetId, members) {
  const withSf = members.filter((m) => m.sf_account);
  if (withSf.length === 1) return withSf[0].entity_id;
  if (withSf.length > 1) {
    // multiple SF-linked → keep the target if it's one of them, else the highest rank
    const t = withSf.find((m) => m.entity_id === targetId);
    if (t) return targetId;
    return withSf.slice().sort((a, b) => (b.rank || 0) - (a.rank || 0))[0].entity_id;
  }
  return targetId;   // none SF-linked → the value-ranked target is canonical
}

/** Build the ids-only evidence-trace detail for one candidate pair. */
function evidenceRow(targetId, pair, action, workspaceId) {
  return {
    entity_id: targetId,
    candidate_entity_id: pair.candidate_entity_id,
    verdict: pair.verdict,
    weighted_score: pair.weighted_score,
    threshold: pair.threshold,
    agreeing_signals: pair.agreeing_signals,
    high_authority_conflict: !!pair.high_authority_conflict,
    action,
    detail: { candidate_name: pair.candidate_name, workspace_id: workspaceId || null },
    created_at: new Date().toISOString(),
  };
}

async function recordEvidence(rows) {
  if (!rows.length) return { ok: true };
  return opsQuery('POST', 'lcc_owner_reconcile_evidence', rows,
    { headers: { Prefer: 'return=minimal' } });
}

/** Resolve the SF-account + rank for a set of entity ids from the evidence cache. */
async function fetchClusterMeta(ids) {
  if (!ids.length) return new Map();
  const inList = ids.map((id) => pgFilterVal(id)).join(',');
  const r = await opsQuery('GET', 'lcc_owner_evidence_cache?select=entity_id,sf_account&entity_id=in.(' + inList + ')');
  const byId = new Map();
  if (r.ok && Array.isArray(r.data)) for (const x of r.data) byId.set(x.entity_id, x.sf_account || null);
  return byId;
}

/** Consolidate a confident same-party cluster into one winner (reversible). */
async function consolidateCluster(targetId, targetRank, mergePairs) {
  const ids = [targetId, ...mergePairs.map((p) => p.candidate_entity_id)];
  const sfById = await fetchClusterMeta(ids);
  const members = ids.map((id) => ({ entity_id: id, sf_account: sfById.get(id) || null,
    rank: id === targetId ? (targetRank || 0) : 0 }));
  const winner = pickMergeWinner(targetId, members);
  const losers = ids.filter((id) => id !== winner);
  const merged = [];
  for (const loser of losers) {
    const res = await opsQuery('POST', 'rpc/lcc_merge_entity', { p_loser: loser, p_winner: winner });
    if (res.ok) merged.push({ loser, winner });
  }
  return { winner, merged };
}

export async function handleOwnerReconcileEngineTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const minValue = req.query.min_value != null ? Number(req.query.min_value) : 0;
  const source = req.query.source === 'queue' ? 'queue' : 'candidates';
  const doMerge = req.query.merge !== '0' && req.query.merge !== 'false';

  // Optional: refresh the evidence cache before a drain (POST only; the cron does
  // this on its own cadence, so a GET dry-run reads the current cache).
  if (!dryRun && (req.query.refresh_cache === '1' || req.query.refresh_cache === 'true')) {
    await opsQuery('POST', 'rpc/lcc_refresh_owner_evidence_cache', {});
  }

  // Load the target owners (value-ranked candidates, or the Unit-4 queue).
  let targets = [];
  if (source === 'queue') {
    const qr = await opsQuery('GET',
      'lcc_owner_reconcile_queue?select=entity_id,reason&status=eq.queued&order=enqueued_at.asc&limit=' + limit);
    if (!qr.ok) return res.status(qr.status || 500).json({ error: 'queue_load_failed', detail: qr.data });
    // enrich with owner_name + rank from the candidate view (best-effort)
    const ids = (qr.data || []).map((x) => x.entity_id).filter(Boolean);
    let meta = new Map();
    if (ids.length) {
      const inList = ids.map((id) => pgFilterVal(id)).join(',');
      const mr = await opsQuery('GET', 'v_lcc_owner_reconcile_candidates?select=entity_id,owner_name,rank_value,workspace_id&entity_id=in.(' + inList + ')');
      if (mr.ok && Array.isArray(mr.data)) for (const m of mr.data) meta.set(m.entity_id, m);
    }
    targets = (qr.data || []).map((x) => ({ entity_id: x.entity_id,
      owner_name: (meta.get(x.entity_id) || {}).owner_name || null,
      rank_value: (meta.get(x.entity_id) || {}).rank_value || null,
      workspace_id: (meta.get(x.entity_id) || {}).workspace_id || null }));
  } else {
    let sel = 'v_lcc_owner_reconcile_candidates?select=entity_id,owner_name,rank_value,workspace_id';
    if (minValue > 0) sel += '&rank_value=gte.' + minValue;
    sel += '&order=rank_value.desc.nullslast&limit=' + limit;
    const r = await opsQuery('GET', sel);
    if (!r.ok) return res.status(r.status || 500).json({ error: 'load_failed', detail: r.data });
    targets = Array.isArray(r.data) ? r.data : [];
  }

  const byVerdict = { same_party: 0, review: 0, distinct: 0 };
  const byAction = { merge: 0, flag_review: 0, record_distinct: 0, skip: 0 };
  const sampleMerge = [];
  const sampleReview = [];
  const started = Date.now();
  const summary = { source, targets: targets.length, owners_processed: 0,
    merged_entities: 0, review_pairs: 0, distinct_pairs: 0, evidence_written: 0, failed: 0 };

  for (const tgt of targets) {
    if (!dryRun && Date.now() - started > WALL_CLOCK_MS) break;
    let rr;
    try { rr = await opsQuery('POST', 'rpc/lcc_reconcile_owner', { p_entity_id: tgt.entity_id }); }
    catch (_e) { summary.failed += 1; continue; }
    if (!rr.ok) { summary.failed += 1; continue; }
    const pairs = Array.isArray(rr.data) ? rr.data : [];
    if (!pairs.length) { summary.owners_processed += 1; continue; }

    const mergePairs = [];
    const evidence = [];
    for (const p of pairs) {
      const v = (p.verdict === 'same_party') ? 'same_party' : (p.verdict === 'review' ? 'review' : 'distinct');
      byVerdict[v] = (byVerdict[v] || 0) + 1;
      const action = classifyReconcilePair(p);
      byAction[action] = (byAction[action] || 0) + 1;
      if (action === 'merge') {
        mergePairs.push(p);
        if (sampleMerge.length < 20) sampleMerge.push({ owner: tgt.owner_name, dup: p.candidate_name,
          score: p.weighted_score, signals: (p.agreeing_signals || []).map((s) => s.signal) });
      } else if (action === 'flag_review') {
        summary.review_pairs += 1;
        if (sampleReview.length < 20) sampleReview.push({ owner: tgt.owner_name, candidate: p.candidate_name,
          score: p.weighted_score, signals: (p.agreeing_signals || []).map((s) => s.signal) });
        evidence.push(evidenceRow(tgt.entity_id, p, 'flagged_review', tgt.workspace_id));
      } else if (action === 'record_distinct') {
        summary.distinct_pairs += 1;
        evidence.push(evidenceRow(tgt.entity_id, p, 'none', tgt.workspace_id));
      }
    }

    if (!dryRun) {
      // Consolidate the confident merges (reversible), then record the trace.
      if (doMerge && mergePairs.length) {
        const c = await consolidateCluster(tgt.entity_id, tgt.rank_value, mergePairs);
        summary.merged_entities += c.merged.length;
        for (const p of mergePairs) {
          const ev = evidenceRow(tgt.entity_id, p, 'merged', tgt.workspace_id);
          ev.detail.winner = c.winner;
          evidence.push(ev);
        }
      } else if (mergePairs.length) {
        // merge disabled → record the merge candidates as flagged instead of merging
        for (const p of mergePairs) evidence.push(evidenceRow(tgt.entity_id, p, 'flagged_review', tgt.workspace_id));
      }
      const w = await recordEvidence(evidence);
      if (w.ok) summary.evidence_written += evidence.length; else summary.failed += 1;
      // mark the queue row drained
      if (source === 'queue') {
        await opsQuery('PATCH', 'lcc_owner_reconcile_queue?entity_id=eq.' + pgFilterVal(tgt.entity_id),
          { status: 'done', processed_at: new Date().toISOString(), attempts: 1 });
      }
    }
    summary.owners_processed += 1;
  }

  if (dryRun) {
    // surface the true_owner noise distribution (Unit 3) alongside the verdicts
    let noise = null;
    try {
      const nr = await opsQuery('GET', 'v_lcc_true_owner_noise?select=noise_kind');
      if (nr.ok && Array.isArray(nr.data)) {
        noise = {};
        for (const x of nr.data) noise[x.noise_kind] = (noise[x.noise_kind] || 0) + 1;
      }
    } catch (_e) { /* soft */ }
    return res.status(200).json({ ok: true, dry_run: true, source, targets: targets.length,
      by_verdict: byVerdict, by_action: byAction, sample_merge: sampleMerge,
      sample_review: sampleReview, true_owner_noise: noise, min_value: minValue });
  }

  if (!doMerge) summary.note = 'merge disabled (?merge=0) — same-party pairs recorded as flagged_review';
  return res.status(200).json({ ok: true, ...summary, by_verdict: byVerdict, by_action: byAction,
    sample_merge: sampleMerge });
}
