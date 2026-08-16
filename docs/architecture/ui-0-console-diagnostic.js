/* ============================================================================
 * LCC — UI-0 / UI-1 / UI-2 / UI-3 console diagnostic
 * ----------------------------------------------------------------------------
 * WHY: the red "Something went wrong — try refreshing" toast is index.html's
 * GLOBAL window.onerror / unhandledrejection handler, so a real exception or
 * rejected promise is firing somewhere. The toast deliberately hides the detail.
 * A static pass over _udTabOwnership found no missing references (23 identifiers,
 * all defined), so it is a RUNTIME/ASYNC failure — it cannot be found by reading
 * the code, only by catching it live.
 *
 * HOW TO RUN
 *   1. Open the LCC app.
 *   2. F12 → Console tab.
 *      (If Chrome refuses the paste, type  allow pasting  then Enter first.)
 *   3. Paste STEP 1 below and press Enter. It arms the capture.
 *   4. Reproduce: open a dialysis comp → property panel → Ownership tab.
 *      Then also try dragging the panel's LEFT EDGE, clicking an owner chip,
 *      and pressing the ⇄ swap button — so one report covers all four defects.
 *   5. Paste STEP 2 and press Enter. The full report is copied to your
 *      clipboard; paste it back to me.
 *
 * Nothing here modifies the app or writes any data — it only listens and reads.
 * ========================================================================== */

/* ── STEP 1 — arm the capture, then reproduce ─────────────────────────────── */
(() => {
  const D = (window.__lccDiag = { errors: [], rejections: [], logs: [], armedAt: new Date().toISOString() });
  const trim = (s, n = 8) => (s ? String(s).split('\n').slice(0, n).join('  |  ') : null);

  addEventListener('error', (e) => {
    D.errors.push({
      msg: e.message, src: e.filename, line: e.lineno, col: e.colno,
      stack: trim(e.error && e.error.stack),
    });
  }, true);

  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    D.rejections.push({
      msg: r && r.message ? r.message : String(r),
      stack: trim(r && r.stack),
    });
  });

  // The app's own handler logs "[LCC error] ..." — mirror console.error too, in
  // case something is caught-and-logged rather than thrown.
  const origErr = console.error.bind(console);
  console.error = (...a) => {
    try { D.logs.push(a.map(x => (x && x.stack ? trim(x.stack, 4) : String(x))).join(' ')); } catch (_) {}
    origErr(...a);
  };

  console.log('%cLCC diag ARMED. Reproduce the problem, then paste STEP 2.', 'color:#22c55e;font-weight:700');
})();

/* ── STEP 2 — collect + copy ──────────────────────────────────────────────── */
(() => {
  const D = window.__lccDiag || { errors: [], rejections: [], logs: [] };
  const el = (id) => document.getElementById(id);
  const rect = (n) => { try { const r = n.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width) }; } catch (_) { return null; } };
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const panel = el('detailPanel');
  const comp = el('companionPanel');
  const rp = el('panelResizerPrimary');
  const rc = el('panelResizerCompanion');

  const report = {
    when: new Date().toISOString(),
    armedAt: D.armedAt || null,

    /* UI-0 — the actual failure */
    UI0_errors: D.errors,
    UI0_rejections: D.rejections,
    UI0_consoleErrors: D.logs.slice(-25),

    /* build identity — confirms the redeploy actually reached this browser */
    build: {
      detailJs: (document.querySelector('script[src*="detail.js"]') || {}).src || null,
      stylesCss: (document.querySelector('link[href*="styles.css"]') || {}).href || null,
      hasOpenOwnerChip: typeof window._openOwnerChip === 'function',
      hasPanelAnchorResizer: typeof window._panelSyncResizers === 'function',
      hasJsStrArg: typeof window._jsStrArg === 'function' || /(_jsStrArg)/.test(String(window.entityLink || '')),
    },

    /* UI-1 — resize */
    UI1_resize: {
      innerWidth: innerWidth,
      dualCapable: innerWidth >= 1180,
      varPrimary: cssVar('--panel-primary-w'),
      varCompanion: cssVar('--panel-companion-w'),
      panelRect: panel ? rect(panel) : null,
      panelDisplay: panel ? panel.style.display : null,
      resizerPrimary: rp ? { exists: true, open: rp.classList.contains('open'), bound: !!rp._pwBound, rect: rect(rp), right: rp.style.right } : { exists: false },
      resizerCompanion: rc ? { exists: true, open: rc.classList.contains('open'), rect: rect(rc) } : { exists: false },
      // The grab strip should sit within ~8px of the panel's left edge.
      stripAlignedToPanel: (panel && rp) ? Math.abs(rect(rp).left + 8 - rect(panel).left) <= 10 : null,
    },

    /* UI-2 / UI-3 — docking + swap */
    UI2_dock: {
      activePrimaryKind: window._activePrimaryKind || null,
      companionOpen: comp ? comp.classList.contains('open') : null,
      trayExists: !!el('panelTray'),
      trayChips: el('panelTray') ? el('panelTray').children.length : 0,
      ownerChipsOnPage: document.querySelectorAll('.owner-link[data-owner-ctx]').length,
    },

    hash: location.hash,
    ua: navigator.userAgent,
  };

  const out = JSON.stringify(report, null, 2);
  try { copy(out); console.log('%cCopied to clipboard — paste it back to Claude.', 'color:#22c55e;font-weight:700'); }
  catch (_) { console.log('Copy failed — select the object below and copy manually.'); }
  console.log(report);
  return report;
})();
