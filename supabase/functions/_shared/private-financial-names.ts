// GOV-CU1 (2026-09-23) — Deno mirror of api/_shared/private-financial-names.js.
// Edge functions cannot import from api/, so this is a lock-step copy; the parity test
// test/gov-cu1-private-financial-names.test.mjs runs both over the same fixtures and fails
// on any divergence. Edit both, never one. See the JS file for the rationale and limits.

// Protected agency names are stashed verbatim and restored by index, so the strip never
// changes their spelling or case.
const PROTECTED_RE = /national\s+credit\s+union\s+administration|farm\s+credit\s+administration/gi;

export const PRIVATE_FINANCIAL_NAME_RE = new RegExp(
  String.raw`(?:\b[a-z0-9][a-z0-9.&'-]*\s+){0,2}\b(?:` +
    String.raw`(?:federal\s+)?credit\s+union` +
    String.raw`|federal\s+savings(?:\s+(?:and|&)\s+loan(?:\s+association)?|\s+bank)?` +
    String.raw`|savings\s+(?:and|&)\s+loan(?:\s+association)?` +
    String.raw`|federal\s+bank` +
    String.raw`|farm\s+credit(?:\s+(?:services|bank|association))?(?:\s+of\s+[a-z-]+)?` +
    String.raw`|fcu` +
  String.raw`)\b`,
  "gi",
);

export function stripPrivateFinancialNames(text: string): string {
  const kept: string[] = [];
  let s = String(text ?? "").replace(PROTECTED_RE, (m) => `\u0001${kept.push(m) - 1}\u0001`);
  s = s.replace(PRIVATE_FINANCIAL_NAME_RE, " ");
  s = s.replace(/\u0001(\d+)\u0001/g, (_: string, i: string) => kept[Number(i)]);
  return s;
}
