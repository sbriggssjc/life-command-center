// R58 Unit 1 — shared document text / OCR foundation. Pure core with injected
// byte-fetch / pdf-parse / OCR deps so no network or OpenAI key is needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';

const { extractDocumentText, isAbsoluteUrl, fetchDocBytes, ocrPdfToTextTiered } = await import('../api/_shared/document-text.js');

const pdfBuf = Buffer.from('%PDF-1.7 fake');           // %P magic → treated as pdf
const okFetch = async () => ({ ok: true, buffer: pdfBuf, contentType: 'application/pdf' });

describe('document-text foundation (R58 Unit 1)', () => {
  it('isAbsoluteUrl distinguishes CDN urls from sharepoint refs', () => {
    assert.equal(isAbsoluteUrl('https://ahprd1cdn.csgpimgs.com/d2/x/Deed'), true);
    assert.equal(isAbsoluteUrl('/sites/TeamBriggs20/Shared Documents/x.pdf'), false);
    assert.equal(isAbsoluteUrl(''), false);
  });

  it('digital PDF → pdf_text (no OCR attempted)', async () => {
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/deed.pdf' },
      { fetchDocBytes: okFetch, pdfTextFromBuffer: async () => 'GRANT DEED ... grantor ... grantee ...' }
    );
    assert.equal(r.ok, true);
    assert.equal(r.method, 'pdf_text');
    assert.equal(r.ocr_attempted, false);
    assert.ok(r.text_len > 0);
  });

  it('scanned PDF (zero digital text) → OCR fallback yields text', async () => {
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/scan.pdf' },
      {
        fetchDocBytes: okFetch,
        pdfTextFromBuffer: async () => '',                       // no text layer
        ocrPdfToText: async () => ({ ok: true, text: 'OCR transcribed deed text' }),
      }
    );
    assert.equal(r.method, 'ocr');
    assert.equal(r.ocr_attempted, true);
    assert.equal(r.ocr_ok, true);
    assert.ok(r.text.includes('OCR'));
  });

  it('scanned PDF + OCR unavailable → needs_ocr (truthful, not an error)', async () => {
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/scan.pdf' },
      {
        fetchDocBytes: okFetch,
        pdfTextFromBuffer: async () => '',
        ocrPdfToText: async () => ({ ok: false, reason: 'ocr_non_ok' }),
      }
    );
    assert.equal(r.ok, true);
    assert.equal(r.needs_ocr, true);
    assert.equal(r.text_len, 0);
  });

  it('allowOcr:false on a scanned PDF → needs_ocr without attempting OCR', async () => {
    let ocrCalled = false;
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/scan.pdf', allowOcr: false },
      { fetchDocBytes: okFetch, pdfTextFromBuffer: async () => '', ocrPdfToText: async () => { ocrCalled = true; return { ok: true, text: 'x' }; } }
    );
    assert.equal(r.needs_ocr, true);
    assert.equal(r.ocr_attempted, false);
    assert.equal(ocrCalled, false);
  });

  it('byte fetch failure → ok:false (transient, leave for retry)', async () => {
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/gone.pdf' },
      { fetchDocBytes: async () => ({ ok: false, status: 404, detail: 'fetch_non_ok' }) }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'fetch_failed');
    assert.equal(r.status, 404);
  });

  it('text/* document → text_decode', async () => {
    const r = await extractDocumentText(
      { sourceUrl: 'https://cdn/note.txt' },
      { fetchDocBytes: async () => ({ ok: true, buffer: Buffer.from('plain text body'), contentType: 'text/plain' }) }
    );
    assert.equal(r.method, 'text_decode');
    assert.ok(r.text.includes('plain text body'));
  });

  it('fetchDocBytes routes absolute url to direct fetch, ref to sharepoint', async () => {
    let direct = false;
    const r = await fetchDocBytes({
      sourceUrl: 'https://cdn/x.pdf',
      fetchImpl: async () => { direct = true; return { ok: true, arrayBuffer: async () => pdfBuf, headers: { get: () => 'application/pdf' } }; },
    });
    assert.equal(direct, true);
    assert.equal(r.ok, true);
  });
});

describe('tiered OCR — free-first, cheap-cloud escalation (UW#4 / UW#4b)', () => {
  const buf = Buffer.from('%PDF scan');
  // Keep each test hermetic w.r.t. the cloud-policy env vars.
  function clearCloudEnv() {
    delete process.env.OCR_CLOUD_ESCALATION;
    delete process.env.OCR_FREE_CONFIDENCE_MIN;
    delete process.env.OCR_CLOUD_PROVIDER;
    delete process.env.OCR_CLOUD_OCR_URL;
    delete process.env.OCR_CLOUD_GPT4O_LASTRESORT;
  }

  it('free tier above the floor → used, no paid tier called', async () => {
    clearCloudEnv();
    let cheap = false, gpt = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'free ocr text', confidence: 88, engine: 'surya' }),
      cloudCheapOcr: async () => { cheap = true; return { ok: true, text: 'cheap' }; },
      ocrPdfToText: async () => { gpt = true; return { ok: true, text: 'gpt' }; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.tier, 'free');
    assert.equal(r.confidence, 88);
    assert.equal(r.engine, 'surya');
    assert.equal(cheap, false);
    assert.equal(gpt, false);
  });

  it('UW#4b — free below the floor → escalates to CHEAP CLOUD, not gpt-4o', async () => {
    clearCloudEnv();
    process.env.OCR_FREE_CONFIDENCE_MIN = '55';
    let cheap = false, gpt = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'garbled', confidence: 20, engine: 'tesseract' }),
      cloudCheapOcr: async () => { cheap = true; return { ok: true, text: 'docai transcription', confidence: 97, engine: 'google_docai' }; },
      ocrPdfToText: async () => { gpt = true; return { ok: true, text: 'gpt', model: 'gpt-4o' }; },
    });
    assert.equal(cheap, true);
    assert.equal(gpt, false);                 // gpt-4o is NOT the lease default
    assert.equal(r.tier, 'cloud_cheap');
    assert.equal(r.text, 'docai transcription');
    assert.equal(r.engine, 'google_docai');
    assert.equal(r.confidence, 97);
    clearCloudEnv();
  });

  it('UW#4b — no free adapter + cheap cloud configured → cheap cloud (preferred paid)', async () => {
    clearCloudEnv();
    let gpt = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      cloudCheapOcr: async () => ({ ok: true, text: 'cheap only', engine: 'azure_di' }),
      ocrPdfToText: async () => { gpt = true; return { ok: true, text: 'gpt', model: 'gpt-4o' }; },
    });
    assert.equal(r.tier, 'cloud_cheap');
    assert.equal(r.engine, 'azure_di');
    assert.equal(gpt, false);
  });

  it('UW#4b — gpt-4o reached ONLY behind the explicit last-resort flag', async () => {
    clearCloudEnv();
    process.env.OCR_CLOUD_GPT4O_LASTRESORT = 'true';
    let gpt = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      // cheap cloud misses (unconfigured), so it falls to the gated last resort
      cloudCheapOcr: async () => ({ ok: false, reason: 'cloud_ocr_unconfigured' }),
      ocrPdfToText: async () => { gpt = true; return { ok: true, text: 'gpt rescue', model: 'gpt-4o' }; },
    });
    assert.equal(gpt, true);
    assert.equal(r.tier, 'cloud');
    assert.equal(r.engine, 'gpt-4o');
    clearCloudEnv();
  });

  it('UW#4b — OCR_CLOUD_PROVIDER=gpt4o selects gpt-4o as the paid tier', async () => {
    clearCloudEnv();
    process.env.OCR_CLOUD_PROVIDER = 'gpt4o';
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      ocrPdfToText: async () => ({ ok: true, text: 'gpt only', model: 'gpt-4o' }),
    });
    assert.equal(r.tier, 'cloud');
    assert.equal(r.engine, 'gpt-4o');
    clearCloudEnv();
  });

  it('UW#4b — default (no provider, no flag) → ZERO spend, gpt-4o never called', async () => {
    clearCloudEnv();
    let gpt = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      ocrPdfToText: async () => { gpt = true; return { ok: true, text: 'gpt' }; },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'cloud_ocr_unconfigured');
    assert.equal(gpt, false);
  });

  it('low-conf free + cloud disabled → returns free_low_conf (pure-free drain)', async () => {
    clearCloudEnv();
    process.env.OCR_CLOUD_ESCALATION = 'false';
    process.env.OCR_FREE_CONFIDENCE_MIN = '55';
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'weak text', confidence: 30, engine: 'tesseract' }),
      cloudCheapOcr: async () => ({ ok: true, text: 'should not run' }),
    });
    assert.equal(r.tier, 'free_low_conf');
    assert.equal(r.text, 'weak text');
    clearCloudEnv();
  });

  it('free fails + cloud disabled → ok:false (no spend, honest miss)', async () => {
    clearCloudEnv();
    process.env.OCR_CLOUD_ESCALATION = 'false';
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: false, reason: 'tesseract_empty' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'free_ocr_unavailable_cloud_disabled');
    clearCloudEnv();
  });

  it('free adapter throws → escalates to cheap cloud (never a 500)', async () => {
    clearCloudEnv();
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => { throw new Error('binary missing'); },
      cloudCheapOcr: async () => ({ ok: true, text: 'cheap rescued', engine: 'webhook' }),
    });
    assert.equal(r.tier, 'cloud_cheap');
    assert.equal(r.text, 'cheap rescued');
  });
});

describe('ocrCloudCheap — cheap-cloud HTTP seam (UW#4b)', () => {
  const buf = Buffer.from('%PDF scan');

  it('unconfigured (no OCR_CLOUD_OCR_URL) → no-op, zero spend', async () => {
    delete process.env.OCR_CLOUD_OCR_URL;
    const { ocrCloudCheap } = await import('../api/_shared/document-text.js');
    const r = await ocrCloudCheap({ buffer: buf });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'cloud_ocr_unconfigured');
  });

  it('configured → POSTs base64 and reads back { text, confidence }', async () => {
    process.env.OCR_CLOUD_OCR_URL = 'https://ocr.example/flow';
    process.env.OCR_CLOUD_PROVIDER = 'google_docai';
    const { ocrCloudCheap } = await import('../api/_shared/document-text.js');
    let sentBody = null;
    const r = await ocrCloudCheap({
      buffer: buf,
      fetchImpl: async (_url, opts) => {
        sentBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ text: 'doc ai text', confidence: 96, engine: 'google_docai' }) };
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'doc ai text');
    assert.equal(r.confidence, 96);
    assert.equal(r.engine, 'google_docai');
    assert.equal(sentBody.provider, 'google_docai');
    assert.ok(typeof sentBody.content_base64 === 'string' && sentBody.content_base64.length > 0);
    delete process.env.OCR_CLOUD_OCR_URL;
    delete process.env.OCR_CLOUD_PROVIDER;
  });
});
