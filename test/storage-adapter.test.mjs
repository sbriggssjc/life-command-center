import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  looksLikeSharepointRef,
  normalizeSharepointStorageRef,
  resolveArtifactDownload,
} from '../api/_shared/storage-adapter.js';

const ORIGINAL_LINK_URL = process.env.SHAREPOINT_LINK_URL;

describe('storage-adapter SharePoint references', () => {
  beforeEach(() => {
    process.env.SHAREPOINT_LINK_URL = 'https://example.test/pa-link';
  });

  afterEach(() => {
    if (ORIGINAL_LINK_URL === undefined) delete process.env.SHAREPOINT_LINK_URL;
    else process.env.SHAREPOINT_LINK_URL = ORIGINAL_LINK_URL;
  });

  it('recognizes server-relative and legacy SharePoint path shapes', () => {
    assert.equal(looksLikeSharepointRef('/sites/TeamBriggs20/Shared Documents/a.pdf'), true);
    assert.equal(looksLikeSharepointRef('sites/TeamBriggs20/Shared Documents/a.pdf'), true);
    assert.equal(looksLikeSharepointRef('Shared Documents/a.pdf'), true);
    assert.equal(looksLikeSharepointRef('lcc-om-uploads/2026-08-01/a.pdf'), false);
  });

  it('normalizes SharePoint paths before calling the PA sharing-link flow', async () => {
    const calls = [];
    const result = await resolveArtifactDownload({
      storageRef: 'Shared Documents/Storage OMs/Intake/a.pdf',
      fetchImpl: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return new Response(JSON.stringify({ ok: true, url: 'https://sharepoint.test/a.pdf' }), { status: 200 });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.signed_url, 'https://sharepoint.test/a.pdf');
    assert.equal(calls[0].url, 'https://example.test/pa-link');
    assert.equal(
      calls[0].body.server_relative_url,
      '/sites/TeamBriggs20/Shared Documents/Storage OMs/Intake/a.pdf',
    );
  });

  it('strips the host from full SharePoint URLs', () => {
    assert.equal(
      normalizeSharepointStorageRef('https://northmarq.sharepoint.com/sites/TeamBriggs20/Shared%20Documents/a.pdf'),
      '/sites/TeamBriggs20/Shared Documents/a.pdf',
    );
  });
});
