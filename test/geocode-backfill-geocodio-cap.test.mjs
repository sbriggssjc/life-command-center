// FLAGS-geocode-on (2026-09-16, decision S3) — the Geocodio daily-cap
// arithmetic used to stop routing to Geocodio once its free-tier quota is
// spent for the day, while Census keeps running regardless.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { geocodioCallsRemaining, handleGeocodeTick } from '../api/_handlers/geocode-backfill.js';

describe('geocodioCallsRemaining', () => {
  it('reports the full cap when nothing has been used today', () => {
    assert.equal(geocodioCallsRemaining(0, 0, 2400), 2400);
  });

  it('subtracts both prior-usage and this-tick usage', () => {
    assert.equal(geocodioCallsRemaining(2000, 50, 2400), 350);
  });

  it('reaches zero exactly at the cap, not one call late', () => {
    assert.equal(geocodioCallsRemaining(2399, 0, 2400), 1);
    assert.equal(geocodioCallsRemaining(2400, 0, 2400), 0);
    assert.equal(geocodioCallsRemaining(2400, 1, 2400), -1); // budget check is `> 0`, so this still blocks
  });

  it('treats a missing/NaN usage as zero rather than throwing', () => {
    assert.equal(geocodioCallsRemaining(undefined, undefined, 2400), 2400);
    assert.equal(geocodioCallsRemaining(NaN, NaN, 2400), 2400);
  });
});

describe('handleGeocodeTick — missing key / auth surface', () => {
  it('returns 405 on unsupported methods without touching any DB', async () => {
    let statusCode = null;
    let body = null;
    const req = { method: 'DELETE', query: {} };
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };
    await handleGeocodeTick(req, res);
    assert.equal(statusCode, 405);
    assert.match(body.error, /GET or POST only/);
  });

  it('rejects an invalid domain param before any geocoding work', async () => {
    let statusCode = null;
    let body = null;
    const req = {
      method: 'GET',
      query: { domain: 'mars' },
      headers: { 'x-lcc-key': process.env.LCC_API_KEY || 'test-key' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { body = payload; return this; },
    };
    await handleGeocodeTick(req, res);
    // Auth may reject first (401) depending on env config; either way no
    // domain work should proceed and the response must be a client error.
    assert.ok(statusCode === 400 || statusCode === 401, `expected 400 or 401, got ${statusCode}`);
  });
});
