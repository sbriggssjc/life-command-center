// AC10 — "an exclusion needs a counterpart that promotes"
// (docs/architecture/account-based-contact-intelligence.md §5a / §7b).
//
// v_owner_contact_worklist correctly excludes any valued owner already
// carrying a linked person (via entity_relationships), and nothing ever wrote
// that person into owner_contact_pivot.active_contact_entity_id. This pins
// the shape of the fix: the candidate view ranking rule, the writer
// fill-blanks discipline, the ledger-before-write ordering, the reversal
// "never clobber a later legitimate write" guard, the SECURITY DEFINER
// privilege stanza, and the forward-running cron.
//
// MEASURED LIVE (xengecqvemvfknjvbvrq, 2026-09-10):
//   suppressed-and-invisible population before the fix: 251 owners / $329,379,804.64
//     (14 with no pivot row at all, 237 with a pivot row missing active_contact)
//   after building + running for real (batch ac10_20260910_real):
//     249 owners promoted (14 created_pivot, 235 filled_active_contact);
//     v_lcc_ac10_promote_candidates: 251 -> 0
//     (2 of the 251 carry no candidate that survives the junk/brokerage guards
//      and are therefore correctly left unpromoted rather than guessed at)
//   reversibility proven live in a ROLLED-BACK transaction: unpromoting the
//   whole batch restored the candidate view to 249, then rolled back — the
//   249 real promotions stand.
//
// Anchored on the migration own function/view bodies, comment-stripped
// first (the migration header explains the fix by quoting several of the
// exact tokens these tests check for, so a raw-source grep would find the
// header PROSE and pass over a reverted fix — the A1/A5c/N18/B1 doctrine).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';
const FILE = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && f.includes('ac10_promote_linked_owner_contacts'))
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'))
  .join('\n');

const SQL = FILE.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the AC10 migration exists', () => {
  assert.ok(FILE.length > 0, 'AC10 migration not found');
});

/** Slice a named objects body up to (not including) the next top-level
 * CREATE OR REPLACE / DO $...$ — a stable structural boundary. */
function objBody(marker) {
  const start = SQL.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found`);
  const rest = SQL.slice(start + 1);
  const next = rest.search(/\n(CREATE OR REPLACE|DO \$)/);
  return next === -1 ? rest : rest.slice(0, next);
}

test('the candidate view mirrors the worklist own linked_person definition', () => {
  const v = objBody('CREATE OR REPLACE VIEW public.v_lcc_ac10_promote_candidates');
  assert.match(v, /current_annual_rent_total > 0/, 'must reuse the value gate (rent > 0)');
  assert.match(v, /lcc_is_operator_owner_name\(e\.name\)/, 'must reuse the operator exclusion');
  assert.match(v, /junk_name_flagged/, 'must reuse the junk-name exclusion');
  assert.match(v, /relationship_type IN \('associated_with', 'contact_at', 'works_at'\)/,
    'must reuse v_owner_contact_worklist exact linked_person relationship types');
  assert.match(v, /pe\.entity_type = 'person'/);
  assert.match(v, /pe\.merged_into_entity_id IS NULL/);
});

test('the candidate view excludes brokers, agents, tenants, operators outright', () => {
  const v = objBody('CREATE OR REPLACE VIEW public.v_lcc_ac10_promote_candidates');
  const whereStart = v.indexOf('WHERE lower');
  const whereEnd = v.indexOf('lcc_is_rejected_contact_name');
  const where = v.slice(whereStart, whereEnd);
  for (const role of ['broker', 'broker_of_record', 'listing_broker', 'purchasing_broker',
    'l_broker', 'p_broker', 'agent', 'tenant', 'operator']) {
    assert.match(where, new RegExp(`'${role}'`),
      `NON_REACHABLE_ROLES mirror is missing '${role}'`);
  }
  assert.match(v, /lcc_is_rejected_contact_name\(pe\.name\)/, 'junk/misparse names must never be promoted');
});

test('the ranking mirrors owner-reachable-via.js pickReachableVia ordering', () => {
  const v = objBody('CREATE OR REPLACE VIEW public.v_lcc_ac10_promote_candidates');
  assert.match(v, /PARTITION BY e\.owner_entity_id/, 'one winner per owner');
  // Role-authority CASE ladder — anchor on the strongest and weakest named
  // roles so the ladder cannot be silently truncated.
  assert.match(v, /WHEN 'decision_maker'\s+THEN 10/);
  assert.match(v, /WHEN 'associated_with'\s+THEN 85/);
  assert.match(v, /ELSE 90/, 'an unlisted role must still be selectable, at the bottom');
  assert.match(v, /relationship_created_at DESC NULLS LAST/, 'recency tiebreak');
  assert.match(v, /person_entity_id ASC/, 'a stable tiebreak, never whatever the query returned first');
});

test('the candidate view only surfaces an owner missing an active pivot contact', () => {
  const v = objBody('CREATE OR REPLACE VIEW public.v_lcc_ac10_promote_candidates');
  assert.match(v, /r\.rn = 1/);
  assert.match(v, /pv\.entity_id IS NULL OR pv\.active_contact_entity_id IS NULL/);
});

test('the writer is dry-run default and re-checks the pivot at write time', () => {
  const fn = objBody('CREATE OR REPLACE FUNCTION public.lcc_promote_linked_owner_contacts(');
  assert.match(fn, /p_dry_run\s+boolean DEFAULT true/, 'dry-run must default to true');
  // Re-read at write time — never trust the candidate scan for a concurrent write.
  assert.match(fn, /SELECT \* INTO v_pivot FROM public\.owner_contact_pivot WHERE entity_id = v_row\.owner_entity_id;/);
  assert.match(fn, /IF v_pivot\.entity_id IS NOT NULL AND v_pivot\.active_contact_entity_id IS NOT NULL THEN\s*\n\s*CONTINUE;/,
    'an owner already filled since the scan must be skipped, not overwritten');
  // Both the ledger write and the pivot write must be gated behind IF NOT p_dry_run.
  const gated = fn.slice(fn.indexOf('IF NOT p_dry_run THEN'), fn.lastIndexOf('END IF;'));
  assert.match(gated, /INSERT INTO public\.lcc_ac10_promote_log/, 'ledger write must be inside the dry-run gate');
  assert.match(gated, /INSERT INTO public\.owner_contact_pivot/, 'pivot INSERT must be inside the dry-run gate');
  assert.match(gated, /UPDATE public\.owner_contact_pivot/, 'pivot UPDATE must be inside the dry-run gate');
  // The ledger is written BEFORE the pivot write (applyTier0Attach ordering).
  const ledgerAt = gated.indexOf('INSERT INTO public.lcc_ac10_promote_log');
  const pivotInsertAt = gated.indexOf('INSERT INTO public.owner_contact_pivot');
  const pivotUpdateAt = gated.indexOf('UPDATE public.owner_contact_pivot');
  assert.ok(ledgerAt < pivotInsertAt && ledgerAt < pivotUpdateAt,
    'the ledger must be written BEFORE the pivot write, not after');
});

test('the pivot UPDATE re-asserts active_contact_entity_id IS NULL', () => {
  const fn = objBody('CREATE OR REPLACE FUNCTION public.lcc_promote_linked_owner_contacts(');
  const upd = fn.slice(fn.indexOf('UPDATE public.owner_contact_pivot'));
  assert.match(upd.slice(0, upd.indexOf(';')), /active_contact_entity_id IS NULL/,
    'the WHERE clause must re-assert the fill-blanks condition at write time, or a race can clobber');
});

test('every write stamps active_source ac10_promote and confidence medium', () => {
  const fn = objBody('CREATE OR REPLACE FUNCTION public.lcc_promote_linked_owner_contacts(');
  const matches = fn.match(/'ac10_promote'/g) || [];
  assert.ok(matches.length >= 2, 'active_source=ac10_promote must appear on both the INSERT and UPDATE paths');
  assert.match(fn, /'medium'/, 'confidence must be medium, matching Tier 0 own automated-attach confidence');
  assert.match(fn, /5,\s*'ac10_promote'/, 'active_authority_level must be 5 (captured), never promoted from role alone');
});

test('the reversal never clobbers a later legitimate write', () => {
  const fn = objBody('CREATE OR REPLACE FUNCTION public.lcc_ac10_unpromote(p_batch_tag text)');
  assert.match(fn, /v_pivot\.active_contact_entity_id IS DISTINCT FROM v_log\.person_entity_id/,
    'must skip if the pivot no longer holds what this batch wrote');
  assert.match(fn, /v_pivot\.active_source IS DISTINCT FROM 'ac10_promote'/,
    'must skip if the pivot source has changed since');
  assert.match(fn, /v_skipped := v_skipped \+ 1;\s*\n\s*CONTINUE;/, 'a mismatched row must be skipped, not forced');
  assert.match(fn, /IF v_log\.action = 'created_pivot' THEN\s*\n\s*DELETE FROM public\.owner_contact_pivot/,
    'a created pivot reverses by DELETE');
  assert.match(fn, /UPDATE public\.owner_contact_pivot[\s\S]*?prior_active_contact_entity_id/,
    'a filled pivot reverses by restoring the prior_* columns');
});

test('both SECURITY DEFINER functions carry the revoke and has_function_privilege stanza', () => {
  for (const fname of [
    'public.lcc_promote_linked_owner_contacts(boolean, int, text)',
    'public.lcc_ac10_unpromote(text)',
  ]) {
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION ${fname.replace(/[().]/g, '\\$&')} FROM PUBLIC`),
      `${fname} missing REVOKE ... FROM PUBLIC`);
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION ${fname.replace(/[().]/g, '\\$&')} FROM anon, authenticated`),
      `${fname} missing REVOKE ... FROM anon, authenticated`);
  }
  const anonChecks = (SQL.match(/has_function_privilege\('anon'/g) || []).length;
  const authChecks = (SQL.match(/has_function_privilege\('authenticated'/g) || []).length;
  assert.ok(anonChecks >= 2 && authChecks >= 2,
    'each SECURITY DEFINER function needs its own has_function_privilege assertion for anon and authenticated');
});

test('a forward-running daily cron is scheduled, not a one-shot backfill', () => {
  assert.match(SQL, /cron\.schedule\(\s*'lcc-ac10-promote-linked-contacts',\s*'12 6 \* \* \*'/,
    'must schedule the daily 06:12 UTC cron');
  assert.match(SQL, /SELECT public\.lcc_promote_linked_owner_contacts\(false, 500, NULL\);/,
    'the cron must run a real (non-dry-run) pass');
  assert.match(SQL, /PERFORM cron\.unschedule\('lcc-ac10-promote-linked-contacts'\)/,
    'the schedule must be idempotently re-registered (unschedule-then-schedule)');
});

test('the ledger table is locked down from anon and authenticated', () => {
  assert.match(SQL, /REVOKE ALL ON TABLE public\.lcc_ac10_promote_log FROM PUBLIC, anon, authenticated/);
});
