// RECON2-c — evidence-rule + confirm-with-successor migration shape guard.
//
// This is a STATIC shape guard over
// supabase/migrations/dialysis/20260918130000_dia_recon2c_lease_evidence_rules_and_confirmations.sql
// — the sandbox this migration was authored in has no Supabase MCP / live DB
// access, so there is no live query to assert against (unlike a normal
// behavioural test). It pins the structural invariants the task and
// docs/architecture/reconcile-property-spec.md R5 require:
//
//  1. demoted_duplicate medicare_clinics rows are never joined as evidence
//     (on the lease's own property OR a twin).
//  2. cms_closure requires an operator match (dia_resolve_operator) between
//     the clinic and the lease's tenant, not just a status value.
//  3. twin evidence (R1 twins) proposes expired_unconfirmed, never confirmed.
//  4. a conflict flag exists and is computed both at classify time (twin vs
//     same-property signal) and at evidence-record time (positive vs
//     negative observation in the array).
//  5. expiration_evidence is an ARRAY now, with a closed source vocabulary,
//     and legacy scalar rows are wrapped, never discarded.
//  6. the confirm function APPENDS evidence, never replaces the column.
//  7. every confirm-with-successor lease inserts the successor BEFORE
//     confirming the old row, and never guesses a lease_expiration.
//  8. lease 23273 (Sierra Vista) gets NO is_active/expiration_state write —
//     evidence only.
//  9. every write is idempotent (guarded on current state before writing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations/dialysis';
const FILE = readdirSync(MIGRATIONS_DIR).find(
  (f) => f.endsWith('.sql') && f.includes('dia_recon2c_lease_evidence_rules_and_confirmations')
);

const stripComments = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const RAW = FILE ? readFileSync(`${MIGRATIONS_DIR}/${FILE}`, 'utf8') : '';
const SQL = stripComments(RAW);

test('RECON2-c migration file exists', () => {
  assert.ok(FILE, 'expected a supabase/migrations/dialysis/*dia_recon2c_lease_evidence_rules_and_confirmations*.sql file');
});

test('(a) demoted_duplicate clinic rows are excluded from clinic evidence, own-property and twin', () => {
  const matches = SQL.match(/dedup_status[\s\S]{0,40}is distinct from 'demoted_duplicate'/g) || [];
  // Must appear at least twice: once for the lease's own-property clinic_rows
  // CTE, once for the twin_operating CTE. One occurrence would mean the twin
  // path is unguarded and the Sierra Vista defect (a demoted-duplicate row on
  // 22471) could still leak into a *twin's* evidence undetected.
  assert.ok(matches.length >= 2, `expected >=2 dedup_status exclusions (own property + twin), found ${matches.length}`);
});

test('(b) cms_closure requires an operator match via dia_resolve_operator, not status alone', () => {
  assert.match(SQL, /dia_resolve_operator\s*\(\s*mc\.chain_organization\s*\)/);
  assert.match(SQL, /dia_resolve_operator\s*\(\s*c\.tenant\s*\)/);
  assert.match(SQL, /mc_operator_id\s*=\s*(?:\w+\.)?tenant_operator_id/);
});

test('(c) twin evidence never proposes expired_confirmed', () => {
  // The twin branch of the proposed_state CASE must resolve to
  // 'expired_unconfirmed', and nowhere does 'twin' co-occur with
  // 'expired_confirmed' in a way that would let a twin-only signal confirm.
  const caseBlockMatch = SQL.match(/case[\s\S]*?end as proposed_state/i);
  assert.ok(caseBlockMatch, 'expected a proposed_state CASE expression');
  const block = caseBlockMatch[0];
  const twinLine = block.match(/when\s+twn\.twin_property_id\s+is\s+not\s+null\s+then\s+'([a-z_]+)'/i);
  assert.ok(twinLine, 'expected a WHEN branch keyed on twn.twin_property_id');
  assert.equal(twinLine[1], 'expired_unconfirmed');
});

test('twin lookup reuses dia_normalize_address rather than reinventing normalization', () => {
  assert.match(SQL, /dia_recon2_street_twin_key/);
  assert.match(SQL, /dia_normalize_address\s*\(\s*addr\s*\)/);
});

test('(d) a conflict flag is computed and returned by the classifier', () => {
  assert.match(SQL, /conflict\s+boolean/);
  assert.match(SQL, /as conflict/);
  assert.match(SQL, /dia_recon2_evidence_array_conflicts/);
});

test('evidence-array conflict heuristic checks for BOTH a positive and a negative observation', () => {
  assert.match(SQL, /active\|operating\|current\|open/);
  assert.match(SQL, /closed\|terminat\|vacat\|relocat\|expired\|removed/);
});

test('expiration_evidence source vocabulary is closed to the six named sources', () => {
  assert.match(
    SQL,
    /costar_lease','operator_locator','google_hours','cms','deed','sale_om/
  );
  assert.match(SQL, /raise exception[\s\S]{0,120}invalid source/i);
});

test('legacy scalar expiration_evidence rows are wrapped into arrays, never discarded', () => {
  assert.match(SQL, /jsonb_build_array\(expiration_evidence\)/);
  assert.match(SQL, /jsonb_typeof\(expiration_evidence\)\s+is distinct from 'array'/);
});

test('confirm function APPENDS to expiration_evidence, never replaces the whole column', () => {
  // Find the confirm-function body and check it concatenates (||) onto an
  // existing array rather than assigning a bare jsonb_build_object().
  const fnMatch = SQL.match(/create or replace function dia_recon2_confirm_lease_expired[\s\S]*?\$\$;/);
  assert.ok(fnMatch, 'expected dia_recon2_confirm_lease_expired function body');
  const body = fnMatch[0];
  assert.match(body, /v_array\s*:=\s*v_array\s*\|\|\s*jsonb_build_array\(v_entry\)/);
  assert.doesNotMatch(body, /set\s+expiration_evidence\s*=\s*jsonb_build_object\(/i);
});

test('every confirm-with-successor lease inserts the successor lease BEFORE confirming the old row', () => {
  for (const leaseId of [23259, 12599, 12678, 13058]) {
    const blockRe = new RegExp(
      `v_old_lease_id\\s*integer\\s*:=\\s*${leaseId}[\\s\\S]*?end \\$\\$;`
    );
    const block = SQL.match(blockRe);
    assert.ok(block, `expected a DO block for lease ${leaseId}`);
    const insertIdx = block[0].indexOf('insert into leases');
    const confirmIdx = block[0].indexOf('dia_recon2_confirm_lease_expired');
    assert.ok(insertIdx >= 0, `lease ${leaseId}: expected an INSERT INTO leases (the successor)`);
    assert.ok(confirmIdx >= 0, `lease ${leaseId}: expected a dia_recon2_confirm_lease_expired call`);
    assert.ok(insertIdx < confirmIdx, `lease ${leaseId}: successor insert must precede the confirm call`);
  }
});

test('successor lease_expiration is never guessed — 2028-06-30 only for Orlando (12599), NULL for the other three', () => {
  const orlandoBlock = SQL.match(/v_old_lease_id\s*integer\s*:=\s*12599[\s\S]*?end \$\$;/);
  assert.ok(orlandoBlock, 'expected Orlando (12599) DO block');
  assert.match(orlandoBlock[0], /date\s+'2028-06-30'/);

  for (const leaseId of [23259, 12678, 13058]) {
    const blockRe = new RegExp(`v_old_lease_id\\s*integer\\s*:=\\s*${leaseId}[\\s\\S]*?end \\$\\$;`);
    const block = SQL.match(blockRe);
    assert.ok(block, `expected a DO block for lease ${leaseId}`);
    assert.doesNotMatch(block[0], /date\s+'20\d\d-\d\d-\d\d'/, `lease ${leaseId}: no date literal should be inserted as lease_expiration — only 12599 has a CoStar date`);
  }
});

test('lease 23273 (Sierra Vista) gets NO confirm call anywhere in the migration', () => {
  // Evidence-recording calls for 23273 are fine and expected; a confirm call
  // naming lease_id 23273 is not.
  assert.doesNotMatch(SQL, /dia_recon2_confirm_lease_expired\(\s*\n?\s*23273\b/);
});

test('Scott field-check evidence rows are recorded for all seven leases, recorded_by scott, dated 2026-09-18', () => {
  for (const leaseId of [23273, 23506, 23259, 6912, 12599, 12678, 13058]) {
    const re = new RegExp(`dia_recon2_record_evidence\\(${leaseId},`);
    assert.match(SQL, re, `expected at least one dia_recon2_record_evidence call for lease ${leaseId}`);
  }
  assert.match(SQL, /'scott'/);
  assert.match(SQL, /date '2026-09-18'/);
});

test('every field-check evidence write is idempotency-guarded (not exists check before the call)', () => {
  const calls = (SQL.match(/perform dia_recon2_record_evidence\(/g) || []).length;
  const guards = (SQL.match(/if not exists \(select 1 from leases, jsonb_array_elements/g) || []).length;
  assert.ok(calls > 0, 'expected at least one dia_recon2_record_evidence call');
  assert.equal(guards, calls, `every record_evidence call must be preceded by a not-exists idempotency guard (${guards} guards vs ${calls} calls)`);
});

test('every confirm call is guarded on current expiration_state (idempotent re-run)', () => {
  const confirmGuards = (SQL.match(/\bv_(?:state|old\.expiration_state)\s+is\s+distinct\s+from\s+'expired_confirmed'/g) || []).length;
  // 23506 + 6912 + the four confirm-with-successor leases = 6 guarded confirms.
  assert.ok(confirmGuards >= 6, `expected >=6 idempotency guards on confirm calls, found ${confirmGuards}`);
});

test('successor-lease insert failure aborts the whole pair (do block, no exception swallowed)', () => {
  for (const leaseId of [23259, 12599, 12678, 13058]) {
    const blockRe = new RegExp(`v_old_lease_id\\s*integer\\s*:=\\s*${leaseId}[\\s\\S]*?end \\$\\$;`);
    const block = SQL.match(blockRe);
    assert.ok(block, `expected a DO block for lease ${leaseId}`);
    // No "exception when others" inside these pair blocks — an insert
    // failure must propagate and roll back the whole DO block, never be
    // swallowed and leave a dangling confirm.
    assert.doesNotMatch(block[0], /exception\s+when\s+others/i);
  }
});

test('reversal runbook documents both the confirm-path and the successor-lease undo', () => {
  assert.match(RAW, /REVERSAL RUNBOOK/);
  assert.match(RAW, /parent_lease_id in \(23259,12599,12678,13058\)/);
  assert.match(RAW, /data_source = 'costar_field_check'/);
});
