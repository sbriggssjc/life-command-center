// CONTACT-SELECTION Slice 4 — Phase A: deed/PSA signature-block parser tests.
//
// The parser is pure text→signer, so it is fully validated here against
// realistic deed / PSA execution blocks (the dia byte fetch is deferred /
// network-gated, so the parser is gated by these fixtures, per Scott's branch).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeedSignatory, buildDeedParseAdapter } from '../api/_shared/deed-signatory.js';

describe('parseDeedSignatory', () => {
  it('LLC deed exec block (By/Name/Title) → manager, high', () => {
    const txt = `IN WITNESS WHEREOF, Grantor has executed this Special Warranty Deed.

GRANTOR:

CARROLLWOOD INVESTORS, LLC,
a Florida limited liability company

By: /s/ Robert J. Hughes
Name: Robert J. Hughes
Title: Manager`;
    const r = parseDeedSignatory(txt);
    assert.equal(r.ok, true);
    assert.equal(r.person_name, 'Robert J. Hughes');
    assert.equal(r.role, 'manager');
    assert.equal(r.authority, 1);
    assert.equal(r.confidence, 'high');
  });

  it('PSA same-line "By: Name, its Managing Member" → managing_member', () => {
    const txt = `SELLER:\nDV WYOMING LLC\nBy: Jennifer A. Park, its Managing Member`;
    const r = parseDeedSignatory(txt);
    assert.equal(r.ok, true);
    assert.equal(r.person_name, 'Jennifer A. Park');
    assert.equal(r.role, 'managing_member');
  });

  it('bare signature with no title → signatory, medium', () => {
    const r = parseDeedSignatory('Executed this day.\nBy: /s/ Michael Chen\n');
    assert.equal(r.ok, true);
    assert.equal(r.person_name, 'Michael Chen');
    assert.equal(r.role, 'signatory');
    assert.equal(r.confidence, 'medium');
  });

  it('never returns the LLC / a blank signature as a person', () => {
    const txt = `GRANTOR:\nACME HOLDINGS, LLC\nBy: ____________________\nName: ACME HOLDINGS, LLC\nTitle: Owner`;
    assert.equal(parseDeedSignatory(txt).ok, false);
  });

  it('no execution block → no signer (never a guess)', () => {
    const txt = 'This Special Warranty Deed made this 1st day of January, 2020 between grantor and grantee for $10.00.';
    const r = parseDeedSignatory(txt);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_signature_block');
  });

  it('multiple signers → highest authority wins (managing_member > member)', () => {
    const txt = `By: /s/ Sara Lin\nName: Sara Lin\nTitle: Member\n\nBy: /s/ Tom Reed\nName: Tom Reed\nTitle: Managing Member`;
    const r = parseDeedSignatory(txt);
    assert.equal(r.ok, true);
    assert.equal(r.person_name, 'Tom Reed');
    assert.equal(r.role, 'managing_member');
  });

  it('empty / too-short text → no_text', () => {
    assert.equal(parseDeedSignatory('').reason, 'no_text');
    assert.equal(parseDeedSignatory(null).reason, 'no_text');
  });
});

describe('buildDeedParseAdapter (feature-flag + fetch wiring)', () => {
  it('unconfigured (no OWNER_ENRICH_DEED_URL) → unconfigured no-op', async () => {
    delete process.env.OWNER_ENRICH_DEED_URL;
    const adapter = buildDeedParseAdapter({ fetchDocText: async () => ({ ok: true, text: 'By: John Smith\nTitle: Manager' }) });
    const r = await adapter({ owner_name: 'X LLC' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unconfigured');
  });

  it('configured + fetched text → parses + returns the signer', async () => {
    process.env.OWNER_ENRICH_DEED_URL = 'https://example.test/deed';
    try {
      const adapter = buildDeedParseAdapter({ fetchDocText: async () => ({ ok: true, text: 'By: /s/ Dana Cole\nName: Dana Cole\nTitle: Manager', source_url: 'sp://x' }) });
      const r = await adapter({ owner_name: 'X LLC' });
      assert.equal(r.ok, true);
      assert.equal(r.person_name, 'Dana Cole');
      assert.equal(r.role, 'manager');
      assert.equal(r.source_doc, 'sp://x');
    } finally { delete process.env.OWNER_ENRICH_DEED_URL; }
  });

  it('configured but doc has no parseable block → reason from parse', async () => {
    process.env.OWNER_ENRICH_DEED_URL = 'https://example.test/deed';
    try {
      const adapter = buildDeedParseAdapter({ fetchDocText: async () => ({ ok: true, text: 'just some legal recitals, no signers' }) });
      const r = await adapter({ owner_name: 'X LLC' });
      assert.equal(r.ok, false);
    } finally { delete process.env.OWNER_ENRICH_DEED_URL; }
  });
});
