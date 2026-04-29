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
    res = await opsQuery('POST', 'rpc/lcc_merge_field', {
      _target_database: targetDb,
      _target_table:    targetTable,
      _record_pk_value: String(recordPk ?? ''),
      _field_name:      fieldName,
      _value:           value == null ? null : String(value),
      _source:          source,
      _source_run_id:   sourceRunId || null,
      _confidence:      confidence == null ? null : Number(confidence),
    });
  } catch (err) {
    // Fail open — never block a write because of a registry RPC error.
    console.warn(`[field-priority-guard] lcc_merge_field RPC failed for ${targetTable}.${fieldName}: ${err?.message}`);
    return { write: true, decision: 'no_rule', enforceMode: 'no_rule',
             reason: 'RPC error — failing open' };
  }
  if (!res.ok) {
    console.warn(`[field-priority-guard] lcc_merge_field returned ${res.status} for ${targetTable}.${fieldName}`);
    return { write: true, decision: 'no_rule', enforceMode: 'no_rule',
             reason: 'RPC non-ok — failing open' };
  }

  const result = res.data;
  // result shape: { decision, enforce_mode, current_source, current_priority, ... }
  const decision    = result?.decision   || 'no_rule';
  const enforceMode = result?.enforce_mode || 'no_rule';
  const currentSrc  = result?.current_source || null;

  // Strict-mode skips block the write. Everything else allows it.
  if ((decision === 'skip' || decision === 'conflict') && enforceMode === 'strict') {
    return {
      write: false,
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
        _target_database: targetDb,
        _target_table:    targetTable,
        _record_pk_value: String(recordPk),
        _field_name:      fieldName,
        _value:           value == null ? null : String(value),
        _source:          source,
        _source_run_id:   sourceRunId || null,
        _confidence:      conf,
      })
        .then(res => { res?.ok ? recorded++ : failed++; })
        .catch(() => { failed++; })
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
