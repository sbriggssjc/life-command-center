// api/_handlers/ambiguous-entity-automerge-tick.js
// ============================================================================
// PDR1 / P13 fork 1 — auto-merge the clear Salesforce-sync duplicate placeholders
// (`entities.metadata.ambiguous_resolution`), and drain the rest into the
// `ambiguous_entity_resolution` Decision Center lane (dc-lanes.js / admin.js).
//
//   GET  → DRY RUN. No writes, NOT flag-gated. Scores every open ambiguous
//          entity with `ambiguous-entity-merge-planner.js` and reports the
//          auto-mergeable / needs_human split, per the `?generate=1`-style
//          grade precedent (P140, tier0-auto-attach-tick) — the population
//          must be gradeable BEFORE the flag decides whether it writes.
//   POST → writes, flag-gated AMBIGUOUS_ENTITY_AUTOMERGE, bounded, resumable.
//
// ⚠️ NO SECOND MERGE WRITER. This tick calls the SAME `rpc/reconcile_entity`
// Postgres function that `mcp/entity-reconcile.js`'s `/api/pipeline/
// reconcile-entity` HTTP route calls (supabase/migrations/20260728170000_
// entity_reconcile_functions.sql). It does NOT call that HTTP route directly:
// `mcp/entity-reconcile.js` runs on the SEPARATE MCP server process
// (mcp/server.js), not the Railway app this file is mounted into (server.js at
// repo root, per CLAUDE.md's "server.js is the single source of truth for
// /api/* routing" rule) — a cross-service HTTP call from inside the Railway
// app to the MCP server would be a fragile, unnecessary hop for what is
// really one DB call. Calling `rpc/reconcile_entity` directly via `opsQuery`
// is the SAME database function with the SAME atomicity guarantee; there is
// still exactly one merge writer in the system.
//
// ⚠️ DB ACCESS WAS UNAVAILABLE WHEN THIS WAS BUILT (sandboxed session, no
// egress to Supabase). Everything here is built against the DOCUMENTED shape
// of the population (PLANNED-BACKLOG.md §P17 / §P13#1 — 189 entities,
// candidate lists of 2-55, minted 2026-07-28..08-04, closed population) and
// tested with fixtures, never against live rows. The GET dry-run's
// auto-mergeable/needs_human split is therefore UNKNOWN until this is run for
// real — see docs/claude-code/STATUS.md.
//
// ⚠️ POPULATION IS CLOSED. Per Scott's own instruction (task item 5) this tick
// does NOT get a recurring cron — nothing has minted a new `ambiguous_
// resolution` entity since 2026-08-04. If the Salesforce sync starts
// producing more, that is a new, separate measurement before any schedule is
// justified (mirrors P176/Class 8's "a one-shot repair of a recurring
// producer is a chore you repeat silently forever" — the inverse case: this
// producer is NOT recurring, so a one-shot drain is the right shape, but
// route it manually until proven otherwise).
//
// ⚠️ RECONCILE_ENTITY'S REVERSIBILITY IS A SOFT TOMBSTONE, NOT A SNAPSHOT.
// The RPC clears `ambiguous_resolution` and stamps `metadata.merged_into` on
// the placeholder — it is NOT a point-in-time backup/restore pair like
// `lcc_merge_entity`/`lcc_unmerge_entity` elsewhere in this repo (P196). A
// human wanting to reverse a merge would need to manually re-point
// `bd_opportunities`/`activity_events`/`entity_relationships` rows back to
// the placeholder and clear `merged_into` — there is no `unreconcile_entity`
// RPC. This tick does NOT claim otherwise; confirming reconcile_entity's real
// reversibility live (a rollback-tested positive control) is named as a
// follow-up in STATUS.md, not assumed here.
// ============================================================================

import { randomUUID } from 'crypto';
import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import { planAmbiguousEntityMerge } from '../_shared/ambiguous-entity-merge-planner.js';

const FLAG = 'AMBIGUOUS_ENTITY_AUTOMERGE';
const RUN_LOG = 'lcc_ambiguous_entity_automerge_run_log';
const DEFAULT_BATCH = 50;
// Inside lcc_cron_post's 60 s pg_net window (this tick is not cron-scheduled
// today per the "closed population, no recurring cron" rule above, but the
// same budget discipline applies to any manual/ops-triggered invocation).
const BUDGET_MS = 45_000;

// ---------------------------------------------------------------------------
// Population source. `list_flagged_open_deals` (mcp/entity-reconcile.js) only
// returns placeholders with an OPEN `bd_opportunities` row for a Team-Briggs
// owner — narrower than the documented 189-entity population (PLANNED-
// BACKLOG.md counts ALL `entities` rows carrying `ambiguous_resolution`,
// regardless of deal-open status or owner). The task spec offers either
// source; this tick reads directly off `entities` so a placeholder with a
// closed or no linked deal (e.g. a pure asset-only ambiguity) is not silently
// excluded from the review population — `list_flagged_open_deals` remains the
// richer, TB-scoped VIEW used for deal-shaped review UI elsewhere and is left
// untouched.
// ---------------------------------------------------------------------------
async function fetchOpenAmbiguousEntities(limit) {
  const r = await opsQuery('GET', 'entities?select=id,name,city,state,metadata'
    + '&metadata->>ambiguous_resolution=not.is.null'
    + '&metadata->>merged_into=is.null'
    + '&order=name.asc&limit=' + Math.max(1, Math.min(1000, limit)));
  if (!r.ok) return { ok: false, detail: r.data, rows: [] };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

/**
 * Enrich a placeholder's raw {id,name} candidate list with address/
 * normalization data from `entities`. Signal counts (entity_relationships /
 * lcc_entity_portfolio_facts / external_identities) are NOT fetched here —
 * doing so per-candidate across the closed 189-entity population would be an
 * N+1 query pattern this repo's own doctrine warns against repeatedly
 * (P123). The planner treats an absent signal count as 0, which is
 * conservative: it can only ever make the planner LESS willing to
 * auto-merge on a thin tie-break, never more. A follow-up enrichment pass
 * can add the counts without any planner change (they are already read by
 * `scoreCandidate` when present).
 */
async function enrichCandidates(rawCandidates) {
  const ids = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .map((c) => c && c.id).filter(Boolean);
  if (!ids.length) return [];
  const inList = ids.map((id) => encodeURIComponent(id)).join(',');
  const r = await opsQuery('GET', 'entities?select=id,name,address,normalized_address'
    + '&id=in.(' + inList + ')');
  const byId = new Map();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) byId.set(row.id, row);
  }
  return rawCandidates.map((c) => {
    const found = byId.get(c.id) || {};
    return {
      id: c.id,
      name: c.name || found.name || null,
      address: found.address ?? null,
      normalized_address: found.normalized_address ?? null,
      // Not fetched in this pass — see doc comment above.
      entity_relationships_count: null,
      portfolio_facts_count: null,
      external_identities_count: null,
    };
  });
}

async function openRunLog(row) {
  try {
    const r = await opsQuery('POST', RUN_LOG, row, { headers: { Prefer: 'return=representation' } });
    if (!r.ok) { console.error('[ambiguous-entity-automerge] run-log open failed', r.status, r.data); return null; }
    const rec = Array.isArray(r.data) ? r.data[0] : r.data;
    return rec?.run_id ?? null;
  } catch (e) {
    console.error('[ambiguous-entity-automerge] run-log open threw', String(e?.message || e));
    return null;
  }
}

async function closeRunLog(runId, row) {
  try {
    if (runId == null) { await openRunLog(row); return; }
    const r = await opsQuery('PATCH', `${RUN_LOG}?run_id=eq.${encodeURIComponent(runId)}`,
      row, { headers: { Prefer: 'return=minimal' } });
    if (r && r.ok === false) console.error('[ambiguous-entity-automerge] run-log close failed', r.status, r.data);
  } catch (e) {
    console.error('[ambiguous-entity-automerge] run-log close threw', String(e?.message || e));
  }
}

async function callReconcileEntity({ placeholderId, canonicalId }) {
  const r = await opsQuery('POST', 'rpc/reconcile_entity', {
    p_placeholder: placeholderId,
    p_canonical: canonicalId,
    p_keep_new: false,
  });
  if (r.ok === false) return { ok: false, error: 'rpc_call_failed', detail: r.data };
  const out = Array.isArray(r.data) ? r.data[0] : r.data;
  return (out && typeof out === 'object') ? out : { ok: false, error: 'no_result', detail: r.data };
}

export async function handleAmbiguousEntityAutomergeTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const started = Date.now();
  const dryRun = req.method !== 'POST';
  const triggerSource = String(req.query.source || (dryRun ? 'manual' : 'api'));
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || DEFAULT_BATCH));

  let flagOn = false;
  try { flagOn = flagEnabled(FLAG, await fetchFeatureFlag(FLAG)); } catch (_e) { flagOn = false; }

  const batchTag = 'ambigmerge_' + new Date().toISOString().slice(0, 10).replace(/-/g, '')
    + '_' + randomUUID().slice(0, 8);

  const runLogId = dryRun ? null : await openRunLog({
    status: 'started', trigger_source: triggerSource, batch_tag: batchTag,
    flag_enabled: flagOn, dry_run: false, batch_limit: limit,
  });

  try {
    const scan = await fetchOpenAmbiguousEntities(limit + 1);
    if (!scan.ok) {
      await closeRunLog(runLogId, {
        status: 'failed', ok: false, finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started, error_count: 1, detail: { scan_error: scan.detail },
      });
      return res.status(502).json({ error: 'entity_scan_failed', detail: scan.detail });
    }
    const capped = scan.rows.length > limit;
    const entities = capped ? scan.rows.slice(0, limit) : scan.rows;

    // ---- plan (enrichment + pure scoring) --------------------------------
    const planned = [];
    const needsHuman = [];
    for (const entity of entities) {
      const rawCandidates = entity?.metadata?.ambiguous_resolution || [];
      const enriched = await enrichCandidates(rawCandidates);
      const plan = planAmbiguousEntityMerge(entity, enriched);
      if (plan.eligible) planned.push({ entity, plan });
      else needsHuman.push({ entity, plan });
    }

    // ---- GET: dry run ------------------------------------------------
    if (dryRun) {
      return res.status(200).json({
        ok: true, mode: 'dry_run', writes: 0,
        flag: FLAG, flag_enabled: flagOn,
        note: flagOn
          ? 'Flag is ON — POST would merge the auto-mergeable rows below.'
          : 'Flag is OFF — POST is a no-op. This grade is ungated on purpose, so the '
            + 'auto-mergeable/needs_human split can be read before the flag is flipped.',
        db_access_note: 'Population and scores are computed live against whatever '
          + 'the connected DB returns. This split was UNKNOWN at build time (no DB '
          + 'egress in the sandbox this tick was written in) — read this response, '
          + 'do not assume the numbers documented in STATUS.md/PLANNED-BACKLOG.md.',
        population: {
          scanned: entities.length, capped,
          auto_mergeable: planned.length, needs_human: needsHuman.length,
        },
        auto_mergeable: planned.map(({ entity, plan }) => ({
          placeholder_id: entity.id, placeholder_name: entity.name,
          city: entity.city, state: entity.state,
          winner: plan.winner, ranked: plan.ranked,
        })),
        needs_human: needsHuman.map(({ entity, plan }) => ({
          placeholder_id: entity.id, placeholder_name: entity.name,
          city: entity.city, state: entity.state,
          reason: plan.reason, ranked: plan.ranked,
        })),
      });
    }

    // ---- POST: write -----------------------------------------------------
    if (!flagOn) {
      await closeRunLog(runLogId, {
        status: 'completed', ok: true, finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started, scanned: entities.length,
        planned: planned.length, merged: 0, failed_merges: 0,
        detail: { skipped_reason: 'flag_off' },
      });
      return res.status(200).json({ ok: true, skipped: 'flag_off', flag: FLAG, writes: 0,
        would_merge: planned.length });
    }

    let merged = 0; let failedMerges = 0; let budgetStopped = false;
    const results = [];
    const errors = [];

    for (const { entity, plan } of planned) {
      if (Date.now() - started >= BUDGET_MS) { budgetStopped = true; break; }

      const out = await callReconcileEntity({
        placeholderId: entity.id, canonicalId: plan.winner.id,
      });
      if (out.ok) {
        merged++;
        results.push({ placeholder_id: entity.id, canonical_id: plan.winner.id, outcome: 'merged', detail: out });
      } else {
        failedMerges++;
        errors.push({ placeholder_id: entity.id, canonical_id: plan.winner.id, error: out.error, detail: out });
        results.push({ placeholder_id: entity.id, outcome: 'failed:' + (out.error || 'unknown') });
      }
    }

    await closeRunLog(runLogId, {
      status: 'completed', ok: failedMerges === 0, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      scanned: entities.length, planned: planned.length, skipped_needs_human: needsHuman.length,
      merged, failed_merges: failedMerges, capped, budget_stopped: budgetStopped,
      error_count: errors.length,
      detail: { batch_tag: batchTag, errors: errors.slice(0, 10) },
    });

    return res.status(200).json({
      ok: failedMerges === 0, mode: 'write', flag_enabled: true, batch_tag: batchTag,
      merged, failed_merges: failedMerges, skipped_needs_human: needsHuman.length,
      capped, budget_stopped: budgetStopped, run_log_id: runLogId, results,
      reversibility_note: 'reconcile_entity stamps metadata.merged_into on the '
        + 'placeholder — this is a soft tombstone, NOT a snapshot/restore pair '
        + '(unlike lcc_merge_entity/lcc_unmerge_entity elsewhere in this repo). '
        + 'There is no unreconcile_entity RPC. Confirm real reversibility live '
        + 'before relying on it operationally.',
    });
  } catch (err) {
    await closeRunLog(runLogId, {
      status: 'failed', ok: false, finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started, error_count: 1,
      detail: { message: String(err?.message || err) },
    });
    console.error('[ambiguous-entity-automerge-tick]', err?.message || err);
    return res.status(500).json({ error: 'ambiguous_entity_automerge_failed', message: err?.message });
  }
}

export default handleAmbiguousEntityAutomergeTick;
