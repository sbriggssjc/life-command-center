# Rent Intelligence Engine — Phase 1 Discovery Report

**DB:** Dialysis_DB `zqzrriwuavgrquhisnoa` (dia) · **Repo:** life-command-center ·
**Branch:** `claude/rent-intelligence-discovery-t7t0ey` · **Date:** 2026-08-08

> **GATE:** This is the report-back deliverable. **No schema is built until this is reviewed.**
> All counts below are live from the dia DB on the date above. Design is dia-first but written so
> the same engine reuses on the gov tenant (§7).

---

## 0. TL;DR / headline findings

| Fact | Number | Consequence for design |
|---|---|---|
| Total properties (universe) | **12,371** | Denominator for the coverage heatmap. |
| Properties with a **documented lease structure** (term + escalation schedule/options) | **3,570 (28.9%)** | The `contract`-basis backbone. |
| Properties with **partial** structure (term dates, no schedule) | **885 (7.2%)** | `projected` basis via `convention` infill. |
| Properties with **rent point(s) only** (no term) | **441 (3.6%)** | `stated` basis, single-year anchors. |
| Properties with **nothing** (no lease, no esc, no sale rent, no anchor) | **5,337 (43.1%)** | `convention`-only or no-timeline. Do **not** manufacture rent for these. |
| Sales with **derivable rent** (`rent_at_sale`) | **2,523 of 4,775** | Revives the 2023-2026 rent-box (§6). |
| Rent **conflicts** (>5% disagreement, same property-year) | **356 property-years / 338 props** | Reconciliation queue + the big surprise (§4). |
| **Projection core exists** — JS + SQL, battle-tested | ✅ | Reuse wholesale, do not rewrite (§5). |

**Two surprises that change the Phase 2/3 design (details in §4, §8):**
1. The conflict scan is dominated by **unit-scale mismatches** (annual-total vs PSF vs per-treatment),
   not by genuine rent disagreements. **The reconciliation engine must normalize units *before* it
   diffs**, or every property with a `lease_escalations` row will false-fork.
2. The existing projection defaults **disagree by source**: the cap-rate-recalc JS defaults to
   **10% / 60 mo** (DaVita 3×5), the SQL `dia_project_rent_at_date` defaults to **2% / 12 mo** (CPI).
   The convention table (§1c) must carry the *per-tenant* schedule so we stop relying on a single
   global default.

---

## 1a. Rent-evidence inventory

### `leases` (12,828 rows · 6,912 distinct properties)

| Field | Non-null | % of rows | Note |
|---|---|---|---|
| `lease_start` | 10,650 | 83% | Anchor date for projection. |
| `lease_expiration` | 9,023 | 70% | Bounds the initial term. |
| `rent` = `annual_rent` | 9,169 | 71% | Annual total (the two columns are kept in lockstep). |
| `rent_per_sf` | 7,303 | 57% | The **published rent-box unit**; needs RBA to reconcile to total. |
| `renewal_options` (varchar) | 2,703 | 21% | Raw text — option **count/term** parse target. |
| `renewal_option_text` (text) | 1,149 | 9% | Richer option prose. |
| `annualized_escalation_percent_current` | 1,117 | 9% | **The bump %** — only 9% populated. |
| `escalation_frequency_years_current` | 1,229 | 10% | **The bump interval** — only 10% populated. |
| `source_confidence` | documented 7,659 / inferred 882 / null 4,287 | | Maps directly to confidence hierarchy (§2c). |
| `data_source` | davita_subledger 3,147 · costar_import 2,832 · master_import 1,053 · costar_sidebar 595 · email_intake 285 · null 4,905 | | Source → confidence + authority ladder. |

Also present and useful: `term_number` / `term_type` / `parent_lease_id` (the lease is **already
modeled as initial + option terms** via a self-FK — the timeline builder should walk this chain,
not re-derive it), `superseded_at` (7,801 not-superseded — versioning already exists at the lease
grain), `expense_structure` / `expense_structure_canonical` (NNN vs gross — matters for whether
rent == NOI), `effective_date`.

**Key gap:** only ~9-10% of leases carry a structured escalation %/frequency, but **28.9% of
properties** get a "full structure" classification because `lease_escalations` (a separate per-step
ledger) fills many of them. The escalation schedule is split across two tables — the builder must
union them.

### `lease_escalations` (5,135 rows · 4,996 leases · 3,786 properties)

| Field | Non-null | Note |
|---|---|---|
| `effective_date` | 2,804 | Step start; `start_date`/`end_date` also present as a range. |
| `rent_amount` | 3,876 | **Per-step rent — UNIT IS INCONSISTENT** (see §4). |
| `annualized_escalation_percent` | 1,206 | Step bump %. |
| `escalation_frequency_years` | 1,339 | Step interval. |
| `escalation_type` / `escalation_value` / `escalation_unit` / `flat_increase_amount` | — | Fixed-% vs fixed-$ vs CPI discriminator. |
| `rent_low_psf` / `rent_high_psf` / `rent_estimate_psf` | — | PSF band — a second, PSF-native rent lane. |
| `raw_escalation_text` | — | Provenance / re-parse source. |

This is the **richest schedule source** and the primary feedstock for `contract`-basis years.

### `sales_transactions` (4,775 rows · 2,460 distinct properties · all have `sale_date`)

| Field | Non-null | Note |
|---|---|---|
| `sold_price` | 4,318 | |
| `rent_at_sale` | **2,523** | The point-in-time rent evidence — a dated anchor per sale. |
| `calculated_cap_rate` | 2,968 | Product of the Apr-2026 recalc pipeline. |
| `stated_cap_rate` | 1,690 | Broker-quoted (low trust). |
| `firm_term_years_at_sale` | 3,291 | **Firm term at close** — infers lease commencement/expiry. |
| `firm_term_expiration_at_sale` | 3,218 | Direct expiry anchor. |

`rent_at_sale` provenance (`rent_source`) — this tells us exactly which basis each is:

| rent_source | rows | Timeline basis |
|---|---|---|
| `derived_from_cap_rate` | 729 | `stated` (weak — rent = cap × price) |
| `projected_from_lease_confirmed` | 724 | already `projected` from a lease anchor |
| `master_curated` | 560 | `stated`/`contract` (curated workbook) |
| `master_import` | 397 | `stated` |
| `projected_from_om_confirmed` | 80 | `projected` from OM |
| `costar_stated` | 7 | `stated` (listing) |
| others / null | ~26 | |

**Design implication:** ~1,528 of the 2,523 `rent_at_sale` values are *already projections* our own
pipeline wrote. The timeline builder must treat `projected_from_*` rows as **derived, not
evidence** (else the engine corroborates itself). Only `master_*`, `derived_from_cap_rate`,
`costar_stated`, `om_*` are genuine point evidence.

### Listing / OM-derived rent (`available_listings`)

Rent is **implicit** on listings — no `rent`/`noi` column. Rent-relevant fields are all price/cap:
`initial_price`/`last_price`/`price_per_sf`, `cap_rate` (+ `initial`/`current`/`last`), `sold_price`,
`had_price_change`. Rent on a listing is recoverable only as `cap_rate × price` (a `stated`-basis,
low-confidence anchor, same tier as `derived_from_cap_rate`). Active-listing rent is therefore the
**weakest** evidence lane and feeds the reconciliation loop (§3), not the contract backbone.
`properties.anchor_rent` / `last_known_rent` / `anchor_rent_date` / `anchor_rent_source` already
capture the OM/lease-confirmed anchor per property — the timeline builder reads these directly.

### Existing projection logic — see §5.

---

## 1b. Structure-completeness census

Universe = all 12,371 `properties`. Classification precedence: full → partial → points-only → nothing.

```
(i)   Full structure   (term dates + escalation schedule or option text)   3,570   28.9%
(ii)  Partial          (term dates, no schedule)                             885    7.2%
(iii) Rent point(s)    (rent evidence but no term dates)                     441    3.6%
(iv)  Nothing          (no lease / esc / sale-rent / anchor)               5,337   43.1%
      ---------------------------------------------------------------------------------
      (subtotal classified)                                               10,233
      remainder = properties with a lease row but no rent & no term       ~2,138   17.3%
```

> The "remainder" are properties with a lease shell (tenant/status) but neither rent nor term —
> effectively `convention`-only candidates (tenant known, no economics). They sit between (iii) and
> (iv): a tenant-standard model can *model* them but with the lowest confidence (0.4, decaying).

**Coverage heatmap (properties × year, by best available basis).** Full property×year matrix is an
artifact of Phase 2; the discovery-grade summary by evidence lane:

| Year band | contract-capable (leases w/ schedule) | stated points (sales rent) | modeled-only (convention) |
|---|---|---|---|
| pre-2015 | high (davita_subledger dense) | ~1,100 sales | tenant-known shells |
| 2015-2022 | high | ~1,400 sales | " |
| 2023-2026 | **thin** (few new documented leases) | **374 sales w/ rent** | " |

The 2023-2026 thinness in *documented leases* is exactly why the published rent-box collapses to
NULL there (§6) — and why derived sale rent is the honest revival source.

---

## 1c. Tenant-standard conventions — seed check

Tenant strings are messy but collapse cleanly to 3-4 operators (top of 25 distinct values):

| Canonical | Variant strings observed | lease rows |
|---|---|---|
| **DaVita** | `DaVita Kidney Care` (4,176), `DaVita` (871), `DaVita Dialysis` (492), `Davita` (198), `Davita Kidney Care` (109), `DaVita HealthCare Prtnrs`, `DaVita, Inc.`, … | ~6,000 |
| **Fresenius** | `Fresenius Medical Care` (2,418), `Fresenius Kidney Care` (178), `Fresenius` (66), `Fresenius Medical` (65), `Fresenis Kidney Care` (25 — typo), … | ~2,900 |
| **U.S. Renal Care** | `U.S. Renal Care` (194), `US Renal Care` (36) | ~230 |
| **American Renal / Innovative Renal / DCI** | `American Renal Associates` (37), `Innovative Renal Care` (15), `Dialysis Clinic (Inc)` (64) | ~120 |
| junk | `Loan`, `Financials`, `XXX`, `Abc 9999` | flagged, excluded |

**Confirms the `tenant_lease_conventions` design.** Proposed columns:
`tenant_canonical, effective_from, initial_term_years, option_count, option_term_years,
bump_pct, bump_interval_years, expense_structure, notes, source`. Seed from the report's
Standard Build-to-Suit Lease Terms page:
- **DaVita** — 15-yr initial / 3×5 options / 10% every 5 yr
- **FMC** — 15-yr / 2×5 / varies (seed a CPI-ish 2%/yr placeholder, flag as low-confidence)
- **USRC** — 10-yr / 2×5 / 2.5% annual

A **tenant-name normalizer** (the same collapse the comps engine already uses) is a prerequisite —
the convention lookup keys on canonical tenant + `effective_from` (conventions changed by vintage).

---

## 1d. Conflict scan (>5% disagreement, same property-year)

**356 property-years across 338 properties** have ≥2 rent evidence points in the same year
differing by >5%. Top 10 sampled:

| property_id | year | n | low | high | gap % | sources |
|---|---|---|---|---|---|---|
| 3622903 | 2013 | 2 | 79,776 | 4,145,400 | 5096% | esc, lease |
| 22180 | 2015 | 2 | 1,800 | 85,328 | 4640% | sale, sale |
| 33681 | 2014 | 5 | 42,850 | 1,955,964 | 4465% | esc, lease |
| 29133 | 2011 | 4 | 6,592 | 183,750 | 2687% | esc, lease |
| 23722 | 2011 | 2 | 63,111 | 1,420,380 | 2151% | esc, lease |
| 25249 | 2015 | 4 | 188,398 | 4,144,768 | 2100% | esc, lease |
| 28842 | 2015 | 2 | 169,693 | 3,393,868 | 1900% | lease, lease |
| 3115869 | 2021 | 5 | 227,150 | 4,247,664 | 1770% | lease, sale |
| 2696823 | 2016 | 2 | 252,906 | 4,727,220 | 1769% | lease, lease |
| 22696 | 2013 | 2 | 215,021 | 3,681,053 | 1612% | esc, lease |

**This is the biggest surprise.** These are **not** rent disagreements — a ~50× gap is a **unit /
scale error**: `lease_escalations.rent_amount` (and some `leases.annual_rent`) is stored sometimes
as PSF, sometimes as annual total, sometimes (likely) per-treatment or monthly. A genuine
renegotiation is ±10-30%, not ±5000%.

**Consequence for Phase 3:** the reconciliation classifier must run a **unit-normalization +
sanity gate first**: reconcile every candidate to `annual_total` using `rba_sf`/`leased_area`
(PSF×area) and reject/park physically-impossible values (rent > price, rent PSF > $200, rent
implying a <1% or >20% yield) into the review queue as `bad_data`/`unit_error` — **before** the
±5% RBA-change / extension / renegotiation classification runs. Otherwise v1 forks on noise. The
true "genuine >5% but plausible" conflict count is a subset — Phase 2 will re-run this scan post-
normalization to get the honest number for the review queue's initial load.

---

## 2. Reuse assessment — the projection core

**`api/_shared/rent-projection.js` — reuse wholesale as the projection engine.**
- `projectRentAtDate({anchorRent, anchorDate, targetDate, bumpPct, bumpIntervalMonths, leaseCommencement})`
  is a clean, pure, tested step-escalation function. Anchors bumps on true lease anniversaries
  (`leaseCommencement`), handles forward + backward projection, compound stepping. **This is the
  Phase 2b projection core, unchanged.**
- `recalculateSaleCapRates()` shows the exact read pattern (via `domainQuery`) and the property
  anchor fields (`anchor_rent`, `anchor_rent_date`, `anchor_rent_source`, `lease_commencement`,
  `lease_bump_pct`, `lease_bump_interval_mo`) the builder should read.

**SQL mirror `dia_project_rent_at_date(anchor_rent, anchor_date, target_date, bump_pct, bump_interval_mo)`**
exists and is `IMMUTABLE` — usable directly inside the builder migration / views.

**⚠️ Default divergence to resolve in Phase 2 (do not silently pick one):**
| Surface | default bump | default interval |
|---|---|---|
| JS `recalculateSaleCapRates` | **10%** | **60 mo** (DaVita 3×5) |
| SQL `dia_project_rent_at_date` | **2%** | **12 mo** (CPI) |

The timeline builder must source bump/interval from the **convention table keyed on the property's
tenant** (§1c), falling back to a tenant-appropriate default — never a single global constant.
`v_sales_comps` already relies on `dia_project_rent_at_date` and projects to CURRENT_DATE
(`rent_per_sf` = projected, `base_rent` = Y1) — the timeline generalizes this from "one value at
today" to "a value per year, versioned".

**Confidence-hierarchy inputs already exist:** `leases.source_confidence`
(documented/inferred/null) + `data_source` + `sales_transactions.cap_rate_confidence` +
`rent_source`. Phase 2c encodes these as a data table rather than re-deriving in code.

**Serving reuse (Phase 4):** MCP tools live in `mcp/server.js` as a `TOOL_DEFINITIONS` map
(`get_property_context` at line 453 is the template — `{name, description, inputSchema}`); comps +
deal-dossier tools are registered by merging def maps (`__compsDefs`, `__ddDefs`). `get_property_rent_timeline`
slots in the same way and is consumed by the `comps-engine` + `bov` skills. CM rent views are
`cm_dialysis_rent_box_q` / `_rent_price_psf_q` / `_rent_price_per_chair_q` (all VIEWs) — Phase 4a
adds basis-aware variants **beside** them (never mutating the published series).

---

## 3. Schema surprises / footgun notes

1. **Split escalation schedule** — `leases.*_escalation_*_current` AND `lease_escalations.*` both
   hold schedule data; ~9-10% coverage each. Builder must UNION both, and `leases.parent_lease_id`
   / `term_number` already model initial-vs-option terms (walk the chain).
2. **`rent_at_sale` is ~60% already-projected by our own pipeline** — corroboration logic must
   exclude `rent_source LIKE 'projected%'` from "evidence" or the engine confirms itself.
3. **Unit inconsistency in rent columns** (§1d) — the dominant "conflict" cause; normalize first.
4. **Versioning primitives already exist** (`leases.superseded_at`, `sales.*`) — the new
   `property_rent_timeline.version`/`superseded_at` should mirror this convention, not invent a new one.
5. **Rent-box publishes PSF, not total** — `cm_dialysis_rent_box_q` filters `rent_per_sf BETWEEN
   5 AND 100` and suppresses quarters with `n_leases < 6`. Any "with modeled" variant must emit PSF
   and respect the same n≥6 suppression to stay comparable.
6. **43% of properties have no rent evidence at all** — the engine must be honest: `convention`
   basis for tenant-known shells (conf 0.4), and **no timeline row** for true blanks. Never fabricate.

---

## 4. Coverage heatmap (known / derivable / modeled / none)

Property counts by best-achievable basis (mutually exclusive, precedence high→low):

| Basis achievable | Definition | Properties | % |
|---|---|---|---|
| **contract** (known) | documented lease w/ schedule or option text | 3,570 | 28.9% |
| **projected** (derivable) | term + convention infill (partial structure) | 885 | 7.2% |
| **stated** (point-derivable) | rent point(s), no term | 441 | 3.6% |
| **convention** (modeled) | tenant known, no economics (lease shell) | ~2,138 | 17.3% |
| **none** | nothing | 5,337 | 43.1% |

Year granularity (Phase 2 fills the full matrix): contract/stated evidence is dense pre-2023 and
thin 2023-2026 for documented leases, but **2,523 dated sale-rent points** (incl. 374 in 2023-2026)
provide the stated-basis coverage that revives recent quarters (§6).

---

## 5. Serving-layer gap the engine closes (Phase 4 preview)

`cm_dialysis_rent_box_q` bins **new leases by `lease_start` quarter** using `rent_per_sf`, and
suppresses any quarter with `n_leases < 6`. Result today: **2023-2026 quarters are almost all NULL**
(n = 2-5 per quarter) — the "abandoned CoStar-backfill" gap. Meanwhile sales carry derivable rent:

| sale year | sales | with `rent_at_sale` |
|---|---|---|
| 2019 | 485 | 273 |
| 2020 | 477 | 229 |
| 2021 | 461 | 243 |
| 2022 | 452 | 243 |
| 2023 | 272 | 124 |
| 2024 | 201 | 98 |
| 2025 | 288 | 128 |
| 2026 | 129 | 24 |

A basis-aware "with modeled" rent-box variant (`contract`/`stated`/`projected`, conf ≥ 0.7) that
also draws these dated sale-rent points **honestly revives 2023-2026** — labeled, never mixed into
the published actuals-only series. This is the concrete Phase 4a deliverable and the prompt's stated
expected side effect.

---

## 6. Recommended Phase 2 shape (for review, not yet built)

- `property_rent_timeline` per the prompt's DDL — with `version`/`superseded_at` mirroring the
  existing `leases.superseded_at` convention; `basis` ∈ contract/stated/projected/convention;
  `provenance` jsonb carrying source table + row id + `data_source` + `source_confidence`.
- `tenant_lease_conventions` (§1c) + a tenant-name normalizer (reuse the comps engine's).
- `confidence_source_ladder` as **data** (§2c): executed lease 1.0 → OM schedule 0.9 →
  rent_at_sale confirmed 0.85 → listing/brochure 0.7 → convention 0.4 (decaying per option period).
- Builder (idempotent, per-property): walk lease + `lease_escalations` (+ `parent_lease_id` chain)
  → normalize units → project across years → evidence years keep their basis, projection fills gaps
  only → write versioned rows. Reuse `projectRentAtDate` / `dia_project_rent_at_date`.
- `v_property_rent_current` = latest unsuperseded version per property-year.

## 7. Government-reuse notes

The gov DB has the mirrored primitives: `leases`/`lease_escalations`, `sales_transactions` with the
cap-rate recalc columns, `gov_project_rent_at_date` + the full cap-rate framework (gov CLAUDE.md
§12), and `tenant`=agency conventions differ (GSA modified-gross, firm/soft term). The engine's
tables/functions should be authored with a `dia_`/`gov_` prefix convention and tenant-convention
rows seeded per tenant universe — same spine, different `tenant_lease_conventions` seed and
expense-structure default (gov leases are FS/gross by default → rent ≠ NOI).

## 8. Open decisions for reviewer

1. **Universe scope** — "surveyed universe" = all 12,371 properties, or only the ~6,912 with a
   lease / the CMS-surveyed subset? (Affects the `none` denominator.)
2. **Bump/interval default** — confirm convention-table-per-tenant with DaVita 10%/5yr,
   USRC 2.5%/1yr, FMC 2%/1yr placeholder (flagged low-confidence) as seeds.
3. **Convention-only rows** — do we materialize timeline rows for the ~2,138 tenant-known shells
   (conf 0.4) or leave them absent until real evidence lands? (Recommend: materialize, clearly
   flagged, so the coverage view is honest about "modeled".)
4. **Conflict tolerance** — 5% is the fork trigger; confirm the pre-normalization sanity bounds
   (rent PSF ≤ $200, implied yield 1-20%, rent < price) for the `bad_data` gate.

---

*End Phase 1 discovery. Awaiting review before Phase 2 (schema + builder).*
