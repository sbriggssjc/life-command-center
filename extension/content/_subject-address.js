// ============================================================================
// LCC Assistant — CoStar subject-address + tenant-header guards (SIDEBAR5)
// Pure, DOM-free helpers. Loaded as a content script before costar.js
// (manifest order) and importable from Node for unit tests. Publishes
// `globalThis.__lccSubjectAddress`.
//
// WHY (Scott, 2026-09-23, CoStar #1014478): saving "2600 Central Fwy N -
// Wichita Falls Shopping Center" from its Contacts tab captured the PRIMARY
// LEASING COMPANY's office ("4005 Call Field Rd, Suite 100") as the property,
// and minted gov property 41083 at that address. Two defects compounded:
//   1. "Fwy" was not a known street type, so the real header failed to parse
//      in the <h1> and in document.title;
//   2. the body-wide line walk ran BEFORE document.title and had no stop at a
//      contact block it did not know ("Primary Leasing Company"), so it walked
//      down the Contacts tab and returned the firm's office.
// The rule now: the subject address comes from the property HEADER only —
// headings, then document.title, then the page lines ABOVE the first
// contact/party section. If none of those yields an address, the capture
// carries address=null + _subject_address_status='header_not_found' and the
// side panel refuses to save it. There is no contact-block fallback.
// ============================================================================

(function () {
  'use strict';

  // A contact/party section on any CoStar tab. The page lines at or below the
  // first of these are never read for the subject address. Start-anchored with
  // no trailing \b: CoStar two-column panels concatenate label and value
  // ("Primary Leasing CompanyTruity Capital"). Bare words that also appear as
  // tab names or field labels ("Contacts", "Owner", "Developer") are NOT here —
  // a tab strip rendered above the header would otherwise empty the region.
  const CONTACT_SECTION_RE = /^(primary\s+leasing\s+compan(?:y|ies)|leasing\s+compan(?:y|ies)|leasing\s+contacts?|leasing\s+agents?|primary\s+leasing\s+contacts?|property\s+contacts|sales?\s+comp(?:any|anies)|sales?\s+contacts?|listing\s+contacts?|listing\s+broker|buyer\s+broker|recorded\s+(?:owner|buyer|seller)|true\s+(?:owner|buyer|seller)|current\s+owner|previous\s+owner|parent\s+compan(?:y|ies)|property\s+manage(?:r|ment)|architects?\b|architecture\s+firm|developers?\s*[-–—:]|general\s+contractor|contractor\b|engineer(?:ing)?\s+firm|builder\b|lender\b|borrower\b|originator\b|about\s+the\s+(?:owner|architect|developer|leasing\s+company|broker|buyer|seller|firm))/i;

  function isContactSectionHeader(line) {
    return CONTACT_SECTION_RE.test(String(line || '').trim());
  }

  // Lines above the first contact/party section. The property header is always
  // at the top of every CoStar tab; contact blocks are always below it.
  function headerRegionLines(lines) {
    const out = [];
    for (const raw of lines || []) {
      const line = String(raw || '').trim();
      if (!line) continue;
      if (isContactSectionHeader(line)) break;
      out.push(line);
    }
    return out;
  }

  // Order is the contract: headings → document.title → header-region lines.
  // `parse` is costar.js parseAddress; `findInLines` is costar.js
  // findAddressInLines. Returns { address, source } where source is one of
  // 'heading' | 'title' | 'header_lines', or { address: null,
  // source: null, status: 'header_not_found' }.
  function resolveSubjectAddress({ headingTexts, title, lines, parse, findInLines }) {
    for (const t of headingTexts || []) {
      const a = parse(String(t || '').trim());
      if (a) return { address: a, source: 'heading', status: 'ok' };
    }
    const fromTitle = title ? parse(String(title)) : null;
    if (fromTitle) return { address: fromTitle, source: 'title', status: 'ok' };
    const region = headerRegionLines(lines);
    const fromRegion = region.length ? findInLines(region) : null;
    if (fromRegion) return { address: fromRegion, source: 'header_lines', status: 'ok' };
    return { address: null, source: null, status: 'header_not_found' };
  }

  // ── Street comparison (mirror of api/_shared/intake-address-guard.js
  //    streetKey; SIDEBAR5 server check is the authority, this is only used
  //    to tell the panel about a disagreement before Save) ──────────────────
  const DIRS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west']);

  function streetParts(address) {
    const line = String(address || '').split(',')[0].toLowerCase().replace(/[.#]/g, ' ');
    const m = line.match(/^\s*(\d+)(?:\s*-\s*(\d+))?\s+(.+)$/);
    if (!m) return null;
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    const words = m[3].split(/\s+/).filter(Boolean);
    const name = words.find((w) => !DIRS.has(w)) || null;
    return { lo, hi, name };
  }

  // true = same building street; false = a different street/number; null = no opinion.
  function streetsAgree(a, b) {
    const x = streetParts(a);
    const y = streetParts(b);
    if (!x || !y) return null;
    if (!(x.lo <= y.hi && y.lo <= x.hi)) return false;
    if (x.name && y.name && x.name !== y.name) return false;
    return true;
  }

  // ── LEASEJUNK1 header list, extension side (lock-step) ────────────────────
  // BYTE-FOR-BYTE the same list as OM_TABLE_HEADER_TENANTS in
  // api/_handlers/sidebar-pipeline.js (and SQL dia_is_om_table_header_tenant()).
  // test/sidebar5-subject-address-and-header-tenants.test.mjs fails if they
  // drift. Edit all three together.
  const COSTAR_HEADER_TENANTS = Object.freeze([
    // rent-roll / tenant-table column headers
    'type', 'tenant', 'tenant name', 'tenants', 'suite', 'unit', 'sq ft', 'sq. ft', 'sf', 'rsf',
    'size', 'rent', 'annual rent', 'monthly rent', 'base rent', 'rent/sf', 'rent psf', 'term',
    'lease term', 'lease start', 'lease end', 'lease expiration', 'lease exp', 'commencement',
    'expiration', 'notes', 'comments', 'options', 'renewal options', 'increases', 'escalations',
    '% of gla', 'pro rata share', 'lease type', 'avail. spaces', 'avail spaces', 'available spaces',
    // CoStar panel headers / summary rows / section labels
    'shopping center', 'strip center', 'total avail', 'office/med avail', 'office/ret avail',
    'retail avail', 'asking', 'anchor', 'anchors', 'sale highlights', 'sale broker',
    'recorded owner', 'property contacts', 'store type', 'analytics', 'starting', 'financials',
    'loan', 'about the architect', 'public transportation', 'commuter rail', 'services',
    // lease-type cell values read as a tenant
    'triple net', 'double net', 'absolute net', 'full service', 'modified gross', 'cam', 'nnn',
  ]);
  const HEADER_SET = new Set(COSTAR_HEADER_TENANTS);

  // Mirror of normalizeHeaderCandidate (JS) / dia_normalize_header_candidate (SQL).
  function normalizeHeaderCandidate(name) {
    return String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[:.\s]+$/, '');
  }

  function isHeaderTenantName(name) {
    if (name == null) return false;
    return HEADER_SET.has(normalizeHeaderCandidate(name));
  }

  function filterHeaderTenants(tenants) {
    if (!Array.isArray(tenants)) return tenants;
    return tenants.filter((t) => !isHeaderTenantName(t && typeof t === 'object' ? t.name : t));
  }

  const api = {
    CONTACT_SECTION_RE,
    isContactSectionHeader,
    headerRegionLines,
    resolveSubjectAddress,
    streetParts,
    streetsAgree,
    COSTAR_HEADER_TENANTS,
    normalizeHeaderCandidate,
    isHeaderTenantName,
    filterHeaderTenants,
  };

  if (typeof globalThis !== 'undefined') globalThis.__lccSubjectAddress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
