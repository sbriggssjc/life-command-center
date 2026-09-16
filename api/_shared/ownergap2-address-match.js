// ============================================================================
// OWNERGAP2 — address normalisation + candidate matching for free public
// assessor sources. PURE: no I/O, no model, no network.
// Life Command Center — writes Dialysis_DB (zqzrriwuavgrquhisnoa)
// ----------------------------------------------------------------------------
// OWNERGAP1 measured that 4,014 dia properties (34% of the book) carry an
// operator-flagged true_owner and NO recorded_owner, and that the owner is
// genuinely absent from every table this database holds (24,365 of 25,331 tax
// payloads carry a null/empty mailing_owner AT SOURCE). OWNERGAP1's §8/§9
// sampling then measured that FREE public sources DO hold it — Philadelphia
// ~68%, Harris 86% — and named three miss causes. This module is the matching
// half of the first build against that finding.
//
// 🚨 THE PROVENANCE CONTRACT (why this file is pure).
// The whole owner arc exists because a gpt-4o call was asked to RECALL a public
// record and invented `XYZ Dialysis Centers LLC` across 119 counties
// (OWNERGAP1 §1). So: an owner NAME is copied verbatim from a fetched source
// row or it does not exist. Nothing in this file generates, "cleans up",
// title-cases or otherwise authors a name — it only decides WHICH fetched row,
// if any, corresponds to a property. Every function here takes rows it was
// handed and returns a verdict about them.
//
// ── The three miss causes (OWNERGAP1 §9), and what this module does ─────────
//   1. Address RANGES   — handled. See below; this is bigger than §8 said.
//   2. Street ALIASES   — handled, by a small EXPLICIT data-driven list
//                         (STREET_ALIASES). Never by loosening the match until
//                         something returns.
//   3. Multi-parcel     — REFUSED, never guessed. `3300 Henry Ave` returns six
//                         owning LPs (Falls Center). Flagged
//                         `needs_parcel_discriminator`.
//
// ⚠️ CORRECTION TO OWNERGAP1 §8, MEASURED LIVE 2026-09-16 AGAINST
//    phl.carto.com (see docs/audits/OWNERGAP1_... §10). §8 described the range
//    problem as a PREFIX problem — `4126 Walnut St` vs `4126-38 WALNUT ST` —
//    and prescribed "house-number-prefix + street match". That is only HALF
//    the class, and the half it misses is the larger one:
//
//      prefix       `4126 Walnut St`  ->  `4126-38 WALNUT ST`   (starts with 4126)
//      CONTAINMENT  `3823 Market St`  ->  `3817-39 MARKET ST`   (does NOT start
//                                                                with 3823)
//
//    A prefix rule is STRUCTURALLY UNABLE to find the second shape. Measured on
//    the live 26-property Philadelphia population: the prefix arm alone resolves
//    16; adding containment resolves 4 more (3823 MARKET ST, 4190 CITY AVE, and
//    both Lindbergh rows). Four of the eight "misses" were never missing data —
//    they were outside the rule's reach. The prescribed rule would have been
//    reported as ~62% when the source supports ~77%.
//
// ⚠️ A RANGE'S END IS TRUNCATED, NOT LITERAL. Philadelphia writes `800-34
//    WALNUT ST` meaning 800..834 — the `34` is the LAST TWO DIGITS of the end,
//    not the number 34. `7601-51` is 7601..7651. Reading the suffix literally
//    gives an empty or inverted range and silently matches nothing, which reads
//    exactly like "the city has no record" (CLAUDE.md Class 11 — the zero is the
//    instrument). expandRangeEnd() reconstructs it and carries when the
//    reconstruction would fall below the start (`798-02` -> 798..802).
// ============================================================================

/** Street-type suffixes → the abbreviation assessor files use. */
const SUFFIX_MAP = {
  STREET: 'ST', STR: 'ST', ST: 'ST',
  AVENUE: 'AVE', AVEN: 'AVE', AV: 'AVE', AVE: 'AVE',
  BOULEVARD: 'BLVD', BOULEVARDE: 'BLVD', BLVD: 'BLVD',
  ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DRIV: 'DR', DR: 'DR',
  PARKWAY: 'PKWY', PARKWY: 'PKWY', PKWAY: 'PKWY', PKY: 'PKWY', PWY: 'PKWY', PKWY: 'PKWY',
  LANE: 'LN', LN: 'LN',
  PLACE: 'PL', PL: 'PL',
  COURT: 'CT', CT: 'CT',
  TERRACE: 'TER', TERR: 'TER', TER: 'TER',
  HIGHWAY: 'HWY', HWY: 'HWY',
  FREEWAY: 'FWY', FRWY: 'FWY', FWY: 'FWY',
  CIRCLE: 'CIR', CIR: 'CIR',
  SQUARE: 'SQ', SQ: 'SQ',
  TRAIL: 'TRL', TRL: 'TRL',
  EXPRESSWAY: 'EXPY', EXPY: 'EXPY',
  BYPASS: 'BYP', BYP: 'BYP',
};

/** Directionals → single/double letter. Applied to leading AND trailing tokens. */
const DIRECTIONAL_MAP = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
  N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
};

// ⚠️ EXPLICIT, DATA-DRIVEN, AND DELIBERATELY TINY (OWNERGAP2 §3.2).
// Every entry is a jurisdiction-scoped, evidence-backed renaming — a street
// that genuinely has two official names. This is NOT a fuzzy-matching escape
// hatch: adding an entry because "something should have matched" is how a
// matcher starts returning confident wrong owners. Each entry cites why.
//
// Keys are jurisdiction ids; values map a normalised street key to the
// alternative key(s) the assessor file may hold. Matching tries the property's
// own key FIRST and an alias only if the primary yields nothing.
export const STREET_ALIASES = {
  // OWNERGAP1 §9: `4427 Cypress Creek Pkwy` returned Cypress Grove Ln / Cypress
  // Pond Ct / W Cypress Villas Dr — the WRONG STREET ENTIRELY. Cypress Creek
  // Parkway is Houston's renamed FM 1960, and HCAD indexes it under the name it
  // holds. Three dia properties in the live Harris population are filed under
  // the FM 1960 spelling and one under the new one, so the alias is needed in
  // BOTH directions.
  harris_tx: [
    { a: 'CYPRESS CREEK PKWY', b: 'FM 1960 RD W' },
    { a: 'CYPRESS CREEK PKWY', b: 'FM 1960 RD' },
    { a: 'CYPRESS CREEK PKWY', b: 'FM 1960 W' },
    { a: 'FM 1960 BYP', b: 'FM 1960 BYPASS RD W' },
  ],
  // OWNERGAP1 §8 named `CITY AVE` vs `CITY LINE AVE`. Philadelphia's OPA file
  // indexes the city-side frontage as CITY AVE; the postal/marketing name is
  // City Line Avenue. Measured live 2026-09-16: `4190 City Avenue` resolves
  // ONLY under CITY AVE, and `4508 City Line Ave` finds `4500 CITY AVE` under
  // the alias — which then correctly FAILS the house-number test (4508 is not
  // 4500 and 4500 is not a range), so the alias widens the search without
  // widening what may be written. That is the shape an alias list should have.
  philadelphia_pa: [
    { a: 'CITY LINE AVE', b: 'CITY AVE' },
  ],
};

/**
 * Normalise an LCC free-text address into { house, street } in assessor form.
 * Returns ok:false with a NAMED reason rather than a guess when it cannot.
 */
export function normalizeAddress(raw, jurisdiction = null) {
  const out = { ok: false, house: null, houseLetter: null, street: null, unit: null, reason: null, input: raw ?? null };
  if (raw == null || String(raw).trim() === '') { out.reason = 'empty_address'; return out; }

  let s = String(raw).toUpperCase().trim();

  // Strip a unit/suite tail. Recorded BEFORE stripping so the caller can see it
  // (a suite is real information — `3020 Market Street, Suite 10` — it is just
  // not part of the parcel's street address).
  const unitRe = /[,]?\s*\b(?:SUITE|STE|UNIT|APT|BLDG|BUILDING|FL|FLOOR|RM|ROOM|#)\b\.?\s*([A-Z0-9-]*)\s*$/;
  const unitMatch = s.match(unitRe);
  if (unitMatch) { out.unit = (unitMatch[1] || '').trim() || null; s = s.slice(0, unitMatch.index).trim(); }

  s = s.replace(/[.,]+$/g, '').trim();

  // House number: leading digits, optionally a range (`1438-1446`, `3310-24`)
  // and optionally an IMMEDIATELY-ATTACHED letter (`13535A I-10`, `2910R`).
  //
  // ⚠️ THE LETTER MUST BE ATTACHED — `\s*([A-Z])?` HERE SILENTLY EATS A LEADING
  // DIRECTIONAL AND IS THE SINGLE MOST DESTRUCTIVE BUG THIS MODULE CAN HAVE.
  // Found by running this matcher against the live 26-row Philadelphia
  // population rather than by reading it: `100 E. Lehigh Ave` normalised to
  // house 100 + street `LEHIGH AVE` (the `E` captured as a building letter),
  // `1172 S Broad Street` to `BROAD ST`, `1300 W. Lehigh Ave` to `LEHIGH AVE`.
  // Every one then failed `street_mismatch` against a source row that was
  // sitting right there, and the run reported them as "the city has no record"
  // — five real owners lost to a `\s*`, with no error anywhere. Five of 26.
  const houseRe = /^(\d+)(?:\s*-\s*\d+)?([A-Z])?(?![A-Z0-9])/;
  const hm = s.match(houseRe);
  if (!hm) { out.reason = 'no_house_number'; return out; }
  out.house = hm[1];
  out.houseLetter = hm[2] || null;
  let rest = s.slice(hm[0].length).trim();

  // A DETACHED single letter (`27720 A Tomball Pky`) is a building letter —
  // but ONLY when it is not a directional. `100 E Lehigh` and `4621 Center`
  // must keep their `E`; `S`/`N`/`E`/`W` are street geography, not buildings.
  rest = rest.replace(/^([A-Z])\s+(?=[A-Z0-9])/, (m, letter) => {
    if (Object.prototype.hasOwnProperty.call(DIRECTIONAL_MAP, letter)) return m;
    if (!out.houseLetter) out.houseLetter = letter;
    return '';
  }).trim();

  rest = rest.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!rest) { out.reason = 'no_street'; return out; }

  const tokens = rest.split(' ').filter(Boolean).map((t) => {
    if (Object.prototype.hasOwnProperty.call(DIRECTIONAL_MAP, t)) return DIRECTIONAL_MAP[t];
    if (Object.prototype.hasOwnProperty.call(SUFFIX_MAP, t)) return SUFFIX_MAP[t];
    return t;
  });

  out.street = tokens.join(' ');
  out.ok = true;
  out.jurisdiction = jurisdiction || null;
  return out;
}

/**
 * Reconstruct the true end of a truncated assessor address range.
 * `800` + `34` -> 834 ·  `7601` + `51` -> 7651 ·  `798` + `02` -> 802 (carry).
 * ⚠️ Reading the suffix literally (34) instead of reconstructing it (834) makes
 * every containment test fail silently — see this file's header.
 */
export function expandRangeEnd(startStr, endSuffixStr) {
  const start = parseInt(startStr, 10);
  if (!Number.isFinite(start)) return null;
  if (endSuffixStr == null || endSuffixStr === '') return start;
  const suffix = String(endSuffixStr);
  if (suffix.length >= String(start).length) {
    const literal = parseInt(suffix, 10);
    return Number.isFinite(literal) ? literal : null;
  }
  const keep = String(start).slice(0, String(start).length - suffix.length);
  let end = parseInt(keep + suffix, 10);
  if (!Number.isFinite(end)) return null;
  // Carry: `798-02` reconstructs to 702, which is below the start — the range
  // actually crosses a hundred, so add one unit of the truncated magnitude.
  if (end < start) end += Math.pow(10, suffix.length);
  return end;
}

/**
 * Parse an assessor `location` string into its house range + street key.
 * Handles `4126-38 WALNUT ST`, `2910R S 70TH ST` (R = rear parcel), `825 WALNUT ST`.
 */
export function parseSourceLocation(location) {
  const out = {
    ok: false, houseStart: null, houseEnd: null, rear: false,
    subLetter: null, street: null, raw: location ?? null,
  };
  if (location == null || String(location).trim() === '') { out.reason = 'empty_location'; return out; }
  const s = String(location).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  // ⚠️ THE SUB-PARCEL LETTER IS ANY LETTER, NOT JUST `R`. Live Philadelphia
  // rows include `2910R S 70TH ST` (rear lot) AND `3151L MARKET ST`. Matching
  // only `R` leaves `L` to be parsed as the first STREET token, so the row
  // becomes street `L MARKET ST`, fails street_mismatch and is DROPPED — which
  // silently discards a candidate that may hold a DIFFERENT owner, i.e. it can
  // hide a genuine ambiguity and let a single-owner answer through that should
  // have been refused. A dropped candidate is not a safe candidate.
  const m = s.match(/^(\d+)(?:\s*-\s*(\d+))?([A-Z])?\b\s*(.*)$/);
  if (!m) { out.reason = 'unparsed_location'; return out; }
  const start = parseInt(m[1], 10);
  const end = m[2] != null ? expandRangeEnd(m[1], m[2]) : start;
  if (!Number.isFinite(start) || end == null) { out.reason = 'unparsed_house'; return out; }
  out.houseStart = start;
  out.houseEnd = Math.max(start, end);
  out.subLetter = m[3] || null;
  out.rear = m[3] === 'R';
  const streetTokens = (m[4] || '').split(' ').filter(Boolean).map((t) => {
    if (Object.prototype.hasOwnProperty.call(DIRECTIONAL_MAP, t)) return DIRECTIONAL_MAP[t];
    if (Object.prototype.hasOwnProperty.call(SUFFIX_MAP, t)) return SUFFIX_MAP[t];
    return t;
  });
  out.street = streetTokens.join(' ');
  if (!out.street) { out.reason = 'no_street'; return out; }
  out.ok = true;
  return out;
}

/** Every street key worth querying for this property, primary first. */
export function streetKeysFor(street, jurisdiction) {
  const keys = [street];
  const aliases = STREET_ALIASES[jurisdiction] || [];
  for (const { a, b } of aliases) {
    if (street === a && !keys.includes(b)) keys.push(b);
    if (street === b && !keys.includes(a)) keys.push(a);
  }
  return keys;
}

/**
 * Does a parsed source row correspond to this property's address?
 *
 * ⚠️ §4: "a fuzzy match that is not exact on house number AND street →
 * write nothing". The STREET must be exactly equal (after normalisation, and
 * after an explicit alias substitution — never a similarity score). The HOUSE
 * NUMBER must be exactly the start, or genuinely inside a stated range.
 *
 * @returns {{matched:boolean, arm:string|null, reason:string|null}}
 */
export function locationMatches(norm, parsed, jurisdiction = null) {
  if (!norm?.ok) return { matched: false, arm: null, reason: norm?.reason || 'address_unparsed' };
  if (!parsed?.ok) return { matched: false, arm: null, reason: parsed?.reason || 'location_unparsed' };

  const wanted = streetKeysFor(norm.street, jurisdiction);
  const streetArm = parsed.street === norm.street
    ? 'street_exact'
    : (wanted.includes(parsed.street) ? 'street_alias' : null);
  if (!streetArm) return { matched: false, arm: null, reason: 'street_mismatch' };

  const house = parseInt(norm.house, 10);
  if (!Number.isFinite(house)) return { matched: false, arm: null, reason: 'house_unparsed' };

  if (parsed.houseStart === house && parsed.houseEnd === house) {
    return { matched: true, arm: streetArm === 'street_alias' ? 'exact_via_alias' : 'exact', reason: null };
  }
  if (parsed.houseStart === house) {
    return { matched: true, arm: streetArm === 'street_alias' ? 'range_start_via_alias' : 'range_start', reason: null };
  }
  if (house > parsed.houseStart && house <= parsed.houseEnd) {
    // ⚠️ PARITY IS PART OF CONTAINMENT, AND OMITTING IT MANUFACTURES A FALSE
    // AMBIGUITY THAT LOSES A REAL OWNER. US street numbering puts odd numbers
    // on one side and even on the other, so a single-sided range covers only
    // its own parity. Measured live on `3823 Market St`: WITHOUT this check it
    // matched BOTH `3817-39 MARKET ST` (odd, RALSTON MERCY-DOUGLASS HO — the
    // correct answer) and `3816-40 MARKET ST` (even, UNIVERSITY CITY — the
    // other side of the street), producing two distinct owners and a
    // `needs_parcel_discriminator` refusal on a property that is not ambiguous
    // at all. The refusal LOOKS like the safety rule working, which is exactly
    // why it would have survived review.
    //
    // Applied only when the range is self-evidently single-sided (start and end
    // share parity — true of all 14 ranges in the live sample). A mixed-parity
    // range makes no claim about sides, so no parity is inferred from it.
    const singleSided = (parsed.houseStart % 2) === (parsed.houseEnd % 2);
    if (singleSided && (house % 2) !== (parsed.houseStart % 2)) {
      return { matched: false, arm: null, reason: 'house_number_wrong_side_of_street' };
    }
    return { matched: true, arm: streetArm === 'street_alias' ? 'range_contains_via_alias' : 'range_contains', reason: null };
  }
  return { matched: false, arm: null, reason: 'house_number_outside_range' };
}

// ── Owner-identity comparison, for the ambiguity rule ONLY ───────────────────
//
// ⚠️ This is used to answer "do these candidate rows name the SAME party, so
// there is no ambiguity to refuse on" — it NEVER decides that two differently
// named owners are one party, and it never edits a name. CLAUDE.md's standing
// rule (`lcc_normalize_entity_name` / `ownerCore` / `lcc_owner_strict_core` are
// banned for identity) is respected by keeping this deliberately STRICT: only
// case, punctuation and whitespace are collapsed. `SIX G'S L P` and `SIX GS LP`
// are one party; `AGREE LIBERTY PA LLC` and `CARLYLE REVOLUTION LLC` are not,
// and no amount of token-stripping may be allowed to make them so.
export function ownerIdentityKey(name) {
  if (name == null) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The verdict for ONE property against the candidate rows a source returned.
 *
 * Candidates are `{ owner, sourceRecordId, location, raw }` — already fetched.
 * Returns a verdict object; `owner` is non-null ONLY on `resolved`.
 *
 * §4 ambiguity rules, all of which WRITE NOTHING:
 *   - more than one distinct owner        -> needs_parcel_discriminator
 *   - no exact house+street match         -> no_matching_record / near_miss
 *   - the matched name is an operator     -> matched_name_is_operator
 */
export function resolveOwnerFromCandidates(norm, candidates, opts = {}) {
  const jurisdiction = opts.jurisdiction || null;
  const out = {
    status: 'unresolved',
    reason: null,
    owner: null,
    sourceRecordIds: [],
    matchArm: null,
    candidatesConsidered: Array.isArray(candidates) ? candidates.length : 0,
    matchedRows: [],
    nearMisses: [],
    distinctOwners: 0,
  };
  if (!norm?.ok) { out.reason = norm?.reason || 'address_unparsed'; return out; }
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) { out.reason = 'no_records_returned'; return out; }

  const matched = [];
  for (const row of rows) {
    const parsed = parseSourceLocation(row.location);
    const verdict = locationMatches(norm, parsed, jurisdiction);
    if (verdict.matched) matched.push({ row, parsed, arm: verdict.arm });
    else out.nearMisses.push({ location: row.location ?? null, owner: row.owner ?? null, reason: verdict.reason });
  }

  if (!matched.length) { out.reason = 'no_matching_record'; return out; }

  // An owner string that is blank at source is NOT an owner. Never substitute.
  const named = matched.filter((m) => m.row.owner != null && String(m.row.owner).trim() !== '');
  if (!named.length) { out.reason = 'source_states_no_owner'; return out; }

  const byOwner = new Map();
  for (const m of named) {
    const key = ownerIdentityKey(m.row.owner);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(m);
  }
  out.distinctOwners = byOwner.size;
  out.matchedRows = named.map((m) => ({
    location: m.row.location, owner: m.row.owner,
    sourceRecordId: m.row.sourceRecordId ?? null, arm: m.arm,
  }));

  // ⚠️ MULTI-PARCEL: `3300 Henry Ave` -> six owning LPs (Falls Center). One
  // street address, several parcels, several owners, and nothing in the address
  // says which one is ours. Refuse — OWNERGAP1 §8/§9 named this as the real hard
  // case and it is NOT a matching failure to be tuned away.
  if (byOwner.size > 1) {
    out.reason = 'needs_parcel_discriminator';
    out.status = 'needs_parcel_discriminator';
    return out;
  }

  // Several parcels, ONE owner (measured live: `2910 S 70TH ST` + `2910R S 70TH
  // ST`, both BLUE BELL ASSOC — the second is the rear lot). The answer is the
  // same whichever parcel is ours, so this is unambiguous, not multi-parcel.
  const group = [...byOwner.values()][0];
  const ARM_RANK = {
    exact: 0, exact_via_alias: 1, range_start: 2, range_start_via_alias: 3,
    range_contains: 4, range_contains_via_alias: 5,
  };
  group.sort((a, b) => (ARM_RANK[a.arm] ?? 99) - (ARM_RANK[b.arm] ?? 99));
  const best = group[0];

  // 🚨 The owner name is COPIED, byte for byte, from the source row. No
  // trimming beyond the source's own value, no casing change, no expansion.
  out.owner = best.row.owner;
  out.matchArm = best.arm;
  out.sourceRecordIds = group.map((m) => m.row.sourceRecordId).filter((x) => x != null);
  out.status = 'resolved';
  return out;
}
