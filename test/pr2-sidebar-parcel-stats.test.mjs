// ============================================================================
// PR2 — the sidebar writer must carry the physical stats the capture hands it,
// and must parse the lot size's UNIT rather than its number.
//
// THE DEFECT
// ----------
// `parcel_records` has held building_sf / lot_sf / year_built / land_use /
// zoning / owner_name since it was created, and the CoStar Public Record tab
// sends them. `upsertPublicRecords` built its INSERT from
// apn/county/state/assessed_value only and stashed the captured `tax_amount`
// in the parcel raw_payload instead of the tax_records.tax_amount column. So
// the ONE genuine public-record source in dia produced 932 rows with 931 real
// APNs and ZERO building stats (measured 2026-09-02), while the gpt-4o leg's
// APN-less rows were the only ones carrying any.
//
// THE UNIT TRAP THIS PINS
// -----------------------
// CoStar's DOMINANT lot-size shape is "1.00 (43,560 sf)" — 1,679 of 2,477 live
// captures, 68%. The previous `parseLotSF` looked for /([\d.]+)\s*AC/i, which
// that string does not contain, then fell through to `parseSF`, which strips
// the "sf" token and parseFloats the LEADING number — returning **1** square
// foot for a one-acre lot. It is the parenthetical that carries square feet.
// (I12: dia holds both `lot_sf` (sq ft) and `land_area` (acres), 3,702 paired
// rows, 0 equal, ratio 43,560.)
//
// ⚠️ Comments are stripped before every source assertion. The handler's own
// comments name `metadata.lot_sf`, `property_type` and the CoStar owner panel
// repeatedly while explaining why each is NOT read, so a raw grep would match
// the explanation and pass over a regression (the A5c / N18 lesson).
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLotSize, lotSizeFromMetadata, parcelStatsFromMetadata }
  from '../api/_handlers/sidebar-pipeline.js';

const SRC_PATH = new URL('../api/_handlers/sidebar-pipeline.js', import.meta.url);
const RAW = readFileSync(SRC_PATH, 'utf8');

/** Strip // line comments and /* *\/ block comments, keeping code intact. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/([^:])\/\/.*$/gm, '$1');
}
const CODE = stripComments(RAW);

/**
 * The body of a named top-level function.
 *
 * ⚠️ Close the PARAMETER LIST first. `function f(metadata = {})` has its first
 * `{` inside the parameters, so naive brace matching from `indexOf('{')` closes
 * on the default value and returns a 40-character stub — a guard that asserts
 * over almost nothing and passes on any regression. That is the fixed-window /
 * block-slice family this repo documents, and it survived its own mutation
 * here until the mutation pass caught it.
 */
function functionBody(code, name) {
  const start = code.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found — it may have been renamed`);
  let i = code.indexOf('(', start), depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) { i++; break; }
  }
  const open = code.indexOf('{', i);
  assert.notEqual(open, -1, `no body found for ${name}`);
  depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}' && --depth === 0) return code.slice(start, j + 1);
  }
  assert.fail(`unbalanced braces reading ${name}`);
}

/** Count non-overlapping occurrences — a site count, not a presence check. */
function countSites(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('positive control: the comment stripper removes prose naming the banned reads', () => {
  const sample = "// metadata.lot_sf is EXCLUDED and property_type is not land_use\nconst x = 1;\n";
  const out = stripComments(sample);
  assert.ok(!out.includes('metadata.lot_sf'), 'the stripper leaves prose these guards must see past');
  assert.ok(!out.includes('property_type'), 'the stripper leaves prose these guards must see past');
  assert.ok(out.includes('const x = 1'), 'the stripper ate real code');
});

test('the lot-size parser reads the UNIT, not the leading number', () => {
  // A) the dominant CoStar shape — the parenthetical is the square footage.
  assert.equal(parseLotSize('1.00 (43,560 sf)').sf, 43560);
  assert.equal(parseLotSize('1.79 (77,972 sf)').sf, 77972);
  assert.equal(parseLotSize('1.00 (43,560 sf)').basis, 'parenthetical_sf');
  // B) acres convert.
  assert.equal(parseLotSize('0.86 AC').sf, 37462);
  assert.equal(parseLotSize('2.49 Acres').sf, 108464);
  // C) square feet pass through.
  assert.equal(parseLotSize('12,400 SF').sf, 12400);
  // Both columns come from ONE parse, so they cannot disagree about the unit.
  const oneAcre = parseLotSize('1.00 (43,560 sf)');
  assert.equal(oneAcre.acres, 1);
});

test('an ambiguous bare lot_size is refused, never guessed', () => {
  const bare = parseLotSize('19,998');
  assert.equal(bare.sf, null);
  assert.equal(bare.basis, 'ambiguous_bare_number');
  // The unit may ride the KEY when the value does not carry one.
  assert.equal(parseLotSize('19,998', 'sf').sf, 19998);
  assert.equal(parseLotSize('1.5', 'acres').sf, 65340);
});

test("CoStar's no-data lot rendering is refused, not stored as a measurement", () => {
  // "0.00 (1 sf)" is zero acres with a rounding artefact, not a one-square-foot
  // parcel. Storing it is the PR1a sentinel-as-measurement defect. Measured
  // 2026-09-02: 10 captures render that shape and EVERY parenthetical below
  // 100 sq ft is one of them.
  for (const v of ['0.00 (1 sf)', '0.00 (2 sf)']) {
    const r = parseLotSize(v);
    assert.equal(r.sf, null, `${v} must not be stored`);
    assert.equal(r.basis, 'implausible_lot_size');
  }
  // ...and a genuinely small urban lot still passes.
  assert.equal(parseLotSize('3,528 SF').sf, 3528);
});

test('the mixed-unit `lot_sf` capture key is not read as a unit source', () => {
  // ⚠️ `metadata.lot_sf` names square feet and holds BOTH units: live values
  // include 78300 / 43560 / 100000 (sq ft) alongside 1.71 / 0.94 / 0.7 (acres).
  // Trusting the key turned a 1.71-acre lot into "2 square feet" in this
  // change's own dry run.
  const mixed = lotSizeFromMetadata({ lot_sf: '1.71', lot_size: '0.30 (13,000 sf)' });
  assert.equal(mixed.sf, 13000, 'lot_size (unit-bearing) must win over the mixed-unit lot_sf key');
  assert.equal(lotSizeFromMetadata({ lot_sf: '78300' }).sf, null,
    'the lot_sf key alone must not be treated as square feet');
  assert.ok(!/metadata\.lot_sf/.test(functionBody(CODE, 'lotSizeFromMetadata')),
    'lotSizeFromMetadata reads metadata.lot_sf again — that key carries both units');
});

test('parcelStatsFromMetadata is the single owner, and the writer calls it', () => {
  const stats = parcelStatsFromMetadata({
    square_footage: '8,210 SF', year_built: '2016', lot_size: '0.96 AC', zoning: 'C2',
  });
  assert.equal(stats.building_sf, 8210);
  assert.equal(stats.year_built, 2016);
  assert.equal(stats.lot_sf, 41818);
  assert.equal(stats.zoning, 'C2');
  // The writer must not re-derive the stats inline — two parsers for one rule
  // is the normaliser drift this repo has paid for repeatedly.
  const writer = functionBody(CODE, 'upsertPublicRecords');
  assert.match(writer, /parcelStatsFromMetadata\(metadata\)/,
    'upsertPublicRecords no longer derives its stats from the shared owner');
  assert.ok(!/parseSF\(\s*metadata\.square_footage\s*\)/.test(writer),
    'upsertPublicRecords re-parses square_footage inline instead of using the shared owner');
});

test('"Underway" and a zero building size are refused, not stored', () => {
  const s = parcelStatsFromMetadata({ year_built: 'Underway', square_footage: '0' });
  assert.equal(s.year_built, null, '"Underway" is a construction status, not a year');
  assert.equal(s.building_sf, null, 'a zero building size is the no-data sentinel, not a measurement');
  // A real, if old, year still passes.
  assert.equal(parcelStatsFromMetadata({ year_built: '1795' }).year_built, 1795);
});

test('parcel owner_name is never sourced from the CoStar owner panel', () => {
  // `parcel_records.owner_name` means "the party the COUNTY names on this
  // parcel". Filling it from the owner we already resolved restates our own
  // value as if a county had said it — the gov ORE Phase A1 finding, where
  // 9,749 parcel owner_names are the recorded owner echoed back.
  const helper = functionBody(CODE, 'assessorOwnerName');
  for (const banned of ['ownerContact', 'recorded_owner', 'true_owner', 'entity.name']) {
    assert.ok(!helper.includes(banned),
      `assessorOwnerName reads ${banned} — that fabricates an assessor's owner from our own record`);
  }
  assert.equal(parcelStatsFromMetadata({ owner: 'Acme Realty LLC' }).owner_name, null);
  assert.equal(parcelStatsFromMetadata({ owner_name: 'Smith Family Trust' }).owner_name, 'Smith Family Trust');
});

test('land_use is never mapped from property_type', () => {
  // On a county-assessor capture `property_type` holds a use code; on a CoStar
  // capture it holds the CRE property type ("Medical Office"). One key, two
  // meanings — writing the wrong one into a land-use column states a fact
  // nobody stated.
  assert.equal(parcelStatsFromMetadata({ property_type: 'Medical Office' }).land_use, null);
  const owner = functionBody(CODE, 'parcelStatsFromMetadata');
  assert.ok(!/property_type/.test(owner),
    'parcelStatsFromMetadata reads property_type — that is the CRE type, not a land use');
});

test('the parcel PATCH path is fill-blanks and strips nulls', () => {
  // These rungs ship enforce_mode=record_only, under which lcc_merge_field
  // records a `skip` and the writer proceeds anyway — so the blank test cannot
  // be delegated to the registry and must be explicit. And a null passed to
  // filterByFieldPriority reaches the PATCH, which would NULL a column the
  // capture simply did not carry.
  const writer = functionBody(CODE, 'upsertPublicRecords');
  assert.match(writer, /blankFieldsOnly\(/, 'the PATCH path no longer applies the fill-blanks filter');
  // ⚠️ COUNT the sites. `blankOnly` legitimately appears twice on the dia
  // parcel PATCH — once in `fields:` and once in the catch fallback — so a
  // presence check reads the neighbour's copy and stays green while one of them
  // loses the filter (the B6c-dup lesson: anchor per site, count them).
  assert.equal(countSites(writer, '...blankOnly'), 2,
    'the dia parcel PATCH no longer applies blankFieldsOnly at BOTH its sites ' +
    '(the fields: list and the priority-filter catch fallback)');
  assert.equal(countSites(writer, '...parcelStats'), 1,
    'the raw parcelStats object reaches a PATCH — the PATCH path must send only blanks');

  const blank = functionBody(CODE, 'blankFieldsOnly');
  assert.match(blank, /current\s*==\s*null/, 'blankFieldsOnly no longer tests for a blank current value');
  assert.match(blank, /if\s*\(v\s*==\s*null\)\s*continue/, 'blankFieldsOnly no longer drops null offers');
});

test('the captured tax figure reaches the tax_amount COLUMN', () => {
  // It was being stashed in the parcel raw_payload, where nothing reads it:
  // tax_amount is non-null on 0 of the 287 sidebar tax rows.
  const writer = functionBody(CODE, 'upsertPublicRecords');
  assert.match(writer, /tax_amount:\s*ty\.year === taxYear \? capturedTaxAmount : null/,
    'tax_amount is no longer written to the tax_records column on the current year');
  // Only the current year — a multi-year assessment carries assessed values per
  // year, never a per-year tax bill, so stamping one figure across every year
  // would manufacture history.
  assert.ok(!/tax_amount:\s*capturedTaxAmount\s*[,}]/.test(writer),
    'tax_amount is stamped onto every assessment year — that invents tax history');
});

test('the parcel writes carry every stat column the capture can fill', () => {
  const writer = functionBody(CODE, 'upsertPublicRecords');
  assert.match(writer, /\.\.\.parcelStats\b/, 'the dia parcel INSERT no longer spreads the stats');
  assert.match(writer, /\.\.\.govParcelStats\b/, 'the gov parcel INSERT no longer spreads the stats');
  // gov names the same facts differently and carries BOTH units — I12 says
  // derive one from the other, never write whichever the source expressed.
  // ⚠️ Anchor on the OBJECT LITERAL. `land_area_sf` / `land_area_acres` also
  // appear in the gov PATCH's `select=` list further down, so a slice-and-grep
  // from `govParcelStats` matches that instead and survives the column being
  // dropped from the map — measured, it did.
  const mapStart = writer.indexOf('const govParcelStats = {');
  assert.notEqual(mapStart, -1, 'the gov stat map is gone');
  const map = writer.slice(mapStart, writer.indexOf('};', mapStart));
  for (const col of ['building_sf', 'land_area_sf', 'land_area_acres', 'year_built', 'zoning']) {
    assert.ok(map.includes(`${col}:`), `gov stat map no longer carries ${col}`);
  }
});
