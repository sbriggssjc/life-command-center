// Closing the Loop — Flow 6: the To Do completion poll (staged → Processed).
// Pure helpers + the deps-injected orchestrator, no DB / no Graph.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isTodoTaskComplete,
  buildCompletionInstruction,
  pollTodoCompletions,
} from '../api/_shared/todo-completion.js';

describe('isTodoTaskComplete — Graph task status', () => {
  it('true only for status "completed" (case/space-insensitive)', () => {
    assert.equal(isTodoTaskComplete({ status: 'completed' }), true);
    assert.equal(isTodoTaskComplete({ status: ' Completed ' }), true);
    assert.equal(isTodoTaskComplete({ status: 'COMPLETED' }), true);
  });
  it('false for every other status + missing', () => {
    for (const s of ['notStarted', 'inProgress', 'waitingOnOthers', 'deferred', '', undefined]) {
      assert.equal(isTodoTaskComplete({ status: s }), false, String(s));
    }
    assert.equal(isTodoTaskComplete(null), false);
    assert.equal(isTodoTaskComplete({}), false);
  });
});

describe('buildCompletionInstruction', () => {
  const row = { internet_message_id: '<AAA@x>', final_target_folder: 'Processed/Deals' };

  it('issues a clear_flag move to final_target_folder when the task is completed', () => {
    assert.deepEqual(buildCompletionInstruction(row, 'completed'), {
      internet_message_id: '<AAA@x>',
      target_folder: 'Processed/Deals',
      clear_flag: true,
    });
  });

  it('returns null when the task is not completed (incomplete / unknown)', () => {
    assert.equal(buildCompletionInstruction(row, 'incomplete'), null);
    assert.equal(buildCompletionInstruction(row, 'unknown'), null);
  });

  it('never files without a resolved destination (no guessing a folder)', () => {
    assert.equal(buildCompletionInstruction({ internet_message_id: '<A>', final_target_folder: null }, 'completed'), null);
    assert.equal(buildCompletionInstruction({ internet_message_id: '<A>' }, 'completed'), null);
  });

  it('returns null when the message key is missing', () => {
    assert.equal(buildCompletionInstruction({ final_target_folder: 'Processed/Deals' }, 'completed'), null);
  });
});

// ── orchestrator harness ─────────────────────────────────────────────────────
function makeDeps({ rows, taskMap, statuses, failFlipFor = new Set(), throwStatusFor = new Set() }) {
  const flipped = [];
  return {
    flipped,
    deps: {
      fetchStagedRows: async (n) => rows.slice(0, n),
      fetchTaskMapping: async (imid) => taskMap[imid] ?? null,
      getTaskStatus: async (_listId, taskId) => {
        if (throwStatusFor.has(taskId)) throw new Error('graph 500');
        return statuses[taskId] ?? 'unknown';
      },
      markFiled: async (row) => {
        if (failFlipFor.has(row.id)) return false; // concurrent poll already won
        flipped.push(row.id);
        return true;
      },
    },
  };
}

describe('pollTodoCompletions — the staged → Processed orchestrator', () => {
  it('emits a move instruction + flips only the completed, mapped staged rows', async () => {
    const rows = [
      { id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' }, // completed → instruct
      { id: 2, internet_message_id: '<b>', final_target_folder: 'Processed/Infra' }, // not started → stay
      { id: 3, internet_message_id: '<c>', final_target_folder: 'Processed/General' }, // no mapping → stay
    ];
    const { deps, flipped } = makeDeps({
      rows,
      taskMap: {
        '<a>': { todo_task_id: 'T1', todo_list_id: 'L1' },
        '<b>': { todo_task_id: 'T2', todo_list_id: 'L1' },
        // '<c>' unmapped
      },
      statuses: { T1: 'completed', T2: 'incomplete' },
    });

    const r = await pollTodoCompletions({ limit: 100 }, deps);
    assert.equal(r.completed, 1);
    assert.equal(r.count, 1);
    assert.deepEqual(r.instructions, [
      { internet_message_id: '<a>', target_folder: 'Processed/Deals', clear_flag: true },
    ]);
    assert.equal(r.unresolved, 1); // '<c>' has no mapping
    assert.deepEqual(flipped, [1]); // only the completed one flipped staged→filed
  });

  it('a mapping with no list id is unresolved (can not query Graph — never guesses)', async () => {
    const { deps, flipped } = makeDeps({
      rows: [{ id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' }],
      taskMap: { '<a>': { todo_task_id: 'T1', todo_list_id: null } },
      statuses: { T1: 'completed' },
    });
    const r = await pollTodoCompletions({}, deps);
    assert.equal(r.count, 0);
    assert.equal(r.unresolved, 1);
    assert.deepEqual(flipped, []);
  });

  it('does NOT issue the instruction when the flip is lost to a concurrent poll', async () => {
    const { deps, flipped } = makeDeps({
      rows: [{ id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' }],
      taskMap: { '<a>': { todo_task_id: 'T1', todo_list_id: 'L1' } },
      statuses: { T1: 'completed' },
      failFlipFor: new Set([1]),
    });
    const r = await pollTodoCompletions({}, deps);
    assert.equal(r.count, 0, 'no instruction when we did not win the flip');
    assert.deepEqual(flipped, []);
  });

  it('a Graph status error leaves that row staged (counted errored), never instructed', async () => {
    const { deps, flipped } = makeDeps({
      rows: [{ id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' }],
      taskMap: { '<a>': { todo_task_id: 'T1', todo_list_id: 'L1' } },
      statuses: {},
      throwStatusFor: new Set(['T1']),
    });
    const r = await pollTodoCompletions({}, deps);
    assert.equal(r.count, 0);
    assert.equal(r.errored, 1);
    assert.deepEqual(flipped, []);
  });

  it('empty staged set → clean zero result', async () => {
    const { deps } = makeDeps({ rows: [], taskMap: {}, statuses: {} });
    const r = await pollTodoCompletions({}, deps);
    assert.deepEqual(r, { checked: 0, completed: 0, unresolved: 0, errored: 0, count: 0, instructions: [] });
  });
});
