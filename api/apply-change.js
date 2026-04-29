// ============================================================================
// Apply Change API — Closed-loop mutation service for business table writes
// Life Command Center
//
// POST /api/apply-change
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, isOpsConfigured, logPerfMetric, withErrorHandler } from './_shared/ops-db.js';
import {
  GOV_WRITE_TABLES, DIA_WRITE_TABLES, isAllowedTable, safeColumn
} from './_shared/allowlist.js';
import { domainQuery } from './_shared/domain-db.js';
import { recalculateSaleCapRates } from './_shared/rent-projection.js';

// Fields on the dialysis `properties` table whose write implies every
// historical sale on that property must have its calculated_cap_rate
// recomputed against the projected rent at the sale date.
const CAP_RATE_ANCHOR_FIELDS = new Set([
  'anchor_rent',
  'anchor_rent_date',
  'lease_commencement',
  'lease_bump_pct',
  'lease_bump_interval_mo',
]);

const SOURCE_CONFIG = {
  gov: { urlEnv: 'GOV_SUPABASE_URL', keyEnv: 'GOV_SUPABASE_KEY', writeTables: GOV_WRITE_TABLES },
  dia: { urlEnv: 'DIA_SUPABASE_URL', keyEnv: 'DIA_SUPABASE_KEY', writeTables: DIA_WRITE_TABLES }
};

export default withErrorHandler(async function handler(req, res) {
  const startedAt = Date.now();
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  if (!requireRole(user, 'operator', workspaceId)) {
    return res.status(403).json({ error: 'Operator role required' });
  }

  const {
    actor,
    source_surface,
    target_table,
    target_source,       // 'gov' or 'dia' — which Supabase instance
    mutation_mode,       // 'patch' (default) or 'insert'
    record_identifier,   // the filter value (e.g., property_id value)
    id_column,           // the filter column (e.g., 'property_id')
    changed_fields,
    notes,
    linked_pending_id,
    propagation_scope,
    match_filters,
    reconciliation,
    propagation
  } = req.body || {};

  // --- Validate required fields ---
  const errors = [];
  const extraFilters = Array.isArray(match_filters) ? match_filters : [];
  const mutationMode = mutation_mode === 'insert' ? 'insert' : 'patch';
  if (!target_table) errors.push('target_table is required');
  if (!target_source || !SOURCE_CONFIG[target_source]) errors.push('target_source must be gov or dia');
  if (mutationMode === 'patch' && !record_identifier) errors.push('record_identifier is required');
  if (mutationMode === 'patch' && !id_column) errors.push('id_column is required');
  if (!changed_fields || typeof changed_fields !== 'object' || Object.keys(changed_fields).length === 0) {
    errors.push('changed_fields must be a non-empty object');
  }
  if (!Array.isArray(extraFilters)) errors.push('match_filters must be an array when provided');
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // --- Validate table is writable ---
  const cfg = SOURCE_CONFIG[target_source];
  if (!isAllowedTable(target_table, cfg.writeTables)) {
    return res.status(403).json({ ok: false, errors: [`Write access denied for table: ${target_table}`] });
  }

  // --- Validate column name ---
  const col = mutationMode === 'patch' ? safeColumn(id_column) : (id_column ? safeColumn(id_column) : null);
  if (mutationMode === 'patch' && !col) {
    return res.status(400).json({ ok: false, errors: ['Invalid id_column name'] });
  }
  if (mutationMode === 'insert' && id_column && !col) {
    return res.status(400).json({ ok: false, errors: ['Invalid id_column name'] });
  }
  const safeExtraFilters = [];
  for (const filter of extraFilters) {
    const safeCol = safeColumn(filter?.column || '');
    if (!safeCol) {
      return res.status(400).json({ ok: false, errors: ['Invalid match_filters column name'] });
    }
    if (filter?.value === undefined || filter?.value === null || filter?.value === '') {
      return res.status(400).json({ ok: false, errors: ['match_filters entries require a non-empty value'] });
    }
    safeExtraFilters.push({ column: safeCol, value: String(filter.value) });
  }

  const dbUrl = process.env[cfg.urlEnv];
  const dbKey = process.env[cfg.keyEnv];
  if (!dbUrl || !dbKey) {
    return res.status(503).json({ ok: false, errors: ['bridge_unavailable', 'Domain database not configured'] });
  }

  async function createPendingReview(status, errorDetails) {
    if (!isOpsConfigured()) return null;
    const pending = await opsQuery('POST', 'pending_updates', {
      workspace_id: workspaceId,
      target_source,
      target_table,
      record_identifier: record_identifier != null ? String(record_identifier) : null,
      id_column: col,
      mutation_mode: mutationMode,
      match_filters: safeExtraFilters,
      source_surface: source_surface || 'unknown',
      actor: actor || user.display_name || user.email || 'unknown',
      status,
      changed_fields,
      notes: notes || null,
      error_details: errorDetails || {},
      reconciliation: reconciliation || {},
      propagation: propagation || {},
      propagation_scope: propagation_scope || null
    });
    return pending.ok ? (Array.isArray(pending.data) ? pending.data[0] : pending.data) : null;
  }

  const requestUrl = mutationMode === 'insert'
    ? `${dbUrl}/rest/v1/${target_table}`
    : `${dbUrl}/rest/v1/${target_table}?${[{ column: col, value: String(record_identifier) }, ...safeExtraFilters]
        .map(({ column, value }) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`)
        .join('&')}`;

  let mutationResponse;
  try {
    mutationResponse = await fetch(requestUrl, {
      method: mutationMode === 'insert' ? 'POST' : 'PATCH',
      headers: {
        'apikey': dbKey,
        'Authorization': `Bearer ${dbKey}`,
        'Content-Type': 'application/json',
        'Prefer': mutationMode === 'insert'
          ? 'return=representation,resolution=ignore-duplicates'
          : 'return=representation'
      },
      body: JSON.stringify(changed_fields)
    });
  } catch (err) {
    const pending_review = await createPendingReview('needs_review', { stage: 'fetch', message: err.message });
    logPerfMetric(workspaceId, user.id, 'mutation_latency', 'apply-change', Date.now() - startedAt, {
      status: 'fetch_failed',
      target_table,
      target_source,
      mutation_mode: mutationMode
    }).catch(e => console.warn('[apply-change] Perf metric log failed:', e.message));
    console.error('[apply-change] Fetch failed:', err.message);
    return res.status(502).json({ ok: false, errors: ['bridge_unavailable', 'Domain database request failed'], pending_review });
  }

  // 409-conflict fallback: when an INSERT collides with a UNIQUE constraint
  // (e.g. a parallel writer or auto-link cron got there first), automatically
  // retry as a PATCH against the same record_identifier. The user's intent
  // wins regardless of who wrote first. Only triggered when:
  //   - we tried INSERT
  //   - server returned 409
  //   - we have an id_column + record_identifier (i.e. the row is locatable)
  if (!mutationResponse.ok
      && mutationResponse.status === 409
      && mutationMode === 'insert'
      && col
      && record_identifier !== undefined
      && record_identifier !== null) {
    const patchUrl = `${dbUrl}/rest/v1/${target_table}?${[{ column: col, value: String(record_identifier) }, ...safeExtraFilters]
      .map(({ column, value }) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`)
      .join('&')}`;
    try {
      const patchResp = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'apikey': dbKey,
          'Authorization': `Bearer ${dbKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(changed_fields)
      });
      if (patchResp.ok) {
        // Replace the response so downstream audit + return-path logic uses the patch result
        mutationResponse = patchResp;
        console.warn('[apply-change] INSERT 409 on ' + target_table
          + ' — auto-retried as PATCH and succeeded (record_identifier='
          + String(record_identifier) + ')');
      }
    } catch (retryErr) {
      // fall through to the original error path
      console.warn('[apply-change] 409 retry-as-PATCH failed:', retryErr.message);
    }
  }

  if (!mutationResponse.ok) {
    const errBody = await mutationResponse.text();
    const pending_review = await createPendingReview('needs_review', {
      stage: mutationMode,
      status: mutationResponse.status,
      detail: errBody.substring(0, 1000)
    });
    logPerfMetric(workspaceId, user.id, 'mutation_latency', 'apply-change', Date.now() - startedAt, {
      status: 'mutation_failed',
      status_code: mutationResponse.status,
      target_table,
      target_source,
      mutation_mode: mutationMode
    }).catch(e => console.warn('[apply-change] Perf metric log failed:', e.message));
    console.error(`[apply-change] ${mutationMode} failed (${mutationResponse.status}):`, errBody.substring(0, 500));
    return res.status(mutationResponse.status).json({
      ok: false,
      errors: [`Mutation failed (${mutationResponse.status})`],
      pending_review
    });
  }

  let updatedRows = [];
  try {
    const body = await mutationResponse.text();
    updatedRows = body ? JSON.parse(body) : [];
  } catch { /* representation parse failure is non-fatal */ }

  // --- Log audit record (data_corrections) in ops database ---
  // Use isOpsConfigured() to check without sending a response
  if (isOpsConfigured()) {
    const correction = {
      workspace_id: workspaceId,
      actor: actor || user.display_name || user.email || 'unknown',
      source_surface: source_surface || 'unknown',
      target_table,
      target_source,
      record_identifier: record_identifier != null ? String(record_identifier) : null,
      id_column: col,
      mutation_mode: mutationMode,
      match_filters: safeExtraFilters,
      changed_fields,
      applied_mode: mutationMode === 'insert' ? 'mutation_insert' : 'mutation_service',
      notes: notes || null,
      pending_update_id: linked_pending_id || null,
      propagation_scope: propagation_scope || null,
      reconciliation_result: reconciliation || {},
      propagation_result: propagation || {},
      applied_at: new Date().toISOString()
    };

    // Fire-and-forget audit log — don't block the response on this
    opsQuery('POST', 'data_corrections', correction).catch(err => {
      console.error('[apply-change] Failed to log data_correction:', err);
    });

    // --- Resolve linked pending_updates if provided ---
    if (linked_pending_id) {
      opsQuery('PATCH',
        `pending_updates?id=eq.${encodeURIComponent(linked_pending_id)}&workspace_id=eq.${workspaceId}`,
        { status: 'applied', resolved_at: new Date().toISOString(), resolved_by: actor || user.email }
      ).catch(err => {
        console.error('[apply-change] Failed to resolve pending_update:', err);
      });
    }
  }

  logPerfMetric(workspaceId, user.id, 'mutation_latency', 'apply-change', Date.now() - startedAt, {
    status: 'ok',
    target_table,
    target_source,
    mutation_mode: mutationMode,
    rows_affected: Array.isArray(updatedRows) ? updatedRows.length : 0,
    propagation_scope: propagation_scope || null,
    reconciliation_present: !!reconciliation,
    propagation_present: !!propagation
  }).catch(e => console.warn('[apply-change] Perf metric log failed:', e.message));

  // --- Cap-rate recalc trigger ---
  // When a PATCH against the dialysis `properties` table touches any of the
  // rent-anchor / lease-escalation columns, recompute calculated_cap_rate on
  // every historical sale for that property. Fire-and-forget so the response
  // isn't held up by sales-table scans. Only PATCH mutations are considered
  // (INSERT-mode rows are handled by the sidebar ingest pipeline).
  if (
    mutationMode === 'patch' &&
    target_source === 'dia' &&
    target_table === 'properties' &&
    record_identifier
  ) {
    const changedKeys = Object.keys(changed_fields || {});
    const anchorFieldsTouched = changedKeys.filter(k => CAP_RATE_ANCHOR_FIELDS.has(k));
    if (anchorFieldsTouched.length > 0) {
      const pid = String(record_identifier);
      console.log(
        `[cap-rate-recalc] apply-change triggered property=${pid} ` +
        `fields=${anchorFieldsTouched.join(',')}`
      );
      recalculateSaleCapRates(pid, domainQuery)
        .then(result => {
          console.log(
            `[cap-rate-recalc] apply-change result property=${pid} ` +
            `updated=${result.updated} skipped=${result.skipped} ` +
            `reason=${result.reason || 'n/a'}`
          );
        })
        .catch(err => {
          console.error(
            `[cap-rate-recalc] apply-change error property=${pid}:`,
            err?.message || err
          );
        });
    }
  }

  return res.status(200).json({
    ok: true,
    applied_mode: mutationMode === 'insert' ? 'mutation_insert' : 'mutation_service',
    rows_affected: Array.isArray(updatedRows) ? updatedRows.length : 0,
    rows: Array.isArray(updatedRows) ? updatedRows : [],
    audit_logged: isOpsConfigured(),
    reconciliation: reconciliation || {},
    propagation: propagation || {}
  });
});
