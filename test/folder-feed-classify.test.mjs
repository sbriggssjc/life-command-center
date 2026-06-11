// Phase 2 folder-feed (Slice 1) — classifier + path→subject_hint anchor.
// These are the cheap, deterministic guards the worker leans on before any
// content parse: filename decides what gets staged this slice (OM/flyer only),
// and the path resolves the entity (tenant/brand + City, ST + vertical).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFile, parseSubjectHintFromPath,
  extractCityState, extractStreetAddress, isPortfolioHint, tenantCore,
  parseCityStateFromFilename, looksLikePortfolioRollup, isExcludedFolderPath,
} from '../api/_shared/folder-feed-classify.js';

describe('folder-feed classifyFile', () => {
  it('classifies OM/flyer PDFs as stage-able om', () => {
    assert.deepEqual(classifyFile('DaVita Tulsa OM.pdf'), { type: 'om', isOm: true });
    assert.deepEqual(classifyFile('SSA Falls Church Offering Memorandum.pdf'), { type: 'om', isOm: true });
    assert.deepEqual(classifyFile('Some Brand Flyer.pdf'), { type: 'om', isOm: true });
  });

  it('does NOT treat a master/rent-roll xlsx as an OM (later unit)', () => {
    assert.deepEqual(classifyFile('master inventory.xlsx'), { type: 'master', isOm: false });
    assert.equal(classifyFile('2024 Rent Roll.xlsx').isOm, false);
  });

  it('recognizes lease / comp / bov / dd types without staging them', () => {
    assert.equal(classifyFile('lease abstract.pdf').type, 'lease');
    assert.equal(classifyFile('Sales Comps export.xlsx').type, 'comp');
    assert.equal(classifyFile('GSA BOV valuation.pdf').type, 'bov');
    assert.equal(classifyFile('Tax Records 2024.pdf').type, 'dd');
    assert.equal(classifyFile('lease abstract.pdf').isOm, false);
  });

  it('treats an unknown file as unknown (recorded, not parsed)', () => {
    assert.deepEqual(classifyFile('random notes.docx'), { type: 'unknown', isOm: false });
  });
});

describe('folder-feed parseSubjectHintFromPath', () => {
  it('resolves tenant/brand + City, ST + vertical from a dialysis property path', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/D/DaVita Dialysis/Tulsa, OK/DaVita Tulsa OM.pdf');
    assert.equal(h.bucket, 'D');
    assert.equal(h.tenant_brand, 'DaVita Dialysis');
    assert.equal(h.city, 'Tulsa');
    assert.equal(h.state, 'OK');
    assert.equal(h.vertical, 'dia');
  });

  it('infers gov vertical from agency cues in the brand folder', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/S/Social Security Administration/Falls Church, VA/SSA OM.pdf');
    assert.equal(h.tenant_brand, 'Social Security Administration');
    assert.equal(h.city, 'Falls Church');
    assert.equal(h.state, 'VA');
    assert.equal(h.vertical, 'gov');
  });

  it('uses the research-root to set the vertical when there is no property path', () => {
    assert.equal(parseSubjectHintFromPath('Dialysis Research/Comps/x.pdf').vertical, 'dia');
    assert.equal(parseSubjectHintFromPath("Gv't Leased Research/Inventory/x.pdf").vertical, 'gov');
  });

  it('handles a property path with no City, ST subfolder', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/F/Fresenius/some doc.pdf');
    assert.equal(h.tenant_brand, 'Fresenius');
    assert.equal(h.city, null);
    assert.equal(h.state, null);
    assert.equal(h.vertical, 'dia'); // tenant cue
  });

  it('tolerates a flat store path with no anchor', () => {
    const h = parseSubjectHintFromPath("Storage OM's/Some Brand Flyer.pdf");
    assert.equal(h.tenant_brand, null);
    assert.equal(h.city, null);
    assert.equal(h.vertical, null);
  });

  it('normalizes backslash (local Windows) paths', () => {
    const h = parseSubjectHintFromPath('PROPERTIES\\D\\DaVita Dialysis\\Tulsa, OK\\OM.pdf');
    assert.equal(h.city, 'Tulsa');
    assert.equal(h.state, 'OK');
  });
});

// ── Stage A (Slice 2d.1): recover City/ST + address + portfolio from the
// filename / fused tenant folder (the clean City, ST subfolder is the exception).
describe('folder-feed City/ST + address + portfolio recovery', () => {
  it('extracts City, ST embedded in a filename (not anchored to the end)', () => {
    assert.deepEqual(extractCityState('Hamilton Electric- Austin, TX- Valuation Analysis Memo.docx'),
      { city: 'Austin', state: 'TX' });
    assert.deepEqual(extractCityState('Master Sheet - Colony, TX.xlsx'), { city: 'Colony', state: 'TX' });
    assert.deepEqual(extractCityState('Valuation Analysis Memo - Fountainview Dental - Raytown, MO (Stan Johnson Company).pdf'),
      { city: 'Raytown', state: 'MO' });
    assert.equal(extractCityState('AMRA Portfolio of 7 - Master Sheet.xlsx'), null); // no City, ST
    assert.equal(extractCityState('Office Comps 4-12-22.xlsx'), null);              // 22 is not a state
  });

  it('un-fuses City, ST from a combined tenant folder name', () => {
    assert.deepEqual(extractCityState('Cypress Grove Office - Greenville, MS'), { city: 'Greenville', state: 'MS' });
  });

  it('extracts a leading street address', () => {
    assert.equal(extractStreetAddress('9216 S Toledo Ave - Tulsa, OK'), '9216 S Toledo Ave');
    assert.equal(extractStreetAddress('Fountainview Dental - KC (Master Sheet).xlsx'), null);
  });

  it('flags multi-property portfolios', () => {
    assert.equal(isPortfolioHint('AMRA Portfolio of 7'), true);
    assert.equal(isPortfolioHint('GSA-USDA Portfolio (4) - TX'), true);
    assert.equal(isPortfolioHint('Rite Aid Portfolio of 12 - PA & TN'), true);
    assert.equal(isPortfolioHint('Hamilton Electric'), false);
    assert.equal(isPortfolioHint('FMC - Martin, TN (Master Sheet).xlsx'), false);
  });

  it('reduces a fused/portfolio tenant label to a matchable core', () => {
    assert.equal(tenantCore('Cypress Grove Office - Greenville, MS'), 'Cypress Grove Office');
    assert.equal(tenantCore('FMC Portfolio of 14 - Capital Square'), 'FMC');
    assert.equal(tenantCore('DaVita Portfolio (3) - AR'), 'DaVita');
    assert.equal(tenantCore('Kohls Portfolio 10 - BRIGGS HERROLD'), 'Kohls');
    assert.equal(tenantCore('Hamilton Electric'), 'Hamilton Electric');
  });

  it('recovers the anchor from a filename when there is no City, ST subfolder', () => {
    const h = parseSubjectHintFromPath(
      'PROPERTIES/H/Hamilton Electric/Hamilton Electric- Austin, TX- Valuation Analysis Memo (Stan Johnson Company).docx');
    assert.equal(h.tenant_brand, 'Hamilton Electric');
    assert.equal(h.city, 'Austin');
    assert.equal(h.state, 'TX');
    assert.equal(h.is_portfolio, false);
  });

  it('un-fuses a combined tenant folder + flags portfolios from the path', () => {
    const fused = parseSubjectHintFromPath(
      'PROPERTIES/Multi/Cypress Grove Office - Greenville, MS/Cypress Grove Office - Greenville MS - Valuation Analysis Memo.docx');
    assert.equal(fused.city, 'Greenville');
    assert.equal(fused.state, 'MS');
    assert.equal(fused.tenant_core, 'Cypress Grove Office');

    const port = parseSubjectHintFromPath(
      'PROPERTIES/A/AMRA Portfolio of 7/AMRA Portfolio of 7 - Master Sheet.xlsx');
    assert.equal(port.is_portfolio, true);
    assert.equal(port.tenant_core, 'AMRA');
  });
});

// Slice 2e — the real PROPERTIES tree has no City, ST folder level; the city and
// state live in the FILENAME. These guards unlock the non-OM attach path.
describe('folder-feed parseCityStateFromFilename (Slice 2e)', () => {
  const cases = [
    ['Vervent - Portland, OR (Master Sheet).xlsx',                                  'Portland',    'OR'],
    ['First Oklahoma Federal Credit Union - Tulsa, OK (Master Sheet).xlsx',         'Tulsa',       'OK'],
    ['Vistra Corp (UNIFIED) - Irving, TX (Master Sheet).xlsx',                      'Irving',      'TX'],
    ['Thrive - San Antonio, TX (Master Sheet).xlsx',                               'San Antonio', 'TX'],
    ['Master Sheet - Colony, TX.xlsx',                                              'Colony',      'TX'],
    ['Brand - Alpharetta, GA - Valuation Analysis Memo.pdf',                        'Alpharetta',  'GA'],
  ];
  for (const [name, city, state] of cases) {
    it(`parses "${name}" → ${city}, ${state}`, () => {
      assert.deepEqual(parseCityStateFromFilename(name), { city, state });
    });
  }

  it('returns null for a pure rollup name with no City, ST', () => {
    assert.equal(parseCityStateFromFilename('ARA Portfolio of 5 - Master Sheet.xlsx'), null);
    assert.equal(parseCityStateFromFilename('North American Dental Group Portfolio of 10 - Master Sheet.xlsx'), null);
  });

  it('returns null when the trailing 2-caps token is not a real US state', () => {
    assert.equal(parseCityStateFromFilename('Something - Memo, ZZ.pdf'), null);
    assert.equal(parseCityStateFromFilename('Brand - Foo, XX (Master Sheet).xlsx'), null);
  });
});

describe('folder-feed parseSubjectHintFromPath — filename City, ST fallback (Slice 2e)', () => {
  it('fills city/state from the filename when there is no City, ST folder', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/V/Vervent/Vervent - Portland, OR (Master Sheet).xlsx');
    assert.equal(h.tenant_brand, 'Vervent');
    assert.equal(h.city, 'Portland');
    assert.equal(h.state, 'OR');
  });

  it('keeps the tenant_brand from the folder, not the filename', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/F/First Oklahoma Federal Credit Union/First Oklahoma Federal Credit Union - Tulsa, OK (Master Sheet).xlsx');
    assert.equal(h.tenant_brand, 'First Oklahoma Federal Credit Union');
    assert.equal(h.city, 'Tulsa');
    assert.equal(h.state, 'OK');
  });

  it('a City, ST PATH SEGMENT still wins over a filename city', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/D/DaVita Dialysis/Tulsa, OK/DaVita - Reno, NV OM.pdf');
    assert.equal(h.city, 'Tulsa');
    assert.equal(h.state, 'OK');
  });

  it('rollup filename with no City, ST leaves city/state null', () => {
    const h = parseSubjectHintFromPath('PROPERTIES/Portfolio/ARA Portfolio of 5/ARA Portfolio of 5 - Master Sheet.xlsx');
    assert.equal(h.tenant_brand, 'ARA Portfolio of 5');
    assert.equal(h.city, null);
    assert.equal(h.state, null);
  });
});

// Slice 2f — archive / working-folder exclusion. Anchored to a whole path
// SEGMENT so a tenant legitimately named "Old Dominion …" isn't caught.
describe('folder-feed isExcludedFolderPath (Slice 2f)', () => {
  const BASE = "/sites/TeamBriggs20/Shared Documents/Gv't Leased Research/On Market";

  it('excludes an /OLD/ archive subfolder + its files', () => {
    assert.equal(isExcludedFolderPath(`${BASE}/OLD`), true);
    assert.equal(isExcludedFolderPath(`${BASE}/OLD/Some Deprecated Listing OM.pdf`), true);
  });

  it('excludes /Archive/ and /Archived/ segments (any case)', () => {
    assert.equal(isExcludedFolderPath(`${BASE}/Archive/x.pdf`), true);
    assert.equal(isExcludedFolderPath(`${BASE}/archived/y.pdf`), true);
  });

  it('excludes a leading-underscore working/staging subfolder', () => {
    assert.equal(isExcludedFolderPath(
      '/sites/TeamBriggs20/Shared Documents/Dialysis Research/Comps/On Market/_added or updated in comps spreadsheet'), true);
    assert.equal(isExcludedFolderPath(
      '/sites/TeamBriggs20/Shared Documents/Dialysis Research/Comps/On Market/_added or updated in comps spreadsheet/y.xlsx'), true);
  });

  it('does NOT exclude a live deal folder', () => {
    assert.equal(isExcludedFolderPath(`${BASE}/Live Deal`), false);
    assert.equal(isExcludedFolderPath(`${BASE}/Live Deal/z.pdf`), false);
  });

  it('does NOT catch a tenant named "Old Dominion …" (segment ≠ OLD)', () => {
    assert.equal(isExcludedFolderPath(`${BASE}/Old Dominion Freight Line - Greenville, NC`), false);
    assert.equal(isExcludedFolderPath(
      `${BASE}/Old Dominion Freight Line - Greenville, NC/Old Dominion OM.pdf`), false);
  });

  it('tolerates empty / backslash paths', () => {
    assert.equal(isExcludedFolderPath(''), false);
    assert.equal(isExcludedFolderPath(null), false);
    assert.equal(isExcludedFolderPath(`${BASE}\\OLD\\x.pdf`), true);
  });
});

describe('folder-feed looksLikePortfolioRollup (Slice 2e)', () => {
  it('flags a Portfolio-bucket tenant with no resolvable city', () => {
    assert.equal(looksLikePortfolioRollup({ tenant_brand: 'ARA Portfolio of 5', bucket: 'Portfolio', city: null, state: null }), true);
  });
  it('flags a "… Portfolio …" tenant regardless of bucket', () => {
    assert.equal(looksLikePortfolioRollup({ tenant_brand: 'North American Dental Group Portfolio of 10', bucket: 'N', city: null, state: null }), true);
  });
  it('does NOT flag a rollup-bucket file that resolved a City, ST', () => {
    assert.equal(looksLikePortfolioRollup({ tenant_brand: 'Thrive Portfolio', bucket: 'Portfolio', city: 'San Antonio', state: 'TX' }), false);
  });
  it('does NOT flag an ordinary single-property tenant', () => {
    assert.equal(looksLikePortfolioRollup({ tenant_brand: 'Vervent', bucket: 'V', city: null, state: null }), false);
  });
});
