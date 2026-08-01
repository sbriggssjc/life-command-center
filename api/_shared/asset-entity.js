// api/_shared/asset-entity.js
// ============================================================================
// ensureAssetEntityForProperty — the single reusable path that guarantees a
// domain property (dia / gov) has a well-formed LCC **asset entity** so the deal
// spine can assemble around it.
//
// Extracted from intake-promoter.js::promoteLccEntity so every surface that
// needs a domain property surfaced as an entity — the OM promoter, the
// post-close (sales_transactions) hook, the property panel, and the
// generate_dossier action — funnels through one implementation instead of each
// minting its own stub.
//
// What "well-formed" means (the 5247 Airways gold-standard, entity bd4aab4a):
//   - entities row: entity_type='asset', name = street address (NOT the city),
//     domain, addr/city/state/zip/lat/lng, asset_type.
//   - external_identities bridge: (source_system=<dia|gov>, source_type='asset',
//     external_id=<domain property_id>), metadata.domain_property_id +
//     bridge_source.
//   - entities.metadata populated from the domain DB: tenants[], sales_history[],
//     loans[], contacts[], domain_property_id, source — so the sidebar timeline,
//     dossier packet, and party graph read live facts instead of "Not on file".
//
// Contract (matches the codebase's data-write discipline):
//   - FILL-BLANKS ONLY on the entity scalar fields — never clobber a curated
//     name/address/asset_type that a human or a richer source already set.
//   - NEVER FABRICATE — a party/loan/tenant the domain DB doesn't hold stays
//     absent; the metadata arrays only carry rows that exist in the domain DB.
//   - IDEMPOTENT — a second call over an already-enriched entity is a no-op.
//   - REVERSIBLE — the bridge/metadata are additive; nothing is hard-deleted.
//
// The heavy CoStar/RCA "capture → propagate into the domain DB" path
// (sidebar-pipeline) is the INVERSE of this: it writes the domain DB from a
// fresh capture. This function reads an ALREADY-domain-resident property and
// surfaces it as an entity, which is the case for every closed deal we already
// hold.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';
import { domainQuery } from './domain-db.js';
import {
  ensureEntityLink,
  canonicalIdentitySystem,
  canonicalEntityDomain,
  normalizeState,
} from './entity-link.js';

// Default workspace (matches intake-promoter + the sidebar bridge seed).
export const DEFAULT_ASSET_WORKSPACE_ID = 'a0000000-0000-0000-0000-000000000001';

// dia/gov long-form ↔ short-form. domainQuery wants the LONG form
// ('dialysis'/'government'); external_identities.source_system wants the canonical
// SHORT form ('dia'/'gov'). We accept either spelling on the way in.
function domainLongForm(domain) {
  const d = String(domain || '').toLowerCase();
  if (d === 'dia' || d === 'dialysis') return 'dialysis';
  if (d === 'gov' || d === 'government') return 'government';
  return null;
}

function firstNonBlank(...vals) {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return null;
}

// Pull the domain rows we surface into entity.metadata. Every read is
// best-effort — a domain table that 403s / is empty just yields [] and the
// section renders "Not on file" rather than blocking entity creation.
async function readDomainPacket(longDomain, propertyId, deps) {
  const dq = deps.domainQuery || domainQuery;
  const pid = encodeURIComponent(String(propertyId));

  async function safe(path) {
    try {
      const r = await dq(longDomain, 'GET', path);
      return (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    } catch { return []; }
  }

  // dia and gov diverge on column names; the packet builder below reads
  // defensively so one shared query shape works for both.
  const [property] = await safe(
    `properties?property_id=eq.${pid}&limit=1`);

  const leases = await safe(
    `leases?property_id=eq.${pid}&order=lease_id.desc&limit=25`);
  const sales = await safe(
    `sales_transactions?property_id=eq.${pid}&order=sale_date.desc&limit=25`);
  const contacts = await safe(
    `contacts?property_id=eq.${pid}&limit=25`);
  const loans = await safe(
    `loans?property_id=eq.${pid}&limit=25`);

  return { property: property || null, leases, sales, contacts, loans };
}

function buildTenants(leases) {
  const out = [];
  const seen = new Set();
  for (const l of leases || []) {
    // Prefer the LIVE lease's tenant; a superseded row's tenant is historical.
    const name = firstNonBlank(l.tenant, l.tenant_name, l.operator, l.guarantor);
    if (!name) continue;
    const key = String(name).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: String(name),
      lease_expiration: firstNonBlank(l.lease_expiration, l.lease_exp) || null,
    });
  }
  return out;
}

function buildSalesHistory(sales) {
  return (sales || []).map(s => {
    const row = {
      kind: 'sale',
      seller: firstNonBlank(s.seller_name, s.seller) || null,
      buyer: firstNonBlank(s.buyer_name, s.buyer) || null,
      cap_rate: firstNonBlank(s.cap_rate_final, s.cap_rate, s.stated_cap_rate) || null,
      sale_date: firstNonBlank(s.sale_date) || null,
      sale_price: firstNonBlank(s.sold_price, s.sale_price) || null,
      is_northmarq: s.is_northmarq === true || undefined,
    };
    // Drop undefined keys so the metadata stays tight.
    Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
    return row;
  });
}

function buildContacts(contacts) {
  const out = [];
  for (const c of contacts || []) {
    const name = firstNonBlank(c.contact_name, c.name, c.company);
    if (!name) continue;
    const row = {
      name: String(name),
      role: firstNonBlank(c.role, c.contact_role) || 'contact',
    };
    const email = firstNonBlank(c.contact_email, c.email);
    const phone = firstNonBlank(c.contact_phone, c.phone);
    const company = firstNonBlank(c.company);
    if (email) row.email = email;
    if (phone) row.phone = phone;
    if (company && company !== name) row.company = company;
    out.push(row);
  }
  return out;
}

/**
 * Ensure the domain property has a well-formed LCC asset entity.
 *
 * @param {object} o
 * @param {'dia'|'gov'|'dialysis'|'government'} o.domain
 * @param {string|number} o.propertyId   domain properties.property_id
 * @param {string} [o.workspaceId]
 * @param {string} [o.userId]            actor for created_by (nullable)
 * @param {object} [o.deps]              { opsQuery, domainQuery, ensureEntityLink } for tests
 * @returns {Promise<{ok:boolean, entity_id?:string, created?:boolean,
 *   enriched?:boolean, skipped?:string, detail?:any}>}
 */
export async function ensureAssetEntityForProperty({
  domain,
  propertyId,
  workspaceId = DEFAULT_ASSET_WORKSPACE_ID,
  userId = null,
  deps = {},
} = {}) {
  const longDomain = domainLongForm(domain);
  if (!longDomain) return { ok: false, skipped: 'unsupported_domain', detail: domain };
  if (propertyId === null || propertyId === undefined || String(propertyId).trim() === '') {
    return { ok: false, skipped: 'no_property_id' };
  }

  const _ops = deps.opsQuery || opsQuery;
  const _link = deps.ensureEntityLink || ensureEntityLink;
  const sourceSystem = canonicalIdentitySystem(longDomain); // 'dia' | 'gov'
  const externalId = String(propertyId);

  // 1) Read the domain property + its deal facts FIRST so the entity is seeded
  //    with the real address on creation (avoids the "name = city" stub bug).
  const packet = await readDomainPacket(longDomain, propertyId, deps);
  const prop = packet.property;
  const seedAddress = prop ? firstNonBlank(prop.address, prop.street_address) : null;
  const seedCity = prop ? firstNonBlank(prop.city) : null;
  const seedState = prop ? normalizeState(firstNonBlank(prop.state)) : null;

  // 2) Resolve-or-create the entity + bridge via the R4-A choke point.
  const link = await _link({
    workspaceId,
    userId,
    sourceSystem,
    sourceType: 'asset',
    externalId,
    domain: canonicalEntityDomain(longDomain),
    seedFields: {
      // name defaults to the street address (gold-standard convention) — the
      // domain city is the fallback only when we truly have no address.
      name: seedAddress || seedCity || `asset ${externalId}`,
      address: seedAddress || null,
      city: seedCity || null,
      state: seedState || null,
      zip: prop ? firstNonBlank(prop.zip_code, prop.zip) : null,
      county: prop ? firstNonBlank(prop.county) : null,
      latitude: prop ? firstNonBlank(prop.latitude) : null,
      longitude: prop ? firstNonBlank(prop.longitude) : null,
      asset_type: prop ? firstNonBlank(prop.property_type, prop.asset_type) : null,
      domain: canonicalEntityDomain(longDomain),
    },
    metadata: {
      domain_property_id: Number.isNaN(Number(externalId)) ? externalId : Number(externalId),
      bridge_source: deps.bridgeSource || 'ensure_asset_entity',
    },
  });

  if (!link || !link.ok) {
    return { ok: false, skipped: 'ensure_link_failed', detail: link };
  }
  const entityId = link.entity?.id || link.entityId || null;
  if (!entityId) return { ok: false, skipped: 'no_entity_id', detail: link };

  // 3) Enrich the entity (fill-blanks on scalars, populate metadata) from the
  //    domain packet. Idempotent — a second call re-derives the same values.
  const enriched = await enrichAssetEntity({
    entityId, workspaceId, longDomain, externalId, packet, prop,
    seedAddress, seedCity, seedState, opsQuery: _ops,
  });

  return {
    ok: true,
    entity_id: entityId,
    created: !!(link.createdEntity),
    identity_created: !!(link.createdIdentity),
    enriched: enriched.enriched,
    enrich_detail: enriched.detail || null,
  };
}

// Fill-blanks scalar backfill + metadata population. Reads the CURRENT entity
// row so we never clobber a curated scalar, and merges the deal-fact arrays
// into metadata.
async function enrichAssetEntity({
  entityId, workspaceId, longDomain, externalId, packet, prop,
  seedAddress, seedCity, seedState, opsQuery: _ops,
}) {
  const cur = await _ops('GET',
    `entities?id=eq.${encodeURIComponent(entityId)}&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&select=name,address,city,state,zip,county,latitude,longitude,asset_type,metadata&limit=1`);
  if (!cur.ok || !cur.data?.length) return { enriched: false, detail: 'entity_read_failed' };
  const e = cur.data[0];

  const patch = {};
  // Correct a STUB name (== city, or blank) to the street address. This is the
  // one case where we overwrite: a name that equals the city is a known stub,
  // not curated data.
  const nameIsStub = !e.name || (seedCity && e.name === seedCity && seedAddress && seedAddress !== seedCity);
  if (nameIsStub && seedAddress) patch.name = seedAddress;

  // A city-as-address is the same stub shape as a city-as-name (the hollow-bridge
  // bug): correct it to the real street address. Otherwise fill-blanks only.
  const addressIsStub = seedCity && e.address === seedCity && seedAddress && seedAddress !== seedCity;
  if (!firstNonBlank(e.address) && seedAddress) patch.address = seedAddress;
  else if (addressIsStub && seedAddress) patch.address = seedAddress;
  if (!firstNonBlank(e.city) && seedCity) patch.city = seedCity;
  if (!firstNonBlank(e.state) && seedState) patch.state = seedState;
  if (!firstNonBlank(e.zip) && prop) { const z = firstNonBlank(prop.zip_code, prop.zip); if (z) patch.zip = z; }
  if (!firstNonBlank(e.county) && prop) { const c = firstNonBlank(prop.county); if (c) patch.county = c; }
  if (e.latitude == null && prop && prop.latitude != null) patch.latitude = prop.latitude;
  if (e.longitude == null && prop && prop.longitude != null) patch.longitude = prop.longitude;
  if (!firstNonBlank(e.asset_type) && prop) { const t = firstNonBlank(prop.property_type, prop.asset_type); if (t) patch.asset_type = t; }

  // Metadata: merge the deal-fact arrays. Fill only when the entity doesn't
  // already carry a non-empty array (a richer capture source wins).
  const meta = e.metadata && typeof e.metadata === 'object' ? { ...e.metadata } : {};
  const tenants = buildTenants(packet.leases);
  const salesHistory = buildSalesHistory(packet.sales);
  const contacts = buildContacts(packet.contacts);
  const loans = Array.isArray(packet.loans) ? packet.loans : [];

  let metaChanged = false;
  function setArr(key, arr) {
    const existing = Array.isArray(meta[key]) ? meta[key] : [];
    if (existing.length === 0 && arr.length > 0) { meta[key] = arr; metaChanged = true; }
  }
  setArr('tenants', tenants);
  setArr('sales_history', salesHistory);
  setArr('contacts', contacts);
  setArr('loans', loans);
  if (meta.domain_property_id == null) {
    meta.domain_property_id = Number.isNaN(Number(externalId)) ? externalId : Number(externalId);
    metaChanged = true;
  }
  if (!meta.source) { meta.source = longDomain === 'dialysis' ? 'dia_domain' : 'gov_domain'; metaChanged = true; }
  if (tenants[0]?.name && !meta.tenant_name) { meta.tenant_name = tenants[0].name; metaChanged = true; }

  if (metaChanged) patch.metadata = meta;
  if (Object.keys(patch).length === 0) return { enriched: false, detail: 'already_enriched' };

  const upd = await _ops('PATCH',
    `entities?id=eq.${encodeURIComponent(entityId)}&workspace_id=eq.${pgFilterVal(workspaceId)}`,
    patch);
  return { enriched: !!(upd && upd.ok), detail: { fields: Object.keys(patch) } };
}

// ============================================================================
// Post-close hook — reconcile closed Northmarq deals into asset entities.
//
// A closed sale lands in the domain DB (dia/gov) via the Salesforce internal-comp
// export sync (Python pipeline), NOT an LCC JS ingestion point, so the hook is a
// reusable SWEEP: for every recent is_northmarq sale whose property has no
// resolvable asset entity, ensure one. Idempotent + value-gated (northmarq-only)
// so it satisfies the Consumption-Layer contract (named consumer + auto-resolve).
// Intended caller: a pg_cron route (e.g. the queue/decision refresh sweep) or an
// on-demand admin route. Reads sales via domainQuery; ensures via
// ensureAssetEntityForProperty.
//
// @returns {Promise<{ok:boolean, scanned:number, ensured:number, results:Array}>}
// ============================================================================
export async function reconcileClosedDealAssetEntities({
  domain,
  sinceDays = 90,
  limit = 50,
  dryRun = false,
  deps = {},
} = {}) {
  const longDomain = domainLongForm(domain);
  if (!longDomain) return { ok: false, skipped: 'unsupported_domain', scanned: 0, ensured: 0, results: [] };
  const dq = deps.domainQuery || domainQuery;
  const _ops = deps.opsQuery || opsQuery;
  const sourceSystem = canonicalIdentitySystem(longDomain);

  // Recent northmarq closes. sale_date filter keeps the sweep bounded.
  const sinceIso = deps.sinceIso || null; // tests inject a fixed date (no Date.now in scripts)
  const dateClause = sinceIso ? `&sale_date=gte.${encodeURIComponent(sinceIso)}` : '';
  let sales = [];
  try {
    const r = await dq(longDomain, 'GET',
      `sales_transactions?is_northmarq=eq.true&transaction_state=eq.live` +
      `${dateClause}&order=sale_date.desc&limit=${Math.max(1, Math.min(500, limit))}` +
      `&select=sale_id,property_id,sale_date,sold_price,is_northmarq`);
    if (r && r.ok && Array.isArray(r.data)) sales = r.data;
  } catch { sales = []; }

  const results = [];
  let ensured = 0;
  const seenProps = new Set();
  for (const s of sales) {
    const pid = s.property_id;
    if (pid == null || seenProps.has(String(pid))) continue;
    seenProps.add(String(pid));

    // Skip when a bridge already resolves (fast path — no domain read).
    const has = await _ops('GET',
      `external_identities?source_system=eq.${pgFilterVal(sourceSystem)}` +
      `&source_type=eq.asset&external_id=eq.${pgFilterVal(String(pid))}&select=entity_id&limit=1`)
      .catch(() => ({ ok: false }));
    const alreadyLinked = has.ok && Array.isArray(has.data) && has.data.length > 0;
    if (alreadyLinked && !deps.forceEnrich) {
      results.push({ property_id: pid, sale_id: s.sale_id, outcome: 'already_linked' });
      continue;
    }
    if (dryRun) {
      results.push({ property_id: pid, sale_id: s.sale_id, outcome: alreadyLinked ? 'would_enrich' : 'would_create' });
      continue;
    }
    const ens = await ensureAssetEntityForProperty({
      domain: longDomain, propertyId: pid, deps: { ...deps, bridgeSource: 'post_close_reconcile' },
    });
    if (ens.ok) ensured += 1;
    results.push({ property_id: pid, sale_id: s.sale_id, outcome: ens.ok ? (ens.created ? 'created' : 'enriched') : 'failed', detail: ens.skipped || null });
  }

  return { ok: true, domain: longDomain, scanned: sales.length, ensured, dry_run: dryRun, results };
}

export const __test__ = {
  domainLongForm, buildTenants, buildSalesHistory, buildContacts, firstNonBlank,
};
