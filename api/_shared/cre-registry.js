// ============================================================================
// R15 — generic CRE property registry (Phase 1)
// Life Command Center
//
// The "high-value middle": out-of-domain docs (office / retail / bank /
// entertainment / MOB — Briggs's whole book outside dia/gov) currently PARK
// because they have no home DB. This module registers them into a lightweight
// store (lcc_cre_properties + lcc_cre_property_documents on LCC Opps), mints the
// OWNER as a first-class entity in the existing graph (the BD payoff), and
// attaches the doc — WITHOUT building a third underwriting engine.
//
// Doctrine / boundaries (mirrors the enrich path):
//   • The value is the OWNER, not underwriting. No scoring / NOI / cap-rate.
//   • Match-or-create by natural key, FILL-BLANKS only (never clobber).
//   • Never INVENT an owner. Owner comes from an extraction snapshot when one
//     is supplied (the OM/master-sheet path); the light-attach path passes no
//     snapshot, so the property registers with the owner left pending for a
//     Phase-2 backfill. A junk/implausible owner name is rejected by the shared
//     entity guards — we leave it pending, never mint garbage.
//   • Register what you can, PARK the rest (never guess) — a doc with no
//     usable anchor returns registered:false so the caller keeps the park path.
//   • dia/gov docs never reach here (the caller gates on out-of-domain).
//
// The core is performCreRegister(args, deps) (deps injected for unit tests);
// registerCreProperty(args) wires the production deps (opsQuery + ensureEntityLink
// + lcc_merge_field).
// ============================================================================

import { opsQuery } from './ops-db.js';
import {
  ensureEntityLink,
  normalizeCanonicalName,
  looksLikePersonName,
} from './entity-link.js';

// ---- Pure helpers ----------------------------------------------------------

// True when the subject carries NO dia/gov vertical cue — i.e. it is an
// out-of-domain asset class that should route to the CRE registry rather than
// the dia/gov match/disambiguation path. dia/gov subjects return false.
export function isOutOfDomainSubject(subjectHint) {
  const v = subjectHint && subjectHint.vertical;
  return v !== 'dia' && v !== 'gov';
}

// Normalize a street address into a stable dedupe key: lower-case, drop
// punctuation, collapse whitespace. Returns null for empty/blank input.
export function normalizeCreAddress(address) {
  if (!address) return null;
  const s = String(address)
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

function normState(state) {
  if (!state) return null;
  const s = String(state).trim().toUpperCase();
  return s ? s.slice(0, 2) : null;
}

function firstOf(v) {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v ?? null;
}

// Ordered keyword → asset_class rules. First match wins, so the more specific
// classes (medical office, bank, entertainment) precede the generic ones.
const ASSET_CLASS_RULES = [
  [/medical\s*office|\bmob\b|\bmedical\b|clinic|healthcare/i, 'mob'],
  [/\bbank\b|santander|credit union|first national|\bfinancial center\b/i, 'bank'],
  [/top\s*golf|topgolf|theat(er|re)|cinema|entertain|bowl|casino|arcade|fitness|gym/i, 'entertainment'],
  [/retail|shopping|strip\s*(center|mall)|\bstore\b|outlet|\bplaza\b|grocery|pharmacy|restaurant|qsr/i, 'retail'],
  [/industrial|warehouse|distribution|logistics|manufactur|flex\b/i, 'industrial'],
  [/office|class\s*[abc]\b|\bhq\b|headquarters|corporate center/i, 'office'],
];

// Derive a coarse asset class from the path tenant + extraction property_type /
// tenant. Best-effort; defaults to 'unknown' (a valid, non-blocking value).
export function deriveAssetClass(subjectHint, snapshot) {
  const parts = [
    subjectHint && subjectHint.tenant_brand,
    subjectHint && subjectHint.asset_class,
    snapshot && snapshot.property_type,
    snapshot && firstOf(snapshot.tenant_name),
    snapshot && firstOf(snapshot.primary_tenant),
  ].filter(Boolean).join(' ');
  if (!parts.trim()) return 'unknown';
  for (const [re, cls] of ASSET_CLASS_RULES) {
    if (re.test(parts)) return cls;
  }
  return 'unknown';
}

// Pull a usable owner name out of an extraction snapshot. Returns null when the
// snapshot is absent (light-attach path) or carries no owner — we NEVER invent.
export function extractOwnerName(snapshot) {
  if (!snapshot) return null;
  const cands = [
    snapshot.true_owner_name,
    snapshot.recorded_owner_name,
    snapshot.owner_name,
    snapshot.seller_name,
  ];
  for (const c of cands) {
    const v = firstOf(c);
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

// Build the natural key from the path anchor + (optional) extraction snapshot.
export function buildCreNaturalKey({ subjectHint, snapshot } = {}) {
  const address = (snapshot && snapshot.address) || (subjectHint && subjectHint.address) || null;
  const city    = (snapshot && snapshot.city)    || (subjectHint && subjectHint.city)    || null;
  const state   = normState((snapshot && snapshot.state) || (subjectHint && subjectHint.state) || null);
  const tenant  = (subjectHint && subjectHint.tenant_brand)
    || firstOf(snapshot && snapshot.tenant_name)
    || null;
  return {
    normalized_address: normalizeCreAddress(address),
    address: address ? String(address).trim() : null,
    city:    city ? String(city).trim() : null,
    state,
    tenant_brand: tenant ? String(tenant).trim() : null,
  };
}

// ---- The testable core -----------------------------------------------------

/**
 * Register an out-of-domain doc into the CRE registry.
 *
 * @param {object} args  - {subjectHint, snapshot, fileName, sourceUrl, docType, workspaceId, actorId}
 * @param {object} deps  - {findProperty, insertProperty, updateProperty, attachDoc, ensureOwnerEntity, recordProvenance}
 * @returns {Promise<{ok:boolean, registered:boolean, cre?:boolean, cre_property_id?:number,
 *                     created?:boolean, asset_class?:string, owner_entity_id?:string|null,
 *                     owner_pending?:boolean, document_id?:number|null, attached?:boolean, reason?:string}>}
 */
export async function performCreRegister(args, deps) {
  const { subjectHint, snapshot, fileName, sourceUrl, docType, workspaceId, actorId } = args || {};
  const { findProperty, insertProperty, updateProperty, attachDoc, ensureOwnerEntity, recordProvenance } = deps || {};

  const key = buildCreNaturalKey({ subjectHint, snapshot });

  // Need a state PLUS either a normalized address or a tenant brand to anchor a
  // row safely. Otherwise the anchor is too weak — PARK (register what you can,
  // never guess a property).
  const haveAnchor = !!(key.normalized_address || key.tenant_brand);
  if (!haveAnchor || !key.state) {
    return { ok: false, registered: false, reason: 'insufficient_anchor' };
  }

  const assetClass = deriveAssetClass(subjectHint, snapshot);

  // ---- Owner → entity (the BD payoff). Never invent. ----------------------
  let ownerEntityId = null;
  const ownerName = extractOwnerName(snapshot);
  if (ownerName) {
    const res = await ensureOwnerEntity(ownerName, { workspaceId, actorId }).catch(() => null);
    if (res && res.ok && res.entityId) ownerEntityId = res.entityId;
    // res.ok=false (junk/implausible/federal anti-pattern) → leave pending.
  }

  // ---- Match-or-create the CRE property (fill-blanks only) ----------------
  let prop = await findProperty(key).catch(() => null);
  let created = false;
  const writtenProp = {};   // field → value, for provenance

  if (!prop || prop.id == null) {
    const row = {
      normalized_address: key.normalized_address,
      address:            key.address,
      city:               key.city,
      state:              key.state,
      tenant_brand:       key.tenant_brand,
      asset_class:        assetClass,
      owner_entity_id:    ownerEntityId,
      source_path:        sourceUrl || null,
    };
    prop = await insertProperty(row).catch((e) => ({ __err: e && e.message }));
    if (!prop || prop.id == null) {
      return { ok: false, registered: false, reason: 'insert_failed', detail: prop };
    }
    created = true;
    for (const f of ['address', 'city', 'state', 'tenant_brand', 'asset_class', 'owner_entity_id', 'source_path']) {
      if (row[f] != null) writtenProp[f] = row[f];
    }
  } else {
    // Fill blanks on the existing row — never clobber a curated value.
    const patch = {};
    if (!prop.address && key.address)            patch.address       = key.address;
    if (!prop.city && key.city)                  patch.city          = key.city;
    if (!prop.tenant_brand && key.tenant_brand)  patch.tenant_brand  = key.tenant_brand;
    if ((prop.asset_class == null || prop.asset_class === 'unknown') && assetClass !== 'unknown')
      patch.asset_class = assetClass;
    if (!prop.owner_entity_id && ownerEntityId)  patch.owner_entity_id = ownerEntityId;
    if (!prop.source_path && sourceUrl)          patch.source_path   = sourceUrl;
    if (Object.keys(patch).length) {
      await updateProperty(prop.id, patch).catch(() => {});
      Object.assign(writtenProp, patch);
    }
    // Surface the (possibly pre-existing) owner so the caller's pending flag is honest.
    if (!ownerEntityId && prop.owner_entity_id) ownerEntityId = prop.owner_entity_id;
  }

  const crePropertyId = prop.id;

  // ---- Attach the doc ------------------------------------------------------
  let doc = null;
  if (fileName) {
    doc = await attachDoc({
      crePropertyId,
      fileName,
      docType: docType || 'document',
      sourceUrl: sourceUrl || null,
    }).catch((e) => ({ ok: false, error: e && e.message }));
  }

  // ---- Provenance (source='folder_feed_cre'; best-effort) -----------------
  try {
    const entries = [];
    if (Object.keys(writtenProp).length) {
      entries.push({ targetTable: 'public.lcc_cre_properties', recordPk: crePropertyId, fields: writtenProp });
    }
    if (doc && doc.ok && doc.document_id) {
      entries.push({
        targetTable: 'public.lcc_cre_property_documents',
        recordPk: doc.document_id,
        fields: { file_name: fileName || null, document_type: docType || null, source_url: sourceUrl || null },
      });
    }
    if (entries.length && recordProvenance) {
      await recordProvenance(entries, { workspaceId, actorId }).catch(() => {});
    }
  } catch { /* provenance is never load-bearing */ }

  return {
    ok: true,
    registered: true,
    cre: true,
    cre_property_id: crePropertyId,
    created,
    asset_class: assetClass,
    owner_entity_id: ownerEntityId,
    owner_pending: !ownerEntityId,
    document_id: doc && doc.ok ? (doc.document_id || null) : null,
    attached: !!(doc && doc.ok),
  };
}

// ---- Production wiring ------------------------------------------------------

async function findCreProperty(key) {
  const params = [`state=eq.${encodeURIComponent(key.state)}`, 'select=*', 'limit=1'];
  if (key.normalized_address) {
    params.push(`normalized_address=eq.${encodeURIComponent(key.normalized_address)}`);
  } else {
    // Tenant+city fallback. ilike without wildcards = case-insensitive equality.
    params.push('normalized_address=is.null');
    if (key.tenant_brand) params.push(`tenant_brand=ilike.${encodeURIComponent(key.tenant_brand)}`);
    if (key.city) params.push(`city=ilike.${encodeURIComponent(key.city)}`);
  }
  const r = await opsQuery('GET', `lcc_cre_properties?${params.join('&')}`);
  if (r.ok && Array.isArray(r.data) && r.data.length) return r.data[0];
  return null;
}

async function insertCreProperty(row) {
  const r = await opsQuery('POST', 'lcc_cre_properties', { ...row, updated_at: new Date().toISOString() },
    { Prefer: 'return=representation' });
  if (r.ok) return Array.isArray(r.data) ? r.data[0] : r.data;
  return { __err: r.data };
}

async function updateCreProperty(id, patch) {
  return opsQuery('PATCH', `lcc_cre_properties?id=eq.${encodeURIComponent(id)}`,
    { ...patch, updated_at: new Date().toISOString() });
}

async function attachCreDoc({ crePropertyId, fileName, docType, sourceUrl }) {
  const r = await opsQuery('POST',
    'lcc_cre_property_documents?on_conflict=cre_property_id,file_name',
    { cre_property_id: Number(crePropertyId), file_name: fileName, document_type: docType || null,
      source_url: sourceUrl || null, source: 'folder_feed_cre' },
    { Prefer: 'return=representation,resolution=merge-duplicates' });
  if (r.ok) {
    const ins = Array.isArray(r.data) ? r.data[0] : r.data;
    return { ok: true, document_id: ins && ins.id != null ? ins.id : null };
  }
  return { ok: false, status: r.status, detail: r.data };
}

// Resolve/create the owner entity in the existing graph, domain='cre' so it is
// tagged a CRE owner but deduped by canonical_name (no novel external_identities
// source_system — the composite-person path mints the same way). The shared junk
// / implausible-person / federal-anti-pattern guards inside ensureEntityLink
// reject garbage; we surface that as ok:false so the caller leaves owner pending.
export async function ensureCreOwnerEntity(name, { workspaceId, actorId } = {}) {
  const sourceType = looksLikePersonName(name) ? 'person' : 'true_owner';
  const res = await ensureEntityLink({
    workspaceId,
    userId: actorId,
    domain: 'cre',
    sourceType,
    seedFields: { name, domain: 'cre', metadata: { source: 'folder_feed_cre' } },
  });
  return res; // {ok:true, entityId} | {ok:false, skipped}
}

export async function recordCreProvenance(entries, { workspaceId, actorId } = {}) {
  const tasks = [];
  for (const e of entries) {
    for (const [fieldName, value] of Object.entries(e.fields)) {
      if (value === undefined || value === null) continue;
      tasks.push(opsQuery('POST', 'rpc/lcc_merge_field', {
        p_workspace_id:    workspaceId || null,
        p_target_database: 'lcc_db',
        p_target_table:    e.targetTable,
        p_record_pk:       String(e.recordPk),
        p_field_name:      fieldName,
        p_value:           value,
        p_source:          'folder_feed_cre',
        p_source_run_id:   null,
        p_confidence:      0.6,
        p_recorded_by:     actorId || null,
      }).catch(() => null));
    }
  }
  await Promise.allSettled(tasks);
}

/**
 * Set a CRE property's owner (Phase 2 backfill). Guarded on `owner_entity_id IS
 * NULL` so it is idempotent and never clobbers an owner another tick already
 * resolved — a second tick or re-run patches nothing (`patched:false`). On a
 * real write it records field provenance (source='folder_feed_cre', the
 * owner_entity_id field is already registered).
 *
 * @returns {Promise<{ok:boolean, patched:boolean}>}
 */
export async function setCrePropertyOwner(crePropertyId, ownerEntityId, { workspaceId, actorId } = {}) {
  if (crePropertyId == null || !ownerEntityId) return { ok: false, patched: false };
  const r = await opsQuery('PATCH',
    `lcc_cre_properties?id=eq.${encodeURIComponent(crePropertyId)}&owner_entity_id=is.null`,
    { owner_entity_id: ownerEntityId, updated_at: new Date().toISOString() },
    { Prefer: 'return=representation' });
  const patched = !!(r.ok && Array.isArray(r.data) && r.data.length);
  if (patched) {
    await recordCreProvenance(
      [{ targetTable: 'public.lcc_cre_properties', recordPk: crePropertyId, fields: { owner_entity_id: ownerEntityId } }],
      { workspaceId, actorId },
    ).catch(() => {});
  }
  return { ok: !!r.ok, patched };
}

/**
 * Production entrypoint — registers an out-of-domain doc into the CRE registry
 * using the live LCC Opps + entity-graph deps. Returns the performCreRegister
 * result (registered:false when the anchor is too weak → caller PARKS).
 */
export async function registerCreProperty(args) {
  return performCreRegister(args, {
    findProperty:     findCreProperty,
    insertProperty:   insertCreProperty,
    updateProperty:   updateCreProperty,
    attachDoc:        attachCreDoc,
    ensureOwnerEntity: ensureCreOwnerEntity,
    recordProvenance: recordCreProvenance,
  });
}
