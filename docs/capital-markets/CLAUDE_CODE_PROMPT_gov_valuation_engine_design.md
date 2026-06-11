# Claude Code prompt — Resilient Government Valuation Engine (design exploration, receipts-first)

> Surfaced from the R76 Layer-F gov #20 review: gov "cap rates" we store are
> CONTRACT/headline numbers, but gov deals distort the contract cap away from the
> ECONOMIC (comparable) cap in four structurally different ways. A naive cap average
> mixes incompatible quantities — which is why our gov NM cohort reads ~8% when the
> real economic level is lower. Scott's directive: build a resilient gov engine that
> handles all of these across accuracy / tracking / valuation / reporting.
>
> THIS IS A DESIGN EXPLORATION — taxonomy + extraction + valuation functions +
> reporting, grounded in Scott's OWN BOV/appraisal conventions (reviewed 2026-06-11,
> see "Grounding" below). Receipts-first; NO schema/view writes until the Phase-3
> plan is gated. Both verticals where relevant; gov is the focus. dia stays as-is
> (NNN, single-stream — the engine's gov-specific lanes don't apply).

## Grounding — Scott's actual methodology (from the gov BOVs/appraisals)
Read these conventions OUT of the Northmarq Valuation Analysis Memos + the GSA
Multi-Tenant (Glenwood Springs) appraisal — do not invent a textbook version:
- **Two valuation methods, by income shape.** Direct capitalization (NOI ÷ market
  cap) for STABILIZED, level income; **yield capitalization / DCF** (discount a
  series of income streams + reversion at a market discount rate) "for properties
  that are not stabilized or expect to have large fluctuations in the income stream
  over a holding period" — i.e. the GSA TI-amortization burn-off. (Glenwood
  appraisal, Income Capitalization Approach.)
- **"Implied capitalization rate" is the appraisal's own term** = buyer/in-place NOI
  ÷ price. Our `economic_cap` must align with this.
- **BOVs report a RANGE, not a point**: e.g. VCA memo — Ask Cap 6.35%, **Trade Cap
  range 6.50%–6.85%**, with PPSF ranges. Reporting should carry going-in/reported AND
  economic, expressible as ranges.
- **Multi-tenant is valued per-stream/per-unit**: the Glenwood multi-tenant building
  was appraised at the UNIT level (the SSA unit on its own), each lease abstracted
  separately. Model multi-tenant at the **lease grain**, not a deal-level "% federal".
- **Lease language**: "reasonable actual costs of the Capital Items on an Amortized
  Basis" / TI amortization (Glenwood OM: 120-month amortization) — the contractual
  amortization that creates the income cliff. Extractable from the lease abstract.

## Cloud-first file access (MANDATORY — local cache is not durable)
Scott's machine offloads OneDrive files to the cloud after ~3 days (Files
On-Demand), so the local PROPERTIES mirror is unreliable — folders persist but file
CONTENTS disappear. The engine (and any BOV/OM/model read) must therefore treat
**SharePoint cloud as the source of truth and NEVER read the local mirror**:
1. **Read via the PA flows, not the disk.** The Phase-2 folder-feed already has
   `SHAREPOINT_LIST_URL` (list folder) + `SHAREPOINT_FETCH_URL` (get file content) —
   these fetch from the cloud regardless of local cache state. ALL PROPERTIES access
   routes through them. Add a **path-targeted fetch** (fetch THIS server-relative
   path now) so the engine/analyst can pull a specific OM / appraisal / financial
   model on demand.
3. **Persist the EXTRACTION durably, fetch once.** When a file is fetched + parsed
   (text + financial-model values), persist the extracted components to the DB
   (`staged_intake_artifacts` / `property_documents` + a gov valuation-components
   table). Subsequent reads hit the DB, never the file — so an offloaded file stays
   usable and the PA flow isn't re-hit. Re-fetch only when the folder-feed change-hash
   shows the file changed.
4. **Net:** the file's bytes live in the cloud; its extracted MEANING lives in our DB.
   Nothing in the pipeline ever depends on a file being cached on a local disk.

## The four deal shapes (the taxonomy the engine turns on)
1. **TI-amortized** — GSA amortizes tenant improvements INTO the rent over the firm
   term; in-place NOI is temporarily inflated and drops at burn-off. Contract cap is
   high; economic cap is normal. → **bifurcate**: stabilized NOI (direct cap) + NPV
   of the excess TI strip (DCF over remaining amort term @ discount rate) → implied
   economic cap. This is the bulk of the Layer-F "high-cap federal" set.
2. **Zero-cash-flow (ZCF)** — priced as points over the debt balance, tax-motivated,
   not income-priced. → cap is meaningless; **store `points_over_debt`, NULL the cap**,
   exclude from every cap cohort. (`zero_cash_flow_cap` column already hints at this.)
3. **Government contractor** — private tenant explicitly tied to a federal contract
   (e.g. Raytheon). A gov deal for our purposes. → `tenant_credit_type='government_
   contractor'`, kept IN the gov universe in its own credit lane (+ a future chart).
4. **Multi-tenant mixed** — only part of the income is long-term federal firm; the
   balance is shorter-term/lower-credit and the market devalues it. → **stratify by
   lease**: value the federal-firm stream at a gov cap, the balance at a market cap,
   blend to an implied deal cap. Tag `multi_tenant_mixed`; keep OUT of the pure
   single-tenant-NNN cohort.
Plus the non-distorted lanes already real: **short/holdover** and **state-local
low-credit** deals genuinely trade wide — their high cap is REAL, keep as comps in
their own lanes. And genuine **errors** (impossible caps) drop.

## Phase 1 — AUDIT + taxonomy proposal (read-only)
- Inventory how many gov sales fall in each shape (signal-based: ZCF = `zero_cash_
  flow_cap` present / very-low cap + big $; multi-tenant = `agency='Multi'` or >1
  lease; TI-amortized candidates = federal + elevated cap + long firm or high $/SF;
  contractor = private tenant + gov agency tie; short/holdover = firm<2y/neg).
- Propose the taxonomy columns: `pricing_basis` (income_cap | zero_cash_flow | other),
  `tenant_credit_type` (federal | state_local | government_contractor | mixed),
  `tenancy` (single_tenant | multi_tenant), `income_structure` (level | ti_amortized
  | stepped). Plus value columns: `reported_cap` (in-place/going-in), `economic_cap`
  (stabilized/implied), and the components to derive it: `stabilized_noi`,
  `ti_amort_annual`, `ti_amort_end_date`, `discount_rate`, `points_over_debt`, and a
  per-lease stream table for multi-tenant.
- Receipts: shape counts, and the F-50 set classified (the Shape worksheet is the
  seed — reconcile to it).

## Phase 2 — the valuation function (shared by engine + BOVs)
- A single `gov_economic_cap(deal)` routine implementing Scott's bifurcation:
  stabilized value = stabilized_noi / market_cap; bonus = NPV(excess strip, remaining
  amort term, discount_rate); price = stabilized + bonus; **economic_cap =
  stabilized_noi / price**. Multi-tenant = the same, summed across lease streams.
  ZCF short-circuits (no cap). Mirror the math the BOVs/appraisals use so the engine
  and a BOV produce the SAME number — pull the exact discount-rate / stabilized-NOI
  convention from a downloaded GSA financial model (Scott to point to one; the
  Glenwood model is OneDrive cloud-only).
- Extraction: extend the **Phase-2 folder-feed** (already reads PROPERTIES) to pull
  the TI-amortization schedule + per-lease abstract out of each gov deal's OM /
  appraisal / financial model, feeding the components above. This is the ingestion
  arm of the engine — reuse the existing pipeline, don't fork it.

## Phase 3 — reporting switch (gated, after the cohort is clean)
- Cap cohorts/charts read `economic_cap` (not reported) on apples-to-apples slices:
  single-tenant federal NNN (stabilized) as the core line; short/holdover, low-credit,
  multi-tenant, contractor, ZCF each in their own lane (or excluded from the core).
- Express going-in vs trade-cap as RANGES where that's how the BOV presents value.
- This is the fix that finally makes a 9.5% TI-amortized GSA deal and a clean 6.5%
  deal comparable — and makes our gov cap reporting better than the brokers'.

## Guardrails
- Receipts-first; NO writes until Phase-3 is gated. Provenance-tag; never destroy the
  reported cap — store BOTH reported and economic.
- Ground every convention in Scott's BOVs/appraisals/models, not a textbook.
- Reuse the folder-feed for extraction; reuse `field_source_priority`/provenance.
- The Layer-F Shape worksheet (Scott's row-by-row shape calls) is the labeled seed
  set — the engine's classifier should reproduce it.
