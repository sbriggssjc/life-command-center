// ============================================================================
// Government Write Service Proxy
// Life Command Center — Closed-loop write services
//
// Proxies LCC write operations to the Government FastAPI write service endpoints.
// All government domain mutations (ownership, lead research, financial, pending
// update resolution) flow through here instead of raw Supabase table patches.
//
// POST /api/gov-write?endpoint=ownership
// POST /api/gov-write?endpoint=lead-research
// POST /api/gov-write?endpoint=financial
// POST /api/gov-write?endpoint=resolve-pending&update_id=<id>
// ============================================================================

import { authenticate, requireRole, primaryWorkspace, handleCors } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';

const GOV_API_URL = process.env.GOV_API_URL;

// Map LCC endpoint names to Gov FastAPI paths
const ENDPOINT_MAP = {
  'ownership':        '/api/write/ownership',
  'lead-research':    '/api/write/lead-research',
  'financial':        '/api/write/financial',
  'resolve-pending':  '/api/pending-updates'   // /{update_id}/resolve appended below
};

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const ws = primaryWorkspace(user);
  if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
    return res.status(403).json({ error: 'Operator role required for government writes' });
  }

  if (!GOV_API_URL) {
    return res.status(503).json({ error: 'GOV_API_URL not configured' });
  }

  const { endpoint, update_id } = req.query;
  if (!endpoint || !ENDPOINT_MAP[endpoint]) {
    return res.status(400).json({
      error: `Invalid endpoint. Use: ${Object.keys(ENDPOINT_MAP).join(', ')}`
    });
  }

  // Build the Gov FastAPI URL
  let govPath = ENDPOINT_MAP[endpoint];
  if (endpoint === 'resolve-pending') {
    if (!update_id) {
      return res.status(400).json({ error: 'update_id query parameter required for resolve-pending' });
    }
    govPath = `${govPath}/${encodeURIComponent(update_id)}/resolve`;
  }

  const govUrl = `${GOV_API_URL.replace(/\/+$/, '')}${govPath}`;

  // Inject LCC-specific fields: source_app and actor
  const body = {
    ...req.body,
    source_app: 'lcc',
    actor: user.email || user.display_name || user.id
  };

  try {
    const response = await fetch(govUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source-App': 'lcc',
        'X-LCC-User': user.id
      },
      body: JSON.stringify(body)
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Gov write service returned ${response.status}`,
        detail: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(`[gov-write] Error calling ${govUrl}:`, err.message);
    return res.status(502).json({
      error: 'Failed to reach government write service',
      message: process.env.LCC_ENV === 'development' ? err.message : undefined
    });
  }
});
