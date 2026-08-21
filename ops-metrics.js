// ─────────────────────────────────────────────────────────────────────────────
// ops-metrics.js — W6.5 Stage 4, Unit 4 (extracted from ops.js 2026-08-20).
// Moved VERBATIM from ops.js lines 6025-6135.
//
// The Metrics page — work counts and team performance. Entry point:
// app.js:1133, `case 'pageMetrics'`.
//
// ⚠️ metricCardHTML DID NOT COME ALONG, though the map's range included it and
// this page is its single heaviest consumer. Measured: 12 calls inside this
// region, 16 calls elsewhere in ops.js (from line 1724 onward). A helper whose
// majority of callers live outside the region is shared infrastructure, not
// part of the feature — moving it would leave 16 call sites depending on a file
// named "metrics". Same call this unit's predecessor made for _opsSparkline.
//
// STAGE-4 RULE: declares only functions; no top-level statement reads ops.js's
// shared state header (45-126) at eval time.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// METRICS — work counts, team performance
// ============================================================================
async function renderMetricsPage() {
  const el = document.getElementById('metricsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:metrics');

  const [countsRes, oversightRes, syncHealthRes] = await Promise.all([
    opsApi('/api/queue?view=work_counts'),
    opsApi('/api/workflows?action=oversight'),
    opsApi('/api/sync?action=health')
  ]);

  let html = '';
  html += workspaceContextHTML();
  html += '<div class="ops-header"><h2>Metrics</h2></div>';

  // Work counts - SYNC FIX: Use canonicalCounts as fallback when available
  // This ensures consistency between Dashboard stats and Metrics page
  let countsData = countsRes.ok ? (countsRes.data || {}) : {};
  if (!countsRes.ok && typeof canonicalCounts !== 'undefined' && canonicalCounts) {
    countsData = canonicalCounts;
  }

  if (countsRes.ok || (typeof canonicalCounts !== 'undefined' && canonicalCounts)) {
    const c = countsData;
    html += '<div class="metrics-grid">';
    html += metricCardHTML('My Actions', c.my_actions || c.my_open || 0, 'assigned to me');
    html += metricCardHTML('Team Actions', c.team_actions || c.team_open || 0, 'shared queue');
    html += metricCardHTML('Inbox', c.inbox_new || 0, 'needs triage', c.inbox_new > 10 ? 'yellow' : '');
    html += metricCardHTML('Overdue', c.overdue || 0, 'past due date', c.overdue > 0 ? 'red' : 'green');
    html += metricCardHTML('In Progress', c.in_progress || 0, 'active work');
    html += metricCardHTML('Completed (7d)', c.completed_week || 0, 'this week', 'green');
    html += metricCardHTML('Research', c.research_active || 0, 'active tasks');
    // QA-10 (2026-05-18): prefer the live connector-status error count
    // (summary.error from /api/sync?action=health) over the stale-prone
    // work_counts.sync_errors row count. Reason: a connector can be in
    // status='error' (failing right now) without any rows in the
    // sync_errors log table, and vice-versa. The connector-status count
    // is what the Pipeline banner uses, so this makes Metrics agree with
    // it. Falls back to c.sync_errors if sync-health endpoint failed.
    const liveSyncErrors = (syncHealthRes.ok && syncHealthRes.data?.summary)
      ? (syncHealthRes.data.summary.error || 0)
      : (c.sync_errors || 0);
    html += metricCardHTML('Sync Errors', liveSyncErrors, 'connectors in error state', liveSyncErrors > 0 ? 'red' : 'green');
    html += '</div>';
    if (c.refreshed_at) {
      html += `<div class="widget" style="margin-top:12px"><div class="q-item-meta">Counts refreshed ${freshnessHTML(c.refreshed_at)}</div></div>`;
    }
  }

  if (syncHealthRes.ok && syncHealthRes.data) {
    const summary = syncHealthRes.data.summary || {};
    const drift = syncHealthRes.data.queue_drift || {};
    html += '<div class="widget"><div class="widget-title">Operational Signals</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML(
      'Outbound Success',
      summary.outbound_success_rate_24h != null ? Math.round(summary.outbound_success_rate_24h * 100) + '%' : '--',
      'last 24h',
      summary.outbound_success_rate_24h != null && summary.outbound_success_rate_24h < 0.9 ? 'red' : 'green'
    );
    html += metricCardHTML('Degraded Connectors', summary.degraded || 0, 'need attention', (summary.degraded || 0) > 0 ? 'yellow' : 'green');
    html += metricCardHTML('Queue Drift Gap', drift.estimated_gap || 0, 'Salesforce open-task delta', drift.drift_flag ? 'red' : 'green');
    html += metricCardHTML('Drift Status', drift.drift_flag ? 'Review' : 'Stable', drift.source || 'sync health', drift.drift_flag ? 'red' : 'green');
    html += '</div></div>';
  }

  // Team overview (manager only)
  if (oversightRes.ok && oversightRes.data?.team?.length) {
    html += '<div class="widget"><div class="widget-title">Team Overview</div>';
    oversightRes.data.team.forEach(member => {
      const initials = (member.display_name || '??').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      html += `<div class="team-row">
        <div class="team-avatar">${esc(initials)}</div>
        <div class="team-info">
          <div class="team-name">${esc(member.display_name)}</div>
          <div class="team-role">${esc(member.role || 'viewer')}</div>
        </div>
        <div class="team-stats">
          <div class="stat"><span class="stat-n">${member.active_actions || 0}</span>Active</div>
          <div class="stat"><span class="stat-n" style="${member.overdue_actions > 0 ? 'color:var(--red)' : ''}">${member.overdue_actions || 0}</span>Overdue</div>
          <div class="stat"><span class="stat-n" style="color:var(--green)">${member.completed_this_week || 0}</span>Done/wk</div>
          <div class="stat"><span class="stat-n">${member.untriaged_inbox || 0}</span>Inbox</div>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  // Open escalations
  if (oversightRes.ok && oversightRes.data?.open_escalations?.length) {
    html += '<div class="widget" style="border-color:var(--orange)"><div class="widget-title">Open Escalations</div>';
    oversightRes.data.open_escalations.forEach(escalation => {
      html += `<div class="q-item high-pri">
        <div class="q-item-title">${esc(escalation.action_items?.title || 'Unknown action')}</div>
        <div class="q-item-meta">
          <span>From: ${esc(escalation.users?.display_name || 'unknown')}</span>
          <span>Reason: ${esc(escalation.reason || '')}</span>
          ${freshnessHTML(escalation.created_at)}
        </div>
      </div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  perf.end();
}
