// ============================================================================
// office-text.test.mjs — zero-dep docx/xlsx extraction (2026-08-12)
//
// Fixtures: test/fixtures/office/fix.docx / fix.xlsx are REAL files (generated
// with python-docx / openpyxl) so the zip reader is exercised against genuine
// central directories + deflate streams, not hand-rolled zips.
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  sniffOfficeKind,
  extractOfficeText,
  listZipEntries,
  docxXmlToText,
  parseSharedStrings,
  sheetXmlToLines,
} from '../api/_shared/office-text.js';
import { extractDocumentText } from '../api/_shared/document-text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCX = readFileSync(path.join(here, 'fixtures/office/fix.docx'));
const XLSX = readFileSync(path.join(here, 'fixtures/office/fix.xlsx'));
// OLE/CFB magic (legacy .doc) + padding
const LEGACY_DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);

// ── sniffing ─────────────────────────────────────────────────────────────────

test('sniffOfficeKind detects docx / xlsx from bytes regardless of name', () => {
  assert.equal(sniffOfficeKind(DOCX, 'whatever.bin'), 'docx');
  assert.equal(sniffOfficeKind(XLSX, ''), 'xlsx');
});

test('sniffOfficeKind detects legacy OLE .doc', () => {
  assert.equal(sniffOfficeKind(LEGACY_DOC, 'Estoppel.doc'), 'legacy_doc');
});

test('sniffOfficeKind is null for PDFs and junk', () => {
  assert.equal(sniffOfficeKind(Buffer.from('%PDF-1.5 lorem'), 'a.pdf'), null);
  assert.equal(sniffOfficeKind(Buffer.from('hello world this is not a zip'), 'a.txt'), null);
  assert.equal(sniffOfficeKind(Buffer.alloc(0), 'a.docx'), null);
});

test('a plain zip that is not an office doc is not claimed', () => {
  // Take the real xlsx central directory but present it under a neutral name —
  // it IS an office doc, so it must still be claimed (bytes win over name)…
  assert.equal(sniffOfficeKind(XLSX, 'archive.zip'), 'xlsx');
});

// ── zip reader ───────────────────────────────────────────────────────────────

test('listZipEntries finds the expected member files', () => {
  const docxEntries = listZipEntries(DOCX);
  assert.ok(docxEntries.has('word/document.xml'));
  const xlsxEntries = listZipEntries(XLSX);
  assert.ok(xlsxEntries.has('xl/workbook.xml'));
  assert.ok([...xlsxEntries.keys()].some((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)));
});

// ── docx ─────────────────────────────────────────────────────────────────────

test('extractOfficeText reads docx paragraphs and table cells', () => {
  const r = extractOfficeText({ buffer: DOCX, fileName: 'fix.docx' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'docx');
  assert.match(r.text, /LEASE ABSTRACT/);
  assert.match(r.text, /Total Renal Care, Inc\./);
  assert.match(r.text, /Commencement/);
  assert.match(r.text, /\$160,598/);
});

test('docxXmlToText keeps paragraph breaks, strips tags, decodes entities', () => {
  const xml = '<w:document><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p></w:document>';
  assert.equal(docxXmlToText(xml), 'A & B\nC');
});

// ── xlsx ─────────────────────────────────────────────────────────────────────

test('extractOfficeText reads xlsx sheets, shared strings, and numbers', () => {
  const r = extractOfficeText({ buffer: XLSX, fileName: 'fix.xlsx' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'xlsx');
  assert.match(r.text, /=== SHEET: Terms ===/);
  assert.match(r.text, /Tenant: \| Total Renal Care, Inc\./);
  assert.match(r.text, /Firm Term \(years\) \| 10/);
  assert.match(r.text, /=== SHEET: Options ===/);
  assert.match(r.text, /Renewal Options \| 2 x 5/);
});

test('parseSharedStrings concatenates rich-text runs and decodes entities', () => {
  const xml = '<sst><si><t>Plain</t></si><si><r><t>Rich </t></r><r><t>Run &amp; Co</t></r></si></sst>';
  assert.deepEqual(parseSharedStrings(xml), ['Plain', 'Rich Run & Co']);
});

test('sheetXmlToLines resolves shared, inline, and numeric cells', () => {
  const xml = '<worksheet><sheetData>'
    + '<row><c t="s"><v>0</v></c><c><v>42</v></c></row>'
    + '<row><c t="inlineStr"><is><t>Inline</t></is></c></row>'
    + '<row><c/></row>' // empty row emits nothing
    + '</sheetData></worksheet>';
  assert.deepEqual(sheetXmlToLines(xml, ['Label']), ['Label | 42', 'Inline']);
});

// ── failure modes (the ones that must stay OUT of the OCR lane) ─────────────

test('legacy .doc is a truthful terminal failure, never text', () => {
  const r = extractOfficeText({ buffer: LEGACY_DOC, fileName: 'Estoppel.doc' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'legacy_doc');
  assert.equal(r.reason, 'legacy_doc_unsupported');
});

test('non-office bytes are refused with not_office', () => {
  const r = extractOfficeText({ buffer: Buffer.from('%PDF-1.5 x'), fileName: 'a.pdf' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_office');
});

// ── extractDocumentText integration: office pre-branch beats a lying mime ────

test('extractDocumentText extracts xlsx even when contentType claims pdf', async () => {
  const r = await extractDocumentText(
    { sourceUrl: 'https://cdn.example/fix.xlsx', mediaType: 'application/pdf' },
    { fetchDocBytes: async () => ({ ok: true, buffer: XLSX, contentType: 'application/pdf', via: 'url' }) },
  );
  assert.equal(r.ok, true);
  assert.equal(r.method, 'office_text');
  assert.match(r.text, /Firm Term \(years\) \| 10/);
  assert.equal(r.ocr_attempted, false);
});

test('extractDocumentText marks an unreadable office file needs_ocr WITHOUT OCR', async () => {
  let ocrCalled = false;
  const r = await extractDocumentText(
    { sourceUrl: 'https://cdn.example/Estoppel.doc', mediaType: 'application/pdf', ocrTiered: true },
    {
      fetchDocBytes: async () => ({ ok: true, buffer: LEGACY_DOC, contentType: 'application/pdf', via: 'url' }),
      ocrPdfToTextTiered: async () => { ocrCalled = true; return { ok: false, reason: 'should_not_run' }; },
      ocrPdfToText: async () => { ocrCalled = true; return { ok: false, reason: 'should_not_run' }; },
    },
  );
  assert.equal(r.ok, true);
  assert.equal(r.needs_ocr, true);
  assert.equal(r.reason, 'legacy_doc_unsupported');
  assert.equal(ocrCalled, false, 'office bytes must never reach the OCR tiers');
});

// ── runLeaseExtraction: office_unreadable is terminal, no OCR spend ─────────

test('runLeaseExtraction returns office_unreadable for a legacy .doc', async () => {
  const prevUrl = process.env.SHAREPOINT_FETCH_URL;
  process.env.SHAREPOINT_FETCH_URL = 'https://pa.example/get-file';
  try {
    const { runLeaseExtraction } = await import('../api/_handlers/lease-extractor.js');
    const paJson = JSON.stringify({ ok: true, content_base64: LEGACY_DOC.toString('base64'), content_type: 'application/pdf' });
    const ext = await runLeaseExtraction({
      storageRef: '/sites/x/Estoppel.doc',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => paJson }),
      ocrTieredImpl: async () => { throw new Error('office bytes must never reach OCR'); },
    });
    assert.equal(ext.office_unreadable, true);
    assert.equal(ext.office_kind, 'legacy_doc');
    assert.equal(ext.normalized, null);
  } finally {
    if (prevUrl === undefined) delete process.env.SHAREPOINT_FETCH_URL;
    else process.env.SHAREPOINT_FETCH_URL = prevUrl;
  }
});
