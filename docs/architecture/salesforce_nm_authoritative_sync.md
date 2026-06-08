# Salesforce as the authoritative source for `is_northmarq` (Round 74)

> Status: **Foundation shipped** (classifier + contract + dry-run). Live flag
> flips, missing-deal import, the #20 cap-basis switch, and the listing_date
> backfill are **gated on Scott's verification** of the dry-run plan and are
> tracked as the remaining slices below.

Make Salesforce the LIVE authoritative source for `is_northmarq` on **both**
dialysis and government, replacing the unreliable R23 broker-string backfill.
The dia `is_northmarq` flag is both over-set (315 vs master's 183) and under-set
(50 listing-side deals unflagged in the 286-row spot-check), so the heuristic
fails in both directions.

---

## 1. Architecture constraint — everything goes through Power Automate

Scott's SF org requires SSO and he has no admin rights to register a Connected
App, so **there is no direct OAuth from LCC**. All SF access is a Power-Automate
webhook proxy (`api/_shared/salesforce.js`, `SF_LOOKUP_WEBHOOK_URL`) for
single-record lookups, plus the bulk `intake-salesforce` edge function +
`sf_*_staging` tables (the May 126k-row backfill) and a healthy SF identity map
(1,910 entities via `external_identities source_system='salesforce'`).

So "make it LIVE" is **not a new connector**. It is:

- **(a) A Power Automate flow** (Scott builds, to the contract in §4): on a
  weekly cadence, query SF closed-won deals and POST the universe to an LCC
  endpoint, landing rows in a staging table.
- **(b) LCC-side ingest → classify → match → flag** (CC builds): on each push,
  run the multi-strategy classifier + matcher + flag re-derivation idempotently.

The durable config for (b) — the classifier + the operator/agency dictionaries —
ships now in `api/_shared/sf-nm-classifier.js`. Until the flow exists, the
**one-shot path** (`scripts/sf-nm-dryrun.mjs` over Scott's `data.xlsx` export)
delivers the classification + the flag plan immediately.

> **Do NOT reuse the `intake-salesforce` / `autoCreateProperty` domain routing**
> (R12 audit: dia property → gov table, `government_type='Healthcare'` → 23514).
> The dia/gov split must come from `classifyVertical()`, never a single SF field.

---

## 2. Reachability + identity model (Task 1)

What the SF closed-won object exposes (confirmed from Scott's `data.xlsx`
`Export` sheet — this IS the Opportunity/closed-won deal object):

| Concept | Export column(s) |
|---|---|
| Deal identity | `DEAL NAME` (+ a stable SF Id the live flow must add — see §4) |
| NM side | `DIRECT / CO-BROKE`, `BROKER TEAM`, `CO-BROKE INTERNAL`, `REFERRAL` |
| Economics | `SALE PRICE`, `CAP RATE`, `DEAL COMMISSION`, `ASKING LIST PRICE`, `MARKETING CAP RATE` |
| Timing | `CLOSE DATE`, `LIST DATE`, `TIME ON MARKET DAYS`, `LEASE TERM REMAINING`, `LEASE TERM YEARS` |
| Location | `CITY`, `STATE`, `CBSA TITLE` |
| Asset | `TENANT`, `BUILDING SF`, `PROPERTY TYPE`, `PROPERTY USE`, `SPECIFIC USE`, `LAND OWNERSHIP`, `LAND ACRES`, `SALE CONDITIONS`, `ELA` |
| Counterparties | `SELLER COMPANY/ENTITY/ORG TYPE`, `BUYER COMPANY/CONTACT/STATE/ORG TYPE` |

**Authoritative NM-listed rule (Scott-confirmed):** a deal is Northmarq iff NM
held the **LISTING** — `DIRECT / CO-BROKE ∈ {'Direct (Both)', 'Co-Broke
(Seller)'}` on a Northmarq broker team. Buy-side-only (`Co-Broke (Buyer)`) is NM
track record but **not** NM-listed; it is tagged `is_northmarq_buyside`
separately so the #20 listing-side cap chart is never polluted by buy-side caps.

**Identity for idempotency:** the `data.xlsx` Scott exported has **no SF record
Id** and contains report artifacts (a `Total` summary row, an `Applied filters:`
footer row). The live flow MUST include the Opportunity `Id` (§4) so the ingest
can upsert idempotently and re-derive the flag from scratch each run.

---

## 3. The multi-strategy classifier (Task 2) — `api/_shared/sf-nm-classifier.js`

Scott's integrity constraint: SF is entered by many people, so **no single field
is trusted**. Every membership test OR's several independent signals and reports
which fired; multi-tenant tenant strings (joined by `| / , & +`) are split and
**each** tenant is matched.

- `classifyVertical(deal)` → dia / gov / null, with `signals[]` + `operators[]`.
  - **dia** signals: named operator in any tenant token (`DIALYSIS_OPERATORS`
    dictionary — DaVita/Total Renal Care/RTC, Fresenius/FMC/Bio-Med, US Renal
    Care, American Renal, Satellite, DCI, Liberty, …), `property_use=Dialysis`,
    operator/keyword in deal name, linked `dia_property_id`.
  - **gov** signals: `is_government` flag, agency pattern in tenant/deal/seller
    (`GOV_AGENCY_PATTERNS` — GSA/SSA/DHS/VA/FBI/USPS/courts/State-County-City-of…),
    gov lease-number format (`GOV_LEASE_NUMBER_PATTERNS`), linked `gov_property_id`.
  - **Inclusive-dia resolution:** a named dialysis operator wins even when a gov
    signal also fires (a fed building that also houses a clinic → dia, with gov
    membership still reported). A *generic-only* dia keyword defers to a strong
    gov signal.
- `classifyNmListing(deal)` → `is_northmarq`, `is_northmarq_buyside`,
  `listing_role`, `nm_team_source`. A **missing** team does NOT demote a
  listing-side deal (the export is the NM closed-won universe; `Direct/Co-Broke`
  already encodes NM's side); only a positively-external team marker demotes.
- `isExcludedFromComps(deal)` → drops referral/advisory/fee/portfolio rows and
  rows with no closed sale price (Task 4 pre-filter).
- `classifyDeal(raw)` → the merged verdict the ingest + dry-run both record,
  tagged `is_northmarq_source='salesforce'`.

The dictionaries are exported constants — **maintain them here**, not inline at
call sites. Add a new operator/agency by extending the arrays + a unit test.

---

## 4. The Power Automate flow contract (Task 6a — Scott builds to this)

`POST <SF_BULK_WEBHOOK_URL>` (a NEW signed PA HTTP-trigger URL; treat as secret —
mirror `SF_LOOKUP_WEBHOOK_URL`'s handling). Cadence: weekly. Body is the SF
closed-won universe, one object per deal, modeled on the `data.xlsx` columns
**plus a stable SF Id**:

```jsonc
{
  "operation": "sync_nm_deals",
  "generated_at": "2026-06-08T00:00:00Z",
  "deals": [
    {
      "sf_id": "0068W00000jee5VQAQ",      // REQUIRED — Opportunity Id, idempotency key
      "deal_name": "DaVita Dialysis - Auburn - WA",
      "city": "Auburn", "state": "WA", "cbsa": "Seattle-Tacoma-Bellevue",
      "tenant": "DaVita Dialysis",         // multi-tenant: join with " | "
      "building_sf": 11500,
      "broker_team": "Team Briggs",
      "ela": "Y",
      "direct_co_broke": "Co-Broke (Seller)",
      "referral": "No Referral",
      "co_broke_internal": false,
      "sale_price": 7120503, "deal_commission": 105307.55, "cap_rate": 6.35,
      "property_type": "Healthcare", "property_use": "Dialysis", "specific_use": null,
      "land_ownership": "Fee Simple", "land_acres": 1.25,
      "list_date": "2023-11-16", "asking_list_price": null,
      "marketing_cap_rate": 5.85, "lease_term_remaining": 13.1, "lease_term_years": 15,
      "time_on_market_days": 585, "sale_conditions": "Standard Deal",
      "seller_company": "DaVita Healthcare", "seller_org_type": "Owner/User",
      "buyer_company": "Venpri Investments", "buyer_contact_name": "…",
      "buyer_state": "WA", "buyer_org_type": "Owner/User",
      "close_date": "2025-06-23",

      // OPTIONAL but valuable — strengthen the classifier when SF carries them:
      "is_government": false,               // SF "Is Government" (when set)
      "lease_number": null,                 // gov lease id (GS-…) when present
      "property_subtype": "Dialysis"        // SF subtype (when set)
    }
  ]
}
```

Field names accept both this snake_case form **and** the human `data.xlsx`
headers — `normalizeDealRow()` resolves both (case-insensitive, prefix match, so
truncated headers like `DIRECT / CO-BROKE` work). The flow should send the
**whole** closed-won universe (not a subtype filter) so LCC classifies our way.

PA success response: `{ "ok": true, "received": <n>, "batch_id": "…" }`.

---

## 5. LCC ingest → classify → match → flag (Task 6b — CC, gated on §4 + Scott)

On each push, idempotently (re-derive `is_northmarq` from scratch every run so a
corrected SF row propagates):

1. **Stage** each deal on `sf_id` (upsert) — reuse `sf_comps_staging` if its
   shape fits, else a sibling `sf_nm_deal_staging` table.
2. **Classify** via `classifyDeal()` → vertical + NM-listed + comp/exclude.
3. **Match** each NM-listed comp to our domain sales: `state` + `close_date`
   ±120d + `sold_price` ±6% (the established tolerant gate), city fallback for
   thin matches. (Same fingerprint as the existing sale matchers.)
4. **Re-derive the flag** per vertical:
   - **add** `is_northmarq=true` on matched deals the CRM says are NM-listed,
   - **remove** `is_northmarq=true` on deals the CRM does **not** attribute to
     NM-listing,
   - tag `is_northmarq_source='salesforce'`.
5. **Log** adds/removes to `sf_sync_log`; surface per-run counts.

**Gate:** the dry-run plan JSON (§6) → Scott verifies → flag-column writes only.
No price/term/cap writes.

---

## 6. Task-3 dry-run numbers (validated against `data.xlsx`, 285 rows)

`node scripts/sf-nm-dryrun.mjs sf_export.csv` over Scott's dialysis SF export:

| Bucket | Count | Reconciliation |
|---|---|---|
| Total data rows | 284 | (1 `Total` footer row classified as unclassified) |
| Vertical: **dia** | 283 | `PROPERTY USE=Dialysis` + operator tenants |
| Vertical: gov / unclassified | 0 / 1 | (the report `Total` row) |
| **NM-listed** (`is_northmarq`) | **234** | = 159 `Co-Broke (Seller)` + 75 `Direct (Both)` ✓ |
| Buy-side only (`is_northmarq_buyside`) | 47 | = 47 `Co-Broke (Buyer)` ✓ |
| Neither | 3 | NULL `Direct/Co-Broke` |
| Real single-asset comps | 262 | |
| Excluded non-comps | 22 | 21 null sale price + 1 `Referral` keyword |

This tracks the spot-check context (≈240 listing-side; ~14 referral/fee of the
missing-from-DB set). The cap-rate averages over a SINGLE SF file are ~equal
(6.64 vs 6.65) **by construction** — both cohorts are SF NM deals. The real #20
spread is **SF-NM caps vs the broad-DB market caps**, which is Task 5 and needs
the live DB (the deck is built on curated comps; our broad-DB caps run ~48bps
low). See §7.

---

## 7. Remaining gated slices (NOT yet applied)

| Task | What | Gate |
|---|---|---|
| **3 (commit)** | Apply the add/remove flag plan per vertical | Scott verifies the §6 plan + the live-DB match dry-run (30-row add/remove samples) |
| **5** | #20 cap basis: compute `cm_{gov,dia}_nm_vs_market` on the **curated-comp** cap basis (master/SF-confirmed cap where present, else `sold_cap_rate`) so the chart reproduces the deck's ~50-72bps spread (recommended option A); keep the 2yr TTM window | Live DB; Scott's A/B call |
| **4** | Stage the ≈26 dia (+gov) NM-listed deals that fingerprint-match nothing in the DB as an import candidate set; report count + $ volume | Separate gated mini-round AFTER the flag fix; drop referral/advisory/fee/portfolio (already filtered by `isExcludedFromComps`) |
| **6a** | Build the PA flow to §4 | Scott (has PA access) |
| **6b** | Wire the staging table + ingest endpoint (sub-route of `admin.js`/`intake.js` — 12-function limit) consuming the classifier | After §4 + Task-3 blessing |
| **6c** | dia listing_date backfill for the ~222 NULL-date + future-off_market rows; find & stop the writer stamping a future `off_market_date` on undated rows; re-verify `cm_dialysis_market_turnover_m` | Live DB dry-run → Scott; audit gov for the same pattern |

**Ship-now exception (Scott):** the gov #20 clean-flag commit (already validated
to 6.79% ≈ deck 6.78%) can ship ahead of the full SF wiring. The dia
master-only re-derivation **must NOT** ship (it regressed dia to 7.29%); dia
waits for the SF-authoritative set above.
