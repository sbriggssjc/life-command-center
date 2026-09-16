// ============================================================================
// OWNERGAP2-harris — loader idempotency + parse-time guards for
// scripts/hcad-pdata-load.mjs. No zip/network I/O here (that path is smoke-
// tested manually with a real download); this pins the pure logic: the
// upsert call shape (which IS the idempotency mechanism -- the unique index
// on (acct, file_year) plus merge-duplicates AND an explicit on_conflict=
// since OWNERGAP2-harris-c) and that a re-run of the same rows sends the
// SAME upsert shape rather than accumulating state.
//
// OWNERGAP2-harris-c changed two things these tests must reflect:
//   - `upsertRows` returns `{written, errors}`, never `{ok, status}` -- every
//     `upsert` stub below returns that real shape now.
//   - `streamLoadRealAcct` no longer flushes a batch every UPSERT_BATCH_SIZE
//     rows AS IT STREAMS the (already-filtered, small) staged-row set -- it
//     buffers all staged rows (never the raw file text -- that stays
//     line-by-line, unbuffered) and hands them to `upsert()` ONCE at the end,
//     so it can refuse the whole write if any staged row is missing an
//     owner_name (Problem 3) before anything is sent. The per-1000-row HTTP
//     batching this used to do inline now lives in `upsertRows` itself (see
//     "the loader batches at UPSERT_BATCH_SIZE" below, which calls the REAL
//     upsertRows rather than a counting stub).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { upsertRows, streamLoadRealAcct } from '../scripts/hcad-pdata-load.mjs';
import { parseRealAcctText } from '../api/_shared/hcad-pdata-parse.js';

function linesToStream(lines) {
  return Readable.from(lines.map((l) => `${l}\n`));
}

function stubDomainQuery(calls) {
  return async (domain, method, path, body, headers) => {
    calls.push({ domain, method, path, body, headers });
    return { ok: true, status: 200, data: null };
  };
}

/** A stub for streamLoadRealAcct's `upsert` param -- the REAL shape
 * (`{written, errors}`), never the old `{ok, status}`. */
function okUpsert(calls) {
  return async (rows) => { calls.push(rows.length); return { written: rows.length, errors: [] }; };
}

test('upsertRows sends Prefer: resolution=merge-duplicates + an explicit on_conflict= -- the idempotency mechanism', async () => {
  const calls = [];
  const rows = [{ acct: '1', file_year: 2026, owner_name: 'A' }];
  const { written, errors } = await upsertRows(rows, { domainQuery: stubDomainQuery(calls) });
  assert.equal(errors.length, 0);
  assert.equal(written, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'dialysis');
  // OWNERGAP2-harris-c: on_conflict= must be explicit -- PostgREST infers an
  // arbiter WITHOUT it only from the table's PRIMARY KEY (the bigserial `id`,
  // which never collides), never from another unique index even a
  // plain-column one like (acct, file_year).
  assert.equal(calls[0].path, 'hcad_real_acct_stage?on_conflict=acct,file_year');
  assert.match(calls[0].headers.Prefer, /resolution=merge-duplicates/);
});

test('re-running the loader on the SAME parsed rows issues the SAME upsert shape twice, '
  + 'never a growing batch (the (acct, file_year) unique index is what actually dedupes server-side)', async () => {
  const text = 'acct\towner_name\tstate_class\n1\tCorp LLC\tF1\n2\tOther LLC\tF1';
  const parsedOnce = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });
  const parsedTwice = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });

  const calls1 = [];
  const calls2 = [];
  const r1 = await upsertRows(parsedOnce.rows, { domainQuery: stubDomainQuery(calls1) });
  const r2 = await upsertRows(parsedTwice.rows, { domainQuery: stubDomainQuery(calls2) });

  assert.equal(r1.written, r2.written);
  assert.deepEqual(
    calls1.map((c) => c.body.map((r) => `${r.acct}:${r.file_year}`)),
    calls2.map((c) => c.body.map((r) => `${r.acct}:${r.file_year}`)),
  );
});

test('a chunk that fails is reported, never silently dropped -- and carries the DB code/message, not just the status', async () => {
  const failing = async () => ({ ok: false, status: 500, data: 'boom' });
  const rows = [{ acct: '1', file_year: 2026 }];
  const { written, errors } = await upsertRows(rows, { domainQuery: failing });
  assert.equal(written, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /status=500/);
});

test('the loader batches at UPSERT_BATCH_SIZE (1000, OWNERGAP2-harris-b) so one PostgREST call '
  + 'cannot silently truncate a huge export', async () => {
  const calls = [];
  const rows = Array.from({ length: 2500 }, (_, i) => ({ acct: String(i), file_year: 2026 }));
  const { written } = await upsertRows(rows, { domainQuery: stubDomainQuery(calls) });
  assert.equal(written, 2500);
  // 1000-row batches -> 3 calls for 2500 rows.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.length, 1000);
  assert.equal(calls[2].body.length, 500);
});

// ── streamLoadRealAcct — the OWNERGAP2-harris-b streaming rewrite ───────────
// Problem 2: the real real_acct.txt is ~889 MB uncompressed; readFileSync-> a
// string and JSZip's `.async('string')` both throw `RangeError: Invalid
// string length` on Scott's machine. These tests feed streamLoadRealAcct a
// real Node Readable (never a pre-buffered string) so the STREAMING contract
// itself is pinned, not just the per-line parse. OWNERGAP2-harris-c: the
// per-1000-row HTTP batching moved into `upsertRows` (pinned above); what
// streamLoadRealAcct itself guarantees now is that the DECOMPRESSED TEXT is
// read line-by-line and only the already-FILTERED staged rows are held in
// memory before one `upsert()` call.

test('streamLoadRealAcct reads the file line-by-line and hands the real upsertRows the full staged set -- '
  + 'which is what actually chunks the HTTP calls at 1000 rows', async () => {
  const header = 'acct\tname\tmailto\tstr_num\tstr\tstr_sfx\tstate_class';
  const rows = [];
  for (let i = 1; i <= 2500; i += 1) {
    rows.push(`${i}\tOwner ${i} LLC\tOwner ${i} LLC\t${i}\tMAIN\tST\tF1`);
  }
  const stream = linesToStream([header, ...rows]);
  const httpCalls = [];
  const result = await streamLoadRealAcct(stream, {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: true, limit: null, includeAll: false,
    ownersByAcct: new Map(),
    // The REAL upsertRows -- not a counting stub -- so its own 1000-row
    // chunking is what gets exercised end to end.
    upsert: (batch) => upsertRows(batch, { domainQuery: stubDomainQuery(httpCalls) }),
  });
  assert.equal(result.totalLines, 2500);
  assert.equal(result.staged, 2500);
  assert.equal(result.written, 2500);
  assert.equal(result.missingOwnerName, 0);
  // 1000-row HTTP batches -> 3 POSTs, never one 2500-row call.
  assert.equal(httpCalls.length, 3);
  assert.deepEqual(httpCalls.map((c) => c.body.length), [1000, 1000, 500]);
});

test('streamLoadRealAcct filters to F1/F2 WHILE STREAMING, unless --include-all', async () => {
  const header = 'acct\tname\tstr_num\tstr\tstr_sfx\tstate_class';
  const lines = [
    header,
    '1\tCommercial Real LLC\t100\tMAIN\tST\tF1',
    '2\tIndustrial Real LLC\t200\tMAIN\tST\tF2',
    '3\tPersonal BPP LLC\t300\tMAIN\tST\tL1',
    '4\tResidential Owner\t400\tMAIN\tST\tA1',
    '5\tVacant Lot LLC\t500\tMAIN\tST\tC1',
  ];
  const filtered = await streamLoadRealAcct(linesToStream(lines), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null, includeAll: false,
    ownersByAcct: new Map(), upsert: okUpsert([]),
  });
  assert.equal(filtered.staged, 2); // F1 + F2 only
  assert.equal(filtered.classSkipped, 3); // L1, A1, C1

  const all = await streamLoadRealAcct(linesToStream(lines), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null, includeAll: true,
    ownersByAcct: new Map(), upsert: okUpsert([]),
  });
  assert.equal(all.staged, 5);
  assert.equal(all.classSkipped, 0);
});

test('streamLoadRealAcct --limit stops after the first N F1/F2 rows, not the first N lines', async () => {
  const header = 'acct\tname\tstr_num\tstr\tstr_sfx\tstate_class';
  const lines = [
    header,
    '1\tA LLC\t1\tMAIN\tST\tA1', // not commercial -- does not count toward limit
    '2\tB LLC\t2\tMAIN\tST\tF1',
    '3\tC LLC\t3\tMAIN\tST\tF1',
    '4\tD LLC\t4\tMAIN\tST\tF1',
  ];
  const r = await streamLoadRealAcct(linesToStream(lines), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: 2, includeAll: false,
    ownersByAcct: new Map(), upsert: okUpsert([]),
  });
  assert.equal(r.staged, 2);
});

test('streamLoadRealAcct folds owners.txt\'s second owner into owner_name_2 ONLY when still blank', async () => {
  const header = 'acct\tname\tmailto\tstr_num\tstr\tstr_sfx\tstate_class';
  const lines = [
    header,
    // mailto already carries owner_name_2 -- owners.txt supplement must NOT override it.
    '1\tOwner One LLC\tOwner One LLC C/O SOMEONE\t1\tMAIN\tST\tF1',
    // no mailto at all -- owners.txt's second name fills the blank.
    '2\tOwner Two LLC\t\t2\tMAIN\tST\tF1',
  ];
  const ownersByAcct = new Map([
    ['1', [{ name: 'Owner One LLC' }, { name: 'Second Owner For One' }]],
    ['2', [{ name: 'Owner Two LLC' }, { name: 'Second Owner For Two' }]],
  ]);
  let sent = [];
  await streamLoadRealAcct(linesToStream(lines), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: true, limit: null, includeAll: false,
    ownersByAcct,
    upsert: async (batch) => { sent = sent.concat(batch); return { written: batch.length, errors: [] }; },
  });
  const byAcct = Object.fromEntries(sent.map((r) => [r.acct, r]));
  assert.equal(byAcct['1'].owner_name_2, 'Owner One LLC C/O SOMEONE'); // untouched
  assert.equal(byAcct['2'].owner_name_2, 'Second Owner For Two'); // filled from owners.txt
});

test('streamLoadRealAcct refuses (never guesses) when the header lacks the required acct column', async () => {
  const lines = ['name\tstate_class', 'Foo LLC\tF1'];
  await assert.rejects(
    () => streamLoadRealAcct(linesToStream(lines), {
      fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null, includeAll: false,
      ownersByAcct: new Map(), upsert: okUpsert([]),
    }),
    /missing_required_columns/,
  );
});
