// ============================================================================
// Entities API — Canonical business entities (person, org, asset)
// Life Command Center — Phase 2
//
// GET    /api/entities                        — list/search entities
// GET    /api/entities?id=<uuid>              — get entity with external identities
// POST   /api/entities                        — create entity
// PATCH  /api/entities?id=<uuid>              — update entity
// POST   /api/entities?action=link            — link external identity to entity
// GET    /api/entities?action=search&q=       — search by name across types
// GET    /api/entities?action=lookup_asset&address=&city=&state= — find asset entity by address
// GET    /api/entities?action=duplicates      — find duplicate candidates
// POST   /api/entities?action=merge           — merge two entities (manager+)
// POST   /api/entities?action=add_alias       — add alias for entity
// GET    /api/entities?action=quality         — data quality dashboard
// POST   /api/entities?action=process_sidebar_extraction — unpack CRE sidebar metadata
// ============================================================================

import { authenticate, requireRole, handleCors } from '../_shared/auth.js';
import { opsQuery, paginationParams, requireOps, withErrorHandler, fetchWithTimeout, pgFilterVal } from '../_shared/ops-db.js';
import { resolveArtifactDownload, uploadDocToFolder } from '../_shared/storage-adapter.js';
import { assemblePropertyPacket } from '../operations.js';
import { generateDossier, recordDossier } from '../_shared/dossier-generator.js';
import { projectRentAtDate } from '../_shared/rent-projection.js';
import { ensureAssetEntityForProperty } from '../_shared/asset-entity.js';
import { ENTITY_TYPES, DOMAINS, isValidEnum } from '../_shared/lifecycle.js';
import { normalizeAddress, stripListingStatusPrefix, canonicalIdentitySystem, CANONICAL_DOMAIN_SYSTEMS, canonicalDomainSourceType, canonicalEntityDomain } from '../_shared/entity-link.js';
import { writeListingCreatedSignal } from '../_shared/signals.js';
import { processSidebarExtraction, hasSidebarData } from './sidebar-pipeline.js';
import { domainQuery } from '../_shared/domain-db.js';
import { sanitizeListingUrl } from '../_shared/listing-url-filter.js';
import { enrichReviewQueueContext } from '../_shared/provenance-row-context.js';
import { computeRoe, mergeTimeline } from '../_shared/roe.js';
import { sf15, toSf18 } from '../_shared/sf-id.js';
import { loadOrCreateStaticMap, loadOrCreateNearbyNationalTenants } from '../_shared/location-trade-area.js';

function pageMeta(page, perPage, totalCount) {
  const totalPages = Math.ceil((totalCount || 0) / perPage);
  return {
    page,
    per_page: perPage,
    total: totalCount || 0,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1
  };
}

// Classify an ingested document into a BD-meaningful type from its file name +
// the ingest's file_type tag. Order of surfacing: om > bov > lease > psa_dd >
// comp > master > other.
function classifyDocType(fileName, fileType) {
  const n = String(fileName || '').toLowerCase();
  const t = String(fileType || '').toLowerCase();
  if (t === 'om' || /\bom\b|offering memorandum|marketing brochure|\bflyer\b|for sale/.test(n)) return 'om';
  if (t === 'bov' || /\bbov\b|opinion of value|valuation/.test(n)) return 'bov';
  if (t === 'lease' || /\blease\b|lease overview|abstract/.test(n)) return 'lease';
  if (t === 'dd' || /\bpsa\b|purchase.{0,6}sale|\bdd\b|due diligence|\bagreement\b|\bestoppel\b|\bsnda\b/.test(n)) return 'psa_dd';
  if (t === 'comp' || /\bcomp\b|comparable/.test(n)) return 'comp';
  if (t === 'master' || /master sheet|\bmaster\b/.test(n)) return 'master';
  return 'other';
}

function normalizeDocDate(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    return String(v);
  }
  return null;
}

function docNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toDocumentRow(row) {
  const name = row.file_name || row.title || row.name || 'Document';
  const type = row.doc_type || row.document_type || row.type || classifyDocType(name, row.file_type || row.extension);
  const source = row.source || row.storage_backend || row.backend || null;
  const date = normalizeDocDate(row.date, row.created_at, row.last_modified_at, row.system_modstamp, row.sf_last_modified);
  const reconciled = row.reconciled === true || row.reconciled_status === 'linked_to_record';
  return {
    ...row,
    file_name: name,
    name,
    doc_type: type,
    type,
    source,
    backend: row.backend || row.storage_backend || source,
    date,
    created_at: row.created_at || date,
    reconciled,
    reconciled_status: reconciled ? 'linked_to_record' : 'not_yet_reconciled',
  };
}

function dedupeDocuments(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const d = toDocumentRow(row);
    const k = [
      d.source || d.backend || '',
      d.storage_ref || d.storage_path || d.source_url || d.sf_file_id || d.id || '',
      docNameKey(d.file_name),
      d.doc_type || '',
    ].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function docSourcesSummary(docs) {
  const counts = {};
  for (const d of docs || []) {
    const k = d.source || d.backend || 'unknown';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

async function resolveEntityAssetLink(entityId, workspaceId) {
  const entRes = await opsQuery('GET',
    `entities?id=eq.${pgFilterVal(entityId)}&workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&select=id,name,address,city,state,zip,metadata&limit=1`);
  if (!entRes.ok || !entRes.data?.length) return { ok: false, status: 404, error: 'Entity not found' };
  const entity = entRes.data[0];

  const idRes = await opsQuery('GET',
    `external_identities?entity_id=eq.${pgFilterVal(entityId)}` +
    `&source_type=eq.asset&source_system=in.(dia,gov,dialysis,government,dia_db,dia_supabase,gov_db,gov_supabase)` +
    `&select=source_system,source_type,external_id,last_synced_at&limit=20`).catch(() => null);
  const identities = (idRes && idRes.ok && Array.isArray(idRes.data)) ? idRes.data : [];
  const link = resolveDomainLink(identities);
  const domain = link.domain;
  const propertyId = link.externalId;

  let property = null;
  if (domain && propertyId != null) {
    const pr = await domainQuery(domain, 'GET',
      `properties?property_id=eq.${pgFilterVal(propertyId)}` +
      `&select=property_id,address,city,state,zip_code,latitude,longitude,medicare_id,updated_at&limit=1`).catch(() => null);
    property = pr?.ok && Array.isArray(pr.data) ? (pr.data[0] || null) : null;
  }

  return { ok: true, entity, identities, domain, property_id: propertyId, property };
}

async function findMappedCreProperty(asset) {
  const address = asset.property?.address || asset.entity?.address || asset.entity?.name || null;
  const state = asset.property?.state || asset.entity?.state || null;
  const normalized = normalizeAddress(address);
  if (!normalized || !state) return null;
  const r = await opsQuery('GET',
    `lcc_cre_properties?normalized_address=eq.${pgFilterVal(normalized)}` +
    `&state=ilike.${pgFilterVal(state)}` +
    `&select=id,normalized_address,address,city,state,tenant_brand,source_path,metadata,updated_at&limit=5`).catch(() => null);
  if (!r?.ok || !Array.isArray(r.data) || !r.data.length) return null;
  const city = String(asset.property?.city || asset.entity?.city || '').toLowerCase();
  return r.data.find(p => city && String(p.city || '').toLowerCase() === city) || r.data[0];
}

async function fetchIntakeDocuments(entityId) {
  const prom = await opsQuery('GET',
    `staged_intake_promotions?entity_id=eq.${pgFilterVal(entityId)}&select=intake_id`).catch(() => null);
  const intakeIds = Array.from(new Set(((prom && prom.data) || []).map(r => r.intake_id).filter(Boolean)));
  if (!intakeIds.length) return [];
  const inList = intakeIds.map(pgFilterVal).join(',');
  const art = await opsQuery('GET',
    `staged_intake_artifacts?intake_id=in.(${inList})` +
    `&select=id,intake_id,file_name,file_type,mime_type,storage_backend,storage_ref,storage_path,created_at` +
    `&order=created_at.desc&limit=300`).catch(() => null);
  return ((art && art.data) || [])
    .map(a => {
      const ref = a.storage_ref || a.storage_path || null;
      const name = a.file_name || '';
      const ft = String(a.file_type || '').toLowerCase();
      const isDoc = /^(pdf|doc|docx|xlsx|xls)$/.test(ft) || /\.(pdf|docx?|xlsx?)$/i.test(name);
      if (!isDoc || !ref) return null;
      return toDocumentRow({
        id: a.id,
        intake_id: a.intake_id,
        file_name: name,
        doc_type: classifyDocType(name, ft),
        source: a.storage_backend || (ref && ref.startsWith('/') ? 'sharepoint_pa' : 'lcc-om-uploads'),
        backend: a.storage_backend || (ref && ref.startsWith('/') ? 'sharepoint_pa' : 'supabase'),
        storage_ref: ref,
        mime_type: a.mime_type || null,
        date: a.created_at,
        created_at: a.created_at,
        reconciled: true,
        source_history: [{ source: 'staged_intake_promotions', status: 'entity_id linked', date: a.created_at }],
      });
    })
    .filter(Boolean);
}

async function fetchCreDocuments(asset) {
  const cre = await findMappedCreProperty(asset);
  if (!cre?.id) return { cre_property: null, docs: [] };
  const r = await opsQuery('GET',
    `lcc_cre_property_documents?cre_property_id=eq.${pgFilterVal(cre.id)}` +
    `&select=id,cre_property_id,file_name,document_type,source_url,source,created_at` +
    `&order=created_at.desc&limit=300`).catch(() => null);
  const docs = ((r && r.ok && Array.isArray(r.data)) ? r.data : []).map(d => toDocumentRow({
    id: `cre:${d.id}`,
    cre_document_id: d.id,
    cre_property_id: d.cre_property_id,
    file_name: d.file_name,
    doc_type: d.document_type || classifyDocType(d.file_name, null),
    source: d.source || 'folder_feed_cre',
    backend: 'lcc_cre_property_documents',
    source_url: d.source_url || null,
    storage_ref: d.source_url || null,
    date: d.created_at,
    created_at: d.created_at,
    reconciled: true,
    source_history: [
      { source: 'lcc_cre_properties', status: `matched cre_property_id ${cre.id} by normalized address/state`, date: cre.updated_at || null },
      { source: 'lcc_cre_property_documents', status: 'linked to CRE property record', date: d.created_at },
    ],
  }));
  return { cre_property: cre, docs };
}

async function fetchSfFilesForProperty(domain, propertyId) {
  if (!domain || propertyId == null) return [];
  const pid = pgFilterVal(propertyId);

  const selectCols = 'file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,sf_comp_id,sf_listing_id,sf_deal_id,title,file_name,extension,source_system,ingestion_status,extraction_status,storage_path,process_notes,created_at';
  const fallbackSelectCols = 'file_id,content_document_id,content_version_id,linked_entity_type,linked_entity_sf_id,sf_comp_id,sf_listing_id,sf_deal_id,title,file_name,extension,source_system,ingestion_status,extraction_status,storage_path,process_notes';
  let direct = await domainQuery(domain, 'GET',
    `sf_files?linked_property_id=eq.${pid}` +
    `&select=${selectCols},linked_property_id&order=created_at.desc&limit=300`).catch(() => null);
  if (!direct?.ok) {
    direct = await domainQuery(domain, 'GET',
      `sf_files?linked_property_id=eq.${pid}` +
      `&select=${fallbackSelectCols},linked_property_id&limit=300`).catch(() => null);
  }
  if (direct?.ok && Array.isArray(direct.data) && direct.data.length) {
    return direct.data.map(f => toSfDocumentRow({ domain, propertyId, file: f, linkSource: 'sf_files.linked_property_id' }));
  }

  const [compRes, listingRes, dealRes] = await Promise.all([
    domainQuery(domain, 'GET', `sf_comp_staging?linked_property_id=eq.${pid}&select=sf_comp_id,sf_listing_id,sf_deal_id&limit=1000`).catch(() => null),
    domainQuery(domain, 'GET', `sf_listing_staging?linked_property_id=eq.${pid}&select=sf_listing_id,sf_deal_id&limit=1000`).catch(() => null),
    domainQuery(domain, 'GET', `sf_deal_staging?linked_property_id=eq.${pid}&select=sf_deal_id&limit=1000`).catch(() => null),
  ]);
  const compIds = new Set();
  const listingIds = new Set();
  const dealIds = new Set();
  for (const row of compRes?.ok && Array.isArray(compRes.data) ? compRes.data : []) {
    if (row.sf_comp_id) compIds.add(row.sf_comp_id);
    if (row.sf_listing_id) listingIds.add(row.sf_listing_id);
    if (row.sf_deal_id) dealIds.add(row.sf_deal_id);
  }
  for (const row of listingRes?.ok && Array.isArray(listingRes.data) ? listingRes.data : []) {
    if (row.sf_listing_id) listingIds.add(row.sf_listing_id);
    if (row.sf_deal_id) dealIds.add(row.sf_deal_id);
  }
  for (const row of dealRes?.ok && Array.isArray(dealRes.data) ? dealRes.data : []) {
    if (row.sf_deal_id) dealIds.add(row.sf_deal_id);
  }

  const orParts = [];
  if (compIds.size) orParts.push(`sf_comp_id.in.(${Array.from(compIds).map(pgFilterVal).join(',')})`);
  if (listingIds.size) orParts.push(`sf_listing_id.in.(${Array.from(listingIds).map(pgFilterVal).join(',')})`);
  if (dealIds.size) orParts.push(`sf_deal_id.in.(${Array.from(dealIds).map(pgFilterVal).join(',')})`);
  if (!orParts.length) return [];

  let r = await domainQuery(domain, 'GET',
    `sf_files?or=(${orParts.join(',')})` +
    `&select=${selectCols}` +
    `&order=created_at.desc&limit=300`).catch(() => null);
  if (!r?.ok) {
    r = await domainQuery(domain, 'GET',
      `sf_files?or=(${orParts.join(',')})` +
      `&select=${fallbackSelectCols}` +
      `&limit=300`).catch(() => null);
  }
  const rows = r?.ok && Array.isArray(r.data) ? r.data : [];
  return rows.map(f => toSfDocumentRow({ domain, propertyId, file: f, linkSource: 'sf_*_staging.linked_property_id' }));
}

function toSfDocumentRow({ domain, propertyId, file: f, linkSource }) {
  return toDocumentRow({
    id: `sf:${domain}:${f.file_id}`,
    sf_file_id: f.file_id,
    content_document_id: f.content_document_id || null,
    content_version_id: f.content_version_id || null,
    file_name: f.file_name || f.title || (f.title && f.extension ? `${f.title}.${f.extension}` : null),
    doc_type: classifyDocType(f.file_name || f.title, f.extension),
    source: 'salesforce_files',
    backend: 'salesforce-files',
    storage_ref: f.storage_path || null,
    storage_path: f.storage_path || null,
    linked_entity_type: f.linked_entity_type || null,
    linked_entity_sf_id: f.linked_entity_sf_id || null,
    sf_comp_id: f.sf_comp_id || null,
    sf_listing_id: f.sf_listing_id || null,
    sf_deal_id: f.sf_deal_id || null,
    ingestion_status: f.ingestion_status || null,
    extraction_status: f.extraction_status || null,
    process_notes: f.process_notes || null,
    date: f.created_at || f.system_modstamp || null,
    reconciled: true,
    source_history: [
      { source: 'intake-salesforce-files', status: f.ingestion_status || 'discovered', date: f.created_at || null },
      { source: linkSource, status: `linked to ${domain} property ${propertyId}`, date: null },
    ],
  });
}

export async function fetchEntityDocuments(entityId, workspaceId) {
  const asset = await resolveEntityAssetLink(entityId, workspaceId);
  if (!asset.ok) return asset;
  const [intakeDocs, creResult, sfDocs] = await Promise.all([
    fetchIntakeDocuments(entityId),
    fetchCreDocuments(asset),
    fetchSfFilesForProperty(asset.domain, asset.property_id),
  ]);
  const docs = dedupeDocuments([
    ...intakeDocs,
    ...(creResult.docs || []),
    ...sfDocs,
  ]);
  const groups = {};
  for (const d of docs) (groups[d.doc_type] = groups[d.doc_type] || []).push(d);
  return {
    ok: true,
    entity_id: entityId,
    domain: asset.domain,
    property_id: asset.property_id,
    cre_property_id: creResult.cre_property?.id || null,
    count: docs.length,
    docs,
    documents: docs,
    groups,
    sources: docSourcesSummary(docs),
    source_status: {
      intake_artifacts: {
        count: intakeDocs.length,
        reconciled_status: intakeDocs.length ? 'linked_to_record' : 'not_yet_reconciled',
      },
      cre_property_documents: {
        count: creResult.docs?.length || 0,
        cre_property_id: creResult.cre_property?.id || null,
        reconciled_status: creResult.docs?.length ? 'linked_to_record' : 'not_yet_reconciled',
      },
      salesforce_files: {
        count: sfDocs.length,
        reconciled_status: sfDocs.length ? 'linked_to_record' : 'not_yet_reconciled',
      },
    },
  };
}

// ============================================================================
// DOSSIER PACKET ASSEMBLERS (grounded, reconciled — see
// docs/architecture/dossier-standard-and-llm-contract.md §2). Every leaf value
// is a TAG {v, source, as_of?, confidence?} or is OMITTED (renders "Not on
// file"). We never fabricate: a field the source doesn't state stays absent.
// ============================================================================

const _diaSystems = ['dia', 'dia_db', 'dia_supabase', 'dialysis'];
const _govSystems = ['gov', 'gov_db', 'gov_supabase', 'government'];

function tag(v, source, extra = {}) {
  if (v == null || v === '') return undefined;
  return { v, ...(source ? { source } : {}), ...extra };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function moneyInput(v) {
  const n = num(v);
  return n == null ? 'null' : '$' + Math.round(n).toLocaleString('en-US');
}

function pctInput(v) {
  const n = num(v);
  if (n == null) return 'null';
  return (n * 100).toFixed(n * 100 >= 10 ? 0 : 2).replace(/\.?0+$/, '') + '%';
}

function roundMoney(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

function rentPsfTag(rent, buildingSf, label) {
  const r = num(rent);
  const sf = num(buildingSf);
  if (r == null || !(sf > 0)) return undefined;
  return { v: Math.round((r / sf) * 100) / 100, derived: `${label} ${moneyInput(r)} ÷ building ${sf.toLocaleString('en-US')} SF` };
}

function capTag(...vals) {
  for (const v of vals) {
    const n = num(v);
    if (n == null) continue;
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return { v: Math.round(pct * 100) / 100, source: 'source table' };
  }
  return undefined;
}

function milesTag(v, source, extra = {}) {
  const n = num(v);
  return n == null ? undefined : { v: Math.round(n * 10) / 10, source, ...extra };
}

function dateTag(v, source, extra = {}) {
  return v ? tag(String(v).slice(0, 10), source, extra) : undefined;
}

function listingDate(row) {
  return row?.on_market_date || row?.listing_date || row?.created_at || null;
}

function listingStatus(row) {
  return String(row?.listing_status || row?.status || (row?.is_active ? 'active' : '') || '').toLowerCase();
}

function isActiveListing(row) {
  const s = listingStatus(row);
  return row?.is_active === true || ['active', 'available', 'for sale', 'for_sale'].includes(s);
}

function isPortfolioListing(row) {
  const explicit = row?.is_portfolio_listing ?? row?.portfolio_listing ?? row?.is_portfolio ?? null;
  if (explicit === true) return true;
  const hay = [
    row?.listing_type,
    row?.deal_type,
    row?.marketing_type,
    row?.portfolio_name,
    row?.portfolio_id,
    row?.notes,
    row?.source_notes,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\bportfolio\b/.test(hay);
}

function daysBetween(startDate, endDate) {
  if (!startDate) return null;
  const s = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const e = new Date(`${String(endDate || new Date().toISOString().slice(0, 10)).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)));
}

function listingAsk(row) {
  return num(row?.asking_price ?? row?.initial_price ?? row?.ask_price ?? row?.last_price ?? row?.price);
}

function listingPricePerSf(row, buildingSf, ask) {
  const stored = num(row?.asking_price_psf ?? row?.price_per_sf ?? row?.last_price_psf);
  if (stored != null) return tag(stored, 'available_listings');
  const sf = num(buildingSf);
  if (ask != null && sf > 0) {
    return { v: Math.round((ask / sf) * 100) / 100, derived: `asking ${moneyInput(ask)} ÷ building ${sf.toLocaleString('en-US')} SF` };
  }
  return undefined;
}

function buildTransactionMarketingTimeline({ sales = [], listings = [], buildingSf, asOfDate }) {
  const events = [];

  for (const l of listings || []) {
    if (!l) continue;
    if (l.exclude_from_market_metrics === true) continue;
    const status = listingStatus(l);
    if (status === 'superseded') continue;
    const active = isActiveListing(l);
    const ask = listingAsk(l);
    const marketDate = listingDate(l);
    const psf = listingPricePerSf(l, buildingSf, ask);
    const impliedSingleAssetAsk = psf?.v != null && buildingSf ? Number(psf.v) * Number(buildingSf) : null;
    const isPortfolio = isPortfolioListing(l) || (ask != null && impliedSingleAssetAsk != null && ask > impliedSingleAssetAsk * 2);
    const broker = [
      l.listing_firm || l.broker_firm || l.listing_broker_firm || null,
      l.listing_broker || l.listing_broker_name || l.broker_name || l.broker || null,
    ].filter(Boolean).join(' · ') || null;
    events.push({
      kind: 'listing',
      date: marketDate,
      status: active ? 'active' : (status || 'off-market'),
      event: active ? 'Listed for sale' : 'Prior listing',
      broker: tag(broker, 'available_listings'),
      asking_price: tag(ask, 'available_listings'),
      price_per_sf: psf,
      cap_rate: capTag(l.asking_cap_rate, l.current_cap_rate, l.cap_rate),
      days_on_market: active
        ? { v: daysBetween(marketDate, asOfDate), derived: `from ${String(marketDate || 'Not on file').slice(0, 10)} to ${asOfDate}` }
        : undefined,
      portfolio_flag: { v: isPortfolio ? 'Portfolio listing' : 'Single-asset listing', source: 'available_listings' },
      portfolio_note: isPortfolio && ask != null && psf?.v != null && buildingSf
        ? { v: `Portfolio ask; do not present ${moneyInput(ask)} as this property's asking.`, derived: `${moneyInput(psf.v)} per SF × ${Number(buildingSf).toLocaleString('en-US')} SF = ${moneyInput(Number(psf.v) * Number(buildingSf))} implied for this asset` }
        : (isPortfolio ? { v: `Portfolio ask; do not present ${moneyInput(ask)} as this property's asking.`, source: 'available_listings' } : undefined),
      source: 'available_listings',
      sort_date: marketDate || l.created_at || '',
    });
  }

  for (const s of sales || []) {
    if (!s) continue;
    const state = String(s.transaction_state || '').toLowerCase();
    if (state && state !== 'live') continue;
    events.push({
      kind: 'sale',
      date: s.sale_date,
      status: state || 'live',
      event: 'Sale',
      party: tag([s.seller_name || s.seller || null, s.buyer_name || s.buyer || null].filter(Boolean).join(' -> '), 'sales_transactions'),
      price: tag(num(s.sold_price ?? s.price ?? s.sale_price), 'sales_transactions'),
      stated_cap_rate: capTag(s.stated_cap_rate, s.sold_cap_rate),
      calculated_cap_rate: capTag(s.calculated_cap_rate, s.cap_rate_final, s.cap_rate),
      firm_term_years_at_sale: tag(num(s.firm_term_years_at_sale ?? s.firm_term_years), 'sales_transactions'),
      source: s.data_source || 'sales_transactions',
      sort_date: s.sale_date || '',
    });
  }

  return events.sort((a, b) => String(a.sort_date || '').localeCompare(String(b.sort_date || '')));
}

function pickCurrentScheduleRow(rows, asOfDate) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  if (Number.isNaN(asOf.getTime())) return null;
  const sorted = rows.slice().sort((a, b) => String(a.period_start || '').localeCompare(String(b.period_start || '')));
  const inPeriod = sorted.find(r => {
    const s = r.period_start ? new Date(`${String(r.period_start).slice(0, 10)}T00:00:00Z`) : null;
    const e = r.period_end ? new Date(`${String(r.period_end).slice(0, 10)}T00:00:00Z`) : null;
    return s && !Number.isNaN(s.getTime()) && s <= asOf && (!e || Number.isNaN(e.getTime()) || asOf <= e);
  });
  if (inPeriod) return inPeriod;
  let prior = null;
  for (const r of sorted) {
    const s = r.period_start ? new Date(`${String(r.period_start).slice(0, 10)}T00:00:00Z`) : null;
    if (s && !Number.isNaN(s.getTime()) && s <= asOf) prior = r;
  }
  return prior || sorted[0] || null;
}

function deriveCurrentRent({ lease, prop, scheduleRows, buildingSf, asOfDate }) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const scheduleRow = pickCurrentScheduleRow(scheduleRows, asOf);
  if (scheduleRow) {
    const rent = roundMoney(scheduleRow.base_rent ?? scheduleRow.annual_rent ?? scheduleRow.rent_amount);
    if (rent != null) {
      return {
        rent: { v: rent, derived: `lease_rent_schedule ${scheduleRow.period_start || `year ${scheduleRow.lease_year || '?'}`} as of ${asOf}` },
        psf: rentPsfTag(rent, buildingSf, 'current scheduled rent'),
      };
    }
  }

  const anchorRent = num((prop && prop.anchor_rent) ?? (lease && (lease.annual_rent ?? lease.rent)));
  const anchorDate = (prop && prop.anchor_rent_date) || (lease && lease.lease_start) || (prop && prop.lease_commencement);
  const leaseStart = (lease && lease.lease_start) || (prop && prop.lease_commencement) || anchorDate;
  const bumpPct = num((prop && prop.lease_bump_pct) ?? (lease && lease.lease_bump_pct));
  const bumpInterval = num((prop && prop.lease_bump_interval_mo) ?? (lease && lease.lease_bump_interval_mo));
  if (anchorRent == null || !anchorDate || bumpPct == null || !(bumpInterval > 0)) return null;

  try {
    const projected = projectRentAtDate({
      anchorRent,
      anchorDate,
      targetDate: asOf,
      bumpPct,
      bumpIntervalMonths: bumpInterval,
      leaseCommencement: leaseStart,
    });
    const rent = roundMoney(projected.projected_rent);
    const bumps = projected.bumps_applied;
    const intervalYears = Math.round((bumpInterval / 12) * 10) / 10;
    const derived = `anchor rent ${moneyInput(anchorRent)} as of ${String(anchorDate).slice(0, 10)} × (1 + ${pctInput(bumpPct)})^${bumps}; ${bumpInterval} mo (${intervalYears} yr) interval; as-of ${asOf}`;
    return {
      rent: { v: rent, derived },
      psf: rentPsfTag(rent, buildingSf, 'current rent'),
    };
  } catch {
    return null;
  }
}

function optionBumpsContinueTag(lease) {
  const text = String(
    (lease && (lease.option_bumps_continue_text || lease.option_rent_escalations || lease.renewal_option_text || lease.renewal_options)) || ''
  ).trim();
  if (!text) return undefined;
  if (/\b(same|continue|continuing)\b.{0,80}\b(escalation|increase|rent bump|bump)\b/i.test(text) ||
      /\b(escalation|increase|rent bump|bump)\b.{0,80}\b(same|continue|continuing)\b/i.test(text)) {
    return { v: 'Yes', source: 'lease renewal terms', confidence: text.slice(0, 180) };
  }
  if (/\b(fmv|fair market|market rent|then market|negotiated)\b/i.test(text)) {
    return { v: 'No / reset to market', source: 'lease renewal terms', confidence: text.slice(0, 180) };
  }
  return undefined;
}

// Resolve the linked domain (dia/gov) + external property id from an entity's
// identities. Returns { domain, externalId } or nulls.
function resolveDomainLink(identities) {
  const gov = (identities || []).find(i => _govSystems.includes(i.source_system) && i.source_type === 'asset');
  const dia = (identities || []).find(i => _diaSystems.includes(i.source_system) && i.source_type === 'asset');
  if (gov?.external_id) return { domain: 'gov', externalId: gov.external_id };
  if (dia?.external_id) return { domain: 'dia', externalId: dia.external_id };
  // Fall back to any domain identity (some assets carry source_type='property').
  const anyGov = (identities || []).find(i => _govSystems.includes(i.source_system) && i.external_id);
  const anyDia = (identities || []).find(i => _diaSystems.includes(i.source_system) && i.external_id);
  if (anyGov) return { domain: 'gov', externalId: anyGov.external_id };
  if (anyDia) return { domain: 'dia', externalId: anyDia.external_id };
  return { domain: null, externalId: null };
}

/**
 * Assemble the reconciled PROPERTY packet for an asset entity. Reuses
 * assemblePropertyPacket for entity/domain resolution + owner names, then
 * augments with the live lease, CMS operations, and demographics readers.
 */
export async function buildPropertyPacket(entityId, workspaceId) {
  const base = await assemblePropertyPacket(entityId, workspaceId);
  const bp = base.payload || {};
  const prop = bp.lease_data || {}; // NOTE: assemblePropertyPacket names the properties row "lease_data".
  const { domain, externalId } = resolveDomainLink(bp.external_identities);
  const pid = externalId != null ? encodeURIComponent(externalId) : null;
  const domainLabel = domain === 'gov' ? 'Government' : (domain === 'dia' ? 'Dialysis' : 'CRE');

  // Live lease (superseded_at NULL), primary CMS clinic, patient-count series,
  // demographics, ZIP census, payer mix — each degrades independently.
  let lease = null, clinic = null, fpc = [], demos = [], zcta = null, payer = null, leaseScheduleRows = [];
  let sales = [], listings = [];
  let loans = [];
  let relocationLineage = null, marketCompetition = [];
  let staticMap = null, nearbyNationalTenants = [];
  if (domain && pid) {
    const calls = [
      domainQuery(domain, 'GET', `leases?property_id=eq.${pid}&superseded_at=is.null&order=is_active.desc.nullslast,lease_start.desc&limit=1`).catch(() => null),
      domainQuery(domain, 'GET', `sales_transactions?property_id=eq.${pid}&transaction_state=eq.live&order=sale_date.desc&limit=8`).catch(() => null),
      domainQuery(domain, 'GET', `available_listings?property_id=eq.${pid}&order=listing_date.desc.nullslast&limit=50`).catch(() => null),
      domainQuery(domain, 'GET',
        `loans?property_id=eq.${pid}` +
        `&select=${domain === 'gov'
          ? 'loan_id,originator,loan_amount,interest_rate,term_years,origination_date,maturity_date,ltv,loan_type,status,cmbs_deal_name,servicer,special_servicer,notes,data_source'
          : 'loan_id,lender_name,originator,loan_amount,current_balance,interest_rate_percent,loan_term,origination_date,maturity_date,loan_to_value,loan_type,is_active,cmbs_deal_name,servicer,special_servicer,notes,data_source'}` +
        `&order=maturity_date.desc.nullslast,origination_date.desc.nullslast&limit=8`).catch(() => null),
    ];
    if (domain === 'dia') {
      calls.push(
        domainQuery(domain, 'GET', `medicare_clinics?property_id=eq.${pid}&order=is_primary_ccn.desc.nullslast&limit=1`).catch(() => null),
        domainQuery(domain, 'GET', `facility_patient_counts?property_id=eq.${pid}&order=snapshot_date.desc&limit=6`).catch(() => null),
        domainQuery(domain, 'GET', `property_demographics?property_id=eq.${pid}&order=radius_miles.asc&limit=5`).catch(() => null),
      );
    }
    const r = await Promise.all(calls);
    lease = r[0]?.ok ? (r[0].data?.[0] || null) : null;
    sales = r[1]?.ok ? (r[1].data || []) : [];
    listings = r[2]?.ok ? (r[2].data || []) : [];
    loans = r[3]?.ok ? (r[3].data || []) : [];
    if (domain === 'dia') {
      clinic = r[4]?.ok ? (r[4].data?.[0] || null) : null;
      fpc = r[5]?.ok ? (r[5].data || []) : [];
      demos = r[6]?.ok ? (r[6].data || []) : [];
    }
    if (lease?.lease_id) {
      const sched = await domainQuery(domain, 'GET',
        `lease_rent_schedule?lease_id=eq.${encodeURIComponent(lease.lease_id)}` +
        `&order=lease_year.asc&limit=100`).catch(() => null);
      leaseScheduleRows = sched?.ok && Array.isArray(sched.data) ? sched.data : [];
    }
  }

  // ZIP census + payer mix (dia) — cheap follow-ups keyed off the property/clinic.
  if (domain === 'dia') {
    const zip = prop.zip_code || null;
    const ccn = prop.medicare_id || (clinic && clinic.medicare_id) || null;
    const follow = await Promise.all([
      zip ? domainQuery(domain, 'GET', `census_zcta_demographics?zip_code=eq.${encodeURIComponent(zip)}&limit=1`).catch(() => null) : Promise.resolve(null),
      ccn ? domainQuery(domain, 'GET', `v_payer_mix_geo_averages?medicare_id=eq.${encodeURIComponent(ccn)}&limit=1`).catch(() => null) : Promise.resolve(null),
    ]);
    zcta = follow[0]?.ok ? (follow[0].data?.[0] || null) : null;
    payer = follow[1]?.ok ? (follow[1].data?.[0] || null) : null;

    const lat = num(prop.latitude);
    const lng = num(prop.longitude);
    const lineageAndCompetition = await Promise.all([
      ccn ? domainQuery(domain, 'GET',
        `v_clinic_relocation_lineage?medicare_id=eq.${encodeURIComponent(ccn)}&limit=1`).catch(() => null)
        : Promise.resolve(null),
      (lat != null && lng != null) ? domainQuery(domain, 'POST',
        'rpc/dia_nearby_dialysis_competition',
        {
          p_latitude: lat,
          p_longitude: lng,
          p_radius_miles: 5,
          p_limit: 15,
          p_exclude_medicare_id: ccn,
        }).catch(() => null)
        : Promise.resolve(null),
    ]);
    relocationLineage = lineageAndCompetition[0]?.ok ? (lineageAndCompetition[0].data?.[0] || null) : null;
    marketCompetition = lineageAndCompetition[1]?.ok && Array.isArray(lineageAndCompetition[1].data)
      ? lineageAndCompetition[1].data
      : [];

    if (lat != null && lng != null && externalId != null) {
      const locationAssets = await Promise.all([
        loadOrCreateStaticMap({
          domain,
          propertyId: externalId,
          lat,
          lng,
          address: [prop.address, prop.city, prop.state, prop.zip_code].filter(Boolean).join(', '),
        }).catch(() => null),
        loadOrCreateNearbyNationalTenants({
          domain,
          propertyId: externalId,
          lat,
          lng,
        }).catch(() => []),
      ]);
      staticMap = locationAssets[0] || null;
      nearbyNationalTenants = Array.isArray(locationAssets[1]) ? locationAssets[1] : [];
    }
  }

  // --- Ownership reconciliation: owner is NEVER the operator (§1.6) ------------
  const recordedName = bp.ownership?.recorded_owner_name || prop.recorded_owner_name || null;
  const trueName = bp.ownership?.true_owner_name || prop.true_owner_name || null;
  let trueIsOperator = false;
  if (prop.true_owner_id != null && domain) {
    const to = await domainQuery(domain, 'GET',
      `true_owners?true_owner_id=eq.${encodeURIComponent(prop.true_owner_id)}&select=is_operator_not_owner&limit=1`).catch(() => null);
    trueIsOperator = !!(to?.ok && to.data?.[0]?.is_operator_not_owner);
  }
  const ownerOfRecord = (trueName && !trueIsOperator) ? trueName : recordedName;
  const operatorName = prop.operator || (lease && lease.operator) || (trueIsOperator ? trueName : null) || prop.tenant;

  // --- Snapshot / identity ----------------------------------------------------
  const buildingSf = num(prop.building_size);
  const valueEst = num(prop.current_value_estimate);
  const identity = {
    property_type: tag(prop.property_type, 'properties'),
    building_sf: tag(buildingSf, 'properties'),
    land_acres: tag(num(prop.land_area), 'properties'),
    year_built: tag(prop.year_built, 'properties'),
    ownership_type: tag(prop.property_ownership_type, 'properties'),
    ownership: tag(prop.property_ownership_type, 'properties'),
  };
  if (clinic && clinic.stations != null) {
    identity.stations = tag(num(clinic.stations), 'CMS (medicare_clinics)',
      clinic.max_patient_capacity ? { confidence: `max capacity ${clinic.max_patient_capacity}` } : {});
  }
  if (valueEst != null && buildingSf) {
    identity.price_per_sf = { v: Math.round(valueEst / buildingSf), derived: `value ${valueEst} ÷ building ${buildingSf} SF` };
  }

  // --- Tenancy & lease --------------------------------------------------------
  const annualRent = lease ? num(lease.annual_rent != null ? lease.annual_rent : lease.rent) : num(prop.anchor_rent);
  const year1RentPsf = (lease && lease.rent_per_sf != null)
    ? tag(num(lease.rent_per_sf), 'leases')
    : rentPsfTag(annualRent, buildingSf, 'year-1 rent');
  const currentRent = deriveCurrentRent({
    lease,
    prop,
    scheduleRows: leaseScheduleRows,
    buildingSf,
    asOfDate: new Date().toISOString().slice(0, 10),
  });
  const tenancy_lease = {
    tenant: tag((lease && lease.tenant) || prop.tenant, lease ? 'leases' : 'properties'),
    guarantor: tag(lease && lease.guarantor, 'leases'),
    guaranty_scope: tag(lease && lease.guaranty_scope, 'leases'),
    annual_base_rent: tag(annualRent, lease ? 'lease (documented)' : 'properties',
      lease && lease.lease_start ? { as_of: lease.lease_start } : {}),
    year1_rent_psf: year1RentPsf,
    current_base_rent: currentRent?.rent,
    current_rent_psf: currentRent?.psf,
    lease_start: tag(lease && lease.lease_start, 'leases'),
    lease_expiration: tag(lease && lease.lease_expiration, 'leases'),
    expense_structure: tag(lease && (lease.expense_structure_canonical || lease.expense_structure), 'leases'),
    roof_responsibility: tag(lease && lease.roof_responsibility, 'leases'),
    structure_responsibility: tag(lease && lease.structure_responsibility, 'leases'),
    parking_responsibility: tag(lease && lease.parking_responsibility, 'leases'),
    hvac_responsibility: tag(lease && lease.hvac_responsibility, 'leases'),
    escalations_text: tag(lease && (lease.escalation_raw_text_current || lease.renewal_option_text), 'leases'),
    renewal_options: tag(lease && lease.renewal_options, 'leases'),
    option_bumps_continue: optionBumpsContinueTag(lease),
  };
  // Derived term remaining (years) — every input present.
  if (lease && lease.lease_expiration) {
    const exp = new Date(lease.lease_expiration);
    if (!Number.isNaN(exp.getTime())) {
      const yrs = Math.round(((exp.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
      if (yrs > 0) tenancy_lease.term_remaining_years = { v: `~${yrs}`, derived: `to ${String(lease.lease_expiration).slice(0, 10)} from today (firm; excludes options)` };
    }
  }

  // --- Operations (CMS) with conflict surfacing (§1.5) ------------------------
  let operations = null;
  if (domain === 'dia' && (clinic || fpc.length || prop.total_chairs != null)) {
    const latestFpc = fpc.find(r => !r.data_quality_flag) || fpc[0] || null;
    const clinicPatients = clinic && num(clinic.latest_estimated_patients);
    const trendPatients = latestFpc && num(latestFpc.corrected_total_patients != null ? latestFpc.corrected_total_patients : latestFpc.total_patients);
    operations = {
      stations: tag(clinic && num(clinic.stations), 'CMS (medicare_clinics)'),
      patient_count: tag(clinicPatients, 'CMS (medicare_clinics.latest_estimated_patients)'),
      patient_trend_latest: tag(trendPatients, 'facility_patient_counts', latestFpc && latestFpc.snapshot_date ? { as_of: latestFpc.snapshot_date } : {}),
      ttm_treatments: tag(clinic && num(clinic.ttm_total_treatments != null ? clinic.ttm_total_treatments : clinic.estimated_annual_treatments), 'CMS (medicare_clinics)'),
      certification_date: tag(clinic && (clinic.certification_date || clinic.latest_certification_date), 'CMS (medicare_clinics)'),
      relocation: relocationLineage ? {
        facility_certification_date: dateTag(relocationLineage.facility_certification_date || (clinic && clinic.certification_date), 'CMS (medicare_clinics)'),
        original_certification_date: dateTag(relocationLineage.original_certification_date || prop.certification_date, 'clinic relocation lineage'),
        prior_address: tag(relocationLineage.prior_address, 'clinic_history_unified'),
        prior_city_state: tag([relocationLineage.prior_city, relocationLineage.prior_state].filter(Boolean).join(', '), 'clinic_history_unified'),
        prior_stations: tag(num(relocationLineage.prior_stations), 'clinic_history_unified'),
        current_address: tag(relocationLineage.current_address || prop.address, relocationLineage.current_address ? 'clinic_history_unified' : 'properties'),
        current_stations: tag(num(relocationLineage.current_stations || (clinic && clinic.stations)), relocationLineage.current_stations ? 'clinic_history_unified / CMS' : 'CMS (medicare_clinics)'),
        distance_miles: milesTag(relocationLineage.distance_miles, 'clinic_history_unified'),
        lineage_status: tag(relocationLineage.lineage_status, 'clinic_history_unified'),
      } : {
        facility_certification_date: dateTag(clinic && clinic.certification_date, 'CMS (medicare_clinics)'),
        original_certification_date: dateTag(prop.certification_date, 'properties'),
      },
      market_competition: marketCompetition.map(r => ({
        medicare_id: r.medicare_id,
        facility_name: r.facility_name || null,
        address: r.address || null,
        city: r.city || null,
        state: r.state || null,
        distance_miles: num(r.distance_miles),
        operator: r.operator || null,
        stations: num(r.stations),
        patients: num(r.patients),
        annual_rent: num(r.annual_rent),
        rent_per_sf: num(r.rent_per_sf),
        rent_source: r.rent_source || null,
        lease_expiration: r.lease_expiration || null,
      })),
      _conflicts: [],
    };
    // Surface the audited property-denorm vs CMS divergence rather than trusting either.
    const denormChairs = num(prop.total_chairs), cmsStations = clinic && num(clinic.stations);
    if (denormChairs != null && cmsStations != null && Math.abs(denormChairs - cmsStations) > 2) {
      operations._conflicts.push({ field: 'stations', values: [{ v: cmsStations, source: 'CMS' }, { v: denormChairs, source: 'properties denorm' }], reconciled: cmsStations });
    }
    const denormPatients = num(prop.total_patients);
    const cmsPatients = clinicPatients;
    if (denormPatients != null && cmsPatients != null && Math.abs(denormPatients - cmsPatients) > Math.max(20, cmsPatients)) {
      operations._conflicts.push({ field: 'patient count', values: [{ v: cmsPatients, source: 'CMS' }, { v: denormPatients, source: 'properties denorm' }], reconciled: cmsPatients });
    }
  } else if (domain === 'gov') {
    operations = {
      agency: tag(prop.agency || (bp.gov_data && bp.gov_data.agency), 'gov'),
    };
  }

  // --- Transactions (live only) ----------------------------------------------
  const transactions = (sales || []).map(s => ({
    date: s.sale_date,
    grantor: s.seller_name || s.seller || null,
    grantee: s.buyer_name || s.buyer || null,
    price: num(s.sold_price),
    stated_cap_rate: num(s.stated_cap_rate ?? s.sold_cap_rate),
    calculated_cap_rate: num(s.calculated_cap_rate ?? s.cap_rate_final ?? s.cap_rate),
    cap_rate: s.cap_rate_final != null ? s.cap_rate_final : (s.calculated_cap_rate != null ? s.calculated_cap_rate : s.cap_rate),
    firm_term_years_at_sale: num(s.firm_term_years_at_sale ?? s.firm_term_years),
    source: s.data_source || 'sales_transactions',
  }));
  const transaction_marketing_timeline = buildTransactionMarketingTimeline({
    sales,
    listings,
    buildingSf,
    asOfDate: new Date().toISOString().slice(0, 10),
  });

  // --- Documents --------------------------------------------------------------
  const docsPacket = await fetchEntityDocuments(entityId, workspaceId).catch(() => null);
  const documents = (docsPacket && docsPacket.ok && Array.isArray(docsPacket.docs) && docsPacket.docs.length
    ? docsPacket.docs
    : (bp.documents || []).map(d => toDocumentRow({
      type: d.doc_type || d.type || 'document',
      file_name: d.file_name || d.title || null,
      source: d.storage_backend || d.source || d.backend || null,
      date: d.created_at || null,
      reconciled: !!(d.property_id || d.document_id),
    }))
  ).map(d => ({
    type: d.doc_type || d.type || 'document',
    name: d.file_name || d.name || d.title || null,
    file_name: d.file_name || d.name || d.title || null,
    source: d.source || d.storage_backend || d.backend || null,
    date: d.date || d.created_at || null,
    reconciled: d.reconciled === true,
    reconciled_status: d.reconciled_status || (d.reconciled ? 'linked_to_record' : 'not_yet_reconciled'),
    source_history: Array.isArray(d.source_history) ? d.source_history : undefined,
  }));

  // --- Valuation --------------------------------------------------------------
  const valuation = {
    model_estimate: valueEst != null
      ? { v: valueEst, source: 'LCC valuation model', confidence: 'low (model estimate — not an appraisal)' }
      : undefined,
    last_sale_price: tag(num(prop.latest_sale_price), 'properties'),
  };

  const debt_financing = (loans || []).map(l => {
    let notes = {};
    if (l.notes) {
      try { notes = typeof l.notes === 'string' ? JSON.parse(l.notes) : l.notes; } catch { notes = {}; }
    }
    const rate = num(l.interest_rate_percent ?? l.interest_rate);
    const termMonths = num(l.loan_term);
    const termYears = num(l.term_years != null ? l.term_years : (termMonths != null ? termMonths / 12 : null));
    const currentBalance = num(l.current_balance ?? notes.current_balance_estimate);
    const currentBasis = notes.current_balance_estimate_basis || null;
    return {
      loan_id: l.loan_id,
      lender: tag(l.lender_name || l.originator || l.cmbs_deal_name, l.data_source || 'loans'),
      cmbs_deal_name: tag(l.cmbs_deal_name, l.data_source || 'loans'),
      initial_balance: tag(num(l.loan_amount), l.data_source || 'loans'),
      current_balance_estimate: currentBalance != null
        ? { v: currentBalance, derived: currentBasis || 'current balance estimate from loans/metadata notes' }
        : undefined,
      rate: tag(rate, l.data_source || 'loans'),
      rate_type: notes.amortization_type ? tag(notes.amortization_type, 'loans.notes') : undefined,
      origination_date: dateTag(l.origination_date, l.data_source || 'loans'),
      maturity_date: dateTag(l.maturity_date, l.data_source || 'loans'),
      term_years: termYears != null ? tag(termYears, l.data_source || 'loans') : undefined,
      ltv: tag(num(l.loan_to_value ?? l.ltv), l.data_source || 'loans'),
      loan_type: tag(l.loan_type, l.data_source || 'loans'),
      servicer: tag(l.servicer, l.data_source || 'loans'),
      special_servicer: tag(l.special_servicer, l.data_source || 'loans'),
      status: l.is_active != null ? tag(l.is_active ? 'Active' : 'Inactive', 'loans') : undefined,
    };
  });

  // --- Ownership block --------------------------------------------------------
  const ownership = {
    owner_of_record: tag(ownerOfRecord, 'reconciled property owner',
      trueName && !trueIsOperator ? { confidence: 'true owner' } : { confidence: 'recorded deed owner' }),
    recorded_deed_owner: (recordedName && recordedName !== ownerOfRecord) ? tag(recordedName, 'recorded deed') : undefined,
    operator_tenant: tag(operatorName, operatorName === trueName ? 'operator (not the owner)' : 'lease/properties'),
    owner_is_spe: prop.owner_is_spe != null ? tag(prop.owner_is_spe ? 'Yes' : 'No', 'properties') : undefined,
    developer: tag(prop.developer, 'properties'),
  };

  // --- Meta / header ----------------------------------------------------------
  const addr = prop.address || bp.entity?.name || 'Property';
  const cityState = [prop.city, prop.state].filter(Boolean).join(', ');
  const footerIds = [
    externalId != null ? `property ${externalId}` : null,
    prop.medicare_id ? `CCN ${prop.medicare_id}` : null,
  ].filter(Boolean).join(' · ');
  const meta = {
    title: addr + (cityState ? `, ${cityState}` : ''),
    subtitle: [prop.county ? `${prop.county} County` : null, prop.property_type].filter(Boolean).join(' · '),
    domain_label: domainLabel,
    footer_ids: footerIds,
    property_label: addr,
    domain,
    property_id: externalId,
  };

  return {
    meta, identity, ownership, tenancy_lease, operations, valuation, debt_financing, transactions, transaction_marketing_timeline, documents,
    document_sources: docsPacket?.ok ? { sources: docsPacket.sources, cre_property_id: docsPacket.cre_property_id } : undefined,
    location: (domain === 'dia') ? {
      address: tag([prop.address, prop.city, prop.state, prop.zip_code].filter(Boolean).join(', '), 'properties'),
      latitude: tag(num(prop.latitude), 'properties'),
      longitude: tag(num(prop.longitude), 'properties'),
      geocode: (prop.latitude && prop.longitude) ? tag(`${prop.latitude}, ${prop.longitude}`, 'properties') : undefined,
      frontage: prop.address ? tag(prop.address, 'properties') : undefined,
      static_map: staticMap ? {
        image_data_uri: staticMap.image_data_uri,
        provider: staticMap.provider,
        cache_key: staticMap.cache_key,
        cached: staticMap.cached,
        rings_miles: [1, 3, 5],
      } : undefined,
      nearby_national_tenants: nearbyNationalTenants.map(t => ({
        tenant_name: tag(t.tenant_name, t.source || 'google_places_nearbysearch'),
        vicinity: tag(t.vicinity, t.source || 'google_places_nearbysearch'),
        distance_miles: milesTag(t.distance_miles, t.source || 'google_places_nearbysearch'),
        place_types: Array.isArray(t.place_types) ? t.place_types : [],
        rating: tag(num(t.rating), t.source || 'google_places_nearbysearch'),
      })),
      radius_demographics: (demos || []).map(d => ({
        radius_miles: num(d.radius_miles),
        population: tag(num(d.population), d.data_source || 'property_demographics', d.data_year ? { as_of: d.data_year } : {}),
        num_households: tag(num(d.num_households), d.data_source || 'property_demographics', d.data_year ? { as_of: d.data_year } : {}),
        population_growth_pct: tag(num(d.population_growth_pct), d.data_source || 'property_demographics', d.data_year ? { as_of: d.data_year } : {}),
        avg_hhi: tag(num(d.avg_hhi), d.data_source || 'property_demographics', d.data_year ? { as_of: d.data_year } : {}),
        median_hhi: tag(num(d.median_hhi), d.data_source || 'property_demographics', d.data_year ? { as_of: d.data_year } : {}),
      })),
      radius_demographics_gap: (!demos || !demos.length) ? {
        v: `No property_demographics rows are on file for property ${externalId}.`,
        source: 'property_demographics coverage audit',
      } : undefined,
      zip_census: zcta ? {
        zip_code: tag(zcta.zip_code, 'census_zcta_demographics'),
        total_population: tag(num(zcta.total_population ?? zcta.population), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        median_household_income: tag(num(zcta.median_household_income ?? zcta.median_hhi), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        population_65_plus: tag(num(zcta.population_65_plus), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        population_65_plus_pct: tag(num(zcta.population_65_plus_pct), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        uninsured_rate: tag(num(zcta.uninsured_rate), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        poverty_rate: tag(num(zcta.poverty_rate), 'census_zcta_demographics', zcta.data_year ? { as_of: zcta.data_year } : {}),
        data_year: zcta.data_year || null,
      } : undefined,
      payer_mix: payer ? {
        county: tag(payer.county || payer.county_name, 'v_payer_mix_geo_averages'),
        state: tag(payer.state || payer.state_name, 'v_payer_mix_geo_averages'),
        county_medicare_pct: tag(num(payer.county_medicare_pct ?? payer.medicare_pct), 'v_payer_mix_geo_averages'),
        county_medicaid_pct: tag(num(payer.county_medicaid_pct ?? payer.medicaid_pct), 'v_payer_mix_geo_averages'),
        county_private_pct: tag(num(payer.county_private_pct ?? payer.private_pct), 'v_payer_mix_geo_averages'),
        county_clinic_count: tag(num(payer.county_clinic_count ?? payer.clinic_count), 'v_payer_mix_geo_averages'),
        state_medicare_pct: tag(num(payer.state_medicare_pct), 'v_payer_mix_geo_averages'),
        state_medicaid_pct: tag(num(payer.state_medicaid_pct), 'v_payer_mix_geo_averages'),
        state_private_pct: tag(num(payer.state_private_pct), 'v_payer_mix_geo_averages'),
        state_clinic_count: tag(num(payer.state_clinic_count), 'v_payer_mix_geo_averages'),
      } : undefined,
    } : undefined,
    listings,
  };
}

/**
 * Assemble the reconciled DEAL packet — the property block + the deal spine
 * (parties, correspondence, offers, cadence, ROE). Correspondence/offers mirror
 * mcp/deal-dossier-tools.js (activity_events on the entity + deal anchor).
 */
export async function buildDealPacket(entityId, workspaceId) {
  const propertyPacket = await buildPropertyPacket(entityId, workspaceId);

  const [actRes, cadRes, partyRes, spineRes, dealPartiesRes, bdRes] = await Promise.all([
    opsQuery('GET',
      `activity_events?or=(entity_id.eq.${encodeURIComponent(entityId)},metadata->>deal_entity_id.eq.${encodeURIComponent(entityId)})` +
      `&order=occurred_at.desc&limit=60&select=category,title,direction,occurred_at,source_type,metadata`).catch(() => null),
    opsQuery('GET',
      `touchpoint_cadence?entity_id=eq.${encodeURIComponent(entityId)}&select=next_touch_date,next_touch_type,cadence_status&order=next_touch_date.asc&limit=1`).catch(() => null),
    opsQuery('POST', 'rpc/lcc_party_relationships', { p_entity: entityId, p_limit: 40 }).catch(() => null),
    // Deal-spine read model (prompt 06): commission/milestones/diligence/documents/
    // correspondence-summary/conflicts. Missing sections come back as [] / null so the
    // renderer prints "Not on file" — nothing is fabricated.
    opsQuery('POST', 'rpc/lcc_deal_spine', { p_entity: entityId }).catch(() => null),
    opsQuery('POST', 'rpc/lcc_deal_parties', { p_entity: entityId, p_limit: 60 }).catch(() => null),
    opsQuery('GET',
      `bd_opportunities?entity_id=eq.${encodeURIComponent(entityId)}&select=sf_opp_id,stage,is_open,closed_won,amount,deal_name&order=updated_at.desc&limit=1`).catch(() => null),
  ]);

  const acts = (actRes?.ok && Array.isArray(actRes.data)) ? actRes.data : [];
  const correspondence = acts
    .filter(a => ['email', 'call', 'meeting', 'note'].includes(String(a.category || '').toLowerCase()))
    .slice(0, 25)
    .map(a => ({ date: a.occurred_at, direction: a.direction || (a.metadata && a.metadata.direction) || '', subject: a.title || '', source: a.source_type || 'activity_events' }));
  const offers = acts
    .filter(a => /offer|loi|bid/i.test(String(a.category || '') + ' ' + String(a.title || '')))
    .slice(0, 15)
    .map(a => ({ date: a.occurred_at, buyer: (a.metadata && (a.metadata.buyer || a.metadata.buyer_name)) || '', price: (a.metadata && (a.metadata.price || a.metadata.offer_price)) || null, status: (a.metadata && a.metadata.status) || '' }));

  const spine = (spineRes?.ok && spineRes.data && typeof spineRes.data === 'object') ? spineRes.data : {};
  const conflicts = Array.isArray(spine.conflicts) ? spine.conflicts : [];

  // Parties by side/role from the graph. Reconciliation discipline: a `brokers`
  // edge sourced from CoStar/costar_sidebar is a fallback view of the third-party
  // broker — it must NOT stand as OUR verified role, so it is labelled `third_party`
  // and any open listing_broker conflict is surfaced (never silently resolved).
  const brokerConflictOpen = conflicts.some(c => c && c.field === 'listing_broker' && c.status === 'open');
  const graphParties = (dealPartiesRes?.ok && Array.isArray(dealPartiesRes.data)) ? dealPartiesRes.data : [];
  let parties = graphParties.map(r => {
    const src = r.source || 'entity_relationships';
    const isCostar = /costar|dia_contact/i.test(String(src));
    let side = r.side || 'other';
    let flag = '';
    if (r.relationship === 'brokers') {
      // CoStar-sourced broker stays third_party until our own systems confirm the role.
      side = isCostar ? 'third_party' : side;
      if (isCostar && brokerConflictOpen) flag = 'unverified role';
    } else if (r.relationship === 'guaranteed_by') {
      side = 'guarantor';
    }
    return {
      party_entity_id: r.party_entity_id || null,
      role: r.role || r.relationship || 'party',
      name: r.name || '',
      side,
      flag,
      effective_from: r.effective_from || null,
      source: src,
    };
  });
  // Back-compat fallback to lcc_party_relationships if the deal-parties fn returned nothing.
  if (!parties.length && partyRes?.ok && Array.isArray(partyRes.data)) {
    parties = partyRes.data.slice(0, 25).map(r => ({
      party_entity_id: r.counterparty_id || null,
      role: r.relationship || r.role || 'party', name: r.name || r.counterparty_name || '',
      side: 'other', flag: r.is_institution ? 'institution' : (r.is_reit ? 'REIT' : ''),
      source: 'lcc_party_relationships',
    }));
  }

  // Correspondence: prefer the living rolling summary; keep the row-level thread list too.
  const corrSummary = spine.correspondence_summary || null;

  // Connected-sources panel: which systems actually feed this record, and where the gaps are.
  const bd = (bdRes?.ok && Array.isArray(bdRes.data) && bdRes.data[0]) || null;
  const connected_sources = {
    costar: parties.some(p => /costar|dia_contact/i.test(String(p.source))) ? 'source' : 'none',
    salesforce: (bd && bd.sf_opp_id) ? 'linked' : (bd ? 'container_no_opportunity' : 'no_opportunity'),
    outlook: correspondence.length ? 'linked' : 'not_linked',
    sharefile: (Array.isArray(spine.documents) && spine.documents.some(d => d && /sharefile|folder_feed/i.test(String(d.source)))) ? 'linked' : 'not_linked',
    deal_spine: `entity ${String(entityId).slice(0, 8)}`,
  };

  const cad = (cadRes?.ok && cadRes.data?.[0]) || null;
  const deal = {
    stage: tag(bd && bd.stage, 'sf'),
    sf_opportunity_id: tag(bd && bd.sf_opp_id, 'sf'),
    parties,
    commission: Array.isArray(spine.commission) ? spine.commission : [],
    milestones: Array.isArray(spine.milestones) ? spine.milestones : [],
    diligence: Array.isArray(spine.diligence) ? spine.diligence : [],
    documents: Array.isArray(spine.documents) ? spine.documents : [],
    conflicts,
    correspondence_summary: corrSummary,
    correspondence,
    offers,
    connected_sources,
    cadence: {
      next_touch_due: tag(cad && cad.next_touch_date, 'touchpoint_cadence'),
      next_touch_type: tag(cad && cad.next_touch_type, 'touchpoint_cadence'),
    },
    roe: {},
  };

  const meta = { ...propertyPacket.meta };
  meta.title = `${propertyPacket.meta.property_label} — Deal`;
  return { ...propertyPacket, deal, meta };
}

export const entitiesHandler = withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (requireOps(res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  const workspaceId = req.headers['x-lcc-workspace'] || user.memberships[0]?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace context' });

  const membership = user.memberships.find(m => m.workspace_id === workspaceId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this workspace' });

  // GET
  if (req.method === 'GET') {
    const { id, action, q, entity_type, domain } = req.query;

    // UI Phase 4B — authoritative per-entity portfolio from the BD spine.
    // GET /api/entities?action=portfolio&id=<uuid>
    //   rollup  ← v_entity_portfolio_all (one row; count / Σ rent / domains)
    //   props   ← lcc_entity_portfolio_facts ⋈ lcc_property_attributes
    // Replaces the old fuzzy v_ownership_current true_owner=ilike name-match in
    // openEntityDetail (SPEs / renamed owners mismatched). Each property row is a
    // 4A zoom target (clicking opens openUnifiedDetail). MUST run before the
    // `if (id)` single-entity early-return below.
    if (action === 'portfolio' && id) {
      // Confirm the entity belongs to this workspace before exposing its portfolio.
      const entRes = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=id,name`);
      if (!entRes.ok || !entRes.data?.length) {
        return res.status(404).json({ error: 'Entity not found' });
      }

      const { rollup, properties } = await fetchEntityPortfolio(id, workspaceId);
      return res.status(200).json({ rollup, properties });
    }

    // Contact 360 — the single aggregating read behind the reusable contact
    // side-panel (openEntityDetail / openContact360). Composes, in ONE call,
    // everything the panel needs: the entity (+ external identities / relationships),
    // the authoritative BD portfolio (owns/former), the developed edges, the
    // UNIFIED activity timeline (LCC activity_events + dia salesforce_activities,
    // each broker-labeled), the Outlook email relationship, engagement
    // (unified_contacts), marketing_leads signals, the SF-account owner, and the
    // Rules-of-Engagement verdict. Entity-keyed — a plain contact resolves to its
    // person entity client-side (openContact360) before calling this.
    // MUST run before the `if (id)` single-entity early-return below.
    if (action === 'contact360' && id) {
      const c360 = await buildContact360(id, workspaceId);
      if (!c360) return res.status(404).json({ error: 'Entity not found' });
      return res.status(200).json(c360);
    }

    // Tab 3 "Relationships" (Scott ask #2) — working-relationship intelligence:
    // the party's counterparties across shared assets (buyers sold-to, sellers
    // bought-from, co-brokers, lenders), with a REIT/institution flag. Pure graph
    // rollup via lcc_party_relationships(p_entity, p_limit). Best-effort.
    // GET /api/entities?action=relationships&id=<uuid>[&limit=]
    if (action === 'relationships' && id) {
      const entRes = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=id`);
      if (!entRes.ok || !entRes.data?.length) return res.status(404).json({ error: 'Entity not found' });
      const lim = Math.min(Math.max(1, Number(req.query.limit) || 60), 200);
      const r = await opsQuery('POST', 'rpc/lcc_party_relationships',
        { p_entity: id, p_limit: lim }).catch(() => null);
      const rows = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
      // Group by relationship category so the UI can section buyers / sellers /
      // brokers / lenders without re-deriving on the client.
      const groups = {};
      for (const row of rows) {
        const g = row.relationship || 'co_party';
        (groups[g] = groups[g] || []).push(row);
      }
      return res.status(200).json({ entity_id: id, count: rows.length, rows, groups });
    }

    // Tab 2 "Portfolio & History" (Scott ask #1) — every role the party has played
    // on every asset over time (owner / buyer / seller / broker / lender /
    // developer), current-vs-prior, capped per role with an honest role_total.
    // Pure graph read via lcc_party_history(p_entity, p_per_role).
    // GET /api/entities?action=history&id=<uuid>[&per_role=]
    if (action === 'history' && id) {
      const entRes = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=id`);
      if (!entRes.ok || !entRes.data?.length) return res.status(404).json({ error: 'Entity not found' });
      const perRole = Math.min(Math.max(1, Number(req.query.per_role) || 25), 100);
      const r = await opsQuery('POST', 'rpc/lcc_party_history',
        { p_entity: id, p_per_role: perRole }).catch(() => null);
      const rows = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
      const groups = {};
      const totals = {};
      for (const row of rows) {
        const g = row.party_role || 'other';
        (groups[g] = groups[g] || []).push(row);
        if (totals[g] == null) totals[g] = row.role_total != null ? Number(row.role_total) : (groups[g].length);
      }
      return res.status(200).json({ entity_id: id, count: rows.length, rows, groups, totals });
    }

    // Documents viewer — the OMs / BOVs / leases / comps ingested for this
    // property across intake artifacts, the CRE folder-feed registry, and
    // Salesforce file discovery. Every row carries a date and reconciliation
    // status for dossier v2 grounding.
    // GET /api/entities?action=documents&id=<uuid>
    if (action === 'documents' && id) {
      const packet = await fetchEntityDocuments(id, workspaceId);
      if (!packet.ok) return res.status(packet.status || 500).json({ error: packet.error || 'documents_unavailable' });
      return res.status(200).json(packet);
    }

    // Deal tab packet — the same grounded buildDealPacket shape used by
    // generate_dossier(kind='deal'), with an explicit eligibility flag so the
    // entity panel only shows the singular Deal tab for real asset deals.
    // GET /api/entities?action=deal_packet&id=<uuid>
    if (action === 'deal_packet' && id) {
      const entRes = await opsQuery('GET',
        `entities?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${workspaceId}&select=id`);
      if (!entRes.ok || !entRes.data?.length) return res.status(404).json({ error: 'Entity not found' });

      let packet;
      try {
        packet = await buildDealPacket(id, workspaceId);
      } catch (err) {
        return res.status(422).json({ error: 'deal_packet_unavailable', detail: err?.message || String(err) });
      }

      const domain = packet?.meta?.domain;
      const propertyId = packet?.meta?.property_id;
      const [bd, nmSale] = await Promise.all([
        opsQuery('GET',
          `bd_opportunities?entity_id=eq.${encodeURIComponent(id)}` +
          `&select=id,is_open,closed_won,sf_opp_id,stage,updated_at&order=updated_at.desc&limit=5`).catch(() => null),
        (domain && propertyId != null)
          ? domainQuery(domain, 'GET',
              `sales_transactions?property_id=eq.${encodeURIComponent(propertyId)}` +
              `&is_northmarq=eq.true&transaction_state=eq.live&select=sale_id,is_northmarq,sale_date&limit=5`).catch(() => null)
          : Promise.resolve(null),
      ]);
      const bdRows = (bd && bd.ok && Array.isArray(bd.data)) ? bd.data : [];
      const nmRows = (nmSale && nmSale.ok && Array.isArray(nmSale.data)) ? nmSale.data : [];
      const hasDeal = bdRows.length > 0 || nmRows.length > 0 ||
        (packet?.deal && packet.deal.connected_sources && packet.deal.connected_sources.salesforce === 'linked');

      return res.status(200).json({
        ok: true,
        entity_id: id,
        has_deal: hasDeal,
        deal_signals: {
          bd_opportunities: bdRows.length,
          northmarq_sales: nmRows.length,
          open_opportunity: bdRows.some(r => r && r.is_open === true),
        },
        packet,
      });
    }

    // Mint a short-lived signed URL for a stored document (by artifact id, so we
    // never sign an arbitrary object). GET /api/entities?action=document_url&artifact_id=<uuid>
    if (action === 'document_url') {
      const artId = String(req.query.artifact_id || '').trim();
      if (!artId) return res.status(400).json({ error: 'artifact_id required' });
      const a = await opsQuery('GET',
        `staged_intake_artifacts?id=eq.${encodeURIComponent(artId)}&select=storage_ref,storage_path,file_name&limit=1`).catch(() => null);
      const row = (a && a.data && a.data[0]) || null;
      const ref = row && (row.storage_ref || row.storage_path);
      if (!ref) return res.status(404).json({ error: 'artifact_not_found' });
      const resolved = await resolveArtifactDownload({
        storageRef: ref,
        opsUrl: process.env.OPS_SUPABASE_URL,
        opsKey: process.env.OPS_SUPABASE_KEY,
        fetchImpl: (u, opts) => fetchWithTimeout(u, opts, 8000),
      });
      if (!resolved.ok) return res.status(resolved.status || 500).json({ error: resolved.error || 'sign_failed', detail: resolved.detail || null });
      return res.status(200).json({ ok: true, signed_url: resolved.signed_url,
        file_name: row.file_name || resolved.file_name, expires_at: resolved.expires_at || null });
    }

    // Dossiers list — stored property/deal dossiers for this entity, newest per
    // type first, with all versions. Surfaced in the property panel Documents tab.
    // GET /api/entities?action=dossiers&id=<uuid>
    if (action === 'dossiers' && id) {
      const entRes = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=id`);
      if (!entRes.ok || !entRes.data?.length) return res.status(404).json({ error: 'Entity not found' });
      const d = await opsQuery('GET',
        `lcc_dossiers?entity_id=eq.${encodeURIComponent(id)}` +
        `&select=id,dossier_type,storage_ref,format,version,title,generated_at,source_hash,metadata` +
        `&order=generated_at.desc&limit=50`).catch(() => null);
      const rows = (d && d.ok && Array.isArray(d.data)) ? d.data : [];
      const current = {};
      for (const r of rows) if (!current[r.dossier_type]) current[r.dossier_type] = r;
      return res.status(200).json({ entity_id: id, count: rows.length, dossiers: rows, current });
    }

    // Mint a signed URL for a stored dossier (by dossier id, routing on ref shape
    // — Supabase signed URL or SharePoint sharing link).
    // GET /api/entities?action=dossier_url&dossier_id=<uuid>
    if (action === 'dossier_url') {
      const dId = String(req.query.dossier_id || '').trim();
      if (!dId) return res.status(400).json({ error: 'dossier_id required' });
      const d = await opsQuery('GET',
        `lcc_dossiers?id=eq.${encodeURIComponent(dId)}&select=storage_ref,title,metadata&limit=1`).catch(() => null);
      const row = (d && d.data && d.data[0]) || null;
      if (!row || !row.storage_ref) return res.status(404).json({ error: 'dossier_not_found' });
      const resolved = await resolveArtifactDownload({
        storageRef: row.storage_ref,
        opsUrl: process.env.OPS_SUPABASE_URL,
        opsKey: process.env.OPS_SUPABASE_KEY,
        fetchImpl: (u, opts) => fetchWithTimeout(u, opts, 8000),
      });
      if (!resolved.ok) return res.status(resolved.status || 500).json({ error: resolved.error || 'sign_failed', detail: resolved.detail || null });
      return res.status(200).json({ ok: true, signed_url: resolved.signed_url,
        title: row.title || null, sharepoint_url: row.metadata?.sharepoint_url || null,
        expires_at: resolved.expires_at || null });
    }

    // UI Phase 5 — "Owners Missing a Contact" value-ranked BD worklist.
    // GET /api/entities?action=owner_worklist[&min_value=&limit=&offset=]
    //   rows ← v_owner_contact_worklist (contactless valued owners, value-ranked).
    // Defaults to the workable high-value set (min_value); returns the actionable
    // count (matching the filter) AND the full clean universe so the surface can
    // show an honest "X of N" (Consumption-Layer doctrine). The row action runs
    // the EXISTING CONTACT-SELECTION picker via the 4B owner detail Contacts tab.
    if (action === 'owner_worklist') {
      const minValue = Math.max(0, Number(req.query.min_value) || 0);
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const base = `v_owner_contact_worklist?workspace_id=eq.${workspaceId}`;
      const filt = minValue > 0 ? `&rank_value=gte.${minValue}` : '';
      const rowPath = base +
        `&select=entity_id,owner_name,rank_value,property_count,primary_domain,is_cross_vertical,enrichment_action,bench_size` +
        filt + `&order=rank_value.desc.nullslast&limit=${limit}&offset=${offset}`;
      const [rowsRes, universeRes] = await Promise.all([
        opsQuery('GET', rowPath, undefined, { countMode: 'exact' }),
        opsQuery('GET', base + '&select=entity_id', undefined, { countMode: 'exact' }),
      ]);
      return res.status(200).json({
        rows: (rowsRes.ok && Array.isArray(rowsRes.data)) ? rowsRes.data : [],
        actionable_count: rowsRes.count ?? (rowsRes.data?.length || 0),
        universe_count: universeRes.count ?? null,
        min_value: minValue,
        limit,
        offset,
      });
    }

    // Single entity with related data
    if (id) {
      const result = await opsQuery('GET',
        `entities?id=eq.${id}&workspace_id=eq.${workspaceId}&select=*,external_identities(*),entity_aliases(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)`
      );
      if (!result.ok || !result.data?.length) {
        return res.status(404).json({ error: 'Entity not found' });
      }
      return res.status(200).json({ entity: result.data[0] });
    }

    // Duplicate candidates — entities with matching canonical names or similar names
    if (action === 'duplicates') {
      const result = await opsQuery('GET',
        `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,canonical_name,domain,city,state&order=canonical_name,name`
      );
      const entities = result.data || [];

      // Group by canonical_name to find exact duplicates
      const byCanonical = {};
      for (const e of entities) {
        const key = e.canonical_name || e.name.toLowerCase();
        if (!byCanonical[key]) byCanonical[key] = [];
        byCanonical[key].push(e);
      }

      const duplicates = [];
      for (const [canonical, group] of Object.entries(byCanonical)) {
        if (group.length > 1) {
          duplicates.push({
            canonical_name: canonical,
            match_type: 'exact_canonical',
            count: group.length,
            entities: group
          });
        }
      }

      // Also find near-matches using prefix similarity (first 10 chars)
      const prefixGroups = {};
      for (const e of entities) {
        const prefix = (e.canonical_name || '').substring(0, 10);
        if (prefix.length >= 5) {
          if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
          prefixGroups[prefix].push(e);
        }
      }
      const nearMatches = [];
      for (const [prefix, group] of Object.entries(prefixGroups)) {
        if (group.length > 1) {
          // Only include if not already caught by exact match
          const canonicals = new Set(group.map(e => e.canonical_name));
          if (canonicals.size > 1) {
            nearMatches.push({
              prefix,
              match_type: 'prefix_similarity',
              count: group.length,
              entities: group
            });
          }
        }
      }

      return res.status(200).json({
        exact_duplicates: duplicates,
        near_matches: nearMatches,
        total_entities: entities.length,
        duplicate_groups: duplicates.length,
        near_match_groups: nearMatches.length
      });
    }

    // Data quality dashboard
    if (action === 'quality') {
      const [entities, identities, aliases, orphanedActions, orphanedInbox] = await Promise.all([
        opsQuery('GET', `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,domain,email,phone,address,city,state`),
        opsQuery('GET', `external_identities?workspace_id=eq.${workspaceId}&select=id,entity_id,source_system,last_synced_at`),
        opsQuery('GET', `entity_aliases?workspace_id=eq.${workspaceId}&select=id,entity_id`),
        opsQuery('GET', `action_items?workspace_id=eq.${workspaceId}&entity_id=is.null&status=neq.cancelled&select=id&limit=100`),
        opsQuery('GET', `inbox_items?workspace_id=eq.${workspaceId}&status=in.(new,triaged)&select=id&limit=100`)
      ]);

      const entityList = entities.data || [];
      const identityList = identities.data || [];
      const linkedEntityIds = new Set(identityList.map(i => i.entity_id));
      const staleThreshold = new Date(Date.now() - 7 * 86400000).toISOString();
      const staleIdentities = identityList.filter(i => i.last_synced_at && i.last_synced_at < staleThreshold);

      // Entities missing key fields by type
      const missingFields = {
        persons_without_email: entityList.filter(e => e.entity_type === 'person' && !e.email).length,
        persons_without_phone: entityList.filter(e => e.entity_type === 'person' && !e.phone).length,
        assets_without_address: entityList.filter(e => e.entity_type === 'asset' && !e.address).length,
        assets_without_state: entityList.filter(e => e.entity_type === 'asset' && !e.state).length,
        entities_without_domain: entityList.filter(e => !e.domain).length
      };

      return res.status(200).json({
        total_entities: entityList.length,
        by_type: {
          person: entityList.filter(e => e.entity_type === 'person').length,
          organization: entityList.filter(e => e.entity_type === 'organization').length,
          asset: entityList.filter(e => e.entity_type === 'asset').length
        },
        linked_to_external: linkedEntityIds.size,
        unlinked: entityList.length - linkedEntityIds.size,
        total_identities: identityList.length,
        stale_identities: staleIdentities.length,
        total_aliases: (aliases.data || []).length,
        missing_fields: missingFields,
        orphaned_actions: (orphanedActions.data || []).length,
        orphaned_inbox: (orphanedInbox.data || []).length,
        checked_at: new Date().toISOString()
      });
    }

    if (action === 'quality_details') {
      const [duplicates, unlinked, stale, completeness, orphaned, precedence] = await Promise.all([
        opsQuery('GET', `v_duplicate_candidates?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_unlinked_entities?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_stale_identities?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `v_entity_completeness?workspace_id=eq.${workspaceId}&order=completeness_score.asc&limit=25`),
        opsQuery('GET', `v_orphaned_actions?workspace_id=eq.${workspaceId}&limit=25`),
        opsQuery('GET', `source_precedence?workspace_id=eq.${workspaceId}&order=precedence.desc&limit=25`)
      ]);

      return res.status(200).json({
        duplicate_candidates: duplicates.data || [],
        unlinked_entities: unlinked.data || [],
        stale_identities: stale.data || [],
        low_completeness: (completeness.data || []).filter(row => (row.completeness_score || 0) < 60),
        orphaned_actions: orphaned.data || [],
        source_precedence: precedence.data || []
      });
    }

    // Phase 3 + 4 — surface field_provenance skips/conflicts where the rule
    // is in warn/strict mode AND any (target_table,field_name,source) triple
    // that's been writing to field_provenance but isn't in
    // field_source_priority (schema drift). Drives the LCC Data Quality
    // UI's "Provenance conflicts" + "Unranked fields" panels.
    if (action === 'quality_provenance') {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const [actionable, summary, unranked] = await Promise.all([
        // TIER 1 Unit 2: exclude decision='skip' telemetry from the rendered
        // "Provenance conflicts" list — a skip is the registry correctly choosing
        // a higher-priority source, not a human decision. (The summary_7d
        // aggregate below still buckets skip vs conflict as drift telemetry.)
        opsQuery('GET',
          `v_field_provenance_actionable?` +
          `select=provenance_id,recorded_at,target_database,target_table,record_pk_value,` +
          `field_name,attempted_value,attempted_source,attempted_priority,enforce_mode,` +
          `decision,decision_reason,current_source,current_value` +
          `&decision=eq.conflict&order=recorded_at.desc&limit=${limit}`
        ),
        // Summary: by target_table+field, how many would-have-blocked rows
        // in the last 7 days. We can't GROUP BY in PostgREST — fold in JS
        // after fetching the raw set with a higher cap (cheap, < 5k rows
        // expected even at peak).
        opsQuery('GET',
          `v_field_provenance_actionable?` +
          `select=target_table,field_name,enforce_mode,decision` +
          `&recorded_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString())}` +
          `&limit=5000`
        ),
        // Phase 4 — schema-drift detector. Unranked field writes from the
        // last 30 days (any source).
        opsQuery('GET',
          `v_field_provenance_unranked?` +
          `select=target_table,field_name,source,writes_30d,writes_succeeded,` +
          `writes_skipped,writes_conflicted,first_seen,last_seen,distinct_records,` +
          `distinct_sources_seen` +
          `&order=writes_30d.desc&limit=100`
        )
      ]);

      // Build the summary aggregate
      const summaryMap = new Map();
      for (const r of (summary.data || [])) {
        const key = `${r.target_table}|${r.field_name}|${r.enforce_mode}|${r.decision}`;
        summaryMap.set(key, (summaryMap.get(key) || 0) + 1);
      }
      const summaryRows = [...summaryMap.entries()]
        .map(([key, count]) => {
          const [target_table, field_name, enforce_mode, decision] = key.split('|');
          return { target_table, field_name, enforce_mode, decision, count };
        })
        .sort((a, b) => b.count - a.count);

      return res.status(200).json({
        actionable: actionable.data || [],
        summary_7d: summaryRows,
        unranked:   unranked.data || [],
      });
    }

    // R4 Phase-4 Tier A: unified review queue. Drives the "Provenance Review
    // Queue" widget on the Ops page. Returns the rows from
    // v_field_provenance_review_queue plus per-bucket counts so the UI can
    // render the bucket-filter chips without a second round trip.
    //
    // Perf note: an earlier version fetched a 10k-row rollup to count
    // buckets; with the full view computing ~520k skip rows the
    // PostgREST round-trip exceeded the 8s fetchWithTimeout ceiling.
    // The view has since been split: actionable conflicts only live in
    // v_field_provenance_review_queue (~70ms); the warn/strict skip
    // surface lives in v_field_provenance_warn_strict_skips and is
    // loaded only when the dedicated chip is clicked.
    if (action === 'quality_provenance_review_queue') {
      const limit  = Math.min(Math.max(parseInt(req.query.limit, 10)  || 200, 1), 1000);
      const bucket = req.query.bucket; // optional pre-filter
      let path = `v_field_provenance_review_queue?` +
        `select=provenance_id,recorded_at,target_database,target_table,record_pk_value,` +
        `field_name,attempted_value,attempted_source,attempted_priority,attempted_enforce_mode,` +
        `current_provenance_id,current_value,current_source,current_priority,` +
        `decision,decision_reason,row_kind,bucket` +
        `&order=recorded_at.desc&limit=${limit}`;
      if (bucket && /^[a-z_]+$/.test(bucket)) {
        path += `&bucket=eq.${bucket}`;
      }

      // Rows query + tiny aggregate RPC for counts. countMode:'none' skips
      // PostgREST's exact-count round-trip (which doubles the view scan).
      const [rows, countsRpc] = await Promise.all([
        opsQuery('GET', path, undefined, { countMode: 'none' }),
        opsQuery('POST', 'rpc/lcc_provenance_review_queue_counts', {}),
      ]);
      const bucketCounts = {};
      for (const r of (countsRpc.data || [])) {
        bucketCounts[r.bucket] = Number(r.n) || 0;
      }

      // Decorate each row with the underlying entity's label (property
      // address, lease tenant + dates, contact name, document file_name,
      // parcel APN) so the queue card reads like
      //     dia.leases.lease_expiration
      //     Fresenius · expires 2026-05-31
      //     123 Main St, Memphis, TN
      // instead of "record 18391" with no other context. Best-effort:
      // failure leaves record_context=null on the row, queue still renders.
      const queueRows = rows.data || [];
      try {
        await enrichReviewQueueContext(queueRows);
      } catch (err) {
        console.warn('[quality_provenance_review_queue] enrichment failed:', err?.message || err);
      }

      return res.status(200).json({
        rows: queueRows,
        bucket_counts: bucketCounts,
      });
    }

    // Search by name
    if (action === 'search' && q) {
      const searchTerm = q.replace(/[%_]/g, '').trim();
      if (searchTerm.length < 2) {
        return res.status(400).json({ error: 'Search term must be at least 2 characters' });
      }

      let path = `entities?workspace_id=eq.${workspaceId}&or=(name.ilike.*${encodeURIComponent(searchTerm)}*,canonical_name.ilike.*${encodeURIComponent(searchTerm.toLowerCase())}*)&select=id,entity_type,name,domain,city,state,email,phone,address,org_type,asset_type,external_identities(source_system,source_type,external_id)`;
      if (entity_type && isValidEnum(entity_type, ENTITY_TYPES)) {
        path += `&entity_type=eq.${entity_type}`;
      }
      if (domain && isValidEnum(domain, DOMAINS)) {
        path += `&domain=eq.${domain}`;
      }
      path += '&limit=50&order=name';

      // Search results — countMode='estimated' is fine for the surfaced count
      // and skips the second COUNT(*) trip.
      const result = await opsQuery('GET', path, undefined, { countMode: 'estimated' });
      return res.status(200).json({ entities: result.data || [], count: result.count });
    }

    // Lookup a single asset entity by address (+ optional city/state).
    // Used by the property detail panel to surface CoStar-sourced lease
    // estimates from the entity's metadata JSONB.
    //
    // Round 76ek (2026-04-29): the address-only path is fragile against
    // tiny formatting differences ("Dr" vs "Drive" vs "Dr."), which caused
    // the sidebar to "lose" entities right after a successful save and show
    // the green Save button again as if nothing happened. We now try
    // stronger identity signals first when the caller supplies them:
    //   1) entity_id (exact)
    //   2) source_url (exact match against metadata->>'source_url')
    //   3) parcel_number (exact match against metadata->>'parcel_number')
    //   4) domain_property_id + domain (exact)
    //   5) address (case-insensitive, with light Drive↔Dr normalization)
    //   6) address (case-insensitive, exact equality — legacy fallback)
    // First non-empty result wins. This lets the sidebar identify a
    // CoStar-saved property from any of source_url/parcel/property_id even
    // if the address text on the live page has drifted.
    if (action === 'lookup_asset') {
      const select = 'id,entity_type,name,address,city,state,domain,asset_type,metadata';
      const baseFilter = `workspace_id=eq.${workspaceId}&entity_type=eq.asset`;
      const sanitize = (s) => String(s || '').trim().replace(/[%_*,()]/g, '');

      const tryQuery = async (extraFilter) => {
        const path = `entities?${baseFilter}&${extraFilter}&select=${select}&limit=1`;
        const r = await opsQuery('GET', path);
        const hit = (r.data && r.data[0]) || null;
        // Attach the reconciled PROPERTY owner (lcc_property_owner) so the detail panel
        // can show the real owner entity instead of falling back to the operator/tenant.
        // This is the property-owner truth (an entity), distinct from the point person.
        // Best-effort; a miss just leaves property_owner unset (panel shows "Unresolved").
        if (hit && hit.id) {
          try {
            const po = await opsQuery('GET',
              `lcc_property_owner?entity_id=eq.${hit.id}&select=owner_entity_id,owner_name,confidence,source,resolved_at&limit=1`);
            if (po.data && po.data[0] && po.data[0].owner_name) {
              hit.property_owner = po.data[0];
              // Connect the property-owner to the prospecting layer: is our team working
              // this owner, by whom, how recently? (touchpoint_cadence). Powers the P3.3
              // Current Owner prospecting strip. Best-effort.
              if (hit.property_owner.owner_entity_id) {
                try {
                  const ps = await opsQuery('POST', 'rpc/lcc_owner_prospecting_status',
                    { p_owner_entity_id: hit.property_owner.owner_entity_id });
                  const pv = Array.isArray(ps.data) ? ps.data[0] : ps.data;
                  if (pv && typeof pv === 'object') hit.property_owner.prospecting = pv;
                } catch (_e2) { /* best-effort */ }
              }
            }
          } catch (_e) { /* best-effort */ }
        }
        return hit;
      };

      // 1) entity_id — caller already knows the row (e.g. immediately after save)
      if (req.query.entity_id) {
        const id = sanitize(req.query.entity_id);
        if (id) {
          const hit = await tryQuery(`id=eq.${encodeURIComponent(id)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'entity_id' });
        }
      }

      // 2) source_url — most precise sidebar identity (CoStar listing URL, etc.)
      if (req.query.source_url) {
        const u = sanitize(req.query.source_url);
        if (u && u.length >= 8) {
          const hit = await tryQuery(`metadata->>source_url=eq.${encodeURIComponent(u)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'source_url' });
        }
      }

      // 2b) canonical_url — same site path without query/tracking params.
      //     Round 76ej.i (2026-05-04): added because CREXi eblast URLs
      //     carry recommId / utm_term / templateId tokens that drift
      //     between visits, breaking the exact-eq source_url match. The
      //     extension now strips them and sends the canonical
      //     /properties/<id>/<slug> URL alongside the full source_url.
      if (req.query.canonical_url) {
        const cu = sanitize(req.query.canonical_url);
        if (cu && cu.length >= 8) {
          const hit = await tryQuery(
            `metadata->>source_url=ilike.${encodeURIComponent(cu)}*`
          );
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'canonical_url' });
        }
      }

      // 2c) domain_listing_id + listing_source — site-native listing id
      //     (e.g. CREXi /properties/<id>/, LoopNet listing id).
      //     Stable across listing-status changes and URL rewrites.
      if (req.query.domain_listing_id && req.query.listing_source) {
        const lid = sanitize(req.query.domain_listing_id);
        const ls  = sanitize(req.query.listing_source);
        if (lid && ls) {
          // Try a wildcard match against any source_url that contains
          // /<source>.com/properties/<id>/. Cheap O(n) scan but the
          // workspace_id filter keeps it bounded.
          const pat = `*${ls}.com/properties/${lid}*`;
          const hit = await tryQuery(
            `metadata->>source_url=ilike.${encodeURIComponent(pat)}`
          );
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'domain_listing_id' });
        }
      }

      // 3) parcel_number — survives address re-spellings and re-listings
      if (req.query.parcel_number) {
        const parcel = sanitize(req.query.parcel_number);
        if (parcel && parcel.length >= 3) {
          const hit = await tryQuery(`metadata->>parcel_number=eq.${encodeURIComponent(parcel)}`);
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'parcel_number' });
        }
      }

      // 4) domain_property_id + domain (only useful if caller already knows
      //    which dia/gov row this is — e.g. after a save bootstrap)
      if (req.query.domain_property_id && req.query.domain) {
        const pid = sanitize(req.query.domain_property_id);
        const dom = sanitize(req.query.domain);
        if (pid && dom) {
          const hit = await tryQuery(
            `metadata->>domain_property_id=eq.${encodeURIComponent(pid)}` +
            `&domain=eq.${encodeURIComponent(dom)}`
          );
          if (hit) return res.status(200).json({ entity: hit, matched_via: 'domain_property_id' });
        }
      }

      // 5) + 6) address fallbacks
      const rawAddress = (req.query.address || '').trim();
      if (rawAddress.length < 3) {
        return res.status(400).json({
          error: 'address query parameter required (min 3 chars), or supply entity_id/source_url/parcel_number/domain_property_id'
        });
      }
      const address = rawAddress.replace(/[%_*]/g, '');
      const cityFilter = req.query.city
        ? `&city=ilike.${encodeURIComponent(sanitize(req.query.city))}`
        : '';
      const stateFilter = req.query.state
        ? `&state=eq.${encodeURIComponent(sanitize(req.query.state))}`
        : '';

      // 5) address with Drive↔Dr normalization — covers the common drift
      //    we saw on 1507 Hillview where one row stored "Drive" and another
      //    stored "Dr". Build a wildcard pattern that matches either form.
      const STREET_ALIASES = [
        [/\b(drive)\b/i,    'Dr'],
        [/\b(dr\.?)\b/i,    'Drive'],
        [/\b(street)\b/i,   'St'],
        [/\b(st\.?)\b/i,    'Street'],
        [/\b(avenue)\b/i,   'Ave'],
        [/\b(ave\.?)\b/i,   'Avenue'],
        [/\b(boulevard)\b/i,'Blvd'],
        [/\b(blvd\.?)\b/i,  'Boulevard'],
        [/\b(road)\b/i,     'Rd'],
        [/\b(rd\.?)\b/i,    'Road'],
        [/\b(highway)\b/i,  'Hwy'],
        [/\b(hwy\.?)\b/i,   'Highway'],
        [/\b(parkway)\b/i,  'Pkwy'],
        [/\b(pkwy\.?)\b/i,  'Parkway'],
      ];
      const addressVariants = new Set([address]);
      for (const [re, alt] of STREET_ALIASES) {
        if (re.test(address)) {
          addressVariants.add(address.replace(re, alt));
        }
      }
      // Round 76ej.i (2026-05-04): the extension passes the full address
      // string ("109 Harrison Ave & 1601 Spring St, Jeffersonville, IN
      // 47130") but stored entities typically hold just the street
      // portion ("109 Harrison Ave & 1601 Spring St") with city/state
      // in their own columns. Strip the trailing ", City, ST ZIP" so
      // the exact-ilike pass also tries the bare street form. Adds the
      // street-only variant to the set; address-alias normalization
      // re-runs on it.
      const STRIP_SUFFIX = /,\s*[^,]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/i;
      if (STRIP_SUFFIX.test(address)) {
        const streetOnly = address.replace(STRIP_SUFFIX, '').trim();
        if (streetOnly && streetOnly.length >= 3) {
          addressVariants.add(streetOnly);
          for (const [re, alt] of STREET_ALIASES) {
            if (re.test(streetOnly)) {
              addressVariants.add(streetOnly.replace(re, alt));
            }
          }
        }
      }
      // Try each variant exact-equal first (cheap), then fall through to a
      // pattern match. Stop at the first hit.
      for (const variant of addressVariants) {
        const v = variant.replace(/[%_*]/g, '');
        const hit = await tryQuery(
          `address=ilike.${encodeURIComponent(v)}${cityFilter}${stateFilter}`
        );
        if (hit) {
          return res.status(200).json({
            entity: hit,
            matched_via: variant === address ? 'address' : 'address_alias',
          });
        }
      }

      // 6) Final widest pass — wildcard on the original address. Helps when
      //    the live-page address has a trailing period or apartment suffix
      //    the saved row doesn't have. Limited to 1 row so we don't return
      //    the wrong building for ambiguous fragments.
      const hit = await tryQuery(
        `address=ilike.*${encodeURIComponent(address)}*${cityFilter}${stateFilter}`
      );
      if (hit) return res.status(200).json({ entity: hit, matched_via: 'address_wildcard' });

      return res.status(200).json({ entity: null, matched_via: null });
    }

    // List with filters
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.per_page) || parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * perPage;

    let path = `entities?workspace_id=eq.${workspaceId}&select=id,entity_type,name,domain,city,state,email,org_type,asset_type,created_at`;
    if (entity_type && isValidEnum(entity_type, ENTITY_TYPES)) {
      path += `&entity_type=eq.${entity_type}`;
    }
    if (domain && isValidEnum(domain, DOMAINS)) {
      path += `&domain=eq.${domain}`;
    }
    const rawOrder = req.query.order || 'created_at.desc';
    const safeOrder = /^[a-zA-Z0-9_.,]+$/.test(rawOrder) ? rawOrder : 'created_at.desc';
    path += `&limit=${perPage}&offset=${offset}&order=${safeOrder}`;

    // Paginated entity list — countMode='estimated' for parity with v2 queue.
    const result = await opsQuery('GET', path, undefined, { countMode: 'estimated' });
    return res.status(200).json({
      entities: result.data || [],
      count: result.count,
      pagination: pageMeta(page, perPage, result.count)
    });
  }

  // POST — create entity or link external identity
  if (req.method === 'POST') {
    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    // Generate (or reuse) a grounded property/deal dossier.
    // POST /api/entities?action=generate_dossier  body: { entity_id, kind?, force? }
    //   - assembles the reconciled DATA PACKET (buildPropertyPacket/buildDealPacket)
    //   - generateDossier() → HTML (facts rendered in code; Ollama authors Analysis)
    //   - if the packet hash matches the latest stored dossier and !force, REUSE it
    //   - else recordDossier() stores the HTML + inserts a versioned lcc_dossiers row
    //   - pushes the HTML to SharePoint (Team Briggs - Documents/PROPERTIES/<property>)
    //     best-effort and saves the web URL to metadata.sharepoint_url
    //   - returns { storage_ref, signed_url, sharepoint_url }
    if (req.query.action === 'generate_dossier') {
      let { entity_id } = req.body || {};
      const { force, domain, property_id } = req.body || {};
      const kind = (req.body?.kind === 'deal') ? 'deal' : 'property';

      // R-asset-linking: on-demand entity materialization. A property panel can
      // call generate_dossier with { domain, property_id } for a closed deal that
      // has no asset entity yet — ensure it (and enrich it from the domain DB)
      // so the dossier's Deal Spine / Parties sections fill from live data
      // instead of "Not on file". Idempotent: an existing entity is reused.
      if (!entity_id && domain && property_id != null) {
        const ensured = await ensureAssetEntityForProperty({
          domain, propertyId: property_id, workspaceId, userId: user.id,
          deps: { bridgeSource: 'generate_dossier' },
        });
        if (!ensured.ok || !ensured.entity_id) {
          return res.status(422).json({ error: 'asset_entity_unresolved', detail: ensured.skipped || ensured });
        }
        entity_id = ensured.entity_id;
      }
      if (!entity_id) return res.status(400).json({ error: 'entity_id (or domain + property_id) is required' });

      const entRes = await opsQuery('GET',
        `entities?id=eq.${encodeURIComponent(entity_id)}&workspace_id=eq.${workspaceId}&select=id,name`);
      if (!entRes.ok || !entRes.data?.length) return res.status(404).json({ error: 'Entity not found' });

      const opsUrl = process.env.OPS_SUPABASE_URL;
      const opsKey = process.env.OPS_SUPABASE_KEY;
      const fetchImpl = (u, opts) => fetchWithTimeout(u, opts, 45000);

      let packet;
      try {
        packet = kind === 'deal'
          ? await buildDealPacket(entity_id, workspaceId)
          : await buildPropertyPacket(entity_id, workspaceId);
      } catch (err) {
        return res.status(500).json({ error: 'packet_assembly_failed', detail: err?.message });
      }

      const built = await generateDossier({ kind, packet, entityId: entity_id, title: packet.meta?.title });

      // Freshness: reuse the latest stored dossier when the fact-packet hash is
      // unchanged (source_hash excludes generated_date, so it's a true staleness key).
      if (!force) {
        const prev = await opsQuery('GET',
          `lcc_dossiers?entity_id=eq.${encodeURIComponent(entity_id)}&dossier_type=eq.${kind}` +
          `&select=id,storage_ref,version,source_hash,metadata&order=version.desc&limit=1`).catch(() => null);
        const row = (prev && prev.ok && prev.data?.[0]) || null;
        if (row && row.source_hash && row.source_hash === built.source_hash && row.storage_ref) {
          const resolved = await resolveArtifactDownload({ storageRef: row.storage_ref, opsUrl, opsKey, fetchImpl });
          return res.status(200).json({
            ok: true, reused: true, id: row.id, kind, storage_ref: row.storage_ref, version: row.version,
            signed_url: resolved.ok ? resolved.signed_url : null,
            sharepoint_url: row.metadata?.sharepoint_url || null,
            analysis: built.analysis,
          });
        }
      }

      // Store + version.
      const stored = await recordDossier({
        kind, entityId: entity_id, workspaceId, title: built.title, html: built.html,
        sourceHash: built.source_hash, generatedBy: user.id,
        metadata: { generated_via: 'panel', analysis_ok: built.analysis?.ok || false, ai_model: built.analysis?.model || null },
        opsQuery, opsUrl, opsKey, fetchImpl,
      });
      if (!stored.ok) return res.status(502).json({ error: 'record_failed', detail: stored.insert_error || stored.error });

      const resolved = await resolveArtifactDownload({ storageRef: stored.storage_ref, opsUrl, opsKey, fetchImpl });

      // Best-effort SharePoint push (HTML) — never blocks the dossier response.
      let sharepointUrl = null;
      try {
        const label = String(packet.meta?.property_label || 'Property').replace(/[\\/]+/g, '-').slice(0, 120);
        const root = process.env.SHAREPOINT_DOSSIER_ROOT || 'Team Briggs - Documents/PROPERTIES';
        const sp = await uploadDocToFolder({
          folderPath: `${root}/${label}`,
          fileName: `${kind}-dossier-v${stored.version}.html`,
          bytes: Buffer.from(built.html, 'utf8'),
          fetchImpl: (u, opts) => fetchWithTimeout(u, opts, 30000),
        });
        if (sp.ok && sp.server_relative_url) {
          sharepointUrl = sp.server_relative_url;
          await opsQuery('PATCH', `lcc_dossiers?id=eq.${encodeURIComponent(stored.id)}`,
            { metadata: { generated_via: 'panel', analysis_ok: built.analysis?.ok || false, ai_model: built.analysis?.model || null, sharepoint_url: sharepointUrl } })
            .catch(() => null);
        }
      } catch (_e) { /* SharePoint push is best-effort */ }

      return res.status(200).json({
        ok: true, reused: false, id: stored.id, kind, version: stored.version,
        storage_ref: stored.storage_ref,
        signed_url: resolved.ok ? resolved.signed_url : null,
        sharepoint_url: sharepointUrl,
        analysis: built.analysis,
      });
    }

    // On-demand sidebar extraction processing
    if (req.query.action === 'process_sidebar_extraction') {
      const { entity_id, force } = req.body || {};
      if (!entity_id) {
        return res.status(400).json({ error: 'entity_id is required' });
      }
      try {
        const result = await processSidebarExtraction(entity_id, workspaceId, user.id, { force: !!force });
        if (!result.ok) {
          return res.status(result.error === 'Entity not found' ? 404 : 500).json(result);
        }
        return res.status(200).json(result);
      } catch (err) {
        console.error('[Sidebar pipeline error]', err);
        return res.status(500).json({ error: 'Pipeline processing failed', detail: err?.message });
      }
    }

    // Round 76cx Phase 3: record a listing verification check
    // POST /api/entities?action=record_listing_verification
    // Body: { domain: 'dialysis'|'government', property_id, method, check_result,
    //         asking_price?, cap_rate?, source_url?, notes?, off_market_reason? }
    // Looks up active listings on the property and calls
    // public.lcc_record_listing_check() once per listing. Returns the
    // per-listing decision (state_transitioned + new_status) so the
    // sidebar can toast a meaningful summary.
    if (req.query.action === 'record_listing_verification') {
      const {
        domain,
        property_id,
        method,
        check_result,
        asking_price,
        cap_rate,
        source_url,
        notes,
        off_market_reason,
      } = req.body || {};

      if (!domain || !['dialysis', 'government'].includes(domain)) {
        return res.status(400).json({ error: 'domain must be "dialysis" or "government"' });
      }
      if (!property_id || !Number.isFinite(Number(property_id))) {
        return res.status(400).json({ error: 'property_id (number) is required' });
      }
      const validMethods = ['auto_scrape', 'manual_user', 'sidebar_capture', 'sold_imported'];
      if (!method || !validMethods.includes(method)) {
        return res.status(400).json({ error: `method must be one of ${validMethods.join(', ')}` });
      }
      const validResults = ['still_available', 'price_changed', 'off_market', 'sold', 'unreachable'];
      if (!check_result || !validResults.includes(check_result)) {
        return res.status(400).json({ error: `check_result must be one of ${validResults.join(', ')}` });
      }

      try {
        // Find active listings on this property in the chosen domain.
        // dia uses is_active boolean; gov uses listing_status text.
        const listingFilter = domain === 'dialysis'
          ? `is_active=eq.true`
          : `listing_status=eq.active`;
        const idColumn = 'listing_id';
        const listingsRes = await domainQuery(domain, 'GET',
          `available_listings?property_id=eq.${Number(property_id)}&${listingFilter}&select=${idColumn}&limit=20`);
        if (!listingsRes.ok) {
          return res.status(502).json({ error: 'failed to read available_listings', detail: listingsRes.data });
        }
        let listings = Array.isArray(listingsRes.data) ? listingsRes.data : [];

        // Round 76eg: before deciding to auto-create, look at *any* listing
        // for this property (including inactive/Sold/Stale ones) so we can
        // (a) refuse to create when a recent sale event has been recorded,
        // and (b) prefer reactivating an existing row over inserting a
        // duplicate. Prior versions only checked is_active=true and would
        // happily insert parallel rows whenever the existing one was Sold.
        let autoCreated = null;
        let reactivated = null;
        if (listings.length === 0
            && method === 'sidebar_capture'
            && check_result === 'still_available'
            && asking_price != null && Number(asking_price) > 0) {

          // Refuse to auto-create when the property has a recorded sale
          // within the last 12 months — the user is most likely looking
          // at a stale broker page, not a genuine re-listing. The DB's
          // fn_listing_close_if_sold trigger would immediately flip any
          // row we inserted back to Sold anyway.
          const saleProbeFilter = domain === 'dialysis'
            ? `property_id=eq.${encodeURIComponent(String(property_id))}`
            : `property_id=eq.${Number(property_id)}`;
          const recentSaleRes = await domainQuery(domain, 'GET',
            `property_sale_events?${saleProbeFilter}&sale_date=gte.${
              new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
            }&select=sale_event_id,sale_date,price&order=sale_date.desc&limit=1`);
          if (recentSaleRes.ok && Array.isArray(recentSaleRes.data) && recentSaleRes.data.length) {
            return res.status(409).json({
              error: 'recent_sale_recorded',
              property_id,
              sale_date: recentSaleRes.data[0].sale_date,
              hint: 'A sale was recorded for this property within the last 12 months. Confirm this is a genuine re-listing before creating a fresh available_listings row.',
            });
          }

          // Try reactivating the most-recent inactive listing for this
          // property before inserting. This collapses the
          // sidebar-verify → fresh-row pattern into a single canonical row.
          const reviveFilter = domain === 'dialysis'
            ? `property_id=eq.${Number(property_id)}&is_active=eq.false`
            : `property_id=eq.${Number(property_id)}&listing_status=neq.active`;
          const reviveRes = await domainQuery(domain, 'GET',
            `available_listings?${reviveFilter}&select=*&order=listing_date.desc.nullslast&limit=1`);
          if (reviveRes.ok && Array.isArray(reviveRes.data) && reviveRes.data.length) {
            const prior = reviveRes.data[0];
            // Don't revive Sold rows — those carry sold_date/sold_price
            // and represent a real terminal state. Only revive Stale /
            // Withdrawn / Off Market.
            const status = String(prior.status || prior.listing_status || '').toLowerCase();
            const hasSale = prior.sold_date || prior.sold_price || prior.sale_transaction_id;
            if (!hasSale && !['sold', 'closed', 'closed but obligated'].includes(status)) {
              // Drop paywalled CoStar Suite URLs before persisting
              // (issue #560). Falls back to prior.listing_url so the
              // revive doesn't blank out an already-good URL.
              const safeSourceUrl = sanitizeListingUrl(
                source_url || null,
                `entities-handler:revive:${domain}.available_listings`,
              );
              const patchRow = domain === 'dialysis'
                ? {
                    is_active: true,
                    status: 'Active',
                    last_price: Number(asking_price),
                    current_cap_rate: cap_rate != null ? Number(cap_rate) : prior.current_cap_rate,
                    listing_url: safeSourceUrl || prior.listing_url,
                    last_seen: new Date().toISOString().slice(0, 10),
                    last_verified_at: new Date().toISOString(),
                    off_market_date: null,
                    off_market_reason: null,
                    notes: (prior.notes ? prior.notes + '\n' : '') +
                      `[entities-handler reactivated ${new Date().toISOString().slice(0, 10)}] sidebar verify-still-available`,
                  }
                : {
                    listing_status: 'active',
                    asking_price: Number(asking_price),
                    asking_cap_rate: cap_rate != null ? Number(cap_rate) : prior.asking_cap_rate,
                    source_url: safeSourceUrl || prior.source_url,
                    last_seen_at: new Date().toISOString(),
                    last_verified_at: new Date().toISOString(),
                  };
              const patchRes = await domainQuery(domain, 'PATCH',
                `available_listings?listing_id=eq.${encodeURIComponent(prior.listing_id)}`,
                patchRow,
                { Prefer: 'return=representation' });
              if (patchRes.ok) {
                const revived = Array.isArray(patchRes.data) ? patchRes.data[0] : patchRes.data;
                if (revived?.listing_id) {
                  reactivated = revived;
                  listings = [{ listing_id: revived.listing_id }];
                  console.log(`[record_listing_verification] reactivated listing_id=${revived.listing_id} for ${domain} property_id=${property_id}`);
                }
              }
            }
          }
        }

        if (listings.length === 0
            && reactivated == null
            && method === 'sidebar_capture'
            && check_result === 'still_available'
            && asking_price != null && Number(asking_price) > 0) {
          // Round 76dy: dia.available_listings has no data_source column (only
          // notes); gov uses listing_source not data_source. The prior
          // payload tried to insert data_source on both, which crashed dia
          // INSERTs with "column does not exist" → the verify button toast
          // showed "auto-create attempted but failed" on every click.
          // Drop paywalled CoStar Suite URLs before persisting
          // (issue #560). Same logic as the revive branch above.
          const safeSourceUrlForCreate = sanitizeListingUrl(
            source_url || null,
            `entities-handler:create:${domain}.available_listings`,
          );
          const newListing = domain === 'dialysis'
            ? {
                property_id: Number(property_id),
                is_active: true,
                listing_date: new Date().toISOString().slice(0, 10),
                // R70 B3/B4: no true list-date signal in the verify path —
                // tag as capture-fallback so new-to-market counts can exclude it.
                listing_date_source: 'capture_date_fallback',
                // T4c: no market-entry evidence in the verify path → on_market_date
                // HELD (null) so the row is excluded from the timing/DOM series.
                on_market_date_source: 'unestablished',
                on_market_date_confidence: 'none',
                last_price: Number(asking_price),
                current_cap_rate: cap_rate != null ? Number(cap_rate) : null,
                listing_url: safeSourceUrlForCreate,
                last_seen: new Date().toISOString().slice(0, 10),
                last_verified_at: new Date().toISOString(),
                notes: 'auto-created by LCC sidebar verify-still-available',
              }
            : {
                property_id: Number(property_id),
                listing_status: 'active',
                listing_date: new Date().toISOString().slice(0, 10),
                listing_date_source: 'capture_date_fallback',
                on_market_date_source: 'unestablished',
                on_market_date_confidence: 'none',
                asking_price: Number(asking_price),
                asking_cap_rate: cap_rate != null ? Number(cap_rate) : null,
                source_url: safeSourceUrlForCreate,
                first_seen_at: new Date().toISOString(),
                last_seen_at: new Date().toISOString(),
                last_verified_at: new Date().toISOString(),
                listing_source: 'lcc_sidebar_verify',
              };
          const createRes = await domainQuery(domain, 'POST', 'available_listings', newListing);
          if (createRes.ok) {
            const created = Array.isArray(createRes.data) ? createRes.data[0] : createRes.data;
            if (created?.listing_id) {
              autoCreated = created;
              listings = [{ listing_id: created.listing_id }];
              console.log(`[record_listing_verification] auto-created listing_id=${created.listing_id} for ${domain} property_id=${property_id}`);
            }
          } else {
            console.warn('[record_listing_verification] auto-create failed:', createRes.status, createRes.data);
          }
        }

        if (listings.length === 0) {
          return res.status(404).json({
            error: 'no active listings on this property',
            property_id,
            hint: asking_price ? 'auto-create attempted but failed' : 'pass asking_price to auto-create on first verify',
          });
        }

        const results = [];
        for (const l of listings) {
          const rpcRes = await domainQuery(domain, 'POST', 'rpc/lcc_record_listing_check', {
            p_listing_id: l.listing_id,
            p_method: method,
            p_check_result: check_result,
            p_asking_price: asking_price != null ? Number(asking_price) : null,
            p_cap_rate: cap_rate != null ? Number(cap_rate) : null,
            p_source_url: source_url || null,
            p_off_market_reason: off_market_reason || null,
            p_notes: notes || null,
            p_verified_by: user.id || null,
          }, { label: 'entitiesHandler:recordListingCheck' });
          if (!rpcRes.ok) {
            results.push({ listing_id: l.listing_id, ok: false, error: rpcRes.data });
            continue;
          }
          // RPC returns a row with verification_id, status_history_id,
          // state_transitioned, new_status.
          const decision = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
          results.push({ listing_id: l.listing_id, ok: true, ...decision });
        }
        const okCount = results.filter(r => r.ok).length;
        return res.status(200).json({
          ok: okCount > 0,
          property_id,
          domain,
          method,
          check_result,
          listings_verified: okCount,
          listings_total: listings.length,
          auto_created: autoCreated ? { listing_id: autoCreated.listing_id } : null,
          results,
        });
      } catch (err) {
        console.error('[record_listing_verification error]', err);
        return res.status(500).json({ error: 'Verification failed', detail: err?.message });
      }
    }

    // Add alias
    if (req.query.action === 'add_alias') {
      const { entity_id, alias_name, source } = req.body || {};
      if (!entity_id || !alias_name) {
        return res.status(400).json({ error: 'entity_id and alias_name are required' });
      }

      const alias_canonical = alias_name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const result = await opsQuery('POST', 'entity_aliases', {
        workspace_id: workspaceId,
        entity_id,
        alias_name: alias_name.trim(),
        alias_canonical,
        source: source || 'manual'
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to add alias', detail: result.data });
      }
      return res.status(201).json({ alias: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    if (req.query.action === 'set_precedence') {
      const { field_name, source_system, precedence } = req.body || {};
      const parsed = Number(precedence);
      if (!field_name || !source_system || Number.isNaN(parsed)) {
        return res.status(400).json({ error: 'field_name, source_system, and numeric precedence are required' });
      }

      const result = await opsQuery('POST', 'source_precedence', {
        workspace_id: workspaceId,
        field_name: String(field_name).trim(),
        source_system: String(source_system).trim(),
        precedence: parsed
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to set source precedence', detail: result.data });
      }
      return res.status(201).json({ precedence: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    // Merge two entities — moves all relationships, identities, aliases, actions, inbox items to target
    if (req.query.action === 'merge') {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Manager role required to merge entities' });
      }

      const { target_id, source_id } = req.body || {};
      if (!target_id || !source_id) {
        return res.status(400).json({ error: 'target_id and source_id are required' });
      }
      if (target_id === source_id) {
        return res.status(400).json({ error: 'Cannot merge entity with itself' });
      }

      // Verify both entities exist
      const [targetRes, sourceRes] = await Promise.all([
        opsQuery('GET', `entities?id=eq.${target_id}&workspace_id=eq.${workspaceId}&select=id,name`),
        opsQuery('GET', `entities?id=eq.${source_id}&workspace_id=eq.${workspaceId}&select=id,name`)
      ]);

      if (!targetRes.data?.length) return res.status(404).json({ error: 'Target entity not found' });
      if (!sourceRes.data?.length) return res.status(404).json({ error: 'Source entity not found' });

      const targetEntity = targetRes.data[0];
      const sourceEntity = sourceRes.data[0];

      // Canonical merge (Tier 3 Phase 2, 2026-06-16): route through
      // lcc_merge_entity FIRST — the BD-doctrine merge that PK-safely carries
      // lcc_entity_portfolio_facts + external_identities and tombstones the
      // loser. The older hand-rolled path moved aliases/relationships/ops rows
      // but DROPPED the portfolio edges entirely, silently orphaning BD-graph
      // data on every merge. We now do BOTH: the RPC owns the BD graph
      // (portfolio_facts + external_identities), and the PATCHes below move only
      // the ops tables the RPC does NOT cover — no orphans on either graph.
      const mergeRpc = await opsQuery('POST', 'rpc/lcc_merge_entity',
        { p_loser: source_id, p_winner: target_id });
      if (!mergeRpc.ok) {
        return res.status(502).json({ error: 'merge_failed', detail: mergeRpc.data });
      }

      // Move aliases from source to target (external_identities already moved by
      // the RPC).
      await opsQuery('PATCH',
        `entity_aliases?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Add source name as alias on target
      const sourceCanonical = sourceEntity.name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      await opsQuery('POST', 'entity_aliases', {
        workspace_id: workspaceId,
        entity_id: target_id,
        alias_name: sourceEntity.name,
        alias_canonical: sourceCanonical,
        source: `merged_from:${source_id}`
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      // Move relationships
      await opsQuery('PATCH',
        `entity_relationships?from_entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { from_entity_id: target_id }
      );
      await opsQuery('PATCH',
        `entity_relationships?to_entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { to_entity_id: target_id }
      );

      // Move action items
      await opsQuery('PATCH',
        `action_items?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Move activity events
      await opsQuery('PATCH',
        `activity_events?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Move watchers
      await opsQuery('PATCH',
        `watchers?entity_id=eq.${source_id}&workspace_id=eq.${workspaceId}`,
        { entity_id: target_id }
      );

      // Log merge activity
      await opsQuery('POST', 'activity_events', {
        workspace_id: workspaceId,
        actor_id: user.id,
        entity_id: target_id,
        category: 'system',
        title: `Merged entity "${sourceEntity.name}" into "${targetEntity.name}"`,
        source_type: 'system',
        visibility: 'shared',
        metadata: {
          merge_source_id: source_id,
          merge_source_name: sourceEntity.name,
          merge_target_id: target_id,
          merge_target_name: targetEntity.name
        },
        occurred_at: new Date().toISOString()
      });

      // Merges change entity membership (SPE/parent + queue) — refresh the
      // caches, parity with the Decision Center merge_duplicate_entities path.
      try { await opsQuery('POST', 'rpc/lcc_refresh_buyer_spe_resolved', {}); } catch (_e) { /* soft */ }
      try { await opsQuery('POST', 'rpc/lcc_refresh_priority_queue_resolved', {}); } catch (_e) { /* soft */ }

      // Delete source entity (portfolio + identities now live on target via the
      // RPC; aliases/relationships/ops rows moved above).
      await opsQuery('DELETE',
        `entities?id=eq.${source_id}&workspace_id=eq.${workspaceId}`
      );

      const mergeStats = (Array.isArray(mergeRpc.data) && mergeRpc.data[0]) ? mergeRpc.data[0] : {};
      return res.status(200).json({
        merged: true,
        target: targetEntity,
        source_removed: sourceEntity,
        portfolio_edges_moved: mergeStats.portfolio_edges_moved ?? null,
        external_identities_moved: mergeStats.external_identities_moved ?? null,
        message: `"${sourceEntity.name}" merged into "${targetEntity.name}". Source entity deleted.`
      });
    }

    // R4 Phase-4 Tier A: resolve a single provenance conflict/skip row.
    //
    // Body: { provenance_id: <bigint>,
    //         chosen: 'current'|'attempted'|'custom'|'junk'|'defer',
    //         custom_value: <any>,   // required iff chosen='custom'
    //         notes: <string> }      // optional
    //
    // Flow:
    //   1. Validate body + load attempted row from field_provenance
    //   2. For chosen in {attempted, custom}: call the domain DB's
    //      lcc_apply_field_resolution RPC; abort early on failure
    //   3. Call LCC Opps lcc_record_field_resolution to atomically:
    //      insert resolutions row, insert new manual_resolution
    //      provenance row (if writing), supersede prior rows.
    //
    // Manager role gate. Domain write is reversible via the
    // before_value in resolutions.domain_write_response.
    if (req.query.action === 'resolve_provenance_conflict') {
      if (!requireRole(user, 'manager', workspaceId)) {
        return res.status(403).json({ error: 'Manager role required to resolve provenance conflicts' });
      }

      const body = req.body || {};
      const provenance_id = body.provenance_id;
      const chosen        = body.chosen;
      const custom_value  = body.custom_value;
      const notes         = body.notes || null;

      const VALID_CHOSEN = new Set(['current','attempted','custom','junk','defer']);
      if (!Number.isFinite(Number(provenance_id))) {
        return res.status(400).json({ error: 'provenance_id (bigint) is required' });
      }
      if (!VALID_CHOSEN.has(chosen)) {
        return res.status(400).json({ error: `chosen must be one of ${[...VALID_CHOSEN].join(', ')}` });
      }
      if (chosen === 'custom' && (custom_value === undefined)) {
        return res.status(400).json({ error: 'custom_value is required when chosen=custom' });
      }

      // 1. Load the attempted row from LCC Opps
      const fpRes = await opsQuery('GET',
        `field_provenance?id=eq.${Number(provenance_id)}&select=id,target_database,target_table,record_pk_value,field_name,value,source,decision&limit=1`
      );
      if (!fpRes.ok || !fpRes.data?.length) {
        return res.status(404).json({ error: 'provenance row not found' });
      }
      const fp = fpRes.data[0];

      if (!['conflict','skip'].includes(fp.decision)) {
        return res.status(409).json({ error: `row no longer resolvable (decision=${fp.decision})`, decision: fp.decision });
      }

      // 2. Compute chosen_value + decide whether a domain write is needed.
      //    - 'current'  : no domain write; resolver picks the current value.
      //    - 'attempted': write the attempted value (fp.value) to the domain DB.
      //    - 'custom'   : write the reviewer-typed value.
      //    - 'junk'     : no domain write; flag attempted as junk.
      //    - 'defer'    : no domain write; queue re-review in 7d.
      let chosen_value_jsonb = null;
      let needsDomainWrite = false;
      if (chosen === 'attempted') {
        chosen_value_jsonb = fp.value;        // field_provenance.value is already JSONB
        needsDomainWrite = true;
      } else if (chosen === 'custom') {
        chosen_value_jsonb = custom_value;    // serialized as JSONB through the RPC call
        needsDomainWrite = true;
      }

      // 3. Domain DB write (if needed)
      let domainWriteOk = null;
      let domainWriteResponse = null;
      if (needsDomainWrite) {
        // Map LCC's target_database -> domain key + strip schema prefix from target_table
        let domain = null;
        let unqualifiedTable = fp.target_table;
        if (fp.target_database === 'dia_db' && fp.target_table.startsWith('dia.')) {
          domain = 'dialysis';
          unqualifiedTable = fp.target_table.slice('dia.'.length);
        } else if (fp.target_database === 'gov_db' && fp.target_table.startsWith('gov.')) {
          domain = 'government';
          unqualifiedTable = fp.target_table.slice('gov.'.length);
        } else {
          return res.status(400).json({
            error: 'Domain DB writes only supported for dia_db / gov_db with schema-prefixed target_table',
            target_database: fp.target_database, target_table: fp.target_table,
          });
        }

        const rpcRes = await domainQuery(domain, 'POST', 'rpc/lcc_apply_field_resolution', {
          p_target_table: unqualifiedTable,
          p_record_pk:    String(fp.record_pk_value),
          p_field_name:   fp.field_name,
          p_new_value:    chosen_value_jsonb,
          p_workspace_id: workspaceId,
          p_resolved_by:  user.id,
        }, {}, { label: 'resolve_provenance_conflict' });

        domainWriteResponse = rpcRes.data;
        domainWriteOk = !!(rpcRes.ok && rpcRes.data && rpcRes.data.ok);

        if (!domainWriteOk) {
          // Surface the domain envelope so the UI can show the specific error
          // (schema_ok=false / row-not-found / SQL error) without guessing.
          return res.status(502).json({
            error: 'Domain DB write failed',
            domain, target_table: unqualifiedTable,
            field_name: fp.field_name, record_pk: fp.record_pk_value,
            domain_write_response: rpcRes.data,
          });
        }
      }

      // 4. Atomic LCC-side resolution write
      const recordRes = await opsQuery('POST', 'rpc/lcc_record_field_resolution', {
        p_attempted_provenance_id: Number(provenance_id),
        p_chosen:                  chosen,
        p_chosen_value:            chosen_value_jsonb,
        p_workspace_id:            workspaceId,
        p_resolved_by:             user.id,
        p_decision_notes:          notes,
        p_domain_write_ok:         domainWriteOk,
        p_domain_write_response:   domainWriteResponse,
      });
      if (!recordRes.ok) {
        return res.status(500).json({
          error: 'Failed to record resolution on LCC Opps',
          detail: recordRes.data,
          // domain write already succeeded (if any); operator will need to inspect
          domain_write_ok: domainWriteOk,
          domain_write_response: domainWriteResponse,
        });
      }
      const resolution_id = Array.isArray(recordRes.data) ? recordRes.data[0] : recordRes.data;

      return res.status(200).json({
        ok: true,
        resolution_id,
        chosen,
        domain_write_ok: domainWriteOk,
        domain_write_response: domainWriteResponse,
      });
    }

    // Link external identity
    if (req.query.action === 'link') {
      const { entity_id, source_system, source_type, external_id, external_url, metadata } = req.body || {};
      if (!entity_id || !source_system || !source_type || !external_id) {
        return res.status(400).json({ error: 'entity_id, source_system, source_type, and external_id are required' });
      }

      // R4-A: canonicalize before writing so manual/API links can't introduce
      // a deprecated domain-DB spelling (dia_db/gov_supabase/…).
      const canonSystem = canonicalIdentitySystem(source_system);
      let canonType = source_type;
      if (CANONICAL_DOMAIN_SYSTEMS.includes(canonSystem)) {
        canonType = canonicalDomainSourceType(source_type) || source_type;
      }

      const result = await opsQuery('POST', 'external_identities', {
        workspace_id: workspaceId,
        entity_id,
        source_system: canonSystem,
        source_type: canonType,
        external_id,
        external_url: external_url || null,
        metadata: metadata || {},
        last_synced_at: new Date().toISOString()
      }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

      if (!result.ok) {
        return res.status(result.status).json({ error: 'Failed to link identity', detail: result.data });
      }

      return res.status(201).json({ identity: Array.isArray(result.data) ? result.data[0] : result.data });
    }

    // Create entity
    const { entity_type, name, domain: entityDomain, metadata, ...fields } = req.body || {};

    if (!entity_type || !isValidEnum(entity_type, ENTITY_TYPES)) {
      return res.status(400).json({ error: `entity_type must be one of: ${ENTITY_TYPES.join(', ')}` });
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Build canonical name for dedup
    const canonical_name = name.trim().toLowerCase()
      .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Pre-insert dedup check for assets: match on normalized address + city.
    // Exact ilike on raw address misses common abbreviation variants
    // ("Street" vs "St", "Road" vs "Rd"), which lets CoStar create a duplicate
    // every time it spells a street type differently from the CMS record.
    const pickedFields = pickEntityFields(entity_type, fields);
    // Strip CoStar/LoopNet listing-status prefixes ("For Sale | ", "For Lease | ", …)
    // off the address before dedup or storage. Without this the prefixed string
    // becomes the dedup key and creates a duplicate asset entity for every
    // re-capture of an active listing.
    if (entity_type === 'asset' && pickedFields.address) {
      pickedFields.address = stripListingStatusPrefix(pickedFields.address).trim();
    }
    if (entity_type === 'asset' && pickedFields.address && pickedFields.city) {
      const normAddr = normalizeAddress(pickedFields.address);
      const rawAddr  = pickedFields.address.trim();
      const city = pickedFields.city.trim();
      const state = pickedFields.state;
      // Round 76s (2026-04-27): ilike on state matches 'SC' to stored
      // 'South Carolina' (and vice versa) — eq missed across format split.
      const stateClause = state ? `&state=ilike.${encodeURIComponent(state)}` : '';
      const dedupPath = `entities?entity_type=eq.asset` +
        `&address=ilike.${encodeURIComponent(normAddr)}` +
        `&city=ilike.${encodeURIComponent(city)}` +
        stateClause +
        `&workspace_id=eq.${workspaceId}` +
        `&select=id,domain,metadata` +
        `&order=domain.nullslast,updated_at.desc` +
        `&limit=5`;
      let dupCheck = await opsQuery('GET', dedupPath);
      // Round 76s: Fallback when normAddr ilike misses — try RAW address.
      // Same Round 76m bug pattern: ilike-without-wildcards is exact match,
      // so '3919 mayfair st' lookup misses '3919 Mayfair Street' stored.
      if ((!dupCheck.ok || !dupCheck.data?.length) && rawAddr && rawAddr !== normAddr) {
        const rawDedupPath = `entities?entity_type=eq.asset` +
          `&address=ilike.${encodeURIComponent(rawAddr)}` +
          `&city=ilike.${encodeURIComponent(city)}` +
          stateClause +
          `&workspace_id=eq.${workspaceId}` +
          `&select=id,domain,metadata` +
          `&order=domain.nullslast,updated_at.desc` +
          `&limit=5`;
        const rawDupCheck = await opsQuery('GET', rawDedupPath);
        if (rawDupCheck.ok && rawDupCheck.data?.length) dupCheck = rawDupCheck;
      }
      if (dupCheck.ok && dupCheck.data?.length) {
        // Among matches, prefer the one with domain + domain_property_id set
        const candidates = dupCheck.data;
        const existing = candidates.find(e =>
          e.domain &&
          e.metadata?.domain_property_id
        ) || candidates[0];

        // Found existing entity — update metadata with new extraction data.
        // Merge: prefer incoming non-null values over existing values.
        if (metadata && Object.keys(metadata).length > 0) {
          const existingMeta = existing.metadata || {};
          const incomingMeta = metadata;

          const mergedMeta = { ...existingMeta };
          for (const [key, val] of Object.entries(incomingMeta)) {
            if (val !== undefined && val !== null) {
              mergedMeta[key] = val;
            } else if (val === null) {
              // Explicit null clears stale bad values for tracked fields
              const TRACKED = ['cap_rate', 'noi', 'tenant_name', 'primary_tenant',
                'city', 'state', 'zip_code', 'parcel_number', 'assessed_value',
                'land_value', 'improvement_value'];
              if (TRACKED.includes(key)) mergedMeta[key] = null;
            }
          }
          mergedMeta._pipeline_status = null; // reset so pipeline re-runs

          const patchResult = await opsQuery(
            'PATCH',
            `entities?id=eq.${existing.id}&workspace_id=eq.${workspaceId}`,
            { metadata: mergedMeta, updated_at: new Date().toISOString() }
          );

          // Re-trigger pipeline with the fresh merged metadata
          if (patchResult.ok && hasSidebarData(mergedMeta)) {
            const patched = Array.isArray(patchResult.data)
              ? patchResult.data[0] : patchResult.data;
            if (patched?.id) {
              processSidebarExtraction(patched.id, workspaceId, user.id)
                .catch(err => console.error('[Dedup pipeline re-trigger]',
                  err?.message || err));
            }
          }
        }

        return res.status(200).json({ entity: existing, deduplicated: true });
      }
    }

    const entity = {
      workspace_id: workspaceId,
      entity_type,
      name: name.trim(),
      canonical_name,
      // 5th dia/gov alias bug (2026-06-07): canonicalize entities.domain so a
      // 'dialysis'/'government' body value writes the short form.
      domain: canonicalEntityDomain(entityDomain) || null,
      created_by: user.id,
      metadata: metadata || {},
      ...pickedFields
    };

    // Store a normalized copy of the street address on assets so future
    // dedup lookups can match on an abbreviation-stable key.
    if (entity_type === 'asset' && pickedFields.address) {
      entity.normalized_address = normalizeAddress(pickedFields.address);
    }

    const result = await opsQuery('POST', 'entities', entity);
    if (!result.ok) {
      return res.status(result.status).json({ error: 'Failed to create entity', detail: result.data });
    }

    const created = Array.isArray(result.data) ? result.data[0] : result.data;

    // Fire-and-forget: signal for listing-as-BD pipeline when an asset/listing is created
    if (entity_type === 'asset' && created?.state) {
      writeListingCreatedSignal(created, user);
    }

    // Fire-and-forget: unpack sidebar extraction data (contacts, sales, domain classification)
    if (entity_type === 'asset' && created?.id && hasSidebarData(metadata)) {
      processSidebarExtraction(created.id, workspaceId, user.id)
        .catch(err => console.error('[Sidebar pipeline async error]', err?.message || err));
    }

    return res.status(201).json({ entity: created });
  }

  // PATCH — update entity
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id query parameter required' });

    if (!requireRole(user, 'operator', workspaceId)) {
      return res.status(403).json({ error: 'Operator role required' });
    }

    const { name, domain: entityDomain, tags, metadata, ...fields } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };

    if (name) {
      updates.name = name.trim();
      updates.canonical_name = name.trim().toLowerCase()
        .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (entityDomain !== undefined) updates.domain = canonicalEntityDomain(entityDomain);
    if (tags !== undefined) updates.tags = tags;
    if (metadata !== undefined) updates.metadata = metadata;

    // Pick type-appropriate fields
    const allowedFields = ['description', 'first_name', 'last_name', 'title', 'phone', 'email',
      'org_type', 'address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) updates[f] = fields[f];
    }

    const result = await opsQuery('PATCH',
      `entities?id=eq.${id}&workspace_id=eq.${workspaceId}`,
      updates
    );
    if (!result.ok) return res.status(result.status).json({ error: 'Failed to update entity' });

    const updated = Array.isArray(result.data) ? result.data[0] : result.data;

    // Fire-and-forget: if metadata was updated with new sidebar data, run the pipeline
    if (metadata && updated?.id && updated?.entity_type === 'asset' && hasSidebarData(metadata)) {
      processSidebarExtraction(updated.id, workspaceId, user.id)
        .catch(err => console.error('[Sidebar pipeline async error on PATCH]', err?.message || err));
    }

    return res.status(200).json({ entity: updated });
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed` });
});

// ============================================================================
// Contact 360 helpers (shared by action=portfolio + action=contact360)
// ============================================================================

/**
 * Authoritative BD-spine portfolio for an entity: the v_entity_portfolio_all
 * rollup + the per-property lcc_entity_portfolio_facts ⋈ lcc_property_attributes
 * rows (owns/former via is_current). Returns { rollup, properties }.
 */
async function fetchEntityPortfolio(entityId, workspaceId) {
  const [rollupRes, factsRes] = await Promise.all([
    opsQuery('GET',
      `v_entity_portfolio_all?entity_id=eq.${entityId}&workspace_id=eq.${workspaceId}` +
      `&select=entity_id,name,owner_role,primary_domain,total_property_count,current_property_count,` +
      `dia_property_count,gov_property_count,is_cross_vertical,current_annual_rent_total,avg_cap_rate,` +
      `earliest_acquisition_date,latest_acquisition_date&limit=1`),
    opsQuery('GET',
      `lcc_entity_portfolio_facts?entity_id=eq.${entityId}` +
      `&select=source_domain,source_property_id,is_current,annual_rent,sale_price,cap_rate,` +
      `ownership_start_date,ownership_end_date,ownership_source` +
      `&order=is_current.desc,annual_rent.desc.nullslast&limit=500`)
  ]);

  const rollup = (rollupRes.ok && rollupRes.data?.length) ? rollupRes.data[0] : null;
  const facts = (factsRes.ok && Array.isArray(factsRes.data)) ? factsRes.data : [];

  // Batch-fetch property attributes for address / tenant / city. The two mirrors
  // share (source_domain, source_property_id) but carry no declared FK, so
  // PostgREST can't embed — fetch per-domain id sets + merge in JS.
  const idsByDomain = {};
  for (const f of facts) {
    const dom = f.source_domain;
    if (!dom || f.source_property_id == null) continue;
    (idsByDomain[dom] = idsByDomain[dom] || []).push(String(f.source_property_id));
  }
  const attrMap = {};
  await Promise.all(Object.entries(idsByDomain).map(async ([dom, ids]) => {
    const uniq = Array.from(new Set(ids));
    for (let i = 0; i < uniq.length; i += 200) {
      const chunk = uniq.slice(i, i + 200);
      const inList = chunk.map(v => encodeURIComponent(v)).join(',');
      const ar = await opsQuery('GET',
        `lcc_property_attributes?source_domain=eq.${encodeURIComponent(dom)}` +
        `&source_property_id=in.(${inList})` +
        `&select=source_domain,source_property_id,address,city,state,tenant_short,tenant_label,` +
        `building_type,asset_class,annual_rent,noi`);
      if (ar.ok && Array.isArray(ar.data)) {
        for (const a of ar.data) attrMap[a.source_domain + ':' + a.source_property_id] = a;
      }
    }
  }));

  const properties = facts.map(f => {
    const a = attrMap[f.source_domain + ':' + f.source_property_id] || {};
    return {
      source_domain: f.source_domain,
      source_property_id: f.source_property_id,
      is_current: f.is_current,
      annual_rent: f.annual_rent != null ? Number(f.annual_rent) : (a.annual_rent != null ? Number(a.annual_rent) : null),
      sale_price: f.sale_price != null ? Number(f.sale_price) : null,
      cap_rate: f.cap_rate != null ? Number(f.cap_rate) : null,
      ownership_start_date: f.ownership_start_date || null,
      ownership_end_date: f.ownership_end_date || null,
      address: a.address || null,
      city: a.city || null,
      state: a.state || null,
      tenant: a.tenant_label || a.tenant_short || null,
      building_type: a.building_type || null,
      asset_class: a.asset_class || null,
    };
  });

  return { rollup, properties };
}

/**
 * Resolve the SF Account owner (the rep who owns the account = the assigned
 * broker for ROE). Reads the sf_owner_name/sf_owner_id captured on the
 * salesforce/Account external_identity's metadata (by the SF sync going forward).
 * Prefers the entity's OWN account identity; falls back to the account of an org
 * the person works_at / is associated_with. Returns { name, sf_owner_id,
 * sf_account_id, source } | null.
 */
async function resolveAccountOwner(entity, entityId, workspaceId) {
  const own = (entity.external_identities || []).find(x =>
    String(x.source_system || '').toLowerCase() === 'salesforce' &&
    String(x.source_type || '').toLowerCase() === 'account');
  if (own && own.metadata && (own.metadata.sf_owner_name || own.metadata.sf_owner_id)) {
    return { name: own.metadata.sf_owner_name || null, sf_owner_id: own.metadata.sf_owner_id || null,
             sf_account_id: own.external_id || null, source: 'entity_account' };
  }

  // Person → org (either edge direction). Fetch related org ids then their
  // Account identity + owner metadata. Best-effort; forward-looking.
  const relRes = await opsQuery('GET',
    `entity_relationships?workspace_id=eq.${workspaceId}` +
    `&or=(from_entity_id.eq.${entityId},to_entity_id.eq.${entityId})` +
    `&relationship_type=in.(works_at,associated_with,owner_parent,managed_by)` +
    `&select=from_entity_id,to_entity_id&limit=50`);
  const orgIds = new Set();
  if (relRes.ok && Array.isArray(relRes.data)) {
    for (const r of relRes.data) {
      if (r.from_entity_id && r.from_entity_id !== entityId) orgIds.add(r.from_entity_id);
      if (r.to_entity_id && r.to_entity_id !== entityId) orgIds.add(r.to_entity_id);
    }
  }
  if (orgIds.size) {
    const inList = Array.from(orgIds).map(v => encodeURIComponent(v)).join(',');
    const orgRes = await opsQuery('GET',
      `external_identities?entity_id=in.(${inList})&source_system=eq.salesforce&source_type=eq.Account` +
      `&select=external_id,metadata&limit=10`);
    if (orgRes.ok && Array.isArray(orgRes.data)) {
      const withOwner = orgRes.data.find(r => r.metadata && (r.metadata.sf_owner_name || r.metadata.sf_owner_id));
      if (withOwner) {
        return { name: withOwner.metadata.sf_owner_name || null, sf_owner_id: withOwner.metadata.sf_owner_id || null,
                 sf_account_id: withOwner.external_id || null, source: 'org_account' };
      }
      if (orgRes.data[0]) {
        return { name: null, sf_owner_id: null, sf_account_id: orgRes.data[0].external_id || null, source: 'org_account' };
      }
    }
  }

  if (own) return { name: null, sf_owner_id: null, sf_account_id: own.external_id || null, source: 'entity_account' };
  return null;
}

/** Aggregate the engagement summary from the entity's unified_contacts row(s). */
function buildEngagement(ucRows) {
  if (!Array.isArray(ucRows) || !ucRows.length) return null;
  let best = ucRows[0];
  for (const u of ucRows) if (Number(u.engagement_score || 0) > Number(best.engagement_score || 0)) best = u;
  return {
    score: best.engagement_score != null ? Number(best.engagement_score) : null,
    last_call: best.last_call_date || null,
    last_email: best.last_email_date || null,
    last_meeting: best.last_meeting_date || null,
    last_activity: best.last_activity_date || null,
    total_calls: best.total_calls || 0,
    total_emails: best.total_emails_sent || 0,
    total_touches: best.total_touches || 0,
    total_transactions: best.total_transactions || 0,
    total_volume: best.total_volume != null ? Number(best.total_volume) : null,
  };
}

// Relationship types that carry each BD role, in priority order. The role
// drives the whole Contact 360 layout (owner-portfolio vs broker deal-intel).
const OWNER_REL_TYPES = new Set(['owns', 'developed']);
const BROKER_REL_TYPES = new Set(['brokers']);
const BUYER_REL_TYPES = new Set(['purchases']);

/**
 * Detect the entity's BD role from its OUT (from-side) relationship edges.
 * owner (owns/developed) > broker (brokers) > buyer (purchases) > contact.
 * A person captured as a "Listing Broker at <firm>" carries `brokers` edges →
 * broker mode. An org/person with owns edges → owner mode. Returns
 * { role, has_owner_edges, has_broker_edges, has_buyer_edges }.
 */
export function detectEntityRole(entity) {
  const edges = Array.isArray(entity?.entity_relationships) ? entity.entity_relationships : [];
  let owner = false, broker = false, buyer = false;
  for (const e of edges) {
    const t = e?.relationship_type;
    if (OWNER_REL_TYPES.has(t)) owner = true;
    else if (BROKER_REL_TYPES.has(t)) broker = true;
    else if (BUYER_REL_TYPES.has(t)) buyer = true;
  }
  // An asset entity is never a contact — but Contact 360 is only opened on
  // person/org, so we key purely on the edges. Priority: owner > broker > buyer.
  let role = 'contact';
  if (owner) role = 'owner';
  else if (broker) role = 'broker';
  else if (buyer) role = 'buyer';
  return { role, has_owner_edges: owner, has_broker_edges: broker, has_buyer_edges: buyer };
}

/**
 * Broker deal intelligence — replaces owner-portfolio for broker entities.
 * Counts deals brokered off the `brokers` OUT edges and splits by
 * metadata.role (listing_broker = represents SELLERS; buyer_broker = represents
 * BUYERS — the signal is on the LCC edge, no cross-DB name-match needed).
 * Target markets = the states/cities of the linked asset entities. Returns
 * { total_deals, represents_sellers, represents_buyers, represents_unknown,
 *   markets:[{state, count}], recent_deals:[{name, city, state, role}] }.
 */
export async function buildBrokerDealIntel(entity, entityId, queryFn = opsQuery) {
  const edges = (Array.isArray(entity?.entity_relationships) ? entity.entity_relationships : [])
    .filter(e => e?.relationship_type === 'brokers' && e.to_entity_id);
  if (!edges.length) {
    return { total_deals: 0, represents_sellers: 0, represents_buyers: 0,
             represents_unknown: 0, markets: [], recent_deals: [] };
  }

  let sellers = 0, buyers = 0, unknown = 0;
  for (const e of edges) {
    const r = String(e.metadata?.role || '').toLowerCase();
    if (r === 'listing_broker') sellers++;
    else if (r === 'buyer_broker') buyers++;
    else unknown++;
  }

  // Resolve the linked asset entities (name / city / state) for target markets
  // + a recent-deals sample. Asset entities carry city/state directly.
  const assetIds = Array.from(new Set(edges.map(e => e.to_entity_id)));
  const assetById = {};
  for (let i = 0; i < assetIds.length; i += 200) {
    const inList = assetIds.slice(i, i + 200).map(v => encodeURIComponent(v)).join(',');
    const ar = await queryFn('GET',
      `entities?id=in.(${inList})&select=id,name,city,state`).catch(() => null);
    if (ar && ar.ok && Array.isArray(ar.data)) for (const a of ar.data) assetById[a.id] = a;
  }

  const marketCounts = {};
  const recent = [];
  for (const e of edges) {
    const a = assetById[e.to_entity_id] || {};
    const st = (a.state || '').trim().toUpperCase();
    if (st) marketCounts[st] = (marketCounts[st] || 0) + 1;
    const r = String(e.metadata?.role || '').toLowerCase();
    recent.push({
      name: a.name || null, city: a.city || null, state: st || null,
      role: r === 'listing_broker' ? 'seller' : r === 'buyer_broker' ? 'buyer' : 'unknown',
      at: e.metadata?.extracted_at || e.created_at || null,
    });
  }
  const markets = Object.entries(marketCounts)
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count);
  recent.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  return {
    total_deals: edges.length,
    represents_sellers: sellers,
    represents_buyers: buyers,
    represents_unknown: unknown,
    markets,
    recent_deals: recent.slice(0, 15),
  };
}

function contactRoleLabel(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'owns' || r === 'owner') return 'Owner';
  if (r === 'operator' || r === 'operates' || r === 'managed_by') return 'Operator';
  if (r === 'listing_broker') return 'Listing broker';
  if (r === 'procuring_broker' || r === 'buyer_broker') return 'Procuring broker';
  if (r === 'broker' || r === 'brokers') return 'Broker';
  if (r === 'attorney') return 'Attorney';
  if (r === 'title') return 'Title';
  if (r === 'lender' || r === 'finances') return 'Lender';
  if (r === 'buyer' || r === 'purchases') return 'Buyer';
  if (r === 'seller' || r === 'sells') return 'Seller';
  if (r === 'developer' || r === 'developed') return 'Developer';
  if (r === 'guarantor' || r === 'guaranteed_by') return 'Guarantor';
  if (r === 'deal_party') return 'Deal party';
  return r ? r.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) : 'Other';
}

function groupByRole(rows) {
  const grouped = {};
  for (const row of rows || []) {
    const label = contactRoleLabel(row.role || row.sub_role || row.relationship);
    (grouped[label] = grouped[label] || []).push(row);
  }
  return grouped;
}

function normalizeContactProperties(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    subject_entity_id: r.subject_entity_id || null,
    subject_name: r.subject_name || null,
    subject_type: r.subject_type || null,
    via_relationship: r.via_relationship || 'direct',
    role: r.role || r.sub_role || 'party',
    role_label: contactRoleLabel(r.role || r.sub_role),
    sub_role: r.sub_role || null,
    asset_entity_id: r.asset_entity_id || null,
    asset_name: r.asset_name || null,
    domain: r.domain === 'government' ? 'gov' : r.domain === 'dialysis' ? 'dia' : (r.domain || null),
    property_id: r.property_id != null ? String(r.property_id) : null,
    address: r.address || null,
    city: r.city || null,
    state: r.state || null,
    tenant: r.tenant || null,
    effective_from: r.effective_from || null,
    effective_to: r.effective_to || null,
    is_current: r.is_current !== false,
    source: r.source || 'entity_relationships',
  }));
}

function normalizeContactDeals(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    subject_entity_id: r.subject_entity_id || null,
    subject_name: r.subject_name || null,
    subject_type: r.subject_type || null,
    via_relationship: r.via_relationship || 'direct',
    role: r.role || r.sub_role || 'party',
    role_label: contactRoleLabel(r.role || r.sub_role),
    sub_role: r.sub_role || null,
    asset_entity_id: r.asset_entity_id || null,
    asset_name: r.asset_name || null,
    domain: r.domain === 'government' ? 'gov' : r.domain === 'dialysis' ? 'dia' : (r.domain || null),
    property_id: r.property_id != null ? String(r.property_id) : null,
    address: r.address || null,
    deal_id: r.deal_id || null,
    sale_id: r.sale_id || null,
    deal_name: r.deal_name || r.asset_name || r.address || 'Deal',
    stage: r.stage || (r.is_open === false ? 'Closed' : null),
    is_open: r.is_open === true,
    closed_won: r.closed_won === true,
    amount: r.amount != null ? Number(r.amount) : null,
    opened_at: r.opened_at || null,
    closed_at: r.closed_at || r.sale_date || null,
    sale_date: r.sale_date || null,
    next_action: r.next_action || null,
    source: r.source || 'bd_opportunities',
  }));
}

async function fetchNorthmarqSalesForContactProperties(properties) {
  const byDomain = {};
  for (const p of properties || []) {
    if (!p.domain || p.property_id == null) continue;
    (byDomain[p.domain] = byDomain[p.domain] || new Set()).add(String(p.property_id));
  }
  const sales = [];
  await Promise.all(Object.entries(byDomain).map(async ([domain, ids]) => {
    const arr = Array.from(ids);
    for (let i = 0; i < arr.length; i += 150) {
      const chunk = arr.slice(i, i + 150).map(v => encodeURIComponent(v)).join(',');
      const sr = await domainQuery(domain, 'GET',
        `sales_transactions?property_id=in.(${chunk})&is_northmarq=eq.true&transaction_state=eq.live` +
        `&select=sale_id,property_id,is_northmarq,sale_date,sold_price,transaction_state` +
        `&order=sale_date.desc.nullslast&limit=200`).catch(() => null);
      if (sr?.ok && Array.isArray(sr.data)) {
        for (const s of sr.data) sales.push({ ...s, domain });
      }
    }
  }));
  return sales;
}

async function buildContactConnectivity(entityId, propertiesRes, dealsRes) {
  const properties = normalizeContactProperties(propertiesRes?.ok ? propertiesRes.data : []);
  const dealRows = normalizeContactDeals(dealsRes?.ok ? dealsRes.data : []);

  const propByKey = {};
  for (const p of properties) {
    if (p.domain && p.property_id != null) propByKey[p.domain + ':' + String(p.property_id)] = p;
  }

  const salesRows = await fetchNorthmarqSalesForContactProperties(properties).catch(() => []);
  for (const s of salesRows) {
    const p = propByKey[s.domain + ':' + String(s.property_id)] || {};
    dealRows.push({
      subject_entity_id: p.subject_entity_id || null,
      subject_name: p.subject_name || null,
      subject_type: p.subject_type || null,
      via_relationship: p.via_relationship || 'direct',
      role: p.role || 'party',
      role_label: p.role_label || contactRoleLabel(p.role),
      sub_role: p.sub_role || null,
      asset_entity_id: p.asset_entity_id || null,
      asset_name: p.asset_name || null,
      domain: s.domain,
      property_id: s.property_id != null ? String(s.property_id) : null,
      address: p.address || null,
      deal_id: null,
      sale_id: s.sale_id != null ? String(s.sale_id) : null,
      deal_name: p.asset_name || p.address || ('Property ' + s.property_id),
      stage: 'Closed',
      is_open: false,
      closed_won: true,
      amount: s.sold_price != null ? Number(s.sold_price) : null,
      opened_at: null,
      closed_at: s.sale_date || null,
      sale_date: s.sale_date || null,
      next_action: null,
      source: 'sales_transactions',
    });
  }

  const seenDeals = new Set();
  const deals = [];
  for (const d of dealRows) {
    const key = [d.source, d.deal_id || d.sale_id || d.asset_entity_id || '', d.role || '', d.subject_entity_id || ''].join('|');
    if (seenDeals.has(key)) continue;
    seenDeals.add(key);
    deals.push(d);
  }
  deals.sort((a, b) => {
    if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
    return String(b.closed_at || b.opened_at || '').localeCompare(String(a.closed_at || a.opened_at || ''));
  });

  return {
    properties,
    properties_by_role: groupByRole(properties),
    deals,
    deals_by_status: {
      active: deals.filter(d => d.is_open),
      closed: deals.filter(d => !d.is_open),
    },
    deals_by_role: groupByRole(deals),
  };
}

/**
 * Compose the full Contact 360 payload for an entity. Returns null when the
 * entity is missing / not in this workspace. Every sub-fetch is best-effort so a
 * missing dia connection / stale table degrades to an empty block, never a 500.
 */
async function buildContact360(entityId, workspaceId) {
  const entRes = await opsQuery('GET',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}` +
    `&select=*,external_identities(*),entity_relationships!entity_relationships_from_entity_id_fkey(*)`);
  if (!entRes.ok || !entRes.data?.length) return null;
  const entity = entRes.data[0];

  // sf_contact_ids for this entity (salesforce/Contact identities + linked
  // unified_contacts) — the join key for SF activity, engagement, marketing.
  const sfContactIds = new Set();
  for (const x of (entity.external_identities || [])) {
    if (String(x.source_system || '').toLowerCase() === 'salesforce' &&
        String(x.source_type || '').toLowerCase() === 'contact' && x.external_id) {
      sfContactIds.add(String(x.external_id));
    }
  }
  const ucRes = await opsQuery('GET',
    `unified_contacts?entity_id=eq.${entityId}` +
    `&select=unified_id,sf_contact_id,email,engagement_score,last_call_date,last_email_date,` +
    `last_meeting_date,last_activity_date,total_calls,total_emails_sent,total_touches,` +
    `total_transactions,total_volume&limit=25`);
  const ucRows = (ucRes.ok && Array.isArray(ucRes.data)) ? ucRes.data : [];
  for (const u of ucRows) if (u.sf_contact_id) sfContactIds.add(String(u.sf_contact_id));
  const sfIds = Array.from(sfContactIds);
  // dia salesforce_activities.sf_contact_id is overwhelmingly 15-char, but the
  // LCC external_identities are 18-char — a raw match misses every SF activity.
  // Query BOTH forms (15-char base + canonical 18-char) so the fold-in populates.
  const sfIdVariants = new Set();
  for (const id of sfContactIds) {
    const s = String(id).trim();
    if (!s) continue;
    sfIdVariants.add(s);
    const b15 = sf15(s);
    if (b15) { sfIdVariants.add(b15); const c18 = toSf18(b15); if (c18) sfIdVariants.add(c18); }
  }
  const inSf = Array.from(sfIdVariants).map(v => encodeURIComponent(v)).join(',');

  let subjectEmail = entity.email ? String(entity.email).trim().toLowerCase() : null;
  if (!subjectEmail) { const em = ucRows.find(u => u.email)?.email; if (em) subjectEmail = String(em).trim().toLowerCase(); }

  const accountOwner = await resolveAccountOwner(entity, entityId, workspaceId);

  const [portfolio, lccEvents, sfActs, mktRows, emailRel, sfOpenTasks, cadenceRow, contactPropsRes, contactDealsRes] = await Promise.all([
    fetchEntityPortfolio(entityId, workspaceId).catch(() => ({ rollup: null, properties: [] })),
    opsQuery('GET',
      `activity_events?entity_id=eq.${entityId}&workspace_id=eq.${workspaceId}` +
      `&select=occurred_at,created_at,category,title,body,source_type,users!activity_events_actor_id_fkey(display_name)` +
      `&order=occurred_at.desc&limit=40`).then(r => (r.ok && Array.isArray(r.data)) ? r.data : []).catch(() => []),
    sfIds.length
      ? domainQuery('dialysis', 'GET',
          `salesforce_activities?sf_contact_id=in.(${inSf})` +
          `&select=subject,nm_type,task_subtype,activity_date,nm_notes,status,assigned_to,company_name` +
          `&order=activity_date.desc&limit=40`)
          .then(r => (r.ok && Array.isArray(r.data)) ? r.data : []).catch(() => [])
      : Promise.resolve([]),
    sfIds.length
      ? domainQuery('dialysis', 'GET',
          `marketing_leads?sf_contact_id=in.(${inSf})` +
          `&select=source,activity_type,activity_detail,status,touchpoint_count,assigned_to,lead_date,deal_name` +
          `&order=lead_date.desc.nullslast&limit=20`)
          .then(r => (r.ok && Array.isArray(r.data)) ? r.data : []).catch(() => [])
      : Promise.resolve([]),
    subjectEmail
      ? Promise.all([
          opsQuery('POST', 'rpc/lcc_email_relationship', { p_email: subjectEmail })
            .then(r => Array.isArray(r.data) ? (r.data[0] || null) : null).catch(() => null),
          opsQuery('POST', 'rpc/lcc_email_recent', { p_email: subjectEmail, p_limit: 12 })
            .then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
        ]).then(([summary, recent]) => ({ email: subjectEmail, summary, recent })).catch(() => null)
      : Promise.resolve(null),
    // Open SF tasks (Not Started / Open / In Progress) — completed tasks dominate
    // the recent-activity window, so a dedicated open-status query is needed. dia
    // salesforce_activities carries no WhatId, so the linked "opportunity" surfaces
    // via the marketing array's deal_name; the account is company_name.
    sfIds.length
      ? domainQuery('dialysis', 'GET',
          `salesforce_activities?sf_contact_id=in.(${inSf})` +
          `&status=in.(${encodeURIComponent('Not Started')},Open,${encodeURIComponent('In Progress')})` +
          `&select=subject,nm_type,task_subtype,activity_date,status,assigned_to,company_name` +
          `&order=activity_date.desc.nullslast&limit=15`)
          .then(r => (r.ok && Array.isArray(r.data)) ? r.data : []).catch(() => [])
      : Promise.resolve([]),
    // Cadence / next-touch (Scott ask #3) — surface the NEXT scheduled touchpoint
    // + the SUGGESTED touchpoint (phase/template) in the Activity cockpit, and
    // feed the hero next-action resolver. touchpoint_cadence is keyed by
    // entity_id; take the soonest-due active row. Best-effort → null on miss.
    opsQuery('GET',
      `touchpoint_cadence?entity_id=eq.${entityId}&workspace_id=eq.${workspaceId}` +
      `&select=id,phase,priority_tier,next_touch_due,next_touch_type,next_touch_template,` +
      `last_touch_at,last_touch_type,current_touch,emails_sent,emails_replied,calls_connected,` +
      `unsubscribe_status&order=next_touch_due.asc.nullslast&limit=1`)
      .then(r => (r.ok && Array.isArray(r.data)) ? (r.data[0] || null) : null).catch(() => null),
    opsQuery('POST', 'rpc/lcc_contact_properties', { p_entity: entityId, p_limit: 200 }).catch(() => null),
    opsQuery('POST', 'rpc/lcc_contact_deals', { p_entity: entityId, p_limit: 200 }).catch(() => null),
  ]);

  // Normalize the cadence row into a compact `cadence` block with a derived
  // overdue flag + days-until-due (the hero next-action + cockpit read these).
  let cadence = null;
  if (cadenceRow) {
    const due = cadenceRow.next_touch_due ? new Date(cadenceRow.next_touch_due) : null;
    const now = new Date();
    const daysUntil = due ? Math.round((due.getTime() - now.getTime()) / 86400000) : null;
    cadence = {
      cadence_id: cadenceRow.id,
      phase: cadenceRow.phase || null,
      priority_tier: cadenceRow.priority_tier || null,
      next_touch_due: cadenceRow.next_touch_due || null,
      next_touch_type: cadenceRow.next_touch_type || null,
      next_touch_template: cadenceRow.next_touch_template || null,
      last_touch_at: cadenceRow.last_touch_at || null,
      last_touch_type: cadenceRow.last_touch_type || null,
      current_touch: cadenceRow.current_touch != null ? Number(cadenceRow.current_touch) : null,
      emails_sent: cadenceRow.emails_sent != null ? Number(cadenceRow.emails_sent) : null,
      emails_replied: cadenceRow.emails_replied != null ? Number(cadenceRow.emails_replied) : null,
      calls_connected: cadenceRow.calls_connected != null ? Number(cadenceRow.calls_connected) : null,
      unsubscribe_status: cadenceRow.unsubscribe_status || null,
      days_until_due: daysUntil,
      overdue: (daysUntil != null && daysUntil < 0),
      on_cadence: true,
    };
  }

  const openTasks = (Array.isArray(sfOpenTasks) ? sfOpenTasks : []).map(t => ({
    subject: t.subject || '(task)',
    status: t.status || null,
    date: t.activity_date || null,
    account: t.company_name || null,
    type: t.task_subtype || t.nm_type || null,
    assigned_to: t.assigned_to || null,
  }));

  // Person-level ownership / linked properties (Contact 360 refinement): a person
  // often owns via their affiliated org, not directly. Resolve (a) direct
  // owns/purchases edges to asset entities and (b) the first affiliated org's BD
  // portfolio. Reuses the true-owner graph + fetchEntityPortfolio (no new engine).
  let ownedProperties = { direct: [], affiliated: null };
  if (entity.entity_type === 'person') {
    const fromEdges = entity.entity_relationships || [];
    const ownEdges = fromEdges.filter(r => (r.relationship_type === 'owns' || r.relationship_type === 'purchases') && r.to_entity_id);
    if (ownEdges.length) {
      const inIds = Array.from(new Set(ownEdges.map(e => e.to_entity_id))).map(v => encodeURIComponent(v)).join(',');
      const ar = await opsQuery('GET', `entities?id=in.(${inIds})&select=id,name,city,state,entity_type,domain`).catch(() => null);
      const byId = {};
      if (ar && ar.ok && Array.isArray(ar.data)) for (const e of ar.data) byId[e.id] = e;
      ownedProperties.direct = ownEdges.map(e => ({ entity_id: e.to_entity_id, rel: e.relationship_type, ...(byId[e.to_entity_id] || {}) }));
    }
    const orgEdge = fromEdges.find(r => (r.relationship_type === 'associated_with' || r.relationship_type === 'works_at') && r.to_entity_id);
    if (orgEdge) {
      const orgRes = await opsQuery('GET', `entities?id=eq.${orgEdge.to_entity_id}&select=id,name,entity_type`).catch(() => null);
      const org = orgRes && orgRes.ok && orgRes.data && orgRes.data[0];
      if (org) {
        const p = await fetchEntityPortfolio(org.id, workspaceId).catch(() => ({ properties: [] }));
        if (p && Array.isArray(p.properties) && p.properties.length) {
          ownedProperties.affiliated = { org_entity_id: org.id, org_name: org.name, rollup: p.rollup || null, properties: p.properties.slice(0, 25) };
        }
      }
    }
  }

  // Developed edges (a distinct ownership signal from owns/former). Rare; resolve
  // the target entity names best-effort so the panel can label them.
  const developedEdges = (entity.entity_relationships || []).filter(r => r.relationship_type === 'developed' && r.to_entity_id);
  let developed = [];
  if (developedEdges.length) {
    const inDev = Array.from(new Set(developedEdges.map(e => e.to_entity_id))).map(v => encodeURIComponent(v)).join(',');
    const devRes = await opsQuery('GET', `entities?id=in.(${inDev})&select=id,name,city,state`).catch(() => null);
    const nameById = {};
    if (devRes && devRes.ok && Array.isArray(devRes.data)) for (const e of devRes.data) nameById[e.id] = e;
    developed = developedEdges.map(e => ({ entity_id: e.to_entity_id, ...(nameById[e.to_entity_id] || {}) }));
  }

  const dealAssignees = sfActs.map(a => ({ name: a.assigned_to, date: a.activity_date })).filter(a => a.name);
  const roe = computeRoe({ accountOwnerName: accountOwner?.name || null, dealAssignees });
  const engagement = buildEngagement(ucRows);
  const timeline = mergeTimeline(lccEvents, sfActs, { limit: 40 });
  const connectivity = await buildContactConnectivity(entityId, contactPropsRes, contactDealsRes);

  // Role drives the layout. Broker mode replaces owner-portfolio with the
  // deal-intelligence block (deals brokered + buyer/seller representation).
  const roleInfo = detectEntityRole(entity);
  const brokerIntel = roleInfo.role === 'broker'
    ? await buildBrokerDealIntel(entity, entityId).catch(() => null)
    : null;

  return {
    subject: {
      entity_id: entityId,
      name: entity.name,
      entity_type: entity.entity_type,
      domain: entity.domain,
      email: subjectEmail,
      sf_contact_ids: sfIds,
      role: roleInfo.role,
    },
    role: roleInfo.role,
    role_flags: roleInfo,
    broker_intel: brokerIntel,
    entity,
    portfolio,
    developed,
    timeline,
    engagement,
    marketing: mktRows,
    open_tasks: openTasks,
    owned_properties: ownedProperties,
    account_owner: accountOwner,
    roe,
    email_relationship: emailRel,
    cadence,
    contact_properties: connectivity.properties,
    contact_properties_by_role: connectivity.properties_by_role,
    contact_deals: connectivity.deals,
    contact_deals_by_status: connectivity.deals_by_status,
    contact_deals_by_role: connectivity.deals_by_role,
  };
}

/** Pick only fields relevant to the entity type */
function pickEntityFields(type, fields) {
  const picked = {};
  const common = ['description'];
  const person = ['first_name', 'last_name', 'title', 'phone', 'email'];
  const org = ['org_type'];
  const asset = ['address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type'];

  const allowed = [...common,
    ...(type === 'person' ? person : []),
    ...(type === 'organization' ? org : []),
    ...(type === 'asset' ? asset : [])
  ];

  for (const f of allowed) {
    if (fields[f] !== undefined) picked[f] = fields[f];
  }
  return picked;
}
