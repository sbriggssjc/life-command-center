// ============================================================================
// GOV-UX1-D5-gate (2026-09-23) — the seller-lead review lane + auto-create tick.
//
//   GET  /api/seller-lead-gate                 lane rows (gated) + funnel + precision meter
//   POST /api/seller-lead-gate                 {entity_id, decision:'create'|'reject', reason?}
//   POST /api/seller-lead-gate?action=reverse  {entity_id} or {batch_tag}: undo auto-created
//                                              leads (and undo a lane "Not a lead")
//   GET  /api/seller-lead-autocreate-tick      dry-run: what the tick WOULD create
//   POST /api/seller-lead-autocreate-tick      apply (flag SELLER_LEAD_AUTOCREATE AND
//                                              precision >= 90% over 25 lane decisions)
//
// Every lead is written by operations.js::bridgeCreateLead — the only lead
// writer. This file calls it; it never inserts into prospect_leads,
// marketing_leads or bd_opportunities itself (reversal only CLOSES them).
// ============================================================================

import { authenticate, requireRole } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import { fetchFeatureFlag, flagEnabled } from '../_shared/feature-flag.js';
import {
  SELLER_LEAD_AUTOCREATE_FLAG, SELLER_LEAD_AUTOCREATE_SOURCE, SELLER_LEAD_LANE_SOURCE,
  SELLER_LEAD_REJECT_REASONS, isValidRejectReason, applySellerLeadGate,
  autoCreateEligibility, precisionMeterLabel, buildCreateLeadBody,
  loadGateCandidates, loadPrecision,
} from '../_shared/seller-lead-gate.js';

const PRODUCER = 'seller_lead_autocreate';
const AUTO_MAX_PER_TICK = 10;

function truthy(v) { return v === true || v === '1' || v === 'true' || v === 1; }

/**
 * Call bridgeCreateLead as a function: it is written as an HTTP handler, so hand it
 * a capturing `res`. Dynamic import keeps operations.js (large) off this module's
 * cold path and avoids an import cycle.
 */
export async function invokeCreateLead(body, user, workspaceId, deps = {}) {
  const create = deps.bridgeCreateLead || (await import('../operations.js')).bridgeCreateLead;
  let status = 200; let payload = null;
  const res = {
    status(code) { status = code; return this; },
    json(obj) { payload = obj; return this; },
  };
  await create({ body, query: {}, headers: {} }, res, user, workspaceId);
  return { status, body: payload || {} };
}

async function recordDecision(row, fields) {
  const r = await opsQuery('POST', 'lcc_seller_lead_gate_decision', {
    workspace_id: row.workspace_id,
    entity_id: row.entity_id,
    owner_name: row.owner_name,
    source_domain: row.source_domain,
    source_property_id: row.source_property_id != null ? String(row.source_property_id) : null,
    gate_snapshot: {
      rank_value: row.rank_value, reason_to_sell: row.reason_to_sell,
      linked_roles: row.linked_roles, contact: row.gate_contact || null,
      point_person_user_id: row.point_person_user_id,
    },
    ...fields,
  });
  // 409 = the live-decision unique index: this owner was already decided (a double
  // click or a re-run). Idempotent by design, never a second decision.
  if (!r.ok && r.status === 409) return { ok: true, duplicate: true };
  return { ok: !!r.ok, duplicate: false, detail: r.ok ? null : r.data };
}

async function loadGated(workspaceId) {
  const cand = await loadGateCandidates(opsQuery);
  if (!cand.ok) return { ok: false, detail: cand.detail };
  const rows = workspaceId ? cand.rows.filter((r) => !r.workspace_id || r.workspace_id === workspaceId) : cand.rows;
  return { ok: true, ...applySellerLeadGate(rows) };
}

async function loadEligibility() {
  const [flagRow, precisionRow] = await Promise.all([
    fetchFeatureFlag(SELLER_LEAD_AUTOCREATE_FLAG), loadPrecision(opsQuery),
  ]);
  const elig = autoCreateEligibility({ flagOn: flagEnabled(SELLER_LEAD_AUTOCREATE_FLAG, flagRow), precisionRow });
  return { ...elig, label: precisionMeterLabel(elig), registry_state: flagRow?.state || null };
}

// ---------------------------------------------------------------------------
// The lane.
// ---------------------------------------------------------------------------
export async function handleSellerLeadGate(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (req.method === 'GET') {
    const [gate, meter] = await Promise.all([loadGated(workspaceId), loadEligibility()]);
    if (!gate.ok) return res.status(502).json({ error: 'gate_query_failed', detail: gate.detail });
    return res.status(200).json({
      ok: true, items: gate.gated, funnel: gate.funnel, meter, reject_reasons: SELLER_LEAD_REJECT_REASONS,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  if (!requireRole(user, 'operator', workspaceId)) return res.status(403).json({ error: 'Operator role required' });

  if (req.query.action === 'reverse') return reverseDecisions(req, res, user);

  const { entity_id: entityId, decision, reason } = req.body || {};
  if (!entityId) return res.status(400).json({ error: 'entity_id is required' });
  if (decision !== 'create' && decision !== 'reject') return res.status(400).json({ error: "decision must be 'create' or 'reject'" });
  if (decision === 'reject' && !isValidRejectReason(reason)) {
    return res.status(400).json({ error: 'reason must be one of ' + SELLER_LEAD_REJECT_REASONS.map((r) => r.key).join(', ') });
  }

  // Re-run the gate server-side: a stale card must not write (the owner may have
  // gained an open opp, been decided by someone else, or become a repeat buyer).
  const gate = await loadGated(workspaceId);
  if (!gate.ok) return res.status(502).json({ error: 'gate_query_failed', detail: gate.detail });
  const row = gate.gated.find((r) => r.entity_id === entityId);
  if (!row) return res.status(409).json({ error: 'not_in_gate', message: 'This owner no longer passes the seller-lead gate (already decided, has an open lead, or a guard now fails).' });

  if (decision === 'reject') {
    const rec = await recordDecision(row, { decision: 'reject', reason, decided_via: 'lane', decided_by: user.id });
    if (!rec.ok) return res.status(500).json({ error: 'decision_write_failed', detail: rec.detail });
    return res.status(200).json({ ok: true, decision: 'reject', duplicate: rec.duplicate, meter: await loadEligibility() });
  }

  const created = await invokeCreateLead(buildCreateLeadBody(row, SELLER_LEAD_LANE_SOURCE), user, workspaceId);
  if (created.body.blocked) {
    return res.status(200).json({ ok: true, decision: null, blocked: created.body.blocked, message: created.body.message });
  }
  if (created.status >= 300 || !created.body.ok) {
    return res.status(created.status >= 400 ? created.status : 500).json({ error: 'create_lead_failed', detail: created.body });
  }
  const rec = await recordDecision(row, {
    decision: 'create', decided_via: 'lane', decided_by: user.id,
    lead_id: created.body.lead_id != null ? String(created.body.lead_id) : null,
    bd_opportunity_id: created.body.bd_opportunity_id || null,
  });
  return res.status(201).json({
    ok: true, decision: 'create', lead: created.body, decision_recorded: rec.ok, duplicate: rec.duplicate,
    meter: await loadEligibility(),
  });
}

// ---------------------------------------------------------------------------
// Reversal: an auto-created lead is closed (opp closed_lost, domain lead void,
// seeded cadence paused) and its decision stamped reversed_at — which the gate
// view reads as a standing "no" for that owner. A lane "Not a lead" is simply
// un-reversed so the owner returns to the lane. Never a delete.
// ---------------------------------------------------------------------------
async function reverseDecisions(req, res, user) {
  const { entity_id: entityId, batch_tag: batchTag, note } = req.body || {};
  if (!entityId && !batchTag) return res.status(400).json({ error: 'entity_id or batch_tag is required' });
  const filter = entityId ? 'entity_id=eq.' + pgFilterVal(entityId) : 'batch_tag=eq.' + encodeURIComponent(batchTag);
  const list = await opsQuery('GET', 'lcc_seller_lead_gate_decision?select=*&reversed_at=is.null&' + filter);
  if (!list.ok) return res.status(500).json({ error: 'list_failed', detail: list.data });
  const now = new Date().toISOString();
  const out = [];
  for (const d of list.data || []) {
    const step = { id: d.id, entity_id: d.entity_id, decision: d.decision, decided_via: d.decided_via };
    if (d.decision === 'create' && d.decided_via === 'auto') {
      // PostgREST PATCH replaces a jsonb column wholesale — read, merge, write.
      if (d.bd_opportunity_id) {
        const cur = await opsQuery('GET', 'bd_opportunities?select=metadata&id=eq.' + pgFilterVal(d.bd_opportunity_id) + '&limit=1');
        const meta = (cur.ok && cur.data && cur.data[0] && cur.data[0].metadata) || {};
        const o = await opsQuery('PATCH', 'bd_opportunities?id=eq.' + pgFilterVal(d.bd_opportunity_id) + '&closed_at=is.null', {
          closed_at: now, closed_won: false, stage: 'closed_lost',
          metadata: { ...meta, reversed_by: 'seller_lead_autocreate_reverse', reversed_decision_id: d.id, reversed_at: now },
        });
        step.opportunity_closed = !!o.ok;
      }
      if (d.lead_id && d.source_domain) {
        const table = d.source_domain === 'gov' ? 'prospect_leads' : 'marketing_leads';
        const col = d.source_domain === 'gov' ? 'pipeline_status' : 'status';
        const l = await domainQuery(d.source_domain, 'PATCH', table + '?lead_id=eq.' + encodeURIComponent(d.lead_id), { [col]: 'void' });
        step.lead_voided = !!l.ok;
      }
      // Pause only the cadence(s) the auto-create seeded (created at/after it).
      const cads = await opsQuery('GET', 'touchpoint_cadence?select=id,phase,metadata&entity_id=eq.' + pgFilterVal(d.entity_id)
        + '&created_at=gte.' + encodeURIComponent(d.created_at) + '&phase=not.in.(paused,unsubscribed)');
      step.cadence_paused = 0;
      for (const c of (cads.ok && Array.isArray(cads.data) ? cads.data : [])) {
        const p = await opsQuery('PATCH', 'touchpoint_cadence?id=eq.' + pgFilterVal(c.id), {
          phase: 'paused',
          metadata: { ...(c.metadata || {}), pause_reason: 'seller_lead_autocreate_reversed', paused_phase: c.phase, paused_at: now },
        });
        if (p.ok) step.cadence_paused += 1;
      }
    } else if (d.decision === 'create') {
      // A lane "Create lead" was a human act — its lead is worked through the
      // normal pipeline, not silently closed here.
      step.skipped = 'lane_create_not_reversible_here';
      out.push(step);
      continue;
    }
    const u = await opsQuery('PATCH', 'lcc_seller_lead_gate_decision?id=eq.' + d.id, {
      reversed_at: now, reversed_by: user.id, reversed_note: note || null,
    });
    step.reversed = !!u.ok;
    out.push(step);
  }
  return res.status(200).json({ ok: true, reversed: out.filter((s) => s.reversed).length, steps: out });
}

// ---------------------------------------------------------------------------
// The auto-create tick.
// ---------------------------------------------------------------------------
async function openRun(triggerSource) {
  const r = await opsQuery('POST', 'producer_runs', { producer: PRODUCER, status: 'started', trigger_source: triggerSource },
    { headers: { Prefer: 'return=representation' } });
  const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
  return row?.run_id || null;
}
async function closeRun(runId, patch) {
  if (!runId) return;
  await opsQuery('PATCH', 'producer_runs?run_id=eq.' + runId, { finished_at: new Date().toISOString(), ...patch }).catch(() => null);
}

/**
 * Pure planner: which gated rows would the tick create, given eligibility?
 * Nothing when ineligible; otherwise the top `max` by value. Exported for tests.
 */
export function planAutoCreate(gated, elig, max = AUTO_MAX_PER_TICK) {
  if (!elig || !elig.eligible) return [];
  return (Array.isArray(gated) ? gated : []).slice(0, Math.max(0, max));
}

export async function handleSellerLeadAutocreateTick(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  const user = await authenticate(req, res);
  if (!user) return;
  const isApply = req.method === 'POST';
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const triggerSource = q.trigger_source || 'api';

  const elig = await loadEligibility();
  const gate = await loadGated(null);
  if (!gate.ok) return res.status(502).json({ error: 'gate_query_failed', detail: gate.detail });
  const plan = planAutoCreate(gate.gated, elig, Math.min(Number(q.limit) || AUTO_MAX_PER_TICK, 25));

  if (!isApply) {
    return res.status(200).json({
      ok: true, mode: 'dry_run', eligibility: elig, gated: gate.funnel.qualifies, funnel: gate.funnel,
      would_create: plan.map((r) => ({ entity_id: r.entity_id, owner_name: r.owner_name, rank_value: r.rank_value })),
    });
  }

  const runId = await openRun(triggerSource);
  if (!elig.eligible) {
    // A NAMED skip, never a silent zero.
    await closeRun(runId, { status: 'skipped', skip_reason: elig.reason, detail: { eligibility: elig, gated: gate.funnel.qualifies } });
    return res.status(200).json({ ok: true, mode: 'apply', skipped: elig.reason, eligibility: elig });
  }

  const batchTag = 'seller_lead_autocreate_' + new Date().toISOString().slice(0, 10);
  const results = [];
  for (const row of plan) {
    const ws = row.workspace_id || user.memberships?.[0]?.workspace_id;
    // The lead OWNER is the entity's point person, never the cron caller.
    const pointUser = { ...user, id: row.point_person_user_id };
    const created = await invokeCreateLead(buildCreateLeadBody(row, SELLER_LEAD_AUTOCREATE_SOURCE), pointUser, ws);
    const item = { entity_id: row.entity_id, owner_name: row.owner_name, status: created.status };
    if (created.body.blocked) { item.blocked = created.body.blocked; results.push(item); continue; }
    if (created.status >= 300 || !created.body.ok) { item.error = created.body; results.push(item); continue; }
    const rec = await recordDecision(row, {
      decision: 'create', decided_via: 'auto', decided_by: row.point_person_user_id, batch_tag: batchTag,
      lead_id: created.body.lead_id != null ? String(created.body.lead_id) : null,
      bd_opportunity_id: created.body.bd_opportunity_id || null,
    });
    Object.assign(item, { created: true, lead_id: created.body.lead_id, bd_opportunity_id: created.body.bd_opportunity_id, decision_recorded: rec.ok });
    results.push(item);
  }
  const createdN = results.filter((r) => r.created).length;
  const errors = results.filter((r) => r.error).length;
  await closeRun(runId, {
    status: errors && !createdN ? 'failed' : 'completed', facts_written: createdN, error_count: errors,
    detail: { batch_tag: batchTag, eligibility: elig, results },
  });
  return res.status(200).json({ ok: true, mode: 'apply', batch_tag: batchTag, created: createdN, errors, results, eligibility: elig });
}

export const _internals = { truthy };
