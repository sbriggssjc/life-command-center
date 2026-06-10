// Phase 2 folder-feed (Slice 1) — classifier + path→subject_hint anchor.
// These are the cheap, deterministic guards the worker leans on before any
// content parse: filename decides what gets staged this slice (OM/flyer only),
// and the path resolves the entity (tenant/brand + City, ST + vertical).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFile, parseSubjectHintFromPath } from '../api/_shared/folder-feed-classify.js';

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
