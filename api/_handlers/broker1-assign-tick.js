// api/_handlers/broker1-assign-tick.js
// ============================================================================
// BROKER1 — assign every prospect to a Team Briggs broker.
//
//   GET  → dry run. No writes. Runs the JS ROE self-signal pass in dry-run
//          mode and the SQL default-assignment RPC in dry-run mode; returns
//          both plans so the counts can be checked before writing.
//   POST → apply. Runs the ROE self-signal pass for real (fill-blanks) THEN
//          the SQL default sweep (fill-blanks), in that order — the SQL
//          sweep's "already assigned" exclusion must see the ROE pass's own
//          writes, or a self-signal owner would be overwritten by a vertical
//          default.
//
// Idempotent, reversible (`lcc_entity_owner_override.set_by like 'broker1_%'`),
// never overwrites an existing row from ANY source. Auth-gated like every
// other admin sub-route; no feature flag — the write is fill-blanks-only by
// construction, so there is no unsafe state a flag would be protecting
// against (mirrors the tier0-auto-attach-tick GET-dry-run precedent for the
// judge-before-flip half, without needing the flip half at all).
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery } from '../_shared/ops-db.js';
import { applyBroker1RoeSelfSignal } from '../_shared/broker1-assign.js';

export async function handleBroker1AssignTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return; // authenticate() already responded

  const isApply = req.method === 'POST';

  try {
    const roeResult = await applyBroker1RoeSelfSignal({ dryRun: !isApply });

    const rpcResult = await opsQuery('POST',
      'rpc/lcc_broker1_assign_prospect_brokers',
      { p_dry_run: !isApply },
      { countMode: 'none' }
    );

    if (!rpcResult.ok) {
      res.status(502).json({ ok: false, error: 'default_sweep_rpc_failed', status: rpcResult.status, detail: rpcResult.data });
      return;
    }

    const buckets = {};
    for (const row of (Array.isArray(rpcResult.data) ? rpcResult.data : [])) {
      buckets[row.bucket] = Number(row.n);
    }

    res.status(200).json({
      ok: true,
      mode: isApply ? 'apply' : 'dry_run',
      roe_self_signal: roeResult,
      default_sweep: buckets,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
