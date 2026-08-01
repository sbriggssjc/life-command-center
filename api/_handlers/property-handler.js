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
  for (const dom of domains) {
    const idRes = await ops(
      'GET',
      `external_identities?source_system=eq.${enc(dom)}&source_type=eq.asset` +
        `&external_id=eq.${enc(propertyId)}&select=entity_id&limit=1`
    );
    const entityId = idRes.data?.[0]?.entity_id || null;
    if (!entityId) continue;
    const entRes = await ops(
      'GET',
      `entities?id=eq.${enc(entityId)}&entity_type=eq.asset&${PROPERTY_ENTITY_SELECT}&limit=1`
    );
    const entity = entRes.data?.[0] || null;
    if (entity) return entity;
  }
  return null;
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
      `properties?address=ilike.*${enc(variant)}*&select=property_id,address,city,state${extra}&limit=1`
    ).catch(() => ({ data: [] }));
    const hit = r.data?.[0] || null;
    if (hit?.property_id != null) return { domain, property: hit };
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
  let entity = null;
  if (entity_id) {
    const r = await opsQuery(
      'GET',
      `entities?id=eq.${enc(entity_id)}&entity_type=eq.asset&${PROPERTY_ENTITY_SELECT}`
    );
    entity = r.data?.[0] || null;
  } else if (property_id) {
    entity = await resolveEntityByPropertyIdentity({ domain, propertyId: property_id });
  }

  if (!entity && address) {
    entity = await resolveEntityByAddressPropertyIdentity({ address });
  }

  if (!entity && address) {
    const selectClause = PROPERTY_ENTITY_SELECT;

    const expanded = expandAddress(address);

    // Try original address first (case-insensitive partial match)
    const r1 = await opsQuery(
      'GET',
      `entities?entity_type=eq.asset&or=(address.ilike.*${enc(address)}*,name.ilike.*${enc(address)}*)&${selectClause}&limit=1`
    );
    entity = r1.data?.[0] || null;

    // If not found, try with abbreviations expanded / contracted
    if (!entity) {
      const contracted = contractAddress(address);
      // Build a set of unique variants (skip duplicates of original)
      const variants = [...new Set([expanded, contracted])].filter(v => v !== address);

      for (const variant of variants) {
        const r2 = await opsQuery(
          'GET',
          `entities?entity_type=eq.asset&or=(address.ilike.*${enc(variant)}*,name.ilike.*${enc(variant)}*)&${selectClause}&limit=1`
        );
        entity = r2.data?.[0] || null;
        if (entity) break;
      }
    }

    console.log(`[property] address lookup: "${address}" → "${expanded}" result: ${entity ? 'found' : 'not-found'}`);
  }

  if (!entity) {
    res.status(404).json({
      error: 'Property not found',
      entity_id: entity_id || null,
      property_id: property_id || null,
      domain: domain || null,
      address: address || null,
    });
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
