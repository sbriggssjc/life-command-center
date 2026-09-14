// P140 — the dormant OWNERSHIP_CHAIN_ROLE_LABELS layer must be GRADEABLE before
// it is flipped, and the grade must show the rejects.
//
// What these pin is that the dry run cannot flatter the model: the applier and
// the grader reach the SAME verdict (one owner per decision), the grader mutates
// nothing, a dropped label still reports WHY it was dropped, and the sample is
// spread across chain shapes rather than skimmed off the value-ranked head —
// which is how a homogeneous head gets mistaken for the model's accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  buildChainDraft, applyRoleLabels, gradeRoleLabels, evaluateRoleLabel,
  chainFingerprint, classifyChainShape, affiliateNameOverlap, pickGradeSample,
  OCD_NOMINAL_PRICE_MAX,
} from '../api/_shared/ownership-chain-draft-planner.js';
import { summariseGrade } from '../api/_handlers/ownership-chain-draft-tick.js';

const link = (o = {}) => ({
  ownership_id: o.id || 'x', transfer_date: o.date || '2010-01-01',
  prior_owner: o.from || 'Alpha LLC', new_owner: o.to || 'Beta LLC',
  transfer_price: o.price, data_source: o.src || 'gsa_lease_diff',
  prior_owner_is_clean: true, new_owner_is_clean: true,
  is_self_transition: false, is_oscillating_pair: false, is_name_variant: false,
});

// --------------------------------------------------------------------------
// One owner per decision: the grade must equal what production would do.
// --------------------------------------------------------------------------
test('grader and applier reach the identical verdict on every label', () => {
  const labels = [
    { index: 0, label: 'arms_length_sale', why: 'Alpha LLC conveyed to Beta LLC' },
    { index: 0, label: 'portfolio_trade', why: 'Part of the Blackstone Realty Portfolio' },
    { index: 0, label: 'not_a_label', why: '' },
    { index: 0, label: 'unknown', why: '' },
    { index: 7, label: 'reit_acquisition', why: '' },
  ];
  const graded = gradeRoleLabels(buildChainDraft([link()], {}), labels);
  const applyDraft = buildChainDraft([link()], {});
  const applied = applyRoleLabels(applyDraft, labels);

  assert.equal(graded.summary.would_apply, applied.applied);
  assert.equal(graded.summary.dropped, applied.dropped);
  assert.deepEqual(graded.summary.drop_reasons, applied.drop_reasons);
});

test('the grader mutates nothing — the draft is untouched after grading', () => {
  const d = buildChainDraft([link()], {});
  const snapshot = JSON.parse(JSON.stringify(d.links));
  gradeRoleLabels(d, [{ index: 0, label: 'developer_sale', why: 'Alpha built and sold to Beta' }]);
  assert.deepEqual(d.links, snapshot);
  assert.equal(d.links[0].role_label, undefined, 'grading must never stamp a label');
});

// --------------------------------------------------------------------------
// The drop rate IS the finding — it must be visible, per label and in aggregate.
// --------------------------------------------------------------------------
test('a dropped label is REPORTED with its link, rationale and reason', () => {
  const d = buildChainDraft([link({ from: 'Alpha LLC', to: 'Beta LLC', price: 4_000_000 })], {});
  const g = gradeRoleLabels(d, [
    { index: 0, label: 'portfolio_trade', why: 'Sold with the Blackstone Realty Portfolio' },
  ]);
  assert.equal(g.rows.length, 1, 'the reject is on the sheet, not swallowed');
  const row = g.rows[0];
  assert.equal(row.would_apply, false);
  assert.equal(row.drop_reason, 'why_names_unknown_party');
  assert.equal(row.party_presence, 'fail');
  assert.equal(row.proposed_label, 'portfolio_trade');
  assert.match(row.rationale, /Blackstone/);
  // The link the label was graded against travels with it, or a grader cannot
  // tell a correct label from a plausible one.
  assert.equal(row.link.grantor, 'Alpha LLC');
  assert.equal(row.link.grantee, 'Beta LLC');
  assert.equal(row.link.date, '2010-01-01');
  assert.equal(row.link.price, 4_000_000);
  assert.equal(row.link.data_source, 'gsa_lease_diff');
});

test('party-presence is evaluated even when the label was dropped for another reason', () => {
  // Otherwise the guard's own rate is measurable only on labels that got past
  // every other check — a different, flattering question.
  const v = evaluateRoleLabel(buildChainDraft([link()], {}),
    { index: 0, label: 'nonsense_label', why: 'Brokered by Cushman Wakefield' });
  assert.equal(v.ok, false);
  assert.equal(v.drop_reason, 'label_not_allowed');
  assert.equal(v.party_presence, 'fail', 'the guard verdict is still recorded');
});

test('an absent rationale is "no_rationale", never a silent pass', () => {
  const g = gradeRoleLabels(buildChainDraft([link()], {}), [{ index: 0, label: 'arms_length_sale' }]);
  assert.equal(g.rows[0].party_presence, 'no_rationale');
  assert.equal(g.rows[0].would_apply, true, 'no rationale is not itself a rejection');
});

test('summariseGrade keeps party-presence failures separate from the drop total', () => {
  const agg = summariseGrade([
    {
      chain_shape: 'single_link', chain_unchanged: true, model: { ok: true, provider: 'ollama' },
      grade: gradeRoleLabels(buildChainDraft([link()], {}), [
        { index: 0, label: 'arms_length_sale', why: 'Alpha LLC to Beta LLC' },
        { index: 0, label: 'portfolio_trade', why: 'Part of the Blackstone Portfolio' },
        { index: 4, label: 'reit_acquisition', why: '' },
      ]),
    },
  ]);
  assert.equal(agg.labels_proposed, 3);
  assert.equal(agg.labels_would_apply, 1);
  assert.equal(agg.labels_dropped, 2);
  assert.equal(agg.drop_rate, 0.667);
  // Two drops, but only ONE of them is the party-presence guard; a single total
  // would answer a different question than the one being asked.
  assert.equal(agg.party_presence.fail, 1);
  assert.equal(agg.party_presence_fail_rate, 0.5, '1 fail of 2 rationales actually checked');
  assert.equal(agg.providers.ollama, 1, 'which seam answered is part of the grade');
  assert.equal(agg.chains_altered_by_layer2, 0);
});

test('summariseGrade reports a parse failure rather than counting it as zero labels', () => {
  const agg = summariseGrade([{ model: { ok: true, provider: 'ollama' }, grade: { rows: [], summary: null, parsed: false } }]);
  assert.equal(agg.samples_parse_failed, 1);
  assert.equal(agg.drop_rate, null, 'no proposals means no rate, not a perfect one');
});

// --------------------------------------------------------------------------
// Immutability, PROVEN rather than asserted in a comment.
// --------------------------------------------------------------------------
test('chainFingerprint survives labelling and catches a re-dated or re-named link', () => {
  const d = buildChainDraft([link({ from: 'Alpha LLC', to: 'Beta LLC' })], {});
  const before = chainFingerprint(d);
  applyRoleLabels(d, [{ index: 0, label: 'arms_length_sale', why: 'Alpha LLC to Beta LLC' }]);
  assert.equal(chainFingerprint(d), before, 'a label is additive metadata, not a chain edit');

  d.links[0].date = '2011-01-01';
  assert.notEqual(chainFingerprint(d), before);
  const d2 = buildChainDraft([link()], {});
  d2.links[0].to = 'Gamma Inc';
  assert.notEqual(chainFingerprint(d2), before);
});

// --------------------------------------------------------------------------
// Sample spread. A value-ranked head can be structurally homogeneous.
// --------------------------------------------------------------------------
test('classifyChainShape names what is OBSERVABLE, never the answer under test', () => {
  assert.equal(classifyChainShape(buildChainDraft([link()], {})), 'single_link');
  assert.equal(
    classifyChainShape(buildChainDraft([link({ price: OCD_NOMINAL_PRICE_MAX })], {})),
    'nominal_price', 'a $0/nominal deed is the non-arms-length case the grade must include');
  assert.equal(
    classifyChainShape(buildChainDraft([
      link({ from: 'Brookfield DTLA Fund LLC', to: 'Brookfield Office Properties Inc' })], {})),
    'affiliate_name_overlap', 'the SPE/affiliate case the model must not call arms-length');
  assert.equal(
    classifyChainShape(buildChainDraft([link({ price: 12_000_000 })], {})),
    'priced_transfer', 'a priced link is the arms-length candidate, single or not');
  assert.equal(
    classifyChainShape(buildChainDraft([
      link({ from: 'Alpha LLC', to: 'Beta LLC', date: '2001-01-01' }),
      link({ from: 'Gamma Corp', to: 'Delta Inc', date: '2015-01-01' })], {})),
    'multi_link_gapped');
  assert.equal(
    classifyChainShape(buildChainDraft([
      link({ from: 'Alpha LLC', to: 'Beta LLC', date: '2001-01-01' }),
      link({ from: 'Beta LLC', to: 'Delta Inc', date: '2015-01-01' })], {})),
    'multi_link_contiguous');
});

test('affiliateNameOverlap ignores generic CRE tokens', () => {
  // "Holdings"/"Properties"/"Capital" are shared by thousands of unrelated firms;
  // matching on them would put every multi-link chain in one bucket.
  assert.equal(affiliateNameOverlap({ from: 'Aspen Holdings LLC', to: 'Zenith Holdings LLC' }), null);
  assert.equal(affiliateNameOverlap({ from: 'Carrington Capital LP', to: 'Meridian Capital LP' }), null);
  assert.equal(affiliateNameOverlap({ from: 'Easterly SPE 12 LLC', to: 'Easterly Government Properties' }), 'easterly');
});

test('pickGradeSample spreads across shapes instead of taking the ranked head', () => {
  const cands = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, shape: 'single_link' })),
    { id: 'n1', shape: 'nominal_price' },
    { id: 'a1', shape: 'affiliate_name_overlap' },
    { id: 'g1', shape: 'multi_link_gapped' },
  ];
  const picked = pickGradeSample(cands, 8);
  assert.equal(picked.length, 8);
  const shapes = new Set(picked.map((p) => p.shape));
  assert.equal(shapes.size, 4, 'all four shapes reached the sample');
  // Head-skimming would have produced eight single_link rows and reported the
  // model's accuracy on one shape.
  assert.ok(picked.filter((p) => p.shape === 'single_link').length < 8);
  // Deterministic, so two grading runs are comparable.
  assert.deepEqual(pickGradeSample(cands, 8).map((p) => p.id), picked.map((p) => p.id));
});

test('pickGradeSample drains a bucket it exhausts rather than stalling', () => {
  const picked = pickGradeSample(
    [{ id: 'a', shape: 'x' }, { id: 'b', shape: 'x' }, { id: 'c', shape: 'y' }], 10);
  assert.equal(picked.length, 3);
});

// --------------------------------------------------------------------------
// The dry run must be reachable WITHOUT the flag, and must not write.
// Anchored on stable identity tokens (the query params and the payload key),
// never on a line number or a sliced source region.
// --------------------------------------------------------------------------
test('the grade path is ungated and declares itself unwritten', () => {
  const src = readFileSync(new URL('../api/_handlers/ownership-chain-draft-tick.js', import.meta.url), 'utf8');
  assert.match(src, /forceRoleLabels \|\| roleLabels/,
    'the grade must run with OWNERSHIP_CHAIN_ROLE_LABELS off — the grade is what decides the flip');
  assert.match(src, /role_label_grade/);
  assert.match(src, /written: false/);
  assert.match(src, /forced_by_query/,
    'a populated grade block must say it ran with the flag off');
  // The POST apply path still honours the flag; the grade did not loosen it.
  assert.match(src, /skipped: 'feature_flag_off'/);
});

test('the grade samples the open lane, NOT the undrafted slice', () => {
  // Measured live 2026-08-26: all 545 open lane rows already carry a draft, so
  // the tick's `fresh` (undrafted) slice is EMPTY. Grading off it returns zero
  // samples and renders identically to a clean grade. Layer 2 labels a chain
  // that already exists, so an already-drafted row is the ideal candidate.
  const src = readFileSync(new URL('../api/_handlers/ownership-chain-draft-tick.js', import.meta.url), 'utf8');
  assert.match(src, /prepareTasks\(openRows\.slice\(0, GRADE_LANE_SCAN\), gradeErrors\)/,
    'the grade must prepare from openRows, never from the fresh-only `prepared`');
  assert.match(src, /candidate_source: 'open_lane_including_already_drafted'/,
    'the response must name what it sampled, so an empty grade is diagnosable');
  // The write path is unchanged: it still prepares only the undrafted slice.
  assert.match(src, /const prepared = await prepareTasks\(fresh, scanErrors\)/);
});
