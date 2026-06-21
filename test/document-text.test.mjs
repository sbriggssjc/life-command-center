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

describe('tiered OCR — free-first, cloud escalation (UW#4)', () => {
  const buf = Buffer.from('%PDF scan');

  it('free tier above the floor → used, cloud never called', async () => {
    let cloud = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'free ocr text', confidence: 88, engine: 'tesseract' }),
      ocrPdfToText: async () => { cloud = true; return { ok: true, text: 'cloud' }; },
    });
    assert.equal(r.ok, true);
    assert.equal(r.tier, 'free');
    assert.equal(r.confidence, 88);
    assert.equal(cloud, false);
  });

  it('free tier below the floor → escalates to cloud', async () => {
    process.env.OCR_FREE_CONFIDENCE_MIN = '55';
    let cloud = false;
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'garbled', confidence: 20, engine: 'tesseract' }),
      ocrPdfToText: async () => { cloud = true; return { ok: true, text: 'cloud transcription', model: 'gpt-4o' }; },
    });
    assert.equal(cloud, true);
    assert.equal(r.tier, 'cloud');
    assert.equal(r.text, 'cloud transcription');
    delete process.env.OCR_FREE_CONFIDENCE_MIN;
  });

  it('no free adapter configured → straight to cloud (byte-identical to R58)', async () => {
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      ocrPdfToText: async () => ({ ok: true, text: 'cloud only', model: 'gpt-4o' }),
    });
    assert.equal(r.tier, 'cloud');
    assert.equal(r.engine, 'gpt-4o');
  });

  it('low-conf free + cloud disabled → returns free_low_conf (pure-free drain)', async () => {
    process.env.OCR_CLOUD_ESCALATION = 'false';
    process.env.OCR_FREE_CONFIDENCE_MIN = '55';
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: true, text: 'weak text', confidence: 30, engine: 'tesseract' }),
      ocrPdfToText: async () => ({ ok: true, text: 'should not run' }),
    });
    assert.equal(r.tier, 'free_low_conf');
    assert.equal(r.text, 'weak text');
    delete process.env.OCR_CLOUD_ESCALATION;
    delete process.env.OCR_FREE_CONFIDENCE_MIN;
  });

  it('free fails + cloud disabled → ok:false (no spend, honest miss)', async () => {
    process.env.OCR_CLOUD_ESCALATION = 'false';
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => ({ ok: false, reason: 'tesseract_empty' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'free_ocr_unavailable_cloud_disabled');
    delete process.env.OCR_CLOUD_ESCALATION;
  });

  it('free adapter throws → escalates to cloud (never a 500)', async () => {
    const r = await ocrPdfToTextTiered({ buffer: buf }, {
      freeOcr: async () => { throw new Error('binary missing'); },
      ocrPdfToText: async () => ({ ok: true, text: 'cloud rescued', model: 'gpt-4o' }),
    });
    assert.equal(r.tier, 'cloud');
    assert.equal(r.text, 'cloud rescued');
  });
});
