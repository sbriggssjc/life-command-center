// ─────────────────────────────────────────────────────────────────────────────
// detail-openers.js — W6.5 Stage 2, Unit 7 (extracted from detail.js
// 2026-08-20). Moved VERBATIM from detail.js lines 13075-13385.
//
// THE ENTRY POINTS: resolve a subject by id or by name, then open the right
// detail panel. Plus the deal-scoped "Log call" quick-log modal that hangs off
// the same surface.
//
//   _callNoteCtx · _ensureCallNoteModal · openCallNote · closeCallNote
//   submitCallNote                              the W7.3 quick-log modal
//   openContact360                              id → delegates to openEntityDetail
//   openEntityDetailByName                      name → /api/entities lookup
//   openContactDetail · openContactDetailByName name/id → /api/contacts lookup
//
// ⚠️ THE MAP CALLED THIS "detail-contact.js" AND THAT NAME IS WRONG.
// openEntityDetailByName is an ENTITY opener and sits in the middle of the
// cluster — not a stray, but the entity sibling of the same resolve-and-open
// family (all four share _entityApiFetch). Filing it under a contact-only name
// would have meant either mislabelling it or splitting a cohesive region to
// satisfy the label. Named for what it IS. See map §2b.
//
// STAYS in detail.js: openEntityDetail (the panel opener these delegate INTO),
// _entityApiFetch / _entityApiHeaders (the shared fetch layer, called at CALL
// time), and the whole dispatcher.
//
// NOTE ON EXPORTS: only the modal's four carry explicit `window.` assignments.
// The openers do not need them — a top-level `function` declaration in a CLASSIC
// script becomes a property of the global object automatically (unlike
// let/const), so `onclick="openContactDetailByName(...)"` resolves. That is
// preserved here because this is also a classic script loaded into the same
// shared global scope.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// W7.3 path A — deal-scoped "Log call" quick-log
// ----------------------------------------------------------------------------
// The deal-surface "Log call" button. Writes a deal-stamped `call` activity via
// POST /api/intake-log-call (→ logManualCallNote), so the note flows into the
// deal summary + next steps through the LIVE W7.2 tick. Self-contained: builds
// its own lightweight modal (no index.html edit) so it can't collide with the
// separate Salesforce-task "Log Call" modal (openLogCall) elsewhere.
// ============================================================================
var _callNoteCtx = {};
function _ensureCallNoteModal() {
  let m = document.getElementById('dealCallNoteModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'dealCallNoteModal';
  m.className = 'modal';
  m.innerHTML =
    '<div class="modal-content" style="max-width:480px">' +
    '  <div class="modal-header"><h3 style="margin:0">Log call</h3>' +
    '    <button class="modal-close" onclick="closeCallNote()">&times;</button></div>' +
    '  <div class="modal-body">' +
    '    <div id="dealCallNoteCtx" style="font-size:12px;color:var(--text2);margin-bottom:10px"></div>' +
    '    <label style="font-size:12px;color:var(--text2)">Direction' +
    '      <select id="dealCallNoteDir" style="width:100%;margin-top:4px;margin-bottom:10px;padding:6px">' +
    '        <option value="made">Call made</option>' +
    '        <option value="received">Call received</option></select></label>' +
    '    <label style="font-size:12px;color:var(--text2)">When' +
    '      <input id="dealCallNoteDate" type="date" style="width:100%;margin-top:4px;margin-bottom:10px;padding:6px"></label>' +
    '    <label style="font-size:12px;color:var(--text2)">Notes' +
    '      <textarea id="dealCallNoteNotes" rows="5" placeholder="What was discussed / committed…" style="width:100%;margin-top:4px;padding:6px"></textarea></label>' +
    '  </div>' +
    '  <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
    '    <button class="act-btn" onclick="closeCallNote()">Cancel</button>' +
    '    <button class="act-btn primary" id="dealCallNoteSubmit" onclick="submitCallNote()">Log call</button>' +
    '  </div></div>';
  document.body.appendChild(m);
  return m;
}

function openCallNote(entityId, name) {
  _callNoteCtx = { entityId: entityId || null, name: name || '' };
  const m = _ensureCallNoteModal();
  const ctx = document.getElementById('dealCallNoteCtx');
  const dateEl = document.getElementById('dealCallNoteDate');
  const notesEl = document.getElementById('dealCallNoteNotes');
  const btn = document.getElementById('dealCallNoteSubmit');
  if (ctx) ctx.textContent = 'Logging a call on: ' + (name || 'this deal');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  if (notesEl) notesEl.value = '';
  if (btn) { btn.disabled = false; btn.textContent = 'Log call'; }
  m.classList.add('open');
  m.style.display = 'flex';
}
function closeCallNote() {
  const m = document.getElementById('dealCallNoteModal');
  if (m) { m.classList.remove('open'); m.style.display = 'none'; }
}
async function submitCallNote() {
  const btn = document.getElementById('dealCallNoteSubmit');
  const dirEl = document.getElementById('dealCallNoteDir');
  const dateEl = document.getElementById('dealCallNoteDate');
  const notesEl = document.getElementById('dealCallNoteNotes');
  const notes = notesEl ? notesEl.value.trim() : '';
  if (!notes) { if (typeof showToast === 'function') showToast('Add a note first.', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }
  const payload = {
    deal_entity_id: _callNoteCtx.entityId || undefined,
    direction: dirEl ? dirEl.value : undefined,
    contact_name: _callNoteCtx.name || undefined,
    occurred_at: dateEl && dateEl.value ? new Date(dateEl.value + 'T12:00:00Z').toISOString() : undefined,
    notes,
  };
  try {
    const fetchFn = (typeof LCC_AUTH !== 'undefined' && LCC_AUTH.isAuthenticated) ? LCC_AUTH.apiFetch : fetch;
    const res = await fetchFn('/api/intake-log-call', {
      method: 'POST', headers: _entityApiHeaders(), body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (typeof showToast === 'function') showToast(data.note || 'Call logged.', 'success');
      closeCallNote();
      // Refresh the open entity so the just-logged call shows in Activity.
      if (typeof openEntityDetail === 'function' && _callNoteCtx.entityId) {
        try { openEntityDetail(_callNoteCtx.entityId, 'Activity'); } catch (_e) {}
      }
    } else {
      if (typeof showToast === 'function') showToast('Error: ' + (data.error || res.status), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Log call'; }
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Network error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Log call'; }
  }
}
window.openCallNote = openCallNote;
window.closeCallNote = closeCallNote;
window.submitCallNote = submitCallNote;

// ── Contact 360 — the ONE reusable trigger (Deals cards, Contacts view, the
// coming Marketing tab). Takes a contact/entity id and opens the canonical
// Contact 360 panel. Works for any contact:
//   • an owner ENTITY id (or opts.kind==='entity' / opts.entity_id) → opens directly
//   • a unified_contacts row → resolve its entity_id, then open the entity panel
//   • a plain person/broker contact with NO entity → fall back to the lighter
//     openContactDetail drawer (contacts-ui.js) so a broker still resolves.
async function openContact360(id, opts = {}) {
  if (!id) return;
  const tab = opts.tab || 'Overview';
  // Caller already knows the entity id.
  if (opts.entity_id) { openEntityDetail(opts.entity_id, tab); return; }
  if (opts.kind === 'entity') { openEntityDetail(id, tab); return; }

  // Resolve a unified_contacts row → its owning/self person entity.
  try {
    const data = await _entityApiFetch('/api/contacts?action=get&id=' + encodeURIComponent(id)).catch(() => null);
    const eid = data && data.contact && data.contact.entity_id;
    if (eid) { openEntityDetail(eid, tab); return; }
    // A real contact row with no linked entity → the lighter drawer resolves it.
    if (data && data.contact && typeof openContactDetail === 'function') { openContactDetail(id); return; }
  } catch (_) { /* fall through */ }

  // Not a unified_contacts row (or lookup failed): the light drawer if present,
  // else best-effort open as an entity.
  if (typeof openContactDetail === 'function') { openContactDetail(id); return; }
  openEntityDetail(id, tab);
}
window.openContact360 = openContact360;

/** Open entity detail by name search (when only name is available) */
async function openEntityDetailByName(name) {
  if (!name) return;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const bodyEl = document.getElementById('detailBody');
  const tabsEl = document.getElementById('detailTabs');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(name)}</div>
        <div class="detail-subtitle">Searching...</div>
      </div>
      <span class="detail-badge" style="background:var(--accent);color:#fff">ENTITY</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Looking up entity...</p></div>';
  if (tabsEl) tabsEl.innerHTML = '';

  try {
    const data = await _entityApiFetch('/api/entities?action=search&q=' + encodeURIComponent(name));
    const entities = data?.entities || [];

    if (entities.length === 1) {
      // Exact single match — open it
      openEntityDetail(entities[0].id);
      return;
    }

    if (entities.length > 1) {
      // Multiple matches — show list to pick from
      let html = '<div class="detail-section"><div class="detail-section-title">Multiple entities found for "' + esc(name) + '"</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">';
      for (const e of entities) {
        const loc = (e.city || '') + (e.city && e.state ? ', ' : '') + (e.state || '');
        html += '<div onclick="openEntityDetail(\'' + esc(e.id) + '\')" style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer;display:flex;gap:12px;align-items:center">';
        html += '<div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text)">' + esc(e.name) + '</div>';
        html += '<div style="font-size:11px;color:var(--text2)">' + esc(e.entity_type || '') + (loc ? ' · ' + esc(loc) : '') + '</div></div>';
        html += '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s3);color:var(--text2)">' + esc(e.entity_type || 'org') + '</span>';
        html += '</div>';
      }
      html += '</div></div>';
      if (bodyEl) bodyEl.innerHTML = html;
      return;
    }

    // No matches — show not found with helpful message
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">No entity found matching "' + esc(name) + '".<br><span class="t-meta3-sm">Try the Entities page to search or create one.</span></div>';
  } catch (err) {
    console.error('Entity lookup error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error searching entities: ' + esc(err.message) + '</div>';
  }
}

/** Open contact detail panel by contact ID */
async function openContactDetail(contactId) {
  _entityDetailCache = null;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const tabsEl = document.getElementById('detailTabs');
  const bodyEl = document.getElementById('detailBody');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">Loading contact...</div>
      </div>
      <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Loading contact details...</p></div>';

  try {
    const data = await _entityApiFetch('/api/contacts?action=get&id=' + encodeURIComponent(contactId));
    const contact = data?.contact || null;
    if (!contact) {
      if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Contact not found</div>';
      return;
    }

    // Fetch activities if contact has a linked entity
    let activities = [];
    if (contact.entity_id) {
      try {
        const actData = await _entityApiFetch('/api/activities?entity_id=' + encodeURIComponent(contact.entity_id) + '&order=occurred_at.desc&limit=20');
        activities = actData?.activities || [];
      } catch (_) { /* ignore */ }
    }

    _entityDetailCache = { contact, activities, type: 'contact' };

    // Render header
    if (headerEl) headerEl.innerHTML = `
      <div class="detail-header-info">
        <div style="flex:1;min-width:0">
          <div class="detail-title">${esc(contact.full_name || contact.display_name || 'Unknown')}</div>
          <div class="detail-subtitle">${esc(contact.title || '')}${contact.title && contact.company_name ? ' at ' : ''}${esc(contact.company_name || '')}</div>
        </div>
        <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
        <button class="detail-close" onclick="closeDetail()">&times;</button>
      </div>`;

    // Tabs for contacts
    if (tabsEl) tabsEl.innerHTML = '<button class="detail-tab active" onclick="_switchContactTab(\'Details\')">Details</button><button class="detail-tab" onclick="_switchContactTab(\'Activity\')">Activity</button>';

    if (bodyEl) bodyEl.innerHTML = _renderContactTab(contact);
  } catch (err) {
    console.error('Contact detail error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error loading contact: ' + esc(err.message) + '</div>';
  }
}

/** Open contact detail by name search */
async function openContactDetailByName(name) {
  if (!name) return;
  const panel = document.getElementById('detailPanel');
  const overlay = document.getElementById('detailOverlay');
  if (!panel || !overlay) return;

  panel.style.display = 'block';
  overlay.classList.add('open');

  const headerEl = document.getElementById('detailHeader');
  const bodyEl = document.getElementById('detailBody');
  const tabsEl = document.getElementById('detailTabs');

  if (headerEl) headerEl.innerHTML = `
    <button class="detail-back" onclick="closeDetail()">&#x2190;<span>Back</span></button>
    <div class="detail-header-info">
      <div style="flex:1;min-width:0">
        <div class="detail-title">${esc(name)}</div>
        <div class="detail-subtitle">Searching...</div>
      </div>
      <span class="detail-badge" style="background:var(--purple);color:#fff">CONTACT</span>
    </div>
    <button class="detail-close" onclick="closeDetail()">&times;</button>`;
  if (bodyEl) bodyEl.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><span class="spinner"></span><p style="margin-top:12px">Looking up contact...</p></div>';
  if (tabsEl) tabsEl.innerHTML = '';

  try {
    const data = await _entityApiFetch('/api/contacts?action=list&q=' + encodeURIComponent(name) + '&limit=10');
    const contacts = data?.contacts || [];

    if (contacts.length === 1) {
      openContactDetail(contacts[0].id);
      return;
    }

    if (contacts.length > 1) {
      let html = '<div class="detail-section"><div class="detail-section-title">Multiple contacts found for "' + esc(name) + '"</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">';
      for (const c of contacts) {
        html += '<div onclick="openContactDetail(\'' + esc(c.id) + '\')" style="padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:8px;cursor:pointer">';
        html += '<div style="font-weight:600;color:var(--text)">' + esc(c.full_name || c.display_name || 'Unknown') + '</div>';
        html += '<div style="font-size:11px;color:var(--text2)">' + esc(c.title || '') + (c.company_name ? ' · ' + esc(c.company_name) : '') + '</div>';
        html += '</div>';
      }
      html += '</div></div>';
      if (bodyEl) bodyEl.innerHTML = html;
      return;
    }

    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">No contact found matching "' + esc(name) + '"</div>';
  } catch (err) {
    console.error('Contact lookup error:', err);
    if (bodyEl) bodyEl.innerHTML = '<div class="detail-empty">Error searching contacts: ' + esc(err.message) + '</div>';
  }
}
