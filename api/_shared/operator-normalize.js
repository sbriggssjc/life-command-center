// ============================================================================
// Tenant → operator normalization (dialysis).
//
// Many `dia.properties` rows carry a tenant string that clearly encodes the
// operating company but have `operator` left blank (legacy CSV/CMS import, OM
// intake, CoStar capture all wrote the tenant without resolving the operator).
// Grounded 2026-06-24: 743 blank-operator properties carry a tenant; ~45 map
// cleanly to a known consolidator, ~18 are NOT dialysis at all (they rode in
// through the same OM inbox).
//
// This module is the SINGLE deterministic source of the tenant→operator map.
// It is applied in TWO places:
//   1. one-time fill-blanks backfill (SQL mirror: `dia_classify_operator_tenant`
//      in supabase/migrations/dialysis/20260624_dia_operator_normalize.sql)
//   2. at-ingest, in the OM promoter (`promoteDiaPropertyFromOm`).
//
// HARD GUARD (the critical invariant): a non-dialysis tenant can NEVER be
// assigned a dialysis operator. Only the dialysis-operator-specific family
// regexes below ever return an operator; everything else returns a NULL
// operator with a review status. We classify, we never guess.
//
// Keep the SQL function in lock-step with this map (test/operator-normalize
// .test.mjs pins the receipts). Canonical operator targets reuse the DOMINANT
// existing `dia.properties.operator` spelling so no new operator variant is
// minted.
// ============================================================================

// Canonical operator names.
//
// ⚠️ ID2a (2026-09-11): Fresenius and US Renal Care were RENAMED off the
// dominant-existing-spelling rule this module's header used to justify them
// by. Scott's decision (docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md
// §11, per the audit's §5.2 "3 of 4 independent sources agree" evidence):
//   - Fresenius → 'Fresenius Medical Care' (dia.operators, LCC Opps entities,
//     and CMS chain_organization all already said this; this module was the
//     ONE outlier, and its own comment admitted it chose the majority variant
//     of the defect it was built to fix, not any external authority).
//   - US Renal Care → 'US Renal Care' (the brand form CMS uses; the legacy
//     legal-entity form 'US Renal Care, Inc.' is now an ALIAS, never the
//     canonical target).
// This is a single point of change — everything downstream (the SQL mirror
// dia_operator_from_tenant, the dia.operators registry row, the dia
// dia_operator_aliases seed) was updated in the SAME change
// (supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql)
// so no second canonical map exists anywhere in the repo
// (test/id2a-operator-registry.test.mjs pins that).
//
// Chart labels are UNCHANGED — SHORT_OPERATOR_DISPLAY below seeds the CM
// export's existing `display: 'short_operator'` token so a longer canonical
// name never lengthens a chart axis.
const OP_DAVITA = 'DaVita';
const OP_FRESENIUS = 'Fresenius Medical Care';
const OP_USRC = 'US Renal Care';
const OP_DCI = 'Dialysis Clinic, Inc.';
const OP_ARA = 'American Renal Associates';
const OP_SATELLITE = 'Satellite Healthcare';

// Canonical → short chart-label map (ID2a §5.2's trade-off resolution: choose
// the long, more-authoritative canonical name and solve the display-length
// problem here, at export time, per the CM export's existing
// `display: 'short_operator'` token — never by re-shortening the identity).
export const SHORT_OPERATOR_DISPLAY = Object.freeze({
  'Fresenius Medical Care': 'Fresenius',
});

// Deterministic, anchored alias map. Each pattern is anchored `^` so a stray
// substring (e.g. a street or a clinic name containing a family token) never
// false-positives. Order is irrelevant — families are mutually exclusive.
const OPERATOR_ALIASES = [
  // ---- DaVita ----
  // "DaVita", "Da Vita", "DAVITA", "DaVita Kidney Care", "DaVita Dialysis",
  // "DaVita <clinic name>", "DaVita (Leasehold)".
  { re: /^da\s*vita\b/i, operator: OP_DAVITA },
  // Total Renal Care, Inc. — DaVita's pre-rename legal entity (deed/county).
  { re: /^total\s+renal\s+care\b/i, operator: OP_DAVITA },
  // DVA Renal Healthcare / DVA Healthcare Renal Care — DaVita legal entities.
  { re: /^dva\s+(renal|healthcare)\b/i, operator: OP_DAVITA },
  // Renal Treatment Centers(-Southeast, L.P.) — DaVita legal entity.
  { re: /^renal\s+treatment\s+centers\b/i, operator: OP_DAVITA },

  // ---- Fresenius ----
  // "Fresenius", "Fresenius Medical Care", "Fresenius Kidney Care", and the
  // recurring "Fresnius"/"Fresinius" typos.
  { re: /^fres[ei]?nius\b/i, operator: OP_FRESENIUS },
  // FMC / FMCNA / "FMC <city>" / "FMCNA - <city>". The "na" is optional as a
  // whole (NOT `fmcna?`, which would require "fmcn").
  { re: /^fmc(na)?\b/i, operator: OP_FRESENIUS },
  // FKC = Fresenius Kidney Care ("FKC COLTON HOME", "FKC SUNSET, UT").
  { re: /^fkc\b/i, operator: OP_FRESENIUS },
  // RAI = Renal Advantage Inc — Fresenius ("RAI-CERES AVE-CHICO"). Anchored, so
  // "Rainbow…" (no boundary after "rai") never matches.
  { re: /^rai\b/i, operator: OP_FRESENIUS },
  // Bio-Medical Applications of <state> — FMC's per-state legal entity. BMA.
  { re: /^bio-?\s*medical\s+applications\b/i, operator: OP_FRESENIUS },
  { re: /^bma\b/i, operator: OP_FRESENIUS },
  // American Access Care — Fresenius vascular-access subsidiary.
  { re: /^american\s+access\s+care\b/i, operator: OP_FRESENIUS },
  // Renal Care Group — acquired by Fresenius.
  { re: /^renal\s+care\s+group\b/i, operator: OP_FRESENIUS },
  // Azura Vascular Care — Fresenius vascular brand.
  { re: /^azura\s+vascular\s+care\b/i, operator: OP_FRESENIUS },
  // Liberty Dialysis — acquired by Fresenius.
  { re: /^liberty\s+dialysis\b/i, operator: OP_FRESENIUS },

  // ---- US Renal Care ----
  // "U.S. Renal Care", "U.S Renal Care", "US Renal Care", "USRC <clinic>".
  { re: /^u\.?\s*s\.?\s+renal\s+care\b/i, operator: OP_USRC },
  { re: /^usrc\b/i, operator: OP_USRC },
  // Dialysis Newco, Inc. dba DSI Renal — US Renal Care legal entity.
  { re: /^dialysis\s+newco\b/i, operator: OP_USRC },
  // "DSI Renal" — acquired by US Renal Care. (Bare "DSI" is left ambiguous —
  // "Diversified Specialty Institutes (DSI)" is its own curated operator.)
  { re: /^dsi\s+renal\b/i, operator: OP_USRC },

  // ---- Dialysis Clinic, Inc. (DCI) ----
  { re: /^dci\b/i, operator: OP_DCI },
  { re: /^dialysis\s+clinic(s)?\b/i, operator: OP_DCI },

  // ---- American Renal / Innovative Renal Care ----
  { re: /^american\s+renal\b/i, operator: OP_ARA },
  { re: /^innovative\s+renal\s+care\b/i, operator: OP_ARA },

  // ---- Satellite Healthcare ----
  { re: /^satellite\s+(health|healthcare|dialysis)\b/i, operator: OP_SATELLITE },
  // WellBound — Satellite's home-dialysis brand.
  { re: /^wellbound\b/i, operator: OP_SATELLITE },
];

// Clinical dialysis cues — when a tenant has one of these word-start stems but
// does NOT match a family above, it is plausibly dialysis but of an
// unknown/independent operator → leave operator NULL and surface for map
// extension (never guess). Stems (no trailing boundary) so "Dialyze"/"Dialyzer"
// match like "Dialysis".
const DIALYSIS_CUE_RE = /\b(dialy|renal|kidney|nephro|esrd|hemodialys)/i;

// Confident NON-dialysis brands/categories that ride in through the same OM
// inbox (national retail / fitness / auto). Only used to make the non_dialysis
// classification explicit; the structural guard (only family regexes assign an
// operator) is what actually prevents a dialysis operator from landing on these.
const NON_DIALYSIS_BRAND_RE = /\b(planet\s+fitness|staples|macy'?s|hertz|starbucks|walgreens|cvs\b|dollar\s+general|dollar\s+tree|7-?eleven|autozone|o'?reilly|advance\s+auto|taco\s+bell|mcdonald|wendy'?s|burger\s+king|chipotle|fedex|ups\s+store|verizon|at&t|t-?mobile)\b/i;

/**
 * Classify a tenant string into a dialysis operator (or a review status).
 *
 * Returns one of:
 *   { operator: <canonical>, status: 'matched' }          — assign the operator
 *   { operator: null,        status: 'unmatched_dialysis' } — plausibly dialysis,
 *                                                             unknown operator;
 *                                                             leave NULL, report
 *   { operator: null,        status: 'non_dialysis' }      — not a dialysis
 *                                                             tenant; flag, never
 *                                                             assign an operator
 *
 * Pure function — no side effects. Non-strings / empty → non_dialysis.
 */
export function deriveOperatorFromTenant(tenant) {
  if (typeof tenant !== 'string') return { operator: null, status: 'non_dialysis' };
  const t = tenant.trim();
  if (t.length < 2) return { operator: null, status: 'non_dialysis' };

  // ID2a fix (found verifying the live 2026-09-11 backfill write): a piped
  // string ("DaVita | US Army Corps of Engineers") is a multi-tenant capture
  // artifact (ID1 §10) — never a single operator's identity, even when its
  // first token matches a family alias below. Refuse it outright rather than
  // let the first-token match silently assign an operator; it falls through
  // to unmatched_dialysis/non_dialysis, the fail-closed default this whole
  // classifier exists to produce. Kept in lock-step with the SQL mirror
  // `dia_operator_from_tenant` (both were found carrying the exact same bug).
  if (t.includes('|')) {
    return DIALYSIS_CUE_RE.test(t)
      ? { operator: null, status: 'unmatched_dialysis' }
      : { operator: null, status: 'non_dialysis' };
  }

  for (const { re, operator } of OPERATOR_ALIASES) {
    if (re.test(t)) return { operator, status: 'matched' };
  }
  // A confident non-dialysis brand is flagged even if (improbably) it carried a
  // cue word — checked before the cue so the guard is explicit.
  if (NON_DIALYSIS_BRAND_RE.test(t)) return { operator: null, status: 'non_dialysis' };
  if (DIALYSIS_CUE_RE.test(t)) return { operator: null, status: 'unmatched_dialysis' };
  return { operator: null, status: 'non_dialysis' };
}

/** Convenience: the canonical operator for a tenant, or null when not matched. */
export function operatorForTenant(tenant) {
  return deriveOperatorFromTenant(tenant).operator;
}

/** Test/audit helper — the distinct canonical operator targets. */
export function listCanonicalOperators() {
  return [OP_DAVITA, OP_FRESENIUS, OP_USRC, OP_DCI, OP_ARA, OP_SATELLITE];
}

// ============================================================================
// ID2a — the single resolver every writer routes through.
//
// `deriveOperatorFromTenant` above is the pure, offline classifier (no DB) —
// it is what the SQL mirror `dia_operator_from_tenant` was generated from and
// what this module's own tests pin. It cannot resolve an `operator_id`
// (that needs the live registry + alias table on Dialysis_DB), so it is NOT
// itself "the resolver" the ID2a design calls for.
//
// `resolveOperatorAgainstRegistry` IS that resolver: it calls the SQL mirror
// function `dia_resolve_operator(text)` (added by
// supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql)
// via the caller's own domain-query function, so the identity source is the
// live registry — never a second copy of the alias map re-implemented here.
// It FAILS CLOSED: any status other than 'matched' returns
// `{ operatorId: null, status: 'needs_review' | 'non_dialysis' | 'blank' }`
// and never mints a new operator row.
//
// @param {string} tenant - raw tenant/operator free text.
// @param {(method:string, path:string, body?:object) => Promise<{ok:boolean,
//   data?:any}>} domainQueryFn - e.g. `(m,p,b) => domainQuery('dialysis',m,p,b)`.
// @returns {Promise<{operatorId:number|null, canonicalName:string|null,
//   status:'matched'|'needs_review'|'non_dialysis'|'blank'|'lookup_failed'}>}
export async function resolveOperatorAgainstRegistry(tenant, domainQueryFn) {
  const t = typeof tenant === 'string' ? tenant.trim() : '';
  if (!t) return { operatorId: null, canonicalName: null, status: 'blank' };
  if (typeof domainQueryFn !== 'function') {
    return { operatorId: null, canonicalName: null, status: 'lookup_failed' };
  }
  try {
    const r = await domainQueryFn(
      'POST',
      'rpc/dia_resolve_operator',
      { p_text: t }
    );
    const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
    if (!r?.ok || !row) return { operatorId: null, canonicalName: null, status: 'lookup_failed' };
    return {
      operatorId: row.operator_id ?? null,
      canonicalName: row.canonical_name ?? null,
      status: row.status || 'needs_review',
    };
  } catch {
    // Fail closed — never guess, never mint. A caller reachability failure is
    // the same as an unresolved name: leave operator_id NULL, review it.
    return { operatorId: null, canonicalName: null, status: 'lookup_failed' };
  }
}
