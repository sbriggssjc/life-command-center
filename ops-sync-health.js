// ─────────────────────────────────────────────────────────────────────────────
// ops-sync-health.js — W6.5 Stage 4, Unit 2 (extracted from ops.js 2026-08-20).
// Moved VERBATIM from ops.js lines 6346-6538.
//
// Connector status + sync-job monitoring: renderSyncHealthPage and the four
// actions triggerSync / retrySync / reconnectConnector / removeConnector.
//
// ⚠️ TWO DIFFERENT window-BINDING MECHANISMS ARE IN USE HERE, BOTH LOAD-BEARING.
// Do not "tidy" either into the other:
//   • reconnectConnector / removeConnector carry EXPLICIT `window.x = x` lines
//     (ops.js 6520 / 6538) and are reached by onclick="reconnectConnector(…)"
//     at 6398/6399.
//   • triggerSync / retrySync have NO explicit export. They are passed as bare
//     identifiers INSIDE an onclick string —
//         onclick="_opsBtnGuard(this, triggerSync, decodeURIComponent('…'))"
//     — which resolves off `window` at CLICK time via the inline-handler scope
//     chain. That works only because a top-level `function` declaration in a
//     CLASSIC script becomes a window property automatically. Convert this file
//     to a module, or wrap these in an IIFE, and both buttons die silently.
//
// Cross-sibling seam: renderSyncHealthPage does
//     setTimeout(appendPerfToSyncHealth, 100);
// which now lives in ops-perf-dashboard.js. Both are siblings loaded before
// ops.js; their relative order does not matter because the reference is
// evaluated inside a function body at call time.
//
// External caller: app.js:1135, the nav dispatcher —
//     case 'pageSyncHealth': if (typeof renderSyncHealthPage === 'function') …
//
// STAGE-4 RULE: declares only functions and the two window exports; no
// top-level statement reads ops.js's shared state header (45-126) at eval time.
// This region in fact reads NONE of that state at all (see the dead-state note
// in the decomposition map re: opsSyncData).
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// SYNC HEALTH — connector status and sync job monitoring
// ============================================================================
async function renderSyncHealthPage() {
  const el = document.getElementById('syncHealthContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  const perf = opsPerf('render:sync_health');

  const [connRes, healthRes] = await Promise.all([
    opsApi('/api/connectors?action=list'),
    opsApi('/api/sync?action=health')
  ]);

  let html = '<div class="ops-header"><h2>Sync Health</h2></div>';

  // Connector status cards
  const connectors = connRes.ok ? (connRes.data?.connectors || connRes.data || []) : [];

  if (connectors.length === 0) {
    html += emptyStateHTML(
      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
      'No connectors configured',
      'Connect Outlook, Salesforce, or calendar to start syncing data into your workspace.',
      null, null
    );
  } else {
    // A5 (2026-06-06): a disconnected/errored connector can't be fixed by
    // "Sync Now" (it'll just fail). Give it the real next action \u2014 Reconnect
    // (honest guidance, since auth is provisioned outside the app) \u2014 and let a
    // stale duplicate be removed. Field names match the connector_accounts list
    // payload (display_name / last_sync_at / last_error).
    const _healthyStatuses = ['active', 'healthy', 'degraded'];
    connectors.forEach(conn => {
      const status = conn.status || 'unknown';
      const isUsable = _healthyStatuses.indexOf(status) !== -1;
      const statusCls = (status === 'active' || status === 'healthy') ? 'healthy'
        : status === 'degraded' ? 'degraded'
        : 'error';
      const icon = conn.connector_type === 'email' ? 'E'
        : conn.connector_type === 'calendar' ? 'C'
        : conn.connector_type === 'salesforce' ? 'SF'
        : conn.connector_type?.substring(0, 2).toUpperCase() || '?';
      const label = conn.display_name || conn.label || '';
      const lastSync = conn.last_sync_at || conn.last_synced_at || null;
      const errMsg = conn.last_error || conn.error_message || '';
      const cidEnc = encodeURIComponent(conn.id || '');
      const typeEnc = encodeURIComponent(conn.connector_type || '');
      const nameEnc = encodeURIComponent((conn.connector_type || 'connector') + (label ? ' (' + label + ')' : ''));

      const actions = isUsable
        ? `<button class="q-action" onclick="_opsBtnGuard(this, triggerSync, decodeURIComponent('${typeEnc}'))">Sync Now</button>`
        : `<button class="q-action primary" onclick="reconnectConnector(decodeURIComponent('${typeEnc}'))">Reconnect \u2192</button>`
          + (conn.id ? `<button class="q-action" onclick="removeConnector(decodeURIComponent('${cidEnc}'),decodeURIComponent('${nameEnc}'))">Remove</button>` : '');

      html += `<div class="sync-card ${statusCls}">
        <div class="sync-card-icon">${icon}</div>
        <div class="sync-card-info">
          <div class="sync-card-name">${esc(conn.connector_type || 'Unknown')} ${label ? '(' + esc(label) + ')' : ''}</div>
          <div class="sync-card-status">
            Status: ${esc(status)}
            ${lastSync ? ' \u00b7 Last sync: ' + freshnessHTML(lastSync) : ''}
            ${errMsg ? ' \u00b7 <span style="color:var(--red)">' + esc(errMsg) + '</span>' : ''}
            ${!isUsable ? ' \u00b7 <span style="color:var(--red)">needs reconnect</span>' : ''}
          </div>
        </div>
        <div class="sync-card-actions">${actions}</div>
      </div>`;
    });
  }

  const health = healthRes.ok ? (healthRes.data || {}) : {};
  const summary = health.summary || {};
  const unresolvedErrors = health.unresolved_errors || [];
  const queueDrift = health.queue_drift || null;

  // Sync health summary
  if (healthRes.ok && healthRes.data) {
    html += '<div class="widget" style="margin-top:16px"><div class="widget-title">Sync Summary</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML('Healthy', summary.healthy || 0, 'connectors');
    html += metricCardHTML('Degraded', summary.degraded || 0, 'connectors', (summary.degraded || 0) > 0 ? 'yellow' : 'green');
    // QA-10 (2026-05-18): show connector-status errors here (matches Pipeline
    // banner). Sync-log row count (unresolvedErrors.length) lives in the
    // "Recent Errors" widget below — keeping both as a single tile conflated
    // two different concepts and made every surface disagree with itself.
    html += metricCardHTML('Errors', summary.error || 0, 'connectors in error state', (summary.error || 0) > 0 ? 'red' : 'green');
    html += metricCardHTML(
      'Outbound Success',
      summary.outbound_success_rate_24h != null ? Math.round(summary.outbound_success_rate_24h * 100) + '%' : '--',
      'completed outbound jobs, 24h',
      summary.outbound_success_rate_24h != null && summary.outbound_success_rate_24h < 0.9 ? 'red' : 'green'
    );
    html += '</div></div>';
  }

  if (queueDrift) {
    html += '<div class="widget" style="margin-top:16px"><div class="widget-title">Queue Drift</div>';
    html += '<div class="metrics-grid">';
    html += metricCardHTML('Open SF Tasks', queueDrift.salesforce_open_task_count || 0, 'inbox items');
    html += metricCardHTML('Last SF Pull', queueDrift.last_sf_records_processed || 0, 'records processed');
    html += metricCardHTML('Estimated Gap', queueDrift.estimated_gap || 0, 'open tasks vs last pull', queueDrift.drift_flag ? 'red' : 'green');
    html += metricCardHTML('Drift Flag', queueDrift.drift_flag ? 'Review' : 'Stable', queueDrift.last_inbound_completed_at ? `last inbound ${freshnessHTML(queueDrift.last_inbound_completed_at)}` : 'no inbound timestamp', queueDrift.drift_flag ? 'red' : 'green');
    html += '</div>';
    html += `<div class="q-item" style="margin-top:12px">
      <div class="q-item-meta">
        <span>Source: ${esc(queueDrift.source || 'unknown')}</span>
        ${queueDrift.last_inbound_job_id ? `<span>Job: ${esc(queueDrift.last_inbound_job_id)}</span>` : ''}
      </div>
    </div>`;
    html += '</div>';
  }

  // Unresolved sync errors
  if (unresolvedErrors.length) {
    html += '<div class="widget" style="border-color:var(--red)"><div class="widget-title">Recent Errors</div>';
    unresolvedErrors.forEach(err => {
      html += `<div class="q-item overdue">
        <div class="q-item-header">
          <span class="q-item-title">${esc(err.error_code || 'Sync Error')}</span>
          ${freshnessHTML(err.created_at)}
        </div>
        <div class="q-item-meta"><span style="color:var(--red)">${esc(err.error_message || '')}</span></div>
        <div class="q-actions">
          <button class="q-action" onclick="_opsBtnGuard(this, retrySync, decodeURIComponent('${encodeURIComponent(err.id)}'))">Retry</button>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;
  perf.end();

  // Append perf dashboard for managers
  setTimeout(appendPerfToSyncHealth, 100);

  // Phase C (2026-05-18): mount the silent-write-failures widget at the
  // bottom of the Sync Health page. Surfaces ingest_write_failures
  // rollup so silent failures are visible in-app instead of only in Studio.
  try {
    if (typeof renderWriteFailuresWidget === 'function') {
      await renderWriteFailuresWidget(el);
    }
  } catch (e) { console.warn('[SyncHealth] write-failures widget render failed:', e?.message); }
}

async function triggerSync(connectorType) {
  const actionMap = { email: 'ingest_emails', outlook: 'ingest_emails', calendar: 'ingest_calendar', salesforce: 'ingest_sf_activities' };
  const action = actionMap[connectorType] || 'ingest_' + connectorType;
  const res = await opsPost(`/api/sync?action=${action}`, {});
  if (res.ok) showToast(`Sync triggered for ${connectorType}`, 'success');
  else showToast(res.error || 'Sync trigger failed', 'error');
}

async function retrySync(errorId) {
  const res = await opsPost(`/api/sync?action=retry&error_id=${errorId}`, {});
  if (res.ok) showToast('Retry triggered', 'success');
  else showToast(res.error || 'Retry failed', 'error');
}

// A5 (2026-06-06): reconnect path for a disconnected/errored connector. Auth is
// provisioned outside the app (Outlook/SF via Power Automate + admin setup),
// so there is no in-app OAuth handshake to launch — give the user honest,
// specific guidance instead of a button that silently does nothing.
function reconnectConnector(connectorType) {
  const t = (connectorType || 'this connector');
  const how = t === 'salesforce'
    ? 'Salesforce reconnects through the Power Automate flow + the SF connected app — re-authorize there, then the next sync will turn this green.'
    : (t === 'email' || t === 'outlook')
      ? 'Outlook reconnects through the Power Automate flow that owns the mailbox connection — re-authorize the flow, then run Sync Now.'
      : 'Re-authorize this connector at its source (the Power Automate flow / admin setup that provisioned it), then run Sync Now.';
  if (typeof showToast === 'function') showToast('Reconnect ' + t + ': ' + how, 'warn');
}
window.reconnectConnector = reconnectConnector;

// Remove a connector account (used for stale/duplicate disconnected rows). The
// API DELETE is owner-gated server-side; confirm first since it drops the row.
async function removeConnector(connectorId, displayName) {
  if (!connectorId) return;
  const ok = typeof lccConfirm === 'function'
    ? await lccConfirm('Remove the connector "' + (displayName || connectorId) + '"?\n\nThis deletes the connector account row. Use this for a stale duplicate — an active connector should be reconnected, not removed.', 'Remove')
    : (typeof confirm === 'function' ? confirm('Remove connector "' + (displayName || connectorId) + '"?') : false);
  if (!ok) return;
  const res = await opsApi('/api/connectors?id=' + encodeURIComponent(connectorId), { method: 'DELETE' });
  if (res.ok) {
    if (typeof showToast === 'function') showToast('Connector removed.', 'success');
    if (typeof renderSyncHealthPage === 'function') renderSyncHealthPage();
  } else {
    if (typeof showToast === 'function') showToast('Could not remove connector: ' + (res.error || 'unknown'), 'error');
  }
}
window.removeConnector = removeConnector;
