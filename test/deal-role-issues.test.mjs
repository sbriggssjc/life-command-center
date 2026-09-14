// test/deal-role-issues.test.mjs
// W7.4 unit tests — evidence validator, idempotency watermark, versioning shape,
// issue lifecycle, deterministic stage line, dossier render.
// Run: node --test test/deal-role-issues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForMatch, quoteVerbatimInComm, validateEvidence, validateProposal,
  validateRoles, applyIssueLifecycle, parseRoleIssuesResponse, buildRoleIssuesPrompt,
  commsIndex, roleIssuesWatermark, issueKey, ROLE_KEYS, ISSUE_KINDS,
} from '../api/_shared/deal-role-issues.js';
import { deriveStageLine } from '../api/_shared/deal-stage-line.js';
import { __test__ as dossierTest } from '../api/_shared/dossier-generator.js';

const COMMS = [
  { activity_id: 'a1', occurred_at: '2026-08-01T10:00:00Z', direction: 'inbound', sender: 'Jane Buyer',
    subject: 'Re: Woodland Hills', body: 'We want updated financials before we sign the LOI. Please send by Friday.' },
  { activity_id: 'a2', occurred_at: '2026-08-03T12:00:00Z', direction: 'outbound', sender: 'Scott',
    subject: 'Financials', body: 'Attached are the updated financials you requested. Survey is due Friday.' },
];
const BY_ID = commsIndex(COMMS);

// ── evidence validator ──────────────────────────────────────────────────────
test('validator: verbatim quote is kept', () => {
  const { evidence, dropped } = validateEvidence(
    [{ comm_id: 'a1', quote: 'updated financials before we sign the LOI' }], BY_ID);
  assert.equal(evidence.length, 1);
  assert.equal(dropped.length, 0);
});

test('validator: fabricated quote is dropped + logged', () => {
  const { evidence, dropped } = validateEvidence(
    [{ comm_id: 'a1', quote: 'we agree to a 6% cap rate on this deal' }], BY_ID);
  assert.equal(evidence.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'quote_not_verbatim');
});

test('validator: whitespace-normalized match is accepted', () => {
  const { evidence } = validateEvidence(
    [{ comm_id: 'a2', quote: '  updated   financials\n you   requested ' }], BY_ID);
  assert.equal(evidence.length, 1);
});

test('validator: cross-comm quote (right text, wrong comm id) is dropped', () => {
  // This text is verbatim in a1, but cited against a2 → must drop.
  const { evidence, dropped } = validateEvidence(
    [{ comm_id: 'a2', quote: 'before we sign the LOI' }], BY_ID);
  assert.equal(evidence.length, 0);
  assert.equal(dropped[0].reason, 'quote_not_verbatim');
});

test('validator: unknown comm id is dropped with reason', () => {
  const { dropped } = validateEvidence([{ comm_id: 'zzz', quote: 'anything at all here' }], BY_ID);
  assert.equal(dropped[0].reason, 'unknown_comm');
});

test('validator: too-short quote cannot ground a proposal', () => {
  assert.equal(quoteVerbatimInComm('LOI', 'a1', BY_ID), false);
});

test('validateProposal: role with one good + one bad evidence keeps only the good', () => {
  const { proposal, dropped } = validateProposal({
    party: 'Jane Buyer', proposed_role: 'decision_maker',
    evidence: [
      { comm_id: 'a1', quote: 'before we sign the LOI' },
      { comm_id: 'a1', quote: 'this quote is entirely invented' },
    ],
  }, BY_ID);
  assert.ok(proposal);
  assert.equal(proposal.evidence.length, 1);
  assert.equal(dropped.length, 1);
});

test('validateProposal: proposal with no surviving evidence → null', () => {
  const { proposal } = validateProposal({
    party: 'X', proposed_role: 'lender',
    evidence: [{ comm_id: 'a1', quote: 'totally made up sentence' }],
  }, BY_ID);
  assert.equal(proposal, null);
});

test('validateRoles: drops fabricated, keeps grounded, computes thread_count', () => {
  const { roles, dropped } = validateRoles([
    { party: 'Jane Buyer', proposed_role: 'decision_maker', confidence: 0.7,
      evidence: [{ comm_id: 'a1', quote: 'we want updated financials' }] },
    { party: 'Ghost', proposed_role: 'attorney',
      evidence: [{ comm_id: 'a1', quote: 'no such text' }] },
  ], BY_ID);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].thread_count, 1);
  assert.equal(dropped.length, 1);
});

// ── parser ──────────────────────────────────────────────────────────────────
test('parser: extracts JSON, clamps confidence, enforces role/kind vocab', () => {
  const raw = 'noise ' + JSON.stringify({
    roles: [
      { party: 'Jane', proposed_role: 'Decision-Maker', confidence: 2, evidence: [{ comm_id: 'a1', quote: 'x' }] },
      { party: 'Bad', proposed_role: 'wizard', evidence: [] },
    ],
    issues: [{ title: 'Send updated financials', kind: 'nonsense', evidence: [{ comm_id: 'a1', quote: 'x' }] }],
    closures: [{ issue_ref: 'p0', evidence: [{ comm_id: 'a2', quote: 'y' }] }],
  }) + ' trailing';
  const parsed = parseRoleIssuesResponse(raw);
  assert.equal(parsed.roles.length, 1);
  assert.equal(parsed.roles[0].proposed_role, 'decision_maker');
  assert.equal(parsed.roles[0].confidence, 1);
  assert.equal(parsed.issues[0].kind, 'ask'); // invalid kind → default ask
  assert.equal(parsed.closures.length, 1);
});

test('parser: non-JSON → null', () => {
  assert.equal(parseRoleIssuesResponse('sorry, I cannot help'), null);
});

test('vocab constants are stable', () => {
  assert.ok(ROLE_KEYS.includes('decision_maker') && ROLE_KEYS.includes('transaction_manager'));
  assert.deepEqual(ISSUE_KINDS, ['ask', 'question', 'commitment', 'deadline']);
});

// ── watermark / idempotency ─────────────────────────────────────────────────
test('watermark: same corpus → same digest (order-independent)', () => {
  const w1 = roleIssuesWatermark(COMMS);
  const w2 = roleIssuesWatermark([...COMMS].reverse());
  assert.equal(w1, w2);
});

test('watermark: changed corpus → different digest', () => {
  const w1 = roleIssuesWatermark(COMMS);
  const w2 = roleIssuesWatermark([...COMMS, { activity_id: 'a3', occurred_at: '2026-08-05T00:00:00Z' }]);
  assert.notEqual(w1, w2);
});

// ── issue lifecycle ─────────────────────────────────────────────────────────
test('lifecycle: opens a new evidence-backed issue', () => {
  const parsed = {
    issues: [{ title: 'Buyer wants updated financials', kind: 'ask',
      evidence: [{ comm_id: 'a1', quote: 'we want updated financials' }] }],
    closures: [],
  };
  const r = applyIssueLifecycle([], parsed, BY_ID);
  assert.equal(r.opened, 1);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].status, 'open');
});

test('lifecycle: an issue closed by a later comm flips to resolved with closing evidence', () => {
  const prior = [{ id: 'iss-1', title: 'Buyer wants updated financials', kind: 'ask', status: 'open',
    evidence: [{ comm_id: 'a1', quote: 'we want updated financials' }] }];
  const parsed = {
    issues: [],
    closures: [{ issue_ref: 'iss-1', evidence: [{ comm_id: 'a2', quote: 'Attached are the updated financials you requested' }] }],
  };
  const r = applyIssueLifecycle(prior, parsed, BY_ID);
  assert.equal(r.closed, 1);
  const iss = r.issues.find((i) => issueKey(i) === issueKey(prior[0]));
  assert.equal(iss.status, 'resolved');
  assert.ok(Array.isArray(iss.closing_evidence) && iss.closing_evidence.length === 1);
});

test('lifecycle: a closure with a fabricated quote does NOT close the issue', () => {
  const prior = [{ id: 'iss-1', title: 'Survey due', kind: 'deadline', status: 'open', evidence: [] }];
  const parsed = { issues: [], closures: [{ issue_ref: 'iss-1', evidence: [{ comm_id: 'a2', quote: 'survey is complete and approved' }] }] };
  const r = applyIssueLifecycle(prior, parsed, BY_ID);
  assert.equal(r.closed, 0);
  assert.equal(r.issues[0].status, 'open');
});

test('lifecycle: prior open issue is carried forward when untouched', () => {
  const prior = [{ id: 'iss-9', title: 'Order the survey', kind: 'commitment', status: 'open', evidence: [] }];
  const r = applyIssueLifecycle(prior, { issues: [], closures: [] }, BY_ID);
  assert.equal(r.carried, 1);
  assert.equal(r.issues[0].status, 'open');
});

// ── prompt builder ──────────────────────────────────────────────────────────
test('prompt: includes comm_ids, verbatim contract, and prior open issues', () => {
  const prompt = buildRoleIssuesPrompt({ deal_name: 'Woodland Hills' }, COMMS,
    [{ id: 'iss-1', title: 'Send financials', kind: 'ask' }]);
  assert.match(prompt, /comm_id=a1/);
  assert.match(prompt, /VERBATIM/);
  assert.match(prompt, /PREVIOUSLY-OPEN ISSUES/);
  assert.match(prompt, /issue_ref=iss-1/);
});

// ── deterministic stage line ────────────────────────────────────────────────
test('stage line: latest = highest-rank milestone', () => {
  const sl = deriveStageLine([
    { milestone_key: 'loi', date: '2026-07-01' },
    { milestone_key: 'psa', date: '2026-07-15' },
  ]);
  assert.equal(sl.latest_key, 'psa');
  assert.equal(sl.regressed, false);
  assert.match(sl.line, /Stage: PSA/);
});

test('stage line: Banning-style same-key collapse uses last_seen_on, no false regression', () => {
  const sl = deriveStageLine([
    { milestone_key: 'loi', date: '2026-05-01', last_seen_on: '2026-06-01' },
    { milestone_key: 'psa', date: '2026-06-10' },
  ]);
  assert.equal(sl.latest_key, 'psa');
  assert.equal(sl.regressed, false);
});

test('stage line: regression flag when an earlier stage re-occurs after a later one', () => {
  const sl = deriveStageLine([
    { milestone_key: 'loi', date: '2026-05-01' },
    { milestone_key: 'psa', date: '2026-05-20' },
    { milestone_key: 'loi', date: '2026-08-01' }, // a 2nd LOI after PSA → regression
  ]);
  // Note: same-key rows would normally collapse upstream; here we model the freshest date.
  assert.equal(sl.high_water_rank > 0, true);
  assert.equal(sl.newest_key, 'loi');
  assert.equal(sl.regressed, true);
  assert.match(sl.regression_note, /Regression/);
});

test('stage line: same-day higher+lower milestones do NOT false-flag regression (Villages case)', () => {
  const sl = deriveStageLine([
    { milestone_key: 'psa', date: '2026-06-22' },
    { milestone_key: 'escrow', date: '2026-06-22' },
  ]);
  assert.equal(sl.latest_key, 'escrow');
  assert.equal(sl.newest_key, 'escrow');
  assert.equal(sl.regressed, false);
});

test('stage line: live Banning shape (LOI after diligence) flags regression', () => {
  const sl = deriveStageLine([
    { milestone_key: 'diligence', date: '2024-12-13' },
    { milestone_key: 'loi', date: '2024-12-13' },
    { milestone_key: 'loi', date: '2025-09-30' },
    { milestone_key: 'loi', date: '2026-03-31' },
  ]);
  assert.equal(sl.latest_key, 'diligence');
  assert.equal(sl.newest_key, 'loi');
  assert.equal(sl.regressed, true);
});

test('stage line: empty milestones → null line', () => {
  assert.equal(deriveStageLine([]).line, null);
});

// ── dossier render ──────────────────────────────────────────────────────────
test('render: open-issues panel shows kind, item, evidence, and status badges', () => {
  const html = dossierTest.renderDealAnalysis({
    stage_awareness: { line: 'Stage: LOI (as of 2026-08-01)', regressed: false },
    open_issues: [
      { title: 'Buyer wants updated financials', kind: 'ask', status: 'open',
        evidence: [{ comm_id: 'a1', quote: 'we want updated financials' }] },
      { title: 'Survey due', kind: 'deadline', status: 'resolved',
        closing_evidence: [{ comm_id: 'a2', quote: 'survey received' }] },
    ],
  });
  assert.match(html, /What&rsquo;s Coming/);
  assert.match(html, /Buyer wants updated financials/);
  assert.match(html, /Stage: LOI/);
  assert.match(html, /b-rec">resolved/);
  assert.match(html, /evidence \(1\)/);
});

test('render: emerging-roles note reads "emerging decision-maker: …, per N threads"', () => {
  const html = dossierTest.renderEmergingRoles([
    { party: 'Jane Buyer', proposed_role: 'decision_maker', confidence: 0.8, thread_count: 3,
      evidence: [{ comm_id: 'a1', quote: 'x' }] },
  ]);
  assert.match(html, /emerging decision-maker/);
  assert.match(html, /Jane Buyer/);
  assert.match(html, /per 3 threads/);
});

test('render: no roles → empty string (nothing surfaced)', () => {
  assert.equal(dossierTest.renderEmergingRoles([]), '');
});
