// ============================================================================
// Property Handler — HTTP mirror of Railway MCP get_property_context tool
// Life Command Center
//
// Exposed via:
//   GET /api/property?address=<str>      → (vercel.json rewrite)
//   GET /api/property?entity_id=<uuid>   → (vercel.json rewrite)
// Which rewrites to /api/entity-hub?_domain=property and dispatches here.
//
// Parity target: mcp/server.js get_property_context (lines ~253-349).
// Returns the same JSON shape so Railway MCP and direct HTTP callers can
// share response parsing code:
//   {
//     entity,                           // ops entity row + external_identities + relationships
//     active_tasks,                     // open/in_progress/waiting action_items
//     context_packet,                   // latest property context packet (cache)
//     gov_data: {                       // null if gov DB not configured or no gov linkage
//       gsa_leases,
//       ownership_history,
//       prospect_lead
//     } | null
//   }
//
// Auth: This endpoint enforces STRICT X-LCC-Key checking. Unlike the dual-mode
// authenticate() middleware used elsewhere, this endpoint is intended for
// external automation (Railway MCP, Power Automate) and refuses any request
// without a valid key. Missing or mismatched key → 401.
// ============================================================================

import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery, getDomainCredentials } from '../_shared/domain-db.js';

function enc(v) {
  return encodeURIComponent(String(v));
}

// Constant-time API key comparison (same pattern as _shared/auth.js verifyApiKey)
function verifyApiKey(provided) {
  const expected = process.env.LCC_API_KEY;
  if (!expected) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function propertyHandler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LCC-Key');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET.' });
    return;
  }

  // Strict API key auth — reject missing or wrong key
  const providedKey = req.headers['x-lcc-key'] || '';
  if (!verifyApiKey(providedKey)) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid X-LCC-Key header' });
    return;
  }

  const { address, entity_id } = req.query;

  if (!address && !entity_id) {
    res.status(400).json({ error: 'Either address or entity_id query parameter is required' });
    return;
  }

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  // ── Resolve entity ────────────────────────────────────────────────────────
  let entity = null;
  if (entity_id) {
    const r = await opsQuery(
      'GET',
      `entities?id=eq.${enc(entity_id)}&entity_type=eq.asset&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)`
    );
    entity = r.data?.[0] || null;
  } else if (address) {
    const r = await opsQuery(
      'GET',
      `entities?entity_type=eq.asset&or=(address.ilike.*${enc(address)}*,name.ilike.*${enc(address)}*)&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)&limit=1`
    );
    entity = r.data?.[0] || null;
  }

  if (!entity) {
    res.status(404).json({ error: 'Property not found', entity_id: entity_id || null, address: address || null });
    return;
  }

  const eid = entity.id;

  // Identify linked external records
  const extIds = entity.external_identities || [];
  const govIds = extIds.filter(
    (x) => x.source_system === 'gov_db' || x.source_system === 'government'
  );

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const promises = [];

  // Operations / research tasks for this entity
  promises.push(
    opsQuery(
      'GET',
      `action_items?entity_id=eq.${enc(eid)}&status=in.(open,in_progress,waiting)&select=id,title,status,priority,due_date,action_type&order=due_date.asc.nullslast&limit=20`
    )
  );

  // Context packet cache
  promises.push(
    opsQuery(
      'GET',
      `context_packets?entity_id=eq.${enc(eid)}&packet_type=eq.property&order=created_at.desc&limit=1`
    )
  );

  // GSA lease data from gov DB (if configured and entity has gov links)
  let govPromise = Promise.resolve(null);
  if (getDomainCredentials('government') && govIds.length > 0) {
    const govExtId = govIds[0].external_id;
    govPromise = Promise.all([
      domainQuery('government', 'GET', `gsa_leases?property_id=eq.${enc(govExtId)}&select=*&limit=5`),
      domainQuery('government', 'GET', `ownership_history?property_id=eq.${enc(govExtId)}&select=*&order=recorded_date.desc&limit=10`),
      domainQuery('government', 'GET', `prospect_leads?property_id=eq.${enc(govExtId)}&select=*&limit=1`),
    ]).catch(() => null);
  }
  promises.push(govPromise);

  const [actionsRes, contextRes, govData] = await Promise.all(promises);

  const result = {
    entity,
    active_tasks: actionsRes?.data || [],
    context_packet: contextRes?.data?.[0] || null,
    gov_data: null,
  };

  if (govData && Array.isArray(govData)) {
    result.gov_data = {
      gsa_leases: govData[0]?.data || [],
      ownership_history: govData[1]?.data || [],
      prospect_lead: govData[2]?.data?.[0] || null,
    };
  }

  res.status(200).json(result);
}
