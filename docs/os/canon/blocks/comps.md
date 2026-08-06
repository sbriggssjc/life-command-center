### Comps
Comps come ONLY from the LCC engine: `SynthesizeComps` (default — pass Scott's request text VERBATIM; never add
tenant/metro/date filters he didn't state, that collapses the set; the engine parses and expands — appraisal:
subject → state → region → national, incl. estimated-NOI) or `QueryComps` (explicit structured filters only).
Never pull or merge comps from SharePoint, knowledge files, or general knowledge. Render the returned `markdown`
verbatim (reliable-or-exclude NOI/rent, decimal cap rates, request-aware MOB/MT naming, surface
`meta.flagged_for_review`); never re-order, re-filter, or add analysis. Zero results → say so and offer to widen;
never substitute proxy comps.

**Workbooks:** for an appraisal/comp WORKBOOK call `generate_comps` with `request` = Scott's text verbatim; return
only the download link + compact counts (never hold or pass the 20–25 rows through the model). Small interactive
exports only: use returned `template_comps` as the row payload. Formula columns (PRICE/SF, CAP RATE, RENT/SF, TERM,
DOM, EFFECTIVE RENT/SF) are never written; dialysis adds Chair Count then Patient Count after RBA;
`buyer`/`seller`/`financing` excluded unless asked.

**Engine owns selection defaults + field vocabularies (prompt 41), identical on every surface:** no-window sold
pulls = last 18 months; too few → engine widens (operators → geography → window; logged in `meta.widened`), never
stale comps to hit a count. TENANT = canonical operator brand (FMC/BMA/Bio-Medical→Fresenius Medical Care,
USRC→US Renal Care; DaVita, American Renal, Innovative Renal Care…), never the raw clinic name. EXPENSES ∈
{Absolute NNN, NNN, NN, Gross, Ground Lease, Modified Gross}; OPTIONS `(N) M-yr`; bumps `X% / yr` or `X% / N yrs`
(uninterpretable bare numbers → review lane as bad data). Never hand-fix these per export.

**ONE renderer — never hand-author a workbook:** the only acceptable comps workbook comes from
`generate_comps`/`populate_comps` into the canonical Briggs template
(`bov-generator/templates/Comps Blank Template - Briggs - *.xlsx`). No invented sheets/columns/summary tabs/sorts;
grid trimmed to the AVG/TOTALS bar; CHAIRS/PATIENTS from the record, never blank. Connector down → run the SAME
renderer locally (`from comps_generator import populate_comps; populate_comps(payload, out,
template_dir='bov-generator/templates')`, payload uses query_comps field names → `unknown_keys: []`), then
LibreOffice-recalc — never build by hand. On-market with known asking cap, no in-place NOI:
`rent = round(asking_price * asking_cap)` with `initial_price = last_price = ask` so INITIAL/LAST CAP reproduce
the asking cap. `bov-generator/templates/` is the single source of truth (project-knowledge `Templates/` copies
are DERIVED via `sync_comps_templates.py`, never hand-edit). Every workbook passes
`validate_comps_output.py` before delivery — non-conforming = error, not a delivered file.

**Appraisal cap discipline + selection (prompts 48–52; hard filter on the DISPLAYED rows that ship, prompt 54):**
include comps within **35 bps of the subject cap**; keep the **set average cap below the subject**; never show a
comp above the ceiling (displayed cap ≤ subject + 35 bps). Reliability-or-exclude floor: displayed cap **< 4.5%**
or dialysis **RENT/SF outside ~12–60** = rent/SF/price error → review lane, never displayed; above-ceiling /
average-trim rows are context-only (kept for stats, not shown) — shipped rows and the `summary` cap range always
match. Sold comps carry the real `list_date` (gated < sale) so the Sold tab shows ON MARKET + DOM only where
genuine (never synthetic). Window: 18 months, may reach ~24 to make the count but keeps a handful of trailing
~7–9-month sales (recency is not sacrificed to the band). All ranking, discipline checks, and bands use the
**DISPLAYED cap = rent ÷ price**, never the stored `cap_rate` field (mislabeled on
some records; >25 bps disagreement → parked for review). The subject's operator **anchors similarity, never
filters the universe** (an appraisal pull spans all dialysis operators; an explicit "DaVita comps" request still
filters). Same-address duplicates: use the enriched/complete record, drop bare dupes (consolidated via the review
lane, never hard-deleted — prompt 51). Sold reads `sales_transactions`; recent closes propagate from
`available_listings` with `sold_cap = rent ÷ price` verified (prompt 50) so recent (incl. our own) closings appear. Subject resolution is **address-first and phrasing-independent** (prompt 49): a resolving street address
hydrates the subject (SF, chairs, term, bumps, actual cap) at top level and `fields`, and excludes it from the
set. Shared-column width contract re-applies **after** LibreOffice recalc (prompt 48,
`comps_width_postpass.py`).
