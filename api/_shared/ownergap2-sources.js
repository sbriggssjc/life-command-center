// ============================================================================
// OWNERGAP2 — the two jurisdiction adapters. Two, deliberately: not a national
// pipeline, no scheduler, no `county_authorities` table.
// Life Command Center — reads free public sources, writes Dialysis_DB.
// ----------------------------------------------------------------------------
// 🚨 THE PROVENANCE CONTRACT. Every candidate an adapter emits carries:
//     jurisdiction        — which source answered
//     sourceRecordId      — that source's OWN record identifier (OPA account
//                           number / HCAD account number). NOT ours.
//     sourceQuery         — the exact query that found it
//     sourceUrl           — where the query went
//     owner               — copied VERBATIM from the fetched row
//   A candidate that cannot carry all of these is not emitted, and
//   ownergap2-owner-writeback.js refuses to write one that does not.
//
// 🚨 NO MODEL PRODUCES AN OWNER NAME, ANYWHERE IN THIS FILE OR ITS CALLERS.
//   OWNERGAP1 exists because a gpt-4o call was asked to recall a public record
//   and invented `XYZ Dialysis Centers LLC` across 119 counties. A name here is
//   read out of an HTTP response body or it does not exist. (OWNERGAP1-ollama:
//   a local model may ONLY normalise/match strings already fetched — and even
//   then the written value is the SOURCE's string, not the model's rendering.)
//
// `fetchImpl` is injected on every call. The test suite is hermetic by guard
// (test/_helpers/net-guard.mjs throws on any non-loopback host), so these are
// exercised against recorded fixtures; nothing here may reach a real host from
// a test.
// ============================================================================

import { normalizeAddress, streetKeysFor, resolveOwnerFromCandidates } from './ownergap2-address-match.js';

export const PHILADELPHIA = 'philadelphia_pa';
export const HARRIS = 'harris_tx';

// ============================================================================
// (a) PHILADELPHIA — phl.carto.com/api/v2/sql over `opa_properties_public`.
//     Free, public, documented, no key, no login, no CAPTCHA.
// ============================================================================

export const PHL_SQL_URL = 'https://phl.carto.com/api/v2/sql';
export const PHL_TABLE = 'opa_properties_public';
const PHL_COLS = 'parcel_number, location, owner_1, owner_2, mailing_address_1, '
  + 'mailing_street, mailing_city_state, mailing_zip, mailing_care_of, unit, zip_code';

export const PHL_ROW_LIMIT = 250;
/** How far below the house number a containing range may START. */
export const PHL_HOUSE_BAND = 999;

/**
 * The exact SQL this adapter sends. Kept as its own function so the CITATION
 * stored beside every written owner is the real query, never a description of
 * one — a citation nobody can re-run is not a citation.
 *
 * ⚠️ AN UNBOUNDED STREET FETCH IS A TRUNCATION TRAP, MEASURED: `MARKET ST`
 * carries **1,218** parcels and `WALNUT ST` **1,923**. The first cut of this
 * function fetched the whole street at `LIMIT 100` — which would have returned
 * an arbitrary 100 of 1,218 and reported `no_matching_record` about a row it
 * never asked for. That is A5's `815 = 1000 − 185` exactly: a count equal to a
 * query window is a reading of the instrument, not of the population. It
 * survived my first verification run only because that run hand-narrowed the
 * scan to `38%MARKET ST`.
 *
 * So the server-side filter is a NUMERIC BAND on the leading house number
 * (`house-999 .. house`, ordered by start DESCENDING). A range containing our
 * house must start at or below it, and ranges are short, so the containing row
 * sorts to the TOP — truncation can only ever drop rows that are further away
 * and irrelevant. The caller still reports truncation honestly rather than
 * concluding absence from it.
 */
export function buildPhlQuery(street, house, { limit = PHL_ROW_LIMIT, band = PHL_HOUSE_BAND } = {}) {
  const safeStreet = String(street).replace(/'/g, "''");
  const h = parseInt(house, 10);
  if (!Number.isFinite(h)) throw new Error('buildPhlQuery requires a numeric house number');
  const lo = Math.max(0, h - band);
  const houseExpr = "(substring(location from '^[0-9]+'))::bigint";
  return `SELECT ${PHL_COLS} FROM ${PHL_TABLE} `
    + `WHERE location LIKE '%${safeStreet}' `
    + `AND location ~ '^[0-9]' `
    + `AND ${houseExpr} BETWEEN ${lo} AND ${h} `
    + `ORDER BY ${houseExpr} DESC `
    + `LIMIT ${limit}`;
}

export function phlRequestUrl(sql) {
  return `${PHL_SQL_URL}?q=${encodeURIComponent(sql)}`;
}

/**
 * Fetch every OPA row on one street. The house-number decision is made OFFLINE
 * by ownergap2-address-match — deliberately.
 *
 * ⚠️ A SERVER-SIDE `location LIKE '<house>%'` FILTER CANNOT FIND THE LARGER
 * HALF OF THE POPULATION. Philadelphia stores `3817-39 MARKET ST` for house
 * 3823 and `800-34 WALNUT ST` for house 834 — neither STARTS with the house
 * number, so a prefix filter returns zero rows and the run reports "the city
 * has no record" about a row it never asked for. Measured live 2026-09-16: the
 * prefix filter resolves 14 of 26; fetching the street and deciding offline
 * resolves 20. The filter is on the STREET (bounded, tens of rows) and the
 * house test happens where the range arithmetic lives.
 */
export async function fetchPhiladelphiaCandidates(address, deps = {}) {
  const fetchImpl = deps.fetchImpl;
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required (no ambient fetch)');
  const norm = normalizeAddress(address, PHILADELPHIA);
  const out = {
    ok: false, jurisdiction: PHILADELPHIA, norm,
    candidates: [], queries: [], errors: [], truncated: false,
  };
  if (!norm.ok) { out.errors.push(norm.reason); return out; }

  for (const street of streetKeysFor(norm.street, PHILADELPHIA)) {
    const sql = buildPhlQuery(street, norm.house);
    const url = phlRequestUrl(sql);
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch (err) {
      out.errors.push(`fetch_failed:${String(err?.message || err)}`);
      continue;
    }
    out.queries.push({ street, sql, url, status: res?.status ?? null });
    if (!res || !res.ok) { out.errors.push(`http_${res?.status ?? 'none'}`); continue; }
    let body;
    try { body = await res.json(); } catch (err) { out.errors.push('bad_json'); continue; }
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    // ⚠️ Compare against the RETURNED row count, never the limit we asked for
    // (A5a: "a guard that compares a request against a response is not a
    // guard"). The band + DESC ordering means a truncated page cannot hide the
    // containing range — but the caller is still told, so an empty result is
    // never silently upgraded into "the city has no record".
    if (rows.length >= PHL_ROW_LIMIT) out.truncated = true;
    for (const r of rows) {
      // owner_1 is the county's own assertion, copied as-is. owner_2 is the
      // co-owner line and rides along as evidence, never merged into the name.
      out.candidates.push({
        owner: r.owner_1 ?? null,
        ownerSecondary: r.owner_2 ?? null,
        location: r.location ?? null,
        sourceRecordId: r.parcel_number != null ? String(r.parcel_number) : null,
        sourceRecordKind: 'opa_account_number',
        jurisdiction: PHILADELPHIA,
        sourceQuery: sql,
        sourceUrl: PHL_SQL_URL,
        mailingAddress: [r.mailing_care_of, r.mailing_address_1, r.mailing_street,
          r.mailing_city_state, r.mailing_zip].filter(Boolean).join(', ') || null,
        raw: r,
      });
    }
    // The primary street answered — an alias is a fallback, not an addition.
    // Querying both and pooling would manufacture cross-street ambiguity.
    if (rows.length) break;
  }
  out.ok = out.candidates.length > 0 || out.errors.length === 0;
  return out;
}

// ============================================================================
// (b) HARRIS COUNTY, TX — HCAD.
// ============================================================================
//
// ⚠️ MEASURED LIVE 2026-09-16, AND THE ANSWER CHANGES THE SHAPE OF THIS
//    ADAPTER: **HCAD EXPOSES NO FREE API OR ENUMERABLE BULK INDEX REACHABLE
//    FROM A DATACENTER EGRESS, AND ITS SEARCH IS BOT-PROTECTED.** Probed from
//    Dialysis_DB via pg_net (the documented sandbox egress):
//
//      https://search.hcad.org/                       -> 403, body is the
//                                                        Cloudflare managed
//                                                        challenge
//                                                        ("Just a moment...")
//      https://hcad.org/                              -> 521 (origin down)
//      https://public.hcad.org/records/quicksearch.asp-> 404 (legacy ASP
//                                                        endpoint retired)
//      https://download.hcad.org/                     -> 200, but the root is a
//                                                        shell page carrying no
//                                                        file links to follow
//
//    The task's own §2 says to establish this first and, if it is UI-only, to
//    "say so and scope (b) to whatever is reachable without automating a
//    bot-protected page", and §6 says not to work around a CAPTCHA. Both are
//    honoured: **THIS ADAPTER DOES NOT FETCH.** It is a pure parser + matcher
//    over an HCAD payload the OPERATOR supplies — through the capture path this
//    repo already ships (`POST /api/admin?_route=public-records-capture`,
//    `api/_shared/public-records-writeback.js`) or from an HCAD bulk export.
//    There is no crawler here and none should be added; the same
//    Cloudflare/Incapsula wall already stopped the SOS-direct fetcher
//    (government-lease §25) and the answer there was a residential egress, an
//    operator decision, not a code one.
//
// 🔑 THE ACCOUNT TYPE IS THE DISCRIMINATOR, AND IT IS A RECORDED FACT.
//    OWNERGAP1 §9 measured that Harris returns two or three accounts at the
//    same address and types them ITSELF:
//      5040 Crenshaw  Personal:  FRESENIUS MEDICAL CARE ... / FUSA MARKETING
//                     Commercial: CRENSHAW MOB LLC          <- the real owner
//    The `Personal` account is the tenant's equipment (business personal
//    property); the `Commercial`/real-property account is the building's owner.
//    That is PDR2's distinction drawn for us by the county, for free.
//    ⚠️ We key on THAT FIELD and never re-derive operator-vs-owner from name
//    text — a name test is exactly the defect PDR2 fixed, and CLAUDE.md's P113
//    rule ("use the existing flag; never write a second name-based operator
//    test") applies verbatim.

export const HARRIS_REAL_PROPERTY_TYPES = new Set(['commercial', 'real', 'real property', 'residential']);
export const HARRIS_PERSONAL_PROPERTY_TYPES = new Set(['personal', 'business personal property', 'bpp']);

export function normalizeHarrisAccountType(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ') || null;
}

/** true when HCAD itself types this account as the REAL PROPERTY account. */
export function isHarrisRealPropertyAccount(accountType) {
  const t = normalizeHarrisAccountType(accountType);
  if (!t) return false;
  return HARRIS_REAL_PROPERTY_TYPES.has(t);
}

/** true when HCAD itself types this account as BUSINESS PERSONAL PROPERTY. */
export function isHarrisPersonalPropertyAccount(accountType) {
  const t = normalizeHarrisAccountType(accountType);
  if (!t) return false;
  return HARRIS_PERSONAL_PROPERTY_TYPES.has(t);
}

/**
 * Turn an operator-supplied HCAD payload into OWNERGAP2 candidates.
 *
 * @param {object} payload - { address, accounts: [{ account_number, account_type,
 *   owner_name, site_address, source_url }] }
 * @returns the same shape fetchPhiladelphiaCandidates returns, so one caller
 *   serves both jurisdictions.
 */
export function buildHarrisCandidates(payload, opts = {}) {
  const address = payload?.address ?? opts.address ?? null;
  const norm = normalizeAddress(address, HARRIS);
  const out = {
    ok: false, jurisdiction: HARRIS, norm, candidates: [], queries: [], errors: [],
    excludedPersonalAccounts: [], untypedAccounts: [],
  };
  if (!norm.ok) { out.errors.push(norm.reason); return out; }
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  if (!accounts.length) { out.errors.push('no_accounts_supplied'); return out; }

  for (const acct of accounts) {
    const accountType = acct?.account_type ?? acct?.accountType ?? null;
    const accountNumber = acct?.account_number ?? acct?.accountNumber ?? null;
    const ownerName = acct?.owner_name ?? acct?.ownerName ?? null;

    // ⚠️ AN UNTYPED ACCOUNT IS NOT A REAL-PROPERTY ACCOUNT. The whole safety of
    // this adapter rests on HCAD's own typing; treating a missing type as
    // "probably the building" would re-derive the very judgement the type
    // exists to make, and would let a tenant's BPP account through as the
    // owner. Untyped accounts are REPORTED, never admitted.
    if (!accountType) {
      out.untypedAccounts.push({ accountNumber, owner: ownerName });
      continue;
    }
    if (isHarrisPersonalPropertyAccount(accountType)) {
      out.excludedPersonalAccounts.push({ accountNumber, owner: ownerName, accountType });
      continue;
    }
    if (!isHarrisRealPropertyAccount(accountType)) {
      out.untypedAccounts.push({ accountNumber, owner: ownerName, accountType });
      continue;
    }

    out.candidates.push({
      owner: ownerName,
      ownerSecondary: null,
      location: acct?.site_address ?? acct?.siteAddress ?? address,
      sourceRecordId: accountNumber != null ? String(accountNumber) : null,
      sourceRecordKind: 'hcad_account_number',
      jurisdiction: HARRIS,
      sourceQuery: payload?.source_query ?? opts.sourceQuery
        ?? `HCAD real-property account search for ${address}`,
      sourceUrl: acct?.source_url ?? payload?.source_url ?? opts.sourceUrl ?? null,
      accountType: normalizeHarrisAccountType(accountType),
      mailingAddress: acct?.mailing_address ?? acct?.mailingAddress ?? null,
      raw: acct,
    });
  }
  out.ok = true;
  return out;
}

/**
 * One entry point for both jurisdictions: fetch/parse candidates, then apply
 * the shared matcher + ambiguity rules.
 */
export async function resolveOwnerForProperty(jurisdiction, input, deps = {}) {
  let bundle;
  if (jurisdiction === PHILADELPHIA) {
    bundle = await fetchPhiladelphiaCandidates(input?.address ?? input, deps);
  } else if (jurisdiction === HARRIS) {
    bundle = buildHarrisCandidates(input, deps);
  } else {
    return { status: 'unresolved', reason: 'unsupported_jurisdiction', jurisdiction, owner: null };
  }

  const verdict = resolveOwnerFromCandidates(bundle.norm, bundle.candidates, { jurisdiction });
  // A miss over a TRUNCATED page is "we did not see the whole answer", which is
  // a different fact from "the source has no record" and must not be reported
  // as one (P180: unknown is not a value).
  if (verdict.status !== 'resolved' && bundle.truncated
      && (verdict.reason === 'no_matching_record' || verdict.reason === 'no_records_returned')) {
    verdict.reason = 'source_response_truncated';
  }
  return {
    ...verdict,
    jurisdiction,
    truncated: !!bundle.truncated,
    normalizedAddress: bundle.norm.ok ? `${bundle.norm.house} ${bundle.norm.street}` : null,
    queries: bundle.queries,
    fetchErrors: bundle.errors,
    excludedPersonalAccounts: bundle.excludedPersonalAccounts || [],
    untypedAccounts: bundle.untypedAccounts || [],
    citation: verdict.status === 'resolved'
      ? buildCitation(jurisdiction, verdict, bundle)
      : null,
  };
}

/**
 * The citation stored with every written owner. §1: "Every owner written MUST
 * cite the source row it came from — jurisdiction, the source's own record
 * identifier, and the query that found it."
 */
export function buildCitation(jurisdiction, verdict, bundle) {
  const first = (bundle.candidates || []).find(
    (c) => verdict.sourceRecordIds.includes(c.sourceRecordId));
  return {
    jurisdiction,
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
