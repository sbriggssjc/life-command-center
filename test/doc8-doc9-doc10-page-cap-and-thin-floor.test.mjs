// DOC8 + DOC9 + DOC10 — the cheap OCR tier 502'd on long documents, the counter
// built to catch the escalation was blind to it, and the fragment that came back
// counted as a COVERED lease.
//
// Measured across every OCR row the CRE lane has produced (2026-09-01):
//   gpt-4o  19 rows, avg 1,579 chars, 12 under 500, minimum 31
//   DocAI    6 rows, avg  9,055 chars,  0 under 500, minimum 601
// Cause, read from the edge log: PAGE_LIMIT_EXCEEDED "15 got 19" — DocAI's
// synchronous page cap, not the documented Custom-Extractor footgun.
//
// These tests pin the properties that make the three fixes fixes:
//   DOC8  — imagelessMode is a TOP-LEVEL ProcessRequest field (verified against the
//           live v1 discovery document), the processor's refusal of it degrades
//           instead of breaking OCR, and above the cap the caller writes a NAMED,
//           DATED marker instead of falling silently through to gpt-4o
//   DOC9  — the ENGINE is counted unconditionally, PAGES only when known, and an
//           unknown page count is never reported as 0 (P180)
//   DOC10 — the thin floor is PAGE-AWARE, and a thin result carries needs_ocr=true
//           so it is invisible to both consumers instead of reading as covered
//
// Every assertion below was mutation-verified RED. Source-shape assertions STRIP
// COMMENTS first — this file's subject matter names `imagelessMode`, `ocr_by_engine`
// and `thin_ocr_result` repeatedly in the fixes' own prose, so a raw grep would pass
// over the very regression it exists to catch (the A5c / N18 / B1 lesson).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const {
  ocrThinFloor,
  isThinOcrResult,
  buildDocTextRow,
  CRE_OCR_PAGE_CAP,
  CRE_RETRY_REASONS,
  CRE_CEILING_REASONS,
} = await import('../api/_shared/cre-property-doc-text.js');

const { extractDocumentText } = await import('../api/_shared/document-text.js');

const EDGE_SRC = readFileSync(new URL('../supabase/functions/docai-ocr/index.ts', import.meta.url), 'utf8');
const WORKER_SRC = readFileSync(new URL('../api/_shared/cre-property-doc-text.js', import.meta.url), 'utf8');
const HANDLER_SRC = readFileSync(new URL('../api/_handlers/cre-doc-text.js', import.meta.url), 'utf8');
const DOCTEXT_SRC = readFileSync(new URL('../api/_shared/document-text.js', import.meta.url), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A PDF buffer header is all extractDocumentText sniffs for the PDF branch.
const PDF = Buffer.from('%PDF-1.7 fake');

// ---------------------------------------------------------------------------
// DOC8 — the edge function
// ---------------------------------------------------------------------------

describe('DOC8 — the docai-ocr request asks for imageless mode', () => {
  const src = stripComments(EDGE_SRC);

  it('sets imagelessMode at the TOP LEVEL of ProcessRequest, not under processOptions', () => {
    // Verified against documentai.googleapis.com/$discovery/rest?version=v1 on
    // 2026-09-01: GoogleCloudDocumentaiV1ProcessRequest.imagelessMode is a boolean.
    // ProcessOptions carries ocrConfig/layoutConfig/... and NO imageless field, so
    // nesting it there is silently ignored and the cap stays at 15.
    assert.ok(/imagelessMode:\s*true/.test(src), 'expected imagelessMode: true in the request body');
    assert.ok(!/processOptions[\s\S]{0,200}imagelessMode/.test(src),
      'imagelessMode is NOT a ProcessOptions/OcrConfig field — nesting it is a silent no-op');
    // It must sit beside rawDocument/skipHumanReview, i.e. in the same object literal.
    assert.ok(/rawDocument:[\s\S]{0,200}imagelessMode/.test(src),
      'expected imagelessMode alongside rawDocument in the ProcessRequest body');
  });

  it('degrades instead of breaking OCR when the processor rejects the field', () => {
    assert.ok(/rejectsImagelessMode/.test(src), 'expected a narrow unknown-field detector');
    assert.ok(/callDocai\([^)]*false\)/.test(src), 'expected a single retry with imageless off');
  });

  it('surfaces which mode served the document, so a silent fallback is observable', () => {
    // ⚠️ Anchored on the SUCCESS response. `imageless: imagelessUsed` legitimately
    // appears in the error response too, so a file-wide grep is not a guard — it
    // stays green with the success echo deleted (the B6c-dup lesson).
    // The GET health probe also opens `json({ ok: true, engine: "google_docai"`, so
    // anchor on the POST success payload by a field only it carries.
    const okResp = /return json\(\{[^;]*?page_texts: pageTexts,[\s\S]*?\}\);/.exec(src)?.[0] || '';
    assert.ok(okResp, 'expected the POST ok:true response literal');
    assert.ok(/imageless:\s*imagelessUsed/.test(okResp),
      'a success response that cannot say whether imageless applied cannot verify the fix');
    const errResp = /return json\(\{\s*ok: false, reason, status: dResp\.status,[\s\S]*?\}, 502\);/.exec(src)?.[0] || '';
    assert.ok(/imageless:\s*imagelessUsed/.test(errResp), 'the failure path must name the mode too');
  });

  it('does not keep a page-cap constant that nothing reads', () => {
    // DOCAI_MAX_PAGES was declared and never once referenced — a constant wearing a
    // guard's clothes. The caller does the pre-flight; this function reports the cap.
    assert.ok(!/DOCAI_MAX_PAGES/.test(src), 'DOCAI_MAX_PAGES was dead code and must not return');
    assert.ok(/page_cap:/.test(src), 'the GET health probe must report the cap in force');
  });
});

// ⚠️ The edge module reads Deno.env and calls Deno.serve at module scope. Stubbing
// them is what makes these three tests RUN rather than silently skip — a guard that
// cannot load its subject reports green over anything.
globalThis.Deno = { env: { get: () => '' }, serve: () => {} };
const EDGE = await import('../supabase/functions/docai-ocr/index.ts');

describe('DOC8 — the page count Google names in its own error is carried, not discarded', () => {
  it('parses "exceed the limit: 15 got 19"', () => {
    assert.deepEqual(EDGE.pageLimitFromError('Document pages in non-imageless mode exceed the limit: 15 got 19.'),
      { limit: 15, got: 19 });
  });

  it('takes the limit from the PAIR, not the first number that looks like one', () => {
    // A loose `limit:?\s*(\d+)` fallback grabs the quota figure. The paired form
    // is what makes the parse mean the page cap.
    assert.deepEqual(
      EDGE.pageLimitFromError('Quota limit: 300 requests/min. Document pages in non-imageless mode exceed the limit: 15 got 19.'),
      { limit: 15, got: 19 });
  });

  it('returns NULL, never 0, when the count is absent (P180)', () => {
    assert.deepEqual(EDGE.pageLimitFromError('some other failure'), { limit: null, got: null });
  });

  it('does not treat a PAGE_LIMIT_EXCEEDED body as an unknown-field rejection', () => {
    assert.equal(EDGE.rejectsImagelessMode('PAGE_LIMIT_EXCEEDED: non-imageless mode exceed the limit: 15 got 19'), false,
      'retrying an over-cap document without imageless mode re-bills a call that cannot succeed');
    assert.equal(EDGE.rejectsImagelessMode('Invalid JSON payload received. Unknown name "imagelessMode": Cannot find field.'), true);
    // ⚠️ The detector must NAME the field. An INVALID_ARGUMENT about anything else
    // would otherwise trigger a second, identically-doomed, billed call.
    assert.equal(EDGE.rejectsImagelessMode('INVALID_ARGUMENT: rawDocument.content is malformed'), false);
  });

  it('reports the raised cap, and the caller\'s cap agrees with it', () => {
    assert.equal(EDGE.DOCAI_SYNC_PAGE_CAP, 15);
    assert.equal(EDGE.DOCAI_SYNC_PAGE_CAP_IMAGELESS, 30);
    assert.equal(CRE_OCR_PAGE_CAP, EDGE.DOCAI_SYNC_PAGE_CAP_IMAGELESS,
      'a pre-flight that disagrees with the service it guards is worse than none');
  });
});

// ---------------------------------------------------------------------------
// DOC8 — the caller-side pre-flight
// ---------------------------------------------------------------------------

describe('DOC8 — above the cap, no OCR is attempted and the marker is NAMED', () => {
  const deps = (pages, ocrSpy) => ({
    fetchDocBytes: async () => ({ ok: true, buffer: PDF, contentType: 'application/pdf' }),
    pdfTextFromBuffer: async () => '',
    pdfPageCount: async () => pages,
    ocrPdfToTextTiered: ocrSpy,
  });

  it('refuses OCR on a 31-page document and says so', async () => {
    let called = 0;
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrTiered: true, ocrPageCap: 30 },
      deps(31, async () => { called++; return { ok: true, text: 'x'.repeat(9000), tier: 'cloud' }; }),
    );
    assert.equal(called, 0, 'gpt-4o must not be paid for a document DocAI cannot serve');
    assert.equal(r.needs_ocr, true);
    assert.equal(r.reason, 'over_docai_page_cap');
    assert.equal(r.page_count, 31, 'the page count IS the finding on this row');
    assert.equal(r.ocr_attempted, false);
  });

  it('runs OCR normally AT the cap — 30 is servable in imageless mode', async () => {
    let called = 0;
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrTiered: true, ocrPageCap: 30 },
      deps(30, async () => { called++; return { ok: true, text: 'y'.repeat(40000), tier: 'cloud_cheap', pages: 30 }; }),
    );
    assert.equal(called, 1);
    assert.equal(r.method, 'ocr');
  });

  it('is OFF by default — the deed lane (cron 160) passes no cap and is unchanged', async () => {
    let called = 0;
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/deed.pdf', ocrTiered: true },
      deps(400, async () => { called++; return { ok: true, text: 'z'.repeat(9000), tier: 'cloud_cheap', pages: 12 }; }),
    );
    assert.equal(called, 1, 'a default-on cap would silently change the deed drain');
    assert.equal(r.method, 'ocr');
  });

  it('the CRE worker opts in, and its cap matches Google\'s imageless limit', () => {
    assert.equal(CRE_OCR_PAGE_CAP, 30);
    assert.ok(/ocrPageCap:\s*deps\.ocrPageCap\s*\?\?\s*CRE_OCR_PAGE_CAP/.test(stripComments(WORKER_SRC)),
      'the CRE worker must pass the cap through to extractDocumentText');
  });

  it('the over-cap marker is a CEILING reason with a longer expiry, not a transient', () => {
    assert.deepEqual([...CRE_CEILING_REASONS], ['over_docai_page_cap']);
    assert.ok(!CRE_RETRY_REASONS.includes('over_docai_page_cap'),
      'a 24 h retry on a known-unservable document parks the batch on it forever');
  });
});

// ---------------------------------------------------------------------------
// DOC10 — the page-aware thin floor
// ---------------------------------------------------------------------------

describe('DOC10 — the floor is page-aware, not a flat char count', () => {
  it('scales with pages: a 19-page lease needs far more than a 1-page notice', () => {
    assert.equal(ocrThinFloor(1), 200);
    assert.equal(ocrThinFloor(19), 3800);
    assert.ok(ocrThinFloor(19) > ocrThinFloor(1), 'a flat floor cannot tell those apart');
  });

  it('accepts every one of the six DocAI results measured live', () => {
    // (pages, chars) from lcc_cre_property_document_text, 2026-09-01.
    for (const [pages, chars] of [[1, 601], [1, 2094], [5, 7572], [10, 11723], [5, 12461], [6, 19876]]) {
      assert.equal(isThinOcrResult({ meaningfulChars: chars, pages }), false,
        `DocAI ${pages}p/${chars}c is a real extraction`);
    }
  });

  it('an UNKNOWN page count is not treated as one page', () => {
    // Unknown on this lane means DocAI never answered, i.e. we are on the tier
    // measured to return fragments. 116 chars passed the old flat 120 floor.
    assert.equal(ocrThinFloor(null), 500);
    assert.equal(isThinOcrResult({ meaningfulChars: 116, pages: null }), true);
    assert.equal(isThinOcrResult({ meaningfulChars: 116, pages: 1 }), true);
  });

  it('separates the 12 live fragments from the 7 real gpt-4o extractions', () => {
    const thin = [31, 44, 44, 48, 49, 68, 116, 163, 186, 187, 188, 200];
    const real = [783, 2251, 2670, 3521, 4062, 7014, 8375];
    for (const c of thin) assert.equal(isThinOcrResult({ meaningfulChars: c, pages: null }), true, `${c} is a fragment`);
    for (const c of real) assert.equal(isThinOcrResult({ meaningfulChars: c, pages: null }), false, `${c} is real text`);
  });
});

describe('DOC10 — a thin result is INVISIBLE to both consumers', () => {
  const build = (text, pages) => buildDocTextRow(
    { id: 11, cre_property_id: 7, document_type: 'lease', source_url: '/sites/x/lease.pdf' },
    {
      extractDocumentText: async () => ({
        ok: true, text, method: 'ocr', text_len: text.length,
        ocr_tier: 'cloud', ocr_engine: 'gpt-4o-2024-08-06', ocr_pages: pages, page_count: pages,
      }),
    },
  );

  it('sets needs_ocr=true on a 116-char "lease" — the exact live row', async () => {
    const built = await build('x'.repeat(116), null);
    // gatherPropertyText admits on needs_ocr=is.false AND raw_text=not.is.null;
    // v_lcc_cre_bov_ready counts covered on NOT needs_ocr. needs_ocr=true fails both.
    assert.equal(built.row.needs_ocr, true, 'a 116-char fragment must not read as a covered lease');
    assert.equal(built.row.reason, 'thin_ocr_result');
    assert.equal(built.outcome, 'thin_ocr', 'a thin result must not report as an extraction');
  });

  it('KEEPS the fragment text — the marker hides the row, it does not destroy evidence', async () => {
    const built = await build('x'.repeat(116), null);
    assert.equal(built.row.raw_text.length, 116);
    assert.equal(built.row.char_len, 116, 'char_len must stay honest');
  });

  it('leaves a real extraction covered and reporting as an extraction', async () => {
    const built = await build('y'.repeat(14687), 6);
    assert.equal(built.row.needs_ocr, false);
    assert.equal(built.outcome, 'ocr');
    assert.equal(built.row.page_count, 6);
  });

  it('re-admits the thin marker so DOC8 can retry it', () => {
    assert.ok(CRE_RETRY_REASONS.includes('thin_ocr_result'),
      'a floor that parks a document forever is worse than the fragment it rejected');
  });

  it('names the over-cap outcome separately from a plain needs_ocr', async () => {
    const built = await buildDocTextRow(
      { id: 12, cre_property_id: 7, document_type: 'lease', source_url: '/sites/x/big.pdf' },
      { extractDocumentText: async () => ({ ok: true, text: '', needs_ocr: true, reason: 'over_docai_page_cap', page_count: 44 }) },
    );
    assert.equal(built.outcome, 'over_page_cap');
    assert.equal(built.row.page_count, 44);
  });
});

// ---------------------------------------------------------------------------
// DOC10 — the SQL copy of the floor must not drift from the JS one
// ---------------------------------------------------------------------------

describe('the repair migration\'s floor is pinned to the JS floor', () => {
  const raw = readFileSync(
    new URL('../supabase/migrations/20260901120000_lcc_doc10_thin_ocr_marker_backfill.sql', import.meta.url), 'utf8');
  // ⚠️ Strip `--` comments FIRST. The migration header quotes the floor and prints
  // the reversal UPDATE verbatim, so a raw-source slice starts at the PROSE copy of
  // the statement and runs past the real one (A5c / N18 / B1).
  const sql = raw.replace(/^\s*--.*$/gm, '');
  const body = /CREATE OR REPLACE FUNCTION public\.lcc_doc10_thin_ocr_floor[\s\S]*?\$\$;/.exec(sql)?.[0] || '';

  it('computes the same floor as the module for every page count', () => {
    assert.ok(body, 'expected the lcc_doc10_thin_ocr_floor body');
    const absolute = Number(/greatest\((\d+),/.exec(body)?.[1]);
    const perPage = Number(/p_pages \* (\d+)/.exec(body)?.[1]);
    const unknown = Number(/ELSE (\d+)/.exec(body)?.[1]);
    assert.ok([absolute, perPage, unknown].every(Number.isFinite), 'could not read all three constants');
    // Behavioural equivalence, not three literal greps: the JS module is the single
    // owner for WRITES and this SQL copy only backs the one-shot repair and the
    // standing drift view. If they disagree the view stops describing the population
    // the producer creates — silently, because both sides look plausible.
    const sqlFloor = (pages) => (pages != null && pages > 0 ? Math.max(absolute, pages * perPage) : unknown);
    for (const pages of [null, 1, 2, 5, 6, 10, 15, 19, 30, 40, 0]) {
      assert.equal(sqlFloor(pages), ocrThinFloor(pages), `floor drifted at pages=${pages}`);
    }
  });

  it('the repair keeps the fragment text and only flips needs_ocr / reason', () => {
    const upd = /UPDATE public\.lcc_cre_property_document_text[\s\S]*?WHERE t\.id = p\.sidecar_id;/.exec(sql)?.[0] || '';
    assert.ok(upd, 'expected the repair UPDATE');
    assert.ok(/needs_ocr = true/.test(upd) && /reason\s*=\s*'thin_ocr_result'/.test(upd));
    assert.ok(!/raw_text/.test(upd),
      'nulling the fragment destroys the only record of what the expensive tier returned');
  });
});

// ---------------------------------------------------------------------------
// DOC9 — the spend counter
// ---------------------------------------------------------------------------

describe('DOC9 — the engine is counted unconditionally, pages only when known', () => {
  const src = stripComments(HANDLER_SRC);

  it('does not gate the engine tally behind a page count', () => {
    // The defect: `if (Number.isFinite(r.ocr_pages) && r.ocr_pages > 0)` wrapped BOTH
    // the page sum and the engine tally, and gpt-4o returns no page count — so the
    // spend guard read empty exactly when the expensive tier was serving.
    const bump = /const bump[\s\S]*?\n  \};/.exec(src)?.[0] || '';
    assert.ok(bump, 'expected a bump() in the tick handler');
    const gate = /if\s*\(r\.ocr_tier\s*\|\|\s*r\.ocr_engine\)/.test(bump);
    assert.ok(gate, 'the engine tally must key on a tier/engine being present, not on pages');
    const engineIdx = bump.indexOf('ocr_docs_by_engine');
    const pagesIdx = bump.indexOf('Number.isFinite(r.ocr_pages)');
    assert.ok(engineIdx > -1 && pagesIdx > -1 && engineIdx < pagesIdx,
      'the engine must be counted BEFORE (and outside) the page-count test');
  });

  it('reports an unknown page count as unknown, never as 0 (P180)', () => {
    // ⚠️ Anchored on the ELSE ARM, not on the identifier — the name also appears in
    // the result initializer, so a presence grep stays green with the increment
    // deleted and the counter silently reads 0 forever.
    const bump = /const bump[\s\S]*?\n  \};/.exec(src)?.[0] || '';
    assert.ok(/\}\s*else\s*\{[^}]*result\.ocr_pages_unknown\+\+;/.test(bump),
      'an OCR served with no page count must be COUNTED as unpriced, not silently dropped');
  });

  it('removes the ambiguous ocr_by_engine key rather than redefining its unit', () => {
    assert.ok(!/\bocr_by_engine\b/.test(src),
      'ocr_by_engine counted PAGES; reusing the name for a DOC count changes its meaning silently');
    assert.ok(/ocr_docs_by_engine/.test(src) && /ocr_pages_by_engine/.test(src),
      'documents and pages are different units and need different keys');
  });

  it('logs whenever OCR was served, not only when it was priced', () => {
    assert.ok(/if\s*\(result\.ocr_docs\s*>\s*0\)/.test(src),
      'gating the cost log on priced pages hides the unpriced gpt-4o document');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: the page count must survive the tier fall-through
// ---------------------------------------------------------------------------

describe('the cheap tier\'s refusal carries the only page count anyone gets', () => {
  const src = stripComments(DOCTEXT_SRC);

  it('ocrCloudCheap passes `pages` through on a structured failure', () => {
    const fn = /export async function ocrCloudCheap[\s\S]*?\n}/.exec(src)?.[0] || '';
    assert.ok(/data\.ok === false/.test(fn), 'expected the structured-failure branch');
    assert.ok(/pages:\s*Number\.isFinite\(data\.pages\)/.test(fn),
      'discarding the page count leaves the marker with a NULL that reads as "we never looked"');
  });

  it('the tiered chain carries it out even when gpt-4o serves', () => {
    assert.ok(/cheap_pages/.test(src), 'gpt-4o reports no pages; the cheap tier counted them before refusing');
  });
});
