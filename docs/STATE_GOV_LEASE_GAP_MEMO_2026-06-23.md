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

### Proposed insertion point (to be confirmed when we start)

- **Option A (preferred): consolidate into `gsa_leases`** — add `government_level`
  (`Federal|State|Municipal`), `source_system` (`GSA|TFC|CA_SPI|…`), `state_lease_id`; reuse the
  existing 4-tier `gsa_property_matcher`. One lease table, one matching pipeline.
- **Option B: parallel `state_lease_inventory` table** — isolated, per-state ingest, same matcher.
- New module(s) following `ingest_gsa_historical.py` shape: `ingest_state_leases.py` /
  `ingest_texas_tfc.py` (Excel/ManagePath export), then CA SPI (open data) as the second state.
- Field mapping (TFC → gov): Agency→`agency` (+ `government_type` via classifier), Lessor→
  recorded/true owner + `contacts` (we already capture lessor email/phone — high BD value),
  Start/End→lease term, Agency SF→`sf_leased`, County/Zip→location.

### Work checklist — Topic 2

- [ ] Decide Option A vs B (recommend A) and write the schema migration (discriminator columns).
- [x] Strengthen the gov-side State classifier (`agency_enrichment_rules`) to match the Topic-1
      vocabulary — `government-lease/sql/20260623_gov_state_agency_classifier_expansion.sql`
      (additive, idempotent, evidence-tagged). Adds a Municipal `school district` rule (priority 31)
      + a State program-name rule (priority 41); scoped tighter than LCC so it can't steal a federal
      record (`comptroller`→`comptroller of public accounts|state comptroller`; wildlife drops
      `service`). **Applied live to the gov DB (`scknotsqkcheojiaewwh`) 2026-06-23 + VERIFY pass:
      32/32** — all 22 TX agencies (NULL → `State`), federal → `Federal`, municipal incl. Dallas ISD
      → `Municipal`, private (Macy's/Nordstrom/Workforce Housing) → `NULL`. Baseline before apply:
      all 16 spot-checked TX agencies were NULL.
- [ ] Build `ingest_texas_tfc.py` (parse the TFC Agency Report shape) → properties/leases/owners/
      contacts; idempotent (MD5 dedupe), logs to `run_log`/`ingestion_tracker` per project rules.
- [ ] Run the 4-tier matcher over the new state leases; confirm `government_type='State'` lands and
      investment scoring assigns State=4 (the tier becomes live, not dead).
- [ ] Confirm the lessor contact (name/email/phone) flows to `contacts` for BD/outreach.
- [ ] Decide cadence/recurrence for state feeds (TFC has no open API → manual export drop vs
      scheduled; CA SPI is open data → scheduled).
- [ ] (Stretch) second state — California SPI — to prove the module generalizes.

**Status: NOT STARTED**

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

### Work checklist — Topic 3

- [ ] Scott decides (a) vs (b). Record the decision here.
- [ ] If (b): design `sf_deal_staging` → `sales_transactions` promotion (gated by `lcc_merge_field`,
      fill-blanks, never clobber a curated/CoStar comp; idempotent on `sf_deal_id`).
- [ ] If (b): add state-aware vertical routing in `sf-config.ts` so state deals route to `gov`.
- [ ] If (a): document the decision + ensure Topics 1/2 carry the full burden (no silent reliance
      on SF).

**Status: NOT STARTED · awaiting decision**

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
