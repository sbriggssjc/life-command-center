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
import { assembleSinglePacket } from '../operations.js';
import { resolveSubject, resolutionHttpStatus } from '../../mcp/subject-resolver.js';

function enc(v) {
  return encodeURIComponent(String(v));
}

function normDomain(v) {
  const d = String(v || '').toLowerCase().trim();
  if (d === 'dia' || d === 'dialysis') return 'dia';
  if (d === 'gov' || d === 'government') return 'gov';
  return null;
}

const PROPERTY_ENTITY_SELECT = 'select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)';

export async function resolveEntityByPropertyIdentity({ domain, propertyId, ops = opsQuery }) {
  if (propertyId === null || propertyId === undefined || String(propertyId).trim() === '') return null;
  const domains = normDomain(domain) ? [normDomain(domain)] : ['dia', 'gov'];
  const matches = [];
  for (const dom of domains) {
    const idRes = await ops(
      'GET',
      `external_identities?source_system=eq.${enc(dom)}&source_type=eq.asset` +
        `&external_id=eq.${enc(propertyId)}&select=entity_id`
    );
    const entityIds = [...new Set((idRes.data || []).map((r) => r.entity_id).filter(Boolean))];
    for (const entityId of entityIds) {
      const entRes = await ops(
        'GET',
        `entities?id=eq.${enc(entityId)}&entity_type=eq.asset&${PROPERTY_ENTITY_SELECT}&limit=1`
      );
      const entity = entRes.data?.[0] || null;
      if (entity) matches.push(entity);
    }
  }
  const unique = [...new Map(matches.map((e) => [e.id, e])).values()];
  return unique.length === 1 ? unique[0] : null;
}

async function findDomainPropertyByAddress(domain, address) {
  const longDomain = domain === 'gov' ? 'government' : 'dialysis';
  if (!getDomainCredentials(longDomain)) return null;
  const extra = domain === 'gov' ? ',agency' : ',tenant,operator,chain_canonical';
  const variants = [...new Set([address, expandAddress(address), contractAddress(address)])];
  for (const variant of variants) {
    const r = await domainQuery(
      longDomain,
      'GET',
      `properties?address=ilike.*${enc(variant)}*&select=property_id,address,city,state${extra}&limit=25`
    ).catch(() => ({ data: [] }));
    const hits = [...new Map((r.data || []).filter((p) => p?.property_id != null).map((p) => [p.property_id, p])).values()];
    if (hits.length === 1) return { domain, property: hits[0] };
    if (hits.length > 1) return null;
  }
  return null;
}

export async function resolveEntityByAddressPropertyIdentity({
  address,
  ops = opsQuery,
  findDomainProperty = findDomainPropertyByAddress,
}) {
  if (!address) return null;
  for (const dom of ['dia', 'gov']) {
    const hit = await findDomainProperty(dom, address);
    if (!hit) continue;
    const entity = await resolveEntityByPropertyIdentity({
      domain: hit.domain,
      propertyId: hit.property.property_id,
      ops,
    });
    if (entity) return entity;
  }
  return null;
}

/**
 * Resolve the property context packet, assembling on a cache miss.
 *
 * Phase 2 Slice 3a — the handler used to READ the cache and return null on a
 * miss, so every property returned `context_packet: null`. Now a miss (no fresh
 * cached row) warms the cache via the assembler and returns the freshly built
 * packet. A cache HIT short-circuits (no assembly). Exported + dependency-
 * injected (`assembleFn`) so the miss/hit branches are unit-testable.
 */
export async function resolveContextPacket({ cachedRow, entity, assembleFn }) {
  if (cachedRow) {
    return { context_packet: cachedRow, assembled_on_miss: false };
  }
  try {
    const assembled = await assembleFn({
      packet_type: 'property',
      entity_id: entity.id,
      entity_type: 'asset',
      workspaceId: entity.workspace_id || null,
      userId: null,
    });
    if (!assembled || !assembled.payload) {
      return { context_packet: null, assembled_on_miss: false };
    }
    return {
      context_packet: {
        packet_type: 'property',
        entity_id: entity.id,
        payload: assembled.payload,
        token_count: assembled.token_count ?? null,
        assembled_at: assembled.assembled_at ?? null,
        expires_at: assembled.expires_at ?? null,
        cache_hit: !!assembled.cache_hit,
        assembled_on_miss: true,
      },
      assembled_on_miss: true,
    };
  } catch (err) {
    console.error('[property] assemble-on-miss failed:', err.message);
    return { context_packet: null, assembled_on_miss: false };
  }
}

// ── Address abbreviation expansion ──────────────────────────────────────────
// Maps common street abbreviations ↔ full words so lookups match either form.
const ABBREV_MAP = {
  'S': 'South', 'N': 'North', 'E': 'East', 'W': 'West',
  'St': 'Street', 'Ave': 'Avenue', 'Blvd': 'Boulevard', 'Dr': 'Drive', 'Rd': 'Road',
};

// Build a reverse map (full → abbreviated) for contracting addresses
const EXPAND_MAP = {};  // abbrev → full  (same as ABBREV_MAP)
const CONTRACT_MAP = {}; // full → abbrev
for (const [abbr, full] of Object.entries(ABBREV_MAP)) {
  EXPAND_MAP[abbr.toLowerCase()] = full;
  CONTRACT_MAP[full.toLowerCase()] = abbr;
}

/**
 * Replace standalone abbreviated words with their expanded forms.
 * "601 S Boulder Ave" → "601 South Boulder Avenue"
 */
function expandAddress(address) {
  return address.replace(/\b(\w+)\b/g, (match) => {
    const expanded = EXPAND_MAP[match.toLowerCase()];
    if (!expanded) return match;
    // Preserve leading case: if input is uppercase "S", return "South"
    return match[0] === match[0].toUpperCase() ? expanded : expanded.toLowerCase();
  });
}

/**
 * Replace standalone full words with their abbreviated forms.
 * "601 South Boulder Avenue" → "601 S Boulder Ave"
 */
function contractAddress(address) {
  return address.replace(/\b(\w+)\b/g, (match) => {
    const contracted = CONTRACT_MAP[match.toLowerCase()];
    if (!contracted) return match;
    return contracted;
  });
}

// Constant-time API key comparison (same pattern as _shared/auth.js verifyApiKey)
// Exported so sibling handlers (e.g. contact-handler.js) can reuse the exact
// same strict X-LCC-Key check without reimplementing it.
export function verifyApiKey(provided) {
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

  let { address, entity_id, property_id, domain, q } = req.query;

  // Resolve q -> property_id, entity_id, or address when dedicated params are absent.
  if (!address && !entity_id && q) {
    const trimmed = q.trim();
    const domainProperty = trimmed.match(/^(dia|dialysis|gov|government):(.+)$/i);
    if (domainProperty) {
      domain = domainProperty[1];
      property_id = domainProperty[2];
    } else if (/^\d+$/.test(trimmed)) {
      property_id = trimmed;
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
        || /^[a-z]+:/i.test(trimmed)) {
      entity_id = trimmed;
    } else {
      address = trimmed;
    }
  }

  if (!address && !entity_id && !property_id) {
    res.status(400).json({ error: 'One of q, address, entity_id, or property_id query parameter is required' });
    return;
  }

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  // ── Resolve entity ────────────────────────────────────────────────────────
  const resolution = await resolveSubject(
    { entity_id, address, property_id, domain },
    {
      type: 'property',
      tool: 'get_property_context',
      surface: 'http',
      opsQuery,
      domainQuery,
      getDomainCredentials,
    }
  );

  if (resolution.status !== 'resolved') {
    res.status(resolutionHttpStatus(resolution)).json({
      ...resolution,
      error: resolution.error || 'Property not found',
      entity_id: entity_id || null,
      property_id: property_id || null,
      domain: domain || null,
      address: address || null,
    });
    return;
  }

  if (!resolution.entity && resolution.domain_property) {
    const direct = await assembleDomainPropertyFallback(resolution.domain_property);
    if (direct) {
      res.status(200).json({ ...direct, resolution });
      return;
    }
  }

  const entity = resolution.entity;
  if (!entity) {
    res.status(404).json({ ...resolution, error: 'Property not found', entity_id, property_id, domain, address });
    return;
  }

  const eid = entity.id;

  // Identify linked external records
  const extIds = entity.external_identities || [];
  // R4-A: canonical 'gov' first; accept deprecated spellings during transition.
  const govIds = extIds.filter(
    (x) => x.source_system === 'gov'
        || x.source_system === 'gov_db'
        || x.source_system === 'gov_supabase'
        || x.source_system === 'government'
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

  // Context packet cache — fresh rows only (a stale/invalidated row counts as a
  // miss so assemble-on-miss rebuilds it below).
  promises.push(
    opsQuery(
      'GET',
      `context_packets?entity_id=eq.${enc(eid)}&packet_type=eq.property` +
      `&invalidated=eq.false&expires_at=gt.${enc(new Date().toISOString())}` +
      `&order=created_at.desc&limit=1`
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

  // Assemble-on-miss: warm + return a real packet when the cache has no fresh row.
  const { context_packet } = await resolveContextPacket({
    cachedRow: contextRes?.data?.[0] || null,
    entity,
    assembleFn: assembleSinglePacket,
  });

  const result = {
    resolution: {
      status: resolution.status,
      type: resolution.type,
      confidence: resolution.confidence,
      resolved_via: resolution.resolved_via,
      candidates: resolution.candidates,
    },
    entity,
    active_tasks: actionsRes?.data || [],
    context_packet,
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

async function assembleDomainPropertyFallback(domainProperty) {
  const dom = normDomain(domainProperty?.domain);
  if (!dom || !domainProperty?.property_id) return null;
  if (dom === 'gov') {
    const pid = domainProperty.property_id;
    const [leases, owners, lead] = await Promise.all([
      domainQuery('government', 'GET', `gsa_leases?property_id=eq.${enc(pid)}&select=*&limit=5`).catch(() => ({ data: [] })),
      domainQuery('government', 'GET', `ownership_history?property_id=eq.${enc(pid)}&select=*&order=recorded_date.desc&limit=10`).catch(() => ({ data: [] })),
      domainQuery('government', 'GET', `prospect_leads?property_id=eq.${enc(pid)}&select=*&limit=1`).catch(() => ({ data: [] })),
    ]);
    return {
      resolved_via: 'gov_property_fallback',
      note: 'No LCC asset entity for this property yet — resolved directly from the government domain by address.',
      property: { ...domainProperty, domain: 'gov' },
      entity: null,
      context_packet: null,
      gov_data: {
        gsa_leases: leases.data || [],
        ownership_history: owners.data || [],
        prospect_lead: lead.data?.[0] || null,
      },
    };
  }
  const leases = await domainQuery('dialysis', 'GET', `leases?property_id=eq.${enc(domainProperty.property_id)}&select=*&limit=5`)
    .catch(() => ({ data: [] }));
  return {
    resolved_via: 'dia_property_fallback',
    note: 'No LCC asset entity for this property yet — resolved directly from the dialysis domain by address.',
    property: { ...domainProperty, domain: 'dia' },
    entity: null,
    context_packet: null,
    dia_data: { leases: leases.data || [] },
  };
}
