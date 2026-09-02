// DOC18 — the three-call sync window. DOC17 measured, on a real 316-page PDF,
// that Document AI's synchronous page limit is measured against the SELECTION,
// not the document: `individualPageSelector {pages:[31..45]}` returns pages
// 31–45, and `fromStart:15` on the same document returns 1–15. The engineering
// number is the refinement: **30 pages per call contiguously from page 1
// (imageless), 15 pages per call anywhere else.**
//
// These tests pin the properties that make this route a route rather than a
// hope, and every one of DOC17 §3's four traps has an assertion here:
//
//   TRAP 1  `metadata.page_limit` reports the MAXIMUM ACHIEVABLE limit, not the
//           one in force (a 30-page refusal whose applicable limit is 15 says
//           "30"). Nothing may size a call from it.
//   TRAP 2  `At most 15 pages in one call please.` carries NO details[] and
//           matches neither prose fallback — both halves of the parser were
//           blind to it, and the cap detector could not see it either.
//   TRAP 3  The base limit is 15 and the BASELINE arm reported 30. One error's
//           metadata is not a limits table.
//   TRAP 4  `docai-ocr` resolved one shared secret with `||`, so the first env
//           var set SHADOWED the others.
//
// Plus the two properties §4 says must not move: gpt-4o is unreachable from this
// path, and the ordinary under-cap drain is byte-identical.
//
// Source-shape assertions STRIP COMMENTS first — this file's subject matter
// names `page_limit`, `At most 15 pages`, `over_docai_page_cap` and
// `partial_page_window` repeatedly in the fixes' own prose, so a raw grep would
// pass over the very regression it exists to catch (the A5c / N18 / B1 lesson).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const {
  planPageWindow,
  pageNumbersToRanges,
  pageGaps,
  ocrCloudCheapWindow,
  extractDocumentText,
  DOCAI_FIRST_SEGMENT_PAGES,
  DOCAI_RANGE_SEGMENT_PAGES,
  OCR_WINDOW_TARGET_PAGES,
  OCR_CORPUS_CHARS_PER_PAGE,
} = await import('../api/_shared/document-text.js');

const { LEASE_TEXT_SLICE_CHARS } = await import('../api/_shared/bov-extract.js');

const {
  buildDocTextRow,
  fetchOverCapCreDocs,
  CRE_CEILING_REASONS,
  CRE_OCR_WINDOW_BUDGET_MS,
} = await import('../api/_shared/cre-property-doc-text.js');

const DOCTEXT_SRC = readFileSync(new URL('../api/_shared/document-text.js', import.meta.url), 'utf8');
const EDGE_SRC = readFileSync(new URL('../supabase/functions/docai-ocr/index.ts', import.meta.url), 'utf8');
const HANDLER_SRC = readFileSync(new URL('../api/_handlers/cre-doc-text.js', import.meta.url), 'utf8');
const WORKER_SRC = readFileSync(new URL('../api/_shared/cre-property-doc-text.js', import.meta.url), 'utf8');
const MIGRATION_SRC = readFileSync(
  new URL('../supabase/migrations/20260902120000_lcc_doc18_partial_page_window.sql', import.meta.url), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function stripSqlComments(src) {
  return src.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}
/** The exact source span of a named function — never a character window. */
function fnSpan(src, name) {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `expected a function named ${name}`);
  const open = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  assert.fail(`unbalanced braces in ${name}`);
}

const PDF = Buffer.from('%PDF-1.7 fake');
/** A cheap-tier stub that honours the selector and reports real page numbers. */
function stubCheap({ fail = null, ignoreSelector = false, chars = 1800 } = {}) {
  const calls = [];
  return {
    calls,
    async fn({ pageRange }) {
      calls.push(pageRange);
      const from = pageRange?.from_start ? 1 : pageRange.from;
      const to = pageRange?.from_start ? pageRange.from_start : pageRange.to;
      if (fail && fail(pageRange, calls.length)) {
        return { ok: false, reason: 'over_page_cap', status: 502, page_limit: 30, pages: null, imageless: true };
      }
      const lo = ignoreSelector ? 1 : from;
      const hi = ignoreSelector ? (to - from + 1) : to;
      const pageTexts = [];
      for (let p = lo; p <= hi; p++) pageTexts.push({ page: p, text: `PAGE ${p} `.padEnd(chars, 'x') });
      return {
        ok: true, text: pageTexts.map((p) => p.text).join('\n'), pageTexts,
        pages: pageTexts.length, confidence: 91, engine: 'google_docai',
        page_range_applied: pageRange, imageless: true,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The plan — DOC17's measured contract, and TRAP 3
// ---------------------------------------------------------------------------

describe('DOC18 — planPageWindow encodes the measured contract', () => {
  it('plans 141 pages at a 50-page target as exactly three calls: 1-30, 31-45, 46-50', () => {
    const plan = planPageWindow(141, { targetPages: 50 });
    assert.deepEqual(plan.map((s) => [s.from, s.to]), [[1, 30], [31, 45], [46, 50]]);
    assert.equal(plan[0].from_start, true, 'segment 1 must be the fromStart shape (the only one measured at 30)');
    assert.equal(plan[1].from_start, false);
  });

  it('TRAP 3 — the base limit is 15 and only the FIRST segment may be 30', () => {
    // Reading only DOC17's baseline arm (which reported page_limit 30 with
    // imageless OFF) concludes the base cap is 30 and produces a route that fails
    // on EVERY non-page-1 call. Row 4 is what showed the base is still 15.
    assert.equal(DOCAI_FIRST_SEGMENT_PAGES, 30);
    assert.equal(DOCAI_RANGE_SEGMENT_PAGES, 15);
    for (const total of [31, 50, 141, 316]) {
      const plan = planPageWindow(total, { targetPages: 50 });
      assert.ok(plan[0].pages <= 30, `first segment ${plan[0].pages} > 30`);
      for (const seg of plan.slice(1)) {
        assert.ok(seg.pages <= 15, `segment ${seg.from}-${seg.to} is ${seg.pages} pages; the base limit is 15`);
      }
    }
  });

  it('never plans past the document or past the target, and never overlaps', () => {
    const short = planPageWindow(35, { targetPages: 50 });
    assert.deepEqual(short.map((s) => [s.from, s.to]), [[1, 30], [31, 35]]);
    const long = planPageWindow(316, { targetPages: 50 });
    assert.equal(long[long.length - 1].to, 50, 'the window is the CONSUMER window, not the document');
    for (let i = 1; i < long.length; i++) {
      assert.equal(long[i].from, long[i - 1].to + 1, 'segments must be contiguous and non-overlapping');
    }
  });

  it('a zero/absent target plans nothing rather than defaulting to something', () => {
    assert.deepEqual(planPageWindow(141, { targetPages: 0 }), []);
  });
});

describe('DOC18 — the page target is DERIVED from the consumer, not chosen', () => {
  it('binds OCR_WINDOW_TARGET_PAGES to bov-extract`s own text slice', () => {
    // ⚠️ This is the guard §2 asks for: "make the page target a named constant,
    // not a literal 50 — it is derived from the consumer's slice and must move if
    // that slice moves." If LEASE_TEXT_SLICE_CHARS changes and the window does
    // not, this goes RED with the reason attached.
    assert.equal(LEASE_TEXT_SLICE_CHARS, 90_000);
    assert.equal(OCR_CORPUS_CHARS_PER_PAGE, 1800);
    assert.equal(
      OCR_WINDOW_TARGET_PAGES,
      Math.ceil(LEASE_TEXT_SLICE_CHARS / OCR_CORPUS_CHARS_PER_PAGE),
      'the OCR page window must equal the consumer slice divided by chars-per-page',
    );
  });
});

// ---------------------------------------------------------------------------
// The seam — assembled by PAGE NUMBER, so duplication is impossible and a gap
// is detected rather than inferred from a plausible total length
// ---------------------------------------------------------------------------

describe('DOC18 — the seam concatenates by page number', () => {
  it('three calls land 50 pages in order, with no duplication and no gap', async () => {
    const cheap = stubCheap();
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, mediaType: 'application/pdf', totalPages: 141, targetPages: 50 },
      { cloudCheapOcr: cheap.fn },
    );
    assert.equal(w.ok, true);
    assert.equal(w.calls, 3);
    assert.equal(w.pages_covered, 50);
    assert.deepEqual(w.page_ranges, [[1, 50]], 'the three ranges must join into one contiguous span');
    assert.deepEqual(w.page_gaps, []);
    assert.equal(w.duplicate_pages, 0);
    assert.deepEqual(w.pageTexts.map((p) => p.page), Array.from({ length: 50 }, (_, i) => i + 1));
    // The BOUNDARIES are the evidence: page 30/31 and page 45/46 must be adjacent
    // and distinct in the assembled text.
    const at = (n) => w.text.indexOf(`PAGE ${n} `);
    assert.ok(at(30) > 0 && at(31) > at(30), 'page 31 must follow page 30 in the assembled text');
    assert.ok(at(45) > 0 && at(46) > at(45), 'page 46 must follow page 45 in the assembled text');
    assert.equal(w.partial, true, '141 pages read to 50 is a PARTIAL');
  });

  it('a duplicated page from an overlapping segment cannot survive the assembly', async () => {
    const cheap = stubCheap();
    const dupCall = async (args) => {
      const r = await cheap.fn(args);
      if (!r.ok) return r;
      // A wrapper that returns page 31 twice INSIDE the requested range. (An
      // out-of-range repeat is caught earlier, by the selector-honoured check.)
      if (args.pageRange.from === 31) r.pageTexts.unshift({ page: 31, text: 'PAGE 31 DUPLICATE' });
      return r;
    };
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: dupCall },
    );
    assert.equal(w.duplicate_pages, 1);
    assert.equal(w.pages_covered, 50, 'a duplicate must not inflate the covered count');
    // The FIRST occurrence of a page number wins and the repeat is dropped whole.
    // WHICH copy survives is arbitrary (there is no basis to prefer either) and is
    // not the invariant; that the page appears EXACTLY ONCE is.
    assert.equal(w.pageTexts.filter((p) => p.page === 31).length, 1);
    assert.equal((w.text.match(/PAGE 31 /g) || []).length, 1,
      'the same page`s text must never be concatenated twice');
  });

  it('a missing middle segment is reported as a GAP, not smoothed over', async () => {
    const cheap = stubCheap();
    const holed = async (args) => {
      const r = await cheap.fn(args);
      if (r.ok && args.pageRange.from === 31) r.pageTexts = r.pageTexts.filter((p) => p.page !== 38);
      return r;
    };
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: holed },
    );
    assert.deepEqual(w.page_gaps, [[38, 38]]);
    assert.equal(w.pages_covered, 49);
  });

  it('a SILENTLY IGNORED selector is caught by the page NUMBERS, not the count', async () => {
    // An unknown body field is ignored silently, and an ignored selector returns
    // pages 1..N — which looks like a clean success and would make every segment
    // a duplicate of the first. The page numbers are the evidence (DOC17).
    const cheap = stubCheap({ ignoreSelector: true });
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: cheap.fn },
    );
    const ignored = w.segments.find((s) => s.reason === 'page_range_ignored');
    assert.ok(ignored, 'expected the second segment to be rejected as page_range_ignored');
    assert.ok(w.calls <= 2, 'a wrapper that ignores the selector cannot serve later segments either');
  });
});

// ---------------------------------------------------------------------------
// TRAP 1 — never size a call from `page_limit`
// ---------------------------------------------------------------------------

describe('DOC18 TRAP 1 — page_limit never sizes a call', () => {
  it('a segment refused with page_limit 30 is NOT retried at 30', async () => {
    const cheap = stubCheap({ fail: (pr) => pr.from === 31 });
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: cheap.fn },
    );
    // The stub reports page_limit 30 on every refusal. If anything sized a retry
    // from it, a 30-page selection would appear.
    for (const pr of cheap.calls) {
      const span = pr.from_start ? pr.from_start : pr.to - pr.from + 1;
      if (!pr.from_start) assert.ok(span <= 15, `a non-page-1 call asked for ${span} pages`);
    }
    assert.equal(cheap.calls.filter((pr) => pr.from === 31).length, 1, 'a refused range must not be re-sent');
    // The pages already paid for are KEPT, never discarded (that is what makes
    // the next attempt not double-charge).
    assert.equal(w.ok, true);
    assert.equal(w.pages_covered, 30);
    assert.equal(w.window_incomplete, true);
  });

  it('the window planner reads no page_limit at all', () => {
    const src = stripComments(fnSpan(DOCTEXT_SRC, 'ocrCloudCheapWindow'));
    assert.equal(/page_limit/.test(src), false,
      'page_limit is the MAXIMUM ACHIEVABLE limit, not the one in force — it must never reach the planner');
  });

  it('does NOT re-plan when imageless HELD, however loudly page_limit says 30', async () => {
    // The discriminating case. A first-segment refusal reporting `page_limit: 30`
    // WITH imageless applied means 30-from-page-1 is genuinely unavailable on this
    // processor right now — but `page_limit` is the maximum ACHIEVABLE limit, so a
    // caller keyed on it would re-plan and re-send forever. Only `imageless:false`
    // (a fact about what was SENT) licenses the re-plan.
    const calls = [];
    const fn = async ({ pageRange }) => {
      calls.push(pageRange);
      return { ok: false, reason: 'over_page_cap', status: 502, page_limit: 30, pages: 316, imageless: true };
    };
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: fn },
    );
    assert.equal(w.replanned, false, 'page_limit must never trigger a re-plan');
    assert.equal(calls.length, 1, 'a refused first segment must not be re-sent');
    assert.equal(w.ok, false);
    assert.equal(w.reason, 'over_page_cap');
  });

  it('the ONE re-plan keys on `imageless`, a fact about what was SENT', async () => {
    // If the processor rejected imagelessMode the wrapper falls back silently and
    // the real cap is 15 — the first segment must then be re-planned at 15.
    let n = 0;
    const cheap = stubCheap();
    const fn = async (args) => {
      n++;
      if (n === 1) return { ok: false, reason: 'over_page_cap', status: 502, page_limit: 30, imageless: false };
      return cheap.fn(args);
    };
    const w = await ocrCloudCheapWindow(
      { buffer: PDF, totalPages: 141, targetPages: 50 }, { cloudCheapOcr: fn },
    );
    assert.equal(w.replanned, true);
    assert.equal(w.ok, true);
    assert.equal(w.pages_covered, 50);
    for (const pr of cheap.calls) {
      const span = pr.from_start ? pr.from_start : pr.to - pr.from + 1;
      assert.ok(span <= 15, `after the imageless fallback every call must be <= 15 pages, got ${span}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TRAP 2 — the third error shape, and TRAP 4 — the shadowed secret
// ---------------------------------------------------------------------------

describe('DOC18 TRAP 2 — the third error shape is readable at last', async () => {
  const prevDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: () => '' }, serve: () => {} };
  const edge = await import('../supabase/functions/docai-ocr/index.ts');
  globalThis.Deno = prevDeno;

  it('recognises `At most 15 pages in one call please.` as a page-cap refusal', () => {
    // It carries NO details[] and matches neither `exceed the limit: N got M` nor
    // the bare `got N` fallback, so the old detector reported a generic docai_400.
    assert.equal(edge.isPageCapError('At most 15 pages in one call please.'), true);
    assert.equal(edge.isPageCapError('Document pages exceed the limit: 30 got 316'), true);
    assert.equal(edge.isPageCapError('{"error":{"details":[{"reason":"PAGE_LIMIT_EXCEEDED"}]}}'), true);
    assert.equal(edge.isPageCapError('quota exceeded for requests'), false, 'must not swallow an unrelated 400');
  });

  it('parses its limit and leaves `got` NULL — unknown is not zero', () => {
    assert.deepEqual(edge.pageLimitFromError('At most 15 pages in one call please.'), { limit: 15, got: null });
    // The two known shapes still parse exactly as before.
    assert.deepEqual(
      edge.pageLimitFromError('{"error":{"details":[{"metadata":{"page_limit":"30","pages":"40"}}]}}'),
      { limit: 30, got: 40 },
    );
    assert.deepEqual(
      edge.pageLimitFromError('Document pages in non-imageless mode exceed the limit: 15 got 30'),
      { limit: 15, got: 30 },
    );
  });

  it('actually PUTS the selector on the ProcessRequest, and echoes what it applied', () => {
    // `processOptionsFromPageRange` returning the right object buys nothing if the
    // request body never carries it — and an unknown body field is ignored
    // SILENTLY, so the failure would be a clean-looking success returning pages
    // 1..N on every call.
    const call = stripComments(fnSpan(EDGE_SRC, 'callDocai'));
    assert.ok(/\.\.\.\(processOptions \? \{ processOptions \} : \{\}\)/.test(call),
      'ProcessRequest must carry processOptions when a range was asked for');
    assert.ok(/rawDocument:[\s\S]*processOptions/.test(call),
      'processOptions belongs beside rawDocument on the ProcessRequest');
    const src = stripComments(EDGE_SRC);
    assert.equal((src.match(/page_range_applied: processOptions/g) || []).length, 2,
      'both the success and the failure response must echo the applied range, or an ignored selector is unobservable');
  });

  it('translates a page range into the two shapes DOC17 measured, and nothing else', () => {
    assert.deepEqual(edge.processOptionsFromPageRange({ from_start: 30 }), { fromStart: 30 });
    assert.deepEqual(edge.processOptionsFromPageRange({ from: 31, to: 33 }),
      { individualPageSelector: { pages: [31, 32, 33] } });
    assert.equal(edge.processOptionsFromPageRange(null), null, 'an absent range must leave the request unchanged');
    assert.equal(edge.processOptionsFromPageRange({ from: 5 }), null);
  });
});

describe('DOC18 TRAP 4 — every configured shared secret authenticates', () => {
  const src = stripComments(EDGE_SRC);
  it('does not resolve one secret by `||` shadowing', () => {
    assert.equal(/DOCAI_SHARED_SECRET"\)\s*\|\|/.test(src), false,
      'a `||` chain lets the FIRST env var set shadow the others — DOC17`s probe 401`d holding a valid key');
    assert.ok(/SHARED_SECRETS/.test(src), 'expected a SET of accepted secrets');
    assert.ok(/SHARED_SECRETS\.some\(/.test(src), 'authorized() must accept ANY configured secret');
  });
});

// ---------------------------------------------------------------------------
// §4 — what must NOT change
// ---------------------------------------------------------------------------

describe('DOC18 §4 — gpt-4o is unreachable and the ordinary drain is unchanged', () => {
  const baseDeps = {
    fetchDocBytes: async () => ({ ok: true, buffer: PDF, contentType: 'application/pdf', via: 'sharepoint' }),
    pdfTextFromBuffer: async () => '',
    pdfPageCount: async () => 141,
  };

  it('with NO window opted in, an over-cap document behaves exactly as DOC8 left it', async () => {
    let tieredCalled = 0;
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrPageCap: 30 },
      { ...baseDeps, ocrPdfToTextTiered: async () => { tieredCalled++; return { ok: false }; } },
    );
    assert.equal(r.needs_ocr, true);
    assert.equal(r.reason, 'over_docai_page_cap');
    assert.equal(r.ocr_attempted, false);
    assert.equal(r.page_count, 141);
    assert.equal(tieredCalled, 0, 'no OCR of any kind may be attempted on the marker path');
  });

  it('a FAILED window falls to a named marker and NEVER to gpt-4o', async () => {
    let tieredCalled = 0;
    let gptCalled = 0;
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrPageCap: 30, ocrPageWindow: true },
      {
        ...baseDeps,
        cloudCheapOcr: async () => ({ ok: false, reason: 'over_ocr_cap' }),
        ocrPdfToTextTiered: async () => { tieredCalled++; return { ok: false }; },
        ocrPdfToText: async () => { gptCalled++; return { ok: true, text: 'x'.repeat(2000) }; },
      },
    );
    assert.equal(r.needs_ocr, true);
    assert.equal(r.reason, 'window_failed', 'attempted-and-empty is a DIFFERENT fact from never-attempted');
    assert.equal(r.window_reason, 'over_ocr_cap', 'the reason the window produced nothing must be reported');
    assert.equal(tieredCalled + gptCalled, 0, 'gpt-4o is 9.3x worse on exactly this class — it must be unreachable');
  });

  it('a successful window returns a PARTIAL carrying the document`s true length', async () => {
    const cheap = stubCheap();
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrPageCap: 30, ocrPageWindow: { targetPages: 50 } },
      { ...baseDeps, cloudCheapOcr: cheap.fn },
    );
    assert.equal(r.ok, true);
    assert.equal(r.needs_ocr, undefined);
    assert.equal(r.ocr_tier, 'cloud_cheap_window');
    assert.equal(r.page_count, 141, 'page_count is the DOCUMENT length');
    assert.equal(r.ocr_pages, 50, 'ocr_pages is what we were BILLED for — the pages covered');
    assert.equal(r.partial_extract, true);
    assert.deepEqual(r.page_ranges, [[1, 50]]);
  });

  it('a document SHORTER than the window is not marked partial', async () => {
    const cheap = stubCheap();
    const r = await extractDocumentText(
      { sourceUrl: '/sites/x/lease.pdf', ocrPageCap: 30, ocrPageWindow: { targetPages: 50 } },
      { ...baseDeps, pdfPageCount: async () => 35, cloudCheapOcr: cheap.fn },
    );
    assert.equal(r.partial_extract, false);
    assert.equal(r.pages_covered, 35);
  });

  it('the WORKER defaults the window OFF, so a caller that does not ask never gets it', async () => {
    // The handler guard below covers the lanes; this covers the default itself.
    // `deps.ocrPageWindow ?? true` would silently enable the route for the deed
    // lane and every existing caller.
    let seen = 'unset';
    await buildDocTextRow({ id: 1, document_type: 'lease' }, {
      extractDocumentText: async (args) => {
        seen = args.ocrPageWindow;
        return { ok: true, text: 'z'.repeat(4000), method: 'pdf_text' };
      },
    });
    assert.equal(seen, null, 'the window must be opt-in per caller, never defaulted on');
  });

  it('the eligible and jobs lanes never pass a window', () => {
    const src = stripComments(HANDLER_SRC);
    const longdoc = src.slice(src.indexOf('if (isLongDoc)'));
    const before = src.slice(0, src.indexOf('if (isLongDoc)'));
    assert.equal(/ocrPageWindow/.test(before), false,
      'only the longdoc lane may opt in — the ordinary drain must stay byte-identical');
    assert.ok(/ocrPageWindow:\s*\{/.test(longdoc), 'the longdoc lane must pass the window');
  });
});

// ---------------------------------------------------------------------------
// The third state, the cursor, and the honest count
// ---------------------------------------------------------------------------

describe('DOC18 — the partial is a THIRD state, marked honestly', () => {
  const reg = { id: 7, cre_property_id: 3, document_type: 'lease' };

  it('a partial is consumable (needs_ocr false) AND carries its own reason', async () => {
    const built = await buildDocTextRow(reg, {
      extractDocumentText: async () => ({
        ok: true, text: 'x'.repeat(90000), method: 'ocr', ocr_tier: 'cloud_cheap_window',
        ocr_pages: 50, page_count: 141, pages_covered: 50, page_ranges: [[1, 50]],
        partial_extract: true, window_calls: 3,
      }),
    });
    assert.equal(built.outcome, 'partial_window', 'a partial must not report as a plain `ocr` extraction');
    assert.equal(built.row.needs_ocr, false, 'the text we paid for must reach the consumer');
    assert.equal(built.row.reason, 'partial_page_window');
    assert.equal(built.row.partial_extract, true);
    assert.equal(built.row.pages_covered, 50);
    assert.deepEqual(built.row.page_ranges, [[1, 50]]);
    assert.equal(built.row.page_count, 141);
  });

  it('the ORDINARY drain`s payload gains no new keys', async () => {
    const built = await buildDocTextRow(reg, {
      extractDocumentText: async () => ({
        ok: true, text: 'y'.repeat(5000), method: 'pdf_text', text_len: 5000,
      }),
    });
    assert.equal(built.outcome, 'text_extracted');
    for (const k of ['partial_extract', 'pages_covered', 'page_ranges']) {
      assert.equal(k in built.row, false,
        `${k} must be ABSENT from a non-windowed payload — a key the table lacks 400s every write (PGRST204)`);
    }
  });

  it('a windowed row cannot be a ceiling marker, and vice versa', () => {
    assert.equal(CRE_CEILING_REASONS.includes('over_docai_page_cap'), true);
    assert.equal(CRE_CEILING_REASONS.includes('window_failed'), true);
    assert.equal(CRE_CEILING_REASONS.includes('partial_page_window'), false,
      'a partial must NOT re-admit — it is finished for this route, not deferred');
  });
});

describe('DOC18 — the long lane`s cursor is the marker timestamp', () => {
  it('selects both ceiling reasons, oldest ATTEMPT first', async () => {
    const paths = [];
    const q = async (method, path) => {
      paths.push(path);
      if (path.startsWith('lcc_cre_property_document_text')) {
        return { ok: true, data: [{ document_id: 9, page_count: 141, reason: 'over_docai_page_cap', extracted_at: '2026-08-01T00:00:00Z' }] };
      }
      return { ok: true, data: [{ id: 9, document_type: 'lease', cre_property_id: 1 }] };
    };
    const r = await fetchOverCapCreDocs({ limit: 1 }, { opsQuery: q });
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1);
    assert.ok(/order=extracted_at\.asc/.test(paths[0]),
      'the marker timestamp IS the cursor — without it the head never rotates and one unservable document is re-selected forever');
    assert.ok(/reason=in\.\(over_docai_page_cap,window_failed\)/.test(paths[0]));
    assert.ok(/needs_ocr=is\.true/.test(paths[0]));
  });

  it('FAILS CLOSED when the registry lookup fails', async () => {
    const q = async (method, path) => {
      if (path.startsWith('lcc_cre_property_document_text')) {
        return { ok: true, data: [{ document_id: 9, page_count: 141, reason: 'window_failed', extracted_at: 'x' }] };
      }
      return { ok: false, status: 500, data: 'boom' };
    };
    const r = await fetchOverCapCreDocs({ limit: 1 }, { opsQuery: q });
    assert.equal(r.ok, false, 'a failed read must never be reported as an empty queue');
    assert.equal(r.stage, 'registry_lookup');
  });

  it('gives the route its own budget rather than the 22 s tick budget', () => {
    assert.ok(CRE_OCR_WINDOW_BUDGET_MS >= 60000,
      'three DocAI calls measured 10-20 s EACH (DOC17) — a 22 s budget cannot hold one document');
    const src = stripComments(HANDLER_SRC);
    assert.ok(/isLongDoc\s*\n?\s*\?\s*CRE_OCR_WINDOW_BUDGET_MS/.test(src),
      'the longdoc lane must use its own budget');
  });
});

describe('DOC18 — bov_ready reports a partial rather than counting it complete', () => {
  const sql = stripSqlComments(MIGRATION_SRC);

  it('appends the partial columns at the END of the view (CREATE OR REPLACE is append-only)', () => {
    const view = /CREATE OR REPLACE VIEW public\.v_lcc_cre_bov_ready AS[\s\S]*?;/.exec(sql)?.[0] || '';
    assert.ok(view, 'expected the bov_ready view body');
    const order = ['extractable_docs', 'covered_docs', 'lease_docs', 'lease_covered',
      'partial_docs', 'fully_covered_docs', 'lease_partial'];
    let last = -1;
    for (const col of order) {
      const at = view.indexOf(`AS ${col}`);
      assert.ok(at > last, `${col} must appear after the previous column (42P16 on a mid-list insert)`);
      last = at;
    }
  });

  it('keeps membership unchanged — a partial is still consumable', () => {
    const view = /CREATE OR REPLACE VIEW public\.v_lcc_cre_bov_ready AS[\s\S]*?;/.exec(sql)?.[0] || '';
    assert.ok(/HAVING count\(\*\) FILTER \(WHERE document_type = 'lease'\) >= 1/.test(view));
    assert.ok(/AND count\(\*\) FILTER \(WHERE covered\) = count\(\*\)/.test(view));
    assert.equal(/HAVING[\s\S]*partial/.test(view), false,
      'excluding partials from membership would keep real leases out of BOV extract for no gain');
  });

  it('a partial row must have text — the CHECK makes the incoherent state impossible', () => {
    assert.ok(/CHECK \(NOT partial_extract OR \(raw_text IS NOT NULL AND NOT needs_ocr\)\)/.test(sql));
  });
});
