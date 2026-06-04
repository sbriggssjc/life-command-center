// ============================================================================
// normalize-street-address.js — canonical street-address normalization
// Life Command Center
//
// Why this exists (2026-06-04 intake-match forensic):
//   Recent review_required OM intakes with an extracted address were
//   uniformly match_status='unmatched'. Sampling proved the property
//   already existed in the domain DB and failed PURELY on street
//   normalization — the OM and the DB disagreed on directional spelling
//   (N vs North) and suffix spelling (Ave vs Avenue):
//     OM "198 N Springfield Ave"   vs  dia "198 North Springfield Avenue"
//     OM "1809 West Chapman Avenue" vs  dia "1809 W Chapman Ave"
//     OM "506 N Patterson St"       vs  dia "506 North Patterson St"
//
//   The pre-existing entity-link.js::normalizeAddress() only collapsed
//   suffixes one-way (Avenue→Ave) and DID NOT canonicalize directionals
//   (North stayed "north", N stayed "n"), so the two sides never lined up
//   as equal strings. This module canonicalizes BOTH directionals and
//   suffixes to a single short form, strips unit/suite/floor designators,
//   and collapses case/punctuation/whitespace so that the three pairs
//   above (and their kin) produce identical keys.
//
//   Apply normalizeStreetAddress() to BOTH sides of any address comparison.
//
// Pure functions — no side effects, no I/O. Safe to import anywhere.
// ============================================================================

// Directional names → single/double-letter canonical form. Compound forms
// (northeast, northwest, …) must be listed so they map to NE/NW/… rather
// than being split into "n"+"e".
const DIRECTIONAL_MAP = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  // already-short forms are left as-is by virtue of being absent here, but
  // we include the dotted possibilities by stripping punctuation first.
};

// Street-type suffix → canonical short form. Both the long spelling and the
// common abbreviations map to the same token so "Avenue", "Ave", and "Av"
// all collapse to "ave".
const SUFFIX_MAP = {
  avenue: 'ave', ave: 'ave', av: 'ave', aven: 'ave', avenu: 'ave',
  street: 'st', st: 'st', str: 'st', strt: 'st',
  boulevard: 'blvd', blvd: 'blvd', boul: 'blvd', boulv: 'blvd',
  drive: 'dr', dr: 'dr', drv: 'dr',
  road: 'rd', rd: 'rd',
  lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct', crt: 'ct',
  parkway: 'pkwy', pkwy: 'pkwy', pky: 'pkwy', parkwy: 'pkwy',
  highway: 'hwy', hwy: 'hwy', hway: 'hwy',
  place: 'pl', pl: 'pl',
  terrace: 'ter', ter: 'ter', terr: 'ter',
  circle: 'cir', cir: 'cir', circ: 'cir',
  trail: 'trl', trl: 'trl',
  square: 'sq', sq: 'sq',
  plaza: 'plz', plz: 'plz',
  way: 'way',
  loop: 'loop',
  run: 'run',
  pike: 'pike',
  route: 'rte', rte: 'rte',
};

// Number-word → digit folding (Round 77f, 2026-06-04). US street names spell
// numbers both ways: OM "27150 Eight Mile Road" vs dia "27150 W 8 Mile Rd".
// Folding the cardinal/ordinal words to their digit form lets the two sides
// produce the same canonical key. Cardinals one–twenty cover essentially all
// numbered US streets; ordinals first–tenth cover "1st St" / "First Street".
const NUMBER_WORD_MAP = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
};

// Unit / suite / floor designators stripped before tokenization. These carry
// no value for property identity and frequently differ between the OM and the
// canonical record. Run while punctuation (esp. '#') is still present.
const UNIT_KEYWORD_RE =
  /\b(?:ste|suite|unit|apt|apartment|fl|flr|floor|rm|room|bldg|building|dept|department|space|spc|lot|trlr|hangar|slip|key|stop|pier)\.?\s*#?\s*[a-z0-9-]+\b/gi;
const ORDINAL_FLOOR_RE =
  /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|ground|lower|upper|basement|mezzanine|penthouse)\s+floor\b/gi;
const HASH_UNIT_RE = /#\s*[a-z0-9-]+/gi;

/**
 * Canonicalize a single US street address for equality comparison.
 *
 *  - takes the portion before the first comma (drops ", City, ST ZIP")
 *  - strips unit / suite / floor / "#B" designators
 *  - lowercases, removes punctuation, collapses whitespace
 *  - maps directional words to letters (North → n, Southwest → sw)
 *  - maps street-type suffixes to a single short form (Avenue/Ave/Av → ave)
 *
 * @param {string|null|undefined} addr
 * @returns {string} normalized key (possibly empty)
 */
export function normalizeStreetAddress(addr) {
  if (addr == null) return '';
  let s = String(addr);

  // 1. Drop everything after the first comma — street addresses almost never
  //    contain a comma, but "37139 Highway 26, Sandy, OR 97055" style values
  //    do. Keeping only the street portion gives a fair comparison.
  s = s.split(',')[0];

  // 1b. Collapse a leading street-number RANGE to its first number (Round 77f,
  //     2026-06-04). OM "2064 - 2066 Atlantic Ave" ↔ dia "2064 Atlantic Ave":
  //     the range refers to the same building, so the first number is the
  //     canonical key. Runs while the hyphen/en-dash is still present.
  s = s.replace(/^(\s*\d+)\s*[-–—]\s*\d+\b/, '$1');

  // 2. Strip unit/suite/floor designators while '#' is still present.
  s = s.replace(UNIT_KEYWORD_RE, ' ')
       .replace(ORDINAL_FLOOR_RE, ' ')
       .replace(HASH_UNIT_RE, ' ');

  // 3. Lowercase, replace any non-alphanumeric run with a single space.
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return '';

  // 4. Token-by-token canonicalization of directionals + suffixes + number
  //    words. Number-word folding runs first so "eight" → "8" before the
  //    suffix/directional checks (none of which it can collide with).
  const tokens = s.split(/\s+/).map((tok) => {
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORD_MAP, tok)) return NUMBER_WORD_MAP[tok];
    if (Object.prototype.hasOwnProperty.call(DIRECTIONAL_MAP, tok)) return DIRECTIONAL_MAP[tok];
    if (Object.prototype.hasOwnProperty.call(SUFFIX_MAP, tok)) return SUFFIX_MAP[tok];
    return tok;
  });

  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Variant of the normalized key with directional tokens removed entirely.
 * Useful as a looser fallback when the OM and the canonical record disagree
 * on whether a directional is present at all ("991 Johnstown Rd" vs
 * "991 E Johnstown Rd"). Operates on the output of normalizeStreetAddress.
 *
 * @param {string} normalized — output of normalizeStreetAddress
 * @returns {string}
 */
export function stripDirectionalTokens(normalized) {
  if (!normalized) return '';
  const dirSet = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
  return String(normalized)
    .split(/\s+/)
    .filter((tok) => !dirSet.has(tok))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull the leading house/street number off an address so a candidate query
 * can be narrowed with an `address=ilike.<num>*` filter before normalized
 * comparison in JS. Returns null when the address doesn't start with a number.
 *
 * @param {string|null|undefined} addr
 * @returns {string|null}
 */
export function leadingStreetNumber(addr) {
  if (addr == null) return null;
  const m = String(addr).trim().match(/^(\d+)\b/);
  return m ? m[1] : null;
}

/**
 * Split a possibly-multi-property address field into individual
 * {address, tenant} pairs.
 *
 * Multi-property OMs frequently dump every address into one field as:
 *   - a JSON-array string:  '["1208 Scottsville Road", "350 Preakness Avenue"]'
 *   - a real array:         ['1208 Scottsville Road', '350 Preakness Avenue']
 *   - a pipe join:          '1208 Scottsville Road | 350 Preakness Avenue'
 *   - a semicolon join:     '1208 Scottsville Road; 350 Preakness Avenue'
 *
 * The tenant field is paired by index when it parses into a parallel array /
 * join of the same length; otherwise the (single) tenant is broadcast to
 * every address.
 *
 * A plain single address with no separators returns a one-element array.
 * Plain strings are NOT split on whitespace or other heuristics — only the
 * explicit array / pipe / semicolon shapes above trigger a split, and a
 * separator split only counts when ≥2 resulting parts each contain a digit
 * (a street-number signal) so a value like "Smith & Jones; LLC" is left alone.
 *
 * @param {string|string[]|null|undefined} addressField
 * @param {string|string[]|null|undefined} [tenantField]
 * @returns {Array<{address: string, tenant: string|null}>}
 */
export function splitMultiAddress(addressField, tenantField) {
  const addresses = coerceToList(addressField, /* requireDigit */ true);
  if (!addresses.length) {
    // Nothing splittable — return the raw single value (may be empty).
    const single = typeof addressField === 'string' ? addressField.trim() : '';
    return [{ address: single, tenant: coerceSingleTenant(tenantField) }];
  }
  if (addresses.length === 1) {
    return [{ address: addresses[0], tenant: coerceSingleTenant(tenantField) }];
  }

  // Multi. Try to pair tenants by index.
  const tenants = coerceToList(tenantField, /* requireDigit */ false);
  return addresses.map((address, i) => ({
    address,
    tenant: tenants.length === addresses.length
      ? (tenants[i] || null)
      : coerceSingleTenant(tenantField),
  }));
}

/**
 * Coerce a field into a list of trimmed strings if (and only if) it has the
 * shape of a multi-value field (array, JSON-array string, or pipe/semicolon
 * join). Returns [] for a plain single value so callers can detect "not multi".
 */
function coerceToList(field, requireDigit) {
  if (field == null) return [];

  // Real array.
  if (Array.isArray(field)) {
    const parts = field.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
    return parts.length >= 2 ? parts : (parts.length === 1 ? parts : []);
  }

  if (typeof field !== 'string') return [];
  const raw = field.trim();
  if (!raw) return [];

  // JSON-array string.
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const parts = parsed.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
        if (parts.length >= 1) return parts;
      }
    } catch {
      // fall through to separator handling
    }
  }

  // Pipe / semicolon join.
  if (raw.includes('|') || raw.includes(';')) {
    const parts = raw.split(/[|;]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (!requireDigit) return parts;
      // Only treat as a genuine multi-address split when ≥2 parts look like
      // street addresses — i.e. START with a house number. This rejects
      // "198 Main St; Suite 4" (the second part is a unit, not an address).
      const streetLike = parts.filter((p) => /^\s*\d/.test(p));
      if (streetLike.length >= 2) return parts;
    }
  }

  return [];
}

/** Reduce a tenant field to a single representative string (or null). */
function coerceSingleTenant(tenantField) {
  if (tenantField == null) return null;
  if (Array.isArray(tenantField)) {
    const first = tenantField.find((x) => x != null && String(x).trim());
    return first != null ? String(first).trim() : null;
  }
  const raw = String(tenantField).trim();
  if (!raw) return null;
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const first = parsed.find((x) => x != null && String(x).trim());
        return first != null ? String(first).trim() : null;
      }
    } catch { /* ignore */ }
  }
  return raw;
}
