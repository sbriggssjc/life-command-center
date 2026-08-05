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

**Selection defaults + field vocabularies live in the engine (prompt 41) — identical on every surface.** No-window
sold pulls default to the **last 18 months**; too few → the engine widens (add operators → loosen geography →
extend window, logged in `meta.widened`), never keeping stale comps to hit a count. The TENANT column shows the
**canonical operator brand** (DaVita, Fresenius Medical Care, US Renal Care, American Renal, Innovative Renal Care…;
FMC/BMA/Bio-Medical→Fresenius, USRC→US Renal Care), not the raw clinic name. EXPENSES use a fixed set
(`Absolute NNN`/`NNN`/`NN`/`Gross`/`Ground Lease`/`Modified Gross`); OPTIONS are `(N) M-yr`; bumps are `X% / yr`
or `X% / N yrs` (uninterpretable bare numbers routed to review as bad data). Never hand-fix these per export.

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

**Appraisal cap discipline + selection policy (prompts 48–52).** For an appraisal comp set the engine ranks by
similarity to the resolved subject and applies Team Briggs cap discipline: include comps within **35 bps of the
subject cap**, keep the **set average cap below the subject**, and never present a comp with a higher cap / lower
value than the subject beyond that band. Default window is the last 18 months; it may reach back to ~24 months to
make the count but keeps **a handful of trailing ~7–9-month sales** (recency is not sacrificed to the band). The cap
used for ranking, the cap-discipline check, and any band is the **DISPLAYED cap = rent ÷ price** (what the workbook
computes), never the stored `cap_rate` field — that is mislabeled on some records, and >25 bps disagreements are
parked for review. The subject's operator **anchors similarity; it does not filter the universe** — an appraisal
pull spans all dialysis operators (a Fresenius/US Renal of like size/term/cap can outrank a same-brand comp);
an explicit "DaVita comps" request still filters by operator. When several property records share an address the
engine uses the **enriched/complete record and drops bare duplicates** (consolidated via the review-lane, never
hard-deleted — prompt 51). Sold comps read from `sales_transactions` (the live sold source); recent closes propagate
in from `available_listings` with `sold_cap = rent ÷ price` verified (prompt 50) so recent — and our own — closings
appear. Subject resolution is **address-first and phrasing-independent** (prompt 49): a street address that resolves
to a property hydrates the subject (SF, chairs, term, bumps, actual cap) at both the top level and `fields`, and
excludes it from the set, on every phrasing. The shared-column width contract is re-applied **after** the LibreOffice
recalc (prompt 48, `comps_width_postpass.py`) so the conformance gate passes and formula values stay cached.
