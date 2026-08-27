# Government Credit-Tier Propagation Audit — 2026-08-11

## Objective
Investigate why State/Municipal coverage is sparse in the government `cap_rate_by_credit` chart and whether the gap is caused by source metadata, ingestion propagation, classifier logic, or export/chart rendering. First pass is read-only: no canonical row mutation.

## Required Context Read
- `CLAUDE.md`
- `.github/AI_INSTRUCTIONS.md`
- `docs/history/worklogs/CAPMARKETS_TAB_PACKET_WORKLOG.md`
- `docs/capital-markets/ROUND66_DATA_AUDIT_2026-06-01.md`
- `docs/capital-markets/ROUND66_EXPORT_FEEDBACK_WORKLOG.md`
- `supabase/migrations/20260694_cm_round66_gov_export_feedback_view_fixes.sql`
- `supabase/migrations/20260699_cm_round66e_gov_credit_classifier.sql`
- `api/capital-markets.js`
- `api/_shared/cm-excel-export.js`
- `api/_shared/cm-native-chart-injector.js`

## Running Notes
- Started from `docs/capital-markets/CLAUDE_CODE_PROMPT_gov_credit_tier_ingestion_propagation.md`.
- Prior worklog says live coverage on 2026-08-10 was Federal 117/117 quarters, State 77 quarters, Municipal 29 quarters, with recent Municipal failing the `n >= 2` TTM gate after 2023-03 except isolated rows.
- Round 66 migration broadened state/municipal branches, but Round 66e superseded it with a stricter classifier and notes that the government-leased portfolio is genuinely federal-heavy.

## Current Status
- Completed first-pass read-only audit from live Government PostgREST plus repo code trace. No canonical records were mutated.

## Current Coverage

Live Government chart view coverage, read 2026-08-11:

| View | Rows | Federal non-null | State non-null | Municipal non-null |
|---|---:|---:|---:|---:|
| `cm_gov_cap_by_credit_q` | 117 | 117, `1997-03-31` to `2026-03-31` | 77, `2004-12-31` to `2025-09-30` | 29, `2014-12-31` to `2023-03-31` |
| `cm_gov_cap_by_credit_m` | 351 | 351, `1997-01-31` to `2026-03-31` | 230, `2004-12-31` to `2025-11-30` | 84, `2014-12-31` to `2023-03-31` |

Eligible-sale classifier recompute using the Round 66e CASE logic, filtered to `sale_date <= 2026-06-30`, `sold_price > 0`, `sold_cap_rate` between 4.0% and 12.0%, and excluding `cap_rate_quality = 'implausible_unverified'`:

| Class | Count |
|---|---:|
| Federal | 2,443 |
| State | 163 |
| Municipal | 50 |
| Unclassified | 705 |
| Total eligible | 3,361 |

Recent year counts:

| Year | Federal | State | Municipal | Unclassified |
|---|---:|---:|---:|---:|
| 2023 | 84 | 8 | 1 | 38 |
| 2024 | 66 | 6 | 2 | 15 |
| 2025 | 48 | 0 | 1 | 13 |
| 2026 YTD | 28 | 0 | 1 | 3 |

Recent TTM gate reality:

| Period end | Federal n | State n | Municipal n | Unclassified n |
|---|---:|---:|---:|---:|
| `2024-12-31` | 66 | 6 | 2 | 15 |
| `2025-03-31` | 58 | 3 | 3 | 17 |
| `2025-06-30` | 58 | 2 | 2 | 13 |
| `2025-09-30` | 50 | 1 | 2 | 15 |
| `2025-12-31` | 48 | 0 | 1 | 13 |
| `2026-03-31` | 52 | 0 | 0 | 10 |

Conclusion: the sparse chart is not an Excel/native-chart rendering bug. Quarterly State drops when `state_n < 2`; Municipal drops after `2023-03-31` because the TTM count falls below the `muni_n >= 2` gate except isolated later months in `_m`.

## Raw Field Coverage

Raw `government_type` on eligible sale rows:

| Raw value | Count |
|---|---:|
| Federal | 2,440 |
| State | 158 |
| Municipal | 39 |
| Local/State | 11 |
| Federal & State | 4 |
| State & Federal | 1 |
| Other | 8 |
| Blank | 700 |

Top raw sale agencies:

| Agency | Count |
|---|---:|
| Blank | 671 |
| SSA | 375 |
| GSA - Social Security Admin | 173 |
| GSA | 156 |
| USPS | 115 |
| Social Security Administration | 68 |
| FBI | 60 |
| GSA - FBI | 60 |
| DEA | 56 |
| U.S. Department of Veterans Affairs | 56 |

The biggest propagation defect is not that the classifier cannot classify sale-row agency text; it is that 2023+ sale rows frequently have blank `agency` and `government_type` even when the linked property row has them.

## Recoverability Audit

For 2023+ eligible sale rows that the live classifier leaves unclassified:

| Bucket | Count |
|---|---:|
| Recent unclassified eligible sales | 69 |
| Recoverable from linked `properties` / `leases` metadata | 58 |
| No recoverable metadata found through linked property/lease path | 11 |

Recoverable examples:

| Sale date | Property | Sale row fields | Upstream source | Recoverable class |
|---|---:|---|---|---|
| `2023-04-18` | 31246 | `agency=NULL`, `government_type=NULL` | `properties.agency=FSSA/PDR`, `properties.government_type=State` | State |
| `2023-10-13` | 31036 | `agency=NULL`, `government_type=NULL` | `properties.agency=USF Health`, `properties.government_type=State` | State |
| `2023-01-03` | 6154 | `agency=NULL`, `government_type=NULL` | `properties.agency=GENERAL SERVICES ADMINISTRATION`, `properties.government_type=Federal` | Federal |
| `2023-09-22` | 12853 | `agency=NULL`, `government_type=NULL` | `properties.agency=Corpus Christi Field Office`, `properties.government_type=Federal` | Federal |

Truly missing or not safely classifiable examples:

| Sale date | Property | Sale row fields | Notes |
|---|---:|---|---|
| `2023-02-23` | NULL | blank agency/type | no property anchor to recover from |
| `2023-04-27` | NULL | blank agency/type | no property anchor to recover from |
| `2024-02-22` | NULL | blank agency/type | no property anchor to recover from |
| `2024-06-07` | 16531 | `agency=Davita Kidney Care` | likely non-gov/dialysis contaminant in gov sale table, not a credit-tier candidate |
| `2024-12-01` | 23512 | `agency=Restoration Hardware` | likely non-government tenant/commercial contaminant |
| `2026-03-06` | 16546 | `agency=Fresenius Medical Care` | likely dialysis contaminant |

Classifier miss example:

| Sale date | Property | Sale row fields | Issue |
|---|---:|---|---|
| `2023-07-27` | 32180 | `agency=Department of Veteran Affairs`, `government_type=NULL` | Round 66e regex catches `veterans` plural and `VA`, but misses singular `Veteran Affairs`; this should classify Federal. |

## Ingestion And Propagation Map

Current writers and enrichment points found in repo:

| Path | Writes / carries | Credit-tier implication |
|---|---|---|
| `extension/content/rca.js` | Parses RCA property history; when tenant table is absent, extracts `Tenants: ... -- <name>` from sale comments into `tenants[]`. | Good upstream source for agency text when RCA pages hide structured tenants. |
| `api/_handlers/sidebar-pipeline.js::classifyDomain` | Uses `GOV_TENANT_PATTERNS`, now including state/local patterns locked by `test/gov-classifier-state.test.mjs`. | Domain classifier is much broader than the cap-credit SQL classifier and can identify state/local government leases at capture time. |
| `api/_handlers/sidebar-pipeline.js::upsertDomainProperty` | For gov, writes `properties.agency`, `agency_full_name`, and allows `government_type`; historical-comp captures intentionally suppress current lease/agency property fields. | Property rows often retain the recoverable agency/type that sale rows lack. |
| `api/_handlers/sidebar-pipeline.js::linkGsaLease` | Pulls `agency`, `agency_full_name`, `government_type` from `gsa_leases` onto `properties`, guarded against clobbering a CoStar-confirmed occupant. | Good source for property-level Federal classification; not automatically sale-frozen. |
| `api/_handlers/sidebar-pipeline.js::upsertGovernmentLeases` | Writes `leases.tenant_agency`, `tenant_agency_full`, `government_type` from captured metadata. | Lease-level source can support diagnostics/backfill when sale row is blank. |
| `api/_handlers/sidebar-pipeline.js` sale writer | For gov sales, writes `sales_transactions.agency = primaryTenant` and `government_type = metadata.government_type`. | If `primaryTenant` or `metadata.government_type` is blank during bulk/import/historical sale capture, sale rows stay blank even when linked property metadata exists. |
| `api/_handlers/intake-promoter.js` | Writes gov `available_listings.tenant_agency`; prospect-lead path defaults `government_type` to `federal`. | Useful listing tenant source, but live `available_listings` lacks `government_type`, and defaulting all prospect leads to Federal should not be reused for sales. |

## View Definition Drift

Exact live view-body comparison was not possible from this shell:

- Local Supabase project is linked to Dialysis (`zqzrriwuavgrquhisnoa`), not Government.
- `supabase projects list` was unavailable because no Supabase access token is loaded.
- PostgREST does not expose `pg_views` (`PGRST205`, `public.pg_views` not in schema cache).

Behavioral findings:

- Live coverage exactly matches the 2026-08-10 check: quarterly Federal 117, State 77, Municipal 29; monthly Federal 351, State 230, Municipal 84.
- Local recompute using the repo's Round 66e classifier produces the same qualitative coverage pattern and recent TTM gate failures.
- The live view likely has the Round 66e class ordering or a close equivalent, but byte-for-byte drift remains unverified until a Government direct SQL session runs `pg_get_viewdef('public.cm_gov_cap_by_credit_q'::regclass, true)`.

## Answers To Investigation Questions

1. Current sale-row ingestion paths are primarily CoStar/sidebar capture, RCA-derived capture through the sidebar parser, historical comp/import paths marked by `data_source` values like `costar_export`, `costar_sidebar`, and curated master backfills. Future OM/listing intake writes listing rows first, not sale rows.
2. Available classification fields vary by stage: capture metadata has tenant arrays and sale comments; property rows have `agency` / `agency_full_name` / `government_type`; leases have `tenant_agency` / `government_type`; sale rows have `agency` / `government_type` but often blanks.
3. `sales_transactions.government_type` and `sales_transactions.agency` should be sale-frozen fields set at sale-row creation when the source names the tenant/agency. A future normalized `credit_tier` should be additive and provenance-tagged; do not make report views infer silently from mutable current property rows without audit fields.
4. Recent unclassified sales are mostly propagation misses, not source absence: 58/69 have recoverable linked property/lease metadata. The residual 11 are either unanchored sale rows or likely non-government contaminants.
5. Exact live view definition drift could not be verified via current access; live behavior matches Round 66e-style classifier/gates.
6. `Local/State` should not map wholesale to State. Current Round 66e maps `local` to Municipal first, which is safer for city/county/local text. Ambiguous `Local/State` should be split by specific agency text first, then fall back to Municipal rather than State.
7. Keep quarterly `_q` as the primary published chart. Monthly `_m` can be exposed as a diagnostic or alternate detail view because it reveals isolated sparse observations, but it does not solve the thin-sample issue and may imply more continuity than exists.
8. Keep the `n >= 2` gates for State/Municipal in the main line chart. Add count columns/markers or a companion thin-sample table rather than connecting single-observation gaps.

## Recommended Remediation Plan

Phase A — diagnostics only:

- Add a read-only diagnostic view or script that emits per-sale `credit_class_sale`, `credit_class_property`, `credit_class_lease`, source fields, and a `recoverability_status`.
- Add cohort count fields to a diagnostic sibling of `cm_gov_cap_by_credit_q/_m` (`federal_n`, `state_n`, `municipal_n`, `unclassified_n`), not necessarily to the chart view contract.
- Run direct SQL `pg_get_viewdef` against Government to close the drift question.

Phase B — classifier/view fix:

- Patch the credit classifier to catch singular `Department of Veteran Affairs` / `Veteran Affairs`.
- Consider splitting ambiguous `Federal & State` / `State & Federal` by agency text before the raw `government_type` branch, because current string ordering can choose State if `state` appears before explicit federal agency text.
- Do not broaden bare `department of` in the cap-credit SQL; the sidebar classifier already has careful false-positive tests, and SQL should stay conservative.

Phase C — ingestion propagation fix:

- In the gov sale writer, when creating/updating a sale with blank `agency` / `government_type`, fill from the same capture metadata used for property/lease writes before the payload hits `sales_transactions`.
- For sale rows linked to a property, add a fill-blank-only enrichment plan that proposes `sales_transactions.agency/government_type` from `properties` / `leases` only when the sale row is blank and the upstream source is unambiguous.
- Keep historical-comp safeguards: do not overwrite current property tenant with historical sale tenant, and do not infer a sale tenant from current property metadata unless the proposal is explicitly marked as derived/backfill.

Phase D — optional backfill, approval required:

- Backfill blanks only, with provenance and reversible batch tags.
- Candidate first batch: 58 recent unclassified rows where linked property/lease metadata classifies cleanly.
- Exclude or route to review rows with non-government tenants (`Davita`, `Fresenius`, `Restoration Hardware`, `York Space Systems`) and rows without `property_id`.

## Second-Pass Code Investigation — Forward Ingestion Gaps

The deeper code trace shows the current stack is good at routing records into the Government domain, but it does not consistently convert the same evidence into a Federal / State / Municipal credit tier. That means the State/Municipal chart sparsity can continue even after the state/local government classifier improvements, because a row can be classified as Government while `agency` and `government_type` remain blank on `sales_transactions`.

### Code Path Findings

| Area | Evidence | Gap / oversight |
|---|---|---|
| Sidebar domain classifier | `api/_handlers/sidebar-pipeline.js::GOV_TENANT_PATTERNS` includes federal, state, county, city, school district, workforce, public safety, corrections, human services, parks/wildlife, lottery, land office, education agency, and other state/local signals. `classifyDomain()` reads tenant fields, tenant arrays, sale notes, marketing text, OCR/PDF text, and entity text. | This only returns the broad `government` domain. It does not emit `Federal`, `State`, or `Municipal`, so the richer domain detection is not propagated to credit-tier fields. |
| Primary tenant selection | `selectPrimaryTenant(metadata, domain)` chooses a gov tenant from `metadata.tenants`, `tenant_name`, `primary_tenant`, or sale-history comments. | The selected tenant can identify an agency, but no tier resolver is called after selection. The system stops at tenant text. |
| Property writer | `upsertDomainProperty()` writes gov `properties.agency`, `agency_full_name`, and allows `government_type` if present in metadata. `linkGsaLease()` can patch Federal-style GSA lease agency/type onto properties. | Property rows often have recoverable agency/type, but new non-GSA state/municipal captures depend on metadata already containing `government_type`. There is no centralized derivation from agency text. |
| Property-agency link | `upsertPropertyAgency()` looks up `government_agencies` by agency name and writes `property_agencies.government_type` if found. | If the agency is absent from the master list, the path logs the miss and does not classify the text as State/Municipal/Federal. This is a common failure mode for local agencies and state sub-agencies. |
| Lease writer | `upsertGovernmentLeases()` writes `leases.tenant_agency`, `tenant_agency_full`, and `government_type` from `metadata.government_type`. | The lease path does not derive tier from `tenant_agency`; it only propagates a tier if upstream metadata already supplied one. |
| Sale writer | `upsertDomainSales()` sets gov `sales_transactions.agency = primaryTenant` and `government_type = metadata.government_type`. The sale payload uses `stripNulls`, and update logic has fill-blank priority handling for other fields but not for agency/tier. | This is the main chart propagation gap. A gov sale can have an agency in the source text but a null `government_type`; or it can have recoverable linked property/lease tier metadata but still remain unclassified in the sale-based cap-rate views. |
| Sale notes | Gov sales persist `sale_notes_raw` / `sale_notes_extracted` for recent sale-history records. | Sale notes are used for domain routing but not for tier extraction. State/local terms in notes can get the row into Government without filling `agency` / `government_type`. |
| OM extraction | `api/_shared/intake-extraction-prompt.js` schema contains `tenant_name` but not `government_type`, `agency_full_name`, or `credit_tier`. `api/_shared/share-extractor.js` has `tenant.agency` and `tenant.credit_rating`, but no government tier field. | The extraction prompt may see "city", "county", "state", or "federal", but the schema gives it no stable place to return that classification. |
| OM property creation | `api/_handlers/intake-create-property.js` builds property metadata with tenant fields and picks the domain, then calls `upsertDomainProperty()`. Gov provenance records agency/rba, not government type. | Brand-new OM-created government properties can be routed correctly but start life without tier metadata. |
| Intake promoter | `buildGovListingRow()` writes listing `tenant_agency`; live `available_listings` does not expose `government_type`. `promoteProspectLead()` defaults missing `government_type` to `federal`. | Listings cannot carry tier today, and the prospect-lead Federal default is risky if reused elsewhere. Future paths should derive or leave null, not default to Federal. |
| Salesforce/Northmarq classifier | `api/_shared/sf-nm-classifier.js` has separate gov agency patterns and returns vertical `gov`. | Like the sidebar classifier, it identifies Government but does not produce Federal/State/Municipal tier output from tenant or account text. |
| Classifier drift | DB `canonicalize_agency` migration handles singular/plural `Veteran Affairs`, while the cap-credit SQL classifier misses singular `Department of Veteran Affairs`. | Canonical agency normalization and CM credit-tier SQL are not using one shared rule set, creating avoidable Federal misses and likely future drift. |

### Gaps That Can Continue The State/Municipal Data Gap

1. **Government-domain classification is not credit-tier classification.** The state/local patterns added for routing prove the system can identify likely government tenants, but those patterns are not reused to populate `government_type`.
2. **Sale rows are the chart source, and sale rows are under-enriched.** Linked properties and leases often contain enough metadata to classify the sale, but `cm_gov_cap_by_credit_q/_m` are sale-row based and cannot see those recoverable fields unless the view or a backfill explicitly uses them.
3. **The most important writer accepts null tier as normal.** `upsertDomainSales()` has no fill-blank-only tier enrichment, no agency-master fallback, and no sale-note tier extraction.
4. **Master-list lookup is too brittle for state/local agencies.** `government_agencies` is useful when it matches, but unmatched county/city/state agencies should still be classified conservatively from text rather than dropped to null.
5. **Future OM and share extraction schemas cannot carry the tier.** Even if model extraction sees a state/municipal agency, the current schema design discards that detail before downstream writers run.
6. **Federal defaults are dangerous outside narrow prospect workflows.** Defaulting a missing gov type to Federal can hide unknowns and suppress State/Municipal growth. Existing sales/property/lease paths should use explicit evidence only.
7. **There are multiple government classifiers with different output shapes.** Sidebar, Salesforce/NM, DB canonicalizer, and CM SQL views each have partial rules. Without a shared resolver, fixes in one layer do not automatically improve the others.

### Recommended Code Remediation

Phase C1 — add one shared tier resolver:

- Create a shared resolver used by ingestion writers and tests, e.g. `api/_shared/gov-credit-tier.js`.
- Inputs should include explicit `government_type`, `agency`, `agency_full_name`, `tenant_name`, selected tenant text, sale notes, lease number/source fields, and optional master-agency lookup results.
- Output should be normalized to `federal`, `state`, `municipal`, or `null`, plus a reason/source string for provenance.
- Conservative precedence: explicit normalized tier first; federal agency/lease-number evidence; state agency evidence; city/county/local/school-district/municipal evidence; master `government_agencies` lookup; otherwise null. Do not classify bare "department of" by itself.

Phase C2 — wire the resolver into forward writers:

- In `upsertDomainSales()`, fill blank `sales_transactions.government_type` from the resolver when `domain === 'government'` and evidence is unambiguous.
- Continue writing `agency` from `selectPrimaryTenant()`, but also use property/lease/master lookup only as fill-blank support, never as an unmarked overwrite.
- In `upsertDomainProperty()` and `upsertGovernmentLeases()`, derive `government_type` from the same resolver when metadata does not already include it.
- In `upsertPropertyAgency()`, when `government_agencies` lookup misses, classify the agency text for `property_agencies.government_type` without creating a new master-agency row.

Phase C3 — fix extraction schemas:

- Add `government_type` or `credit_tier` plus `agency_full_name` to OM/share extraction output.
- Prompt the extractor to return the tier only when stated or clearly derivable from agency text, otherwise null.
- Preserve the evidence phrase that supported the classification so downstream provenance can show why a tier was set.

Phase C4 — align SQL/reporting:

- Patch Round 66e-style SQL to catch singular `Veteran Affairs`.
- Prefer using a canonical DB function for sale-view classification, or generate CM SQL from the same rule table used by ingestion.
- Add diagnostic columns/views showing `sale_type`, `property_type`, `lease_type`, and `derived_type` before making any silent reporting change.

Phase C5 — add regression tests:

- `TX Health and Human Services` / `Texas Workforce Commission` classify as State.
- `City of ...`, `County of ...`, `School District`, and `Municipal Utility District` classify as Municipal.
- `Department of Veteran Affairs` classifies as Federal.
- Gov sale creation fills blank `government_type` from selected tenant or sale notes.
- Existing nonblank sale `government_type` is not overwritten by weaker property/current-lease inference.
- Dialysis/private tenants that happen to appear in gov sale tables remain excluded or review-routed.

## Chart Recommendation

Keep the main export on quarterly `_q` with current gates. Add visible sparse-cohort markers and/or a count footnote/table rather than lowering gates. Monthly `_m` is useful for diagnostic review because it shows isolated State/Municipal points, but it should not replace the primary chart unless the deck explicitly wants a "thin monthly observations" exhibit.

## Implementation Pass — 2026-08-11

Implemented the forward-ingestion and read-only backfill-identification layer recommended above.

### Code Changes

| Path | Change |
|---|---|
| `api/_shared/gov-credit-tier.js` | New conservative Federal / State / Municipal resolver. It returns all evidenced buckets plus a scalar `primaryType` only when exactly one bucket is supported. Singular `Veteran Affairs` is covered. Bare state names are intentionally not enough. |
| `api/_handlers/sidebar-pipeline.js` | Gov property, sale, and per-tenant lease writers now call the resolver. Single-bucket evidence fills `government_type`; mixed-bucket evidence is left for expanded reporting rather than being squeezed into one scalar. |
| `api/_shared/intake-extraction-prompt.js` | OM extraction schema now includes `agency_full_name`, `government_type`, `credit_tier`, and `government_type_evidence`, with explicit instructions not to default to Federal. |
| `api/_shared/share-extractor.js` | Social/share extraction schema now carries agency tier and evidence, including multi-bucket arrays. |
| `api/_handlers/intake-create-property.js` | OM-created gov property metadata carries extracted agency/tier fields into `upsertDomainProperty()` and provenance. |
| `api/_handlers/intake-promoter.js` | Prospect-lead promotion no longer defaults missing `government_type` to Federal; it derives a single tier from snapshot evidence or leaves null. |
| `test/gov-credit-tier.test.mjs` | New resolver regression tests for Federal, State, Municipal, singular Veteran Affairs, mixed state+federal evidence, and private false-positive guards. |

### Database Migration

Added `supabase/migrations/20260811124435_gov_credit_tier_resolver_and_bucket_views.sql`.

It creates:

- `public.gov_credit_buckets_from_text(text, text)` — SQL-side conservative bucket resolver.
- `public.cm_gov_sale_credit_bucket_expanded` — one row per `sale_id` per supported credit bucket. A state+federal sale intentionally appears once in State and once in Federal.
- `public.v_gov_sales_credit_tier_backfill_candidates` — read-only cleanup queue identifying blank scalar sale rows, recommended single-bucket fills, multi-bucket reporting-only rows, and no-bucket review rows.
- Rewritten `public.cm_gov_cap_by_credit_q` and `public.cm_gov_cap_by_credit_m` to source from the expanded bucket view, preserving existing chart columns and sample gates.

No production data mutation is included in the migration. The backfill layer is identification-only.

### Verification

Passed:

```bash
node --test test/gov-credit-tier.test.mjs test/gov-classifier-state.test.mjs test/sidebar-sales-writer.test.mjs
node --check api/_shared/gov-credit-tier.js
node --check api/_handlers/sidebar-pipeline.js
node --check api/_shared/intake-extraction-prompt.js
node --check api/_shared/share-extractor.js
node --check api/_handlers/intake-create-property.js
node --check api/_handlers/intake-promoter.js
```

### Live Database Application

Applied migration `20260811124435_gov_credit_tier_resolver_and_bucket_views` to the live Government Supabase project (`scknotsqkcheojiaewwh`) on 2026-08-11.

The Supabase migration RPC rejected the full migration payload with `INVALID_ARGUMENT`, so the DDL was applied in connector-safe batches and the migration ledger was recorded after the objects were verified. No canonical sale rows were mutated.

Live smoke checks:

| Check | Result |
|---|---|
| Mixed text: `TX Health and Human Services and Social Security Administration` | returns `federal` and `state` |
| Singular VA text: `Department of Veteran Affairs` | returns `federal` |
| `cm_gov_sale_credit_bucket_expanded` bucket rows | Federal 26,868; State 1,246; Municipal 519 |
| `v_gov_sales_credit_tier_backfill_candidates` | `fill_sale_scalar_blanks` 2,399; `multi_bucket_reporting_only` 474; `needs_review_no_bucket` 766 |
| Quarterly chart view | 127 rows; Federal 121 non-null; State 99 non-null; Municipal 73 non-null; `1990-06-30` to `2026-06-30` |
| Monthly chart view | 352 rows; Federal 347 non-null; State 296 non-null; Municipal 213 non-null; `1990-06-30` to `2026-07-31` |

Important operational note: the DB/reporting layer is live, but the forward-ingestion JavaScript changes still require the normal code deploy path before new sidebar/OM/share captures start writing derived `government_type` values automatically.
