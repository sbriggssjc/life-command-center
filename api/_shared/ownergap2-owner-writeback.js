// ============================================================================
// OWNERGAP2 — the write path. This file is where the provenance contract is
// ENFORCED rather than described.
// Life Command Center — writes Dialysis_DB (zqzrriwuavgrquhisnoa)
// ----------------------------------------------------------------------------
// 🚨 §1, in code:
//   1. A candidate with NO CITATION IS NEVER WRITTEN. `assertCitation()` is
//      called before anything touches the database and refuses a candidate
//      missing the jurisdiction, the source's own record id, or the query that
//      found it. There is no "write it and fill provenance later" path.
//   2. THE NAME IS COPIED. Nothing here generates, expands, title-cases or
//      "cleans up" an owner name. The value written is byte-for-byte the string
//      the source row carried.
//   3. A MISS STAYS A MISS. An unresolved property keeps
//      `recorded_owner_id IS NULL` and is RECORDED with its reason. Nothing
//      here ever falls back to the operator — that is PDR2 undone.
//
// Discipline (CLAUDE.md "Data-write discipline"): fill-blanks only ·
// conservative/unambiguous · provenance-tagged · reversible (batch ledger +
// `dia_ownergap2_unresolve`) · idempotent · never fabricate · dry-run default.
//
// ⚠️ NOTHING HERE WRITES `true_owner_id` OR `true_owners`. The operator flag
// PDR2 relies on is read-only to this module, and OWNERGAP1's quarantine
// triggers are neither modified nor bypassed.
// ============================================================================

import { domainQuery } from './domain-db.js';
import { ownerIdentityKey } from './ownergap2-address-match.js';

export const OWNERGAP2_SOURCE = 'ownergap2_public_assessor';

/**
 * ⚠️ THE OWNERGAP1 FABRICATION GUARD HAS A LIVE FALSE POSITIVE AND THIS BUILD
 * IS THE THING THAT WOULD TRIP IT.
 *
 * `dia_is_fabricated_placeholder_owner()` matches `^(XYZ|ABC)\s` — written
 * against the gpt-4o template placeholders (`ABC Properties LLC`). Measured
 * live 2026-09-16 while reading the Philadelphia misses: the City of
 * Philadelphia's own OPA file lists **`ABC INC`** as the owner of record at
 * `4100 CITY AVE` (parcel on the same street as one of our properties), and
 * `select dia_is_fabricated_placeholder_owner('ABC INC')` returns **true**.
 *
 * So a genuine, source-cited, correctly-matched owner name CAN be a name the
 * write-time trigger will null. If this module simply wrote it, the trigger
 * would quarantine the value, `recorded_owners.name` would land NULL-or-flagged,
 * and the run would report a successful write over a row that says nothing —
 * the "failure that looks exactly like success" this repo catalogues
 * everywhere.
 *
 * The answer is NOT to weaken the guard. That is how a detector starts
 * returning comfortable zeros (P182), and the guard is protecting 471 real
 * fabricated rows. The answer is to CHECK FIRST and REFUSE LOUDLY: the property
 * stays unresolved with reason `blocked_by_fabrication_guard`, carrying the
 * real name and its citation in the ledger so a human can adjudicate one row
 * instead of the system silently losing it.
 *
 * Kept as a JS mirror ONLY for the pre-flight refusal — the SQL function
 * remains the single authority on what is quarantined, and this never decides
 * that something IS fabricated, only that the DB would treat it so.
 */
export function wouldTripFabricationGuard(name) {
  if (name == null) return false;
  const t = String(name).trim();
  if (t === '') return false;
  return /^(XYZ|ABC)\s/i.test(t) || t.toLowerCase() === 'unknown';
}

/**
 * §4, third rule: "The matched owner name IS an operator → write nothing and
 * flag loudly. That is either a genuine operator-owned property or a bad
 * match, and both need a human."
 *
 * ⚠️ THIS READS RECORDED FACTS, NEVER A NAME REGEX. P113 is explicit —
 * "use the existing flag; never write a second name-based operator test, or the
 * two definitions drift and the panel and the feeder disagree". The two
 * recorded facts consulted are:
 *   - `true_owners.is_operator_not_owner` (33 flagged rows / 29 distinct
 *     identity keys, measured live 2026-09-16), and
 *   - the property's OWN `properties.operator` value.
 * A match against either is a refusal, not a write.
 */
export function matchedNameIsOperator(ownerName, { operatorKeys = new Set(), propertyOperator = null } = {}) {
  const key = ownerIdentityKey(ownerName);
  if (!key) return { isOperator: false, basis: null };
  if (operatorKeys.has(key)) return { isOperator: true, basis: 'true_owners.is_operator_not_owner' };
  if (propertyOperator && ownerIdentityKey(propertyOperator) === key) {
    return { isOperator: true, basis: 'properties.operator' };
  }
  return { isOperator: false, basis: null };
}

/**
 * Refuse anything that cannot cite its source. §1: "A row that cannot cite its
 * source does not get written."
 */
export function assertCitation(citation) {
  const missing = [];
  if (!citation) return { ok: false, missing: ['citation'] };
  if (!citation.jurisdiction) missing.push('jurisdiction');
  if (!Array.isArray(citation.source_record_ids) || citation.source_record_ids.length === 0
      || citation.source_record_ids.some((x) => x == null || String(x).trim() === '')) {
    missing.push('source_record_ids');
  }
  if (!citation.source_query) missing.push('source_query');
  return { ok: missing.length === 0, missing };
}

/** Load the recorded operator identity keys once per run (never per row). */
export async function loadOperatorKeys(deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const r = await q('dialysis', 'GET',
    'true_owners?is_operator_not_owner=is.true&select=name&limit=1000');
  const keys = new Set();
  if (r.ok && Array.isArray(r.data)) {
    for (const row of r.data) {
      const k = ownerIdentityKey(row?.name);
      if (k) keys.add(k);
    }
  }
  return { ok: !!r.ok, keys, count: keys.size };
}

/**
 * Decide, WITHOUT writing, what should happen to one resolved/unresolved
 * property. Pure given its inputs so the whole contract is testable.
 *
 * @returns {{action:'write'|'refuse', reason:string|null, ownerName:string|null}}
 */
export function planOwnerWrite(property, verdict, ctx = {}) {
  const base = { action: 'refuse', reason: null, ownerName: null, citation: verdict?.citation ?? null };

  // A property that already has an owner is never overwritten — fill-blanks.
  if (property?.recorded_owner_id) return { ...base, reason: 'already_has_recorded_owner' };

  if (!verdict || verdict.status !== 'resolved') {
    return { ...base, reason: verdict?.reason || verdict?.status || 'unresolved' };
  }

  const cite = assertCitation(verdict.citation);
  if (!cite.ok) return { ...base, reason: `missing_citation:${cite.missing.join('+')}` };

  const name = verdict.owner;
  if (name == null || String(name).trim() === '') return { ...base, reason: 'source_states_no_owner' };

  const op = matchedNameIsOperator(name, ctx);
  if (op.isOperator) {
    return { ...base, reason: 'matched_name_is_operator', ownerName: name, operatorBasis: op.basis };
  }

  if (wouldTripFabricationGuard(name)) {
    return { ...base, reason: 'blocked_by_fabrication_guard', ownerName: name };
  }

  return { action: 'write', reason: null, ownerName: name, citation: verdict.citation };
}

/**
 * Resolve-or-create the `recorded_owners` row for a source-cited owner name,
 * then point the property at it. Fill-blanks throughout.
 *
 * ⚠️ VERIFY THE WRITE LANDED, NEVER THE REQUEST. After inserting, the stored
 * `name` is read back and compared to the source string. If the OWNERGAP1
 * write-time trigger quarantined it, the stored value differs (or the row is
 * flagged) and this reports `write_quarantined` instead of success — a POST
 * that returns 201 over a nulled value is exactly the silent-success shape this
 * repo keeps paying for.
 */
export async function upsertRecordedOwner(ownerName, citation, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const name = String(ownerName);

  const found = await q('dialysis', 'GET',
    `recorded_owners?name=eq.${encodeURIComponent(name)}`
    + '&select=recorded_owner_id,name,fabrication_quarantined_at&limit=1');
  if (!found.ok) return { ok: false, reason: `owner_lookup_failed:${found.status}` };
  if (found.data?.length) {
    const row = found.data[0];
    if (row.fabrication_quarantined_at) {
      return { ok: false, reason: 'existing_owner_row_is_quarantined', recordedOwnerId: row.recorded_owner_id };
    }
    return { ok: true, recordedOwnerId: row.recorded_owner_id, created: false };
  }

  // The `source` column carries the provenance the contract requires, in a form
  // a human can re-run: jurisdiction + the source's own record id.
  const sourceTag = `${OWNERGAP2_SOURCE}:${citation.jurisdiction}:`
    + `${citation.source_record_ids.join('+')}`;
  const insert = await q('dialysis', 'POST', 'recorded_owners', {
    name,
    source: sourceTag,
    notes: JSON.stringify({ ownergap2: citation }),
  }, { Prefer: 'return=representation' });
  if (!insert.ok) return { ok: false, reason: `owner_insert_failed:${insert.status}`, detail: insert.data };
  const created = Array.isArray(insert.data) ? insert.data[0] : insert.data;
  if (!created?.recorded_owner_id) return { ok: false, reason: 'owner_insert_returned_no_id' };

  // Read back — the trigger may have rewritten what we sent.
  const check = await q('dialysis', 'GET',
    `recorded_owners?recorded_owner_id=eq.${created.recorded_owner_id}`
    + '&select=recorded_owner_id,name,fabrication_quarantined_at&limit=1');
  const stored = check.ok && check.data?.length ? check.data[0] : null;
  if (!stored) return { ok: false, reason: 'owner_readback_failed' };
  if (stored.fabrication_quarantined_at || stored.name !== name) {
    return { ok: false, reason: 'write_quarantined', recordedOwnerId: stored.recorded_owner_id, stored: stored.name };
  }
  return { ok: true, recordedOwnerId: stored.recorded_owner_id, created: true };
}

/**
 * Apply ONE planned write. Fill-blanks, ledgered, reversible.
 * `dryRun` is the DEFAULT — a caller must ask for a write explicitly.
 */
export async function applyOwnerResolution(property, plan, batchTag, opts = {}, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const dryRun = opts.dryRun !== false;
  const result = {
    property_id: property.property_id,
    action: plan.action,
    reason: plan.reason,
    owner_name: plan.ownerName,
    recorded_owner_id: null,
    wrote: false,
  };

  if (plan.action !== 'write') {
    // ⚠️ A MISS IS RECORDED, NOT DISCARDED. §5.1 asks for
    // "unresolved-by-cause", and a cause that was never written down cannot be
    // counted. The ledger row IS the deliverable for a refusal.
    if (!dryRun) {
      await ledgerWrite(q, {
        batch_tag: batchTag,
        property_id: property.property_id,
        jurisdiction: opts.jurisdiction || null,
        outcome: 'unresolved',
        outcome_reason: plan.reason,
        owner_name_seen: plan.ownerName,
        citation: plan.citation || null,
      });
    }
    return result;
  }

  if (dryRun) { result.wrote = false; result.reason = 'dry_run'; return result; }

  const owner = await upsertRecordedOwner(plan.ownerName, plan.citation, deps);
  if (!owner.ok) {
    result.action = 'refuse';
    result.reason = owner.reason;
    await ledgerWrite(q, {
      batch_tag: batchTag, property_id: property.property_id,
      jurisdiction: opts.jurisdiction || null, outcome: 'unresolved',
      outcome_reason: owner.reason, owner_name_seen: plan.ownerName, citation: plan.citation,
    });
    return result;
  }
  result.recorded_owner_id = owner.recordedOwnerId;

  // Fill-blanks at the PROPERTY grain — the PATCH itself re-asserts
  // `recorded_owner_id IS NULL`, so a row that gained an owner between the plan
  // and the write is never overwritten (a plan is a verdict recorded before the
  // current state; P121's stale-verdict lesson).
  const patch = await q('dialysis', 'PATCH',
    `properties?property_id=eq.${encodeURIComponent(property.property_id)}&recorded_owner_id=is.null`,
    { recorded_owner_id: owner.recordedOwnerId });
  if (!patch.ok) {
    result.action = 'refuse';
    result.reason = `property_patch_failed:${patch.status}`;
    await ledgerWrite(q, {
      batch_tag: batchTag, property_id: property.property_id,
      jurisdiction: opts.jurisdiction || null, outcome: 'unresolved',
      outcome_reason: result.reason, owner_name_seen: plan.ownerName, citation: plan.citation,
    });
    return result;
  }
  const affected = Array.isArray(patch.data) ? patch.data.length : 0;
  if (affected === 0) {
    result.action = 'refuse';
    result.reason = 'property_gained_owner_since_plan';
    await ledgerWrite(q, {
      batch_tag: batchTag, property_id: property.property_id,
      jurisdiction: opts.jurisdiction || null, outcome: 'unresolved',
      outcome_reason: result.reason, owner_name_seen: plan.ownerName, citation: plan.citation,
    });
    return result;
  }

  result.wrote = true;
  await ledgerWrite(q, {
    batch_tag: batchTag,
    property_id: property.property_id,
    jurisdiction: opts.jurisdiction || null,
    outcome: 'resolved',
    outcome_reason: null,
    owner_name_seen: plan.ownerName,
    recorded_owner_id: owner.recordedOwnerId,
    recorded_owner_created: !!owner.created,
    citation: plan.citation,
  });
  return result;
}

async function ledgerWrite(q, row) {
  try {
    return await q('dialysis', 'POST', 'dia_ownergap2_resolution_log', row,
      { Prefer: 'return=minimal' });
  } catch (err) {
    return { ok: false, status: 0, data: String(err?.message || err) };
  }
}
