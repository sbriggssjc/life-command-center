// ─────────────────────────────────────────────────────────────────────────────
// app-modal.js — W6.5 Stage 3, Unit 1 (extracted from app.js 2026-08-20).
// Moved VERBATIM from app.js lines 1945-2054.
//
// The custom modal: async replacements for the browser's blocking confirm() and
// prompt(). Self-contained — its own state, its own DOM wiring, its own
// keyboard handling — which is why the map named it the best first Stage-3
// candidate, and this time the map was right.
//
//   _modalResolve · _modalPrevFocus · _modalIsPrompt   dialog state
//   _isModalOpen · _showModal · _closeModal · _modalCancel
//   lccConfirm(msg, okLabel)      → Promise<boolean>
//   lccPrompt(msg, defaultVal)    → Promise<string|null>
//   a DOMContentLoaded block wiring OK / Cancel / overlay-click / Esc / Enter
//   and the Tab focus trap
//
// CLASSIC script loaded BEFORE app.js. lccConfirm is called from app.js, gov.js,
// dialysis.js, detail.js, dc-lanes.js and ops.js — all at CALL time, so the
// shared global scope resolves every one of them unchanged.
//
// The one eval-time statement here is its own DOMContentLoaded listener, which
// touches only modal internals that moved with it and fires after every script
// has loaded. Nothing outside reads this file's bindings at eval time.
//
// ⚠️ Do NOT make this a module: `function lccConfirm` at top level of a classic
// script becomes a window property automatically, and inline onclick handlers in
// five other files depend on that.
// ─────────────────────────────────────────────────────────────────────────────

// ── Custom Modal (async replacements for confirm/prompt) ──────────────
let _modalResolve = null;
let _modalPrevFocus = null;
let _modalIsPrompt = false;

function _isModalOpen() {
  const overlay = document.getElementById('lcc-modal-overlay');
  return overlay && overlay.style.display !== 'none';
}

function _showModal(msg, inputMode, defaultVal, okLabel) {
  // Race guard: if a modal is already open, resolve the old one with cancel before opening new
  if (_isModalOpen() && _modalResolve) {
    _modalResolve(_modalIsPrompt ? null : false);
    _modalResolve = null;
  }
  return new Promise(resolve => {
    _modalResolve = resolve;
    _modalIsPrompt = !!inputMode;
    _modalPrevFocus = document.activeElement;
    const overlay = document.getElementById('lcc-modal-overlay');
    const msgEl = document.getElementById('lcc-modal-msg');
    const inputWrap = document.getElementById('lcc-modal-input-wrap');
    const inputEl = document.getElementById('lcc-modal-input');
    const okBtn = document.getElementById('lcc-modal-ok');
    if (!overlay) { resolve(inputMode ? null : false); return; }
    msgEl.textContent = msg;
    okBtn.textContent = okLabel || 'Confirm';
    // Defensive: re-enable in case a caller mistakenly disabled the button.
    okBtn.disabled = false;
    if (inputMode) {
      inputWrap.style.display = 'block';
      inputEl.value = defaultVal || '';
    } else {
      inputWrap.style.display = 'none';
    }
    overlay.style.display = 'flex';
    // Focus: input for prompts, OK button for confirms
    setTimeout(() => {
      if (inputMode) { inputEl.focus(); inputEl.select(); }
      else { okBtn.focus(); }
    }, 50);
  });
}

function _closeModal(val) {
  const overlay = document.getElementById('lcc-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  if (_modalResolve) { _modalResolve(val); _modalResolve = null; }
  // Restore focus to previous element
  if (_modalPrevFocus && typeof _modalPrevFocus.focus === 'function') {
    try { _modalPrevFocus.focus(); } catch (_) {}
    _modalPrevFocus = null;
  }
}

function _modalCancel() {
  _closeModal(_modalIsPrompt ? null : false);
}

document.addEventListener('DOMContentLoaded', () => {
  const okBtn = document.getElementById('lcc-modal-ok');
  const cancelBtn = document.getElementById('lcc-modal-cancel');
  const inputEl = document.getElementById('lcc-modal-input');
  const overlay = document.getElementById('lcc-modal-overlay');

  okBtn?.addEventListener('click', () => {
    if (_modalIsPrompt) {
      _closeModal(document.getElementById('lcc-modal-input')?.value ?? '');
    } else {
      _closeModal(true);
    }
  });
  cancelBtn?.addEventListener('click', _modalCancel);
  overlay?.addEventListener('click', e => {
    if (e.target.id === 'lcc-modal-overlay') _modalCancel();
  });

  // Keyboard: Enter to submit, Escape to cancel, Tab focus trap
  const modalEl = document.getElementById('lcc-modal');
  modalEl?.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      _modalCancel();
      return;
    }
    if (e.key === 'Enter' && e.target.id !== 'lcc-modal-cancel') {
      e.preventDefault();
      okBtn?.click();
      return;
    }
    // Focus trap: Tab wraps between Cancel and OK (and input if visible)
    if (e.key === 'Tab') {
      const focusable = (_modalIsPrompt ? [document.getElementById('lcc-modal-input')].filter(Boolean) : [])
        .concat(Array.from(modalEl.querySelectorAll('button'))).filter(el => !el.disabled);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
});

function lccConfirm(msg, okLabel) { return _showModal(msg, false, null, okLabel); }
function lccPrompt(msg, defaultVal) { return _showModal(msg, true, defaultVal, 'OK'); }
