// SIDEBAR4-c (2026-09-23) — side-panel action guard + request stamping.
//
// Why this exists (measured on LCC Opps, 2026-09-22/23): every sidebar
// "Update LCC" PATCH was followed 0.5–1.0 s later by a
// `process_sidebar_extraction` request carrying its own X-LCC-Request-Id —
// i.e. a SECOND click, landing on the Re-run button. The Update handler
// shrinks its own label ("Update LCC with CoStar Data" → "Updating..."), the
// Re-run button sits inline right after it and slides left under the cursor,
// and the confirm/double click lands on Re-run. Toasts were also prepended
// ABOVE the buttons, pushing the whole row down mid-action.
//
// The guard makes one property action at a time the rule, not the hope:
//   * while an action is in flight every sibling button in the container is
//     disabled and any click that still arrives is swallowed;
//   * every button's width is frozen before the clicked label changes, so
//     nothing moves under the cursor;
//   * toasts/status lines go into a slot BELOW the buttons.
// The server's SIDEBAR4 single-flight (serializeSidebarRun) stays the backstop.
//
// It also owns the request headers for every LCC API call the extension
// makes, so each capture is traceable to one user action and one build.
//
// No ESM exports: the side panel loads this as a classic script; the MV3
// module service worker imports it for its global side effect.
(function installLccActionGuard(root) {
  'use strict';

  function newRequestId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') {
        return root.crypto.randomUUID();
      }
    } catch { /* fall through */ }
    try {
      const b = new Uint8Array(16);
      root.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    } catch {
      return null;
    }
  }

  function clientTag() {
    try {
      const v = root.chrome && root.chrome.runtime && root.chrome.runtime.getManifest
        ? root.chrome.runtime.getManifest().version : null;
      return `lcc-extension/${v || 'unknown'}`;
    } catch {
      return 'lcc-extension/unknown';
    }
  }

  // Headers for EVERY extension call to the LCC API. One request id per call
  // (one call per user action), plus the extension build that made it, so a
  // server-side run with no UUID can be told apart from a stale build.
  function lccRequestHeaders(apiKey, extra) {
    const headers = Object.assign({}, extra || {});
    if (apiKey) headers['X-LCC-Key'] = apiKey;
    const id = newRequestId();
    if (id) headers['X-LCC-Request-Id'] = id;
    headers['X-LCC-Client'] = clientTag();
    return headers;
  }

  function listButtons(container) {
    try { return Array.from(container.querySelectorAll('button')); } catch { return []; }
  }

  function freezeWidths(container) {
    for (const b of listButtons(container)) {
      const w = b.offsetWidth;
      if (w && b.style && !b.style.minWidth) b.style.minWidth = `${w}px`;
    }
  }

  function createActionGroup(container) {
    let inFlight = null;

    function wrap(button, handler) {
      return async function guardedClick(ev) {
        if (inFlight) {
          // A second click while an action runs is never a new intent.
          try { ev && ev.preventDefault && ev.preventDefault(); } catch { /* noop */ }
          try { ev && ev.stopImmediatePropagation && ev.stopImmediatePropagation(); } catch { /* noop */ }
          return undefined;
        }
        inFlight = button;
        freezeWidths(container);
        const prior = listButtons(container)
          .filter((b) => b !== button)
          .map((b) => [b, b.disabled]);
        for (const [b] of prior) b.disabled = true;
        try {
          return await handler.call(this, ev);
        } finally {
          inFlight = null;
          for (const [b, wasDisabled] of prior) b.disabled = wasDisabled;
        }
      };
    }

    return { wrap, isBusy: () => inFlight !== null, inFlight: () => inFlight };
  }

  // One group per render of the actions container: a fresh render starts idle.
  function resetGroup(container) {
    const g = createActionGroup(container);
    try { container._lccActionGroup = g; } catch { /* noop */ }
    return g;
  }

  function groupFor(container) {
    return (container && container._lccActionGroup) || resetGroup(container);
  }

  // Status lines/toasts live BELOW the buttons so inserting one never moves a
  // button under the cursor.
  function statusSlot(container) {
    const doc = container.ownerDocument || root.document;
    let slot = container.querySelector ? container.querySelector('.property-action-status') : null;
    if (!slot) {
      slot = doc.createElement('div');
      slot.className = 'property-action-status';
      container.appendChild(slot);
    }
    return slot;
  }

  root.LccActionGuard = {
    newRequestId,
    clientTag,
    lccRequestHeaders,
    createActionGroup,
    resetGroup,
    groupFor,
    statusSlot,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
