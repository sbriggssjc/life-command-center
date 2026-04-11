// ============================================================================
// Search Handler — HTTP unified search endpoint for the global search UI
// Life Command Center
//
// Exposed via:
//   GET /api/search?q=<str>&domain=<str>&type=<str>&limit=<n>
// Which rewrites to /api/entity-hub?_domain=search and dispatches here.
//
// Derived from mcp/server.js search_entities (lines ~220-251): reuses the
// same PostgREST ilike search with the same [%_] sanitization and ≥2-char
// minimum, but broadens the filter from name/canonical_name only to also
// match address, city, and state so that location queries like "Tulsa"
// surface government-leased properties whose name column is a lease
// number rather than a city.
//
// In addition, when a government domain backend is configured and the
// caller is not restricted to the dialysis domain, this handler runs a
// parallel PostgREST query against the government Supabase `properties`
// table. That table stores the canonical GovLease records and many of
// its rows are not yet mirrored into the LCC entities table, so
// searching entities alone would continue to miss them.
//
// The response is RESHAPED for UI consumers — unified array of
// { id, type, title, subtitle, domain, url, score } sorted by score desc.
//
// Query params:
//   q      — required, ≥2 chars after sanitization
//   domain — government | dialysis | all (default: all)
//   type   — asset | contact | lead | transaction | all (default: all)
//   limit  — default 20, max 50
//
// type mapping to DB entity_type column:
//   asset       → asset
//   contact     → person      (LCC "contact" = DB "person" entity)
//   lead        → lead        (not a canonical entity_type; returns [] unless
//   transaction → transaction  these values are added to the schema later)
//   all         → no filter (all entity types returned)
//
// Auth: STRICT X-LCC-Key enforcement via verifyApiKey imported from
// property-handler.js (no reimplementation).
// ============================================================================

import { opsQuery } from '../_shared/ops-db.js';
import { domainQuery, getDomainCredentials } from '../_shared/domain-db.js';
import { verifyApiKey } from './property-handler.js';

const VERCEL_BASE = 'https://life-command-center-nine.vercel.app';

function enc(v) {
  return encodeURIComponent(String(v));
}

// Translate the API-level `type` value to the DB entity_type column.
// Returns null to mean "no filter" (type=all), or a string to filter by.
function resolveEntityTypeFilter(type) {
  if (!type || type === 'all') return null;
  if (type === 'contact') return 'person';
  // asset, lead, transaction — pass through. Values not in the schema
  // simply yield zero matches, which is the correct behavior for a
  // forward-compatible filter.
  return type;
}

// Reverse mapping: DB entity_type → API-level type (for the response).
function apiTypeFromEntity(entityType) {
  if (entityType === 'person') return 'contact';
  return entityType; // asset, organization, lead, transaction, etc.
}

// Build a subtitle string from entity fields, tailored to the type.
function buildSubtitle(entity) {
  const parts = [];
  if (entity.entity_type === 'asset') {
    if (entity.address) parts.push(entity.address);
    const cityState = [entity.city, entity.state].filter(Boolean).join(', ');
    if (cityState && !parts.includes(cityState)) parts.push(cityState);
    if (entity.asset_type) parts.push(entity.asset_type);
  } else if (entity.entity_type === 'person') {
    if (entity.email) parts.push(entity.email);
    else if (entity.phone) parts.push(entity.phone);
    const cityState = [entity.city, entity.state].filter(Boolean).join(', ');
    if (cityState) parts.push(cityState);
  } else if (entity.entity_type === 'organization') {
    if (entity.org_type) parts.push(entity.org_type);
    const cityState = [entity.city, entity.state].filter(Boolean).join(', ');
    if (cityState) parts.push(cityState);
  } else {
    // Fallback for unknown entity_types
    const cityState = [entity.city, entity.state].filter(Boolean).join(', ');
    if (cityState) parts.push(cityState);
  }
  return parts.join(' · ') || null;
}

// Compute a simple substring-position score so callers can sort results
// meaningfully. Exact > startsWith > contains > fallback.
function computeScore(searchTerm, entity) {
  const s = searchTerm.toLowerCase();
  const name = (entity.name || '').toLowerCase();
  const canonical = (entity.canonical_name || '').toLowerCase();
  if (!s) return 0;
  if (name === s || canonical === s) return 100;
  if (name.startsWith(s) || canonical.startsWith(s)) return 80;
  if (name.includes(s) || canonical.includes(s)) return 60;
  return 30;
}

export async function searchHandler(req, res) {
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

  const { q, domain, type } = req.query;

  // Validate q: same sanitization as mcp/server.js search_entities
  if (typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({ error: 'q query parameter is required' });
    return;
  }
  const searchTerm = q.replace(/[%_]/g, '').trim();
  if (searchTerm.length < 2) {
    res.status(400).json({ error: 'q must be at least 2 characters' });
    return;
  }

  // Validate limit
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 50);

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  // ── Build PostgREST path for entities (ops DB) ──────────────────────────
  // Expanded from the original name/canonical_name-only filter to also
  // match address/city/state. Without this, searches like "Tulsa" return
  // zero rows even when the entities table has Tulsa-located assets,
  // because city was never part of the or=(…) clause.
  const encTerm = enc(searchTerm);
  const encTermLower = enc(searchTerm.toLowerCase());
  let path =
    `entities?or=(name.ilike.*${encTerm}*,canonical_name.ilike.*${encTermLower}*,address.ilike.*${encTerm}*,city.ilike.*${encTerm}*,state.ilike.*${encTerm}*)` +
    `&select=id,entity_type,name,canonical_name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;

  const entityTypeFilter = resolveEntityTypeFilter(type);
  if (entityTypeFilter) {
    path += `&entity_type=eq.${enc(entityTypeFilter)}`;
  }

  const normalizedDomain =
    domain && domain !== 'all' && domain !== 'both' ? domain : null;
  if (normalizedDomain) {
    path += `&domain=eq.${enc(normalizedDomain)}`;
  }

  path += `&limit=${limit}&order=name`;

  // ── Parallel query: government domain `properties` table ────────────────
  // The government Supabase backend is the source of truth for GovLease
  // records. Many properties live there without a matching LCC entity, so
  // searching only the entities table would miss them. Fire this query
  // alongside the ops query when credentials exist and the caller isn't
  // restricted to another domain. The asset/contact/all type filter is
  // honored: only run it when type is 'all' or 'asset' (properties map to
  // the asset result type).
  const includeGov =
    normalizedDomain !== 'dialysis' &&
    (!type || type === 'all' || type === 'asset') &&
    getDomainCredentials('government') != null;

  const govPath = includeGov
    ? `properties?or=(address.ilike.*${encTerm}*,city.ilike.*${encTerm}*,state.ilike.*${encTerm}*,tenant.ilike.*${encTerm}*,recorded_owner_name.ilike.*${encTerm}*)` +
      `&select=property_id,address,city,state,tenant,recorded_owner_name` +
      `&limit=${limit}&order=address`
    : null;

  const [result, govResult] = await Promise.all([
    opsQuery('GET', path),
    govPath
      ? domainQuery('government', 'GET', govPath).catch(() => null)
      : Promise.resolve(null),
  ]);
  const rows = result?.data || [];

  // ── Reshape into unified UI search results ────────────────────────────────
  const items = rows.map((entity) => {
    const apiType = apiTypeFromEntity(entity.entity_type);
    return {
      id: entity.id,
      type: apiType,
      title: entity.name || entity.canonical_name || '(unnamed)',
      subtitle: buildSubtitle(entity),
      domain: entity.domain || null,
      url: `${VERCEL_BASE}/${apiType}/${entity.id}`,
      score: computeScore(searchTerm, entity),
    };
  });

  // Dedupe helper: skip government properties whose address is already
  // represented by a linked entity, so the UI doesn't show twins.
  const seenAddresses = new Set(
    rows
      .filter((r) => r.address)
      .map((r) => `${r.address}|${r.city || ''}|${r.state || ''}`.toLowerCase())
  );

  const govRows = Array.isArray(govResult?.data) ? govResult.data : [];
  for (const prop of govRows) {
    const key = `${prop.address || ''}|${prop.city || ''}|${prop.state || ''}`.toLowerCase();
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    const cityState = [prop.city, prop.state].filter(Boolean).join(', ');
    const subtitleParts = [];
    if (prop.address) subtitleParts.push(prop.address);
    if (cityState && !subtitleParts.includes(cityState)) subtitleParts.push(cityState);
    if (prop.tenant) subtitleParts.push(prop.tenant);
    items.push({
      id: `gov:${prop.property_id}`,
      type: 'asset',
      title: prop.address || prop.tenant || '(unnamed property)',
      subtitle: subtitleParts.join(' · ') || null,
      domain: 'government',
      url: `${VERCEL_BASE}/asset/gov:${prop.property_id}`,
      score: computeScore(searchTerm, {
        name: prop.address,
        canonical_name: prop.city,
      }),
    });
  }

  // Sort by score descending, stable on title ascending
  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.title || '').localeCompare(b.title || '');
  });

  // Cap the merged entities+government result set to the requested limit.
  const trimmed = items.slice(0, limit);

  res.status(200).json(trimmed);
}
