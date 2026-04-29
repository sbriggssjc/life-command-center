// ============================================================================
// Tenant name canonicalization — collapse brand variants to a single
// stable form before writing to leases / properties.
//
// Audit on 2026-04-29 found `dia.leases.tenant × costar_sidebar` produced
// 70 conflicts in 2 days, all from CoStar capturing the same operator under
// different brand variants:
//   "DaVita Kidney Care" (19), "DaVita Dialysis" (15), "DaVita Inc." (3),
//   "DaVita" (1), "Davita Kidney Care" (5), "DAVITA DIALYSIS" (3),
//   "Davita Healthcare Partners, Inc." (2)
//   "Fresenius Medical Care" (7), "Fresenius Kidney Care" (2)
//
// The sidebar's existing fuzzy-match-for-dialysis logic already collapses
// these to the same lease row at MATCH time, but each capture overwrites
// the row's tenant column with whatever variant CoStar last surfaced.
// Provenance records each change as a same-source conflict, and the lease
// row's tenant value is unstable.
//
// Canonicalization at write time stabilizes the value to one form per
// brand and eliminates the conflict noise. Keep the rules narrow and
// well-known — false positives would corrupt distinct operators.
// ============================================================================

const CANONICAL_TENANTS = [
  // DaVita — anchor `^da\s*vita\b` so "non-DaVita" or unrelated words
  // containing "davita" don't false-positive. Matches "DaVita", "Da Vita",
  // "DAVITA", "Davita Kidney Care", "DaVita Inc.", "DaVita Healthcare
  // Partners", etc. Canonical = "DaVita Kidney Care" (the published
  // operating brand the company itself uses on signage).
  { pattern: /^da\s*vita\b/i, canonical: 'DaVita Kidney Care' },

  // Fresenius — anchor `^fresenius\b`. Matches "Fresenius", "Fresenius
  // Medical Care", "Fresenius Kidney Care", "Fresenius Health Partners".
  { pattern: /^fresenius\b/i, canonical: 'Fresenius Medical Care' },

  // US Renal Care — accepts dotted, undotted, and slash variants.
  { pattern: /^(u\.?\s*s\.?\s*renal\s+care|us\s+renal\s+care)\b/i, canonical: 'U.S. Renal Care' },

  // Dialysis Clinic, Inc (DCI) — common abbreviation collapses.
  { pattern: /^(dci|dialysis\s+clinic(s)?(\s*,?\s*inc\.?)?)\b/i, canonical: 'DCI' },

  // Satellite Healthcare
  { pattern: /^satellite\s+(health|healthcare|dialysis)\b/i, canonical: 'Satellite Healthcare' },

  // Innovative Renal Care (formerly American Renal Associates).
  { pattern: /^(innovative\s+renal\s+care|american\s+renal\s+associates)\b/i, canonical: 'Innovative Renal Care' },
];

/**
 * Return the canonical brand name for a known dialysis-tenant variant,
 * or the trimmed input if no rule matches. Returns the input unchanged
 * for non-strings or empty strings.
 *
 * Pure function — no side effects, safe to call repeatedly.
 */
export function canonicalizeTenant(name) {
  if (typeof name !== 'string') return name;
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  for (const { pattern, canonical } of CANONICAL_TENANTS) {
    if (pattern.test(trimmed)) return canonical;
  }
  return trimmed;
}

/**
 * Test-only helper: returns the rule list so callers (and tests) can
 * audit which brands are covered.
 */
export function listCanonicalTenants() {
  return CANONICAL_TENANTS.map(r => r.canonical);
}
