// ─────────────────────────────────────────────────────────────────────────────
// ops-perf-dashboard.js — W6.5 Stage 4, Unit 1 (extracted from ops.js
// 2026-08-20). Moved VERBATIM from ops.js lines 6766-7144.
//
// The manager-only operational performance view: renderPerfDashboard(container)
// and appendPerfToSyncHealth(), which grafts it onto the Sync Health page.
//
// ⚠️ STAGE 4 ADDS A HAZARD THE EARLIER STAGES DID NOT HAVE. ops.js declares ~30
// top-level `let`/`const`s in a SHARED STATE HEADER (lines 45-126) that every
// subsystem reads — unlike detail.js and app.js, which kept state local to the
// region that owned it. That state CANNOT move byte-identically with any one
// region, so it stays in ops.js and siblings only ever read it.
//
// This file therefore carries a hard rule: it must contain NO top-level
// statement that reads ops state at EVAL time. It declares functions and
// nothing else. Every read of `opsPerfLog` (ops.js:45) happens at CALL time,
// long after ops.js has evaluated, which is what makes loading this sibling
// BEFORE ops.js correct despite the dependency pointing backwards. The guard
// asserts the file declares only functions.
//
// Sole external caller: ops.js ~6481, inside the Sync Health render —
//     setTimeout(appendPerfToSyncHealth, 100);
// a direct reference evaluated inside a function body, so call-time. There is
// no window export to preserve; both are top-level function declarations and
// land on `window` automatically.
//
// ⚠️ DOC DRIFT, left as-is (not a refactor's business to fix): the banner below
// claims the view is reachable "via navTo('pagePerfDashboard')". No such route
// exists anywhere in the repo — the string appears in that comment and nowhere
// else. Sync Health is the only real entry point.
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// PERFORMANCE DASHBOARD — manager-only operational perf view
// Accessible from Sync Health page or via navTo('pagePerfDashboard')
// ============================================================================

async function renderPerfDashboard(container) {
  // Render inside sync health page as a collapsible section, or standalone
  const el = container || document.getElementById('perfDashboardContent');
  if (!el) return;
  el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  const [summaryRes, slowRes, aiRes] = await Promise.all([
    opsApi('/api/queue-v2?view=_perf&section=summary'),
    opsApi('/api/queue-v2?view=_perf&section=slow'),
    opsApi('/api/queue-v2?view=_perf&section=ai')
  ]);

  if (!summaryRes.ok) {
    el.innerHTML = `<div class="ops-empty">${esc(summaryRes.data?.error || summaryRes.error || 'Could not load performance data')}</div>`;
    return;
  }

  const data = summaryRes.data;
  const slowData = slowRes.ok ? slowRes.data : {};
  const aiData = aiRes.ok ? aiRes.data : {};
  let html = '';

  html += '<div class="ops-header"><h2>Performance Dashboard</h2></div>';

  // MV freshness check
  if (data.mv_freshness) {
    const mv = data.mv_freshness;
    const staleClass = mv.freshness_status === 'fresh' ? 'green'
      : mv.freshness_status === 'acceptable' ? ''
      : mv.freshness_status === 'stale' ? 'yellow' : 'red';
    html += `<div class="degraded-banner" style="margin-bottom:12px">
      <span class="degraded-icon">~</span>
      <div class="degraded-body">
        <div class="degraded-title">Materialized Views: <span class="${staleClass}">${mv.freshness_status}</span></div>
        <div>Last refreshed ${Math.round(mv.minutes_stale)}m ago</div>
      </div>
    </div>`;
  }

  // Target compliance grid
  if (data.compliance?.length) {
    html += '<div class="widget"><div class="widget-title">Performance Target Compliance</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Endpoint</th>'
      + '<th style="padding:6px;text-align:right">Requests</th>'
      + '<th style="padding:6px;text-align:right">p50</th>'
      + '<th style="padding:6px;text-align:right">p95</th>'
      + '<th style="padding:6px;text-align:right">Target p95</th>'
      + '<th style="padding:6px;text-align:center">Status</th>'
      + '</tr></thead><tbody>';
    data.compliance.forEach(c => {
      const statusColor = c.compliance_status === 'passing' ? 'var(--green)'
        : c.compliance_status === 'warning' ? 'var(--yellow)'
        : c.compliance_status === 'failing' ? 'var(--red)' : 'var(--text3)';
      const statusLabel = c.compliance_status === 'no_data' ? '--' : c.compliance_status;
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(c.description || '')}">${esc(c.endpoint_pattern || '')}</td>
        <td style="padding:6px;text-align:right">${c.request_count != null ? c.request_count : '--'}</td>
        <td style="padding:6px;text-align:right">${c.actual_p50_ms != null ? Math.round(c.actual_p50_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.actual_p95_ms != null ? Math.round(c.actual_p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${c.target_p95_ms != null ? c.target_p95_ms + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:center;color:${statusColor};font-weight:600">${statusLabel}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // Endpoint summary
  if (data.endpoints?.length) {
    html += '<div class="widget"><div class="widget-title">Endpoint Latency (24h)</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Endpoint</th>'
      + '<th style="padding:6px;text-align:right">Count</th>'
      + '<th style="padding:6px;text-align:right">Avg</th>'
      + '<th style="padding:6px;text-align:right">p95</th>'
      + '<th style="padding:6px;text-align:right">Max</th>'
      + '<th style="padding:6px;text-align:right">Slow%</th>'
      + '</tr></thead><tbody>';
    data.endpoints.forEach(ep => {
      const slowColor = ep.slow_pct > 10 ? 'color:var(--red)' : ep.slow_pct > 5 ? 'color:var(--yellow)' : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px;max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(ep.endpoint || '')}</td>
        <td style="padding:6px;text-align:right">${ep.request_count != null ? ep.request_count : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.avg_ms != null ? Math.round(ep.avg_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.p95_ms != null ? Math.round(ep.p95_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right">${ep.max_ms != null ? Math.round(ep.max_ms) + 'ms' : '--'}</td>
        <td style="padding:6px;text-align:right;${slowColor}">${ep.slow_pct != null ? ep.slow_pct + '%' : '--'}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  // Slow requests
  if (slowData.slow_requests?.length) {
    html += `<div class="widget" style="border-color:var(--orange)"><div class="widget-title">Slow Requests (24h) — ${slowData.slow_requests.length} found</div>`;
    slowData.slow_requests.slice(0, 20).forEach(sr => {
      html += `<div class="q-item">
        <div class="q-item-header">
          <span class="q-item-title">${esc(sr.endpoint)}</span>
          <div class="q-item-badges">
            <span class="q-badge pri-high">${sr.duration_ms != null ? sr.duration_ms : '?'}ms</span>
            <span class="q-badge type">${esc(sr.metric_type || '')}</span>
          </div>
        </div>
        <div class="q-item-meta">
          <span>Threshold: ${sr.threshold_ms != null ? sr.threshold_ms : '?'}ms</span>
          ${freshnessHTML(sr.recorded_at)}
        </div>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div class="widget"><div class="widget-title">Slow Requests (24h)</div><div class="ops-empty">No slow requests detected</div></div>';
  }

  if (aiData.summary) {
    const aiSummary = aiData.summary || {};
    const routeConfig = aiData.route_config || {};
    const rollout = aiData.rollout || {};
    const missingModel = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_model || 0));
    const missingUsage = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_usage || 0));
    const missingCache = Math.max(0, (aiSummary.total_calls || 0) - (aiSummary.calls_with_cache_data || 0));
    html += '<div class="widget"><div class="widget-title">AI Usage (Recent 200 Calls)</div>';
    const rolloutBadge = rollout.status === 'active' ? 'pri-low' : 'pri-high';
    const rolloutText = rollout.status === 'active'
      ? `Routing active · ${fmtN(rollout.override_count || 0)} override entries`
      : 'Routing still manual/default-only';
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Rollout Readiness</span>
        <div class="q-item-badges">
          <span class="q-badge ${rolloutBadge}">${esc(rolloutText)}</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>${rollout.status === 'active' ? 'Feature routing config is present and should be observable below.' : 'Set AI_CHAT_POLICY or feature overrides to start a staged routing rollout.'}</span>
      </div>
    </div>`;
    if (rollout.suggestion) {
      html += `<div class="q-item" style="margin-bottom:12px;border-color:var(--accent)">
        <div class="q-item-header">
          <span class="q-item-title">Suggested Next Step</span>
        </div>
        <div class="q-item-meta">
          <span>${esc(rollout.suggestion)}</span>
        </div>
      </div>`;
    }
    if (aiData.presets?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Preset</th>'
        + '<th style="padding:6px">Artifact</th>'
        + '<th style="padding:6px">Use Case</th>'
        + '</tr></thead><tbody>';
      aiData.presets.forEach((preset) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(preset.name || '')}</td>
          <td style="padding:6px">${esc(preset.file || '')}</td>
          <td style="padding:6px">${esc(preset.recommended_for || preset.description || '')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Routing Policy</span>
        <div class="q-item-badges">
          <span class="q-badge type">${esc(routeConfig.policy || 'manual')}</span>
          <span class="q-badge type">${esc(routeConfig.default_provider || 'edge')}</span>
          <span class="q-badge type">${esc(routeConfig.default_model || 'gpt-5-mini')}</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>Default route for features without overrides</span>
      </div>
    </div>`;
    const featureProviderEntries = Object.entries(routeConfig.feature_providers || {});
    const featureModelEntries = Object.entries(routeConfig.feature_models || {});
    if (featureProviderEntries.length || featureModelEntries.length) {
      const featureKeys = [...new Set([...featureProviderEntries.map(([key]) => key), ...featureModelEntries.map(([key]) => key)])];
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px">Provider</th>'
        + '<th style="padding:6px">Model</th>'
        + '</tr></thead><tbody>';
      featureKeys.sort().forEach((feature) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(feature)}</td>
          <td style="padding:6px">${esc(routeConfig.feature_providers?.[feature] || routeConfig.default_provider || 'edge')}</td>
          <td style="padding:6px">${esc(routeConfig.feature_models?.[feature] || routeConfig.default_model || 'gpt-5-mini')}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    if (aiData.mismatches?.length) {
      html += '<div class="q-item" style="margin-bottom:12px;border-color:var(--orange)">';
      html += '<div class="q-item-header"><span class="q-item-title">Routing Mismatches Detected</span>';
      html += `<div class="q-item-badges"><span class="q-badge pri-high">${fmtN(aiData.mismatches.length)}</span></div></div>`;
      html += '<div class="q-item-meta"><span>Configured routes differ from recent observed telemetry for these features.</span></div>';
      html += '</div>';
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px">Expected</th>'
        + '<th style="padding:6px">Observed</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '</tr></thead><tbody>';
      aiData.mismatches.forEach((row) => {
        const observed = `${(row.seen_providers || []).join(', ') || 'unknown'} / ${(row.seen_models || []).join(', ') || 'unknown'}`;
        const expected = `${row.expected_provider || 'edge'} / ${row.expected_model || 'gpt-5-mini'}`;
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.feature)}</td>
          <td style="padding:6px">${esc(expected)}</td>
          <td style="padding:6px">${esc(observed)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += `<div class="q-item" style="margin-bottom:12px">
      <div class="q-item-header">
        <span class="q-item-title">Telemetry Quality</span>
        <div class="q-item-badges">
          <span class="q-badge type">Model ${fmtN(aiSummary.model_coverage_pct || 0)}%</span>
          <span class="q-badge type">Usage ${fmtN(aiSummary.usage_coverage_pct || 0)}%</span>
          <span class="q-badge type">Cache ${fmtN(aiSummary.cache_coverage_pct || 0)}%</span>
        </div>
      </div>
      <div class="q-item-meta">
        <span>Missing model: ${fmtN(missingModel)}</span>
        <span>Missing usage: ${fmtN(missingUsage)}</span>
        <span>Missing cache data: ${fmtN(missingCache)}</span>
      </div>
    </div>`;
    html += '<div class="metrics-grid">';
    html += `<div class="metric-card"><div class="metric-label">Calls</div><div class="metric-val">${fmtN(aiSummary.total_calls || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Avg Latency</div><div class="metric-val">${fmtN(aiSummary.avg_duration_ms || 0)}ms</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Input Tokens</div><div class="metric-val">${fmtN(aiSummary.total_input_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Output Tokens</div><div class="metric-val">${fmtN(aiSummary.total_output_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Total Tokens</div><div class="metric-val">${fmtN(aiSummary.total_tokens || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Attachments</div><div class="metric-val">${fmtN(aiSummary.total_attachments || 0)}</div></div>`;
    html += `<div class="metric-card"><div class="metric-label">Cache Hits</div><div class="metric-val">${fmtN(aiSummary.cache_hits || 0)}</div></div>`;
    html += '</div>';

    if (aiData.features?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:12px">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Feature</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '<th style="padding:6px;text-align:right">Avg</th>'
        + '<th style="padding:6px;text-align:right">Tokens</th>'
        + '<th style="padding:6px;text-align:right">Attachments</th>'
        + '<th style="padding:6px;text-align:right">Cache Hits</th>'
        + '<th style="padding:6px;text-align:right">Last Call</th>'
        + '</tr></thead><tbody>';
      aiData.features.slice(0, 12).forEach((row) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.feature)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.avg_duration_ms || 0)}ms</td>
          <td style="padding:6px;text-align:right">${fmtN(row.total_tokens || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.attachments || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.cache_hits || 0)}</td>
          <td style="padding:6px;text-align:right">${row.last_called_at ? freshnessHTML(row.last_called_at) : '--'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="widget"><div class="widget-title">AI Providers And Recent Calls</div>';
    if (aiData.providers?.length) {
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
      html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
        + '<th style="padding:6px">Provider</th>'
        + '<th style="padding:6px">Model</th>'
        + '<th style="padding:6px;text-align:right">Calls</th>'
        + '<th style="padding:6px;text-align:right">Avg</th>'
        + '<th style="padding:6px;text-align:right">Tokens</th>'
        + '<th style="padding:6px;text-align:right">Cache Hits</th>'
        + '</tr></thead><tbody>';
      aiData.providers.forEach((row) => {
        html += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:6px">${esc(row.provider)}</td>
          <td style="padding:6px">${esc(row.model || 'unknown')}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.calls || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.avg_duration_ms || 0)}ms</td>
          <td style="padding:6px;text-align:right">${fmtN(row.total_tokens || 0)}</td>
          <td style="padding:6px;text-align:right">${fmtN(row.cache_hits || 0)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    } else {
      html += '<div class="ops-empty">No provider data available</div>';
    }

    if (aiData.statuses?.length) {
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">';
      aiData.statuses.forEach((row) => {
        html += `<span class="q-badge type">${esc(row.status)}: ${fmtN(row.calls || 0)}</span>`;
      });
      html += '</div>';
    }

    if (aiData.recent?.length) {
      aiData.recent.slice(0, 10).forEach((row) => {
        const usage = row.usage || {};
        const totalTokens = usage.total_tokens || ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0));
        html += `<div class="q-item">
          <div class="q-item-header">
            <span class="q-item-title">${esc(row.feature || 'unknown')}</span>
            <div class="q-item-badges">
              <span class="q-badge type">${esc(row.provider || 'unknown')}</span>
              <span class="q-badge type">${esc(row.model || 'unknown')}</span>
              <span class="q-badge">${fmtN(row.duration_ms || 0)}ms</span>
              <span class="q-badge">${fmtN(totalTokens || 0)} tok</span>
              ${row.cache_hit ? '<span class="q-badge pri-low">cache</span>' : ''}
            </div>
          </div>
          <div class="q-item-meta">
            <span>${esc(row.endpoint || 'chat')}</span>
            <span>${esc(String(row.status || 'unknown'))}</span>
            ${row.attachment_count ? `<span>${fmtN(row.attachment_count)} attachment${row.attachment_count === 1 ? '' : 's'}</span>` : ''}
            <span>${row.created_at ? freshnessHTML(row.created_at) : '--'}</span>
          </div>
        </div>`;
      });
    } else {
      html += '<div class="ops-empty">No recent AI calls found</div>';
    }
    html += '</div>';
  }

  // Client-side perf log
  if (opsPerfLog.length > 0) {
    html += '<div class="widget"><div class="widget-title">Client-Side Timing (this session)</div>';
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<thead><tr style="color:var(--text2);text-align:left;border-bottom:1px solid var(--border)">'
      + '<th style="padding:6px">Label</th>'
      + '<th style="padding:6px;text-align:right">Duration</th>'
      + '<th style="padding:6px;text-align:right">When</th>'
      + '</tr></thead><tbody>';
    [...opsPerfLog].reverse().slice(0, 30).forEach(entry => {
      const color = entry.dur > 500 ? 'color:var(--red)' : entry.dur > 200 ? 'color:var(--yellow)' : '';
      html += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px">${esc(entry.label)}</td>
        <td style="padding:6px;text-align:right;${color}">${entry.dur}ms</td>
        <td style="padding:6px;text-align:right">${freshnessHTML(new Date(entry.ts).toISOString())}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  el.innerHTML = html;
}

// Wire perf dashboard into sync health page (append as collapsible section)
function appendPerfToSyncHealth() {
  const syncEl = document.getElementById('syncHealthContent');
  if (!syncEl) return;
  // Only show for manager+ roles
  const role = LCC_USER?.role || 'viewer';
  if (!['owner', 'manager'].includes(role)) return;

  const perfSection = document.createElement('div');
  perfSection.id = 'perfDashboardContent';
  perfSection.style.marginTop = '24px';
  syncEl.appendChild(perfSection);
  renderPerfDashboard(perfSection);
}
