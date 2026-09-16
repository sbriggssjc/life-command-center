// ============================================================================
// Domain routing (HOME1/§C, 2026-09-16) — the single owner of "which domain
// (government vs dialysis) does this item belong to."
//
// Extracted out of daily-briefing/index.ts into its own zero-dependency
// module so it can be imported by Node test/*.test.mjs without pulling in
// index.ts's Deno-remote (`https://deno.land/...`) imports, which Node's
// ESM loader cannot resolve (ERR_UNSUPPORTED_ESM_URL_SCHEME).
//
// ⚠️ The bug this closes: `action_items.domain` (and other domain-tagged
// producers) stores the CANONICAL SHORT FORM ("dia"/"gov"), per this repo's
// documented convention ("vertical / source_domain are canonical short-form
// dia/gov ... this class of dia/gov alias bug has recurred many times —
// always canonicalize"). The prior exact-match check only recognised the
// LONG forms ("government"/"dialysis"), so every short-form-tagged item
// (the normal case) silently fell through to a fragile keyword-regex
// fallback — which is how a dialysis deal (e.g. a DaVita item) could land
// under Government Highlights whenever its title text happened to trip a
// gov-flavored keyword, or simply because the tag was ignored.
// ============================================================================

export function canonicalizeDomainTag(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "government" || v === "gov") return "government";
  if (v === "dialysis" || v === "dia") return "dialysis";
  return null;
}

// Government keyword list is intentionally generic and therefore ambiguous
// with dialysis-domain lease/deal prose ("lease", "tenant", "agency" all
// occur routinely in dialysis text too). Dialysis-operator/clinical tokens
// (DaVita, Fresenius, dialysis, renal, …) are far less ambiguous, so they
// are checked FIRST in the text fallback.
export const GOV_DOMAIN_RE =
  /\b(gsa|federal|government|gov\b|lease|tenant|agency|sba|hud|va\b|dod|usda|fema|census|opm)\b/i;
export const DIA_DOMAIN_RE =
  /\b(dialysis|davita|fresenius|clinic|renal|kidney|nephrology|npi|cms\b|esrd|rcm)\b/i;

export interface DomainRoutableItem {
  domain?: unknown;
  title?: unknown;
  body?: unknown;
  metadata?: { sender_name?: unknown; sender_email?: unknown } | null;
}

export function inferDomain(item: DomainRoutableItem): string | null {
  const tagged = canonicalizeDomainTag(item.domain);
  if (tagged) return tagged;
  const text = `${item.title || ""} ${item.body || ""} ${item.metadata?.sender_name || ""} ${item.metadata?.sender_email || ""}`;
  if (DIA_DOMAIN_RE.test(text)) return "dialysis";
  if (GOV_DOMAIN_RE.test(text)) return "government";
  return null;
}
