import { opsQuery, pgFilterVal } from './ops-db.js';

export function normalizeCanonicalName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a street address for duplicate detection.
 * Collapses common street-type abbreviation variants ("Street"/"St",
 * "Road"/"Rd", etc.) and lowercases so CoStar records using different
 * spellings from existing CMS records resolve to the same key.
 */
export function normalizeAddress(addr) {
  if (!addr) return '';
  return String(addr).trim()
    .replace(/\bStreet\b/gi, 'St')
    .replace(/\bAvenue\b/gi, 'Ave')
    .replace(/\bBoulevard\b/gi, 'Blvd')
    .replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bRoad\b/gi, 'Rd')
    .replace(/\bLane\b/gi, 'Ln')
    .replace(/\bCourt\b/gi, 'Ct')
    .replace(/\bPlace\b/gi, 'Pl')
    .replace(/\bHighway\b/gi, 'Hwy')
    .replace(/\bParkway\b/gi, 'Pkwy')
    .replace(/\bCircle\b/gi, 'Cir')
    .replace(/\bTrail\b/gi, 'Trl')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Strip the street-type suffix from a normalized address so that
 * "181 dozier st" and "181 dozier blvd" both become "181 dozier".
 * Used as a fallback when the full normalized address doesn't match
 * because CoStar and the DB disagree on the suffix (St vs Blvd, etc.).
 */
export function stripStreetSuffix(normalizedAddr) {
  if (!normalizedAddr) return '';
  return normalizedAddr
    .replace(/\b(st|ave|blvd|dr|rd|ln|ct|pl|hwy|pkwy|cir|trl|way|ter|loop|run)\b\.?\s*$/i, '')
    .trim();
}

function inferEntityType(sourceType, seedFields = {}) {
  const type = String(sourceType || '').toLowerCase();
  if (['contact', 'person', 'owner_contact'].includes(type)) return 'person';
  if (['property', 'asset', 'clinic', 'facility'].includes(type)) return 'asset';
  if (seedFields.email || seedFields.phone || seedFields.first_name || seedFields.last_name) return 'person';
  return 'organization';
}

function pickSeedFields(entityType, seedFields = {}) {
  const allowed = ['description', 'first_name', 'last_name', 'title', 'phone', 'email',
    'org_type', 'address', 'city', 'state', 'zip', 'county', 'latitude', 'longitude', 'asset_type',
    'domain', 'metadata'];
  const picked = {};
  for (const key of allowed) {
    if (seedFields[key] !== undefined) picked[key] = seedFields[key];
  }

  if (entityType !== 'person') {
    delete picked.first_name;
    delete picked.last_name;
    delete picked.title;
    delete picked.phone;
    delete picked.email;
  }
  if (entityType !== 'organization') {
    delete picked.org_type;
  }
  if (entityType !== 'asset') {
    delete picked.address;
    delete picked.city;
    delete picked.state;
    delete picked.zip;
    delete picked.county;
    delete picked.latitude;
    delete picked.longitude;
    delete picked.asset_type;
  }

  return picked;
}

async function fetchEntityById(entityId, workspaceId) {
  const result = await opsQuery('GET',
    `entities?id=eq.${entityId}&workspace_id=eq.${workspaceId}&select=*&limit=1`
  );
  return result.ok && result.data?.length ? result.data[0] : null;
}

export async function ensureEntityLink({
  workspaceId,
  userId,
  sourceSystem,
  sourceType,
  externalId,
  externalUrl,
  domain,
  entityId,
  seedFields = {},
  metadata = {}
}) {
  let resolvedEntity = null;
  let createdEntity = false;
  let createdIdentity = false;

  if (entityId) {
    resolvedEntity = await fetchEntityById(entityId, workspaceId);
  }

  if (!resolvedEntity && externalId && sourceSystem) {
    const clauses = [
      `workspace_id=eq.${workspaceId}`,
      `source_system=eq.${pgFilterVal(sourceSystem)}`,
      `external_id=eq.${pgFilterVal(externalId)}`,
      'select=entity_id,source_type,external_url,metadata',
      'limit=1'
    ];
    if (sourceType) clauses.splice(2, 0, `source_type=eq.${pgFilterVal(sourceType)}`);
    const lookup = await opsQuery('GET', `external_identities?${clauses.join('&')}`);
    if (lookup.ok && lookup.data?.length) {
      resolvedEntity = await fetchEntityById(lookup.data[0].entity_id, workspaceId);
    }
  }

  const candidateName = seedFields.name
    || [seedFields.first_name, seedFields.last_name].filter(Boolean).join(' ').trim()
    || seedFields.address
    || `${sourceType || 'entity'} ${externalId || ''}`.trim();
  const canonicalName = normalizeCanonicalName(candidateName);
  const entityType = inferEntityType(sourceType, seedFields);

  if (!resolvedEntity && canonicalName) {
    let path = `entities?workspace_id=eq.${workspaceId}&canonical_name=eq.${encodeURIComponent(canonicalName)}&select=*&limit=5`;
    if (domain) path += `&domain=eq.${pgFilterVal(domain)}`;
    const match = await opsQuery('GET', path);
    if (match.ok && match.data?.length) {
      resolvedEntity = match.data.find(e => e.entity_type === entityType) || match.data[0];
    }
  }

  if (!resolvedEntity) {
    const createPayload = {
      workspace_id: workspaceId,
      created_by: userId || null,
      entity_type: entityType,
      name: candidateName,
      canonical_name: canonicalName || normalizeCanonicalName(candidateName || 'entity'),
      domain: domain || seedFields.domain || null,
      ...pickSeedFields(entityType, seedFields)
    };
    const created = await opsQuery('POST', 'entities', createPayload);
    if (!created.ok) {
      return {
        ok: false,
        error: 'Failed to create canonical entity',
        detail: created.data
      };
    }
    resolvedEntity = Array.isArray(created.data) ? created.data[0] : created.data;
    createdEntity = true;
  }

  if (externalId && sourceSystem && sourceType) {
    const identityRes = await opsQuery('POST', 'external_identities', {
      workspace_id: workspaceId,
      entity_id: resolvedEntity.id,
      source_system: sourceSystem,
      source_type: sourceType,
      external_id: externalId,
      external_url: externalUrl || null,
      metadata,
      last_synced_at: new Date().toISOString()
    }, { 'Prefer': 'return=representation,resolution=merge-duplicates' });

    if (!identityRes.ok) {
      return {
        ok: false,
        error: 'Failed to create external identity link',
        detail: identityRes.data,
        entity: resolvedEntity
      };
    }
    createdIdentity = true;
  }

  return {
    ok: true,
    entity: resolvedEntity,
    entityId: resolvedEntity.id,
    createdEntity,
    createdIdentity
  };
}
