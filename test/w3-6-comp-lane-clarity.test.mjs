// W3.6 fix 2 — comp-review lane clarity.
//  • computeReviewSignals records the INPUTS behind each cap (implied_basis /
//    reliable_basis: value + source + as-of) so the reviewer sees which number
//    is stale.
//  • The card names the exact action ("Mark resolved — I corrected the data at
//    source" / "Dismiss — not a real problem"), deep-links to the property,
//    shows both cap bases, and offers Reopen on a resolved row.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeReviewSignals } from '../mcp/comps-tools.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  const parenOpen = src.indexOf('(', start);
  let pdepth = 0, paramEnd = -1;
  for (let i = parenOpen; i < src.length; i++) {
    if (src[i] === '(') pdepth++;
    else if (src[i] === ')') { pdepth--; if (pdepth === 0) { paramEnd = i; break; } }
  }
  const braceStart = src.indexOf('{', paramEnd);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${marker}`);
  return src.slice(start, end);
}

describe('W3.6 fix 2 — computeReviewSignals records the cap inputs', () => {
  it('gov cap_mismatch: implied_basis carries the stale NOI value + source + as-of', () => {
    // The live 70 Commercial St row: NOI 186,053.78 (estimated_comp_ratio @2026-03-31)
    // vs the ingested 3.71% reliable cap.
    const sig = computeReviewSignals({
      is_government: true, sale_price: 8800000,
      noi: 186053.78, noi_source: 'estimated_comp_ratio', noi_as_of_date: '2026-03-31',
      annual_rent: 264898.88, raw: { sold_cap_rate: 0.0371 },
    });
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    const b = sig.review_detail.implied_basis;
    assert.equal(b.kind, 'NOI');
    assert.ok(Math.abs(b.value - 186053.78) < 1e-6);
    assert.equal(b.source, 'estimated_comp_ratio');
    assert.equal(b.as_of, '2026-03-31');
    assert.equal(sig.review_detail.reliable_basis.source, 'ingested sale cap (sold_cap_rate)');
  });
  it('dia implied_basis is RENT-kind with cap_rate_final reliable source', () => {
    const sig = computeReviewSignals({
      is_government: false, sale_price: 4776704, annual_rent: 210000,
      raw: { cap_rate_final: 0.07 },
    });
    assert.ok(sig && sig.review_flags.includes('cap_mismatch'));
    assert.equal(sig.review_detail.implied_basis.kind, 'RENT');
    assert.equal(sig.review_detail.reliable_basis.source, 'cap_rate_final');
  });
});

describe('W3.6 fix 2 — compReviewCardHtml render', () => {
  let card;
  before(() => {
    const caps = sliceFn(opsSrc, 'function compReviewCapsHtml(');
    const cardFn = sliceFn(opsSrc, 'function compReviewCardHtml(');
    card = new Function(`
      function esc(s){ return s == null ? '' : String(s); }
      function openUnifiedDetail(){}
      var _compReviewPct = function (v){ return v == null ? '-' : (Number(v)*100).toFixed(2) + '%'; };
      var _compReviewUsd = function (v){ return v == null ? '-' : '$' + Number(v).toLocaleString(); };
      ${caps}
      ${cardFn}
      return compReviewCardHtml;
    `)();
  });

  it('open row: names the exact actions, deep-links property, shows both cap inputs', () => {
    const html = card({
      domain: 'gov', id: 1, property_id: 9388, tenant: 'Office (FWS)',
      address: '70 Commercial St', city: 'Concord', state: 'NH',
      sale_date: '2026-06-23', sale_price: 8800000, flags: ['cap_mismatch'],
      implied_cap: 0.021142, reliable_cap: 0.0371, status: 'open',
      detail: { implied_basis: { value: 186053.78, kind: 'NOI', source: 'estimated_comp_ratio', as_of: '2026-03-31' },
                reliable_basis: { value: 0.0371, source: 'ingested sale cap (sold_cap_rate)' } },
    }, true);
    assert.match(html, /Mark resolved — I corrected the data at source/);
    assert.match(html, /Dismiss — not a real problem/);
    assert.match(html, /openUnifiedDetail\('gov', \{property_id: 9388\}/);
    assert.match(html, /Open property/);
    // implied cap basis: NOI value + source + as-of
    assert.match(html, /NOI \$186,054/);
    assert.match(html, /estimated_comp_ratio/);
    assert.match(html, /as of 2026-03-31/);
    // reliable basis + the NOI it implies (so the gap is visible)
    assert.match(html, /ingested sale cap/);
    assert.match(html, /implies NOI \$326,480/);
    assert.doesNotMatch(html, /Reopen/);
  });

  it('resolved row: shows Reopen (un-resolve) instead of the resolve actions', () => {
    const html = card({
      domain: 'gov', id: 1, property_id: 9388, address: '70 Commercial St',
      sale_price: 8800000, implied_cap: 0.021142, reliable_cap: 0.0371,
      flags: ['cap_mismatch'], status: 'resolved', detail: {},
    }, false);
    assert.match(html, /Reopen/);
    assert.match(html, /Resolved/);
    assert.doesNotMatch(html, /Mark resolved — I corrected/);
  });

  it('reconstructs the implied value from cap×price on an OLD row lacking implied_basis', () => {
    const html = card({
      domain: 'gov', id: 2, address: 'X', sale_price: 8800000,
      implied_cap: 0.021142, reliable_cap: 0.0371, flags: ['cap_mismatch'],
      status: 'open', detail: {},
    }, false);
    assert.match(html, /NOI \$186,050/);   // 0.021142 * 8,800,000 ≈ 186,050
  });
});
