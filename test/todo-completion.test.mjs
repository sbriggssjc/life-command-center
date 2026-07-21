// Closing the Loop — Flow 6: the To Do completion poll (staged → Processed).
// NATIVE "Flagged email" list model: LCC no longer creates/maps a custom task,
// so the worklist carries NO todo_task_id / todo_list_id. PA matches the native
// list itself (linkedResources → internetMessageId; subject + staging-time
// fallback, only when NOT subject_ambiguous). PA owns the To-Do/Graph calls;
// LCC only does DB reads/writes. Pure helpers + the two deps-injected
// orchestrators, no DB / no Graph.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStagedWorklistItem,
  extractCompletionKeys,
  buildStagedWorklist,
  applyCompletionReports,
} from '../api/_shared/todo-completion.js';

describe('buildStagedWorklistItem', () => {
  it('builds the PA worklist item (message key + subject/staged_at + destination + clear_flag)', () => {
    const row = {
      internet_message_id: '<a>',
      final_target_folder: 'Processed/Deals',
      subject: 'OM — 123 Main St',
      created_at: '2026-07-21T10:00:00Z',
    };
    assert.deepEqual(buildStagedWorklistItem(row), {
      internet_message_id: '<a>',
      subject: 'OM — 123 Main St',
      staged_at: '2026-07-21T10:00:00Z',
      target_folder: 'Processed/Deals',
      clear_flag: true,
    });
  });

  it('subject/staged_at are null when absent (still actionable — PA uses the linkedResources match)', () => {
    const row = { internet_message_id: '<a>', final_target_folder: 'Processed/Deals' };
    assert.deepEqual(buildStagedWorklistItem(row), {
      internet_message_id: '<a>',
      subject: null,
      staged_at: null,
      target_folder: 'Processed/Deals',
      clear_flag: true,
    });
  });

  it('null without a resolved destination (never file to a guessed folder)', () => {
    assert.equal(buildStagedWorklistItem({ internet_message_id: '<a>', final_target_folder: null }), null);
    assert.equal(buildStagedWorklistItem({ internet_message_id: '<a>' }), null);
  });

  it('null when the message key is missing', () => {
    assert.equal(buildStagedWorklistItem({ final_target_folder: 'Processed/Deals' }), null);
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
  it('emits actionable items (no mapping lookup); counts no_destination', async () => {
    const rows = [
      { internet_message_id: '<a>', final_target_folder: 'Processed/Deals', subject: 'Alpha', created_at: 't1' },
      { internet_message_id: '<c>', final_target_folder: null, subject: 'Gamma' },          // no destination
      { final_target_folder: 'Processed/Infra', subject: 'no-imid' },                       // no message key → dropped
    ];
    const r = await buildStagedWorklist(100, {
      fetchStagedRows: async (n) => rows.slice(0, n),
    });
    assert.equal(r.count, 1);
    assert.deepEqual(r.items, [{
      internet_message_id: '<a>', subject: 'Alpha', staged_at: 't1',
      target_folder: 'Processed/Deals', clear_flag: true, subject_ambiguous: false,
    }]);
    assert.equal(r.no_destination, 1);
    assert.ok(!('unmapped' in r)); // the mapping concept is retired
  });

  it('flags subject_ambiguous when ≥2 staged emails share a subject (PA must not subject-match)', async () => {
    const rows = [
      { internet_message_id: '<a>', final_target_folder: 'Processed/Deals', subject: 'RE: Quarterly review' },
      { internet_message_id: '<b>', final_target_folder: 'Processed/Deals', subject: 'quarterly review ' }, // same after norm
      { internet_message_id: '<c>', final_target_folder: 'Processed/Deals', subject: 'Unique subject' },
    ];
    const r = await buildStagedWorklist(100, { fetchStagedRows: async () => rows });
    const byId = Object.fromEntries(r.items.map((i) => [i.internet_message_id, i]));
    assert.equal(byId['<a>'].subject_ambiguous, true);  // collides with <b> (RE:/case/space normalized)
    assert.equal(byId['<b>'].subject_ambiguous, true);
    assert.equal(byId['<c>'].subject_ambiguous, false); // unique
  });

  it('flags subject_ambiguous when the subject is blank (nothing to subject-match on)', async () => {
    const rows = [
      { internet_message_id: '<a>', final_target_folder: 'Processed/Deals', subject: '' },
      { internet_message_id: '<b>', final_target_folder: 'Processed/Deals', subject: null },
    ];
    const r = await buildStagedWorklist(100, { fetchStagedRows: async () => rows });
    assert.ok(r.items.every((i) => i.subject_ambiguous === true));
  });

  it('empty staged set → clean zero', async () => {
    const r = await buildStagedWorklist(100, { fetchStagedRows: async () => [] });
    assert.deepEqual(r, { count: 0, items: [], no_destination: 0 });
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
