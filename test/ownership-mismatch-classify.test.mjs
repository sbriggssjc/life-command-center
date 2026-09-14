// A3 — the ownership-history `mismatch` classification and the sponsor-confirm path.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// The brief for A3 said "route the 73 to a data-integrity lane". Measured live on
// 2026-08-27 that would have been the wrong build: 32 of 74 chains are sponsor <-> SPE
// (the deed names the SPE holding title, our field names the sponsor — both correct), and
// they collapse into TWELVE decisions, one of which (Boyd Watterson) covers 20 chains.
//
// So the assertions below pin the STRUCTURAL properties that make that safe, anchored on
// FUNCTION and COLUMN NAMES inside the migration — never on a line number, never on a
// sliced source region between banners (the block-slice footgun that has produced three
// false failures in this repo), and never on a count that live data will move.
//
// Mutation-verified RED on each of:
//   * re-typing the street/SPE-marker regexes into the A3 gate instead of calling the
//     shared predicates (the fresh-detector drift);
//   * dropping the person / brokerage / street guard from the A3 gate;
//   * folding `sponsor_spe` into `agrees` (which would hand it to A2's WRITE path);
//   * seeding a confirmation row in the migration;
//   * making `confirmed_by` nullable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  OWNERSHIP_LANE_ACTIONS, OWNERSHIP_LANE_HUMAN_ACTIONS, OWNERSHIP_MISMATCH_CLASSES,
  isOwnershipLaneAction, ownershipLaneBucketFilter,
} from '../api/_shared/ownership-lane-split.js';

const FILES = readdirSync('supabase/migrations')
  .filter((f) => f.includes('ownership_mismatch_sponsor_family'));
const MIGRATION = FILES.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

// Body only. This migration's comments legitimately quote the regexes and the names the
// code must NOT re-type, so matching against comments would be a false positive — the
// same care A1's own guard takes.
const SQL = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('the A3 migration exists and ships its four objects', () => {
  assert.ok(FILES.length === 1, `expected exactly one A3 migration, found ${FILES.length}`);
  assert.match(SQL, /create or replace function public\.lcc_ownership_sponsor_token\s*\(/i);
  assert.match(SQL, /create or replace function public\.lcc_ownership_mismatch_class\s*\(/i);
  assert.match(SQL, /create table if not exists public\.lcc_ownership_sponsor_family\b/i);
  assert.match(SQL, /create or replace view public\.v_lcc_ownership_sponsor_family_proposals\b/i);
  assert.match(SQL, /create or replace view public\.v_lcc_ownership_mismatch_classified\b/i);
});

// ---------------------------------------------------------------------------
// The detector is SHARED, not re-typed. This is the whole anti-drift claim.
// ---------------------------------------------------------------------------
test('the P196 guards are EXTRACTED into named predicates, and P196 calls them', () => {
  assert.match(SQL, /create or replace function public\.lcc_name_reads_as_street\s*\(/i);
  assert.match(SQL, /create or replace function public\.lcc_name_has_spe_marker\s*\(/i);

  // The P196 function must be re-issued CALLING them — otherwise there are two copies of
  // each regex and they drift, which is the failure this repo keeps re-learning.
  const p196 = SQL.slice(SQL.indexOf('lcc_tier0_sponsor_brand_token(p_owner_name text, p_company text)'));
  const body = p196.slice(0, p196.indexOf('$$;') + 3);
  assert.ok(body.length > 0, 'lcc_tier0_sponsor_brand_token must be re-issued here');
  assert.match(body, /lcc_name_has_spe_marker\s*\(/,
    'P196 must call the extracted SPE-marker predicate, not inline it');
  assert.match(body, /lcc_name_reads_as_street\s*\(/,
    'P196 must call the extracted street predicate, not inline it');
});

test('the A3 gate re-types NEITHER extracted regex', () => {
  const g = SQL.slice(SQL.indexOf('function public.lcc_ownership_sponsor_token'));
  const gate = g.slice(0, g.indexOf('$$;') + 3);
  assert.ok(gate.length > 0);
  // The street-word alternation and the SPE-marker alternation belong to the shared
  // predicates. A copy here is the fresh-detector drift, however correct it looks.
  assert.doesNotMatch(gate, /\bblvd\b/i,
    'the A3 gate must call lcc_name_reads_as_street, never re-type its alternation');
  assert.doesNotMatch(gate, /propco/i,
    'the A3 gate must not re-type the SPE-marker alternation');
  assert.match(gate, /lcc_name_reads_as_street\s*\(/,
    'the A3 gate must apply the SHARED street guard');
});

test('the A3 gate applies the person and brokerage guards', () => {
  const g = SQL.slice(SQL.indexOf('function public.lcc_ownership_sponsor_token'));
  const gate = g.slice(0, g.indexOf('$$;') + 3);
  // Measured cost of the person guard on this population: exactly two false negatives
  // (`City of Oakland` <- `PORT DEPARTMENT ...`, `Glenn Olds ...` <- `U-Land, Glenn Olds`),
  // kept per P196's stated trade. Removing it re-admits the shared-given-name class that
  // took the P196 detector to ~25%.
  assert.match(gate, /lcc_looks_like_person\s*\(/,
    'a shared GIVEN NAME is the dominant false positive for a brand-token detector');
  assert.match(gate, /lcc_owner_name_is_brokerage\s*\(/,
    'a brokerage is the agent, never the principal');
});

test('the gate requires the token on BOTH sides — the P187 acronym arm is not re-created', () => {
  const g = SQL.slice(SQL.indexOf('function public.lcc_ownership_sponsor_token'));
  const gate = g.slice(0, g.indexOf('$$;') + 3);
  // Both names' brand tokens are extracted, and every arm compares one against the other.
  // P187's rejected arm INFERRED a fact from ONE name; this requires the token to appear
  // on the deed AND on our owner record for the SAME property.
  assert.match(gate, /lcc_tier0_brand_token\s*\(\s*p_owner_name\s*\)/);
  assert.match(gate, /lcc_tier0_brand_token\s*\(\s*p_grantee_name\s*\)/);
  // A 3-character floor. Below it a token is noise on either arm.
  assert.match(gate, /length\(\s*ot\s*\)\s*>=\s*3/);
  assert.match(gate, /length\(coalesce\(gt,''\)\)\s*>=\s*3/);
});

// ---------------------------------------------------------------------------
// The classification has ONE owner, in SQL, and reads no prose.
// ---------------------------------------------------------------------------
test('the class CASE is in SQL and greps no drafter prose', () => {
  assert.doesNotMatch(SQL, /\breason\s+(i?like|~\*?|similar to)/i,
    'a text detector over drafter-generated prose is the A1/P182 defect');
  assert.doesNotMatch(SQL, /does not match the current owner/i);
  const c = SQL.slice(SQL.indexOf('function public.lcc_ownership_mismatch_class'));
  const cls = c.slice(0, c.indexOf('$$;') + 3);
  for (const k of OWNERSHIP_MISMATCH_CLASSES) {
    assert.ok(cls.includes(`'${k}'`), `the SQL CASE must emit '${k}'`);
  }
});

test('no JS mirror of the SQL classifier exists', () => {
  // Comments are stripped first: both files legitimately NAME the comparators in prose
  // while explaining why they must not be re-implemented here. Matching prose would be
  // the false positive this repo has shipped three times from sliced-source greps.
  const strip = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const MOD = strip(readFileSync('api/_shared/ownership-lane-split.js', 'utf8'));
  const CLIENT = strip(readFileSync('ops.js', 'utf8'));
  for (const [name, src] of [['ownership-lane-split.js', MOD], ['ops.js', CLIENT]]) {
    // The vocabulary may LIST the classes; deriving one from the two names may not.
    // Anchored on a CALL shape, not a bare identifier — note `a|b\s*\(` binds so that
    // the first alternative needs no call at all (the same mis-binding P194 hit with `~`).
    assert.doesNotMatch(src, /(lcc_owner_strict_core|strictOwnerCore|lcc_ownership_sponsor_token)\s*\(/i,
      `${name} must not re-derive the mismatch class — the SQL function owns it`);
    assert.doesNotMatch(src, /mismatch_class\s*=[^=]/i,
      `${name} must render the class the server supplied, never assign one`);
  }
});

test('name_variant is LABELLED, never used to retire — it rides lcc_owner_strict_core', () => {
  const c = SQL.slice(SQL.indexOf('function public.lcc_ownership_mismatch_class'));
  const cls = c.slice(0, c.indexOf('$$;') + 3);
  assert.match(cls, /lcc_owner_strict_core/,
    'name_variant is defined by the sanctioned identity comparator');
  // A2 measured and REJECTED strict_core for WRITES on this population (BAMMF (8) ==
  // BAMMF (3)). It must therefore never gate the action or human_actionable: a
  // name_variant chain stays a human question.
  assert.equal(OWNERSHIP_LANE_ACTIONS.includes('name_variant'), false,
    'name_variant must not become an action — that would retire 11 cards on an '
    + 'automated name judgement A2 already rejected for writes');
  assert.equal(isOwnershipLaneAction('name_variant'), false);
});

// ---------------------------------------------------------------------------
// sponsor_spe: gated on a CONFIRMED row, and NOT folded into `agrees`.
// ---------------------------------------------------------------------------
test('sponsor_spe is its own action and is NOT agrees', () => {
  assert.ok(OWNERSHIP_LANE_ACTIONS.includes('sponsor_spe'));
  assert.match(ownershipLaneBucketFilter('sponsor_spe'), /action=eq\.sponsor_spe/);
  // Folding it into `agrees` would hand it to A2's apply path (cron 244), which WRITES
  // portfolio facts — a materially larger decision than "these names are one family".
  const split = SQL.slice(SQL.indexOf("create or replace view public.v_lcc_ownership_history_lane_split"));
  assert.match(split, /then case when t\.sponsor_confirmed then 'sponsor_spe'::text else 'mismatch'::text end/i,
    'sponsor_spe must branch off the mismatch arm, gated on a confirmation');
  assert.doesNotMatch(split, /sponsor_confirmed then 'agrees'/i);
});

test('sponsor_spe is answered, so it leaves the human badge', () => {
  assert.equal(OWNERSHIP_LANE_HUMAN_ACTIONS.includes('sponsor_spe'), false);
  const split = SQL.slice(SQL.indexOf("create or replace view public.v_lcc_ownership_history_lane_split"));
  const ha = split.slice(split.indexOf('as human_actionable') - 700, split.indexOf('as human_actionable'));
  assert.match(ha, /not t\.sponsor_confirmed/,
    'human_actionable must exclude a confirmed sponsor family');
});

test('the confirmation is resolved through lcc_entity_survivor (P175)', () => {
  // Existence is not liveness. A confirmation keyed on a pre-merge entity id would be
  // stranded the moment that owner is merged.
  const split = SQL.slice(SQL.indexOf("create or replace view public.v_lcc_ownership_history_lane_split"));
  assert.match(split, /lcc_entity_survivor\s*\(\s*c\.entity_id\s*\)/i);
});

// ---------------------------------------------------------------------------
// The confirm registry: human decisions only, entity-scoped, reversible.
// ---------------------------------------------------------------------------
test('confirmed_by is REQUIRED and the key is (entity, token)', () => {
  const t = SQL.slice(SQL.indexOf('create table if not exists public.lcc_ownership_sponsor_family'));
  const tbl = t.slice(0, t.indexOf(');') + 2);
  assert.match(tbl, /confirmed_by\s+text\s+not null/i,
    'a row is a HUMAN decision — the same requirement lcc_owner_sponsor_domain carries');
  assert.match(tbl, /primary key \(sponsor_entity_id, sponsor_token\)/i,
    'entity-scoped: a bare token is not bounded (`east` names 146 live entities), and '
    + '`madison` is proposed by two distinct owner entities today');
  assert.match(tbl, /references public\.entities\(id\)/i);
});

test('NOTHING is seeded — a confirmation is never fabricated', () => {
  assert.doesNotMatch(SQL, /insert\s+into\s+public\.lcc_ownership_sponsor_family/i,
    'seeding a confirmation would invent a human decision nobody made');
  assert.doesNotMatch(SQL, /insert\s+into\s+public\.lcc_owner_sponsor_domain/i);
});

test('A3 writes no ownership fact and touches no other lane', () => {
  for (const t of ['lcc_entity_portfolio_facts', 'research_tasks', 'lcc_property_owner']) {
    assert.doesNotMatch(SQL, new RegExp(`(insert into|update|delete from)\\s+(public\\.)?${t}\\b`, 'i'),
      `A3 must not write ${t} — it classifies and registers a confirmation, nothing more`);
  }
});

// ---------------------------------------------------------------------------
// The proposals surface carries the evidence that makes a confirm safe.
// ---------------------------------------------------------------------------
test('a proposal shows its blast radius and its arms', () => {
  const v = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_ownership_sponsor_family_proposals'));
  const view = v.slice(0, v.indexOf(';', v.indexOf('group by')) + 1);
  assert.match(view, /token_entities_fleetwide/,
    'a generic token (`east` = 146 entities) must be visible BEFORE it is confirmed');
  assert.match(view, /chains_resolved/, 'honest count: chains per DECISION, not chains scanned');
  assert.match(view, /grantees/, 'the operator must read the actual SPE names');
  assert.match(view, /sponsor_arms/, 'which arm matched is the evidence');
});

test('a contact confirm is EVIDENCE on the card, never inherited as an answer', () => {
  const v = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_ownership_sponsor_family_proposals'));
  const view = v.slice(0, v.indexOf(';', v.indexOf('group by')) + 1);
  assert.match(view, /also_confirmed_for_contacts/,
    'a token confirmed in lcc_owner_sponsor_domain answers a DIFFERENT question (P188)');
  // The split view decides sponsor_spe ONLY from lcc_ownership_sponsor_family. If it ever
  // reads the contact table, a ~4-of-6 contact gate would start settling ownership facts.
  const split = SQL.slice(SQL.indexOf("create or replace view public.v_lcc_ownership_history_lane_split"));
  assert.doesNotMatch(split, /lcc_owner_sponsor_domain/,
    'the ownership action must not inherit a contact-matching confirmation');
});

test('the residue names WHICH guard dropped it, structurally', () => {
  const v = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_ownership_mismatch_classified'));
  assert.match(v, /unexplained_reason/);
  for (const r of ['owner_reads_as_person', 'brokerage', 'grantee_reads_as_street', 'no_shared_brand_token']) {
    assert.ok(v.includes(`'${r}'`), `the residue must name '${r}' rather than lumping it`);
  }
  // A future A3b ranks the residue off these structured signals, not off prose.
  assert.match(v, /grantee_detected_as_spe/,
    'lcc_is_spe_shell_name under-detects place-named SPEs here — report it, do not widen it');
});

test('the classifier runs on MISMATCH rows only', () => {
  // Stamping every card with a class the question does not apply to is the
  // unearned-positive default (P124) in column form. NULL means "not a mismatch".
  const split = SQL.slice(SQL.indexOf("create or replace view public.v_lcc_ownership_history_lane_split"));
  const cls = split.slice(split.indexOf('as mclass') - 900, split.indexOf('as mclass'));
  assert.match(cls, /terminates_at_current_owner'\)::boolean is false/,
    'mclass must be gated on the mismatch condition, not computed for every row');
});
