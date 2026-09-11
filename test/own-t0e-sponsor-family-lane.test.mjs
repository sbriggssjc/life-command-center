// OWN-T0e (2026-09-09) — the sponsor_family_confirm Decision Center lane.
//
// Layer 1 (behavioural): the pure planner — subject refs, the card, and the
// verdict gate with every refusal the design names (§4). Layer 2 (structural,
// comments stripped): the lane is registered in all four registries, the fetch
// reads the CACHE not the 20 s view, the verdict path carries exactly ONE
// registry write and never touches a portfolio fact / merge / domain table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPONSOR_FAMILY_VERDICTS, SPONSOR_FAMILY_CACHE_TABLE, SPONSOR_FAMILY_REGISTRY_TABLE,
  sponsorTokenIsValid, sponsorFamilySubjectRef, parseSponsorFamilySubjectRef,
  buildSponsorFamilyCard, validateSponsorFamilyVerdict, orderSponsorFamilyRows,
  findSponsorDuplicateTarget, annotateSponsorDuplicates,
} from '../api/_shared/sponsor-family-planner.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

const breadthRow = {
  group_key_id: A, sponsor_id: A, sponsor_name: 'Boyd Watterson', sponsor_side: 'breadth',
  tied_pair: null, sponsor_token: 'boyd', properties: 20, gov_properties: 20, dia_properties: 0,
  annual_rent: '31000000', spe_names: ['Boyd Ashburn LLC', 'BOYD SACRAMENTO GSA, LLC'], spe_ids: [B, C],
  member_ids: [A, B, C], member_names: ['Boyd Watterson', 'Boyd Ashburn LLC', 'BOYD SACRAMENTO GSA, LLC'],
  sponsor_props: 79, spe_props_max: 1, same_party_suspect: false, same_party_pairs: 0,
  already_confirmed: false, also_confirmed_for_contacts: true, token_entities_fleetwide: 129,
  token_is_generic_word: false, refreshed_at: '2026-09-09T11:56:56Z',
};
const tiedRow = {
  group_key_id: A, sponsor_id: null, sponsor_name: null, sponsor_side: 'tied',
  tied_pair: 'NGP ~ NGP V OXFORD MS LLC', sponsor_token: 'ngp', properties: 8, gov_properties: 8, dia_properties: 0,
  annual_rent: '4000000', spe_names: null, spe_ids: null, member_ids: [A, B, C],
  member_names: ['NGP', 'NGP V OXFORD MS LLC', 'NGP V DURHAM NC LLC'],
  sponsor_props: 1, spe_props_max: 1, same_party_suspect: false, same_party_pairs: 0,
  already_confirmed: false, also_confirmed_for_contacts: false, token_entities_fleetwide: 41,
  token_is_generic_word: false,
};

test('subject_ref names the question: sponsor on a decided group, group key on a tied one', () => {
  assert.equal(sponsorFamilySubjectRef(breadthRow), 't0e:' + A + ':boyd');
  assert.equal(sponsorFamilySubjectRef(tiedRow), 't0e:tied:' + A + ':ngp');
  assert.equal(sponsorFamilySubjectRef({ sponsor_side: 'breadth', sponsor_token: 'x' }), null, 'no sponsor id → no ref');
  assert.deepEqual(parseSponsorFamilySubjectRef('t0e:' + A + ':boyd'), { tied: false, sponsor_id: A, sponsor_token: 'boyd' });
  assert.deepEqual(parseSponsorFamilySubjectRef('t0e:tied:' + A + ':ngp'), { tied: true, group_key_id: A, sponsor_token: 'ngp' });
  assert.equal(parseSponsorFamilySubjectRef('t0:' + A + ':boyd.com'), null, 'a Tier 0 ref is a different lane');
});

test('the card carries the design columns, labels the duplicate-entity signal, and never invents a sponsor for a tie', () => {
  const c = buildSponsorFamilyCard(breadthRow);
  assert.equal(c.sponsor_side, 'breadth');
  assert.equal(c.annual_rent, 31000000);
  assert.equal(c.flips_unclassified_rival_pairs, 20);
  assert.equal(c.duplicate_entity_suspect, false);
  assert.equal(c.also_confirmed_for_contacts, true);
  assert.deepEqual(c.member_names, breadthRow.member_names);
  const dup = buildSponsorFamilyCard(Object.assign({}, breadthRow, { spe_props_max: 18 }));
  assert.equal(dup.duplicate_entity_suspect, true, 'an SPE holding >= 2 properties is the duplicate-entity signal');
  const t = buildSponsorFamilyCard(tiedRow);
  assert.equal(t.sponsor_id, null);
  assert.equal(t.sponsor_side, 'tied');
  assert.deepEqual(t.spe_names, []);
});

test('token validity mirrors the registry CHECKs (>= 3 chars, [a-z0-9])', () => {
  assert.equal(sponsorTokenIsValid('boyd'), true);
  assert.equal(sponsorTokenIsValid('ngp'), true);
  assert.equal(sponsorTokenIsValid('ab'), false);
  assert.equal(sponsorTokenIsValid('Boyd'), false);
  assert.equal(sponsorTokenIsValid('boyd-w'), false);
});

test('confirm_family on a decided group takes the card sponsor and refuses a disagreeing client id', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, A);
  assert.equal(ok.sponsor_token, 'boyd');
  const bad = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: B }, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /does not match/);
});

test('confirm_family on a TIED group requires a sponsor pick that is a member', () => {
  const card = buildSponsorFamilyCard(tiedRow);
  const none = validateSponsorFamilyVerdict(card, 'confirm_family', {}, {});
  assert.equal(none.ok, false);
  assert.match(none.error, /sponsor_entity_id required/);
  const stranger = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: '44444444-4444-4444-8444-444444444444' }, {});
  assert.equal(stranger.ok, false);
  assert.match(stranger.error, /not a member/);
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', { sponsor_entity_id: B }, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, B);
});

test('confirm_family refuses on the LIVE facts: already in the registry, or a tombstoned sponsor', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const dup = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: true, sponsor_is_tombstone: false });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already confirmed/);
  const tomb = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: true });
  assert.equal(tomb.ok, false);
  assert.match(tomb.error, /merged away/);
  const badTok = validateSponsorFamilyVerdict(buildSponsorFamilyCard(Object.assign({}, breadthRow, { sponsor_token: 'ab' })),
    'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(badTok.ok, false);
  assert.match(badTok.error, /registry check/);
});

test('a generic-word token does NOT refuse — it is the human call, recorded on the card', () => {
  const card = buildSponsorFamilyCard(Object.assign({}, breadthRow, { sponsor_token: 'realty', token_is_generic_word: true }));
  const ok = validateSponsorFamilyVerdict(card, 'confirm_family', {}, { registry_has: false, sponsor_is_tombstone: false });
  assert.equal(ok.ok, true);
  assert.equal(card.token_is_generic_word, true);
});

test('same_party / not_family / research never need the live facts; same_party validates an optional duplicate id', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  for (const v of ['same_party', 'not_family', 'research']) {
    assert.equal(validateSponsorFamilyVerdict(card, v, {}, undefined).ok, true, v);
  }
  const sp = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: B }, undefined);
  assert.equal(sp.duplicate_entity_id, B);
  const bad = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: '44444444-4444-4444-8444-444444444444' }, undefined);
  assert.equal(bad.ok, false);
  assert.equal(validateSponsorFamilyVerdict(card, 'attach', {}, undefined).ok, false, 'a Tier 0 verdict is not a lane verdict');
});

// ── OWN-T0e-b: same_party + merge_now ─────────────────────────────────────
test('same_party without merge_now is record-only and never names a winner it was not given', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const r = validateSponsorFamilyVerdict(card, 'same_party', { duplicate_entity_id: B }, undefined);
  assert.equal(r.ok, true);
  assert.equal(r.merge_now, false);
  assert.equal(r.sponsor_entity_id, A);
});

test('merge_now requires a named duplicate that is a member, distinct from the sponsor, live, and same-typed', () => {
  const card = buildSponsorFamilyCard(breadthRow);
  const okLive = { sponsor_is_tombstone: false, duplicate_is_tombstone: false, sponsor_type: 'organization', duplicate_type: 'organization' };
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true }, okLive).error, /requires duplicate_entity_id/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: '44444444-4444-4444-8444-444444444444' }, okLive).error, /not a member/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: A }, okLive).error, /is the sponsor itself/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { duplicate_is_tombstone: true })).error, /already merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { sponsor_is_tombstone: true })).error, /merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    Object.assign({}, okLive, { duplicate_type: 'person' })).error, /entity_type differs/);
  const ok = validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B }, okLive);
  assert.equal(ok.ok, true);
  assert.equal(ok.merge_now, true);
  assert.equal(ok.sponsor_entity_id, A, 'winner is the card sponsor');
  assert.equal(ok.duplicate_entity_id, B, 'loser is the named duplicate');
  // a missing type on either side does NOT refuse (unknown is not a mismatch)
  assert.equal(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B },
    { sponsor_type: 'organization', duplicate_type: null }).ok, true);
});

test('merge_now on a TIED group takes the operator-named survivor, which must be a member and not the duplicate', () => {
  const card = buildSponsorFamilyCard(tiedRow);
  const live = { sponsor_type: 'organization', duplicate_type: 'organization' };
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B }, live).error, /sponsor_entity_id required/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: B }, live).error, /is the sponsor itself/);
  assert.match(validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: '44444444-4444-4444-8444-444444444444' }, live).error, /not a member/, 'a stranger survivor is refused');
  const ok = validateSponsorFamilyVerdict(card, 'same_party', { merge_now: true, duplicate_entity_id: B, sponsor_entity_id: C }, live);
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, C);
  assert.equal(ok.duplicate_entity_id, B);
});

test('ordering: breadth-decided groups first, rent desc within, and a null rent sorts last', () => {
  const rows = [
    { sponsor_side: 'tied', annual_rent: 9e9, sponsor_name: 't' },
    { sponsor_side: 'breadth', annual_rent: null, sponsor_name: 'b-null' },
    { sponsor_side: 'breadth', annual_rent: 5, sponsor_name: 'b5' },
    { sponsor_side: 'breadth', annual_rent: 50, sponsor_name: 'b50' },
  ];
  assert.deepEqual(orderSponsorFamilyRows(rows).map((r) => r.sponsor_name), ['b50', 'b5', 'b-null', 't']);
});

// ── OWN-T0e-c: findSponsorDuplicateTarget / annotateSponsorDuplicates ─────────
// A: NGP Capital (sponsor of the family), member D listed as spe_id, spe_props_max
// 2 (so it reads as duplicate_entity_suspect). D also has its OWN breadth card
// (sponsor_id: D) — that is the "NGP Group" shape: a sponsor on its own card who
// is itself listed as an SPE of a DIFFERENT sponsor.
const ngpCapitalRow = {
  group_key_id: A, sponsor_id: A, sponsor_name: 'NGP Capital', sponsor_side: 'breadth',
  sponsor_token: 'ngp', spe_ids: [D], spe_props_max: 2, member_ids: [A, D], spe_names: ['NGP Group'],
};
const ngpGroupOwnCardRow = {
  group_key_id: D, sponsor_id: D, sponsor_name: 'NGP Group', sponsor_side: 'breadth',
  sponsor_token: 'national', spe_ids: [E], spe_props_max: 1, member_ids: [D, E], spe_names: ['NGP Elsewhere LLC'],
};
// A sibling group where the "SPE" holds only 1 property (not a duplicate suspect) —
// must NOT be treated as a target even though C sits in its spe_ids.
const notADuplicateSuspectRow = {
  group_key_id: B, sponsor_id: B, sponsor_name: 'Boyd Watterson', sponsor_side: 'breadth',
  sponsor_token: 'boyd', spe_ids: [C], spe_props_max: 1, member_ids: [B, C], spe_names: ['Boyd Ashburn LLC'],
};
const tiedNoSponsorRow = { group_key_id: E, sponsor_id: null, sponsor_side: 'tied', sponsor_token: 'x', spe_ids: null, spe_props_max: 1 };

test('findSponsorDuplicateTarget: finds the OTHER card listing this id as a duplicate-suspect SPE, never the row\'s own group, never a non-suspect group', () => {
  const rows = [ngpCapitalRow, ngpGroupOwnCardRow, notADuplicateSuspectRow, tiedNoSponsorRow];
  const found = findSponsorDuplicateTarget(D, rows);
  assert.deepEqual(found, { sponsor_id: A, sponsor_token: 'ngp', sponsor_name: 'NGP Capital' });
  // C sits in a group whose spe_props_max is 1 (not >= 2) — no target
  assert.equal(findSponsorDuplicateTarget(C, rows), null);
  // A sponsor with no id, or not present anywhere as an SPE, finds nothing
  assert.equal(findSponsorDuplicateTarget(null, rows), null);
  assert.equal(findSponsorDuplicateTarget(A, rows), null, 'A is a sponsor, never listed as anyone\'s SPE');
  assert.equal(findSponsorDuplicateTarget(B, rows), null, 'B is the sponsor of its OWN group — must not match itself');
});

test('annotateSponsorDuplicates: only the row whose sponsor is duplicate-suspect elsewhere gets the three fields; tied rows and rows with no match are untouched', () => {
  const rows = [ngpCapitalRow, ngpGroupOwnCardRow, notADuplicateSuspectRow, tiedNoSponsorRow];
  const out = annotateSponsorDuplicates(rows);
  const byToken = Object.fromEntries(out.map((r) => [r.sponsor_token, r]));
  assert.equal(byToken.national.duplicate_of_sponsor_id, A);
  assert.equal(byToken.national.duplicate_of_sponsor_token, 'ngp');
  assert.equal(byToken.national.duplicate_of_sponsor_name, 'NGP Capital');
  assert.equal(byToken.ngp.duplicate_of_sponsor_id, undefined, 'the sponsor doing the pointing is not itself annotated');
  assert.equal(byToken.boyd.duplicate_of_sponsor_id, undefined);
  assert.equal(byToken.x.duplicate_of_sponsor_id, undefined, 'a tied row (no sponsor_id) is passed through unchanged');
  assert.equal(annotateSponsorDuplicates([]).length, 0);
});

test('buildSponsorFamilyCard carries duplicate_of_sponsor_* through from an annotated row, null when absent', () => {
  const annotated = annotateSponsorDuplicates([ngpCapitalRow, ngpGroupOwnCardRow])
    .find((r) => r.sponsor_token === 'national');
  const card = buildSponsorFamilyCard(annotated);
  assert.equal(card.duplicate_of_sponsor_id, A);
  assert.equal(card.duplicate_of_sponsor_name, 'NGP Capital');
  const plainCard = buildSponsorFamilyCard(breadthRow);
  assert.equal(plainCard.duplicate_of_sponsor_id, null);
});

// ── OWN-T0e-c: merge_into_sponsor verdict gate ────────────────────────────────
test('merge_into_sponsor refuses a tied group, a card with no target, and self-target', () => {
  const tiedCard = buildSponsorFamilyCard(tiedRow);
  assert.match(validateSponsorFamilyVerdict(tiedCard, 'merge_into_sponsor', {}, {}).error, /tied group/);
  const noTargetCard = buildSponsorFamilyCard(breadthRow); // no duplicate_of_sponsor_id
  assert.match(validateSponsorFamilyVerdict(noTargetCard, 'merge_into_sponsor', {}, {}).error, /no recognized duplicate-of target/);
  const selfCard = buildSponsorFamilyCard(Object.assign({}, breadthRow, { duplicate_of_sponsor_id: breadthRow.sponsor_id }));
  assert.match(validateSponsorFamilyVerdict(selfCard, 'merge_into_sponsor', {}, {}).error, /is the card's own sponsor/);
});

test('merge_into_sponsor refuses on LIVE tombstone/type facts and never accepts a client-supplied target', () => {
  const card = buildSponsorFamilyCard(Object.assign({}, breadthRow,
    { duplicate_of_sponsor_id: D, duplicate_of_sponsor_token: 'ngp', duplicate_of_sponsor_name: 'NGP Capital' }));
  const okLive = { sponsor_is_tombstone: false, duplicate_is_tombstone: false, sponsor_type: 'organization', duplicate_type: 'organization' };
  assert.match(validateSponsorFamilyVerdict(card, 'merge_into_sponsor', {}, Object.assign({}, okLive, { sponsor_is_tombstone: true })).error, /already merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'merge_into_sponsor', {}, Object.assign({}, okLive, { duplicate_is_tombstone: true })).error, /target is merged away/);
  assert.match(validateSponsorFamilyVerdict(card, 'merge_into_sponsor', {}, Object.assign({}, okLive, { duplicate_type: 'person' })).error, /entity_type differs/);
  const ok = validateSponsorFamilyVerdict(card, 'merge_into_sponsor', {}, okLive);
  assert.equal(ok.ok, true);
  assert.equal(ok.sponsor_entity_id, D, 'winner is the TARGET named on the card');
  assert.equal(ok.duplicate_entity_id, A, 'loser is THIS card\'s own sponsor');
  assert.equal(ok.merge_now, true);
  // a client-supplied target is IGNORED entirely — the card's own annotation
  // is the only source (P188); passing a different id changes nothing
  const spoofed = validateSponsorFamilyVerdict(card, 'merge_into_sponsor',
    { sponsor_entity_id: '99999999-9999-4999-8999-999999999999' }, okLive);
  assert.equal(spoofed.sponsor_entity_id, D, 'payload cannot redirect the merge target');
});

test('SPONSOR_FAMILY_VERDICTS names all five, merge_into_sponsor included', () => {
  assert.deepEqual([...SPONSOR_FAMILY_VERDICTS], ['confirm_family', 'same_party', 'merge_into_sponsor', 'not_family', 'research']);
});

// ── structural ──────────────────────────────────────────────────────────────
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const admin = strip(readFileSync(new URL('../api/admin.js', import.meta.url), 'utf8'));

function block(src, startNeedle, endRe) {
  const start = src.indexOf(startNeedle);
  assert.ok(start > 0, 'missing ' + startNeedle);
  const rest = src.slice(start);
  const m = endRe.exec(rest);
  assert.ok(m, 'no end for ' + startNeedle);
  return rest.slice(0, m.index);
}

test('registered in all four registries (admin set, ops set, lane meta + tile, review lane map)', () => {
  const ops = strip(readFileSync(new URL('../ops.js', import.meta.url), 'utf8'));
  const dc = strip(readFileSync(new URL('../dc-lanes.js', import.meta.url), 'utf8'));
  const rs = strip(readFileSync(new URL('../review-shared.js', import.meta.url), 'utf8'));
  assert.match(admin, /'sponsor_family_confirm',/);
  assert.match(admin, /case 'sponsor_family_confirm': return sponsorFamilySubjectRef\(s\);/);
  assert.match(ops, /'sponsor_family_confirm',\n\]\);/, 'in _DC_FEDERATED');
  assert.match(ops, /\{ dt: 'sponsor_family_confirm', label: [^}]+renderFederatedLane\('sponsor_family_confirm'\)/);
  assert.match(dc, /sponsor_family_confirm: \{ title:/);
  assert.match(dc, /_dcFedType === 'sponsor_family_confirm'/);
  assert.match(dc, /onclick="dcSponsorFamilyConfirm\(/);
  assert.match(dc, /window\.dcSponsorFamilyConfirm = dcSponsorFamilyConfirm/);
  assert.match(dc, /nx\.action === 'merge_lane'/, 'same_party forwards to the merge lane');
  assert.match(dc, /window\.dcSponsorFamilyMergeNow = dcSponsorFamilyMergeNow/, 'OWN-T0e-b merge-now helper exported');
  assert.match(dc, /const payload = \{ merge_now: true, duplicate_entity_id: dup \}/, 'merge_now rides the payload with the named duplicate');
  assert.match(dc, /if \(typeof window\.confirm === 'function' && !window\.confirm\([^\n]*\) return;/, 'a second confirm guards the one entity-moving verdict');
  assert.match(rs, /sponsor_family_confirm:\s*\{ lane: 'ownership'/);
  // OWN-T0e-c
  assert.match(dc, /window\.dcSponsorFamilyMergeIntoSponsor = dcSponsorFamilyMergeIntoSponsor/, 'the reverse-direction merge helper is exported');
  assert.match(dc, /dcFed\(i, 'merge_into_sponsor', \{\}\)/, 'the payload carries nothing — the target is never client-supplied');
  assert.match(dc, /c\.duplicate_of_sponsor_id \? '<button class="q-action" onclick="dcSponsorFamilyMergeIntoSponsor\(/, 'the button only renders when the card carries a target');
});

test('the fetch branch reads the CACHE table, never the 20 s view, and re-derives already_confirmed live', () => {
  const b = block(admin, "if (type === 'sponsor_family_confirm') {", /\n {2}if \(type === 'owner_reconcile'\)/);
  assert.match(b, /SPONSOR_FAMILY_CACHE_TABLE \+ '\?select=\*&limit=1000'/);
  assert.doesNotMatch(b, /v_lcc_ownt0e_sponsor_family_proposals\b/, 'the view is not a request path');
  assert.match(b, /SPONSOR_FAMILY_REGISTRY_TABLE \+ '\?select=sponsor_entity_id,sponsor_token/);
  assert.match(b, /rows\.filter\(\(r\) => !\(r\.sponsor_id && reg\.has\(String\(r\.sponsor_id\)/, 'registry membership filters the list');
  assert.match(b, /cache_truncated: rows\.length >= 1000/, 'a full page is flagged, never read as a total');
  assert.match(b, /orderSponsorFamilyRows\(/);
  assert.match(b, /out\.complete = out\.items\.length === ordered\.length/);
  assert.equal(SPONSOR_FAMILY_CACHE_TABLE, 'lcc_ownt0e_sponsor_family_proposals_cache');
  assert.equal(SPONSOR_FAMILY_REGISTRY_TABLE, 'lcc_ownership_sponsor_family');
  // OWN-T0e-c: annotated over the WHOLE population BEFORE ordering/paging, so a
  // duplicate target anywhere in the lane is found regardless of which page a
  // card lands on.
  assert.match(b, /annotateSponsorDuplicates\(live\)/);
  assert.match(b, /orderSponsorFamilyRows\(annotated\)/);
  assert.match(b, /sponsor_is_duplicate_of: ordered\.filter\(\(r\) => r\.duplicate_of_sponsor_id\)\.length/);
});

test('OWN-T0e-c merge_into_sponsor never trusts a client-supplied target — the target is re-derived LIVE from the cache (P188)', () => {
  const b = block(admin, "if (decision.decision_type === 'sponsor_family_confirm') {", /\n {4}return res\.status\(400\)\.json\(\{ error: 'unsupported_decision_type'/);
  assert.match(b, /verdict === 'merge_into_sponsor' && !tied && card\.sponsor_id/, 'the re-derivation runs for this verdict only');
  assert.match(b, /spe_ids=cs\.\{' \+ pgFilterVal\(card\.sponsor_id\)/, 'reads the cache CONTAINS filter on this card\'s own sponsor_id');
  assert.match(b, /sponsor_side=eq\.breadth&spe_props_max=gte\.2/, 'same duplicate-suspect gate as the pure annotator');
  assert.match(b, /sponsor_id=neq\.' \+ pgFilterVal\(card\.sponsor_id\)/, 'excludes this card\'s own group');
  assert.doesNotMatch(b, /candidateSponsor = mergeIntoSponsor \? \(payload\./, 'the winner never comes from the request payload for this verdict');
});

test('the verdict path carries exactly TWO merge writers (same_party+merge_now, and OWN-T0e-c merge_into_sponsor) — a POST to the registry, and nothing else', () => {
  const b = block(admin, "if (decision.decision_type === 'sponsor_family_confirm') {", /\n {4}return res\.status\(400\)\.json\(\{ error: 'unsupported_decision_type'/);
  const posts = (b.match(/opsQuery\('POST', [^,]+/g) || []).map((x) => x.replace(/\s+$/, ''));
  const countOf = (needle) => posts.filter((p) => p === needle).length;
  // OWN-T0e-b added same_party's merge path; OWN-T0e-c adds a SECOND, structurally
  // identical merge_into_sponsor call site (the reverse direction) — two lcc_merge_entity
  // call sites now, never a loop over either. Each carries its own pair of soft refreshes.
  assert.equal(countOf("opsQuery('POST', 'rpc/lcc_merge_entity'"), 2, 'exactly two merge call sites: same_party+merge_now, merge_into_sponsor');
  assert.equal(countOf("opsQuery('POST', 'rpc/lcc_refresh_buyer_spe_resolved'"), 2);
  assert.equal(countOf("opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved'"), 2);
  assert.equal(countOf("opsQuery('POST', SPONSOR_FAMILY_REGISTRY_TABLE"), 1, 'exactly ONE registry write, confirm_family only');
  assert.equal(posts.length, 7, 'no other write exists on this decision type (2+2+2+1)');
  assert.match(b, /\{ p_loser: gate\.duplicate_entity_id, p_winner: gate\.sponsor_entity_id \}/, 'loser = named duplicate, winner = sponsor');
  assert.match(b, /if \(action === 'same_party' && gate\.merge_now\)/, 'merge only on the planner\'s merge_now');
  assert.match(b, /if \(action === 'merge_into_sponsor'\)/, 'OWN-T0e-c has its own execution branch');
  assert.match(b, /duplicate_is_tombstone: candidateDup \? \(!dupEnt \|\| dupEnt\.merged_into_entity_id != null\)/, 'loser liveness read live');
  assert.match(b, /entity_type&id=eq\./, 'entity_type read live for the same-type guard');
  assert.equal((b.match(/opsQuery\('(PATCH|DELETE)'/g) || []).length, 0, 'no PATCH/DELETE');
  assert.equal((b.match(/domainQuery\(/g) || []).length, 0, 'no gov/dia write');
  assert.doesNotMatch(b, /lcc_entity_portfolio_facts|recorded_owners|true_owners/);
  // live guards are READ before the gate runs, and the gate is the planner's
  assert.match(b, /entities\?select=id,merged_into_entity_id,entity_type&id=eq\./);
  assert.match(b, /validateSponsorFamilyVerdict\(card, verdict, payload, live\)/);
  // the card is re-read from the cache by the SAME key the subject_ref names
  assert.match(b, /SPONSOR_FAMILY_CACHE_TABLE \+ '\?select=\*'/);
  assert.match(b, /sponsor_is_tombstone: !ent \|\| ent\.merged_into_entity_id != null/, 'unreadable entity fails CLOSED');
  // the registry row carries the decision id so DELETE-by-notes reverses it
  assert.match(b, /notes = 'decision:' \+ decisionId/);
  assert.match(b, /token_is_generic_word: card\.token_is_generic_word/, 'generic-token confirms are recorded, not refused');
});

test('the migration restates the whole view, appends the three id columns LAST, and locks the cache to service_role', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260909120000_lcc_own_t0e_proposals_member_ids.sql', import.meta.url), 'utf8')
    .replace(/^\s*--.*$/gm, '');
  assert.match(sql, /create or replace view public\.v_lcc_ownt0e_sponsor_family_proposals as/);
  assert.match(sql, /lcc_ownership_sponsor_token\(/, 'the ONE sanctioned proposer');
  assert.match(sql, /g\.member_ids,\s*\n\s*g\.spe_ids,\s*\n\s*g\.member_names\s*\nfrom grp g/, 'appended last');
  assert.match(sql, /create table if not exists public\.lcc_ownt0e_sponsor_family_proposals_cache/);
  assert.match(sql, /revoke all on table public\.lcc_ownt0e_sponsor_family_proposals_cache from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.lcc_ownt0e_refresh_proposals\(\) from public, anon, authenticated/);
  assert.match(sql, /cron\.schedule\('lcc-ownt0e-proposals-refresh', '27 \*\/4 \* \* \*'/);
  // invoker-rights: the function header runs straight from `returns int` to `language plpgsql`
  // to `as $fn$` with no definer clause (the COMMENT names "SECURITY DEFINER" while saying
  // it is absent — so the assertion reads the header, not the file, per OCR1c)
  assert.match(sql, /lcc_ownt0e_refresh_proposals\(\)\s*\nreturns int\s*\nlanguage plpgsql\s*\nas \$fn\$/);
  // read-side only: no registry insert, no merge CALL, no fact update. The view
  // COMMENT names lcc_merge_entity in prose, so the merge check is on a call shape.
  // (the view COMMENT says "a confirm is one human INSERT into lcc_ownership_sponsor_family"
  //  in prose, so the check is on the STATEMENT shape — a column list or VALUES after the name)
  assert.doesNotMatch(sql, /insert into (public\.)?lcc_ownership_sponsor_family\s*(\(|values|select)/i, 'no registry write');
  assert.doesNotMatch(sql, /(select|perform)\s+lcc_merge_entity\(/i, 'no merge call');
  assert.doesNotMatch(sql, /update (public\.)?lcc_entity_portfolio_facts/i, 'no fact update');
});
