// ============================================================================
// count-mode — which `Prefer: count=…` header (if any) a data-query read sends.
// Pure (no Deno APIs) so test/gov-comps-cap.test.mjs can import it under Node.
// ============================================================================
//
// GOV-COMPS-CAP (2026-09-23): a planner count is a RANGE BOUND to PostgREST,
// not just a number. With `Prefer: count=planned` PostgREST answers 416 (Range
// Not Satisfiable) for any offset past its ESTIMATED total. v_sales_comps is
// estimated at 1,817 rows while it really holds ~4,848, so offset=2000 returned
// 416, the proxy surfaced `[]`, and every paging loop stopped at exactly 2,000.
//
// Rules:
//   1. count=false → no header.
//   2. An EXPLICIT mode (exact|planned|estimated) is always honoured — the
//      caller asked, and the 416 retry in index.ts covers a bad planner guess.
//   3. With no explicit mode, a page after the first (offset > 0) gets NO
//      count: loaders take the total from page 0, so it buys nothing and it is
//      exactly what arms the 416.
//   4. Otherwise heavy tables/views get a planner estimate (incident
//      2026-08-12: exact full-table counts wedged the gov origin), the rest exact.

export function countPreferMode(
  table: string,
  countParam: string | null,
  offset: string | null,
  heavy: Set<string>,
): string | null {
  const cp = (countParam || "").toLowerCase();
  if (cp === "false") return null;
  if (cp === "exact" || cp === "planned" || cp === "estimated") return cp;
  const n = offset !== null && offset !== undefined ? parseInt(offset, 10) : 0;
  if (Number.isFinite(n) && n > 0) return null;
  return heavy.has(table) ? "planned" : "exact";
}
