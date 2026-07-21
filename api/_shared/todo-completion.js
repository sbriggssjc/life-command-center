// ============================================================================
// To Do completion poll — "Closing the Loop" Flow 6 (staged → Processed)
// Life Command Center · mailbox-mechanics layer
//
// Microsoft To Do has no "task completed" trigger, so completion is discovered
// by POLLING — and, because Northmarq IT blocks Azure AD app registrations (no
// Graph service token possible), the actual To-Do API calls live in POWER
// AUTOMATE (its Microsoft To-Do (Business) connector is already OAuth-
// authenticated). LCC only ever does DB reads/writes here — no Graph, no token.
//
// The split:
//   GET  /api/webhooks/todo-completion-poll — a pure DB read: the current
//        worklist of `staged` emails awaiting completion, joined to their To Do
//        task ids. { internet_message_id, todo_task_id, todo_list_id,
//        target_folder (= the Processed/{category} to file to), clear_flag }.
//   PA   loops the worklist, calls the To-Do connector's "Get task" per item to
//        check status, and for each COMPLETED task does the Move + Flag-clear
//        itself, then reports the completed ids back.
//   POST /api/webhooks/todo-completion-poll — a pure DB write: flip each reported
//        row staged→filed (idempotent, guarded on outcome=staged), recording the
//        final destination + moved_at.
//
// Design rules:
//   - LCC never calls Graph/To-Do — PA owns those (OAuth connector).
//   - Idempotent: the flip is guarded on outcome=staged, so a re-report / a
//     concurrent poll flips a row at most once (a resolved row is a no-op).
//   - Never file without a resolved destination (final_target_folder), and never
//     surface an item PA can't check (no todo_task_id / no todo_list_id).
//   - Deps-injected + pure helpers, so both orchestrators are unit-testable with
//     no DB. The HTTP handler (api/sync.js) wires the real DB deps.
// ============================================================================

/**
 * Build ONE worklist item for a staged row + its To Do mapping, or null when
 * the item is not actionable by PA (no mapping / no list id / no destination).
 *
 * @param {object} row      processing_log row (internet_message_id + final_target_folder)
 * @param {object|null} mapping  todo_task_map row (todo_task_id + todo_list_id)
 * @returns {null | {internet_message_id, todo_task_id, todo_list_id, target_folder, clear_flag: true}}
 */
export function buildStagedWorklistItem(row, mapping) {
  const imid = row?.internet_message_id || null;
  if (!imid) return null;
  // PA's "Get task" needs BOTH the list id and the task id.
  if (!mapping || !mapping.todo_task_id || !mapping.todo_list_id) return null;
  // Never hand PA a destination we didn't resolve at staging time.
  const target = row.final_target_folder || null;
  if (!target) return null;
  return {
    internet_message_id: imid,
    todo_task_id: mapping.todo_task_id,
    todo_list_id: mapping.todo_list_id,
    target_folder: target,
    clear_flag: true, // the email is being filed → clear the flag on this move
  };
}

/**
 * Extract the message keys to flip from a POST report body. Accepts an array of
 * strings OR of objects carrying internet_message_id (the shape PA echoes from
 * the GET worklist). Trims, drops blanks, de-dupes.
 *
 * @param {Array} reports
 * @returns {string[]}
 */
export function extractCompletionKeys(reports) {
  if (!Array.isArray(reports)) return [];
  const out = [];
  for (const entry of reports) {
    let key = null;
    if (typeof entry === 'string') key = entry;
    else if (entry && typeof entry === 'object') {
      key = entry.internet_message_id ?? entry.internetMessageId ?? null;
    }
    if (typeof key === 'string' && key.trim()) out.push(key.trim());
  }
  return [...new Set(out)];
}

/**
 * GET orchestrator — assemble the worklist of staged emails awaiting completion.
 * A pure DB read (no Graph). deps-injected for testing.
 *
 * @param {number} limit
 * @param {object} deps
 * @param {(n:number)=>Promise<Array>}          deps.fetchStagedRows    open staged rows, oldest first
 * @param {(ids:string[])=>Promise<Map>}        deps.fetchTaskMappings  internet_message_id → mapping row
 * @returns {Promise<{count:number, items:Array, unmapped:number, no_destination:number}>}
 */
export async function buildStagedWorklist(limit, deps = {}) {
  const { fetchStagedRows, fetchTaskMappings } = deps;
  const rows = (await fetchStagedRows(limit)) || [];
  const ids = rows.map((r) => r?.internet_message_id).filter(Boolean);
  const mapById = ids.length ? ((await fetchTaskMappings(ids)) || new Map()) : new Map();

  const items = [];
  let unmapped = 0;      // staged, has a destination, but no To Do task to poll
  let no_destination = 0; // staged but final_target_folder is missing (can't file)
  for (const row of rows) {
    const mapping = (mapById.get && mapById.get(row?.internet_message_id)) || null;
    const item = buildStagedWorklistItem(row, mapping);
    if (item) { items.push(item); continue; }
    if (!row?.final_target_folder) no_destination++;
    else unmapped++;
  }
  return { count: items.length, items, unmapped, no_destination };
}

/**
 * POST orchestrator — flip each reported staged row to filed. A pure DB write
 * (PA already did the Move + Flag-clear). deps-injected for testing.
 *
 * @param {string[]} keys  internet_message_ids PA found completed + moved
 * @param {object} deps
 * @param {(keys:string[])=>Promise<Array>} deps.fetchStagedByKeys  staged rows for these keys
 * @param {(row:object)=>Promise<boolean>}  deps.markFiled          flip staged→filed (guarded); true iff a row flipped
 * @returns {Promise<{requested:number, filed:number, not_staged:number, filed_keys:string[]}>}
 */
export async function applyCompletionReports(keys, deps = {}) {
  const { fetchStagedByKeys, markFiled } = deps;
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (!uniq.length) return { requested: 0, filed: 0, not_staged: 0, filed_keys: [] };

  const rows = (await fetchStagedByKeys(uniq)) || [];
  const byKey = new Map(rows.map((r) => [r.internet_message_id, r]));

  let filed = 0;
  const filed_keys = [];
  for (const key of uniq) {
    const row = byKey.get(key);
    // Not currently staged (already filed / unknown) ⇒ idempotent no-op.
    if (!row) continue;
    let ok = false;
    try {
      ok = await markFiled(row);
    } catch {
      ok = false;
    }
    if (ok) { filed++; filed_keys.push(key); }
  }
  // A reported key with no staged row is "not_staged" — already handled or never
  // staged; reported honestly, never an error.
  const matched = uniq.filter((k) => byKey.has(k)).length;
  return { requested: uniq.length, filed, not_staged: uniq.length - matched, filed_keys };
}
