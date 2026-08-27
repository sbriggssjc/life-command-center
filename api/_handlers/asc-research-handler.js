import { authenticate, requireRole } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { buildAscImportRpcBody, buildAscStructuredCapture, normalizeAscAddressToken } from '../_shared/asc-research-lane.js';

function workspaceFor(req, user) {
  return req.headers['x-lcc-workspace'] || user.memberships?.[0]?.workspace_id || process.env.LCC_DEFAULT_WORKSPACE_ID;
}

async function operator(req, res) {
  const user = await authenticate(req, res);
  if (!user) return null;
  const workspaceId = workspaceFor(req, user);
  if (!workspaceId) { res.status(400).json({ error: 'No workspace context' }); return null; }
  if (!requireRole(user, 'operator', workspaceId)) { res.status(403).json({ error: 'Operator role required' }); return null; }
  return { user, workspaceId };
}

function fail(res, status, error, detail = null) {
  return res.status(status).json({ ok: false, error, ...(detail ? { detail } : {}) });
}

export async function handleAscResearchImport(req, res) {
  if (req.method !== 'POST') return fail(res, 405, `Method ${req.method} not allowed`);
  const auth = await operator(req, res); if (!auth) return;
  let body;
  try { body = buildAscImportRpcBody(req.body || {}, auth.workspaceId, auth.user.user_id || auth.user.id); }
  catch (error) { return fail(res, 400, 'invalid_frozen_sample', error.message); }
  const result = await opsQuery('POST', 'rpc/lcc_import_asc_research_run', body, { countMode: 'none' });
  if (!result.ok) return fail(res, result.status || 500, 'asc_research_import_failed', result.data);
  return res.status(201).json({ ok: true, run: Array.isArray(result.data) ? result.data[0] : result.data });
}

export async function handleAscResearchTarget(req, res) {
  if (req.method !== 'GET') return fail(res, 405, `Method ${req.method} not allowed`);
  const auth = await operator(req, res); if (!auth) return;
  const runs = await opsQuery('GET',
    `healthcare_research_runs?workspace_id=eq.${pgFilterVal(auth.workspaceId)}` +
    '&lane=eq.asc&status=eq.active&select=run_id,release_id,selection_fingerprint,candidate_pool_fingerprint' +
    '&order=created_at.desc&limit=1', null, { countMode: 'none' });
  if (!runs.ok) return fail(res, runs.status || 500, 'asc_research_target_failed', runs.data);
  const run = runs.data?.[0];
  if (!run) return res.status(200).json({ ok: true, target: null, reason: 'no_active_run' });
  const rows = await opsQuery('GET',
    `healthcare_research_candidates?run_id=eq.${pgFilterVal(run.run_id)}` +
    '&status=eq.pending&select=candidate_fingerprint,sample_ordinal,sampling_cell,cms_identity,cms_evidence,address_token' +
    '&order=sample_ordinal.asc&limit=1', null, { countMode: 'none' });
  if (!rows.ok) return fail(res, rows.status || 500, 'asc_research_target_failed', rows.data);
  const candidate = rows.data?.[0];
  let captureCount = 0;
  if (candidate) {
    const captures = await opsQuery('GET',
      `healthcare_research_captures?run_id=eq.${pgFilterVal(run.run_id)}` +
      `&candidate_fingerprint=eq.${pgFilterVal(candidate.candidate_fingerprint)}` +
      '&select=capture_id&limit=1', null, { countMode: 'exact' });
    if (!captures.ok) return fail(res, captures.status || 500, 'asc_research_target_failed', captures.data);
    captureCount = Number(captures.count) || 0;
  }
  return res.status(200).json({
    ok: true,
    target: candidate ? { ...run, ...candidate, capture_count: captureCount, lane: 'asc', controls: { canonical_write_authorized: false, salesforce_write_authorized: false, outreach_authorized: false } } : null,
    reason: candidate ? null : 'sample_capture_complete',
  });
}

async function readOnlyReconciliation(context, workspaceId) {
  const state = String(context.state || '').trim().toUpperCase();
  const address = String(context.address || '').trim();
  if (!state || !address) return { lcc_matches: [], salesforce_identities: [] };
  const candidates = await opsQuery('GET',
    `entities?workspace_id=eq.${pgFilterVal(workspaceId)}&state=eq.${pgFilterVal(state)}` +
    `&address=ilike.${pgFilterVal(`*${address}*`)}&select=id,name,address,city,state,zip&limit=25`, null, { countMode: 'none' });
  const token = normalizeAscAddressToken(context);
  const lccMatches = (candidates.ok && Array.isArray(candidates.data) ? candidates.data : [])
    .filter((row) => normalizeAscAddressToken(row) === token)
    .map((row) => ({ entity_id: row.id, name: row.name || null }));
  if (!lccMatches.length) return { lcc_matches: [], salesforce_identities: [] };
  const ids = lccMatches.map((row) => row.entity_id).join(',');
  const sf = await opsQuery('GET',
    `external_identities?workspace_id=eq.${pgFilterVal(workspaceId)}&source_system=eq.salesforce` +
    `&entity_id=in.(${ids})&select=entity_id,source_type,external_id,external_url`, null, { countMode: 'none' });
  return { lcc_matches: lccMatches, salesforce_identities: sf.ok && Array.isArray(sf.data) ? sf.data : [] };
}

export async function handleAscResearchCapture(req, res) {
  if (req.method !== 'POST') return fail(res, 405, `Method ${req.method} not allowed`);
  const auth = await operator(req, res); if (!auth) return;
  const target = req.body?.target;
  const context = req.body?.context;
  if (!target?.run_id || !target?.candidate_fingerprint) return fail(res, 400, 'frozen_target_required');
  const targetRows = await opsQuery('GET',
    `healthcare_research_candidates?run_id=eq.${pgFilterVal(target.run_id)}` +
    `&candidate_fingerprint=eq.${pgFilterVal(target.candidate_fingerprint)}` +
    '&select=run_id,candidate_fingerprint,cms_identity,cms_evidence,address_token,status&limit=1', null, { countMode: 'none' });
  const storedTarget = targetRows.ok ? targetRows.data?.[0] : null;
  if (!storedTarget) return fail(res, 404, 'frozen_target_not_found');
  let built;
  try { built = buildAscStructuredCapture(storedTarget, context || {}); }
  catch (error) { return fail(res, 409, 'capture_blocked', error.message); }
  const reconciliation = {
    ...await readOnlyReconciliation(context || {}, auth.workspaceId),
    asc_identity_match: built.identity_match,
  };
  const result = await opsQuery('POST', 'rpc/lcc_capture_asc_research_evidence', {
    p_run_id: storedTarget.run_id,
    p_candidate_fingerprint: storedTarget.candidate_fingerprint,
    p_capture: { ...built.capture, reconciliation },
    p_evidence: built.evidence,
    p_captured_by: auth.user.user_id || auth.user.id || null,
  }, { countMode: 'none' });
  if (!result.ok) return fail(res, result.status || 500, 'asc_research_capture_failed', result.data);
  return res.status(201).json({ ok: true, capture: Array.isArray(result.data) ? result.data[0] : result.data, reconciliation, controls: { canonical_write_performed: false, salesforce_write_performed: false, outreach_performed: false } });
}

export async function handleAscResearchComplete(req, res) {
  if (req.method !== 'POST') return fail(res, 405, `Method ${req.method} not allowed`);
  const auth = await operator(req, res); if (!auth) return;
  const { run_id, candidate_fingerprint, source_dispositions } = req.body || {};
  if (!run_id || !candidate_fingerprint) return fail(res, 400, 'frozen_target_required');
  if (source_dispositions != null) {
    if (source_dispositions?.costar !== 'not_found'
      || source_dispositions?.rca !== 'not_found'
      || Object.keys(source_dispositions).length !== 2) {
      return fail(res, 400, 'exact_dual_source_missingness_required');
    }
    const missing = await opsQuery('POST', 'rpc/lcc_complete_asc_candidate_missingness', {
      p_run_id: run_id,
      p_candidate_fingerprint: candidate_fingerprint,
      p_source_dispositions: source_dispositions,
      p_completed_by: auth.user.user_id || auth.user.id || null,
    }, { countMode: 'none' });
    if (!missing.ok) return fail(res, missing.status || 500, 'asc_research_missingness_failed', missing.data);
    return res.status(200).json({
      ok: true,
      candidate: Array.isArray(missing.data) ? missing.data[0] : missing.data,
      controls: { canonical_write_performed: false, salesforce_write_performed: false, outreach_performed: false },
    });
  }
  const result = await opsQuery('POST', 'rpc/lcc_complete_asc_candidate_capture', {
    p_run_id: run_id,
    p_candidate_fingerprint: candidate_fingerprint,
    p_completed_by: auth.user.user_id || auth.user.id || null,
  }, { countMode: 'none' });
  if (!result.ok) return fail(res, result.status || 500, 'asc_research_complete_failed', result.data);
  return res.status(200).json({ ok: true, candidate: Array.isArray(result.data) ? result.data[0] : result.data });
}
