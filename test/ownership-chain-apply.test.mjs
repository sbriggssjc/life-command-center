// A2 — apply the `agrees` ownership chains into lcc_entity_portfolio_facts.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// The applier is SQL (everything it needs is already in LCC Opps, and a
// migration ships instantly while the JS that reads it does not). So the
// invariants worth a guard are properties of the migration's SQL and of the
// vocabulary the JS module and the SQL must agree on.
//
// Every assertion anchors on an IDENTIFIER — a view name, a column name, a
// function name, a quoted enum value — never on a line number and never on a
// region sliced between banner comments. That block-slice shape has produced
// three false failures in this repo (P126 / P128 / P129) and each time the red
// test was stale while the code was correct.
//
// Comment lines are stripped before matching: this migration's header
// deliberately quotes the things the code must NOT do (`lcc_owner_strict_core`,
// `reason ilike`) in order to explain why, and matching those would be a false
// positive of exactly the kind the header warns about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  A2_ACTION, A2_APPLY_FN, A2_UNAPPLY_FN, A2_PLAN_VIEW, A2_OWNER_START_VIEW,
  A2_CONFLICT_VIEW, A2_BLOCKED_VIEW, A2_RUN_HEALTH_VIEW, A2_LEDGER_TABLE,
  A2_LANE_SPLIT_VIEW, A2_OWNERSHIP_SOURCE_PREFIX, A2_PROVENANCE_SOURCE,
  A2_BLOCKED_REASONS, A2_DISPOSITIONS, A2_THROUGHPUT_KEYS, A2_REDISCOVERY_KEY,
  A2_OUTCOME_SOURCE, A2_OUTCOME_REASON,
  a2AgreesPath, a2BlockedPath, a2ConflictPath, fetchA2RunHealth,
} from '../api/_shared/ownership-chain-apply.js';
import { OWNERSHIP_LANE_ACTIONS, OWNERSHIP_LANE_SPLIT_VIEW }
  from '../api/_shared/ownership-lane-split.js';

const MIGRATION = readdirSync('supabase/migrations')
  .filter((f) => f.includes('a2_apply_ownership_chains'))
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');

// Executable SQL only. Three kinds of prose in this file legitimately NAME the
// things the code must not do, in order to explain why:
//   * `--` comment lines (the header),
//   * `comment on ... is '...'` documentation,
//   * long string literals (the field_source_priority / feature_flags notes).
// Matching any of them would be a false positive of exactly the kind the
// block-slice footgun produces. Short quoted literals are KEPT: they are the
// vocabulary these tests pin.
const SQL = MIGRATION
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  // A SQL string literal escapes a quote by DOUBLING it, so a naive /'[^']*'/
  // mis-pairs across `domain''s` and eats the rest of the file. Match the real
  // grammar instead, and blank only the LONG ones (prose); short literals are
  // the vocabulary these tests pin.
  .replace(/'(?:[^']|'')*'/g, (lit) => (lit.length >= 80 ? "''" : lit))
  .replace(/^\s*comment on [\s\S]*?;\s*$/gim, '');

test('the A2 migration exists and defines the applier and its reversal', () => {
  assert.ok(MIGRATION.length > 0, 'A2 migration not found in supabase/migrations');
  assert.match(SQL, new RegExp(`create or replace function ${A2_APPLY_FN}\\b`, 'i'));
  assert.match(SQL, new RegExp(`create or replace function ${A2_UNAPPLY_FN}\\b`, 'i'));
  for (const v of [A2_PLAN_VIEW, A2_OWNER_START_VIEW, A2_CONFLICT_VIEW,
                   A2_BLOCKED_VIEW, A2_RUN_HEALTH_VIEW]) {
    assert.match(SQL, new RegExp(`create (or replace )?view ${v}\\b`, 'i'), `${v} not created`);
  }
});

// ── The bucket is READ from A1's view, never re-derived ──────────────────────

test('A2 consumes exactly one A1 action, and it is one A1 actually emits', () => {
  assert.equal(A2_ACTION, 'agrees');
  assert.ok(OWNERSHIP_LANE_ACTIONS.includes(A2_ACTION),
    'A2_ACTION must be a member of the A1 vocabulary — if A1 renames its actions, '
    + 'A2 would silently filter to nothing rather than fail');
  assert.equal(A2_LANE_SPLIT_VIEW, OWNERSHIP_LANE_SPLIT_VIEW);
});

test('the plan selects action = agrees FROM the split view', () => {
  assert.match(SQL, new RegExp(`from\\s+${A2_LANE_SPLIT_VIEW}\\b`, 'i'),
    'the plan must read A1\'s split view');
  assert.match(SQL, /action\s*=\s*'agrees'/i,
    "the bucket must be the view's `action` column, matched to 'agrees'");
});

test('the plan NEVER re-derives the classification', () => {
  // Re-testing the boolean here would be a second classifier that can drift
  // from A1's (P134: a re-derived GROUP BY returned 150 members for a group of 2).
  assert.doesNotMatch(SQL, /terminates_at_current_owner/i,
    'A2 must not re-test terminates_at_current_owner — it reads action');
  assert.doesNotMatch(SQL, /insufficient_reason/i,
    'A2 must not re-read insufficient_reason — it reads action');
  // And it must never classify from the drafter's generated prose (P182).
  assert.doesNotMatch(SQL, /reason\s+i?like/i, 'no prose classifier');
});

// ── Identity ────────────────────────────────────────────────────────────────

test('the identity comparator is lower()-then-strip, and it is the only one', () => {
  assert.match(SQL, /create or replace function lcc_ownership_chain_name_key/i);
  // lower() BEFORE the character-class strip. The reverse deletes every capital
  // letter, which shipped a 32.6% finding that was really 0.8%.
  assert.match(SQL, /regexp_replace\(\s*lower\(/i,
    'lower() must be applied BEFORE the [^a-z0-9] strip');
  assert.doesNotMatch(SQL, /\[\^a-z0-9\][^)]*\)\s*\)?\s*,?\s*'i'/i,
    'the strip must not rely on a case-insensitive flag instead of lower()');
});

test('the banned-for-identity normalizers are never used to resolve a party', () => {
  // Both strip meaning-bearing tokens; lcc_owner_strict_core additionally drops
  // 1-char tokens and sorts, which collapses BAMMF (8) LLC onto BAMMF (3) LLC.
  assert.doesNotMatch(SQL, /lcc_normalize_entity_name/i);
  assert.doesNotMatch(SQL, /lcc_owner_strict_core/i);
  assert.doesNotMatch(SQL, /nameSimilarity|ownerCore/);
});

test('resolution is unambiguous-only and resolves through the survivor', () => {
  assert.match(SQL, /n_entities\s*=\s*1/, 'exactly one live entity may carry the key');
  assert.match(SQL, /n_entities\s*>\s*1/, 'two or more must be blocked, not picked from');
  // Existence is not liveness (P175): a tombstone still exists.
  assert.match(SQL, /lcc_entity_survivor\(/i);
  assert.match(SQL, /merged_into_entity_id\s+is\s+null/i);
});

// ── What a fact may claim ───────────────────────────────────────────────────

test('every written fact carries an end date — is_current can never be true', () => {
  // is_current is GENERATED ALWAYS as (ownership_end_date IS NULL). A fact with
  // no end date would read as a CURRENT owner on every ranked surface.
  // Anchored between two stable identifiers — the guard and the alias of the
  // CASE it must live in — because `'undated_link'` also appears in the
  // owner-start plan, where it guards a different write. A bare match on the
  // literal passes while the historical-fact guard is gone (verified).
  assert.match(SQL, /transfer_date\s+is\s+null\s+then\s+'undated_link'(?:(?!end as)[\s\S])*?end\s+as\s+resolution0/i,
    'an undated link must be blocked in the PLAN grading, so proposed_end_date '
    + 'is never null on an insert (is_current would then read true)');
  assert.match(SQL, /ownership_end_date/, 'the insert must set ownership_end_date');
  assert.match(SQL, /p\.proposed_end_date/,
    'the end date must come from the link, not be defaulted');
});

test('a chain gap leaves the start date NULL — never bridged', () => {
  assert.match(SQL, /gap_before\s+then\s+null/i,
    'at a gap the start date must be NULL, never the previous link\'s date');
});

test('writes are fill-blanks and conflicts are surfaced, never resolved', () => {
  assert.match(SQL, /ownership_start_date\s+is\s+null/i, 'start fills are blank-only');
  for (const c of ['conflict_reads_current', 'conflict_end_date_differs']) {
    assert.match(SQL, new RegExp(`'${c}'`), `${c} must be its own disposition`);
  }
  assert.match(SQL, new RegExp(`create (or replace )?view ${A2_CONFLICT_VIEW}`, 'i'));
  // Nothing may delete or re-date a contradicting fact (the P175a mistake).
  assert.doesNotMatch(SQL, /delete\s+from\s+lcc_entity_portfolio_facts\s+f?\s*\n?\s*using\s+_a2/i,
    'the applier must never delete a portfolio fact');
});

// ── Completing the task IS the deliverable ──────────────────────────────────

test('the applier completes tasks, and only when every link is terminal-good', () => {
  assert.match(SQL, /status\s*=\s*'completed'/i, 'A2 must complete the task');
  assert.match(SQL, /bool_and\(disposition in \('insert','already_present','fill_start_date'\)\)/i,
    'a task with a blocked or conflicted link must stay open — completing it '
    + 'without a fact would simply be re-seeded by the nightly seeder');
  assert.match(SQL, new RegExp(`'${A2_OUTCOME_SOURCE}'`));
  assert.match(SQL, new RegExp(`'${A2_OUTCOME_REASON}'`));
  assert.match(SQL, /citation_ownership_ids/, 'the outcome must name what was applied');
});

test('the schedule runs AFTER the seeder and the drafter', () => {
  assert.match(SQL, /cron\.schedule\('lcc-a2-ownership-chain-apply'/i);
  const m = SQL.match(/cron\.schedule\('lcc-a2-ownership-chain-apply',\s*'(\d+)\s+(\d+)/i);
  assert.ok(m, 'the cron schedule must be parseable');
  const minute = Number(m[1]); const hour = Number(m[2]);
  // seeder 05:10, drafter 06:45. A row seeded tonight must be drafted and
  // applied tonight, so this has to land after both.
  assert.ok(hour * 60 + minute > 6 * 60 + 45,
    `A2 must run after the 06:45 drafter, got ${hour}:${minute}`);
});

// ── Reversibility ───────────────────────────────────────────────────────────

test('every write is reversible through the ledger, by batch tag', () => {
  assert.match(SQL, new RegExp(`create table if not exists ${A2_LEDGER_TABLE}`, 'i'));
  assert.match(SQL, /prior_ownership_start_date/,
    'a fill-blank is only reversible if the ledger records the prior value');
  assert.match(SQL, /prior_task_status/);
  assert.match(SQL, /batch_tag\s*=\s*p_batch/i, 'the reversal keys on the batch tag');
  assert.match(SQL, new RegExp(`'${A2_OWNERSHIP_SOURCE_PREFIX}'`),
    'the ownership_source prefix guards the reversal against another writer');
});

// ── Honest counts ───────────────────────────────────────────────────────────

test('the run row separates throughput from re-discovery', () => {
  for (const k of A2_THROUGHPUT_KEYS) assert.match(SQL, new RegExp(`\\b${k}\\b`));
  assert.match(SQL, new RegExp(`\\b${A2_REDISCOVERY_KEY}\\b`));
  // facts_inserted must come from the INSERT's own RETURNING set. Counting the
  // ledger insert instead over-reports whenever the join fans out — which is
  // exactly what the first live apply did: 365 reported, 347 written.
  assert.match(SQL, /select \(select count\(\*\) from ins\) into v_ins/i,
    'facts_inserted must be the real insert count, not a ledger row count');
});

// ── JS/SQL vocabulary agreement ─────────────────────────────────────────────

test('every blocked reason and disposition the JS knows exists in the SQL', () => {
  for (const r of A2_BLOCKED_REASONS) {
    assert.match(SQL, new RegExp(`'${r}'`), `blocked reason ${r} is not in the SQL`);
  }
  for (const d of A2_DISPOSITIONS) {
    assert.match(SQL, new RegExp(`'${d}'`), `disposition ${d} is not in the SQL`);
  }
});

test('and the SQL emits no vocabulary the JS does not know', () => {
  // The reverse direction, so a stale list fails too rather than rotting into a
  // lie. Collects every snake_case literal the SQL assigns via `then '...'` and
  // requires it to be a known term.
  const KNOWN = new Set([
    ...A2_BLOCKED_REASONS, ...A2_DISPOSITIONS,
    'resolved', 'blocked',
    // owner-start plan dispositions
    'fill', 'already_matches', 'stale_current_owner', 'no_current_owner_row', 'no_current_fact',
    // domain normalisation
    'dia', 'gov',
  ]);
  const emitted = [...SQL.matchAll(/\bthen\s+'([a-z][a-z0-9_]{2,})'/gi)].map((m) => m[1]);
  assert.ok(emitted.length > 5, 'expected the CASE vocabulary to be found at all');
  const unknown = [...new Set(emitted)].filter((v) => !KNOWN.has(v));
  assert.deepEqual(unknown, [],
    `the SQL emits vocabulary the JS module does not carry: ${unknown.join(', ')}`);
});

// ── Pure JS ─────────────────────────────────────────────────────────────────

test('a2AgreesPath filters on the action column of the split view', () => {
  const p = a2AgreesPath({ limit: 25 });
  assert.ok(p.startsWith(`${A2_LANE_SPLIT_VIEW}?`));
  assert.match(p, /&action=eq\.agrees(&|$)/);
  assert.match(p, /order=priority\.asc,created_at\.asc/);
  assert.match(p, /limit=25/);
});

test('a2BlockedPath refuses an unknown reason rather than serving everything', () => {
  assert.equal(a2BlockedPath({ reason: 'not_a_reason' }), null);
  const p = a2BlockedPath({ reason: 'ambiguous_entity' });
  assert.match(p, /blocked_reason=eq\.ambiguous_entity/);
  assert.match(p, /owner_annual_rent\.desc\.nullslast/);
  // No reason = the whole residue, still value-ranked.
  assert.match(a2BlockedPath({}), /owner_annual_rent\.desc\.nullslast/);
});

test('a2ConflictPath can scope to one side of the conflict view', () => {
  assert.match(a2ConflictPath({ scope: 'current_owner' }), /scope=eq\.current_owner/);
  assert.ok(a2ConflictPath({}).startsWith(`${A2_CONFLICT_VIEW}?`));
});

test('fetchA2RunHealth surfaces the DB message instead of swallowing it', async () => {
  const bad = await fetchA2RunHealth(async () => ({ ok: false, status: 400, data: { message: 'boom' } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'boom');
  const good = await fetchA2RunHealth(async () => ({ ok: true, data: [{ run_id: 1, facts_inserted: 322 }] }));
  assert.equal(good.ok, true);
  assert.equal(good.runs[0].facts_inserted, 322);
});
