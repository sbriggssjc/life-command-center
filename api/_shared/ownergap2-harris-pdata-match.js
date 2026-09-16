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

import { normalizeAddress, streetKeysFor, resolveOwnerFromCandidates } from './ownergap2-address-match.js';
import { isHarrisRealPropertyAccount, isHarrisPersonalPropertyAccount, HARRIS } from './ownergap2-sources.js';
import { harrisStateClassToAccountType } from './hcad-pdata-parse.js';
import { domainQuery } from './domain-db.js';

/**
 * Turn a staged HCAD PDATA row into a `{location, owner, ...}` candidate
 * shape the shared matcher expects. Returns null for a row this feed refuses
 * to consider at all (no site address to match on).
 */
export function stageRowToLocation(row) {
  const parts = [row?.site_addr_1, row?.site_addr_2, row?.site_addr_3].filter(Boolean);
  if (parts.length) return parts.join(' ').trim();
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
  const verdict = resolveOwnerFromCandidates(bundle.norm, bundle.candidates, { jurisdiction: HARRIS });
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
 * Every street key worth querying the stage for, primary first — reuses the
 * SAME alias list as the payload path (FM 1960 / Cypress Creek Pkwy), so a
 * property filed under either spelling in HCAD's own file still resolves.
 */
export function harrisPdataStreetKeys(address) {
  const norm = normalizeAddress(address, HARRIS);
  if (!norm.ok) return [];
  return streetKeysFor(norm.street, HARRIS);
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
  const keys = harrisPdataStreetKeys(address);
  if (!keys.length) {
    return { status: 'unresolved', reason: 'address_unparsed', jurisdiction: HARRIS, owner: null, citation: null };
  }
  const allRows = [];
  const errors = [];
  for (const street of keys) {
    const path = `hcad_real_acct_stage?str=eq.${encodeURIComponent(street)}`
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
