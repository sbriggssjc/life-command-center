// ============================================================================
// Property → SharePoint folder resolver (Phase 2, Slice 2b)
// Life Command Center
//
// Resolve a (domain, property_id) to its PROPERTIES folder so an LCC-generated
// deliverable can be written back INTO the matched property's own folder. The
// doctrine is "resolve confidently or refuse" — no guessed writes into the
// wrong property folder. Priority order:
//
//   1. KNOWN (most reliable) — the property's most recent
//      property_documents.source_url that lives under …/PROPERTIES/…; take its
//      PARENT directory. Slice 2a's enrich crawl populates these as it maps
//      properties, so a property the read channel has already touched resolves
//      here without any guessing.
//   2. DERIVED (verified) — PROPERTIES/<bucket>/<tenant-folder>/<City, ST> from
//      the property's tenant + city/state. Bucket = first alnum char of the
//      tenant folder (A–Z, else the digit). ONLY used when it matches an
//      EXISTING folder (verified via the List flow); a derived path that does
//      not exist is treated as unresolved (never written to).
//   3. UNRESOLVED — refuse ({ ok:false, reason:'folder_unresolved' }); the
//      caller surfaces it. No silent or mis-placed write.
//
// The pure helpers (bucketOf / deriveFolderCandidates / parentOfPropertiesUrl)
// are exported + unit-tested; resolvePropertyFolder takes injectable deps so the
// orchestration is testable without live SharePoint / domain DBs.
// ============================================================================

import { domainQuery } from './domain-db.js';
import { fetchWithTimeout } from './ops-db.js';

// Site document-library prefix (mirrors folder-feed.js SP_DOC_PREFIX) so the
// derived PROPERTIES root matches the real tree. Configurable for another site.
const SP_DOC_PREFIX = (process.env.SHAREPOINT_DOC_PREFIX || '/sites/TeamBriggs20/Shared Documents').replace(/\/+$/, '');

// The PROPERTIES root for the DERIVED fallback. Overridable; defaults to the
// same root Slice 2a's enrich channel walks.
function propertiesRoot() {
  const raw = (process.env.FOLDER_FEED_PROPERTIES_ROOT || `${SP_DOC_PREFIX}/PROPERTIES`).trim();
  return raw.replace(/\/+$/, '');
}

// Bucket = first alphanumeric char of the tenant/brand folder name, uppercased
// for letters (A–Z) or kept as-is for a digit. Returns null when the name has
// no alnum char (can't derive a bucket → can't derive a path).
export function bucketOf(name) {
  const m = String(name || '').match(/[A-Za-z0-9]/);
  if (!m) return null;
  const ch = m[0];
  return /[A-Za-z]/.test(ch) ? ch.toUpperCase() : ch;
}

/**
 * Build candidate DERIVED folder paths, most-specific first. Each must be
 * verified to EXIST before use (the caller does that via the List flow).
 * @returns {string[]}  server-relative candidate folder paths (single apostrophes)
 */
export function deriveFolderCandidates({ tenant, city, state, root }) {
  const brand = String(tenant || '').trim();
  if (!brand) return [];
  const bucket = bucketOf(brand);
  if (!bucket) return [];
  const base = `${root || propertiesRoot()}/${bucket}/${brand}`;
  const out = [];
  const c = String(city || '').trim();
  const s = String(state || '').trim();
  if (c && s) out.push(`${base}/${c}, ${s}`);
  out.push(base);
  return out;
}

/**
 * Take the PARENT directory of a property_documents.source_url, but ONLY when
 * the path lives under a /PROPERTIES/ subtree. Returns null otherwise so a
 * source_url that is not in the PROPERTIES tree (an http listing URL, a Storage
 * OM's path, …) can never become a write target.
 * @param {string} sourceUrl  server-relative path (or backslash path)
 * @returns {string|null}      the parent folder, server-relative
 */
export function parentOfPropertiesUrl(sourceUrl) {
  const raw = String(sourceUrl || '').replace(/\\/g, '/').trim();
  if (!raw) return null;
  // Reject absolute URLs — a write target is a SharePoint SERVER-RELATIVE path,
  // never an http(s) vendor listing URL (e.g. crexi.com/properties/123/… which
  // carries a lowercase /properties/ segment that would otherwise false-match).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  // Require the SharePoint PROPERTIES segment — matched CASE-SENSITIVELY (the
  // real folder is uppercase "PROPERTIES"), so a vendor /properties/ can't slip
  // through even on a relative path.
  if (!/\/PROPERTIES\//.test(raw)) return null;
  const noTrail = raw.replace(/\/+$/, '');
  const lastSlash = noTrail.lastIndexOf('/');
  if (lastSlash < 1) return null;
  const parent = noTrail.slice(0, lastSlash);
  // Defensive: the parent itself must still be within the PROPERTIES subtree.
  if (!/\/PROPERTIES(\/|$)/.test(parent)) return null;
  return parent;
}

// Per-domain column for the tenant/brand folder name: dia properties carry
// `tenant`; gov properties carry `agency`. Selecting a non-existent column 400s,
// so the select set is domain-specific.
function attrSelect(domain) {
  return (domain === 'government' || domain === 'gov')
    ? 'city,state,agency'
    : 'city,state,tenant';
}

async function fetchPropertyDocUrls(domain, propertyId, dq) {
  const sel = `property_documents?property_id=eq.${encodeURIComponent(propertyId)}&select=source_url`;
  // Prefer most-recent first; gracefully retry without the order in case a
  // domain's property_documents lacks created_at.
  let r = await dq(domain, 'GET', `${sel}&order=created_at.desc&limit=25`).catch(() => ({ ok: false }));
  if (!r.ok) r = await dq(domain, 'GET', `${sel}&limit=25`).catch(() => ({ ok: false }));
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.map(row => row?.source_url).filter(Boolean);
}

async function fetchPropertyAttrs(domain, propertyId, dq) {
  const r = await dq(domain, 'GET',
    `properties?property_id=eq.${encodeURIComponent(propertyId)}&select=${attrSelect(domain)}&limit=1`
  ).catch(() => ({ ok: false }));
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  const row = r.data[0];
  return { tenant: row.tenant ?? row.agency ?? null, city: row.city ?? null, state: row.state ?? null };
}

// Verify a folder EXISTS via the PA "List folder" flow. Returns false on any
// error / when the List flow is unconfigured — the derived fallback then can't
// be confirmed, so resolution refuses (safe by construction). The flow inlines
// folder_path into an OData literal, so apostrophes are doubled at request time.
async function folderExistsViaList(folderPath, fetchImpl) {
  const listUrl = process.env.SHAREPOINT_LIST_URL;
  if (!listUrl) return false;
  const doFetch = fetchImpl || ((u, opts) => fetchWithTimeout(u, opts, 20000));
  try {
    const res = await doFetch(listUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: String(folderPath).replace(/'/g, "''") }),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep */ }
    return !!(res.ok && json?.ok);
  } catch {
    return false;
  }
}

/**
 * Resolve a (domain, property_id) to its PROPERTIES folder. See module header
 * for the priority order. Deps are injectable for testing:
 *   deps.domainQueryImpl   (domain, method, path) => { ok, data }
 *   deps.folderExistsImpl  (folderPath) => Promise<boolean>
 *   deps.fetchImpl         passed to the default folderExists
 *   deps.root              PROPERTIES root override
 * @returns {Promise<{ok:boolean, folder_path?:string, source?:string, reason?:string}>}
 */
export async function resolvePropertyFolder({ domain, propertyId }, deps = {}) {
  if (!domain || propertyId == null) {
    return { ok: false, reason: 'missing_domain_or_property' };
  }
  const dq = deps.domainQueryImpl || domainQuery;
  const folderExists = deps.folderExistsImpl || (p => folderExistsViaList(p, deps.fetchImpl));
  const root = deps.root || propertiesRoot();

  // 1. KNOWN — parent of a PROPERTIES-resident property_documents.source_url.
  const docUrls = await fetchPropertyDocUrls(domain, propertyId, dq);
  for (const url of docUrls) {
    const parent = parentOfPropertiesUrl(url);
    if (parent) return { ok: true, folder_path: parent, source: 'known_property_document' };
  }

  // 2. DERIVED (verified) — only if a candidate folder actually exists.
  const attrs = await fetchPropertyAttrs(domain, propertyId, dq);
  if (attrs) {
    for (const cand of deriveFolderCandidates({ ...attrs, root })) {
      const exists = await Promise.resolve(folderExists(cand)).catch(() => false);
      if (exists) return { ok: true, folder_path: cand, source: 'derived_verified' };
    }
  }

  // 3. UNRESOLVED — refuse.
  return { ok: false, reason: 'folder_unresolved' };
}
