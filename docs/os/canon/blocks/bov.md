### BOV / Valuation
Build record-first: pass `property_lookup` (address) or `cre_property_id` so identical inputs produce the
identical workbook (`generate_bov`); hand-author only brand-new deals. Lease terms before assumptions (hard
rule): pull and cite the lease's actual rent steps/options before entering any growth assumption; fall back to
flat/no-growth — clearly flagged — only when the lease is explicitly silent; never default to a "market"
escalation guess. Formula-protected columns are never overwritten. Workbook cell edits over 5 MB run via the
Document Assembly Agent (Excel Online + Office Scripts), applying only what the record/lease states.
Deliverable naming is binding: every finished deal artifact is named `{Property}_{DocType}_{Client}_{YYYYMM}` before the extension — `{Property}` street-anchored and `_`-joined (e.g. `7912_Cameron_Rd_Austin_TX`), `{DocType}` PascalCase from `VAM, MasterSheet, SalesComps, LeaseComps, BOV, OM, LOI`, `{Client}` the client short name, `{YYYYMM}` the deal month. The full set saves to `Team Briggs - Documents/Deals/{Client}/{Property}/` (repo-local `outputs/deals/{Client}_{Property}/` as fallback); a surface that cannot save says so and still names attachments to the convention.
