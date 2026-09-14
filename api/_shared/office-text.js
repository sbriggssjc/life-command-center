// ============================================================================
// office-text — zero-dependency docx/xlsx text extraction (2026-08-12)
// Life Command Center
//
// WHY: the OCR path is PDF/image-only, so office "Lease Abstract" files (often
// the most term-dense docs in a deal folder) could never yield text — they were
// ASCII-salvaged to junk or, worse, POSTed to Document AI (which 400s on
// non-PDF bytes) and then to gpt-4o vision (paid spend on unreadable bytes).
// Grounded 2026-08-12: the ENTIRE remaining lease needs_ocr queue was this
// format tail. This module extracts the text properly, for free, in-process.
//
// ZERO NEW DEPS: .docx/.xlsx are ZIP archives of XML. A minimal central-
// directory reader + zlib.inflateRawSync unpacks the two entries we need:
//   docx → word/document.xml                 (paragraphs + table cells)
//   xlsx → xl/sharedStrings.xml + xl/worksheets/sheet*.xml (+ workbook.xml names)
// Legacy OLE .doc/.xls (D0 CF 11 E0) is detected but NOT parsed (off-box tail).
//
// CONSUMERS: lease-extractor.js::runLeaseExtraction (before the OCR branch —
// office bytes must NEVER reach ocrPdfToTextTiered) and
// document-text.js::extractDocumentText (before the lossy binary salvage).
// Output text feeds the SAME AI extraction prompts as PDF text.
//
// Discipline: pure functions, no I/O, never throws to the caller
// (extractOfficeText returns { ok:false, reason } on any parse surprise).
// ============================================================================

import zlib from 'zlib';

// ── Minimal ZIP reader ───────────────────────────────────────────────────────

/** Find the End Of Central Directory record (PK\x05\x06) near the end. */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557); // max comment 65535 + 22
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

/**
 * List zip entries from the central directory: name → { method, localOffset,
 * compSize }. Returns null when the buffer is not a readable zip.
 */
export function listZipEntries(buf) {
  if (!buf || buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
  const eocd = findEocd(buf);
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries.size ? entries : null;
}

/** Read + inflate one entry (by the central-directory record). Null on failure. */
export function readZipEntry(buf, entry) {
  try {
    const lo = entry.localOffset;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) return null;
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + entry.compSize);
    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    return null; // unsupported compression method
  } catch {
    return null;
  }
}

// ── XML helpers ──────────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// ── docx ─────────────────────────────────────────────────────────────────────

/** word/document.xml → plain text (paragraph breaks kept, table cells piped). */
export function docxXmlToText(xml) {
  let s = String(xml)
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')     // table cell boundary
    .replace(/<\/w:p>/g, '\n');      // paragraph boundary
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── xlsx ─────────────────────────────────────────────────────────────────────

/** xl/sharedStrings.xml → array of resolved strings (rich runs concatenated). */
export function parseSharedStrings(xml) {
  const out = [];
  const items = String(xml).match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const si of items) {
    const ts = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
    out.push(decodeEntities(ts.map((t) => t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')).join('')));
  }
  return out;
}

/** One worksheet XML → text lines (non-empty cells joined with " | "). */
export function sheetXmlToLines(xml, shared) {
  const lines = [];
  const rows = String(xml).match(/<row\b[\s\S]*?<\/row>/g) || [];
  for (const row of rows) {
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cellRe.exec(row))) {
      const attrs = m[1] || '';
      const body = m[2] || '';
      const tAttr = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      let val = '';
      if (tAttr === 'inlineStr') {
        const ts = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
        val = ts.map((t) => t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')).join('');
      } else {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
        val = tAttr === 's' ? (shared[parseInt(v, 10)] ?? '') : v;
      }
      val = decodeEntities(val).trim();
      if (val !== '') cells.push(val);
    }
    if (cells.length) lines.push(cells.join(' | '));
  }
  return lines;
}

/** xl/workbook.xml → ordered sheet names (best-effort; file order otherwise). */
export function parseSheetNames(xml) {
  const out = [];
  const sheets = String(xml || '').match(/<sheet\b[^>]*>/g) || [];
  for (const s of sheets) {
    const name = (s.match(/\bname="([^"]*)"/) || [])[1];
    if (name != null) out.push(decodeEntities(name));
  }
  return out;
}

// ── Kind sniffing ────────────────────────────────────────────────────────────

/**
 * Detect an office document from BYTES (never trust mediaType — the SharePoint
 * PA flow often reports application/pdf for everything, which is exactly how
 * xlsx bytes ended up POSTed to Document AI). Extension is a fallback for a
 * zip whose central directory we couldn't read.
 * Returns 'docx' | 'xlsx' | 'legacy_doc' | null.
 */
export function sniffOfficeKind(buffer, fileName = '') {
  if (!buffer || buffer.length < 8) return null;
  // OLE/CFB (legacy .doc/.xls): D0 CF 11 E0 A1 B1 1A E1
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return 'legacy_doc';
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null; // not a zip
  const ext = String(fileName || '').toLowerCase().match(/\.(docx|xlsx|xlsm)$/)?.[1] || null;
  const entries = listZipEntries(buffer);
  if (!entries) return ext === 'docx' ? 'docx' : (ext ? 'xlsx' : null);
  if (entries.has('word/document.xml')) return 'docx';
  if (entries.has('xl/workbook.xml')) return 'xlsx';
  // A zip that is neither (e.g. a real .zip attachment) is not an office doc —
  // unless the extension says so and the zip was truncated/odd.
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Extract plain text from a docx/xlsx buffer. Never throws.
 * Returns { ok:true, kind, text } or { ok:false, kind, reason }.
 * Note: xlsx numeric cells are emitted as stored (dates appear as serials) —
 * acceptable for the AI extraction prompt; labels carry the semantics.
 */
export function extractOfficeText({ buffer, fileName = '' } = {}) {
  const kind = sniffOfficeKind(buffer, fileName);
  if (!kind) return { ok: false, kind: null, reason: 'not_office' };
  if (kind === 'legacy_doc') return { ok: false, kind, reason: 'legacy_doc_unsupported' };
  const entries = listZipEntries(buffer);
  if (!entries) return { ok: false, kind, reason: 'zip_unreadable' };
  try {
    if (kind === 'docx') {
      const e = entries.get('word/document.xml');
      const xml = e && readZipEntry(buffer, e);
      if (!xml) return { ok: false, kind, reason: 'docx_no_document_xml' };
      const text = docxXmlToText(xml.toString('utf8'));
      if (!text) return { ok: false, kind, reason: 'docx_empty' };
      return { ok: true, kind, text };
    }
    // xlsx
    const ssEntry = entries.get('xl/sharedStrings.xml');
    const shared = ssEntry ? parseSharedStrings((readZipEntry(buffer, ssEntry) || Buffer.alloc(0)).toString('utf8')) : [];
    const wbEntry = entries.get('xl/workbook.xml');
    const names = wbEntry ? parseSheetNames((readZipEntry(buffer, wbEntry) || Buffer.alloc(0)).toString('utf8')) : [];
    const sheetKeys = [...entries.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort((a, b) => parseInt(a.match(/sheet(\d+)/)[1], 10) - parseInt(b.match(/sheet(\d+)/)[1], 10));
    if (!sheetKeys.length) return { ok: false, kind, reason: 'xlsx_no_sheets' };
    const out = [];
    sheetKeys.forEach((k, i) => {
      const xmlBuf = readZipEntry(buffer, entries.get(k));
      if (!xmlBuf) return;
      const lines = sheetXmlToLines(xmlBuf.toString('utf8'), shared);
      if (lines.length) {
        out.push(`=== SHEET: ${names[i] || `Sheet${i + 1}`} ===`);
        out.push(...lines);
      }
    });
    const text = out.join('\n').trim();
    if (!text) return { ok: false, kind, reason: 'xlsx_empty' };
    return { ok: true, kind, text };
  } catch (err) {
    return { ok: false, kind, reason: `office_parse_threw:${err?.message || 'err'}` };
  }
}
