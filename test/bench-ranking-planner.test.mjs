import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankBench, summarizeBenchPlan, seniorityScoreFromTitle, ownerPassesBenchValueGate,
} from '../api/_shared/bench-ranking-planner.js';

const NOW = new Date('2026-09-10T00:00:00Z').getTime();

function candidate(overrides = {}) {
  return {
    contact_entity_id: 'c-' + Math.random().toString(36).slice(2),
    name: 'Someone',
    role: 'works_at',
    source: 'related_person',
    n_props: 1,
    authority: 6,
    is_named_individual: true,
    title: null,
    total_emails_sent: 0,
    last_email_date: null,
    inbound_count: 0,
    inferred_function: null,
    inferred_function_confidence: null,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// The bench is never collapsed to one winner.
// --------------------------------------------------------------------------
test('rankBench never drops a candidate it was handed', () => {
  const input = [candidate({ name: 'A' }), candidate({ name: 'B' }), candidate({ name: 'C' })];
  const out = rankBench(input, { now: NOW });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.name).sort(), ['A', 'B', 'C']);
});

test('rankBench preserves the existing SQL-bench fields unchanged (extends the shape, never redefines it)', () => {
  const input = [candidate({ name: 'A', role: 'works_at', source: 'related_person', n_props: 3, authority: 6, contact_entity_id: 'xyz' })];
  const [out] = rankBench(input, { now: NOW });
  assert.equal(out.role, 'works_at');
  assert.equal(out.source, 'related_person');
  assert.equal(out.n_props, 3);
  assert.equal(out.authority, 6);
  assert.equal(out.contact_entity_id, 'xyz');
});

// --------------------------------------------------------------------------
// "recency beats volume ON A TIE" — when volume (and function/two-way) are
// equal, the more recent candidate ranks first.
// --------------------------------------------------------------------------
test('recency beats volume on an explicit tie', () => {
  const input = [
    candidate({ name: 'Older', total_emails_sent: 40, last_email_date: '2020-01-01T00:00:00Z' }),
    candidate({ name: 'Recent', total_emails_sent: 40, last_email_date: '2026-08-01T00:00:00Z' }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'Recent');
  assert.equal(out[1].name, 'Older');
});

test('when recency ALSO ties, higher volume decided it in the first place (sanity: volume still matters)', () => {
  const input = [
    candidate({ name: 'Low', total_emails_sent: 5, last_email_date: '2026-01-01T00:00:00Z' }),
    candidate({ name: 'High', total_emails_sent: 50, last_email_date: '2020-01-01T00:00:00Z' }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'High'); // volume outranks recency when they're NOT tied
});

// --------------------------------------------------------------------------
// A two-way (reply) signal outranks a one-way blast, absolutely — even a much
// bigger one-way volume does not overtake it.
// --------------------------------------------------------------------------
test('a two-way (reply) signal outranks a one-way blast regardless of volume', () => {
  const input = [
    candidate({ name: 'BigBlast', total_emails_sent: 500, inbound_count: 0 }),
    candidate({ name: 'RealConversation', total_emails_sent: 10, inbound_count: 3 }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'RealConversation');
  assert.equal(out[0].two_way, true);
  assert.equal(out[1].two_way, false);
});

// --------------------------------------------------------------------------
// Inferred function is not a mere volume tiebreak — the doctrine (§3a:
// "correspondence volume is NOT the selector") requires it to outrank volume.
// --------------------------------------------------------------------------
test('inferred acquisitions function outranks higher-volume transaction_dd, both one-way', () => {
  const input = [
    candidate({ name: 'DDManager', total_emails_sent: 90, inferred_function: 'transaction_dd', inferred_function_confidence: 'medium' }),
    candidate({ name: 'AcquisitionsLead', total_emails_sent: 71, inferred_function: 'acquisitions', inferred_function_confidence: 'medium' }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'AcquisitionsLead');
});

test('an unknown/null inferred function is neutral — never assumed acquisitions-grade, never punished to broker level', () => {
  const input = [
    candidate({ name: 'Broker', total_emails_sent: 10, inferred_function: 'broker' }),
    candidate({ name: 'Unknown', total_emails_sent: 10 }),
    candidate({ name: 'Acquisitions', total_emails_sent: 10, inferred_function: 'acquisitions' }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'Acquisitions');
  assert.equal(out[1].name, 'Unknown');
  assert.equal(out[2].name, 'Broker');
});

// --------------------------------------------------------------------------
// Seniority: absence of a title is silence, not a claim of "junior".
// --------------------------------------------------------------------------
test('seniorityScoreFromTitle: absent title is unknown, never scored as junior', () => {
  assert.deepEqual(seniorityScoreFromTitle(null), { score: 0, known: false });
  assert.deepEqual(seniorityScoreFromTitle(''), { score: 0, known: false });
});

test('seniorityScoreFromTitle: a senior title scores above a junior one', () => {
  const sr = seniorityScoreFromTitle('Executive Vice President');
  const jr = seniorityScoreFromTitle('Analyst');
  assert.ok(sr.score > jr.score);
  assert.equal(sr.known, true);
  assert.equal(jr.known, true);
});

// --------------------------------------------------------------------------
// Positive control — the Easterly Pulliam/Shuler worked example from
// account-based-contact-intelligence.md §3a, as fixture data (live DB numbers
// re-confirmed 2026-09-10: Pulliam 132 emails sent, title NULL in
// unified_contacts, inbound rows exist in email_bodies (is_sent=false)).
// Shuler does not resolve by name in unified_contacts at all today, so this
// fixture also covers the shape where a bench candidate has NO correspondence
// data joined at all (volume 0, no title) — he must still rank, never be
// silently dropped, and must never be mistaken for the acquisitions target.
// --------------------------------------------------------------------------
test('Pulliam/Shuler positive control: the acquisitions function outranks a higher-volume transaction_dd contact', () => {
  const input = [
    // Shuler-shaped: higher raw volume than Pulliam, but correspondence-
    // inferred transaction_dd/closing-finance role (per §3.: "Lucas Shuler —
    // '188 Harvest Lane Prorations' -> closing finance / accounting").
    candidate({
      name: 'Lucas Shuler', title: null, total_emails_sent: 90, inbound_count: 1,
      last_email_date: '2023-02-20T00:00:00Z',
      inferred_function: 'transaction_dd', inferred_function_confidence: 'medium',
    }),
    // Pulliam-shaped: real doc facts (132 emails, title NULL live, EVP-
    // Acquisitions per the doc's own confirmed narrative -> function inferred
    // from correspondence, not title, since the live title column is NULL).
    candidate({
      name: 'Andrew Pulliam', title: null, total_emails_sent: 71, inbound_count: 48,
      last_email_date: '2023-02-27T17:56:25Z',
      inferred_function: 'acquisitions', inferred_function_confidence: 'medium',
    }),
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out[0].name, 'Andrew Pulliam');
  assert.equal(out[0].inferred_function, 'acquisitions');
  assert.equal(out[1].name, 'Lucas Shuler');
  // Shuler is demoted, never dropped -- the bench keeps everyone (Scott's
  // "never collapse to one winner" doctrine).
  assert.equal(out.length, 2);
});

test('Pulliam/Shuler: Shuler with NO correspondence join at all (he does not resolve in unified_contacts live) still ranks, never crashes, never silently vanishes', () => {
  const input = [
    candidate({ name: 'Andrew Pulliam', total_emails_sent: 71, inbound_count: 48, inferred_function: 'acquisitions' }),
    candidate({ name: 'Lucas Shuler' }), // every correspondence field defaults to null/0/unknown
  ];
  const out = rankBench(input, { now: NOW });
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Andrew Pulliam');
  const shuler = out.find((c) => c.name === 'Lucas Shuler');
  assert.equal(shuler.correspondence_volume, 0);
  assert.equal(shuler.two_way, false);
  assert.equal(shuler.seniority_known, false);
});

// --------------------------------------------------------------------------
// Summary + value gate.
// --------------------------------------------------------------------------
test('summarizeBenchPlan reports honest counts, not a re-discovery tally', () => {
  const input = [
    candidate({ name: 'A', inbound_count: 1, inferred_function: 'acquisitions', inferred_function_confidence: 'high', title: 'EVP' }),
    candidate({ name: 'B' }),
  ];
  const ranked = rankBench(input, { now: NOW });
  const s = summarizeBenchPlan(ranked);
  assert.equal(s.total, 2);
  assert.equal(s.two_way, 1);
  assert.equal(s.function_known, 1);
  assert.equal(s.function_high_confidence, 1);
  assert.equal(s.title_known, 1);
  assert.equal(s.top_name, 'A');
});

test('ownerPassesBenchValueGate: unknown value is gated, not admitted (P161)', () => {
  assert.equal(ownerPassesBenchValueGate(null, 500000), false);
  assert.equal(ownerPassesBenchValueGate(undefined, 500000), false);
});

test('ownerPassesBenchValueGate: at/above the floor passes, below it does not', () => {
  assert.equal(ownerPassesBenchValueGate(500000, 500000), true);
  assert.equal(ownerPassesBenchValueGate(499999, 500000), false);
  assert.equal(ownerPassesBenchValueGate(1000000, 500000), true);
});

test('ownerPassesBenchValueGate: no floor configured admits (fails open on config, not on data)', () => {
  assert.equal(ownerPassesBenchValueGate(0, NaN), true);
});
