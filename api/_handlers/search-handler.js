// ============================================================================
// Search Handler — HTTP unified search endpoint for the global search UI
// Life Command Center
//
// Exposed via:
//   GET /api/search?q=<str>&domain=<str>&type=<str>&limit=<n>
// Which rewrites to /api/entity-hub?_domain=search and dispatches here.
//
// Derived from mcp/server.js search_entities (lines ~220-251): reuses the
// same PostgREST ilike search against entities.name / canonical_name with
// the same [%_] sanitization and ≥2-char minimum. The response is RESHAPED
// for UI consumers — unified array of { id, type, title, subtitle, domain,
// url, score } sorted by score descending.
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

  // ── Build PostgREST path (same as mcp/server.js search_entities) ────────
  let path =
    `entities?or=(name.ilike.*${enc(searchTerm)}*,canonical_name.ilike.*${enc(searchTerm.toLowerCase())}*)` +
    `&select=id,entity_type,name,canonical_name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;

  const entityTypeFilter = resolveEntityTypeFilter(type);
  if (entityTypeFilter) {
    path += `&entity_type=eq.${enc(entityTypeFilter)}`;
  }

  if (domain && domain !== 'all' && domain !== 'both') {
    path += `&domain=eq.${enc(domain)}`;
  }

  path += `&limit=${limit}&order=name`;

  const result = await opsQuery('GET', path);
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

  // Sort by score descending, stable on title ascending
  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.title || '').localeCompare(b.title || '');
  });

  res.status(200).json(items);
}
