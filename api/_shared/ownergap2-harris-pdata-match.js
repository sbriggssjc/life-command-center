// ============================================================================
// OWNERGAP2-harris — turn staged HCAD PDATA rows into OWNERGAP2 candidates.
// Life Command Center — no network, no model. Given rows already fetched from
// `hcad_real_acct_stage` (Dialysis_DB), it decides which one(s) match a
// property's address and hands the verdict off to the SAME shared matcher
// (`ownergap2-address-match.js::resolveOwnerFromCandidates`) the Philadelphia
// and operator-payload Harris paths already use — one matcher, three feeds.
// ----------------------------------------------------------------------------
// 🔑 THE ACCOUNT TYPE IS THE DISCRIMINATOR, SAME RULE AS THE PAYLOAD PATH
// (`ownergap2-sources.js`'s header, PDR2). HCAD types every account itself via
// `state_class`; a Personal/BPP account (the tenant's equipment) is EXCLUDED,
// never re-derived from name text. `hcad-pdata-parse.js::harrisStateClassToAccountType`
// maps the staged `state_class` to the SAME 'commercial'/'personal' vocabulary
// `isHarrisRealPropertyAccount`/`isHarrisPersonalPropertyAccount` already use,
// so one classification function serves both the payload and PDATA paths.
//
// ⚠️ THE state_class → account-type MAPPING IS UNVERIFIED (see the migration +
//    parser headers) — this module inherits that caveat rather than hiding it.
// ============================================================================

import { normalizeAddress, streetKeysFor, parseSourceLocation, ownerIdentityKey } from './ownergap2-address-match.js';
import { isHarrisRealPropertyAccount, isHarrisPersonalPropertyAccount, HARRIS } from './ownergap2-sources.js';
import { harrisStateClassToAccountType } from './hcad-pdata-parse.js';
import { domainQuery } from './domain-db.js';

// ============================================================================
// OWNERGAP2-harris-b — HCAD's own `str` column is BARE (suffix + directional
// stripped: "CRENSHAW", "ALICE", "SAM HOUSTON"), with the suffix filed
// separately in `str_sfx` and any directional in `str_pfx`/`str_sfx_dir`.
// Verified live 2026-09-16 against all 37 rows Cowork staged from the real
// 2026-09-13 export — e.g. `5040 CRENSHAW RD` stages as `str='CRENSHAW'`,
// `str_sfx='RD'`; `3327 S SAM HOUSTON PKY E` as `str='SAM HOUSTON'`,
// `str_sfx='PKY'`; `12430 SH 249` / `12430 STATE HIGHWAY 249` as two
// DIFFERENT `str` spellings for the SAME address, `str_sfx=null`.
//
// The original fetch queried `str=eq.<key>` with a key built by
// `normalizeAddress()` (SUFFIX-ATTACHED, e.g. "CRENSHAW RD") — which cannot
// match a bare `str` column at all. Deployed dry run: 47 of 50 lookups
// failed `no_staged_rows`. The functions below derive a BARE query key
// (strip the trailing suffix token; strip a leading/trailing directional)
// and a suffix-/directional-TOLERANT comparison for the small remainder
// where the LCC-side address itself carries no suffix (e.g. "1550 Live
// Oak" vs the staged row's own "1550 LIVE OAK ST").
//
// ⚠️ This tolerance is scoped to THIS Harris PDATA feed only — the shared
// `locationMatches()` in ownergap2-address-match.js stays STRICT (suffix
// must equal) because it also serves the Philadelphia adapter, whose source
// location string does carry the suffix reliably. Widening the shared
// strict comparator to accommodate HCAD's split schema would loosen
// matching for a jurisdiction that never asked for it — CLAUDE.md's
// "never widen matching until something returns" cuts the other way here:
// the leniency is jurisdiction-specific because the DATA SHAPE is
// jurisdiction-specific, not because matching felt too strict.
// ============================================================================

/** Canonical suffix abbreviations `normalizeAddress`/`parseSourceLocation`
 * fold every street token to (via SUFFIX_MAP in ownergap2-address-match.js).
 * Used only to find the TRAILING suffix token so it can be treated as
 * optional/HCAD's separate str_sfx — never to widen what counts as a
 * street-name match. */
const HARRIS_KNOWN_SUFFIXES = new Set([
  'ST', 'AVE', 'BLVD', 'RD', 'DR', 'PKWY', 'LN', 'PL', 'CT', 'TER',
  'HWY', 'FWY', 'CIR', 'SQ', 'TRL', 'EXPY', 'BYP', 'WAY',
]);
/** Canonical single/double-letter directionals (post SUFFIX_MAP/
 * DIRECTIONAL_MAP normalisation, so "NORTH" already reads "N" etc). */
const HARRIS_DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

/**
 * Reverses `DIRECTIONAL_MAP` in ownergap2-address-match.js. `normalizeAddress`
 * collapses ANY token matching a directional word to its abbreviation,
 * regardless of position — so a street whose OWN NAME happens to be a
 * directional word ("Northwest Freeway", "North Loop") is indistinguishable,
 * post-normalisation, from a genuine leading directional qualifier ("100 E
 * Lehigh Ave"). Verified live 2026-09-16: `normalizeAddress('20320
 * Northwest Fwy')` returns street `'NW FWY'`, and stripping "NW" as a
 * directional then loses the word entirely — the bare-key candidate would
 * be `'FWY'`, matching nothing. HCAD's own `str` stores the FULL WORD
 * (`'NORTHWEST'`), so a second key candidate expands the leading token back.
 */
const HARRIS_DIRECTIONAL_EXPAND = {
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST',
  NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};

/**
 * Derive every BARE street key candidate HCAD's `str` column might actually
 * hold from an already-normalized (suffix/directional-canonicalized) street
 * string, e.g. "CRENSHAW RD" -> ["CRENSHAW"], "SAM HOUSTON PKWY" ->
 * ["SAM HOUSTON"]. Returns MORE THAN ONE candidate exactly when the leading
 * token is directional-SHAPED and could equally be the street's own name
 * (see HARRIS_DIRECTIONAL_EXPAND above) — "NW FWY" -> ["FWY" (stripped-as-
 * directional, degenerate), "NORTHWEST"] — never a fuzzy expansion, only
 * the two structurally possible readings of one collapsed token.
 */
export function harrisBareStreetKeys(streetNormalized) {
  const tokens = String(streetNormalized || '').split(' ').filter(Boolean);
  const out = [];
  const push = (toks) => { const k = toks.join(' '); if (k && !out.includes(k)) out.push(k); };

  let stripped = tokens.slice();
  if (stripped.length > 1 && HARRIS_DIRECTIONALS.has(stripped[0])) stripped = stripped.slice(1);
  if (stripped.length > 1 && HARRIS_DIRECTIONALS.has(stripped[stripped.length - 1])) stripped = stripped.slice(0, -1);
  if (stripped.length > 1 && HARRIS_KNOWN_SUFFIXES.has(stripped[stripped.length - 1])) stripped = stripped.slice(0, -1);
  push(stripped);

  const lead = tokens[0];
  if (tokens.length > 1 && HARRIS_DIRECTIONALS.has(lead) && HARRIS_DIRECTIONAL_EXPAND[lead]) {
    let expanded = [HARRIS_DIRECTIONAL_EXPAND[lead], ...tokens.slice(1)];
    if (expanded.length > 1 && HARRIS_DIRECTIONALS.has(expanded[expanded.length - 1])) expanded = expanded.slice(0, -1);
    if (expanded.length > 1 && HARRIS_KNOWN_SUFFIXES.has(expanded[expanded.length - 1])) expanded = expanded.slice(0, -1);
    push(expanded);
  }
  return out;
}

/** Single-candidate convenience wrapper over `harrisBareStreetKeys` (the
 * first/primary candidate) — used wherever only one key is needed. */
export function harrisBareStreetKey(streetNormalized) {
  return harrisBareStreetKeys(streetNormalized)[0] || '';
}

/**
 * Split a canonicalized street string into { core, dirLead, dirTrail, sfx }
 * — used ONLY for the suffix-/directional-optional comparison below, never
 * to derive a query key (that is `harrisBareStreetKey`, above, which is
 * deliberately simpler/stricter about ORDER of stripping since a query key
 * has to be exact-equal to HCAD's own bare column).
 */
function harrisStreetParts(street) {
  let toks = String(street || '').split(' ').filter(Boolean);
  let dirLead = null;
  let dirTrail = null;
  let sfx = null;
  if (toks.length > 1 && HARRIS_DIRECTIONALS.has(toks[0])) { dirLead = toks[0]; toks = toks.slice(1); }
  // HCAD's own free-text site_addr sometimes trails BOTH a suffix and a
  // directional ("...PKY E") — strip the trailing directional FIRST so the
  // suffix check below lands on the real suffix token, not "E".
  if (toks.length > 1 && HARRIS_DIRECTIONALS.has(toks[toks.length - 1])) { dirTrail = toks[toks.length - 1]; toks = toks.slice(0, -1); }
  if (toks.length > 1 && HARRIS_KNOWN_SUFFIXES.has(toks[toks.length - 1])) { sfx = toks[toks.length - 1]; toks = toks.slice(0, -1); }
  return { core: toks.join(' '), dirLead, dirTrail, sfx };
}

/**
 * Do two already-canonicalized street strings name the SAME street, per the
 * OWNERGAP2-harris-b leniency rules — never a fuzzy/similarity comparison,
 * only structural (suffix/directional presence) tolerance:
 *   - the CORE street-name tokens must be exactly equal;
 *   - a SUFFIX present on only one side is optional (HCAD keeps it in a
 *     separate column; the free-text side does not always restate it the
 *     way an LCC address does) — rejected only when BOTH sides carry one
 *     and they disagree AFTER the shared SUFFIX_MAP canonicalization that
 *     already ran on both sides (PKY/PKWY, HWY/HIGHWAY, FWY/FREEWAY, …);
 *   - a DIRECTIONAL present on only one side is optional the same way,
 *     rejected only on a genuine contradiction (both present, different —
 *     e.g. "...RD W" vs "...RD E", two different sides of a divided road).
 */
export function harrisStreetsMatch(streetA, streetB) {
  if (!streetA || !streetB) return false;
  const a = harrisStreetParts(streetA);
  const b = harrisStreetParts(streetB);
  if (!a.core || a.core !== b.core) return false;
  if (a.dirLead && b.dirLead && a.dirLead !== b.dirLead) return false;
  if (a.dirTrail && b.dirTrail && a.dirTrail !== b.dirTrail) return false;
  if (a.sfx && b.sfx && a.sfx !== b.sfx) return false;
  return true;
}

/**
 * The street "arm" for one candidate row — 'exact' on the property's own
 * normalized street, 'exact_via_alias' via the shared STREET_ALIASES table
 * (tried on both the suffixed and the bare form, since an alias may be
 * registered on either spelling), or null (street_mismatch).
 */
function harrisStreetArm(norm, parsed, jurisdiction) {
  if (harrisStreetsMatch(norm.street, parsed.street)) return 'exact';
  const aliasKeys = streetKeysFor(norm.street, jurisdiction).slice(1); // [0] is norm.street itself
  for (const alt of aliasKeys) {
    if (harrisStreetsMatch(alt, parsed.street)) return 'exact_via_alias';
  }
  return null;
}

/**
 * Harris-PDATA-specific replacement for the shared `locationMatches()` —
 * IDENTICAL house-number/range/parity logic (copied, not re-derived), with
 * only the street-arm test swapped for the tolerant version above. See this
 * file's header for why the leniency is not folded into the shared strict
 * comparator.
 */
export function harrisLocationMatches(norm, parsed, jurisdiction = HARRIS) {
  if (!norm?.ok) return { matched: false, arm: null, reason: norm?.reason || 'address_unparsed' };
  if (!parsed?.ok) return { matched: false, arm: null, reason: parsed?.reason || 'location_unparsed' };

  const streetArm = harrisStreetArm(norm, parsed, jurisdiction);
  if (!streetArm) return { matched: false, arm: null, reason: 'street_mismatch' };

  const house = parseInt(norm.house, 10);
  if (!Number.isFinite(house)) return { matched: false, arm: null, reason: 'house_unparsed' };

  const viaAlias = streetArm === 'exact_via_alias';
  if (parsed.houseStart === house && parsed.houseEnd === house) {
    return { matched: true, arm: viaAlias ? 'exact_via_alias' : 'exact', reason: null };
  }
  if (parsed.houseStart === house) {
    return { matched: true, arm: viaAlias ? 'range_start_via_alias' : 'range_start', reason: null };
  }
  if (house > parsed.houseStart && house <= parsed.houseEnd) {
    const singleSided = (parsed.houseStart % 2) === (parsed.houseEnd % 2);
    if (singleSided && (house % 2) !== (parsed.houseStart % 2)) {
      return { matched: false, arm: null, reason: 'house_number_wrong_side_of_street' };
    }
    return { matched: true, arm: viaAlias ? 'range_contains_via_alias' : 'range_contains', reason: null };
  }
  return { matched: false, arm: null, reason: 'house_number_outside_range' };
}

/**
 * Harris-PDATA-specific replacement for the shared `resolveOwnerFromCandidates()`
 * — identical ambiguity/grouping logic (copied, not re-derived; see this
 * file's header), with `harrisLocationMatches` swapped in for the per-row
 * test.
 */
export function resolveHarrisPdataMatch(norm, candidates, opts = {}) {
  const jurisdiction = opts.jurisdiction || HARRIS;
  const out = {
    status: 'unresolved', reason: null, owner: null, sourceRecordIds: [],
    matchArm: null, candidatesConsidered: Array.isArray(candidates) ? candidates.length : 0,
    matchedRows: [], nearMisses: [], distinctOwners: 0,
  };
  if (!norm?.ok) { out.reason = norm?.reason || 'address_unparsed'; return out; }
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) { out.reason = 'no_records_returned'; return out; }

  const matched = [];
  for (const row of rows) {
    const parsed = parseSourceLocation(row.location);
    const verdict = harrisLocationMatches(norm, parsed, jurisdiction);
    if (verdict.matched) matched.push({ row, parsed, arm: verdict.arm });
    else out.nearMisses.push({ location: row.location ?? null, owner: row.owner ?? null, reason: verdict.reason });
  }
  if (!matched.length) { out.reason = 'no_matching_record'; return out; }

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

  if (byOwner.size > 1) {
    out.reason = 'needs_parcel_discriminator';
    out.status = 'needs_parcel_discriminator';
    return out;
  }

  const group = [...byOwner.values()][0];
  const ARM_RANK = {
    exact: 0, exact_via_alias: 1, range_start: 2, range_start_via_alias: 3,
    range_contains: 4, range_contains_via_alias: 5,
  };
  group.sort((a, b) => (ARM_RANK[a.arm] ?? 99) - (ARM_RANK[b.arm] ?? 99));
  const best = group[0];

  out.status = 'resolved';
  out.owner = best.row.owner;
  out.matchArm = best.arm;
  out.sourceRecordIds = group.map((m) => m.row.sourceRecordId).filter((id) => id != null);
  return out;
}

/**
 * Turn a staged HCAD PDATA row into a `{location, owner, ...}` candidate
 * shape the shared matcher expects. Returns null for a row this feed refuses
 * to consider at all (no site address to match on).
 *
 * ⚠️ OWNERGAP2-harris-b: `site_addr_1` is the WHOLE house+street string on
 * its own — verified against all 37 real staged rows, e.g.
 * `site_addr_1='5040 CRENSHAW RD'`. `site_addr_2`/`site_addr_3` are the
 * situs CITY and ZIP (checked live: `site_addr_3` is a 5-digit zip on
 * 37 of 37 rows; `site_addr_2` never looks like a street-number
 * continuation), NOT further lines of the street address the way some other
 * assessor exports use a 2nd address line. Joining all three (the prior
 * behaviour here) fed `parseSourceLocation` a string like
 * "5040 CRENSHAW RD PASADENA 77505" and made EVERY row street_mismatch —
 * "PASADENA 77505" parses as extra street tokens no property's normalized
 * street will ever equal. Use `site_addr_1` alone.
 */
export function stageRowToLocation(row) {
  if (row?.site_addr_1) return String(row.site_addr_1).trim();
  // Fall back to the parsed street fields when site_addr_1 is absent — a
  // documented HCAD field, never a guess about what the row means.
  const built = [row?.str_num, row?.str, row?.str_sfx].filter(Boolean).join(' ').trim();
  return built || null;
}

/**
 * Build OWNERGAP2 candidates from staged HCAD rows for ONE property's
 * address. `stagedRows` is whatever the caller already fetched for the
 * relevant street key(s) — this function does no I/O.
 *
 * @param {string} address - the LCC property's free-text address.
 * @param {object[]} stagedRows - rows from `hcad_real_acct_stage`.
 * @returns {{ok:boolean, jurisdiction:string, norm:object, candidates:object[],
 *   excludedPersonalAccounts:object[], untypedAccounts:object[], errors:string[]}}
 */
export function buildHarrisPdataCandidates(address, stagedRows) {
  const norm = normalizeAddress(address, HARRIS);
  const out = {
    ok: false, jurisdiction: HARRIS, norm, candidates: [],
    excludedPersonalAccounts: [], untypedAccounts: [], errors: [],
  };
  if (!norm.ok) { out.errors.push(norm.reason); return out; }
  const rows = Array.isArray(stagedRows) ? stagedRows : [];
  if (!rows.length) { out.errors.push('no_staged_rows'); return out; }

  for (const row of rows) {
    const accountType = harrisStateClassToAccountType(row?.state_class);
    const location = stageRowToLocation(row);
    if (!location) { out.untypedAccounts.push({ accountNumber: row?.acct, owner: row?.owner_name }); continue; }

    // Same PDR2 discipline as the payload path: an UNTYPED account is never
    // admitted as the real-property owner — HCAD's own state_class decides,
    // never a guess and never a name test.
    if (accountType && isHarrisPersonalPropertyAccount(accountType)) {
      out.excludedPersonalAccounts.push({ accountNumber: row?.acct, owner: row?.owner_name, accountType });
      continue;
    }
    if (!accountType || !isHarrisRealPropertyAccount(accountType)) {
      out.untypedAccounts.push({ accountNumber: row?.acct, owner: row?.owner_name, accountType });
      continue;
    }

    out.candidates.push({
      owner: row?.owner_name ?? null,
      ownerSecondary: row?.owner_name_2 ?? null,
      location,
      sourceRecordId: row?.acct != null ? String(row.acct) : null,
      sourceRecordKind: 'hcad_account_number',
      jurisdiction: HARRIS,
      sourceQuery: `hcad_real_acct_stage WHERE acct='${row?.acct ?? ''}' AND file_year=${row?.file_year ?? ''} `
        + `(loaded from ${row?.source_file ?? 'unknown file'})`,
      sourceUrl: 'https://hcad.org/pdata/pdata-property-downloads.html',
      accountType,
      mailingAddress: [row?.mail_addr_1, row?.mail_addr_2, row?.mail_city, row?.mail_state, row?.mail_zip]
        .filter(Boolean).join(', ') || null,
      raw: row,
    });
  }
  out.ok = true;
  return out;
}

/**
 * Resolve one property against staged HCAD rows: build candidates + apply the
 * shared ambiguity/matching rules. Mirrors `resolveOwnerForProperty` in
 * `ownergap2-sources.js` so callers get the same verdict shape as Philadelphia
 * and the operator-payload path.
 */
export function resolveHarrisFromPdata(address, stagedRows) {
  const bundle = buildHarrisPdataCandidates(address, stagedRows);
  // Harris-PDATA-specific matcher (suffix/directional-tolerant, see this
  // file's header) — NOT the shared strict `resolveOwnerFromCandidates`,
  // which also serves Philadelphia and stays strict for it.
  const verdict = resolveHarrisPdataMatch(bundle.norm, bundle.candidates, { jurisdiction: HARRIS });
  return {
    ...verdict,
    jurisdiction: HARRIS,
    truncated: false,
    normalizedAddress: bundle.norm.ok ? `${bundle.norm.house} ${bundle.norm.street}` : null,
    fetchErrors: bundle.errors,
    excludedPersonalAccounts: bundle.excludedPersonalAccounts,
    untypedAccounts: bundle.untypedAccounts,
    citation: verdict.status === 'resolved' ? buildPdataCitation(verdict, bundle) : null,
  };
}

/** Same citation shape `ownergap2-sources.js::buildCitation` produces. */
export function buildPdataCitation(verdict, bundle) {
  const first = (bundle.candidates || []).find(
    (c) => verdict.sourceRecordIds.includes(c.sourceRecordId));
  return {
    jurisdiction: HARRIS,
    source_record_ids: verdict.sourceRecordIds,
    source_record_kind: first?.sourceRecordKind ?? null,
    source_url: first?.sourceUrl ?? null,
    source_query: first?.sourceQuery ?? null,
    source_location: verdict.matchedRows?.[0]?.location ?? null,
    match_arm: verdict.matchArm,
    normalized_address: bundle.norm.ok ? `${bundle.norm.house} ${bundle.norm.street}` : null,
    mailing_address: first?.mailingAddress ?? null,
    owner_secondary: first?.ownerSecondary ?? null,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Every BARE street key worth querying the stage for, primary first — this
 * is HCAD's own shape (`str` with no suffix or directional), NOT the
 * suffix-attached form `normalizeAddress` produces. OWNERGAP2-harris-b: the
 * previous version returned the suffixed key ("CRENSHAW RD") and queried
 * `str=eq.CRENSHAW RD`, which cannot match HCAD's `str='CRENSHAW'` — 47 of
 * 50 deployed lookups failed `no_staged_rows` on exactly this. Runs the
 * shared alias table (`STREET_ALIASES.harris_tx`) on BOTH the suffixed form
 * (existing FM 1960 / Cypress Creek Pkwy aliases) and the bare form (the new
 * STATE HWY 249 / SH 249 alias, which is irregular enough that a plain
 * suffix strip cannot derive it), so an alias registered on either spelling
 * is found.
 */
export function harrisPdataStreetKeys(address) {
  const norm = normalizeAddress(address, HARRIS);
  if (!norm.ok) return [];
  const seen = new Set();
  const out = [];
  const push = (k) => { if (k && !seen.has(k)) { seen.add(k); out.push(k); } };
  for (const suffixed of streetKeysFor(norm.street, HARRIS)) {
    for (const bare of harrisBareStreetKeys(suffixed)) {
      push(bare);
      for (const alt of streetKeysFor(bare, HARRIS)) push(alt);
    }
  }
  return out;
}

/**
 * Query the staged HCAD table for one property's street key(s) and resolve.
 * This is the PRIMARY automated Harris path — an operator-supplied payload
 * (`ownergap2-sources.js::buildHarrisCandidates`) remains a MANUAL FALLBACK
 * for a property this table has not been loaded to cover, never removed.
 *
 * ⚠️ Fails CLOSED, never silently: an unreachable/unconfigured Dialysis_DB
 * or an empty stage returns `reason:'no_staged_rows'`/`'stage_query_failed'`
 * rather than reporting a match that never happened.
 */
export async function fetchHarrisPdataForProperty(address, deps = {}) {
  const q = deps.domainQuery || domainQuery;
  const norm = normalizeAddress(address, HARRIS);
  if (!norm.ok) {
    return { status: 'unresolved', reason: 'address_unparsed', jurisdiction: HARRIS, owner: null, citation: null };
  }
  const keys = harrisPdataStreetKeys(address);
  if (!keys.length) {
    return { status: 'unresolved', reason: 'address_unparsed', jurisdiction: HARRIS, owner: null, citation: null };
  }
  const allRows = [];
  const errors = [];
  for (const street of keys) {
    // OWNERGAP2-harris-b: `&str_num=eq.<house>` -- a busy street (FANNIN has
    // hundreds of accounts on it) can exceed PostgREST's implicit 200-row
    // page and silently truncate the candidate set for a property that
    // never had a chance to appear on the page. Filtering on the house
    // number too turns the query into "the handful of accounts at this
    // address", which the 200 cap never comes close to.
    const path = `hcad_real_acct_stage?str=eq.${encodeURIComponent(street)}`
      + `&str_num=eq.${encodeURIComponent(norm.house)}`
      + '&select=acct,file_year,owner_name,owner_name_2,mail_addr_1,mail_addr_2,mail_city,mail_state,'
      + 'mail_zip,str_num,str,str_sfx,site_addr_1,site_addr_2,site_addr_3,state_class,source_file'
      + '&limit=200';
    const r = await q('dialysis', 'GET', path);
    if (!r.ok) { errors.push(`stage_query_failed:${r.status}`); continue; }
    if (Array.isArray(r.data) && r.data.length) allRows.push(...r.data);
    // The primary street answered — an alias is a fallback, not an addition
    // (same rule as the Philadelphia adapter's own comment on this point).
    if (Array.isArray(r.data) && r.data.length) break;
  }
  if (!allRows.length) {
    return {
      status: 'unresolved',
      reason: errors.length ? errors[0] : 'no_staged_rows',
      jurisdiction: HARRIS, owner: null, citation: null,
      fetchErrors: errors,
    };
  }
  return resolveHarrisFromPdata(address, allRows);
}
