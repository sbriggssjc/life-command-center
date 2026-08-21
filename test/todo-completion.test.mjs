// Closing the Loop — Flow 6: the To Do completion poll (staged → Processed).
// NATIVE "Flagged email" list model: LCC no longer creates/maps a custom task,
// so the worklist carries NO todo_task_id / todo_list_id. PA matches the native
// list itself (linkedResources → internetMessageId; subject + staging-time
// fallback, only when NOT subject_ambiguous). PA owns the To-Do/Graph calls;
// LCC only does DB reads/writes. Pure helpers + the two deps-injected
// orchestrators, no DB / no Graph.
//
// P121 — Flow 6 owns NO folder transition. The worklist publishes move:false /
// clear_flag:false (the W7.6 mirror owns staging → Processed and unflags), and the
// flip goes through rpc/lcc_todo_completion_mark_filed, which records a DISPOSITION
// and never stamps move_status/moved_at. These tests pin that contract.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildStagedWorklistItem,
  extractCompletionKeys,
  buildStagedWorklist,
  applyCompletionReports,
} from '../api/_shared/todo-completion.js';

const root = dirname(fileURLToPath(import.meta.url));

describe('buildStagedWorklistItem', () => {
  it('builds the PA worklist item — and instructs NO move / NO unflag (P121)', () => {
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
      move: false,
      move_owner: 'mailbox_mirror',
      clear_flag: false,
    });
  });

  it('subject/staged_at are null when absent (still actionable — PA uses the linkedResources match)', () => {
    const row = { internet_message_id: '<a>', final_target_folder: 'Processed/Deals' };
    assert.deepEqual(buildStagedWorklistItem(row), {
      internet_message_id: '<a>',
      subject: null,
      staged_at: null,
      target_folder: 'Processed/Deals',
      move: false,
      move_owner: 'mailbox_mirror',
      clear_flag: false,
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
      target_folder: 'Processed/Deals', move: false, move_owner: 'mailbox_mirror',
      clear_flag: false, subject_ambiguous: false,
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
    assert.equal(r.count, 0);
    assert.deepEqual(r.items, []);
    assert.equal(r.no_destination, 0);
    // the contract note rides even on an empty tick, so a PA flow still doing its
    // own Move is visible in the run history rather than silently double-moving.
    assert.equal(r.contract.move, false);
    assert.equal(r.contract.move_owner, 'mailbox_mirror');
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
    assert.deepEqual(r, { requested: 0, filed: 0, not_staged: 0, filed_keys: [], dispositions: {} });
    assert.equal(calls, 0);
  });
});

describe('applyCompletionReports — P121 dispositions', () => {
  const staged = [
    { id: 1, internet_message_id: '<a>', final_target_folder: 'Processed/Deals' },
    { id: 2, internet_message_id: '<b>', final_target_folder: 'Processed/Infra' },
  ];

  it('tallies the RPC disposition per flip (what it did, not just how many)', async () => {
    const r = await applyCompletionReports(['<a>', '<b>'], {
      fetchStagedByKeys: async () => staged,
      markFiled: async (row) => ({
        filed: true,
        disposition: row.id === 1 ? 'mirror_owns_move' : 'retargeted_to_final',
      }),
    });
    assert.equal(r.filed, 2);
    assert.deepEqual(r.dispositions, { mirror_owns_move: 1, retargeted_to_final: 1 });
  });

  it('a non-filing disposition is still tallied and never counted as filed', async () => {
    const r = await applyCompletionReports(['<a>'], {
      fetchStagedByKeys: async () => [staged[0]],
      markFiled: async () => ({ filed: false, disposition: 'already_resolved' }),
    });
    assert.equal(r.filed, 0);
    assert.deepEqual(r.filed_keys, []);
    assert.deepEqual(r.dispositions, { already_resolved: 1 });
  });

  it('still accepts the legacy boolean markFiled shape', async () => {
    const r = await applyCompletionReports(['<a>'], {
      fetchStagedByKeys: async () => [staged[0]],
      markFiled: async () => true,
    });
    assert.equal(r.filed, 1);
    assert.deepEqual(r.dispositions, {});
  });
});

describe('P121 — Flow 6 must not claim a mailbox action', () => {
  const sync = readFileSync(join(root, '..', 'api', 'sync.js'), 'utf8');
  const markFiled = sync.slice(sync.indexOf('markFiled: async (row)'), sync.indexOf('markFiled: async (row)') + 900);

  it('markFiled routes to the RPC, not a raw processing_log PATCH', () => {
    assert.match(markFiled, /rpc\/lcc_todo_completion_mark_filed/);
    assert.ok(!/PATCH'?,\s*\n?\s*`processing_log/.test(markFiled),
      'Flow 6 must not PATCH processing_log directly — the RPC is the single owner of the flip');
  });

  it('markFiled never stamps move_status / moved_at / move_outcome', () => {
    for (const field of ['move_status', 'moved_at', 'move_outcome']) {
      assert.ok(!markFiled.includes(`${field}:`),
        `Flow 6 performs no Graph move, so it must never write ${field} — that stamp is what ` +
        'stranded messages in staging while the DB read filed/moved (P121)');
    }
  });
});

describe('P121 — one spelling of the staging folder', () => {
  it('the SQL lcc_staging_folder_name() matches the JS STAGING_FOLDER constant', () => {
    const js = readFileSync(join(root, '..', 'api', '_shared', 'processing-complete.js'), 'utf8');
    const jsName = js.match(/STAGING_FOLDER\s*=\s*'([^']+)'/)?.[1];
    const sql = readFileSync(
      join(root, '..', 'supabase', 'migrations',
           '20260820160000_lcc_p121_staging_processed_single_owner.sql'), 'utf8');
    const sqlName = sql.match(/lcc_staging_folder_name\(\)[\s\S]{0,200}?SELECT '([^']+)'::text/)?.[1];
    assert.ok(jsName, 'STAGING_FOLDER not found in processing-complete.js');
    assert.equal(sqlName, jsName,
      'two hand-typed copies of the staging-folder name is the normaliser drift this repo keeps hitting');
  });
});
