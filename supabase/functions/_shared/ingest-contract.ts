// ============================================================================
// supabase/functions/_shared/ingest-contract.ts
// ----------------------------------------------------------------------------
// C9 Phase 2 (2026-05-27) — Deno/TS port of the contact-validation slice of
// api/_shared/ingest-contract.js, for use by Edge Function writers
// (lead-ingest RCM/LoopNet).
//
// The Node module can't be imported into Deno (different module system +
// runtime), so the junk-name + federal-anti-pattern filters are ported here.
// This is the same accepted cross-boundary duplication the availability-checker
// Edge Function uses for its per-site parsers. Keep the regex sets in sync with
// api/_handlers/sidebar-pipeline.js::isJunkContactName /
// isFederalOwnerAntiPattern if they change there.
// ============================================================================

const FEDERAL_OWNER_ANTI_PATTERN_RE =
  /^(usa?|u\.?\s*s\.?\s*a?\.?|united\s+states(\s+of\s+america)?|u\.?\s*s\.?\s+government|federal\s+government|government)\s*$/i;

export function isFederalOwnerAntiPattern(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return false;
  return FEDERAL_OWNER_ANTI_PATTERN_RE.test(name.trim());
}

export function isJunkContactName(name: string | null | undefined): boolean {
  if (typeof name !== "string") return true;
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return true;

  // Class A: firm-name suffix patterns. Real person names don't end with these.
  const firmSuffixRe = /\b(LLC|L\.L\.C\.?|Inc\.?|Corp\.?|Corporation|Companies?|Co\.|Realty,?|Real Estate|Realtors?|Properties|Property|Partners|Investments?|Investors|Capital|Holdings?|Advisors?|Management|Brokerage|Brokers|Commercial|Services|Solutions|REIT|Fund(s)?( [IVX]+| [0-9]+)?)\b/i;
  if (firmSuffixRe.test(trimmed)) return true;

  // Class B: well-known brokerage / firm brand markers.
  const firmBrandRe = /(\bMarcus & Millichap\b|\bCBRE\b|\bJLL\b|\bNewmark\b|\bCushman\b|\bColliers\b|\bAvison Young\b|\bBerkadia\b|\bEastdil\b|\bWalker & Dunlop\b|\bMatthews Real Estate\b|\bHorvath & Tremblay\b|\bKW Commercial\b)/i;
  if (firmBrandRe.test(trimmed)) return true;

  // Class C: pipe-separated firm names ("Colliers | Virginia").
  if (/\|/.test(trimmed)) return true;

  // Class D: section labels and UI noise (anchored).
  const labelRe = /^(Fund Name|Owner Name|Listing Broker|Buyer Broker|Seller Broker|View More|View Less|Per SF|Public REIT|Equity Funds?|Vice Chairman|Senior Associate|Senior Director|Senior Vice President|Director|Principal|Managing Director|Executive Vice President|Managing Partner|General Partner|Limited Partner|Partner)$/i;
  if (labelRe.test(trimmed)) return true;

  // Class E: narrative sentences.
  if (trimmed.split(/\s+/).length >= 6 && /\.$/.test(trimmed)) return true;
  if (/^(This transaction|The seller|The buyer|This listing|The property|This property|This sale)/i.test(trimmed)) return true;
  if (/^(The sale|The deed|The transaction|The data|The information|The price|The asking|The cap|The NOI|This property|This deal|Information|Sale price|Asking price)\b/i.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 4
      && /^(the|this|that|a|an|it|all|none|no)$/i.test(tokens[0])
      && /\b(was|were|is|are|has|have|had|will|would|been|verified|unavailable|disclosed|published|obtained|recorded|reported|confirmed)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

export interface ContactIngestDTO {
  domain?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  data_source?: string | null;
}

/**
 * Validate a contact (lead / broker) before writing. A contact needs at least
 * one identifier (name OR email). When a name is present it must not be a
 * junk/section-label pattern or a federal-anti-pattern. Email shape checked.
 *
 * Mirror of api/_shared/ingest-contract.js::validateContactIngest.
 */
export function validateContactIngest(dto: ContactIngestDTO): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!dto || typeof dto !== "object") {
    return { ok: false, errors: ["DTO is not an object"] };
  }

  const name = (dto.name || "").trim();
  const email = (dto.email || "").trim();

  if (!name && !email) {
    errors.push("contact needs at least a name or an email");
  }
  if (name) {
    if (isJunkContactName(name)) {
      errors.push(`name is a junk/section-label pattern: ${JSON.stringify(name)}`);
    }
    if (isFederalOwnerAntiPattern(name)) {
      errors.push(`name matches federal-anti-pattern: ${JSON.stringify(name)}`);
    }
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.push(`email is malformed: ${JSON.stringify(email)}`);
  }

  return { ok: errors.length === 0, errors };
}
