// ============================================================================
// Gov Evidence + Write Routes — backing handler for GOV_API_URL
// Life Command Center — Wave 2 Task #110
//
// These routes are called by the Dialysis_DB `data-query` edge function when
// GOV_API_URL is set to https://life-command-center-production.up.railway.app.
//
// Call chain:
//   Browser → LCC /api/gov-evidence → adminHandler (edge-data proxy)
//          → data-query edge fn (?_route=gov-evidence)
//          → handleGovEvidence() → GOV_API_URL/api/<path>  ← these routes
//
// Auth: the edge function forwards the LCC_API_KEY as X-LCC-Key header,
// or the gov Supabase service key as Authorization: Bearer <key>.
// Both are accepted here. All routes are internal-only (never called by browsers).
//
// Exported as an Express Router. Mounted in server.js with:
//   import govEvidenceRouter from './api/gov-evidence.js';
//   app.use('/api', govEvidenceRouter);
// ============================================================================

import { Router } from 'express';
import { domainQuery, getDomainCredentials } from './_shared/domain-db.js';

const router = Router();

// ── Internal auth ─────────────────────────────────────────────────────────────
function assertInternalAuth(req, res) {
  const apiKey = process.env.LCC_API_KEY;
  const govKey = process.env.GOV_SUPABASE_SERVICE_KEY || process.env.GOV_SUPABASE_KEY;
  const header = req.headers['x-lcc-key'] || '';
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const token  = header || bearer;
  if (!token) {
    res.status(401).json({ error: 'Missing auth token' });
    return false;
  }
  if ((apiKey && token === apiKey) || (govKey && token === govKey)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// ── Helper: require gov DB creds or 503 ──────────────────────────────────────
function requireGovDb(res) {
  const creds = getDomainCredentials('gov');
  if (!creds) {
    res.status(503).json({ ok: false, error: 'gov_db_not_configured' });
    return null;
  }
  return creds;
}

// ── UUID sanitizer ────────────────────────────────────────────────────────────
function safeUuid(val) {
  return /^[0-9a-f-]{36}$/i.test(val || '') ? val : null;
}

// ── Shared DB helpers ─────────────────────────────────────────────────────────
async function fetchArtifact(artifactId) {
  const r = await domainQuery('gov', 'GET', `research_artifacts?id=eq.${artifactId}&limit=1`);
  if (!r.ok) return null;
  const rows = Array.isArray(r.data) ? r.data : [];
  return rows[0] || null;
}

async function insertPendingUpdate(fields) {
  return domainQuery('gov', 'POST', 'pending_updates', fields, { Prefer: 'return=representation' });
}

async function insertObservation(fields) {
  return domainQuery('gov', 'POST', 'research_observations', fields, { Prefer: 'return=representation' });
}

// =============================================================================
// EVIDENCE ENDPOINTS
// =============================================================================

// GET /api/evidence-health
router.get('/evidence-health', (req, res) => {
  res.status(200).json({ ok: true, service: 'gov-evidence', gov_db: !!getDomainCredentials('gov'), ts: Date.now() });
});

// POST /api/extract-screenshot-json
router.post('/extract-screenshot-json', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { image_base64, source_url, property_id, source_app, actor, notes } = req.body || {};
    if (!image_base64 && !source_url) {
      return res.status(400).json({ ok: false, error: 'image_base64 or source_url required' });
    }
    const result = await domainQuery('gov', 'POST', 'research_artifacts', {
      property_id:    property_id || null,
      artifact_type:  'screenshot',
      source_url:     source_url  || null,
      raw_text:       null,
      extracted_json: null,
      status:         'pending',
      actor:          actor       || null,
      source_app:     source_app  || null,
      notes:          notes       || null,
    }, { Prefer: 'return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.message || result.data?.error });
    const artifact = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(201).json({ ok: true, artifact });
  } catch (err) {
    console.error('[gov-evidence] extract-screenshot-json:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/research-artifacts
router.get('/research-artifacts', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { property_id, status, limit = 50, offset = 0 } = req.query;
    let path = `research_artifacts?order=created_at.desc&limit=${Number(limit)}&offset=${Number(offset)}`;
    if (property_id) path += `&property_id=eq.${encodeURIComponent(property_id)}`;
    if (status)      path += `&status=eq.${encodeURIComponent(status)}`;
    const result = await domainQuery('gov', 'GET', path, null, { Prefer: 'count=exact' });
    return res.status(result.status).json({ ok: result.ok, data: result.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts
router.post('/research-artifacts', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { property_id, artifact_type = 'manual', source_url, raw_text, extracted_json, source_app, actor, notes } = req.body || {};
    const result = await domainQuery('gov', 'POST', 'research_artifacts', {
      property_id:    property_id    || null,
      artifact_type,
      source_url:     source_url     || null,
      raw_text:       raw_text       || null,
      extracted_json: extracted_json || null,
      status:         'pending',
      actor:          actor          || null,
      source_app:     source_app     || null,
      notes:          notes          || null,
    }, { Prefer: 'return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.message || result.data?.error });
    const artifact = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(201).json({ ok: true, artifact });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/apply-loan
router.post('/research-artifacts/:artifact_id/apply-loan', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { lender, loan_amount, maturity_date, interest_rate, loan_type, recorded_date, actor, source_app, notes } = req.body || {};
    const sourceCtx = { artifact_id: artifactId, source_app: source_app || 'lcc', notes };
    const pending = [];
    for (const [field, val] of Object.entries({ lender, loan_amount, maturity_date, interest_rate, loan_type, recorded_date })) {
      if (val == null) continue;
      const r = await insertPendingUpdate({ table_name: 'loans', record_id: artifact.property_id ? String(artifact.property_id) : null, property_id: artifact.property_id || null, field_name: field, old_value: null, new_value: String(val), reason: `Extracted from artifact ${artifactId}`, confidence: 0.8, status: 'pending', source_context: { ...sourceCtx, field } });
      if (r.ok) { const row = Array.isArray(r.data) ? r.data[0] : r.data; pending.push(row?.id); }
    }
    await insertObservation({ artifact_id: artifactId, property_id: artifact.property_id || null, observation_type: 'loan', field_path: 'loans.*', proposed_value: JSON.stringify({ lender, loan_amount, maturity_date, interest_rate, loan_type, recorded_date }), confidence: 0.8, source: source_app || 'lcc', source_context: sourceCtx, status: 'pending', actor: actor || null });
    return res.status(200).json({ ok: true, pending_update_ids: pending });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/apply-ownership
router.post('/research-artifacts/:artifact_id/apply-ownership', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { owner_name, owner_entity_type, owner_address, acquisition_date, recorded_date, actor, source_app, notes } = req.body || {};
    const sourceCtx = { artifact_id: artifactId, source_app: source_app || 'lcc', notes };
    const pending = [];
    for (const [field, val] of Object.entries({ owner_name, owner_entity_type, owner_address, acquisition_date, recorded_date })) {
      if (val == null) continue;
      const r = await insertPendingUpdate({ table_name: 'recorded_owners', record_id: artifact.property_id ? String(artifact.property_id) : null, property_id: artifact.property_id || null, field_name: field, old_value: null, new_value: String(val), reason: `Extracted from artifact ${artifactId}`, confidence: 0.75, status: 'pending', source_context: { ...sourceCtx, field } });
      if (r.ok) { const row = Array.isArray(r.data) ? r.data[0] : r.data; pending.push(row?.id); }
    }
    await insertObservation({ artifact_id: artifactId, property_id: artifact.property_id || null, observation_type: 'ownership', field_path: 'recorded_owners.*', proposed_value: JSON.stringify({ owner_name, owner_entity_type, owner_address, acquisition_date, recorded_date }), confidence: 0.75, source: source_app || 'lcc', source_context: sourceCtx, status: 'pending', actor: actor || null });
    return res.status(200).json({ ok: true, pending_update_ids: pending });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/apply-listing
router.post('/research-artifacts/:artifact_id/apply-listing', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { list_price, list_date, cap_rate, status: listingStatus, broker_name, broker_firm, co_broker, actor, source_app, notes } = req.body || {};
    const sourceCtx = { artifact_id: artifactId, source_app: source_app || 'lcc', notes };
    const pending = [];
    for (const [field, val] of Object.entries({ list_price, list_date, cap_rate, status: listingStatus, broker_name, broker_firm, co_broker })) {
      if (val == null) continue;
      const r = await insertPendingUpdate({ table_name: 'available_listings', record_id: artifact.property_id ? String(artifact.property_id) : null, property_id: artifact.property_id || null, field_name: field, old_value: null, new_value: String(val), reason: `Extracted from artifact ${artifactId}`, confidence: 0.8, status: 'pending', source_context: { ...sourceCtx, field } });
      if (r.ok) { const row = Array.isArray(r.data) ? r.data[0] : r.data; pending.push(row?.id); }
    }
    await insertObservation({ artifact_id: artifactId, property_id: artifact.property_id || null, observation_type: 'listing', field_path: 'available_listings.*', proposed_value: JSON.stringify({ list_price, list_date, cap_rate, broker_name, broker_firm }), confidence: 0.8, source: source_app || 'lcc', source_context: sourceCtx, status: 'pending', actor: actor || null });
    return res.status(200).json({ ok: true, pending_update_ids: pending });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/apply-broker-contact
router.post('/research-artifacts/:artifact_id/apply-broker-contact', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { name, email, phone, firm, actor, source_app, notes } = req.body || {};
    const sourceCtx = { artifact_id: artifactId, source_app: source_app || 'lcc', notes };
    await insertObservation({ artifact_id: artifactId, property_id: artifact.property_id || null, observation_type: 'broker_contact', field_path: 'contacts.*', proposed_value: JSON.stringify({ name, email, phone, firm }), confidence: 0.85, source: source_app || 'lcc', source_context: sourceCtx, status: 'pending', actor: actor || null });
    return res.status(200).json({ ok: true, queued: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/apply-activity-note
router.post('/research-artifacts/:artifact_id/apply-activity-note', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { note_text, activity_type, actor, source_app, notes } = req.body || {};
    const sourceCtx = { artifact_id: artifactId, source_app: source_app || 'lcc', notes, activity_type };
    await insertObservation({ artifact_id: artifactId, property_id: artifact.property_id || null, observation_type: 'activity', field_path: null, proposed_value: note_text || '', confidence: 1.0, source: source_app || 'lcc', source_context: sourceCtx, status: 'pending', actor: actor || null });
    return res.status(200).json({ ok: true, queued: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-artifacts/:artifact_id/promote-observations
// Advances all pending observations for this artifact to 'reviewed'.
// Actual canonical DB writes require a separate human-approved step.
router.post('/research-artifacts/:artifact_id/promote-observations', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const artifactId = safeUuid(req.params.artifact_id);
  if (!artifactId) return res.status(400).json({ ok: false, error: 'Invalid artifact_id' });
  try {
    const artifact = await fetchArtifact(artifactId);
    if (!artifact) return res.status(404).json({ ok: false, error: 'Artifact not found' });
    const { actor } = req.body || {};
    const result = await domainQuery('gov', 'PATCH',
      `research_observations?artifact_id=eq.${artifactId}&status=eq.pending`,
      { status: 'reviewed', reviewed_by: actor || null, reviewed_at: new Date().toISOString() },
      { Prefer: 'return=representation' });
    const rows = Array.isArray(result.data) ? result.data : [];
    return res.status(200).json({ ok: true, promoted_count: rows.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================================
// OBSERVATION ENDPOINTS
// =============================================================================

// GET /api/research-observations/broker-feedback  ← MUST be before /:id routes
router.get('/research-observations/broker-feedback', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { limit = 50, offset = 0 } = req.query;
    const path = `research_observations?observation_type=eq.broker_contact&order=created_at.desc&limit=${Number(limit)}&offset=${Number(offset)}`;
    const result = await domainQuery('gov', 'GET', path, null, { Prefer: 'count=exact' });
    return res.status(result.status).json({ ok: result.ok, data: result.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/research-observations
router.get('/research-observations', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { property_id, observation_type, status, limit = 50, offset = 0 } = req.query;
    let path = `research_observations?order=created_at.desc&limit=${Number(limit)}&offset=${Number(offset)}`;
    if (property_id)      path += `&property_id=eq.${encodeURIComponent(property_id)}`;
    if (observation_type) path += `&observation_type=eq.${encodeURIComponent(observation_type)}`;
    if (status)           path += `&status=eq.${encodeURIComponent(status)}`;
    const result = await domainQuery('gov', 'GET', path, null, { Prefer: 'count=exact' });
    return res.status(result.status).json({ ok: result.ok, data: result.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-observations/:observation_id/review
router.post('/research-observations/:observation_id/review', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const obsId = safeUuid(req.params.observation_id);
  if (!obsId) return res.status(400).json({ ok: false, error: 'Invalid observation_id' });
  try {
    const { verdict, notes, actor } = req.body || {};
    const result = await domainQuery('gov', 'PATCH', `research_observations?id=eq.${obsId}`,
      { status: verdict === 'reject' ? 'rejected' : 'reviewed', reviewed_by: actor || null, reviewed_at: new Date().toISOString(), notes: notes || null },
      { Prefer: 'return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.error });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(200).json({ ok: true, observation: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/research-observations/:observation_id/promote
router.post('/research-observations/:observation_id/promote', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const obsId = safeUuid(req.params.observation_id);
  if (!obsId) return res.status(400).json({ ok: false, error: 'Invalid observation_id' });
  try {
    const { actor } = req.body || {};
    const result = await domainQuery('gov', 'PATCH', `research_observations?id=eq.${obsId}`,
      { status: 'promoted', promoted_at: new Date().toISOString(), reviewed_by: actor || null, reviewed_at: new Date().toISOString() },
      { Prefer: 'return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.error });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(200).json({ ok: true, observation: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================================
// WRITE ENDPOINTS
// =============================================================================

// POST /api/write/ownership
router.post('/write/ownership', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { property_id, owner_name, owner_entity_type, owner_address, acquisition_date, recorded_date, actor, source_app, confidence = 0.75 } = req.body || {};
    if (!property_id) return res.status(400).json({ ok: false, error: 'property_id required' });
    const sourceCtx = { actor, source_app };
    const pending   = [];
    for (const [field, val] of Object.entries({ owner_name, owner_entity_type, owner_address, acquisition_date, recorded_date })) {
      if (val == null) continue;
      const r = await insertPendingUpdate({ table_name: 'recorded_owners', record_id: String(property_id), property_id, field_name: field, old_value: null, new_value: String(val), reason: 'Direct ownership write via gov-evidence API', confidence, status: 'pending', source_context: { ...sourceCtx, field } });
      if (r.ok) { const row = Array.isArray(r.data) ? r.data[0] : r.data; pending.push(row?.id); }
    }
    return res.status(200).json({ ok: true, pending_update_ids: pending });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/write/lead-research
router.post('/write/lead-research', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { lead_id, task_type = 'ownership_research', ai_prompt, ai_response, ai_confidence, ai_sources, human_verified, human_notes, actor, source_app } = req.body || {};
    if (!lead_id) return res.status(400).json({ ok: false, error: 'lead_id required' });
    const result = await domainQuery('gov', 'POST', 'ownership_research_queue', {
      lead_id,
      task_type,
      task_status:    'completed',
      ai_prompt:      ai_prompt      || null,
      ai_response:    ai_response    || null,
      ai_confidence:  ai_confidence  ?? null,
      ai_sources:     ai_sources     || null,
      human_verified: human_verified || false,
      human_notes:    human_notes    || null,
      verified_by:    actor          || null,
      completed_at:   new Date().toISOString(),
    }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.error });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(200).json({ ok: true, row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/write/financial
router.post('/write/financial', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  try {
    const { property_id, fields = {}, actor, source_app, confidence = 0.8 } = req.body || {};
    if (!property_id) return res.status(400).json({ ok: false, error: 'property_id required' });
    if (!fields || Object.keys(fields).length === 0) return res.status(400).json({ ok: false, error: 'fields object required' });
    const sourceCtx = { actor, source_app };
    const pending   = [];
    for (const [field, val] of Object.entries(fields)) {
      if (val == null) continue;
      const r = await insertPendingUpdate({ table_name: 'property_financials', record_id: String(property_id), property_id, field_name: field, old_value: null, new_value: String(val), reason: 'Direct financial write via gov-evidence API', confidence, status: 'pending', source_context: { ...sourceCtx, field } });
      if (r.ok) { const row = Array.isArray(r.data) ? r.data[0] : r.data; pending.push(row?.id); }
    }
    return res.status(200).json({ ok: true, pending_update_ids: pending });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/pending-updates/:update_id/resolve
router.post('/pending-updates/:update_id/resolve', async (req, res) => {
  if (!assertInternalAuth(req, res)) return;
  if (!requireGovDb(res)) return;
  const updateId = safeUuid(req.params.update_id);
  if (!updateId) return res.status(400).json({ ok: false, error: 'Invalid update_id' });
  try {
    const { resolution_notes, actor } = req.body || {};
    const result = await domainQuery('gov', 'PATCH', `pending_updates?id=eq.${updateId}`,
      { status: 'resolved', resolved_by: actor || null, resolved_at: new Date().toISOString(), resolution_notes: resolution_notes || null },
      { Prefer: 'return=representation' });
    if (!result.ok) return res.status(result.status).json({ ok: false, error: result.data?.error });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    return res.status(200).json({ ok: true, update: row });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
