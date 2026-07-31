// ============================================================================
// sf-file-collector.test.mjs — W3.7c: PA-collector file-discovery helpers
//
// The server-side Connected-App sweep is retired (the org is SSO-gated, no admin;
// SALESFORCE_LCC_INGESTION_PLAN.md §2). Power Automate is the only SF transport:
// GET ?action=discovery-worklist → PA reads SF → POST ?action=discover-webhook
// (metadata) → POST ?action=file-content (bytes). These tests prove the PURE
// logic those three actions wrap: worklist item shaping + lease cutoff, the
// discover-webhook row mapper + dedup contract, and the file-content size/sha
// decision (idempotence + sha-mismatch rejection). Fort Wayne's real SF ids are
// the acceptance fixture (its OM hangs off the LISTING a0jVs000005AqaLIAS).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKLIST_OBJECTS, DEFAULT_WORKLIST_STALE_DAYS, normalizeVertical,
  makeWorklistItem, staleCutoffIso, mapDiscoveredFileToRow, filterNewVersions,
  fileContentDecision,
} from '../supabase/functions/intake-salesforce-files/discovery.ts';

// Fort Wayne's REAL Salesforce ids (from gov.sf_comp_staging, live).
const FW_LISTING = 'a0jVs000005AqaLIAS';
const FW_DEAL = '006Vs00000MV4aYIAT';
const FW_COMP = 'a1YVs000002BnvVMAS';
const FW_CV = '068Vs00000FortWEAA';
const FW_DOC = '069Vs00000FortWEAA';

describe('worklist — objects + vertical + lease cutoff', () => {
  it('serves the three staged objects', () => {
    assert.deepEqual(WORKLIST_OBJECTS.map((o) => o.key).sort(), ['comp', 'deal', 'listing']);
  });
  it('normalizeVertical accepts dia/gov, rejects everything else', () => {
    assert.equal(normalizeVertical('gov'), 'gov');
    assert.equal(normalizeVertical('DIA'), 'dia');
    assert.equal(normalizeVertical('ops'), null);
    assert.equal(normalizeVertical(''), null);
    assert.equal(normalizeVertical(null), null);
  });
  it('makeWorklistItem carries vertical + object type + sf type + id', () => {
    const listing = WORKLIST_OBJECTS.find((o) => o.key === 'listing');
    const item = makeWorklistItem('gov', listing, FW_LISTING);
    assert.deepEqual(item, {
      vertical: 'gov', object_type: 'listing', sf_type: 'Listing__c',
      linked_entity_sf_id: FW_LISTING,
    });
  });
  it('staleCutoffIso is now minus N days, defaulting on junk input', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0); // 2026-07-31T12:00:00Z
    assert.equal(staleCutoffIso(now, 7), '2026-07-24T12:00:00.000Z');
    assert.equal(staleCutoffIso(now, 0), '2026-07-31T12:00:00.000Z');
    // Bad staleDays falls back to the default window.
    const def = staleCutoffIso(now, NaN);
    assert.equal(def, new Date(now - DEFAULT_WORKLIST_STALE_DAYS * 86400000).toISOString());
  });
});

describe('discover-webhook — map PA metadata → sf_files discovered row', () => {
  const base = {
    linked_entity_type: 'Listing__c', linked_entity_id: FW_LISTING,
    content_document_id: FW_DOC, content_version_id: FW_CV,
    title: 'US Department of Veterans Affairs - Fort Wayne - IN - OM',
    file_name: 'Fort Wayne VA OM.pdf', extension: 'pdf', version_number: '1',
    size_bytes: 6234567,
  };
  it('maps a Listing-attached OM and stamps the sf_listing_id traversal column', () => {
    const row = mapDiscoveredFileToRow({ file: base, batchId: 'wh-1', nowIso: '2026-07-31T00:00:00.000Z' });
    assert.ok(row);
    assert.equal(row.content_version_id, FW_CV);
    assert.equal(row.linked_entity_type, 'Listing__c');
    assert.equal(row.linked_entity_sf_id, FW_LISTING);
    assert.equal(row.sf_listing_id, FW_LISTING);
    assert.equal(row.sf_comp_id, undefined);
    assert.equal(row.ingestion_status, 'discovered');
    assert.equal(row.extraction_status, 'pending');
    assert.equal(row.source_system, 'salesforce');
    assert.equal(row.extension, 'pdf');
    assert.equal(row.sf_download_url, `/services/data/v60.0/sobjects/ContentVersion/${FW_CV}/VersionData`);
  });
  it('a deal-attached file stamps sf_deal_id; a comp-attached one stamps sf_comp_id', () => {
    const deal = mapDiscoveredFileToRow({ file: { ...base, linked_entity_type: 'Opportunity', linked_entity_id: FW_DEAL, content_version_id: '068Vs00000DealAEAA' }, batchId: 'b', nowIso: 'now' });
    assert.equal(deal.sf_deal_id, FW_DEAL);
    const comp = mapDiscoveredFileToRow({ file: { ...base, linked_entity_type: 'Comp__c', linked_entity_id: FW_COMP, content_version_id: '068Vs00000CompAEAA' }, batchId: 'b', nowIso: 'now' });
    assert.equal(comp.sf_comp_id, FW_COMP);
  });
  it('rejects unusable rows: missing cvid, bad linked id, non-document extension', () => {
    assert.equal(mapDiscoveredFileToRow({ file: { ...base, content_version_id: null }, batchId: 'b', nowIso: 'n' }), null);
    assert.equal(mapDiscoveredFileToRow({ file: { ...base, linked_entity_id: "x' OR 1=1--" }, batchId: 'b', nowIso: 'n' }), null);
    assert.equal(mapDiscoveredFileToRow({ file: { ...base, extension: 'png' }, batchId: 'b', nowIso: 'n' }), null);
  });
});

describe('discover-webhook — dedup contract (content_version_id)', () => {
  it('drops a row whose content_version_id already exists in sf_files', () => {
    const rows = [
      mapDiscoveredFileToRow({ file: { linked_entity_type: 'Listing__c', linked_entity_id: FW_LISTING, content_version_id: FW_CV, extension: 'pdf' }, batchId: 'b', nowIso: 'n' }),
      mapDiscoveredFileToRow({ file: { linked_entity_type: 'Comp__c', linked_entity_id: FW_COMP, content_version_id: '068Vs00000CompAEAA', extension: 'pdf' }, batchId: 'b', nowIso: 'n' }),
    ];
    const fresh = filterNewVersions(rows, new Set([FW_CV]));
    assert.deepEqual(fresh.map((r) => r.content_version_id), ['068Vs00000CompAEAA']);
  });
  it('collapses in-batch duplicate content_version_ids', () => {
    const dup = mapDiscoveredFileToRow({ file: { linked_entity_type: 'Listing__c', linked_entity_id: FW_LISTING, content_version_id: FW_CV, extension: 'pdf' }, batchId: 'b', nowIso: 'n' });
    const fresh = filterNewVersions([dup, { ...dup }], new Set());
    assert.equal(fresh.length, 1);
  });
});

describe('file-content — size cap + sha256 decision', () => {
  it('accepts a well-formed file whose sha matches (or is absent)', () => {
    assert.equal(fileContentDecision({ sizeBytes: 6234567, maxBytes: 15 * 1024 * 1024, providedSha: 'abc', computedSha: 'abc' }).verdict, 'ok');
    assert.equal(fileContentDecision({ sizeBytes: 100, maxBytes: 15 * 1024 * 1024, providedSha: null, computedSha: 'anything' }).verdict, 'ok');
    // case-insensitive sha compare
    assert.equal(fileContentDecision({ sizeBytes: 100, maxBytes: 999, providedSha: 'ABC123', computedSha: 'abc123' }).verdict, 'ok');
  });
  it('rejects a sha256 mismatch (corrupt/wrong bytes never reach the extractor)', () => {
    assert.equal(fileContentDecision({ sizeBytes: 100, maxBytes: 999, providedSha: 'deadbeef', computedSha: 'cafef00d' }).verdict, 'sha_mismatch');
  });
  it('rejects an oversize file and an empty file', () => {
    assert.equal(fileContentDecision({ sizeBytes: 20 * 1024 * 1024, maxBytes: 15 * 1024 * 1024, computedSha: 'x' }).verdict, 'too_large');
    assert.equal(fileContentDecision({ sizeBytes: 0, maxBytes: 15 * 1024 * 1024, computedSha: 'x' }).verdict, 'empty');
  });
});
