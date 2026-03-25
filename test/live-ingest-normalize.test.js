import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLiveIngestDocument,
  normalizeLiveIngestDocuments
} from '../api/_shared/live-ingest-normalize.js';

describe('normalizeLiveIngestDocument', () => {
  it('strips html into readable text', () => {
    const doc = normalizeLiveIngestDocument({
      name: 'page.html',
      mime_type: 'text/html',
      text: '<html><body><h1>Deal</h1><p>Price &amp; terms</p><script>alert(1)</script></body></html>'
    });

    assert.equal(doc.source_kind, 'html');
    assert.match(doc.normalized_text, /Deal/);
    assert.match(doc.normalized_text, /Price & terms/);
    assert.doesNotMatch(doc.normalized_text, /alert/);
  });

  it('extracts headers and preferred body from raw email', () => {
    const raw = [
      'Subject: Test Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/alternative; boundary="abc123"',
      '',
      '--abc123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Plain body line',
      '--abc123',
      'Content-Type: text/html; charset="utf-8"',
      '',
      '<html><body><p>HTML body line</p></body></html>',
      '--abc123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'message.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /Subject: Test Intake/);
    assert.match(doc.normalized_text, /From: sender@example.com/);
    assert.match(doc.normalized_text, /Plain body line/);
  });

  it('summarizes attachments from multipart email', () => {
    const raw = [
      'Subject: Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="mix123"',
      '',
      '--mix123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached lease abstract.',
      '--mix123',
      'Content-Type: application/pdf; name="lease.pdf"',
      'Content-Disposition: attachment; filename="lease.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--mix123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /See attached lease abstract/);
    assert.match(doc.normalized_text, /Attachments:/);
    assert.match(doc.normalized_text, /lease\.pdf \(application\/pdf\)/);
    assert.equal(doc.metadata.attachment_summary.includes('lease.pdf'), true);
  });

  it('extracts readable text from text-like email attachments', () => {
    const raw = [
      'Subject: Attachment Body Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="mix456"',
      '',
      '--mix456',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Attached notes and rent roll.',
      '--mix456',
      'Content-Type: text/csv; name="rent-roll.csv"',
      'Content-Disposition: attachment; filename="rent-roll.csv"',
      '',
      'tenant,monthly_rent',
      'Alpha LLC,12000',
      '--mix456',
      'Content-Type: text/html; name="notes.html"',
      'Content-Disposition: attachment; filename="notes.html"',
      '',
      '<html><body><p>Lease starts 2026-04-01</p></body></html>',
      '--mix456--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'attachment-body.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.equal(doc.source_kind, 'email');
    assert.match(doc.normalized_text, /Attachment content excerpts:/);
    assert.match(doc.normalized_text, /rent-roll\.csv \(text\/csv\)/);
    assert.match(doc.normalized_text, /tenant,monthly_rent/);
    assert.match(doc.normalized_text, /Lease starts 2026-04-01/);
    assert.equal(doc.metadata.attachment_preview_count, 2);
  });

  it('handles nested multipart email attachments', () => {
    const raw = [
      'Subject: Nested Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="outer123"',
      '',
      '--outer123',
      'Content-Type: multipart/alternative; boundary="inner456"',
      '',
      '--inner456',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Outer message body.',
      '--inner456--',
      '--outer123',
      'Content-Type: application/json; name="payload.json"',
      'Content-Disposition: attachment; filename="payload.json"',
      '',
      '{\"status\":\"approved\",\"amount\":42}',
      '--outer123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'nested.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /Outer message body/);
    assert.match(doc.normalized_text, /payload\.json \(application\/json\)/);
    assert.match(doc.normalized_text, /"status":"approved"/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });

  it('extracts readable text from attached pdf payloads when present', () => {
    const pdfLike = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nstream\nBT\n(Lease Rate 12500 Monthly) Tj\n(Effective Date 2026-05-01) Tj\nET\nendstream\nendobj\n', 'utf8').toString('base64');
    const raw = [
      'Subject: PDF Attachment Intake',
      'From: sender@example.com',
      'To: receiver@example.com',
      'Content-Type: multipart/mixed; boundary="pdf123"',
      '',
      '--pdf123',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'See attached lease PDF.',
      '--pdf123',
      'Content-Type: application/pdf; name="lease.pdf"',
      'Content-Disposition: attachment; filename="lease.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdfLike,
      '--pdf123--'
    ].join('\r\n');

    const doc = normalizeLiveIngestDocument({
      name: 'pdf-attachment.eml',
      mime_type: 'message/rfc822',
      text: raw
    });

    assert.match(doc.normalized_text, /lease\.pdf \(application\/pdf\)/);
    assert.match(doc.normalized_text, /Attachment content excerpts:/);
    assert.match(doc.normalized_text, /Lease Rate 12500 Monthly/);
    assert.match(doc.normalized_text, /Effective Date 2026-05-01/);
    assert.equal(doc.metadata.attachment_preview_count, 1);
  });
});

describe('normalizeLiveIngestDocuments', () => {
  it('truncates and filters normalized documents', () => {
    const docs = normalizeLiveIngestDocuments([
      { name: 'one.txt', mime_type: 'text/plain', text: 'alpha' },
      null,
      { name: 'two.txt', mime_type: 'text/plain', text: '' }
    ]);

    assert.equal(docs.length, 1);
    assert.equal(docs[0].normalized_text, 'alpha');
  });
});
