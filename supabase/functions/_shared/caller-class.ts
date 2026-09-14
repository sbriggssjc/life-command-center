// caller-class.ts — shared caller-classification helpers for a log-only auth
// gate (the COPILOT-OPEN-gate pattern). Factored out of ai-copilot/index.ts
// by SFENRICH-gate (2026-09-09) so a second gated function does not grow a
// second copy of the same UA/IP classifier — the normaliser-drift class this
// repo warns about repeatedly (dia/gov alias spellings, `lcc_normalize_entity_name`
// duplicated across call sites, etc.). Both ai-copilot and salesforce-enrichment
// import this module; a test asserts their classification output for a fixed
// set of UA/IP pairs is unchanged after the move.

export interface KnownIpEntry {
  cls: string;
  prefix: string;
}

/**
 * Parse a KNOWN_IPS-format env value: "class:prefix,class:prefix,...".
 * Never hardcode an address in a caller — this only knows the FORMAT.
 * An entry with no ":" is classed "other" (defensive; malformed config
 * should never crash the gate).
 */
export function parseKnownIps(raw: string | undefined): KnownIpEntry[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      return idx === -1
        ? { cls: "other", prefix: entry }
        : { cls: entry.slice(0, idx), prefix: entry.slice(idx + 1) };
    });
}

/** Classify a User-Agent header into a coarse caller shape. */
export function uaClass(ua: string): string {
  if (!ua) return "other";
  if (/azure-logic-apps/i.test(ua)) return "logic-apps";
  if (/^node(\/|$)|node-fetch|undici/i.test(ua)) return "node";
  if (/Mozilla\/|Chrome\/|Safari\/|Firefox\//i.test(ua)) return "browser";
  return "other";
}

/** Classify a caller IP against a KNOWN_IPS prefix list. */
export function ipClass(ip: string, knownIps: KnownIpEntry[]): string {
  if (!ip) return "other";
  for (const { cls, prefix } of knownIps) {
    if (prefix && ip.startsWith(prefix)) return cls;
  }
  return "other";
}

/** Resolve the caller's IP from the headers Supabase/Cloudflare set. */
export function requestIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    ""
  );
}
