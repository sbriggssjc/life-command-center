// W6.5 Stage 1 (Prompt 87) — front-end decomposition load-order smoke test.
//
// The SPA is served statically by Railway/Express with NO bundler: JS files are
// classic <script> tags concatenated into one global scope, so LOAD ORDER is the
// dependency mechanism. Stage 1 extracted the Decision Center federated lanes from
// ops.js into dc-lanes.js. This guard pins the invariants that keep that split
// behavior-identical, so a later reorder / rename can't silently break the app:
//   1. dc-lanes.js is loaded, as a classic (non-module) script, BEFORE ops.js.
//   2. dc-lanes.js and ops.js are both syntactically valid.
//   3. The federated surface lives in dc-lanes.js; the lane partition + seeded
//      renderers stay in ops.js (the two halves don't both define the same thing).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function scriptIndex(file) {
  // Match a classic <script src="file?v=..."></script> tag (module tags excluded).
  const re = new RegExp('<script\\s+src="' + file.replace('.', '\\.') + '(\\?[^"]*)?"\\s*>', 'i');
  const m = html.match(re);
  return m ? m.index : -1;
}

describe('W6.5 front-end module load order (no-bundler classic scripts)', () => {
  it('dc-lanes.js is present in index.html', () => {
    assert.ok(scriptIndex('dc-lanes.js') >= 0, 'index.html must load dc-lanes.js');
  });

  it('ops.js is present in index.html', () => {
    assert.ok(scriptIndex('ops.js') >= 0, 'index.html must load ops.js');
  });

  it('dc-lanes.js loads BEFORE ops.js (federated globals defined first)', () => {
    const dc = scriptIndex('dc-lanes.js');
    const ops = scriptIndex('ops.js');
    assert.ok(dc >= 0 && ops >= 0, 'both scripts must be present');
    assert.ok(dc < ops, 'dc-lanes.js must appear before ops.js in index.html');
  });

  it('dc-lanes.js is a CLASSIC script (not type="module"), matching ops.js', () => {
    // A module would get its own scope and break the shared-global contract.
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="dc-lanes\.js/i,
      'dc-lanes.js must be a classic script, not a module');
  });

  it('dc-lanes.js and ops.js both parse (node --check)', () => {
    for (const f of ['dc-lanes.js', 'ops.js']) {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, f)]),
        `${f} must be syntactically valid`);
    }
  });

  // ── Stage 2, Unit 1: detail-rent.js ──────────────────────────────────────
  it('detail-rent.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const rent = scriptIndex('detail-rent.js');
    const detail = scriptIndex('detail.js');
    assert.ok(rent >= 0, 'index.html must load detail-rent.js');
    assert.ok(detail >= 0, 'index.html must load detail.js');
    assert.ok(rent < detail, 'detail-rent.js must appear before detail.js in index.html');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-rent\.js/i,
      'detail-rent.js must be a classic script, not a module');
  });

  it('detail-rent.js and detail.js both parse (node --check)', () => {
    for (const f of ['detail-rent.js', 'detail.js']) {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, f)]),
        `${f} must be syntactically valid`);
    }
  });

  it('the rent POLICY moved to detail-rent.js; the rent RENDERERS stayed in detail.js', () => {
    const rentSrc = readFileSync(join(root, 'detail-rent.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    // Moved: the four pure helpers now live in detail-rent.js ONLY.
    for (const fn of ['_udProjectRent', '_udPickCurrentRent', '_udParseRentEscalation', '_udBuildRentSchedule']) {
      assert.match(rentSrc, new RegExp(`function\\s+${fn}\\b`), `detail-rent.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    // Stayed: the UI renderers + the shared date coercer remain in detail.js ONLY.
    for (const fn of ['_udRenderRentChart', '_udRenderRentRoll', '_udRentPsfTagHtml', '_udCoerceDate']) {
      assert.match(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js keeps ${fn}`);
      assert.doesNotMatch(rentSrc, new RegExp(`function\\s+${fn}\\b`), `detail-rent.js must NOT copy ${fn}`);
    }
    // A pointer comment is left where the region was, so the seam is findable.
    assert.match(detailSrc, /MOVED to detail-rent\.js/, 'detail.js keeps a pointer comment at the extraction site');
  });

  // ── Stage 2, Unit 2: detail-tab-documents.js ─────────────────────────────
  it('detail-tab-documents.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const docs = scriptIndex('detail-tab-documents.js');
    const detail = scriptIndex('detail.js');
    assert.ok(docs >= 0, 'index.html must load detail-tab-documents.js');
    assert.ok(docs < detail, 'detail-tab-documents.js must appear before detail.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-tab-documents\.js/i,
      'detail-tab-documents.js must be a classic script, not a module');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'detail-tab-documents.js')]),
      'detail-tab-documents.js must be syntactically valid');
  });

  it('the Documents tab moved whole — renderers AND the section table', () => {
    const docsSrc = readFileSync(join(root, 'detail-tab-documents.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    for (const fn of ['_udRenderDocumentsAsync', '_udRenderDossiers', '_udRenderDocuments',
                      '_udOpenDossier', '_udOpenDocument',
                      '_udBuildPropertyDossierHTML', '_udOpenClientDossier']) {
      assert.match(docsSrc, new RegExp(`function\\s+${fn}\\b`), `detail-tab-documents.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    // The section table is only meaningful with its renderers — it moves too.
    assert.match(docsSrc, /const\s+_UD_DOC_SECTIONS\s*=/, 'detail-tab-documents.js owns _UD_DOC_SECTIONS');
    assert.doesNotMatch(detailSrc, /const\s+_UD_DOC_SECTIONS\s*=/, 'detail.js must NOT redefine _UD_DOC_SECTIONS');
    // window.* exports feed inline onclick handlers — they must survive the move.
    for (const w of ['_udOpenDossier', '_udOpenDocument', '_udBuildPropertyDossierHTML']) {
      assert.match(docsSrc, new RegExp(`window\\.${w}\\s*=`), `detail-tab-documents.js keeps the window.${w} export`);
    }
    assert.match(detailSrc, /MOVED to detail-tab-documents\.js/, 'detail.js keeps a pointer comment');
  });

  // ── Stage 2, Unit 3: detail-panel-shell.js ───────────────────────────────
  it('detail-panel-shell.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const shell = scriptIndex('detail-panel-shell.js');
    const detail = scriptIndex('detail.js');
    assert.ok(shell >= 0, 'index.html must load detail-panel-shell.js');
    assert.ok(shell < detail, 'detail-panel-shell.js must appear before detail.js — '
      + 'its top-level lets (_companionState, _panelParked, _activePrimaryKind) are read from detail.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-panel-shell\.js/i,
      'detail-panel-shell.js must be a classic script, not a module');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'detail-panel-shell.js')]),
      'detail-panel-shell.js must be syntactically valid');
  });

  it('the panel SHELL moved; the tab shell + entity tabs stayed in detail.js', () => {
    const shellSrc = readFileSync(join(root, 'detail-panel-shell.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    for (const fn of ['_dualCapable', '_panelClampWidth', '_panelSetWidth', '_panelRestoreWidths',
                      '_panelInitResizers', '_panelSyncResizers', '_panelTrayRender', '_panelParkSig',
                      '_panelTrayPark', '_panelTrayRestore', '_panelSwap', 'minimizePrimary',
                      'openCompanionProperty', 'openCompanionEntity', '_renderCompanionEntity',
                      'closeCompanion', '_setPrimaryKind']) {
      assert.match(shellSrc, new RegExp(`function\\s+${fn}\\b`), `detail-panel-shell.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    // Mutable panel state moves WITH its owners, or the two files disagree.
    for (const decl of ['let\\s+_companionState', 'let\\s+_panelParked', 'let\\s+_activePrimaryKind',
                        'const\\s+_PANEL_W', 'const\\s+DUAL_DOCK_MIN_WIDTH']) {
      assert.match(shellSrc, new RegExp(decl), `detail-panel-shell.js owns ${decl}`);
      assert.doesNotMatch(detailSrc, new RegExp(decl), `detail.js must NOT redeclare ${decl}`);
    }
    // The TAB shell is a different thing and must NOT have followed.
    for (const fn of ['openUnifiedDetail', 'switchUnifiedTab', '_udMapLegacyTab']) {
      assert.match(detailSrc, new RegExp(`function\\s+${fn}\\b`), `${fn} stays in detail.js`);
    }
    assert.match(detailSrc, /MOVED to detail-panel-shell\.js/, 'detail.js keeps a pointer comment');
  });

  it('every window.* export survives the panel-shell move (inline onclick targets)', () => {
    // These are reached from onclick="" at CLICK time, off `window` — not through
    // lexical scope. Lose one and the UI renders fine and dies on interaction.
    const shellSrc = readFileSync(join(root, 'detail-panel-shell.js'), 'utf8');
    const exports = [
      '_activePrimaryKind', '_companionEnlargeEntity', '_companionOpenFull', '_entityDrillProperty',
      '_openEntityByNameSmart', '_openEntitySmart', '_panelHeaderControls', '_panelSetWidth',
      '_panelSwap', '_panelSyncResizers', '_panelTrayDrop', '_panelTrayPark', '_panelTrayRestore',
      'closeCompanion', 'minimizeCompanion', 'minimizePrimary', 'openCompanionEntity',
      'openCompanionProperty', 'restoreCompanion',
    ];
    const missing = exports.filter((e) => !new RegExp(`window\\.${e}\\s*=`).test(shellSrc));
    assert.deepEqual(missing, [], `window export(s) lost in the move — onclick handlers would break: ${missing.join(', ')}`);
  });

  // ── Stage 2, Unit 4: detail-entity-tabs.js ───────────────────────────────
  it('detail-entity-tabs.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const tabs = scriptIndex('detail-entity-tabs.js');
    const detail = scriptIndex('detail.js');
    assert.ok(tabs >= 0, 'index.html must load detail-entity-tabs.js');
    assert.ok(tabs < detail, 'detail-entity-tabs.js must appear before detail.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-entity-tabs\.js/i,
      'detail-entity-tabs.js must be a classic script, not a module');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'detail-entity-tabs.js')]),
      'detail-entity-tabs.js must be syntactically valid');
  });

  it('entity tab BODIES moved; the entity DISPATCHER stayed in detail.js', () => {
    const tabsSrc = readFileSync(join(root, 'detail-entity-tabs.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    for (const fn of ['_entityTabRelationships', '_entityTabHistory', '_entityTabActivity',
                      '_entityTabEngagement', '_entityTabRoe', '_entityTabPropertyRef',
                      '_entityTabDeal', '_entityCadenceCockpit', '_dealOpenSource', '_dealInspectSource']) {
      assert.match(tabsSrc, new RegExp(`function\\s+${fn}\\b`), `detail-entity-tabs.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    // The DISPATCHER is the shell for the entity panel — same split the property
    // panel keeps between switchUnifiedTab and its tab bodies.
    for (const fn of ['_renderEntityTab', 'switchEntityTab', 'openEntityDetail']) {
      assert.match(detailSrc, new RegExp(`function\\s+${fn}\\b`), `${fn} is the entity dispatcher and stays in detail.js`);
      assert.doesNotMatch(tabsSrc, new RegExp(`function\\s+${fn}\\b`), `detail-entity-tabs.js must NOT take ${fn}`);
    }
    assert.match(detailSrc, /const\s+ENTITY_DETAIL_TABS\s*=/, 'the tab list stays with the dispatcher');
    // Unit 5 completed the set — no _entityTab* body may remain in detail.js.
    const strays = [...detailSrc.matchAll(/^function\s+(_entityTab[A-Za-z]+)\s*\(/gm)]
      .map((m) => m[1])
      // Unit 6 moved _entityTabOverview + its helper cluster, so its carve-out is
      // GONE — the only exclusion left is _entityTabsForRole, which is a tab-LIST
      // helper belonging to the dispatcher, not a tab body. The guard got stricter
      // as a result of the move; that is how you know the move was complete.
      .filter((n) => n !== '_entityTabsForRole');
    assert.deepEqual(strays, [],
      `entity tab BODY left behind in detail.js — it belongs with its siblings: ${strays.join(', ')}`);
    for (const fn of ['_entityTabContactDeals', '_entityTabBrokerDeals', '_entityTabPortfolio',
                      '_entityTabContacts', '_entityGenerateDossier', '_entityOpenDossierMenu',
                      '_entityTabOverview', '_entityHeroHTML', '_nextActionForContact',
                      '_entityRoeBanner', '_entityFmtMoney']) {
      assert.match(tabsSrc, new RegExp(`function\\s+${fn}\\b`), `detail-entity-tabs.js defines ${fn}`);
    }
    // Shared chrome writes the SAME DOM nodes as the property panel — it is shell.
    assert.match(detailSrc, /function\s+_entityRenderCompletenessRail\b/,
      'the shared completeness rail stays in detail.js (it is shell, not tab content)');
    // ⚠️ Unit 6's four exports were MISSING from this list on the first pass and
    // the mutation test caught it: dropping window._nextActionForContact broke
    // the hero CTA's onclick and every one of the 113 assertions still passed.
    // A window export is only guarded if it is NAMED here — adding the function
    // to the definition list above does nothing for it.
    for (const w of ['_cortexPullHistory', '_dealOpenSource', '_dealInspectSource',
                     '_entityGenerateDossier', '_entityOpenDossierMenu',
                     '_nextActionForContact', '_entityOpenContactProperty',
                     '_entityDraftAndLog', '_entityCopyDraft']) {
      assert.match(tabsSrc, new RegExp(`window\\.${w}\\s*=`), `detail-entity-tabs.js keeps the window.${w} export`);
    }
    assert.match(detailSrc, /MOVED to detail-entity-tabs\.js/, 'detail.js keeps a pointer comment');
  });

  // ── Stage 2, Unit 7: detail-openers.js ───────────────────────────────────
  it('detail-openers.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const op = scriptIndex('detail-openers.js');
    assert.ok(op >= 0, 'index.html must load detail-openers.js');
    assert.ok(op < scriptIndex('detail.js'), 'detail-openers.js must appear before detail.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-openers\.js/i,
      'detail-openers.js must be a classic script — the openers rely on top-level '
      + 'function declarations becoming window properties, which modules do NOT do');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'detail-openers.js')]),
      'detail-openers.js must be syntactically valid');
  });

  it('the subject OPENERS moved; the panel opener + fetch layer stayed', () => {
    const opSrc = readFileSync(join(root, 'detail-openers.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    for (const fn of ['_ensureCallNoteModal', 'openCallNote', 'closeCallNote', 'submitCallNote',
                      'openContact360', 'openEntityDetailByName', 'openContactDetail',
                      'openContactDetailByName']) {
      assert.match(opSrc, new RegExp(`function\\s+${fn}\\b`), `detail-openers.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    assert.match(opSrc, /var\s+_callNoteCtx/, 'the modal state moves with its modal');
    assert.doesNotMatch(detailSrc, /var\s+_callNoteCtx/, 'detail.js must NOT redeclare _callNoteCtx');
    // These are what the openers delegate INTO — they stay.
    for (const fn of ['openEntityDetail', '_entityApiFetch', '_entityApiHeaders']) {
      assert.match(detailSrc, new RegExp(`function\\s+${fn}\\b`), `${fn} stays in detail.js`);
      assert.doesNotMatch(opSrc, new RegExp(`function\\s+${fn}\\b`), `detail-openers.js must NOT take ${fn}`);
    }
    for (const w of ['openCallNote', 'closeCallNote', 'submitCallNote', 'openContact360']) {
      assert.match(opSrc, new RegExp(`window\\.${w}\\s*=`), `detail-openers.js keeps the window.${w} export`);
    }
    assert.match(detailSrc, /MOVED to detail-openers\.js/, 'detail.js keeps a pointer comment');
  });

  // ── Stage 3, Unit 1: app-modal.js ────────────────────────────────────────
  it('app-modal.js is a CLASSIC script loaded BEFORE app.js', () => {
    const modal = scriptIndex('app-modal.js');
    assert.ok(modal >= 0, 'index.html must load app-modal.js');
    assert.ok(modal < scriptIndex('app.js'), 'app-modal.js must appear before app.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="app-modal\.js/i,
      'app-modal.js must be a classic script — lccConfirm/lccPrompt become window '
      + 'properties via top-level function declarations, which five other files rely on');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'app-modal.js')]),
      'app-modal.js must be syntactically valid');
  });

  it('the modal moved whole — state, dialogs, and its own DOM wiring', () => {
    const modalSrc = readFileSync(join(root, 'app-modal.js'), 'utf8');
    const appSrc = readFileSync(join(root, 'app.js'), 'utf8');
    for (const fn of ['_isModalOpen', '_showModal', '_closeModal', '_modalCancel',
                      'lccConfirm', 'lccPrompt']) {
      assert.match(modalSrc, new RegExp(`function\\s+${fn}\\b`), `app-modal.js defines ${fn}`);
      assert.doesNotMatch(appSrc, new RegExp(`function\\s+${fn}\\b`), `app.js must NOT redefine ${fn}`);
    }
    // Dialog state is useless apart from its dialogs — it moves with them.
    for (const d of ['_modalResolve', '_modalPrevFocus', '_modalIsPrompt']) {
      assert.match(modalSrc, new RegExp(`let\\s+${d}\\b`), `app-modal.js owns ${d}`);
      assert.doesNotMatch(appSrc, new RegExp(`let\\s+${d}\\b`), `app.js must NOT redeclare ${d}`);
    }
    // The listener block is what makes OK/Cancel/Esc work; leaving it behind
    // would give a modal that renders and never closes.
    assert.match(modalSrc, /DOMContentLoaded/, 'app-modal.js keeps its own DOM wiring');
    assert.match(modalSrc, /lcc-modal-ok/, 'app-modal.js keeps the OK-button wiring');
    // The ROUTER stays put — the map lumped this region into a 988-2300 "router"
    // range, which is wrong; hash routing is the spine and is extracted last, if ever.
    for (const fn of ['navTo', 'applyRoute', '_routeParseHash']) {
      assert.match(appSrc, new RegExp(`function\\s+${fn}\\b`), `${fn} (router) stays in app.js`);
      assert.doesNotMatch(modalSrc, new RegExp(`function\\s+${fn}\\b`), `app-modal.js must NOT take ${fn}`);
    }
    assert.match(appSrc, /MOVED to app-modal\.js/, 'app.js keeps a pointer comment');
  });

  // ── Stage 3, Unit 2: app-treasury-chart.js ───────────────────────────────
  it('app-treasury-chart.js is a CLASSIC script loaded BEFORE app.js', () => {
    const chart = scriptIndex('app-treasury-chart.js');
    assert.ok(chart >= 0, 'index.html must load app-treasury-chart.js');
    assert.ok(chart < scriptIndex('app.js'), 'app-treasury-chart.js must appear before app.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="app-treasury-chart\.js/i,
      'app-treasury-chart.js must be a classic script, not a module');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'app-treasury-chart.js')]),
      'app-treasury-chart.js must be syntactically valid');
  });

  it('the chart LOGIC moved but its wiring stayed — because that block boots the ROUTER', () => {
    const chartSrc = readFileSync(join(root, 'app-treasury-chart.js'), 'utf8');
    const appSrc = readFileSync(join(root, 'app.js'), 'utf8');
    for (const fn of ['loadMarket', 'yearsForRange', 'fetchYieldHistory', 'filterByRange',
                      'loadYieldChart', 'renderYieldSVG']) {
      assert.match(chartSrc, new RegExp(`function\\s+${fn}\\b`), `app-treasury-chart.js defines ${fn}`);
      assert.doesNotMatch(appSrc, new RegExp(`function\\s+${fn}\\b`), `app.js must NOT redefine ${fn}`);
    }
    for (const d of ['yieldHistoryCache', 'currentYieldRange']) {
      assert.match(chartSrc, new RegExp(`let\\s+${d}\\b`), `app-treasury-chart.js owns ${d}`);
      assert.doesNotMatch(appSrc, new RegExp(`let\\s+${d}\\b`), `app.js must NOT redeclare ${d}`);
    }
    // ⚠️ THE POINT OF THIS UNIT. The yieldChartControls handler shares a
    // DOMContentLoaded block with applyRoute(). Taking the block would have taken
    // the hash router with it. Both must remain in app.js, in the SAME block.
    // Assert on the CONSTRUCT, not the word: this file's own header explains the
    // shared-bootstrap decision, so a bare /DOMContentLoaded/ match fails on the
    // documentation. (It did, on the first run — the guard caught my own comment.)
    assert.doesNotMatch(chartSrc, /addEventListener\(\s*['"]DOMContentLoaded['"]/,
      'app-treasury-chart.js must NOT take the shared bootstrap — it boots the router');
    // ⚠️ Assert the CONSTRUCT, never the bare word — twice in this unit a word-match
    // was satisfied by a COMMENT while the real code was gone. Deleting the wiring
    // and leaving "yieldChartControls" in the pointer comment passed 123/123 on the
    // first mutation run. A guard that a comment can satisfy is not a guard.
    assert.match(appSrc, /getElementById\(\s*['"]yieldChartControls['"]\s*\)\s*\??\.addEventListener/,
      'app.js keeps the LIVE chart-controls wiring (not just a mention of it)');
    // (No loose applyRoute() assertion here: there are TWO call sites — the
    // hashchange handler at ~2519 and the bootstrap — so a bare match is satisfied
    // by the wrong one. The BLOCK assertion below is the real guard, and it pins
    // the bootstrap specifically.)
    const boot = appSrc.slice(appSrc.indexOf("addEventListener('DOMContentLoaded'"));
    const blockEnd = boot.indexOf('\n});');
    const block = boot.slice(0, blockEnd > 0 ? blockEnd : 3000);
    assert.ok(block.includes('applyRoute') && block.includes('yieldChartControls'),
      'the router bootstrap and the chart wiring must stay in the SAME DOMContentLoaded block — '
      + 'splitting them changes init ordering');
    assert.match(appSrc, /MOVED to app-treasury-chart\.js/, 'app.js keeps a pointer comment');
  });

  // ── Stage 3, Unit 3: app-export-comps.js ─────────────────────────────────
  it('app-export-comps.js is a CLASSIC script loaded BEFORE app.js', () => {
    const x = scriptIndex('app-export-comps.js');
    assert.ok(x >= 0, 'index.html must load app-export-comps.js');
    assert.ok(x < scriptIndex('app.js'), 'app-export-comps.js must appear before app.js');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="app-export-comps\.js/i,
      'app-export-comps.js must be a classic script, not a module');
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, 'app-export-comps.js')]),
      'app-export-comps.js must be syntactically valid');
  });

  it('the Excel export moved WITH its window export (two files onclick it)', () => {
    const xSrc = readFileSync(join(root, 'app-export-comps.js'), 'utf8');
    const appSrc = readFileSync(join(root, 'app.js'), 'utf8');
    assert.match(xSrc, /function\s+exportCompsToXlsx\b/, 'app-export-comps.js defines exportCompsToXlsx');
    assert.doesNotMatch(appSrc, /function\s+exportCompsToXlsx\b/, 'app.js must NOT redefine it');
    // ⚠️ The ONLY callers are inline onclick strings built by dialysis.js and
    // gov.js. They resolve off `window` at CLICK time — lose this line and both
    // Export buttons render and do nothing, with no error anywhere.
    assert.match(xSrc, /window\.exportCompsToXlsx\s*=\s*exportCompsToXlsx/,
      'app-export-comps.js MUST keep the window export — dialysis.js and gov.js onclick it');
    // And the callers must still be reaching it by that name.
    for (const f of ['dialysis.js', 'gov.js']) {
      assert.match(readFileSync(join(root, f), 'utf8'), /onclick="exportCompsToXlsx\(/,
        `${f} still invokes exportCompsToXlsx from an inline onclick`);
    }
    // Neighbours that deliberately stayed.
    assert.match(appSrc, /window\.renderLiveIngestWorkbench\s*=/, 'LiveIngest exports stay in app.js');
    assert.doesNotMatch(xSrc, /iPhone\|iPad/, 'the iOS install banner is not part of this region');
    assert.match(appSrc, /MOVED to app-export-comps\.js/, 'app.js keeps a pointer comment');
  });

  it('the federated surface lives in dc-lanes.js, the partition stays in ops.js', () => {
    const dcSrc = readFileSync(join(root, 'dc-lanes.js'), 'utf8');
    const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');
    // Moved: definitions now in dc-lanes.js only.
    assert.match(dcSrc, /const\s+_DC_FED_META\s*=/, 'dc-lanes.js defines _DC_FED_META');
    assert.match(dcSrc, /function\s+_fedCardHTML\b/, 'dc-lanes.js defines _fedCardHTML');
    assert.match(dcSrc, /function\s+renderFederatedLane\b/, 'dc-lanes.js defines renderFederatedLane');
    assert.doesNotMatch(opsSrc, /const\s+_DC_FED_META\s*=/, 'ops.js must NOT redefine _DC_FED_META');
    assert.doesNotMatch(opsSrc, /function\s+_fedCardHTML\b/, 'ops.js must NOT redefine _fedCardHTML');
    // Stayed: the lane partition primitive remains in ops.js only.
    assert.match(opsSrc, /_DC_FEDERATED\s*=\s*new Set\(/, 'ops.js keeps _DC_FEDERATED (the lane partition)');
    assert.doesNotMatch(dcSrc, /_DC_FEDERATED\s*=\s*new Set\(/, 'dc-lanes.js must NOT redefine _DC_FEDERATED');
  });
});
