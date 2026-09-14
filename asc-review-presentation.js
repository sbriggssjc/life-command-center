const PREFERRED_FIELDS = Object.freeze([
  ['building_name', 'Building'], ['property_subtype', 'Property subtype'],
  ['building_class', 'Building class'], ['square_footage', 'Building area'],
  ['year_built', 'Year built'], ['year_renovated', 'Year renovated'],
  ['lot_size', 'Lot size'], ['land_sf', 'Land area'], ['stories', 'Stories'],
  ['parking', 'Parking'], ['zoning', 'Zoning'], ['occupancy', 'Occupancy'],
  ['parcel_number', 'Parcel / APN'], ['county', 'County'],
  ['tenant_name', 'Tenant'], ['primary_tenant', 'Primary tenant'],
  ['tenancy_type', 'Tenancy'], ['owner_occupied', 'Owner occupied'],
  ['ownership_type', 'Ownership type'], ['lease_type', 'Lease type'],
  ['lease_term', 'Lease term'], ['remaining_term', 'Remaining term'],
  ['lease_expiration', 'Lease expiration'], ['rent_per_sf', 'Rent / SF'],
  ['annual_rent', 'Annual rent'], ['expense_structure', 'Expense structure'],
  ['asking_price', 'Asking price'], ['cap_rate', 'Cap rate'], ['noi', 'NOI'],
  ['sale_price', 'Sale price'], ['sale_date', 'Sale date'],
  ['tenants', 'Tenants'], ['contacts', 'Contacts'], ['sales_history', 'Sales history'],
  ['loans', 'Loans'], ['documents', 'Documents'], ['document_links', 'Document links'],
]);

export function safeEvidenceUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function formatEvidenceValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (!value.length) return 'None recorded';
    return value.slice(0, 5).map(formatEvidenceValue).join(' · ') + (value.length > 5 ? ` · +${value.length - 5} more` : '');
  }
  if (typeof value === 'object') {
    const preferred = value.name || value.tenant_name || value.owner_name || value.summary || value.title;
    if (preferred) return String(preferred);
    return Object.entries(value).slice(0, 4).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${formatEvidenceValue(item)}`).join('; ');
  }
  return String(value);
}

export function summarizeCapture(capture = {}, index = 0) {
  const payload = capture.structured_payload || {};
  const fields = PREFERRED_FIELDS
    .filter(([key]) => payload[key] !== null && payload[key] !== undefined && payload[key] !== '')
    .slice(0, 14)
    .map(([key, label]) => ({ label, value: formatEvidenceValue(payload[key]) }));
  const reconciliation = capture.reconciliation?.asc_identity_match || capture.reconciliation || {};
  return {
    title: `${String(capture.source || 'licensed source').toUpperCase()} capture${index === 0 ? ' · latest' : ' · earlier'}`,
    sourceUrl: safeEvidenceUrl(capture.source_url),
    capturedAt: capture.captured_at || null,
    address: [capture.address, capture.city, capture.state, capture.zip].filter(Boolean).join(', ') || 'No captured address',
    fields,
    identity: {
      mode: reconciliation.mode || reconciliation.match_mode || null,
      basis: reconciliation.corroboration_basis || reconciliation.basis || null,
      secondReviewRequired: reconciliation.second_review_required === true,
    },
  };
}

export function validatePrimaryDraft(draft = {}) {
  const blockers = [];
  if (typeof draft.clinicalVerified !== 'boolean') blockers.push('Choose Yes or No for clinical identity.');
  if (!draft.propertyForm) blockers.push('Choose a property form; use Unknown when the evidence does not establish one.');
  const minuteKeys = ['clinical', 'property', 'ownership', 'economics', 'contact'];
  for (const key of minuteKeys) {
    const value = Number(draft.researchMinutes?.[key]);
    if (!Number.isFinite(value) || value < 0 || draft.researchMinutes?.[key] === '') blockers.push(`Enter nonnegative ${key} research minutes.`);
  }
  for (const [key, label] of [['ownershipEvidence', 'Ownership evidence'], ['citations', 'Evidence citations']]) {
    try {
      const value = JSON.parse(draft[key] || '[]');
      if (!Array.isArray(value)) blockers.push(`${label} must be a JSON array.`);
    } catch {
      blockers.push(`${label} is not valid JSON.`);
    }
  }
  return blockers;
}
