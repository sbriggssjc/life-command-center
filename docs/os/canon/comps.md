# Comps Canon
Canon: v1.3.0

## Purpose
Return sales/lease comps that are identical in substance and format on every surface.

## Triggers
"sales comps", "comparable sales", "market comps", "pull comps", "what did [asset] sell for",
"government comps", "[type] comps in [state]".

## Inputs
Scott's request text (verbatim). Data comes ONLY from the LCC comps engine (blends government DB, dialysis DB,
and Salesforce-staged comps) — never from SharePoint, knowledge files, or general knowledge.

## Procedure
1. **Default to `SynthesizeComps`** with a single param `request` = Scott's text verbatim. The engine parses
   state, property type, government intent, and date window server-side. Use `QueryComps` only when Scott
   gives explicit structured filters to pass exactly. **Never add filters the user didn't state** — pass the whole request verbatim; do not invent tenant/operator/metro/state/date filters. The engine resolves the subject and EXPANDS the set (appraisal: subject -> state -> region -> national, incl. estimated-NOI). Pre-narrowing collapses the set.
2. Render the returned `markdown` field **verbatim** — already filtered, de-duplicated, cap-rate-normalized
   (decimals), reconciled. Do not add, remove, re-order, re-filter, or append analysis.
3. To produce an appraisal/comp workbook, call `generate_comps` with `request` = Scott's request text verbatim.
   The server runs synthesis and workbook generation in one pass and returns only `download_url` plus compact
   counts/summary, so 20-25 rows never round-trip through the model or connector. For small interactive exports
   only, pass `template_comps` rows to `generate_comps`; never pass full comp objects.
4. **ONE renderer, always.** The only correct comps workbook is the one `generate_comps` / `populate_comps`
   produces into the canonical template (`bov-generator/templates/Comps Blank Template - Briggs - *.xlsx`) —
   header-driven, writes only input cells, protects formula columns, sorts (Sold by DATE desc, On Market by cap
   asc), flags estimated NOI, trims blank rows to the AVG/TOTALS bar. Never hand-author a workbook, invent
   sheets/columns/a summary or methodology tab/a different sort, or leave the 100-row grid untrimmed.
   CHAIRS/PATIENTS come from the record, never blank.
   - **`bov-generator/templates/` is the SINGLE SOURCE OF TRUTH** for every blank comps template. Project-knowledge
     and `Templates/`-folder copies are DERIVED — refreshed from there via `python bov-generator/sync_comps_templates.py
     --dest <folder>`, never hand-edited (same discipline as the canon/render surface sync). See
     `bov-generator/templates/README.md`.
   - **Conformance gate.** `generate_comps` and the local `populate_comps` fallback run
     `bov-generator/validate_comps_output.py` before returning: sheet set == {Cover, Index, On Market, Sold},
     canonical row-5 headers per vertical, formula-protected columns still hold formulas, AVG bar directly beneath
     the trimmed data with matching ranges, 0 recalc errors. A non-conforming workbook is an ERROR, never a
     delivered file.
5. **Connector-down fallback (documented + reproducible).** When `generate_comps` (BOV service / MCP) is
   unreachable, do NOT build by hand — run the same renderer locally:
   `from comps_generator import populate_comps; populate_comps(payload, out, template_dir='bov-generator/templates')`
   with `payload={comp_type:'sales', vertical:'dialysis', sold:[...], on_market:[...]}` using query_comps field
   names (they alias straight through; a correct payload yields `unknown_keys: []`). Then LibreOffice-recalc.
   Every surface/agent follows this identical path.
6. **On-market rent basis (standard, identical across surfaces).** An on-market listing with a known asking cap
   but no in-place NOI carries `rent = round(asking_price * asking_cap)` (implied NOI, exact) with
   `initial_price = last_price = ask` so the template's INITIAL/LAST CAP reproduce the asking cap.

## Selection defaults + field vocabularies (engine, all surfaces — prompt 41)
These live in the engine (`mcp/comps-tools.js`), so every surface returns identical, clean text — never hand-fix
an export.

- **Recency default.** With NO window given, `synthesize_comps` / appraisal default sold comps to the **last 18
  months** ("older is a different capital-markets condition"). If fewer than the target count qualify, the engine
  WIDENS in order — **add operators** (drop a single-operator filter: DaVita → +Fresenius → +US Renal → +others)
  → **loosen geography** (already national in appraisal) → **extend the window** (24mo → 36mo) — never silently
  keeping stale comps to hit the count. Each step is logged to `meta.widened`; the window used is in
  `meta.recency_window_default`.
- **Operator (TENANT column) — canonical brand, not the raw clinic name:** DaVita · Fresenius Medical Care ·
  US Renal Care · American Renal · Innovative Renal Care · Satellite Healthcare · Dialysis Clinic Inc · DSI Renal ·
  Renal Ventures. Maps FMC / BMA / Bio-Medical → Fresenius Medical Care; USRC / U.S. Renal → US Renal Care;
  DCI → Dialysis Clinic Inc. Government agencies and genuine property names are left untouched (multi-tenant keeps
  its request-aware `MOB (VA)` / `MT (SSA)` label with the brand as anchor).
- **Expense structure — fixed vocabulary:** `Absolute NNN` · `NNN` · `NN` · `Gross` · `Ground Lease` ·
  `Modified Gross`. Maps Double Net → NN; Triple Net / Modified Triple Net → NNN; Full Service → Gross; Bondable →
  Absolute NNN. Unrecognized values pass through unchanged.
- **Renewal OPTIONS → `(N) M-yr`** (e.g. `(3) 5-yr`) — count parsed from words/digits, never the term length.
- **Bumps → `X% / yr` or `X% / N yrs`.** An uninterpretable source value (a bare number with no `%`, e.g. `0.1`,
  `1.75`) is left UNTOUCHED and routed to the review lane as bad data (`bad_bumps` flag).

Applied identically to sold + on-market, dialysis + gov.

## Output contract
Team Briggs Sales/Lease Comps template. Formula-protected columns (PRICE/SF, CAP RATE, RENT/SF, TERM, DOM,
EFFECTIVE RENT/SF) are never written — they calculate. Reliable-or-exclude NOI/rent; request-aware
multi-tenant naming (MOB/MT + anchor); surface `meta.flagged_for_review`. `buyer`/`seller`/`financing`
excluded unless asked. Workbook/appraisal responses return a link and compact counts, not row arrays.

## Never
- Never pull or merge comps from SharePoint, knowledge, or general knowledge.
- Never substitute proxy/urgent-care comps. If zero returned, say so and offer to widen (national, longer window).
- Never pre-narrow with filters the user didn't state (no invented tenant/metro/state/date) — pass verbatim; the engine expands.
- Never round-trip appraisal workbook rows through the model; use `generate_comps.request`.
- Never overwrite formula columns; never re-curate the returned rows.
- **Never hand-author a comps workbook.** When the connector is down, run `populate_comps` locally against the
  canonical template — never hand-roll a layout, invent sheets/columns/a summary tab/a different sort, or leave
  the grid untrimmed. There is exactly ONE renderer.

## Surface bindings
Copilot: `agent-instructions.md` Comps Flow → `QueryComps`/`SynthesizeComps`/`generate_comps`.
Claude Personal/Cowork: `comps-engine` skill + MCP `query_comps`/`synthesize_comps`/`generate_comps`.
Northmarq Claude: project prompt comps clause → same tools. ChatGPT: `lcc-openapi.yaml` `queryComps`/`synthesizeComps`.

## Extension notes
New verticals add columns via the engine (like dialysis chairs/patients), not per-surface logic — extend the
engine + this module, never a single surface.
