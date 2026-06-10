// Phase 2 Slice 2b — property → SharePoint folder resolver.
//
// Resolution doctrine: KNOWN path (parent of a PROPERTIES-resident
// property_documents.source_url) → DERIVED-and-verified fallback → REFUSE.
// No guessed writes into the wrong property folder.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketOf,
  deriveFolderCandidates,
  parentOfPropertiesUrl,
  resolvePropertyFolder,
} from '../api/_shared/property-folder-resolver.js';

const ROOT = '/sites/TeamBriggs20/Shared Documents/PROPERTIES';

describe('bucketOf', () => {
  it('uppercases a leading letter', () => {
    assert.equal(bucketOf('DaVita Dialysis'), 'D');
    assert.equal(bucketOf('elliott bay'), 'E');
  });
  it('keeps a leading digit as the bucket', () => {
    assert.equal(bucketOf('3M Facility'), '3');
  });
  it('skips leading non-alnum to the first alnum char', () => {
    assert.equal(bucketOf('  "Acme" LLC'), 'A');
  });
  it('returns null when there is no alnum char', () => {
    assert.equal(bucketOf('---'), null);
    assert.equal(bucketOf(''), null);
  });
});

describe('parentOfPropertiesUrl (KNOWN path)', () => {
  it('takes the parent dir of a file under PROPERTIES', () => {
    assert.equal(
      parentOfPropertiesUrl(`${ROOT}/D/DaVita/Chilton, WI/DaVita Chilton OM.pdf`),
      `${ROOT}/D/DaVita/Chilton, WI`
    );
  });
  it('handles the PROPERTIES root itself as a parent', () => {
    assert.equal(parentOfPropertiesUrl(`${ROOT}/file.pdf`), ROOT);
  });
  it('normalizes backslash paths', () => {
    assert.equal(
      parentOfPropertiesUrl(`${ROOT}\\D\\DaVita\\Chilton, WI\\x.pdf`.replace(/\//g, '\\')),
      `${ROOT}/D/DaVita/Chilton, WI`
    );
  });
  it('refuses a source_url NOT under PROPERTIES (never a write target)', () => {
    assert.equal(parentOfPropertiesUrl("/sites/TeamBriggs20/Shared Documents/Storage OM's/Intake/x.pdf"), null);
    assert.equal(parentOfPropertiesUrl('https://www.crexi.com/properties/123/listing'), null);
    assert.equal(parentOfPropertiesUrl(''), null);
    assert.equal(parentOfPropertiesUrl(null), null);
  });
});

describe('deriveFolderCandidates (DERIVED fallback)', () => {
  it('builds City,ST first then the tenant folder', () => {
    assert.deepEqual(
      deriveFolderCandidates({ tenant: 'DaVita', city: 'Chilton', state: 'WI', root: ROOT }),
      [`${ROOT}/D/DaVita/Chilton, WI`, `${ROOT}/D/DaVita`],
    );
  });
  it('falls back to tenant-only when city/state are missing', () => {
    assert.deepEqual(
      deriveFolderCandidates({ tenant: 'DaVita', root: ROOT }),
      [`${ROOT}/D/DaVita`],
    );
  });
  it('returns nothing without a tenant/brand (can not derive)', () => {
    assert.deepEqual(deriveFolderCandidates({ city: 'Chilton', state: 'WI', root: ROOT }), []);
  });
});

describe('resolvePropertyFolder', () => {
  it('resolves via the KNOWN property_documents.source_url parent', async () => {
    const domainQueryImpl = async (_domain, _method, path) => {
      if (path.startsWith('property_documents')) {
        return { ok: true, data: [{ source_url: `${ROOT}/D/DaVita/Chilton, WI/OM.pdf` }] };
      }
      throw new Error('properties should not be queried once a known doc resolves');
    };
    const r = await resolvePropertyFolder(
      { domain: 'dialysis', propertyId: 29841 },
      { domainQueryImpl, folderExistsImpl: async () => true },
    );
    assert.equal(r.ok, true);
    assert.equal(r.folder_path, `${ROOT}/D/DaVita/Chilton, WI`);
    assert.equal(r.source, 'known_property_document');
  });

  it('falls back to a DERIVED folder only when it is verified to exist', async () => {
    const domainQueryImpl = async (_domain, _method, path) => {
      if (path.startsWith('property_documents')) return { ok: true, data: [] }; // no known doc
      if (path.startsWith('properties')) return { ok: true, data: [{ tenant: 'DaVita', city: 'Chilton', state: 'WI' }] };
      return { ok: false, data: null };
    };
    const seen = [];
    const folderExistsImpl = async (p) => { seen.push(p); return p === `${ROOT}/D/DaVita/Chilton, WI`; };
    const r = await resolvePropertyFolder(
      { domain: 'dialysis', propertyId: 1 },
      { domainQueryImpl, folderExistsImpl, root: ROOT },
    );
    assert.equal(r.ok, true);
    assert.equal(r.folder_path, `${ROOT}/D/DaVita/Chilton, WI`);
    assert.equal(r.source, 'derived_verified');
    assert.ok(seen.includes(`${ROOT}/D/DaVita/Chilton, WI`));
  });

  it('REFUSES when no known doc and the derived folder does not exist', async () => {
    const domainQueryImpl = async (_domain, _method, path) => {
      if (path.startsWith('property_documents')) return { ok: true, data: [] };
      if (path.startsWith('properties')) return { ok: true, data: [{ tenant: 'DaVita', city: 'Chilton', state: 'WI' }] };
      return { ok: false, data: null };
    };
    const r = await resolvePropertyFolder(
      { domain: 'dialysis', propertyId: 1 },
      { domainQueryImpl, folderExistsImpl: async () => false, root: ROOT },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'folder_unresolved');
  });

  it('REFUSES when the property has no tenant to derive from', async () => {
    const domainQueryImpl = async (_domain, _method, path) => {
      if (path.startsWith('property_documents')) return { ok: true, data: [] };
      if (path.startsWith('properties')) return { ok: true, data: [{ tenant: null, city: 'Chilton', state: 'WI' }] };
      return { ok: false, data: null };
    };
    const r = await resolvePropertyFolder(
      { domain: 'government', propertyId: 7 },
      { domainQueryImpl, folderExistsImpl: async () => true, root: ROOT },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'folder_unresolved');
  });

  it('refuses on missing inputs without touching the DB', async () => {
    let called = false;
    const domainQueryImpl = async () => { called = true; return { ok: true, data: [] }; };
    const r = await resolvePropertyFolder({ domain: null, propertyId: null }, { domainQueryImpl });
    assert.equal(r.ok, false);
    assert.equal(called, false);
  });
});
