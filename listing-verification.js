// ============================================================================
// listing-verification.js — ONE listing-verification surface for every lane
// (GOV-UX1 / SBN-23, 2026-09-22)
//
// Scott: "The verification section here does not appear in our dialysis
// section. We want this LCC app user interface to be uniform across the
// various swimlanes."
//
// Before this file the two lanes carried two copies of the card and the
// recent-verifications panel that had drifted apart:
//   · PLACEMENT — gov on Sales › Available, dia on the Overview On-Market block.
//   · HEADLINE  — dia headlined `overdue (30d+)` (DIA_OVERVIEW_TILE_AUDIT Unit 4);
//                 gov still headlined "due now" (the "9" beside "80 30d-overdue").
//   · RECENT    — dia defaulted to the Evidence filter; gov to All, so its panel
//                 opened on 50/50 cron-only `auto_scrape · inferred_active` rows
//                 — a timer advance, not a verification.
//
// Decisions (one place, both lanes):
//   · Placement: Sales › Available. That is where the listings the digest counts
//     are rows the operator can open and verify; an overview tile has nothing to
//     act on beside it.
//   · Headline: overdue (30d+). "Due now" moves into the sub-line.
//   · Recent panel: opens on Evidence; cron-only rows are labelled as timer
//     advances wherever they are shown.
//
// Classic script (shared global scope, W6.5) — loaded BEFORE gov.js and
// dialysis.js. Pure HTML builders; each lane keeps its own loaders/state.
// ============================================================================

const LV_HEADLINE_LABEL = 'overdue (30d+)';
const LV_DEFAULT_RECENT_FILTER = 'evidence';

function _lvEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _lvFmtN(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

/** A verification-history row that only advanced the cron timer. */
function lvIsCronOnly(r) {
  return !!r && r.method === 'auto_scrape' && r.check_result === 'inferred_active';
}

/** Pure model of the digest card — the single headline definition. */
function lvDigestModel(summary) {
  if (!summary) return null;
  const s = summary;
  const due       = Number(s.due_for_verification) || 0;
  const overdue30 = Number(s.overdue_30d) || 0;
  const overdue90 = Number(s.overdue_90d) || 0;
  const broken    = Number(s.broken_url_count) || 0;
  const recent    = Number(s.verifications_last_7d) || 0;
  const changes7d = Number(s.recent_status_changes_7d) || 0;
  const evidence7d = (s.evidence_verifications_7d != null) ? Number(s.evidence_verifications_7d) : null;
  const cronOnly7d = (s.cron_timer_advances_7d != null) ? Number(s.cron_timer_advances_7d) : null;
  const checks7dPart = (evidence7d != null && cronOnly7d != null)
    ? `${evidence7d} evidence/7d · ${cronOnly7d} cron-only timer advances/7d`
    : `${recent} checks/7d`;
  let color = 'blue';
  if (overdue90 > 0 || broken > 0) color = 'red';
  else if (due > 0 || overdue30 > 0) color = 'yellow';
  return {
    headlineValue: overdue30,
    headlineLabel: LV_HEADLINE_LABEL,
    sub: `${due} due now · ${overdue90} 90d-overdue · ${broken} broken-url · ${checks7dPart} · ${changes7d} status-changes/7d`,
    color,
    recent,
  };
}

/** The digest card. `lane` is 'dia' | 'gov' (a data attribute only). */
function renderListingVerificationDigest(summary, lane) {
  const m = lvDigestModel(summary);
  if (!m) {
    return `<div class="dia-info-card lv-card" data-lv-lane="${_lvEsc(lane)}" style="padding:14px 16px;color:var(--text3);font-size:11px">Loading verification digest…</div>`;
  }
  const tip = `Open an overdue listing in the sidebar and use Verify still available / Mark off market. The auto-scrape cron handles ${m.recent} checks/7d automatically.`;
  return `<div class="dia-info-card dia-info-${m.color} lv-card" data-lv-lane="${_lvEsc(lane)}" data-lv-headline="overdue_30d" onclick="showToast(${_lvEsc(JSON.stringify(tip))},'info')" style="cursor:pointer;padding:14px 16px" title="${_lvEsc(tip)}">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin-bottom:6px">Verification Status</div>
    <div class="lv-headline" style="font-size:24px;font-weight:700;color:var(--text1);margin-bottom:4px">${_lvFmtN(m.headlineValue)}</div>
    <div style="font-size:11px;color:var(--text2)">${_lvEsc(m.headlineLabel)} · ${_lvEsc(m.sub)}</div>
  </div>`;
}

function _lvTimeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/**
 * The Recent Verifications (7d) panel. `setterName` is the global the filter
 * buttons call (setDiaRecentVerificationsFilter / setGovRecentVerificationsFilter).
 */
function renderRecentVerificationsPanel(rows, filter, setterName, lane) {
  if (rows === null || rows === undefined) {
    return `<div class="dia-info-card lv-recent" data-lv-lane="${_lvEsc(lane)}" style="margin-top:14px;padding:14px 16px;color:var(--text3);font-size:11px">Loading recent verifications…</div>`;
  }
  const f = (filter === 'all' || filter === 'cron') ? filter : 'evidence';
  const all = rows;
  const evidence = all.filter(r => !lvIsCronOnly(r));
  const cron = all.filter(lvIsCronOnly);
  const shown = f === 'all' ? all : f === 'cron' ? cron : evidence;
  const btn = (key, label, n) =>
    `<button class="ops-filter ${f === key ? 'active' : ''}" data-lv-filter="${key}" onclick="${setterName}('${key}')">${label} (${n})</button>`;
  let h = `<div class="dia-info-card lv-recent" data-lv-lane="${_lvEsc(lane)}" data-lv-filter-active="${f}" style="margin-top:14px;padding:14px 16px">`;
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
  h += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3)">Recent Verifications (7d)</div>';
  h += '<div style="flex:1"></div>';
  h += btn('evidence', 'Evidence', evidence.length);
  h += btn('cron', 'Cron-only timer advances', cron.length);
  h += btn('all', 'All', all.length);
  h += '</div>';
  if (shown.length === 0) {
    h += '<div style="color:var(--text3);font-size:12px;padding:8px 0">'
      + (f === 'evidence' && cron.length
        ? `No evidence-backed verifications in 7d — ${cron.length} cron-only timer advances (not verifications).`
        : 'No rows for this filter.')
      + '</div>';
  } else {
    h += '<div style="max-height:280px;overflow-y:auto">';
    for (const r of shown.slice(0, 50)) {
      const isCron = lvIsCronOnly(r);
      const noteSnip = String(r.notes || '').substring(0, 80);
      const url = r.source_url ? `<a href="${_lvEsc(r.source_url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">↗</a>` : '';
      h += `<div class="lv-row" data-lv-kind="${isCron ? 'cron' : 'evidence'}" style="display:grid;grid-template-columns:80px 110px 130px 140px 1fr 20px;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;align-items:center">`;
      h += `<span style="color:var(--text3)">${_lvEsc(_lvTimeAgo(r.verified_at))}</span>`;
      h += `<span class="q-badge">${_lvEsc(r.method || '')}</span>`;
      h += isCron
        ? '<span class="q-badge" title="The cron advanced the verification timer; no one looked at the listing.">cron-only · timer advance</span>'
        : `<span class="q-badge">${_lvEsc(r.check_result || '')}</span>`;
      h += `<span style="font-family:monospace;color:var(--text2);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_lvEsc(r.listing_id || '')}">#${_lvEsc(r.listing_id || '')}</span>`;
      h += `<span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_lvEsc(noteSnip)}">${_lvEsc(noteSnip)}</span>`;
      h += `<span>${url}</span></div>`;
    }
    h += '</div>';
  }
  return h + '</div>';
}

if (typeof window !== 'undefined') {
  window.lvDigestModel = lvDigestModel;
  window.lvIsCronOnly = lvIsCronOnly;
  window.renderListingVerificationDigest = renderListingVerificationDigest;
  window.renderRecentVerificationsPanel = renderRecentVerificationsPanel;
}
