// api/_shared/ownt0j-sponsor-classifier.js
// ============================================================================
// OWN-T0j — split the OWN-T0a gov disagreement population by whether it is
// ALREADY EXPLAINED by a confirmed sponsor/SPE family (OWN-T0e), or genuinely
// unclassified. Pure functions only — nothing here reads a database.
//
// WHY THIS EXISTS. OWN-T0a compares each gov property's latest recorded
// ownership-transition GRANTEE (from gov.ownership_history via
// gov.v_ownership_transitions_portfolio) against gov.properties.true_owner_id,
// and reports ~48% disagreement. Read on named rows (Boyd Watterson, UIRC,
// NGP, Highwoods — all already-confirmed sponsor families in LCC Opps'
// lcc_ownership_sponsor_family), most of this "disagreement" is the SAME
// sponsor<->SPE shape OWN-T0 already found and correctly declined to force
// into agreement: a deed/lease grantee names the SPE holding title; true_owner
// rolls up to the sponsor. BOTH are true. This module does NOT make the two
// sides agree (that was tried and refuted on this exact shape, OWN-T0 §4/RO2)
// — it classifies each disagreeing row as `sponsor_family_confirmed` (a
// confirmed sponsor token from LCC Opps' lcc_ownership_sponsor_family explains
// it) or `unclassified_rival` (it does not), so the honest RESIDUAL is
// visible instead of the whole population reading as a defect.
//
// gov and LCC Opps are SEPARATE Supabase projects — no cross-DB SQL join is
// possible, so this classification runs at the Node layer (the tick handler
// reads both sides and calls the pure functions here; see
// api/_handlers/ownt0j-sponsor-classify-tick.js).
//
// NORMALIZATION — ported verbatim, not reinvented. gov's own
// v_ownership_transitions_portfolio computes its match key as:
//   regexp_replace(lower(regexp_replace(x, '\([^)]*\)', '', 'g')), '[^a-z0-9]', '', 'g')
// (strip any parenthesised aside, lowercase, strip everything but a-z0-9).
// normalizeGovNameKey() below is a byte-for-byte JS port of that expression —
// confirmed by running the identical SQL live on gov (scknotsqkcheojiaewwh,
// 2026-09-11) and diffing outputs; see the OWN-T0j test file's fixtures, which
// include the live SQL used to derive them. A second, independently-drifting
// normalizer is exactly the class of defect this repo's CLAUDE.md warns
// against repeatedly (lcc_normalize_entity_name / dup-pair-planner.ownerCore /
// lcc_owner_strict_core each already reduce real, different parties to one
// string) — this is why the SQL is quoted here rather than re-derived.
// ============================================================================

export const OWNT0J_CACHE_TABLE = 'lcc_ownt0j_sponsor_disagreement_cache';
export const OWNT0J_VIEW = 'v_lcc_ownt0j_sponsor_disagreement_report';

export const OWNT0J_CLASS_CONFIRMED = 'sponsor_family_confirmed';
export const OWNT0J_CLASS_UNCLASSIFIED = 'unclassified_rival';

/**
 * Byte-for-byte JS port of gov's own name-key expression (see header). Never
 * modify this without re-running the live SQL and confirming the two still
 * agree — that is the whole point of the port.
 */
export function normalizeGovNameKey(text) {
  if (text == null) return '';
  const noParens = String(text).replace(/\([^)]*\)/g, '');
  const lowered = noParens.toLowerCase();
  return lowered.replace(/[^a-z0-9]/g, '');
}

/**
 * Is this row a disagreement at all? Mirrors the population definition used
 * to reproduce OWN-T0a's live count (transition_grantee_cleaned vs
 * true_owner_name, both name-keyed). `true_owner_name` may be null/blank —
 * that keys to '' and is treated as a disagreement against any non-empty
 * grantee key, matching gov's own `nk IS DISTINCT FROM tk` comparison.
 */
export function isDisagreement(row) {
  const nk = normalizeGovNameKey(row && row.transition_grantee_cleaned);
  const tk = normalizeGovNameKey(row && row.true_owner_name);
  return nk !== tk;
}

/**
 * Build the set of confirmed sponsor tokens from LCC Opps
 * lcc_ownership_sponsor_family rows (already filtered by the caller to
 * confirmed_at IS NOT NULL). Tokens are already lower-case [a-z0-9]{3,} per
 * the registry's own CHECK constraints (chk_ownership_sponsor_token_len/_norm,
 * mirrored in api/_shared/sponsor-family-planner.js::sponsorTokenIsValid) —
 * this function does not re-validate that shape, only dedupes.
 */
export function buildConfirmedTokenSet(sponsorFamilyRows) {
  const set = new Set();
  for (const r of Array.isArray(sponsorFamilyRows) ? sponsorFamilyRows : []) {
    if (r && r.confirmed_at && r.sponsor_token) set.add(String(r.sponsor_token).toLowerCase());
  }
  return set;
}

/**
 * Classify one disagreeing gov row. `row` carries the fields the tick reads
 * from gov (transition_grantee_cleaned, true_owner_name, property_id,
 * data_source, change_type). `confirmedTokens` is a Set from
 * buildConfirmedTokenSet(). Returns one of the two class constants, or null
 * if the row is not actually a disagreement (name keys equal — never
 * classified, never counted in either bucket, per spec).
 *
 * The match rule ("true_owner (or a name-key match to it) appears as a
 * sponsor_token") is SUBSTRING containment of the token inside the
 * true_owner's name-key — the same shape A3's
 * lcc_tier0_sponsor_brand_token / lcc_name_has_spe_marker family already uses
 * for this exact sponsor<->SPE question (CLAUDE.md A3 section). It is
 * deliberately NOT full entity resolution (gov has no external_identities
 * link from true_owner_id to an LCC entity id at this join point) — this is
 * a measurement classifier, not a write path, and the token vocabulary is
 * small (18 tokens at 2026-09-11) and human-curated via OWN-T0e's own confirm
 * lane, so a token match is exactly as trustworthy as the confirm that minted
 * it.
 */
export function classifyDisagreement(row, confirmedTokens) {
  if (!isDisagreement(row)) return null;
  const tk = normalizeGovNameKey(row && row.true_owner_name);
  if (!tk) return OWNT0J_CLASS_UNCLASSIFIED;
  const tokens = confirmedTokens instanceof Set ? confirmedTokens : new Set(confirmedTokens || []);
  for (const tok of tokens) {
    if (tok && tk.includes(tok)) return OWNT0J_CLASS_CONFIRMED;
  }
  return OWNT0J_CLASS_UNCLASSIFIED;
}

/**
 * Classify a whole batch of gov rows against the confirmed token set. Returns
 * { rows: [...row + classification, sponsor_match_token...], counts }.
 * Rows that are not disagreements (classifyDisagreement -> null) are dropped
 * — this function's output IS the disagreement population, split in two.
 */
export function classifyDisagreementBatch(govRows, sponsorFamilyRows) {
  const tokens = buildConfirmedTokenSet(sponsorFamilyRows);
  const tokenList = Array.from(tokens);
  const out = [];
  let confirmed = 0;
  let unclassified = 0;
  for (const row of Array.isArray(govRows) ? govRows : []) {
    const cls = classifyDisagreement(row, tokens);
    if (cls === null) continue;
    let matchedToken = null;
    if (cls === OWNT0J_CLASS_CONFIRMED) {
      const tk = normalizeGovNameKey(row.true_owner_name);
      matchedToken = tokenList.find((t) => tk.includes(t)) || null;
      confirmed += 1;
    } else {
      unclassified += 1;
    }
    out.push(Object.assign({}, row, { classification: cls, sponsor_match_token: matchedToken }));
  }
  return {
    rows: out,
    counts: {
      comparable: (Array.isArray(govRows) ? govRows.length : 0),
      disagree: out.length,
      sponsor_family_confirmed: confirmed,
      unclassified_rival: unclassified,
    },
  };
}
