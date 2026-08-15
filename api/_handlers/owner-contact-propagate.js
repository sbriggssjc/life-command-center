// api/_handlers/owner-contact-propagate.js
// ============================================================================
// BREAK-1 / Prompt 111 — owner-contact PROPAGATION worker
// ----------------------------------------------------------------------------
// Closes the decision-maker discovery gap for the owners the redesigned panel
// actually hands off to, using ONLY contacts we already hold. No external
// fetching, no SOS-direct, no web search (both remain paused/CI-blocked).
//
// THE GAP (grounded live 2026-08-15, read-only):
//   690 owner entities are reachable from a dia/gov asset via lcc_property_owner.
//   Only 56 carry the contact route the owner panel hero actually reads, so
//   "Work this owner →" dead-ends on "Find a contact" for 634 of them.
//   Meanwhile dia/gov `contacts` carries OWNER-BOUND rows (bound by
//   recorded_owner_id / true_owner_id) whose name is, in the dominant case, the
//   owner's OWN name with a switchboard phone/email. Nothing carried it across.
//
// WHY NOT the existing pipe: `owner_contact_pivot` (fed by
// v_owner_contact_signals_portfolio → lcc-owner-contact-signals-sync/-finalize,
// all crons ACTIVE) holds 5,159 rows but intersects this population on only 48
// owners — it is keyed off the domain true_owner signal view, not off the
// lcc_property_owner graph the panel resolves through. So the pivot is not
// "broken", it is aimed at a different population. This worker walks the panel's
// own graph (asset entity → lcc_property_owner → owner entity) instead of
// forking or re-aiming the pivot. `owner-contact-enrich` keeps draining the
// pivot exactly as before.
//
// SHAPE (the whole decision layer is the PURE planner —
// _shared/owner-contact-propagate-planner.js — so it is unit-testable with no DB):
//   fill_org  → fill-blanks entities.email / entities.phone on the owner, ONLY
//               when the contact's name resolves to the SAME party.
//   review    → lcc_owner_contact_propagate_review (name_mismatch / misparse_name
//               / contact_fanout). Never guessed, never dropped.
//
// DISCIPLINE: GET = dry-run (default, zero writes) · POST = apply · fill-blanks
// only (re-checked immediately before the PATCH, so a concurrent curated edit
// wins) · conservative name matching · junk-guarded · provenance-tagged
// (field_source_priority 'domain_owner_contact' registered in migration
// 20260903120000) · reversible by batch_tag · idempotent · bounded by limit +
// wall clock.
//
// VALUE GATE / NAMED CONSUMER (Consumption-Layer doctrine):
//   This worker emits ZERO new operator-facing work. Filling an owner's own
//   contact detail completes a RECORD — no badge, task, queue row or cadence is
//   created — so there is no producer to value-gate in the first place. It runs
//   the doctrine in reverse: it makes work that ALREADY EXISTS actionable.
//   Named consumers, both pull-based and already built:
//     1. the owner panel hero (_nextActionForContact) — leaves "Find a contact"
//        for an actionable next step the moment entities.email/phone is present.
//        This is the primary consumer and it covers every filled owner;
//     2. the EXISTING touchpoint_cadence rows on these owners. 107 of the
//        still-unreachable owners sit on a cadence, i.e. we are "prospecting"
//        parties we have no way to contact. Those rows stop being un-actionable
//        without one new row being emitted. Measured for batch ocp_20260815:
//        6 of the 36 filled owners were already on a cadence (2 of them
//        contactless) — a genuine but small second-order win; do not overstate
//        it, the hero is where this lands.
//   Deliberately NOT done: seeding a cadence, or stamping the cadence's
//   contact_id. The reachable party here is the ORG's own switchboard, not a
//   person; touchpoint_cadence.contact_id means "which person do we call", so
//   writing the owner's own id into it would be a self-reference and a lie.
//   A person-shaped contact for these owners is the review lane's job.
//   Emission is still capped by `limit` and value-ranked so a partial run does
//   the most valuable owners first.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { domainQuery } from '../_shared/domain-db.js';
import {
  planOwnerPropagation,
  contactFanoutKey,
  BROKER_CONTACT_TYPES,
} from '../_shared/owner-contact-propagate-planner.js';

const WALL_CLOCK_MS = 20000;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
// PostgREST caps every response at 1000 rows regardless of `limit` (CLAUDE.md),
// so every batched IN() read strides at 1000 and pages until short.
const PAGE = 1000;
// Keep IN() lists well under typical URL limits.
const IN_CHUNK = 150;

const DOMAINS = ['dia', 'gov'];
const DOMAIN_LONG = { dia: 'dialysis', gov: 'government' };

// dia and gov `contacts` disagree on column names for the same three fields.
// One adapter, declared once, so the rest of the worker is domain-agnostic.
const CONTACT_SHAPE = {
  gov: { name: 'name', email: 'email', phone: 'phone', id: 'contact_id', type: 'contact_type' },
  dia: { name: 'contact_name', email: 'contact_email', phone: 'contact_phone', id: 'contact_id', type: null },
};

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** PostgREST `in.(...)` value list, each element escaped + quoted. */
function inList(values) {
  return '(' + values.map((v) => '"' + String(v).replace(/"/g, '\\"') + '"').join(',') + ')';
}

/** Normalize a domain contacts row to the worker's internal shape. */
export function normalizeDomainContact(domain, row) {
  const s = CONTACT_SHAPE[domain];
  if (!s || !row) return null;
  return {
    id: row[s.id] != null ? String(row[s.id]) : '',
    name: row[s.name] || '',
    email: row[s.email] || '',
    phone: row[s.phone] || '',
    contact_type: s.type ? (row[s.type] || '') : '',
    data_source: row.data_source || '',
    domain,
    // Which owner key bound this contact — recorded_owner is the SPE/shell,
    // true_owner the beneficial party. Both are owner-bound; a property-only
    // contact is deliberately NEVER loaded (it may be a broker or a prior
    // seller, and attributing it to the current owner would be a guess).
    recorded_owner_id: row.recorded_owner_id || null,
    true_owner_id: row.true_owner_id || null,
  };
}

/**
 * Read the value-ranked unreachable owner worklist (the view owns the
 * "unreachable" definition so the worker and the measurement cannot drift).
 */
async function loadOwners(limit) {
  const res = await opsQuery('GET',
    'v_lcc_owner_unreachable_worklist?select=owner_entity_id,owner_name,owner_domain,rank_value,asset_count'
    + '&order=rank_value.desc.nullslast,owner_entity_id.asc&limit=' + Math.min(limit, MAX_LIMIT));
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, detail: res.data };
  return { ok: true, rows: res.data };
}

/**
 * owner entity → its dia/gov asset property ids, via the SAME graph the panel
 * walks: lcc_property_owner (asset entity) → external_identities (domain asset).
 */
async function loadOwnerAssetLegs(ownerIds) {
  const legs = new Map();       // ownerId → [{domain, propertyId}]
  const assetToOwners = new Map(); // asset entity id → Set(ownerId)

  for (const ids of chunk(ownerIds, IN_CHUNK)) {
    let offset = 0;
    for (;;) {
      const res = await opsQuery('GET',
        'lcc_property_owner?select=entity_id,owner_entity_id&owner_entity_id=in.' + inList(ids)
        + '&order=entity_id.asc&limit=' + PAGE + '&offset=' + offset);
      if (!res.ok || !Array.isArray(res.data)) break;
      for (const r of res.data) {
        if (!r.entity_id || !r.owner_entity_id) continue;
        if (!assetToOwners.has(r.entity_id)) assetToOwners.set(r.entity_id, new Set());
        assetToOwners.get(r.entity_id).add(r.owner_entity_id);
      }
      if (res.data.length < PAGE) break;
      offset += PAGE;
    }
  }

  const assetIds = [...assetToOwners.keys()];
  for (const ids of chunk(assetIds, IN_CHUNK)) {
    let offset = 0;
    for (;;) {
      const res = await opsQuery('GET',
        'external_identities?select=entity_id,source_system,external_id'
        + '&source_type=eq.asset&source_system=in.(dia,gov)&entity_id=in.' + inList(ids)
        + '&order=entity_id.asc&limit=' + PAGE + '&offset=' + offset);
      if (!res.ok || !Array.isArray(res.data)) break;
      for (const r of res.data) {
        const owners = assetToOwners.get(r.entity_id);
        if (!owners) continue;
        for (const ownerId of owners) {
          if (!legs.has(ownerId)) legs.set(ownerId, []);
          legs.get(ownerId).push({ domain: r.source_system, propertyId: String(r.external_id) });
        }
      }
      if (res.data.length < PAGE) break;
      offset += PAGE;
    }
  }
  return legs;
}

/** domain property ids → their recorded/true owner keys. */
async function loadPropertyOwnerKeys(domain, propertyIds) {
  const byProperty = new Map();
  for (const ids of chunk(propertyIds, IN_CHUNK)) {
    const res = await domainQuery(DOMAIN_LONG[domain], 'GET',
      'properties?select=property_id,recorded_owner_id,true_owner_id&property_id=in.(' + ids.join(',') + ')'
      + '&limit=' + PAGE);
    if (!res.ok || !Array.isArray(res.data)) continue;
    for (const r of res.data) {
      byProperty.set(String(r.property_id), {
        recorded_owner_id: r.recorded_owner_id || null,
        true_owner_id: r.true_owner_id || null,
      });
    }
  }
  return byProperty;
}

/** Load OWNER-BOUND contacts for a set of recorded/true owner keys. */
async function loadOwnerBoundContacts(domain, recordedIds, trueIds) {
  const s = CONTACT_SHAPE[domain];
  const cols = ['contact_id', s.name, s.email, s.phone, 'data_source', 'recorded_owner_id', 'true_owner_id']
    .concat(s.type ? [s.type] : []).join(',');
  const out = [];

  // A contact can be bound by BOTH owner keys, and the two passes below would
  // then return it twice. Dedupe on contact_id (first binding wins) so the
  // planner sees one candidate per real contact rather than a phantom duplicate
  // that shows up as `superseded_by_better_candidate` noise in the counts.
  const seenContacts = new Set();

  const fetchBy = async (col, ids) => {
    for (const part of chunk(ids, IN_CHUNK)) {
      let offset = 0;
      for (;;) {
        const res = await domainQuery(DOMAIN_LONG[domain], 'GET',
          'contacts?select=' + cols + '&' + col + '=in.' + inList(part)
          + '&order=contact_id.asc&limit=' + PAGE + '&offset=' + offset);
        if (!res.ok || !Array.isArray(res.data)) break;
        for (const r of res.data) {
          const n = normalizeDomainContact(domain, r);
          if (!n || !n.id || seenContacts.has(n.id)) continue;
          seenContacts.add(n.id);
          out.push({ ...n, bound_by: col === 'true_owner_id' ? 'true_owner' : 'recorded_owner' });
        }
        if (res.data.length < PAGE) break;
        offset += PAGE;
      }
    }
  };

  // true_owner first: it is the beneficial party, so when a contact is bound by
  // both keys that is the more meaningful attribution to record.
  if (trueIds.length) await fetchBy('true_owner_id', trueIds);
  if (recordedIds.length) await fetchBy('recorded_owner_id', recordedIds);
  return out;
}

/**
 * Build the per-owner candidate set. Returns a Map ownerId → contact[].
 * A contact reaches an owner ONLY through that owner's own asset's recorded/true
 * owner key — never through a property-scoped contact row.
 */
async function gatherCandidates(owners, legs) {
  const byOwner = new Map();
  const propsByDomain = { dia: new Set(), gov: new Set() };
  for (const o of owners) {
    for (const leg of (legs.get(o.owner_entity_id) || [])) {
      if (propsByDomain[leg.domain]) propsByDomain[leg.domain].add(leg.propertyId);
    }
  }

  const ownerKeyIndex = { dia: new Map(), gov: new Map() }; // ownerKey → Set(ownerEntityId)
  const propKeys = { dia: new Map(), gov: new Map() };

  for (const domain of DOMAINS) {
    const ids = [...propsByDomain[domain]];
    if (!ids.length) continue;
    propKeys[domain] = await loadPropertyOwnerKeys(domain, ids);
  }

  for (const o of owners) {
    for (const leg of (legs.get(o.owner_entity_id) || [])) {
      const keys = propKeys[leg.domain] && propKeys[leg.domain].get(leg.propertyId);
      if (!keys) continue;
      for (const k of [keys.recorded_owner_id, keys.true_owner_id]) {
        if (!k) continue;
        const idx = ownerKeyIndex[leg.domain];
        if (!idx.has(k)) idx.set(k, new Set());
        idx.get(k).add(o.owner_entity_id);
      }
    }
  }

  for (const domain of DOMAINS) {
    const idx = ownerKeyIndex[domain];
    if (!idx.size) continue;
    const recorded = [];
    const trues = [];
    // A key can appear as either kind; query both lists — a contact bound to a
    // key we only saw as a true_owner is still correctly attributed.
    for (const k of idx.keys()) { recorded.push(k); trues.push(k); }
    const contacts = await loadOwnerBoundContacts(domain, recorded, trues);
    for (const c of contacts) {
      const keys = [c.recorded_owner_id, c.true_owner_id].filter(Boolean);
      const seen = new Set();
      for (const k of keys) {
        for (const ownerId of (idx.get(k) || [])) {
          if (seen.has(ownerId)) continue;
          seen.add(ownerId);
          if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
          byOwner.get(ownerId).push(c);
        }
      }
    }
  }
  return byOwner;
}

/**
 * Fan-out map: how many DISTINCT owners each reachable detail is claimed by.
 * One email/phone spread across many owners is an artifact, not a switchboard —
 * the TrafficMetrix fan-out lesson applied to this source.
 */
export function buildFanout(byOwner) {
  const counts = new Map();
  for (const [ownerId, contacts] of byOwner) {
    const keys = new Set();
    for (const c of contacts) { const k = contactFanoutKey(c); if (k) keys.add(k); }
    for (const k of keys) {
      if (!counts.has(k)) counts.set(k, new Set());
      counts.get(k).add(ownerId);
    }
  }
  const out = new Map();
  for (const [k, owners] of counts) out.set(k, owners.size);
  return out;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Fill-blanks PATCH of the owner entity. Re-reads the row IMMEDIATELY before
 * writing and drops any field that is no longer blank, so a curated edit landing
 * between planning and applying is never clobbered.
 */
async function applyFill(owner, plan, batchTag) {
  const cur = await opsQuery('GET',
    'entities?select=id,name,email,phone&id=eq.' + pgFilterVal(owner.owner_entity_id) + '&limit=1');
  const row = (cur.ok && Array.isArray(cur.data)) ? cur.data[0] : null;
  if (!row) return { ok: false, reason: 'owner_vanished' };

  const patch = {};
  const fields = plan.decision.fields || {};
  if (fields.email && !String(row.email || '').trim()) patch.email = fields.email;
  if (fields.phone && !String(row.phone || '').trim()) patch.phone = fields.phone;
  if (!Object.keys(patch).length) return { ok: false, reason: 'no_longer_blank' };

  const upd = await opsQuery('PATCH', 'entities?id=eq.' + pgFilterVal(owner.owner_entity_id), patch);
  if (!upd.ok) return { ok: false, reason: 'patch_failed', detail: upd.data };

  const c = plan.contact;
  const ledger = Object.keys(patch).map((f) => ({
    batch_tag: batchTag,
    owner_entity_id: owner.owner_entity_id,
    owner_name: owner.owner_name || row.name || null,
    field_name: f,
    old_value: null,                 // fill-blanks only, by construction
    new_value: patch[f],
    source_domain: c.domain,
    source_table: 'contacts',
    source_contact_id: c.id || null,
    source_bound_by: c.bound_by || null,
    contact_name: c.name || null,
    match_how: plan.decision.match?.how || null,
    match_score: plan.decision.match?.score ?? null,
    rank_value: owner.rank_value ?? null,
  }));
  // Idempotent: the unique (owner, field, batch) index makes a repeat a no-op.
  await opsQuery('POST', 'lcc_owner_contact_propagate_log?on_conflict=owner_entity_id,field_name,batch_tag',
    ledger, { headers: { Prefer: 'resolution=ignore-duplicates' } });

  return { ok: true, filled: Object.keys(patch), patch };
}

async function insertReviews(owner, reviews, batchTag) {
  if (!reviews.length) return 0;
  const rows = reviews.map((r) => ({
    subject_ref: 'ocp:' + owner.owner_entity_id + ':' + r.contact.domain + ':' + (r.contact.id || 'x'),
    batch_tag: batchTag,
    owner_entity_id: owner.owner_entity_id,
    owner_name: owner.owner_name || null,
    source_domain: r.contact.domain,
    source_contact_id: r.contact.id || null,
    source_bound_by: r.contact.bound_by || null,
    contact_name: r.contact.name || null,
    contact_email: r.contact.email || null,
    contact_phone: r.contact.phone || null,
    contact_type: r.contact.contact_type || null,
    data_source: r.contact.data_source || null,
    reason: r.decision.reason,
    evidence: r.decision.evidence || {},
    rank_value: owner.rank_value ?? null,
  }));
  const ins = await opsQuery('POST', 'lcc_owner_contact_propagate_review?on_conflict=subject_ref', rows,
    { headers: { Prefer: 'resolution=ignore-duplicates' } });
  return ins.ok ? rows.length : 0;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleOwnerContactPropagateTick(req, res) {
  const user = await authenticate(req, res);
  if (!user) return; // authenticate already sent the 401

  const started = Date.now();
  const apply = req.method === 'POST';       // GET is the dry-run DEFAULT
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const minValue = req.query.min_value != null ? Number(req.query.min_value) : null;
  const batchTag = String(req.query.batch || ('ocp_' + new Date().toISOString().slice(0, 10).replace(/-/g, '')));

  const ownersRes = await loadOwners(limit);
  if (!ownersRes.ok) {
    return res.status(500).json({ ok: false, error: 'worklist_read_failed', detail: ownersRes.detail });
  }
  let owners = ownersRes.rows;
  if (minValue != null) owners = owners.filter((o) => Number(o.rank_value || 0) >= minValue);

  const legs = await loadOwnerAssetLegs(owners.map((o) => o.owner_entity_id));
  const byOwner = await gatherCandidates(owners, legs);
  const fanoutByKey = buildFanout(byOwner);

  const out = {
    ok: true, dry_run: !apply, batch_tag: batchTag,
    scanned: owners.length,
    owners_with_candidates: byOwner.size,
    filled: 0, fields_filled: 0, reviews: 0, skipped: 0,
    by_reason: {}, samples: [], truncated: false,
  };
  const bump = (r) => { out.by_reason[r] = (out.by_reason[r] || 0) + 1; };

  for (const owner of owners) {
    if (Date.now() - started > WALL_CLOCK_MS) { out.truncated = true; break; }
    const candidates = byOwner.get(owner.owner_entity_id) || [];
    if (!candidates.length) { bump('no_candidate_contact'); out.skipped++; continue; }

    // The owner row from the view carries no email/phone; the planner needs the
    // live values to honour fill-blanks. The worklist already guarantees both
    // are blank, so pass them as blank and let applyFill re-verify at write time.
    const ownerForPlan = { id: owner.owner_entity_id, name: owner.owner_name, email: '', phone: '' };
    const plan = planOwnerPropagation(ownerForPlan, candidates, { fanoutByKey });

    for (const s of plan.skipped) bump(s.decision.reason);
    out.skipped += plan.skipped.length;

    if (plan.reviews.length) {
      for (const r of plan.reviews) bump(r.decision.reason);
      out.reviews += plan.reviews.length;
      if (apply) await insertReviews(owner, plan.reviews, batchTag);
    }

    if (!plan.winner) continue;
    bump('fill_org');

    if (out.samples.length < 15) {
      out.samples.push({
        owner: owner.owner_name, rank_value: Number(owner.rank_value || 0),
        contact: plan.winner.contact.name, domain: plan.winner.contact.domain,
        bound_by: plan.winner.contact.bound_by,
        fields: Object.keys(plan.winner.decision.fields || {}),
        match: plan.winner.decision.match,
      });
    }

    if (!apply) { out.filled++; out.fields_filled += Object.keys(plan.winner.decision.fields || {}).length; continue; }

    const applied = await applyFill(owner, plan.winner, batchTag);
    if (!applied.ok) { bump('apply_' + applied.reason); continue; }
    out.filled++;
    out.fields_filled += applied.filled.length;
  }

  out.elapsed_ms = Date.now() - started;
  return res.status(200).json(out);
}

export default handleOwnerContactPropagateTick;
export { BROKER_CONTACT_TYPES };
