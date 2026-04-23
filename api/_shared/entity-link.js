import { opsQuery, pgFilterVal } from './ops-db.js';
import { syncSalesforceForEntity } from './salesforce-sync.js';

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

/**
 * Strip directional tokens (North/South/East/West and their abbreviations)
 * from a normalized address. "991 e johnstown rd" and "991 johnstown rd"
 * both become "991 johnstown rd" after this. Used as an extra fallback
 * when the normalized-address ilike doesn't match because the canonical
 * source has a directional prefix but the ingested document omitted it
 * (or vice versa).
 */
export function stripDirectional(normalizedAddr) {
  if (!normalizedAddr) return '';
  return normalizedAddr
    .replace(/\b(northeast|northwest|southeast|southwest|north|south|east|west)\b\.?/gi, ' ')
    .replace(/\b(ne|nw|se|sw|n|s|e|w)\b\.?(?=\s)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Full-name → USPS 2-letter code map for state normalization. AI extractors
// commonly emit "Ohio" while domain databases store "OH" — without this,
// `state=eq.` filters return zero candidates.
const STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR',
};

/**
 * Normalize a US state value to its 2-letter USPS code.
 * 2-letter input → uppercased; full-name → code via map; unknown → uppercased
 * (so the filter still runs, just won't match).
 */
export function normalizeState(state) {
  if (!state) return '';
  const raw = String(state).trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return STATE_NAME_TO_CODE[key] || raw.toUpperCase();
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
    // Target the compound unique index via explicit on_conflict so
    // PostgREST's resolution=merge-duplicates actually kicks in — without
    // the column list, PostgREST defaults to the PK and the upsert falls
    // back to INSERT, which then violates the unique constraint.
    const identityRes = await opsQuery('POST',
      'external_identities?on_conflict=workspace_id,source_system,source_type,external_id',
      {
        workspace_id: workspaceId,
        entity_id: resolvedEntity.id,
        source_system: sourceSystem,
        source_type: sourceType,
        external_id: externalId,
        external_url: externalUrl || null,
        metadata,
        last_synced_at: new Date().toISOString()
      },
      { 'Prefer': 'return=representation,resolution=merge-duplicates' }
    );

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

  // --- Salesforce auto-link (best effort; never fails the caller) ----------
  // Any time LCC creates a brand-new entity, try to stitch a Salesforce
  // match onto it so the sidebar/search/contact-merge paths all see the link
  // without a downstream write needing to re-check SF. Only runs for people
  // (email) and organizations (name) — assets don't have a reliable SF key.
  //
  // Skipped when:
  //   - entity already existed (createdEntity=false); that path has either
  //     been synced before or lives in a flow that handles SF itself
  //     (unified_contacts promoter does its own backfill).
  //   - entity is an asset (no SF analog).
  //   - SF isn't configured (syncSalesforceForEntity short-circuits).
  //
  // We fire-and-await (not fire-and-forget) so we can attach the result to
  // the return payload — handy for tests and for observability. Errors are
  // swallowed inside syncSalesforceForEntity, so this is still safe.
  let salesforce = null;
  if (createdEntity && resolvedEntity && resolvedEntity.entity_type !== 'asset') {
    try {
      salesforce = await syncSalesforceForEntity({
        workspaceId,
        entityId:   resolvedEntity.id,
        entityType: resolvedEntity.entity_type,
        name:       resolvedEntity.name || candidateName,
        email:      seedFields.email || resolvedEntity.email,
        reason:     `ensureEntityLink:${sourceSystem || 'unknown'}`,
      });
    } catch (err) {
      console.warn('[ensureEntityLink] SF sync failed (non-fatal):', err?.message || err);
    }
  }

  return {
    ok: true,
    entity: resolvedEntity,
    entityId: resolvedEntity.id,
    createdEntity,
    createdIdentity,
    salesforce,
  };
}
