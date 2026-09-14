// test/owner-reachable-via.test.mjs
// ============================================================================
// Prompt 114 / BREAK-1 Unit 2 — the "reach the owner VIA a linked person"
// resolver, and the owner-contact lane's shape-aware verdict model.
//
// WHY THIS FILE EXISTS AT ALL (the specific bug class it guards):
//   The winner-selection rule is the exact shape of the gov `ensureTrueOwner`
//   defect — an unanchored `ilike.*X*&limit=1` first-row-wins match that was the
//   SOLE source of gov true_owner links (government-lease CLAUDE.md §20). An
//   owner with several linked people must resolve to the SAME person on every
//   render and on every surface, so the ordering is asserted here rather than
//   left to whatever the database happened to return first.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

import { pickReachableVia, buildReachableVia, normalizeReachableCandidate, roleRank, isNonReachableRole, NON_REACHABLE_ROLES, isWeakAssociationRole, WEAK_ASSOCIATION_ROLES } from '../api/_shared/owner-reachable-via.js';

import {
  classifyLaneRow,
  validateVerdict,
  orgVariantHint,
  isPersonShaped,
  hasOrgMarker,
  isGovernmentBodyName,
  relationshipRoleForContactType,
  VERDICT_ATTACH_PERSON,
  VERDICT_SAME_PARTY,
  VERDICT_REJECT,
} from '../api/_shared/owner-contact-verdict-planner.js';

const person = (over = {}) => ({
  person_id: 'p1', name: 'Eric Dowling', email: 'edowling@boydwatterson.com',
  phone: null, role: 'manager', is_primary: false, verified_at: '2026-01-01T00:00:00Z', ...over,
});

// ---------------------------------------------------------------------------
// Unit 2 — winner selection. THE regression surface.
// ---------------------------------------------------------------------------

test('winner: explicit primary beats a stronger role', () => {
  const { winner } = pickReachableVia([
    person({ person_id: 'aaa', name: 'Strong Role', role: 'managing_member' }),
    person({ person_id: 'zzz', name: 'Flagged Primary', role: 'associated_with', is_primary: true }),
  ]);
  assert.equal(winner.name, 'Flagged Primary');
});

test('winner: role authority beats an email when roles differ', () => {
  const { winner } = pickReachableVia([
    person({ person_id: 'aaa', name: 'Weak Role', role: 'associated_with', email: 'a@x.com' }),
    person({ person_id: 'bbb', name: 'Managing Member', role: 'managing_member', email: null, phone: '(202) 595-9500' }),
  ]);
  assert.equal(winner.name, 'Managing Member');
});

test('winner: with equal roles, an email beats phone-only', () => {
  const { winner } = pickReachableVia([
    person({ person_id: 'aaa', name: 'Phone Only', role: 'manager', email: null, phone: '(202) 595-9500' }),
    person({ person_id: 'bbb', name: 'Has Email', role: 'manager', email: 'b@x.com' }),
  ]);
  assert.equal(winner.name, 'Has Email');
});

test('winner: with equal role and channel, the most recently verified wins', () => {
  const { winner } = pickReachableVia([
    person({ person_id: 'aaa', name: 'Stale', role: 'manager', email: 'a@x.com', verified_at: '2019-01-01T00:00:00Z' }),
    person({ person_id: 'bbb', name: 'Fresh', role: 'manager', email: 'b@x.com', verified_at: '2026-08-01T00:00:00Z' }),
  ]);
  assert.equal(winner.name, 'Fresh');
});

test('winner is DETERMINISTIC — never "first row wins" (the ensureTrueOwner defect)', () => {
  const a = person({ person_id: 'bbb', name: 'Bee', role: 'manager', email: 'b@x.com', verified_at: '2026-01-01T00:00:00Z' });
  const b = person({ person_id: 'aaa', name: 'Ay', role: 'manager', email: 'a@x.com', verified_at: '2026-01-01T00:00:00Z' });
  // Fully tied on every ranked signal: the id tiebreak must decide, and must
  // decide the SAME way regardless of input order.
  assert.equal(pickReachableVia([a, b]).winner.person_id, 'aaa');
  assert.equal(pickReachableVia([b, a]).winner.person_id, 'aaa');
});

test('brokers are EXCLUDED, not merely ranked last', () => {
  for (const role of NON_REACHABLE_ROLES) {
    const { winner } = pickReachableVia([person({ role })]);
    assert.equal(winner, null, 'role ' + role + ' must never be selectable');
  }
  // A broker alongside a real contact must not suppress the real contact.
  const { winner, considered } = pickReachableVia([
    person({ person_id: 'brk', name: 'Listing Broker', role: 'broker', email: 'brk@x.com' }),
    person({ person_id: 'mgr', name: 'Real Manager', role: 'manager', email: 'm@x.com' }),
  ]);
  assert.equal(winner.name, 'Real Manager');
  assert.equal(considered, 1);
});

test('a candidate with no usable channel is not selectable', () => {
  assert.equal(normalizeReachableCandidate(person({ email: null, phone: null })), null);
  assert.equal(normalizeReachableCandidate(person({ email: 'not-an-email', phone: 'call us' })), null);
});

test('TrafficMetrix-class misparse names never become the reachable contact', () => {
  // Prompt 89's exact failure: a street name minted as a person, stamped with
  // the page's one real email. Surfacing it as the decision-maker would put the
  // artifact back in front of the operator through the front door.
  assert.equal(normalizeReachableCandidate(person({ name: 'Collection Street', email: 'x@y.com' })), null);
  assert.equal(normalizeReachableCandidate(person({ name: 'Halleck St N', email: 'x@y.com' })), null);
  // A clean "First Last" must survive — the never-flag guarantee.
  assert.ok(normalizeReachableCandidate(person({ name: 'Richard Ehmer', email: 'x@y.com' })));
});

test('an unknown role is still selectable, just ranked last', () => {
  assert.ok(roleRank('managing_member') < roleRank('associated_with'));
  assert.ok(roleRank('associated_with') < roleRank('wat'));
  assert.ok(!isNonReachableRole('wat'));
  assert.ok(pickReachableVia([person({ role: 'wat' })]).winner);
});

test('buildReachableVia reports an honest via_count and does not leak the org claim', () => {
  const out = buildReachableVia([
    person({ person_id: 'a', name: 'A', role: 'manager', email: 'a@x.com' }),
    person({ person_id: 'b', name: 'B', role: 'member', email: 'b@x.com' }),
    person({ person_id: 'c', name: 'Broker', role: 'broker', email: 'c@x.com' }),
  ]);
  assert.equal(out.name, 'A');
  assert.equal(out.via_count, 2, 'the excluded broker must not be counted');
  assert.equal(out.other_people.length, 1);
  // The descriptor is deliberately its own shape — it must never masquerade as
  // the organization's own contact detail.
  assert.ok(!('subject_email' in out));
  assert.equal(out.person_id, 'a');
});

test('no candidates → null, so the hero falls back to "Find a contact"', () => {
  assert.equal(buildReachableVia([]), null);
  assert.equal(buildReachableVia(null), null);
});

// ---------------------------------------------------------------------------
// Unit 1 — shape-aware verdicts. Every case below is a REAL row from the live
// lane on 2026-08-15.
// ---------------------------------------------------------------------------

const row = (over = {}) => ({
  owner_name: 'Boyd Watterson Asset Management, LLC', contact_name: 'Eric Dowling',
  contact_email: 'edowling@boydwatterson.com', contact_phone: null, contact_type: null, ...over,
});

test('a person-shaped candidate allows attach_person, never same_party', () => {
  const c = classifyLaneRow(row());
  assert.equal(c.shape, 'person');
  assert.deepEqual(c.allowed, [VERDICT_ATTACH_PERSON, VERDICT_REJECT]);
  assert.equal(c.lean, VERDICT_ATTACH_PERSON);
  assert.equal(validateVerdict(row(), 'same_party').ok, false);
});

test('an org-shaped candidate allows same_party, never attach_person', () => {
  // Minting "Easterly Government Properties, Inc." as a PERSON would be the
  // corruption the shape gate exists to prevent.
  const r = row({ owner_name: 'Easterly Gov Properties (REIT)',
    contact_name: 'Easterly Government Properties, Inc.', contact_email: null, contact_phone: '(202) 595-9500' });
  const c = classifyLaneRow(r);
  assert.equal(c.shape, 'org');
  assert.deepEqual(c.allowed, [VERDICT_SAME_PARTY, VERDICT_REJECT]);
  assert.equal(c.lean, VERDICT_SAME_PARTY);
  assert.equal(validateVerdict(r, 'attach_person').ok, false);
  assert.equal(validateVerdict(r, 'same_party').ok, true);
});

test('a transaction counterparty leans REJECT — the lane\'s dominant class', () => {
  const r = row({ owner_name: 'NGP Capital', contact_name: 'CoreCivic, Inc.',
    contact_email: null, contact_phone: '(615) 263-3000', contact_type: 'seller' });
  const c = classifyLaneRow(r);
  assert.equal(c.shape, 'org');
  assert.equal(c.lean, VERDICT_REJECT);
  assert.equal(c.note, 'different_organization');
});

test('"Global Net Lease" is an ORG, not a person (three letter-only tokens)', () => {
  // It passes looksLikePersonName cleanly; only the org-marker check stops a
  // REIT being minted as a human being.
  assert.ok(hasOrgMarker('Global Net Lease'));
  assert.equal(isPersonShaped('Global Net Lease'), false);
  assert.equal(classifyLaneRow(row({ owner_name: 'Elman Investors', contact_name: 'Global Net Lease',
    contact_email: 'Will.Baselj@nmrk.com' })).shape, 'org');
  // Real people must still read as people.
  assert.ok(isPersonShaped('Lee Elman'));
  assert.ok(isPersonShaped('Delos Yancey'));
  assert.ok(isPersonShaped('Mark Cali'));
});

test('a government body is blocked outright — reject only', () => {
  assert.ok(isGovernmentBodyName('U.S. Department of Veterans Affairs'));
  const r = row({ owner_name: 'US Government', contact_name: 'U.S. Department of Veterans Affairs',
    contact_email: null, contact_phone: '(800) 827-1000', contact_type: 'buyer' });
  const c = classifyLaneRow(r);
  assert.equal(c.shape, 'blocked');
  assert.deepEqual(c.allowed, [VERDICT_REJECT]);
  assert.equal(validateVerdict(r, 'attach_person').ok, false);
  assert.equal(validateVerdict(r, 'same_party').ok, false);
});

test('a broker row and a detail-less row are blocked', () => {
  assert.equal(classifyLaneRow(row({ contact_type: 'broker' })).shape, 'blocked');
  assert.equal(classifyLaneRow(row({ contact_email: null, contact_phone: null })).note, 'no_contact_detail');
});

test('orgVariantHint: abbreviation and acronym families', () => {
  assert.equal(orgVariantHint('Four Springs Cap Trust', 'Four Springs Capital Trust').how, 'abbrev');
  assert.equal(orgVariantHint('Sovereign Investment Co', 'Sovereign Investment Company').how, 'abbrev');
  assert.equal(orgVariantHint('Easterly Gov Properties (REIT)', 'Easterly Government Properties, Inc.').how, 'abbrev');
  // The acronym is literally written in both names — the strongest signal, and
  // it must survive the core-substantiality gate that "uirc" (4 chars) fails.
  assert.equal(orgVariantHint('UIRC', 'UIRC, Urban Investment Research Corporation').how, 'shared_acronym');
});

test('orgVariantHint REFUSES the stoplist false positives', () => {
  // The dup-pair-planner core would score these 1.0; the strict core must not.
  assert.equal(orgVariantHint('Agree Realty Corp', 'Agree Holdings LLC').likely, false);
  assert.equal(orgVariantHint('NGP Capital', 'NGP Group').likely, false);
  assert.equal(orgVariantHint('Realty Income Corporation', 'American Realty Capital LLC').likely, false);
});

test('a strict SUBSET name is UNDECIDABLE — no lean either way', () => {
  // "Government Properties Trust" vs "Easterly Government Properties, Inc." are
  // two DIFFERENT REITs; pure token coverage called it an abbreviation until the
  // equal-token-count rule landed. It must lean nothing rather than nudge a
  // human into stamping the wrong company's switchboard onto an owner.
  const hint = orgVariantHint('Government Properties Trust', 'Easterly Government Properties, Inc.');
  assert.equal(hint.likely, false);
  assert.equal(hint.ambiguous, true);
  assert.equal(hint.how, 'subset');
  const c = classifyLaneRow(row({ owner_name: 'Government Properties Trust',
    contact_name: 'Easterly Government Properties, Inc.', contact_email: null, contact_phone: '(202) 595-9500' }));
  assert.equal(c.lean, null);
  assert.equal(c.note, 'org_name_subset_undecidable');
  // Undecidable still offers both verdicts — the human decides, we do not.
  assert.deepEqual(c.allowed, [VERDICT_SAME_PARTY, VERDICT_REJECT]);
});

test('a person named on a transaction role gets NO lean (could be either side)', () => {
  const c = classifyLaneRow(row({ owner_name: 'Elman Investors', contact_name: 'Lee Elman',
    contact_email: 'lee.eii@me.com', contact_type: 'true_seller_contact' }));
  assert.equal(c.shape, 'person');
  assert.equal(c.counterparty, true);
  assert.equal(c.lean, null);
});

test('a bare "confirm" resolves only when one non-reject verdict is legal', () => {
  assert.equal(validateVerdict(row(), 'confirm').verdict, VERDICT_ATTACH_PERSON);
  assert.equal(validateVerdict(row({ owner_name: 'Four Springs Cap Trust',
    contact_name: 'Four Springs Capital Trust', contact_email: null,
    contact_phone: '(877) 449-8828' }), 'confirm').verdict, VERDICT_SAME_PARTY);
  // A blocked row has no non-reject verdict, so a bare confirm is ambiguous.
  assert.equal(validateVerdict(row({ contact_type: 'broker' }), 'confirm').ok, false);
  for (const v of ['reject', 'dismiss', 'keep', 'no']) {
    assert.equal(validateVerdict(row(), v).verdict, VERDICT_REJECT);
  }
});

test('relationship role is conservative — never invents authority', () => {
  assert.equal(relationshipRoleForContactType('landlord'), 'principal');
  assert.equal(relationshipRoleForContactType('manager'), 'manager');
  assert.equal(relationshipRoleForContactType(null), 'prospecting_contact');
  assert.equal(relationshipRoleForContactType('buyer'), 'prospecting_contact');
});


// ───────────────────────────────────────────────────────────────────────────
// P161 — weak-association value gate.
const weakEdge = [{
  person_id: 'p1', name: 'Dana Employee', email: 'dana@bigreit.com',
  role: 'works_at', updated_at: '2026-08-01',
}];
const strongEdge = [{
  person_id: 'p2', name: 'Sam Principal', email: 'sam@smallco.com',
  role: 'manager', updated_at: '2026-08-01',
}];

test('P161: classifies weak vs control roles', () => {
  for (const r of ['works_at', 'associated_with', 'contact']) {
    assert.equal(isWeakAssociationRole(r), true, `${r} is weak`);
  }
  for (const r of ['manager', 'principal', 'managing_member', 'institution_decision_maker']) {
    assert.equal(isWeakAssociationRole(r), false, `${r} proves control`);
  }
});

test('P161: an ABSENT role is weak, never strong — unknown is not a promotion', () => {
  assert.equal(isWeakAssociationRole(''), true);
  assert.equal(isWeakAssociationRole(null), true);
  assert.equal(isWeakAssociationRole(undefined), true);
});

test('P161: ungated behaviour is UNCHANGED when the caller passes no verdict', () => {
  // Backward compatibility: existing callers that never learned about the gate
  // must keep getting a normal descriptor, not a silently gated one.
  const out = buildReachableVia(weakEdge);
  assert.equal(out.gated, undefined);
  assert.equal(out.name, 'Dana Employee');
  assert.equal(out.email, 'dana@bigreit.com');
});

test('P161: gates a weak winner when the DB says the owner is unqualified', () => {
  const out = buildReachableVia(weakEdge, { weakAssociationGated: true, gateReason: 'above_floor' });
  assert.equal(out.gated, true);
  assert.equal(out.gate_reason, 'above_floor');
  // ⚠️ THE POINT OF THE GATE: nothing dialable survives it.
  assert.equal(out.person_id, null);
  assert.equal(out.name, null);
  assert.equal(out.email, null);
  assert.equal(out.phone, null);
  // …but the person is still NAMED, so the operator and the acquisition
  // engine know who we withheld and why.
  assert.equal(out.withheld_name, 'Dana Employee');
  assert.equal(out.withheld_role, 'works_at');
});

test('P161: does NOT gate a control-role winner even if the flag is passed', () => {
  // Belt-and-braces: an owner with a manager edge is never in the worklist, so
  // the two conditions agree by construction. This guards a caller passing the
  // flag for the wrong entity.
  const out = buildReachableVia(strongEdge, { weakAssociationGated: true });
  assert.equal(out.gated, undefined);
  assert.equal(out.name, 'Sam Principal');
  assert.equal(out.email, 'sam@smallco.com');
});

test('P161: returns a GATED DESCRIPTOR, not null — the two are different facts', () => {
  // null means "we found nobody" and routes the panel to a generic
  // "Find a contact". Gated means "we found someone unqualified" and must
  // route to "Find the decision-maker". Collapsing them loses the lead.
  assert.equal(buildReachableVia([], { weakAssociationGated: true }), null);
  assert.notEqual(buildReachableVia(weakEdge, { weakAssociationGated: true }), null);
});

test('P161: REGRESSION: a gated descriptor is truthy but must never render a name', () => {
  // detail-panel-shell.js did `if (dockVia)` then printed dockVia.name in a
  // <b>. A gated object is truthy with name === null, so it printed
  // "Reach via " with an empty bold tag. Both renderers now branch on .gated.
  const out = buildReachableVia(weakEdge, { weakAssociationGated: true });
  assert.ok(out, 'gated descriptor is truthy');
  assert.equal(out.name, null, 'and carries no name — renderers MUST check .gated first');
  const shell = readFileSync(join(root, 'detail-panel-shell.js'), 'utf8');
  assert.match(shell, /dockVia && dockVia\.gated/, 'the dock branches on .gated before rendering');
  const tabs = readFileSync(join(root, 'detail-entity-tabs.js'), 'utf8');
  assert.match(tabs, /via && via\.gated/, 'the hero branches on .gated before "Reach via"');
  assert.match(tabs, /find_decision_maker/, 'and offers a decision-maker action instead');
});

