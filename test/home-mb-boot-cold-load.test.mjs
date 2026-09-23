// HOME-MB-BOOT (2026-09-23) — the Home "Market Briefs" widget spun forever on
// a cold load. Its only caller was handlePageLoad('pageHome'), which runs only
// through navTo(); on a cold load Home is already the active page, so
// applyRoute() never calls navTo, and bootApp() never called the widget.
//
// These tests EXECUTE the real bootApp / applyRoute bodies (sliced by AST span
// with acorn, never a character window) against stubs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(root, 'app.js'), 'utf8');

function topLevel(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const out = new Map();
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') out.set(node.id.name, src.slice(node.start, node.end));
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) if (d.id && d.id.name) out.set(d.id.name, src.slice(node.start, node.end));
    }
  }
  return out;
}
const FNS = topLevel(APP);
const pick = (names, src = FNS) => names.map((n) => {
  const s = src.get(n); assert.ok(s, `top-level ${n} not found in app.js`); return s;
}).join('\n');

// Run bootApp with every loader stubbed to a resolved promise; return the set
// of functions it called once the promise chain has settled.
async function coldBoot(activePageId, appSrc = APP) {
  const fns = appSrc === APP ? FNS : topLevel(appSrc);
  const called = [];
  const rec = (name) => (..._a) => { called.push(name); return Promise.resolve(); };
  const stubs = {
    loadUserContext: rec('loadUserContext'), loadFeatureFlags: rec('loadFeatureFlags'),
    applyFeatureFlags: () => called.push('applyFeatureFlags'),
    autoConnectCredentials: rec('autoConnectCredentials'),
    loadActivities: rec('loadActivities'), loadEmails: rec('loadEmails'), loadCalendar: rec('loadCalendar'),
    loadHealth: rec('loadHealth'), loadWeather: rec('loadWeather'), loadMarket: rec('loadMarket'),
    loadPersonalCalendar: rec('loadPersonalCalendar'), loadPersonalTasks: rec('loadPersonalTasks'),
    loadCanonicalData: rec('loadCanonicalData'), loadDailyBriefingData: rec('loadDailyBriefingData'),
    loadNextBestActionData: rec('loadNextBestActionData'),
    updateGreeting: () => called.push('updateGreeting'),
    renderTodaySections: rec('renderTodaySections'), renderHomeThreeLanes: rec('renderHomeThreeLanes'),
    renderMarketBriefsWidget: rec('renderMarketBriefsWidget'),
    checkFlag: () => false, triggerCanonicalSync: rec('triggerCanonicalSync'),
    ROUTE_PAGE_ALIAS: {},
    document: {
      querySelector(sel) {
        if (sel === '.page.active') return activePageId ? { id: activePageId } : null;
        return null;
      },
    },
  };
  const names = Object.keys(stubs);
  const body = pick(['_routeIsPageActive', 'bootApp'], fns) + '\nreturn bootApp;';
  // eslint-disable-next-line no-new-func
  const bootApp = new Function(...names, body)(...names.map((n) => stubs[n]));
  bootApp();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return called;
}

describe('HOME-MB-BOOT — cold boot renders the Market Briefs widget', () => {
  it('premise: a cold load with Home already active does NOT go through navTo/handlePageLoad', () => {
    const navCalls = [];
    const env = {
      location: { hash: '' },
      document: {
        querySelector: (sel) => (sel === '.page.active' ? { id: 'pageHome' } : null),
        getElementById: () => null,
      },
      navTo: (p) => navCalls.push(p),
    };
    const src = pick([
      'ROUTE_SLUG_TO_PAGE', 'ROUTE_PAGE_TO_SLUG', 'ROUTE_PAGE_ALIAS', '_routerApplying', '_routeCurrentDetail',
      '_routeParseDetail', '_routeParseHash', '_routeDetailIsOpen', '_routeIsPageActive', '_routeSameDetail',
      'applyRoute',
    ]) + '\nreturn applyRoute;';
    // eslint-disable-next-line no-new-func
    const applyRoute = new Function('location', 'document', 'navTo', '_detailStack', '_detailStackReset', 'closeDetail', src)(
      env.location, env.document, env.navTo, [], () => {}, () => {});
    for (const hash of ['', '#/']) { env.location.hash = hash; applyRoute(); }
    assert.deepEqual(navCalls, [], 'router must not navTo an already-active page — so bootApp has to render Home widgets');
  });

  it('cold boot on Home (#/ or no hash) invokes renderMarketBriefsWidget exactly once', async () => {
    const called = await coldBoot('pageHome');
    assert.equal(called.filter((c) => c === 'renderMarketBriefsWidget').length, 1);
  });

  it('cold boot on another page does not fetch the widget (navTo → handlePageLoad renders it later)', async () => {
    const called = await coldBoot('pageBiz');
    assert.ok(!called.includes('renderMarketBriefsWidget'));
  });

  it('mutation: removing the bootApp call leaves the spinner — the test goes RED', async () => {
    const mutated = APP.replace(
      /if \(typeof renderMarketBriefsWidget === 'function' && _routeIsPageActive\('pageHome'\)\) renderMarketBriefsWidget\(\);/,
      '/* removed */');
    assert.notEqual(mutated, APP, 'mutation must apply');
    const called = await coldBoot('pageHome', mutated);
    assert.ok(!called.includes('renderMarketBriefsWidget'), 'without the fix a cold boot never renders the widget');
  });

  it('audit: every renderer handlePageLoad(pageHome) runs is reached from a cold bootApp', async () => {
    const hpl = FNS.get('handlePageLoad');
    const homeCase = hpl.slice(hpl.indexOf("case 'pageHome':"), hpl.indexOf("case 'pagePipeline':"));
    const rendered = [...homeCase.matchAll(/\b(render\w+|load\w+)\s*\(/g)].map((m) => m[1]);
    assert.ok(rendered.length >= 4, `parsed pageHome case: ${rendered}`);
    const called = await coldBoot('pageHome');
    // renderDailyBriefingPanel / renderNextBestActionPanel are invoked by their loaders
    // (loadDailyBriefingData / loadNextBestActionData render on entry and on settle).
    const coveredBy = { renderDailyBriefingPanel: 'loadDailyBriefingData', renderNextBestActionPanel: 'loadNextBestActionData' };
    for (const fn of Object.keys(coveredBy)) {
      assert.match(FNS.get(coveredBy[fn]), new RegExp('\\b' + fn + '\\s*\\('), `${coveredBy[fn]} must render ${fn}`);
    }
    for (const fn of rendered) {
      const via = coveredBy[fn] || fn;
      assert.ok(called.includes(via), `cold boot never reaches ${fn} (via ${via})`);
    }
  });
});
