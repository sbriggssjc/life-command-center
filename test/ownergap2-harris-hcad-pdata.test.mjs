// ============================================================================
// OWNERGAP2-harris — guards for the HCAD free bulk PDATA loader + matcher.
//
// What these tests pin (per the ticket's §5):
//   - the loader is idempotent on (acct, file_year)
//   - the commercial-class filter has a positive control (real vs personal,
//     commercial vs residential)
//   - the matcher refuses a Personal-only account (never re-derives
//     operator-vs-owner from name text)
//   - provenance is required to write (mirrors the existing OWNERGAP2 guard)
//
// Hermetic by the suite-wide net-guard: no test here reaches a real host.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  parseRealAcctText, parseOwnersText, mapHeader,
  isCommercialRealClass, isCommercialPersonalClass, isAnyCommercialClass,
  harrisStateClassToAccountType,
} from '../api/_shared/hcad-pdata-parse.js';
import {
  buildHarrisPdataCandidates, resolveHarrisFromPdata, resolveHarrisPdataMatch,
  stageRowToLocation, harrisPdataStreetKeys, harrisBareStreetKeys,
  harrisStreetsMatch, isHcadPlaceholderOwnerName, parseIncludeClasses,
} from '../api/_shared/ownergap2-harris-pdata-match.js';
import { assertCitation, planOwnerWrite } from '../api/_shared/ownergap2-owner-writeback.js';
import { upsertRows, streamLoadRealAcct } from '../scripts/hcad-pdata-load.mjs';

const TAB_HEADER = 'acct\towner_name\tstr_num\tstr\tstr_sfx\tsite_addr_1\tstate_class';

function tsv(rows) {
  return [TAB_HEADER, ...rows].join('\n');
}

// ── header-driven parsing ────────────────────────────────────────────────────

test('mapHeader is delimiter-agnostic and header-name-driven, never positional', () => {
  const tab = mapHeader('acct\towner_name\tstate_class');
  assert.equal(tab.ok, true);
  assert.equal(tab.delimiter, '\t');

  const comma = mapHeader('acct,owner_name,state_class');
  assert.equal(comma.ok, true);
  assert.equal(comma.delimiter, ',');

  // A header missing the one REQUIRED field refuses rather than guessing a
  // position for it.
  const missing = mapHeader('owner_name\tstate_class');
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['acct']);
});

test('parseRealAcctText refuses (never guesses) when the required column is absent', () => {
  const r = parseRealAcctText('owner_name\tstate_class\nFoo LLC\tF1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_required_columns');
  assert.deepEqual(r.missing, ['acct']);
});

test('parseRealAcctText skips blank/no-acct rows and never fabricates an acct', () => {
  const text = tsv([
    '1\tOwner A\t100\tMAIN\tST\t100 MAIN ST\tF1',
    '', // blank line
    '\tOwner B\t200\tMAIN\tST\t200 MAIN ST\tF1', // no acct
    '2\tOwner C\t300\tMAIN\tST\t300 MAIN ST\tA1',
  ]);
  const r = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.skippedBlank, 2);
  assert.deepEqual(r.rows.map((x) => x.acct), ['1', '2']);
});

test('raw_row carries every column the loader saw, per the migration\'s recoverability contract', () => {
  const text = tsv(['9\tCorp LLC\t500\tELM\tAVE\t500 ELM AVE\tF1']);
  const r = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });
  const row = r.rows[0];
  assert.equal(row.raw_row.acct, '9');
  assert.equal(row.raw_row.owner_name, 'Corp LLC');
  assert.equal(row.raw_row.state_class, 'F1');
});

// OWNERGAP2-harris-b: owner_name / owner_name_2 mapping, corrected against
// the real 37-row seed (owner_name = HCAD's `name`; owner_name_2 =
// `mailto`, which restates `name` and appends care-of text when present —
// e.g. "2000 CRAWFORD PROPERTY LLC" / "...C/O BOXER PROPERTY"). `mailto`
// must land in owner_name_2, never fall back into owner_name.
test('owner_name_2 sources from mailto, never overwrites owner_name with care-of text', () => {
  const header = 'acct\tname\tmailto\tstate_class';
  const text = `${header}\n1\tROSENBERG ANDREW TRUSTEE\tROSENBERG ANDREW TRUSTEE C/O ANGELA K HESS C P A, P C\tF1`;
  const r = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].owner_name, 'ROSENBERG ANDREW TRUSTEE');
  assert.equal(r.rows[0].owner_name_2, 'ROSENBERG ANDREW TRUSTEE C/O ANGELA K HESS C P A, P C');
});

test('a header with ONLY mailto (no name/owner_name) never writes care-of text into owner_name', () => {
  const header = 'acct\tmailto\tstate_class';
  const text = `${header}\n1\t% TERRELL MATTOX & ASSOC\tF1`;
  const r = parseRealAcctText(text, { fileYear: 2026, sourceFile: 'real_acct.txt' });
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].owner_name, null);
  assert.equal(r.rows[0].owner_name_2, '% TERRELL MATTOX & ASSOC');
});

test('parseOwnersText folds a second owner name, keyed by acct', () => {
  const text = 'acct\tname\n1\tFirst Owner\n1\tSecond Owner\n2\tSolo Owner';
  const r = parseOwnersText(text);
  assert.equal(r.ok, true);
  assert.equal(r.rowsByAcct.get('1').length, 2);
  assert.equal(r.rowsByAcct.get('1')[1].name, 'Second Owner');
  assert.equal(r.rowsByAcct.get('2').length, 1);
});

// ── commercial-class filter: positive control ────────────────────────────────

test('commercial-class filter POSITIVE CONTROL: F1/F2/L1/L2 in, A1/B/C1 out', () => {
  assert.equal(isCommercialRealClass('F1'), true);
  assert.equal(isCommercialRealClass('F2'), true);
  assert.equal(isCommercialPersonalClass('L1'), true);
  assert.equal(isCommercialPersonalClass('L2'), true);
  assert.equal(isAnyCommercialClass('F1'), true);
  assert.equal(isAnyCommercialClass('L1'), true);

  // The negative control: real residential / vacant-lot / farm classes must
  // NOT be flagged commercial, or the filter is not filtering anything.
  assert.equal(isAnyCommercialClass('A1'), false); // Real, Residential, Single-Family
  assert.equal(isAnyCommercialClass('B'), false);  // Multifamily
  assert.equal(isAnyCommercialClass('C1'), false); // Real, Vacant Lots/Tracts
  assert.equal(isAnyCommercialClass(null), false);
  assert.equal(isAnyCommercialClass(''), false);
});

test('harrisStateClassToAccountType maps to the SAME vocabulary the payload path uses', () => {
  assert.equal(harrisStateClassToAccountType('F1'), 'commercial');
  assert.equal(harrisStateClassToAccountType('F2'), 'commercial');
  assert.equal(harrisStateClassToAccountType('L1'), 'personal');
  assert.equal(harrisStateClassToAccountType('L2'), 'personal');
  assert.equal(harrisStateClassToAccountType('A1'), null); // untyped for this purpose
});

// ── matcher: refuses a Personal-only account, mirrors PDR2 ───────────────────

test('a Personal-only account (state_class L1) is EXCLUDED, never treated as the owner', () => {
  const rows = [
    { acct: '9001', owner_name: 'FUSA MARKETING INC', site_addr_1: '5040 CRENSHAW ST', state_class: 'L1' },
  ];
  const r = resolveHarrisFromPdata('5040 Crenshaw St', rows);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.owner, null);
  assert.equal(r.excludedPersonalAccounts.length, 1);
  assert.equal(r.excludedPersonalAccounts[0].owner, 'FUSA MARKETING INC');
});

test('the Commercial account is PREFERRED over a co-located Personal account (PDR2 rule)', () => {
  const rows = [
    { acct: '9002', owner_name: 'CRENSHAW MOB LLC', site_addr_1: '5040 CRENSHAW ST', state_class: 'F1' },
    { acct: '9001', owner_name: 'FRESENIUS MEDICAL CARE', site_addr_1: '5040 CRENSHAW ST', state_class: 'L1' },
  ];
  const r = resolveHarrisFromPdata('5040 Crenshaw St', rows);
  assert.equal(r.status, 'resolved');
  assert.equal(r.owner, 'CRENSHAW MOB LLC');
  assert.equal(r.excludedPersonalAccounts.length, 1);
  assert.equal(r.excludedPersonalAccounts[0].owner, 'FRESENIUS MEDICAL CARE');
});

test('an UNTYPED state_class is never admitted as the owner (fails safe, not open)', () => {
  const rows = [
    { acct: '9003', owner_name: 'MYSTERY OWNER LLC', site_addr_1: '100 MAIN ST', state_class: null },
  ];
  const r = resolveHarrisFromPdata('100 Main St', rows);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.untypedAccounts.length, 1);
});

test('multi-account ambiguity among two DIFFERENT commercial owners is refused, never guessed', () => {
  const rows = [
    { acct: 'A', owner_name: 'OWNER ONE LLC', site_addr_1: '100 MAIN ST', state_class: 'F1' },
    { acct: 'B', owner_name: 'OWNER TWO LP', site_addr_1: '100 MAIN ST', state_class: 'F2' },
  ];
  const r = resolveHarrisFromPdata('100 Main St', rows);
  assert.equal(r.status, 'needs_parcel_discriminator');
  assert.equal(r.owner, null);
});

test('the FM 1960 / Cypress Creek Pkwy alias resolves a Harris PDATA row filed under the old name', () => {
  const rows = [
    { acct: 'C1', owner_name: 'CYPRESS OWNER LLC', str_num: '4427', str: 'FM 1960', str_sfx: 'RD W', state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('4427 Cypress Creek Pkwy', rows);
  assert.equal(r.status, 'resolved');
  assert.equal(r.owner, 'CYPRESS OWNER LLC');
  assert.equal(r.matchArm, 'exact_via_alias');
});

test('stageRowToLocation uses site_addr_1 ALONE, falls back to str_num+str+str_sfx', () => {
  assert.equal(stageRowToLocation({ site_addr_1: '100 MAIN ST' }), '100 MAIN ST');
  assert.equal(stageRowToLocation({ str_num: '100', str: 'MAIN', str_sfx: 'ST' }), '100 MAIN ST');
  assert.equal(stageRowToLocation({}), null);
});

// OWNERGAP2-harris-b: site_addr_2/site_addr_3 are the situs CITY/ZIP on
// every real staged row, NEVER a continuation of the street address —
// joining them (the pre-fix behaviour) fed "PASADENA 77505" into the street
// parser and made every real row a street_mismatch.
test('stageRowToLocation does NOT drag city/zip (site_addr_2/3) into the match string', () => {
  const loc = stageRowToLocation({
    site_addr_1: '5040 CRENSHAW RD', site_addr_2: 'PASADENA', site_addr_3: '77505',
  });
  assert.equal(loc, '5040 CRENSHAW RD');
});

// ── OWNERGAP2-harris-b: bare-key query shape, verified against the REAL
// 37-row Cowork seed (Dialysis_DB, queried live 2026-09-16) ─────────────────

test('harrisPdataStreetKeys derives the BARE key HCAD\'s str column holds, not the suffixed form', () => {
  // Real staged row: 5040 CRENSHAW RD -> str='CRENSHAW', str_sfx='RD'.
  assert.deepEqual(harrisPdataStreetKeys('5040 Crenshaw Rd').slice(0, 1), ['CRENSHAW']);
  // Real staged row: 3327 S SAM HOUSTON PKY E -> str='SAM HOUSTON'.
  assert.ok(harrisPdataStreetKeys('3327 Sam Houston Pkwy').includes('SAM HOUSTON'));
});

test('a street whose own NAME collides with a directional word (Northwest Fwy) still keys correctly', () => {
  // normalizeAddress collapses "NORTHWEST" -> "NW" (DIRECTIONAL_MAP applies
  // to any token, not just a genuine leading qualifier); the naive bare-key
  // strip then reads "NW" as a directional and discards it, leaving just
  // "FWY". harrisPdataStreetKeys must also try the expanded reading.
  const keys = harrisPdataStreetKeys('20320 Northwest Fwy');
  assert.ok(keys.includes('NORTHWEST'), `expected 'NORTHWEST' among ${JSON.stringify(keys)}`);
});

test('harrisBareStreetKeys returns BOTH readings of a directional-shaped leading token', () => {
  const keys = harrisBareStreetKeys('NW FWY');
  assert.ok(keys.includes('NORTHWEST'));
});

test('the STATE HWY 249 / SH 249 alias resolves a real Harris PDATA row (HCAD stages BOTH spellings)', () => {
  const rows = [
    { acct: '1240120010004', owner_name: 'IVT ANTOINE TOWN CENTER HOUSTON LLC', str_num: '12430', str: 'SH 249', str_sfx: null, state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('12430 State Hwy 249', rows);
  assert.equal(r.status, 'resolved');
  assert.equal(r.owner, 'IVT ANTOINE TOWN CENTER HOUSTON LLC');
});

// ── OWNERGAP2-harris-b: suffix-optional / directional-optional comparison,
// against the REAL rows that failed the deployed dry run ────────────────────

test('a suffix present on HCAD\'s side only is OPTIONAL when the LCC address has none (Live Oak, Center, La Concha)', () => {
  const liveOak = resolveHarrisFromPdata('1550 Live Oak', [
    { acct: 'LO', owner_name: 'LIVE OAK BAY AREA PRT LTD', site_addr_1: '1550 LIVE OAK ST', state_class: 'F1' },
  ]);
  assert.equal(liveOak.status, 'resolved');
  assert.equal(liveOak.owner, 'LIVE OAK BAY AREA PRT LTD');

  const center = resolveHarrisFromPdata('4621 Center', [
    { acct: 'CTR', owner_name: 'GBCBM LTD', site_addr_1: '4621 CENTER ST', state_class: 'F1' },
  ]);
  assert.equal(center.status, 'resolved');
  assert.equal(center.owner, 'GBCBM LTD');
});

test('a directional present on HCAD\'s side only is OPTIONAL, both leading and trailing (Sam Houston Pkwy, 34th)', () => {
  const samHouston = resolveHarrisFromPdata('3327 Sam Houston Pkwy', [
    { acct: 'SH1', owner_name: 'SOUTHPOINT BUILDING 5 LLC', site_addr_1: '3327 S SAM HOUSTON PKY E', state_class: 'F1' },
  ]);
  assert.equal(samHouston.status, 'resolved');
  assert.equal(samHouston.owner, 'SOUTHPOINT BUILDING 5 LLC');

  const thirtyFourth = resolveHarrisFromPdata('2001 34th St', [
    { acct: 'T34', owner_name: 'ROY AND VEVA MORRISON RANCH CORPORATION', site_addr_1: '2001 W 34TH ST', state_class: 'F1' },
  ]);
  assert.equal(thirtyFourth.status, 'resolved');
  assert.equal(thirtyFourth.owner, 'ROY AND VEVA MORRISON RANCH CORPORATION');
});

test('a directional present on BOTH sides and DISAGREEING is a genuine contradiction, still refused', () => {
  const r = resolveHarrisFromPdata('3203 FM 1960 Rd W', [
    { acct: 'E1', owner_name: 'WRONG SIDE LLC', site_addr_1: '3203 FM 1960 RD E', state_class: 'F1' },
  ]);
  assert.notEqual(r.status, 'resolved');
});

test('harrisStreetsMatch: a suffix present on BOTH sides that DISAGREES is a real mismatch, never widened', () => {
  assert.equal(harrisStreetsMatch('CRENSHAW RD', 'CRENSHAW ST'), false);
  // ...but a suffix present on only ONE side is optional (the ticket's rule).
  assert.equal(harrisStreetsMatch('CRENSHAW', 'CRENSHAW ST'), true);
  // core street name must still be exactly equal -- no similarity scoring.
  assert.equal(harrisStreetsMatch('CRENSHAW', 'CRAWFORD'), false);
});

test('the Little York 2711 population (2 accounts, 2 DIFFERENT owners) is refused, never guessed', () => {
  const rows = [
    { acct: 'A', owner_name: 'PRAM INTERNATIONAL INC', site_addr_1: '2711 LITTLE YORK RD', state_class: 'F1' },
    { acct: 'B', owner_name: 'PRAM REAL ESTATE LLC', site_addr_1: '2711 LITTLE YORK RD', state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('2711 Little York Rd', rows);
  assert.equal(r.status, 'needs_parcel_discriminator');
  assert.equal(r.owner, null);
});

test('the FM 2920 population (2 accounts, SAME owner) resolves cleanly', () => {
  const rows = [
    { acct: 'A', owner_name: 'DD MEDICAL DEVELOPMENT PARTNERS LLC', site_addr_1: '2950 FM 2920 RD', state_class: 'F1' },
    { acct: 'B', owner_name: 'DD MEDICAL DEVELOPMENT PARTNERS LLC', site_addr_1: '2950 FM 2920 RD', state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('2950 FM 2920 Rd', rows);
  assert.equal(r.status, 'resolved');
  assert.equal(r.owner, 'DD MEDICAL DEVELOPMENT PARTNERS LLC');
  assert.equal(r.sourceRecordIds.length, 2);
});

test('no staged rows at all -> honest no_staged_rows, never a fabricated match', () => {
  const r = buildHarrisPdataCandidates('100 Main St', []);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['no_staged_rows']);
});

// ── provenance is required to write (mirrors the existing OWNERGAP2 guard) ───

test('a PDATA-sourced verdict without citation is refused by assertCitation', () => {
  const c = assertCitation(null);
  assert.equal(c.ok, false);
  assert.deepEqual(c.missing, ['citation']);
});

test('planOwnerWrite REFUSES a resolved PDATA verdict missing source_record_ids', () => {
  const property = { property_id: 1, recorded_owner_id: null, operator: null };
  const verdict = {
    status: 'resolved', owner: 'CRENSHAW MOB LLC',
    citation: { jurisdiction: 'harris_tx', source_record_ids: [], source_query: 'x' },
  };
  const plan = planOwnerWrite(property, verdict, {});
  assert.equal(plan.action, 'refuse');
  assert.match(plan.reason, /missing_citation/);
});

test('planOwnerWrite WRITES a genuine PDATA-sourced, fully-cited resolved verdict', () => {
  const property = { property_id: 1, recorded_owner_id: null, operator: null };
  const rows = [
    { acct: '9002', owner_name: 'CRENSHAW MOB LLC', site_addr_1: '5040 CRENSHAW ST', state_class: 'F1' },
  ];
  const verdict = resolveHarrisFromPdata('5040 Crenshaw St', rows);
  const plan = planOwnerWrite(property, verdict, { operatorKeys: new Set(), propertyOperator: null });
  assert.equal(plan.action, 'write');
  assert.equal(plan.ownerName, 'CRENSHAW MOB LLC');
  assert.ok(plan.citation.source_record_ids.includes('9002'));
});

// ── OWNERGAP2-harris-c ───────────────────────────────────────────────────────

test('HCAD placeholder owner names ("CURRENT OWNER" etc.) are never treated as a real owner', () => {
  assert.equal(isHcadPlaceholderOwnerName('CURRENT OWNER'), true);
  assert.equal(isHcadPlaceholderOwnerName('current owner'), true);
  assert.equal(isHcadPlaceholderOwnerName('  Current   Owner  '), true);
  assert.equal(isHcadPlaceholderOwnerName('OWNER UNKNOWN'), true);
  assert.equal(isHcadPlaceholderOwnerName('UNKNOWN OWNER'), true);
  assert.equal(isHcadPlaceholderOwnerName('CRENSHAW MOB LLC'), false);
  assert.equal(isHcadPlaceholderOwnerName(null), false);
});

test('a placeholder-only match resolves to placeholder_owner, never writes the placeholder as the owner', () => {
  const norm = { ok: true, house: '100', street: 'MAIN' };
  const candidates = [{
    owner: 'CURRENT OWNER', location: '100 MAIN ST', sourceRecordId: '0010020000001',
  }];
  const r = resolveHarrisPdataMatch(norm, candidates);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.reason, 'placeholder_owner');
  assert.equal(r.owner, null);
});

test('one real owner + one placeholder for the same address resolves to the real owner only', () => {
  const rows = [
    { acct: '1', owner_name: 'CURRENT OWNER', site_addr_1: '100 MAIN ST', state_class: 'F1' },
    { acct: '2', owner_name: 'REAL PARTY LLC', site_addr_1: '100 MAIN ST', state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('100 Main St', rows);
  assert.equal(r.status, 'resolved');
  assert.equal(r.owner, 'REAL PARTY LLC');
  assert.equal(r.sourceRecordIds.length, 1);
  assert.deepEqual(r.sourceRecordIds, ['2']);
});

test('buildHarrisPdataCandidates: a C2 account is excluded by default and admitted only via includeClasses', () => {
  const rows = [
    { acct: '1', owner_name: '380 LITTLE YORK LLC', site_addr_1: '380 E LITTLE YORK RD', state_class: 'C2' },
  ];
  const dflt = buildHarrisPdataCandidates('380 E Little York Rd', rows);
  assert.equal(dflt.candidates.length, 0);
  assert.equal(dflt.untypedAccounts.length, 1);

  const widened = buildHarrisPdataCandidates('380 E Little York Rd', rows, { includeClasses: ['c2'] });
  assert.equal(widened.candidates.length, 1);
  assert.equal(widened.candidates[0].accountType, 'commercial');
  assert.equal(widened.untypedAccounts.length, 0);

  // A Personal/BPP account is never admitted through includeClasses -- the
  // widening only reaches an account with NO type at all.
  const personal = buildHarrisPdataCandidates('380 E Little York Rd',
    [{ acct: '2', owner_name: 'X', site_addr_1: '380 E LITTLE YORK RD', state_class: 'L1' }],
    { includeClasses: ['l1'] });
  assert.equal(personal.candidates.length, 0);
  assert.equal(personal.excludedPersonalAccounts.length, 1);
});

test('resolveHarrisFromPdata threads includeClasses through to the candidate builder', () => {
  const rows = [
    { acct: '1', owner_name: 'LUEL PARTNERSHIP LTD', site_addr_1: '10311 S POST OAK RD', state_class: 'C2' },
  ];
  const withoutC2 = resolveHarrisFromPdata('10311 S Post Oak Rd', rows);
  assert.equal(withoutC2.reason, 'no_records_returned');

  const withC2 = resolveHarrisFromPdata('10311 S Post Oak Rd', rows, { includeClasses: ['C2'] });
  assert.equal(withC2.status, 'resolved');
  assert.equal(withC2.owner, 'LUEL PARTNERSHIP LTD');
});

// ── OWNERGAP2-harris-d: an includeClasses-admitted row resolves on the EXACT
// situs arm alone -- range/containment is refused even though it is a real
// match arm for the default F1/F2 classes (S5: "the parcel we find must be
// the parcel at the county").

test('an includeClasses-admitted C2 row resolves on EXACT house-number match', () => {
  const rows = [
    { acct: '1', owner_name: 'LUEL PARTNERSHIP LTD', site_addr_1: '10311 S POST OAK RD', state_class: 'C2' },
  ];
  const r = resolveHarrisFromPdata('10311 S Post Oak Rd', rows, { includeClasses: ['C2'] });
  assert.equal(r.status, 'resolved');
  assert.equal(r.matchArm, 'exact');
  assert.equal(r.citation.state_class, 'C2');
});

test('an includeClasses-admitted C2 row is REFUSED on a range/containment match -- exact only', () => {
  // The staged row's own house number is a RANGE-START point (a range-shaped
  // situs field would come from parseSourceLocation on a multi-address
  // string); simulate that shape directly by handing the resolver a row
  // whose parsed location covers, but does not equal, the queried house.
  const rows = [
    { acct: '1', owner_name: 'LUEL PARTNERSHIP LTD', site_addr_1: '10301-10399 S POST OAK RD', state_class: 'C2' },
  ];
  const r = resolveHarrisFromPdata('10311 S Post Oak Rd', rows, { includeClasses: ['C2'] });
  assert.notEqual(r.status, 'resolved');
  assert.equal(r.nearMisses?.some((m) => m.reason === 'class_admitted_requires_exact_situs'), true);
});

test('F1/F2 (default classes) still resolve on a range match -- the exact-only gate is C2-scoped', () => {
  const rows = [
    { acct: '1', owner_name: 'DEFAULT CLASS OWNER LLC', site_addr_1: '10301-10399 S POST OAK RD', state_class: 'F1' },
  ];
  const r = resolveHarrisFromPdata('10311 S Post Oak Rd', rows);
  assert.equal(r.status, 'resolved');
  assert.notEqual(r.matchArm, 'exact');
});

test('parseIncludeClasses validates against the closed allowlist and upper-cases', () => {
  const ok = parseIncludeClasses('c2');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.classes, ['C2']);

  const empty = parseIncludeClasses('');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.classes, []);

  const bad = parseIncludeClasses('C2,F9');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.invalid, ['F9']);
});

// ── loader: on_conflict= is passed explicitly (Problem 1) ───────────────────

test('upsertRows POSTs with on_conflict=acct,file_year -- never relies on PK inference', async () => {
  const calls = [];
  const stubQuery = async (domain, method, path, body) => {
    calls.push({ domain, method, path, body });
    return { ok: true, status: 201, data: null };
  };
  const rows = [{ acct: 'A', file_year: 2026 }, { acct: 'B', file_year: 2026 }];
  const r = await upsertRows(rows, { domainQuery: stubQuery });
  assert.equal(r.written, 2);
  assert.deepEqual(r.errors, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'hcad_real_acct_stage?on_conflict=acct,file_year');
});

test('upsertRows reports the real chunk shape (never chunk_at_N_failed:undefined) and surfaces the DB code/message', async () => {
  const stubQuery = async () => ({
    ok: false, status: 409,
    data: { code: '23505', message: 'duplicate key value violates unique constraint "uq_hcad_stage_acct_year"' },
  });
  const rows = [{ acct: 'A', file_year: 2026 }];
  const r = await upsertRows(rows, { domainQuery: stubQuery });
  assert.equal(r.written, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /status=409/);
  assert.match(r.errors[0], /code=23505/);
  assert.match(r.errors[0], /uq_hcad_stage_acct_year/);
  assert.doesNotMatch(r.errors[0], /undefined/);
});

// ── loader: owner_name / owners.txt refusal (Problem 3) ─────────────────────

const TAB_HEADER_NO_NAME = 'acct\tyr\tmailto\tmail_addr_1\tstr_num\tstr\tstr_sfx\tsite_addr_1\tstate_class';

function tsvNoName(rows) {
  return [TAB_HEADER_NO_NAME, ...rows].join('\n');
}

test('streamLoadRealAcct fills owner_name from owners.txt ln_num=1 when real_acct.txt has no name column', async () => {
  const text = tsvNoName([
    'A\t2026\t\t\t100\tMAIN\tST\t100 MAIN ST\tF1',
  ]);
  const ownersByAcct = new Map([['A', [{ name: 'REAL OWNER LLC', pct: null }]]]);
  const result = await streamLoadRealAcct(Readable.from([text]), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null,
    includeAll: false, ownersByAcct, upsert: async () => ({ written: 0, errors: [] }),
  });
  assert.equal(result.ownerNameHeaderMissing, true);
  assert.equal(result.missingOwnerName, 0);
  assert.equal(result.sampleRow.owner_name, 'REAL OWNER LLC');
});

test('streamLoadRealAcct --apply REFUSES to write when any staged row has no owner_name', async () => {
  const text = tsvNoName([
    'A\t2026\t\t\t100\tMAIN\tST\t100 MAIN ST\tF1',
    'B\t2026\t\t\t200\tMAIN\tST\t200 MAIN ST\tF1',
  ]);
  // Only acct A is covered by owners.txt -- B has no name anywhere.
  const ownersByAcct = new Map([['A', [{ name: 'REAL OWNER LLC', pct: null }]]]);
  let upsertCalled = false;
  const result = await streamLoadRealAcct(Readable.from([text]), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: true, limit: null,
    includeAll: false, ownersByAcct,
    upsert: async (rows) => { upsertCalled = true; return { written: rows.length, errors: [] }; },
  });
  assert.equal(result.staged, 2);
  assert.equal(result.missingOwnerName, 1);
  assert.equal(result.written, 0);
  assert.equal(upsertCalled, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /refused_missing_owner_name/);
  assert.match(result.errors[0], /1_of_2/);
});

test('streamLoadRealAcct --include-classes stages an additional class alongside F1/F2, never a Personal one', async () => {
  const text = tsvNoName([
    'A\t2026\t\t\t100\tMAIN\tST\t100 MAIN ST\tC2',
    'B\t2026\t\t\t200\tMAIN\tST\t200 MAIN ST\tL1',
    'C\t2026\t\t\t300\tMAIN\tST\t300 MAIN ST\tR1',
  ]);
  const ownersByAcct = new Map([
    ['A', [{ name: 'C2 OWNER LLC', pct: null }]],
    ['B', [{ name: 'L1 OWNER LLC', pct: null }]],
  ]);
  const withoutSwitch = await streamLoadRealAcct(Readable.from([text]), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null,
    includeAll: false, ownersByAcct, upsert: async () => ({ written: 0, errors: [] }),
  });
  assert.equal(withoutSwitch.staged, 0); // C2/L1/R1 all fall outside the default F1/F2 filter

  const withSwitch = await streamLoadRealAcct(Readable.from([text]), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: false, limit: null,
    includeAll: false, includeClasses: ['C2'], ownersByAcct,
    upsert: async () => ({ written: 0, errors: [] }),
  });
  // Only C2 (via the switch) is staged -- L1 (Personal/BPP) and R1
  // (residential) stay excluded, the switch never widens beyond the names
  // it was passed.
  assert.equal(withSwitch.staged, 1);
  assert.equal(withSwitch.sampleRow.acct, 'A');
});

test('streamLoadRealAcct --apply WRITES when every staged row resolves an owner_name', async () => {
  const text = tsvNoName([
    'A\t2026\t\t\t100\tMAIN\tST\t100 MAIN ST\tF1',
  ]);
  const ownersByAcct = new Map([['A', [{ name: 'REAL OWNER LLC', pct: null }]]]);
  let received = null;
  const result = await streamLoadRealAcct(Readable.from([text]), {
    fileYear: 2026, sourceFile: 'real_acct.txt', apply: true, limit: null,
    includeAll: false, ownersByAcct,
    upsert: async (rows) => { received = rows; return { written: rows.length, errors: [] }; },
  });
  assert.equal(result.missingOwnerName, 0);
  assert.equal(result.written, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0].owner_name, 'REAL OWNER LLC');
});
