// ============================================================================
// OWNERGAP2-harris — loader idempotency + parse-time guards for
// scripts/hcad-pdata-load.mjs. No zip/network I/O here (that path is smoke-
// tested manually with a real download); this pins the pure logic: the
// upsert call shape (which IS the idempotency mechanism -- the unique index
// on (acct, file_year) plus merge-duplicates) and that a re-run of the same
// rows sends the SAME upsert shape rather than accumulating state.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upsertRows } from '../scripts/hcad-pdata-load.mjs';
import { parseRealAcctText } from '../api/_shared/hcad-pdata-parse.js';

function stubDomainQuery(calls) {
  return async (domain, method, path, body, headers) => {
    calls.push({ domain, method, path, body, headers });
    return { ok: true, status: 200, data: null };
  };
}

test('upsertRows sends Prefer: resolution=merge-duplicates -- the idempotency mechanism', async () => {
  const calls = [];
  const rows = [{ acct: '1', file_year: 2026, owner_name: 'A' }];
  const { written, errors } = await upsertRows(rows, { domainQuery: stubDomainQuery(calls) });
  assert.equal(errors.length, 0);
  assert.equal(written, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'dialysis');
  assert.equal(calls[0].path, 'hcad_real_acct_stage');
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

test('a chunk that fails is reported, never silently dropped', async () => {
  const failing = async () => ({ ok: false, status: 500, data: 'boom' });
  const rows = [{ acct: '1', file_year: 2026 }];
  const { written, errors } = await upsertRows(rows, { domainQuery: failing });
  assert.equal(written, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /failed:500/);
});

test('the loader batches at UPSERT_BATCH_SIZE so one PostgREST call cannot silently truncate a huge export', async () => {
  const calls = [];
  const rows = Array.from({ length: 1200 }, (_, i) => ({ acct: String(i), file_year: 2026 }));
  const { written } = await upsertRows(rows, { domainQuery: stubDomainQuery(calls) });
  assert.equal(written, 1200);
  // 500-row batches -> 3 calls for 1200 rows.
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.length, 500);
  assert.equal(calls[2].body.length, 200);
});
