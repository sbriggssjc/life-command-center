// Prompt 115 — the bridge handler dropped the email body, so the voice corpus
// (`email_bodies.body_html` / `body_text`) stayed empty on all 23,169 rows even
// after the Prompt-114 allowlist let the full body through to the payload.
//
// Grounded root cause (LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-15): the body
// reached `enrichment_jobs.payload` in two different shapes across two live
// sweeps — a Graph object AND a serialized JSON string — and the handler's
// exact-equality split (`p.body?.contentType === 'html'`) produced NULL for the
// string shape while discarding 90–180 KB of content. The bodyless forward
// sweep then wrote explicit NULLs over whatever a body-bearing sweep had stored.
//
// These tests pin the contract: non-empty content ALWAYS lands in a column;
// no content NEVER touches the body columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGraphBody, buildEmailBodyRow,
} from '../api/_shared/bridge-handlers-outlook.js';

const HTML = '<html><head>\r\n<meta http-equiv="Content-Type" content="text/html; '
  + 'charset=utf-8"></head><body><div>Scott — following up on the LOI.</div></body></html>';

function rowFor(body) {
  return buildEmailBodyRow({
    workspaceId: 'ws-1',
    msgId: '<abc@example.com>',
    payload: { subject: 'Re: LOI', bodyPreview: 'Scott — following up', body },
    fromEmail: 'scott@example.com',
    toEmails: ['buyer@example.com'],
    ccEmails: [],
    isSent: true,
    sourceUserId: 'user-1',
  });
}

// ---- shape 1: the Graph object (the shape the sweep is supposed to send) ----

test('Graph object body {contentType:html, content} persists body_html', () => {
  const row = rowFor({ contentType: 'html', content: HTML });
  assert.equal(row.body_format, 'html');
  assert.equal(row.body_html, HTML);
  assert.equal(row.body_text, null);
});

test('Graph object body {contentType:text, content} persists body_text', () => {
  const row = rowFor({ contentType: 'text', content: 'plain sentence, no markup' });
  assert.equal(row.body_format, 'text');
  assert.equal(row.body_text, 'plain sentence, no markup');
  assert.equal(row.body_html, null);
});

// ---- shape 2: the serialized-JSON string (observed live, wave B) -----------

test('body arriving as a JSON STRING is parsed, not dropped', () => {
  const row = rowFor(JSON.stringify({ content: HTML, contentType: 'html' }));
  assert.equal(row.body_format, 'html');
  assert.equal(row.body_html, HTML);
});

test('body arriving as a bare (non-JSON) string still lands as content', () => {
  const row = rowFor(HTML);
  assert.equal(row.body_format, 'html');
  assert.equal(row.body_html, HTML);
});

// ---- contentType fragility: casing, whitespace, mime, missing --------------

test('contentType casing / whitespace / mime spellings are normalized', () => {
  for (const ct of ['HTML', ' Html ', 'text/html']) {
    assert.equal(normalizeGraphBody({ contentType: ct, content: HTML })?.format, 'html', ct);
  }
  for (const ct of ['TEXT', ' text ', 'text/plain']) {
    assert.equal(normalizeGraphBody({ contentType: ct, content: 'hi' })?.format, 'text', ct);
  }
});

test('missing contentType with HTML content is SNIFFED to body_html', () => {
  const row = rowFor({ content: HTML });          // the setProperty variant
  assert.equal(row.body_format, 'html');
  assert.equal(row.body_html, HTML);
  assert.equal(row.body_text, null);
});

test('missing contentType with plain content falls back to body_text', () => {
  const row = rowFor({ content: 'Thanks Scott — talk Monday.' });
  assert.equal(row.body_format, 'text');
  assert.equal(row.body_text, 'Thanks Scott — talk Monday.');
  assert.equal(row.body_html, null);
});

test('unrecognized contentType never discards content', () => {
  assert.equal(normalizeGraphBody({ contentType: 'multipart', content: HTML })?.html, HTML);
  assert.equal(normalizeGraphBody({ contentType: 'weird', content: 'no markup' })?.text, 'no markup');
});

test('a fragment without <html> still sniffs as html', () => {
  assert.equal(normalizeGraphBody({ content: '<div>hi<br></div>' })?.format, 'html');
  assert.equal(normalizeGraphBody({ content: '<p>hi</p>' })?.format, 'html');
});

// ---- the empty case: no fabrication, and no clobber ------------------------

test('empty / missing body writes NO body columns (no fabrication, no clobber)', () => {
  for (const empty of [undefined, null, '', '   ', {}, { contentType: 'html' },
    { contentType: 'html', content: '' }, { content: '   ' }, '{}']) {
    const row = rowFor(empty);
    assert.equal(normalizeGraphBody(empty), null, JSON.stringify(empty));
    // Columns are OMITTED, not nulled: merge-duplicates leaves an already-stored
    // body intact while a fresh row still lands NULL by column default.
    assert.equal('body_format' in row, false, JSON.stringify(empty));
    assert.equal('body_html' in row, false, JSON.stringify(empty));
    assert.equal('body_text' in row, false, JSON.stringify(empty));
  }
});

test('body-bearing payload DOES emit all three body columns', () => {
  const row = rowFor({ contentType: 'html', content: HTML });
  assert.equal('body_format' in row, true);
  assert.equal('body_html' in row, true);
  assert.equal('body_text' in row, true);
});

// ---- the rest of the row is unchanged by the 115 refactor ------------------

test('non-body columns are preserved verbatim', () => {
  const row = rowFor({ contentType: 'html', content: HTML });
  assert.equal(row.workspace_id, 'ws-1');
  assert.equal(row.internet_message_id, '<abc@example.com>');
  assert.equal(row.subject, 'Re: LOI');
  assert.equal(row.body_preview, 'Scott — following up');
  assert.equal(row.from_email, 'scott@example.com');
  assert.deepEqual(row.to_emails, ['buyer@example.com']);
  assert.equal(row.is_sent, true);
  assert.equal(row.source_user_id, 'user-1');
});
