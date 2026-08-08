// W3.6 fix 1 — display-name resolution (owner_reconcile lane + Listing-BD group).
//
// (a) owner_reconcile: the gov owner_unification seeder carries only a
//     candidate_unified_id (uuid); cards used to render "contact <hex8>". The
//     server now batch-resolves gov unified_contacts + the recorded owner's
//     property and the card renders "Owner ↔ Name (Company)" with real facts.
// (b) Listing-BD grouped view: items whose metadata lacked names rendered
//     "New listing" / "Unknown contact"; a batched entities join fills them.
//
// These are FIXTURE render tests: the pure server helpers are imported from
// admin.js / listing-bd.js, and the browser render functions are sliced out of
// ops.js and evaluated with light stubs (the established pattern).

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildOwnerUnificationContext, formatOwnerReconcileCandidate, ownerReconcileMatchReason,
} from '../api/admin.js';
import { applyListingBdEntityNames, collectListingBdEntityIds } from '../api/_shared/listing-bd.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// W6.5 Stage 1 (P87): _fedCardHTML was extracted from ops.js to dc-lanes.js (a
// classic <script> loaded before ops.js, same global scope). Both files are one
// runtime surface, so slice the concatenation — renderListingBdTriageBody still
// lives in ops.js, _fedCardHTML now in dc-lanes.js; the sliceFn markers resolve
// against either half. Assertions unchanged.
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8')
  + '\n' + readFileSync(join(root, 'dc-lanes.js'), 'utf8');

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

// ── (a) owner_reconcile server helpers ──────────────────────────────────────
describe('W3.6(a) owner_reconcile — server name resolution', () => {
  it('formatOwnerReconcileCandidate → "Name (Company)"', () => {
    assert.equal(
      formatOwnerReconcileCandidate({ full_name: 'Jane Smith', company_name: 'Smith Realty' }),
      'Jane Smith (Smith Realty)');
  });
  it('falls back to company, then a short id tag (never a raw hex only)', () => {
    assert.equal(formatOwnerReconcileCandidate({ company_name: 'Acme LLC' }), 'Acme LLC');
    assert.equal(formatOwnerReconcileCandidate({}, '15e86a39-3b6c-4858-9598-7e12b58f0a15'),
      'contact 15e86a39');
  });
  it('drops the parenthetical when name equals company', () => {
    assert.equal(formatOwnerReconcileCandidate({ full_name: 'Acme LLC', company_name: 'ACME llc' }), 'Acme LLC');
  });
  it('ownerReconcileMatchReason humanizes tier0_ambiguous', () => {
    assert.match(ownerReconcileMatchReason('tier0_ambiguous'), /Exact name match/);
    assert.equal(ownerReconcileMatchReason('some_new_token'), 'some new token');
  });
  it('buildOwnerUnificationContext attaches resolved facts + shared_state', () => {
    const ctx = buildOwnerUnificationContext(
      { id: 82, recorded_owner_id: 'o1', owner_name: 'Legend Development',
        candidate_unified_id: 'u1', match_tier: 0, match_score: 1.0, reason: 'tier0_ambiguous' },
      { unified_id: 'u1', full_name: 'Micah Pinney', company_name: 'Legend Development LLC',
        email: 'cpinn16@yahoo.com', city: 'Roseville', state: 'CA' },
      { recorded_owner_id: 'o1', address: '11885 Edgewood Rd', city: 'Auburn', state: 'CA' });
    assert.equal(ctx.candidate_name, 'Micah Pinney');
    assert.equal(ctx.candidate_company, 'Legend Development LLC');
    assert.equal(ctx.candidate_display, 'Micah Pinney (Legend Development LLC)');
    assert.equal(ctx.owner_property_address, '11885 Edgewood Rd');
    assert.equal(ctx.shared_state, true);               // both CA
    assert.match(ctx.match_reason_label, /Exact name match/);
  });
});

// ── (a) owner_reconcile card render ─────────────────────────────────────────
describe('W3.6(a) owner_reconcile — card renders real names, not "contact <hex>"', () => {
  let fedCard;
  before(() => {
    const src = sliceFn(opsSrc, 'function _fedCardHTML(');
    fedCard = new Function(`
      let _dcFedType = 'owner_reconcile';
      function esc(s){ return s == null ? '' : String(s); }
      function _fedMoney(){ return ''; }
      ${src}
      return _fedCardHTML;
    `)();
  });
  it('renders "Owner ↔ Name (Company)" + comparison facts', () => {
    const ctx = buildOwnerUnificationContext(
      { id: 82, recorded_owner_id: 'o1', owner_name: 'Legend Development',
        candidate_unified_id: '15e86a39-3b6c-4858-9598-7e12b58f0a15', match_tier: 0, match_score: 1.0, reason: 'tier0_ambiguous' },
      { unified_id: 'u1', full_name: 'Micah Pinney', company_name: 'Legend Development LLC',
        email: 'cpinn16@yahoo.com', city: 'Roseville', state: 'CA' },
      { recorded_owner_id: 'o1', address: '11885 Edgewood Rd', city: 'Auburn', state: 'CA' });
    const html = fedCard({ context: ctx }, 0, true);
    assert.match(html, /Legend Development/);
    assert.match(html, /Micah Pinney \(Legend Development LLC\)/);
    assert.doesNotMatch(html, /contact 15e86a39/);      // resolved, not the hex tag
    assert.match(html, /Exact name match/);             // humanized reason, not "tier0_ambiguous"
    assert.doesNotMatch(html, /tier0_ambiguous/);
    assert.match(html, /cpinn16@yahoo\.com/);           // contact comparison facts
    assert.match(html, /11885 Edgewood Rd/);            // owner property fact
  });
  it('still shows a short id tag only when nothing resolved (graceful)', () => {
    const ctx = buildOwnerUnificationContext(
      { id: 87, recorded_owner_id: 'o2', owner_name: 'LVA5 EL SEGUNDO 777 AVIATION LP',
        candidate_unified_id: '96859f12-8f5d-49bb-b43f-4d5e86007705', match_tier: 0, match_score: 1.0, reason: 'tier0_ambiguous' },
      { unified_id: 'u2', company_name: 'LVA5 EL SEGUNDO 777 AVIATION L P' }, null);
    const html = fedCard({ context: ctx }, 0, false);
    assert.match(html, /LVA5 EL SEGUNDO 777 AVIATION L P/);   // company shown, not raw hex
  });
});

// ── (b) Listing-BD group render ─────────────────────────────────────────────
describe('W3.6(b) Listing-BD group — batched entity name resolution', () => {
  it('collectListingBdEntityIds gathers listing + name-less contact ids only', () => {
    const items = [
      { id: 'i1', source_type: 'listing_bd_trigger', entity_id: 'c1',
        metadata: { listing_entity_id: 'L1' } },                         // both missing → both
      { id: 'i2', source_type: 'listing_bd_trigger', entity_id: 'c2', entity_name: 'Has Name',
        metadata: { listing_entity_id: 'L1', listing_name: 'Has Listing', contact_name: 'Known' } }, // none missing
      { id: 'i3', source_type: 'other', entity_id: 'x', metadata: {} },   // not listing_bd
    ];
    const ids = collectListingBdEntityIds(items).sort();
    assert.deepEqual(ids, ['L1', 'c1']);
  });

  let renderBody;
  before(() => {
    const src = sliceFn(opsSrc, 'function renderListingBdTriageBody(');
    renderBody = new Function(`
      const opsInboxSelected = new Set();
      function esc(s){ return s == null ? '' : String(s); }
      function typeBadge(t){ return '<span>' + t + '</span>'; }
      function emptyStateHTML(){ return '<div class="ops-empty">empty</div>'; }
      ${src}
      return renderListingBdTriageBody;
    `)();
  });

  it('renders REAL names after enrichment (not "New listing" / "Unknown contact")', () => {
    const items = [
      { id: 'i1', source_type: 'listing_bd_trigger', entity_id: 'c1',
        metadata: { listing_entity_id: 'L1' } },
      { id: 'i2', source_type: 'listing_bd_trigger', entity_id: 'c2',
        metadata: { listing_entity_id: 'L1' } },
    ];
    const entityById = new Map([
      ['L1', { id: 'L1', name: '70 Commercial St', city: 'Concord', state: 'NH' }],
      ['c1', { id: 'c1', name: 'Jane Smith', city: 'Boston', state: 'MA', email: 'jane@x.com' }],
      ['c2', { id: 'c2', name: 'Bob Jones', email: 'bob@y.com' }],
    ]);
    applyListingBdEntityNames(items, entityById);
    const html = renderBody(items);
    assert.match(html, /70 Commercial St/);           // listing name (was "New listing")
    assert.match(html, /Concord, NH/);
    assert.match(html, /Jane Smith/);                  // contact name (was "Unknown contact")
    assert.match(html, /Bob Jones/);
    assert.doesNotMatch(html, /New listing/);
    assert.doesNotMatch(html, /Unknown contact/);
  });

  it('falls back to entity address when the listing entity has no name', () => {
    const items = [{ id: 'i1', source_type: 'listing_bd_trigger', entity_id: 'c1',
      metadata: { listing_entity_id: 'L9' } }];
    applyListingBdEntityNames(items, { L9: { id: 'L9', address: '5 Main St', city: 'Rye', state: 'NY' }, c1: { id: 'c1', name: 'Al Pine' } });
    const html = renderBody(items);
    assert.match(html, /5 Main St/);
    assert.match(html, /Al Pine/);
  });
});
