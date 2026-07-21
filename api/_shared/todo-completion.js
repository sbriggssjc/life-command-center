// ============================================================================
// To Do completion poll — "Closing the Loop" Flow 6 (staged → Processed)
// Life Command Center · mailbox-mechanics layer
//
// Microsoft To Do has no "task completed" trigger, so completion is discovered
// by POLLING. A `staged` email (intake finished for a non-terminal category)
// sits in the "Intake Staged, Not Completed" folder, still flagged, with a
// linked To Do task. This module walks the open staged rows, reads each task's
// status from Graph, and — for the tasks that are now `completed` — emits a move
// instruction { internet_message_id, target_folder, clear_flag } that Power
// Automate executes: Move the email to its Processed/{category} folder (the
// final_target_folder resolved at staging time) and clear the flag.
//
// Design rules:
//   - Idempotent: a staged row is flipped staged→filed the moment its
//     instruction is issued (guarded on outcome=staged), so it drops out of the
//     staged set and is never re-instructed on the next poll.
//   - Optimistic-on-issue (documented tradeoff): the flip happens when the
//     instruction is issued, not on a PA move-report. A rare PA move failure
//     leaves the email in the staging folder, still flagged, still visible —
//     never lost. (The retention sweep never touches the staging folder.)
//   - Deps-injected + pure helpers, so the orchestrator is unit-testable with no
//     DB / Graph. The HTTP handler (api/sync.js) wires the real deps.
//   - Best-effort throughout: a Graph/DB hiccup on one row leaves it staged for
//     the next poll; it never blocks the batch.
// ============================================================================

export const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Is a Graph Microsoft To Do task payload completed?
 * Graph task `status` is one of notStarted | inProgress | completed | waitingOnOthers | deferred.
 * @param {object|null} task  the `/me/todo/lists/{listId}/tasks/{taskId}` body
 * @returns {boolean}
 */
export function isTodoTaskComplete(task) {
  return String(task?.status ?? '').trim().toLowerCase() === 'completed';
}

/**
 * Build the move instruction for a staged row given its resolved task status.
 * Returns null when the email should stay staged (task not complete, or no
 * resolved destination to file to — never guess a folder).
 *
 * @param {object} row         processing_log row (needs internet_message_id + final_target_folder)
 * @param {string} taskStatus  'completed' | 'incomplete' | 'unknown'
 * @returns {null | {internet_message_id: string, target_folder: string, clear_flag: true}}
 */
export function buildCompletionInstruction(row, taskStatus) {
  if (taskStatus !== 'completed') return null;
  const target = row?.final_target_folder || null;
  if (!target) return null; // never file without a resolved Processed/{category}
  const imid = row?.internet_message_id || null;
  if (!imid) return null;
  return { internet_message_id: imid, target_folder: target, clear_flag: true };
}

/**
 * Core poll orchestrator (deps-injected).
 *
 * @param {object}   opts
 * @param {number}   [opts.limit=100]  max staged rows to check this tick
 * @param {object}   deps
 * @param {(n:number)=>Promise<Array>}       deps.fetchStagedRows    open staged rows, oldest first
 * @param {(imid:string)=>Promise<object|null>} deps.fetchTaskMapping  todo_task_map row for a message
 * @param {(listId:string, taskId:string)=>Promise<string>} deps.getTaskStatus  'completed'|'incomplete'|'unknown'
 * @param {(row:object)=>Promise<boolean>}   deps.markFiled          flip staged→filed (guarded); true iff a row flipped
 * @returns {Promise<{checked:number, completed:number, unresolved:number, errored:number, count:number, instructions:Array}>}
 */
export async function pollTodoCompletions({ limit = 100 } = {}, deps = {}) {
  const { fetchStagedRows, fetchTaskMapping, getTaskStatus, markFiled } = deps;
  const rows = (await fetchStagedRows(limit)) || [];

  const instructions = [];
  let checked = 0;
  let completed = 0;
  let unresolved = 0;
  let errored = 0;

  for (const row of rows) {
    const imid = row?.internet_message_id;
    if (!imid) { unresolved++; continue; }

    let map = null;
    try {
      map = await fetchTaskMapping(imid);
    } catch {
      errored++;
      continue;
    }
    // No To Do mapping (or missing list id ⇒ can't query Graph). Leave staged —
    // the task may be linked later, and we never guess completion.
    if (!map || !map.todo_task_id || !map.todo_list_id) { unresolved++; continue; }

    checked++;
    let status = 'unknown';
    try {
      status = await getTaskStatus(map.todo_list_id, map.todo_task_id);
    } catch {
      errored++;
      continue;
    }

    const instr = buildCompletionInstruction(row, status);
    if (!instr) continue;

    // Flip staged→filed FIRST (idempotent: the flip is guarded on outcome=staged,
    // so a concurrent poll flips it exactly once). Only issue the instruction
    // when THIS poll won the flip — otherwise a second poll would re-issue the
    // same move.
    let flipped = false;
    try {
      flipped = await markFiled(row);
    } catch {
      errored++;
      continue;
    }
    if (!flipped) continue;

    completed++;
    instructions.push(instr);
  }

  return { checked, completed, unresolved, errored, count: instructions.length, instructions };
}
