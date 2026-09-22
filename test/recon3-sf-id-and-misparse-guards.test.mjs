// RECON3 (2026-09-22, property_id 27266 — 175 Righter Rd, Succasunna NJ,
// DaVita, Dialysis_DB) — regression coverage for:
//   1. Never write a raw Salesforce record id as a name (buyer_name/
//      seller_name/recorded_owners.name/canonical_name).
//   3. current_value_estimate prefers a closed sale over a stale estimate.
//   4. Lease tenant sidebar misparse (a listing description sentence
//      leaking into leases.tenant).
//   6. The Asset Profile export gates on a closed sale.
//
// Follows the house pattern (see test/b6cdup-sale-store-canonical.test.mjs,
// test/detail-tab-registry.test.mjs): browser-side detail.js is a classic
// script (no module exports), so its logic is extracted by brace-matching
// and evaluated in a stubbed sandbox rather than imported as ESM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. api/_shared/sf-account-name-resolver.js ──────────────────────────────
import {
  looksLikeRawSalesforceId,
  looksLikeRawSalesforceAccountId,
  resolveSfIdToLccName,
  guardNameField,
} from '../api/_shared/sf-account-name-resolver.js';

const REAL_ACCOUNT_ID_18 = '001A000001abcDEIAY';
const REAL_CONTACT_ID_18 = '003A000001abcDEIAY';

describe('sf-account-name-resolver: shape detection', () => {
  it('flags an 18-char Salesforce Account id', () => {
    assert.equal(looksLikeRawSalesforceId(REAL_ACCOUNT_ID_18), true);
    assert.equal(looksLikeRawSalesforceAccountId(REAL_ACCOUNT_ID_18), true);
  });

  it('does not flag a Contact id as an Account id, but does flag it as an SF id', () => {
    assert.equal(looksLikeRawSalesforceAccountId(REAL_CONTACT_ID_18), false);
    assert.equal(looksLikeRawSalesforceId(REAL_CONTACT_ID_18), true);
  });

  it('never flags a real company/person name', () => {
    assert.equal(looksLikeRawSalesforceId('Fresenius Medical Care'), false);
    assert.equal(looksLikeRawSalesforceId('DaVita Kidney Care'), false);
    assert.equal(looksLikeRawSalesforceId(''), false);
    assert.equal(looksLikeRawSalesforceId(null), false);
    assert.equal(looksLikeRawSalesforceId(undefined), false);
  });

  it('handles the 15-char (case-sensitive) id form too', () => {
    assert.equal(looksLikeRawSalesforceId(REAL_ACCOUNT_ID_18.slice(0, 15)), true);
  });
});

describe('sf-account-name-resolver: resolution + write-time guard', () => {
  it('resolves via the external_identities -> entities join (injected query)', async () => {
    const calls = [];
    const stubQuery = async (method, path) => {
      calls.push(path);
      if (path.startsWith('external_identities')) {
        return { ok: true, data: [{ entity_id: 'e1' }] };
      }
      if (path.startsWith('entities')) {
        return { ok: true, data: [{ id: 'e1', name: 'Acme Capital Partners LLC' }] };
      }
      return { ok: false, data: null };
    };
    const name = await resolveSfIdToLccName(REAL_ACCOUNT_ID_18, { query: stubQuery, enc: (x) => x });
    assert.equal(name, 'Acme Capital Partners LLC');
    assert.ok(calls.some((p) => p.startsWith('external_identities')));
    assert.ok(calls.some((p) => p.startsWith('entities')));
  });

  it('returns null (never fabricates) when LCC has never seen the id', async () => {
    const stubQuery = async () => ({ ok: true, data: [] });
    const name = await resolveSfIdToLccName(REAL_ACCOUNT_ID_18, { query: stubQuery, enc: (x) => x });
    assert.equal(name, null);
  });

  it('guardNameField passes through a real name unchanged', async () => {
    const r = await guardNameField('Fresenius Medical Care', { query: async () => ({ ok: true, data: [] }) });
    assert.deepEqual(r, { value: 'Fresenius Medical Care', raw: false, resolved: false });
  });

  it('guardNameField resolves a raw id when LCC knows it', async () => {
    const stubQuery = async (method, path) => {
      if (path.startsWith('external_identities')) return { ok: true, data: [{ entity_id: 'e1' }] };
      if (path.startsWith('entities')) return { ok: true, data: [{ id: 'e1', name: 'Real Owner LLC' }] };
      return { ok: false, data: null };
    };
    const r = await guardNameField(REAL_ACCOUNT_ID_18, { query: stubQuery, enc: (x) => x });
    assert.equal(r.raw, true);
    assert.equal(r.resolved, true);
    assert.equal(r.value, 'Real Owner LLC');
  });

  it('guardNameField drops (never writes) an unresolvable raw id', async () => {
    const stubQuery = async () => ({ ok: true, data: [] });
    const r = await guardNameField(REAL_ACCOUNT_ID_18, { query: stubQuery, enc: (x) => x });
    assert.equal(r.raw, true);
    assert.equal(r.resolved, false);
    assert.equal(r.value, null, 'must never write the opaque id as a name');
  });
});

// ── entity-link.js: ensureEntityLink choke-point is wired to the guard ─────
describe('entity-link.js wiring', () => {
  const src = readFileSync(join(ROOT, 'api/_shared/entity-link.js'), 'utf8');
  it('imports the sf-account-name-resolver guard', () => {
    assert.match(src, /from '\.\/sf-account-name-resolver\.js'/);
  });
  it('checks seedFields.name against looksLikeRawSalesforceId before building candidateName', () => {
    assert.match(src, /looksLikeRawSalesforceId\(seedFields\.name\)/);
  });
});

// ── 1 (synchronous half) + 4. api/_handlers/sidebar-pipeline.js ────────────
const sidebarPipeline = await import('../api/_handlers/sidebar-pipeline.js');

describe('sidebar-pipeline: raw Salesforce id never lands in buyer_name/seller_name', () => {
  it('isJunkSalesParty rejects an 18-char Account id', () => {
    assert.equal(sidebarPipeline.isJunkSalesParty(REAL_ACCOUNT_ID_18), true);
  });
  it('isJunkSalesParty rejects a 15-char id too', () => {
    assert.equal(sidebarPipeline.isJunkSalesParty(REAL_ACCOUNT_ID_18.slice(0, 15)), true);
  });
  it('isJunkSalesParty does not reject a real buyer/seller name', () => {
    assert.equal(sidebarPipeline.isJunkSalesParty('Fresenius Medical Care'), false);
    assert.equal(sidebarPipeline.isJunkSalesParty('John Smith'), false);
  });
  it('cleanSalesPartyValue strips a raw SF id to null instead of writing it', () => {
    assert.equal(sidebarPipeline.cleanSalesPartyValue(REAL_ACCOUNT_ID_18), null);
  });
});

describe('sidebar-pipeline: lease tenant listing-description-sentence guard', () => {
  it('flags the exact RECON3 misparse ("DaVita dialysis clinic in Succasunna")', () => {
    assert.equal(sidebarPipeline.isListingDescriptionSentence('DaVita dialysis clinic in Succasunna'), true);
    assert.equal(sidebarPipeline.isJunkTenant('DaVita dialysis clinic in Succasunna'), true);
  });
  it('flags a similarly-shaped sentence for a different operator', () => {
    assert.equal(sidebarPipeline.isListingDescriptionSentence('Fresenius clinic located in Denton'), true);
  });
  it('never flags a real, clean tenant/operator name', () => {
    assert.equal(sidebarPipeline.isJunkTenant('DaVita Kidney Care'), false);
    assert.equal(sidebarPipeline.isJunkTenant('Fresenius Medical Care'), false);
    assert.equal(sidebarPipeline.isJunkTenant('U.S. Renal Care'), false);
  });
  it('catches a long, clearly-descriptive sentence via the word-count fallback', () => {
    assert.equal(
      sidebarPipeline.isListingDescriptionSentence('This is a single-tenant dialysis facility located in a growing suburban market'),
      true
    );
  });
});

describe('sidebar-pipeline: the single-tenant fallback branch now guards junk tenants', () => {
  const src = readFileSync(join(ROOT, 'api/_handlers/sidebar-pipeline.js'), 'utf8');
  it('upsertDomainLeases fallback branch calls isJunkTenant on the top-level tenant name', () => {
    // Anchor on the fallback comment + the guard call together, so this fails
    // if the call is ever removed without touching the surrounding prose.
    const fallbackIdx = src.indexOf("// Fallback: single lease from top-level metadata fields");
    assert.ok(fallbackIdx >= 0, 'fallback branch marker not found');
    const window = src.slice(fallbackIdx, fallbackIdx + 800);
    assert.match(window, /isJunkTenant\(tenantName\)/);
  });
});

// ── 3. reconcilePropertyOwnership: overwrite a stale current_value_estimate ─
describe('sidebar-pipeline: reconcilePropertyOwnership prefers a closed sale over a stale estimate', () => {
  const src = readFileSync(join(ROOT, 'api/_handlers/sidebar-pipeline.js'), 'utf8');
  it('no longer gates strictly on "field is empty"', () => {
    assert.doesNotMatch(
      src,
      /if \(latestPrice && !prop\.current_value_estimate\) \{\s*\n\s*patch\.current_value_estimate = latestPrice;\s*\n\s*\}/,
      'the old fill-blanks-only guard must be gone'
    );
  });
  it('does not gate the overwrite on properties.updated_at (RECON3-b: updated_at is not a per-field stamp)', () => {
    // RECON3's first attempt gated on `saleIsOlder` derived from
    // properties.updated_at, which is touched by every writer that ever
    // saves the row (not just value-estimate writes) — live-verified to
    // silently refuse the fix on the exact property it was written for.
    assert.doesNotMatch(src, /saleIsOlder/);
  });
  it('unconditionally overwrites when the price differs (a closed sale always beats a modeled estimate)', () => {
    assert.match(src, /priceDiffers/);
    assert.match(
      src,
      /if \(!prop\.current_value_estimate \|\| priceDiffers\)/
    );
  });
});

// ── 6. detail.js: _udDetectClosedSale + export gate ─────────────────────────
describe('detail.js: _udDetectClosedSale + SOLD export gate', () => {
  const detailSrc = readFileSync(join(ROOT, 'detail.js'), 'utf8');

  function functionBody(name) {
    const m = detailSrc.match(new RegExp(`function\\s+${name}\\s*\\(`));
    assert.ok(m, `${name} not found in detail.js`);
    const start = m.index;
    const open = detailSrc.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < detailSrc.length; i++) {
      if (detailSrc[i] === '{') depth++;
      else if (detailSrc[i] === '}') {
        depth--;
        if (depth === 0) return detailSrc.slice(start, i + 1);
      }
    }
    throw new Error(`unbalanced braces extracting ${name}`);
  }

  it('_udDetectClosedSale exists and reads _salesCache + _udCache', () => {
    const body = functionBody('_udDetectClosedSale');
    assert.match(body, /_salesCache/);
    assert.match(body, /_udCache/);
  });

  it('detects a raw Salesforce Account id in buyer_name and marks it pending, not written', () => {
    const body = functionBody('_udDetectClosedSale');
    // Evaluate the extracted function against a stubbed global scope.
    const fn = new Function(
      '_udCache', '_salesCache',
      `${body}\nreturn _udDetectClosedSale();`
    );
    const result = fn(
      { ids: { property_id: 27266 } },
      {
        property_id: 27266,
        transactions: [
          { sale_date: '2026-06-01', price: 4200000, buyer_name: '001A000001abcDEIAY' },
        ],
      }
    );
    assert.ok(result, 'expected a closed sale to be detected');
    assert.equal(result.sale_date, '2026-06-01');
    assert.equal(result.price, 4200000);
    assert.equal(result.buyer_name, null, 'must not surface the raw SF id as a buyer name');
    assert.equal(result.buyer_pending, true);
  });

  it('returns a real buyer name unchanged when it is not id-shaped', () => {
    const body = functionBody('_udDetectClosedSale');
    const fn = new Function(
      '_udCache', '_salesCache',
      `${body}\nreturn _udDetectClosedSale();`
    );
    const result = fn(
      { ids: { property_id: 27266 } },
      { property_id: 27266, transactions: [{ sale_date: '2026-06-01', price: 100, buyer_name: 'Acme LLC' }] }
    );
    assert.equal(result.buyer_name, 'Acme LLC');
    assert.equal(result.buyer_pending, false);
  });

  it('returns null when the Sales tab has never loaded for this property (best-effort, non-blocking)', () => {
    const body = functionBody('_udDetectClosedSale');
    const fn = new Function(
      '_udCache', '_salesCache',
      `${body}\nreturn _udDetectClosedSale();`
    );
    assert.equal(fn({ ids: { property_id: 27266 } }, null), null);
    assert.equal(fn({ ids: { property_id: 27266 } }, { property_id: 999, transactions: [] }), null);
  });

  it('returns null when no transaction carries both a date and a price', () => {
    const body = functionBody('_udDetectClosedSale');
    const fn = new Function(
      '_udCache', '_salesCache',
      `${body}\nreturn _udDetectClosedSale();`
    );
    assert.equal(
      fn({ ids: { property_id: 27266 } }, { property_id: 27266, transactions: [{ sale_date: null, price: 100 }] }),
      null
    );
  });

  it('_udExportOperations gates riskScores on soldInfo and injects a SOLD banner', () => {
    // Anchor on the wiring, not the whole export function (which is ~470
    // lines and reads dozens of other caches) — the block-slice footgun
    // this repo warns about repeatedly.
    assert.match(detailSrc, /const soldInfo = _udDetectClosedSale\(\);/);
    assert.match(detailSrc, /if \(!soldInfo\) \{\s*\n\s*try \{\s*\n\s*if \(typeof _computeLeaseRisk/);
    assert.match(detailSrc, /let soldBannerHtml = '';/);
    assert.match(detailSrc, /if \(soldInfo\) \{/);
    assert.match(detailSrc, /\$\{soldBannerHtml\}/);
  });
});
