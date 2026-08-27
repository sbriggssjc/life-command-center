// A4b — the P138 clean predicate rejected any SPE named after a street number.
//
// WHAT THIS PINS, AND WHY.
//
// The predicate itself is gov-side SQL (government-lease
// sql/20260827_gov_a4b_transition_clean_legal_form_gate.sql, with its own
// structural test). What lives HERE is the half that decides whether the
// correction is ever SEEN, and the invariant that keeps the two from drifting:
//
//  1. A CORRECTED GUARD IS INVISIBLE WITHOUT A RE-DRAFT. `fresh` excludes any
//     task that already carries a proposal, and all 18 `all_guarded` tasks carry
//     a stale `all_transitions_guarded` draft. Fix the view, change nothing on
//     any surface — the predicate is right and the lane never drains. The pass
//     must therefore run BEFORE the existing-draft read, or it supersedes drafts
//     that this run can no longer replace and the tasks sit draftless for a
//     night. This is the A4 stale-draft trap from the other direction.
//
//  2. THE PASS MUST BE KEYED ON STATE, NOT ON "A4b SHIPPED". A one-shot
//     supersede is a chore repeated silently the next time a guard moves
//     (P176 / Dead-End playbook Class 8).
//
//  3. NO JS MIRROR OF THE SQL NAME COMPARISON. `is_name_variant` is now more
//     than a strict prefix. A second copy of that rule in JS is the normalizer
//     drift this repo has paid for repeatedly (lcc_normalize_entity_name,
//     the P134 re-derived GROUP BY that returned 150 members for a 2-member
//     group). The planner must READ the flag, never recompute it.
//
//  4. THE PHANTOM THE CORRECTION WOULD OTHERWISE WRITE. Admitting street-
//     numbered names without widening is_name_variant makes
//     `10835 CAMARILLO STREET APARTMENTS LLC -> 10835 CAMARILLO APARTMENTS LLC`
//     read as a real transfer, and A2 (cron 244) writes it as a historical
//     owner. buildChainDraft must drop a link the view flags as a variant.
//
// Anchors are identifiers — a function name, a flag name, a quoted literal —
// never a line number and never a sliced source region (the block-slice
// footgun, three false failures in this repo).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as OCD from '../api/_shared/ownership-chain-draft-planner.js';

const TICK = readFileSync('api/_handlers/ownership-chain-draft-tick.js', 'utf8');
const PLANNER = readFileSync('api/_shared/ownership-chain-draft-planner.js', 'utf8');

// Strip comments: this file's own banners name the things the code must NOT do,
// so matching prose would be a guaranteed false positive (the A1/A2/A4 rule).
const code = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const TICK_CODE = code(TICK);
const PLANNER_CODE = code(PLANNER);

// A transition row shaped like the gov view, with the flags the guard reads.
function row(over = {}) {
  return {
    ownership_id: 'x', transfer_date: '2022-11-01',
    prior_owner_cleaned: 'ALAMEDA NATPARK LLC', new_owner_cleaned: 'EGP 17101 BROOMFIELD LLC',
    prior_owner_is_clean: true, new_owner_is_clean: true,
    is_self_transition: false, is_oscillating_pair: false, is_name_variant: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
test('A4b: the re-draft pass exists and is wired into the tick', () => {
  assert.match(TICK_CODE, /async function runA4bRedraftPass\(/,
    'the pass that makes a corrected guard visible must exist');
  assert.match(TICK_CODE, /const a4bRedraft = await runA4bRedraftPass\(isApply, scanErrors\)/,
    'it must actually be called by the handler, not merely defined');
  assert.match(TICK_CODE, /a4b_redraft: a4bRedraft/,
    'the run must REPORT what it superseded — a silent pass is unfalsifiable');
});

test('A4b: the re-draft pass runs BEFORE the existing-draft read', () => {
  const iPass = TICK_CODE.indexOf('await runA4bRedraftPass(');
  const iExisting = TICK_CODE.indexOf('await fetchExistingDrafts()');
  assert.ok(iPass > -1 && iExisting > -1, 'both call sites must exist');
  assert.ok(iPass < iExisting,
    'superseding AFTER the existing-draft read leaves the task draftless for a whole night');
});

test('A4b: the pass is keyed on STATE, not on "A4b shipped"', () => {
  // It selects the lane's all_guarded action and re-runs the real guard. A
  // hard-coded property list, a date cutoff, or a migration-name check would
  // make it a one-shot chore rather than a self-clearing sensor.
  assert.match(TICK_CODE, /action=eq\.all_guarded/,
    'the population is "this task believes every transfer was guarded away"');
  assert.match(TICK_CODE, /OCD\.guardTransition\(t\) === null/,
    'the trigger is the REAL guard now passing a link, re-using the shared function');
  assert.doesNotMatch(TICK_CODE, /a4b[\w]*\s*=\s*\[\s*['"]?\d{3,}/i,
    'no hard-coded property list — that is the one-shot chore this pass replaces');
});

test('A4b: an empty gov fetch supersedes nothing', () => {
  // "The fetch failed" must never read as "the guard now passes" — the same
  // fail-closed rule the A4 re-open pass carries.
  assert.match(TICK_CODE, /const ts = byProp\.get\(id\) \|\| \[\];\s*\n\s*return ts\.some\(/,
    'an absent property must yield an empty array and therefore no supersede');
  assert.match(TICK_CODE, /if \(!unblocked\.length \|\| !apply\) continue;/,
    'a dry run must never write');
});

// ---------------------------------------------------------------------------
test('A4b: the planner READS is_name_variant and never re-derives it', () => {
  assert.match(PLANNER_CODE, /row\.is_name_variant === true/,
    'the SQL view is the single owner of the name-variant judgement');
  // A JS copy of the street-token vocabulary is the drift hazard. If someone
  // mirrors the SQL key here, the two definitions diverge silently.
  assert.doesNotMatch(PLANNER_CODE, /\b(boulevard|parkway|avenue)\b/i,
    'no street-token vocabulary in JS — that belongs to gov_owner_name_street_key alone');
  assert.doesNotMatch(PLANNER_CODE, /\[0-9\]\{5\}|\\d\{5\}/,
    'no copy of the 5-digit arm in JS — the predicate lives in gov, once');
});

test('A4b: a link the view flags as a name variant is dropped, not drafted', () => {
  // Property 1429: 10835 CAMARILLO STREET APARTMENTS LLC -> 10835 CAMARILLO
  // APARTMENTS LLC. Both names are now clean (they carry LLC), so ONLY the
  // widened variant flag stands between this and a phantom prior owner written
  // into lcc_entity_portfolio_facts by cron 244.
  const variant = row({
    prior_owner_cleaned: '10835 CAMARILLO STREET APARTMENTS LLC',
    new_owner_cleaned: '10835 CAMARILLO APARTMENTS LLC',
    is_name_variant: true,
  });
  assert.equal(OCD.guardTransition(variant), 'name_variant');
  const d = OCD.buildChainDraft([variant], { current_owner_name: '10835 Camarillo Apartments LLC' });
  assert.equal(d.draftable, false, 'a variant-only property must not draft a chain');
  assert.equal(d.insufficient_reason, 'all_transitions_guarded');
  assert.equal(d.links.length, 0, 'zero links — a phantom prior owner is exactly what must not be written');
});

test('A4b: a street-numbered SPE now drafts and terminates at the current owner', () => {
  // The A4-named casualty. Before the fix new_owner_is_clean was FALSE purely
  // because "17101" is a five-digit token.
  const d = OCD.buildChainDraft([row()], { current_owner_name: 'EGP 17101 BROOMFIELD LLC' });
  assert.equal(OCD.guardTransition(row()), null, 'a clean street-numbered SPE must pass the guard');
  assert.equal(d.draftable, true);
  assert.equal(d.links.length, 1);
  assert.equal(d.terminates_at_current_owner, true, 'this is an `agrees` card, the bucket A2 applies');
});

test('A4b: the other guards still bite — the correction is a narrowing, not a removal', () => {
  assert.equal(OCD.guardTransition(row({ prior_owner_is_clean: false })), 'prior_owner_unclean');
  assert.equal(OCD.guardTransition(row({ new_owner_is_clean: false })), 'new_owner_unclean');
  assert.equal(OCD.guardTransition(row({ is_self_transition: true })), 'self_transition');
  assert.equal(OCD.guardTransition(row({ is_oscillating_pair: true })), 'oscillating_pair');
  assert.equal(OCD.guardTransition(row({ transfer_date: null })), 'undated');
});
