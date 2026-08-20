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
