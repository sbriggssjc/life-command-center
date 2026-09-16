// ============================================================================
// OWNERGAP2 — guards for the first BUILD in the owner arc.
//
// What these tests pin, in the order the task asks for it:
//   §3.1 address RANGES     — including the CONTAINMENT half a prefix rule
//                             cannot reach, and a case the matcher must REFUSE
//   §3.2 street ALIASES     — the explicit list, and that an alias widens the
//                             SEARCH without widening what may be WRITTEN
//   §3.3 multi-parcel       — refused, never guessed
//   §4   ambiguity rules    — all three, as real assertions
//   §1   provenance         — a write without a citation must FAIL
//
// FIXTURES ARE LIVE BYTES. `test/fixtures/ownergap2-live-samples.json` holds
// the rows the production query actually returned from phl.carto.com on
// 2026-09-16 (routed via Dialysis_DB pg_net, since this sandbox has no egress
// to that host). `npm test` is hermetic by guard — test/_helpers/net-guard.mjs
// throws on any non-loopback host — so nothing here reaches a real host.
//
// ⚠️ Comments are stripped before any source assertion: every fix in this arc
// explains itself by NAMING the token it removed (`\\s*([A-Z])?`, `ABC INC`,
// `ilike '%harris%'`), so a raw-source grep would match the explanation and
// pass over a complete revert (A5c / N18 / UXT0).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeAddress, parseSourceLocation, expandRangeEnd, locationMatches,
  resolveOwnerFromCandidates, streetKeysFor, ownerIdentityKey, STREET_ALIASES,
} from '../api/_shared/ownergap2-address-match.js';
import {
  PHILADELPHIA, HARRIS, buildPhlQuery, buildHarrisCandidates,
  resolveOwnerForProperty, isHarrisRealPropertyAccount,
  isHarrisPersonalPropertyAccount, PHL_ROW_LIMIT,
} from '../api/_shared/ownergap2-sources.js';
import {
  assertCitation, planOwnerWrite, matchedNameIsOperator,
  wouldTripFabricationGuard, applyOwnerResolution,
} from '../api/_shared/ownergap2-owner-writeback.js';

const ROOT = new URL('..', import.meta.url).pathname;
const FIX = JSON.parse(readFileSync(new URL('./fixtures/ownergap2-live-samples.json', import.meta.url), 'utf8'));

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1');
}
function stripSqlComments(src) {
  return src.replace(/^\s*--.*$/gm, ' ').replace(/(\S)\s--.*$/gm, '$1');
}
function phlCandidates(addr) {
  const entry = FIX.philadelphia[addr];
  assert.ok(entry, `fixture missing for ${addr}`);
  return entry.rows.map((r) => ({
    owner: r.owner_1, ownerSecondary: r.owner_2 ?? null, location: r.location,
    sourceRecordId: r.parcel_number,
    sourceRecordKind: 'opa_account_number',
    sourceQuery: 'SELECT ... FROM opa_properties_public WHERE ...',
    sourceUrl: 'https://phl.carto.com/api/v2/sql',
  }));
}
function resolvePhl(addr) {
  return resolveOwnerFromCandidates(
    normalizeAddress(addr, PHILADELPHIA), phlCandidates(addr), { jurisdiction: PHILADELPHIA });
}

// ── §3.1 ADDRESS RANGES ─────────────────────────────────────────────────────

test('range end is TRUNCATED, not literal: 800-34 means 800..834', () => {
  assert.equal(expandRangeEnd('800', '34'), 834);
  assert.equal(expandRangeEnd('7601', '51'), 7651);
  assert.equal(expandRangeEnd('4182', '90'), 4190);
  assert.equal(expandRangeEnd('3817', '39'), 3839);
  // Reading the suffix literally gives 34 / 51 / 90 — an inverted range that
  // matches nothing and reads as "the city has no record".
  assert.notEqual(expandRangeEnd('800', '34'), 34);
});

test('range end CARRIES when the reconstruction falls below the start', () => {
  // 798-02 is 798..802, not 798..702.
  assert.equal(expandRangeEnd('798', '02'), 802);
  assert.ok(expandRangeEnd('798', '02') > 798);
});

test('a full-width range end is read literally, not re-truncated', () => {
  assert.equal(expandRangeEnd('1438', '1446'), 1446);
});

test('PREFIX range resolves (4126 Walnut St -> 4126-38 WALNUT ST)', () => {
  const v = resolvePhl('4126 Walnut St');
  assert.equal(v.status, 'resolved');
  assert.equal(v.owner, 'UNIV CITY ASSOCIATES');
  assert.equal(v.matchArm, 'range_start');
});

test('CONTAINMENT range resolves — the half a prefix rule cannot reach', () => {
  // 3823 does not START 3817-39. OWNERGAP1 §8 prescribed "house-number-prefix
  // + street", which is structurally unable to find this row.
  const v = resolvePhl('3823 Market St');
  assert.equal(v.status, 'resolved');
  assert.equal(v.owner, 'RALSTON MERCY-DOUGLASS HO');
  assert.equal(v.matchArm, 'range_contains');
});

test('containment respects PARITY — the odd house belongs to the odd range', () => {
  // Both 3817-39 (odd) and 3816-40 (even) numerically bracket 3823. Without
  // parity, two distinct owners surface and a resolvable property is refused.
  const odd = parseSourceLocation('3817-39 MARKET ST');
  const even = parseSourceLocation('3816-40 MARKET ST');
  const n = normalizeAddress('3823 Market St', PHILADELPHIA);
  assert.equal(locationMatches(n, odd, PHILADELPHIA).matched, true);
  const evenVerdict = locationMatches(n, even, PHILADELPHIA);
  assert.equal(evenVerdict.matched, false);
  assert.equal(evenVerdict.reason, 'house_number_wrong_side_of_street');
});

test('🚨 the matcher REFUSES a house number outside every stated range', () => {
  // The case §3.1 demands be refused: 4508 is not 4500, and 4500 is not a range.
  const n = normalizeAddress('4508 City Line Ave.', PHILADELPHIA);
  const p = parseSourceLocation('4500 CITY AVE');
  const v = locationMatches(n, p, PHILADELPHIA);
  assert.equal(v.matched, false);
  assert.equal(v.reason, 'house_number_outside_range');
});

test('a sub-parcel letter is parsed, never left to become a street token', () => {
  // `3151L MARKET ST` must parse as house 3151 + street MARKET ST. Matching
  // only `R` leaves `L MARKET ST`, which silently DROPS the candidate — and a
  // dropped candidate can hide a genuine ambiguity.
  const p = parseSourceLocation('3151L MARKET ST');
  assert.equal(p.ok, true);
  assert.equal(p.houseStart, 3151);
  assert.equal(p.street, 'MARKET ST');
  assert.equal(p.subLetter, 'L');
  const r = parseSourceLocation('2910R S 70TH ST');
  assert.equal(r.rear, true);
  assert.equal(r.street, 'S 70TH ST');
});

test('a LEADING DIRECTIONAL survives normalisation', () => {
  // The bug that cost five of 26 live Philadelphia owners: `\s*([A-Z])?` in the
  // house regex captured the directional as a building letter.
  for (const [addr, street] of [
    ['100 E. Lehigh Ave.', 'E LEHIGH AVE'],
    ['1300 W. Lehigh Ave', 'W LEHIGH AVE'],
    ['1172 S Broad Street', 'S BROAD ST'],
    ['1438-1446 S Front St', 'S FRONT ST'],
    ['2910 South 70th St', 'S 70TH ST'],
  ]) {
    const n = normalizeAddress(addr, PHILADELPHIA);
    assert.equal(n.ok, true, addr);
    assert.equal(n.street, street, addr);
  }
});

test('a detached NON-directional building letter is still stripped', () => {
  const n = normalizeAddress('27720 A Tomball Pky', HARRIS);
  assert.equal(n.house, '27720');
  assert.equal(n.street, 'TOMBALL PKWY');
  assert.equal(n.houseLetter, 'A');
});

test('a suite/unit tail is stripped and recorded, never matched on', () => {
  const n = normalizeAddress('3020 Market Street, Suite 10', PHILADELPHIA);
  assert.equal(n.house, '3020');
  assert.equal(n.street, 'MARKET ST');
  assert.equal(n.unit, '10');
});

// ── §3.2 STREET ALIASES ─────────────────────────────────────────────────────

test('the alias list is EXPLICIT and data-driven, both directions', () => {
  assert.deepEqual(streetKeysFor('CITY LINE AVE', PHILADELPHIA), ['CITY LINE AVE', 'CITY AVE']);
  assert.deepEqual(streetKeysFor('CITY AVE', PHILADELPHIA), ['CITY AVE', 'CITY LINE AVE']);
  assert.ok(streetKeysFor('CYPRESS CREEK PKWY', HARRIS).includes('FM 1960 RD W'));
  assert.ok(streetKeysFor('FM 1960 RD W', HARRIS).includes('CYPRESS CREEK PKWY'));
});

test('an alias is scoped to its jurisdiction — never applied globally', () => {
  assert.deepEqual(streetKeysFor('CITY LINE AVE', HARRIS), ['CITY LINE AVE']);
  assert.deepEqual(streetKeysFor('CYPRESS CREEK PKWY', PHILADELPHIA), ['CYPRESS CREEK PKWY']);
});

test('🚨 an alias widens the SEARCH but never what may be WRITTEN', () => {
  // `4508 City Line Ave` reaches `4500 CITY AVE` only via the alias — and then
  // the house-number test refuses it. An alias that could resolve a house
  // number it does not match would be a fuzzy-matching escape hatch.
  const v = resolvePhl('4508 City Line Ave.');
  assert.notEqual(v.status, 'resolved');
  assert.equal(v.owner, null);
});

test('the alias list stays SMALL — a growing list is a fuzzy escape hatch', () => {
  const total = Object.values(STREET_ALIASES).reduce((n, a) => n + a.length, 0);
  assert.ok(total <= 12, `alias list has grown to ${total}; every entry must be evidence-backed`);
});

// ── §3.3 / §4.1 MULTI-PARCEL AND AMBIGUITY ──────────────────────────────────

test('🚨 §4: more than one distinct owner -> write NOTHING, flag', () => {
  const v = resolvePhl('3300 Henry Ave');
  assert.equal(v.status, 'needs_parcel_discriminator');
  assert.equal(v.owner, null);
  assert.equal(v.reason, 'needs_parcel_discriminator');
  assert.ok(v.distinctOwners >= 5);
});

test('containment into an ambiguous range is refused, not resolved', () => {
  const v = resolvePhl('834 Walnut St');
  assert.equal(v.status, 'needs_parcel_discriminator');
  assert.equal(v.owner, null);
});

test('several parcels with ONE owner is unambiguous and resolves', () => {
  // 2910 + 2910R S 70TH ST, both BLUE BELL ASSOC. Refusing here would discard a
  // real answer: the verdict is the same whichever parcel is ours.
  const v = resolvePhl('2910 South 70th St');
  assert.equal(v.status, 'resolved');
  assert.equal(v.owner, 'BLUE BELL ASSOC');
  assert.equal(v.distinctOwners, 1);
  assert.equal(v.sourceRecordIds.length, 2);
});

test('§4: a non-matching street is never resolved by similarity', () => {
  const n = normalizeAddress('4126 Walnut St', PHILADELPHIA);
  const p = parseSourceLocation('4126-38 WALNUT AVE');
  assert.equal(locationMatches(n, p, PHILADELPHIA).reason, 'street_mismatch');
});

test('🚨 §4: street equality is EQUALITY — a substring match is refused', () => {
  // Found by the mutation pass, not by reading the code: relaxing
  // `parsed.street === norm.street` to `parsed.street.includes(norm.street)`
  // survived every other assertion in this file. It is not a cosmetic
  // loosening — an address with no directional (`100 Lehigh Ave`) would then
  // match BOTH `100 E LEHIGH AVE` and `100 W LEHIGH AVE`, which are opposite
  // ends of Philadelphia. Either it picks one arbitrarily (a wrong owner) or
  // it sees two owners and refuses a property that a strict rule would simply
  // have reported as a miss. §4 says "a fuzzy match that is not exact on house
  // number AND street -> write nothing"; containment is a fuzzy match.
  const bare = normalizeAddress('100 Lehigh Ave', PHILADELPHIA);
  assert.equal(bare.street, 'LEHIGH AVE');
  for (const loc of ['100 E LEHIGH AVE', '100 W LEHIGH AVE']) {
    const v = locationMatches(bare, parseSourceLocation(loc), PHILADELPHIA);
    assert.equal(v.matched, false, `${bare.street} must not match ${loc}`);
    assert.equal(v.reason, 'street_mismatch');
  }
  // And the whole-verdict path refuses rather than picking one.
  const verdict = resolveOwnerFromCandidates(bare, [
    { location: '100 E LEHIGH AVE', owner: 'EPISCOPAL HOSPITAL', sourceRecordId: 'e' },
    { location: '100 W LEHIGH AVE', owner: 'SOMEONE ELSE LLC', sourceRecordId: 'w' },
  ], { jurisdiction: PHILADELPHIA });
  assert.notEqual(verdict.status, 'resolved');
  assert.equal(verdict.owner, null);
});

test('a blank owner at source is never substituted', () => {
  const v = resolveOwnerFromCandidates(
    normalizeAddress('5003 Umbria St', PHILADELPHIA),
    [{ location: '5003 UMBRIA ST', owner: '', sourceRecordId: 'z' }],
    { jurisdiction: PHILADELPHIA });
  assert.equal(v.status, 'unresolved');
  assert.equal(v.reason, 'source_states_no_owner');
  assert.equal(v.owner, null);
});

test('the owner name is copied BYTE FOR BYTE from the source row', () => {
  const v = resolvePhl('3823 Market St');
  const src = FIX.philadelphia['3823 Market St'].rows.find((r) => r.location === '3817-39 MARKET ST');
  assert.equal(v.owner, src.owner_1);
});

test('ownerIdentityKey collapses only case/punctuation — never tokens', () => {
  assert.equal(ownerIdentityKey("SIX G'S L P"), ownerIdentityKey('SIX GS LP'));
  // Two genuinely different parties must NEVER collapse — that is the whole
  // reason lcc_normalize_entity_name / ownerCore are banned for identity.
  assert.notEqual(ownerIdentityKey('AGREE LIBERTY PA LLC'), ownerIdentityKey('CARLYLE REVOLUTION LLC'));
  assert.notEqual(ownerIdentityKey('UNIT ONE FALLS CENTER LP'), ownerIdentityKey('UNIT SIX FALLS CENTER LP'));
  assert.notEqual(ownerIdentityKey('Realty Income Corporation'), ownerIdentityKey('Agree Realty Corp'));
});

// ── §2(b) HARRIS: the Personal/Commercial discriminator ─────────────────────

test('🔑 Harris keys on the county ACCOUNT TYPE, not on name text', () => {
  const b = buildHarrisCandidates(FIX.harris['5040 Crenshaw Rd']);
  assert.equal(b.candidates.length, 1);
  assert.equal(b.candidates[0].owner, 'CRENSHAW MOB LLC');
  assert.equal(b.candidates[0].sourceRecordId, '1274060000005');
  // Both tenant equipment accounts excluded BY TYPE.
  assert.equal(b.excludedPersonalAccounts.length, 2);
  const excluded = b.excludedPersonalAccounts.map((x) => x.owner);
  assert.ok(excluded.includes('FRESENIUS MEDICAL CARE GREATER SOUTHEAST HOUSTON LLC'));
  assert.ok(excluded.includes('FUSA MARKETING'));
});

test('🚨 an UNTYPED Harris account is reported, never admitted as the owner', () => {
  const b = buildHarrisCandidates(FIX.harris['untyped account']);
  assert.equal(b.candidates.length, 0);
  assert.equal(b.untypedAccounts.length, 1);
  assert.equal(b.untypedAccounts[0].owner, 'SOME PARTY LLC');
});

test('an untyped account is excluded by TWO independent gates (defence in depth)', () => {
  // The mutation pass reported "Harris admits an UNTYPED account" as a SURVIVOR
  // — and reading it, the mutation is BENIGN rather than the guard being weak:
  // deleting the `!accountType` early-return leaves the row to fall through to
  // the positive `isHarrisRealPropertyAccount` test, which is false for null,
  // so it still lands in untypedAccounts and never becomes a candidate. That is
  // a second gate doing its job, not a hole. Pinned explicitly so a future
  // change cannot remove BOTH and have the suite stay green — an admission
  // requires the county to have POSITIVELY typed the account as real property.
  assert.equal(isHarrisRealPropertyAccount(null), false);
  assert.equal(isHarrisRealPropertyAccount(undefined), false);
  assert.equal(isHarrisRealPropertyAccount(''), false);
  assert.equal(isHarrisRealPropertyAccount('   '), false);
  assert.equal(isHarrisRealPropertyAccount('Unknown'), false);
  const b = buildHarrisCandidates({
    address: '5040 Crenshaw Rd', source_query: 'q', source_url: 'u',
    accounts: [
      { account_number: 'x', account_type: '', owner_name: 'MYSTERY LLC', site_address: '5040 CRENSHAW RD' },
      { account_number: 'y', account_type: 'Mystery', owner_name: 'OTHER LLC', site_address: '5040 CRENSHAW RD' },
    ],
  });
  assert.equal(b.candidates.length, 0, 'no untyped/unknown account may ever become a candidate');
  assert.equal(b.untypedAccounts.length, 2);
});

test('the account-type predicates are exclusive and explicit', () => {
  assert.equal(isHarrisRealPropertyAccount('Commercial'), true);
  assert.equal(isHarrisRealPropertyAccount('commercial'), true);
  assert.equal(isHarrisPersonalPropertyAccount('Personal'), true);
  assert.equal(isHarrisRealPropertyAccount('Personal'), false);
  assert.equal(isHarrisPersonalPropertyAccount('Commercial'), false);
  assert.equal(isHarrisRealPropertyAccount(null), false);
  assert.equal(isHarrisPersonalPropertyAccount(null), false);
});

test('Harris resolves the real-property owner end to end, with a citation', async () => {
  const v = await resolveOwnerForProperty(HARRIS, FIX.harris['2920 Fulton St'], {});
  assert.equal(v.status, 'resolved');
  assert.equal(v.owner, 'FULTON SHOPPING CENTER INC');
  assert.equal(v.citation.jurisdiction, HARRIS);
  assert.deepEqual(v.citation.source_record_ids, ['c-fulton']);
  assert.equal(v.citation.source_record_kind, 'hcad_account_number');
  assert.ok(v.citation.source_query);
});

// ── §1 THE PROVENANCE CONTRACT ──────────────────────────────────────────────

test('🚨 §1: a write without a citation FAILS — this is the whole prompt', () => {
  const property = { property_id: 1, recorded_owner_id: null, operator: null };
  const noCite = { status: 'resolved', owner: 'REAL OWNER LLC', citation: null };
  assert.equal(planOwnerWrite(property, noCite, {}).action, 'refuse');
  assert.match(planOwnerWrite(property, noCite, {}).reason, /missing_citation/);
});

test('§1: each citation element is individually required', () => {
  const full = {
    jurisdiction: PHILADELPHIA, source_record_ids: ['882000790'],
    source_query: 'SELECT ... FROM opa_properties_public',
  };
  assert.equal(assertCitation(full).ok, true);
  for (const drop of ['jurisdiction', 'source_record_ids', 'source_query']) {
    const partial = { ...full };
    delete partial[drop];
    const r = assertCitation(partial);
    assert.equal(r.ok, false, `missing ${drop} must refuse`);
    assert.ok(r.missing.includes(drop));
  }
  // An EMPTY id array is not a citation either.
  assert.equal(assertCitation({ ...full, source_record_ids: [] }).ok, false);
  assert.equal(assertCitation({ ...full, source_record_ids: [null] }).ok, false);
});

test('a cited, matched owner produces a WRITE plan carrying the real name', async () => {
  const v = await resolveOwnerForProperty(HARRIS, FIX.harris['5040 Crenshaw Rd'], {});
  const plan = planOwnerWrite({ property_id: 22783, recorded_owner_id: null, operator: 'Fresenius' }, v,
    { operatorKeys: new Set(), propertyOperator: 'Fresenius' });
  assert.equal(plan.action, 'write');
  assert.equal(plan.ownerName, 'CRENSHAW MOB LLC');
  assert.equal(plan.citation.jurisdiction, HARRIS);
});

// ── §4.3 THE MATCHED NAME IS AN OPERATOR ────────────────────────────────────

test('🚨 §4: a matched name that IS an operator -> write nothing, flag', () => {
  const keys = new Set([ownerIdentityKey('DaVita Inc.'), ownerIdentityKey('Fresenius Medical Care')]);
  const hit = matchedNameIsOperator('DAVITA INC', { operatorKeys: keys });
  assert.equal(hit.isOperator, true);
  assert.equal(hit.basis, 'true_owners.is_operator_not_owner');

  const plan = planOwnerWrite(
    { property_id: 9, recorded_owner_id: null, operator: null },
    { status: 'resolved', owner: 'DAVITA INC',
      citation: { jurisdiction: HARRIS, source_record_ids: ['x'], source_query: 'q' } },
    { operatorKeys: keys });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.reason, 'matched_name_is_operator');
});

test("§4: the property's OWN operator is the second recorded fact consulted", () => {
  const plan = planOwnerWrite(
    { property_id: 9, recorded_owner_id: null, operator: 'US Renal Care, Inc.' },
    { status: 'resolved', owner: 'US RENAL CARE INC',
      citation: { jurisdiction: HARRIS, source_record_ids: ['x'], source_query: 'q' } },
    { operatorKeys: new Set(), propertyOperator: 'US Renal Care, Inc.' });
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.reason, 'matched_name_is_operator');
});

test('the operator guard reads RECORDED FACTS, never a name regex', () => {
  const src = stripComments(readFileSync(`${ROOT}api/_shared/ownergap2-owner-writeback.js`, 'utf8'));
  // P113: "never write a second name-based operator test".
  //
  // ⚠️ The first cut of this assertion also banned the token `dialysis` and
  // went RED over correct code — `domainQuery('dialysis', ...)` is the DOMAIN
  // identifier this whole repo routes on, not an operator name. That is the
  // documented "a guard that matches a shape is defeated by a name that
  // legitimately appears elsewhere", firing in the false-positive direction,
  // and it was found by running the guard rather than by reading it. The ban
  // is on operator BRANDS, which is what P113 is actually about.
  assert.ok(!/\bdavita\b|\bfresenius\b|renal care|\busrc\b/i.test(src),
    'the operator guard must not hard-code an operator brand name');
  assert.match(src, /is_operator_not_owner/);
  assert.match(src, /properties\.operator|propertyOperator/);
});

// ── The OWNERGAP1 fabrication-guard collision ───────────────────────────────

test('🚨 a REAL owner whose name trips the OWNERGAP1 guard is refused, not written', () => {
  // Measured live: the City of Philadelphia lists `ABC INC` as owner of record
  // at 4100 CITY AVE, and dia_is_fabricated_placeholder_owner('ABC INC') is
  // TRUE. Writing it would be nulled by the trigger and read as a success.
  assert.equal(wouldTripFabricationGuard('ABC INC'), true);
  assert.equal(wouldTripFabricationGuard('UNIV CITY ASSOCIATES'), false);
  assert.equal(wouldTripFabricationGuard('ABCO PROPERTIES'), false, 'the guard is prefix+space, not substring');

  const plan = planOwnerWrite(
    { property_id: 7, recorded_owner_id: null, operator: null },
    { status: 'resolved', owner: 'ABC INC',
      citation: { jurisdiction: PHILADELPHIA, source_record_ids: ['a1'], source_query: 'q' } },
    {});
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.reason, 'blocked_by_fabrication_guard');
  // The real name is kept so a human can adjudicate ONE row.
  assert.equal(plan.ownerName, 'ABC INC');
});

test('the fix does NOT weaken the OWNERGAP1 guard', () => {
  const mig = readFileSync(
    `${ROOT}supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql`, 'utf8');
  const sql = stripSqlComments(mig);
  // Weakening the detector is how it starts returning comfortable zeros (P182).
  assert.ok(!/create\s+or\s+replace\s+function\s+dia_is_fabricated_placeholder_owner/i.test(sql));
  assert.ok(!/drop\s+trigger[\s\S]{0,120}ownergap1/i.test(sql));
});

// ── §5.3 / fill-blanks / reversibility ──────────────────────────────────────

test('a property that already has an owner is never overwritten', () => {
  const plan = planOwnerWrite(
    { property_id: 5, recorded_owner_id: 'aaaaaaaa-0000-0000-0000-000000000000', operator: null },
    { status: 'resolved', owner: 'SOMEONE LLC',
      citation: { jurisdiction: PHILADELPHIA, source_record_ids: ['x'], source_query: 'q' } },
    {});
  assert.equal(plan.action, 'refuse');
  assert.equal(plan.reason, 'already_has_recorded_owner');
});

test('a miss stays a miss — no fallback to the operator, ever', async () => {
  const calls = [];
  const fakeQuery = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    return { ok: true, status: 200, data: [] };
  };
  const property = { property_id: 11, recorded_owner_id: null, operator: 'DaVita' };
  const plan = planOwnerWrite(property, { status: 'unresolved', reason: 'no_matching_record' }, {});
  const r = await applyOwnerResolution(property, plan, 'batch_x',
    { dryRun: false, jurisdiction: PHILADELPHIA }, { domainQuery: fakeQuery });
  assert.equal(r.wrote, false);
  assert.equal(r.action, 'refuse');
  // The only write is the LEDGER row recording the miss and its cause.
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'dia_ownergap2_resolution_log');
  assert.equal(writes[0].body.outcome, 'unresolved');
  assert.equal(writes[0].body.outcome_reason, 'no_matching_record');
  // Nothing touched properties or recorded_owners.
  assert.ok(!calls.some((c) => c.method !== 'GET' && /^properties/.test(c.path)));
  assert.ok(!calls.some((c) => c.method !== 'GET' && /^recorded_owners/.test(c.path)));
});

test('dry run is the DEFAULT and writes nothing at all', async () => {
  const calls = [];
  const fakeQuery = async (...a) => { calls.push(a); return { ok: true, status: 200, data: [] }; };
  const property = { property_id: 12, recorded_owner_id: null, operator: null };
  const plan = planOwnerWrite(property,
    { status: 'resolved', owner: 'REAL LLC',
      citation: { jurisdiction: PHILADELPHIA, source_record_ids: ['x'], source_query: 'q' } }, {});
  assert.equal(plan.action, 'write');
  const r = await applyOwnerResolution(property, plan, 'b', {}, { domainQuery: fakeQuery });
  assert.equal(r.wrote, false);
  assert.equal(r.reason, 'dry_run');
  assert.equal(calls.length, 0);
});

test('the property PATCH re-asserts recorded_owner_id IS NULL (fill-blanks)', () => {
  const src = stripComments(readFileSync(`${ROOT}api/_shared/ownergap2-owner-writeback.js`, 'utf8'));
  assert.match(src, /properties\?property_id=eq\.\$\{[^}]*\}&recorded_owner_id=is\.null/);
});

test('nothing in this lane writes true_owner_id or true_owners', () => {
  for (const f of ['api/_shared/ownergap2-owner-writeback.js',
    'api/_shared/ownergap2-sources.js',
    'api/_handlers/ownergap2-owner-resolve-tick.js']) {
    const src = stripComments(readFileSync(ROOT + f, 'utf8'));
    assert.ok(!/'(POST|PATCH|DELETE)',\s*[`'"]true_owners/.test(src), `${f} must not write true_owners`);
    assert.ok(!/true_owner_id\s*:/.test(src), `${f} must not set true_owner_id`);
  }
});

// ── §5 the measurement surface + the truncation guard ───────────────────────

test('🚨 the source query is BANDED — an unbounded street fetch truncates', () => {
  // Measured: MARKET ST carries 1,218 parcels and WALNUT ST 1,923. A LIMIT'd
  // whole-street fetch returns an arbitrary slice and reports no_matching_record
  // about a row it never asked for (A5: 815 = 1000 - 185).
  const sql = buildPhlQuery('MARKET ST', '3823');
  assert.match(sql, /BETWEEN 2824 AND 3823/);
  assert.match(sql, /ORDER BY .* DESC/);
  assert.ok(!/LIKE '3823%'/.test(sql), 'a prefix filter cannot find a containing range');
});

test('the band floor never goes negative', () => {
  assert.match(buildPhlQuery('DICKINSON ST', '109'), /BETWEEN 0 AND 109/);
});

test('a street name carrying a quote cannot break the query', () => {
  assert.match(buildPhlQuery("O'HARA ST", '100'), /O''HARA ST/);
});

test('truncation is reported, never upgraded into "no record"', async () => {
  const rows = Array.from({ length: PHL_ROW_LIMIT }, (_, i) => ({
    parcel_number: `p${i}`, location: `${1000 + i} NOWHERE ST`, owner_1: `OWNER ${i}`,
  }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ rows }) });
  const v = await resolveOwnerForProperty(PHILADELPHIA, { address: '9999 Elsewhere St' }, { fetchImpl });
  assert.equal(v.truncated, true);
  assert.equal(v.reason, 'source_response_truncated');
  assert.notEqual(v.reason, 'no_matching_record');
});

test('the ledger CHECK makes an uncitable resolved row impossible', () => {
  const sql = stripSqlComments(readFileSync(
    `${ROOT}supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql`, 'utf8'));
  assert.match(sql, /chk_ownergap2_resolved_must_cite/);
  assert.match(sql, /jsonb_array_length\(citation->'source_record_ids'\)\s*>\s*0/);
  assert.match(sql, /coalesce\(citation->>'source_query',\s*''\)\s*<>\s*''/);
  // A refusal must state its cause, or "unresolved-by-cause" is unmeasurable.
  assert.match(sql, /chk_ownergap2_unresolved_must_explain/);
});

test('the reversal never clobbers a value another writer changed', () => {
  const sql = stripSqlComments(readFileSync(
    `${ROOT}supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql`, 'utf8'));
  // ⚠️ Anchored on the SUBSTANCE, not on a variable name. The first cut of this
  // assertion matched the CTE name `still_ours`, and a later, correct rewrite of
  // the function (same behaviour, simpler shape) turned it RED over working
  // code — the documented block-slice/literal footgun. What must be true is the
  // correlated predicate (only null a row that still points at OUR value) and
  // that the residue is reported rather than folded into success.
  assert.match(sql, /l\.recorded_owner_id\s*=\s*p\.recorded_owner_id|p\.recorded_owner_id\s*=\s*l\.recorded_owner_id/);
  assert.match(sql, /set recorded_owner_id = null/);
  assert.match(sql, /skipped_changed_since/);
  assert.match(sql, /v_skipped\s*:=\s*v_target\s*-\s*v_unresolved|skipped_changed_since/);
  // It must not delete recorded_owners rows — those are real, cited parties.
  assert.ok(!/delete\s+from\s+recorded_owners/i.test(sql));
});

test('the definer reversal is locked to service_role and ASSERTED', () => {
  const sql = stripSqlComments(readFileSync(
    `${ROOT}supabase/migrations/dialysis/20261010120000_dia_ownergap2_owner_resolution_ledger.sql`, 'utf8'));
  assert.match(sql, /revoke all on function dia_ownergap2_unresolve\(text\) from public, anon, authenticated/i);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('service_role'/);
});

// ── the county-substring trap ───────────────────────────────────────────────

test("🚨 Harris is matched EXACTLY — '%harris%' also matches HARRISON County", () => {
  // Measured live: county ILIKE '%harris%' returns 52 owner-unknown dia
  // properties; 2 are in Harrison County (Marshall, TX), a different appraisal
  // district ~200 miles away. Harris proper is 50 — OWNERGAP1 §9's figure.
  const src = stripComments(readFileSync(`${ROOT}api/_handlers/ownergap2-owner-resolve-tick.js`, 'utf8'));
  assert.ok(!/county=ilike\.\*harris\*/.test(src), 'a substring county filter reaches Harrison County');
  assert.ok(!/county=ilike\.%25harris%25/.test(src));
  assert.match(src, /county=ilike\.harris(?![a-z*%])/);
});

test('the handler is two jurisdictions — there is no all-jurisdictions mode', () => {
  const src = stripComments(readFileSync(`${ROOT}api/_handlers/ownergap2-owner-resolve-tick.js`, 'utf8'));
  assert.ok(!/jurisdiction\s*===?\s*['"]all['"]/.test(src));
  assert.match(src, /jurisdiction required/);
});

test('Harris does NOT fetch — the portal is Cloudflare-walled', () => {
  // §6: do not automate a bot-protected portal and do not work around one.
  const src = stripComments(readFileSync(`${ROOT}api/_shared/ownergap2-sources.js`, 'utf8'));
  assert.ok(!/fetchImpl[\s\S]{0,200}hcad/i.test(src), 'no HCAD fetch may exist');
  assert.ok(!/https:\/\/search\.hcad\.org/.test(src), 'no HCAD endpoint may be called');
  const handler = stripComments(readFileSync(`${ROOT}api/_handlers/ownergap2-owner-resolve-tick.js`, 'utf8'));
  assert.match(handler, /fetches:\s*false/);
});

test('no model, prompt or completion call exists anywhere in this lane', () => {
  // §1: "No model may produce an owner name."
  for (const f of ['api/_shared/ownergap2-address-match.js',
    'api/_shared/ownergap2-sources.js',
    'api/_shared/ownergap2-owner-writeback.js',
    'api/_handlers/ownergap2-owner-resolve-tick.js']) {
    const src = stripComments(readFileSync(ROOT + f, 'utf8'));
    assert.ok(!/invokeChatProvider|invokeExtractionAI|invokeOnPremGeneration|openai|ollama|chat\.completions/i.test(src),
      `${f} must contain no model call`);
  }
});

test('the route is mounted in server.js and dispatched in admin.js', () => {
  const server = readFileSync(`${ROOT}server.js`, 'utf8');
  const admin = readFileSync(`${ROOT}api/admin.js`, 'utf8');
  assert.match(server, /\/api\/ownergap2-owner-resolve-tick/);
  assert.match(admin, /case 'ownergap2-owner-resolve-tick'/);
});

// ── §5.2 SPOT-CHECK: the live Philadelphia population, end to end ───────────

test('§5.2 spot-check: the live sample resolves to the owners measured live', () => {
  const expected = [
    ['4126 Walnut St', 'UNIV CITY ASSOCIATES', 'range_start', '882000790'],
    ['3823 Market St', 'RALSTON MERCY-DOUGLASS HO', 'range_contains', '881822820'],
    ['100 E. Lehigh Ave.', 'EPISCOPAL HOSPITAL', 'exact', '777012002'],
    ['1172 S Broad Street', 'FILIPPONE-NEWMAN LLC', 'range_start', '882000440'],
    ['3020 Market Street, Suite 10', '3020 MARKET OPERATING LP', 'range_start', '883071700'],
    ['4190 City Avenue, Suite 124', 'PHILA COLLEGE OF', 'range_contains', '774010040'],
    ['2910 South 70th St', 'BLUE BELL ASSOC', 'exact', '882088600'],
  ];
  for (const [addr, owner, arm, opa] of expected) {
    const v = resolvePhl(addr);
    assert.equal(v.status, 'resolved', addr);
    assert.equal(v.owner, owner, addr);
    assert.equal(v.matchArm, arm, addr);
    assert.ok(v.sourceRecordIds.includes(opa), `${addr} must cite OPA ${opa}`);
  }
});

test('§5.2 spot-check: every refusal and miss keeps its cause', () => {
  const expected = [
    ['3300 Henry Ave', 'needs_parcel_discriminator'],
    ['834 Walnut St', 'needs_parcel_discriminator'],
    ['4508 City Line Ave.', 'no_matching_record'],
    ['3401 Fox St, Building 5', 'no_records_returned'],
  ];
  for (const [addr, reason] of expected) {
    const v = resolvePhl(addr);
    assert.notEqual(v.status, 'resolved', addr);
    assert.equal(v.reason, reason, addr);
    assert.equal(v.owner, null, addr);
  }
});
