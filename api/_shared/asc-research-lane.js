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
    // One frozen CMS ASC row contains the source typo "BLFD". Preserve the
    // raw CMS identity, but compare that unambiguous token as BLVD.
    .replace(/\bBLFD\b/g, 'BLVD')
    .replace(/\b(ROAD|RD)\b/g, 'RD')
    .replace(/\b(DRIVE|DR)\b/g, 'DR')
    .replace(/\b(LANE|LN)\b/g, 'LN')
    .replace(/\b(CIRCLE|CIR)\b/g, 'CIR')
    .replace(/\b(PARKWAY|PKWY|PKY)\b/g, 'PKWY')
    // USPS Publication 28 standardizes COVE as CV. Keep the source address
    // unchanged in the capture; this token is comparison-only.
    .replace(/\b(COVE|CV)\b/g, 'CV')
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
  return /\b(?:suite|ste|unit|building|bldg|\d+(?:st|nd|rd|th)\s+floor|floor\s+[a-z0-9-]+|fl\s+[a-z0-9-]+)\b/i
    .test(clean(address));
}

function uspsCoveSuffixEquivalence(targetIdentity = {}, context = {}) {
  const terminalSuffix = (value) => clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(SUITE|STE|UNIT)\b(?:\s+[A-Z0-9-]+)+\s*$/g, '')
    .trim()
    .match(/\b(COVE|CV)$/)?.[1] || null;
  const frozenSuffix = terminalSuffix(targetIdentity.address);
  const capturedSuffix = terminalSuffix(context.address);
  if (!frozenSuffix || !capturedSuffix || frozenSuffix === capturedSuffix) return null;
  if (new Set([frozenSuffix, capturedSuffix]).size !== 2) return null;
  return { frozen_suffix: frozenSuffix, captured_suffix: capturedSuffix };
}

export function normalizeAscBuildingAddressToken(identity = {}) {
  const address = clean(identity.address).replace(
    /\s*,?\s*\b(?:\d+(?:st|nd|rd|th)\s+floor|floor\s+[a-z0-9-]+|fl\s+[a-z0-9-]+|building|bldg|suite|ste|unit)\b.*$/i,
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

const GENERIC_ASC_IDENTITY_CORES = new Set([
  'AMBULATORY', 'CENTER', 'CENTRE', 'HEALTH', 'HEALTHCARE', 'MEDICAL',
  'SURGERY', 'SURGICAL',
]);

function controlledAscFacilityAlias(target, context) {
  const facility = normalizeTenantIdentityName(target.cms_identity?.facility_name);
  const facilityMatch = facility.match(/^(.+?) AMBULATORY SURGERY CENTER$/);
  if (!facilityMatch) return null;
  const facilityCore = facilityMatch[1].trim();
  if (facilityCore.length < 6
    || facilityCore.split(' ').every((token) => GENERIC_ASC_IDENTITY_CORES.has(token))) return null;
  const tenantObservations = [context.tenant_name, context.primary_tenant];
  for (const tenant of Array.isArray(context.tenants) ? context.tenants : []) {
    tenantObservations.push(typeof tenant === 'string' ? tenant : tenant?.name || tenant?.tenant_name);
  }
  const tenant = tenantObservations.map((rawName) => ({
    raw_name: clean(rawName),
    normalized_name: normalizeTenantIdentityName(rawName),
  })).find(({ normalized_name: name }) => {
    const tenantMatch = name.match(/^(.+?) SURGICAL CENTER$/);
    return tenantMatch?.[1]?.trim() === facilityCore;
  });
  return tenant ? {
    basis: 'controlled_asc_facility_alias',
    organization_core: facilityCore,
    cms_facility_name: facility,
    captured_tenant_name: tenant.raw_name,
  } : null;
}

function normalizeEnrollmentOrganizationName(value) {
  return normalizeTenantIdentityName(value)
    .replace(/\bASSOC\b/g, 'ASSOCIATES')
    .replace(/\s+/g, ' ')
    .trim();
}

function ownerEnrollmentOrganizationCorroboration(target, context) {
  const evidence = target.cms_evidence || {};
  if (evidence.enrollment_corroborated !== true) return null;
  const enrollmentOrganizations = (Array.isArray(evidence.enrollment_org_names)
    ? evidence.enrollment_org_names : [])
    .map((rawName) => ({
      raw_name: clean(rawName),
      normalized_name: normalizeEnrollmentOrganizationName(rawName),
    }))
    .filter(({ normalized_name: name }) => Boolean(name));
  if (enrollmentOrganizations.length === 0) return null;
  for (const contact of Array.isArray(context.contacts) ? context.contacts : []) {
    if (clean(contact?.role).toLowerCase() !== 'owner') continue;
    const capturedOwner = normalizeEnrollmentOrganizationName(contact?.name);
    const enrollmentOrganization = enrollmentOrganizations
      .find(({ normalized_name: name }) => name === capturedOwner);
    if (!enrollmentOrganization) continue;
    return {
      basis: 'cms_enrollment_organization_owner',
      captured_owner_name: clean(contact?.name),
      enrollment_organization: enrollmentOrganization.raw_name,
    };
  }
  return null;
}

function exactFacilityCorroboration(target, context) {
  const facility = normalizeTenantIdentityName(target.cms_identity?.facility_name);
  if (!facility) return null;
  if (normalizeTenantIdentityName(context.building_name) === facility) {
    return { basis: 'building_name', matched_name: facility };
  }
  const tenant = contextTenantNames(context).find((name) => name === facility);
  return tenant ? { basis: 'facility_name', matched_name: tenant } : null;
}

const GENERIC_ORG_FAMILY_TOKENS = new Set([
  'THE', 'CENTER', 'CENTRE', 'SURGERY', 'SURGICAL', 'MEDICAL', 'HEALTH',
  'HEALTHCARE', 'CARE', 'CLINIC', 'HOSPITAL', 'GROUP', 'ASSOCIATES',
]);

function singleTenantOrganizationFamilyCorroboration(target, context) {
  if (!/\bSINGLE\b/i.test(clean(context.tenancy_type))) return null;
  const evidence = target.cms_evidence || {};
  if (evidence.enrollment_corroborated !== true) return null;
  const cmsNames = [
    target.cms_identity?.facility_name,
    ...(Array.isArray(evidence.enrollment_org_names) ? evidence.enrollment_org_names : []),
  ].map(normalizeTenantIdentityName).filter(Boolean);
  const capturedNames = contextTenantNames(context);
  for (const cmsName of cmsNames) {
    const cmsTokens = cmsName.split(' ');
    for (const capturedName of capturedNames) {
      const capturedTokens = capturedName.split(' ');
      const prefix = [];
      for (let i = 0; i < Math.min(cmsTokens.length, capturedTokens.length); i += 1) {
        if (cmsTokens[i] !== capturedTokens[i]) break;
        prefix.push(cmsTokens[i]);
      }
      if (prefix.length < 3
        || prefix.slice(0, 3).some((token) => GENERIC_ORG_FAMILY_TOKENS.has(token))
        || prefix.slice(0, 3).join('').length < 15) continue;
      return {
        basis: 'single_tenant_organization_family',
        matched_name: capturedName,
        organization_family: prefix.slice(0, 3).join(' '),
      };
    }
  }
  return null;
}

function buildingAddressTokensAgree(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = left.split('|');
  const b = right.split('|');
  if (a.length !== 4 || b.length !== 4 || a.slice(1).join('|') !== b.slice(1).join('|')) return false;
  const stripStreetType = (street) => street.replace(/\s+(?:ST|AVE|BLVD|RD|DR|LN|CIR|HWY)$/, '');
  return stripStreetType(a[0]) === stripStreetType(b[0]);
}

function terminalTownshipMunicipalityAlias(left, right) {
  if (!left || !right) return null;
  const frozen = left.split('|');
  const captured = right.split('|');
  if (frozen.length !== 4 || captured.length !== 4
    || frozen[0] !== captured[0]
    || frozen[2] !== captured[2]
    || frozen[3] !== captured[3]) return null;
  const stripTerminalTownship = (city) => city.replace(/\s+TOWNSHIP$/, '');
  if (frozen[1] === captured[1]
    || stripTerminalTownship(frozen[1]) !== stripTerminalTownship(captured[1])
    || (!/\sTOWNSHIP$/.test(frozen[1]) && !/\sTOWNSHIP$/.test(captured[1]))) return null;
  return { frozen_city: frozen[1], captured_city: captured[1] };
}

function capturedDirectionalStreetTypeExtension(frozenAddressToken, capturedAddressToken) {
  if (!frozenAddressToken || !capturedAddressToken) return null;
  const frozen = frozenAddressToken.split('|');
  const captured = capturedAddressToken.split('|');
  if (frozen.length !== 4 || captured.length !== 4
    || frozen.slice(1).join('|') !== captured.slice(1).join('|')) return null;
  const frozenStreet = frozen[0].split(' ');
  const capturedStreet = captured[0].split(' ');
  if (!/^\d+[A-Z]?$/.test(frozenStreet[0] || '')
    || frozenStreet[0] !== capturedStreet[0]) return null;
  const directions = new Set(['N', 'S', 'E', 'W']);
  const streetTypes = new Set(['ST', 'AVE', 'BLVD', 'RD', 'DR', 'LN', 'CIR', 'HWY']);
  const comparison = [...capturedStreet];
  let addedDirectional = null;
  let addedStreetType = null;
  if (directions.has(comparison[1]) && !directions.has(frozenStreet[1])) {
    addedDirectional = comparison.splice(1, 1)[0];
  }
  if (streetTypes.has(comparison.at(-1)) && !streetTypes.has(frozenStreet.at(-1))) {
    addedStreetType = comparison.pop();
  }
  if ((!addedDirectional && !addedStreetType)
    || comparison.join(' ') !== frozenStreet.join(' ')) return null;
  return { added_directional: addedDirectional, added_street_type: addedStreetType };
}

function compoundStreetTokenSplit(frozenAddressToken, capturedAddressToken) {
  if (!frozenAddressToken || !capturedAddressToken) return null;
  const frozen = frozenAddressToken.split('|');
  const captured = capturedAddressToken.split('|');
  if (frozen.length !== 4 || captured.length !== 4
    || frozen.slice(1).join('|') !== captured.slice(1).join('|')) return null;
  const frozenStreet = frozen[0].split(' ');
  const capturedStreet = captured[0].split(' ');
  if (capturedStreet.length !== frozenStreet.length + 1
    || frozenStreet[0] !== capturedStreet[0]
    || frozenStreet.at(-1) !== capturedStreet.at(-1)) return null;
  for (let index = 1; index < frozenStreet.length - 1; index += 1) {
    if (capturedStreet[index] + capturedStreet[index + 1] !== frozenStreet[index]) continue;
    const collapsed = [
      ...capturedStreet.slice(0, index),
      frozenStreet[index],
      ...capturedStreet.slice(index + 2),
    ];
    if (collapsed.join(' ') !== frozenStreet.join(' ')) continue;
    return {
      compound_token: frozenStreet[index],
      captured_parts: [capturedStreet[index], capturedStreet[index + 1]],
    };
  }
  return null;
}

function capturedRangeContainsFrozenNumber(frozenAddressToken, capturedAddressToken) {
  if (!frozenAddressToken || !capturedAddressToken) return null;
  const frozen = frozenAddressToken.split('|');
  const captured = capturedAddressToken.split('|');
  if (frozen.length !== 4 || captured.length !== 4
    || frozen.slice(1).join('|') !== captured.slice(1).join('|')) return null;
  const frozenStreet = frozen[0].match(/^(\d+)\s+(.+)$/);
  const capturedStreet = captured[0].match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!frozenStreet || !capturedStreet) return null;
  const frozenNumber = Number(frozenStreet[1]);
  const rangeStart = Number(capturedStreet[1]);
  const rangeEnd = Number(capturedStreet[2]);
  if (rangeStart >= rangeEnd
    || frozenStreet[2] !== capturedStreet[3]
    || frozenNumber < rangeStart
    || frozenNumber > rangeEnd) return null;
  return { frozen_number: frozenNumber, range_start: rangeStart, range_end: rangeEnd };
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

function approvedOperatingIdentityAlias(target, context, capturedAddressToken) {
  const aliases = Array.isArray(target.cms_evidence?.approved_operating_identity_aliases)
    ? target.cms_evidence.approved_operating_identity_aliases
    : [];
  const facilityName = normalizeTenantIdentityName(target.cms_identity?.facility_name);
  const capturedNames = new Set(contextTenantNames(context));
  for (const alias of aliases) {
    if (alias?.status !== 'approved'
      || alias?.reason_code !== 'legal_entity_operating_identity_same_site'
      || alias?.address_token !== capturedAddressToken
      || normalizeTenantIdentityName(alias?.cms_facility_name) !== facilityName
      || !clean(alias?.authorized_by)
      || !/^\d{4}-\d{2}-\d{2}T/.test(clean(alias?.authorized_at))) continue;
    const operatingNames = (Array.isArray(alias.operating_names) ? alias.operating_names : [])
      .map(normalizeTenantIdentityName).filter(Boolean);
    const matchedName = operatingNames.find((name) => capturedNames.has(name));
    if (!matchedName) continue;
    const citations = Array.isArray(alias.evidence_citations) ? alias.evidence_citations : [];
    const officialHosts = new Set();
    for (const citation of citations) {
      if (clean(citation?.source).toLowerCase() !== 'official_operator') continue;
      try {
        const url = new URL(clean(citation?.url));
        if (url.protocol === 'https:') officialHosts.add(url.hostname.toLowerCase());
      } catch {
        // Invalid citations cannot authorize an identity alias.
      }
    }
    if (officialHosts.size < 2) continue;
    return { ...alias, matched_operating_name: matchedName };
  }
  return null;
}

function normalizeParcelNumber(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function approvedSameParcelAddressConflict(target, context, frozenAddressToken, capturedAddressToken) {
  const aliases = Array.isArray(target.cms_evidence?.approved_same_parcel_address_conflicts)
    ? target.cms_evidence.approved_same_parcel_address_conflicts
    : [];
  const capturedParcel = normalizeParcelNumber(context.parcel_number);
  if (!capturedParcel) return null;
  return aliases.find((alias) => {
    if (alias?.status !== 'approved'
      || alias?.reason_code !== 'service_location_mailing_address_same_parcel'
      || alias?.frozen_address_token !== frozenAddressToken
      || alias?.captured_address_token !== capturedAddressToken
      || normalizeParcelNumber(alias?.parcel_number) !== capturedParcel
      || !clean(alias?.authorized_by)
      || !/^\d{4}-\d{2}-\d{2}T/.test(clean(alias?.authorized_at))) return false;
    const citations = Array.isArray(alias.evidence_citations) ? alias.evidence_citations : [];
    const sources = new Set(citations
      .filter((citation) => /^https:\/\//i.test(clean(citation?.url)))
      .map((citation) => clean(citation?.source).toLowerCase()));
    return sources.has('official_facility_registry')
      && sources.has('licensed_property_public_record');
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
  // Frozen rows predate later deterministic normalizer additions. Recompute a
  // comparison token from the immutable CMS identity so those additions can
  // apply without rewriting the stored frozen token or weakening location
  // matching. The original token remains the capture's database binding.
  const storedTokenParts = clean(target.address_token).split('|');
  const normalizedStoredToken = storedTokenParts.length === 4
    ? normalizeAscAddressToken({
      address: storedTokenParts[0], city: storedTokenParts[1],
      state: storedTokenParts[2], zip: storedTokenParts[3],
    })
    : null;
  const normalizedCmsToken = normalizeAscAddressToken(target.cms_identity);
  const frozenComparisonToken = normalizedStoredToken
    && normalizedStoredToken === normalizedCmsToken
    ? normalizedCmsToken
    : target.address_token;
  const coveSuffixEquivalence = addressToken === frozenComparisonToken
    ? uspsCoveSuffixEquivalence(target.cms_identity, context)
    : null;
  let identityMatch = { mode: 'exact_address_token' };
  if (coveSuffixEquivalence) {
    identityMatch = {
      mode: 'usps_cove_suffix_equivalence',
      frozen_suffix: coveSuffixEquivalence.frozen_suffix,
      captured_suffix: coveSuffixEquivalence.captured_suffix,
      cms_address_preserved: clean(target.cms_identity?.address),
      captured_address_preserved: clean(context.address),
      frozen_address_token_preserved: target.address_token,
      normalized_comparison_token: frozenComparisonToken,
      second_review_required: true,
    };
  } else if (addressToken === frozenComparisonToken && frozenComparisonToken !== target.address_token) {
    identityMatch = {
      mode: 'normalized_frozen_identity_address',
      frozen_address_token_preserved: target.address_token,
      normalized_comparison_token: frozenComparisonToken,
    };
  } else if (addressToken !== frozenComparisonToken) {
    const cmsIdentity = target.cms_identity || {};
    const exactTenantCorroboration = corroboratingTenant(target, context);
    const corroboration = exactTenantCorroboration
      || singleTenantOrganizationFamilyCorroboration(target, context);
    const addressAlias = approvedParentAddressAlias(target, addressToken);
    const operatingIdentityAlias = approvedOperatingIdentityAlias(
      target,
      context,
      addressToken,
    );
    const sameParcelAddressConflict = approvedSameParcelAddressConflict(
      target,
      context,
      frozenComparisonToken,
      addressToken,
    );
    const parentBuildingMatch = hasAscSublocation(cmsIdentity.address)
      && buildingAddressTokensAgree(
        normalizeAscBuildingAddressToken(cmsIdentity),
        normalizeAscBuildingAddressToken(context),
      )
      && corroboration;
    const aliasMatch = addressAlias && corroboration;
    const operatingIdentityAliasMatch = operatingIdentityAlias
      && hasAscSublocation(cmsIdentity.address)
      && buildingAddressTokensAgree(
        normalizeAscBuildingAddressToken(cmsIdentity),
        normalizeAscBuildingAddressToken(context),
      );
    const sameParcelAddressConflictMatch = sameParcelAddressConflict
      && exactTenantCorroboration;
    const rangeContainment = capturedRangeContainsFrozenNumber(frozenComparisonToken, addressToken);
    const rangeContainmentMatch = rangeContainment && corroboration;
    const controlledFacilityAlias = controlledAscFacilityAlias(target, context);
    const ownerEnrollmentCorroboration = ownerEnrollmentOrganizationCorroboration(target, context);
    const multiSignalRangeMatch = rangeContainment
      && controlledFacilityAlias
      && ownerEnrollmentCorroboration;
    const municipalityAlias = terminalTownshipMunicipalityAlias(frozenComparisonToken, addressToken);
    const municipalityAliasMatch = municipalityAlias && exactTenantCorroboration;
    const directionalStreetTypeExtension = capturedDirectionalStreetTypeExtension(
      frozenComparisonToken,
      addressToken,
    );
    const directionalStreetTypeMatch = !parentBuildingMatch
      && hasAscSublocation(cmsIdentity.address)
      && directionalStreetTypeExtension
      && exactTenantCorroboration;
    const compoundStreetSplit = compoundStreetTokenSplit(frozenComparisonToken, addressToken);
    const facilityCorroboration = exactFacilityCorroboration(target, context);
    const compoundStreetSplitMatch = compoundStreetSplit && facilityCorroboration;
    if (!parentBuildingMatch && !aliasMatch && !operatingIdentityAliasMatch
      && !sameParcelAddressConflictMatch
      && !rangeContainmentMatch && !multiSignalRangeMatch
      && !municipalityAliasMatch && !directionalStreetTypeMatch
      && !compoundStreetSplitMatch) {
      throw new Error('Captured page does not match the active frozen ASC candidate');
    }
    identityMatch = sameParcelAddressConflictMatch ? {
      mode: 'approved_same_parcel_address_conflict',
      alias_reason_code: sameParcelAddressConflict.reason_code,
      parcel_number: clean(context.parcel_number),
      cms_service_address_preserved: clean(cmsIdentity.address),
      captured_property_address_preserved: clean(context.address),
      frozen_address_token: frozenComparisonToken,
      captured_address_token: addressToken,
      corroboration_basis: exactTenantCorroboration.basis,
      corroborated_name: exactTenantCorroboration.matched_name,
      second_review_required: true,
    } : operatingIdentityAliasMatch ? {
      mode: 'approved_operating_identity_parent_building',
      alias_reason_code: operatingIdentityAlias.reason_code,
      cms_facility_name_preserved: clean(cmsIdentity.facility_name),
      captured_operating_name: operatingIdentityAlias.matched_operating_name,
      cms_sublocation_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      second_review_required: true,
    } : multiSignalRangeMatch ? {
      mode: 'controlled_multisignal_range_identity',
      frozen_street_number: rangeContainment.frozen_number,
      captured_range_start: rangeContainment.range_start,
      captured_range_end: rangeContainment.range_end,
      facility_alias_basis: controlledFacilityAlias.basis,
      organization_core: controlledFacilityAlias.organization_core,
      cms_facility_name_preserved: clean(cmsIdentity.facility_name),
      captured_tenant_name_preserved: controlledFacilityAlias.captured_tenant_name,
      owner_corroboration_basis: ownerEnrollmentCorroboration.basis,
      captured_owner_name_preserved: ownerEnrollmentCorroboration.captured_owner_name,
      enrollment_organization_preserved: ownerEnrollmentCorroboration.enrollment_organization,
      cms_address_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      second_review_required: true,
    } : compoundStreetSplitMatch ? {
      mode: 'facility_corroborated_compound_street_split',
      frozen_compound_token: compoundStreetSplit.compound_token,
      captured_street_parts: compoundStreetSplit.captured_parts,
      corroboration_basis: facilityCorroboration.basis,
      corroborated_name: facilityCorroboration.matched_name,
      cms_address_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      second_review_required: true,
    } : directionalStreetTypeMatch ? {
      mode: 'tenant_corroborated_directional_street_type_extension',
      added_directional: directionalStreetTypeExtension.added_directional,
      added_street_type: directionalStreetTypeExtension.added_street_type,
      corroboration_basis: exactTenantCorroboration.basis,
      corroborated_name: exactTenantCorroboration.matched_name,
      cms_sublocation_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      facility_name: clean(cmsIdentity.facility_name),
      second_review_required: true,
    } : municipalityAliasMatch ? {
      mode: 'tenant_corroborated_municipality_alias',
      cms_city_preserved: clean(cmsIdentity.city),
      captured_city: clean(context.city),
      frozen_city_token: municipalityAlias.frozen_city,
      captured_city_token: municipalityAlias.captured_city,
      corroboration_basis: exactTenantCorroboration.basis,
      corroborated_name: exactTenantCorroboration.matched_name,
      facility_name: clean(cmsIdentity.facility_name),
      second_review_required: true,
    } : rangeContainmentMatch ? {
      mode: 'tenant_corroborated_range_containment',
      frozen_street_number: rangeContainment.frozen_number,
      captured_range_start: rangeContainment.range_start,
      captured_range_end: rangeContainment.range_end,
      corroboration_basis: corroboration.basis,
      corroborated_name: corroboration.matched_name,
      cms_address_preserved: clean(cmsIdentity.address),
      captured_building_address: clean(context.address),
      facility_name: clean(cmsIdentity.facility_name),
      second_review_required: true,
    } : aliasMatch ? {
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
        : corroboration.basis === 'single_tenant_organization_family'
          ? 'single_tenant_organization_family_parent_building'
        : 'enrollment_org_corroborated_parent_building',
      corroboration_basis: corroboration.basis,
      corroborated_name: corroboration.matched_name,
      ...(corroboration.organization_family
        ? { organization_family: corroboration.organization_family, second_review_required: true }
        : {}),
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
