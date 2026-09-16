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

import {
  parseRealAcctText, parseOwnersText, mapHeader,
  isCommercialRealClass, isCommercialPersonalClass, isAnyCommercialClass,
  harrisStateClassToAccountType,
} from '../api/_shared/hcad-pdata-parse.js';
import {
  buildHarrisPdataCandidates, resolveHarrisFromPdata, stageRowToLocation,
} from '../api/_shared/ownergap2-harris-pdata-match.js';
import { assertCitation, planOwnerWrite } from '../api/_shared/ownergap2-owner-writeback.js';

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

test('stageRowToLocation prefers site_addr_1..3, falls back to str_num+str+str_sfx', () => {
  assert.equal(stageRowToLocation({ site_addr_1: '100 MAIN ST' }), '100 MAIN ST');
  assert.equal(stageRowToLocation({ str_num: '100', str: 'MAIN', str_sfx: 'ST' }), '100 MAIN ST');
  assert.equal(stageRowToLocation({}), null);
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
