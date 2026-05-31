/* ============================================================================
 * DRAFT -- NOT YET APPLIED TO detail.js
 * ----------------------------------------------------------------------------
 * Phase 4 (Ownership De-anonymization) front-end: a read-only "ladder" that
 * renders Recorded Owner -> True Owner with an explicit CONFIDENCE chip and a
 * DIVERGENCE flag, then routes each gap forward to an action.
 *
 * This is the UI that consumes the (schema-confirmed) backend handlers from
 * DRAFT_operations_create_lead_initiate_cadence.js. It is "read-only" in the
 * sense that the ladder itself only READS; the existing Resolve-Ownership form
 * and the new action buttons are the write paths.
 *
 * It drops into _udTabOwnership() (detail.js ~line 5788, the
 * "CURRENT OWNERSHIP" block). Conventions matched against detail.js as of
 * 2026-05-30:
 *   - _udCache.ownership  (one v_ownership_current row, fetched at line 223)
 *   - _udCache.chain, _udCache.db
 *   - esc(), _ownerLink(), _ownerCtxFromCurrent(own, db, which)
 *   - CSS vars: --s2 --s3 --border --text --text2 --text3 --purple --green
 *               --yellow --red --accent
 *   - showToast(msg, level), _udBtnGuard(btn, fn, ...args)
 *   - qFn = (db === 'gov' ? govQuery : diaQuery)   // signature: (table, select, {filter, order, limit})
 *
 * Per the live schema sweep the ownership VIEWS carry no confidence column, so
 * confidence is joined from true_owners.owner_role_confidence (and, when a
 * research task drives it, ownership_research_queue.ai_confidence on gov).
 * Divergence on gov comes from v_recorded_vs_assessor_owner_divergence; on dia
 * it is derived from recorded vs true.
 * ========================================================================== */


/* ----------------------------------------------------------------------------
 * STEP 1 -- Enrich the ownership cache with confidence + divergence.
 *
 * Call this once, right after the main detail fetch populates _udCache (near
 * line 223, in the same Promise block that fetches v_ownership_current), or
 * lazily the first time the Ownership tab renders. It is best-effort: any
 * failure leaves _udCache.ownerConf / .ownerDivergence undefined and the ladder
 * renders without those adornments (never blocks the panel).
 * -------------------------------------------------------------------------- */

async function _udEnrichOwnershipSignals() {
  if (!_udCache || !_udCache.ownership) return;
  const own = _udCache.ownership;
  const db = _udCache.db;
  const qFn = db === 'gov' ? govQuery : diaQuery;

  // --- Confidence: true_owners.owner_role_confidence (numeric, may be string) ---
  // Only fetch when we have a true_owner_id and haven't already enriched.
  if (own.true_owner_id && _udCache.ownerConf === undefined) {
    try {
      const res = await qFn('true_owners', 'true_owner_id,owner_role,owner_role_confidence,owner_role_source', {
        filter: `true_owner_id=eq.${encodeURIComponent(own.true_owner_id)}`,
        limit: 1,
      });
      const row = Array.isArray(res) ? res[0] : (res && res.data ? res.data[0] : null);
      if (row) {
        const raw = row.owner_role_confidence;
        const num = raw == null ? null : Number(raw);          // string-encoded numeric -> number
        _udCache.ownerConf = {
          value: (num != null && !isNaN(num)) ? num : null,
          role: row.owner_role || null,
          source: row.owner_role_source || null,
        };
      } else {
        _udCache.ownerConf = null;
      }
    } catch (_e) {
      _udCache.ownerConf = null;
    }
  }

  // --- Divergence ---
  // gov: dedicated view comparing recorded vs assessor owner.
  // dia: no such view -> derive from recorded vs true on the row itself.
  if (_udCache.ownerDivergence === undefined) {
    if (db === 'gov') {
      const pid = _udCache.ids?.property_id || own.property_id;
      if (pid != null) {
        try {
          const res = await qFn('v_recorded_vs_assessor_owner_divergence',
            'property_id,recorded_owner_name,assessor_owner_name,recorded_unified_id,assessor_unified_id', {
              filter: `property_id=eq.${encodeURIComponent(pid)}`,
              limit: 1,
            });
          const row = Array.isArray(res) ? res[0] : (res && res.data ? res.data[0] : null);
          _udCache.ownerDivergence = row
            ? { kind: 'assessor', a: row.recorded_owner_name, b: row.assessor_owner_name, source: 'v_recorded_vs_assessor_owner_divergence' }
            : null;
        } catch (_e) {
          _udCache.ownerDivergence = null;
        }
      } else {
        _udCache.ownerDivergence = null;
      }
    } else {
      // dia: derive. Only a divergence if BOTH names exist and differ on
      // canonical, and the true owner isn't a mis-stamped operator.
      const rec = own.recorded_owner_canonical || own.recorded_owner;
      const tru = own.true_owner_canonical || own.true_owner;
      _udCache.ownerDivergence = (rec && tru && rec !== tru && !own.true_owner_is_operator)
        ? { kind: 'true', a: rec, b: tru, source: 'v_ownership_current (derived)' }
        : null;
    }
  }
  if (typeof _setUdCache === 'function') _setUdCache(_udCache);
}


/* ----------------------------------------------------------------------------
 * STEP 2 -- The ladder renderer. Returns an HTML string.
 *
 * Drop this in place of the current "SIDE-BY-SIDE OWNER CARDS" block inside
 * _udTabOwnership() (detail.js ~lines 5799-5861). It reuses the same display
 * variables (_recDisplay, _trueDisplay) and _ownerLink/_ownerCtxFromCurrent
 * helpers, so it slots in without touching the surrounding code.
 * -------------------------------------------------------------------------- */

function _udOwnershipLadder(own, db) {
  const recDisplay  = own.recorded_owner_canonical || own.recorded_owner || '';
  const trueDisplay = own.true_owner_canonical     || own.true_owner     || '';
  const trueIsOperator = !!own.true_owner_is_operator;
  // A true owner is "resolved" when present and not a mis-stamped operator.
  const trueResolved = trueDisplay && !trueIsOperator;

  const conf = _udCache.ownerConf || null;       // {value, role, source} | null
  const divergence = _udCache.ownerDivergence || null;

  let h = '';
  h += '<div style="display:grid;grid-template-columns:1fr 26px 1fr;gap:0;align-items:stretch;margin-bottom:12px">';

  // ── Recorded owner step ───────────────────────────────────────────────
  h += '<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px">';
  h += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:6px">Recorded Owner (deed)</div>';
  if (recDisplay) {
    h += '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">'
       + _ownerLink(recDisplay, _ownerCtxFromCurrent(own, db, 'recorded')) + '</div>';
    if (own.recorded_owner_type || own.owner_type)
      h += '<div style="font-size:11px;color:var(--text2)">' + esc(own.recorded_owner_type || own.owner_type) + '</div>';
    // LLC de-anon detail (dia exposes these via join; gov via recorded_owner_contact)
    const llcBits = [];
    if (own.manager_name) llcBits.push('Mgr: ' + esc(own.manager_name));
    if (own.registered_agent_name) llcBits.push('Agent: ' + esc(own.registered_agent_name));
    const filingState = own.state_of_incorporation || own.filing_state || own.recorded_owner_state;
    if (filingState) llcBits.push('Filed: ' + esc(filingState));
    if (llcBits.length) h += '<div style="font-size:11px;color:var(--text3);margin-top:4px">' + llcBits.join(' · ') + '</div>';
  } else {
    h += '<div style="font-size:15px;font-weight:700;color:var(--red);margin-bottom:4px">— not on file —</div>';
    h += '<div style="font-size:11px;color:var(--text3)">No recorded owner. Pull from county deed / CoStar / RCA.</div>';
  }
  h += '</div>';

  // ── Connector arrow ───────────────────────────────────────────────────
  h += '<div style="display:flex;align-items:center;justify-content:center;color:var(--purple);font-size:18px">→</div>';

  // ── True owner step ───────────────────────────────────────────────────
  const trueStepBg = trueResolved
    ? 'linear-gradient(135deg,rgba(165,94,234,0.08),rgba(165,94,234,0.04));border:1px solid rgba(165,94,234,0.3)'
    : 'var(--s2);border:1px solid var(--border)';
  h += '<div style="background:' + trueStepBg + ';border-radius:10px;padding:14px 16px">';
  h += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--purple);margin-bottom:6px">True Owner / Decision Maker</div>';
  if (trueResolved) {
    h += '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">'
       + _ownerLink(trueDisplay, _ownerCtxFromCurrent(own, db, 'true')) + '</div>';
    if (own.true_owner_type) h += '<div style="font-size:11px;color:var(--text2)">' + esc(own.true_owner_type) + '</div>';
    // Confidence chip
    if (conf && conf.value != null) {
      const pct = Math.round(conf.value * 100);
      const band = conf.value >= 0.8 ? 'var(--green)' : conf.value >= 0.5 ? 'var(--yellow)' : 'var(--red)';
      h += '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;font-weight:600;color:var(--text2)">'
         + 'Confidence'
         + '<span style="display:inline-block;width:54px;height:6px;border-radius:3px;background:var(--s3);overflow:hidden">'
         + '<span style="display:block;height:100%;width:' + pct + '%;background:' + band + '"></span></span>'
         + '<span style="color:' + band + '">' + pct + '%</span>'
         + (conf.role ? '<span style="color:var(--text3);font-weight:400">· ' + esc(conf.role) + '</span>' : '')
         + '</div>';
    } else {
      h += '<div style="margin-top:6px;font-size:11px;color:var(--text3)">Confidence: unscored</div>';
    }
  } else if (trueIsOperator) {
    // Do NOT hide (the current code hides this case); label it instead.
    h += '<div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">' + esc(trueDisplay) + '</div>';
    h += '<div style="font-size:11px;color:var(--yellow)">Operator-owner — verify this is the real-estate owner, not the chain operator.</div>';
  } else {
    h += '<div style="font-size:15px;font-weight:700;color:var(--red);margin-bottom:4px">— unresolved —</div>';
    h += '<div style="font-size:11px;color:var(--text3)">Beneficial owner not yet identified. Queue LLC / SoS research.</div>';
  }
  h += '</div>';
  h += '</div>'; // close ladder grid

  // ── Divergence flag ────────────────────────────────────────────────────
  if (divergence) {
    const label = divergence.kind === 'assessor' ? 'Assessor disagrees' : 'Recorded vs true differ';
    h += '<div style="display:flex;align-items:center;gap:10px;background:rgba(251,191,36,0.10);border:1px solid rgba(251,191,36,0.30);border-radius:8px;padding:9px 12px;margin:0 0 12px;font-size:12px">';
    h += '<span style="font-weight:700;color:var(--yellow)">⚠ ' + esc(label) + '</span>';
    h += '<span style="color:var(--text2)">' + esc(divergence.a || '—') + '  vs  <b>' + esc(divergence.b || '—') + '</b></span>';
    h += '</div>';
  }

  // ── Forward actions ────────────────────────────────────────────────────
  // The gap IS the action. Buttons map to the (existing + new) endpoints.
  const pid = _udCache.ids?.property_id || own.property_id || '';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">';
  if (trueResolved) {
    // Owner is known -> push toward prospecting.
    h += '<button onclick="_udBtnGuard(this,_udCreateLeadFromProperty)" style="padding:8px 13px;background:var(--accent);color:#fff;border:none;border-radius:7px;font-weight:600;font-size:12.5px;cursor:pointer">Create lead</button>';
    h += '<button onclick="_udBtnGuard(this,_udAddToCadence)" style="padding:8px 13px;background:var(--s2);border:1px solid var(--border);color:var(--text);border-radius:7px;font-weight:600;font-size:12.5px;cursor:pointer">Add to cadence</button>';
  } else {
    // Owner is unresolved -> the research move.
    h += '<button onclick="_udResolveGap(\'focus:udOwnTrue\')" style="padding:8px 13px;background:var(--accent);color:#fff;border:none;border-radius:7px;font-weight:600;font-size:12.5px;cursor:pointer">Resolve owner</button>';
    // Open Secretary of State (reuses the existing next-action behavior).
    h += '<button onclick="_udResolveGap(\'focus:udOwnRecorded\')" style="padding:8px 13px;background:var(--s2);border:1px solid var(--border);color:var(--text);border-radius:7px;font-weight:600;font-size:12.5px;cursor:pointer">Pull recorded owner</button>';
  }
  h += '</div>';

  return h;
}


/* ----------------------------------------------------------------------------
 * STEP 3 -- Action hooks for the two new buttons.
 *
 * These call the backend sub-routes from
 * DRAFT_operations_create_lead_initiate_cadence.js. They follow the same
 * pattern as the existing _udSaveOwnership (detail.js ~10073): use the standard
 * fetch wrapper, showToast on result, refresh the tab on success.
 * -------------------------------------------------------------------------- */

async function _udCreateLeadFromProperty() {
  if (!_udCache) return;
  const own = _udCache.ownership || {};
  const db = _udCache.db;
  const pid = _udCache.ids?.property_id || own.property_id;
  if (!pid) { showToast('No property id in context', 'error'); return; }

  const body = {
    domain: db,                                   // 'gov' | 'dia'
    property_id: pid,
    entity_id: own.owner_entity_id || null,       // if the view exposes it
    owner_name: own.recorded_owner_canonical || own.recorded_owner || null,
    true_owner_name: own.true_owner_canonical || own.true_owner || null,
    owner_role: own.owner_type || null,
    label: _udCache.property?.address || _udCache.fallback?.address || null,
    property_address: _udCache.property?.address || null,
    source: 'property_flow',
  };

  try {
    const resp = await _udApiPost('/api/operations?action=create_lead', body);
    if (resp && resp.ok) {
      showToast('Lead created' + (resp.bd_opportunity_id ? ' · BD opportunity opened' : ''), 'success');
      // Optional: deep-link into the Review Console lane for this lead.
      // if (resp.lead_id) navigateToReviewConsole('leads', resp.lead_id);
    } else {
      showToast('Create lead failed: ' + (resp?.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Create lead error: ' + e.message, 'error');
  }
}

async function _udAddToCadence() {
  if (!_udCache) return;
  const own = _udCache.ownership || {};
  const db = _udCache.db;
  const entityId = own.owner_entity_id || null;
  const pid = _udCache.ids?.property_id || own.property_id;

  // initiate_cadence needs an entity handle; if the view didn't expose one,
  // create_lead resolves it first. Guard with a friendly message.
  if (!entityId) {
    showToast('Resolve the owner first (Create lead) so a cadence can be attached', 'info');
    return;
  }

  const body = {
    entity_id: entityId,
    property_id: pid,
    property_address: _udCache.property?.address || null,
    domain: db,
    phase: 'onboarding',
    priority_tier: 'B',
  };

  try {
    const resp = await _udApiPost('/api/operations?action=initiate_cadence', body);
    if (resp && resp.ok) {
      showToast('Added to onboarding cadence', 'success');
    } else {
      showToast('Add to cadence failed: ' + (resp?.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Cadence error: ' + e.message, 'error');
  }
}

/* Thin POST helper mirroring how _udSaveOwnership posts today. If detail.js
 * already exposes a shared authenticated fetch (e.g. window.LCC_AUTH.apiFetch
 * or _entityApiFetch), prefer that; this is the fallback shape. */
async function _udApiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.LCC_USER?.workspace_id) headers['x-lcc-workspace'] = window.LCC_USER.workspace_id;
  const doFetch = (window.LCC_AUTH && window.LCC_AUTH.apiFetch) ? window.LCC_AUTH.apiFetch : fetch;
  const res = await doFetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok && data && data.ok === undefined) data.ok = false;
  return data;
}

// Expose for inline onclick handlers (matches the window._udSaveOwnership pattern).
window._udCreateLeadFromProperty = _udCreateLeadFromProperty;
window._udAddToCadence = _udAddToCadence;


/* ----------------------------------------------------------------------------
 * STEP 4 -- Wire it into _udTabOwnership().
 *
 *   a) Near the detail fetch (~line 223), after _setUdCache(...), kick off the
 *      best-effort enrichment (don't await in the render path):
 *
 *          _udEnrichOwnershipSignals().then(() => {
 *            // if the Ownership tab is the active one, re-render so the
 *            // confidence chip + divergence flag appear once loaded.
 *            if (activeTab === 'Ownership & CRM' && bodyEl) {
 *              bodyEl.innerHTML = _udRenderTab('Ownership & CRM');
 *            }
 *          });
 *
 *   b) Inside _udTabOwnership(), REPLACE the side-by-side owner-cards block
 *      (the section between "SIDE-BY-SIDE OWNER CARDS" and the
 *      "Additional details below cards" comment, ~lines 5799-5861) with:
 *
 *          html += _udOwnershipLadder(own, db);
 *
 *      The surrounding "Current Ownership" section header, the "Additional
 *      details" detail-grid, system links, notes, the Resolve-Ownership form,
 *      and the Ownership History timeline all stay exactly as-is.
 * -------------------------------------------------------------------------- */


/* ----------------------------------------------------------------------------
 * REVIEW NOTES
 * ----------------------------------------------------------------------------
 * 1. owner_entity_id: _udAddToCadence and create_lead's entity_id rely on the
 *    view exposing an owner entity handle. v_ownership_current (dia) has
 *    owner_entity_id in some builds; if absent, create_lead resolves/creates
 *    the entity server-side via ensureEntityLink and returns entity_id -- so
 *    the intended UX is: Create lead first (resolves entity) -> Add to cadence
 *    enabled. The guard message in _udAddToCadence reflects that.
 *
 * 2. Confidence source: owner_role_confidence lives on true_owners (both
 *    domains) and on entities/v_priority_queue (LCC). This draft reads
 *    true_owners via the domain qFn. If you'd rather not add a second round
 *    trip, the cleaner long-term fix is to add owner_role_confidence to
 *    v_ownership_current so the ladder needs no join.
 *
 * 3. Divergence (dia): there is no v_recorded_vs_assessor view on dialysis, so
 *    the dia branch derives divergence from recorded vs true on the row. That
 *    is a weaker signal than the gov assessor comparison -- label copy says
 *    "Recorded vs true differ" rather than "Assessor disagrees" so the user
 *    knows which they're looking at.
 *
 * 4. Read-only guarantee: _udOwnershipLadder performs no writes and no awaits;
 *    all network work is in _udEnrichOwnershipSignals (best-effort, cached) and
 *    the two explicit button handlers. A failed enrichment degrades to the
 *    ladder without confidence/divergence -- it never blocks the tab.
 *
 * 5. Operator-owner: this draft SHOWS the operator-flagged true owner (labeled),
 *    fixing the current behavior that hides it. If the product decision is to
 *    keep hiding it, drop the trueIsOperator branch.
 *
 * 6. Backend dependency: Create lead / Add to cadence call the create_lead /
 *    initiate_cadence sub-routes that are still a DRAFT (not yet applied to
 *    operations.js). Ship the backend draft first, or these two buttons 400.
 *    The Resolve owner / Pull recorded owner buttons use the EXISTING
 *    _udResolveGap path and work today.
 * -------------------------------------------------------------------------- */

export {
  _udEnrichOwnershipSignals,
  _udOwnershipLadder,
  _udCreateLeadFromProperty,
  _udAddToCadence,
  _udApiPost,
};
