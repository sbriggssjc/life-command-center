// ============================================================================
// OCR2 — guards for the deed lane's OCR provenance
//
// TWO INVARIANTS, each of which was live-broken before this change:
//   1. the success path PATCH must persist a `document_text` provenance block
//      (it computed method/ocr_tier/ocr_engine/ocr_pages and threw them away);
//   2. `ocrTiered:false` must not be reachable — the gpt-4o-direct branch is gone.
// Plus the hazard that made (1) non-trivial: the deed parser used to REPLACE
// `extracted_data` wholesale, so a provenance key written beside it was destroyed.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE ANY SOURCE MATCH. The fixes' own comments quote
// every removed expression at length — `ocrPdfToText`, `ocrTiered = false`, the
// wholesale `extracted_data: {` object — so a raw-source detector would find them
// all present and pass straight over a regression (the A5c / N18 / B1 lesson).
// ⚠️ And comments are stripped, never string literals blanked: every pattern here
// is an identifier or a property name, not a quoted string, so blanking literals
// would buy nothing and risks the OCR1c apostrophe hazard.
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTextProvenance,
  mergeExtractedData,
  writeTextProvenance,
  mergeRpcName,
  DOC_TEXT_PROVENANCE_KEY,
} from '../api/_shared/document-text-provenance.js';

import { processOneDoc } from '../api/_handlers/document-text.js';
import { processDeedDocument } from '../api/_handlers/deed-parser.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// A deed that parses to real parties, so processDeedDocument reaches its
// extracted_data write instead of returning early.
const DEED_TEXT = [
  'GRANT DEED',
  'County of Los Angeles',
  'DOCUMENTARY TRANSFER TAX is $1,100.00 computed on the full value of the property.',
  'DOC # 2024-0042560  recorded on 03/15/2024',
  'For valuable consideration acknowledged, SELLER TRUST hereby GRANTS to BUYER HOLDINGS LLC, the following described property:',
  'APN: 123-456-789',
].join('\n');

/** Strip // line comments and block comments. Not literal-aware, by design (above). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const HANDLER = stripComments(read('../api/_handlers/document-text.js'));
const PARSER = stripComments(read('../api/_handlers/deed-parser.js'));
const SHARED = stripComments(read('../api/_shared/document-text.js'));

describe('OCR2 — the deed drain persists what it computes', () => {
  // The whole defect: these four were built on every result and never written.
  it('the provenance block carries method, tier, engine and pages', () => {
    const p = buildTextProvenance({
      ok: true, method: 'ocr', text_len: 4200,
      ocr_tier: 'cloud_cheap', ocr_engine: 'google_docai',
      ocr_pages: 12, ocr_confidence: 96, page_count: 12, ocr_attempted: true,
    });
    assert.equal(p.method, 'ocr');
    assert.equal(p.ocr_tier, 'cloud_cheap');
    assert.equal(p.ocr_engine, 'google_docai');
    assert.equal(p.ocr_pages, 12);
    assert.equal(p.ocr_confidence, 96);
    assert.equal(p.text_len, 4200);
    assert.ok(p.extracted_at, 'an undated provenance row cannot be audited');
    assert.equal(p.extractor, 'document-text-tick');
  });

  // P180: null means "no OCR was performed", which is a different fact from
  // "OCR ran on an unknown engine". Inventing a value here would move a FREE
  // digital extraction into a paid bucket on the audit view.
  it('a digital extraction carries NO tier and NO engine — never a fabricated one', () => {
    const p = buildTextProvenance({ ok: true, method: 'pdf_text', text_len: 9000 });
    assert.equal(p.method, 'pdf_text');
    assert.equal(p.ocr_tier, null);
    assert.equal(p.ocr_engine, null);
    assert.equal(p.ocr_pages, null);
    assert.equal(p.ocr_confidence, null);
  });

  // DOC18: ocr_pages is what we were BILLED for; page_count is the document length.
  it('a windowed extract keeps ocr_pages and page_count as DIFFERENT numbers', () => {
    const p = buildTextProvenance({
      ok: true, method: 'ocr', ocr_tier: 'cloud_cheap_window', ocr_engine: 'google_docai',
      ocr_pages: 50, page_count: 141, partial_extract: true, pages_covered: 50,
      page_ranges: [[1, 50]], text_len: 100000,
    });
    assert.equal(p.ocr_pages, 50, 'billed pages');
    assert.equal(p.page_count, 141, 'document length');
    assert.equal(p.partial_extract, true);
    assert.deepEqual(p.page_ranges, [[1, 50]]);
  });

  it('a non-windowed extract omits partial_extract entirely (absent != false)', () => {
    const p = buildTextProvenance({ ok: true, method: 'ocr', ocr_tier: 'cloud_cheap' });
    assert.equal('partial_extract' in p, false,
      'never windowed and windowed-covering-everything must stay distinguishable');
  });

  // ⚠️ BEHAVIOURAL, NOT A GREP. The first cut of this asserted that the handler
  // source MENTIONS writeTextProvenance / provenance_written — and the mutation that
  // deleted the actual call (`const prov = await writeProvenance()` -> `{ ok: true }`)
  // SURVIVED it, because the import line still carried the identifier. Found by the
  // mutation pass, not by reading the guard. Run the function instead.
  it('processOneDoc WRITES provenance on the plain-text exit', async () => {
    let wrote = null;
    const r = await processOneDoc('government', {
      document_id: 77, property_id: 1, document_type: 'lease', storage_path: 's/x.pdf',
    }, {
      domainQuery: async () => ({ ok: true, data: [] }),
      storageGet: async () => ({ ok: true }),
      extractDocumentText: async () => ({
        ok: true, text: 'x'.repeat(900), text_len: 900, method: 'ocr',
        ocr_tier: 'cloud_cheap', ocr_engine: 'google_docai', ocr_pages: 3,
      }),
      writeTextProvenance: async (_d, id, ext) => { wrote = { id, ext }; return { ok: true }; },
    });
    assert.equal(r.outcome, 'text_extracted');
    assert.ok(wrote, 'the provenance writer must actually be called');
    assert.equal(wrote.id, 77);
    assert.equal(wrote.ext.ocr_tier, 'cloud_cheap');
    assert.equal(r.provenance_written, true);
  });

  it('processOneDoc WRITES provenance on the deed exit, AFTER the deed parse', async () => {
    const order = [];
    let wrote = null;
    const r = await processOneDoc('government', {
      document_id: 88, property_id: 2, document_type: 'deed', storage_path: 's/d.pdf',
    }, {
      domainQuery: async () => ({ ok: true, data: [] }),
      storageGet: async () => ({ ok: true }),
      extractDocumentText: async () => ({
        ok: true, text: 'y'.repeat(900), text_len: 900, method: 'ocr',
        ocr_tier: 'cloud', ocr_engine: 'gpt-4o', ocr_pages: null,
      }),
      processDeedDocument: async () => { order.push('deed'); return { parsed: {} }; },
      writeTextProvenance: async (_d, id, ext) => {
        order.push('provenance'); wrote = { id, ext }; return { ok: true };
      },
    });
    assert.equal(r.outcome, 'deed_parsed');
    assert.ok(wrote, 'the deed exit must write provenance too');
    assert.equal(wrote.id, 88);
    // Ordering is the whole safety argument: the parser writes extracted_data, so
    // provenance written BEFORE it would be destroyed by any non-merging writer.
    assert.deepEqual(order, ['deed', 'provenance'],
      'provenance must be written AFTER the deed parse, never before');
    assert.equal(r.provenance_written, true);
  });

  it('a FAILED provenance write is reported, never silently swallowed', async () => {
    const r = await processOneDoc('government', {
      document_id: 99, property_id: 3, document_type: 'lease', storage_path: 's/z.pdf',
    }, {
      domainQuery: async () => ({ ok: true, data: [] }),
      storageGet: async () => ({ ok: true }),
      extractDocumentText: async () => ({ ok: true, text: 'z'.repeat(900), text_len: 900, method: 'pdf_text' }),
      writeTextProvenance: async () => ({ ok: false, reason: 'rpc_non_ok:404' }),
    });
    assert.equal(r.provenance_written, false);
    assert.equal(r.provenance_reason, 'rpc_non_ok:404',
      'a 404 means the migration is not applied — a deploy fact that must surface');
  });
});

describe('OCR2 — extracted_data has ONE merge owner', () => {
  // The hazard: a wholesale replace destroys every sibling key. Proven live —
  // gov's 185 rows carry exactly the two keys that write puts there and nothing else.
  // ⚠️ BEHAVIOURAL. The grep form of this ('the source mentions mergeExtractedData')
  // SURVIVED the mutation that removed the call, because the import kept the name.
  it('the deed parser routes its extracted_data write through the merge owner', async () => {
    let merged = null;
    const patched = [];
    await processDeedDocument('dialysis', 55, 900, DEED_TEXT, { state: 'CA' }, {
      domainQuery: async (_d, m, path, body) => {
        if (m === 'PATCH') patched.push({ path, body });
        return { ok: true, data: [] };
      },
      mergeExtractedData: async (_d, id, patch, opts) => {
        merged = { id, patch, opts }; return { ok: true, keys_written: Object.keys(patch) };
      },
    });
    assert.ok(merged, 'the parser must call the merge owner');
    assert.equal(merged.id, 900);
    assert.ok('deed_extraction' in merged.patch, 'the extraction must ride the merge');
    assert.equal(merged.opts.ingestionStatus, 'deed_parsed');
    assert.equal(merged.opts.fillBlanks, false,
      'a re-parse is EXPECTED to rewrite its own extraction — only sibling keys are protected');
    // The whole point: no wholesale replace of extracted_data when the merge worked.
    const wholesale = patched.filter((c) => c.body && 'extracted_data' in c.body);
    assert.equal(wholesale.length, 0,
      'a successful merge must NOT be followed by a column-replacing PATCH');
  });

  it('the parser falls back to the legacy write when the merge RPC fails — never loses the extraction', async () => {
    const patched = [];
    await processDeedDocument('dialysis', 55, 901, DEED_TEXT, { state: 'CA' }, {
      domainQuery: async (_d, m, path, body) => {
        if (m === 'PATCH') patched.push({ path, body });
        return { ok: true, data: [] };
      },
      mergeExtractedData: async () => ({ ok: false, reason: 'rpc_non_ok:404' }),
    });
    const wholesale = patched.filter((c) => c.body && 'extracted_data' in c.body);
    assert.equal(wholesale.length, 1,
      'a failed merge must fall back, or a half-applied deploy strands the doc in the re-parse queue forever');
    assert.ok('deed_extraction' in wholesale[0].body.extracted_data);
  });

  it('per-key fill-blanks: a patch key already present is skipped, a new one is written', async () => {
    const calls = [];
    const domainQuery = async (_d, _m, path, body) => {
      calls.push({ path, body });
      return { ok: true, data: { ok: true, keys_written: ['document_text'], keys_skipped: [] } };
    };
    const r = await mergeExtractedData('government', 12965,
      { [DOC_TEXT_PROVENANCE_KEY]: { method: 'ocr' } },
      { fillBlanks: true }, { domainQuery });
    assert.equal(r.ok, true);
    assert.equal(calls[0].path, 'rpc/gov_merge_document_extracted_data');
    assert.equal(calls[0].body.p_fill_blanks, true,
      'fill-blanks must reach the RPC, or an existing provenance row gets overwritten');
    assert.equal(calls[0].body.p_document_id, 12965);
  });

  it('writeTextProvenance defaults to fill-blanks — a re-parse must not rewrite the record', async () => {
    let sent = null;
    const domainQuery = async (_d, _m, _p, body) => {
      sent = body;
      return { ok: true, data: { ok: true, keys_written: [], keys_skipped: ['document_text'] } };
    };
    await writeTextProvenance('dia', 3964, { ok: true, method: 'ocr' }, {}, { domainQuery });
    assert.equal(sent.p_fill_blanks, true);
  });

  it('each domain routes to its OWN rpc, and an unknown domain is refused by name', async () => {
    assert.equal(mergeRpcName('government'), 'gov_merge_document_extracted_data');
    assert.equal(mergeRpcName('gov'), 'gov_merge_document_extracted_data');
    assert.equal(mergeRpcName('dialysis'), 'dia_merge_document_extracted_data');
    assert.equal(mergeRpcName('dia'), 'dia_merge_document_extracted_data');
    assert.equal(mergeRpcName('cre'), null, 'never guess an rpc name — a bad POST 404s');
    const r = await mergeExtractedData('cre', 1, { a: 1 }, {}, { domainQuery: async () => ({ ok: true }) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown_domain');
  });

  // A 404 here means the migration is not applied on this domain — a DEPLOY fact.
  // It must never read as "there was nothing to write" (the silent-success shape).
  it('an RPC failure is reported with a NAMED reason, never swallowed', async () => {
    const r = await mergeExtractedData('gov', 1, { a: 1 }, {},
      { domainQuery: async () => ({ ok: false, status: 404, data: 'missing' }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /rpc_non_ok:404/);
  });

  it('the provenance write can never throw into the drain', async () => {
    const r = await mergeExtractedData('gov', 1, { a: 1 }, {},
      { domainQuery: async () => { throw new Error('boom'); } });
    assert.equal(r.ok, false);
    assert.match(r.reason, /rpc_threw/);
  });
});

describe('OCR2 — the gpt-4o-direct route is closed', () => {
  it('extractDocumentText defaults ocrTiered to true', () => {
    assert.match(SHARED, /ocrTiered\s*=\s*true/,
      'omitting the flag must NOT reach the 6-14x tier');
    assert.doesNotMatch(SHARED, /ocrTiered\s*=\s*false/,
      'the default must not be the expensive path');
  });

  it('extractDocumentText has no gpt-4o-direct call — ocrPdfToText survives only as tier 3', () => {
    // The tiered chain legitimately calls it as its last resort; that one site is
    // inside ocrPdfToTextTiered and is gated on an explicit opt-in.
    const sites = (SHARED.match(/deps\.ocrPdfToText\s*\|\|\s*ocrPdfToText/g) || []).length;
    assert.equal(sites, 1,
      `exactly one gpt-4o call site may exist (tier 3 inside the tiered chain); found ${sites}`);
    const tieredStart = SHARED.indexOf('export async function ocrPdfToTextTiered');
    const extractStart = SHARED.indexOf('export async function extractDocumentText');
    const siteIdx = SHARED.indexOf('deps.ocrPdfToText || ocrPdfToText');
    assert.ok(tieredStart >= 0 && extractStart >= 0 && siteIdx >= 0);
    assert.ok(siteIdx > tieredStart && siteIdx < extractStart,
      'the surviving call site must be inside ocrPdfToTextTiered, not extractDocumentText');
  });

  it('an explicit ocrTiered:false is refused by name rather than silently honoured', () => {
    assert.match(SHARED, /ocr_tiering_cannot_be_disabled/,
      'a silent bypass of a cost control is indistinguishable from no control');
  });

  // Positive control: the detectors above must be able to fail. A stripped source
  // that no longer contains the anchors would make every assertion vacuous.
  it('positive control — the source anchors this file greps for actually exist', () => {
    assert.ok(SHARED.includes('ocrPdfToTextTiered'), 'tiered chain present');
    assert.ok(HANDLER.includes('processOneDoc'), 'handler entry present');
    assert.ok(PARSER.includes('deed_extraction'), 'parser write present');
    assert.ok(stripComments('// x\ncode').includes('code'));
    assert.equal(stripComments('// ocrPdfToText').trim(), '',
      'the comment stripper must actually remove a commented mention');
  });
});
