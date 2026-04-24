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
// Symmetrically, when a dialysis domain backend is configured and the
// caller is not restricted to the government domain, a parallel query
// is run against the dialysis Supabase `properties` table. The dialysis
// DB is the source of truth for DCI / Fresenius / DaVita site records,
// most of which never land in the LCC entities table, so without this
// branch `domain=dialysis` (and `domain=all`) returned empty for any
// location query.
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

// LCC app base URL for deep-linking from search results. Single source of
// truth is LCC_BASE_URL env var (set in Railway prod env). Fallback is the
// current Railway auto-generated subdomain in case the env var is missing.
const VERCEL_BASE = process.env.LCC_BASE_URL || 'https://tranquil-delight-production-633f.up.railway.app';

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

  // Observability: log every hit so Vercel runtime logs show exactly what
  // queries reach this handler, what domain/type filters are applied, and
  // (below) how many rows came back. Without this, empty-result bugs
  // (e.g. PostgREST 400s on missing columns) are invisible.
  console.log(`[search] q="${q ?? ''}" domain="${domain ?? ''}" type="${type ?? ''}"`);

  // Validate q: same sanitization as mcp/server.js search_entities
  if (typeof q !== 'string' || q.trim().length === 0) {
    res.status(400).json({ error: 'q query parameter is required' });
    return;
  }
  const rawSearchTerm = q.replace(/[%_]/g, '').trim();
  if (rawSearchTerm.length < 2) {
    res.status(400).json({ error: 'q must be at least 2 characters' });
    return;
  }

  // Pre-process: strip trailing US state abbreviations (", OK" / " OK") or
  // full state names (" Oklahoma") so that compound location queries like
  // "Tulsa OK" or "Tulsa, Oklahoma" match rows where city and state live
  // in separate columns. Without this, the ilike OR clause tries to match
  // the literal "Tulsa OK" within a single column and returns nothing.
  // The raw term is retained as a fallback when the cleaned variant yields
  // zero results (e.g. the caller really did mean a multi-word entity).
  const STATE_NAME_RE = /\s+(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)$/i;
  let cleanTerm = rawSearchTerm.replace(/[,\s]+[A-Z]{2}$/, '').trim();
  cleanTerm = cleanTerm.replace(STATE_NAME_RE, '').trim();
  const hasCleanVariant = cleanTerm.length >= 2 && cleanTerm !== rawSearchTerm;

  // Validate limit
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 50);

  if (!process.env.OPS_SUPABASE_URL || !process.env.OPS_SUPABASE_KEY) {
    res.status(503).json({ error: 'OPS database not configured' });
    return;
  }

  const entityTypeFilter = resolveEntityTypeFilter(type);
  const normalizedDomain =
    domain && domain !== 'all' && domain !== 'both' ? domain : null;

  // ── Parallel query: government domain `properties` table ────────────────
  // The government Supabase backend is the source of truth for GovLease
  // records. Many properties live there without a matching LCC entity, so
  // searching only the entities table would miss them. Fire this query
  // alongside the ops query when credentials exist and the caller isn't
  // restricted to another domain. The asset/contact/all type filter is
  // honored: only run it when type is 'all' or 'asset' (properties map to
  // the asset result type).
  //
  // IMPORTANT: the government properties schema is narrower than the
  // dialysis one. Tenant and recorded owner are NOT columns on
  // government.properties — they are explicitly deleted on ingest
  // (see sidebar-pipeline.js upsertDomainProperty, government branch).
  // Including them in the or=() filter made PostgREST return a 400
  // ("column properties.tenant does not exist") and the swallow-catch
  // below turned that into zero results. Keep the filter limited to
  // columns that actually exist on the gov properties table.
  const includeGov =
    normalizedDomain !== 'dialysis' &&
    (!type || type === 'all' || type === 'asset') &&
    getDomainCredentials('government') != null;

  // ── Parallel query: dialysis domain `properties` table ─────────────────
  // The dialysis Supabase backend is the source of truth for DCI /
  // Fresenius / DaVita site records. The LCC entities table only mirrors
  // a subset of these, so searching entities alone misses the majority of
  // dialysis properties — which is why `domain=dialysis` (and the default
  // `domain=all`) returned empty for any location query before this
  // branch existed. Fire this query alongside the ops query when
  // credentials exist and the caller isn't restricted to the government
  // domain. Same type-filter logic as the government branch (assets only).
  //
  // NOTE: the dialysis properties schema is wider than the government one
  // — it has a real `tenant` column (see sidebar-pipeline.js:702), so the
  // OR filter also matches tenant strings like "Fresenius" or "DCI".
  // Keep the selected columns minimal so PostgREST 400s on schema drift
  // don't silently turn the whole dialysis branch into zero results.
  const includeDia =
    normalizedDomain !== 'government' &&
    (!type || type === 'all' || type === 'asset') &&
    getDomainCredentials('dialysis') != null;

  // ── Build PostgREST path for entities (ops DB) ──────────────────────────
  // Expanded from the original name/canonical_name-only filter to also
  // match address/city/state. Without this, searches like "Tulsa" return
  // zero rows even when the entities table has Tulsa-located assets,
  // because city was never part of the or=(…) clause.
  async function runSearch(term) {
    const encTerm = enc(term);
    const encTermLower = enc(term.toLowerCase());
    let path =
      `entities?or=(name.ilike.*${encTerm}*,canonical_name.ilike.*${encTermLower}*,address.ilike.*${encTerm}*,city.ilike.*${encTerm}*,state.ilike.*${encTerm}*)` +
      `&select=id,entity_type,name,canonical_name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;

    if (entityTypeFilter) {
      path += `&entity_type=eq.${enc(entityTypeFilter)}`;
    }
    if (normalizedDomain) {
      path += `&domain=eq.${enc(normalizedDomain)}`;
    }
    path += `&limit=${limit}&order=name`;

    const govPath = includeGov
      ? `properties?or=(address.ilike.*${encTerm}*,city.ilike.*${encTerm}*,state.ilike.*${encTerm}*)` +
        `&select=property_id,address,city,state` +
        `&limit=${limit}&order=address`
      : null;

    // Dialysis properties table supports a `tenant` column, so include it
    // in the OR filter to match queries like "Fresenius" or "DCI". Other
    // columns not known to exist on the dialysis schema (e.g. recorded
    // owner) are intentionally left out — see the gov-branch comment above
    // about PostgREST 400s silently turning into zero results.
    const diaPath = includeDia
      ? `properties?or=(address.ilike.*${encTerm}*,city.ilike.*${encTerm}*,state.ilike.*${encTerm}*,tenant.ilike.*${encTerm}*)` +
        `&select=property_id,address,city,state,tenant` +
        `&limit=${limit}&order=address`
      : null;

    const [entitiesResult, govQueryResult, diaQueryResult] = await Promise.all([
      opsQuery('GET', path),
      govPath
        ? domainQuery('government', 'GET', govPath).catch((err) => {
            console.error(`[search] gov query threw for q="${term}":`, err?.message || err);
            return null;
          })
        : Promise.resolve(null),
      diaPath
        ? domainQuery('dialysis', 'GET', diaPath).catch((err) => {
            console.error(`[search] dia query threw for q="${term}":`, err?.message || err);
            return null;
          })
        : Promise.resolve(null),
    ]);

    // Surface PostgREST-level failures (e.g. missing column, bad filter) that
    // domainQuery() returns as { ok:false, status, data } rather than throwing.
    // Without this, a broken gov query would just look like "zero gov results".
    if (govPath && govQueryResult && govQueryResult.ok === false) {
      console.error(
        `[search] gov query failed for q="${term}" status=${govQueryResult.status}:`,
        govQueryResult.data
      );
    }
    if (diaPath && diaQueryResult && diaQueryResult.ok === false) {
      console.error(
        `[search] dia query failed for q="${term}" status=${diaQueryResult.status}:`,
        diaQueryResult.data
      );
    }
    if (!entitiesResult?.ok) {
      console.error(
        `[search] entities query failed for q="${term}" status=${entitiesResult?.status}:`,
        entitiesResult?.data
      );
    }

    return {
      rows: entitiesResult?.data || [],
      govRows: Array.isArray(govQueryResult?.data) ? govQueryResult.data : [],
      diaRows: Array.isArray(diaQueryResult?.data) ? diaQueryResult.data : [],
    };
  }

  // Try the cleaned term first (e.g. "Tulsa"), fall back to the raw term
  // (e.g. "Tulsa OK") if the cleaned variant returns nothing.
  let searchTerm = hasCleanVariant ? cleanTerm : rawSearchTerm;
  let { rows, govRows, diaRows } = await runSearch(searchTerm);
  if (
    rows.length === 0 &&
    govRows.length === 0 &&
    diaRows.length === 0 &&
    hasCleanVariant
  ) {
    console.log(
      `[search] clean term "${cleanTerm}" returned 0; falling back to raw q="${rawSearchTerm}"`
    );
    searchTerm = rawSearchTerm;
    ({ rows, govRows, diaRows } = await runSearch(searchTerm));
  }

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

  for (const prop of govRows) {
    const key = `${prop.address || ''}|${prop.city || ''}|${prop.state || ''}`.toLowerCase();
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    const cityState = [prop.city, prop.state].filter(Boolean).join(', ');
    const subtitleParts = [];
    if (prop.address) subtitleParts.push(prop.address);
    if (cityState && !subtitleParts.includes(cityState)) subtitleParts.push(cityState);
    items.push({
      id: `gov:${prop.property_id}`,
      type: 'asset',
      title: prop.address || '(unnamed property)',
      subtitle: subtitleParts.join(' · ') || null,
      domain: 'government',
      url: `${VERCEL_BASE}/asset/gov:${prop.property_id}`,
      score: computeScore(searchTerm, {
        name: prop.address,
        canonical_name: prop.city,
      }),
    });
  }

  // Dialysis properties: same dedupe-by-address logic, plus surface the
  // tenant name in the subtitle so that Fresenius/DCI/DaVita sites are
  // distinguishable in a location-based result list.
  for (const prop of diaRows) {
    const key = `${prop.address || ''}|${prop.city || ''}|${prop.state || ''}`.toLowerCase();
    if (seenAddresses.has(key)) continue;
    seenAddresses.add(key);
    const cityState = [prop.city, prop.state].filter(Boolean).join(', ');
    const subtitleParts = [];
    if (prop.address) subtitleParts.push(prop.address);
    if (cityState && !subtitleParts.includes(cityState)) subtitleParts.push(cityState);
    if (prop.tenant) subtitleParts.push(prop.tenant);
    items.push({
      id: `dia:${prop.property_id}`,
      type: 'asset',
      title: prop.address || '(unnamed property)',
      subtitle: subtitleParts.join(' · ') || null,
      domain: 'dialysis',
      url: `${VERCEL_BASE}/asset/dia:${prop.property_id}`,
      score: computeScore(searchTerm, {
        name: prop.address,
        canonical_name: prop.tenant || prop.city,
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

  console.log(
    `[search] results: ${trimmed.length} for q="${searchTerm}" ` +
    `(entities: ${rows.length}, gov_properties: ${govRows.length}, ` +
    `dia_properties: ${diaRows.length})`
  );

  res.status(200).json(trimmed);
}
