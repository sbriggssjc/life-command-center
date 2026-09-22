// GOV-UX1 (2026-09-22) — SBN-23 / SBN-24 / SBN-25.
//
//   A. Opening/closing a detail from any lane never moves the background.
//      Root cause: the Business sub-tabs never wrote the hash, so after
//      `#/dia` → "Government", opening a gov Available row wrote
//      `#/dia?d=prop:gov:…` and applyRoute navTo'd pageDia. Plus pageBiz
//      reverse-mapped to 'capmarkets', whose inbound branch forces dialysis.
//   B. The owner click resolves through ONE resolver (id → domain identity →
//      exact canonical key), so "Gold Circle Properties, LLC" finds the entity
//      the Next-step card calls resolved, and an unresolved owner never replaces
//      the open property panel.
//   C. One verification component for both lanes: same placement (Sales ›
//      Available), same headline (overdue 30d+), Recent panel opens on Evidence.
//
// Functions are sliced by AST span (acorn), never by a character window.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { planOwnerResolution, ownerCanonicalKey, followSurvivor } from '../api/_shared/owner-entity-resolve.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

function topLevel(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const out = new Map();
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') out.set(node.id.name, src.slice(node.start, node.end));
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) if (d.id && d.id.name) out.set(d.id.name, src.slice(node.start, node.end));
    }
  }
  return { ast, out };
}
function pick(map, names) {
  return names.map((n) => { const s = map.get(n); assert.ok(s, `top-level ${n} not found`); return s; }).join('\n');
}
// Names of top-level functions that CALL `callee` anywhere in their body.
function callersOf(src, callee) {
  const { ast } = topLevel(src);
  const hits = [];
  for (const node of ast.body) {
    if (node.type !== 'FunctionDeclaration') continue;
    const body = src.slice(node.start, node.end);
    if (node.id.name !== callee && new RegExp('\\b' + callee + '\\s*\\(').test(body)) hits.push(node.id.name);
  }
  return hits;
}

// ─────────────────────────────────────────────────────────────── A
describe('A — opening a detail never moves the background lane (SBN-24)', () => {
  const app = topLevel(read('app.js')).out;
  const ROUTER = pick(app, [
    'ROUTE_SLUG_TO_PAGE', 'ROUTE_PAGE_TO_SLUG', 'ROUTE_PAGE_ALIAS', '_routerApplying', '_routeCurrentDetail',
    '_routePageToSlug', '_routeParseDetail', '_routeParseHash', '_routeDetailIsOpen', '_routeIsPageActive',
    '_routeSameDetail', 'applyRoute', '_routePush', '_routeReplace', '_routeSetPageHash',
    '_routeLivePageSlug', '_routeCurrentPageSlug', '_routeSetDetailHash', '_routeClearDetailHash',
  ]);

  function harness({ hash, activePage, activeBnav, bizTab }) {
    const calls = { navTo: [], openUnified: [] };
    const env = {
      location: { hash },
      history: { replaceState(_a, _b, h) { env.location.hash = h; } },
      document: {
        querySelector(sel) {
          if (sel === '.page.active') return activePage ? { id: activePage } : null;
          if (sel === '.bnav.active') return activeBnav ? { dataset: { page: activeBnav } } : null;
          return null;
        },
        getElementById(id) { return id === 'detailOverlay' ? { classList: { contains: () => true } } : { id }; },
      },
      navTo: (p) => calls.navTo.push(p),
      openUnifiedDetail: (...a) => calls.openUnified.push(a),
      closeDetail: () => {},
      _detailStack: [],
    };
    const fn = new Function('env', `
      const { location, history, document, navTo, openUnifiedDetail, closeDetail, _detailStack } = env;
      let currentBizTab = ${JSON.stringify(bizTab)};
      let currentDiaTab = 'overview';
      ${ROUTER}
      return { applyRoute, _routeSetDetailHash, _routeClearDetailHash, _routeSetPageHash, get currentBizTab() { return currentBizTab; } };
    `);
    return { r: fn(env), env, calls };
  }

  it('gov Available row opened after reaching Government via the sub-tab (stale #/dia): hash names gov, no navTo', () => {
    const { r, env, calls } = harness({ hash: '#/dia', activePage: 'pageBiz', activeBnav: 'pageGov', bizTab: 'government' });
    r._routeSetDetailHash({ kind: 'prop', db: 'gov', id: '31516', tab: 'Overview' });
    assert.match(env.location.hash, /^#\/gov\?d=prop:gov:31516:/);
    r.applyRoute();                       // the hashchange the push fires
    assert.deepEqual(calls.navTo, [], 'the background must not be re-navigated');
    assert.equal(r.currentBizTab, 'government', 'active domain tab unchanged');
    r._routeClearDetailHash();            // × / Back
    assert.equal(env.location.hash, '#/gov');
    assert.deepEqual(calls.navTo, []);
  });

  it('a detail opened on a non-domain Business tab writes #/business, never #/capmarkets (which forces dialysis)', () => {
    const { r, env, calls } = harness({ hash: '', activePage: 'pageBiz', activeBnav: null, bizTab: 'prospects' });
    r._routeSetDetailHash({ kind: 'prop', db: 'gov', id: '7', tab: '' });
    assert.match(env.location.hash, /^#\/business\?d=/);
    r.applyRoute();
    assert.equal(r.currentBizTab, 'prospects');
    assert.deepEqual(calls.navTo, []);
  });

  it('navigating to the Business page writes #/business, not the capmarkets alias', () => {
    const { r, env } = harness({ hash: '#/today', activePage: 'pageHome', activeBnav: null, bizTab: 'prospects' });
    r._routeSetPageHash('pageBiz');
    assert.equal(env.location.hash, '#/business');
  });

  it('a dia row opened from the Dialysis lane still routes to #/dia (no regression)', () => {
    const { r, env, calls } = harness({ hash: '#/dia', activePage: 'pageBiz', activeBnav: 'pageDia', bizTab: 'dialysis' });
    r._routeSetDetailHash({ kind: 'prop', db: 'dia', id: '24703', tab: 'Overview' });
    assert.match(env.location.hash, /^#\/dia\?d=prop:dia:24703:/);
    r.applyRoute();
    assert.deepEqual(calls.navTo, []);
  });

  it('the Business sub-tab click writes the domain hash (so the hash cannot go stale)', () => {
    const src = read('app.js');
    const at = src.indexOf("document.getElementById('bizSubTabs')?.addEventListener('click'");
    assert.ok(at > 0);
    const handler = src.slice(at, src.indexOf('});\n', at));
    assert.match(handler, /_routeSetPageHash\(primaryNavMap\[tabBiz\]\)/);
  });
});

// ─────────────────────────────────────────────────────────────── B
const GOLD = 'ff84dd24-8177-4166-ada2-99402eabdf7b';
const TWIN = 'fe43e581-aea3-470d-b010-1bfe5f5f6733';
const goldRows = [
  { id: GOLD, name: 'Gold Circle Properties', canonical_name: 'gold circle properties', merged_into_entity_id: null, entity_type: 'organization' },
  { id: TWIN, name: 'Gold Circle Properties', canonical_name: 'gold circle properties', merged_into_entity_id: GOLD, entity_type: 'organization' },
];

describe('B — one owner resolver (SBN-25)', () => {
  it('", LLC" and trailing punctuation reduce to the same canonical key as the entity', () => {
    // NB "L.L.C." (dotted) keys to 'gold circle properties l l c' — that is the
    // live lcc_entity_canonical_key behaviour (N15c) and is NOT changed here.
    for (const v of ['Gold Circle Properties, LLC', 'Gold Circle Properties LLC.', 'GOLD CIRCLE PROPERTIES, llc', 'Gold Circle Properties Inc']) {
      assert.equal(ownerCanonicalKey(v), 'gold circle properties', v);
    }
  });

  it('live entity + its own merged twin are ONE answer (canonical_exact), not "multiple found"', () => {
    const p = planOwnerResolution({ canonicalRows: goldRows });
    assert.equal(p.status, 'resolved');
    assert.equal(p.entity_id, GOLD);
    assert.equal(p.method, 'canonical_exact');
  });

  it('the domain true_owner identity wins, following the merge chain', () => {
    const p = planOwnerResolution({ identityRows: [{ entity_id: TWIN }], entityRows: goldRows, canonicalRows: [] });
    assert.equal(p.entity_id, GOLD);
    assert.equal(p.method, 'domain_identity');
  });

  it('two different live parties on one key are AMBIGUOUS — never guessed', () => {
    const p = planOwnerResolution({ canonicalRows: [
      { id: 'a', canonical_name: 'x', merged_into_entity_id: null, name: 'X LLC' },
      { id: 'b', canonical_name: 'x', merged_into_entity_id: null, name: 'X Inc' },
    ] });
    assert.equal(p.status, 'ambiguous');
    assert.equal(p.entity_id, null);
    assert.equal(p.candidates.length, 2);
  });

  it('a merge cycle has no survivor', () => {
    const by = new Map([['a', { id: 'a', merged_into_entity_id: 'b' }], ['b', { id: 'b', merged_into_entity_id: 'a' }]]);
    assert.equal(followSurvivor('a', by), null);
  });

  // Client: the owner click goes through the resolver and never replaces the
  // open property panel with "No entity found".
  const shell = topLevel(read('detail-panel-shell.js')).out;
  const CLIENT = pick(shell, ['_resolveOwnerEntity', '_openEntityByNameSmart']);
  function client({ apiResponse, primaryOpen = true, kind = 'property' }) {
    const calls = { urls: [], smart: [], beside: [], byName: [] };
    const fn = new Function('c', `
      const window = {};
      const _entityApiFetch = async (u) => { c.calls.urls.push(u); return c.apiResponse; };
      const _openEntitySmart = (id) => c.calls.smart.push(id);
      const _ownerUnresolvedBeside = (n, r) => c.calls.beside.push([n, r]);
      const openEntityDetailByName = (n) => c.calls.byName.push(n);
      const _panelPrimaryOpen = () => c.primaryOpen;
      const _activePrimaryKind = c.kind;
      ${CLIENT}
      return _openEntityByNameSmart;
    `);
    return { open: fn({ calls, apiResponse, primaryOpen, kind }), calls };
  }

  it('"Gold Circle Properties, LLC" opens entity ff84dd24 beside the property (resolver, not substring search)', async () => {
    const { open, calls } = client({ apiResponse: { status: 'resolved', entity_id: GOLD, method: 'canonical_exact', candidates: [] } });
    await open('Gold Circle Properties, LLC', { db: 'gov', true_owner_id: GOLD });
    assert.match(calls.urls[0], /action=resolve_owner/);
    assert.match(calls.urls[0], /source_system=gov/);
    assert.match(calls.urls[0], /q=Gold%20Circle%20Properties%2C%20LLC/);
    assert.deepEqual(calls.smart, [GOLD]);
    assert.deepEqual(calls.byName, []);
  });

  it('an unresolved owner with a property panel open stays BESIDE it — never replaces it', async () => {
    const { open, calls } = client({ apiResponse: { status: 'none', entity_id: null, candidates: [] } });
    await open('Nobody Holdings, LLC');
    assert.equal(calls.beside.length, 1);
    assert.deepEqual(calls.byName, [], 'openEntityDetailByName would replace the property panel');
  });

  it('with no property panel open, the full-panel name search remains the fallback', async () => {
    const { open, calls } = client({ apiResponse: { status: 'none', entity_id: null, candidates: [] }, primaryOpen: false });
    await open('Nobody Holdings, LLC');
    assert.deepEqual(calls.byName, ['Nobody Holdings, LLC']);
  });

  it('the property panel owner ref carries the domain true_owner id (same identity as "Owner resolved")', () => {
    const detail = topLevel(read('detail.js')).out;
    const ref = new Function(`const _udCache = { db: 'gov' }; ${pick(detail, ['_udResolvedOwnerRef'])}; return _udResolvedOwnerRef;`)();
    const r = ref({ true_owner: 'Gold Circle Properties, LLC', true_owner_id: GOLD, true_owner_is_operator: false });
    assert.equal(r.trueOwnerId, GOLD);
    assert.equal(r.db, 'gov');
    const op = ref({ true_owner: 'DaVita Inc', true_owner_id: 'x', true_owner_is_operator: true });
    assert.equal(op, null, 'an operator is never the owner (P0.1)');
  });

  it('the server search excludes tombstones and matches the canonical key exactly', () => {
    const src = read('api/_handlers/entities-handler.js');
    const at = src.indexOf("if (action === 'search' && q)");
    const block = src.slice(at, src.indexOf('return res.status(200)', at));
    assert.match(block, /merged_into_entity_id=is\.null/);
    assert.match(block, /canonical_name\.eq\./);
    assert.match(src, /if \(action === 'resolve_owner'\)/);
  });
});

// ─────────────────────────────────────────────────────────────── C
describe('C — one verification surface for both lanes (SBN-23)', () => {
  const lv = topLevel(read('listing-verification.js')).out;
  const LV = [...lv.keys()].filter((k) => k !== 'window').map((k) => lv.get(k)).join('\n');
  const dia = topLevel(read('dialysis.js')).out;
  const gov = topLevel(read('gov.js')).out;
  const summary = { due_for_verification: 9, overdue_30d: 80, overdue_90d: 12, broken_url_count: 0,
    verifications_last_7d: 50, recent_status_changes_7d: 1, evidence_verifications_7d: 0, cron_timer_advances_7d: 50 };
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, listing_id: i, method: 'auto_scrape',
    check_result: 'inferred_active', notes: 'no sale evidence in 3y', verified_at: new Date().toISOString() }));

  const lanes = {
    dia: new Function(`const showToast=()=>{}; let diaVerificationSummary = ${JSON.stringify(summary)};
      let diaRecentVerifications = ${JSON.stringify(rows)};
      ${dia.get('diaRecentVerificationsFilter')}
      ${LV}
      ${pick(dia, ['renderListingVerificationCard', 'renderRecentDiaVerificationsPanel'])}
      return { card: renderListingVerificationCard(), panel: renderRecentDiaVerificationsPanel() };`)(),
    gov: new Function(`const showToast=()=>{}; let govVerificationSummary = ${JSON.stringify(summary)};
      let govRecentVerifications = ${JSON.stringify(rows)};
      ${gov.get('govRecentVerificationsFilter')}
      ${LV}
      ${pick(gov, ['renderGovListingVerificationCard', 'renderRecentGovVerificationsPanel'])}
      return { card: renderGovListingVerificationCard(), panel: renderRecentGovVerificationsPanel() };`)(),
  };

  for (const lane of ['dia', 'gov']) {
    it(`${lane}: headline is overdue (30d+) = 80, not "due now" = 9`, () => {
      const m = lanes[lane].card.match(/class="lv-headline"[^>]*>([^<]*)</);
      assert.ok(m, 'headline element rendered');
      assert.equal(m[1].trim(), '80');
      assert.match(lanes[lane].card, /overdue \(30d\+\)/);
      assert.match(lanes[lane].card, /data-lv-headline="overdue_30d"/);
    });
    it(`${lane}: Recent panel opens on Evidence; 50 cron-only rows are labelled timer advances, not shown as verifications`, () => {
      const p = lanes[lane].panel;
      assert.match(p, /data-lv-filter-active="evidence"/);
      assert.equal((p.match(/class="lv-row"/g) || []).length, 0);
      assert.match(p, /50 cron-only timer advances \(not verifications\)/);
    });
  }

  it('both lanes render the identical component (modulo the lane attribute)', () => {
    const norm = (h) => h.replace(/data-lv-lane="(dia|gov)"/g, '').replace(/set(Dia|Gov)RecentVerificationsFilter/g, 'SETTER');
    assert.equal(norm(lanes.dia.card), norm(lanes.gov.card));
    assert.equal(norm(lanes.dia.panel), norm(lanes.gov.panel));
  });

  it('placement: Sales › Available in both lanes, and nowhere else', () => {
    assert.deepEqual(callersOf(read('dialysis.js'), 'renderListingVerificationCard'), ['renderDiaSales']);
    assert.deepEqual(callersOf(read('dialysis.js'), 'renderRecentDiaVerificationsPanel'), ['renderDiaSales']);
    assert.deepEqual(callersOf(read('gov.js'), 'renderGovListingVerificationCard'), ['renderGovSales']);
    assert.deepEqual(callersOf(read('gov.js'), 'renderRecentGovVerificationsPanel'), ['renderGovSales']);
  });

  it('listing-verification.js loads before gov.js and dialysis.js, with the shared cache buster', () => {
    const html = read('index.html');
    const idx = (f) => html.indexOf(`<script src="${f}?v=`);
    assert.ok(idx('listing-verification.js') > 0);
    assert.ok(idx('listing-verification.js') < idx('gov.js'));
    assert.ok(idx('listing-verification.js') < idx('dialysis.js'));
    const v = (f) => (html.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1];
    assert.equal(v('listing-verification.js'), v('app.js'));
  });
});
