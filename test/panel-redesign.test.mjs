// Property + Owner panel redesign (2026-08-15) — behavioural + structural proof.
// Spec: docs/architecture/property-owner-panel-redesign-2026-08.md
// Evidence matrix: docs/architecture/panel-redesign-verification.md
//
// Two kinds of assertion here, deliberately:
//
//  1. BEHAVIOURAL — the new pure functions are sliced out of the live detail.js
//     and executed against real inputs. Follows the repo's existing
//     slice-the-live-source pattern (see w3-6-comp-lane-clarity.test.mjs) so the
//     test can never drift from a stale copy of the code.
//
//  2. STRUCTURAL — assertions that the separation of concerns actually HELD:
//     that the contact/CRM surfaces really left the property tab, that the
//     panel widths are var-driven rather than hard-coded, and that the cache
//     busters moved together. A refactor that quietly re-introduces a Log Call
//     form on the property panel should fail a test, not just a code review.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
const stylesSrc = readFileSync(join(root, 'styles.css'), 'utf8');
const indexSrc = readFileSync(join(root, 'index.html'), 'utf8');

/** Balance-brace a `function name(...) { ... }` out of a source string. */
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `function ${name} not found in source`);
  const braceStart = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${name}`);
  return src.slice(start, end);
}

/** Slice the body of a function so inner declarations can be lifted out. */
function sliceBody(src, name) {
  const fn = sliceFn(src, name);
  return fn.slice(fn.indexOf('{') + 1, fn.lastIndexOf('}'));
}

/**
 * Build a callable from sliced source plus a preamble of stubbed dependencies.
 * `exportName` is what gets returned.
 */
function build(preamble, sources, exportName) {
  // eslint-disable-next-line no-new-func
  return new Function(`${preamble}\n${sources.join('\n')}\nreturn ${exportName};`)();
}

// A faithful stand-in for the app's HTML escaper.
const ESC_STUB = `
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}`;

// ───────────────────────────────────────────────────────────────────────────
describe('§1.1 panel geometry — widths are viewport-aware, not just min/max', () => {
  const mk = (innerWidth) => build(
    `const window = { innerWidth: ${innerWidth} };`,
    [
      detailSrc.slice(detailSrc.indexOf('const _PANEL_W = {'), detailSrc.indexOf('};', detailSrc.indexOf('const _PANEL_W = {')) + 2),
      sliceFn(detailSrc, '_panelClampWidth'),
    ],
    '_panelClampWidth'
  );

  it('clamps to the panel minimum', () => {
    const clamp = mk(2560);
    assert.equal(clamp('primary', 100), 420);
    assert.equal(clamp('companion', 10), 360);
  });

  it('clamps to the panel maximum on a wide screen', () => {
    const clamp = mk(2560);
    assert.equal(clamp('primary', 99999), 1100);
    assert.equal(clamp('companion', 99999), 900);
  });

  it('honours an in-range width unchanged', () => {
    const clamp = mk(2560);
    assert.equal(clamp('primary', 720), 720);
    assert.equal(clamp('companion', 620), 620);
  });

  it('REGRESSION: a width saved on a 2560px monitor cannot push the companion off a 1400px one', () => {
    // The defect: primary.max (1100) + companion.max (900) = 2000 > 1400, and
    // widths are restored from localStorage regardless of the current screen.
    const clamp = mk(1400);
    const primary = clamp('primary', 1100);
    const companion = clamp('companion', 900);
    assert.ok(primary < 1100, 'primary must be reduced below its abstract max');
    assert.ok(primary + companion <= 1400,
      `combined ${primary}+${companion} must fit 1400px, got ${primary + companion}`);
  });

  it('never returns below the minimum even on an absurdly narrow viewport', () => {
    const clamp = mk(600);
    assert.equal(clamp('primary', 800), 420);
  });

  it('falls back to the default for non-numeric input', () => {
    const clamp = mk(2560);
    assert.equal(clamp('primary', undefined), 720);
    assert.equal(clamp('companion', 'abc'), 620);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§1.2 minimize tray — park signature identifies a subject, not a shape', () => {
  const sig = build('', [sliceFn(detailSrc, '_panelParkSig')], '_panelParkSig');

  it('keys an entity on its id', () => {
    assert.equal(sig({ kind: 'entity', entityId: 'abc' }), 'entity:abc');
  });

  it('REGRESSION: the two property descriptor shapes produce the SAME signature', () => {
    // The primary carries { ids: { property_id } }; the companion carries
    // { propertyId }. Keying on `ids` alone made every dock-parked property
    // collapse to "property:dia:{}", silently evicting the previous chip.
    const fromPrimary   = sig({ kind: 'property', db: 'dia', ids: { property_id: 24703 } });
    const fromCompanion = sig({ kind: 'property', db: 'dia', propertyId: 24703 });
    assert.equal(fromPrimary, fromCompanion);
    assert.equal(fromPrimary, 'property:dia:24703');
  });

  it('REGRESSION: two different dock-parked properties do NOT collide', () => {
    const a = sig({ kind: 'property', db: 'dia', propertyId: 111 });
    const b = sig({ kind: 'property', db: 'dia', propertyId: 222 });
    assert.notEqual(a, b);
  });

  it('separates the same numeric id across domains', () => {
    assert.notEqual(
      sig({ kind: 'property', db: 'dia', propertyId: 5 }),
      sig({ kind: 'property', db: 'gov', propertyId: 5 })
    );
  });

  it('an entity and a property can never share a signature', () => {
    assert.notEqual(sig({ kind: 'entity', entityId: '5' }), sig({ kind: 'property', db: '', propertyId: 5 }));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§0 owner resolution — the panel never asserts the operator owns the building', () => {
  const ref = build('', [sliceFn(detailSrc, '_udResolvedOwnerRef')], '_udResolvedOwnerRef');

  it('prefers the reconciled lcc_property_owner name + entity id', () => {
    const r = ref({ lcc_property_owner: { owner_name: 'Rem Management', owner_entity_id: 'e1' },
                    true_owner: 'Fresenius Medical Care', true_owner_is_operator: true });
    assert.equal(r.name, 'Rem Management');
    assert.equal(r.id, 'e1');
  });

  it('falls back to a trusted true_owner when there is no reconciled row', () => {
    const r = ref({ true_owner: 'Boyd Watterson', true_owner_canonical: 'Boyd Watterson Asset Management' });
    assert.equal(r.name, 'Boyd Watterson Asset Management');
  });

  it('P0.1 GUARD: returns null when the only candidate is the flagged operator', () => {
    // Showing the tenant as owner is the defect that started this whole review.
    assert.equal(ref({ true_owner: 'DaVita Inc.', true_owner_is_operator: true }), null);
  });

  it('returns null for no ownership data at all', () => {
    assert.equal(ref(null), null);
    assert.equal(ref({}), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§2.5.1 the "Work this owner" hand-off is a valid, safe CTA', () => {
  const cta = build(ESC_STUB, [
    sliceFn(detailSrc, '_jsStrArg'),
    sliceFn(detailSrc, '_udWorkOwnerCta'),
  ], '_udWorkOwnerCta');

  it('renders nothing without a resolved owner (no dead button)', () => {
    assert.equal(cta(null, 'hero'), '');
  });

  it('routes by entity id when one is resolved', () => {
    const html = cta({ name: 'Rem Management', id: 'e-123' }, 'hero');
    assert.match(html, /_openEntitySmart\(/);
    assert.match(html, /Work this owner/);
  });

  it('routes by name when the owner has no entity id yet', () => {
    const html = cta({ name: 'Rem Management', id: null }, 'footer');
    assert.match(html, /_openEntityByNameSmart\(/);
  });

  it('REGRESSION: an apostrophe in the owner name yields a PARSEABLE onclick', () => {
    // esc() turns ' into &#39;, which the HTML parser decodes back to a raw '
    // inside the onclick source — the old `esc(name).replace(/'/g,"\\'")` was a
    // no-op because there was no ' left to match, so the handler was a
    // SyntaxError for every O'Brien / D'Angelo owner.
    const html = cta({ name: "O'Brien Holdings LLC", id: null }, 'hero');
    const m = html.match(/onclick="([^"]*)"/);
    assert.ok(m, 'expected an onclick attribute');
    // Decode the HTML entities the browser would decode before parsing the JS.
    const js = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    assert.doesNotThrow(() => new Function(`const _openEntityByNameSmart=()=>{};const _openEntitySmart=()=>{};${js}`),
      `onclick did not parse as JS: ${js}`);
    // …and it must actually carry the real name through.
    let captured = null;
    new Function('_openEntityByNameSmart', '_openEntitySmart', js)(v => { captured = v; }, () => {});
    assert.equal(captured, "O'Brien Holdings LLC");
  });

  it('survives a double-quote and an ampersand in the name', () => {
    const html = cta({ name: 'Smith & Sons "Holdings"', id: null }, 'hero');
    const m = html.match(/onclick="([^"]*)"/);
    const js = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    let captured = null;
    new Function('_openEntityByNameSmart', '_openEntitySmart', js)(v => { captured = v; }, () => {});
    assert.equal(captured, 'Smith & Sons "Holdings"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§0 corollary — the ownership ladder collapses only for a genuine match', () => {
  // `_norm` is declared inside _udOwnershipLadder; lift it out of the body.
  const ladderBody = sliceBody(detailSrc, '_udOwnershipLadder');
  const normSrc = ladderBody.slice(ladderBody.indexOf('const _norm = function'),
                                  ladderBody.indexOf('const _recCore'));
  const norm = build('', [normSrc], '_norm');
  const agree = (rec, tru) => {
    const core = norm(rec);
    return !!(rec && tru && core.length >= 4 && core === norm(tru));
  };

  it('collapses casing and legal-suffix variants of one party', () => {
    assert.ok(agree('Rem Management', 'REM Management LLC'));
    assert.ok(agree('Boyd Watterson Asset Management', 'Boyd Watterson Asset Management, LLC'));
    assert.ok(agree('Acme Holdings Inc.', 'ACME HOLDINGS INCORPORATED'));
  });

  it('keeps two genuinely different parties apart (the shell-in-front-of-parent case)', () => {
    assert.ok(!agree('MDS DV Victorville LLC', 'DaVita Inc.'));
    assert.ok(!agree('Rem Management', 'Fresenius Medical Care'));
  });

  it('REGRESSION: names that normalize to an empty/短 residue are NOT reported as agreeing', () => {
    // The normalizer strips every legal form; two unrelated names could both
    // reduce to '' and compare equal, collapsing a real shell→parent ladder.
    assert.ok(!agree('LLC', 'Inc'));
    assert.ok(!agree('The Co', 'Ltd'));
    assert.ok(!agree('LP', 'LLP'));
  });

  it('requires both sides present', () => {
    assert.ok(!agree('Rem Management', ''));
    assert.ok(!agree('', 'Rem Management'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('UI-5 — one party is never printed twice, on EITHER collapse path', () => {
  const ladderFn = sliceFn(detailSrc, '_udOwnershipLadder');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = strip(ladderFn);

  // Found LIVE on dia:31857 (2026-08-17): true_owner was flagged as the operator,
  // so `trueResolved` was false, `_ownersAgree` could not fire, and the
  // true-owner card deliberately re-rendered `recDisplay` — printing
  // "Netstreit Inc → Netstreit Inc" side by side with an arrow between them.
  it('the operator-elevation branch is folded into the single-card condition', () => {
    assert.match(code, /_operatorElevated\s*=\s*!!\(\s*trueIsOperator\s*&&\s*recDisplay\s*\)/,
      'operator elevation must be recognised as a single-party render');
    assert.match(code, /_singleCard\s*=\s*_ownersAgree\s*\|\|\s*_operatorElevated/);
  });

  it('EVERY layout decision reads _singleCard, not the narrower _ownersAgree', () => {
    // The grid-vs-single wrapper, the arrow + second card guard, and the
    // collapsed note must all agree; if one still read _ownersAgree the
    // operator case would render a one-column grid with a stranded arrow.
    assert.match(code, /h \+= _singleCard\s*\n?\s*\?/, 'wrapper must branch on _singleCard');
    assert.match(code, /if \(!_singleCard\) \{/, 'second card must be gated on _singleCard');
    assert.match(code, /if \(_singleCard\) \{/, 'collapsed note must be gated on _singleCard');
    // _ownersAgree may survive ONLY where the two cases need different wording.
    const stray = code.match(/_ownersAgree/g) || [];
    assert.ok(stray.length <= 3,
      `_ownersAgree still drives ${stray.length} decisions; expected it to survive only in wording choices`);
  });

  it('the collapsed card still carries the operator fact — the one thing card 2 added', () => {
    assert.match(code, /_operatorElevated[\s\S]{0,220}operator \/ tenant, not the owner/,
      'collapsing must not silently drop "X is the operator / tenant"');
  });

  it('an operator with NO recorded owner still renders the second card (nothing to collapse into)', () => {
    // trueIsOperator && !recDisplay must stay two-card so the "unresolved —
    // queue LLC / SoS research" call to action survives.
    assert.match(code, /_operatorElevated\s*=\s*!!\(\s*trueIsOperator\s*&&\s*recDisplay\s*\)/);
    assert.match(code, /Beneficial owner not yet identified/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('UI-5b — the owner chip label and its navigation target are the same string', () => {
  const ctx = build(ESC_STUB, [sliceFn(detailSrc, '_ownerCtxFromCurrent')], '_ownerCtxFromCurrent');
  // How the ladder LABELS each side, verbatim from the renderer.
  const labelRecorded = (own) => own.recorded_owner_canonical || own.recorded_owner || '';
  const labelTrue = (own) => own.true_owner_canonical || own.true_owner || '';

  // The live case: the chip read "Netstreit Inc" and docked "NETSTREIT Corp".
  const live = {
    recorded_owner: 'Netstreit Corp',
    recorded_owner_canonical: 'Netstreit Inc',
    true_owner: 'DaVita Inc.',
    true_owner_is_operator: true,
  };

  it('REGRESSION: the recorded chip navigates to the name it displays', () => {
    assert.equal(ctx(live, 'dia', 'recorded').name, labelRecorded(live));
    assert.equal(ctx(live, 'dia', 'recorded').name, 'Netstreit Inc');
  });

  it('REGRESSION: the true-owner chip navigates to the name it displays', () => {
    const own = { true_owner: 'Davita Incorporated', true_owner_canonical: 'DaVita Inc.' };
    assert.equal(ctx(own, 'dia', 'true').name, labelTrue(own));
  });

  it('the RAW name is preserved for lookups, not overwritten by the canonical', () => {
    const c = ctx(live, 'dia', 'recorded');
    assert.equal(c.recorded_owner_name, 'Netstreit Corp', 'raw recorded name must survive');
    assert.equal(c.true_owner_name, 'DaVita Inc.');
  });

  it('falls back to the raw name when there is no canonical', () => {
    const own = { recorded_owner: 'Rem Management LLC' };
    assert.equal(ctx(own, 'dia', 'recorded').name, 'Rem Management LLC');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('property-in-dock — the full tabbed panel, mounted without global cross-wiring', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const openUD = strip(sliceFn(detailSrc, 'openUnifiedDetail'));
  const openCP = strip(sliceFn(detailSrc, 'openCompanionProperty'));
  const closeCo = strip(sliceFn(detailSrc, 'closeCompanion'));

  // The 12 functions in the property-render family that re-grab the body/tabs
  // element on their own. Every one must go through _udHost(), or a docked
  // property's in-panel action would repaint the PRIMARY panel instead.
  const FAMILY = ['openUnifiedDetail','switchUnifiedTab','_udRenderFallbackHeader','refreshDetailPanel',
    '_udDismissLead','_udCmsLinkCandidate','_udCmsClearLink','switchLeaseSubView',
    '_udOwnerBeginProspecting','_salesSetFilter','_salesSaveTransaction','_dealHistorySetFilter'];

  it('NO function in the property-render family still hard-codes a singleton id', () => {
    const offenders = [];
    for (const name of FAMILY) {
      const body = strip(sliceFn(detailSrc, name));
      if (/getElementById\(['"]detail(Body|Tabs|Header)['"]\)/.test(body)) offenders.push(name + ' (getElementById)');
      if (/querySelector\w*\(['"]#detail(Body|Tabs|Header)/.test(body)) offenders.push(name + ' (querySelector)');
    }
    assert.deepEqual(offenders, [],
      `these would render into the primary even when the property is docked: ${offenders.join(', ')}`);
  });

  it('the mount resolver maps both slots and defaults to primary', () => {
    const mapSrc = detailSrc.slice(
      detailSrc.indexOf('const _UD_HOST_IDS = {'),
      detailSrc.indexOf('};', detailSrc.indexOf('const _UD_HOST_IDS = {')) + 2);
    const mk = (mount) => build(
      `const document={getElementById:(id)=>({id})};const _udMount=${JSON.stringify(mount)};`,
      [mapSrc, sliceFn(detailSrc, '_udHost')],
      '_udHost');
    const host = mk('companion');
    assert.equal(mk('primary')('body').id, 'detailBody');
    assert.equal(mk('primary')('tabs').id, 'detailTabs');
    assert.equal(mk(undefined)('body').id, 'detailBody', 'an unknown mount must fall back to primary');
    assert.equal(host('body').id, 'companionBody');
    assert.equal(host('tabs').id, 'companionTabs');
    assert.equal(host('header').id, 'companionHeader');
  });

  it('the dock never rewrites the hash or the back-stack (they belong to the primary)', () => {
    for (const fn of ['_routeSetDetailHash', '_detailStackSync', '_detailStackSetLabel']) {
      const idx = openUD.indexOf(fn);
      assert.notEqual(idx, -1, `${fn} call not found`);
      const guard = openUD.slice(Math.max(0, idx - 170), idx);
      assert.match(guard, /!inCompanion/, `${fn} must be guarded by !inCompanion`);
    }
  });

  it('Back and Close are primary-only — detailBack/closeDetail act on the primary stack', () => {
    assert.match(openUD, /inCompanion \? '' : '<button class="detail-back"/,
      'Back must be suppressed in the dock');
    assert.match(openUD, /inCompanion \? '' : '<button class="detail-close"/,
      'Close must be suppressed in the dock (the dock has its own controls)');
    assert.match(openUD, /_panelHeaderControls\('companion'\)/, 'the dock needs its own header controls');
    assert.match(openUD, /_panelHeaderControls\(_udMount\)/, 'the loaded header must follow the mount, not hard-code primary');
  });

  it('a docked property does NOT claim the primary kind or the overlay', () => {
    assert.match(openUD, /!inCompanion && typeof _setPrimaryKind/, '_setPrimaryKind is a primary-slot fact');
    // The overlay must sit in the ELSE of the mount branch: the dock renders
    // beside the primary, not over the page.
    const ovIdx = openUD.indexOf("overlay.classList.add('open')");
    assert.notEqual(ovIdx, -1, 'overlay open call not found');
    assert.match(openUD.slice(Math.max(0, ovIdx - 60), ovIdx), /\}\s*else\s*\{/,
      'the overlay is primary-only — it must be in the else of the inCompanion branch');
    assert.match(openUD, /if \(inCompanion\) \{\s*panel\.classList\.add\('open'\)/,
      'the dock opens the companion panel rather than the overlay');
  });

  it('REFUSES property-beside-property (the singleton caches would collide)', () => {
    assert.match(openCP, /_activePrimaryKind === 'property'/);
    assert.match(openCP, /showToast\(/);
    // …and it still opens the property, in the primary slot, rather than dropping the click.
    const refusal = openCP.slice(openCP.indexOf("_activePrimaryKind === 'property'"));
    assert.match(refusal.slice(0, 320), /openUnifiedDetail\(db, \{ property_id: propertyId \}, summary\)/);
  });

  it('delegates to the FULL panel — no summary card, and the tab bar is shown', () => {
    assert.match(openCP, /openUnifiedDetail\(db, \{ property_id: propertyId \}, summary, null, \{ mount: 'companion' \}\)/);
    assert.match(openUD, /tabsEl\.style\.display = ''/,
      'the dock hid the tab bar for the old summary card; the full panel must show it');
  });

  it('the dock header is COMPACT — 620px cannot carry the primary header furniture', () => {
    // Seen live: at 620px the title wrapped to three lines, the key-field strip
    // re-printed "Address:" under a title that IS the address, and the comps /
    // Consolidate / Dossier controls pushed the panel controls onto their own row.
    assert.match(openUD, /_compactHeader \? '' : _udKeyFields/,
      'the key-field strip must be dropped in the dock');
    assert.match(openUD, /_compactHeader \? '' : _udLeaseCompsControlHtml/);
    assert.match(openUD, /inCompanion \? '' : `<button class="detail-action-btn" title="Open a print-ready property dossier"/,
      'Dossier/Consolidate must be dropped from the dock loading header');
    // …and the title must ellipsize rather than wrap, in BOTH header renders.
    const ell = openUD.match(/white-space:nowrap;overflow:hidden;text-overflow:ellipsis/g) || [];
    assert.ok(ell.length >= 2, `expected both header renders to ellipsize the title, found ${ell.length}`);
  });

  it('closing the dock re-aims the mount pointer so a later refresh cannot render into nothing', () => {
    assert.match(closeCo, /_companionState\.kind === 'property'\)\s*_udMount = 'primary'/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§2 STRUCTURAL — the CRM stack actually left the property panel', () => {
  // Strip comments before asserting: the tab carries a deliberate "MOVED TO THE
  // OWNER PANEL" note that NAMES each removed surface, and a naive substring
  // search would match the documentation of the removal rather than the code.
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const ownershipTab = stripComments(sliceFn(detailSrc, '_udTabOwnership'));

  const gone = [
    ['Log Call / Activity form',    /Log Call \/ Activity/],
    ['activity-type select',        /udLogType/],
    ['Draft Email engine',          /udDraftTemplate|Draft Email/],
    ['Recent Touchpoints host',     /udTouchpoints/],
    ['Salesforce Activity Feed host', /udActivityFeed/],
    ['contact-name write input',    /udOwnContact/],
    ['contact-phone write input',   /udOwnPhone/],
    ['contact-email write input',   /udOwnEmail/],
    ['Ownership Assistant',         /_udAssistantSection\('ownership'/],
    ['per-row CRM coverage bar',    /CRM Coverage/],
    ['per-row Begin Prospecting',   /_udOwnerBeginProspecting/],
    ['async CRM loaders',           /_loadTouchpoints\(|_loadActivityFeed\(|_loadEmailTemplates\(/],
  ];
  for (const [label, re] of gone) {
    it(`property Ownership tab no longer renders: ${label}`, () => {
      assert.ok(!re.test(ownershipTab), `${label} is still present on the property Ownership tab`);
    });
  }

  it('the tab keeps its ASSET-scoped responsibilities', () => {
    assert.match(ownershipTab, /_udCurrentOwnerCard/,   'current owner card missing');
    assert.match(ownershipTab, /_udOwnershipLadder/,    'ownership ladder missing');
    assert.match(ownershipTab, /Ownership History/,     'ownership chain missing');
    assert.match(ownershipTab, /Resolve Ownership/,     'resolve-ownership form missing');
  });

  it('and ends in the hand-off to the owner panel', () => {
    assert.match(ownershipTab, /_udOwnerHandoffCard/);
  });

  it('the tab is registered as "Ownership", with the legacy name still routable', () => {
    assert.match(detailSrc, /const tabs = \[[^\]]*'Ownership'[^\]]*\]/,
      'tab registry should list Ownership');
    assert.ok(!/const tabs = \[[^\]]*'Ownership & CRM'/.test(detailSrc),
      'tab registry should no longer list "Ownership & CRM"');
    assert.match(detailSrc, /case 'ownership & crm':\s*return 'Ownership'/,
      'legacy deep-links / DB-sourced rail chips must still resolve');
    assert.match(detailSrc, /case 'Ownership & CRM': return _udTabOwnership\(\)/,
      'legacy render alias must still dispatch');
  });

  it('Overview Actions no longer offers Log Touchpoint (a party action on an asset)', () => {
    const actions = sliceFn(detailSrc, '_udActionButtons');
    assert.ok(!/log_touchpoint/.test(actions), 'Log Touchpoint is still on the property Overview');
    assert.match(actions, /Add to Pipeline/, 'asset-scoped actions should remain');
  });

  it('the completeness rail is capped at 4 chips so the Next-step card stays above the fold', () => {
    assert.match(detailSrc, /const top = missing\.slice\(0, 4\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('never-clobber — removing the contact inputs must not null curated data', () => {
  const save = sliceFn(detailSrc, '_udSaveOwnership');

  it('detects whether the contact form is rendered at all', () => {
    assert.match(save, /_contactFormPresent\s*=\s*!!document\.getElementById\('udOwnContact'\)/);
  });

  it('REGRESSION: contact_1_name is OMITTED from the payload when the form is absent', () => {
    // With the inputs deleted, `contactName` reads null on every save. If the
    // key were still sent unconditionally, each "Save Ownership Resolution"
    // would PATCH true_owners.contact_1_name to null.
    assert.ok(!/contact_1_name:\s*contactName/.test(save),
      'contact_1_name must not be set unconditionally in the payload literal');
    assert.match(save, /if \(_contactFormPresent\) trueOwnerPayload\.contact_1_name/,
      'contact_1_name must be gated on the form being present');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§1.1 STRUCTURAL — panel widths are var-driven and the shell is coherent', () => {
  it('the width tokens are declared once, on :root', () => {
    assert.match(stylesSrc, /--panel-primary-w:\s*720px/);
    assert.match(stylesSrc, /--panel-companion-w:\s*620px/);
  });

  it('REGRESSION: no hard-coded 520px panel offset survives', () => {
    // Three hard-coded `right: 520px` / `max-width: 520px` values were the
    // reason the primary panel could never be widened.
    const offenders = stylesSrc.split('\n').filter(l =>
      /\.detail-panel|\.companion-panel|\.companion-min|#panelResizer/.test(l) && /520px|480px/.test(l));
    assert.deepEqual(offenders, [], `hard-coded panel widths remain:\n${offenders.join('\n')}`);
  });

  it('the companion and both resizers offset off the primary var', () => {
    assert.match(stylesSrc, /\.companion-panel\s*\{[^}]*right:\s*var\(--panel-primary-w\)/);
    assert.match(stylesSrc, /#panelResizerPrimary\s*\{\s*right:\s*calc\(var\(--panel-primary-w\) - 8px\)/);
    assert.match(stylesSrc, /#panelResizerCompanion\s*\{\s*right:\s*calc\(var\(--panel-primary-w\) \+ var\(--panel-companion-w\) - 8px\)/);
  });

  it('the dual-dock threshold clears the two new default widths', () => {
    const m = detailSrc.match(/const DUAL_DOCK_MIN_WIDTH = (\d+)/);
    assert.ok(m, 'DUAL_DOCK_MIN_WIDTH not found');
    assert.ok(Number(m[1]) >= 720 + 620 - 200,
      `threshold ${m[1]} is too low for a 720+620 dual dock`);
  });

  it('the tray + resizer + companion nodes all exist in the document', () => {
    for (const id of ['panelTray', 'panelResizerPrimary', 'panelResizerCompanion', 'companionPanel']) {
      assert.ok(indexSrc.includes(`id="${id}"`), `#${id} missing from index.html`);
    }
  });

  it('REGRESSION: cache busters moved together on every file this change touched', () => {
    // A client that gets new index.html + new styles.css but a cached old
    // detail.js has the new CSS hiding the old restore tab — minimizing the
    // companion becomes unrecoverable.
    const v = (f) => (indexSrc.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)')) || [])[1];
    // W6.5 Stage 2: detail-rent.js was extracted OUT of detail.js and shares its
    // global scope, so a fresh detail.js paired with a cached detail-rent.js is
    // exactly the stale mix this guard exists to prevent — it joins the set.
    const versions = { 'app.js': v('app.js'), 'detail.js': v('detail.js'), 'detail-rent.js': v('detail-rent.js'), 'ops.js': v('ops.js'), 'styles.css': v('styles.css') };
    for (const [f, ver] of Object.entries(versions)) assert.ok(ver, `${f} has no ?v= cache buster`);
    assert.equal(new Set(Object.values(versions)).size, 1,
      `cache busters disagree: ${JSON.stringify(versions)}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
describe('UI-1/2/3 — defects from the 2026-08-15 manual run', () => {
  it('UI-2: every owner chip goes through ONE router', () => {
    // Before: `.owner-link` CLICK docked-or-drawered, KEYDOWN always drawered,
    // and entityLink had two more paths — so which surface opened depended on
    // where the chip was rendered and how you activated it.
    assert.match(detailSrc, /function _openOwnerChip\(/, '_openOwnerChip router missing');
    const handlers = [...detailSrc.matchAll(/closest\('\.owner-link\[data-owner-ctx\]'\)[\s\S]{0,320}?\n\}\);/g)]
      .map(m => m[0]);
    assert.ok(handlers.length >= 2, 'expected both a click and a keydown owner-link handler');
    for (const h of handlers) {
      assert.match(h, /_openOwnerChip\(/, 'an owner-link handler still bypasses the shared router');
    }
  });

  it('UI-2: docking requires a primary panel that is actually OPEN', () => {
    // `_activePrimaryKind` is set on open but was never cleared, so a stale
    // 'property' could dock a lone companion beside nothing.
    for (const fn of ['_openEntitySmart', '_openEntityByNameSmart', '_openOwnerChip']) {
      const src = sliceFn(detailSrc, fn);
      assert.match(src, /_panelPrimaryOpen\(\)/,
        `${fn} decides to dock without checking that a primary panel is open`);
    }
    assert.match(detailSrc, /function _panelPrimaryOpen\(/);
  });

  it('UI-2: closing the detail panel clears the primary-kind flag', () => {
    const appSrc = readFileSync(join(root, 'app.js'), 'utf8');
    const close = sliceFn(appSrc, 'closeDetail');
    assert.match(close, /_setPrimaryKind\(null\)/, 'closeDetail must clear _activePrimaryKind');
  });

  it('UI-1: the resize strip is anchored to the panel\'s real rect, not the CSS var', () => {
    assert.match(detailSrc, /function _panelAnchorResizer\(/);
    const anchor = sliceFn(detailSrc, '_panelAnchorResizer');
    assert.match(anchor, /getBoundingClientRect\(\)/,
      'must measure the panel; a var-derived offset drifts when the rendered width differs');
    const sync = sliceFn(detailSrc, '_panelSyncResizers');
    assert.match(sync, /_panelAnchorResizer\(/, 'sync must re-anchor the strips');
  });

  it('UI-1: the resize strip is visually discoverable', () => {
    // It was a fully transparent 8px zone — the handler worked, nobody could
    // find it. The hairline and the grip must paint by default, not on hover.
    const before = stylesSrc.match(/\.panel-resizer::before\s*\{([^}]*)\}/);
    const after = stylesSrc.match(/\.panel-resizer::after\s*\{([^}]*)\}/);
    assert.ok(before, '.panel-resizer::before rule missing');
    assert.ok(after, '.panel-resizer::after grip missing');
    assert.ok(!/background:\s*transparent/.test(before[1]),
      'the hairline is still transparent by default — undiscoverable');
  });

  it('UI-1: the inner strip SPLITS the pair — reproduces Scott\'s live geometry', () => {
    // Live capture 2026-08-15: innerWidth 1534, companion 194..814 (w620),
    // primary 814..1534 (w720), strip 814..822 — bound, open, correctly placed.
    // The old drag grew the primary into the 120px sliver behind the pair, so
    // the clamp allowed 720 -> 794: SEVENTY-FOUR pixels, which reads as "does
    // not drag". A divider must reallocate, holding the pair total constant.
    const src = sliceFn(detailSrc, '_panelInitResizers');
    assert.match(src, /splitMode/, 'no split mode — the inner strip is not a divider');
    assert.match(src, /companionPanel/, 'split must be conditional on the companion being open');
    assert.match(src, /_panelSetWidthExact/,
      'split must bypass the viewport clamp; the pair total already fits by construction');
    assert.match(src, /_panelSyncResizers\(\)/,
      'the strip writes an inline `right`, so it must re-anchor during the drag');

    // Simulate the split arithmetic on the real numbers.
    const MIN_P = 420, MAX_P = 1100, MIN_C = 360, MAX_C = 900;
    const total = 720 + 620;               // 1340
    const split = (dx) => {
      let p = Math.max(MIN_P, Math.min(MAX_P, 720 + dx));
      let c = Math.max(MIN_C, Math.min(MAX_C, total - p));
      p = Math.max(MIN_P, Math.min(MAX_P, total - c));
      return { p, c };
    };
    const wide = split(260);   // drag 260px left
    assert.equal(wide.p + wide.c, total, 'the pair total must be conserved');
    assert.ok(wide.p >= 940, `expected real travel, got primary ${wide.p} (old clamp capped at 794)`);
    assert.ok(wide.c >= MIN_C, 'companion must never go below its minimum');

    const narrow = split(-250);
    assert.equal(narrow.p + narrow.c, total, 'the pair total must be conserved both ways');
    assert.ok(narrow.p >= MIN_P && narrow.c <= MAX_C);

    // And the pair must still fit the viewport it started in.
    assert.ok(wide.p + wide.c <= 1534, 'split must not overflow the viewport');
  });

  it('UI-3: swap explains itself instead of failing silently', () => {
    const swap = sliceFn(detailSrc, '_panelSwap');
    assert.match(swap, /Swap needs two panels/,
      'pressing swap with one panel open must say why, not look broken');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
describe('the panel resolves its own asset entity by ID, not by address string', () => {
  // Found live 2026-08-16 driving the browser. openUnifiedDetail looked its own
  // asset entity up by ADDRESS even though it holds the exact domain property
  // id. Address is a fuzzy string compare and missed on ordinary variation —
  //   panel  "3233 East Coliseum Blvd."  vs  entity "3233 E Coliseum Blvd"
  // — so `ent` was null, `ent.property_owner` never arrived, and the Current
  // Owner card + "Work this owner ->" silently did not render, even though
  // lcc_property_owner held the answer at confidence 1.0 and the API returned
  // it correctly when asked by id. 2,117 assets carry both an exact
  // domain_property_id and a resolved owner.
  const region = (() => {
    const s = detailSrc.indexOf('const lookupAddr =');
    assert.notEqual(s, -1, 'lookup block not found');
    return detailSrc.slice(s, s + 4200);
  })();

  it('tries domain_property_id + domain before address', () => {
    const idAt = region.indexOf('domain_property_id');
    const addrAt = region.indexOf("action: 'lookup_asset', address:");
    assert.notEqual(idAt, -1, 'no id-based lookup_asset call');
    assert.notEqual(addrAt, -1, 'address fallback should still exist');
    assert.ok(idAt < addrAt, 'the id lookup must be attempted FIRST');
  });

  it('still falls back to address when there is no domain property id', () => {
    assert.match(region, /if \(!ent && lookupAddr\)/,
      'address lookup must remain as the fallback for assets with no domain id');
  });

  it('an id-lookup failure cannot abort the panel load', () => {
    assert.match(region, /catch \(_eId\)/,
      'the id attempt must be wrapped so a failure falls through rather than throwing');
  });

  it('still attaches property_owner to the ownership cache', () => {
    assert.match(region, /ownership\.lcc_property_owner = ent\.property_owner/,
      'the Current Owner card + hand-off depend on this attach');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§4.2 side-by-side — the companion hosts the FULL entity panel', () => {
  // Scott, 2026-08-15: "we want to see the full detail side-by-side instead of
  // a placeholder that you can swap over to the primary." The dock used to
  // render a summary card with an "Open full detail ↗" button.
  const openEntity = sliceFn(detailSrc, 'openEntityDetail');
  const switchTab = sliceFn(detailSrc, 'switchEntityTab');
  const openCompEntity = sliceFn(detailSrc, 'openCompanionEntity');

  it('openEntityDetail accepts a companion mount and resolves the dock elements', () => {
    assert.match(openEntity, /opts && opts\.mount === 'companion'/);
    for (const id of ['companionHeader', 'companionTabs', 'companionBody']) {
      assert.ok(openEntity.includes(id), `mount must resolve ${id}`);
    }
  });

  it('primary-only chrome is skipped in the dock', () => {
    // Stealing the primary kind, driving the overlay, or rewriting the hash from
    // the dock would break the property that still owns the route.
    assert.match(openEntity, /if \(!inCompanion\) \{[\s\S]*_setPrimaryKind/,
      '_setPrimaryKind must be primary-only');
    assert.match(openEntity, /if \(!inCompanion\)[\s\S]{0,400}_routeSetDetailHash/,
      'hash routing must be primary-only');
    assert.match(openEntity, /!inCompanion && \(role === 'owner'/,
      'the rail/next-step chrome lives in the primary DOM only');
  });

  it('the dock tab bar routes back to the dock, not the primary body', () => {
    assert.match(openEntity, /_mountArg = inCompanion \? ", 'companion'" : ''/,
      'tab handlers must carry the mount');
    assert.match(switchTab, /function switchEntityTab\(tabName, mount\)/);
    assert.match(switchTab, /inCompanion \? 'companionBody' : 'detailBody'/);
    assert.match(switchTab, /#companionTabs \.detail-tab/);
  });

  it('a dock tab change does NOT rewrite the hash', () => {
    assert.match(switchTab, /!inCompanion && typeof _routeUpdateTabHash/,
      '`?d=` encodes one subject — the dock must not claim it');
  });

  it('REGRESSION: the single _entityDetailCache forbids entity-beside-entity', () => {
    // _entityDetailCache is a module singleton, so two entity panels would
    // corrupt each other. Refuse explicitly rather than silently.
    assert.match(openCompEntity, /_activePrimaryKind === 'entity'/,
      'docking an entity beside an entity must be refused');
    assert.match(openCompEntity, /openEntityDetail\(entityId\);/,
      'the refusal should still open the entity, just in the primary slot');
  });

  it('the companion opens the real panel, not the summary card', () => {
    assert.match(openCompEntity, /openEntityDetail\(entityId, undefined, \{ mount: 'companion' \}\)/);
  });

  it('the dock header has no Back button — it would drive the PRIMARY back-stack', () => {
    // `detailBack()` walks _detailStack, which belongs to the primary
    // slide-over. A Back button in the dock would navigate the wrong panel.
    const backs = [...openEntity.matchAll(/class="detail-back"/g)];
    assert.ok(backs.length >= 1, 'the primary header should still have Back');
    for (const m of backs) {
      const line = openEntity.slice(Math.max(0, m.index - 120), m.index + 40);
      assert.match(line, /inCompanion \? ''/,
        'every detail-back in the entity panel must be suppressed in companion mode');
    }
  });

  it('a property docked after an entity does not inherit its tab bar', () => {
    const openCompProp = sliceFn(detailSrc, 'openCompanionProperty');
    assert.match(openCompProp, /companionTabs/,
      'the shared dock must clear the entity tab bar when a property takes it');
  });
});

describe('V-2 generalised — no inline onclick may hand-roll quote escaping', () => {
  // The original V-2 fix touched ONE call site. The same broken idiom
  // `esc(x).replace(/'/g, "\\'")` — a no-op, because esc() already produced
  // &#39; — survived in `entityLink`, the app's main party-chip factory, so
  // every O'Brien / D'Angelo chip emitted a SyntaxError handler.
  const offenders = detailSrc.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\.replace\(\/'\/g/.test(l) && /onclick=/.test(l));

  it('detail.js has no remaining hand-rolled quote escaping inside an onclick', () => {
    assert.deepEqual(offenders.map(([n]) => n), [],
      'use _jsStrArg(); offending lines:\n' + offenders.map(([n, l]) => `  ${n}: ${l.trim().slice(0, 120)}`).join('\n'));
  });

  it('entityLink round-trips an apostrophe through every name-based branch', () => {
    const entityLinkSrc = detailSrc.slice(
      detailSrc.indexOf('window.entityLink = function'),
      detailSrc.indexOf('window.entityLink = function') + 4000);
    for (const branch of ['openContactDetailByName', '_openEntityByNameSmart', 'navToState']) {
      const line = entityLinkSrc.split('\n').find(l => l.includes(branch + '('));
      assert.ok(line, `branch ${branch} not found`);
      assert.match(line, new RegExp(branch + '\\(\' \\+ _jsStrArg\\(text\\)|' + branch + '\\(\' \\+ _jsStrArg'),
        `${branch} does not use _jsStrArg`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('§3.1 owner panel — the cross-links point at tabs that exist', () => {
  it('the completeness-rail chip targets a live tab name', () => {
    // It pointed at "Portfolio", which is not in any role tab set, so
    // switchEntityTab bounced the click back to tab 0.
    const rail = sliceFn(detailSrc, '_entityRenderCompletenessRail');
    const targets = [...rail.matchAll(/switchEntityTab\(&quot;([^&]+)&quot;\)/g)].map(m => m[1]);
    const roleSets = sliceFn(detailSrc, '_entityTabsForRole');
    for (const t of targets) {
      assert.ok(roleSets.includes(`'${t}'`), `rail chip targets "${t}", which no role tab set contains`);
    }
  });

  it('the Deal tab no longer repeats the Property tab snapshot', () => {
    const ref = sliceFn(detailSrc, '_dealPropertyRef');
    for (const f of ['tenancy.tenant', 'tenancy.guarantor', 'tenancy.term_remaining_years', 'ident.building_sf']) {
      assert.ok(!ref.includes(f), `_dealPropertyRef still duplicates ${f} from the Property tab`);
    }
  });
});
