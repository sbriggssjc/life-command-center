// ============================================================================
// sf-file-discovery.test.mjs — W3.7b: server-side SF file-discovery helpers
//
// Proves the pure discovery logic that extends the sweep past Comp__c to
// Listing__c + Deal (Opportunity). Fort Wayne (VA, gov comp id=11) is the
// acceptance case: its OM is attached to the LISTING a0jVs000005AqaLIAS, so a
// listing-attached ContentVersion must map to an sf_files row whose sf_listing_id
// points back to that listing (the om-comp-resolver traversal key).
// ============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_OBJECTS, traversalColumnForType, sanitizeSfId,
  buildContentDocumentLinkSoql, buildContentVersionSoql, versionDataPath,
  isDiscoverableExtension, mapVersionToFileRow, filterNewVersions, linkedTypeFromCdl, chunk,
} from '../supabase/functions/intake-salesforce-files/discovery.ts';

// Fort Wayne's REAL Salesforce ids (from gov.sf_comp_staging, live).
const FW_LISTING = 'a0jVs000005AqaLIAS';
const FW_DEAL = '006Vs00000MV4aYIAT';
const FW_COMP = 'a1YVs000002BnvVMAS';

describe('DISCOVERY_OBJECTS + traversalColumnForType', () => {
  it('sweeps comp, listing, and deal', () => {
    assert.deepEqual(DISCOVERY_OBJECTS.map((o) => o.key).sort(), ['comp', 'deal', 'listing']);
  });
  it('maps each SObject type to its traversal column', () => {
    assert.equal(traversalColumnForType('Comp__c'), 'sf_comp_id');
    assert.equal(traversalColumnForType('Listing__c'), 'sf_listing_id');
    assert.equal(traversalColumnForType('Opportunity'), 'sf_deal_id');
  });
  it('tolerates the logical key and rejects unknown types', () => {
    assert.equal(traversalColumnForType('listing'), 'sf_listing_id');
    assert.equal(traversalColumnForType('Account'), null);
    assert.equal(traversalColumnForType(''), null);
  });
});

describe('sanitizeSfId', () => {
  it('accepts 15/18-char SF ids, rejects junk', () => {
    assert.equal(sanitizeSfId(FW_LISTING), FW_LISTING);
    assert.equal(sanitizeSfId('a0jVs000005AqaL'), 'a0jVs000005AqaL'); // 15-char
    assert.equal(sanitizeSfId("x' OR 1=1--"), null);
    assert.equal(sanitizeSfId(null), null);
    assert.equal(sanitizeSfId('short'), null);
  });
});

describe('SOQL builders', () => {
  it('CDL SOQL bounds the query by LinkedEntityId and drops junk ids', () => {
    const soql = buildContentDocumentLinkSoql([FW_LISTING, FW_DEAL, "junk';drop"]);
    assert.match(soql, /FROM ContentDocumentLink/);
    assert.match(soql, /LinkedEntity\.Type/);
    assert.ok(soql.includes(`'${FW_LISTING}'`));
    assert.ok(soql.includes(`'${FW_DEAL}'`));
    assert.ok(!soql.includes('drop'), 'malformed id filtered out');
  });
  it('ContentVersion SOQL selects the latest version per document', () => {
    const soql = buildContentVersionSoql(['069Vs000001aBcDEAA']);
    assert.match(soql, /FROM ContentVersion/);
    assert.match(soql, /IsLatest = true/);
    assert.match(soql, /VersionData|ContentSize/);
  });
  it('versionDataPath points at the ContentVersion blob', () => {
    assert.equal(versionDataPath('068Vs00000abcdEAA', 'v60.0'),
      '/services/data/v60.0/sobjects/ContentVersion/068Vs00000abcdEAA/VersionData');
  });
});

describe('isDiscoverableExtension', () => {
  it('keeps document types, drops images/thumbnails', () => {
    assert.equal(isDiscoverableExtension('pdf'), true);
    assert.equal(isDiscoverableExtension('.PDF'), true);
    assert.equal(isDiscoverableExtension('docx'), true);
    assert.equal(isDiscoverableExtension('xlsx'), true);
    assert.equal(isDiscoverableExtension('png'), false);
    assert.equal(isDiscoverableExtension('jpg'), false);
    assert.equal(isDiscoverableExtension(null), false);
  });
});

describe('mapVersionToFileRow — Fort Wayne LISTING attachment', () => {
  const cv = {
    Id: '068Vs00000FortWEAA', ContentDocumentId: '069Vs00000FortWEAA',
    Title: 'US Department of Veterans Affairs - Fort Wayne - IN - OM',
    FileExtension: 'pdf', PathOnClient: 'Fort Wayne VA OM.pdf',
    VersionNumber: '1', ContentSize: 6234567, Checksum: 'abc123',
  };
  const row = mapVersionToFileRow({
    cv, linkedEntityType: 'Listing__c', linkedEntityId: FW_LISTING,
    batchId: 'discover-test', nowIso: '2026-07-30T00:00:00.000Z', apiVersion: 'v60.0',
  });
  it('records SF file identity + discovered status', () => {
    assert.equal(row.content_version_id, '068Vs00000FortWEAA');
    assert.equal(row.content_document_id, '069Vs00000FortWEAA');
    assert.equal(row.ingestion_status, 'discovered');
    assert.equal(row.extraction_status, 'pending');
    assert.equal(row.extension, 'pdf');
    assert.equal(row.size_bytes, 6234567);
    assert.equal(row.source_system, 'salesforce');
  });
  it('stamps linked_entity + the sf_listing_id traversal column', () => {
    assert.equal(row.linked_entity_type, 'Listing__c');
    assert.equal(row.linked_entity_sf_id, FW_LISTING);
    assert.equal(row.sf_listing_id, FW_LISTING, 'traversal column set to the listing id');
    assert.equal(row.sf_comp_id, undefined);
    assert.equal(row.sf_deal_id, undefined);
    assert.equal(row.sf_download_url, versionDataPath('068Vs00000FortWEAA', 'v60.0'));
  });
  it('deal attachments stamp sf_deal_id', () => {
    const d = mapVersionToFileRow({
      cv: { Id: '068Vs00000DealAEAA', ContentDocumentId: '069Vs00000DealAEAA', FileExtension: 'pdf' },
      linkedEntityType: 'Opportunity', linkedEntityId: FW_DEAL,
      batchId: 'b', nowIso: 'now',
    });
    assert.equal(d.sf_deal_id, FW_DEAL);
    assert.equal(d.linked_entity_type, 'Opportunity');
  });
});

describe('filterNewVersions — dedup on content_version_id', () => {
  const rows = [
    { content_version_id: 'CV1' }, { content_version_id: 'CV2' }, { content_version_id: 'CV1' },
  ];
  it('drops rows whose content_version_id already exists', () => {
    const fresh = filterNewVersions(rows, new Set(['CV2']));
    assert.deepEqual(fresh.map((r) => r.content_version_id), ['CV1']);
  });
  it('drops in-batch duplicates and accepts an array of existing ids', () => {
    const fresh = filterNewVersions(rows, ['CV9']);
    assert.deepEqual(fresh.map((r) => r.content_version_id), ['CV1', 'CV2']);
  });
});

describe('linkedTypeFromCdl + chunk', () => {
  it('reads LinkedEntity.Type from a ContentDocumentLink row', () => {
    assert.equal(linkedTypeFromCdl({ LinkedEntity: { Type: 'Listing__c' } }), 'Listing__c');
    assert.equal(linkedTypeFromCdl({ LinkedEntity: null }), null);
    assert.equal(linkedTypeFromCdl({}), null);
  });
  it('chunks id lists for SOQL IN() limits', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 3), []);
  });
});
