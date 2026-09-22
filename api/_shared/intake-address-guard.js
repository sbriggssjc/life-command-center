// GOV-AVAIL1 (2026-09-22) — subject-address guards for the OM intake chain.
//
// The trace behind this module (gov Available tab, SBN-22): the Findlay, OH
// dialysis OM `USRenalMOB_Findlay_OH_OM_SB.pdf` (Salesforce Listing__c,
// seed_data.source_vertical='dia') was extracted by the local model as
// address "6120 South Yale Avenue, Suite 300", Tulsa OK — Team Briggs'
// office block, not the subject. That address matched an LCC asset entity
// that was itself named "6120 South Yale Ave" (minted 2026-06-08 from an
// earlier snapshot) but bridged to gov property 11255 at 5110 South Yale Ave,
// and the promoter wrote an ACTIVE gov listing. Four links failed:
//   (a) the extractor accepted a broker/firm contact block as the subject;
//   (b) nothing rejected an address that is a known brokerage office;
//   (c) the bridge accepted a property whose civic number differs (6120 vs 5110);
//   (d) a source_vertical='dia' document was promoted into the gov tables.
// (a)+(b) live here as pure functions; (c)+(d) are enforced in
// intake-promoter.js using civicNumbersAgree / verticalDomainConflict below.
//
// Everything here is PURE (no I/O) so it is unit-testable and shared by the
// extractor (fresh extraction, where the document text is available) and the
// downstream pipeline (cached re-runs, where only the snapshot is).

// ── Civic-number parsing (moved here from sidebar-pipeline.js; one copy) ─────
// "4550-4666 S Kirkman Rd" → { lo: 4550, hi: 4666, rest }
// "4600 S Kirkman Rd"      → { lo: 4600, hi: 4600, rest }
export function parseCivicNumberSpan(addr) {
  const s = String(addr || '').trim();
  const m = s.match(/^(\d+)\s*-\s*(\d+)\s+(.+)$/);
  if (m) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) {
      return { lo, hi, rest: m[3].trim().toLowerCase() };
    }
  }
  const single = s.match(/^(\d+)\s+(.+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (Number.isFinite(n)) return { lo: n, hi: n, rest: single[2].trim().toLowerCase() };
  }
  return null;
}

// true  = both addresses carry a civic number and the numbers/ranges overlap;
// false = both carry one and they are disjoint (6120 vs 5110) — a different building;
// null  = at least one side has no parseable civic number (no opinion).
// A range containing the single number agrees ("5519-5525 W Hillsborough" vs "5519 …").
export function civicNumbersAgree(a, b) {
  const x = parseCivicNumberSpan(a);
  const y = parseCivicNumberSpan(b);
  if (!x || !y) return null;
  return x.lo <= y.hi && y.lo <= x.hi;
}

// ── Vertical ↔ domain (link d) ───────────────────────────────────────────────
// seed_data.source_vertical is stamped by the Salesforce-files edge function
// (and any caller that knows which book a document belongs to). It is the
// strongest statement available about the document's domain, so a match that
// would promote it into the OTHER domain's tables is refused, both directions.
const VERTICAL_TO_DOMAIN = {
  dia: 'dialysis', dialysis: 'dialysis',
  gov: 'government', government: 'government',
};
export function seedVerticalDomain(seedData) {
  const v = String(seedData?.source_vertical || '').trim().toLowerCase();
  return VERTICAL_TO_DOMAIN[v] || null;
}
// Returns null when there is no conflict (or no stated vertical), else a
// { source_vertical, vertical_domain, match_domain } record for the skip reason.
export function verticalDomainConflict(seedData, matchDomain) {
  const verticalDomain = seedVerticalDomain(seedData);
  if (!verticalDomain) return null;
  if (matchDomain !== 'dialysis' && matchDomain !== 'government') return null;
  if (verticalDomain === matchDomain) return null;
  return {
    source_vertical: seedData.source_vertical,
    vertical_domain: verticalDomain,
    match_domain: matchDomain,
  };
}

// ── Street-key normalization for the brokerage-office registry ──────────────
const DIRECTIONAL_ABBR = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const SUFFIX_ABBR = {
  avenue: 'ave', av: 'ave', street: 'st', boulevard: 'blvd', drive: 'dr', road: 'rd',
  parkway: 'pkwy', pky: 'pkwy', highway: 'hwy', lane: 'ln', place: 'pl', court: 'ct',
  circle: 'cir', terrace: 'ter', trail: 'trl', square: 'sq', freeway: 'fwy',
};
const UNIT_RE = /\b(suite|ste|unit|apt|bldg|building|floor|fl|room|rm)\b\.?\s*[#]?\s*[\w-]+|#\s*[\w-]+/gi;

// "6120 South Yale Avenue, Suite 300" → "6120 s yale ave". Only the street
// line (text before the first comma) is keyed; unit designators are dropped.
export function streetKey(address) {
  const line = String(address || '').split(',')[0].replace(UNIT_RE, ' ');
  const tokens = line.toLowerCase().replace(/[.#]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length || !/^\d+(-\d+)?$/.test(tokens[0])) return null;
  const out = tokens.map((t, i) => {
    if (i === 0) return t;
    if (DIRECTIONAL_ABBR[t]) return DIRECTIONAL_ABBR[t];
    if (SUFFIX_ABBR[t]) return SUFFIX_ABBR[t];
    return t;
  });
  return out.join(' ');
}

function normState(s) {
  return String(s || '').trim().toUpperCase().replace(/\./g, '') || null;
}

// Our own offices are never a subject property, and that must not depend on a
// DB read succeeding. This is the ONE own-office list: api/_shared/own-firm-
// addresses.js (the §3 2026-05-21 sidebar guard, after 11 dia properties and 3
// listings were minted at this office) re-exports from here. The DB table
// lcc_brokerage_office_address (LCC Opps) EXTENDS it; it does not replace it.
export const BUILTIN_BROKERAGE_OFFICES = Object.freeze([
  Object.freeze({
    firm_name: 'Northmarq (Team Briggs)',
    address: '6120 S Yale Ave, Suite 300',
    city: 'Tulsa',
    state: 'OK',
    source: 'builtin:own_office',
  }),
]);

// Returns the matching registry row, or null. Match = same street key (civic
// number + normalized street) AND, when both sides state one, the same state.
export function matchBrokerageOffice(address, state, registryRows = BUILTIN_BROKERAGE_OFFICES) {
  const key = streetKey(address);
  if (!key) return null;
  const st = normState(state);
  for (const row of registryRows || []) {
    if (!row || row.is_active === false) continue;
    if (streetKey(row.address) !== key) continue;
    const rowSt = normState(row.state);
    if (st && rowSt && st !== rowSt) continue;
    return row;
  }
  return null;
}

// ── Contact-block detection over the document text (link a) ─────────────────
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const CONTACT_CUE_RE = /\b(exclusively|listed by|listing (broker|agent|team)|presented by|marketed by|offered by|broker of record|for (more )?information|contact(s)?\b|investment (sales|advisors?)|northmarq|marcus\s*&\s*millichap|cbre|colliers|jll|cushman|newmark|kidder mathews|stan johnson|matthews real estate|sands investment|capital pacific)/i;
const WINDOW = 250;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Find every occurrence of the address's civic number + street name in the
// text; an occurrence is "in a contact block" when an e-mail address sits
// within ±250 chars, or a phone number AND a contact cue do. Returns counts.
export function addressContactBlockEvidence(address, text) {
  const civic = parseCivicNumberSpan(address);
  const body = String(text || '');
  if (!civic || !body) return { occurrences: 0, contact_occurrences: 0 };
  const restWords = civic.rest.replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < restWords.length && DIRECTIONAL_ABBR[restWords[i]] !== undefined) i++;
  while (i < restWords.length && /^(n|s|e|w|ne|nw|se|sw)$/.test(restWords[i])) i++;
  const streetWord = restWords[i];
  if (!streetWord) return { occurrences: 0, contact_occurrences: 0 };
  const re = new RegExp(
    `\\b${civic.lo}\\s+(?:[a-z]{1,9}\\.?\\s+){0,2}${escapeRe(streetWord)}\\b`, 'gi');
  let occurrences = 0;
  let contactOccurrences = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    occurrences += 1;
    const w = body.slice(Math.max(0, m.index - WINDOW), m.index + m[0].length + WINDOW);
    if (EMAIL_RE.test(w) || (PHONE_RE.test(w) && CONTACT_CUE_RE.test(w))) contactOccurrences += 1;
  }
  return { occurrences, contact_occurrences: contactOccurrences };
}

const HAS_UNIT_RE = /\b(suite|ste|unit|floor|fl)\b\.?\s*[#]?\s*\w+|#\s*\w+/i;

// The address is judged a broker/firm contact block only when EVERY place it
// appears in the document is inside a contact block, and it either carries a
// unit designator (offices sit in suites) or appears more than once. A subject
// address that appears once, suite-less, on a cover page beside the broker's
// e-mail therefore survives — the cost of a false positive here is a real OM
// routed to review, so the rule stays narrow.
export function isBrokerContactBlockAddress(address, text) {
  const ev = addressContactBlockEvidence(address, text);
  if (ev.occurrences === 0 || ev.contact_occurrences !== ev.occurrences) return false;
  return HAS_UNIT_RE.test(String(address || '')) || ev.occurrences >= 2;
}

// ── The single entry point both call sites use ───────────────────────────────
// Mutates `snapshot` when the subject address is rejected: address/city/state/
// zip_code become null, the rejected address is removed from `addresses`, and
// `_address_guard` records what was removed and why (never silently).
// Returns { rejected, reason, office? }.
export function applySubjectAddressGuard(snapshot, { text = null, registry = BUILTIN_BROKERAGE_OFFICES } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return { rejected: false };
  const address = typeof snapshot.address === 'string' ? snapshot.address : null;
  if (!address) return { rejected: false };

  let reason = null;
  let office = matchBrokerageOffice(address, snapshot.state, registry);
  if (office) reason = 'known_brokerage_office';
  else if (text && isBrokerContactBlockAddress(address, text)) reason = 'broker_contact_block';
  if (!reason) return { rejected: false };

  const rejectedKey = streetKey(address);
  snapshot._address_guard = {
    rejected_address: address,
    rejected_city: snapshot.city ?? null,
    rejected_state: snapshot.state ?? null,
    reason,
    office_firm: office?.firm_name || null,
    guard: 'GOV-AVAIL1',
  };
  snapshot.address = null;
  snapshot.city = null;
  snapshot.state = null;
  if ('zip_code' in snapshot) snapshot.zip_code = null;
  if (Array.isArray(snapshot.addresses)) {
    const kept = snapshot.addresses.filter(a =>
      streetKey(a) !== rejectedKey && !matchBrokerageOffice(a, null, registry));
    snapshot.addresses = kept.length ? kept : null;
  }
  return { rejected: true, reason, office: office || null };
}

// ── Legacy own-firm API (api/_shared/own-firm-addresses.js re-exports these) ──
// The legacy test was a punctuation-insensitive SUBSTRING match on the exact
// string "6120 s yale ave ste 300" — so the spelled-out "6120 South Yale
// Avenue, Suite 300" (the Findlay OM, 2026-09-22) slipped past it. The
// street-key match covers every spelling; the substring arm is kept so a
// street line with trailing text still matches.
export const OWN_FIRM_ADDRESSES = BUILTIN_BROKERAGE_OFFICES.map(o => o.address);
const legacyNorm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function isOwnFirmAddress(addr) {
  if (!addr) return false;
  if (matchBrokerageOffice(addr, null, BUILTIN_BROKERAGE_OFFICES)) return true;
  const n = legacyNorm(addr);
  return !!n && ['6120syaleaveste300', '6120syaleavesuite300'].some(own => n.includes(own));
}
