import { createHash } from 'node:crypto';

export const ASC_RESEARCH_LANE_VERSION = 'healthcare_asc_research_lane:1.0';
export const ASC_RESEARCH_SAMPLE_SIZE = 50;

const SHA256_RE = /^[a-f0-9]{64}$/;
const ALLOWED_SOURCES = new Set(['costar', 'rca', 'public_records', 'salesforce']);

// Deliberately structured-only. Page HTML, cookies, tokens, and other licensed
// session material never enter the research tables.
const CAPTURE_FIELDS = [
  'building_name', 'property_subtype', 'building_class', 'square_footage',
  'year_built', 'year_renovated', 'lot_size', 'land_sf', 'stories', 'parking',
  'zoning', 'occupancy', 'ownership_type', 'location_type', 'parcel_number',
  'county', 'assessed_value', 'land_value', 'improvement_value', 'tenant_name',
  'primary_tenant', 'tenancy_type', 'owner_occupied', 'lease_type', 'lease_term',
  'remaining_term', 'lease_expiration', 'lease_commencement', 'rent_per_sf',
  'annual_rent', 'expense_structure', 'renewal_options', 'guarantor',
  'rent_escalations', 'asking_price', 'list_price', 'cap_rate', 'noi',
  'price_per_sf', 'sale_price', 'sale_date', 'listing_broker', 'listing_firm',
  'listing_email', 'listing_phone', 'tenants', 'contacts', 'sales_history',
  'loans', 'document_links', 'documents', 'investment_highlights',
];

function clean(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export function normalizeAscAddressToken({ address, city, state, zip } = {}) {
  const cityValue = clean(city);
  const stateValue = clean(state).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  let addressValue = clean(address);
  // CoStar sometimes emits the full display location in `address` while also
  // supplying city/state/ZIP separately. Strip only the corroborated trailing
  // location so both that shape and the CMS street-only shape bind to the same
  // property token. The city and two-letter state must both agree before any
  // suffix is removed.
  if (addressValue && cityValue && stateValue) {
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const locationSuffix = new RegExp(
      `\\s*,?\\s*${escapeRegex(cityValue)}\\s*,?\\s*${escapeRegex(stateValue)}` +
      '(?:\\s+\\d{5}(?:-\\d{4})?)?\\s*$',
      'i',
    );
    addressValue = addressValue.replace(locationSuffix, '').replace(/,\s*$/, '').trim();
  }
  const street = addressValue
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(STREET|ST)\b/g, 'ST')
    .replace(/\b(AVENUE|AVE)\b/g, 'AVE')
    .replace(/\b(BOULEVARD|BLVD)\b/g, 'BLVD')
    .replace(/\b(ROAD|RD)\b/g, 'RD')
    .replace(/\b(DRIVE|DR)\b/g, 'DR')
    .replace(/\b(LANE|LN)\b/g, 'LN')
    .replace(/\b(HIGHWAY|HWY)\b/g, 'HWY')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bWEST\b/g, 'W')
    // CMS addresses sometimes split a suite into multiple tokens (for
    // example, "STE 100 B"). Treat the complete trailing designator as
    // non-property identity so it binds to building-level CoStar/RCA pages.
    .replace(/\b(SUITE|STE|UNIT)\b(?:\s+[A-Z0-9-]+)+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cityToken = cityValue.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stateToken = stateValue;
  const zipToken = clean(zip).match(/\d{5}/)?.[0] || '';
  if (!street || !stateToken) return null;
  return [street, cityToken, stateToken, zipToken].join('|');
}

function hasAscSublocation(address) {
  return /\b(?:suite|ste|unit|\d+(?:st|nd|rd|th)\s+floor|floor\s+[a-z0-9-]+|fl\s+[a-z0-9-]+)\b/i
    .test(clean(address));
}

export function normalizeAscBuildingAddressToken(identity = {}) {
  const address = clean(identity.address).replace(
    /\s*,?\s*\b(?:\d+(?:st|nd|rd|th)\s+floor|floor\s+[a-z0-9-]+|fl\s+[a-z0-9-]+|suite|ste|unit)\b.*$/i,
    '',
  ).trim();
  return normalizeAscAddressToken({ ...identity, address });
}

function normalizeFacilityName(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeTenantIdentityName(value) {
  return normalizeFacilityName(value)
    .replace(/\s+(?:INCORPORATED|INC|CORPORATION|CORP|LIMITED|LTD|LLC|PLLC|LLP|LP|PC|P A|PA)$/, '')
    .trim();
}

function contextTenantNames(context) {
  const names = [context.tenant_name, context.primary_tenant];
  for (const tenant of Array.isArray(context.tenants) ? context.tenants : []) {
    names.push(typeof tenant === 'string' ? tenant : tenant?.name || tenant?.tenant_name);
  }
  return names.map(normalizeTenantIdentityName).filter(Boolean);
}

function corroboratingTenant(target, context) {
  const facility = normalizeTenantIdentityName(target.cms_identity?.facility_name);
  const tenants = contextTenantNames(context);
  if (facility) {
    const tenant = tenants.find((name) => name === facility || facility.startsWith(`${name} AT `));
    if (tenant) return { basis: 'facility_name', matched_name: tenant };
  }
  const evidence = target.cms_evidence || {};
  if (evidence.enrollment_corroborated !== true) return null;
  const organizations = (Array.isArray(evidence.enrollment_org_names) ? evidence.enrollment_org_names : [])
    .map(normalizeTenantIdentityName).filter(Boolean);
  const organization = organizations.find((name) => tenants.includes(name));
  return organization ? { basis: 'cms_enrollment_organization', matched_name: organization } : null;
}

function buildingAddressTokensAgree(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = left.split('|');
  const b = right.split('|');
  if (a.length !== 4 || b.length !== 4 || a.slice(1).join('|') !== b.slice(1).join('|')) return false;
  const stripStreetType = (street) => street.replace(/\s+(?:ST|AVE|BLVD|RD|DR|LN|HWY)$/, '');
  return stripStreetType(a[0]) === stripStreetType(b[0]);
}

function approvedParentAddressAlias(target, capturedAddressToken) {
  const aliases = Array.isArray(target.cms_evidence?.approved_parent_address_aliases)
    ? target.cms_evidence.approved_parent_address_aliases
    : [];
  return aliases.find((alias) => {
    if (alias?.status !== 'approved'
      || alias?.reason_code !== 'same_physical_building_dedicated_entry'
      || alias?.address_token !== capturedAddressToken
      || !clean(alias?.authorized_by)
      || !/^\d{4}-\d{2}-\d{2}T/.test(clean(alias?.authorized_at))) return false;
    const citations = Array.isArray(alias.evidence_citations) ? alias.evidence_citations : [];
    const sources = new Set(citations
      .filter((citation) => /^https:\/\//i.test(clean(citation?.url)))
      .map((citation) => clean(citation?.source).toLowerCase()));
    return sources.has('official_operator') && sources.has('property_manager');
  }) || null;
}

export function assertAscResearchImport({ release_id, selection_fingerprint, candidate_pool_fingerprint, candidates } = {}) {
  for (const [name, value] of Object.entries({ release_id, selection_fingerprint, candidate_pool_fingerprint })) {
    if (!SHA256_RE.test(clean(value).toLowerCase())) throw new Error(`${name} must be a lowercase SHA-256 fingerprint`);
  }
  if (!Array.isArray(candidates) || candidates.length !== ASC_RESEARCH_SAMPLE_SIZE) {
    throw new Error(`ASC research import requires exactly ${ASC_RESEARCH_SAMPLE_SIZE} candidates`);
  }
  const fingerprints = new Set();
  return candidates.map((row, index) => {
    const fingerprint = clean(row?.candidate_fingerprint).toLowerCase();
    if (!SHA256_RE.test(fingerprint)) throw new Error(`candidate ${index + 1} has an invalid fingerprint`);
    if (fingerprints.has(fingerprint)) throw new Error(`candidate ${index + 1} duplicates a fingerprint`);
    fingerprints.add(fingerprint);
    const identity = row.cms_identity || {};
    const addressToken = normalizeAscAddressToken(identity);
    if (!addressToken) throw new Error(`candidate ${index + 1} requires an address and two-letter state`);
    if (!clean(identity.ccn)) throw new Error(`candidate ${index + 1} requires a CMS facility ID`);
    return {
      candidate_fingerprint: fingerprint,
      sample_ordinal: index + 1,
      sampling_cell: clean(row.sampling_cell),
      cms_identity: identity,
      cms_evidence: row.cms_evidence || {},
      address_token: addressToken,
    };
  });
}

export function buildAscStructuredCapture(target, context = {}) {
  if (!target || !SHA256_RE.test(clean(target.candidate_fingerprint).toLowerCase())) {
    throw new Error('A frozen ASC candidate target is required');
  }
  const source = clean(context.source || context.domain).toLowerCase().replace(/-/g, '_');
  if (!ALLOWED_SOURCES.has(source)) throw new Error('ASC capture source must be CoStar, RCA, public records, or Salesforce');
  const addressToken = normalizeAscAddressToken(context);
  if (!addressToken) throw new Error('Captured page requires an address and state');
  let identityMatch = { mode: 'exact_address_token' };
  if (addressToken !== target.address_token) {
    const cmsIdentity = target.cms_identity || {};
    const corroboration = corroboratingTenant(target, context);
    const addressAlias = approvedParentAddressAlias(target, addressToken);
    const parentBuildingMatch = hasAscSublocation(cmsIdentity.address)
      && buildingAddressTokensAgree(
        normalizeAscBuildingAddressToken(cmsIdentity),
        normalizeAscBuildingAddressToken(context),
      )
      && corroboration;
    const aliasMatch = addressAlias && corroboration;
    if (!parentBuildingMatch && !aliasMatch) {
      throw new Error('Captured page does not match the active frozen ASC candidate');
    }
    identityMatch = aliasMatch ? {
      mode: 'evidence_backed_parent_address_alias',
      alias_reason_code: addressAlias.reason_code,
      alias_address_token: addressAlias.address_token,
      corroboration_basis: corroboration.basis,
      corroborated_name: corroboration.matched_name,
      cms_address_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      facility_name: clean(cmsIdentity.facility_name),
      second_review_required: true,
    } : {
      mode: corroboration.basis === 'facility_name'
        ? 'tenant_corroborated_parent_building'
        : 'enrollment_org_corroborated_parent_building',
      corroboration_basis: corroboration.basis,
      corroborated_name: corroboration.matched_name,
      cms_sublocation_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      facility_name: clean(cmsIdentity.facility_name),
    };
  }

  const structured = {};
  for (const field of CAPTURE_FIELDS) {
    const value = context[field];
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    structured[field] = value;
  }
  if (Object.keys(structured).length === 0) throw new Error('Captured page contains no approved structured research fields');

  const capturedAt = new Date().toISOString();
  const capture = {
    source,
    source_url: clean(context.page_url) || null,
    captured_at: capturedAt,
    address: clean(context.address),
    city: clean(context.city) || null,
    state: clean(context.state).toUpperCase(),
    zip: clean(context.zip) || null,
    // The database remains bound to the frozen candidate token. A parent-
    // building capture may omit the CMS suite/floor only after the separate
    // base-address + tenant corroboration gate above succeeds.
    address_token: target.address_token,
    structured_payload: structured,
  };
  capture.payload_sha256 = createHash('sha256').update(JSON.stringify(structured)).digest('hex');
  const evidence = Object.entries(structured).map(([field_name, value]) => ({
    field_name,
    asserted_value: value,
    source,
    source_url: capture.source_url,
    observed_at: capturedAt,
    confidence: source === 'salesforce' ? 0.6 : 0.7,
  }));
  return { capture, evidence, identity_match: identityMatch };
}

export function buildAscImportRpcBody(input, workspaceId, userId) {
  const candidates = assertAscResearchImport(input);
  return {
    p_workspace_id: workspaceId || null,
    p_release_id: input.release_id.toLowerCase(),
    p_selection_fingerprint: input.selection_fingerprint.toLowerCase(),
    p_candidate_pool_fingerprint: input.candidate_pool_fingerprint.toLowerCase(),
    p_packet_id: clean(input.packet_id).toLowerCase() || null,
    p_candidates: candidates,
    p_created_by: userId || null,
  };
}
