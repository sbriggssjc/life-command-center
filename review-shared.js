// ============================================================================
// review-shared.js — Tier 3 Phase 1 shared review primitives
// Life Command Center — UX consolidation (UX_CONSOLIDATION_AUDIT.md, Finding E)
//
// Three reusable building blocks for the Decision Center consolidation:
//   1. planMerge()       — single merge planner for entity + property merges,
//                          routing through the one canonical backend per kind
//                          (entity → /api/entities?action=merge → lcc_merge_entity;
//                           property → /api/admin?_route=consolidate-property →
//                           dia_merge_property / gov_merge_property).
//   2. planFollowup()    — single follow-up planner; one signature, one write
//                          path (generic → /api/actions, or research-task
//                          completion → /api/workflows?action=research_followup).
//   3. LCC_DECISION_LANE_MAP — the lane rationalization map: the 14 decision
//                          types collapsed to ~8 logical lanes (see
//                          docs/capital-markets/TIER3_LANE_MAP.md).
//
// Phase 1 doctrine (additive — nothing removed):
//   - The PURE planners (planMerge / planFollowup / laneForDecisionType) hold the
//     routing + validation logic and are unit-tested headless. The modal UI is a
//     thin wrapper that calls them. No backend is forked — both merge kinds reuse
//     the existing, proven endpoints.
//   - This file loads as a browser <script> (attaches helpers to window) AND is
//     requirable in node tests (CommonJS guard at the bottom). Nothing at module
//     load time touches document/window unconditionally.
// ============================================================================

// ── 1. Lane rationalization map ─────────────────────────────────────────────
// The Decision Center currently routes 14 decision_types to 14 lane cards. The
// logical work collapses to 8 lanes (the merge lanes group, the linking lanes
// group, provenance groups, intake groups, automation groups). This map is the
// single source of truth consumed by the consolidated lane index in Phase 2.
// Phase 1 only DEFINES it — no decision_type is deleted or re-routed yet.
var LCC_REVIEW_LANES = [
  { lane: 'ownership',     title: 'Ownership & control',     question: 'Who is the true owner — confirm or correct?' },
  { lane: 'buyer_mapping', title: 'Buyer parents & SF mapping', question: 'Confirm the sponsor / map to the Salesforce parent account.' },
  { lane: 'entity_merge',  title: 'Entities — merge & clean', question: 'Same entity? Merge duplicates, rename junk, or keep separate.' },
  { lane: 'property_merge', title: 'Properties — merge',      question: 'Same property? Merge duplicates or keep distinct.' },
  { lane: 'provenance',    title: 'Field values & provenance', question: 'Which source/value is right — apply, prefer, or correct?' },
  { lane: 'intake',        title: 'Intake disposition',       question: 'Create the property, pick the match, re-extract, or dismiss.' },
  { lane: 'linkage',       title: 'Links to confirm',         question: 'Is this link (CMS↔property, owner↔contact) correct?' },
  { lane: 'automation',    title: 'Automation needs you',     question: 'Resolve dead-letters and bot-block / implausible-value alerts.' },
];

// decision_type → logical lane. Every type the Decision Center renders today is
// mapped; the SOS owner-contact worklist (built-in, not a decision_type) maps to
// 'linkage' under the synthetic key 'sos_owner_links'.
var LCC_DECISION_LANE_MAP = {
  confirm_true_owner:            { lane: 'ownership',     merges: false },
  resolve_ownership:             { lane: 'ownership',     merges: false },
  confirm_buyer_parent:          { lane: 'buyer_mapping', merges: false },
  map_sf_parent_account:         { lane: 'buyer_mapping', merges: false },
  merge_duplicate_entities:      { lane: 'entity_merge',  merges: 'entity' },
  junk_entity_name:              { lane: 'entity_merge',  merges: 'entity' },
  property_merge:                { lane: 'property_merge', merges: 'property' },
  provenance_conflict:           { lane: 'provenance',    merges: false },
  pending_update:                { lane: 'provenance',    merges: false },
  caprate_review:                { lane: 'provenance',    merges: false },
  bad_rent_lease:                { lane: 'provenance',    merges: false },
  intake_disposition:            { lane: 'intake',        merges: false },
  match_disambiguation:          { lane: 'intake',        merges: false },
  cms_link_suspect:              { lane: 'linkage',       merges: false },
  sf_contact_account_mismatch:   { lane: 'linkage',       merges: false },
  sos_owner_links:               { lane: 'linkage',       merges: false },
  implausible_value:             { lane: 'automation',    merges: false },
  llc_research_dead:             { lane: 'automation',    merges: false },
  availability_checker_botblock: { lane: 'automation',    merges: false },
};

function laneForDecisionType(t) {
  var m = LCC_DECISION_LANE_MAP[t];
  return m ? m.lane : null;
}

// Group an array of {decision_type, n} counts into the logical lanes (for the
// consolidated lane index Phase 2 will render). Returns lanes in LCC_REVIEW_LANES
// order, each with its summed open count + the member decision_types present.
function rollupLaneCounts(typeCounts) {
  var byLane = {};
  (typeCounts || []).forEach(function (tc) {
    var lane = laneForDecisionType(tc.decision_type);
    if (!lane) return;
    if (!byLane[lane]) byLane[lane] = { n: 0, types: [] };
    byLane[lane].n += Number(tc.n) || 0;
    byLane[lane].types.push(tc.decision_type);
  });
  return LCC_REVIEW_LANES.map(function (def) {
    var agg = byLane[def.lane] || { n: 0, types: [] };
    return { lane: def.lane, title: def.title, question: def.question, n: agg.n, types: agg.types };
  });
}

// ── 2. Merge planner (pure) ─────────────────────────────────────────────────
// Validates the merge and resolves the single canonical endpoint + body for the
// kind. survivor/loser are { id, name }. Returns a plan { ok, endpoint, method,
// body, confirmText } or { ok:false, error }.
var _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function planMerge(opts) {
  opts = opts || {};
  var kind = opts.kind;
  var survivor = opts.survivor || {};
  var loser = opts.loser || {};
  var sId = survivor.id != null ? String(survivor.id) : '';
  var lId = loser.id != null ? String(loser.id) : '';
  if (kind !== 'entity' && kind !== 'property' && kind !== 'contact') {
    return { ok: false, error: "merge kind must be 'entity', 'property', or 'contact'" };
  }
  if (!sId || !lId) return { ok: false, error: 'survivor and loser ids are required' };
  if (sId === lId) return { ok: false, error: 'cannot merge a record into itself' };

  var sName = survivor.name || sId;
  var lName = loser.name || lId;
  var confirmText = 'Merge "' + lName + '" INTO "' + sName + '"?\n\n'
    + 'The merged-away record is removed and its data (identities, relationships, '
    + 'portfolio) carries to the survivor. This cannot be undone.';

  if (kind === 'entity') {
    if (!_UUID_RE.test(sId) || !_UUID_RE.test(lId)) {
      return { ok: false, error: 'entity ids must be valid UUIDs' };
    }
    return {
      ok: true, kind: 'entity', method: 'POST',
      endpoint: '/api/entities?action=merge',
      body: { target_id: sId, source_id: lId },
      confirmText: confirmText,
    };
  }

  if (kind === 'contact') {
    // Unified Contacts merge — a separate backend (unified_contacts in the gov
    // DB), keyed by unified_id. keep_id = survivor, merge_id = loser.
    var body = { keep_id: sId, merge_id: lId };
    if (opts.queueId != null && opts.queueId !== '') body.queue_id = String(opts.queueId);
    return {
      ok: true, kind: 'contact', method: 'POST',
      endpoint: '/api/contacts?action=merge',
      body: body,
      confirmText: confirmText,
    };
  }

  // property
  var domain = String(opts.domain || '').toLowerCase();
  if (domain !== 'dia' && domain !== 'gov') {
    return { ok: false, error: "property merge requires domain 'dia' or 'gov'" };
  }
  var keep = parseInt(sId, 10), drop = parseInt(lId, 10);
  if (!Number.isFinite(keep) || !Number.isFinite(drop)) {
    return { ok: false, error: 'property ids must be numeric' };
  }
  return {
    ok: true, kind: 'property', method: 'POST',
    endpoint: '/api/admin?_route=consolidate-property&domain=' + encodeURIComponent(domain),
    body: { keep_id: keep, drop_id: drop },
    confirmText: confirmText,
  };
}

// ── 3. Follow-up planner (pure) ─────────────────────────────────────────────
// One signature for the 6+ "Create Follow-up" triggers. Generic follow-ups write
// to /api/actions; a follow-up that also COMPLETES a research task writes to the
// existing /api/workflows?action=research_followup (research-task semantics
// preserved). Returns { ok, endpoint, method, body } or { ok:false, error }.
function planFollowup(opts) {
  opts = opts || {};
  var title = String(opts.title || '').trim();
  if (!title) return { ok: false, error: 'follow-up title is required' };
  var notes = opts.notes != null ? String(opts.notes).trim() : '';
  var assignee = opts.assigneeId || opts.assigned_to || null;
  var due = opts.dueDate || opts.due_date || null;

  if (opts.researchTaskId) {
    return {
      ok: true, kind: 'research_followup', method: 'POST',
      endpoint: '/api/workflows?action=research_followup',
      body: {
        research_task_id: opts.researchTaskId,
        followup_title: title,
        followup_description: notes || null,
        followup_type: 'follow_up',
        assigned_to: assignee || undefined,
        due_date: due || null,
      },
    };
  }

  var metadata = Object.assign({ source: opts.source || 'review' }, opts.context || {});
  var body = {
    title: title,
    action_type: 'follow_up',
    priority: opts.priority || 'normal',
    visibility: opts.visibility || 'shared',
    metadata: metadata,
  };
  if (notes) body.description = notes;
  if (assignee) body.assigned_to = assignee;
  if (due) body.due_date = due;
  return { ok: true, kind: 'followup', method: 'POST', endpoint: '/api/actions', body: body };
}

// ============================================================================
// Browser-only UI wrappers (no-op / undefined in node). Everything below is
// guarded so requiring this file in a test never touches the DOM.
// ============================================================================
if (typeof document !== 'undefined') {
  (function () {
    function _esc(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }
    function _toast(m, t) { if (typeof showToast === 'function') showToast(m, t); }

    function _ensureOverlay(id) {
      var ov = document.getElementById(id);
      if (ov) return ov;
      ov = document.createElement('div');
      ov.id = id;
      ov.className = 'modal-overlay';
      ov.setAttribute('role', 'dialog');
      document.body.appendChild(ov);
      return ov;
    }

    // ── Shared merge modal (entity / property / contact) ────────────────────
    var _mergeState = null;
    var _KIND_LABEL = { entity: 'entities', property: 'properties', contact: 'contacts' };

    function _mergeCard(s, rec, side) {
      var isSurv = s.survivorId === String(rec.id);
      return '<div class="lcc-merge-card' + (isSurv ? ' is-survivor' : '') + '" '
        + 'onclick="mergeModalSetSurvivor(\'' + _esc(side) + '\')" '
        + 'style="border:2px solid ' + (isSurv ? 'var(--accent,#003DA5)' : 'var(--border,#ccc)')
        + ';border-radius:8px;padding:12px;cursor:pointer;flex:1">'
        + '<div style="font-weight:600">' + _esc(rec.name || rec.id) + '</div>'
        + '<div style="font-size:12px;color:var(--text2,#888)">' + _esc(String(rec.id)) + '</div>'
        + (rec.meta ? '<div style="font-size:12px;color:var(--text2,#888);margin-top:4px">' + _esc(rec.meta) + '</div>' : '')
        + '<div style="font-size:12px;margin-top:6px;font-weight:600;color:' + (isSurv ? 'var(--accent,#003DA5)' : 'var(--text2,#888)') + '">'
        + (isSurv ? '✓ Keep this (survivor)' : 'Keep this') + '</div></div>';
    }

    function _renderMergeModal() {
      var ov = _ensureOverlay('lccMergeModal');
      var s = _mergeState;
      var kindLabel = _KIND_LABEL[s.kind] || 'records';
      var bodyHtml;
      if (!s.b) {
        // Find-target mode: side A known, search for the record to merge.
        bodyHtml = '<div style="font-size:13px;color:var(--text2,#888);margin-bottom:8px">'
          + 'Merging <b>' + _esc(s.a.name || s.a.id) + '</b>. Search for the duplicate to merge with it.</div>'
          + '<div style="display:flex;gap:8px;margin-bottom:10px">'
          + '<input id="lccMergeSearch" type="text" placeholder="Search by name…" '
          + 'style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--s2);color:var(--text);font-size:14px" '
          + 'onkeydown="if(event.key===\'Enter\')mergeModalSearch()">'
          + '<button class="btn-submit" onclick="mergeModalSearch()">Search</button></div>'
          + '<div id="lccMergeResults"></div>';
        ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Merge ' + kindLabel + '</h3>'
          + '<button class="modal-close" onclick="closeMergeModal()" aria-label="Close">&times;</button></div>'
          + '<div class="modal-body">' + bodyHtml + '</div>'
          + '<div class="modal-foot"><button class="btn-cancel" onclick="closeMergeModal()">Cancel</button></div></div>';
        ov.classList.add('open');
        return;
      }
      bodyHtml = '<div style="font-size:13px;color:var(--text2,#888);margin-bottom:12px">'
        + 'Pick the record to KEEP. The other is merged into it and removed.</div>'
        + '<div style="display:flex;gap:12px;align-items:stretch">' + _mergeCard(s, s.a, 'a')
        + '<div style="align-self:center;font-size:20px;color:var(--text2,#888)">&larr;</div>'
        + _mergeCard(s, s.b, 'b') + '</div>';
      ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Merge ' + kindLabel + '</h3>'
        + '<button class="modal-close" onclick="closeMergeModal()" aria-label="Close">&times;</button></div>'
        + '<div class="modal-body">' + bodyHtml + '</div>'
        + '<div class="modal-foot"><button class="btn-cancel" onclick="closeMergeModal()">Cancel</button>'
        + '<button class="btn-submit" id="lccMergeSubmit" onclick="submitMergeModal()">Merge</button></div></div>';
      ov.classList.add('open');
    }

    // openMergeModal({ kind, domain?, queueId?, a:{id,name,meta}, b?:{id,name,meta},
    //   survivorId?, findTarget?, searchEndpoint?, onDone? })
    // b omitted + findTarget:true ⇒ search for the record to merge (entity only).
    window.openMergeModal = function (opts) {
      opts = opts || {};
      var kind = (opts.kind === 'property' || opts.kind === 'contact') ? opts.kind : 'entity';
      if (!opts.a) { _toast('Merge needs a starting record', 'error'); return; }
      if (!opts.b && !opts.findTarget) { _toast('Merge needs two records', 'error'); return; }
      _mergeState = {
        kind: kind,
        domain: opts.domain || null,
        queueId: opts.queueId != null ? opts.queueId : null,
        a: opts.a, b: opts.b || null,
        survivorId: String((opts.survivorId != null ? opts.survivorId : opts.a.id)),
        searchEndpoint: opts.searchEndpoint || '/api/entities?action=search&q=',
        onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
      };
      _renderMergeModal();
    };

    window.mergeModalSearch = async function () {
      var s = _mergeState; if (!s) return;
      var input = document.getElementById('lccMergeSearch');
      var q = input ? String(input.value || '').trim() : '';
      var slot = document.getElementById('lccMergeResults');
      if (q.length < 2) { if (slot) slot.innerHTML = '<div style="font-size:12px;color:var(--text2,#888)">Type at least 2 characters.</div>'; return; }
      if (slot) slot.innerHTML = '<div style="font-size:12px;color:var(--text2,#888)">Searching…</div>';
      var res = (typeof opsApi === 'function') ? await opsApi(s.searchEndpoint + encodeURIComponent(q)) : { ok: false };
      var rows = (res && res.data && (res.data.entities || res.data.items || (Array.isArray(res.data) ? res.data : []))) || [];
      rows = rows.filter(function (r) { return String(r.id) !== String(s.a.id); }).slice(0, 12);
      if (!rows.length) { if (slot) slot.innerHTML = '<div style="font-size:12px;color:var(--text2,#888)">No other records matched.</div>'; return; }
      _mergeState._cand = rows;
      var html = '';
      rows.forEach(function (r, i) {
        var meta = [r.entity_type, r.domain, [r.city, r.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
        html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">'
          + '<div><div style="font-weight:600">' + _esc(r.name || r.id) + '</div>'
          + (meta ? '<div style="font-size:12px;color:var(--text2,#888)">' + _esc(meta) + '</div>' : '') + '</div>'
          + '<button class="btn-submit" onclick="mergeModalPickTarget(' + i + ')">Select</button></div>';
      });
      if (slot) slot.innerHTML = html;
    };

    window.mergeModalPickTarget = function (i) {
      var s = _mergeState; if (!s || !s._cand) return;
      var r = s._cand[i]; if (!r) return;
      s.b = { id: r.id, name: r.name || r.id, meta: [r.entity_type, r.domain].filter(Boolean).join(' · ') };
      _renderMergeModal();
    };

    window.mergeModalSetSurvivor = function (side) {
      if (!_mergeState || !_mergeState[side]) return;
      _mergeState.survivorId = String(_mergeState[side].id);
      _renderMergeModal();
    };

    window.closeMergeModal = function () {
      _mergeState = null;
      var ov = document.getElementById('lccMergeModal');
      if (ov) ov.classList.remove('open');
    };

    window.submitMergeModal = async function () {
      var s = _mergeState;
      if (!s || !s.b) return;
      var survivor = s.survivorId === String(s.a.id) ? s.a : s.b;
      var loser = s.survivorId === String(s.a.id) ? s.b : s.a;
      var plan = planMerge({ kind: s.kind, domain: s.domain, queueId: s.queueId, survivor: survivor, loser: loser });
      if (!plan.ok) { _toast(plan.error, 'error'); return; }
      var btn = document.getElementById('lccMergeSubmit');
      if (btn) { btn.disabled = true; btn.textContent = 'Merging…'; }
      var res = (typeof opsPost === 'function')
        ? await opsPost(plan.endpoint, plan.body)
        : { ok: false, error: 'opsPost unavailable' };
      if (btn) { btn.disabled = false; btn.textContent = 'Merge'; }
      if (res && res.ok) {
        _toast((_KIND_LABEL[s.kind] || 'records') + ' merged', 'success');
        var done = s.onDone;
        window.closeMergeModal();
        if (done) done(res);
        else if (typeof refreshActiveOpsPage === 'function') refreshActiveOpsPage();
      } else {
        _toast('Merge failed: ' + ((res && (res.error || (res.data && res.data.error))) || 'unknown'), 'error');
      }
    };

    // ── Shared follow-up modal ──────────────────────────────────────────────
    var _fuState = null;

    function _renderFollowupModal(members) {
      var ov = _ensureOverlay('lccFollowupModal');
      var s = _fuState;
      var opts = (members || []).filter(function (m) { return m.is_active !== false; })
        .map(function (m) { return '<option value="' + _esc(m.user_id) + '">' + _esc(m.display_name || m.email || m.user_id) + '</option>'; })
        .join('');
      ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>Create follow-up</h3>'
        + '<button class="modal-close" onclick="closeFollowupShared()" aria-label="Close">&times;</button></div>'
        + '<div class="modal-body">'
        + (s.contextLabel ? '<div style="font-size:13px;color:var(--text2,#888);margin-bottom:12px">' + _esc(s.contextLabel) + '</div>' : '')
        + '<label for="lccFuTitle">Title</label><input type="text" id="lccFuTitle" value="' + _esc(s.title || '') + '" placeholder="Follow-up action title">'
        + '<label for="lccFuAssignee">Assignee</label><select id="lccFuAssignee">' + opts + '</select>'
        + '<label for="lccFuDue">Due date</label><input type="date" id="lccFuDue">'
        + '<label for="lccFuNotes">Notes</label><textarea id="lccFuNotes" rows="4" placeholder="Optional notes" '
        + 'style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--s2);color:var(--text);font-size:14px;resize:vertical;font-family:inherit"></textarea>'
        + '</div><div class="modal-foot"><button class="btn-cancel" onclick="closeFollowupShared()">Cancel</button>'
        + '<button class="btn-submit" id="lccFuSubmit" onclick="submitFollowupShared()">Create</button></div></div>';
      ov.classList.add('open');
    }

    // openFollowupModal({ title?, contextLabel?, source?, context?, researchTaskId?, onDone? })
    window.openFollowupModal = async function (opts) {
      opts = opts || {};
      _fuState = {
        title: opts.title || '',
        contextLabel: opts.contextLabel || '',
        source: opts.source || 'review',
        context: opts.context || {},
        researchTaskId: opts.researchTaskId || null,
        onDone: typeof opts.onDone === 'function' ? opts.onDone : null,
      };
      var members = (typeof loadWorkspaceMembers === 'function') ? (await loadWorkspaceMembers() || []) : [];
      _renderFollowupModal(members);
    };

    window.closeFollowupShared = function () {
      _fuState = null;
      var ov = document.getElementById('lccFollowupModal');
      if (ov) ov.classList.remove('open');
    };

    window.submitFollowupShared = async function () {
      var s = _fuState;
      if (!s) return;
      var plan = planFollowup({
        title: (document.getElementById('lccFuTitle') || {}).value,
        notes: (document.getElementById('lccFuNotes') || {}).value,
        assigneeId: (document.getElementById('lccFuAssignee') || {}).value,
        dueDate: (document.getElementById('lccFuDue') || {}).value,
        source: s.source, context: s.context, researchTaskId: s.researchTaskId,
      });
      if (!plan.ok) { _toast(plan.error, 'error'); return; }
      var btn = document.getElementById('lccFuSubmit');
      if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
      var res = (typeof opsPost === 'function')
        ? await opsPost(plan.endpoint, plan.body)
        : { ok: false, error: 'opsPost unavailable' };
      if (btn) { btn.disabled = false; btn.textContent = 'Create'; }
      if (res && res.ok) {
        _toast('Follow-up created', 'success');
        var done = s.onDone;
        window.closeFollowupShared();
        if (done) done(res);
        else if (typeof refreshActiveOpsPage === 'function') refreshActiveOpsPage();
      } else {
        _toast('Could not create follow-up: ' + ((res && (res.error || (res.data && res.data.error))) || 'unknown'), 'error');
      }
    };
  })();
}

// Expose pure helpers on window for the browser callers (classic scripts such as
// ops.js / contacts-ui.js reference these as globals at click-time).
if (typeof window !== 'undefined') {
  window.planMerge = planMerge;
  window.planFollowup = planFollowup;
  window.laneForDecisionType = laneForDecisionType;
  window.rollupLaneCounts = rollupLaneCounts;
  window.LCC_DECISION_LANE_MAP = LCC_DECISION_LANE_MAP;
  window.LCC_REVIEW_LANES = LCC_REVIEW_LANES;
}

// ESM export for headless unit tests (the package is type:module). Harmless in
// the browser when loaded via <script type="module">.
export {
  planMerge,
  planFollowup,
  laneForDecisionType,
  rollupLaneCounts,
  LCC_DECISION_LANE_MAP,
  LCC_REVIEW_LANES,
};
