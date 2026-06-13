// R15 Phase 2 — CRE owner extractor. The load-bearing piece is the master-sheet
// xlsx label scan: find a labelled cell (Owner / True Owner / Recorded Owner /
// Landlord / Seller / Ownership), take the adjacent value (right then below),
// honour the priority order, and NEVER return a junk cell. Built against a
// synthetic ExcelJS workbook (buffer round-trip — the realistic path).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

const {
  extractCreOwner,
  scanLoadedWorkbookForOwner,
  ownerLabelRank,
  looksLikeOwnerValue,
  classifyOwnerDoc,
  pickOwnerBearingDoc,
  orderOwnerBearingDocs,
  aiOwnerFromText,
  debugLabelsForDoc,
  dumpLoadedWorkbookCells,
} = await import('../api/_shared/cre-owner-extract.js');

// Build an xlsx buffer from a sparse {[ "r,c" ]: value} cell map (1-indexed).
async function workbookBuffer(cells, { sheetName = 'Master' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const [key, value] of Object.entries(cells)) {
    const [r, c] = key.split(',').map(Number);
    ws.getRow(r).getCell(c).value = value;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('ownerLabelRank', () => {
  it('ranks True Owner > Recorded Owner > Owner/Ownership > Landlord > Seller', () => {
    assert.equal(ownerLabelRank('True Owner'), 1);
    assert.equal(ownerLabelRank('Recorded Owner:'), 2);
    assert.equal(ownerLabelRank('Owner'), 3);
    assert.equal(ownerLabelRank('Ownership'), 3);
    assert.equal(ownerLabelRank('Landlord'), 4);
    assert.equal(ownerLabelRank('Seller'), 5);
  });
  it('is 0 for non-labels', () => {
    assert.equal(ownerLabelRank('Address'), 0);
    assert.equal(ownerLabelRank('Vervent Holdings LLC'), 0);
    assert.equal(ownerLabelRank(''), 0);
  });
});

describe('looksLikeOwnerValue', () => {
  it('accepts a real owner string (person or LLC)', () => {
    assert.equal(looksLikeOwnerValue('Vervent Holdings LLC'), true);
    assert.equal(looksLikeOwnerValue('John Smith'), true);
  });
  it('rejects empty / numeric / date / a label / over-long', () => {
    assert.equal(looksLikeOwnerValue(''), false);
    assert.equal(looksLikeOwnerValue('1,250,000'), false);
    assert.equal(looksLikeOwnerValue('2026-01-01'), false);
    assert.equal(looksLikeOwnerValue('Owner'), false);
    assert.equal(looksLikeOwnerValue('x'.repeat(200)), false);
  });
});

describe('classifyOwnerDoc', () => {
  it('routes by extension', () => {
    assert.equal(classifyOwnerDoc({ fileName: 'Master Sheet.xlsx' }), 'xlsx');
    assert.equal(classifyOwnerDoc({ fileName: 'BOV.pdf' }), 'pdf');
    assert.equal(classifyOwnerDoc({ fileName: 'memo.docx' }), 'docx');
    assert.equal(classifyOwnerDoc({ fileName: 'notes.txt' }), 'other');
  });
});

describe('pickOwnerBearingDoc', () => {
  it('prefers master > comp > bov > om and requires a source_url', () => {
    const best = pickOwnerBearingDoc([
      { document_type: 'om', source_url: '/a/om.pdf' },
      { document_type: 'master', source_url: '/a/master.xlsx' },
      { document_type: 'bov', source_url: '/a/bov.pdf' },
    ]);
    assert.equal(best.document_type, 'master');
  });
  it('skips docs without a source_url; null when none usable', () => {
    assert.equal(pickOwnerBearingDoc([{ document_type: 'master' }]), null);
    assert.equal(pickOwnerBearingDoc([]), null);
  });
});

describe('scanLoadedWorkbookForOwner (label scan)', () => {
  it('takes the value in the cell to the RIGHT of the label', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(7).getCell(1).value = 'True Owner';
    ws.getRow(7).getCell(2).value = 'Vervent Holdings LLC';
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit.name, 'Vervent Holdings LLC');
    assert.equal(hit.label, 'True Owner');
  });

  it('falls back to the cell BELOW the label when the right cell is empty', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(3).getCell(4).value = 'Owner';
    ws.getRow(4).getCell(4).value = 'Acme Real Estate Partners LP';
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit.name, 'Acme Real Estate Partners LP');
  });

  it('skips a BLANK gap to the right (Label | (empty) | Value layout)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(2).getCell(1).value = 'True Owner';
    // col 2 empty (merged-cell / formatting gap) → value lives at col 3
    ws.getRow(2).getCell(3).value = 'Gap Owner Holdings LLC';
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit.name, 'Gap Owner Holdings LLC');
  });

  it('does NOT jump PAST a populated non-owner cell to the right', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(2).getCell(1).value = 'Owner';
    ws.getRow(2).getCell(2).value = 1250000;                 // first non-empty is numeric → stop here
    ws.getRow(2).getCell(3).value = 'Not The Owner Co LLC';  // must NOT be grabbed
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit, null);
  });

  it('prefers True Owner over Recorded Owner / Seller when several are present', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(1).getCell(1).value = 'Seller';        ws.getRow(1).getCell(2).value = 'Seller Co LLC';
    ws.getRow(2).getCell(1).value = 'Recorded Owner'; ws.getRow(2).getCell(2).value = 'Recorded Co LLC';
    ws.getRow(3).getCell(1).value = 'True Owner';     ws.getRow(3).getCell(2).value = 'True Owner Co LLC';
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit.name, 'True Owner Co LLC');
  });

  it('returns null for a junk adjacent cell (number / empty)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(1).getCell(1).value = 'Owner';
    ws.getRow(1).getCell(2).value = 1250000;        // numeric → not an owner
    // (no cell below) → no usable adjacent
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit, null);
  });

  it('is robust to a hyperlink-valued owner cell', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('M');
    ws.getRow(5).getCell(1).value = 'Landlord';
    ws.getRow(5).getCell(2).value = { text: 'Boyd Watterson Global', hyperlink: 'https://x' };
    const hit = scanLoadedWorkbookForOwner(wb);
    assert.equal(hit.name, 'Boyd Watterson Global');
  });
});

describe('extractCreOwner (dispatch)', () => {
  it('xlsx → label scan via buffer round-trip', async () => {
    const buf = await workbookBuffer({ '7,1': 'Owner', '7,2': 'Vervent Holdings LLC' });
    const r = await extractCreOwner({ buffer: buf, fileName: 'Vervent - Portland, OR (Master Sheet).xlsx' });
    assert.equal(r.method, 'master_sheet_label_scan');
    assert.equal(r.name, 'Vervent Holdings LLC');
  });

  it('xlsx with no owner label → name null (never invents)', async () => {
    const buf = await workbookBuffer({ '1,1': 'Address', '1,2': '10 Market St' });
    const r = await extractCreOwner({ buffer: buf, fileName: 'sheet.xlsx' });
    assert.equal(r.name, null);
  });

  it('pdf → AI fallback (injected), returns the owner name', async () => {
    const r = await extractCreOwner(
      { buffer: Buffer.from('%PDF-1.4 fake'), fileName: 'BOV.pdf' },
      { pdfOwner: async () => 'Top Golf Owner LLC' },
    );
    assert.equal(r.method, 'pdf_ai_fallback');
    assert.equal(r.name, 'Top Golf Owner LLC');
  });

  it('docx → unsupported, name null (owner stays pending)', async () => {
    const r = await extractCreOwner({ buffer: Buffer.from('PK fake'), fileName: 'memo.docx' });
    assert.equal(r.method, 'unsupported_doc_type');
    assert.equal(r.name, null);
  });

  it('no bytes → no_bytes, name null', async () => {
    const r = await extractCreOwner({ buffer: Buffer.alloc(0), fileName: 'x.xlsx' });
    assert.equal(r.name, null);
    assert.equal(r.method, 'no_bytes');
  });
});

// blocker 2 — the owner prompt distinguishes owner from tenant.
describe('aiOwnerFromText (owner-vs-tenant)', () => {
  it('passes the tenant brand into the prompt as a NEGATIVE signal', async () => {
    let captured = '';
    const invokeAI = async ({ prompt }) => { captured = prompt; return { ok: true, data: { response: '{"owner_name":"Vervent Holdings LLC"}' } }; };
    const name = await aiOwnerFromText('… owner is Vervent Holdings LLC …', { tenantBrand: 'HUB Group Trucking', invokeAI });
    assert.equal(name, 'Vervent Holdings LLC');
    assert.match(captured, /HUB Group Trucking/, 'names the tenant brand to exclude');
    assert.match(captured, /TENANT/, 'instructs the model to exclude the tenant/occupant');
    assert.match(captured, /SELLER|LANDLORD|fee owner/i, 'asks for the owner/seller/landlord');
  });

  it('returns null when the model identifies only a tenant (never guesses an owner)', async () => {
    const invokeAI = async () => ({ ok: true, data: { response: '{"owner_name": null}' } });
    const name = await aiOwnerFromText('HUB Group Trucking occupies the building (tenant).', { tenantBrand: 'HUB Group Trucking', invokeAI });
    assert.equal(name, null);
  });

  it('returns null on AI failure', async () => {
    const invokeAI = async () => ({ ok: false });
    assert.equal(await aiOwnerFromText('text', { invokeAI }), null);
  });
});

// blocker 3 — the label-scan diagnostic mode returns the cell labels.
describe('debugLabelsForDoc / dumpLoadedWorkbookCells', () => {
  it('dumps non-empty cells, flags owner labels, and returns the scan verdict', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Master');
    ws.getRow(1).getCell(1).value = 'Tenant';
    ws.getRow(1).getCell(2).value = 'Top Golf';
    ws.getRow(2).getCell(1).value = 'True Owner';
    ws.getRow(2).getCell(2).value = 'Topgolf RE Owner LLC';
    const cells = dumpLoadedWorkbookCells(wb);
    assert.ok(cells.length >= 4, 'returns every non-empty cell');
    const ownerLabel = cells.find((c) => c.text === 'True Owner');
    assert.equal(ownerLabel.is_owner_label, true);
    assert.equal(cells.find((c) => c.text === 'Tenant').is_owner_label, false);

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const dump = await debugLabelsForDoc({ buffer: buf, fileName: 'Top Golf (Master Sheet).xlsx' });
    assert.equal(dump.kind, 'xlsx');
    assert.ok(dump.owner_labels.some((c) => c.text === 'True Owner'), 'surfaces the owner label');
    assert.equal(dump.scan.name, 'Topgolf RE Owner LLC');
  });

  it('is a no-op for a non-xlsx doc', async () => {
    const dump = await debugLabelsForDoc({ buffer: Buffer.from('%PDF'), fileName: 'BOV.pdf' });
    assert.equal(dump.note, 'not_xlsx');
    assert.deepEqual(dump.cells, []);
  });
});

describe('orderOwnerBearingDocs', () => {
  it('orders master > comp > bov > om, dropping docs with no source_url', () => {
    const ordered = orderOwnerBearingDocs([
      { document_type: 'om', source_url: '/om' },
      { document_type: 'master', source_url: '/m' },
      { document_type: 'bov', source_url: '/b' },
      { document_type: 'lease' /* no source_url */ },
    ]);
    assert.deepEqual(ordered.map((d) => d.document_type), ['master', 'bov', 'om']);
  });
});
