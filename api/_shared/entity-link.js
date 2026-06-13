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
 * Strip a CoStar/LoopNet listing-status prefix off a street address.
 * CoStar's For Sale tab heading and LoopNet's listing tile read
 * "For Sale | 1164 Route 130 North" — the extension's parseAddress
 * splits on `\s+|\s+`, but the address-element fallbacks
 * (LoopNet [data-testid="listing-address"], CoStar h1 textContent on
 * pages where parseAddress's number-prefix guard rejects the segmented
 * form) leak the prefix through. When that prefixed string lands in
 * `properties.address` it creates a duplicate row keyed on the bogus
 * "For Sale | 1164 Route 130 North" instead of merging into the
 * canonical "1164 Route 130 North" row. This helper is applied at
 * every write seam (entity insert, property upsert) and before
 * normalization, so the bad prefix never leaves the API layer.
 */
export function stripListingStatusPrefix(addr) {
  if (!addr) return addr;
  // Round 76ei: also recognize "<property type> <disposition>:" headings
  // used on CoStar Sale Comp / Lease Comp pages (e.g. "Condo Sold: 326
  // Del Prado Blvd, 1st Floor - 101", "Office Sold: 1234 Foo St"). When
  // the sidebar captures a comp-detail page, the H1 / document.title
  // carries this prefix; without stripping it, parseAddress in the
  // content script returns null and the sidebar shows the empty state
  // instead of recognizing the property.
  const PROP_TYPE = '(?:condo|office|industrial|retail|land|hotel|multifamily|multi-family|specialty|flex|medical(?:\\s+office)?|health\\s*care|sports?(?:\\s*&\\s*\\w+)?|self\\s*storage|mobile\\s*home(?:\\s+park)?|mixed\\s*use|apartments?|warehouse|shopping\\s+center|strip\\s+center)';
  const DISPOSITION = '(?:for\\s+sale|for\\s+lease|for\\s+rent|sale|sold|lease|leased|rent|rented|new\\s+listing|reduced|price\\s+reduced|just\\s+listed|coming\\s+soon|under\\s+contract|off\\s+market|new\\s+price)';
  const PREFIX_RE = new RegExp(`^\\s*(?:${PROP_TYPE}\\s+)?${DISPOSITION}\\s*[|\\-–—:]\\s*`, 'i');
  // Round 76ej.k (2026-05-05): also strip an email-subject doctype prefix
  // ("OM:", "OM -", "Flyer:", "Marketing Brochure:" etc.). Power Automate
  // emails often arrive with subject lines like "OM: 1234 Main St, City, ST"
  // and AI extraction occasionally lifts the entire subject straight into
  // the address field; without stripping the prefix the normalized address
  // becomes "om: 1234 main st" and matchAgainstDomain misses the
  // canonical "1234 main st" record.
  const DOCTYPE_PREFIX_RE = /^\s*(?:om|offering(?:\s+memorandum)?|flyer|marketing\s+brochure|broker\s+package|listing|new\s+listing\s+alert)\s*[|\-–—:]\s*/i;
  let out = String(addr);
  // Loop in case multiple prefixes stack ("For Sale | New Listing | 1164 Route...")
  for (let i = 0; i < 3; i++) {
    let next = out.replace(PREFIX_RE, '');
    next = next.replace(DOCTYPE_PREFIX_RE, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Normalize a street address for duplicate detection.
 * Collapses common street-type abbreviation variants ("Street"/"St",
 * "Road"/"Rd", etc.) and lowercases so CoStar records using different
 * spellings from existing CMS records resolve to the same key.
 */
export function normalizeAddress(addr) {
  if (!addr) return '';
  // Strip trailing ", City, ST ZIP" — AI extractors often emit full
  // "37139 Highway 26, Sandy, OR 97055" while the domain DBs store only the
  // street portion "37139 Us-26 Hwy". Truncating at the first comma gives
  // the matcher a fair chance on the street address alone. Street addresses
  // almost never contain commas, so this is safe in practice.
  const beforeComma = stripListingStatusPrefix(String(addr)).split(',')[0];
  return beforeComma.trim()
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

// ===========================================================================
// external_identities canonicalization (R4-A, 2026-06-04)
// ---------------------------------------------------------------------------
// The domain backends MUST be addressed with a single canonical source_system
// spelling. Historically four spellings leaked in (dia_db / dia_supabase /
// gov_db / gov_supabase) plus the long forms (dialysis/government), which
// fragmented the entity graph: the same dia/gov property could end up with
// two external_identities rows under two spellings pointing at two entities,
// and the unified detail page (which resolves the property-anchor entity via
// the canonical `(dia|gov, asset, <property_id>)` convention) fell through to
// "(Unknown)" / "LCC Entity Not Registered". See CLAUDE.md
// "external_identities canonicalization".
//
// Canonical scheme:
//   - source_system: 'dia' | 'gov'  (for the two domain DBs)
//   - source_type for the property-anchor entity: 'asset'
//     ('property'/'clinic'/'facility' are synonyms — collapsed to 'asset')
//   - source_type for an owner entity: 'true_owner'  (external_id = true_owner id)
//   - external_id for an asset: the domain `properties.property_id`
//
// Vendor / channel systems (salesforce, costar, rca, crexi, loopnet, outlook,
// email_intake, …) are NOT domain DBs and pass through unchanged.
// ===========================================================================
export const CANONICAL_DOMAIN_SYSTEMS = ['dia', 'gov'];

/**
 * Normalize an external_identities source_system to its canonical form.
 * dia_db|dia_supabase|dialysis → 'dia'; gov_db|gov_supabase|government → 'gov'.
 * Every other value (vendor/channel system) is lower-cased + trimmed and
 * returned unchanged. This is the single choke point — route every
 * external_identities writer through it so a 6th spelling can never appear.
 */
export function canonicalIdentitySystem(system) {
  const s = String(system || '').trim().toLowerCase();
  if (s === 'dia' || s === 'dia_db' || s === 'dia_supabase' || s === 'dialysis') return 'dia';
  if (s === 'gov' || s === 'gov_db' || s === 'gov_supabase' || s === 'government') return 'gov';
  return s;
}

// ---------------------------------------------------------------------------
// entities.domain canonicalization (5th dia/gov alias bug, 2026-06-07)
// ---------------------------------------------------------------------------
// The CoStar sidebar entity bridge passed classifyDomain()'s long-form
// 'government'/'dialysis' straight into entities.domain, so LCC Opps carried
// BOTH spellings (gov 8,950 / dia 6,713 / government 871 / dialysis 142 / lcc
// 35 / NULL 1,293). R4-A canonicalized external_identities.source_system but
// entities.domain itself was never normalized at the writer. This is the 5th
// instance of the alias class (after getDomainCredentials, QA#9, E2E#5, R4-A);
// route every entities.domain writer through this so a 6th spelling is
// structurally impossible (same playbook as R4-A's canonicalIdentitySystem).
//
// This is the SIBLING of canonicalIdentitySystem for the domain COLUMN, not
// the source_system column. Identity-system semantics don't fit here: that
// helper coerces null→'' and lower-cases/returns arbitrary vendor systems,
// but entities.domain's vocabulary is exactly {dia, gov, lcc, NULL}. So this
// one preserves null/undefined untouched (never coerces to '') and keeps
// 'lcc' (a legit third value per the E2E#5 rule — never remap it).
export function canonicalEntityDomain(domain) {
  if (domain === null || domain === undefined) return domain;
  const d = String(domain).trim().toLowerCase();
  if (!d) return null;
  if (d === 'dia' || d === 'dia_db' || d === 'dia_supabase' || d === 'dialysis') return 'dia';
  if (d === 'gov' || d === 'gov_db' || d === 'gov_supabase' || d === 'government') return 'gov';
  return d; // 'lcc' and anything else preserved (lower-cased)
}

// Property-anchor source_type synonyms — all collapse to the canonical 'asset'
// for domain-DB identities (entity_type is 'asset', and the detail page /
// property-handler query entity_type=eq.asset).
const DOMAIN_ASSET_SOURCE_TYPES = new Set(['property', 'asset', 'clinic', 'facility']);

/**
 * Canonical source_type for a DOMAIN-DB identity. Collapses the property-anchor
 * synonyms to 'asset'; leaves 'true_owner' (and anything else) untouched.
 * Only meaningful when the source_system is a canonical domain system — callers
 * gate on CANONICAL_DOMAIN_SYSTEMS so vendor 'property' rows (costar/rca/crexi
 * listing ids) are never rewritten.
 */
export function canonicalDomainSourceType(type) {
  const t = String(type || '').trim().toLowerCase();
  return DOMAIN_ASSET_SOURCE_TYPES.has(t) ? 'asset' : (type || null);
}

// ---------------------------------------------------------------------------
// Junk entity-name guard (R4-A, 2026-06-04)
// ---------------------------------------------------------------------------
// Narrow guard for the ENTITY creation/sync boundary. Unlike the sidebar's
// isJunkContactName (which rejects firm-suffix names and so can't run on
// organization entities), this must NOT reject legitimate names like
// "Acme Holdings LLC". It only catches structural garbage a real entity name
// never contains: embedded phone numbers, emails, phone-type labels, and
// CoStar "Buyer/Seller Contacts" panel-header bleed-through.
// Example caught (Priority Queue P0.5, 2026-06-04):
//   "Seller ContactsCraig Burrows(916) 768-5544 (p)"
const ENTITY_JUNK_PATTERNS = [
  /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/,                       // (916) 768-5544
  /\b\d{3}[-.]\d{3}[-.]\d{4}\b/,                         // 916-768-5544 / 916.768.5544
  /\b(?:buyer|seller)\s*contacts?\b/i,                   // Buyer Contacts / Seller Contact(s)
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,      // embedded email
  /\(\s*[pcmf]\s*\)/i,                                   // (p)/(c)/(m)/(f) phone-type label
];

// ---------------------------------------------------------------------------
// Bare street-address fragment guard (R9 follow-up, 2026-06-09)
// ---------------------------------------------------------------------------
// The chain-connect drain minted "West Mall Dr" (dia) as an ORGANIZATION — a
// bare street fragment pulled from an ownership row. The sidebar's isJunkTenant()
// already rejects these on the lease path (STREET_NAME_RE); port the shape to the
// entity boundary. Conservative by construction: a name is a street fragment only
// when it ENDS in an abbreviated road word (+ optional directional), carries NO
// firm suffix, AND shows a STRONG street signal (a leading street number, a
// leading directional word, or a trailing directional abbreviation). The strong-
// signal gate is what keeps real businesses safe — "Parkway Properties" and
// "Boulevard Capital LLC" don't end in a road word, "Broadway"/"Gateway" have no
// word boundary before "way", and plausible surnames ending in a road word
// ("John Way", "Mary Place") carry no street signal and so pass. The signal is
// the directional/number shape, not the road word itself.
//
// Note: deliberately does NOT call looksLikePersonName() — that would recurse
// (looksLikePersonName -> isImplausiblePersonName -> isJunkEntityName). The
// strong-signal gate is the person-shape protection instead.
const STREET_FRAGMENT_RE =
  /\b(?:st|ave|avenue|blvd|dr|rd|ln|pkwy|hwy|way|ct|cir|ter|pl)\.?(?:\s+(?:n|s|e|w|ne|nw|se|sw))?$/i;
const ENTITY_FIRM_SUFFIX_RE =
  /\b(?:LLC|L\.L\.C|LP|LLP|Inc|Incorporated|Corp|Corporation|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Property|Associates|Group|Management|Mgmt|Development|Developers|Investments|Investors|Enterprises|Bancorp|Bank|Co)\b/i;
const STREET_LEAD_DIRECTIONAL_RE =
  /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\b/i;
const STREET_TRAIL_DIRECTIONAL_RE = /\s(?:n|s|e|w|ne|nw|se|sw)$/i;

// True when a name carries a corporate/firm suffix (LLC, LP, Bank, Trust, Realty,
// Holdings, …). Useful where a 2-token org name ("Truist Bank") would otherwise
// pass looksLikePersonName and be mis-handled as a person.
export function hasFirmSuffix(name) {
  return typeof name === 'string' && ENTITY_FIRM_SUFFIX_RE.test(name);
}

export function isStreetFragmentName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  if (!t) return false;
  if (!STREET_FRAGMENT_RE.test(t)) return false;     // must end in a road word
  if (ENTITY_FIRM_SUFFIX_RE.test(t)) return false;   // a real firm — never junk
  // Only flag on a strong street signal (see comment above).
  return /\d/.test(t)
      || STREET_LEAD_DIRECTIONAL_RE.test(t)
      || STREET_TRAIL_DIRECTIONAL_RE.test(t);
}

// ---------------------------------------------------------------------------
// Pipe-delimited composite owner names (R9 follow-up, 2026-06-09)
// ---------------------------------------------------------------------------
// CoStar captures sometimes glue a contact and their firm with a pipe, e.g.
// "Chad Middendorf | Green Rock USA" or "Vincent Curran | Palestra Real Estate
// Partners, Inc". Minted whole, these become single junk entities whose person
// and firm components often ALSO exist separately (both then drift into P0.4).
// The convention is "<person> | <firm>". Returns:
//   * { firm, person, ambiguous:false } for a clean two-part split (exactly one
//     plausible person + the other carrying a firm suffix) — caller mints the
//     FIRM and attaches the person as a related contact.
//   * { firm, person:null, ambiguous:true } otherwise (both firms / 3+ segments
//     / no clear person) — caller mints the firm-most segment (a firm-suffixed
//     one, else the trailing segment per convention) and stashes the original.
//   * null when there is no pipe / nothing to split.
export function splitCompositeOwnerName(raw) {
  if (typeof raw !== 'string' || raw.indexOf('|') === -1) return null;
  const segments = raw.split('|').map((s) => s.replace(/,\s*$/, '').trim()).filter(Boolean);
  if (segments.length < 2) return null;

  // Clean "<person> | <firm>": exactly two parts, exactly one a plausible person
  // (and not itself firm-suffixed), the other carrying a firm suffix.
  if (segments.length === 2) {
    const personIdx = segments.findIndex(
      (s) => looksLikePersonName(s) && !ENTITY_FIRM_SUFFIX_RE.test(s));
    if (personIdx !== -1) {
      const otherIdx = personIdx === 0 ? 1 : 0;
      if (ENTITY_FIRM_SUFFIX_RE.test(segments[otherIdx])) {
        return { firm: segments[otherIdx], person: segments[personIdx], ambiguous: false, original: raw };
      }
    }
  }

  // Ambiguous: prefer a firm-suffixed segment, else the trailing segment (the
  // capture convention is "<person> | <firm>", so the firm trails).
  const firmSuffixed = segments.find((s) => ENTITY_FIRM_SUFFIX_RE.test(s));
  const firm = firmSuffixed || segments[segments.length - 1];
  return { firm, person: null, ambiguous: true, original: raw };
}

/**
 * True when an entity name is structurally junk (phone/email/contacts-header
 * bleed-through) and should not be minted as a canonical entity. Conservative:
 * returns false for ordinary org/person/asset names.
 *
 * NOTE: this stays ADDRESS-SAFE — it must return false for asset/property names
 * (which ARE street addresses), because the ensureEntityLink creation boundary
 * runs it for every entity type. The bare-street-fragment check lives in the
 * standalone isStreetFragmentName() above and is applied type-gated (non-asset
 * only) at the choke point, so an owner minted as "West Mall Dr" is rejected
 * while the property "123 Main St" still mints.
 */
export function isJunkEntityName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return ENTITY_JUNK_PATTERNS.some((re) => re.test(trimmed));
}

// ---------------------------------------------------------------------------
// Person-plausibility guard (R7 Phase 2.5, 2026-06-07)
// ---------------------------------------------------------------------------
// The sale-event/capture pipeline classified any buyer/seller string WITHOUT a
// firm suffix as a PERSON, so deal-capture artifacts got minted as person
// entities: "Boyd Watterson by NAI Capital" (broker attribution), "... JV ...",
// "Heatwole Miller Cos CDCMT 2002-FX1 ($5.0m approx)" (CMBS), bare firm names
// ("Townsend Capital", "Leibsohn Family Trust"). These pollute the buy-side
// contact picker (no real human is selectable). Two checks:
//   * isImplausiblePersonName — strong NEGATIVE signals a human name never has
//     (deal tokens / firm suffixes / $ / amounts / "by <broker>"). Used to (a)
//     stop minting such persons at the boundary, and (b) flag existing rows.
//   * looksLikePersonName — strict POSITIVE first+last shape. Used by the picker
//     so name-matched suggestions are only selectable humans.
const PERSON_IMPLAUSIBLE_PATTERNS = [
  /\bby\s+\w/i,                                                   // "... by Marcus & Millichap"
  /\bJV\b/i,                                                      // joint-venture strings
  /\b(?:CMBS|BBCMS|CDCMT|ML-?CFC)\b/i,                            // CMBS deal codes
  /\b\d{4}-[A-Z]?\d/i,                                            // 2021-C10 / 2002-FX1 series
  /\bapprox\b/i,
  /\$/,                                                           // dollar amounts
  /\([^)]*\d[^)]*\)/,                                             // parenthesized amount "(... )"
  /\b(?:LLC|L\.L\.C|LP|LLP|Inc|Corp|Ltd|Trust|Fund|Holdings|Partners|Ptnrs|Capital|Advisors|Realty|Ventures|Cos|Company|Properties|Associates|Group|Management)\b/i,
];

export function isImplausiblePersonName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  if (!t) return false;
  if (isJunkEntityName(t)) return true;
  return PERSON_IMPLAUSIBLE_PATTERNS.some((re) => re.test(t));
}

// True only for a plausible human name: a first + last (+ optional middle/
// initial/suffix), all alpha tokens, no digits, no firm/deal tokens.
export function looksLikePersonName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  if (!t || t.length < 3 || t.length > 60) return false;
  if (isImplausiblePersonName(t)) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  // Each token: starts with a letter; letters/apostrophe/hyphen/period only
  // (covers "O'Brien", "Jean-Luc", "T.", "Jr.").
  return tokens.every((tok) => /^[A-Za-z][A-Za-z'.\-]*$/.test(tok));
}

// Title tokens that can be glued to a captured name with no delimiter
// ("John CarverExecutive Vice President", "Steve MoormannAgent").
const CONTACT_TITLE_WORDS = new Set([
  'agent', 'president', 'vice', 'executive', 'director', 'manager', 'broker', 'officer',
  'principal', 'partner', 'associate', 'associates', 'senior', 'sr', 'jr', 'vp', 'evp', 'svp',
  'ceo', 'cfo', 'coo', 'chairman', 'owner', 'founder', 'counsel', 'realtor', 'advisor', 'analyst',
  'managing', 'regional', 'national', 'first', 'chief',
]);

// Parse a phone/email panel-header bleed-through junk name into a clean contact.
// "Seller ContactsCraig Burrows(916) 768-5544 (p)" →
//   { name:'Craig Burrows', phone:'(916) 768-5544', role:'seller_contact', title:null }
// Returns null when it can't confidently isolate a plausible person name with
// at least one contact datum (those rows stay flagged — never guessed).
export function parseContactFromJunk(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // 1) Strip + capture the panel-header role prefix.
  let role = 'contact';
  // No \b after "contacts?": the header is glued to the name with no delimiter
  // ("Buyer ContactsAlex Lyman"), so there's no word boundary to anchor on.
  const pre = s.match(/^(seller|buyer|listing|tenant|owner)\s*contacts?\s*/i);
  if (pre) { role = pre[1].toLowerCase() + '_contact'; s = s.slice(pre[0].length).trim(); }
  // 2) Email + phone (first phone only — some rows carry two).
  const emailM = s.match(/[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  const email = emailM ? emailM[0] : null;
  const phoneM = s.match(/\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/);
  const phone = phoneM ? phoneM[0].trim() : null;
  // 3) Name = the run before the first phone / paren / digit / email.
  let namePart = s;
  const cut = s.search(/[(\d]/);
  if (cut > 0) namePart = s.slice(0, cut);
  if (email) namePart = namePart.split(email)[0];
  namePart = namePart.replace(/[,;|]+$/, '').trim();
  if (!namePart) return null;
  // 4) Split a glued title: insert a space at a camelCase boundary, then cut at
  //    the first title word. Only adopt the split when a title word is actually
  //    found, so plain names ("McDonald") are never corrupted.
  let title = null;
  const spaced = namePart.replace(/([a-z])([A-Z])/g, '$1 $2');
  const toks = spaced.split(/\s+/);
  const titleIdx = toks.findIndex((t) => CONTACT_TITLE_WORDS.has(t.toLowerCase().replace(/\.$/, '')));
  let name;
  if (titleIdx > 0) {
    name = toks.slice(0, titleIdx).join(' ').trim();
    title = toks.slice(titleIdx).join(' ').trim() || null;
  } else {
    name = namePart.trim();
  }
  // 5) Confidence gate — must be a plausible human name, and worth a contact.
  if (!looksLikePersonName(name)) return null;
  if (!phone && !email) return null;
  return { name, phone, email, role, title };
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

// Synthetic placeholder name minted by upstream intake when a real owner name
// wasn't known yet, e.g. "property 3fbb28bb-b50c-4b2e-8c4d-6e1280a3c987".
const PLACEHOLDER_ENTITY_NAME_RE = /^property\s+[0-9a-f-]+$/i;

export function isPlaceholderEntityName(name) {
  return !!name && PLACEHOLDER_ENTITY_NAME_RE.test(String(name).trim());
}

// When an existing entity still carries the synthetic "property <uuid>"
// placeholder name, adopt a real name so BD surfaces (priority queue, cadence
// dashboard, opportunity cards) stop displaying a UUID. Conservative: only
// rewrites a placeholder, and only when given a real (non-placeholder) name.
// Returns the (possibly-updated) entity object. (E2E#6 follow-up, 2026-06-03)
export async function refreshPlaceholderEntityName(entity, realName) {
  if (!entity || !entity.id) return entity;
  if (!isPlaceholderEntityName(entity.name)) return entity;
  const clean = (realName == null) ? '' : String(realName).trim();
  if (!clean || isPlaceholderEntityName(clean)) return entity;
  const newCanonical = normalizeCanonicalName(clean) || entity.canonical_name || null;
  const refreshed = await opsQuery('PATCH',
    `entities?id=eq.${pgFilterVal(entity.id)}`,
    { name: clean, canonical_name: newCanonical },
    { 'Prefer': 'return=representation' }
  );
  if (refreshed.ok && Array.isArray(refreshed.data) && refreshed.data[0]) {
    return refreshed.data[0];
  }
  // Soft-fall: reflect locally even if no representation came back.
  return { ...entity, name: clean, canonical_name: newCanonical };
}

// Fetch-then-refresh variant for callers that only hold an entity id (e.g.
// bridgeCreateLead when the property detail already resolved the asset entity
// and passes entity_id directly, skipping ensureEntityLink).
export async function refreshPlaceholderEntityNameById(entityId, workspaceId, realName) {
  if (!entityId) return null;
  const clean = (realName == null) ? '' : String(realName).trim();
  if (!clean || isPlaceholderEntityName(clean)) return null;
  const ent = await fetchEntityById(entityId, workspaceId);
  if (!ent) return null;
  return refreshPlaceholderEntityName(ent, clean);
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

  // R4-A: canonicalize the source_system/source_type at the single choke point
  // so no caller can write a deprecated domain-DB spelling (dia_db/gov_supabase
  // …) and fragment the entity graph. Vendor systems pass through unchanged.
  sourceSystem = canonicalIdentitySystem(sourceSystem);
  if (CANONICAL_DOMAIN_SYSTEMS.includes(sourceSystem)) {
    const ct = canonicalDomainSourceType(sourceType);
    if (ct) sourceType = ct;
  }

  // 5th dia/gov alias bug (2026-06-07): canonicalize the entity domain at the
  // same choke point. The CoStar sidebar bridge passes classifyDomain()'s
  // long-form 'government'/'dialysis'; without this they land verbatim in
  // entities.domain (and the dedup lookup below would miss the canonical row).
  // Covers every ensureEntityLink caller (sidebar bridge, bridgeCreateLead,
  // composite-person attach). undefined/null pass through unchanged.
  domain = canonicalEntityDomain(domain);
  if (seedFields && seedFields.domain !== undefined) {
    seedFields = { ...seedFields, domain: canonicalEntityDomain(seedFields.domain) };
  }

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

  let candidateName = seedFields.name
    || [seedFields.first_name, seedFields.last_name].filter(Boolean).join(' ').trim()
    || seedFields.address
    || `${sourceType || 'entity'} ${externalId || ''}`.trim();

  // R9 follow-up: pipe-delimited composite owner names ("<person> | <firm>", a
  // CoStar capture convention). Never mint the composite as one entity — resolve
  // to the FIRM as the owner. For a clean split, attach the person as a related
  // contact after the firm mints; ambiguous splits mint the firm-most segment
  // and keep the original string in metadata.composite_source_name so nothing
  // is lost. Only do this when the name wasn't already resolved by id/external
  // id (a pre-resolved entity keeps its own identity).
  let compositePerson = null;
  if (!resolvedEntity) {
    const composite = splitCompositeOwnerName(candidateName);
    if (composite) {
      compositePerson = composite.ambiguous ? null : composite.person;
      candidateName = composite.firm;
      seedFields = {
        ...seedFields,
        name: composite.firm,
        metadata: { ...(seedFields.metadata || {}), composite_source_name: composite.original },
      };
    }
  }
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
    // R4-A: junk-name guard at the creation boundary. Don't mint a canonical
    // entity from CoStar panel-header / phone / email garbage. Asset names are
    // addresses and never trip this; contact/owner garbage does.
    if (isJunkEntityName(candidateName)) {
      console.warn(`[ensureEntityLink] rejected junk entity name: "${String(candidateName).slice(0, 60)}"`);
      return {
        ok: false,
        skipped: 'junk_entity_name',
        junk: true,
        candidateName,
      };
    }

    // R9 follow-up: bare-street-fragment guard. The chain-connect drain minted
    // "West Mall Dr" (an ownership-row street fragment) as an organization.
    // Reject street fragments for owner orgs/persons — but NOT for assets, whose
    // names ARE street addresses (so this is type-gated, unlike isJunkEntityName).
    if (entityType !== 'asset' && isStreetFragmentName(candidateName)) {
      console.warn(`[ensureEntityLink] rejected street-fragment entity name: "${String(candidateName).slice(0, 60)}"`);
      return {
        ok: false,
        skipped: 'street_fragment_name',
        junk: true,
        candidateName,
      };
    }

    // R7 Phase 2.5: person-plausibility guard. The capture pipeline mints a
    // PERSON for any buyer/seller string without a firm suffix; reject the
    // deal-capture artifacts ("X by <broker>", JV/CMBS strings, $ amounts) so
    // they never become person entities (same junk-guard class as R4-A).
    if (entityType === 'person' && isImplausiblePersonName(candidateName)) {
      console.warn(`[ensureEntityLink] rejected implausible person name: "${String(candidateName).slice(0, 60)}"`);
      return {
        ok: false,
        skipped: 'implausible_person_name',
        junk: true,
        candidateName,
      };
    }

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

  // If we matched an EXISTING entity that still carries the synthetic
  // "property <uuid>" placeholder name, adopt the real seed name so BD surfaces
  // stop displaying a UUID. (E2E#6 follow-up, 2026-06-03)
  if (!createdEntity && resolvedEntity && isPlaceholderEntityName(resolvedEntity.name)) {
    resolvedEntity = await refreshPlaceholderEntityName(resolvedEntity, seedFields.name || candidateName);
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

  // R9 follow-up: attach the composite person as a related contact of the firm
  // (best-effort, never fails the firm mint). The person mints through this same
  // path (junk/plausibility guards apply; the name has no pipe so it won't
  // re-enter the composite branch). Mirrors the buyer-contact picker's
  // person→org associated_with pattern.
  let compositeContactId = null;
  if (compositePerson && resolvedEntity && resolvedEntity.id) {
    try {
      const personDomain = domain || resolvedEntity.domain || null;
      const personLink = await ensureEntityLink({
        workspaceId,
        userId,
        domain: personDomain,
        sourceType: 'person',
        seedFields: {
          name: compositePerson,
          domain: personDomain,
          metadata: { source: 'composite_owner_split' },
        },
      });
      if (personLink && personLink.ok && personLink.entityId) {
        const exists = await opsQuery('GET',
          'entity_relationships?select=id&relationship_type=eq.associated_with'
          + `&from_entity_id=eq.${pgFilterVal(resolvedEntity.id)}`
          + `&to_entity_id=eq.${pgFilterVal(personLink.entityId)}&limit=1`);
        if (!(exists.ok && Array.isArray(exists.data) && exists.data[0])) {
          await opsQuery('POST', 'entity_relationships', {
            workspace_id: workspaceId,
            from_entity_id: resolvedEntity.id,
            to_entity_id: personLink.entityId,
            relationship_type: 'associated_with',
            metadata: { role: 'contact', via: 'composite_owner_split' },
          });
        }
        compositeContactId = personLink.entityId;
      }
    } catch (err) {
      console.warn('[ensureEntityLink] composite person attach failed (non-fatal):', err?.message || err);
    }
  }

  return {
    ok: true,
    entity: resolvedEntity,
    entityId: resolvedEntity.id,
    createdEntity,
    createdIdentity,
    salesforce,
    compositeContactId,
  };
}
