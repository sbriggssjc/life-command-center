// Phase 2 folder-feed (Slice 1) — classifier + path→subject_hint anchor.
// These are the cheap, deterministic guards the worker leans on before any
// content parse: filename decides what gets staged this slice (OM/flyer only),
// and the path resolves the entity (tenant/brand + City, ST + vertical).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFile, parseSubjectHintFromPath,
  extractCityState, extractStreetAddress, isPortfolioHint, tenantCore,
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
