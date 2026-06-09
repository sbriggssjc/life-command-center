/* ============================================================================
 * DRAFT -- NOT YET APPLIED TO detail.js
 * ----------------------------------------------------------------------------
 * Phase 8 (Prospecting Convergence) front-end: replaces the single-row sticky
 * "next action" bar with a RANKED FEED of actions for the current property,
 * each ending in a concrete move (resolve / create lead / add to cadence /
 * log call). This is the destination the Phase 4 ladder hands forward to.
 *
 * Pairs with:
 *   - DRAFT_detail_ownership_ladder.js   (Phase 4 UI; reuses its action hooks)
 *   - DRAFT_operations_create_lead_initiate_cadence.js  (create_lead / initiate_cadence)
 *
 * Conventions matched against detail.js as of 2026-05-30:
 *   - _udCache.nextAction        (today: one v_next_best_action row, fetched
 *                                 at line 286 with limit:1)
 *   - #detailNextActionBar        mount element (index.html line 431)
 *   - _udRenderNextActionBar()    current single-row renderer (line 1469),
 *                                 called at line 407 after the cache loads
 *   - _udNextActionClick(gapType) existing dispatch (line 1777)
 *   - _udFormatNabValue(n)        $ value formatter (line 1459)
 *   - esc(), showToast(), _udBtnGuard()
 *   - qFn = (db === 'gov' ? govQuery : diaQuery)
 *   - _udCreateLeadFromProperty / _udAddToCadence  (from the ladder draft)
 *
 * KEY DATA NOTE (from the live sweep):
 *   - v_next_best_research lives on the DOMAIN DBs (gov + dia), identical
 *     schema on both -> readable today via qFn. Columns:
 *       research_type, entity_kind, entity_id, label, priority, instructions, domain
 *   - v_priority_queue_enriched lives on LCC OPPS, which the detail front-end
 *     has NO direct read path to. The band/cross-vertical context is therefore
 *     behind a small TO-BUILD endpoint (see _udFetchPriorityBand + review note 2).
 *     The feed renders fully WITHOUT the band; the band is an enhancement.
 * ========================================================================== */


/* ----------------------------------------------------------------------------
 * STEP 1 -- Fetch the ranked research rows for THIS property.
 *
 * Mirrors the existing v_next_best_action fetch (line 286) but on
 * v_next_best_research with limit:N, ordered by priority desc. Stored on
 * _udCache.researchFeed. Best-effort; failure leaves it [] and the feed falls
 * back to the single-row bar behavior.
 *
 * v_next_best_research keys rows by entity_id (text) + entity_kind. For a
 * property we filter entity_kind='property' AND entity_id=<property_id text>.
 * -------------------------------------------------------------------------- */

async function _udFetchProspectingFeed(limit = 6) {
  if (!_udCache) return [];
  const db = _udCache.db;
  const qFn = db === 'gov' ? govQuery : diaQuery;
  const pid = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (pid == null) { _udCache.researchFeed = []; return []; }

  try {
    const res = await qFn('v_next_best_research', 'research_type,entity_kind,entity_id,label,priority,instructions,domain', {
      filter: `entity_kind=eq.property&entity_id=eq.${encodeURIComponent(String(pid))}`,
      order: 'priority.desc.nullslast',
      limit,
    });
    const rows = Array.isArray(res) ? res : (res && res.data ? res.data : []);
    _udCache.researchFeed = rows || [];
  } catch (_e) {
    _udCache.researchFeed = [];
  }
  if (typeof _setUdCache === 'function') _setUdCache(_udCache);
  return _udCache.researchFeed;
}


/* ----------------------------------------------------------------------------
 * STEP 2 -- (Optional enhancement) Fetch the owner's BD priority band.
 *
 * v_priority_queue_enriched is on LCC Opps. The detail front-end can't read it
 * directly, so this goes through a small NEW endpoint that returns the band +
 * cross-vertical context for a (source_domain, source_property_id) or entity_id.
 * Until that endpoint exists, this resolves to null and the feed simply omits
 * the band token -- no error, no empty rows.
 *
 * Proposed endpoint (TO BUILD, one sub-route on entity-hub.js or admin.js):
 *   GET /api/priority-band?domain=gov&property_id=16404
 *     -> { priority_band, reason, owner_role_confidence, is_cross_vertical,
 *          total_property_count, source_property_address }  | null
 * -------------------------------------------------------------------------- */

async function _udFetchPriorityBand() {
  if (!_udCache) return null;
  if (_udCache.priorityBand !== undefined) return _udCache.priorityBand;
  const db = _udCache.db;
  const pid = _udCache.ids?.property_id || _udCache.property?.property_id;
  if (pid == null) { _udCache.priorityBand = null; return null; }

  try {
    const doFetch = (window.LCC_AUTH && window.LCC_AUTH.apiFetch) ? window.LCC_AUTH.apiFetch : fetch;
    const res = await doFetch('/api/priority-band?domain=' + encodeURIComponent(db) + '&property_id=' + encodeURIComponent(pid));
    if (res && res.ok) {
      const data = await res.json();
      _udCache.priorityBand = data && data.priority_band ? data : null;
    } else {
      _udCache.priorityBand = null;   // endpoint not built yet -> graceful null
    }
  } catch (_e) {
    _udCache.priorityBand = null;
  }
  if (typeof _setUdCache === 'function') _setUdCache(_udCache);
  return _udCache.priorityBand;
}


/* ----------------------------------------------------------------------------
 * STEP 3 -- Render the ranked feed into #detailNextActionBar.
 *
 * Drop-in replacement for _udRenderNextActionBar(). Behavior:
 *   - If a priority band exists, render it as the top "owner-level" row with
 *     prospecting actions (Create lead / Add to cadence).
 *   - Then render each v_next_best_research row as a property-level action with
 *     a rank token (priority score) and a context-aware CTA.
 *   - If neither exists, fall back to the legacy single nextAction row (so this
 *     is safe to ship before the research fetch is wired everywhere).
 *   - If truly nothing, hide the bar (the completeness rail covers "all clear").
 * -------------------------------------------------------------------------- */

function _udBandClass(band) {
  const b = String(band || '').toUpperCase();
  if (b === 'P0') return { bg: '#7A1020', label: 'P0' };
  if (b === 'P0.5') return { bg: 'var(--red)', label: 'P0.5' };
  if (b === 'P1') return { bg: 'var(--yellow)', label: 'P1' };
  if (b === 'P2' || b === 'P3') return { bg: 'var(--purple)', label: b };
  return { bg: 'var(--text3)', label: b || '—' };
}

// Map a research_type to the tab + a short CTA. Reuses the existing
// _udNextActionTabForGap mapping where the types overlap.
function _udResearchCta(researchType) {
  const t = String(researchType || '');
  if (t.indexOf('missing_recorded_owner') !== -1) return { label: 'Pull recorded owner →', tab: 'Ownership & CRM' };
  if (t.indexOf('llc') !== -1 || t.indexOf('true_owner') !== -1) return { label: 'Resolve true owner →', tab: 'Ownership & CRM' };
  if (t.indexOf('lease') !== -1) return { label: 'Confirm lease →', tab: 'Rent Roll' };
  if (t.indexOf('sale') !== -1) return { label: 'Review sale →', tab: 'Deal History' };
  return { label: 'Take action →', tab: 'Ownership & CRM' };
}

function _udRenderProspectingFeed() {
  const bar = document.getElementById('detailNextActionBar');
  if (!bar) return;

  const band = _udCache && _udCache.priorityBand;          // may be null
  const feed = (_udCache && _udCache.researchFeed) || [];
  const legacy = _udCache && _udCache.nextAction;

  // Nothing to show at all -> hide (completeness rail handles "all clear").
  if (!band && feed.length === 0 && (!legacy || !legacy.gap_type)) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  const rows = [];
  rows.push('<div class="prospect-feed-header"><span class="nab-label">What to do about this property</span>'
          + (band && band.is_cross_vertical ? '<span class="nab-xv-chip" title="Owner holds assets in both verticals">cross-vertical</span>' : '')
          + '</div>');

  // ── Owner-level band row (if available) ────────────────────────────────
  if (band && band.priority_band) {
    const bc = _udBandClass(band.priority_band);
    const conf = band.owner_role_confidence != null ? Number(band.owner_role_confidence) : null;
    const why = esc(band.reason || 'BD priority')
              + (band.total_property_count ? ' · ' + esc(String(band.total_property_count)) + ' properties' : '');
    rows.push('<div class="prospect-row">');
    rows.push(  '<span class="prospect-band" style="background:' + bc.bg + '">' + esc(bc.label) + '</span>');
    rows.push(  '<div class="prospect-why"><b>Owner: ' + esc(band.owner_name || _udCache.ownership?.true_owner || _udCache.ownership?.recorded_owner || '—') + '</b>'
            + '<div class="prospect-sub">' + why + (conf != null && !isNaN(conf) ? ' · role conf ' + Math.round(conf * 100) + '%' : '') + '</div></div>');
    rows.push(  '<div class="prospect-actions">'
            + '<button type="button" class="prospect-cta-primary" onclick="event.stopPropagation();_udBtnGuard(this,_udCreateLeadFromProperty)">Create lead</button>'
            + '<button type="button" class="prospect-cta" onclick="event.stopPropagation();_udBtnGuard(this,_udAddToCadence)">Add to cadence</button>'
            + '</div>');
    rows.push('</div>');
  }

  // ── Property-level research rows ───────────────────────────────────────
  feed.forEach((r) => {
    const cta = _udResearchCta(r.research_type);
    const tabAttr = esc(cta.tab);
    rows.push('<div class="prospect-row">');
    rows.push(  '<span class="prospect-rank" title="priority score">' + esc(String(r.priority != null ? r.priority : '—')) + '</span>');
    rows.push(  '<div class="prospect-why"><b>' + esc(_udResearchTitle(r)) + '</b>'
            + '<div class="prospect-sub">' + esc(r.instructions || r.label || '') + '</div></div>');
    rows.push(  '<div class="prospect-actions">'
            + '<button type="button" class="prospect-cta" onclick="event.stopPropagation();switchUnifiedTab(&quot;' + tabAttr + '&quot;)">' + esc(cta.label) + '</button>'
            + '</div>');
    rows.push('</div>');
  });

  // ── Legacy single-row fallback (only when no research rows loaded) ──────
  if (feed.length === 0 && legacy && legacy.gap_type) {
    const dispatch = (typeof _udNextActionDispatchFor === 'function') ? _udNextActionDispatchFor(legacy.gap_type) : { label: 'Take action →' };
    const valStr = _udFormatNabValue(legacy.gap_value);
    rows.push('<div class="prospect-row">');
    rows.push(  '<span class="prospect-rank">' + esc(String(legacy.gap_severity || '').toUpperCase()) + '</span>');
    rows.push(  '<div class="prospect-why"><b>' + esc(legacy.suggested_action || legacy.gap_label || 'Next action') + '</b>'
            + (valStr ? '<div class="prospect-sub">' + esc(valStr) + ' value</div>' : '') + '</div>');
    rows.push(  '<div class="prospect-actions"><button type="button" class="prospect-cta" onclick="event.stopPropagation();_udNextActionClick(&quot;' + esc(legacy.gap_type) + '&quot;)">' + esc(dispatch.label) + '</button></div>');
    rows.push('</div>');
  }

  bar.className = 'prospect-feed';
  bar.onclick = null;                      // feed rows own their own clicks now
  bar.innerHTML = rows.join('');
  bar.style.display = '';
}

// Short title from a research row. v_next_best_research has no title column,
// so derive a human label from research_type, with instructions as the sub.
function _udResearchTitle(r) {
  const t = String(r.research_type || '');
  if (t.indexOf('missing_recorded_owner') !== -1) return 'Pull recorded owner';
  if (t.indexOf('llc') !== -1) return 'Resolve LLC / true owner';
  if (t.indexOf('true_owner') !== -1) return 'Resolve true owner';
  if (t.indexOf('lease') !== -1) return 'Confirm lease / expiration';
  if (t.indexOf('sale') !== -1) return 'Review sale record';
  // Fall back to a cleaned research_type.
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Research action';
}

window._udFetchProspectingFeed = _udFetchProspectingFeed;
window._udFetchPriorityBand = _udFetchPriorityBand;
window._udRenderProspectingFeed = _udRenderProspectingFeed;


/* ----------------------------------------------------------------------------
 * STEP 4 -- Wire into the detail load.
 *
 *   a) In the main fetch block (~line 295-407), after _setUdCache(...) and the
 *      existing `_udRenderNextActionBar()` call (line 407), REPLACE that call
 *      with the feed path (which still renders the legacy row as a fallback):
 *
 *          // Phase 8: ranked prospecting feed (replaces single-row bar).
 *          Promise.allSettled([
 *            _udFetchProspectingFeed(6),
 *            _udFetchPriorityBand(),
 *          ]).then(() => {
 *            try { _udRenderProspectingFeed(); }
 *            catch (e) { console.warn('prospecting feed render failed', e); _udRenderNextActionBar(); }
 *          });
 *
 *      Keeping _udRenderNextActionBar as the catch-fallback means a feed bug
 *      degrades to today's behavior rather than an empty bar.
 *
 *   b) CSS -- add to styles.css (mirrors the existing .next-action-bar tokens,
 *      Northmarq palette via the --nm/--accent vars already in the sheet):
 *
 *        .prospect-feed{display:flex;flex-direction:column;gap:8px;padding:10px 14px;
 *          background:var(--s1);border-top:1px solid var(--border)}
 *        .prospect-feed-header{display:flex;align-items:center;gap:8px;font-size:11px;
 *          text-transform:uppercase;letter-spacing:.5px;color:var(--text3)}
 *        .nab-xv-chip{background:var(--purple);color:#fff;border-radius:10px;
 *          padding:1px 7px;font-size:10px;font-weight:700;text-transform:none}
 *        .prospect-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;
 *          align-items:center;background:var(--s2);border:1px solid var(--border);
 *          border-radius:9px;padding:9px 12px}
 *        .prospect-band{font-size:11px;font-weight:800;color:#fff;border-radius:6px;
 *          padding:2px 8px;min-width:34px;text-align:center}
 *        .prospect-rank{font-size:12px;font-weight:700;color:var(--text2);
 *          background:var(--s3);border-radius:6px;padding:2px 8px;min-width:30px;text-align:center}
 *        .prospect-why b{font-size:13px;color:var(--text)}
 *        .prospect-sub{font-size:11.5px;color:var(--text3);margin-top:2px}
 *        .prospect-actions{display:flex;gap:6px}
 *        .prospect-cta,.prospect-cta-primary{border:none;border-radius:7px;
 *          padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer}
 *        .prospect-cta{background:var(--s3);color:var(--text);border:1px solid var(--border)}
 *        .prospect-cta-primary{background:var(--accent);color:#fff}
 * -------------------------------------------------------------------------- */


/* ----------------------------------------------------------------------------
 * REVIEW NOTES
 * ----------------------------------------------------------------------------
 * 1. SAFE-TO-SHIP ORDER: this renderer falls back to the legacy single-row bar
 *    whenever the research feed is empty AND on any render error, so it can ship
 *    BEFORE the priority-band endpoint exists. Step 1 (research feed) works
 *    today against the existing v_next_best_research + qFn path.
 *
 * 2. PRIORITY-BAND ENDPOINT (to build): v_priority_queue_enriched is on LCC
 *    Opps; the detail front-end has no LCC read path. Add a tiny GET sub-route
 *    (entity-hub.js ?_domain=priority-band, or admin.js ?_route=priority-band)
 *    that runs ONE opsQuery against v_priority_queue_enriched filtered by
 *    source_domain + source_property_id (or entity_id) and returns the band
 *    row. _udFetchPriorityBand already calls /api/priority-band and degrades to
 *    null until it exists. Note: source_domain/source_property_id are NULL on
 *    entity-level bands (P0.5) -- when filtering by property you'll match the
 *    property-anchored bands; for entity-level, resolve via the owner entity_id
 *    once create_lead has linked one.
 *
 * 3. DEDUPE vs the ladder: the Phase 4 ladder also surfaces "Resolve owner" /
 *    "Create lead". That's intentional -- the ladder is the owner-resolution
 *    surface, the feed is the cross-cutting action queue -- but if both are
 *    on-screen, consider suppressing the feed's owner-missing research row when
 *    the ladder already shows the same unresolved-owner CTA, to avoid a double
 *    ask. Cheap filter: skip feed rows whose research_type starts with
 *    'property_missing_recorded_owner' when _udCache.ownership?.recorded_owner
 *    is null AND the ladder is rendered.
 *
 * 4. switchUnifiedTab: the property-level rows call switchUnifiedTab(tab) (the
 *    same fn the completeness chips use, line 1380). Confirm it's in scope where
 *    detail.js inlines onclick; if not, route through a window._udGoTab shim.
 *
 * 5. BACKEND DEPENDENCY: Create lead / Add to cadence buttons reuse the ladder's
 *    _udCreateLeadFromProperty / _udAddToCadence, which call the create_lead /
 *    initiate_cadence sub-routes (still a DRAFT). Property-level research CTAs
 *    and the legacy fallback work today.
 *
 * 6. PERF: one extra domain query (v_next_best_research, limit 6) + one LCC
 *    fetch (band) per detail open, both best-effort and parallel with nothing
 *    blocking on them. The legacy v_next_best_action fetch (line 286) can be
 *    dropped once the feed is the default, saving a query.
 * -------------------------------------------------------------------------- */

export {
  _udFetchProspectingFeed,
  _udFetchPriorityBand,
  _udRenderProspectingFeed,
  _udResearchTitle,
  _udResearchCta,
  _udBandClass,
};
