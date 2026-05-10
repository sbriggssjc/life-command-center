// ============================================================================
// Bridge handlers — SharePoint
// Life Command Center — Phase 2
// ----------------------------------------------------------------------------
// One handler so far:
//
//   sharepoint.document.classify → sharepoint_documents row
//                                  + best-effort entity linkage with confidence
//
// The classifier runs in the worker (api/bridges.js _route=worker), one row
// per Graph driveItem coming through the ingest receiver. It does:
//
//   1. Path-parse `/Properties/<TenantName>/<City, State>/...`
//      Other paths land with parent_path filled but tenant_name/city/state null.
//   2. Heuristic doc_type from filename (om / lease / comp / ownership_research /
//      financial / marketing / other).
//   3. Tenant entity link by canonical_name match (organizations).
//   4. Property entity link by (city, state) match against asset entities,
//      with match_confidence written so the UI can surface low-confidence
//      matches for review.
//   5. Upsert into sharepoint_documents on (workspace_id, drive_id, item_id).
//
// Phase 2.5 will add `sharepoint.document.extract` for on-demand body fetch.
// ============================================================================

import { opsQuery, pgFilterVal } from './ops-db.js';

// ---- helpers --------------------------------------------------------------

function canonicalize(name) {
  if (!name) return '';
  return String(name).toLowerCase()
    .replace(/[.,]+/g, ' ')
    .replace(/\b(inc|llc|l\.?l\.?c\.?|ltd|corp|corporation|company|co|the|holdings?|properties|property)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Graph driveItem.parentReference.path looks like:
//   "/drive/root:/Properties/Acme Properties/Dallas, TX"
// Strip the "/drive/root:" prefix to get a clean filesystem-style path.
function cleanParentPath(parentPath) {
  if (!parentPath) return '';
  return decodeURIComponent(parentPath).replace(/^\/drive\/root:/, '') || '/';
}

// Parse "/Properties/<Tenant>/<City, State>/..." into { tenantName, city, state }.
// Returns nulls for any segment that's missing or doesn't match.
function parsePropertyPath(cleanPath) {
  const out = { tenantName: null, city: null, state: null };
  if (!cleanPath) return out;
  const m = cleanPath.match(/^\/Properties\/([^\/]+)(?:\/([^\/]+))?/i);
  if (!m) return out;
  out.tenantName = m[1].trim();
  if (m[2]) {
    const cs = m[2].trim().match(/^(.+?),\s*([A-Z]{2})\b/i);
    if (cs) {
      out.city  = cs[1].trim();
      out.state = cs[2].trim().toUpperCase();
    }
  }
  return out;
}

// Filename → doc_type heuristic. Loose on purpose — refined by the
// extractor in Phase 2.5 once bodies are read. Order matters; first
// match wins.
function classifyByFilename(name) {
  const n = (name || '').toLowerCase();
  if (/\bom\b|offering[\s_-]?memo|teaser/.test(n))             return 'om';
  if (/\blease\b|\blse\b|\blease[\s_-]?abstract\b/.test(n))     return 'lease';
  if (/\bcomp\b|\bcomparable/.test(n))                          return 'comp';
  if (/owner|ownership|llc[\s_-]?research|true[\s_-]?owner/.test(n)) return 'ownership_research';
  if (/financial|p&?l|\bt-?12\b|cashflow|noi|operating[\s_-]?statement/.test(n)) return 'financial';
  if (/marketing|brochure|flyer/.test(n))                       return 'marketing';
  return 'other';
}

async function findOrgEntityByCanonical(workspaceId, name) {
  if (!workspaceId || !name) return null;
  const r = await opsQuery('GET',
    `entities?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&entity_type=eq.organization` +
    `&canonical_name=eq.${pgFilterVal(canonicalize(name))}` +
    `&select=id&limit=1`,
    null, { countMode: 'none' }
  );
  if (r.ok && r.data?.length) return r.data[0].id;
  return null;
}

// Find candidate asset entities for a (city, state) pair. Returns up to 5
// rows so the caller can decide how to disambiguate.
async function findAssetCandidates(workspaceId, city, state) {
  if (!workspaceId || !city || !state) return [];
  const r = await opsQuery('GET',
    `entities?workspace_id=eq.${pgFilterVal(workspaceId)}` +
    `&entity_type=eq.asset` +
    `&city=ilike.${pgFilterVal(city)}` +
    `&state=eq.${pgFilterVal(state)}` +
    `&select=id,name,address,metadata&limit=5`,
    null, { countMode: 'none' }
  );
  return (r.ok && Array.isArray(r.data)) ? r.data : [];
}

// ---- document.classify ----------------------------------------------------

export async function handleSharepointDocumentClassify(job) {
  const p = job.payload || {};
  const workspaceId = job.workspace_id;
  const itemId  = p.id || job.external_id;
  const driveId = p.parentReference?.driveId || null;

  if (!itemId)  return { ok: false, error: 'missing_drive_item_id' };
  if (!driveId) return { ok: false, error: 'missing_drive_id' };

  // Folders shouldn't reach the worker — the PA flow filters them — but
  // skip defensively if one slips through. (Recursing into folders is the
  // PA flow's job, not ours.)
  if (p.folder) return { ok: true, result: { skipped: 'folder', item_id: itemId } };

  const cleanPath = cleanParentPath(p.parentReference?.path);
  const { tenantName, city, state } = parsePropertyPath(cleanPath);
  const docType = classifyByFilename(p.name);

  // Best-effort entity linkage.
  let tenantEntityId = null;
  let propertyEntityId = null;
  let matchConfidence = null;

  if (tenantName) {
    tenantEntityId = await findOrgEntityByCanonical(workspaceId, tenantName);
  }

  if (city && state) {
    const candidates = await findAssetCandidates(workspaceId, city, state);
    if (candidates.length === 1) {
      propertyEntityId = candidates[0].id;
      matchConfidence  = 0.9;
    } else if (candidates.length > 1) {
      // Multi-candidate: prefer one whose name canonicalizes near the
      // tenant or whose metadata.salesforce.account_id ties back to the
      // tenant entity. Without a richer signal we drop confidence and
      // let the UI prompt for review.
      const tenantCanon = canonicalize(tenantName || '');
      const preferred = tenantCanon
        ? candidates.find(c => canonicalize(c.name).includes(tenantCanon)
                             || canonicalize(c.name).split(' ').some(t => tenantCanon.split(' ').includes(t)))
        : null;
      propertyEntityId = (preferred || candidates[0]).id;
      matchConfidence  = preferred ? 0.65 : 0.35;
    }
  }

  await opsQuery('POST',
    'sharepoint_documents?on_conflict=workspace_id,drive_id,item_id',
    {
      workspace_id:        workspaceId,
      drive_id:            driveId,
      item_id:             itemId,
      parent_path:         cleanPath,
      name:                p.name || '(unnamed)',
      web_url:             p.webUrl || null,
      size_bytes:          p.size || null,
      content_type:        p.file?.mimeType || null,
      etag:                p.eTag || null,
      tenant_name:         tenantName,
      city, state,
      doc_type:            docType,
      property_entity_id:  propertyEntityId,
      tenant_entity_id:    tenantEntityId,
      match_confidence:    matchConfidence,
      last_modified_at:    p.lastModifiedDateTime || null,
      indexed_at:          new Date().toISOString(),
      extraction_status:   'pending',
      metadata: {
        sf_owner: p.lastModifiedBy?.user?.displayName || null,
        path_parse: tenantName ? 'rich' : 'other',
        candidate_count: (city && state) ? undefined : null
      }
    },
    { headers: { Prefer: 'resolution=merge-duplicates' } }
  );

  return {
    ok: true,
    result: {
      item_id: itemId,
      doc_type: docType,
      tenant_name: tenantName,
      city, state,
      tenant_entity_id: tenantEntityId,
      property_entity_id: propertyEntityId,
      match_confidence: matchConfidence
    }
  };
}
