// C6 — a CURRENT HOLDING satisfies the gov seller-side bands, gated on reachability.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// `v_priority_queue_live.gov_owner_props` gated four gov deal-timing bands on
// `effective_owner_role = ANY (ARRAY['developer','user_owner'])` — a PARTY-LEVEL
// identity answering a PER-ASSET question, while the CTE was already holding the
// per-asset fact (`f.is_current = true`) and discarding it. `user_owner` matched
// 0 of 66,874 live entities; 578 correctly-labelled `buyer` owners held a gov
// property with a lease expiring inside 24 months.
//
// THREE THINGS THIS GUARD HAD TO GET RIGHT:
//
// 1. IT MUST STRIP SQL COMMENTS FIRST. The C6 migration's own header quotes the
//    removed role-gate predicate SIX times while explaining why it went. A
//    detector reading raw text passes over the gate's deletion — and would keep
//    passing if someone restored it. (A1's prose detector, A5c's deleted
//    assignment, N18's re-reported bug, B1's held-lane discussion: same class.)
//
// 2. P5 / `aged_props` MUST KEEP ITS ROLE GATE. It is 83% of the naive flood
//    (58 -> 1,681) and — the part that is easy to miss — it joins
//    lcc_entity_portfolio_facts with NO source_domain filter, so it covers dia
//    too (26 -> 565 dia rows). Removing its gate is a cross-domain change.
//    Nothing in this arc has been. The guard fails if that gate disappears.
//
// 3. REACHABILITY IS LOAD-BEARING, NOT DECORATION. Without it the same change
//    emits 3,235 rows over 2,719 owners of whom 11% are contactable — the P112
//    failure at scale. The guard fails if `gov_owner_props` ever stops requiring
//    a non-null `owner_contact_pivot.active_contact_entity_id`.
//
// Anchored on the CTE name (`gov_owner_props` / `aged_props`) and on stable
// identity tokens, never on a line number or a byte offset — the block-slice
// footgun this repo has paid for three times.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRATION =
  'supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql';

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '');
}

// Slice a named CTE body by matching parentheses from its opening `(`, so the
// boundary is structural and cannot drift into a neighbouring CTE.
function cteBody(sql, name) {
  const start = sql.search(new RegExp(`\\b${name}\\s+AS\\s*\\(`, 'i'));
  assert.notEqual(start, -1, `CTE ${name} not found`);
  const open = sql.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error(`unbalanced parentheses in CTE ${name}`);
}

const RAW = readFileSync(MIGRATION, 'utf8');
const SQL = stripSqlComments(RAW);
// `::text` is OPTIONAL on purpose. Postgres deparses the casts, but a hand-
// written restore of the gate would very likely omit them, and a regex that
// demanded them would go blind to exactly the regression this guard exists to
// catch (the P182 deparse trap / P189 over-strict-predicate class).
const ROLE_GATE =
  /effective_owner_role\s*=\s*ANY\s*\(\s*ARRAY\s*\[\s*'developer'(?:::text)?\s*,\s*'user_owner'(?:::text)?\s*\]\s*\)/i;

test('the guard reads code, not prose: the header quotes the removed gate', () => {
  // Positive control for the comment stripper. If this ever fails, the header
  // stopped discussing the old predicate and the stripper is no longer exercised
  // — the assertions below would then be passing vacuously.
  assert.ok(
    ROLE_GATE.test(RAW.slice(0, RAW.indexOf('CREATE TABLE'))),
    'expected the migration header to quote the old role gate',
  );
  assert.ok(
    !ROLE_GATE.test(stripSqlComments(RAW.slice(0, RAW.indexOf('CREATE TABLE')))),
    'stripSqlComments must remove the header discussion',
  );
});

test('gov_owner_props no longer gates on the party-level role', () => {
  assert.ok(
    !ROLE_GATE.test(cteBody(SQL, 'gov_owner_props')),
    'gov_owner_props must not gate the bands on effective_owner_role — the band ' +
      'is a per-asset question and f.is_current already answers it',
  );
});

test('gov_owner_props requires a confirmed active contact (P112 reachability)', () => {
  const body = cteBody(SQL, 'gov_owner_props');
  assert.match(body, /owner_contact_pivot/i);
  assert.match(body, /active_contact_entity_id\s+IS\s+NOT\s+NULL/i);
});

test('gov_owner_props still establishes CURRENT gov holding', () => {
  const body = cteBody(SQL, 'gov_owner_props');
  assert.match(body, /f\.is_current\s*=\s*true/i);
  assert.match(body, /f\.source_domain\s*=\s*'gov'::text/i);
});

test('P5 / aged_props KEEPS its role gate — it is cross-domain', () => {
  const body = cteBody(SQL, 'aged_props');
  assert.ok(
    ROLE_GATE.test(body),
    'aged_props must keep the role gate: it has no source_domain filter, so ' +
      'removing it changes dia too (26 -> 565 dia rows)',
  );
  assert.ok(
    !/source_domain\s*=\s*'gov'/i.test(body),
    'aged_props is deliberately NOT gov-scoped; if that changes, re-derive the ' +
      'cross-domain argument above before touching its gate',
  );
});

test('the reachability gate is not silently widened to the whole pivot', () => {
  // An owner_contact_pivot row with a NULL active_contact_entity_id is a bench,
  // not a contact. Dropping the NOT NULL would admit 4,031 unreachable owners.
  const body = cteBody(SQL, 'gov_owner_props');
  const pivotRefs = (body.match(/owner_contact_pivot/gi) || []).length;
  const notNullRefs = (body.match(/active_contact_entity_id\s+IS\s+NOT\s+NULL/gi) || []).length;
  assert.equal(pivotRefs, notNullRefs, 'every owner_contact_pivot read must require a live contact');
});

test('no column was added, removed or reordered (CREATE OR REPLACE VIEW is append-only)', () => {
  // 42P16: inserting a column mid-list fails outright, but appending one silently
  // changes every positional consumer. Pin the emitted band set instead of a
  // brittle column list — a new column almost always arrives with a new arm.
  const bands = [...SQL.matchAll(/'(P[0-9.]+|P-[A-Z]+)'::text AS priority_band/g)].map((m) => m[1]);
  assert.deepEqual(
    bands.sort(),
    ['P-BUYER', 'P-CONTACT', 'P0.4', 'P0.5', 'P1', 'P2', 'P3', 'P4', 'P5', 'P8'].sort(),
  );
});

test('the migration restates the WHOLE view body (P194) and is reversible', () => {
  assert.match(SQL, /CREATE OR REPLACE VIEW public\.v_priority_queue_live/i);
  assert.match(SQL, /lcc_c6_view_backup/i, 'prior definition must be captured for reversal');
  assert.match(RAW, /REVERSAL RUNBOOK/i);
  // The queue is served from a materialized cache; a view change that does not
  // refresh it leaves the surface stale and reads as "the change did nothing".
  assert.match(SQL, /lcc_refresh_priority_queue_resolved\(\)/i);
});
