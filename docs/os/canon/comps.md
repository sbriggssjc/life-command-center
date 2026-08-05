# Comps Canon
Canon: v1.2.3

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
5. **Connector-down fallback (documented + reproducible).** When `generate_comps` (BOV service / MCP) is
   unreachable, do NOT build by hand — run the same renderer locally:
   `from comps_generator import populate_comps; populate_comps(payload, out, template_dir='bov-generator/templates')`
   with `payload={comp_type:'sales', vertical:'dialysis', sold:[...], on_market:[...]}` using query_comps field
   names (they alias straight through; a correct payload yields `unknown_keys: []`). Then LibreOffice-recalc.
   Every surface/agent follows this identical path.
6. **On-market rent basis (standard, identical across surfaces).** An on-market listing with a known asking cap
   but no in-place NOI carries `rent = round(asking_price * asking_cap)` (implied NOI, exact) with
   `initial_price = last_price = ask` so the template's INITIAL/LAST CAP reproduce the asking cap.

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
