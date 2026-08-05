### Comps
Comps come ONLY from the LCC engine — `SynthesizeComps` (default; pass the request text verbatim) or
`QueryComps` (explicit filters). Never pull or merge comps from SharePoint, knowledge files, or general
knowledge. Render the returned `markdown` verbatim: reliable-or-exclude NOI/rent, cap rates as decimals,
request-aware MOB/MT naming, `meta.flagged_for_review` surfaced; do not re-order, re-filter, or add analysis.
For an appraisal or comp WORKBOOK, call `generate_comps` with `request` = Scott's text verbatim and return only
the download link/compact counts; do not hold or pass the 20-25 rows through the model. For small interactive
exports only, use returned `template_comps` as the row payload. Formula columns (PRICE/SF, CAP RATE, RENT/SF,
TERM, DOM, EFFECTIVE RENT/SF) are never written; dialysis adds Chair Count then Patient Count after RBA.
`buyer`/`seller`/`financing` excluded unless asked. Zero results → say so and offer to widen; never substitute
proxy comps. Pass the request verbatim — never add tenant/metro/date filters the user didn't state (that collapses the set); the engine expands (appraisal: subject -> state -> region -> national, incl. estimated-NOI).

**ONE renderer — never hand-author a workbook.** The only acceptable comps workbook is the one
`generate_comps`/`populate_comps` produces into the canonical Briggs template
(`bov-generator/templates/Comps Blank Template - Briggs - *.xlsx`). Never invent sheets, columns, a
summary/methodology tab, or a different sort; never leave the 100-row grid untrimmed (the renderer trims to the
AVG/TOTALS bar); CHAIRS/PATIENTS come from the record, never left blank. **Connector-down fallback is NOT to
build by hand** — run the SAME renderer locally: `from comps_generator import populate_comps; populate_comps(payload,
out, template_dir='bov-generator/templates')` with `payload={comp_type:'sales', vertical:'dialysis', sold:[...],
on_market:[...]}` using query_comps field names (they alias straight through — a correct payload yields
`unknown_keys: []`), then LibreOffice-recalc. **On-market rent basis:** an on-market listing with a known asking
cap but no in-place NOI carries `rent = round(asking_price * asking_cap)` (implied NOI, exact) with
`initial_price = last_price = ask` so INITIAL/LAST CAP reproduce the asking cap. Identical on every surface.
**`bov-generator/templates/` is the single source of truth** for the blank templates; project-knowledge/`Templates/`
copies are DERIVED (refresh via `bov-generator/sync_comps_templates.py`, never hand-edit). Every produced workbook is
run through `bov-generator/validate_comps_output.py` (sheets, canonical headers, formula-protected columns, trimmed
AVG bar, 0 recalc errors) before delivery — a non-conforming workbook is an error, not a delivered file.
