// ============================================================================
// R15 Phase 2 — CRE owner extractor (xlsx-first, PDF fallback)
// Life Command Center
//
// Phase 1's light-attach path registers a CRE property by PATH ANCHOR alone, so
// `lcc_cre_properties.owner_entity_id` is left NULL. The OWNER is the whole point
// of the registry (it makes a CRE owner a first-class BD entity and reveals
// cross-asset-class overlap), so Phase 2 backfills it from the property's best
// owner-bearing doc.
//
// WHERE THE OWNER ACTUALLY LIVES (grounded live 2026-06-12): the CRE universe is
// dominated by Briggs MASTER SHEETS, which are .xlsx (master 185 xlsx / 10 pdf;
// comp 131 xlsx) — NOT OM PDFs. So the load-bearing reader is the master-sheet
// xlsx label scan. BOVs (49 pdf / 41 docx) + the occasional OM are the PDF
// fallback.
//
// Doctrine / boundaries:
//   • READ-ONLY on bytes fetched via the existing SharePoint Get flow. Never
//     writes back to SharePoint.
//   • The reader returns a CANDIDATE owner NAME only. It does NOT mint anything —
//     the name is fed through the shared guarded owner-minting path
//     (ensureCreOwnerEntity) by the backfill worker, so garbage cells never
//     become an entity. Never invents an owner: a junk/empty/numeric adjacent
//     cell yields null and the property stays owner-pending.
//   • The label scan is robust to format drift — it scans for a labelled cell and
//     takes the adjacent value; it NEVER hardcodes a cell address (no "B7").
//
// xlsx loading + the PDF AI fallback are injected as deps so the label-scan core
// is unit-testable without exceljs round-trips or AI/PA calls.
// ============================================================================

import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { invokeExtractionAI } from './ai.js';

// createRequire'd for the same reason as intake-extractor.js — pdf-parse 1.1.1's
// ESM-hostile debug block stays dormant under require().
const nodeRequire = createRequire(import.meta.url);

// ---- Owner labels (priority order) -----------------------------------------
// Lower rank = more preferred. The label varies across the Briggs master-sheet
// generations, so match a SET of synonyms case-insensitively (trailing colon
// tolerated). Preference: True Owner > Recorded Owner > Owner/Ownership >
// Landlord > Seller.
const OWNER_LABELS = [
  { re: /^true\s*owner$/i,                       rank: 1 },
  { re: /^(recorded\s*owner|owner\s*of\s*record)$/i, rank: 2 },
  { re: /^(owner|ownership|current\s*owner)$/i,  rank: 3 },
  { re: /^landlord$/i,                           rank: 4 },
  { re: /^seller$/i,                             rank: 5 },
];

// Return the label rank for a cell's text (0 = not a label). Strips a trailing
// colon and surrounding whitespace before matching (label cells are often
// "True Owner:" / "Owner :").
export function ownerLabelRank(text) {
  const t = String(text || '').trim().replace(/[:：]\s*$/, '').trim();
  if (!t) return 0;
  for (const { re, rank } of OWNER_LABELS) if (re.test(t)) return rank;
  return 0;
}

// True when a candidate value is a usable owner NAME. Rejects empties, pure
// numeric/date/currency cells, over-long blobs, and another label bleeding into
// the adjacent cell. Deliberately permissive on shape (an owner may be a person
// OR an LLC/Trust) — the structural junk/implausible guards run later, at the
// minting boundary.
export function looksLikeOwnerValue(text) {
  const t = String(text || '').trim();
  if (t.length < 2 || t.length > 120) return false;
  if (/^[\d.,$%/()\s:-]+$/.test(t)) return false; // pure number / date / currency / amount
  if (ownerLabelRank(t)) return false;            // adjacent cell is itself a label
  return true;
}

// Best-effort text of an ExcelJS cell across its value shapes (string / number /
// date / rich-text / hyperlink / formula-result).
function cellText(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('');
    if (typeof v.text === 'string') return v.text;              // hyperlink {text,hyperlink}
    if (v.result != null) return String(v.result);              // formula {formula,result}
  }
  try { return String(cell.text || ''); } catch { return ''; }
}

// True when the cell's underlying value is numeric/date (so it can't be a name),
// independent of any display formatting.
function isNumericOrDate(cell) {
  if (!cell) return false;
  const v = cell.value;
  if (typeof v === 'number') return true;
  if (v instanceof Date) return true;
  if (v && typeof v === 'object' && typeof v.result === 'number') return true;
  return false;
}

/**
 * Scan an already-loaded ExcelJS workbook for the best owner value. Pure (no
 * I/O) so it unit-tests directly. Walks every sheet (bounded), finds labelled
 * cells, and takes the adjacent value (right cell first, then the cell below).
 * Returns the highest-priority hit, or null.
 *
 * @returns {{name:string, label:string}|null}
 */
export function scanLoadedWorkbookForOwner(workbook, { maxRows = 400, maxCols = 80 } = {}) {
  let best = null; // { rank, name, label }
  for (const ws of workbook?.worksheets || []) {
    const rowCount = Math.min(ws.rowCount || 0, maxRows);
    const colCount = Math.min(ws.columnCount || 0, maxCols);
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= colCount; c++) {
        const labelCell = row.getCell(c);
        const rank = ownerLabelRank(cellText(labelCell));
        if (!rank) continue;
        // Adjacent value: right cell first, then the cell directly below.
        const adjacents = [row.getCell(c + 1), ws.getRow(r + 1).getCell(c)];
        for (const adj of adjacents) {
          if (isNumericOrDate(adj)) continue;
          const val = cellText(adj).trim();
          if (!looksLikeOwnerValue(val)) continue;
          // Strict `<` keeps the FIRST hit on a rank tie (deterministic).
          if (!best || rank < best.rank) best = { rank, name: val, label: cellText(labelCell).trim() };
          break; // first usable adjacent for this label
        }
      }
    }
  }
  return best ? { name: best.name, label: best.label } : null;
}

async function defaultLoadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// PDF owner fallback: extract text with pdf-parse, then ask the AI for the
// owner/seller name ONLY (not a full deal extraction). Returns a name or null.
async function defaultPdfOwner(buffer) {
  let text = '';
  try {
    const pdfParse = nodeRequire('pdf-parse');
    const parsed = await pdfParse(buffer);
    text = String(parsed?.text || '').trim();
  } catch {
    return null;
  }
  if (!text) return null;
  return aiOwnerFromText(text);
}

// Focused owner-only AI prompt over already-extracted document text. Returns a
// trimmed name string or null. Caps the text — the owner/seller almost always
// appears on the cover / disclosure pages.
export async function aiOwnerFromText(text) {
  const body = String(text || '').slice(0, 60_000);
  if (!body.trim()) return null;
  const prompt = `From the commercial real estate document text below, identify the property's OWNER (the entity or person that owns/holds title — labelled Owner, True Owner, Recorded Owner, Landlord, or Seller). Return ONLY a JSON object, no markdown:
{"owner_name": null}
Use null if no owner/seller is stated. Do NOT return the listing broker, marketing firm, or contact name. Return the name verbatim as written.

DOCUMENT:
${body}`;
  try {
    const res = await invokeExtractionAI({ prompt });
    if (!res?.ok) return null;
    const raw = res?.data?.response ?? res?.data ?? '';
    const jsonText = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const name = parsed?.owner_name;
    return name && String(name).trim() ? String(name).trim() : null;
  } catch {
    return null;
  }
}

// Classify the doc bytes by file name extension + content type.
export function classifyOwnerDoc({ contentType, fileName }) {
  const name = String(fileName || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (/\.(xlsx|xlsm|xls)$/.test(name) || /spreadsheet|excel/.test(ct)) return 'xlsx';
  if (/\.pdf$/.test(name) || ct.includes('pdf')) return 'pdf';
  if (/\.(docx|doc)$/.test(name) || ct.includes('word') || ct.includes('wordprocessing')) return 'docx';
  return 'other';
}

/**
 * Extract a candidate owner name from a CRE doc's bytes.
 *   • xlsx (master sheet / comp) → label scan (the load-bearing path).
 *   • pdf  (BOV / OM)            → pdf-parse text → owner-only AI prompt.
 *   • docx / other              → unsupported here (no text reader); owner stays
 *     pending for a later pass. (pdf-parse can't read docx, and we don't fork in
 *     a new binary reader for it in Phase 2.)
 *
 * Returns {name, method, label?} — name is null when no clean owner is found.
 * NEVER invents.
 *
 * @param {object} args  - {buffer, contentType, fileName}
 * @param {object} deps  - {loadWorkbook, pdfOwner} (injected for tests)
 */
export async function extractCreOwner({ buffer, contentType, fileName }, deps = {}) {
  const kind = classifyOwnerDoc({ contentType, fileName });
  if (!buffer || !buffer.length) return { name: null, method: 'no_bytes' };

  if (kind === 'xlsx') {
    const loadWorkbook = deps.loadWorkbook || defaultLoadWorkbook;
    try {
      const wb = await loadWorkbook(buffer);
      const hit = scanLoadedWorkbookForOwner(wb);
      return { name: hit?.name || null, label: hit?.label || null, method: 'master_sheet_label_scan' };
    } catch (e) {
      return { name: null, method: 'master_sheet_label_scan', error: e?.message?.slice(0, 200) || 'xlsx_load_failed' };
    }
  }

  if (kind === 'pdf') {
    const pdfOwner = deps.pdfOwner || defaultPdfOwner;
    const name = await pdfOwner(buffer).catch(() => null);
    return { name: name || null, method: 'pdf_ai_fallback' };
  }

  return { name: null, method: 'unsupported_doc_type' };
}

// Document-type read priority for the backfill (richest, most structured first):
// master > comp > bov > om > anything else. Returns the best doc carrying a
// source_url, or null.
const DOC_READ_PRIORITY = { master: 1, comp: 2, bov: 3, om: 4 };
export function pickOwnerBearingDoc(docs) {
  const list = (Array.isArray(docs) ? docs : []).filter((d) => d && d.source_url);
  if (!list.length) return null;
  list.sort((a, b) => {
    const pa = DOC_READ_PRIORITY[String(a.document_type || '').toLowerCase()] || 9;
    const pb = DOC_READ_PRIORITY[String(b.document_type || '').toLowerCase()] || 9;
    return pa - pb;
  });
  return list[0];
}
