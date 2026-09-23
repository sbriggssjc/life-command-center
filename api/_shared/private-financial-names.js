// GOV-CU1 (2026-09-23) — private "federal"-named lenders are not government tenants.
//
// A federal credit union ("Navy Federal Credit Union"), a federal savings bank / S&L
// ("Third Federal Savings & Loan", "First Federal Savings & Loan Association"), a
// "Federal Bank" and a Farm Credit association are PRIVATE, member- or stockholder-owned
// institutions that happen to hold a federal charter. The word "federal" (and, for Navy
// Federal, the word "navy") read as a government signal in every gov classifier we run,
// so their bank-branch net leases were minted as Federal gov properties: 705 gov rows,
// 17 of them on the live Available list, measured 2026-09-23.
//
// This module is the ONE JS implementation of "remove the private-lender name before
// asking whether the text names a government tenant". Mirrors, kept in lock-step and
// parity-tested (test/gov-cu1-private-financial-names.test.mjs):
//   - supabase/functions/_shared/private-financial-names.ts  (edge routers)
//   - gov DB gov_strip_private_financial_names(text)          (government-lease sql/20260923_gov_cu1_*)
//
// It STRIPS the name (plus up to two preceding words, which is where the institution's
// own name sits: "Navy Federal Credit Union", "Third Federal Bank"), it does not veto the
// text. So "GSA | Navy Federal Credit Union" still classifies government on the GSA half.
//
// ⚠️ PROTECTED — these ARE federal agencies and must survive the strip:
//   "National Credit Union Administration" (NCUA — 6 live gov properties, 8 leases, 8 sales)
//   "Farm Credit Administration"
// ⚠️ "Federal Bankruptcy Court" is a court; the `federal bank` arm is word-bounded so
// "bankruptcy" never matches (a live gov sale carries "AOC/Federal Bankruptcy Court").
//
// Known limit, stated: the two-word prefix can swallow an adjacent word with no
// punctuation between ("gsa navy federal credit union" loses "gsa"). Delimited tenant
// lists (| ; , /) are safe because the prefix never crosses a delimiter.

// Protected agency names are stashed verbatim and restored by index, so the strip never
// changes their spelling or case.
const PROTECTED_RE = /national\s+credit\s+union\s+administration|farm\s+credit\s+administration/gi;

// Keep this pattern byte-equivalent in meaning to the TS and SQL mirrors.
export const PRIVATE_FINANCIAL_NAME_RE = new RegExp(
  String.raw`(?:\b[a-z0-9][a-z0-9.&'-]*\s+){0,2}\b(?:` +
    String.raw`(?:federal\s+)?credit\s+union` +
    String.raw`|federal\s+savings(?:\s+(?:and|&)\s+loan(?:\s+association)?|\s+bank)?` +
    String.raw`|savings\s+(?:and|&)\s+loan(?:\s+association)?` +
    String.raw`|federal\s+bank` +
    String.raw`|farm\s+credit(?:\s+(?:services|bank|association))?(?:\s+of\s+[a-z-]+)?` +
    String.raw`|fcu` +
  String.raw`)\b`,
  'gi',
);

/**
 * Remove private federally-chartered lender names from free text. Returns the text with
 * each name replaced by a space; everything else (case included) is untouched.
 */
export function stripPrivateFinancialNames(text) {
  if (text == null) return text;
  const kept = [];
  let s = String(text).replace(PROTECTED_RE, (m) => `\u0001${kept.push(m) - 1}\u0001`);
  s = s.replace(PRIVATE_FINANCIAL_NAME_RE, ' ');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]);
  return s;
}

/** True when the text names a private federally-chartered lender (NCUA / FCA excluded). */
export function hasPrivateFinancialName(text) {
  if (!text) return false;
  return stripPrivateFinancialNames(text) !== String(text);
}

/**
 * True when the text is NOTHING BUT private-lender names and punctuation, i.e. there is
 * no other tenant left to classify. "Navy Federal Credit Union" → true;
 * "GSA | Navy Federal Credit Union" → false.
 */
export function isOnlyPrivateFinancialName(text) {
  if (!hasPrivateFinancialName(text)) return false;
  return !/[a-z0-9]/i.test(stripPrivateFinancialNames(text));
}
