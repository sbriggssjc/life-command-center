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
