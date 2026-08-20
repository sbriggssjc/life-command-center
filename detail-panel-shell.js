// ─────────────────────────────────────────────────────────────────────────────
// detail-panel-shell.js — W6.5 Stage 2, Unit 3 (extracted from detail.js
// 2026-08-20). Moved VERBATIM from detail.js lines 13838-14546.
//
// The slide-over WINDOW-MANAGEMENT layer — geometry, not content:
//   panel widths + clamping   _PANEL_W, _panelClampWidth/Set/Get/RestoreWidths
//   drag resizers             _panelInitResizers/SyncResizers/AnchorResizer
//   minimize tray             _panelTrayRender/ParkSig/Park/Drop/Restore
//   dual-panel dock           DUAL_DOCK_MIN_WIDTH, _dualCapable, _companionState,
//                             openCompanionProperty/Entity, minimize/restore/
//                             closeCompanion, _panelSwap, minimizePrimary
//
// ⚠️ THE MAP WAS WRONG ABOUT THIS REGION. Its seam inventory folded these into
// "detail-entity.js" (range 13363-15267). They are NOT entity-tab renderers —
// they are the shell, and detail-tab-registry.test.mjs requires the shell to
// stay out of tab modules. They also sit BETWEEN the two halves of the entity
// tabs, which is why "extract the entity tabs" was never one region-move.
// See the CORRECTION block in w6-5-frontend-decomposition-map.md §2b.
//
// ⚠️ 18 window.* EXPORTS LIVE HERE and are reached from inline onclick=""
// strings at CLICK time, off `window` — not through lexical scope. Losing one
// leaves the UI rendering perfectly and dying on interaction. The load-order
// guard asserts every one of them survives.
//
// CLASSIC script loaded BEFORE detail.js. Its top-level `let`s (_companionState,
// _panelParked, _activePrimaryKind) are read from detail.js (lines ~136, 16100,
// 16117, 17164); because this file loads FIRST those bindings are initialized
// before detail.js evaluates, so both eval-time and call-time reads resolve.
// ─────────────────────────────────────────────────────────────────────────────

// ── Companion property dock (dual-panel, item #6) ─────────────────────────────
// Opens a focused property card BESIDE the contact/owner panel so both are
// visible at once. The row summary is looked up from the entity cache by index
// (no re-fetch, no escaping-in-onclick, no failure mode). "Open full ↗" promotes
// it to the main detail panel (the existing zoom path). On screens too narrow for
// two panels it falls back to the full single-panel open (existing behavior).
// Raised 980 → 1180 with the 2026-08-15 width bump (primary 520→720,
// companion 480→620): two panels at the new widths need the extra room, and
// below it we fall back to a single full-width panel exactly as before.
const DUAL_DOCK_MIN_WIDTH = 1180;
let _companionState = null;

function _dualCapable() {
  return typeof window !== 'undefined' && window.innerWidth >= DUAL_DOCK_MIN_WIDTH;
}

// ── Panel shell: width / resize / swap / minimize tray ───────────────────────
// docs/architecture/property-owner-panel-redesign-2026-08.md §1.
// Widths live as CSS custom properties (--panel-primary-w / --panel-companion-w)
// so .companion-panel and the resizer strips offset off the primary and track it
// automatically. Persisted per workstation so the layout is sticky.
const _PANEL_W = {
  primary:   { varName: '--panel-primary-w',   def: 720, min: 420, max: 1100, key: 'lcc.panelw.primary' },
  companion: { varName: '--panel-companion-w', def: 620, min: 360, max: 900,  key: 'lcc.panelw.companion' },
};

// Clamp to the panel's own bounds AND to what the viewport can actually hold.
// Without the viewport term the two independent maxima (1100 + 900) let a layout
// saved on a 2560px monitor push the companion's left edge off-screen when the
// same widths are restored on a 1400px one.
function _panelClampWidth(which, px) {
  const cfg = _PANEL_W[which];
  if (!cfg) return null;
  const n = Number(px);
  let out = isFinite(n) ? Math.round(n) : cfg.def;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
  let viewportMax = cfg.max;
  if (vw > 0) {
    // Budget against the OTHER panel's ACTUAL current width, not its minimum —
    // clamping each panel independently against the other's *minimum* still let
    // the pair total more than the viewport (920 + 860 = 1780 on a 1400px
    // screen). Fall back to the other panel's default before the vars are set.
    const otherKey = which === 'primary' ? 'companion' : 'primary';
    const otherCfg = _PANEL_W[otherKey];
    let other = otherCfg.def;
    try {
      const raw = (typeof document !== 'undefined' && document.documentElement)
        ? getComputedStyle(document.documentElement).getPropertyValue(otherCfg.varName) : '';
      const parsed = parseInt(String(raw).trim(), 10);
      if (isFinite(parsed) && parsed > 0) other = parsed;
    } catch (_e) { /* keep the default */ }
    other = Math.max(otherCfg.min, Math.min(otherCfg.max, other));
    // Leave a 120px sliver of the app visible behind the pair.
    viewportMax = Math.min(cfg.max, Math.max(cfg.min, vw - other - 120));
  }
  return Math.max(cfg.min, Math.min(viewportMax, out));
}

function _panelSetWidth(which, px, persist) {
  const cfg = _PANEL_W[which];
  if (!cfg || typeof document === 'undefined') return;
  const w = _panelClampWidth(which, px);
  document.documentElement.style.setProperty(cfg.varName, w + 'px');
  if (persist) { try { localStorage.setItem(cfg.key, String(w)); } catch (_e) {} }
}
window._panelSetWidth = _panelSetWidth;

/**
 * Set a width honouring ONLY the panel's own min/max, skipping the viewport
 * budget. Used by the split drag, where the pair total is held constant and
 * therefore already fits by construction — applying the viewport term there
 * would double-count the other panel and strangle the travel.
 */
function _panelSetWidthExact(which, px) {
  const cfg = _PANEL_W[which];
  if (!cfg || typeof document === 'undefined') return cfg ? cfg.def : 0;
  const w = Math.max(cfg.min, Math.min(cfg.max, Math.round(Number(px) || cfg.def)));
  document.documentElement.style.setProperty(cfg.varName, w + 'px');
  return w;
}

function _panelGetWidth(which) {
  const cfg = _PANEL_W[which];
  if (!cfg || typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cfg.varName);
  const n = parseInt(String(raw).trim(), 10);
  return isFinite(n) && n > 0 ? n : cfg.def;
}

function _panelRestoreWidths() {
  Object.keys(_PANEL_W).forEach(function(which) {
    let stored = null;
    try { stored = localStorage.getItem(_PANEL_W[which].key); } catch (_e) {}
    if (stored != null) _panelSetWidth(which, stored, false);
  });
}

// Drag a grab strip. The strip sits on the LEFT edge of its panel, so the panel
// width is (viewport right edge − cursor x) minus everything to its right.
function _panelInitResizers() {
  if (typeof document === 'undefined') return;
  [['panelResizerPrimary', 'primary'], ['panelResizerCompanion', 'companion']].forEach(function(pair) {
    const el = document.getElementById(pair[0]);
    const which = pair[1];
    if (!el || el._pwBound) return;
    el._pwBound = true;
    el.addEventListener('dblclick', function() { _panelSetWidth(which, _PANEL_W[which].def, true); });
    el.addEventListener('mousedown', function(ev) {
      ev.preventDefault();
      el.classList.add('dragging');
      document.body.classList.add('panel-resizing');

      // TWO DISTINCT DRAG MODES (fixed 2026-08-15 after a live capture).
      //
      // The primary strip sits at the boundary BETWEEN the two docked panels
      // when both are open — measured live: companion 194..814, primary
      // 814..1534, strip 814..822. That is a SPLIT DIVIDER, and a divider must
      // REALLOCATE space: one panel grows by exactly what the other gives up.
      //
      // The first cut instead grew the primary into the 120px sliver left
      // behind the pair, so on a 1534px screen with a 620px companion the
      // travel was 720 -> 794 = SEVENTY-FOUR PIXELS before the clamp stopped it
      // dead. Bound, positioned, visible — and it read as "the panel does not
      // drag", which is exactly how it was reported.
      //
      //   inner divider (primary strip, companion open) -> split the pair,
      //                                                    total held constant
      //   outer edge    (companion strip, or primary alone) -> resize the whole
      //                                                    dock into the app
      const compEl = document.getElementById('companionPanel');
      const splitMode = (which === 'primary') && !!(compEl && compEl.classList.contains('open'));
      const startX = ev.clientX;
      const startPrimary = _panelGetWidth('primary');
      const startCompanion = _panelGetWidth('companion');
      const total = startPrimary + startCompanion;

      const move = function(e) {
        if (splitMode) {
          const dx = startX - e.clientX;               // drag LEFT => primary grows
          let p = Math.max(_PANEL_W.primary.min,
                  Math.min(_PANEL_W.primary.max, startPrimary + dx));
          // Give the companion whatever is left, then re-derive the primary so
          // the pair ALWAYS sums to `total` even when one side hits its bound.
          let c = Math.max(_PANEL_W.companion.min,
                  Math.min(_PANEL_W.companion.max, total - p));
          p = Math.max(_PANEL_W.primary.min,
              Math.min(_PANEL_W.primary.max, total - c));
          _panelSetWidthExact('primary', p);
          _panelSetWidthExact('companion', c);
        } else {
          const offsetRight = which === 'companion' ? _panelGetWidth('primary') : 0;
          _panelSetWidth(which, window.innerWidth - e.clientX - offsetRight, false);
        }
        // Re-anchor live: _panelAnchorResizer writes an INLINE `right`, which
        // overrides the CSS calc, so without this the strip detaches from the
        // edge it is supposed to be dragging.
        _panelSyncResizers();
      };

      const up = function() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        el.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');
        // Persist both — a split moved two widths.
        try {
          localStorage.setItem(_PANEL_W.primary.key, String(_panelGetWidth('primary')));
          localStorage.setItem(_PANEL_W.companion.key, String(_panelGetWidth('companion')));
        } catch (_e) {}
        _panelSyncResizers();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
}

// Resizers are only grabbable when their panel is actually open.
//
// UI-1 (manual run 2026-08-15: "the panel does not drag"). Two fixes here:
//  1. The strip is positioned from the panel's ACTUAL bounding rect, not from
//     the CSS var. If anything caps the rendered width (a narrow viewport, a
//     more specific rule, a stale var) the var and the real edge diverge and the
//     8px grab zone ends up floating in the middle of the panel — invisible and
//     un-grabbable. Measuring the element cannot drift.
//  2. It is drawn with a visible grip, because an 8px fully transparent strip is
//     undiscoverable — you cannot drag an affordance you cannot see.
function _panelSyncResizers() {
  if (typeof document === 'undefined') return;
  const panelEl = document.getElementById('detailPanel');
  const primaryOpen = !!(panelEl && panelEl.style.display === 'block');
  const compEl = document.getElementById('companionPanel');
  const companionOpen = !!(compEl && compEl.classList.contains('open'));
  const rp = document.getElementById('panelResizerPrimary');
  const rc = document.getElementById('panelResizerCompanion');
  const dual = _dualCapable();

  if (rp) {
    const on = primaryOpen && dual;
    rp.classList.toggle('open', on);
    if (on && panelEl) _panelAnchorResizer(rp, panelEl);
  }
  if (rc) {
    const on = companionOpen && dual;
    rc.classList.toggle('open', on);
    if (on && compEl) _panelAnchorResizer(rc, compEl);
  }
}
window._panelSyncResizers = _panelSyncResizers;

/** Pin a resize strip to the real left edge of its panel (see UI-1 above). */
function _panelAnchorResizer(strip, panel) {
  try {
    const r = panel.getBoundingClientRect();
    // `right` offset from the viewport's right edge, so it tracks the panel even
    // if the rendered width differs from the CSS variable.
    strip.style.right = Math.max(0, Math.round(window.innerWidth - r.left - 8)) + 'px';
  } catch (_e) { /* leave the CSS fallback in place */ }
}

// ── Minimize tray ────────────────────────────────────────────────────────────
// Any number of parked panels. Each entry is a re-open recipe, not a DOM
// snapshot, so restoring re-renders from live data.
// { kind:'property'|'entity', label, db?, ids?, entityId?, slot:'primary'|'companion' }
let _panelParked = [];

function _panelTrayRender() {
  const tray = document.getElementById('panelTray');
  if (!tray) return;
  if (!_panelParked.length) { tray.classList.remove('open'); tray.innerHTML = ''; return; }
  tray.classList.add('open');
  tray.innerHTML = _panelParked.map(function(p, i) {
    const icon = p.kind === 'property' ? '&#127970;' : '&#128100;';
    return '<div class="panel-tray-chip" onclick="_panelTrayRestore(' + i + ')" title="Restore ' + esc(p.label || '') + '">'
      + '<span class="ptc-kind">' + icon + '</span>'
      + '<span class="ptc-label">' + esc(p.label || (p.kind === 'property' ? 'Property' : 'Contact')) + '</span>'
      + '<span class="ptc-close" onclick="event.stopPropagation();_panelTrayDrop(' + i + ')" title="Discard">&times;</span>'
      + '</div>';
  }).join('');
}

// Stable identity for a parked subject. MUST cover both descriptor shapes:
// the primary carries { ids:{property_id} } while the companion carries
// { propertyId } — keying on `ids` alone collapsed every dock-parked property
// to the same signature ("property:dia:{}"), so parking a second one silently
// evicted the first.
function _panelParkSig(p) {
  if (!p) return '';
  if (p.kind === 'entity') return 'entity:' + String(p.entityId || '');
  const pid = (p.ids && p.ids.property_id != null ? p.ids.property_id : p.propertyId);
  return 'property:' + (p.db || '') + ':' + String(pid != null ? pid : '');
}

function _panelTrayPark(entry) {
  if (!entry) return;
  // De-dupe: parking the same subject twice just refreshes the chip.
  const sig = _panelParkSig(entry);
  _panelParked = _panelParked.filter(function(p) { return _panelParkSig(p) !== sig; });
  _panelParked.push(entry);
  _panelTrayRender();
}
window._panelTrayPark = _panelTrayPark;

function _panelTrayDrop(i) {
  _panelParked.splice(i, 1);
  _panelTrayRender();
}
window._panelTrayDrop = _panelTrayDrop;

// Is the PRIMARY slide-over actually on screen right now? `_activePrimaryKind`
// is only ever set, never cleared by closeDetail/closeCompanion, so on its own
// it is stale after a close — restoring a tray chip would then dock a lone
// companion at right:720px with no panel beside it. Same test the resizer sync
// uses, so the two can never disagree.
function _panelPrimaryOpen() {
  const el = typeof document !== 'undefined' && document.getElementById('detailPanel');
  return !!(el && el.style.display === 'block');
}

function _panelTrayRestore(i) {
  const p = _panelParked[i];
  if (!p) return;
  _panelParked.splice(i, 1);
  _panelTrayRender();
  // Dock it beside the primary only when a primary of the OTHER kind is
  // genuinely open; otherwise promote it to the full panel.
  const canDockBeside = function(kind) {
    return p.slot === 'companion' && _dualCapable() && _panelPrimaryOpen() && _activePrimaryKind === kind;
  };
  if (p.kind === 'entity') {
    if (canDockBeside('property')) openCompanionEntity(p.entityId);
    else if (typeof openEntityDetail === 'function') openEntityDetail(p.entityId);
  } else {
    const pid = (p.ids && p.ids.property_id != null) ? p.ids.property_id : p.propertyId;
    if (canDockBeside('entity')) openCompanionProperty(p.db, pid, _panelPropertySummary(p));
    else if (typeof openUnifiedDetail === 'function') openUnifiedDetail(p.db, p.ids || { property_id: pid });
  }
}
window._panelTrayRestore = _panelTrayRestore;

// A property descriptor coming FROM the primary has no `summary` (the dock's
// header/body are built from one), so synthesize a minimal card from what the
// descriptor does carry — otherwise the dock renders "(property)" / "No details."
function _panelPropertySummary(d) {
  if (!d) return {};
  if (d.summary && (d.summary.address || d.summary.tenant)) return d.summary;
  return Object.assign({}, d.summary || {}, {
    address: (d.summary && d.summary.address) || d.label || null,
    city: (d.summary && d.summary.city) || d.city || null,
    state: (d.summary && d.summary.state) || d.state || null,
  });
}

// What is currently in the PRIMARY panel, as a re-open recipe.
function _panelPrimaryDescriptor() {
  if (_activePrimaryKind === 'entity') {
    const c = (typeof _entityDetailCache !== 'undefined' && _entityDetailCache) || {};
    const id = c.entityId || (c.entity && c.entity.id) || null;
    if (!id) return null;
    return { kind: 'entity', entityId: String(id), label: (c.entity && c.entity.name) || 'Contact', slot: 'primary' };
  }
  if (_activePrimaryKind === 'property') {
    const c = (typeof _udCache !== 'undefined' && _udCache) || {};
    if (!c.ids && !c.db) return null;
    const p = c.property || c.fallback || {};
    const label = p.address || p.facility_name || 'Property';
    return {
      kind: 'property', db: c.db, ids: c.ids || {}, label: label, slot: 'primary',
      // Carry a dock-renderable summary so a swap/park→restore into the
      // companion shows the real address, not "(property)".
      summary: { address: p.address || label, city: p.city || null, state: p.state || null,
                 tenant: p.tenant || p.operator_name || p.agency_short || null },
    };
  }
  return null;
}

// What is currently in the COMPANION dock, as a re-open recipe.
function _panelCompanionDescriptor() {
  const s = _companionState;
  if (!s) return null;
  if (s.kind === 'entity') return { kind: 'entity', entityId: s.entityId, label: s.label || 'Contact', slot: 'companion' };
  return { kind: 'property', db: s.db, propertyId: s.propertyId, summary: s.summary || {}, label: s.label || 'Property', slot: 'companion' };
}

// ⇄ Swap — promote the companion into the wide primary slot and demote the
// primary into the dock. This is the "move the panels around" affordance:
// you work in the wide slot, whichever subject that is.
function _panelSwap() {
  const prim = _panelPrimaryDescriptor();
  const comp = _panelCompanionDescriptor();
  // UI-3: this returned a vague toast, so pressing ⇄ with one panel open read as
  // "the button is broken" rather than "there is nothing to swap with".
  if (!prim && !comp) { if (typeof showToast === 'function') showToast('Nothing to swap', 'info'); return; }
  if (!comp) {
    if (typeof showToast === 'function') showToast('Swap needs two panels — click an owner or property to open one beside this.', 'info');
    return;
  }
  if (!prim) { if (typeof showToast === 'function') showToast('Swap needs a main panel open', 'info'); return; }
  closeCompanion();
  const openPrimary = function(d) {
    if (d.kind === 'entity') openEntityDetail(d.entityId);
    else if (typeof openUnifiedDetail === 'function') openUnifiedDetail(d.db, d.ids || { property_id: d.propertyId });
  };
  openPrimary(comp);
  // Let the primary settle (it sets _activePrimaryKind) before docking the other.
  setTimeout(function() {
    if (prim.kind === 'entity') openCompanionEntity(prim.entityId);
    else openCompanionProperty(prim.db, (prim.ids && prim.ids.property_id != null) ? prim.ids.property_id : prim.propertyId, _panelPropertySummary(prim));
  }, 260);
}
window._panelSwap = _panelSwap;

// Park the PRIMARY panel into the tray. When a companion is docked it is
// PROMOTED into the wide slot rather than being torn down with the primary —
// that is the "minimize one while opening another" workflow: park the property,
// keep working the owner, restore the property from the tray when you're done.
function minimizePrimary() {
  const prim = _panelPrimaryDescriptor();
  const comp = _panelCompanionDescriptor();
  if (prim) _panelTrayPark(prim);
  // closeDetail() also tears down the companion (it is anchored to the primary),
  // so re-open the companion's subject as the new primary afterwards.
  if (typeof closeDetail === 'function') closeDetail();
  else {
    const panel = document.getElementById('detailPanel');
    const ov = document.getElementById('detailOverlay');
    if (panel) { panel.style.display = 'none'; panel.classList.remove('open'); }
    if (ov) ov.classList.remove('open');
    closeCompanion();
  }
  if (comp) {
    if (comp.kind === 'entity') openEntityDetail(comp.entityId);
    else if (typeof openUnifiedDetail === 'function') openUnifiedDetail(comp.db, comp.ids || { property_id: comp.propertyId });
  } else {
    // Nothing left on screen — make sure the stale primary-kind can't route a
    // later tray restore into an orphaned dock.
    _setPrimaryKind(null);
  }
  _panelSyncResizers();
}
window.minimizePrimary = minimizePrimary;

// The shared header control cluster: ⇄ swap · – minimize · × close.
function _panelHeaderControls(scope) {
  const min = scope === 'primary' ? 'minimizePrimary()' : 'minimizeCompanion()';
  const close = scope === 'primary' ? 'closeDetail()' : 'closeCompanion()';
  return '<button class="detail-close" title="Swap panels" onclick="_panelSwap()" style="margin:0 2px">&#8646;</button>'
    + '<button class="detail-close" title="Minimize to tray" onclick="' + min + '" style="margin:0 2px">&#8211;</button>'
    + '<button class="detail-close" title="Close" onclick="' + close + '">&times;</button>';
}
window._panelHeaderControls = _panelHeaderControls;

if (typeof window !== 'undefined') {
  _panelRestoreWidths();
  const _panelBoot = function() { _panelInitResizers(); _panelSyncResizers(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _panelBoot);
  else _panelBoot();
  window.addEventListener('resize', _panelSyncResizers);
}

// Drill a property clicked INSIDE a contact/owner panel. `source` selects the
// cache array (portfolio | developed | deal), `idx` the row. Dual-docks beside
// the contact when there's room; else the full single-panel open.
function _entityDrillProperty(db, propertyId, source, idx) {
  const c = _entityDetailCache || {};
  let row = {};
  if (source === 'portfolio') row = (c.portfolio || [])[idx] || {};
  else if (source === 'developed') row = (c.developed || [])[idx] || {};
  else if (source === 'contactProperties') row = (c.contactProperties || [])[idx] || {};
  const summary = {
    address: row.address || row.name || null,
    city: row.city || null,
    state: row.state || null,
    tenant: row.tenant || null,
    rent: row.annual_rent != null ? _entityFmtMoney(row.annual_rent) : null,
    is_current: row.is_current,
  };
  if (_dualCapable()) { openCompanionProperty(db, propertyId, summary); return; }
  if (typeof openUnifiedDetail === 'function') openUnifiedDetail(db, { property_id: propertyId });
}
window._entityDrillProperty = _entityDrillProperty;

/**
 * Dock a property beside the primary panel — the FULL tabbed property panel,
 * not a summary card (Scott, 2026-08-15: "the full detail side-by-side").
 *
 * REFUSAL, for the same reason the entity dock refuses entity-beside-entity:
 * `_udCache` (and `_opsExtraCache` / `_salesCache`) are module singletons, so
 * two property panels would overwrite each other's data — the second open would
 * silently repaint the first with the wrong property. Property + owner in
 * either slot is fully supported; property + property is not, so it opens in
 * the primary slot instead of corrupting the cache.
 */
function openCompanionProperty(db, propertyId, summary = {}) {
  db = (db === 'gov' || db === 'government') ? 'gov' : 'dia';
  const panel = document.getElementById('companionPanel');
  const header = document.getElementById('companionHeader');
  const body = document.getElementById('companionBody');
  const minTab = document.getElementById('companionMin');
  if (!panel || !header || !body) { if (typeof openUnifiedDetail === 'function') openUnifiedDetail(db, { property_id: propertyId }); return; }

  if (_activePrimaryKind === 'property') {
    if (typeof showToast === 'function') showToast('Open an owner to dock a property beside it', 'info');
    if (typeof openUnifiedDetail === 'function') openUnifiedDetail(db, { property_id: propertyId }, summary);
    return;
  }
  if (typeof openUnifiedDetail === 'function') {
    openUnifiedDetail(db, { property_id: propertyId }, summary, null, { mount: 'companion' });
    return;
  }

  if (minTab) minTab.classList.remove('open');
  panel.classList.add('open');
  panel.style.display = 'block';
  // The dock is shared with the full entity panel, which shows a tab bar. A
  // property docked afterwards must not inherit the previous subject's tabs.
  const _compTabs = document.getElementById('companionTabs');
  if (_compTabs) { _compTabs.innerHTML = ''; _compTabs.style.display = 'none'; }

  const addr = summary.address || '(property)';
  const loc = (summary.city || '') + (summary.city && summary.state ? ', ' : '') + (summary.state || '');
  const badge = db.toUpperCase();
  _companionState = { kind: 'property', db, propertyId, summary, label: addr };
  _panelSyncResizers();
  header.innerHTML =
    '<div class="detail-header-info" style="width:100%">'
    + '<div style="flex:1;min-width:0"><div class="detail-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(addr) + '</div>'
    + '<div class="detail-subtitle">' + esc(loc) + '</div></div>'
    + '<span class="detail-badge" style="background:' + (db === 'gov' ? 'var(--gov-green)' : 'var(--purple)') + ';color:#fff">' + esc(badge) + '</span>'
    + _panelHeaderControls('companion')
    + '</div>';

  const rows = [];
  const addRow = (l, v) => { if (v != null && v !== '') rows.push('<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span class="t-meta3">' + l + '</span><span style="font-size:12px;color:var(--text);text-align:right">' + esc(String(v)) + '</span></div>'); };
  addRow('Address', summary.address);
  addRow('City / State', loc);
  addRow(db === 'gov' ? 'Agency / Tenant' : 'Tenant', summary.tenant);
  addRow('Annual rent', summary.rent);
  if (summary.is_current === false) addRow('Status', 'Former');

  body.innerHTML =
    '<div class="detail-section"><div class="detail-section-title">Property</div>' + (rows.join('') || '<div class="detail-empty">No details.</div>') + '</div>'
    + '<div class="detail-section"><button class="dns-cta" onclick="_companionOpenFull()">Open full detail ↗</button>'
    + '<div style="font-size:11px;color:var(--text3);margin-top:6px">Full property panel — replaces this dock.</div></div>';
}
window.openCompanionProperty = openCompanionProperty;

function _companionOpenFull() {
  const s = _companionState;
  if (!s) return;
  closeCompanion();
  if (typeof openUnifiedDetail === 'function') openUnifiedDetail(s.db, { property_id: s.propertyId });
}
window._companionOpenFull = _companionOpenFull;

// Park the companion into the tray (multiple panels can be parked at once) and
// free the dock so another subject can be opened beside the primary.
function minimizeCompanion() {
  const panel = document.getElementById('companionPanel');
  const d = _panelCompanionDescriptor();
  if (panel) { panel.classList.remove('open'); panel.style.display = 'none'; }
  if (d) _panelTrayPark(d);
  _companionState = null;
  _panelSyncResizers();
}
window.minimizeCompanion = minimizeCompanion;

// Legacy entry point (the old single vertical restore tab). Restores the most
// recently parked panel so any stale caller still does the sensible thing.
function restoreCompanion() {
  if (_panelParked.length) _panelTrayRestore(_panelParked.length - 1);
}
window.restoreCompanion = restoreCompanion;

function closeCompanion() {
  const panel = document.getElementById('companionPanel');
  const minTab = document.getElementById('companionMin');
  if (panel) { panel.classList.remove('open'); panel.style.display = 'none'; }
  if (minTab) minTab.classList.remove('open');
  // If the DOCK was hosting the property panel, the mount pointer must not stay
  // aimed at a hidden element — a later refresh would render into nothing and
  // read as "the panel went blank".
  if (_companionState && _companionState.kind === 'property') _udMount = 'primary';
  _companionState = null;
  _panelSyncResizers();
}
window.closeCompanion = closeCompanion;

// ── Companion ENTITY (owner beside property) — Scott: clicking an owner from the
// property tab should open it BESIDE the property (both visible), with close /
// minimize / enlarge, not replace the property. Reuses the companion dock that
// already docks a property inside an owner panel — same element, other direction.
let _activePrimaryKind = null; // 'property' | 'entity' — which panel is primary
window._activePrimaryKind = null;
function _setPrimaryKind(k) { _activePrimaryKind = k; try { window._activePrimaryKind = k; } catch (_e) {} }

// Router: an entity chip clicked FROM a property panel docks the entity as a
// companion (when there's room); otherwise the normal full-panel open.
function _openEntitySmart(id) {
  if (!id) return;
  // UI-2: require a property panel to actually BE open, not just a stale
  // `_activePrimaryKind` left over from a previous open.
  if (_dualCapable() && _panelPrimaryOpen() && _activePrimaryKind === 'property') { openCompanionEntity(String(id)); return; }
  openEntityDetail(String(id));
}
window._openEntitySmart = _openEntitySmart;

async function _openEntityByNameSmart(name) {
  if (!name) return;
  if (_dualCapable() && _panelPrimaryOpen() && _activePrimaryKind === 'property') {
    try {
      const data = await _entityApiFetch('/api/entities?action=search&q=' + encodeURIComponent(name));
      const hit = (data && Array.isArray(data.entities) && data.entities[0]) || null;
      if (hit && hit.id) { openCompanionEntity(String(hit.id)); return; }
    } catch (_e) { /* fall through */ }
  }
  openEntityDetailByName(name);
}
window._openEntityByNameSmart = _openEntityByNameSmart;

// Open an owner/contact ENTITY in the companion dock beside the property.
function openCompanionEntity(entityId) {
  if (!entityId) return;
  const panel = document.getElementById('companionPanel');
  const header = document.getElementById('companionHeader');
  const body = document.getElementById('companionBody');
  const minTab = document.getElementById('companionMin');
  // No dock element or not enough room → fall back to the full panel.
  if (!panel || !header || !body || !_dualCapable()) { openEntityDetail(entityId); return; }
  if (minTab) minTab.classList.remove('open');
  panel.classList.add('open');
  panel.style.display = 'block';
  // SINGLE-CACHE CONSTRAINT: `_entityDetailCache` is a module singleton, so two
  // entity panels cannot coexist. That is fine for every supported layout
  // (property + owner, in either slot) but must be refused explicitly rather
  // than silently corrupting the primary panel's cache.
  if (_activePrimaryKind === 'entity') {
    if (typeof showToast === 'function') showToast('Open a property to dock a contact beside it', 'info');
    openEntityDetail(entityId);
    return;
  }
  _companionState = { kind: 'entity', entityId, label: 'Contact' };
  _panelSyncResizers();
  // FULL detail side-by-side (Scott, 2026-08-15) — the dock renders the same
  // tabbed entity panel as the primary, not a summary card with an
  // "Open full detail ↗" button.
  openEntityDetail(entityId, undefined, { mount: 'companion' })
    .then(function() {
      // Keep the tray chip / swap descriptor labelled with the real subject.
      try {
        const t = document.querySelector('#companionHeader .detail-title');
        if (t && _companionState && _companionState.entityId === entityId) {
          _companionState.label = t.textContent.trim() || 'Contact';
        }
      } catch (_e) {}
    })
    .catch(function() {
      if (body) body.innerHTML = '<div class="detail-empty">Could not load this contact.</div>';
    });
}
window.openCompanionEntity = openCompanionEntity;

function _companionEnlargeEntity() {
  const s = _companionState;
  if (!s || !s.entityId) return;
  const id = s.entityId;
  closeCompanion();
  openEntityDetail(id);
}
window._companionEnlargeEntity = _companionEnlargeEntity;

function _renderCompanionEntity(c360, entityId) {
  const header = document.getElementById('companionHeader');
  const body = document.getElementById('companionBody');
  if (!header || !body) return;
  const e = (c360 && c360.entity) || {};
  const role = (c360 && c360.role) || 'contact';
  const rm = (typeof _entityRoleMeta === 'function') ? _entityRoleMeta(role) : { label: role, color: 'var(--accent)' };
  const nm = e.name || '(contact)';
  const loc = (e.city || '') + (e.city && e.state ? ', ' : '') + (e.state || '');
  // Carry the real name onto the dock state so the tray chip and the swap
  // descriptor label it correctly (the old restore tab was hard-coded "Property"
  // even when the dock held an owner).
  if (_companionState && _companionState.entityId === entityId) _companionState.label = nm;
  header.innerHTML =
    '<div class="detail-header-info" style="width:100%">'
    + '<div style="flex:1;min-width:0"><div class="detail-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(nm) + '</div>'
    + (loc ? '<div class="detail-subtitle">' + esc(loc) + '</div>' : '')
    + '</div>'
    + '<span class="detail-badge" style="background:' + rm.color + ';color:#fff">' + esc(rm.label) + '</span>'
    + '<button class="detail-close" title="Enlarge to full panel" onclick="_companionEnlargeEntity()" style="margin:0 2px">&#8599;</button>'
    + _panelHeaderControls('companion')
    + '</div>';

  let html = '';
  // Next best action (reuse the deterministic hero resolver on the c360 payload).
  if (typeof _nextActionForContact === 'function') {
    const cacheLike = { entity: e, cadence: c360.cadence || null, emailRel: c360.email_relationship || null, subject: c360.subject || null };
    const a = _nextActionForContact(cacheLike);
    if (a) {
      const tones = { stop: 'var(--red,#ef4444)', warn: 'var(--amber,#d98c00)', accent: 'var(--accent)', go: 'var(--green,#22c55e)' };
      const col = tones[a.tone] || 'var(--accent)';
      html += '<div class="detail-section"><div style="padding:11px 13px;border-radius:9px;background:var(--s2);border:1px solid var(--border);border-left:4px solid ' + col + '">'
        + '<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:' + col + '">Next best action</div>'
        + '<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px">' + esc(a.label) + '</div>'
        + (a.sub ? '<div style="font-size:11px;color:var(--text2);margin-top:2px">' + esc(a.sub) + '</div>' : '')
        + '</div></div>';
    }
  }
  // Standing: ROE + cadence next touch.
  const roe = c360 && c360.roe;
  const cad = c360 && c360.cadence;
  if (roe || cad) {
    html += '<div class="detail-section"><div class="detail-section-title">Standing</div>';
    if (roe && roe.headline) html += '<div style="font-size:12px;color:var(--text);margin-bottom:4px">' + esc(roe.headline) + '</div>';
    if (cad && cad.next_touch_due) html += '<div style="font-size:11px;color:var(--text3)">Next touch: ' + esc(cad.next_touch_type || 'touch') + ' · ' + esc(_fmtDate(cad.next_touch_due)) + (cad.overdue ? ' (overdue)' : '') + '</div>';
    html += '</div>';
  }
  // Portfolio one-liner.
  const roll = c360 && c360.portfolio && c360.portfolio.rollup;
  if (roll && roll.total_property_count != null) {
    html += '<div class="detail-section"><div style="font-size:12px;color:var(--text2)">Owns ' + Number(roll.total_property_count) + ' propert' + (Number(roll.total_property_count) === 1 ? 'y' : 'ies') + '</div></div>';
  }
  // Contact methods.
  const email = (c360 && c360.subject && c360.subject.email) || e.email || null;
  const phone = e.phone || null;
  // Prompt 114 Unit 2 — the dock reuses the same resolver output as the full
  // panel, so the two surfaces cannot disagree about whether this owner is
  // reachable. Rendered under its own label because it is a DIFFERENT claim
  // from the entity's own contact detail.
  const dockVia = (c360 && c360.subject && c360.subject.reachable_via) || null;
  if (email || phone || dockVia) {
    html += '<div class="detail-section"><div class="detail-section-title">Contact</div>';
    if (email) html += '<div style="font-size:12px"><a href="mailto:' + esc(email) + '" style="color:var(--accent)">' + esc(email) + '</a></div>';
    if (phone) html += '<div style="font-size:12px;margin-top:3px"><a href="tel:' + esc(phone) + '" style="color:var(--accent)">' + esc(phone) + '</a></div>';
    if (dockVia) {
      html += '<div style="font-size:11px;color:var(--text3);margin-top:' + (email || phone ? '6' : '0') + 'px">Reach via '
        + '<b style="color:var(--text2)">' + esc(dockVia.name) + '</b>'
        + (dockVia.role ? ' <span style="opacity:.75">(' + esc(String(dockVia.role).replace(/_/g, ' ')) + ')</span>' : '') + '</div>';
      if (dockVia.email) html += '<div style="font-size:12px;margin-top:2px"><a href="mailto:' + esc(dockVia.email) + '" style="color:var(--accent)">' + esc(dockVia.email) + '</a></div>';
      else if (dockVia.phone) html += '<div style="font-size:12px;margin-top:2px"><a href="tel:' + esc(dockVia.phone) + '" style="color:var(--accent)">' + esc(dockVia.phone) + '</a></div>';
    }
    html += '</div>';
  }
  html += '<div class="detail-section"><button class="dns-cta" onclick="_companionEnlargeEntity()">Open full detail ↗</button>'
    + '<div style="font-size:11px;color:var(--text3);margin-top:6px">Full contact panel with all tabs — replaces this dock.</div></div>';
  body.innerHTML = html;
}
