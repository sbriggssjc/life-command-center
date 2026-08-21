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
// NATIVE "Flagged email" list model (2026): Outlook auto-creates ONE task in the
// system "Flagged email" To Do list for every flagged message — Scott completes
// tasks THERE, not in a custom list. So LCC no longer creates/maps a custom task
// (the `todo_task_map` write path + `/api/webhooks/todo-task-created` are retired,
// and this module no longer joins to a mapping). Instead PA queries the native
// "Flagged email" list each tick and matches its tasks back to the staged emails
// LCC returns — PRIMARY match: the task's `linkedResources` → the source message
// → its `internetMessageId`; FALLBACK: subject text + staging-time proximity, and
// ONLY when unambiguous (see `subject_ambiguous`).
//
// The split:
//   GET  /api/webhooks/todo-completion-poll — a pure DB read: the current
//        worklist of `staged` emails awaiting completion. Each item is
//        { internet_message_id (the stable match key), subject + staged_at (the
//        subject-fallback anchors), subject_ambiguous (PA must NOT subject-match
//        when true), target_folder (where it will END UP — display/audit only),
//        move:false + move_owner + clear_flag:false }. NO todo_task_id /
//        todo_list_id — LCC doesn't know (and no longer creates) the native task;
//        PA looks it up in the native list.
//   PA   lists the native "Flagged email" tasks, matches each COMPLETED one back
//        to a worklist item (linkedResources → internetMessageId; subject+time
//        fallback only when not subject_ambiguous), and reports the completed
//        internet_message_ids back. It does NOT move or unflag (see P121 below).
//   POST /api/webhooks/todo-completion-poll — a pure DB write: flip each reported
//        row staged→filed + stamp todo_completed_at, via the SQL RPC
//        lcc_todo_completion_mark_filed (idempotent, guarded on outcome=staged).
//
// ⚠️ P121 — Flow 6 owns NO folder transition. The W7.6 mailbox mirror owns
//   staging → Processed/* (and unflags as part of that move); the P120 move queue
//   owns Inbox → *. Flow 6 only RECORDS that the To Do closed, and hands that fact
//   to the mirror via processing_log.todo_completed_at (the mirror's
//   `todo_completed` closure arm). It previously stamped move_status='moved' —
//   asserting a move it never performed, which dropped the row off the mirror's
//   worklist and stranded the message in staging while the DB read filed/moved.
//   The worklist therefore now publishes move:false / clear_flag:false: the PA
//   flow must report completions ONLY, never Move or Flag-clear.
//
// Design rules:
//   - LCC never calls Graph/To-Do — PA owns those (OAuth connector).
//   - Idempotent: the flip is guarded on outcome=staged, so a re-report / a
//     concurrent poll flips a row at most once (a resolved row is a no-op).
//   - Never file without a resolved destination (final_target_folder).
//   - Never assert a mailbox action Flow 6 did not perform (P121).
//   - Surface ambiguity, never guess: a staged subject shared by ≥2 staged emails
//     (or a blank subject) is flagged `subject_ambiguous` so PA's lower-confidence
//     subject fallback leaves it rather than risk clearing the wrong task's flag.
//   - Deps-injected + pure helpers, so both orchestrators are unit-testable with
//     no DB. The HTTP handler (api/sync.js) wires the real DB deps.
// ============================================================================

/**
 * Normalize a subject for the collision check driving `subject_ambiguous`.
 * Aggressive on purpose (strip reply/forward prefixes, case, whitespace) —
 * over-flagging ambiguity is the SAFE direction (PA just leaves it for the
 * next tick / the linkedResources path).
 */
function normSubject(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/^((re|fw|fwd|aw)\s*:\s*)+/i, '') // drop leading RE:/FW:/FWD:/AW:
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build ONE worklist item for a staged row, or null when it is not actionable by
 * PA (no message key / no resolved destination). No mapping arg anymore — the
 * native "Flagged email" task is looked up by PA, not stored by LCC.
 *
 * `subject_ambiguous` is a CROSS-ROW property (set by buildStagedWorklist over
 * the whole worklist), so it is left off here and stamped by the assembler.
 *
 * @param {object} row  processing_log row (internet_message_id + final_target_folder + subject + created_at)
 * @returns {null | {internet_message_id, subject, staged_at, target_folder,
 *                    move: false, move_owner: string, clear_flag: false}}
 */
export function buildStagedWorklistItem(row) {
  const imid = row?.internet_message_id || null;
  if (!imid) return null;
  // Never hand PA a destination we didn't resolve at staging time.
  const target = row.final_target_folder || null;
  if (!target) return null;
  return {
    internet_message_id: imid,
    // Subject + staging time are the FALLBACK match anchors (used only when the
    // linkedResources → internetMessageId primary path can't resolve).
    subject: row.subject || null,
    staged_at: row.created_at || null,
    // Where the message will END UP — published for display/audit only. P121:
    // Flow 6 no longer instructs a move. The mirror owns staging → Processed and
    // unflags as part of that move, so PA's Flow 6 must report completions ONLY.
    target_folder: target,
    move: false,
    move_owner: 'mailbox_mirror',
    clear_flag: false,
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
 * A pure DB read (no Graph, no mapping join). deps-injected for testing.
 *
 * @param {number} limit
 * @param {object} deps
 * @param {(n:number)=>Promise<Array>} deps.fetchStagedRows  open staged rows, oldest first
 * @returns {Promise<{count:number, items:Array, no_destination:number, contract:object}>}
 */
export async function buildStagedWorklist(limit, deps = {}) {
  const { fetchStagedRows } = deps;
  const rows = (await fetchStagedRows(limit)) || [];

  const items = [];
  let no_destination = 0; // staged but final_target_folder is missing (can't file)
  for (const row of rows) {
    const item = buildStagedWorklistItem(row);
    if (item) { items.push(item); continue; }
    // A row with a message key but no destination is surfaced only as a count;
    // a row with no message key at all is nothing PA can file → dropped silently.
    if (row?.internet_message_id && !row?.final_target_folder) no_destination++;
  }

  // Subject-collision flag: PA's subject fallback must never guess between two
  // staged emails that share a subject (Scott: surface ambiguity, don't pick).
  // A blank subject is also ambiguous (nothing to subject-match on).
  const counts = new Map();
  for (const it of items) {
    const key = normSubject(it.subject);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const it of items) {
    const key = normSubject(it.subject);
    it.subject_ambiguous = key === '' || (counts.get(key) || 0) > 1;
  }

  return {
    count: items.length,
    items,
    no_destination,
    // P121: make the contract change visible in PA's own run history the first
    // time this fires, so a flow still doing its own Move is noticed, not guessed at.
    contract: {
      move: false,
      move_owner: 'mailbox_mirror',
      note: 'Report completed To Dos only. Do NOT move or unflag — the W7.6 mailbox '
          + 'mirror owns staging → Processed/* and unflags as part of that move.',
    },
  };
}

/**
 * POST orchestrator — flip each reported staged row to filed. A pure DB write
 * (PA already did the Move + Flag-clear). deps-injected for testing.
 *
 * @param {string[]} keys  internet_message_ids PA found completed + moved
 * @param {object} deps
 * @param {(keys:string[])=>Promise<Array>} deps.fetchStagedByKeys  staged rows for these keys
 * @param {(row:object)=>Promise<boolean|{filed:boolean,disposition?:string}>} deps.markFiled
 *        flip staged→filed (guarded). Returns true / { filed:true } iff a row flipped.
 * @returns {Promise<{requested:number, filed:number, not_staged:number, filed_keys:string[],
 *                    dispositions:Object<string,number>}>}
 */
export async function applyCompletionReports(keys, deps = {}) {
  const { fetchStagedByKeys, markFiled } = deps;
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (!uniq.length) {
    return { requested: 0, filed: 0, not_staged: 0, filed_keys: [], dispositions: {} };
  }

  const rows = (await fetchStagedByKeys(uniq)) || [];
  const byKey = new Map(rows.map((r) => [r.internet_message_id, r]));

  let filed = 0;
  const filed_keys = [];
  // P121 honest counts: WHAT each flip did, not just how many flipped.
  // mirror_owns_move  = already in staging; the mirror performs the move.
  // retargeted_to_final = never staged; the move queue now delivers it direct.
  // Never read `filed` as a count of emails moved — Flow 6 moves nothing.
  const dispositions = {};
  for (const key of uniq) {
    const row = byKey.get(key);
    // Not currently staged (already filed / unknown) ⇒ idempotent no-op.
    if (!row) continue;
    let out = false;
    try {
      out = await markFiled(row);
    } catch {
      out = false;
    }
    // Accept the legacy boolean and the P121 { filed, disposition } shape.
    const ok = out === true || (out && out.filed === true);
    const disposition = (out && typeof out === 'object' && out.disposition) || null;
    if (disposition) dispositions[disposition] = (dispositions[disposition] || 0) + 1;
    if (ok) { filed++; filed_keys.push(key); }
  }
  // A reported key with no staged row is "not_staged" — already handled or never
  // staged; reported honestly, never an error.
  const matched = uniq.filter((k) => byKey.has(k)).length;
  return { requested: uniq.length, filed, not_staged: uniq.length - matched, filed_keys, dispositions };
}
