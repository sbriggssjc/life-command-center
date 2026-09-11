// ============================================================================
// OC1 — the in-app "Note" button, every page.
//
// Classic script, shared global scope (W6.5 — NO bundler, NO type="module").
// Renders a small floating button + a one-textbox modal, auto-captures
// route/entity/recent-errors, and POSTs to /api/operator-notes. Nothing
// about this button requires a lane, type, or severity — that is triage's
// job (OC2), never the capturing surface's.
// ============================================================================

(function () {
  function currentRoute() {
    try { return location.hash || '#/'; } catch (_e) { return null; }
  }

  function currentEntity() {
    // Best-effort: the detail panel (detail.js) tracks the open entity/property
    // via a few different globals depending on what's open. Read whatever
    // exists; never throw if none do.
    try {
      if (window._detailStack && window._detailStack.length) {
        var top = window._detailStack[window._detailStack.length - 1];
        return { entity_id: top.id || top.entityId || null, entity_type: top.kind || top.type || null };
      }
    } catch (_e) { /* best-effort */ }
    return { entity_id: null, entity_type: null };
  }

  function recentErrors() {
    try { return (window.__lccRecentErrors || []).slice(-10); } catch (_e) { return []; }
  }

  function buildButton() {
    var btn = document.createElement('button');
    btn.id = 'lcc-operator-note-btn';
    btn.type = 'button';
    btn.title = 'Note something for the team (bug, data gap, idea, question)';
    btn.textContent = '📝 Note';
    btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:9998;'
      + 'padding:8px 14px;border-radius:999px;border:1px solid var(--border,#333);'
      + 'background:var(--s2,#1c1c1e);color:var(--text1,#eee);font-size:12px;'
      + 'font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,0.35);'
      + 'opacity:0.85;';
    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '0.85'; });
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function openModal() {
    var existing = document.getElementById('lcc-operator-note-overlay');
    if (existing) { existing.remove(); }

    var overlay = document.createElement('div');
    overlay.id = 'lcc-operator-note-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.55);'
      + 'display:flex;align-items:center;justify-content:center;';

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--s2,#1c1c1e);border:1px solid var(--border,#333);'
      + 'border-radius:12px;padding:20px;max-width:440px;width:90%;'
      + 'box-shadow:0 8px 32px rgba(0,0,0,0.4);';

    var title = document.createElement('div');
    title.textContent = 'Note something';
    title.style.cssText = 'font-size:14px;font-weight:700;color:var(--text1,#eee);margin-bottom:10px;';

    var textarea = document.createElement('textarea');
    textarea.placeholder = "What's wrong, missing, or a good idea? (one funnel, sorted for you — no need to classify it)";
    textarea.rows = 5;
    textarea.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;'
      + 'border:1px solid var(--border,#333);border-radius:6px;background:var(--s3,#222);'
      + 'color:var(--text1,#eee);font-size:13px;font-family:inherit;resize:vertical;';

    var status = document.createElement('div');
    status.style.cssText = 'font-size:12px;color:var(--text2,#999);margin-top:8px;min-height:16px;';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:14px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;border:1px solid var(--border,#333);border-radius:6px;'
      + 'background:var(--s3,#222);color:var(--text2,#999);font-size:13px;cursor:pointer;';
    cancelBtn.addEventListener('click', function () { overlay.remove(); });

    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:6px;'
      + 'background:var(--accent,#4a9eff);color:#fff;font-size:13px;font-weight:600;cursor:pointer;';
    sendBtn.addEventListener('click', function () { submitNote(textarea.value, status, overlay, sendBtn); });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(sendBtn);
    box.appendChild(title);
    box.appendChild(textarea);
    box.appendChild(status);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    textarea.focus();

    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
  }

  function submitNote(text, statusEl, overlay, sendBtn) {
    var trimmed = (text || '').trim();
    if (!trimmed) { statusEl.textContent = 'Type something first.'; return; }

    sendBtn.disabled = true;
    statusEl.textContent = 'Sending…';

    var entity = currentEntity();
    var payload = {
      channel: 'in_app_note',
      raw_text: trimmed,
      context: {
        route: currentRoute(),
        entity_id: entity.entity_id,
        entity_type: entity.entity_type,
        recent_errors: recentErrors(),
      },
    };

    var headers = { 'Content-Type': 'application/json' };
    try {
      if (window.LCC_API_KEY) headers['X-LCC-Key'] = window.LCC_API_KEY;
    } catch (_e) { /* auth.js's fetch interceptor also attaches this globally */ }

    fetch('/api/operator-notes', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) {
          statusEl.textContent = 'Noted — thanks.';
          setTimeout(function () { overlay.remove(); }, 700);
        } else {
          statusEl.textContent = 'Could not send: ' + (res.body && res.body.error ? res.body.error : 'unknown error');
          sendBtn.disabled = false;
        }
      })
      .catch(function (err) {
        statusEl.textContent = 'Could not send: ' + (err && err.message ? err.message : String(err));
        sendBtn.disabled = false;
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildButton);
  } else {
    buildButton();
  }
})();
