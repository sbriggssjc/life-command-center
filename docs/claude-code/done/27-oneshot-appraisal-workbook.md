# Prompt 27 — One-shot appraisal workbook: build server-side, return only the link (fix the row round-trip)

## Observed (post-deploy — appraisal mode now WORKS)
`synthesize_comps` for the Villages appraisal returns 100 candidates, ranks, returns top ~25 (17 FL), sold +
active listings, 16 flagged-for-review. The comp SET is correct. But the WORKBOOK fails on BOTH surfaces:
- **ChatGPT** (HTTP `/api/*`): the 45k-char bounded-output guard (`mcp/http-response-bound.js`) truncates the
  response before the curated rows reach `generate_comps` → "Action response truncated, no comp rows."
- **Copilot** (`/mcp` tool call): the large 25-row payload → `SystemError` (TooMuchDataToHandle-class).

## Root cause
The 2-step flow (synthesize → the MODEL holds all rows → pass them to `generate_comps`) forces the full curated
row set back through the surface's response, which every surface truncates/chokes on at appraisal scale (~25 rows
× full fields ≫ 45k chars). The rows should never round-trip through the model for a workbook.

## Fix (`mcp/comps-tools.js` + `mcp/server.js`)
1. **One-shot appraisal path.** Extend `generate_comps` to accept a `request` param (or add
   `generate_comps_from_request`) that runs synthesize + builds the Team Briggs workbook **server-side** and
   returns ONLY `{ download_url, counts, cap_rate_range, tiers:{A,B,C}, flagged_count, subject }` — the rows never
   return through the model. Make this the appraisal/workbook default. (BOV already returns a link, not bytes;
   mirror that.)
2. **Keep the 2-step path** for small interactive pulls, but the workbook-facing payload must be the COMPACT
   `template_comps` (not full comp objects), and the bounded-output guard must PRESERVE `template_comps` +
   the download affordance rather than truncating them.
3. **Canon + instructions:** update `docs/os/canon/blocks/comps.md` (and re-render) so every surface, for a comp
   WORKBOOK / appraisal, calls the one-shot path (request in → link out) and does NOT try to hold/pass 25 rows.

## Verify
- The Villages appraisal request returns a working Team Briggs workbook **download link** on ChatGPT AND Copilot,
  20–25 sold + active-listing rows, review flags retained, NO truncation / SystemError.
- Small non-appraisal pulls still render inline as before.

## Secondary (carried from prompt 26)
Subject still resolves as the place "The Villages", not the actual under-contract asset (fields "Not on file").
Resolving the live deal record (tenant/term/SF/chairs/cap) sharpens ranking — do after the workbook handoff works.
