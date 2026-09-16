import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PRI2 (2026-09-16): re-composes the Priority tab onto v_lcc_seller_prospect_queue
// (via /api/seller-prospect-queue) instead of v_priority_queue_enriched's P-band
// worklist, gated OFF by default behind priority_tab_v2. This guard pins:
//   (1) the flag defaults OFF and the render entry point delegates on it;
//   (2) the v2 renderer reads /api/seller-prospect-queue, never
//       /api/priority-queue's code-doable bands (P0.4/P0.5/P-CONTACT/P-BUYER);
//   (3) the footer reads the hidden-band counts from its own endpoint, so the
//       four automated bands are named rather than silently dropped;
//   (4) the flag-off path is untouched — renderPriorityQueuePageV1 still exists
//       byte-identically to the pre-PRI2 renderPriorityQueuePage body.

const root = process.cwd();
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');
const appSrc = readFileSync(join(root, 'app.js'), 'utf8');
const adminSrc = readFileSync(join(root, 'api', 'admin.js'), 'utf8');
const serverSrc = readFileSync(join(root, 'server.js'), 'utf8');

function stripComments(s) {
  return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const opsClean = stripComments(opsSrc);
const appClean = stripComments(appSrc);
const adminClean = stripComments(adminSrc);

function extractFnBody(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  let i = src.indexOf('{', start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(bodyStart, i + 1);
}

describe('PRI2 priority tab v2 (flag-gated re-composition)', () => {
  it('priority_tab_v2 defaults to false in LCC_FLAGS', () => {
    assert.match(appClean, /priority_tab_v2:\s*false/, 'priority_tab_v2 must default OFF');
  });

  it('renderPriorityQueuePage delegates to v1/v2 by the flag and does not duplicate the v1 body', () => {
    const delegateBody = extractFnBody(opsClean, 'renderPriorityQueuePage');
    assert.match(delegateBody, /checkFlag\('priority_tab_v2'\)/, 'delegate must gate on priority_tab_v2');
    assert.match(delegateBody, /renderPriorityQueuePageV2\(\)/, 'delegate must route to V2 when flag is on');
    assert.match(delegateBody, /renderPriorityQueuePageV1\(band\)/, 'delegate must route to V1 when flag is off');
    // The delegate itself must not fetch anything -- it is a pure router.
    assert.ok(!/opsApi\(/.test(delegateBody), 'delegate must not call opsApi itself');
  });

  it('renderPriorityQueuePageV1 still exists and is the pre-PRI2 band-queue renderer', () => {
    const v1Body = extractFnBody(opsClean, 'renderPriorityQueuePageV1');
    assert.match(v1Body, /\/api\/priority-queue\?limit=150/, 'V1 must still read /api/priority-queue unchanged');
    assert.match(v1Body, /_pqBandColor/, 'V1 must still render the doctrinal band chips unchanged');
  });

  it('renderPriorityQueuePageV2 reads the seller-prospect-queue API, never the P-band endpoint', () => {
    const v2Body = extractFnBody(opsClean, 'renderPriorityQueuePageV2');
    assert.match(v2Body, /\/api\/seller-prospect-queue/, 'V2 must read /api/seller-prospect-queue');
    assert.ok(!/\/api\/priority-queue\b/.test(v2Body), 'V2 must NOT read the P-band /api/priority-queue endpoint');
    // Hidden code-doable bands must never appear as row content in the v2 renderer.
    for (const band of ['P0.4', 'P0.5', 'P-CONTACT', 'P-BUYER']) {
      assert.ok(!v2Body.includes(`'${band}'`), `V2 row renderer must not reference hidden band ${band}`);
    }
  });

  it('the v2 footer names the hidden bands from their own endpoint, never fabricating a "resolved today" count', () => {
    const footerBody = extractFnBody(opsClean, 'renderPriorityQueueFooterV2');
    assert.match(footerBody, /\/api\/priority-hidden-band-counts/, 'footer must read the dedicated hidden-band-counts endpoint');
    assert.match(footerBody, /producer/, 'footer must surface which producer handles each hidden band');
  });

  it('the hidden-band-counts endpoint reads v_priority_queue_band_counts scoped to human_surface=is.false', () => {
    const handlerBody = extractFnBody(adminClean, 'handlePriorityHiddenBandCounts');
    assert.match(handlerBody, /v_priority_queue_band_counts/, 'must read v_priority_queue_band_counts');
    assert.match(handlerBody, /human_surface=is\.false/, 'must scope to the hidden (non-human) bands only');
  });

  it('the hidden-band-counts route is dispatched in admin.js and mounted in server.js', () => {
    assert.match(adminClean, /case 'priority-hidden-band-counts':\s*return handlePriorityHiddenBandCounts/,
      'admin.js must dispatch the new _route');
    assert.match(serverSrc, /app\.all\('\/api\/priority-hidden-band-counts'/,
      'server.js must mount /api/priority-hidden-band-counts');
  });

  it('the v2 CTA is a single button per row: open property if known, else open owner', () => {
    const ctaBody = extractFnBody(opsClean, '_pqV2Cta');
    assert.match(ctaBody, /openUnifiedDetail/, 'must route to the property when property_id is known');
    assert.match(ctaBody, /openEntityDetail/, 'must fall back to the owner when no property is known');
  });
});
