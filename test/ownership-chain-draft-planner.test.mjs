// P131 — ownership-chain drafter: the pure planner's guarantees.
//
// What these pin is the SAFETY of the draft, not its prettiness: a guarded link
// never reaches the chain, a break is reported rather than bridged, and the
// optional local-model layer can only ever LABEL a link it did not create.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChainDraft, guardTransition, chainNameKey, renderChainDraftText,
  applyRoleLabels, parseRoleLabels, introducesUnknownParty, ocdSubjectRef,
  OCD_VERDICT_LINK, OCD_VERDICT_RESEARCH,
} from '../api/_shared/ownership-chain-draft-planner.js';

const link = (o = {}) => ({
  ownership_id: o.id || 'x', transfer_date: o.date || '2010-01-01',
  prior_owner: o.from || 'Alpha LLC', new_owner: o.to || 'Beta LLC',
  prior_owner_is_clean: true, new_owner_is_clean: true,
  is_self_transition: false, is_oscillating_pair: false, is_name_variant: false,
  ...o.over,
});

test('chainNameKey lowercases BEFORE stripping non-alphanumerics', () => {
  // The SQL form of this bug (strip [^a-z0-9] from raw text) deletes every
  // uppercase letter, collapsing ALL-CAPS names to '' so they compare equal to
  // each other. An ALL-CAPS name must keep its material.
  assert.equal(chainNameKey('YUKON MEDICAL VA LLC'), 'yukonmedicalvallc');
  assert.notEqual(chainNameKey('YUKON MEDICAL VA LLC'), '');
  assert.equal(chainNameKey('Boyd Watterson, LLC'), chainNameKey('BOYD WATTERSON LLC'));
});

test('chainNameKey does NOT strip semantic tokens (identity, not fuzzy pairing)', () => {
  // The loose normalizers are banned for identity: "Century Park Partners" and
  // "Century Park Properties" must NOT compare equal here.
  assert.notEqual(chainNameKey('Century Park Partners'), chainNameKey('Century Park Properties'));
});

test('every P138 guard rejects its link', () => {
  assert.equal(guardTransition(link()), null);
  assert.equal(guardTransition(link({ over: { transfer_date: null } })), 'undated');
  assert.equal(guardTransition(link({ over: { is_self_transition: true } })), 'self_transition');
  assert.equal(guardTransition(link({ over: { is_oscillating_pair: true } })), 'oscillating_pair');
  assert.equal(guardTransition(link({ over: { is_name_variant: true } })), 'name_variant');
  assert.equal(guardTransition(link({ over: { new_owner_is_clean: false } })), 'new_owner_unclean');
  assert.equal(guardTransition(link({ over: { prior_owner_is_clean: false } })), 'prior_owner_unclean');
  assert.equal(guardTransition(link({ over: { new_owner: '' } })), 'party_missing');
});

test('a self-transition is caught even when the remote flag says otherwise', () => {
  // The view computes these flags; we re-derive rather than trust a remote
  // boolean, because a guard that silently stops applying looks like one that passes.
  const t = link({ from: 'Alpha LLC', to: 'ALPHA, LLC', over: { is_self_transition: false } });
  assert.equal(guardTransition(t), 'self_transition');
});

test('draft orders by date, dedups repeats, and reports gaps instead of bridging them', () => {
  const d = buildChainDraft([
    link({ id: 'c', from: 'Gamma Corp', to: 'Delta Inc', date: '2018-03-01' }),
    link({ id: 'a', from: 'Alpha LLC', to: 'Beta LLC', date: '2001-01-01' }),
    link({ id: 'a2', from: 'Alpha LLC', to: 'Beta LLC', date: '2001-01-01' }), // duplicate
  ], { current_owner_name: 'Delta Inc' });

  assert.equal(d.draftable, true);
  assert.equal(d.verdict, OCD_VERDICT_LINK);
  assert.equal(d.links.length, 2, 'duplicate collapsed');
  assert.equal(d.links[0].date, '2001-01-01', 'ordered ascending');
  // Beta LLC -> Gamma Corp is an unrecorded hand-off: reported, never invented.
  assert.equal(d.links[1].gap_before, true);
  assert.equal(d.continuity.breaks, 1);
  assert.equal(d.terminates_at_current_owner, true);
  const txt = renderChainDraftText(d, {});
  assert.match(txt, /Not on file/, 'the gap is stated in the rendered draft');
  assert.ok(!/Gamma Corp\s+→\s+Gamma/.test(txt));
});

test('no usable transition => research verdict with a NAMED reason, never an empty draft', () => {
  const none = buildChainDraft([], {});
  assert.equal(none.draftable, false);
  assert.equal(none.verdict, OCD_VERDICT_RESEARCH);
  assert.equal(none.insufficient_reason, 'no_transitions_on_file');
  assert.equal(none.links.length, 0);

  const guarded = buildChainDraft([link({ over: { is_oscillating_pair: true } })], {});
  assert.equal(guarded.draftable, false);
  assert.equal(guarded.insufficient_reason, 'all_transitions_guarded');
  assert.match(guarded.reason, /oscillating_pair/, 'the reason names what was rejected');

  const undated = buildChainDraft([link({ over: { transfer_date: null } })], {});
  assert.equal(undated.insufficient_reason, 'no_dated_transition');
});

test('a chain that does not land on the current owner is flagged, not silently accepted', () => {
  const d = buildChainDraft([link({ from: 'Alpha LLC', to: 'Beta LLC' })], { current_owner_name: 'Zeta Trust' });
  assert.equal(d.terminates_at_current_owner, false);
  assert.match(d.reason, /does not match the current owner/);
  assert.ok(d.confidence < 0.8);
});

test('confidence never reaches certainty', () => {
  const perfect = buildChainDraft([
    link({ from: 'A Co', to: 'B Co', date: '2001-01-01' }),
    link({ from: 'B Co', to: 'C Co', date: '2005-01-01' }),
  ], { current_owner_name: 'C Co' });
  assert.equal(perfect.continuity.breaks, 0);
  assert.ok(perfect.confidence <= 0.95, `got ${perfect.confidence}`);
  assert.ok(perfect.confidence > 0.8);
});

test('a single link is not described as a contiguous chain', () => {
  const d = buildChainDraft([link({ from: 'A Co', to: 'B Co' })], { current_owner_name: 'B Co' });
  assert.ok(!/contiguous/i.test(d.reason), 'nothing was checked, so nothing is claimed');
});

test('subject_ref normalizes the long-form domain aliases', () => {
  assert.equal(ocdSubjectRef('government', 7296), 'chaindraft:gov:7296');
  assert.equal(ocdSubjectRef('dialysis', 12), 'chaindraft:dia:12');
});

// ---- Layer 2 (local model) — additive labels only ---------------------------

test('role labels cannot add, remove or alter a link', () => {
  const d = buildChainDraft([link({ from: 'Alpha LLC', to: 'Beta LLC' })], {});
  const before = JSON.parse(JSON.stringify(d.links));
  const out = applyRoleLabels(d, [
    { index: 0, label: 'reit_acquisition', why: 'Beta LLC acquired from Alpha LLC' },
    { index: 9, label: 'developer_sale', why: 'out of range' },
    { index: 0, label: 'not_a_real_label', why: 'bad vocab' },
  ]);
  assert.equal(out.applied, 1);
  assert.equal(out.dropped, 2);
  assert.equal(out.drop_reasons.bad_index, 1);
  assert.equal(out.drop_reasons.label_not_allowed, 1);
  assert.equal(d.links.length, before.length, 'no link added or removed');
  assert.equal(d.links[0].from, before[0].from);
  assert.equal(d.links[0].date, before[0].date);
  assert.equal(d.links[0].role_label, 'reit_acquisition');
});

test('a label whose rationale names a party not in the link is dropped', () => {
  const d = buildChainDraft([link({ from: 'Alpha LLC', to: 'Beta LLC' })], {});
  const out = applyRoleLabels(d, [
    { index: 0, label: 'portfolio_trade', why: 'Sold as part of the Blackstone Realty Portfolio' },
  ]);
  assert.equal(out.applied, 0);
  assert.equal(out.drop_reasons.why_names_unknown_party, 1);
  assert.equal(d.links[0].role_label, undefined);
});

test('"unknown" is dropped rather than stored as a finding', () => {
  const d = buildChainDraft([link()], {});
  const out = applyRoleLabels(d, [{ index: 0, label: 'unknown', why: '' }]);
  assert.equal(out.applied, 0);
  assert.equal(out.drop_reasons.unknown_label, 1);
});

test('introducesUnknownParty tolerates the link parties and catches new ones', () => {
  const l = { from: 'Alpha Holdings LLC', to: 'Beta Realty Trust' };
  assert.equal(introducesUnknownParty('Alpha Holdings sold to Beta Realty', l), false);
  assert.equal(introducesUnknownParty('Brokered by Cushman Wakefield', l), true);
});

test('malformed model output degrades to no labels, never to a broken draft', () => {
  assert.equal(parseRoleLabels(''), null);
  assert.equal(parseRoleLabels('not json'), null);
  assert.equal(parseRoleLabels('{"labels": "nope"}'), null);
  const d = buildChainDraft([link()], {});
  const out = applyRoleLabels(d, parseRoleLabels('garbage'));
  assert.equal(out.applied, 0);
  assert.equal(d.draftable, true, 'Layer 1 survives a Layer 2 failure');
});
