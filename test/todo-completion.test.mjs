// Closing the Loop — Flow 6: the To Do completion poll (staged → Processed).
// PA owns the To-Do/Graph calls (OAuth connector); LCC only does DB reads/writes.
// Pure helpers + the two deps-injected orchestrators, no DB / no Graph.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStagedWorklistItem,
  extractCompletionKeys,
  buildStagedWorklist,
  applyCompletionReports,
} from '../api/_shared/todo-completion.js';

describe('buildStagedWorklistItem', () => {
  const mapping = { todo_task_id: 'T1', todo_list_id: 'L1' };

  it('builds the PA worklist item (task ids + destination + clear_flag) for a mapped staged row', () => {
    const row = { internet_message_id: '<a>', final_target_folder: 'Processed/Deals' };
    assert.deepEqual(buildStagedWorklistItem(row, mapping), {
      internet_message_id: '<a>',
      todo_task_id: 'T1',
      todo_list_id: 'L1',
      target_folder: 'Processed/Deals',
      clear_flag: true,
    });
  });

  it('null when unmapped, or missing a list id / task id (PA can not Get-task)', () => {
    const row = { internet_message_id: '<a>', final_target_folder: 'Processed/Deals' };
    assert.equal(buildStagedWorklistItem(row, null), null);
    assert.equal(buildStagedWorklistItem(row, { todo_task_id: 'T1', todo_list_id: null }), null);
    assert.equal(buildStagedWorklistItem(row, { todo_task_id: null, todo_list_id: 'L1' }), null);
  });

  it('null without a resolved destination (never file to a guessed folder)', () => {
    assert.equal(buildStagedWorklistItem({ internet_message_id: '<a>', final_target_folder: null }, mapping), null);
    assert.equal(buildStagedWorklistItem({ internet_message_id: '<a>' }, mapping), null);
  });

  it('null when the message key is missing', () => {
    assert.equal(buildStagedWorklistItem({ final_target_folder: 'Processed/Deals' }, mapping), null);
  });
});

describe('extractCompletionKeys', () => {
  it('accepts objects (internet_message_id / internetMessageId) and bare strings', () => {
    assert.deepEqual(
      extractCompletionKeys([{ internet_message_id: '<a>' }, { internetMessageId: '<b>' }, '<c>']),
      ['<a>', '<b>', '<c>'],
    );
  });
  it('trims, drops blanks/junk, de-dupes', () => {
    assert.deepEqual(extractCompletionKeys([' <a> ', '<a>', '', null, { nope: 1 }, {}]), ['<a>']);
  });
  it('non-array → empty', () => {
    assert.deepEqual(extractCompletionKeys(null), []);
    assert.deepEqual(extractCompletionKeys(undefined), []);
    assert.deepEqual(extractCompletionKeys('x'), []);
  });
});

describe('buildStagedWorklist — the GET worklist assembler', () => {
  it('emits only actionable items; counts unmapped + no_destination', async () => {
    const rows = [
      { internet_message_id: '<a>', final_target_folder: 'Processed/Deals' },   // mapped → item
      { internet_message_id: '<b>', final_target_folder: 'Processed/Infra' },   // no mapping → unmapped
      { internet_message_id: '<c>', final_target_folder: null },                // no destination
    ];
    const mappings = new Map([['<a>', { todo_task_id: 'T1', todo_list_id: 'L1' }]]);
    let askedIds = null;
    const r = await buildStagedWorklist(100, {
      fetchStagedRows: async (n) => rows.slice(0, n),
      fetchTaskMappings: async (ids) => { askedIds = ids; return mappings; },
    });
    assert.deepEqual(askedIds, ['<a>', '<b>', '<c>']); // batch-resolved, not N+1
    assert.equal(r.count, 1);
    assert.deepEqual(r.items, [{
      internet_message_id: '<a>', todo_task_id: 'T1', todo_list_id: 'L1',
      target_folder: 'Processed/Deals', clear_flag: true,
    }]);
    assert.equal(r.unmapped, 1);
    assert.equal(r.no_destination, 1);
  });

  it('empty staged set → clean zero, no mapping lookup', async () => {
    let mapCalls = 0;
    const r = await buildStagedWorklist(100, {
      fetchStagedRows: async () => [],
      fetchTaskMappings: async () => { mapCalls++; return new Map(); },
    });
    assert.deepEqual(r, { count: 0, items: [], unmapped: 0, no_destination: 0 });
    assert.equal(mapCalls, 0);
  });
});

describe('applyCompletionReports — the POST report-back flipper', () => {
  it('flips only the reported staged rows; ignores unknown/already-filed keys', async () => {
    const staged = [
      { id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' },
      { id: 2, internet_message_id: '<b>', final_target_folder: 'Processed/Infra' },
    ];
    const flipped = [];
    const r = await applyCompletionReports(['<a>', '<b>', '<gone>'], {
      fetchStagedByKeys: async (ks) => staged.filter((s) => ks.includes(s.internet_message_id)),
      markFiled: async (row) => { flipped.push(row.id); return true; },
    });
    assert.equal(r.requested, 3);
    assert.equal(r.filed, 2);
    assert.equal(r.not_staged, 1); // '<gone>' had no staged row
    assert.deepEqual(r.filed_keys.sort(), ['<a>', '<b>']);
    assert.deepEqual(flipped.sort(), [1, 2]);
  });

  it('a lost flip (concurrent poll already filed it) is not counted', async () => {
    const r = await applyCompletionReports(['<a>'], {
      fetchStagedByKeys: async () => [{ id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' }],
      markFiled: async () => false, // 0 rows affected — we did not win the flip
    });
    assert.equal(r.filed, 0);
    assert.deepEqual(r.filed_keys, []);
  });

  it('a markFiled throw is swallowed (row stays staged), never crashes the batch', async () => {
    const staged = [
      { id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' },
      { id: 2, internet_message_id: '<b>', final_target_folder: 'Processed/Infra' },
    ];
    const r = await applyCompletionReports(['<a>', '<b>'], {
      fetchStagedByKeys: async () => staged,
      markFiled: async (row) => { if (row.id === 1) throw new Error('db 503'); return true; },
    });
    assert.equal(r.filed, 1);
    assert.deepEqual(r.filed_keys, ['<b>']);
  });

  it('empty / no keys → clean zero (no DB call)', async () => {
    let calls = 0;
    const r = await applyCompletionReports([], {
      fetchStagedByKeys: async () => { calls++; return []; },
      markFiled: async () => true,
    });
    assert.deepEqual(r, { requested: 0, filed: 0, not_staged: 0, filed_keys: [] });
    assert.equal(calls, 0);
  });
});
