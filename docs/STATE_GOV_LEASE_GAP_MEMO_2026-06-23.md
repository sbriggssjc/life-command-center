# Gap Memo — State-Government Leased Property Falls Through the Cracks

> **Status:** OPEN · investigation complete, remediation not started
> **Opened:** 2026-06-23
> **Owner:** Scott + Claude/Cowork
> **Repos in scope:** `life-command-center` (LCC), `government-lease` (gov), `Dialysis` (reference only)
> **Trigger:** CoStar sidebar capture of a State-of-Texas leased sale returned `Pipeline error: no_domain`; the same deal (Northmarq-brokered) also never arrived via Salesforce.

This is a **living document.** Each topic below has a findings section (frozen evidence) and a
work checklist (updated as we go). We close the memo only when every checklist item is ticked
and the **Close-out audit** at the bottom passes. Append to the Changelog on every update.

---

## 0. The triggering case (the concrete example)

- **Property:** 22581 Mack Washington Ln (Part of a Portfolio Sale), Hempstead, TX 77445
- **CoStar:** Office, Waller County submarket; sold 2026-05-27; CompEntity/8727798
- **Tenant:** **"TX Health and Human Services"** — a **Texas STATE** agency (not federal)
- **Broker:** Northmarq — Brian D. Corriston, `bcorriston@northmarq.com`
- **LCC sidebar result:** property synced ("Found in LCC database" / "Property data synced from
  CoStar") **but** the domain pipeline logged **`Pipeline error: no_domain`** (twice). It was
  therefore not written/underwritten as a government asset.
- **Salesforce:** the deal was not present via the SF ingestion path either.

Three independent **"federal-only" assumptions** converge on this one capture. Each is a topic below.

---

## Topic 1 — CoStar sidebar domain classifier is federal-centric → `no_domain`

### Findings (evidence frozen 2026-06-23)

- **Root cause:** `classifyDomain()` in `api/_handlers/sidebar-pipeline.js:1197`. A capture is
  routed to `government` only when:
  1. `entityFields.asset_type === 'government_leased'` — CoStar tagged this **"Office"**, so no; **or**
  2. the assembled tenant/marketing text matches a regex in **`GOV_TENANT_PATTERNS`**
     (`api/_handlers/sidebar-pipeline.js:398`).
- **`GOV_TENANT_PATTERNS` is almost entirely FEDERAL** (GSA, VA, SSA, IRS, FBI, DEA, ICE, USCIS,
  FEMA, USDA, "department of", "bureau of", "office of", federal courts, USPS, etc.). State-agency
  program vocabulary is largely absent.
- **The exact tenant misses:** "TX Health and Human Services" matches **none** of the patterns.
  There is no rule for `human services`; `\bhealth\s+service\b` requires "health" immediately
  before "service" so "Health **and Human** Services" does not match.
- **Quantified impact** (tested live against the attached TFC "Agency Report",
  `ActiveLeaseSummaryReport.xls`, 1,179 leases / 32 distinct agencies):
  - **639 of 1,179 leases (54%) MISS** the classifier → would land `no_domain`.
  - Top missed agencies by lease count:

    | Missed agency | TX leases |
    |---|---:|
    | Health & Human Services Commission | 319 |
    | Texas Dept of Criminal Justice | 96 |
    | Parks and Wildlife Department | 50 |
    | Comptroller of Public Accounts | 45 |
    | Texas Comm. on Environmental Quality | 34 |
    | Texas Lottery Commission | 15 |
    | General Land Office | 15 |
    | Texas Dept. of Licensing & Regulation | 11 |
    | Railroad Commission | 9 |
    | (Animal Health, Soil & Water, Education Agency, Water Dev Board, Juvenile Justice, Securities Board, Workforce Commission, ABC, Housing…) | rest |

- **Three structural blind spots** behind the misses:
  1. No state-program vocabulary (`human services`, `wildlife`, `criminal justice`, `comptroller`,
     `workforce/lottery/railroad/utility commission`, `general land office`, …).
  2. Department only matches as `\bdepartment of\b` → trailing "…Department" (Parks and Wildlife
     Department) and the abbreviation "dept of" (Texas Dept of Criminal Justice) both miss.
  3. No state-abbreviation prefix awareness ("TX …").
- **Inconsistent, not uniformly broken** (why it went unnoticed): some TX agencies match by luck —
  "Department of Family and Protective Services" via `\bdepartment of\b`; "State Ofc of
  Administrative Hearings" via `\boffice of\b`.
- **Multi-domain note:** `classifyAllApplicableDomains()` (`:1315`) and `isTenantForDomain()`
  (`:1381`) share the same `GOV_TENANT_PATTERNS`, so fixing the pattern list propagates to the
  multi-domain and per-domain-tenant-filter paths too.

### Design constraints / guardrails

- Keep regexes anchored (`\b…\b`, `^…$` where appropriate) so legitimate private tenants are not
  false-positived into `government` — same discipline as the existing junk-value filters.
- Mirror the additions into the gov DB classifier (Topic 2, `agency_enrichment_rules` State tier)
  so the two classifiers agree (LCC routes the capture; gov assigns `government_type`).
- `government` is the correct LCC domain for state leases (LCC has only dia/gov/cre verticals);
  Federal-vs-State distinction is carried in the gov DB `government_type`, not in LCC routing.

### Work checklist — Topic 1

- [x] Extend `GOV_TENANT_PATTERNS` with state-program vocabulary + trailing/abbrev "department"
      + state-prefix coverage (anchored). — `api/_handlers/sidebar-pipeline.js:398` (+26 anchored
      patterns: `human services`, `dept of`, `comm(ission) on`, `criminal/juvenile justice`,
      `parks and wildlife`, `comptroller`, `environmental quality`, `lottery/railroad/workforce/
      historical commission`, `land office`, `securities/examiners/state board`, …). Scoped to
      avoid false positives (no bare `department`/`workforce`/`lottery`/`commission`).
- [x] Add a regression test — `test/gov-classifier-state.test.mjs` (5 cases: 22 state agencies →
      government; 6 already-covered still pass; 10 private/retail/multifamily tenants NOT gov incl.
      "Macy's Department Store", "Workforce Housing"; trigger case; all patterns anchored). Exported
      `classifyDomain` + `GOV_TENANT_PATTERNS` from the module for testing.
- [x] Re-run the 1,179-row TFC corpus — **miss-rate 54% (639) → 0% (0/1179).**
- [x] Confirm `node --check` clean, `ls api/*.js | wc -l` = 12, full suite green
      (**1356 pass / 0 fail / 6 skipped**).
- [ ] (Live, post-deploy) re-run the Hempstead capture → confirm it classifies `government`, not
      `no_domain`.

**Status: CODE COMPLETE · pending live post-deploy verification (Railway redeploy of merged `main`)**

> Note: gov-side mirror (`agency_enrichment_rules` State tier) shipped in the same pass to keep the
> two classifiers in agreement — see Topic 2 checklist (gov classifier item ticked). Pre-existing
> gov-classifier quirks surfaced while validating (NOT introduced here, NOT in scope): the base
> Federal rule's bare `national` token tiers "First National Bank" → Federal, and the spelled-out
> "Internal Revenue Service" relies on the `government_agencies` exact table rather than a
> `\mirs\M` token. Logged for a future federal-precision pass.

---

## Topic 2 — No state-government lease *inventory* feed (gov repo is federal-only)

### Findings (evidence frozen 2026-06-23)

- The gov DB **already supports** a State tier but **nothing feeds it** — confirmed in two layers:
  1. **Classifier exists, feeder doesn't.** `gov_classify_agency()`
     (`government-lease/sql/20260601_gov_type_3tier_classification.sql`) returns
     Federal/State/Municipal; `investment_scorer.py:134` scores State=4 / Municipal=3. The same
     migration's header states it plainly (lines 11-13):
     > *"Growing the state/municipal lines requires ingesting more state/local comps; there is
     > currently **NO state/municipal ingestion source** (FRPP/OPM are federal)."*
  2. **Every ingestion module is federal.** All 18 `government-lease/src/ingest_*.py` are GSA /
     FRPP / USASpending / SAM.gov / FRED / BLS / Census / OPM / USAJobs. No `ingest_state_*`.
- **`government_type` is reachable but effectively a dead enum** for State: the schema allows
  `('Federal','State','Municipal','Other')` (`sql/20260304_initial_schema.sql:40`), the ~38 State
  + ~25 Municipal sales that exist were hand-entered (Excel master) or captured ad-hoc
  (CoStar/LinkedIn/email) — never from a systematic inventory.
- **The gov-side State regex is also thin:** `…(department of (administration|family|protective|
  child support|corrections|revenue)|state properties|\mstate\M|…)` would still miss HHS
  Commission, Parks & Wildlife, Comptroller, Workforce Commission, etc. — same blind spots as
  Topic 1, must be fixed in lockstep.
- **`gsa_leases` has no state discriminator:** no `government_level` / `source_system` /
  `state_lease_id`; columns (`lease_number`, `field_office_name`, `lessor_name`) are GSA-shaped.
- **Already documented as an unbuilt integration:** `government-lease/DATABASE_CONNECTIVITY_AUDIT.md`
  (lines ~522-527) lists **Texas Facilities Commission** (700+ active leases, ~8.8M SF; no open
  download) and **California SPI** (`data.ca.gov`, open data, since 1988) as "Priority 15" — never
  built.

### The attached file IS the state analog of the federal feed

`ActiveLeaseSummaryReport.xls` (TFC "Agency Report", source app ManagePath, 2023-07-13) =
1,179 rows, columns: **Prop ID, Agency, Address, City, State, Zip, County, Agency SF, Start, End,
Space Utilization, Lessor, Contact First/Last Name, Lessor Email, Lessor Address/City/State/Zip,
Lessor Phone, Janitorial, Utilities**. This is the **state equivalent of the GSA lease inventory +
FRPP**: tenant (agency), premises, SF, lease term, **landlord/owner + direct contact**, expense
responsibility. It is exactly the recurring inventory the federal side has and the state side lacks.

### Schema decision — RESOLVED (refinement of Option A)

Grounding the live gov schema (2026-06-23) showed the existing tables already hold the TFC shape
with **no new tables and only one additive column** — so we write state inventory straight into the
Excel-"Ownership"-sheet path rather than routing through `gsa_leases` (which has no `agency` column
and is GSA-snapshot-shaped). The mapping:

| TFC Agency Report | gov table.column |
|---|---|
| Prop ID (building) | `properties` (one row/building) — `state_lease_id` + synthetic `lease_number='TFC-TX-<propid>'` |
| Agency (tenant) | `properties.agency` (primary = max SF) + `property_agencies` (one/agency — multi-tenant) + `leases.tenant_agency` |
| Address/City/State/Zip/County | `properties.*` |
| Agency SF | `properties.sf_leased` (building = Σ) + `property_agencies.sf_occupied` |
| Start / End | `leases.commencement_date`/`expiration_date`, `properties.lease_commencement`/`_expiration` |
| Lessor | `recorded_owners.name` → `properties.recorded_owner_id` |
| Contact name/email/phone/address | `contacts` (`contact_type='landlord'`, linked `recorded_owner_id`) — **high BD value** |
| — | `government_type='State'` (explicit; the classify trigger only fills NULLs so it isn't clobbered) |
| — | `data_source='tfc_state_inventory'` on every row |

`properties.lease_number` is UNIQUE → idempotent upsert; child tables are delete-then-insert scoped
to `(property_id, data_source)`. CA SPI / other states reuse the same transform with a per-state
column map.

### Work checklist — Topic 2

- [x] **Schema decision + migration** — resolved to the property-direct path (above). Only additive
      change: `properties.state_lease_id` + partial index
      (`government-lease/sql/20260623_gov_state_lease_inventory.sql`). **Applied live to the gov DB
      (`scknotsqkcheojiaewwh`) 2026-06-23.** Reversible (`DROP COLUMN`); no `gsa_leases` discriminator
      needed.
- [x] Strengthen the gov-side State classifier (`agency_enrichment_rules`) —
      `government-lease/sql/20260623_gov_state_agency_classifier_expansion.sql`; **applied live +
      VERIFY 32/32** (Topic-1 note). Municipal `school district` (p31) + State program rule (p41),
      scoped tighter than LCC (`comptroller`→`comptroller of public accounts|state comptroller`;
      wildlife drops `service`). Baseline before apply: all 16 spot-checked TX agencies NULL.
- [x] **Build `ingest_texas_tfc.py`** — `government-lease/src/ingest_texas_tfc.py`. PURE
      `transform_tfc(rows)` (groups by building, primary-by-SF, multi-agency, lessor→owner+contact,
      synthetic key, `government_type='State'`) + a thin idempotent writer (`ingest_tfc`, upsert on
      `lease_number`, child tables scope-replaced by `data_source`). `tests/unit/test_ingest_texas_tfc.py`
      (6 cases) **pass**. **Validated on the REAL file:** 1,179 rows → **725 buildings / 997
      agency-tenants / 549 distinct landlords / 553 lessor contacts (all w/ email)**; multi-agency
      building 01271 grouped its 3 agencies with the right primary.
- [~] **LIVE DRAIN (gate) — gated building DONE + verified live; full bulk via the module run.**
      Drove a gated 1-building drain (Prop ID 01021) into the gov DB via Supabase MCP and verified:
      `properties.property_id=32505`, `government_type='State'` (the classify trigger left the
      explicit value), `recorded_owner_id`→SVEA Industrial VI LLC, + 1 `property_agencies` row,
      1 `leases` row, and the landlord `contact` (Harry Kuper, email/phone, `contact_type='landlord'`,
      linked owner). The mechanism works against the real schema. The gated test **surfaced + fixed
      two writer bugs** (committed): `recorded_owners` has **no `data_source`** column and
      `contact_info` is **JSONB** (the writer now inserts owners as name/type/state via `NOT EXISTS`,
      not `upsert on name`). **The full 725-building bulk is NOT done via MCP** — ~3,800 rows ≈ 900KB
      of SQL (the owners batch alone is ~31K tokens) is impractical to push through the chat context;
      it must run from `ingest_tfc(<TFC file>)` on a workstation with gov creds + the file (streams via
      the DB client, no LLM in the loop). The writer + SQL are idempotent, so the gated row 32505
      coexists with the later full run. Still to wire: `start_ingestion_run`/`log_ingestion_error`
      into the live-drain step (writer currently returns a summary dict).
- [ ] After the drain: confirm investment scoring assigns **State=4** on the new rows (the dead enum
      goes live), and re-run the classifier backfill for any agency that landed `government_type` NULL.
- [ ] De-dupe new state buildings against existing rows by `normalized_address` (most won't exist —
      state is a new universe — but a few CoStar-captured state sales may already be present).
- [ ] Cadence/recurrence: TFC has no open API → manual export drop; CA SPI is open data → scheduled.
      Wire a state-inventory step into `run_pipeline.py`.
- [ ] (Stretch) second state — California SPI — to prove the transform generalizes.

**Status: ✅ COMPLETE · verified live 2026-06-23.** Full drain landed **725 State properties**
(725/725 `government_type='State'`, 725/725 linked to a landlord, 725/725 `state_lease_id`), **553
landlord contacts** (all linked), **997 agency-tenant rows**, **997 leases**. Live-drain hardening
took four passes (owner canonical-name dedupe; FK-safe contacts scope-replace; small per-row-trigger
batches) — the writer is now idempotent and re-runnable. Remaining (separate, non-blocking): State=4
investment-scoring confirm, address de-dupe vs federal book, run-logging wiring, cadence wiring,
CA SPI.

---

## Topic 3 — Salesforce ingestion is BD-only; it can't backstop a brokered deal as a comp

### Findings (evidence frozen 2026-06-23)

- **SF ingest is staging + BD, not a deal/comp feed.** `supabase/functions/intake-salesforce/`
  stages SF **Property / Comp / Listing / Deal(Opportunity)** rows into `sf_*_staging` and
  link-matches to existing properties by normalized address; `api/_handlers/sf-activity-ingest.js`
  mirrors SF Tasks/Events into `activity_events` to **advance cadences**.
- **No `sf_deal_staging` → `sales_transactions` path exists.** The "sf-promotion-worker" referenced
  in `intake-salesforce/index.ts` comments is **not present** in the repo. A staged Closed-Won
  Opportunity links to a property and stops there.
- **Sales rows are created only by 3 other paths:** CoStar sidebar capture (`sidebar-pipeline.js`
  `upsertDomainSales`), the R58/R59 deed parser (`processDeedDocument`), and the R53 Decision-Center
  suspected-sale verdict (`gov_confirm_suspected_sale`).
- **Consequence for the trigger case:** even though Northmarq brokered it, a SF Opportunity for this
  sale would stage + link but never become a comp. The only reason it exists in LCC is the CoStar
  sidebar capture — which then failed at **Topic 1**. So the deal had to survive *two* federal-only
  chokepoints and was stopped at the first.
- **Vertical routing in SF config is fine** (`sf-config.ts` gov signals: gsa/federal/government/
  department of/veterans/social security) — but it is also **federal-flavored**, so a state deal
  with no federal cue may mis-route to no/other vertical even within SF staging.

### Open decision (needs Scott)

SF is intentionally the BD/outreach layer. Two valid resolutions — **decide, don't drift**:
- **(a) Leave SF BD-only** and accept that CoStar + deeds + Decision-Center are the sole comp
  sources → then Topic 1 + Topic 2 are the single points of failure for state deals (so they must
  be robust).
- **(b) Close the loop:** add a promotion path (or reconcile) `sf_deal_staging` Closed-Won →
  `sales_transactions` so deals we brokered are captured as comps regardless of CoStar coverage.

### Decision — RESOLVED (Scott, 2026-06-23): **(b) close the loop**

> "We can ingest information from Salesforce, especially closed transactions. Those can absolutely
> populate in our databases and the LCC. We want it to be a source of information that populates our
> LCC universe, especially if it's new or confirmed information from elsewhere."

So SF becomes a **populating source**, not just a BD/outreach mirror: a staged closed (Closed-Won)
SF Opportunity → a `sales_transactions` comp in the right domain **+** the LCC BD spine
(entity/owner). Doctrine guardrails (mirror R51/R53/R59): fill-blanks / never clobber a curated or
CoStar comp; idempotent on `sf_deal_id`; gated through `lcc_merge_field`; a price is a fact only when
SF carries it (no fabrication).

### Grounding — RESOLVED (2026-06-23): the promotion worker EXISTS but stops short

Correcting the initial investigation: `supabase/functions/sf-promotion-worker/index.ts` **does
exist** and promotes property/comp/listing/**deal**. But for a **deal** it only `promoteEntity` →
resolves a `property_id` and merges deal FIELDS into a `deal_provenance` record via `lcc_merge_field`
— **it never inserts a `sales_transactions` row.** (Comp promotion writes to `comparable_sales` on
dia, also not `sales_transactions`.) So the precise missing piece for (b) is the **sales-row insert
from a Closed-Won deal**.

The staging row already carries everything needed (`intake-salesforce/sf-config.ts` `deal.parsed`,
confirmed against a real NorthMarq Opportunity 2026-05-15):
`deal_price` (sold price) · `expected_close_date` (`CloseDate` = the sale date for Closed-Won) ·
`buyer_company_name` / `seller_company_name` · `deal_cap_rate` / `noi` / `annual_rent` ·
`stage` (`StageName` → gate on Closed-Won) · property resolution via `sf_property_id` /
`linked_property_id` / `property_address`. Staging tables live in the **domain** DBs (gov/dia), not
LCC Opps. Vertical routing (`routeVertical`) keys on federal-flavored gov signals → a TX **state**
deal with no federal cue defaults to `dia` + review (the state-routing gap).

### Build plan (b) — concrete

1. **Sales-row promotion** (the headline): in `sf-promotion-worker` deal branch, when
   `stage` ∈ Closed-Won **and** a `property_id` resolved **and** `deal_price` + a close date are
   present → upsert a `sales_transactions` row (`sold_price`, `sale_date`=`expected_close_date`,
   `buyer`/`seller`, `data_source='salesforce_deal'`), **idempotent on a deterministic key tied to
   `sf_deal_id`**, **fill-blanks / never clobber** a CoStar/curated comp, gated through
   `lcc_merge_field`. The existing cap-rate trigger then derives the cap rate (gov §12 doctrine —
   don't trust the ingested `deal_cap_rate`). Env-flag gated for first-drain discipline.
2. **State-aware routing**: extend `routeVertical` so a state-agency cue (reuse the Topic-1 vocab)
   routes a deal to `gov` instead of defaulting `dia`.
3. **Surface into the LCC universe**: the resolved property + buyer/seller already flow to the BD
   spine via the existing entity/owner sync — confirm the new comp's buyer becomes/links an owner
   entity (it should, via the sales→listing-events + owner sync), so the deal "populates the LCC
   universe" per Scott's ask.

### Work checklist — Topic 3

- [x] Scott decides (a) vs (b) → **(b)** — SF as a populating source.
- [x] Ground the live `sf_deal_staging` shape + the promotion worker (worker exists; stops at
      `deal_provenance` field-merge; the sales-row insert is the gap; staging on gov/dia;
      state deals mis-route to `dia`). **See grounding above.**
- [ ] Build the Closed-Won `sf_deal_staging` → `sales_transactions` insert in `sf-promotion-worker`
      (gated by `lcc_merge_field`, fill-blanks, never clobber a curated/CoStar comp; idempotent on
      `sf_deal_id`; env-flag for first drain). Cap-rate derived by the trigger, not ingested.
- [ ] Add state-aware vertical routing in `sf-config.ts routeVertical` (reuse Topic-1 vocab) so state
      deals route to `gov`.
- [ ] Confirm the new comp's buyer/seller populates the LCC universe (entity/owner) — "new or
      confirmed" per Scott.
- [ ] Test (headless) + a gated live promotion of ONE real Closed-Won deal (fill-blanks, no-clobber,
      idempotent), same first-drain discipline as Topics 1/2.

**Status: ✅ BUILT (gated, awaiting Scott's migrations + drain) · 2026-06-23.** Closed-Won SF deals
→ domain `sales_transactions` comp now built + pushed (3 repos). New pure helper
`supabase/functions/_shared/sf-deal-promotion.ts` (`planDealSalePromotion`, single source of truth,
19 tests) drives `sf-promotion-worker`'s deal path to INSERT a sale; `sf-config.ts routeVertical`
gains state-gov cues (+`tenant_names`). Safety (all verified): env-gated **`SF_DEAL_SALE_PROMOTION`
default OFF** (field-merge-only until set); **idempotent** via additive `sf_deal_id text` + partial
unique index on gov + dia `sales_transactions` (migrations `sql/20260623_gov_sf_deal_sales_promotion.sql`,
`Dialysis/.../20260623_dia_sf_deal_sales_promotion.sql`); **never-clobber** (skips `curated_sale_exists`
within ±45d of a non-`salesforce_deal` comp); requires real `deal_price` ≥ $50k (no ask-price
fallback); **never writes cap rate** (the existing trigger derives it). New comp flows to the BD
spine via the existing `v_sales_transactions_portfolio` → `lcc_listing_events` sync (no new wiring).
Full suite 1381 pass; 12 api files. **Scott's runbook:** apply the 2 domain migrations → deploy the
edge function → set `SF_DEAL_SALE_PROMOTION` → capped gated drain (`?action=run`
`{object:'deal',vertical:'gov',limit:25}`, then dia) → verify ONE `salesforce_deal` sale/deal with a
trigger-derived cap rate, idempotent on re-run.

---

## Cross-cutting sequencing

1. **Topic 1 first** — smallest change, stops the live `no_domain` bleed immediately, reclaims ~54%
   of the TX book at the entry point. Mirror the vocabulary into Topic 2's gov classifier in the
   same pass so the two never diverge.
2. **Topic 2 next** — the structural fix: a real state inventory feed makes `government_type='State'`
   and the State scoring tier live, and turns the lessor contacts into BD signal.
3. **Topic 3** — a decision + (optionally) a promotion path; independent of 1/2 but determines
   whether SF is a backstop or strictly BD.

Shared invariant across all three: **no fabrication, fill-blanks, reversible, anchored regexes**, and
honest classification (surface `no_domain`/`State`, never guess).

---

## Close-out audit (the memo is DONE when all pass)

- [ ] Topic 1 checklist complete; live Hempstead capture classifies `government`.
- [ ] TFC corpus re-run: documented miss-rate ≪ 54% (record final number).
- [ ] Topic 2 checklist complete; ≥1 state inventory ingested; `government_type='State'` populated
      from a feed (not hand entry); State scoring tier exercised on real rows.
- [ ] Lessor contacts from the state feed present in `contacts`.
- [ ] Topic 3 decision recorded; if (b), promotion path verified idempotent + non-clobbering.
- [ ] gov-side `gov_classify_agency` and LCC `GOV_TENANT_PATTERNS` verified in agreement on the
      TFC agency list.
- [ ] All test suites green; `ls api/*.js | wc -l` = 12; migrations additive/idempotent.
- [ ] Changelog below reflects every step; no open TODOs.

---

## Changelog

- **2026-06-23** — Memo opened. Investigation complete across all three topics; evidence frozen,
  remediation not started. Quantified Topic-1 miss-rate at 54% of the TFC corpus (639/1,179).
  Confirmed Topic-2 gap independently (gov classifier migration self-documents "NO state/municipal
  ingestion source") and Topic-3 (no `sf_deal_staging`→`sales_transactions` path).
- **2026-06-23** — **Topic 1 code complete.** Extended LCC `GOV_TENANT_PATTERNS` (+27 anchored
  state-agency patterns) → TFC corpus miss-rate **54% → 0%**; added
  `test/gov-classifier-state.test.mjs` (exported `classifyDomain`/`GOV_TENANT_PATTERNS`); full suite
  1356 pass / 0 fail. **Topic 2 (partial):** mirrored the vocabulary into the gov-side classifier
  (`government-lease/sql/20260623_gov_state_agency_classifier_expansion.sql`, additive/idempotent;
  Municipal `school district` + State program rule) so LCC routing and gov `government_type` agree;
  validated all 22 TX agencies → `State` (regex emulation), live apply still pending. Surfaced two
  pre-existing federal-classifier quirks (bare `national`; spelled-out IRS) — out of scope, logged.
- **2026-06-23** — **Topic 1 gov-classifier APPLIED LIVE** to the gov DB (`scknotsqkcheojiaewwh`,
  PRs LCC #1301 / gov #306 merged + redeployed). VERIFY 32/32 (TX→State, federal→Federal,
  municipal→Municipal, private→NULL). Topic 1 closed except the post-deploy Hempstead re-capture
  (Scott's live UI test). **Follow-up for Topic 2:** existing gov-DB rows whose `agency` now
  classifies `State` but carry `government_type=NULL` should be re-run through the classifier
  backfill once a state inventory feed lands (no state rows in the DB today to backfill).
  Proceeding to Topic 2.
- **2026-06-23** — **Topic 2 schema + classifier live; ingest built + validated.** Resolved the
  schema decision to the property-direct path (existing Ownership-sheet tables, no new tables);
  added `properties.state_lease_id` (`government-lease/sql/20260623_gov_state_lease_inventory.sql`,
  applied live to gov DB). Mirrored the State classifier vocabulary into `agency_enrichment_rules`
  (applied live, VERIFY 32/32). Built `src/ingest_texas_tfc.py` (pure `transform_tfc` + thin
  idempotent writer) with `tests/unit/test_ingest_texas_tfc.py` (6 pass); validated the transform on
  the real TFC file → 725 buildings / 997 agency-tenants / 549 landlords / 553 lessor contacts. The
  **live drain** (write 725 State properties to the gov DB) is the remaining Topic-2 gate — needs gov
  creds + the TFC file in-repo / a workstation run.
- **2026-06-23** — **TFC gated live drain DONE + verified** (gov DB via MCP): building 01021 →
  property 32505, `government_type='State'` (trigger preserved), owner SVEA linked, +1 agency, +1
  lease, +1 landlord contact (Harry Kuper). Gated test surfaced + **fixed two module writer bugs**
  (`recorded_owners` has no `data_source`; `contact_info` is JSONB → owners now inserted via
  `NOT EXISTS` on name); tests still 6/6. Decision: the **full 725-building bulk is NOT pushed
  through chat-MCP** (~900KB SQL, owners batch alone ~31K tokens) — it runs from the idempotent
  `ingest_tfc()` module on a workstation (the gated row 32505 coexists via ON CONFLICT/NOT EXISTS).
  Topic 2 = schema + classifier live, ingest built/validated/gated-live; full bulk + run-logging is
  the workstation step.
- **2026-06-23** — **Topic 1 live-capture follow-up (CPS/APS):** Scott's Hempstead-portfolio
  recapture confirmed property 1 (TX Health and Human Services) → Government DB, but property 2
  (**Children's Protective Services**, Sherman TX) hit `Pipeline error: no_domain` — CPS/APS bare
  program names weren't covered. Added an anchored `(child|children's|adult|family) protective
  services` pattern to **both** the JS `GOV_TENANT_PATTERNS` (LCC PR #1301, fixes no_domain on
  Railway redeploy) **and** the gov `agency_enrichment_rules` (gov PR #306, applied live — sets
  `government_type='State'`). Verified: CPS/APS → State/government; HHS/DFPS unchanged; a private
  "Allied Protective Services" security firm correctly does NOT classify gov. Test 5/5. Scott
  re-captures Sherman after the Railway redeploy to confirm it routes to the Government DB.
- **2026-06-23** — **Topic 1 live-capture follow-up #2 (Parole):** Haltom City retail strip
  (3912 NE 28th St) with a *Parole Supervision* tenant (TX Dept of Criminal Justice, Parole
  Division) hit `no_domain`. Added `/\bparole\b/` to JS `GOV_TENANT_PATTERNS` (LCC) + a `\mparole\M`
  State rule to gov `agency_enrichment_rules` (applied live; gov PR #306). Anchored so "Parolee
  Apparel LLC" stays private. Test +2. Same recapture-after-deploy step as CPS.
- **2026-06-23** — **Topic 3 / Phase 3 BUILT** (gated) — see the Topic-3 status block above.
- **2026-06-23** — **TFC full-drain fix** (gov PR #306): the live full run hit `23505` on
  `uq_recorded_owners_canonical` — `recorded_owners` is unique on **`canonical_name`** (a
  normalized form), not `name`, so the name-based NOT-EXISTS guard missed owners colliding under a
  different spelling (`RKJ ENTERPRISES, LLC`). Mirrored the gov `compute_canonical_name` in Python
  (verified byte-identical to the DB on real TFC names) and now dedupe + link owners by
  `canonical_name`, preferring active (non-merged) rows. The aborted run wrote no owners/properties
  (atomic batch failed first); only the gated building 01021 exists — the re-run is idempotent. Scott
  re-runs `python -m src.ingest_texas_tfc "<file>"`.
- **2026-06-23** — **State engine Phase 3 BUILT** (gov repo): `state_lease_events` →
  `prospect_leads`. `lessor_change` → **suspected-sale** leads filtered through
  `state_norm_lessor_core` (c/o-strip + `gov_norm_owner_core`) so only GENUINE ownership transfers
  surface — c/o manager swaps / typos / legal-form variants are churn (no lead); `new_lease /
  relocated / expired / footprint_reduction` → leads; `renewed / removed / reappeared /
  agency_change` → consumed, no lead. SF-ranked (TFC carries no rent). Idempotent (dedupe by
  `(lead_source, lease_number)` + `state_lease_events.processed_at` watermark). Live first-diff =
  **114 lessor_changes → 92 genuine / 22 churn** (all 114 property-linked), routed. New (gov repo):
  `sql/20260623_gov_state_norm_lessor_core.sql`, `src/state_events_to_leads.py`,
  `tests/unit/test_state_events_to_leads.py`; wired into `run_pipeline` step 44. The
  `state_norm_lessor_core` function migration is applied + verified separately (NOT live this
  session). Phase 3b (surface state `lessor_change` in the LCC **R53** `v_suspected_sale`
  Decision-Center lane), rent-$-ranking, and Phase-2 dataset URLs are documented follow-ups, out of
  scope. See gov `docs/STATE_LEASE_INVENTORY_PIPELINE_PLAN.md` §8–§10.
