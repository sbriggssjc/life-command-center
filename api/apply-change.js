// ============================================================================
// Apply Change API — Closed-loop mutation service for business table writes
// Life Command Center
//
// POST /api/apply-change
// ============================================================================

import { authenticate, requireRole, handleCors } from './_shared/auth.js';
import { opsQuery, isOpsConfigured, withErrorHandler } from './_shared/ops-db.js';
import {
  GOV_WRITE_TABLES, DIA_WRITE_TABLES, isAllowedTable, safeColumn
} from './_shared/allowlist.js';

const SOURCE_CONFIG = {
  gov: { urlEnv: 'GOV_SUPABASE_URL', keyEnv: 'GOV_SUPABASE_KEY', writeTables: GOV_WRITE_TABLES },
  dia: { urlEnv: 'DIA_SUPABASE_URL', keyEnv: 'DIA_SUPABASE_KEY', writeTables: DIA_WRITE_TABLES }
};

export default withErrorHandler(async function handler(req, res) {
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
    record_identifier,   // the filter value (e.g., property_id value)
    id_column,           // the filter column (e.g., 'property_id')
    changed_fields,
    notes,
    linked_pending_id,
    propagation_scope,
    reconciliation,
    propagation
  } = req.body || {};

  // --- Validate required fields ---
  const errors = [];
  if (!target_table) errors.push('target_table is required');
  if (!target_source || !SOURCE_CONFIG[target_source]) errors.push('target_source must be gov or dia');
  if (!record_identifier) errors.push('record_identifier is required');
  if (!id_column) errors.push('id_column is required');
  if (!changed_fields || typeof changed_fields !== 'object' || Object.keys(changed_fields).length === 0) {
    errors.push('changed_fields must be a non-empty object');
  }
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // --- Validate table is writable ---
  const cfg = SOURCE_CONFIG[target_source];
  if (!isAllowedTable(target_table, cfg.writeTables)) {
    return res.status(403).json({ ok: false, errors: [`Write access denied for table: ${target_table}`] });
  }

  // --- Validate column name ---
  const col = safeColumn(id_column);
  if (!col) {
    return res.status(400).json({ ok: false, errors: ['Invalid id_column name'] });
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
      record_identifier: String(record_identifier),
      id_column: col,
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

  // --- Apply the PATCH to the target table ---
  const patchUrl = `${dbUrl}/rest/v1/${target_table}?${encodeURIComponent(col)}=eq.${encodeURIComponent(record_identifier)}`;

  let patchResponse;
  try {
    patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'apikey': dbKey,
        'Authorization': `Bearer ${dbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(changed_fields)
    });
  } catch (err) {
    const pending_review = await createPendingReview('needs_review', { stage: 'fetch', message: err.message });
    return res.status(502).json({ ok: false, errors: ['bridge_unavailable', `Fetch failed: ${err.message}`], pending_review });
  }

  if (!patchResponse.ok) {
    const errBody = await patchResponse.text();
    const pending_review = await createPendingReview('needs_review', {
      stage: 'patch',
      status: patchResponse.status,
      detail: errBody.substring(0, 1000)
    });
    return res.status(patchResponse.status).json({
      ok: false,
      errors: [`Supabase PATCH failed (${patchResponse.status}): ${errBody.substring(0, 500)}`],
      pending_review
    });
  }

  let updatedRows = [];
  try {
    const body = await patchResponse.text();
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
      record_identifier: String(record_identifier),
      id_column: col,
      changed_fields,
      applied_mode: 'mutation_service',
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
        `pending_updates?id=eq.${linked_pending_id}&workspace_id=eq.${workspaceId}`,
        { status: 'applied', resolved_at: new Date().toISOString(), resolved_by: actor || user.email }
      ).catch(err => {
        console.error('[apply-change] Failed to resolve pending_update:', err);
      });
    }
  }

  return res.status(200).json({
    ok: true,
    applied_mode: 'mutation_service',
    rows_affected: Array.isArray(updatedRows) ? updatedRows.length : 0,
    audit_logged: isOpsConfigured(),
    reconciliation: reconciliation || {},
    propagation: propagation || {}
  });
});
