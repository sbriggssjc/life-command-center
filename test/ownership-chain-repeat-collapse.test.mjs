// A2b — one conveyance recorded on several dates.
//
// What these pin is that the COLLAPSE is a representation fix and nothing more:
// the surviving link carries the earliest date, every source row stays traceable
// from it, and a grantor who genuinely sold twice is never folded into one.
//
// The date rule is the load-bearing judgement, so it is pinned explicitly rather
// than left to whichever end of the sort a refactor happens to keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildChainDraft, collapseRepeatedConveyances,
} from '../api/_shared/ownership-chain-draft-planner.js';

const TICK = readFileSync(
  new URL('../api/_handlers/ownership-chain-draft-tick.js', import.meta.url), 'utf8');

const row = (o = {}) => ({
  ownership_id: o.id || 'x', transfer_date: o.date,
  prior_owner: o.from || 'Alpha LLC', new_owner: o.to || 'Beta LLC',
  data_source: o.src || 'gsa_lease_diff',
  transfer_price: o.price == null ? null : o.price,
  prior_owner_is_clean: true, new_owner_is_clean: true,
  is_self_transition: false, is_oscillating_pair: false, is_name_variant: false,
});

// --- the date rule ---------------------------------------------------------

test('a conveyance recorded on several dates collapses to ONE link at the EARLIEST date', () => {
  // Property 3123, live shape: SENTINEL SQUARE I -> WASHINGTON DC VI FGF across
  // 8 distinct GSA leases, 2020-02..2020-04.
  const d = buildChainDraft([
    row({ id: 'c', date: '2020-04-01', from: 'SENTINEL SQUARE I, L.L.C.', to: 'WASHINGTON DC VI FGF, LLC' }),
    row({ id: 'a', date: '2020-02-01', from: 'SENTINEL SQUARE I, L.L.C.', to: 'WASHINGTON DC VI FGF, LLC' }),
    row({ id: 'b', date: '2020-03-01', from: 'SENTINEL SQUARE I, L.L.C.', to: 'WASHINGTON DC VI FGF, LLC' }),
  ]);
  assert.equal(d.links.length, 1);
  assert.equal(d.links[0].date, '2020-02-01');
  assert.equal(d.collapsed_conveyances, 2);
});

test('EARLIEST, never latest — the rule that keeps the grantor tenure from being overstated', () => {
  // This link's transfer_date becomes the GRANTOR's ownership_end_date. Taking a
  // later observation would assert the grantor still held the asset after the
  // record already showed the successor in possession — on the live population
  // by up to 700 days. Measured corroboration: over every party pair gov holds
  // from BOTH costar_sidebar and gsa_lease_diff, 26 of 26 have the recorded sale
  // FIRST, 0 same-day, 0 later, mean lag 161 days.
  const [l] = collapseRepeatedConveyances([
    { from: 'A LLC', to: 'B LLC', date: '2018-06-01', price: null, citation: { ownership_id: 'late' } },
    { from: 'A LLC', to: 'B LLC', date: '2016-07-01', price: null, citation: { ownership_id: 'early' } },
  ]);
  assert.equal(l.date, '2016-07-01');
  assert.equal(l.citation.ownership_id, 'early');
  assert.notEqual(l.date, '2018-06-01');
});

// --- evidence preservation -------------------------------------------------

test('every collapsed source row stays traceable from the surviving link', () => {
  const d = buildChainDraft([
    row({ id: 'first', date: '2013-03-01', from: 'WASHINGTON OFFICE CENTER L.L.C.', to: 'WOC LLC' }),
    row({ id: 'second', date: '2014-01-01', from: 'WASHINGTON OFFICE CENTER L.L.C.', to: 'WOC LLC' }),
    row({ id: 'third', date: '2014-05-01', from: 'WASHINGTON OFFICE CENTER L.L.C.', to: 'WOC LLC' }),
  ]);
  const [l] = d.links;
  assert.equal(l.citation.ownership_id, 'first');
  const also = l.citation.also_recorded_as;
  assert.deepEqual(also.map((a) => a.ownership_id), ['second', 'third']);
  assert.deepEqual(also.map((a) => a.transfer_date), ['2014-01-01', '2014-05-01']);
  // Nothing is lost: all three source rows are still reachable from the draft.
  assert.equal(1 + also.length, 3);
  assert.equal(l.collapsed_from, 3);
  assert.deepEqual(l.also_recorded_on, ['2014-01-01', '2014-05-01']);
});

test('a price seen only on a later observation is carried but CITED', () => {
  // Property 3891's shape: costar_sidebar holds the sale, gsa_lease_diff the
  // lease paperwork. One conveyance has one price; a figure whose provenance is
  // not on the row is exactly what this lane must not produce.
  const [l] = collapseRepeatedConveyances([
    { from: 'A LLC', to: 'B LLC', date: '2014-07-01', price: null, citation: { ownership_id: 'early' } },
    { from: 'A LLC', to: 'B LLC', date: '2015-05-01', price: 9_000_000, citation: { ownership_id: 'priced' } },
  ]);
  assert.equal(l.price, 9_000_000);
  assert.equal(l.citation.price_from_ownership_id, 'priced');
});

test('same-date twins are preserved as evidence too, not silently dropped', () => {
  // P131's dedup folds byte-identical (from, to, date) rows — property 3123 has
  // three on 2020-03-01 alone. They are the same fact recorded twice, so they
  // are evidence: the draft must still name them.
  const d = buildChainDraft([
    row({ id: 'a', date: '2020-02-01', from: 'S LLC', to: 'F LLC' }),
    row({ id: 'b1', date: '2020-03-01', from: 'S LLC', to: 'F LLC' }),
    row({ id: 'b2', date: '2020-03-01', from: 'S LLC', to: 'F LLC' }),
    row({ id: 'b3', date: '2020-03-01', from: 'S LLC', to: 'F LLC' }),
  ]);
  assert.equal(d.links.length, 1);
  const ids = new Set([d.links[0].citation.ownership_id,
    ...d.links[0].citation.also_recorded_as.map((a) => a.ownership_id)]);
  assert.deepEqual([...ids].sort(), ['a', 'b1', 'b2', 'b3']);
});

test('a single link with same-date twins still names them, and collapses nothing', () => {
  const d = buildChainDraft([
    row({ id: 'x1', date: '2013-03-01', from: 'A LLC', to: 'B LLC' }),
    row({ id: 'x2', date: '2013-03-01', from: 'A LLC', to: 'B LLC' }),
  ]);
  assert.equal(d.links.length, 1);
  assert.equal(d.collapsed_conveyances, 0); // same date is not a second conveyance
  assert.deepEqual(d.links[0].citation.also_recorded_as.map((a) => a.ownership_id), ['x2']);
});

test('the internal _repeats scratch field never reaches a stored draft', () => {
  const d = buildChainDraft([
    row({ id: 'a', date: '2020-02-01', from: 'S LLC', to: 'F LLC' }),
    row({ id: 'b', date: '2020-03-01', from: 'S LLC', to: 'F LLC' }),
    row({ id: 'c', date: '2020-03-01', from: 'S LLC', to: 'F LLC' }),
  ]);
  for (const l of d.links) assert.equal('_repeats' in l, false);
});

// --- the safety property ---------------------------------------------------

test('SAME grantor, DIFFERENT grantee is genuine repeat ownership and is NOT collapsed', () => {
  // A sold to B, then later sold to C. One interval per party cannot represent
  // that either, so it must stay blocked for a human — never folded into one.
  const out = collapseRepeatedConveyances([
    { from: 'A LLC', to: 'B LLC', date: '2014-01-01', price: null, citation: { ownership_id: 'b' } },
    { from: 'A LLC', to: 'C LLC', date: '2019-01-01', price: null, citation: { ownership_id: 'c' } },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.every((l) => l.collapsed_from === undefined));
});

test('a real multi-party chain is untouched, and reports zero collapsed', () => {
  const d = buildChainDraft([
    row({ id: '1', date: '2010-01-01', from: 'Alpha LLC', to: 'Beta LLC' }),
    row({ id: '2', date: '2015-01-01', from: 'Beta LLC', to: 'Gamma LLC' }),
  ]);
  assert.equal(d.links.length, 2);
  assert.equal(d.collapsed_conveyances, 0);
  assert.equal(d.continuity.contiguous, true);
});

test('case and punctuation variants of the SAME parties collapse', () => {
  // Live shapes: `Gate Properties LP` / `GATE PROPERTIES LP`, and
  // `MEPT/FCP Patriots Plaza LLC` / `MEPT/FCP PATRIOTS PLAZA LLC`.
  const d = buildChainDraft([
    row({ id: 'a', date: '2014-07-01', from: 'Gate Properties LP', to: 'Tampa GSA MEPS LLC', src: 'costar_sidebar' }),
    row({ id: 'b', date: '2015-05-01', from: 'GATE PROPERTIES LP', to: 'TAMPA GSA MEPS, LLC' }),
  ]);
  assert.equal(d.links.length, 1);
  assert.equal(d.links[0].date, '2014-07-01');
  assert.equal(d.links[0].citation.also_recorded_as[0].data_source, 'gsa_lease_diff');
});

// --- the collapse must precede continuity ----------------------------------

test('collapsing removes the PHANTOM gap the repeat manufactured', () => {
  // A->B, A->B reads as a break, because link[1].from (A) is not link[0].to (B).
  // The chain was never broken; it was one link recorded twice.
  const d = buildChainDraft([
    row({ id: 'a', date: '2023-02-01', from: 'LAW BUILDING, LLC, THE', to: 'THE LAW BUILDING, L.L.C.' }),
    row({ id: 'b', date: '2023-10-01', from: 'LAW BUILDING, LLC, THE', to: 'THE LAW BUILDING, L.L.C.' }),
    row({ id: 'c', date: '2024-09-01', from: 'LAW BUILDING, LLC, THE', to: 'THE LAW BUILDING, L.L.C.' }),
  ], { current_owner_name: 'THE LAW BUILDING, L.L.C.' });
  assert.equal(d.continuity.breaks, 0);
  assert.equal(d.continuity.contiguous, true);
  assert.equal(d.terminates_at_current_owner, true);
});

test('a REAL gap is still reported, never bridged', () => {
  const d = buildChainDraft([
    row({ id: '1', date: '2010-01-01', from: 'Alpha LLC', to: 'Beta LLC' }),
    row({ id: '2', date: '2015-01-01', from: 'Delta LLC', to: 'Gamma LLC' }),
  ]);
  assert.equal(d.links.length, 2);
  assert.equal(d.continuity.breaks, 1);
  assert.equal(d.links[1].gap_before, true);
});

// --- the sweep -------------------------------------------------------------

test('the A2b re-draft pass is keyed on STATE, not on "A2b shipped"', () => {
  // The producer is LIVE (323 repeat pairs fleet-wide, 58 in 90 days, 9 in 30,
  // most recent 2026-08-24 — costar_sidebar landing a second observation of a
  // pair gsa_lease_diff already recorded). A one-shot supersede would be a chore
  // repeated silently forever (Class 8). Anchored on the stable predicate token,
  // never on a line number or a sliced region.
  assert.match(TICK, /blocked_reason=eq\.repeat_transfer_unrepresentable/);
  assert.match(TICK, /async function runA2bRedraftPass/);
});

test('the sweep re-runs the REAL planner rather than trusting the blocked reason', () => {
  // "The gov fetch failed" must never read as "now collapsible", and a task
  // blocked for a reason A2b does not fix must keep its draft.
  const pass = TICK.slice(TICK.indexOf('async function runA2bRedraftPass'));
  const body = pass.slice(0, pass.indexOf('\nasync function '));
  assert.match(body, /OCD\.buildChainDraft/);
  assert.match(body, /collapsed_conveyances > 0/);
  assert.match(body, /if \(!ts\.length\) continue;/);
});

test('the sweep supersedes nothing in dry-run', () => {
  const pass = TICK.slice(TICK.indexOf('async function runA2bRedraftPass'));
  const body = pass.slice(0, pass.indexOf('\nasync function '));
  assert.match(body, /!collapsible\.length \|\| !apply/);
});
