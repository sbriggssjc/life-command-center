// ============================================================================
// Intake extract drain — bounded async extraction worker
// Life Command Center · Phase 2, Slice 2d (Unit 3)
//
//   GET  /api/intake-extract-drain   — dry-run: count queued intakes, NO work
//   POST /api/intake-extract-drain   — drain: extract a bounded batch of queued
//                                      intakes (oldest first), time-budgeted
//
// Decouples extraction from staging (Unit 3). The folder-feed crawl (and any
// channel that passes defer_extraction) stages OMs FAST, leaving the row at
// staged_intake_items.status='queued'. This worker drains those rows in small,
// time-budgeted batches so it never floods LCC Opps (the disk / connection
// lessons). It also drains the On Market deferred backlog and any intake the
// inline race timed out on.
//
// processIntakeExtraction is idempotent (it short-circuits on an existing
// extraction and re-running is safe), and the grace window avoids racing an
// in-flight inline extraction, so this coexists with the existing
// lcc-retry-stranded-extractions cron — both only ever advance a stuck row.
//
// House rules: no new api/*.js — sub-route of intake.js (?_route=intake-extract-
// drain) + the handler lives here.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { processIntakeExtraction } from './intake-extractor.js';

export async function handleIntakeExtractDrain(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) or POST (drain) only' });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';

  // Bounded per tick — small batch + grace window so we never grind LCC Opps and
  // never double-run an in-flight inline extraction (default 2-min grace).
  const limit      = Math.min(20, Math.max(1, parseInt(req.query.limit || '6', 10)));
  const graceMin   = Math.max(0, parseInt(req.query.grace_minutes ?? '2', 10) || 0);
  const cutoffIso  = new Date(Date.now() - graceMin * 60_000).toISOString();
  // Leave headroom under the function cap; never START a new extraction past it.
  const TIME_BUDGET_MS = Math.max(0, parseInt(process.env.INTAKE_DRAIN_TIME_BUDGET_MS, 10) || 22000);
  const startedAt = Date.now();

  // Queued + aged past the grace window, oldest first. Once extraction lands,
  // the extractor flips status away from 'queued', so this filter alone never
  // re-picks an already-extracted row; processIntakeExtraction is also
  // idempotent (short-circuits on an existing extraction), so a rare overlap
  // with the retry cron only ever advances a stuck row.
  const listRes = await opsQuery('GET',
    `staged_intake_items?status=eq.queued` +
    `&created_at=lt.${pgFilterVal(cutoffIso)}` +
    `&select=intake_id,created_at,workspace_id&order=created_at.asc&limit=${limit}`
  );

  if (!listRes.ok) {
    return res.status(listRes.status || 500).json({ error: 'queue_lookup_failed', detail: listRes.data });
  }
  const queued = Array.isArray(listRes.data) ? listRes.data : [];

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'drain',
    grace_minutes: graceMin,
    limit,
    queued_in_batch: queued.length,
    extracted: 0,
    review_required: 0,
    matched: 0,
    failed: 0,
    errored: 0,
    items: [],
  };

  if (dryRun) {
    report.items = queued.map(q => ({ intake_id: q.intake_id, created_at: q.created_at }));
    return res.status(200).json(report);
  }

  for (const q of queued) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    let result = null;
    try {
      result = await processIntakeExtraction(q.intake_id, {
        workspaceId: q.workspace_id || null,
      });
    } catch (err) {
      report.errored++;
      report.items.push({ intake_id: q.intake_id, status: 'error', error: err?.message || 'extract_error' });
      continue;
    }
    report.extracted++;
    const snap = result?.extraction_snapshot;
    // processIntakeExtraction returns the snapshot; the matcher/promoter ran
    // inside it and flipped staged_intake_items.status. We don't re-read it here
    // (extra round-trips); the snapshot presence is the success signal.
    if (snap) {
      // matched vs review_required is decided downstream; surface both buckets
      // off the result envelope when present.
      if (result?.match_result?.status === 'matched') report.matched++;
      else report.review_required++;
    } else {
      report.failed++;
    }
    report.items.push({
      intake_id: q.intake_id,
      status: snap ? (result?.match_result?.status || 'review_required') : 'failed',
    });
  }

  return res.status(200).json(report);
}
