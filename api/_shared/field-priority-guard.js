// ============================================================================
// Field priority guard — Round 76aa (2026-04-27)
//
// Phase 5 of the data quality self-learning loop. Wraps lcc_merge_field()
// so JS writers can ASK before they UPDATE: "is this write allowed under
// the field_source_priority registry?" Returns a decision the writer can
// short-circuit on.
//
// Until now (Phases 1-4), JS writers logged provenance AFTER an UPDATE
// regardless of the registry's decision. lcc_merge_field returned 'skip'
// when a lower-trust source attempted to clobber a higher-trust value,
// but the JS just logged it as a 'skip' decision and went ahead with
// the UPDATE anyway — losing data.
//
// This helper closes that loop. Call shouldWriteField() per column. If
// the rule's enforce_mode is 'strict' and decision is 'skip' or 'conflict',
// the writer should NOT execute the UPDATE for that column.
//
// Usage in upsertDomainLeases / upsertDomainProperty / etc:
//
//   const allowed = await shouldWriteField({
//     targetDb:    'dia',
//     targetTable: 'dia.leases',
//     recordPk:    leaseId,
//     fieldName:   'guarantor',
//     value:       newGuarantorValue,
//     source:      'costar_sidebar',
//     confidence:  0.6,
//   });
//   if (allowed.write) {
//     // Run the UPDATE for this column.
//   }
//
// ============================================================================

import { opsQuery } from './ops-db.js';

// ============================================================================
// PR12 — a dropped provenance write must never be silent (2026-09-02)
//
// field_provenance.value_text_hash was GENERATED over `value::text::bytea`.
// The bytea escape parser rejects jsonb's backslash escapes (\" \n \t \r \b
// \f \uXXXX) with 22P02, aborting the whole lcc_merge_field() call — so any
// value carrying a double quote, newline, tab or control character wrote its
// curated value and lost its provenance row. The DB half is fixed by
// supabase/migrations/20261010120000_lcc_pr12_provenance_hash_bytea_safe.sql.
//
// This is the other half. shouldWriteField STILL FAILS OPEN — a provenance
// failure must never cost a curated value, which is the one thing worse than
// losing the provenance. What changes is that the failure now leaves a trace:
//   * the DB's OWN SQLSTATE + message, never just `rpc_<status>` (the same
//     rule this repo learned from "a PostgREST 409 is not necessarily a
//     conflict" — a status code cannot name a cause);
//   * a process-local counter, so a caller/tick can report `provenance_failed`;
//   * a deduped lcc_health_alerts row, so it reaches a surface.
//
// ⚠️ Read `provenance_failed`, never `recorded`. A re-discovery tally reads
//    exactly like throughput while nothing moves.
// ============================================================================

const PROVENANCE_FAILURE_ALERT_KIND = 'provenance_write_failed';

// key -> { count, code, message, targets:Set, firstAt, lastAt }
const _provenanceFailures = new Map();
// Alerts are opened at most once per distinct SQLSTATE per process. The hot
// path is per-FIELD, so a GET+POST per failure would be its own outage.
const _provenanceAlerted = new Set();

/**
 * PostgREST returns the DB error body as { code, message, details, hint } on a
 * non-2xx. Pull the real cause out of it; fall back to the transport error.
 */
export function describeProvenanceFailure(res, err) {
  const body = res && res.data && typeof res.data === 'object' ? res.data : null;
  const code = (body && body.code) || (err && err.code) || null;
  const message = (body && body.message) || (err && err.message) || null;
  return {
    code: code || `http_${res && res.status != null ? res.status : 'exception'}`,
    message: message || 'no DB message returned',
    details: (body && body.details) || null,
  };
}

function _recordProvenanceFailure(targetTable, fieldName, cause) {
  const key = cause.code;
  let e = _provenanceFailures.get(key);
  if (!e) {
    e = { count: 0, code: cause.code, message: cause.message,
          targets: new Set(), firstAt: new Date().toISOString(), lastAt: null };
    _provenanceFailures.set(key, e);
  }
  e.count += 1;
  e.lastAt = new Date().toISOString();
  if (e.targets.size < 25) e.targets.add(`${targetTable}.${fieldName}`);
  return e;
}

/**
 * Provenance-write failures seen by this process, keyed by the DB's own
 * SQLSTATE. `{ total, byCode: [{ code, message, count, targets }] }`.
 * Callers that report a tick should surface `total` as `provenance_failed`.
 */
export function getProvenanceFailureStats() {
  const byCode = [];
  let total = 0;
  for (const e of _provenanceFailures.values()) {
    total += e.count;
    byCode.push({ code: e.code, message: e.message, count: e.count,
                  targets: Array.from(e.targets), firstAt: e.firstAt, lastAt: e.lastAt });
  }
  byCode.sort((a, b) => b.count - a.count);
  return { total, byCode };
}

/** Test seam only — resets the process-local counters and alert dedup. */
export function resetProvenanceFailureStats() {
  _provenanceFailures.clear();
  _provenanceAlerted.clear();
}

/**
 * Fire-and-forget deduped health alert. Never throws: a failure to report a
 * failure must not become a third failure on the caller's write path.
 */
async function _openProvenanceFailureAlert(entry) {
  if (_provenanceAlerted.has(entry.code)) return;
  _provenanceAlerted.add(entry.code);
  const source = `lcc_merge_field:${entry.code}`;
  try {
    const existing = await opsQuery(
      'GET',
      'lcc_health_alerts?select=alert_id&alert_kind=eq.' + encodeURIComponent(PROVENANCE_FAILURE_ALERT_KIND)
        + '&source=eq.' + encodeURIComponent(source) + '&resolved_at=is.null&limit=1',
      undefined, { countMode: 'none' });
    if (existing.ok && Array.isArray(existing.data) && existing.data[0]) return;
    await opsQuery('POST', 'lcc_health_alerts', {
      detected_at: new Date().toISOString(),
      alert_kind: PROVENANCE_FAILURE_ALERT_KIND,
      source,
      severity: 'warn',   // the column default and 482 of 485 live rows; 'warning' is drift
      summary: `lcc_merge_field failed with ${entry.code}: provenance not recorded (the curated write still proceeded)`,
      details: { sqlstate: entry.code, db_message: entry.message,
                 targets: Array.from(entry.targets), first_seen: entry.firstAt },
    });
  } catch (_e) {
    // Swallowed on purpose — see the doc comment above.
  }
}

/**
 * Single owner of "a provenance write was dropped": count it, name the DB's
 * cause, and surface it. Returns the fail-open decision so the two call sites
 * cannot drift on what a failure means.
 */
function noteProvenanceFailure({ targetTable, fieldName, res, err }) {
  const cause = describeProvenanceFailure(res, err);
  const entry = _recordProvenanceFailure(targetTable, fieldName, cause);
  console.warn(`[field-priority-guard] provenance NOT recorded for ${targetTable}.${fieldName}`
    + ` — ${cause.code}: ${cause.message} (write still allowed)`);
  void _openProvenanceFailureAlert(entry);
  return {
    write: true,
    decision: 'no_rule',
    enforceMode: 'no_rule',
    provenanceRecorded: false,
    failureCode: cause.code,
    reason: `provenance write failed (${cause.code}) — failing open`,
  };
}

/**
 * Consult the field_source_priority registry for whether this write should
 * proceed. Calls lcc_merge_field() to get the decision and the rule's
 * enforce_mode, then returns:
 *
 * @returns {{ write: boolean, decision: string, enforceMode: string,
 *            currentSource?: string, reason?: string }}
 *   - write: true when the writer should execute the UPDATE for this column
 *   - decision: 'write' | 'skip' | 'conflict' | 'no_rule'
 *   - enforceMode: 'record_only' | 'warn' | 'strict' | 'no_rule'
 *   - currentSource: when skipped, the higher-trust source that's blocking
 *   - reason: human-readable explanation
 *
 * Behavior matrix:
 *   decision    | enforce_mode | write returns
 *   write       | any          | true
 *   skip        | record_only  | true  (logs the skip but allows write)
 *   skip        | warn         | true  (logs WARN to server console + provenance)
 *   skip        | strict       | false (writer must NOT execute UPDATE)
 *   conflict    | record_only  | true  (logs the conflict but allows write)
 *   conflict    | warn         | true  (logs WARN)
 *   conflict    | strict       | false (writer must NOT execute UPDATE)
 *   no_rule     | n/a          | true  (no priority rule → fail open)
 */
export async function shouldWriteField({
  targetDb,
  targetTable,
  recordPk,
  fieldName,
  value,
  source,
  sourceRunId,
  confidence,
}) {
  if (!targetTable || !fieldName || !source) {
    return { write: true, decision: 'no_rule', enforceMode: 'no_rule',
             reason: 'missing required arguments — failing open' };
  }

  // Call the SQL function. It writes to field_provenance + returns the
  // decision. The function name is lcc_merge_field; we wrap via a SELECT.
  const sql = `SELECT public.lcc_merge_field(
      $1::text,  -- target_database
      $2::text,  -- target_table
      $3::text,  -- record_pk_value
      $4::text,  -- field_name
      $5::text,  -- value
      $6::text,  -- source
      $7::text,  -- source_run_id
      $8::numeric -- confidence
    ) AS result`;

  let res;
  try {
    // lcc_merge_field's parameter names use the `p_*` prefix (verified in
    // production via pg_proc.proname='lcc_merge_field'). PostgREST RPC arg
    // matching is by exact name, so prior `_*` keys silently 404'd —
    // `shouldWriteField` was returning {decision:'no_rule', ...} via the
    // catch path on every call, meaning strict-mode gates were no-ops in
    // production. Re-keying restores the contract.
    res = await opsQuery('POST', 'rpc/lcc_merge_field', {
      p_workspace_id:    null,
      p_target_database: targetDb,
      p_target_table:    targetTable,
      p_record_pk:       String(recordPk ?? ''),
      p_field_name:      fieldName,
      p_value:           value == null ? null : value,
      p_source:          source,
      p_source_run_id:   sourceRunId || null,
      p_confidence:      confidence == null ? null : Number(confidence),
      p_recorded_by:     null,
    });
  } catch (err) {
    // PR12: still fail open — never block a curated write because of a registry
    // RPC error — but record WHY, so a dropped provenance row is not silent.
    return noteProvenanceFailure({ targetTable, fieldName, res: null, err });
  }
  if (!res.ok) {
    return noteProvenanceFailure({ targetTable, fieldName, res, err: null });
  }

  // lcc_merge_field returns SETOF record (TABLE), so PostgREST sends an
  // array. Unwrap the first row.
  const result = Array.isArray(res.data) ? res.data[0] : res.data;
  // result shape: { provenance_id, decision, decision_reason, current_value,
  //                 current_source, current_priority, new_priority, enforce_mode }
  const decision    = result?.decision   || 'no_rule';
  const enforceMode = result?.enforce_mode || 'no_rule';
  const currentSrc  = result?.current_source || null;

  // Strict-mode skips block the write. Everything else allows it.
  if ((decision === 'skip' || decision === 'conflict') && enforceMode === 'strict') {
    return {
      write: false,
      provenanceRecorded: true,
      decision,
      enforceMode,
      currentSource: currentSrc,
      reason: `strict mode: ${currentSrc} (priority ${result?.current_priority}) blocks ${source} write`,
    };
  }

  // Warn-mode skip logs visibly but allows the write.
  if ((decision === 'skip' || decision === 'conflict') && enforceMode === 'warn') {
    console.warn(`[field-provenance:warn] ${decision} on ${targetTable}.${fieldName} record=${recordPk} (current=${currentSrc}, attempted=${source})`);
  }

  return {
    write: true,
    decision,
    enforceMode,
    provenanceRecorded: true,
    currentSource: currentSrc,
  };
}

/**
 * Audit-only provenance recording. Like shouldWriteField but for callers
 * that have ALREADY written and just want the audit trail. Never blocks,
 * never logs warnings — just dispatches a fire-and-forget lcc_merge_field
 * RPC for each field. Used by apply-change.js to record manual_edit
 * provenance after the bridge mutation succeeds.
 *
 * @param {object} args
 * @param {string} args.targetDb       e.g. 'dia_db' / 'gov_db'
 * @param {string} args.targetTable    qualified table, e.g. 'dia.properties'
 * @param {string} args.recordPk       PK value as string
 * @param {string} args.source         source tag, e.g. 'manual_edit'
 * @param {string} [args.sourceRunId]  optional run id (e.g. data_correction id)
 * @param {string} [args.workspaceId]  optional workspace context
 * @param {number} [args.confidence=1] manual_edit defaults to 1.0
 * @param {Object} args.fields         { fieldName: value, ... }
 * @returns {Promise<{ recorded: number, failed: number }>}
 */
export async function recordFieldWrites({
  targetDb,
  targetTable,
  recordPk,
  source,
  sourceRunId,
  workspaceId,
  confidence,
  fields,
}) {
  if (!targetTable || !recordPk || !source || !fields || typeof fields !== 'object') {
    return { recorded: 0, failed: 0 };
  }
  const conf = confidence == null ? 1.0 : Number(confidence);
  let recorded = 0;
  let failed = 0;
  const promises = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (value === undefined) continue;  // null is a meaningful manual write (clear field)
    promises.push(
      opsQuery('POST', 'rpc/lcc_merge_field', {
        p_workspace_id:    workspaceId || null,
        p_target_database: targetDb,
        p_target_table:    targetTable,
        p_record_pk:       String(recordPk),
        p_field_name:      fieldName,
        p_value:           value == null ? null : value,
        p_source:          source,
        p_source_run_id:   sourceRunId || null,
        p_confidence:      conf,
        p_recorded_by:     null,
      })
        .then(res => {
          if (res?.ok) { recorded++; return; }
          // PR12: same counter, same DB-cause capture as the gate path.
          failed++;
          noteProvenanceFailure({ targetTable, fieldName, res, err: null });
        })
        .catch(err => {
          failed++;
          noteProvenanceFailure({ targetTable, fieldName, res: null, err });
        })
    );
  }
  await Promise.allSettled(promises);
  return { recorded, failed };
}

/**
 * Convenience: filter an object of {field: value} to only those fields the
 * writer should UPDATE according to the priority registry. Returns a new
 * object with the disallowed fields stripped out.
 */
export async function filterByFieldPriority({
  targetDb,
  targetTable,
  recordPk,
  source,
  sourceRunId,
  confidence,
  fields,
}) {
  if (!fields || typeof fields !== 'object') return fields;
  const allowed = {};
  const blocked = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    const decision = await shouldWriteField({
      targetDb, targetTable, recordPk, fieldName, value,
      source, sourceRunId, confidence,
    });
    if (decision.write) {
      allowed[fieldName] = value;
    } else {
      blocked.push({ fieldName, reason: decision.reason });
    }
  }
  if (blocked.length > 0) {
    console.log(`[field-priority-guard] ${targetTable} record=${recordPk} blocked ${blocked.length} field(s):`, blocked.map(b => b.fieldName).join(', '));
  }
  return allowed;
}
