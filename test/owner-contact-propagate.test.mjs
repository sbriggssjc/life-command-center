// test/owner-contact-propagate.test.mjs
// ============================================================================
// BREAK-1 / Prompt 111 — owner-contact propagation.
//
// The whole decision layer is pure, so it is tested directly with no DB. The
// cases below are the ones that decide whether this worker is safe to run
// unattended: it must NEVER stamp a differently-named party's detail onto an
// owner org record, never overwrite curated data, and never let a misparse or a
// fanned-out address through.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  sameParty,
  strictOwnerCore,
  classifyOwnerContact,
  planOwnerPropagation,
  contactFanoutKey,
  BROKER_CONTACT_TYPES,
} from '../api/_shared/owner-contact-propagate-planner.js';

const owner = (over = {}) => ({ id: 'o1', name: 'Easterly Government Properties', email: '', phone: '', ...over });
const contact = (over = {}) => ({
  id: 'c1', name: 'Easterly Government Properties, Inc.', email: '', phone: '(202) 595-9500',
  contact_type: 'buyer', data_source: 'costar_sidebar', domain: 'gov', ...over,
});

// ---------------------------------------------------------------------------
// sameParty — the gate that decides an automatic write
// ---------------------------------------------------------------------------

test('sameParty: legal-form variants of one name collapse', () => {
  assert.equal(sameParty('Easterly Government Properties', 'Easterly Government Properties, Inc.').match, true);
  assert.equal(sameParty('CoreCivic', 'CoreCivic, Inc.').match, true);
  assert.equal(sameParty('Downing Construction Company, Inc.', 'Downing Construction Company Inc').match, true);
});

test('sameParty: genuinely different parties do NOT collapse', () => {
  assert.equal(sameParty('DBB Holdings, Inc.', 'Daniel Brower').match, false);
  assert.equal(sameParty('Blackstone Group', 'Brookfield Properties').match, false);
  // The ladder-collapse case from the panel redesign — must stay distinct.
  assert.equal(sameParty('MDS DV Victorville LLC', 'DaVita Inc.').match, false);
});

test('sameParty: an initials-only core is never auto-matched by similarity', () => {
  // Insubstantial cores must fall through to review rather than score their way
  // into a write ("P & A" vs "B & W" is the classic false positive).
  assert.equal(sameParty('P & A', 'B & W').match, false);
});

// --- The two defects the live dry-run caught (2026-08-15) -------------------
// Both came from reusing dup-pair-planner's `ownerCore`, which strips a
// generic-CRE STOPLIST (realty/capital/income/group/holdings/…). That is right
// for SCORING a fuzzy pair and wrong for asking "same party?".

test('REGRESSION: a name built entirely of stoplist words still matches ITSELF', () => {
  // Under ownerCore, "Realty Income Corporation" reduces to "" and failed to
  // match itself — the live dry-run filed Realty Income Corporation as
  // `name_mismatch` against Realty Income Corporation.
  const r = sameParty('Realty Income Corporation', 'Realty Income Corporation');
  assert.equal(r.match, true);
  assert.equal(r.how, 'name_exact');
  assert.equal(strictOwnerCore('Realty Income Corporation'), 'income realty');
});

test('REGRESSION: two owners sharing one distinctive token do NOT collapse', () => {
  // Under ownerCore both reduce to "agree" and scored 1.0 — an automatic write
  // onto the wrong party. The strict core keeps the distinguishing word.
  const r = sameParty('Agree Realty Corp', 'Agree Holdings LLC');
  assert.equal(r.match, false, 'Agree Realty ≠ Agree Holdings');
  const r2 = sameParty('Capital Partners Group LLC', 'Capital Partners Holdings LLC');
  assert.equal(r2.match, false, 'Group ≠ Holdings — a real distinction');
});

test('strictOwnerCore strips ONLY pure legal forms, keeping semantic tokens', () => {
  assert.equal(strictOwnerCore('Winford Group LLC'), 'group winford');
  assert.equal(strictOwnerCore('Boyd Watterson Asset Management, LLC'), 'asset boyd management watterson');
  assert.equal(strictOwnerCore('CoreCivic, Inc.'), 'corecivic');
});

test('sameParty: empty / missing names never match', () => {
  assert.equal(sameParty('', 'Anything').match, false);
  assert.equal(sameParty('Anything', null).match, false);
  assert.equal(sameParty(undefined, undefined).match, false);
});

// ---------------------------------------------------------------------------
// classifyOwnerContact — one pair
// ---------------------------------------------------------------------------

test('fills the owner org from its own name-matched switchboard contact', () => {
  const d = classifyOwnerContact(owner(), contact());
  assert.equal(d.action, 'fill_org');
  assert.equal(d.reason, 'owner_self_contact');
  assert.equal(d.fields.phone, '(202) 595-9500');
  assert.equal(d.fields.email, undefined);
});

test('NEVER overwrites curated contact detail — fill-blanks only', () => {
  const d = classifyOwnerContact(owner({ phone: '(555) 111-2222' }), contact());
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'nothing_to_fill');
});

test('fills only the blank slot when the owner is half-populated', () => {
  const d = classifyOwnerContact(
    owner({ email: 'curated@easterly.com' }),
    contact({ email: 'other@easterly.com', phone: '(202) 595-9500' }),
  );
  assert.equal(d.action, 'fill_org');
  assert.deepEqual(Object.keys(d.fields), ['phone']);
  assert.equal(d.fields.email, undefined, 'the curated email must not be touched');
});

test('a differently-named party goes to REVIEW, never onto the org record', () => {
  // This is the conflation error sf-account-link.js C1/C2 guards against: a
  // person is RELATED to the org, never stamped AS it.
  const d = classifyOwnerContact(
    owner({ name: 'DBB Holdings, Inc.' }),
    contact({ name: 'Daniel Brower', contact_type: 'landlord' }),
  );
  assert.equal(d.action, 'review');
  assert.equal(d.reason, 'name_mismatch');
  assert.equal(d.evidence.contact_name, 'Daniel Brower');
  assert.equal(d.evidence.owner_name, 'DBB Holdings, Inc.');
});

test('broker-role rows never supply the owner contact detail', () => {
  for (const t of BROKER_CONTACT_TYPES) {
    const d = classifyOwnerContact(owner(), contact({ contact_type: t }));
    assert.equal(d.action, 'skip', `${t} must skip`);
    assert.equal(d.reason, 'broker_role');
  }
});

test('TrafficMetrix-class misparse names route to review, not a write', () => {
  const d = classifyOwnerContact(owner(), contact({ name: 'Collection Street' }));
  assert.equal(d.action, 'review');
  assert.equal(d.reason, 'misparse_name');
});

test('a fanned-out contact detail routes to review', () => {
  const d = classifyOwnerContact(owner(), contact(), { fanout: 25 });
  assert.equal(d.action, 'review');
  assert.equal(d.reason, 'contact_fanout');
  assert.equal(d.evidence.fanout, 25);
});

test('a low fan-out (a genuine multi-property owner) still fills', () => {
  const d = classifyOwnerContact(owner(), contact(), { fanout: 1 });
  assert.equal(d.action, 'fill_org');
});

test('junk contact detail is rejected on SHAPE before anything else', () => {
  const d = classifyOwnerContact(owner(), contact({ email: 'not-an-email', phone: 'see notes' }));
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'no_contact_detail');
});

test('a bare extension is not a phone number', () => {
  const d = classifyOwnerContact(owner(), contact({ phone: 'x412' }));
  assert.equal(d.action, 'skip');
  assert.equal(d.reason, 'no_contact_detail');
});

test('an unnamed owner or contact is skipped, never matched on blanks', () => {
  assert.equal(classifyOwnerContact(owner({ name: '' }), contact()).reason, 'owner_unnamed');
  assert.equal(classifyOwnerContact(owner(), contact({ name: '  ' })).reason, 'contact_unnamed');
});

// ---------------------------------------------------------------------------
// planOwnerPropagation — one owner, many candidate rows
// ---------------------------------------------------------------------------

test('picks the richest candidate and reconciles every other row', () => {
  const candidates = [
    contact({ id: 'a', phone: '(202) 595-9500' }),
    contact({ id: 'b', email: 'ir@easterly.com', phone: '(202) 595-9500' }),
    contact({ id: 'c', name: 'Some Broker', contact_type: 'broker' }),
    contact({ id: 'd', name: 'Jane Doe', phone: '(303) 111-2222' }),
  ];
  const { winner, reviews, skipped } = planOwnerPropagation(owner(), candidates);
  assert.equal(winner.contact.id, 'b', 'email+phone beats phone-only');
  assert.deepEqual(Object.keys(winner.decision.fields).sort(), ['email', 'phone']);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].decision.reason, 'name_mismatch');
  // every input is accounted for: 1 winner + 1 review + 2 skipped (broker,
  // superseded runner-up) === 4
  assert.equal(1 + reviews.length + skipped.length, candidates.length);
  assert.ok(skipped.some((s) => s.decision.reason === 'superseded_by_better_candidate'));
});

test('ranking is deterministic across input order', () => {
  const mk = () => [
    contact({ id: 'z', email: 'a@x.com', phone: '(202) 595-9500' }),
    contact({ id: 'a', email: 'b@x.com', phone: '(202) 595-9500' }),
  ];
  const fwd = planOwnerPropagation(owner(), mk());
  const rev = planOwnerPropagation(owner(), mk().reverse());
  assert.equal(fwd.winner.contact.id, rev.winner.contact.id);
  assert.equal(fwd.winner.contact.id, 'a', 'ties break on contact id, not arrival order');
});

test('an owner with no usable candidate yields no winner and no review', () => {
  const { winner, reviews } = planOwnerPropagation(owner(), [contact({ email: '', phone: '' })]);
  assert.equal(winner, null);
  assert.equal(reviews.length, 0);
});

test('empty / non-array candidates are handled without throwing', () => {
  assert.equal(planOwnerPropagation(owner(), []).winner, null);
  assert.equal(planOwnerPropagation(owner(), null).winner, null);
  assert.equal(planOwnerPropagation(owner(), undefined).winner, null);
});

// ---------------------------------------------------------------------------
// fan-out key
// ---------------------------------------------------------------------------

test('fan-out keys on the email when present, else the digits of the phone', () => {
  assert.equal(contactFanoutKey({ email: 'IR@Easterly.com' }), 'email:ir@easterly.com');
  assert.equal(contactFanoutKey({ phone: '(202) 595-9500' }), 'phone:2025959500');
  // Same number, different formatting → same key, so fan-out is not undercounted.
  assert.equal(contactFanoutKey({ phone: '202.595.9500' }), contactFanoutKey({ phone: '(202) 595-9500' }));
  assert.equal(contactFanoutKey({}), '');
});

// ---------------------------------------------------------------------------
// Structural — the wiring the subroute guard cares about
// ---------------------------------------------------------------------------

test('the propagate route is mounted in server.js AND dispatched in operations.js', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const ops = readFileSync(new URL('../api/operations.js', import.meta.url), 'utf8');
  assert.ok(server.includes("'/api/owner-contact-propagate-tick'"), 'server.js must mount the route');
  assert.ok(ops.includes("_route === 'owner-contact-propagate-tick'"), 'operations.js must dispatch it');
  assert.ok(ops.includes('handleOwnerContactPropagateTick'), 'operations.js must import the handler');
});

test('the worker never loads property-scoped contacts (owner-bound only)', () => {
  // A contact bound to a PROPERTY but not to an owner may be a broker or the
  // prior seller; attributing it to the current owner would be a guess. Assert
  // the read path only ever filters on the two owner keys.
  const src = readFileSync(new URL('../api/_handlers/owner-contact-propagate.js', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(src.includes("fetchBy('recorded_owner_id'"), 'must read recorded_owner-bound contacts');
  assert.ok(src.includes("fetchBy('true_owner_id'"), 'must read true_owner-bound contacts');
  assert.ok(!/contacts\?select=[^']*property_id=in/.test(src), 'must NOT read contacts by property_id');
});

test('GET is the dry-run default — only POST applies', () => {
  const src = readFileSync(new URL('../api/_handlers/owner-contact-propagate.js', import.meta.url), 'utf8');
  assert.ok(/const apply = req\.method === 'POST'/.test(src), 'apply must be gated on POST');
});

test('the apply path re-checks blankness immediately before the PATCH', () => {
  // The planner decided on a snapshot; a curated edit could have landed since.
  const src = readFileSync(new URL('../api/_handlers/owner-contact-propagate.js', import.meta.url), 'utf8');
  assert.ok(src.includes("no_longer_blank"), 'must have a no_longer_blank guard');
  assert.ok(/if \(fields\.email && !String\(row\.email \|\| ''\)\.trim\(\)\)/.test(src));
  assert.ok(/if \(fields\.phone && !String\(row\.phone \|\| ''\)\.trim\(\)\)/.test(src));
});
