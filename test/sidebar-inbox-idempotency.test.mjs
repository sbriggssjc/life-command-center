// SIDEBAR2-c (2026-09-18) — sidebar-sourced inbox_items rows were posted
// TWICE within ~1s of each other (duplicate inserts on every capture: OM
// cards, "New contact: ..." cards). Root cause: the writes at
// api/_handlers/sidebar-pipeline.js (contact_misparse_review,
// new_contact_qualify) and api/_shared/intake-om-pipeline.js (stageOmIntake)
// set no `external_id`, so the ALREADY-EXISTING dedup unique index
// (schema/028_email_dedup_constraint.sql — idx_inbox_items_dedup on
// (workspace_id, external_id, source_type) WHERE external_id IS NOT NULL)
// never applied to them, and PostgREST's `resolution=merge-duplicates` had
// nothing to key off. No new schema was needed — the writers just weren't
// using the mechanism the table already had.
//
// This test pins the pure key-derivation helper (stable, collision-resistant
// across a retry, distinct across genuinely different captures) and
// reproduces a duplicate-post scenario against a fake opsQuery to prove the
// idempotency key + merge-duplicates Prefer header together stop a retry
// from minting a second row.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inboxItemDedupKey } from '../api/_handlers/sidebar-pipeline.js';

describe('inboxItemDedupKey (SIDEBAR2-c)', () => {
  it('is stable for the same event repeated inside the same minute (the retry case)', () => {
    const t = '2026-09-18T17:35:03.980Z';
    const t2 = '2026-09-18T17:35:04.910Z'; // ~1s later, same minute bucket
    const k1 = inboxItemDedupKey('contact_misparse_review', ['prop-123', 'costar', 'email_fanout'], t);
    const k2 = inboxItemDedupKey('contact_misparse_review', ['prop-123', 'costar', 'email_fanout'], t2);
    assert.equal(k1, k2, 'two posts ~1s apart for the same event must collide on the dedup key');
  });

  it('differs across distinct properties / reasons', () => {
    const t = '2026-09-18T17:35:03.980Z';
    const kA = inboxItemDedupKey('contact_misparse_review', ['prop-123', 'costar', 'email_fanout'], t);
    const kB = inboxItemDedupKey('contact_misparse_review', ['prop-456', 'costar', 'email_fanout'], t);
    assert.notEqual(kA, kB);
  });

  it('differs across genuinely different minutes (a real second capture, not a retry)', () => {
    const t1 = '2026-09-16T09:10:00.000Z';
    const t2 = '2026-09-16T09:41:00.000Z';
    const kA = inboxItemDedupKey('new_contact_qualify', ['prop-1'], t1);
    const kB = inboxItemDedupKey('new_contact_qualify', ['prop-1'], t2);
    assert.notEqual(kA, kB);
  });

  it('is case/whitespace tolerant on its parts (defense against minor payload jitter)', () => {
    const t = '2026-09-18T17:35:03.980Z';
    const kA = inboxItemDedupKey('contact_misparse_review', [' Prop-123 ', 'CoStar'], t);
    const kB = inboxItemDedupKey('contact_misparse_review', ['prop-123', 'costar'], t);
    assert.equal(kA, kB);
  });
});

describe('duplicate-post reproduction against a fake inbox_items table', () => {
  // Minimal in-memory stand-in for the (workspace_id, external_id, source_type)
  // partial unique index + PostgREST's resolution=merge-duplicates: a second
  // POST with an external_id that already exists for that (workspace, source_type)
  // updates the row in place rather than inserting a new one.
  function makeFakeInboxTable() {
    const rows = [];
    return {
      rows,
      async post(payload, headers) {
        const merges = String(headers?.Prefer || '').includes('resolution=merge-duplicates');
        if (payload.external_id != null && merges) {
          const existing = rows.find((r) => r.workspace_id === payload.workspace_id
            && r.source_type === payload.source_type
            && r.external_id === payload.external_id);
          if (existing) {
            Object.assign(existing, payload);
            return { ok: true, data: [existing], merged: true };
          }
        }
        const row = { id: `row-${rows.length + 1}`, ...payload };
        rows.push(row);
        return { ok: true, data: [row], merged: false };
      },
    };
  }

  it('two POSTs for the same logical event (retry) land as ONE row when external_id + merge-duplicates are used', async () => {
    const table = makeFakeInboxTable();
    const key = inboxItemDedupKey('new_contact_qualify', ['entity-789'], '2026-09-16T16:36:43.670Z');
    const payload = {
      workspace_id: 'ws-1',
      source_type: 'new_contact_qualify',
      external_id: key,
      title: 'New contact: Lance Sasser',
    };
    const headers = { Prefer: 'return=minimal,resolution=merge-duplicates' };

    const r1 = await table.post(payload, headers);
    const r2 = await table.post({ ...payload, title: 'New contact: Lance Sasser (retry)' }, headers);

    assert.equal(r1.merged, false, 'first post is a genuine insert');
    assert.equal(r2.merged, true, 'second post for the same key merges instead of inserting');
    assert.equal(table.rows.length, 1, 'only ONE inbox_items row exists after the duplicate POST');
  });

  it('WITHOUT external_id (the pre-fix shape), a retry mints a second row — proves the bug and the fix', async () => {
    const table = makeFakeInboxTable();
    const payload = {
      workspace_id: 'ws-1',
      source_type: 'new_contact_qualify',
      external_id: null, // the pre-fix behavior
      title: 'New contact: Lance Sasser',
    };
    const headers = { Prefer: 'return=minimal,resolution=merge-duplicates' };

    await table.post(payload, headers);
    await table.post(payload, headers);

    assert.equal(table.rows.length, 2, 'no external_id ⇒ the dedup index cannot apply ⇒ duplicate row (the bug)');
  });

  it('two DIFFERENT events (different entities) never collide', async () => {
    const table = makeFakeInboxTable();
    const headers = { Prefer: 'return=minimal,resolution=merge-duplicates' };
    const keyA = inboxItemDedupKey('new_contact_qualify', ['entity-A'], '2026-09-16T16:36:43.670Z');
    const keyB = inboxItemDedupKey('new_contact_qualify', ['entity-B'], '2026-09-16T16:36:43.670Z');

    await table.post({ workspace_id: 'ws-1', source_type: 'new_contact_qualify', external_id: keyA, title: 'A' }, headers);
    await table.post({ workspace_id: 'ws-1', source_type: 'new_contact_qualify', external_id: keyB, title: 'B' }, headers);

    assert.equal(table.rows.length, 2);
  });
});
