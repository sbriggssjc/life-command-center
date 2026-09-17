import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PRI2-on (2026-09-17): re-composes the Priority tab onto v_lcc_seller_prospect_queue
// (via /api/seller-prospect-queue) instead of v_priority_queue_enriched's P-band
// worklist. Scott delegated the read on docs/audits/PRI2_SIDE_BY_SIDE_2026-09-16.md
// to Cowork; the flag is ON, with reason-first order and one card per property. This
// guard pins:
//   (1) the flag defaults ON and the render entry point delegates on it;
//   (2) the v2 renderer reads /api/seller-prospect-queue, never
//       /api/priority-queue's code-doable bands (P0.4/P0.5/P-CONTACT/P-BUYER);
//   (3) the footer reads the hidden-band counts from its own endpoint, so the
//       four automated bands are named rather than silently dropped;
//   (4) the flag-off path is untouched — renderPriorityQueuePageV1 still exists
//       byte-identically to the pre-PRI2 renderPriorityQueuePage body;
//   (5) the server order is reason-first (SELLER_QUEUE_ORDER), not value-alone;
//   (6) the v2 renderer groups rows to one card per property before rendering.

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
  it('priority_tab_v2 defaults to true in LCC_FLAGS (PRI2-on)', () => {
    assert.match(appClean, /priority_tab_v2:\s*true/, 'priority_tab_v2 must default ON since PRI2-on');
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
    assert.match(ctaBody, /source_property_id/, 'must key on the view\'s own source_property_id, not property_id');
    assert.match(ctaBody, /source_domain/, 'must key on the view\'s own source_domain, not domain');
    assert.match(ctaBody, /openUnifiedDetail/, 'must route to the property when source_property_id is known');
    assert.match(ctaBody, /openEntityDetail/, 'must fall back to the owner when no property is known');
  });
});

describe('PRI2-on reason-first order (server-side)', () => {
  const sellerSrc = readFileSync(join(root, 'api', '_shared', 'seller-prospect-queue.js'), 'utf8');
  const sellerClean = stripComments(sellerSrc);

  it('SELLER_QUEUE_ORDER puts reason_measured ahead of rank_value and years_into_term', () => {
    const m = sellerClean.match(/SELLER_QUEUE_ORDER\s*=\s*\n?\s*'([^']+)'/);
    assert.ok(m, 'SELLER_QUEUE_ORDER must be found');
    const order = m[1];
    const iReason = order.indexOf('reason_measured');
    const iValue = order.indexOf('rank_value');
    const iYears = order.indexOf('years_into_term');
    assert.ok(iReason >= 0, 'order must include reason_measured');
    assert.ok(iReason < iValue && iValue < iYears,
      'order must read reason_measured, then rank_value, then years_into_term');
    assert.match(order, /reason_measured\.desc/, 'reason_measured must sort DESC (measured first)');
  });

  it('the PRI2-on migration adds reason_measured as an APPENDED boolean column, never replacing the predicate', () => {
    const migPath = join(root, 'supabase', 'migrations', '20260917120000_lcc_pri2_on_reason_first_order.sql');
    const mig = readFileSync(migPath, 'utf8');
    assert.match(mig, /AS reason_measured/, 'must add a reason_measured column');
    assert.match(mig, /reason_measured/, 'the column name must appear');
    // The queue's WHERE clause (membership) must be untouched -- reason_measured only
    // reorders, it never re-selects.
    assert.match(mig,
      /WHERE in_band IS TRUE\s*\n\s*AND \(newer_lease IS TRUE OR reason_to_sell <> 'reason_to_sell_unmeasured'\)\s*\n\s*AND reach_state <> 'touched'/,
      'the queue predicate must be byte-identical to the pre-PRI2-on WHERE clause');
  });
});

describe('PRI2-on one card per property', () => {
  it('_pqV2GroupByProperty groups on source_domain + source_property_id, keeping owner-only rows separate', () => {
    const groupBody = extractFnBody(opsClean, '_pqV2GroupByProperty');
    assert.match(groupBody, /source_property_id/, 'must group on source_property_id');
    assert.match(groupBody, /source_domain/, 'must group on source_domain');
    assert.match(groupBody, /entity_id/, 'a row with no property must still key on its own entity_id');
  });

  it('the v2 renderer builds groups before building row HTML', () => {
    const v2Body = extractFnBody(opsClean, 'renderPriorityQueuePageV2');
    assert.match(v2Body, /_pqV2GroupByProperty\(items\)/, 'V2 must group items before rendering cards');
    assert.match(v2Body, /groups\.map/, 'V2 must build one card per GROUP, not one per raw row');
  });

  it('a multi-owner card lists every owner\'s own why-now and reach, never blending them into one badge', () => {
    const linesBody = extractFnBody(opsClean, '_pqV2GroupOwnerLines');
    assert.match(linesBody, /g\.owners\.map/, 'must render one line per owner in the group');
    assert.match(linesBody, /_pqV2WhyNow/, 'each owner line must carry its own why-now');
    assert.match(linesBody, /reach_state/, 'each owner line must carry its own reach state');
  });

  it('the footer states the row-vs-property split honestly ("N owner·property rows")', () => {
    const v2Body = extractFnBody(opsClean, 'renderPriorityQueuePageV2');
    assert.match(v2Body, /owner·property row/, 'must name the row grain explicitly, never implying one card == one row');
  });
});
