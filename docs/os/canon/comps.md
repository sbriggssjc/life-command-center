# Comps Canon
Canon: v1.2.1

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

## Surface bindings
Copilot: `agent-instructions.md` Comps Flow → `QueryComps`/`SynthesizeComps`/`generate_comps`.
Claude Personal/Cowork: `comps-engine` skill + MCP `query_comps`/`synthesize_comps`/`generate_comps`.
Northmarq Claude: project prompt comps clause → same tools. ChatGPT: `lcc-openapi.yaml` `queryComps`/`synthesizeComps`.

## Extension notes
New verticals add columns via the engine (like dialysis chairs/patients), not per-surface logic — extend the
engine + this module, never a single surface.
