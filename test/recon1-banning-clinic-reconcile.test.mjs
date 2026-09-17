// RECON1 — DaVita Banning clinic reconciliation migration shape guard.
//
// This pins the STRUCTURAL invariants of
// supabase/migrations/dialysis/20260917180000_dia_recon1_banning_clinic_reconcile.sql
// that the doctrine in CLAUDE.md requires and that this specific fix depends on:
//
//  1. The property fold goes through dia_merge_property_reversible — never a
//     raw DELETE FROM properties. A raw delete on a duplicate-address shell
//     would destroy the merge log / backup / unmerge path this repo's entity
//     and property merge machinery depends on everywhere else.
//  2. Buyer/seller are never silently left NULL nor guessed — the migration
//     stamps an explicit "not on file" sentinel and opens a pending_updates
//     research task, matching "never fabricate, never guess" (CLAUDE.md).
//  3. The reconciliation function is dry-run-default (p_dry_run default true)
//     so a bare `select dia_recon1_reconcile_banning_clinic()` can never write.
//  4. The listing-status vocabulary used matches this DB's live CHECK
//     constraints (status IN ('active','sold','superseded','under_contract',
//     'withdrawn','off_market','orphan'); off_market_reason IN ('sold',
//     'expired','withdrawn','unverified_assumed_off','duplicate','other',
//     'stale_unverified','withdrawn_inferred_stale')) — a naive
//     'superseded_by_sale' value (which does NOT exist in this DB) would 23514
//     at write time, which is exactly what happened on the first apply attempt
//     of this migration and is the regression this guard exists to prevent.
//  5. Every write path is guarded by a "did this already happen" check before
//     it runs (idempotent) — re-running the function after a successful apply
//     must be a no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations/dialysis';
const FILE = readdirSync(MIGRATIONS_DIR).find((f) =>
  f.endsWith('.sql') && f.includes('dia_recon1_banning_clinic_reconcile')
);

const stripComments = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const RAW = FILE ? readFileSync(`${MIGRATIONS_DIR}/${FILE}`, 'utf8') : '';
const SQL = stripComments(RAW);

test('RECON1 migration file exists', () => {
  assert.ok(FILE, 'expected a supabase/migrations/dialysis/*dia_recon1_banning_clinic_reconcile*.sql file');
});

test('property fold uses dia_merge_property_reversible, never a raw DELETE FROM properties', () => {
  assert.match(SQL, /dia_merge_property_reversible\s*\(/);
  // A raw destructive delete on the shell rows would defeat the whole
  // reversibility contract this migration depends on.
  assert.doesNotMatch(SQL, /delete\s+from\s+properties\b/i);
});

test('unmerge path is documented in the reversal runbook', () => {
  assert.match(RAW, /dia_unmerge_property\s*\(/);
});

test('buyer/seller are never silently left null nor guessed - an explicit sentinel is stamped', () => {
  assert.match(SQL, /Not on file \(pending deed\)/);
  // The sentinel write must be guarded on BOTH fields still being NULL
  // (fill-blanks only, never overwrite a real value someone already entered).
  assert.match(SQL, /buyer_name'\)\s+is\s+null[\s\S]{0,80}seller_name'\)\s+is\s+null/);
});

test('an explicit research task is opened when buyer/seller are unknown, not a silent gap', () => {
  assert.match(SQL, /insert into pending_updates/);
  assert.match(SQL, /research_needed/);
});

test('the reconciliation function is dry-run-default', () => {
  assert.match(SQL, /p_dry_run\s+boolean\s+default\s+true/);
});

test('the listing status/off_market_reason vocabulary matches this DB live CHECK constraints', () => {
  // Must use 'superseded' (a real value in chk_dia_listing_status_vocab), never
  // an invented 'superseded_by_sale' which does not exist in this database and
  // 23514s at write time.
  assert.doesNotMatch(SQL, /'superseded_by_sale'/);
  assert.match(SQL, /status\s*=\s*'superseded'/);
  assert.match(SQL, /off_market_reason\s*=\s*'sold'/);
  assert.match(SQL, /status\s*=\s*'withdrawn'/);
});

test('every write step checks prior state before writing (idempotent)', () => {
  // Each of the four value-fixing steps (false-sold listing, expired lease,
  // attribution, not-on-file) guards on the prior value in an `if` before the
  // corresponding UPDATE runs.
  const guardedSteps = [
    /if\s+v_prior\s+is\s+not\s+null\s+and\s+\(v_prior->>'status'\)\s*=\s*'sold'/,
    /if\s+v_prior\s+is\s+not\s+null\s+and\s+\(v_prior->>'is_active'\)::boolean\s*=\s*true/,
    /if\s+v_prior\s+is\s+not\s+null\s+and\s+\(v_prior->>'listing_broker_id'\)\s+is\s+null/,
  ];
  for (const re of guardedSteps) {
    assert.match(SQL, re, `expected a guard matching ${re}`);
  }
});

test('the lease-active-past-expiration guard is a standing trigger, not a one-time UPDATE', () => {
  assert.match(SQL, /create\s+trigger\s+trg_dia_recon1_lease_active_guard/i);
  assert.match(SQL, /before\s+insert\s+or\s+update\s+of\s+is_active,\s*lease_expiration,\s*status\s+on\s+leases/i);
  // The holdover escape hatch must survive: a real month-to-month tenancy past
  // firm term is a fact, not a data error, and must never be silently flipped.
  assert.match(SQL, /status\s+is\s+distinct\s+from\s+'holdover'/);
});

test('every write is logged to dia_recon1_run_log with a prior_value for manual reversal', () => {
  assert.match(SQL, /create table if not exists dia_recon1_run_log/);
  assert.match(SQL, /prior_value\s+jsonb/);
  assert.match(SQL, /backup_id\s+bigint/);
});

// Positive control: prove the vocabulary assertion actually catches the
// regression it exists to catch, rather than passing vacuously.
test('positive control: the vocabulary guard would fail on the pre-fix invented status value', () => {
  const regressed = SQL.replace(/status\s*=\s*'superseded'/g, "status = 'superseded_by_sale'");
  assert.throws(() => assert.doesNotMatch(regressed, /'superseded_by_sale'/));
});
