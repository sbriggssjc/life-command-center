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

## 3.5 The already-staged universe (`sf_deal_staging`) — verified state 2026-06-08

The hourly `SF → LCC: Object Sync` PA flow already lands closed deals in
`public.sf_deal_staging` on **both** domain projects (dia
`zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`). Each row carries parsed
columns + the full SF record in `raw_row` jsonb. SF API field map (confirmed
live, all present):

| concept | `raw_row->>'…'` |
|---|---|
| NM side | `Direct_Co_Broke_sjc__c` (Direct (Both)/Co-Broke (Seller)=listed; Co-Broke (Buyer)=buy-side) |
| NM team | `SJC_Broker_Team_Name_sjc__c` → `SJC_Broker_Team_sjc__c` → `Broker_Name__c` |
| tenant (multi) | `Tenant_Names_sjc__c` / `Tenants_sjc__c` (`|`-joined) |
| subtype/type | `Property_Type_Subtype__c` / `Property_Type_Sub_Type__c`, `Property_Type__c` |
| price / cap | `Sale_Price_Report_sjc__c` / `Final_Sale_Price__c`; `Closing_Cap_Rate_sjc__c`/`Deal_Cap_Rate__c` |
| loc / date | `City_sjc__c`/`State_sjc__c`; `Close_Date_sjc__c`/`CloseDate` |
| **SF id** | `sf_deal_id` (staging col) — the idempotency key the export lacked |

⚠️ **`Agency_sjc__c` is NOT a gov signal** — it is the listing-agreement type
("Exclusive"/"Non-Exclusive"). Gov membership uses `GOV_AGENCY_PATTERNS` on
tenant/name/seller.

### 3.5.1 The staged universe is NOT yet a fuller superset (the R74b blocker)

Re-derivation cannot run authoritatively on the staged data **today**:

- **dia**: 3,320 `'Closed IS'` rows = **only 61 distinct deals** (each staged
  40–208×, avg 54×). Incl. `'Final'` → **79 distinct closed deals / 57
  NM-listed**. Scott's `data.xlsx` export had **285 closed / 234 NM-listed** —
  so staging is a ~28% **subset**, not a superset.
- **gov**: 2,747 rows = **66 distinct deals** (34 closed). Same pattern.
- The staged NM-listed set fingerprint-matched **88 already-flagged** dia sales
  and yielded **0 city-confirmed and 0 post-cutoff net-new adds**; the 55 loose
  "candidates" were wrong-city false matches (several to *competitor*-listed
  sales — `M&M; Glass`, `Colliers; Patel`). A full re-derivation would have
  **removed ~348 of 436** correctly-flagged sales (only 88 matched). **Verdict:
  do not re-derive from the staged subset** — the R74 `data.xlsx`-based fix
  (+96/−34, applied 2026-06-08) remains the best available state.

### 3.6 Change specs — trustworthy staged loop

**(A) Get Deals filter — broaden the closed-stage set (PA-side, Scott applies).**
dia closed deals historically carry **`'CM - Closed IS'`** (per the `data.xlsx`
footer: *"STAGENAME is CM - Closed IS or Closed IS"*) — a label that does **not**
exist in staging at all (staging has only `'Closed IS'`/`'Final'`). In the PA
flow's *Get Deals* (SF connector / SOQL) step, change the filter from
`StageName eq 'Closed IS'` to:

```
StageName IN ('Closed IS', 'CM - Closed IS', 'Final')
```

Reconcile the exact label set against the complete unfiltered export (gov uses
both `'Closed IS'` and `'Final'`; `'CM - Closed IS'` is the dia historical
label). The filter is **additive + watermark-gated**, so it only pulls
newly-modified deals — the **historical closed book needs a one-time backfill**
(reset/clear the watermark for one full pull). This backfill is the real
prerequisite for the staged loop to drive dia de-contamination, *not* a deferred
long-tail.

**(B) Staging duplication — APPLIED (mitigation) + the permanent fix.**
Root cause: the edge fn `supabase/functions/intake-salesforce/index.ts` *already*
upserts, but on `on_conflict=(sfIdColumn, source_system, import_batch)`. Because
`import_batch` is unique per hourly run, the conflict key never matches across
runs → every run INSERTs a fresh row (dia 7,222 rows / 142 distinct; gov 2,747 /
66; all four `sf_*_staging` tables affected — comp peaked at 23,688/221).

- **Applied live 2026-06-08** (the `sf_sync_log`-precedent disk-safety fix,
  reversible, no edge-fn/sync risk): `public.sf_staging_dedup_prune()` +
  autovacuum hardening + cron **`sf-staging-dedup-prune`** (hourly :17) on **dia
  + gov**. One-time reclaim: ~56k → ~662 rows on dia (~99%), similar on gov.
  Migrations `…/dialysis/20260608210000_*` + `…/government/20260608210000_*`.
- **Permanent fix (coordinated deploy — drops the prune's reason to exist):**
  remove `import_batch` from the conflict key. Verified safe: `import_batch` is
  otherwise only used by `linkProbe` (by-batch lookup — survives, since the
  merge-update sets `import_batch` to the latest run) and the `processed` flag
  (not in the upsert payload → unchanged on merge). Two coordinated steps,
  **deploy order: migration FIRST, edge fn immediately after** (between them the
  old edge fn's 3-col upsert errors on the new 2-col index — one hourly run, then
  it recovers):
  1. Migration (dia + gov): `sf_staging_dedup_prune()` then
     `DROP INDEX uq_sf_deal_staging_dedup; CREATE UNIQUE INDEX
     uq_sf_deal_staging_dedup ON sf_deal_staging (sf_deal_id, source_system);`
     (repeat per `sf_*_staging` table on its `(sf_<obj>_id, source_system)`).
  2. Edge fn `index.ts` (two occurrences, ~L182 + ~L389):
     `const onConflict = ` `${cfg.sfIdColumn},source_system,import_batch`
     → `${cfg.sfIdColumn},source_system` ; deploy to whichever project hosts
     `intake-salesforce`.

**(C) Matcher needs city/address confirmation.** Even once the universe is
complete, the tolerant state+price+date gate over-matches badly on clustered
dialysis (0/55 city-confirmed in the 2026-06-08 staged run). The live re-derivation
must require a city (or address) match for an auto-add, exactly as the
`data.xlsx` Task-3 fix did (city-confirmed adds only).

**Staging-sourced de-contamination dry-run (wired now).**
`scripts/sf-nm-decontam-dryrun.mjs --domain dia|gov --out plan.json` reads the
deduped closed deals straight from `sf_deal_staging` (via the SF field map
`mapStagingRawRow` + the durable classifier — no manual export step), matches
the NM-listed comps to `sales_transactions` (state + close_date ±120d +
sold_price ±6%, **city-confirmed adds only**), and emits the add/remove plan:
ADD = city-confirmed + not flagged, REMOVE = flagged + no NM match + explicit
competitor broker (`isCompetitorBroker`), HOLD = null/personal-broker removes +
SJC/NM-broker removes (`isNorthmarqListingBroker`, keep flagged) +
non-city-confirmed adds + Task-4 no-match. Read-only (env carries
`DIA_/GOV_SUPABASE_URL` + `…_SERVICE_KEY`). Once the §3.6(A) filter + backfill
land the complete deduped set, this resolves the held buckets against
authoritative CRM data → dry-run → Scott's gate → commit. **Until then dia flags
stay at +96/−34 = 436 (no regression).**

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
