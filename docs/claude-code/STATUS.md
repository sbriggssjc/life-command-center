# Claude Code queue — STATUS

> **START HERE for the current state:** `docs/os/CURRENT-STATE.md` (what is LIVE / flag-gated OFF /
> PLANNED, plus the canonical-doc map). **Everything unbuilt-but-intended:**
> `docs/os/PLANNED-BACKLOG.md`. **Surfaces / comps engine / deploy mechanics:**
> `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`.
>
> **This file is the running work log, newest first.** It is *not* the state of the system — a block
> here was true on the day it was written and may since have been superseded (re-measure a dated
> blocker before quoting it; that doctrine has bitten this file repeatedly).
>
> **Archive:** entries for **2026-08-03 → 2026-08-12** (the comps arc prompts 19–60, the Wave 8
> hygiene campaign, the Wave 9 connectedness build-out, the ChatGPT/Copilot surface rollout, and the
> 2026-08-03 security/deploy-pending notes) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-03_to_2026-08-12.md`](../history/STATUS_claude-code_2026-08-03_to_2026-08-12.md)
> on 2026-08-26 (Prompt 141). Every still-open item from that range was carried into
> `PLANNED-BACKLOG.md`; nothing was dropped.

## 2026-08-29 — C6 SHIPPED: the seller-side bands now gate on current holding + reachability

**LIVE on LCC Opps.** Migration `supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql`;
evidence `docs/audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`; canonical
`docs/architecture/bd-ranking-and-priority-queue.md` (**§3 rewritten — the old gate is RETIRED**).

**All four predicted deltas hit exactly** (verified live off `v_priority_queue`, cache refreshed):
**P1 74→149 · P2 32→95 · P3 61→163 · P8 76→213 = 620 rows / 497 assets / 303 owners.**
P5 58 · P0.4 555 · P0.5 148 · P-CONTACT 231 · P-BUYER 22 · P4 12 and all dia held.
⏰ **All 14 owners with a gov lease inside 90 days who were contactable-and-invisible now appear.**

**Doc corrections made in this pass** — the canonical page had four passages that went stale the
moment C6 landed:

- **§3 presented the RETIRED role predicate as the live gate** and still said "observed P1 = 74".
  Rewritten to show what actually runs, with the old form kept beneath it, labelled retired.
- **The "73% data work" line used the pre-C6 denominator.** It is **934 of 1,646 (57%)** now —
  ⚠️ and **both numerator and denominator moved**, so the percentages are not comparable: the
  data-completion rows did not fall, **the deal-timing rows doubled underneath them.**
- **"1,924 owners are invisible / 224 contactable" was present tense.** Past-tensed; the reachable
  half is closed, and ⚠️ **the unreachable ~1,700 remain invisible DELIBERATELY** (P112) — they are
  a contact-acquisition backlog, not a queue backlog.
- **Broker denominator** 14 of 1,267 → **14 of 1,646**.

⚠️ **New fact worth acting on: C6 cleared `gov_owner_props` only. Four `effective_owner_role = ANY`
predicates remain** (counted live off `pg_get_viewdef`) — the two-value form still gates **P0.4 +
P0.5 + P5 = 761 of 1,646 rows**, P4 uses a three-value form. **A gate arm that has never matched a
row still governs 46% of the surface** (C4b, re-sized from cosmetic to real).

⚠️ **C6 also made C4c the binding constraint:** +377 deal-timing rows, **none carrying an owner**.
## 2026-08-29 — B6d: the feed expectations are graded, and two "mis-sized SLAs" are real outages

Closes the **B6a → B6a-follow-up → B6b → B6b-lead** arc.
[`docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md`](../audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md).
Backlog **B6d** (+ **B6d-cms**, **B6d-sam**). Applied live to gov, dia and LCC Opps; every committed
function body and all 25 registry rows verified byte-identical to live by md5.

**Open `feed_stale` 4 → 2, and both survivors are genuine breaks.** All 25 feeds now carry a
`cadence_class` and either a bound with a mandatory `expectation_basis` or **no bound with a mandatory
`unwatched_reason`** — CHECK-enforced, so a round number with no reasoning can no longer be added.

- ⚠️ **THE POPULATION IS 25, NOT 23.** LCC Opps has its own registry (`om_intake`, `salesforce_sync`),
  evaluated by the same check through its `lcc_local` arm and invisible to a count taken from the
  domain databases. **Enumerate every registry that feeds the monitor.**
- ⚠️ **RULE 3c HELD TWICE — and this is the finding.** Both alerts the brief read as mis-sized SLAs
  are ingestion outages. dia **`medicare_clinics`**: p50 gap 2d and a **max gap ever of 41d**, so the
  45d bound was never the problem — **27 failed + 6 abandoned** CMS runs since the last success
  2026-06-25, while `dataset_modified_date` reads **2026-08-25**. gov **`sam_lease_opportunities`**:
  re-scoped 14 → 21 **and deliberately left violated at 33d**; the weekly producer is healthy
  (`usajobs`, same workflow, landed 2026-08-24) and the SAM call returns **401 Unauthorized**.
  ⚠️ That 401 is **not** §18's rate limit (different key, different endpoint) — and §18's own
  *"the 401 is not real"* correction is exactly what makes a real 401 easy to dismiss.
- ⚠️ **MEASURING A FEED'S OWN GAPS IS CIRCULAR ONCE IT HAS BEEN DEAD.** An outage is a CLOSED gap and
  enters its own distribution: `gsa_lease_change_facts` has 2 dates and one 170d gap — *the outage B6b
  repaired* — so 3×p90 derives a **510-day** bound. **B6a's p90 rule does not transfer from steps to
  feeds** (a dead step's gap never closes; a dead feed's does). Lifetime windows also mix eras
  (`usajobs` p90 31.8 over life, 7 in the scheduled era). Primary basis = the **declared** schedule;
  below three gaps the verdict is `cannot_be_sized_from_data`, recorded rather than dressed up.
- ⚠️ **THE GSA FAMILY IS FOUR FEEDS, ONE PUBLISHER, AND CARRIED FOUR BOUNDS** (65/35/45/45) — three
  below the publication cycle's own peak. Publication is monthly with a **21–51d lag**, so peak data
  age is ~82d: snapshot **65 → 90**, derived trio **→ 75** (pinned by a guard). It was **6 days from
  firing** on a healthy feed, with `consecutive_unchanged=3` proving GSA has not published August, and
  `gsa_lease_events` **would have fired 2026-09-10** — its cadence changed on 2026-08-10 when the
  fingerprint dedupe began skipping, and its bound had not. **`gsa_source_pull` stays tight at 21**:
  *did WE stop pulling* is a different question, with a different owner, from *is GSA publishing*.
- ⚠️ **`opm_workforce` 120 → 200 because 120 was UNMEETABLE by the process that feeds it** — data is
  74–75d old *at the moment of a successful manual import* and the one observed import interval is
  119d. It fired three times in three months, every one closed "expected".
- ⚠️ **RETIRING AN EXPECTATION MADE ITS ALERT PERMANENT, and it was already live.** The auto-resolve
  arm requires the feed to be PRESENT, so a retired feed's alert can never close — exactly what
  B6c-dup's `is_active = false` did to `property_sale_events` earlier the same day. Fixed with **B6a's
  own lesson one layer up: an unwatched feed EMITS**, with a NULL bound as a *positive* statement, and
  a resolve arm keyed on that — **never on absence**, which also covers a feed whose query errored or
  whose mirror went blind. The residual is **counted as `alerts_orphaned`, never auto-resolved**.
- **Controls (rolled back):** opm@199d → 0 alerts, opm@205d → 1, gsa@95d → 1, unwatched@1800d → 0,
  orphan counter → 1 named. Guards: LCC 7 tests **12/12 mutations RED**, gov 8 tests **12/12 RED**;
  full LCC suite **4,855 tests, 0 fail**.
- ⚠️ **Both guards first passed a mutation they were written to catch** — a whole-body grep for a
  literal (`feed_mirror_stale`) and for a predicate (the 3-day exclusion) that each legitimately appear
  more than once, which is **B6c-dup's own documented lesson, reproduced in guards written after it**.
  And **comment-stripping was not enough**: B6d stores each retirement's reasoning in a *column*, and
  `property_sale_events`' reason quotes `is_active = false` — so the gov guard failed on itself until
  it also blanked **string literals**. The A5c/N18 defect one level deeper.
- **Housekeeping:** the pre-existing backlog id **B6d was renamed B6h** (the `parcel_owner_xref`
  divergence consumer, unbuilt and doc-only) — this round's id was already inside `expectation_basis`
  values on three live databases, so it was the cheaper rename. Pointers in `STATUS`, `I6` and the
  backlog updated.
- **NOT done, deliberately:** no producer started, stopped or altered. The two real breaks are filed
  (**B6d-cms**, **B6d-sam**), not fixed — fixing them here would blur which change moved which number.
- ⚠️ **FOLLOW-UP, and it is this round's own theme turned on itself: a REVIEW BOT caught a security
  claim B6d asserted without positive-controlling it.** `REVOKE EXECUTE … FROM anon, authenticated`
  on `compute_feed_cadence` was a **no-op** — Postgres grants EXECUTE on a newly created FUNCTION to
  **PUBLIC** by default, so both roles still reached the SECURITY DEFINER function that runs dynamic
  full-table scans. Measured live *after* the "fix" shipped: `proacl = {=X/postgres, …}` (the leading
  `=X` IS the PUBLIC grant) and `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` on gov and
  dia. Fixed by `REVOKE … FROM PUBLIC`; verified false after. **A VIEW takes no default PUBLIC
  grant**, which is why the view half of the same migration WAS effective. **Assert a privilege with
  `has_function_privilege()`, never by reading the REVOKE you just wrote** — it was one query away,
  and four artifacts (migration comment, audit doc, backlog row, guard) repeated it unverified.
  ⚠️ Not generalisable: `compute_feed_freshness` keeps its `anon` grant BY DESIGN (the cross-DB pull
  reads `v_feed_freshness` as anon); the gov guard now pins that asymmetry in both directions.

## 2026-08-28 — CONSOLIDATION: BD ranking gets a canonical page

**Docs only.** New canonical page **`docs/architecture/bd-ranking-and-priority-queue.md`** — one
door into **C4 → C5 → C6**, following the `tier0-owner-contact-system.md` pattern. It carries: where
this sits in Scott's chain (hops 6–7), the band table, the gate and its exact reconciliation, the
role-column distribution, the two defects, the C6 build with predicted deltas, **the four traps**,
broker assignment, and a decisions table separating what is decided / open / **refused**.

Wired in: `connectivity-and-open-threads.md` §0 canonical-pages table (now **four**, not three) and
banners on §4o/§4p marking them the dated evidence · `CURRENT-STATE.md` canonical-doc map ·
`DOCUMENTATION-MAP.md` subsystem example · **a canonical-page banner in both C4 and C5 audits**
(a trap list is only a guard if it is on the path someone walks).

⚠️ **The page states DIAGNOSED, NOT BUILT** in three places. Nothing in C4/C5 touched a live system.

## 2026-08-28 — C5b answered; C6 build prompt written (still nothing written to live systems)

Closes **C5b** and corrects C5 §5's "narrower" framing. Prompt:
`docs/claude-code/prompts/C6-per-asset-band-eligibility-with-reachability.md`. Backlog **C6**.

- ⚠️ **The per-asset fix is better founded than widening to `unknown` but NOT narrower on its own:**
  all five bands, all roles = **4,506 rows / 3,622 owners — a 20× flood.**
- **P5 `aged_building_value_add` is 83% of it** (58 → 1,681) and is the weakest signal in the set.
  ⚠️ **`aged_props` is NOT gov-scoped** — no `source_domain` filter, so **P5 covers dia** (26 → 565).
  Touching it is a cross-domain change; nothing in this arc has been. **P5 keeps the role gate.**
- **The design that works — per-asset PLUS the P112 reachability precondition, P1/P2/P3/P8 only:**
  **P1 74→149 · P2 32→95 · P3 62→163 · P8 76→213 = 244 → 497 rows / 303 owners.** ~2×, not 14×,
  and every emitted row is callable. **Reachability is what converts a flood into a call list.**
## 2026-08-29 — B6b-lead: the lead lane was graded, funnelled, and deliberately NOT restarted

**Diagnosis only. Nothing written to `ownership_history`, `prospect_leads`, or any gov table.**
Writeup: `docs/audits/B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`. Backlog **B6b-lead**;
contract **I4**; connectivity **§4q**; gov `CLAUDE.md` **§21a**.

**🛑 The restart was not taken, and the reason is not the one the prompt anticipated.** It set a stop
condition on the gate (*if `is_same_owner` cannot separate a re-spelling from a sale, stop*). **The
gate passed** — 91.80% agreement with the alnum-key reference over all 16,492 rows, erring
conservative (it suppresses 9,146 vs the reference's 7,940). What failed is the premise in §0:

- **⚠️ THE LANE HAS NO HUMAN CONSUMER.** All 7,729 `ownership_change` leads: `assigned_to` **0**,
  `last_contacted_at` **0**, `next_action` **0**, `sf_lead_id` **0**; `sf_sync_status` `'pending'`
  for every one; only `new` and `filtered_multi_tenant` have ever appeared in `pipeline_status`.
  The three numbers that justified the restart reproduce **exactly** and are all mislabelled —
  *2,041 worked* is an automated exclusion filter, *208 pushed to Salesforce* is `sf_contact_id`
  (a matched existing contact), *2,149 touched in 30d* is **1,216 of them on one day**. A5 and P119
  landing together on the one lane whose liveness nobody re-checked because it was already
  "verified." Per the Consumption-Layer rule, a producer with no consumer does not get restarted.
- **⚠️ 59% of that evidence is another lane's.** `route_to_pipeline` hard-codes
  `lead_source='ownership_change'` for every row regardless of `data_source`: only **3,199** leads
  trace to `gsa_lease_diff`, **4,530** to `county_deed`. **That is why the badge never went quiet
  when the lane died.** Its input today is 4,369 rows with **zero** `gsa_lease_diff` — 2,776 are
  B5's sale-derived transitions from the day before. It also reads `ownership_history`, not the
  events, so **the lead lane is downstream of the ownership-fact write** and "restart the leads
  without writing facts" is impossible as coded.
- **⚠️ Both top-2 would-write rows by value are false acquisitions** — `LCOR` → `LCOR ALEXANDRIA`
  at **$75.4M** (arm 3's `length > 5` guard blocks short sponsor names) and a `JPMORGAN` → `MORGAN`
  truncation at $26.3M. An agreement rate is not a safety property when errors sit at the top of the
  ranking. `normalize_entity` also mangles names via unanchored `str.replace` (`ACME CORPORATION` →
  `ACMEORATION`; live: `ALACHUA,UNTY OF`, `GRAHAMMPANIES`), order-dependently.
- **Blast radius 584 / 568 properties / $433.4M — the backlog's 10,635 is 18× too high** (it counted
  usable events without applying the gate or the dedup). Only **42** arrived since the lane died;
  **158 (27.1%)** clear the $500k floor. ✅ **B5a's fill-forward guard is live and decisive** —
  without it this restart would have nulled recorded owners on up to 568 properties.
- **Sequenced recommendation:** 👤 **Scott decides retire-vs-restart first** (nobody has worked one
  of these 7,729 leads) → fix the provenance laundering → fix the three gate defects → then restart
  value-gated at 584 rows. **B6e stays a genuine prerequisite.**
- **Guard shipped (gov):** `tests/unit/test_changed_fields_jsonb_probe.py` — 14 tests, **9 mutations
  RED**, pinning the Class-11 jsonb-string trap (`changed_fields ? 'k'` → a silent 0 of 233,666)
  that produced two published wrong findings. ⚠️ One assertion **passed its own mutation** on the
  first pass and had to be re-anchored on the comment-ONLY case; and `#` cannot be stripped naively
  in Python because `#>>` is the operator the guard looks for.
- **Suite:** gov 936 pass / 10 fail — the 10 are **pre-existing** in `test_sos_detail_fetcher.py`
  (922 pass / same 10 fail without this change) and are sandbox dependency-version artifacts, not
  touched by this work.

## 2026-08-28 — C5: 224 owners callable today, and the `buyer` exclusion is the larger half (diagnosis only)

**NOTHING WRITTEN.** Audit:
[`docs/audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md);
canonical **§4p**. Answers **C4e**; adds **C5/C5a/C5b**.

- **1,924 owners hold a current gov property with a P1/P2/P3 signal and are invisible to the queue**
  — 1,052 `buyer`, 871 `unknown`. **224 are contactable today.**
  ⚠️ **C4's "56 contactable" was P1-only and `unknown`-only** — easily misread as the total. **224.**
- ⚠️ **C4e answered: the `buyer` exclusion is a CATEGORY ERROR, not a bad label. 578 owners /
  $410.4M** — bigger than the `unknown` half. Boyd Watterson (45 gov assets), Prologis, RMR,
  HC Government Realty Trust are all correctly typed `buyer` **and** are the current owner of a
  building whose lease is expiring. `owner_role` is a party-level identity; the bands ask a
  per-asset question — **and the CTE already joined `is_current=true`, then discarded it.**
- ⚠️ **Firing the band is not choosing the pitch** — acquisitions vs disposition are different
  contacts and tones (`account-based-contact-intelligence.md`). The bucket stays C4a.
- ⏰ **173 owners have a gov lease expiring within 90 days and are on no surface; 14 contactable.**
  **Boyd Watterson is 2026-08-31 — three days out.** ⚠️ **Not verified whether that lease is
  renewing, extended or terminal — the attributes row carries a date, not an outcome.**
- **The names are the ones the Tier 0 arc already resolved** — Boyd, Easterly, NGP, RMR, Gardner
  Tanenbaum, GI Partners. The contacts were confirmed, the signal existed, and **the role gate sat
  between them.**
- **Recommendation shifts:** the **per-asset fix (C5)** is narrower and better founded than widening
  to `unknown` — no new classifier, no doctrine call. Still pair with the P112 reachability
  precondition.

## 2026-08-29 — B6c-dup: the two sale stores disagreed about which is canonical (SHIPPED)

Full writeup: [`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`](../audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md) ·
connectivity **§4p** · contract **I1**.

**Decision, in writing: `sales_transactions` is the canonical comps spine; `property_sale_events` is
a capture surface that propagates into it.** 77 of 77 gov views that read a sale store read the
spine (all 30 `cm_gov*` CM views); zero read PSE. `detail.js` said the opposite in its own comments
— corrected at 4 sites, each `B6c-dup`-marked with the old wording quoted.

**The leak was real, confirmed behaviourally** (one rolled-back INSERT: PSE +1, spine **+0**,
`latest_sale_price` set). Shipped `trg_gov_pse_propagate_to_sale` — AFTER INSERT on PSE, the single
owner of that transition, keyed `(property, YEAR-MONTH, price-to-$1k)`, fill-blanks, ledgered
(`gov_pse_propagation_log`), kill-switched, batch-reversible; `field_source_priority` @5.
Also: `B6c-feed` **retired** (not resolved) — the expectation moved to feed `sales_transactions`,
which has an actual cadence.

⚠️ **THE DAMAGE WAS ZERO AND ALL THREE PRIOR ORPHAN FIGURES WERE WRONG — 330/$4.48B, 9/$558.8M, and
my own first re-measure of 6/$29.2M. The true count is 0.** Three lessons, in order of how much they
would have cost:

1. **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated**
   for its dominant source (`costar_sidebar` 87.4% day-1). Re-keyed on `(property, YEAR-MONTH)`:
   **0 of 1,694**, positive-controlled at 1,694. ⚠️ `dedup_natural_key` already stated that
   granularity. **Run the neighbouring key before believing an anti-join.**
2. **`property_id IS NULL` ≠ dangling** — dangling is 0 and impossible under
   `fk_pse_property … ON DELETE SET NULL`. ⚠️ I reproduced the brief's error first: **a
   `LEFT JOIN … WHERE prop_live=false` lumps NULL in with dangling.**
3. **`transaction_state` was never read.** The "$529.6M invisible" is **quarantine**
   (`needs_review` / `duplicate_superseded`, `exclude_from_market_metrics=true`). The spine is
   complete: 1,687 live twins, 7 quarantined, 0 absent.

⚠️ **The first propagator filtered its twin lookup to `transaction_state='live'` and would have
resurrected those quarantined comps as live CM rows.** Caught by the live probe, one pass before it
mattered. **A filter that narrows a lookup to the rows you want to ACT on hides the rows that should
STOP you** (the A5c mint/probe asymmetry).

⚠️ **A complete downstream store is not evidence that propagation exists** — gov's spine held every
priced event because both bulk importers wrote both tables independently, not because anything
connected them.

Guards: `test/b6cdup-sale-store-canonical.test.mjs` (5 tests, 5/5 mutations RED) — ⚠️ **the one guard
here that cannot strip comments, because the defect IS a comment**; resolved by proximity to an
annotated correction. `tests/unit/test_b6cdup_pse_propagation.py` (gov, 11 tests, 12/12 RED) —
⚠️ **one assertion passed its own mutation** (it grepped a predicate that also appears in an
`ORDER BY`) and was re-anchored on the branch. LCC suite 4,833 pass / 0 fail.

**Not done, by design:** no backfill (nothing to backfill) · the 376 unlinked events untouched
(`B6c-orphan` re-scoped) · the 7 quarantined twins untouched · **dia not ported** — it is 72:2, not
77:0, and has real PSE consumers (`B6c-dup-dia`).

## 2026-08-28 — C4 §5 self-correction: widening the BD gate admits 2,521, not 62,554 (diagnosis only)

**NOTHING WRITTEN.** Same-day follow-up to the C4 entry below, sizing the decision it left to Scott.
New Dead-End **Class 23**. Backlog **C4a** rewritten, **C4e** added.

⚠️ **The C4 audit's own §5 warning was wrong by 25× and is corrected in place.** It said widening
`gov_owner_props`'s role gate to `unknown` admits **62,554 entities** — "every junk name, every SPE
husk." The CTE **already joins** `lcc_entity_portfolio_facts` (current, gov) and
`lcc_property_attributes`, which bound the population to **2,521**, of which **3** are placeholder
or brokerage names. **The predicted flood does not exist.**

- **Class 23 — a predicate's blast radius belongs to the QUERY, not the column it names.** Reading
  the `WHERE` and reaching for the column's fleet-wide distribution skips the JOINs above it.
  ⚠️ An overstated blast radius fails **as a refusal**: it reads as caution, gets written down, and
  is quoted as a reason not to ship. **Wrong-and-cautious is not a safe default.**
- **Sizing:** widening produces P1 **74 → 553**, P2 **32 → 242**, P3 **62 → 414**, **997 distinct
  owners**. The P1 delta is 479 rows / **449 owners / $148.0M**, named rows reading as genuine gov
  landlords (`1101 WILSON OWNER, LLC`, `131 SOUTH DEARBORN LLC`).
- ⚠️ **The binding constraint is REACHABILITY, not noise — only 56 of 449 (12.5%) are contactable**,
  39 have a cadence. Widening alone emits ~393 owners nobody can call: the documented **P112**
  failure. **Recommendation is sequencing, not refusal** — gate the widening on the reachability
  precondition the cadence engine already applies; the 56 are actionable day one.
- **Newly visible:** **`buyer` is 2,432 reachable entities**, excluded deliberately and never
  re-examined (**C4e**); an `operator` role exists (2 entities).

## 2026-08-28 — C4: the ranked call list measured for the first time (diagnosis only)

**NOTHING WRITTEN — no migration, no flag, no cron.** Audit:
[`docs/audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](../audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md);
canonical **§4o** of `docs/architecture/connectivity-and-open-threads.md`; backlog **C4/C4a–C4d**;
new Dead-End **Class 22**.

⚠️ **Numbered C4, not C3** — `C3` is already a C1-lane doctrine row in `PLANNED-BACKLOG.md`.

This closes the last hop of Scott's chain (the ranked call list) after the T1 + T2a mints took gov
asset coverage to 57.8% and resolved owners to 5,992. **Cache freshness was ruled out first.**

- **The gate is one column.** Every gov deal-timing band (P1/P2/P3/P8) reads `gov_owner_props`,
  filtered `effective_owner_role IN ('developer','user_owner')`. It reconciles **to the row**:
  1,216 candidate gov facts → **74** after the role predicate = the observed P1 count. Not value-,
  cadence- or opportunity-gated.
- ⚠️ **`user_owner` is 0 of 66,874 live entities** — half the gate has never matched anything, and
  a gate arm that never matches is indistinguishable from one that is absent (**Class 22**).
  `developer` is 715 (1.07%) from a classifier that is **exhausted, not broken** (285 rows lifetime,
  2 candidates left). `unknown` is **62,554 (93.5%)**.
- **Only 256 of 5,992 resolved owners (4.3%)** reach the queue; **931 of 1,267 rows (73%)** are
  data-completion work rather than calls.
- ⚠️ That classifier is the **N18 view** — which N18 found was ranked arbitrarily, not knowing it
  sits upstream of the entire ranked call list.
- **Broker assignment is 48 of 2,301 cadences (~2%).** The obvious fix is the documented
  three-user-table FK trap; go through `lcc_cadence_point_person()`.
- 👤 **C4a is Scott's and it is doctrine, not code:** what recorded evidence promotes an owner out
  of `unknown`. ⚠️ Widening the gate to `unknown` admits 62,554 entities and is refused;
  a name-based role classifier is refused (~25%/7% measured precision in this arc).

**Cleanup in this change:** two same-round C3-named drafts deleted; connectivity §0 index, the
audit evidence trail, and the playbook updated in the same commit.

## 2026-08-28 — Cross-lane property identity contract and build queue documented (design only)

**DOCUMENTATION ONLY — nothing activated, migrated, promoted, or written to live systems.** Canonical design:
[`docs/architecture/property-identity-and-address-resolution.md`](../architecture/property-identity-and-address-resolution.md).
Backlog: **PI1–PI8** in `docs/os/PLANNED-BACKLOG.md` P10a. The ASC integration contract now names
the shared dependency without authorizing extraction or adoption.

The restricted frozen ASC sample established that repeated capture failures are a platform class, not just
bad strings: suite/floor versus parent building, shared campuses, suffix/directional/locality/range variants,
compound street spacing, historical frozen-token drift, explicit tenant corroboration, valid source
missingness, stale sidebar candidate state, and ambiguous database-function output. The new contract turns
those aggregate lessons into a versioned match hierarchy, structured decision object, rule lifecycle,
de-identified golden corpus, sidebar diagnostics, shadow evaluation, governed alias-ledger design, and
aggregate quality measures.

**Boundaries preserved:** no private candidate rows, source payloads, run IDs, or licensed evidence entered
Git; no full-universe ingestion, canonical promotion, Salesforce write, outreach, opportunity creation,
unattended licensed-source scraping, evidence deletion, or IDTF activation. An on-box model is advisory only
and can never decide or write identity. **Next gate:** finish the frozen 50-property sample, review its
aggregate outcomes, then separately decide whether PI2/PI3 (corpus + pure matcher) should begin.



## 2026-08-28 — B6c: `property_sale_events` — answered, and deliberately not repaired

**Diagnosis only. No migration, no column dropped, no type changed.** Writeup:
`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`. The brief said to answer *"does this table
have a consumer"* **before** fixing the `bigint`/`uuid` link columns §4j found. Answer: **the table
does, the two link columns do not, and the audit found something that outranks both.**

**The three verdicts.** The **table is load-bearing — keep it**: 6 live gov triggers (close-listing,
propagate-sale-to-`properties`, cap-rate snapshot), the LCC detail panel's *declared canonical write
target* (2 write paths), read+write allowlisted on both domains. **`ownership_history_id` has ZERO
readers anywhere** — 0 hits across **620 gov objects**, 0 across dia, 0 in `api/`; 0 of 5,208 gov
rows; **1.9% (52/2,730) on dia after four months**; no FK on either domain. Retyping it builds a link
nobody follows (**Class 2**) into a population that is **56% `ownership_change_stub*`**, the retired
circular source. **`sales_transaction_id` has exactly one reader, dia-only** (`fn_listing_close_if_sold`);
gov has none, and gov's own close-listing trigger does not want one — **held, not retyped**, because
if the two stores consolidate the column disappears rather than getting fixed.

**🚨 What outranks it (`B6c-dup`).** `detail.js` says in its own comments that `property_sale_events`
is canonical and `sales_transactions` is *"legacy, retired for write paths."* The database says the
opposite: **76 of 76** gov views that read a sale store read `sales_transactions` and **ZERO** read
`property_sale_events` (30 of them are the `cm_gov*` CM views). Nothing propagates PSE →
`sales_transactions`, though the reverse direction exists. **So a sale an operator types into the
property panel never reaches the comps spine** — already **6 real priced comps, up to $10.8M with cap
rates**, invisible to every chart in the book. PSE is also **92.6% duplicative** of
`sales_transactions` on exact `(property_id, sale_date)`. ⚠️ **Both stores are individually correct
with coherent consumers; nothing errors and no component test can see it, because it is a property
of the CONNECTION.**

**D2 swept all three projects** — 10 genuine defects, 3 low-severity, 5 accepted false positives;
SQL published as I3's detector (audit §7e), and I3's status row moves **❌ none → ⚠️ manual**. Two
refinements the sweep earned: **a declared FK is authoritative and Postgres already type-checks it**,
so only *unFK'd* columns need examining (`available_portfolios.portfolio_id` was a false positive on
exactly that basis); and **every genuinely mismatched undeclared column found is 0% populated** — a
column that cannot hold its value never gets one — so **triage by populated-ness before reading
names**, since a *populated* mismatch is nearly always an external vendor id or a uuid-as-text.

**⚠️ Three honest limits, stated rather than smoothed over.** (1) **LCC Opps' zero is BOUNDED** — 151
of 559 `_id` columns evaluated; the other 408 were **not examined**, so this is not "LCC is clean."
(2) **The `feed_stale` alert is to be re-scoped, not resolved** (`B6c-feed`): the bulk producer was
retired on purpose and the only live producer is an operator form with no cadence, so a 45-day
expectation alerts whenever nobody types a sale for six weeks and then sits open forever — the B6a
*"expectation nobody chose"* failure inside the freshness registry. (3) **Nothing was shipped, so
there is no guard** — when B6c-dup acts, the guard ships with it, and it must strip comments before
matching, because this audit quotes the broken predicate repeatedly (the N18/A5c lesson).

**Canonical docs updated in the same change:** `PLANNED-BACKLOG.md` (B6c ✅, D2 ✅, plus new
`B6c-dup` 🔴 / `B6c-oh` / `B6c-feed` / `D2-dia` / `D2-shape`), `data-coherence-invariants.md` (I3
body + detector row), `connectivity-and-open-threads.md` (**new §4l**, and the §4j bullet annotated
where its last sentence did not survive re-measurement).

## 2026-08-28 — B6b: the GSA landlord-change detector restarted (gov)

**Shipped.** `gsa_lease_change_facts` **356,291 → 374,257**, max snapshot **2026-02-01 → 2026-07-01**;
`gsa_lease_timeline` **16,471 → 16,779**, max **2025-12-01 → 2026-07-01**. **Both `feed_stale` alerts
AUTO-RESOLVED** — verified on the alert row (`resolved_note = 'Auto-resolved: feed refreshed within
SLA'`), not on a run log. Derivable backlog **5 → 0**; the re-run is a clean no-op. gov suite **921
pass / 1 skip**; 14 new tests, **13 mutations RED**. Writeup:
`docs/audits/B6b_GSA_LANDLORD_CHANGE_RESTART_2026-08-28.md`; migration
`government-lease/sql/20260828_gov_b6b_gsa_change_layer_from_snapshots.sql`; caller
`src/gsa_change_layer.py` wired into the existing Monday `gsa-sync` on **both** paths.

**What it cost / what it corrected.** Three premises in the brief were wrong and each correction
changed the build:

1. **The raw feed was never dead.** `gsa_source_pull_log` shows a pull on **2026-08-24** recording
   `skipped_duplicate` / `consecutive_unchanged=3` — GSA has not published past 2026-07-01, cadence
   measured at 28–31 days. A feed early in its cycle and a dead feed read identically from
   `max(snapshot_date)`; the ledger is the instrument.
2. **The derived layer read a DIFFERENT TABLE** — `gsa_inventory_snapshot_lines` (manual, frozen)
   vs `gsa_snapshots` (live). **Scheduling the old code unchanged would have derived nothing.**
   Repoint gated by a full-history digest (137 dates, 136 identical; 22,030 field-level pairs, 0
   diffs) positive-controlled at 6,223 diffs when mis-keyed — and it is **not a clean superset**:
   10 dates exist only in the manual panel, which a three-month sample had shown as clean.
3. **"Undiffed" ≠ "derivable."** 21 undiffed dates, **15 already SPANNED** by an existing diff.
   Deriving those double-observes conveyances — the A2b fan-out in the time dimension.

**Two traps worth carrying forward.** A **dry run cannot catch a write-time constraint**: one row in
17,966 (a `$1.00` placeholder rent corrected to `$10,418.00`, ratio 10,417 against `numeric(8,4)`)
aborted the batch after five clean dry runs. And the **client timed out while the work committed** —
verified by the row delta, never the return value.

**Deflated honestly:** raw **+1,336** → **+72 net-new conveyances / +63 properties** (18.6× on the
increment). ⚠️ Non-oscillating went **DOWN 47** — the new months supplied return legs, so more data
made the P138 guard stricter.

**Not done, named:** nothing fed to `ownership_history`; the `ownership_change` lead lane was **not**
restarted (**B6b-lead** — 10,635-row blast radius, no credentials to dry-run it, and its only gate is
a name heuristic). ⚠️ **B6's G3 row is REFUTED**: `gsa_lease_events` does carry lessor pairs (16,907
rows) — B6's zero came from `changed_fields ? 'key'` against a jsonb **string**. Also filed:
**B6b-june** (2026-06-01 is a merged snapshot of two source files, 7,919 leases vs a 7,348–7,495 norm).

## 2026-08-28 — C2h: the "silent feeder" was answering a different question. It is the sponsor↔SPE gap.

Evidence: [`C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md`](../audits/C2h_SPONSOR_SPE_NOT_A_FEEDER_DEFECT_2026-08-28.md);
canonical **§4n**. Diagnosis only — nothing written.

**C2g called these 79 "the genuine feeder defect." They are not a defect.** **All 79 properties are
resolved.** The feeder resolved the **SPE that holds title** — the correct recorded owner — while
the Salesforce person works for the **sponsor**. Both sides are right.

| SF person's employer *(a gov `true_owner`)* | LCC resolved owner *(title holder)* |
|---|---|
| **Avery Capital** | **AC** ORLANDO SPV LLC |
| **Ball Ventures** | **BV**GC PARCEL C, LLC |
| **Browman Development Co.** | **BDC** Livermore L.P. |
| **Carmel Partners** | **CP** VI Van Gordon, LLC |

**The SPE initials are the sponsor's initials.** Split: **69 sponsor↔SPE · 8 true duplicates · 2
probable.** Guards explained almost nothing — brokerage 2, placeholder 0, not-prospected 0.

### ⚠️ One column turned the diagnosis around, and the lesson generalises

`prop_resolved_to_someone` equalled `props_with_asset` on **all 79**. C2g's framing —
*"everything the feeder needs is present and it produced nothing"* — was wrong because it never
asked whether the property had resolved **to someone else**. **When a producer looks silent, check
whether it answered a DIFFERENT question before calling it silent.** That is a new variant of the
family this arc keeps meeting, and the fourth time a "silent producer" turned out to be working.

⚠️ Also: `lcc_looks_like_person` returned true for **40 of 79** and was used for nothing — it
carries the documented `CITY OF SALEM` / `BROOME COUNTY` false positive (A3/P196).

### The recommendation is to build NOTHING new

Two sponsor surfaces already exist and are **human-confirm by design** —
`lcc_owner_sponsor_domain` (P190) and `lcc_ownership_sponsor_family` (A3) — because A3 measured a
lexical sponsor detector at **~25% precision** raw and P196 at 4-of-6 even with three guards.
**A third detector is the normaliser drift this repo has paid for repeatedly.** Feed the 69 in as
candidates (**C2i**); they arrive with stronger evidence than either surface normally has, since the
sponsor is independently attested as a gov `true_owner` *and* carries Salesforce people.

### Real residue found while reading (C2j)

**`Casa De Chupita` → `Undisclosed` at confidence 0.57 — a placeholder won a resolution**, and
`lcc_is_placeholder_owner_name` does not list `Undisclosed`. **`Chiapelone Trust` → `BGC-Havasu
Project LLC by Newmark Knight Frank`** — brokerage pollution inside a resolved owner name (P116).
Two more at confidence 1.00 are unexplained and want individual reading.

## 2026-08-28 — C2b + C2g: the SF bridge self-healed, and both hypotheses for the residue were wrong

Evidence: [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](../audits/C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md)
· [`C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md`](../audits/C2g_UNRESOLVED_OWNER_ORGS_2026-08-28.md).
Canonical **§4l / §4m**. Measurement only — nothing written.

**The bridge doubled with no bridge code.** SF-linked people reaching a resolved property owner:
**669 (6.8%) → 1,486 (15.2%), +817**, purely because T1 + T2a built the far bank. C2 said the bridge
had *"no far bank"*; there are now 8,636 owner rows over 5,992 owners. **Diagnosis and remedy both
vindicated — and the lesson is to re-measure a downstream gap after fixing an upstream one, before
building anything for it.**

**⚠️ The residue is 91.5% NOT-AN-OWNER.** Of 7,646 still unconnected across 6,816 orgs, only **489
orgs / 652 people** are at companies that own properties in our domains. The rest are brokers,
vendors, tenants, lenders. **So Scott's opening figure — "8–10k Salesforce opportunities not
connected" — is, measured, ~652 people at 489 owner-orgs.**

### ⚠️ C2g: both leading hypotheses for those 489 were REFUTED

| hypothesis | measured | verdict |
|---|---|---|
| the **0.55 confidence gate** | **444 of 489 were NEVER a candidate** in `lcc_property_owner_evidence` | ❌ the gate never saw them |
| **P113 operator trap** | `true_owner_is_operator` = **0** across all 489 | ❌ |

They were the two documented causes closest to hand. The residue is three populations: **dia 248 of
271 have no property in the mirror**; **gov 74 of 222 have a property with no asset entity** (the
minting slice — *exactly* the 74 overlapping the T2b plan, reconciling with C2b's independent
count); **gov 79 of 222 have a property WITH an asset entity and still no evidence** ← the genuine
defect, filed as **C2h**. Join controlled first: 19,851 of 20,123 facts key correctly.

**T2b now has a THIRD independent reading against it** — contactability 3.7% (T2a), only 74 of 489
reachable (C2b), those same 74 the only slice of this residue (C2g). Safe, low-value, not run.
## 2026-08-28 — C2b: the Salesforce bridge SELF-HEALED, and the opening premise is retired

Evidence: [`C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md`](../audits/C2b_SALESFORCE_BRIDGE_SELF_HEALED_2026-08-28.md);
canonical **§4l**. Measurement only — nothing written.

**No bridge code was written and the bridge doubled.** Same query, two dates:

| | C2 (pre-mint) | **now** |
|---|---:|---:|
| SF-linked people reaching a **resolved property owner** | **669 (6.8%)** | **1,486 (15.2%)** |

**+817 people, +122%, purely because T1 + T2a built the far bank.** C2 said the bridge had *"no far
bank — only 4,065 property→owner rows for 32,289 properties"*; there are now **8,636 rows over 5,992
owners**. That is the cleanest confirmation in this arc that **hop 3 was the binding constraint** —
diagnosis and remedy both vindicated, and it argues for re-measuring a downstream gap after fixing an
upstream one **before** building anything for it.

### ⚠️ The residue is 91.5% NOT-AN-OWNER — and that retires the framing this whole thread opened with

Of the 7,646 still unconnected, across **6,816 distinct orgs**: only **489 orgs (7.2%) / 652 people
(8.5%)** are at companies that are property owners in our domains. The other **6,994 (91.5%)** are at
brokerages, vendors, tenants, lenders and counsel — edged to their employer by the `works_at`
Salesforce-account edge. **Their employers do not own our properties. No minting or reconcile will
connect them, and none should.**

**So Scott's opening figure — *"8–10k Salesforce opportunities… not yet connected"* — is, measured,
~652 people at 489 owner-orgs.** The rest are correctly unconnected. That is a much smaller and much
more actionable number than the one this topic started from.

### ⚠️ It settles T2b on a second, independent axis

Only **74 of the 489** unresolved owner-orgs appear in the T2b plan — **3.6%** of its 2,054 owners.
Combined with T2a's measured collapse in contactability to **3.7%** in that band, **T2b is weak on
two independently measured axes.** It stays *safe* (graph cost settled across 4,570 minted entities),
so it can be revisited if the ranked queue runs dry. **Recommendation: do not run it now.**

### The next question, deliberately undiagnosed

**415 of the 489 owner-orgs are NOT reachable by minting** — anchored, with SF people attached, and
still unresolved for some other reason. **That is a resolution gap, not an asset-identity gap — a
different lever from everything C2a–C2e pulled.** Filed as **C2g**, with candidates ranked and none
assumed: the `lcc_reconcile_property_owner` **0.55 confidence gate** (CLAUDE.md documents 876 assets
with evidence still reading "Unresolved"), a dia **operator** in the owner slot, or cross-domain
anchoring.

## 2026-08-28 — C2e-T2a MINTED: gov asset coverage 39.2% → 57.8%

Evidence: [`C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md`](../audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md);
canonical **§4k**. Batches `c2e_gov_eligible_t2a_20260828` + `c2e_t2a_evidence_20260828`, gov only.

| | C2a baseline | after T1 | **after T2a** |
|---|---:|---:|---:|
| **gov asset coverage** (of 13,837 non-archived) | 24.7% | 39.2% | **57.8%** |
| asset anchors, both domains | 5,096 | 7,147 | **9,717** |
| `lcc_property_owner` rows | 4,065 | 6,065 | **8,636** |
| **distinct resolved owner entities** | 2,768 | 3,743 | **5,992** |
| plan remaining | 6,811 | 4,811 | **2,241** |

**2,570 minted · 2,570 resolved an owner · 0 evidence-less · 0 orphans**, and the population
reproduced C2e §6 exactly *before* the write. Gates held **and were attributed** per the §4i rule —
merge candidates 5,194 → 5,194, `auto_mergeable` 3,006 → 3,006, drift 0 → 0, readings timestamped
seven minutes apart.

**The gate that starved the whole chain has now moved from 24.7% to 57.8% in two staged passes,
with the noise cost measured across 4,570 entities rather than assumed.**

### ⚠️ Predicted +44 duplicate groups, measured +46 — and chasing the 2-row gap found a real defect

`lcc_mint_gov_asset_entities` passes `lcc_normalize_entity_name(m.name)` as `canonical_name`, and
**the N15c `BEFORE INSERT` trigger overwrites it.** Only **2,497 of 2,570 (97.2%)** matched what the
function supplied. Re-running the prediction against the key actually **persisted** gives 46 exactly.

**The trigger is working as N15c intended — one writer for the dedup key.** But the argument inside
the mint is now **dead code that reads like the answer**, and it is what produced the wrong
prediction. **Durable rule: predict a canonical-key effect with the key the WRITER persists, not the
one the caller passes** — where a `BEFORE` trigger owns a derived column, the caller's argument is a
suggestion. Same family as P157/P182. Filed as **N15g** (cosmetic).

**This is also the value of predicting before measuring**: a +46 against no prediction reads as
"about right" and the defect stays hidden.

### ⚠️ Tier 0 moved +4, not the predicted ~+20 — a population signal, not a miss

Only **7.0%** of T2a's owners carry a second identity, against tranche one's 12.9%. **Resolving an
owner makes "who do we call there" askable; it does not manufacture a bench.**

### 👤 T2b — safe to run, low-value to run. No default taken.

2,241 properties / 2,054 owners. **The graph argument is settled** — T2b's predicted duplicate rate
(1.16%) is **lower than T2a's actual (1.79%)**, computed against the live post-T2a graph with the
corrected key. What remains is the **owner cliff**, exactly where C2a predicted: contactability
**21.3% → 17.2% → 3.7%**, known-beyond-gov 12.9% → 7.0% → **1.9%**. Cities, counties, DOTs,
corporate occupiers, private individuals. **A prospect-quality judgement, not a technical risk.**

## 2026-08-28 21:50 UTC — TIER0_AUTO_ATTACH: the flag was in the wrong place, and my doc made it a deadlock

**The dated verification came due and FAILED — then resolved.** Cron 241 fired at 06:55 UTC on both
08-27 and 08-28, `cron.job_run_details` said **succeeded** both times, and `tier0_auto` writes stayed
**0** with 9 auto cards waiting.

**Root cause: the flag lives in two places and only one is the gate.** Scott set
`TIER0_AUTO_ATTACH=true` as a **Railway environment variable**. The handler reads the
**`feature_flags_registry` TABLE** — `tier0-auto-attach-tick.js:208`,
`flagEnabled(await fetchFeatureFlag(FLAG))`. The env var did nothing.

**The tick's own run log is what proved it**, and it is the only durable record:

| ran | flag_enabled | auto_candidates | planned | attached |
|---|---|---:|---:|---:|
| 2026-08-28 06:55 | **false** | 9 | 9 | **0** |
| 2026-08-27 06:55 | **false** | 9 | 9 | **0** |

It found every card and planned every card, then was refused by the flag. ⚠️ **`net._http_response`
had already pruned** (~6-hour retention, P123) — 15 hours after the run there was no response body
left to read. **`cron.job_run_details` only ever tells you the POST succeeded.**

### ⚠️ And the documentation made it unresolvable — that part is mine

The canonical page said *"registry flips to `on` only after a tick reports `writes > 0`."* For a
**registry-gated** flag that is a **deadlock**: the tick cannot write until the registry says on, and
the policy said don't flip the registry until it writes. Written as a safety rule, it functioned as
a permanent off switch.

**Resolved: registry flipped to `on` 2026-08-28**, with the cause recorded in the flag's own notes.
Scott's intent had been unambiguous since 08-27 — the mechanism was wrong, not the decision. **The
next 06:55 run is the real test**: expect `active_source='tier0_auto'` 0 → 9, all reversible via
`lcc_tier0_confirm_log`. Recorded as trap **13** on the canonical page.

## 2026-08-28 — C2e-T2a drafted: tranche two, step one

**Prompt** → `prompts/C2e-T2a-tranche-two-step-one-2026-08-28.md`. **2,570 properties / 2,300
owners** at `owner_gov_rent >= 100000` — verified against `v_lcc_c2e_asset_mint_plan` (4,811 / 4,354
remaining, splitting 2,570/2,300 and 2,241/2,054 exactly as C2e §6 predicted). **17.2% already
contactable**, indistinguishable from tranche one's 21.3%, and it covers the whole $2M–$20M sweet
spot ($140k–$1.4M of rent at ~7% cap).

**The prompt front-loads what tranche one did NOT establish:** its cut landed at **$543,782 of owner
rent — entirely above the old $500k floor**, so it tested the safest population in the system and
exercised none of the low-rent tail. C2e measured tranche two as mildly worse (duplicate-group
formation 1.5× the rate), not catastrophically.

**Two attribution traps are written in explicitly**, both already hit in this arc: **`auto_mergeable`
has two threads moving it** (C2e's 3,038 → 3,005 was 64 merges from the other window, not the mint —
read `lcc_entity_merge_log` before attributing a delta), and **predict the duplicate-group delta
(~+38) before measuring, then reconcile it** rather than accepting a number that moves "about right".

**The step that must not be skipped:** drive `lcc_ingest_domain_owner_evidence` explicitly after the
mint. Cron 225 caps at 400/run daily, so a 2,570-row tranche would sit evidence-less for most of a
week — matching the retire predicate the eligible-set design exists to prevent.

**T2b is deliberately out of scope** and stays Scott's call; the prompt asks only what T2a's outcome
implies for it.
## 2026-08-28 — B6a-follow-up SHIPPED: the monitor went quiet at the moment it went blind

**LCC Opps LIVE + one dia grant.** Writeup:
`docs/audits/B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md`. Contract **I11** (now ✅ detector live),
playbook **Class 21**. **gov NOT touched.** Visibility only — the four producers are still dead (B6b).

- **Acceptance met, and it is a state delta, not a status.** `feeds_evaluated` **2 → 25**,
  `feeds_excluded_stale_mirror` **18 → 0**, mirror `synced_at` **33d (gov) / 30d (dia) stale → today**.
  **6 `feed_stale` alerts opened — all four B6a producers among them** (170/170/150/144d), plus dia
  `medicare_clinics` 64d and gov `sam_lease_opportunities` 32d. Re-run is idempotent (`new_alerts 0`).
- **⚠️ THE TRANSPORT WAS TWO UNRELATED CAUSES THREE DAYS APART, NOT ONE.** All 18 feeds froze in the
  same week, which reads like one bug in the shared pull. **gov** = a **marginal cold-cache statement
  timeout** — `500`/`57014` against `anon`'s **3 s** budget; warm the sweep is **231 ms**, but cold it
  measured **2,601 ms across just its top 8 feeds** and the 05:30 cron is the first touch of the day by
  construction. **Positive control: the identical request, same key — `500` cold at 17:41, `200` with
  all 18 feeds warm at 17:44.** **dia** = a **hard revoked `anon` EXECUTE** (`401`/`42501`). Fixing
  either alone leaves the other silent. **A `500` from a marginal cost is not a break — try it twice.**
- **⚠️ AND THE BRIEF'S OWN PREMISE WAS PARTLY REFUTED.** §2c said *"do not touch gov, its view is
  correct."* Its view **is** correct **and was not servable to the caller that reads it** — a different
  property, and the one that failed. gov is still untouched (mitigated LCC-side by a bounded retry),
  but *"the view is correct"* was not grounds to stop looking.
- **The exclusion was KEPT — deleting it is the wrong fix and worse than the bug** (the check would
  then alert on ages it explicitly cannot vouch for). What changed is that the excluded set became its
  own deduped, auto-resolving **`feed_mirror_stale`**, and `feeds_evaluated` /
  `feeds_excluded_stale_mirror` are now separate honest counts. **Both halves are pinned**, because
  each is a plausible "fix" for the other.
- **Three further silent paths closed alongside `(0,0)`:** a `RAISE NOTICE`-and-continue on a missing
  vault secret; a **`200` carrying an empty array** (the P157 shape — a status-code check passes while
  nothing arrives, so read the body); and a **`lost` class** — `net._http_response` prunes at **~6 h**
  while the inflight row lingered **24 h**, so a response arriving after finalize ran could **never** be
  consumed. *Ask what happens to a request that is neither answered nor answerable.*
- **The dia GRANT could not ship alone.** dia's registry ACL was `anon=arwdDxt`; `anon` EXECUTE on a
  **SECURITY DEFINER** function over a registry `anon` can write lets any anon caller repoint a feed at
  an arbitrary table — **the hole B6a closed on gov, still open on dia.** Both halves or neither.
- **⚠️ §2e sweep: this was the only one of ten `lcc_check_*` with the shape**, and
  `lcc_check_bd_sync_freshness` **already does it right** — it is the precedent this fix reuses rather
  than a new alert system. `lcc_check_cron_health` is the nearest neighbour and is covered by a
  *separate* sibling, so retiring that sibling would open the shape. Named, not fixed.
- **⚠️ Two self-inflicted traps worth carrying.** (1) `CREATE OR REPLACE` does not replace a function
  of different arity — all three signatures changed, and missing the `DROP` on
  `lcc_check_feed_freshness()` alone would have made cron 193 ambiguous (**42725**) and taken the hourly
  tick's **other three checks** down with it: a monitoring fix that silences monitoring. (2) plpgsql
  resolves an identifier to a **DECLAREd variable before a SQL alias**, so aliasing
  `net._http_response` as `r` beside `DECLARE r record` **plans fine and dies only when executed**
  (`55000`). Found by *running the function*; then the regexp fix **over-reached into the `FOR r IN`
  loop** and was caught by listing every affected line rather than trusting the substitution.
- **⚠️ Four of fifteen mutations left the test GREEN and had to be tightened** — `'lost'` also appears
  in a `FILTER`, the return columns are also *assigned* in the body, the watermark table is also named
  in an `ON CONFLICT` qualifier, and the mirror predicate also lives in the blind-spot scan. **A
  body-wide `includes()` is a weak assertion wherever the token recurs.** 17 tests, **15 mutations RED**.
- **⚠️ NOT fixed, read before quoting the monitor as healthy.** gov's timeout is **mitigated, not
  cured** — the first attempt each morning will still usually fail and the margin shrinks with every
  feed registered; watch `lcc_feed_freshness_sync_status.last_attempt_no` and raise **that**, never the
  retry cap (**B6a-follow-up-b**). The four producers remain dead (**B6b**, now unblocked — its premise
  was being able to tell whether a restart holds). And **B6a's `record_skip` has STILL not been
  exercised by a real run**: gov `run_log` carries **0 rows with `skip_reason` ever and 0 rows of any
  kind since B6a shipped** (newest 2026-08-27 18:52), so the RED producers prove the **registry** rows,
  not the emission fix. Until a run passes through, *no bad rows* and *no rows at all* read identically.


## 2026-08-28 — B6a SHIPPED: a skipped step emits nothing, and the health view was built on emitted rows

**gov DB LIVE + committed.** Writeup:
`docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`. Playbook **Class 21**, contract **I4**,
gov `CLAUDE.md` §16. **No producer was restarted — B6b owns that; only visibility moved.**

- **Acceptance met.** The four producers dead since March–April 2026 now read **RED**:
  `gsa_lease_change_facts` 170d · `gsa_lease_timeline` 170d · `prospect_leads.ownership_change` 150d ·
  `property_sale_events` 144d, against a 45-day SLA. Feeds 14 → 18, stale 1 → 5, **0 pre-existing rows
  changed in either direction**.
- **⚠️ THE REGISTRY THE PROMPT ASKED FOR ALREADY EXISTED, WIRED END TO END.** R56's
  `feed_freshness_registry` + `compute_feed_freshness()` + the LCC cross-DB mirror + a deduped,
  auto-resolving `lcc_health_alerts` row — and `feed_stale` has genuinely fired 8 times. It read
  healthy over four dead producers **because nobody registered them**. Three registries already
  existed; a fourth would have been the drift this repo warns about. **Check what you have before
  building.**
- **⚠️ "A SKIPPED STEP IS NO ROW" IS ONLY HALF THE MECHANISM, AND THE PRESCRIBED FIX WOULD HAVE MISSED
  THE LIVE INSTANCE.** `gsa_ingest_+_diff` was **not absent** from `v_pipeline_task_health` — it carried
  `status='ok'`, *"Task completed"*, **2026-06-22, 67 days stale**, on a step whose own history says it
  ran every 7 days. `status` read the last outcome's `event_type` and nothing compared it to when that
  outcome should have been superseded. So *"enumerate declared steps, not logged ones"* returns nothing
  for it: **the missing dimension is cadence, not enumeration.**
- **The evidence was inside the green row's own payload.** `find_latest_gsa_inventory` logged *"Task
  completed"* with **`result: null`, `duration_seconds: 0`** six weeks running; the view projected
  `details->>'error'` and never `details->>'result'`.
- **The fix is at the EMISSION POINT — and it dissolves the enumeration problem.** `record_skip` /
  `run_guarded_task` make **both branches of a guard write**, so the logged set IS the declared set and
  no step registry is needed. Five guard sites rewired. **`declared` has no default**: a skip somebody
  chose is healthy and must be visible without alerting; an undeclared skip is the finding. **Not
  emitted for scope selection.** `tasks_skipped` previously counted **dry runs** — split, and
  **`tasks_skipped_undeclared`** added as the number that means something.
- **⚠️ A PRODUCER IS NOT A TABLE.** A plain `prospect_leads` registry row stays **green** (0d — other
  lead sources are live) while its `ownership_change` lane is 150 days dead. Structured
  `filter_column`/`filter_value` through `%I`/`%L` (never free SQL — the function is `SECURITY
  DEFINER` and runs dynamic `EXECUTE`), both-or-neither CHECK. Also **revoked anon/authenticated
  write grants** on that config table (anon could repoint the function's targets or delete the
  registry); SELECT retained for the LCC pull.
- **The cadence statistic was measured, not chosen.** `is_overdue = age_days > 3 × the step's own p90
  inter-run gap`. **p90, not median** — clustered runs deflate the median and false-positive healthy
  monthly steps (`census_demographics` median 3.99d vs p90 28.78d; at 23d the median rule flags it,
  p90 does not). **NULL below 3 observed gaps**, never false.
- **Positive-controlled (§2a).** A healthy weekly step read not-overdue; **the same step silenced 60
  days read overdue**; declared and undeclared skips are distinguishable — all in a self-rolling-back
  transaction, **0 residue**. A hostile `filter_value` returns `no_data`, not everything. 23 tests,
  **18 mutations verified RED** (two guards were caught blind by the mutation run and strengthened);
  comments and docstrings stripped before matching, positive-controlled.
- **⚠️ FOUND, NAMED, NOT FIXED — the instrument one level up is blind.** The cross-DB freshness monitor
  has evaluated **no gov or dia feed since 2026-07-26**. Crons 140/141 fire daily and record
  `succeeded`; the mirror's `synced_at` is stuck; `lcc_finalize_feed_freshness` consumes only
  `status_code = 200` and **silently drops anything else**, returning `(0,0)`; and
  `lcc_check_feed_freshness` **excludes mirror rows older than 3 days**, so it evaluates zero feeds and
  returns `stale: []`. **When the sync stops, the check stops checking and reports nothing wrong.**
  Live proof: gov reads a stale feed today with **no open `feed_stale` alert**. So B6a's four RED
  producers **will not reach an alert until this is fixed** — backlog **B6a-follow-up**.
- **Also named, not fixed:** 10 `step_NN_*` steps of `src/run_pipeline.py` now read overdue at 121–150
  days (true — CI runs `pipeline_runner`, not that orchestrator); and **the GSA skip is documented in
  `ci.yml` and compensated by the weekly `gsa-sync` job**, so it is a genuine instance of the class but
  was **not** the load-bearing cause of the four-producer blindness — that was B6 §8(a) plus the fact
  that no instrument watched those four tables.


## 2026-08-28 — B5 SHIPPED: gov's sales table becomes ownership history (+ a destructive trigger fixed)

**gov DB LIVE. LCC JS pending a Railway deploy.** Writeup:
`docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`.

- **The feeder.** gov had never consumed `sales_transactions` as ownership history — 169 of 9,515
  named, dated sellers (1.8%). `gov_feed_sales_transitions` (dry-run default, batch-reversible) wrote
  **2,776 transitions over 2,000 properties**. Transitions view **9,595 → 12,371** rows,
  **4,698 → 5,555** properties; **2+ guard-passing links 1,376 → 2,118 (+742)**. Idempotent — a
  re-run plans 0. Reverse: `gov_unfeed_sales_transitions('b5_gov_20260828')`.
  **Ceiling graded down 3,080 → 2,776 / 2,114 → 2,000.**
- **⚠️ THE HEADLINE IS THE BUG IT SURFACED.** `trg_propagate_ownership_to_property` had **no guard on
  `NEW.recorded_owner_id`**, so any dated `ownership_history` row naming its parties as TEXT
  **overwrote `properties.recorded_owner_id` with NULL** — silently, with no ledger, unrecoverably.
  **7,567 live rows are in that shape**; B5's first run alone would have destroyed the recorded owner
  on **1,446 of the 9,312 gov properties that hold one (15.5%)**. Proven on property 7370 and rolled
  back, before *and* after the fix. Fixed fill-forward by
  `sql/20260828_gov_b5a_ownership_propagate_fill_forward.sql`; `props_with_recorded_owner` held at
  9,312 across the real 2,776-row batch. **Do not revert it to unblock a producer.**
- **⚠️ A2b's earliest-wins rule does not reproduce here** — the sale row is later **217** times and
  earlier **34** against an already-recorded pair (A2b measured 26 of 26 the other way), so the
  anti-join keys on the **party pair**, not the date. Quote A2b for its own population.
- **⚠️ Depth at the SOURCE is not `chain_2plus`.** 1,376 view-level 2+ properties convert to 178
  facts today (12.9%). LCC is deliberately unmoved as of this entry: any_history 2,238, chain_2plus
  178, lane completed 1,302, **human_actionable 55**.
- **⚠️ Stale-draft trap, third arrival** (after A4b and A2b). 527 of 579 open tasks already carry a
  pre-B5 draft and the drafter prepares only `fresh` = open ∧ undrafted. `runB5RedraftPass` (keyed on
  STATE, so it catches the next source too) closes it — **JS, so it needs the deploy**; without it B5
  converts on 52 tasks, not 579.
- **B5 is the missing consumer for a producer that already mints the parties** — `r9_chain_connect`
  (cron 104) has read gov sales seller/buyer for months with nothing attaching its output.
- Guards: `tests/unit/test_b5_sales_transition_feeder.py` (gov, 13, **all mutation-verified RED**),
  `test/b5-chain-redraft-pass.test.mjs` (LCC, 10, **9 mutations RED**). Suite **4,815 / 0 fail**.
## 2026-08-28 — B6: the owner/lessee change-signal sweep. Most sources are already consumed; the gaps are four dead producers, two unpopulatable columns, and a health view that cannot see a skipped step.

**AUDIT + DESIGN, nothing built.** Full writeup:
[`docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](../audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md).
Folded into `docs/architecture/connectivity-and-open-threads.md` §4j; backlog rows **B6a–B6g**.

Nineteen signals swept across gov + dia against Scott's three requirements — coverage, corroboration,
next action. **The framing that "we are missing sources" is largely wrong.** Deeds are **98.5%**
consumed, the CoStar sidebar writes both parties, and gov's sales table turns out to be ~97%
represented in `ownership_history` under other provenance labels.

⚠️ **Both numbers I filed the B6 prompt under are corrected.**

- **38,213 landlord-change rows deflate 28.6× → 1,338 net-new / 1,202 properties.** The stages:
  **46.7% of the flag is a pure name re-spelling** (it is computed on raw string inequality, not a
  normalized key); then transition-clean guards; then **−33% for property resolution**; then the A2b
  per-lease fan-out collapses 13,225 → 4,845 conveyances; then P138 oscillation. Still worth
  building — it spans **2013→2026**, so it adds DEPTH, and it is a **FLOOR** (four monthly snapshots
  sit undiffed).
- **`property_sale_events`' two link columns are a TYPE DEFECT, not neglect.**
  `ownership_history_id` and `sales_transaction_id` are **`bigint` against `uuid` PKs with no FK** —
  a writer raises `22P02`. **dia's identical table has a compatible `integer` PK and 52 populated
  rows**, which is the positive control that makes gov's zero structural. This is the comp↔ownership
  join Scott's framing names, and in gov it has never existed.

**⚠️ The lesson worth keeping: A SKIPPED STEP EMITS NOTHING, AND A HEALTH VIEW BUILT ON EMITTED ROWS
CANNOT SEE IT.** Four producers died in March–April 2026 —`gsa_lease_change_facts` and
`gsa_lease_timeline` (2026-03-11), `prospect_leads.ownership_change` (2026-03-31, 7,729 leads of
which **2,041 were actually worked**), `property_sale_events` (2026-04-06). `pipeline_runner.py`
guards the diff with `if latest_file and not runner.dry_run:`, and `find_latest_gsa()` globs a
**local folder** that is always empty on a CI checkout: it returns `None` and is logged **"Task
completed"**. The guarded `run_task` is then never invoked, writes **no `run_log` row**, and has
**no row in `v_pipeline_task_health`** — which today reports one failing step (SAM, 401) and
otherwise all green. **gov `CLAUDE.md` §16 built that view to stop a green `completed` masking a
FAILED sub-task; the SKIPPED case was left open, and it is invisible in a different way — a failed
step is a red row, a skipped step is no row.** It is A5a's lesson in a health view: a producer that
never emitted has no row to `GROUP BY`. **Enumerate declared steps, not logged ones (B6a).**

**Separately: the landlord-change detector has no scheduled caller at all.**
`gsa_lease_change_facts`/`gsa_lease_timeline` are written **only** by `src/ingest_gsa_historical.py`
(a manual CLI, reachable from `run_pipeline.py:172`, which CI does not run). The live Monday job
`src/gsa_auto_sync` writes `gsa_snapshots` + `gsa_lease_events` and **not** the change layer — **the
raw feed and the derived layer have different writers and only one is scheduled.**

**⚠️ B5 is in flight and its ceiling should be re-derived before it builds.** I could not reproduce
`3,080 / 2,114`, and **the anti-join is scope-sensitive by 26×**: against the `sales_transaction`
provenance bucket → **9,517 rows**; against the **whole store** → **366** on the same exact-date key,
or **269 / 215 props** without the date. 3,080 sits between the two, so I am **not** claiming to have
found its bug — the ceiling is simply uninterpretable without its scope. **And 3,313 of the 9,686
named-seller rows are `ownership_change_stub*`, a mechanism gov R37 explicitly RETIRED** (ranked
priority 9 in every sales-dedup pass), minted *from* ownership history — **feeding them back is
circular**. Honest target: **~270–370 rows / ~215–291 properties**, mostly `costar_export`. That does
not refute B5's premise; it resizes the prize by an order of magnitude.

**The corroboration Scott asked for already exists — its verdict just has no reader.**
`parcel_owner_xref` runs every 30 minutes and produces **8,838 `corroborates` / 561 `diverges` / 362
properties**. ⚠️ **319 of those 362 already carry the assessor's name as `new_owner` in
`ownership_history`** — so that is a **propagation gap between the store and
`properties.recorded_owner_id`**, the cheapest correction in the audit; only **43** are genuine
net-new. `diverges` produces no task, card or lead (B6h, renamed from B6d 2026-08-29). And the ladder that should adjudicate
disagreements **has no rung for `gsa_lease_diff` (6,648 rows, its largest source) or
`sales_transaction`** (B6e).

**Measured and refuted — three would have been expensive builds.** `ownership_research_queue`
(17,665 rows) is **100% complete**, not a stalled backlog. **Deeds are 98.5% consumed — the gap is
EXTRACTION** (876 grantors of 5,804), which independently supports B1a/B5's finding that county-deed
acquisition is the wrong first lever. **gov `CLAUDE.md` §21's "state-lease producer silent 6+ weeks"
is SUPERSEDED** — 617 rows, all within 90 days, events to 2026-08-05 (its `property_id`-is-NULL half
still stands). And `gsa_lease_events` is not a landlord signal at all — it is the **LESSEE** half of
Scott's ask, and it is the healthiest lane in the matrix (7,522 leads, **2,863 worked**).

**⚠️ Detector hygiene, for the next Class-20 sweep:** `ownership_source` is **not** a controlled
vocabulary — **2,978 distinct values over 14,076 rows**, embedding record ids
(`county_deed:<uuid>`, `gov_master_backfill_r71|h=<md5>`). Split on `:` and `|` before grouping, or
gov `county_deed` reads as **1 row instead of 1,614**. And **69% of dia's own `ownership_history`
carries a NULL `ownership_source`**, so the detector is structurally blind to it (B6g).


## 2026-08-29 — ✅ B6d SHIPPED. The alert surface is graded, and the ONE SLA I guessed was wrong was a REAL two-month outage.

Merged: `life-command-center#1933` · `Dialysis#7378` · `government-lease#393`.
**Live: 25 registered feeds, every one carrying a graded expectation OR a recorded reason for having
none. `feed_stale` 4 → 2, and both survivors are genuine outages. 0 alerts describing a decision.
0 `feed_mirror_stale`. 2 feeds unwatched-by-decision, still emitting their age.**

**⚠️ THE RULE THAT EARNED ITS KEEP WAS THE ONE I WROTE AGAINST MY OWN HYPOTHESIS.** I predicted
`medicare_clinics` was *"probably the SLA is wrong — CMS publishes slowly"*, and added §3c: **do not
weaken an SLA to silence a real defect; measure CMS's actual cadence first.** Measured: the feed's own
history is **p50 gap 2d, p90 18.5d, max 41d** — and the current age is **65d, above the largest gap it
has ever had.** **The 45-day bound was never the problem.** Widening it would have buried a two-month
ingestion outage.

**I re-verified it independently and it is WORSE than the audit recorded, because it is still
accruing:** `ingestion_tracker` for CMS now reads **116 success (newest 2026-06-25) · 40 FAILED
(newest attempt 2026-08-26) · 16 ABANDONED (newest 2026-08-27)** — and the abandoned rows carry
**`dataset_modified_date = 2026-08-25`**. **CMS published four days ago, we tried, and the runs
failed.** The audit's "27 failed + 6 abandoned" was correct when written; **failures accrue daily**.

⚠️ **My first three verification queries were all against the wrong objects** — `ingestion_runs` (empty),
`ingestion_log`, and `cms_dataset_updates` (which tracks only `cms_patient_counts`, last published
2026-03-24). I briefly could not reproduce the audit's claim and nearly reported a discrepancy.
**What resolved it was reading the registry's own `ts_column` — `source_last_seen`, not `updated_at`
— and its `expectation_basis` field, which records the entire reasoning inline.** *That field is
B6d's real deliverable: it made a shipped conclusion re-checkable by someone who did not write it,
which is exactly what the whole cleanup arc is for.*

**Two more caught before they fired**, both non-defects, exactly as predicted: `opm_workforce`
(age 120 vs SLA 120 — would have alerted the next day) and `gsa_leases_snapshot` (GSA has not
published August).

### ⚠️ And the round turned its own theme on itself — a security claim that was FALSE when written

`compute_feed_cadence` is SECURITY DEFINER over registry-derived dynamic SQL. The first narrowing —
`REVOKE EXECUTE ... FROM anon, authenticated` — **was a no-op**, because **Postgres grants EXECUTE on
a new function to PUBLIC by default**, and both roles still reached it that way. Measured on the live
object *after* the "fix" shipped: `proacl = {=X/postgres, ...}` (**the leading `=X` IS the PUBLIC
grant**) and `has_function_privilege('anon', oid, 'EXECUTE') = TRUE` on gov and dia. **An
unauthenticated caller could invoke a definer function running dynamic full-table scans over every
registered source table.** Corrected by `REVOKE ... FROM PUBLIC`; verified with
`has_function_privilege`, **not by reading the grant that was just written.**

**Caught by a review bot, not by its author** — and it is this round's own §3d (*positive-control the
change*) applied to everything except the security assertion. Already in `CLAUDE.md`.

## 2026-08-29 — B6d drafted: grade the feed EXPECTATIONS. Two more alerts fire imminently for non-defect reasons.

> ⚠️ **SUPERSEDED THE SAME DAY BY THE SHIPPED ENTRY AT THE TOP OF THIS FILE** (`B6d: the feed
> expectations are graded…`). The framing held and the two imminent non-defect fires were real, but
> **three of the four predicted verdicts were refuted by measurement**: `sam_lease_opportunities` is
> **not** a rate-limit case (that is `SAM_GOV_API_KEY` on a different endpoint — this is a genuine 401
> on `SAM_API_KEY`, so its bound was tightened and deliberately left violated); `medicare_clinics` is
> **a real two-month ingestion outage**, not a mis-sized SLA; and the population is **25 feeds, not
> 23**. Retiring `property_sale_events` was right, but **not by dropping the row** — that is what
> stranded its alert. **Read the shipped entry, not this one, for what is true.**

**Prompt: `prompts/B6d-grade-the-feed-expectations-2026-08-29.md`.** It closes the
B6a → B6a-follow-up → B6b arc honestly, **grades expectations only, and writes no data.**

**B6b-lead's refusal is what makes it urgent.** We *decided* not to restart
`prospect_leads_ownership_change` — so its alert now **describes a decision and will sit open
forever**. ⚠️ **An alert describing a decision is the badge-that-is-noise failure, inside the
alerting system we just spent three prompts repairing.**

**Live: 23 feeds · 4 alerting · 19 ok.** The four have three non-defect explanations and one genuine
hypothesis: retire the ownership-lead expectation (no human consumer); re-scope `property_sale_events`
(**its only live producer is an operator form with no cadence** — a 45-day SLA alerts whenever nobody
types a sale for six weeks); re-scope `sam_lease_opportunities` (a 14-day SLA against a documented
**~10 lookups/day** limit is unachievable); and **measure CMS's actual cadence** for
`medicare_clinics` before touching it — ⚠️ **that one is still a hypothesis, and widening an SLA to
silence a real break would bury it.**

🚨 **Two more fire imminently, and neither is a defect:** **`opm_workforce` is age 120 against an SLA
of 120 — it alerts tomorrow**, and **`gsa_leases_snapshot` (59 vs 65) fires in ~6 days because GSA
has not published August.** *A publisher that has not published is not a broken pipeline.* Catching
these before they fire is the difference between a graded surface and a surface people learn to
ignore.

⚠️ **The tell that these were never graded: `expected_max_age_days = 45` appears on 10 of 23 feeds.**
A default, not a measurement — which is why the prompt grades **all 23**, not just the six in
trouble, and requires each to state its **cadence class**: continuous (operator), scheduled (cron),
or **external publication** (GSA monthly, CMS ~annual, OPM slow, SAM rate-limited). **An
external-publication feed's SLA is a property of the PUBLISHER, not of our pipeline** — conflating
those is exactly why `gsa_leases_snapshot` is about to alert.

**Two rules carried in from what this arc has cost us:** a retirement must be **recorded, not
deleted** (otherwise B6a's "a skipped step must emit, not vanish" is undone one layer up), and the
detector must be **seen firing after the change** — *an SLA set so wide nothing can trip it is the
same failure as no monitor at all* (I11).

## 2026-08-29 — 🛑 B6b-lead GRADED AND CORRECTLY NOT RESTARTED. My §0 premise was refuted, and it was the whole justification.

`docs/audits/B6b_lead_OWNERSHIP_LEAD_RESTART_2026-08-29.md`. **The right outcome, reached by
refuting the prompt that asked for it.**

**I wrote in §0: *"Its consumer is CONFIRMED ALIVE, with a measured working record — 7,729 leads ·
2,041 worked · 208 pushed to Salesforce · 2,149 touched in 30 days. Most restarts cannot say
that."*** That was the entire reason this producer was worth restarting. **Every number is real.
Every one means something else.** Verified independently by Cowork:

| I quoted | it actually is |
|---|---|
| **2,041 worked** | `pipeline_status = 'filtered_multi_tenant'` — an **automated exclusion filter**. The lane has exactly **two** status values ever (`new`, that one). **No human has ever set a status.** |
| **208 pushed to Salesforce** | `sf_contact_id IS NOT NULL` = a **matched EXISTING contact**. ⚠️ **`sf_lead_id` is non-null on 0 of 7,729; `sf_sync_status='pending'` on ALL 7,729. Nothing has ever been pushed.** |
| **2,149 touched in 30 days** | **1,216 on a single day** — a bulk sweep, not use. |

**The lane has NO human consumer. It is Class 2 — precisely what I claimed it was not.**

⚠️ **This is the A5 lesson, repeated by me, four days after I wrote it up.** A5's 596 `gap_resolved`
"completions" were all a truncated auto-close; I documented that, then inherited three status counts
from B6b §9 and repeated them without asking **what writes those values**. Filed as **playbook Class
26** and `CLAUDE.md`, because *knowing the rule did not prevent the mistake* — which is the only
reason it earns its own class rather than a footnote.

**The three questions, one query each:** who or what SETS this status · does the "sent" column mean
sent (a **destination** id means *matched*; an **emitted** id means *sent*) · is the activity a
distribution or a spike.

⚠️ **The correction did not reverse the decision — it replaced the reason, and that distinction
matters.** The safety gate I demanded be graded, `is_same_owner`, came back **91.80% agreement and
errs conservative — it PASSED its stop test.** Had the grade been the only check, this would have
restarted. **It was refused on the consumer finding, which the gate grade could never have
surfaced.** *Grade the gate AND the consumer; either can disqualify.*

**Also corrected: the population.** Real figures are **584 total / 42 since the lane died** — far
below the backlog's 10,635 *and* below my own deflated ≈4,987. ⚠️ **And `normalize_entity` has a real
defect found on the way**: unanchored `str.replace` mangles names — **`ABC INCOME LLC` → `ABCOME`,
`ABC CORPORATION` → `ABCORATION`.** The reference comparator that reproduced 7,940 exactly is the
A2-sanctioned alnum key (`lower()` then strip non-alphanumerics).

**Two things deliberately NOT done, both correctly:** the restart, and **registering it in B6a's
producer registry** — *registering a producer nobody will restart adds a permanent RED row describing
a decision*, which is the badge-that-is-noise failure.

## 2026-08-29 — B6b-lead drafted. The deflation is measured, and the "no lessor signal" claim is refuted by a probe bug.

**Prompt: `prompts/B6b-lead-restart-ownership-lead-lane-2026-08-29.md`.** The last of the four open
`feed_stale` alerts that is a genuine restart candidate.

**Why this one earns a restart when most dead producers do not: its consumer is confirmed alive with
a measured working record** — 7,729 leads, **2,041 worked, 208 pushed to Salesforce, 2,149 touched
in 30 days.** Dead since 2026-03-31, correctly alerting at 150 days.

**⚠️ The jsonb-string trap, confirmed live and quantified.** `changed_fields` is a jsonb **STRING**
on **201,212 of 233,666 rows (86%)**, so the naive `changed_fields ? 'lessor_name'` returns **0**
while the correct `(changed_fields #>> '{}')::jsonb ? 'lessor_name'` returns **16,907**. **B6 and
B6b's first probe both read that zero and wrote the producer off.** Playbook Class 11; the rule is
**check `jsonb_typeof` before trusting any containment result.**

**⚠️ And the deflation is now measured, which changes the target substantially:**
**16,907** → −415 missing a side → **−7,940 PURE RE-SPELLINGS (47.0%)** → **8,552 genuine across
2,760 properties** → **−3,565 (42% of genuine) carry `property_id IS NULL` and cannot reach a
property-keyed store at all** → **≈4,987 genuine and property-linked**, still before the A2b
per-lease fan-out and the P138 oscillation guard.

**The 47.0% re-spelling rate independently corroborates B6's 46.7% on `landlord_change_flag`** —
two different populations, two different queries, the same answer. That is the kind of agreement
worth noticing, because most of this arc has been measurements disagreeing.

⚠️ **The backlog's own "10,635 usable pair-events" is PRE-deflation and is now marked as such.** And
only **995 of them arrived since the lane died** — **9,640 are historical residue**, so *resuming the
producer* and *backfilling five months* are two decisions the prompt keeps separate.

⚠️ **`is_same_owner` is the only gate and has never been graded.** The prompt grades it head-to-head
against the normalized comparison before anything writes, and says plainly: **if it cannot separate
a re-spelling from a sale, STOP** — manufacturing thousands of false ownership leads into a lane a
human actually works is strictly worse than leaving it dead.

⚠️ **Expect the lane to stay QUIET after a correct restart.** Newest lessor event is **2026-07-01** —
the same ceiling as the raw GSA feed, because GSA has not published August (pull ledger 2026-08-24,
`consecutive_unchanged=3`). **A correct restart drains the backlog and then waits**, and that must
not be read as failure — the mistake B6b nearly made in the other direction.

## 2026-08-29 — ✅ B6c-dup SHIPPED. The collision was real, the write path did leak, and the orphan count was ZERO — after three wrong answers, two of them mine.

`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`. **Decision, in writing:
`sales_transactions` is the canonical comps spine; `property_sale_events` is a CAPTURE surface that
propagates into it.** 77 of 77 gov views that read a sale store read the spine (all 30 `cm_gov*` CM
views); zero read PSE. **`detail.js` said the opposite in its own comments — corrected at 4 sites,
each marked and quoting the old wording.** Shipped `trg_gov_pse_propagate_to_sale` (AFTER INSERT,
**the single owner of that transition**), `field_source_priority` @5, ledger + kill switch + batch
reversal.

**The leak was confirmed BEHAVIOURALLY, in a rolled-back transaction — PSE +1, spine +0,
`latest_sale_price` set — not by reading the propagation code.** That is the right way to prove a
gap between two stores.

⚠️ **BLAST RADIUS TODAY IS ZERO, AND THAT IS THE POINT.** The operator path has **never** produced a
row; all 5,208 PSE rows are bulk importers that wrote the spine independently, and inserts stopped
2026-04-06. **Fix-before-it-bites, so the build is small** — the right time to close a leak is
before it has leaked.

### ⛔ ALL THREE ORPHAN FIGURES WERE WRONG. THE TRUE COUNT IS ZERO.

**330 / $4.48B (mine) → 9 / $558.8M (mine, "corrected") → 6 / $29.2M (CC's own first re-measure) →
ZERO.** Three root causes, all in one anti-join, now **playbook Class 25**:

1. **The exact-date join was the wrong key.** `sales_transactions.sale_date` is **month-truncated
   for its dominant source** — `costar_sidebar` **87.4% day-1**, ownership stubs **100%**. Re-keyed
   on `(property, YEAR-MONTH)`: **0 orphans of 1,694**, impossible-price positive control **1,694**.
   Every named orphan had an **exact price twin 3–21 days away, every twin on the 1st.**
   ⚠️ **`dedup_natural_key` had been stating that granularity all along** (`property | price | YYYY-MM`).
   **Look for the dedup/natural key before writing an anti-join, then run the neighbouring key.**
2. **`property_id IS NULL` ≠ dangling.** Dangling was **0 and structurally impossible** —
   `ON DELETE SET NULL`. The 321 are **NULL-link rows, 321 detached in ONE batch on 2026-04-03** by a
   bulk property deletion. **A `LEFT JOIN … WHERE pk IS NULL` cannot tell "points nowhere" from
   "points at nothing."**
3. **`transaction_state` was never read.** The "$529.6M invisible to the spine" is **quarantine** —
   `needs_review` / `duplicate_superseded` with `exclude_from_market_metrics = true`. **The store had
   already judged its own residue.** An exclusion check means every membership column, **state
   machines included**, not just the ones named `exclude_*`.

**True population: 1,687 live twins · 7 quarantined ($604.1M) · 0 absent · 0 live twins with a null
price. The spine was COMPLETE.**

⚠️ **The lesson I most need to carry: the FINDING and its SIZE are separate claims, and I conflated
them twice.** The collision was real and the fix was right; only the number was wrong — three times.
Reported separately, a corrected number does not read as a retracted defect. **And this is the third
time this arc I led with an alarming figure that measurement deflated** (the GSA raw feed, then this
twice). The checking is working; **my ordering of alarm-before-caution is the part that keeps
failing.**

⚠️ **Two process notes worth keeping:** the parallel window merged `main` into this branch
concurrently and **both resolutions of the same `STATUS.md` conflict were correct** — both kept both
entries, newest-first, no markers (the §4a lesson, resolved well on both sides). And **gov #391
merged 31 seconds after opening, before CI finished** — no harm, Test & Lint went green 31 seconds
later, but that is the PR #1793 pattern and it was flagged factually rather than let pass.

## 2026-08-28 — 🗄️ CLEANUP COMPLETE: root `.md` 70 → 10 across five topic passes

**Final pass moved the Dialysis-book copy/emails to `docs/capital-markets/` and the DIA-demographics
+ lease-abstract worklogs to `docs/history/`.**

**The 10 that remain are all defensible:** `CLAUDE.md`, `AGENTS.md`, `LCC-OS.md` (entry points) ·
`WRITE_SURFACE_POLICY.md` (**canon-bound — `canon/00-INDEX.md` invariant #4 binds to it by name**) ·
`SALESFORCE_LCC_INGESTION_PLAN.md` (**cited by path in a user-visible runtime error string**) ·
`BRIGGS-WRITING-VOICE.md` · four `SPEC_*` files (low-risk; a future pass can triage them).

**Across five passes: 62 items recovered that existed in NO tracker** — P14 (M1–M11), P14b (R1–R14),
P14c (I1–I23), P14d (J1–J14), P14e (AI1–AI10) — **plus SEC2–SEC4 and two defects fixed in flight**
(the Vercel-era pre-commit hard fail; the canon write-policy naming deleted files).
**Not one of them would have survived a move-first cleanup.**

## 2026-08-28 — B6c-dup drafted, and the sizing check I demanded settled it AGAINST ME

**Prompt: `prompts/B6c-dup-two-sale-stores-disagree-2026-08-28.md`.**

⛔ **I reported 330 orphaned priced comps / $4.48B this morning. It was inflated ~8× and is now
corrected in place.** The exclusion check I insisted on as "step one" is what caught it: **321 of the
330 have a `property_id` that does not exist in `properties` at all.** They are a
dangling-reference / stale-import defect, **not** missing comps.

**The honest figure is 9 orphaned priced sale events on LIVE properties — 4 `costar_export` + 5
`excel_master` — $558.8M, 5 with a cap rate.** ⚠️ **And the value is concentrated: one row is
$379.5M of the $558.8M**, so the nine get inspected individually and the sum is never quoted as a
portfolio. **B6c's original ~6 was close to right; mine was not.**

**The lesson, and it is mine: check what a row points AT before counting it as absent from somewhere
else.** This is the **second time this arc** I have led with an alarming number that measurement
deflated — the first was *"the raw GSA feed is stale too"* (it wasn't; GSA hadn't published August).
**Both times the guard I had written into my own prompt is what caught it, and both times I put the
alarm in the headline and the caution in a footnote.** The protocol's step ① is doing its job; my
ordering of alarm-vs-caution is the part that still needs discipline.

**Filed as its own row — `B6c-orphan`** — with the generalisation stated: **D2/I3 asks whether a link
column can HOLD its target's key; this asks whether the key it holds still EXISTS.** A repo-wide
dangling-reference sweep is the natural sibling.

**What did NOT change:** the finding itself. **76 of 76 gov views read `sales_transactions`, zero
read `property_sale_events`, including all 30 `cm_gov*` Capital Markets views**, and nothing
propagates PSE → `sales_transactions`. **A sale an operator types into the property panel still
never reaches the comps spine.** The prompt fixes the write path before any backfill (Class 8), and
requires `detail.js`'s comment — which asserts the opposite of the database — to be corrected either
way, *because that comment is how this survived.*

## 2026-08-28 — 🗄️ CLEANUP PASS 4: AI-chat / Copilot / architecture. Root `.md` 70 → 17, and a landmine defused.

**13 files read in full. No secrets — the SEC2 pattern did not repeat here.** Two defects were
**FIXED rather than filed**, because both were small, unambiguous and actively dangerous:

- 🚨 **`.github/hooks/pre-commit` hard-failed every commit when `api/*.js` > 12, citing *"Vercel will
  reject this deployment."* `api/` holds 21.** It was **never installed**, so a landmine rather than
  a fire — but **its own header tells you how to install it**, and doing so would have blocked all
  work against a platform retired three months ago. **Defused:** it now emits a non-blocking notice
  and records why, preserving the ≤12 *structure* convention (`CLAUDE.md` rule 1) while dropping the
  retired-platform hard fail.
- **`WRITE_SURFACE_POLICY.md`'s exempt-surface list named two DELETED files** (`api/data-proxy.js`,
  `api/contacts.js`). ⚠️ **This is a canon-integrity defect, not a typo** — `canon/00-INDEX.md`
  invariant #4 binds to that file **by name** and `REGISTRY.md` §A calls it canonical at a
  root-anchored path. **Corrected in place and bannered KEEP AT ROOT**: moving it would force a
  `CANON_VERSION` bump and a paste to every surface, which is exactly the kind of cost a tidy-up
  should not incur silently.

**10 more unfiled items (`P14e`, AI1–AI10). The one that matters:**

⭐ **AI1 — the AI-chat routing rollout was specified, tooled, and NEVER VALIDATED.**
`AI_CHAT_ROLLOUT_RESULTS_TEMPLATE.md` is **blank in every field** — no date, no policy, no tester —
while `AI_CHAT_POLICY` / `AI_CHAT_FEATURE_PROVIDERS` are **live** at `api/_shared/ai.js:181–190` and
**five assistants route through them.** **Nobody knows which provider `global_copilot` actually
hits.** ⚠️ And it must be asserted on the dashboard's **observed** provider/model rows, never the
configured policy — *the doc's own "Routing Mismatches Detected" section exists because those two
disagree.* ⚠️ **It may also be silently failing the same way as the Anthropic credit-balance
outage** that kills the cloud Analyst's-Take and capital-markets generation. Unmeasured; `npm run
ai:status` + filling the template settles it.

**Four contradictions found, and canon/code is right in all four** — hosting (a doc recommending a
**Vercel Pro upgrade**), the API file topology (**six `api/*.js` files that no longer exist**, named
across three docs *including the canonical write policy*), the AI chat handler and model (**AI6**:
a doc asserting *"AI chat logic lives outside this repository"* when `/api/chat` is right here), and
the database topology (one doc presenting the **gov** project as *the* database). **All bannered in
place, none deleted.**

**Three path-anchored references were repointed in the same change** (`scripts/ai-rollout-status.mjs`
×3, `.github/AI_INSTRUCTIONS.md` ×3, `REGISTRY.md`) — §6z step 5 doing its job.

## 2026-08-28 — ✅ B6c ANSWERED: keep the table, retire the columns — and the type defect was never the real finding.

`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`. **Diagnosis only; no migration shipped**, which
was the right call: dia holds 52 real `ownership_history_id` values a `DROP` would destroy, and it
sequences behind the bigger decision below.

**The type question resolved cleanly.** The table **has** a future — six live gov triggers, the LCC
detail panel's declared canonical write target, read+write allowlisted on both domains. **The two
link columns do not.** `ownership_history_id` has **ZERO readers anywhere** — 0 hits across 620 gov
objects, 0 across dia, 0 in `api/`; 0 of 5,208 gov rows; 1.9% on dia after four months; no FK on
either domain. **Retyping it would satisfy I3 and build a link nobody follows.** The invariant was
sharpened in place: *I3 says a link column must be type-compatible; it does not say every
`<table>_id` column deserves to exist.*

### 🚨 The real finding — the two sale stores disagree about which is canonical

**`detail.js` says in its own comments that `property_sale_events` is canonical and
`sales_transactions` is "legacy, retired for write paths." The database says the exact opposite.**
Verified independently by Cowork: **76 of 76 gov views that read a sale store read
`sales_transactions`; ZERO read `property_sale_events`** — including **all 30 `cm_gov*` Capital
Markets views**. Nothing propagates PSE → `sales_transactions`, though the reverse exists.

**So a sale an operator types into the property panel never reaches the comps spine.** Filed as
**B6c-dup**, ranked above every column repair. **Both stores are individually correct with coherent
consumers — nothing errors, and no component test can see it, because it is a property of the
connection.** That is the P0d thesis with an operator-facing cost attached.

⚠️ **I re-measured the orphan population and got a much bigger number than B6c's six. Both are
right, about different questions — quote them separately.** Anti-joining priced PSE rows (stubs
excluded) against `sales_transactions` on (property, exact date): **330 orphaned priced comps, 203
with a cap rate, 2004-12 → 2025-11, $4.48B, max $379.5M** — **325 `costar_export` + 5
`excel_master`**, and **321 of those properties have NO sale in `sales_transactions` at all
($3.92B)**, so it is **not** the A2b date-mismatch class. **Two findings: the ~6 operator entries are
the ONGOING leak (fix the write path); the ~322 properties are a HISTORICAL bulk-load orphan (a
backfill decision).** ⚠️ **Neither I nor B6c checked them against `exclude_from_property_linking` /
`sales_exclusion_reason` — some may be excluded from the comps spine BY DESIGN. The honest number is
between 6 and 322 and the exclusion check is the first step.**

### D2 swept all three projects — 10 genuine defects, 3 low, 5 accepted false positives

Two refinements it earned while running, both now in the contract: **a declared FK is authoritative
and Postgres already type-checks it**, so only *unFK'd* columns need examining (that killed a whole
false-positive class); and **every genuinely mismatched undeclared column found is 0% populated** —
*a column that cannot hold its value never gets one* — so **triage by populated-ness before reading
names**, since a *populated* mismatch is nearly always a vendor id or a uuid-stored-as-text.

**Two further findings worth carrying:** gov and dia's `property_sale_events` are broken on
**different** columns (dia's `broker_id` is `uuid` against an `integer` PK), so **neither domain is a
safe template for the other** — I2's same-shape invariant failing on TYPES, which I2's provenance
`group by` structurally cannot see. And **`available_listings.true_owner_id` on dia is `integer`
against a `uuid` PK, 0 of 5,334, on a live central table.**

**Three limits stated rather than smoothed over** — the kind of honesty that makes the rest
trustworthy: **LCC Opps' zero is BOUNDED, not clean** (151 of 559 `_id` columns evaluated; **408
unexamined**); the `property_sale_events` `feed_stale` alert should be **re-scoped, not resolved**
(its bulk producer was retired on purpose and its only live producer is an operator form with no
cadence, so a 45-day SLA alerts whenever nobody types a sale for six weeks, then sits open forever);
and **nothing shipped, so there is no guard** — it ships with B6c-dup.

## 2026-08-28 — 🚨 CLEANUP PASS 3 FOUND A LIVE CREDENTIAL EXPOSURE. That outranks the cleanup.

**`wave0-config-values.txt` is TRACKED IN GIT at the repo root and holds `LCC_API_KEY` in
PLAINTEXT.** Verified: 858 bytes, `git ls-files --error-unmatch` confirms tracked, **not in
`.gitignore`**. It also carries `LCC_HOST=https://life-command-center-nine.vercel.app` — **the
retired host that still answers and still holds a service key** (P194) — plus Teams tenant/team/
channel IDs.

⚠️ **This is a DIFFERENT and worse exposure than SEC1**, which records the key as *"pasted in
plaintext during a curl diagnostic."* **A chat paste is transient; a tracked file is in git history,
in every clone, and in every fork.** Filed as **SEC2**.

**And it is not the only one. `SEC3`:** `docs/os/POWER-AUTOMATE-DEPLOYED-CATALOG.md` reports **ten of
seventeen** deployed PA packages contain **literal JWT-like values**, and
`docs/architecture/flows/sync-sf-activities-to-supabase.md` carries an unresolved **P0** —
*"rotate exposed Supabase keys immediately"* — with **`Credential rotation completed: TBD`**.
**I1 covered only the `X-PA-Webhook-Secret`; this is a separate, larger, never-filed item.**

👤 **Scott, order matters: (1) ROTATE `LCC_API_KEY` and update Railway; (2) `git rm --cached` +
`.gitignore`; (3) only then consider history.** ⚠️ **Do not reach for `filter-branch` casually** —
this repo nearly lost a 475 MB mailbox doing exactly that. **Rotation is what makes the committed
value worthless, and that is the outcome that matters.** `SEC4` proposes the standing guard (a
JWT/`sb_secret_`/long-hex check over flow exports and config files) so the next export cannot
re-introduce it silently.

### Cleanup pass 3 — the Power Automate cluster (root `.md` 35 → 29)

**14 more unfiled items (`P14d`, J1–J14).** The four that matter:

- **J1 — `sf-promotion-worker` has NEVER left report-only.** `enforce` defaults `false` **and the
  Salesforce rungs of `field_source_priority` were never seeded**, so **no Salesforce field can ever
  be promoted.** A whole promotion path that reports success and writes nothing.
- **J2 — LCC calls the PA flow with `action:'reschedule'` and the flow has no such branch**, so
  rescheduled dates never reach Salesforce. A caller sending to a branch that does not exist.
- **J13 — archiving the root files did NOT solve the retired-URL problem.**
  `rcm-power-automate.md`, `loopnet-power-automate.md` and `lcc-personal-calendar-sync.md` **still
  record the retired host as their endpoint — inside `docs/architecture/flows/`, the directory this
  pass just confirmed as authoritative.**
- **J14 — FOUR homes for one topic**, two of which near-collide by name (`docs/flows/` vs
  `docs/architecture/flows/`).

**`RCM_LOOPNET_FIX_INSTRUCTIONS.md` got the strongest banner yet** — it instructs an operator to
point two PA flows at the retired host and hands them working `curl` commands against it. Its
**code** half is fully shipped; only the PA half (M8) is outstanding, and its spec **competes with
the authoritative `.github/PA_FLOWS.md` §Flow 3.**

⚠️ **`SALESFORCE_LCC_INGESTION_PLAN.md` was deliberately KEPT AT ROOT** — `intake-salesforce-files/
index.ts` cites it **by path in a user-visible runtime error string**. It contradicts production
(§10 says "every 6 months"; the deployed sync is **hourly**) and itself (§12 vs §5.3) — **J12 fixes
it in place.**

**Two cross-checks strengthened existing rows rather than adding new ones:** **I5** is a *regression
from spec* (the design always mandated capturing the failed slice and a dead-letter listing), and
**I4**'s backfill was designed **manual/button-only**, so *"turn it off"* beats *"fix it."*

## 2026-08-28 — B6c drafted, and re-measuring turned "fix the bigint" into "does this table have a future?"

**Prompt: `prompts/B6c-property-sale-events-decide-before-fixing-2026-08-28.md`.** It also carries
the **D2** sweep, since this is D2's known instance.

**The type defect is confirmed exactly** — `sales_transaction_id` and `ownership_history_id` are
**`bigint` against `uuid` PKs**, no FKs, **both populated on 0 of 5,208 rows**. And the positive
control is stronger than reported: **dia's identical table has `integer` PKs and links 2,432 of
2,730 rows (89%)** on the sales side. The design works; gov's instance is structurally impossible.

**⚠️ But protocol step ① found three things the type defect was hiding, and they change the job:**

1. **56% of the table — 2,919 rows — is `ownership_change_stub*`, the RETIRED CIRCULAR mechanism.**
   It is minted *from* ownership history, so linking it back is a loop. **B6 raised this class
   against B5, where it measured 2 of 2,776 and was correctly dismissed. Here it is the majority.**
   *The same objection can be noise in one population and decisive in another — re-measure it per
   population rather than inheriting the verdict.*
2. **`buyer_id` and `seller_id` are `uuid` and populated on ZERO rows too.** It is not just the two
   link columns — **every id column in this table is empty.** It holds text names only.
3. **The producer is dead** — newest row 2026-04-06, which is exactly the 144-day `feed_stale` alert.

⚠️ **And the strongest argument against a naive fix comes from the positive control itself:** on
dia, where the link CAN be populated, `ownership_history_id` is set on **52 of 2,730 (1.9%)**. The
sales side works at 89%; **the ownership side is barely used even where it is possible.** So *"fix
the type and the join lights up"* is not supported by the one working instance.

**The prompt therefore asks the consumer question first** — grep for readers, ask whether this is a
**third representation of a relationship `ownership_history` and `sales_transactions` already
model**, and decide. **Retiring the table is an explicitly acceptable outcome** (A5, C1, A3, P196,
P198 all ended in *do not build*). What is not acceptable is fixing the types without knowing
whether anything will read them — that is Class 2 with a migration attached.

## 2026-08-28 — 🗄️ CLEANUP PASS 2: infra / hosting / monitoring. 23 more items filed nowhere, and a live contradiction between two canonical pages.

**Root `.md` 50 → 35** (70 → 35 across both passes). Fifteen files read in full before any move.
**23 items existed in no tracker** — §P14c, **I1–I23**.

**The five that matter most:**

- 🔒 **I1 — the `X-PA-Webhook-Secret` was committed INLINE in a Power Automate export and rotation
  was never confirmed.** 👤 Scott, security, do this first.
- ⚠️ **I2 — dia parallel pagination was never reverted or probed, and its gov twin was a
  194-SECOND regression.** QA-33 says *"dia NOT reverted yet"* and nobody went back.
- **I3 — the Supavisor pooler move was filed ONLY as a pointer from the backlog INTO the file being
  archived.** **A pointer into an archive is not a filing.** It now has its own row; the pointer is
  repointed. **This is the cautionary tale of the pass** — the extract-first gate caught it only
  because the gate exists.
- **I4/I5 — a PA flow has been failing daily at ~11:26 UTC since June** ("turn it off" was never
  confirmed), and **the PA fault branch posts only the run header, so `error_detail` is empty and
  every flow failure is undiagnosable.**
- **I9 — six of seven Pipeline Control findings are still true in today's code**, including a banner
  telling operators *"runs are triggered via CLI — contact your administrator"* when they run on
  Railway crons.

**Two obsolete WORKFLOW workarounds are now bannered off.** `AUDIT_PROGRESS` and
`GAPS_AND_FINDINGS_REGISTER` both prescribe writing files via `bash python open('w')` because
*"sandbox writes are invisible to Windows git"* — a 2026-05 mount artifact. **A future session
adopting that would be silently slowed by a bug that no longer exists.** Stale *process* advice is
worse than stale facts: nothing contradicts it.

**A name collision ended.** There were **two `ROLLOUT_STATUS.md`**. The live one is
`docs/audits/ROLLOUT_STATUS.md` (250 KB, cited by `api/admin.js:263`); the root copy had **zero
inbound references** and its own banner redirected readers elsewhere — *a document everyone thought
they had found.* Archived under a disambiguated name.

**Four root files named four different hosting targets** — Vercel (ROLLOUT AD6, a "locked
architecture decision"), Railway (INFRASTRUCTURE), Render (RENDER_MIGRATION_PLAN), GitHub Pages
(VERIFICATION-SUMMARY). **Railway is right**, and **none of the four recorded that the retired Vercel
deployment still answers and still holds a service key** — the fact an infra reader most needs.
**I16 makes the Render contingency a decision instead of a fourth answer.** 👤 Scott.

### ⚠️ A LIVE CONTRADICTION BETWEEN TWO CANONICAL PAGES — surfaced, not resolved

**`CURRENT-STATE.md` says `LCC_API_KEY` is "production-ready but NOT enforced". `CLAUDE.md` says
`/api/*` IS auth-enforced** — on the strength of my own probe returning **HTTP 401** while
`/version` answered normally. **Both cannot be right about the same thing.** Most likely one
describes the env state and the other a route-level guard. **The resolver is
`GET /api/diag?kind=auth-ready`.** Flagged in place on `CURRENT-STATE.md`; **neither page should be
quoted on auth until it is run.**

## 2026-08-28 — ✅ B6b SHIPPED. The change layer is live and self-healing — and it corrected THREE of my premises, including one I raised as an alarm.

Merged: `government-lease#390` (`9b7dfda`, post-merge Test & Lint green on main — **verified on the
run, not assumed**, after it merged ~30s from opening) · `life-command-center#1903`.

**Verified live by Cowork:** `gsa_lease_change_facts` **336,303 → 374,257** rows, now current to
snapshot **2026-07-01** (was 2026-02-01) · `gsa_lease_timeline` **16,779** · `landlord_change_flag`
**38,213 → 39,549** · derivable backlog **0** · **the layer now derives on the Monday `gsa-sync` on
both paths, so it self-heals whenever GSA publishes.**

**🎯 THE ACCEPTANCE TEST WAS MET IN THE LEDGER, NOT IN A RUN LOG.** Both `feed_stale` alerts —
`gsa_lease_change_facts` and `gsa_lease_timeline` — **opened AND resolved on 2026-08-28**. The
monitor repaired yesterday detected the producer repaired today and closed itself. That is the
whole point of having sequenced B6a → B6a-follow-up → B6b.

### ⚠️ Three corrections to MY prompt's premises — and the first one was my alarm

1. **🚨 "THE RAW FEED IS STALE TOO" WAS WRONG. The raw feed was never dead.** The pull ledger shows a
   **2026-08-24 pull with `consecutive_unchanged=3`** — **GSA simply has not published August.** I
   led the prompt with `gsa_snapshots` at 2026-07-01 (~58 days) as a 🚨 finding. **My own prompt
   warned against exactly this error** (*"a feed early in its cycle and a dead feed look identical
   from `max(snapshot_date)`"*) — so the guard worked and the check was made, but **I put the alarm
   in the headline and the caution in a footnote, and the alarm was the wrong half.** Read the
   producer's own ledger before calling a feed dead.
2. **"No scheduled caller" was TRUE BUT INSUFFICIENT.** The derivation read a **different table**
   from the one the live job writes. **Scheduling the old code unchanged would have produced
   nothing** — a green cron over a no-op, i.e. the exact class B6a exists to expose.
3. **"Undiffed" ≠ "derivable."** **15 of 21 undiffed dates are already spanned by an existing diff**,
   and deriving them would have **double-counted conveyances the store already holds.** Backlog
   count and work count are different numbers.

### New durable footgun (recorded in gov's CLAUDE.md)

⚠️ **A DDL batch that ends in a runtime error rolls the DDL back with it.** That is how a 2-arg
`gov_gsa_change_layer_tick` overload survived a `DROP` that appeared to have run — found only by
**censusing the live objects afterwards**. Same family as *merged is not running*: **the statement
executing is not the object existing.**

### Deliberately left open, with reasoning recorded

- **`B6b-lead`** — `prospect_leads_ownership_change` is **still dead and still correctly alerting**
  (150d). `ingest_ownership` IS restartable and **B6's claim that its input carries no lessor signal
  is REFUTED — 16,907 rows do.** But it is a **10,635-row first write gated only by a name
  heuristic** that could not be dry-run from the sandbox. ⚠️ **Its consumer is confirmed alive —
  2,041 leads worked, 208 in Salesforce — which is precisely why it deserves a MEASURED restart
  rather than a blind one.**
- **`B6b-june`** — `gsa_snapshots` 2026-06-01 is a **merged snapshot of two source files**: an
  upstream ingest defect, not a change-layer one.

**Open `feed_stale` alerts now 6 → 4:** `prospect_leads_ownership_change` (B6b-lead) ·
`property_sale_events` 144d (**B6c**, the `bigint`-vs-`uuid` table) · `sam_lease_opportunities` 32d
vs a 14d SLA · `medicare_clinics` (dia) 64d — ⚠️ still **check the SLA before treating as a defect**,
CMS publishes slowly. *(The ledger also shows the alerting worked before the July outage —
`gsa_lease_events` opened 06-20/resolved 06-22, `gsa_leases_snapshot` 07-09/07-14.)*

## 2026-08-28 — B6b drafted, and re-measuring found the raw feed is stale too

**Prompt: `prompts/B6b-restart-gsa-landlord-change-detector-2026-08-28.md`.** B6a + B6a-follow-up
unblocked it — a restarted producer can now be told whether it stays up, which was the whole point
of doing them first.

**⚠️ Protocol step ① earned its keep before the prompt was even written.** B6's finding was *the
derived layer has no scheduled caller* — true, and incomplete. Measured today:

| object | newest | |
|---|---|---|
| `gsa_lease_change_facts` | **2026-02-01** | the derived layer, ~7 months dead |
| **`gsa_snapshots`** | **2026-07-01** | **the RAW feed, ~58 days old** |
| undiffed snapshots | 4 — `2026-03/05/06/07-01` | `2026-04` genuinely absent upstream |
| `prospect_leads` (`ownership_change`) | 2026-03-31 | **7,729 leads, 2,041 historically WORKED** |

**Restarting only the diff would eat the four backlog months, report success, and stop again at
2026-07 with nothing for August** — while the `feed_stale` alert stays open and everyone believes it
is fixed. **That is the B6a lesson repeating one layer up: follow the signal all the way to the
source.** The prompt therefore requires the raw feed to be diagnosed *first*.

⚠️ **And it explicitly warns against the opposite error:** GSA publishes monthly on a lag, so **a
feed early in its cycle and a dead feed look identical from `max(snapshot_date)`** — the same
wrong-SLA-vs-dead-feed ambiguity flagged for dia `medicare_clinics`. Establish the expected cadence
before calling it broken.

**Why this restart is unusual:** the lead lane it revives has **2,041 historically worked leads** —
a measured consumption record, not a speculative producer. Most restarts cannot say that.

**Carried into the prompt as hard rules:** deflate `landlord_change_flag` before quoting it (38,213
→ **1,338 / 1,202 properties**, 28.6×, of which **46.7% is pure name re-spelling** because the flag
is raw string inequality); this producer writes **text parties**, which is the exact shape that
**nulled 7,567 rows** through the propagation trigger before B5 fixed it; register the new step in
B6a's registry with declared skips, or it restarts into the blindness B6a just fixed; and **the
acceptance test is the alert auto-resolving, not a green run log.**

## 2026-08-28 — ✅ B6a-follow-up SHIPPED: the monitor is alive, and its first honest run names the backlog. Plus: the build-turn protocol is now the definition of done.

**Verified live by Cowork (the response transcript ended mid-work, so this is measured, not read):**

| metric | before | after |
|---|---|---|
| gov feeds evaluated | **13, frozen 2026-07-26** | **18, synced TODAY** |
| dia feeds evaluated | 5, frozen 2026-07-29 | **5, synced TODAY** |
| open `feed_stale` alerts | **0** (for 33 days) | **6, and every one is real** |

⚠️ **gov went 13 → 18 feeds** — the transport fix did not merely un-freeze the mirror, it **restored
five feeds that had been failing silently.**

**The first honest run names the backlog, which is the strongest possible evidence it is working:**
`gsa_lease_change_facts` **170d** (⚠️ **the 336k-row landlord-change source B6b exists to restart**) ·
`gsa_lease_timeline` 170d · `prospect_leads_ownership_change` 150d · `property_sale_events` **144d**
(⚠️ **the B6c `bigint`-vs-`uuid` table**) · `sam_lease_opportunities` 32d against a 14d SLA ·
**`medicare_clinics` (dia) 64d — a dia feed nobody was watching.**
⚠️ **Before treating `medicare_clinics` as a defect, check its SLA is right** — CMS publishes on a
slow cadence and `facility_patient_counts` is documented as ~annual, so a 45d SLA may simply be
mis-set. *A wrong SLA and a dead feed render identically.*

**The transport was TWO different causes, one per domain** — which is why "all 18 froze on one date"
was worth diagnosing before patching the consumer: gov was a **cold-start timeout** (same request,
same key, 3 minutes apart: cold → HTTP 500, warm → HTTP 200 with all 18 feeds), dia a **missing
grant**. ⚠️ And restoring dia's grant naively would have **re-opened the privilege-escalation surface
B6a had just closed on gov** — the revoke was mirrored instead.

**§2e answered:** `lcc_check_feed_freshness` was the **only** check with the go-silent shape, and
`lcc_check_bd_sync_freshness` **already implemented the fix correctly** — an in-repo precedent reused
rather than a new pattern invented. **I11 moves from ❌ VIOLATED to ✅ with a standing detector.**

⚠️ **Still open and NOT closed by this:** `record_skip` has **still not been exercised by a real
run**. The four RED producers remain a *registry* result. The check is a `Task skipped` row for
`gsa_ingest_+_diff` in `run_log` with `skip_reason='gsa_download_folder_empty'` after the next
scheduled run (daily `0 8 * * *`).

### 🔁 And the process itself is now the deliverable

Scott: *"incorporate this repository clean and self-improvement process at every turn of every build
… so the latest chat can always pick a topic up fresh."* Written as
**[`docs/os/BUILD-TURN-PROTOCOL.md`](../os/BUILD-TURN-PROTOCOL.md)** and wired in as **`CLAUDE.md`
Rule 00** (so every Claude Code session reads it) and **`DOCUMENTATION-MAP.md` §6y**.

**Eight steps**, each earned by a measured failure from this week: measure before concluding ·
verify on the state delta and positive-control every zero · establish deploy state via `/version` +
`merge-base` · reconcile against the parallel window · **update canonical docs in the same change** ·
correct what is false in place, **your own calls included** · **extract open intent before archiving**
· leave the next step named. **The test is one question: *can the next session pick this topic up
cold, from the canonical pages alone, and be right?*** It explicitly is **not** ceremony — a one-line
fix needs a one-line STATUS entry.

## 2026-08-28 — 🗄️ TOPIC-BASED REPO CLEANUP, pass 1: the ownership/sales/provenance cluster. 25 items were filed nowhere.

**Scott: *"topic based and repository wide, not just the prompts folder — so there is zero confusion
on what the latest status or build or plans or designs are."*** This pass covers **one topic
cluster** end to end. It is not a full repo reorganisation; the rest is sized below.

**Both moves were gated on reading every file first**, because the standing rule is *lose nothing,
especially no planned feature.* **That gate earned its keep: 25 items existed in no backlog, no
audit and no design doc.**

| moved | from → to | items recovered |
|---|---|---|
| **32 session statuses** (2026-05-23 → 05-29) | `docs/ownership_sales_remediation/` → `docs/history/worklogs/ownership_sales_remediation/` | **11** → backlog **§P14, M1–M11** |
| **12 root `.md` files** + 4 coupled | repo root → `docs/history/` and `docs/audits/` | **14** → backlog **§P14b, R1–R14** |
| **3 still-live references** | repo root → `docs/architecture/` | (relocated, not archived) |

**Root `.md` count 70 → 50.** The doc map's own rule is *"the root is code and config; do not add a
new `.md` there"* — it was being violated 70 times.

**The five recovered items that matter most:**

- **R1 — an entire unexecuted Supabase 3→1 consolidation plan**, with rollback, **no backlog row
  anywhere**, still cited as live by a 2026-07 audit. 👤 Scott's call.
- **R2/R3/R4 — the duplicate-property RECURRENCE fix was never built.** `upsertDomainProperty` still
  runs the `address=ilike` fall-through chain; `v_property_address_collisions` has **zero consumers
  on either DB**. **We clean the output nightly via the twin lane and never fixed the producer** —
  Class 8, and exactly the pattern this whole campaign is about.
- **M1 — 617 `ownership_history` rows are grandfathered out of `excl_oh_no_overlap`** and the review
  queue was never drained. **"C5 DONE" meant the constraint shipped, not that the overlaps were
  resolved.**
- **R13 — an unresolved CONTRADICTION that M10 and K10 are sized off.** The remediation plan calls
  the deed/parcel orphaning *"audit overstated"*; the deed spec's whole premise is the opposite
  (9,402 orphans). **One of them is wrong.**
- **M8 / M7 — LoopNet PA Flow 3 has never been built (0 leads ever landed)**, and the `lead-ingest`
  Edge redeploy was never confirmed, leaving sanitization live only on the **retired-but-answering**
  host.

**Two archives carry mandatory-read banners**, because several files assert things that are now
false and would mislead a future session within one paragraph: the A9b cutover design says
**"Status: design / not executed"** when it shipped 2026-05-29; its runbook's **Step 0 gov→hub
re-sync is now actively harmful** (it would import the stale snapshot into the authoritative hub);
and `SPEC_research_task_generator`'s cron snippets **target the retired Vercel host** while its
auto-close **is** the A5a defect that falsely closed 5,763 tasks.

⚠️ **Also recorded: a LETTER COLLISION.** The May campaign's Track A/B/C are unrelated to the Aug
lettered prompts. *"B4"* is a May sales worker **and** the dia-vs-gov chain-depth question.
**Always check the date.**

**Remaining, sized not done: ~50 root `.md` files in other clusters** — capital-markets emails and
book copy, BOV/lease-extractor specs, Power Automate setup guides, hosting strategy
(`LONG_TERM_HOSTING_STRATEGY.md` + `PHASE_0_INVENTORY.md` should move with R1's plan), AI-chat
rollout, and the DQ/intake remainder. **Same discipline required: read, extract unfiled intent,
then move.** Filed as the next cleanup pass.

## 2026-08-28 (evening) — B6a SHIPPED; the four dead producers read RED. And the alert chain that would carry that to a human has been silent for a month.

Evidence: [`B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`](../audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md) §7a ·
contract [`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) **I4 (shipped) / I11 (new)**.
Merged: `government-lease#389` (code + migrations, Test & Lint ✅) · `life-command-center#1893` (docs, `b31f401`).

**B6a delivered, and delivered the thing I asked for most.** The four producers dead since
March–April 2026 now read **RED** (170/170/150/144 days against a 45-day SLA); skips emit a
first-class `Task skipped` row with a declared reason; `is_overdue` is computed against the step's
**own p90 cadence**; equivalence held at **0-changed in both directions** on every pre-existing feed
and view column. **And the detector was SEEN going red on a deliberate silence and green again** —
the §2a requirement, which is what separates this from the view it replaces.

⚠️ **`record_skip` HAS NOT YET BEEN EXERCISED BY A REAL RUN, and the RED rows are not proof that it
was.** They are a **registry** result — they prove the config rows. The daily pipeline fires
`0 8 * * *` and the weekly `0 6 * * 1`. **The check that matters is a `Task skipped` row for
`gsa_ingest_+_diff` in `run_log` carrying `skip_reason='gsa_download_folder_empty'` and
`skip_declared: true`**, after which its `age_days` resets and it stops reading overdue. **Until a
run passes through, "no bad rows" and "no rows at all" read identically** — the exact trap the work
is about, correctly flagged by the build rather than papered over.

**🚨 THE FOLLOW-ON FINDING IS BIGGER THAN THE FIX, and I verified it independently.** The chain that
carries gov's verdict to an LCC alert **has evaluated nothing since 2026-07-26**, and **every layer
reports success**: gov `v_feed_freshness` is correct (says `sam_lease_opportunities` is 32d stale) →
crons **140/141** fire daily and record **`succeeded`** → `lcc_finalize_feed_freshness` consumes
only `status_code = 200` and **silently drops the rest, returning `(0,0)`** (identical to *nothing to
do*) → `lcc_domain_feed_freshness.synced_at` frozen at **2026-07-26** gov / **2026-07-29** dia →
`lcc_check_feed_freshness` **excludes mirror rows older than 3 days**, so it evaluates **zero** feeds
and returns `new_alerts: 0, stale: []`.

**Verified live 2026-08-28:** gov mirror **33 days** stale across **13 feeds**, dia **30** across
**5**; `feed_stale` alerts — **8 ever, 0 open, last detected 2026-07-24**, **two days before the sync
died.** *The alerts stopped when the monitoring stopped.*

- **New invariant `I11` — a monitor must alert on its own blindness.** *"I cannot see this feed"* and
  *"this feed is fine"* must never render identically. **The staleness guard on the mirror IS the
  silent failure**, and the exclusion is individually defensible, which is why nobody caught it.
- **Corollary:** a fail-soft that swallows a non-200 must **count and surface** it. `(0,0)` may
  never mean both *nothing to do* and *everything failed*.
- **The contract is now three of eleven invariants with a standing detector** — I4 shipped today,
  **I11 was added the same day because it was found violated.**

**Next prompt drafted: `B6a-follow-up`** (LCC-side only; gov is correct and must not be touched).
Sequenced **before B6b**, because B6b's entire premise is being able to tell whether a restarted
producer stays up — and today it cannot be told. ⚠️ It carries three cautions: **diagnose the
transport before patching the consumer** (all 18 feeds froze on the same date — and `200 []` would
pass a status-code check while carrying nothing, the P157 class); **expect a loud, real first run**
and rank rather than suppress it; and **grep the other `lcc_check_*` functions for the same
exclusion shape**, naming them without fixing them.

## 2026-08-28 (later) — B5 SHIPPED and found a destructive trigger on the way; B6 swept 19 signals; the two windows produced CONTRADICTORY measurements of one population and B5 wins.

Evidence: [`B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`](../audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md) ·
[`B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`](../audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md) ·
new contract [`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) · playbook **Class 21**.

**⚠️ THE HEADLINE IS A BUG, NOT THE FEEDER.** `trg_propagate_ownership_to_property` (gov, AFTER
INSERT) had **no guard on `NEW.recorded_owner_id`**, so any dated `ownership_history` row naming its
parties **as text** — which is how `gsa_lease_diff`, `deed_extraction` **and B5** all write —
**overwrote `properties.recorded_owner_id` with NULL.** Silently, no ledger, unrecoverable.
**7,567 live rows are already in that shape**, and **B5's first run alone would have destroyed the
recorded owner on 1,446 of the 9,312 gov properties that hold one (15.5%).** Proven on property
7370 in a rolled-back transaction, fixed fill-forward, positive-controlled both directions.
**Verified live: the guard is in place and `props_with_recorded_owner` held at 9,312.**

**B5 shipped, and every claim verifies independently:** gov `ownership_history` **16,177 → 18,953**
(+2,776 rows / 2,000 properties) · transitions view **9,595 → 12,371** rows, **4,698 → 5,555**
properties (**+857 with a first transition ever**) · view-level 2+ links **1,376 → 2,118** ·
re-plan 0 · reversal round-tripped on 5 real rows first. My ceiling graded **down**: 3,080 → 2,776,
2,114 → 2,000.

**⚠️ THE LCC SIDE HAS NOT MOVED AT ALL, AND WILL NOT UNTIL THE RAILWAY REDEPLOY.** Verified:
facts **14,076**, lane completed **1,302**, open **579**, gov `chain_2plus` **178**, `any_history`
**2,238** — all identical to pre-B5. **527 of 579 open tasks carry a pre-B5 draft**, and the drafter
only prepares `fresh = open ∧ undrafted` — **the stale-draft trap for the THIRD time** after A4b and
A2b. `runB5RedraftPass` fixes it, is keyed on STATE (so it catches the next source too), and **is
JS: without the deploy B5 converts on 52 tasks, not 579.**

**⚠️ AND THE TWO WINDOWS MEASURED ONE POPULATION AND DISAGREED BY 10×, WITH NEITHER SIDE ERRORING.**
B6 §6 could not reproduce B5's ceiling, found `ownership_change_stub*` at 34% of the source
population (a mechanism gov R37 retired, minted **from** ownership history — so circular), and
recommended *"RESIZE BEFORE BUILDING; may not clear the bar."* **B5 had already shipped.**
Adjudicated live: **2 of 2,776 rows (0.07%)** trace to a stub; the rest are `excel_master` 1,222,
`costar_export` 625, `costar_sidebar` 141, `gov_master_backfill_r71` tail. **The decisive check was
the one that does not depend on the disputed key: 677 of the 2,000 properties had NO ownership
history at all before B5.** A duplicate cannot create history for a property that had none. §6 is
superseded in place; its scope-sensitivity table (a **26×** swing on one population and one key) is
the durable content and stands.

- **Durable:** *merged is not running* has a mirror — **in flight is not unbuilt.** Before writing
  "resize before building" about parallel work, check whether it shipped.
- **Durable:** when two honest measurements of one population disagree, **find the measurement that
  does not depend on the disputed key** rather than adjudicating the keys.
- **A2b's earliest-wins rule does NOT transfer here** — against an already-recorded pair the sale
  row is **later 217 times, earlier 34** (the opposite of A2b's 26-of-26), so B5 keys on the **party
  pair**, not the date. A rule calibrated on one population must be re-graded on the next.

**B6's own findings (19 signals, gov + dia):** most sources are already consumed (deeds **98.5%**).
Both figures I filed B6 under are **corrected** — the 38,213 landlord-change signal deflates
**28.6×** to **1,338 / 1,202 properties** (46.7% of the flag is a **pure name re-spelling** —
computed on raw string inequality, not a normalized key), and `property_sale_events`' link columns
are **`bigint` against `uuid` PKs — unpopulatable (`22P02`), not merely unwired**, with dia's twin
as the positive control at 52 populated rows. **The real gaps are four producers dead since
March–April 2026 behind an all-green health view** — `pipeline_runner` skips on an empty local
folder, logs *"Task completed"*, and emits **no run row at all**, so it has no row in
`v_pipeline_task_health`. **A failed step is a red row; a skipped step is no row.** Filed as
**Class 21** and **B6a**, and it is why nobody saw the other three for five months.
Ranked gaps **B6a–B6g**; two of seven end in *"don't build."*

**🚨 DEPLOY STATE, 2026-08-28 evening — UNKNOWN, and the first probe was worthless.**
`GET /api/ownership-chain-draft-tick` returned **`HTTP 401 {"error":"Authentication required…"}`**,
so grepping its body for `b5_redraft` found nothing **because the body was an auth error**, not
because the field is missing. **I read that empty grep as "the deploy is stale" and said so.**

- ⚠️ **This is the P182 class committed by the detector's own author, twice in two turns** — first
  reading "all written today" off an upserted `updated_at`, then reading a 401 body as a missing
  field. **A text-matching probe must carry a positive control IN THE SAME COMMAND** (here:
  `a2b_redraft`, which shipped pre-B5) **and must print its HTTP status.** A probe that cannot
  distinguish *absent field* from *never reached the handler* is not a probe.
- ⚠️ **`LCC_API_KEY` auth is ENFORCED on `/api/*` in production.** Any future behavioural deploy
  probe must either send `X-LCC-Key` or use an unauthenticated endpoint. **Use `/version` + the
  documented `git merge-base --is-ancestor <fix-sha> <deployed-sha>` check** — that is the repo's
  own doctrine for exactly this question and it does not depend on parsing a handler response.
- ✅ **ANSWERED — DEPLOYED.** Live `/version` = **`e3a0407d25bc`** (`git_pinned: true`), and
  `git merge-base --is-ancestor 385023cf… e3a0407d` returns **0** — `runB5RedraftPass` (commit
  **`385023cf`**) IS in the deployed build. **Tonight's 06:45 drafter → 06:49 apply runs with it.**
  **The check that worked took two commands and parsed nothing** — that is the standing answer to
  "is my fix running", not a handler probe.

**📋 BASELINE FOR TOMORROW'S VERIFICATION (measured 2026-08-28, post-B5, pre-conversion).** B5's
gov-side write is banked; **none of it has reached LCC yet.** Assert on the DELTA against these:

| metric | baseline |
|---|---:|
| `lcc_entity_portfolio_facts` | **14,076** |
| lane `completed` / `open` | **1,302 / 579** |
| gov `chain_2plus` | **178** |
| gov `any_history` | **2,238** |
| `human_actionable` (must stay ~flat) | **55** |
| gov `ownership_history` (source, already banked) | **18,953** |
| transitions view | **12,371 rows / 5,555 properties** |

**Read `b5_redraft`, `written_draftable`, `facts_inserted` and `tasks_completed`. Do NOT read
`already_drafted` or `links_already_present`** — both are re-discovery tallies that read exactly
like throughput (P159a). ⚠️ **Expect coverage (`any_history`) to move much harder than depth
(`chain_2plus`)** — B1 moved them +901 vs +28, and the source is mostly one transition per
property. **A big `any_history` gain with a small `chain_2plus` gain is the expected shape, not a
shortfall.** ⚠️ **`backlog_remaining: 0` is scoped to the scan window** — the lane advances only as
A2 *completes* tasks, so this is a draft→apply cycle over several nights, not one pass.

**Next prompt drafted: `B6a`** — fix the health view's blindness to SKIPPED steps **before**
restarting the four dead producers (B6b). Restarting first leaves you unable to tell whether they
stay up, because the instrument is the broken thing. Acceptance: the four known-dead producers read
RED, and the detector is **seen** red on a deliberate silence.

**Scott's standing requirement is now a contract, not an audit.**
[`docs/architecture/data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) —
**I1–I10**, a new-database onboarding checklist (the planned future domains), and the honest status:
**two of ten invariants have a standing detector.** Campaign **P0d / D1–D5** turns the highest-yield
ones into scheduled checks, D1 (the provenance producer-set diff) and D2 (the link-column type
audit) first because they are cheap and find real defects today.

## 2026-08-28 — B1a merged and refuted its own premise; then MY "we must acquire deeds" conclusion was refuted one query later. gov has never consumed its own sales table.

Evidence: [`B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md`](../audits/B1a_AMBIGUOUS_ENTITY_MERGE_2026-08-28.md);
audit **§3b/§3c** in [`BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md`](../audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md);
canonical [`ownership-history-lane.md`](../architecture/ownership-history-lane.md) §3a.

**B1a shipped and moved the wrong number.** 59 groups / 63 losers merged, `ambiguous_entity`
**126 → 57** links, **+65 completions / +66 facts** (lane **1,237 → 1,302**, `any_history`
2,173 → **2,238**). But `chain_2plus` moved **by one** — **64 of the 65 completed tasks carried
exactly ONE link.** **Duplicates constrained chain EXISTENCE, never DEPTH.** The entire remaining
A2-blocked residue is worth **12** `chain_2plus` properties, 8 of them permanently blocked by
design (the placeholder is the GRANTOR). **That closes the lane as a depth source.**

**Then I got the follow-up wrong, in the most expensive direction available.** Measuring gov's
deed layer — **876 grantor-bearing deed records of 5,804; 325 deed documents of 13,835
properties** — I concluded depth was now an **external acquisition** problem (K10 / county
fetchers) and wrote it into the audit as §3b. **It survived one more query.**

**B4 was the thread, and one `group by` answered it.** Grouping
`lcc_entity_portfolio_facts` by `ownership_source` shows dia's depth comes from
**`sales_transactions_seller_exit` — 2,207 of its 2,757 historical facts** — a feeder that closes
the SELLER's ownership interval when a sale is recorded. **gov has no such feeder.** gov
`sales_transactions`: **14,645 rows / 5,321 properties / 1970→2026, 9,514 with a named seller,
4,697 properties with a dated seller** — and `ownership_history` has consumed
**`data_source='sales_transaction'` = 169 rows, 1.8%.** Anti-joined on (property, normalized
prior-owner, exact date): **3,080 net-new rows across 2,114 properties**, against gov's current
**178** chained and **2,238** with any history.

**Filed as ⭐ B5** (B4 closed as answered; B1b re-scoped to coverage; deed acquisition **deferred,
not refuted** — it is the right answer for the tail B5 cannot reach). ⚠️ **3,080 is a CEILING** —
ID-to-ID resolution takes a share, the exact-date key inflates it via the A2b
one-conveyance-several-dates class, `gsa_lease_diff` already covers 3,704 properties, and a
seller-exit only deepens a chain where the buyer is known too. ⚠️ **The `developer` column is not
the path** — 32 rows / 30 properties.

**The durable lesson, and it is mine to own:** *"the source is exhausted"* is a claim about
**every table that could carry the fact**, not the tables named after it. I measured
`deed_records` and `property_documents`, found them thin, and recommended acquisition — the most
expensive conclusion available — while a source holding **30× more** sat one join away. It is the
A5 rule (*grep for who already writes the gap*) and the A2 rule (*check whether an existing
producer already minted the parties*) arriving as a **recommendation** instead of a code review,
where nothing catches it. **Acquisition earns the highest burden of proof.**

**Also durable:** when one domain out-performs another on a metric, **group that metric by its
provenance column before theorising.** The funnel audit could not see this at all; one
`group by ownership_source` produced it immediately.

**Scott generalised it correctly and it is a CLASS, not an incident.** Two more unconsumed gov
sources inside ten minutes: **`gsa_lease_change_facts`** — 336,303 rows, `landlord_change_flag` on
**38,213 across 8,845 leases**, **38,055 with both old and new lessor names**, spanning
**2013-02 → 2026-02**, against `ownership_history`'s 6,648 `gsa_lease_diff` rows; and
**`property_sale_events`** — **5,208 rows carrying `ownership_history_id` AND
`sales_transaction_id`, both populated on ZERO rows.** The comps↔ownership join table is modelled
and was never wired. ⚠️ 38,213 is a RAW signal — P138 flicker, A2b per-lease fan-out (the table is
keyed on `lease_number`), and name variants all inflate it.

Filed as **playbook Class 20** (*a source one domain consumes and a sibling never wired up*) and
**backlog B6** — the systematic sweep across GSA lease inventory, SAM.gov, public records, sales and
dia, covering **both** stores (comps + ownership history), with corroboration/contradiction routed
to a review lane on the **existing** authority ladder and a next-action for every detected change.
**B6 is audit + design; it builds nothing.**

## 2026-08-28 — C2e tranche one MINTED. The noise cost the floor existed to prevent is mostly not real.

Evidence: [`C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md`](../audits/C2e_ELIGIBLE_SET_ASSET_MINT_2026-08-28.md);
folded into the canonical page as **§4i**. Batch `c2e_gov_eligible_t1_20260828`, gov only, dia untouched.

**The structural finding.** `v_lcc_merge_candidates` and `v_lcc_merge_candidates_normalizer_blind`
filter **`entity_type = 'organization'`**; a minted asset is **`entity_type = 'asset'`** — so it is
**structurally incapable of entering either surface.** The merge-noise cost that justified the rent
floor **cannot occur for asset minting at all.** Measured across 2,000 entities: merge candidates
5,250 → 5,250, `auto_mergeable` 3,038 → 3,038, normalizer-blind 64 → 64, drift 0 → 0. The entire
observable cost was **+20 `v_duplicate_candidates` rows (+0.25%)** and **+23 Tier 0 cards with the
`auto` band flat at 9.**

⚠️ **This does not retire the doctrine.** *"Evidence justifies the entity"* is exactly why the mint
was eligible-set only: **2,000 minted, 2,000 resolved an owner, 0 evidence-less.** What is refuted
is the narrower claim that minting *assets* pollutes the merge surfaces.

**Verified live:** asset anchors **5,096 → 7,145**; `lcc_property_owner` **4,065 → 6,065**; distinct
owner entities **2,768 → 3,743 (+975)**; Tier 0 ask 82 → 91, auto 9 unchanged; drift 0.

### ⚠️ `auto_mergeable` now has TWO threads moving it — and this nearly read as a failed gate

I checked the gate live and got **3,005**, against C2e's reported-unchanged **3,038**. That is the
"unexplained move is a stop" condition. **It was not the mint:** `lcc_entity_merge_log` shows **64
merges in that window from the other Cowork thread** (log 66 → 130, 97 entities tombstoned), and
`v_lcc_merge_candidates` cannot see assets in any case. **C2e's claim was correct at its measurement
time.** New rule recorded in §4i: with parallel windows, *"the gate did not move"* means nothing
without a **timestamp and an attribution** — read `lcc_entity_merge_log` before claiming a delta is
yours.

### 👤 Tranche two — recommended in two steps, not run

**4,811 properties / 4,354 owners remain.** ⚠️ **Tranche one tested the SAFEST population** — its cut
landed at $543,782 of owner rent, entirely *above* the old floor, so it exercised none of the
low-rent tail the no-floor decision was actually about. **T2a (owner rent ≥ $100k: 2,570 properties,
17.2% contactable)** is indistinguishable from tranche one and covers the whole $2M–$20M sweet spot
— recommended. **T2b (below $100k + unknown: 2,241 properties, ~3% contactable, 17.8% public bodies
in the bottom band)** is Scott's call, **and the argument has changed**: C2a said stop to avoid
noise, and that premise is now measured and largely false. What remains is a judgement about
prospect quality, not technical risk.

⚠️ **Whatever runs, drive `lcc_ingest_domain_owner_evidence` explicitly afterwards** — cron 225's
400/run cap would leave a 2,570-row tranche evidence-less for most of a week.

## 2026-08-28 05:10 UTC — repository-wide consolidation on the ownership→contact chain

Scott: *"apply this to all files in the repository on the topic… consolidate the intention into one
living document… a clean and clear paper trail without older files distracting us."*

**Surveyed the whole topic: ~22 architecture docs + ~21 audits touch this chain.** I expected to find
a pile of contradictions. **I did not — and that matters, because the fix is different.** A targeted
conflict scan (the $500k floor, "producer with no consumer", the coverage percentages, `--min-rent`)
returned **zero hits** across the ten oldest candidates. They are not wrong; they are **unindexed**,
and **two of them are dangerously named**.

### ⚠️ The real hazard was naming, not staleness — and I nearly fell into it myself

**`owner-reconciliation-engine.md` does not resolve the property owner.** It resolves the **point
person** — which Northmarq broker works the deal (`lcc_entity_owner_override.owner_user_id`).
`sf-owner-capture.md` is also point-person (the Salesforce Task assignee). The property owner lives
in `lcc_property_owner`. `property-owner-subsystem.md` opens by documenting this exact confusion as
*"the finding that reframed P0.2."* Both files now carry a **NAMING TRAP** banner, and
`touchpoint_cadence_spec.md` (2026-04-13) carries one recording that **BREAK-2's "no consumer"
verdict was overturned**.

### One living document, with a topic index

**`connectivity-and-open-threads.md` is the living doc for the chain**, and it now opens with **§0 —
the topic index**: the three canonical pages and what each owns, the two naming traps, the
supporting design docs, and the full evidence trail. Anyone picking this topic up reads one file and
knows which of the twenty to open.

**Nothing was deleted.** Per `DOCUMENTATION-MAP`, an audit is *evidence for a date* and dated
evidence stays. The rule now stated on §0: **if a number in a canonical page disagrees with an
audit, the page wins and the audit gets a supersession banner in the same change** — as
`C2_CONNECTIVITY_STALL_MAP` now does.

## 2026-08-28 04:50 UTC — C2e drafted (the mint); and C2's own audit was carrying three dead claims

**C2e prompt drafted** → `prompts/C2e-no-floor-eligible-set-asset-mint-2026-08-28.md`. It implements
Scott's decision: **drop the rent predicate, keep the evidence predicate.** Mint only gov properties
whose owner **resolves on the same pass** (C2a: ~6,811 of 10,415), staged — **tranche one only
(~top 2,000 by owner portfolio rent), then measure the noise, then recommend tranche two and stop.**

**The noise measurement is the point of staging, and it has never been done.** C2a could not measure
it because nothing had been minted. The prompt requires a before/after table on
`v_lcc_merge_candidates` **and `auto_mergeable`**, the normalizer-blind population, canonical-name
drift, the Tier 0 lane, and the duplicate surfaces — with the instruction that **an unexplained
`auto_mergeable` move is a stop, not a footnote** (it has held at 3,040 through N15c, N15e, N19 and
P198, every movement explained group by group).

### ⚠️ Consolidation: the C2 audit was still asserting three things later rounds overturned

A future chat reading `C2_CONNECTIVITY_STALL_MAP` cold would have inherited all three. Now
banner-corrected at the top of that file:

| C2 said | truth |
|---|---|
| 32,289 properties · 5,144 anchors · **16%** | **25,633 · 5,096 · 19.9%** — the 32,289 included 6,657 archived gov shells; the 5,144 counted 49 identities pointing at deleted properties |
| *"`lcc_mint_gov_asset_entities` **refuses to run without `--min-rent`**"* | **False** — it takes a row list; the floor was a caller-side convention in the feeder script |
| *"**Do not simply drop the floor**"* | **The floor is dropped** (Scott 2026-08-28) — it gates on *rent*, and $500k ≈ $7.1M of value, excluding two-thirds of the $2M–$20M sweet spot |

**§1's chain shape, §2's Salesforce finding and §4's corrections still stand** — it is the
denominator and the floor conclusion that moved. That distinction is stated on the banner so the
whole file is not discarded.

## 2026-08-28 04:30 UTC — Scott's floor decision: NO rent floor, eligible-set only. And my framing was wrong twice.

Recorded as canonical **§4h**. Scott: *"My inclination is to have no minimum floor… we want to
resolve all ownership and pursue the relative next most valuable contact based on all
considerations… our sweet spot tends to be single-tenant deals from $2M to $20M, through volume with
repeat seller clients."*

### ⚠️ Two facts I had not established before recommending $250k

1. **The gate is on GROSS ANNUAL RENT, not deal value.** At a ~7% cap the $2M–$20M sweet spot is
   **$140k–$1.4M of rent** — so the **$500k floor sits at ≈$7.1M of value and excludes the bottom
   two-thirds of the target range.** A floor calibrated for *"is this worth an entity"* was never
   calibrated for *"is this our kind of deal."* **I recommended $250k without ever converting rent
   to value against the business model.**
2. **There is no `--min-rent` inside the mint.** `lcc_mint_gov_asset_entities(p_rows jsonb, p_batch
   text, p_dry_run boolean)` takes a **row list**; the floor is a caller-side convention in the
   feeder script, not a database constraint. Both C2a and I described it as a floor *in the mint*.

### ⚠️ And Scott's own example was measured and does NOT hold

*"Someone that owns 20-30 properties with rents below $250k."* Measured on gov (non-archived, with a
`true_owner_id`): of **16 owners with 20+ properties, ZERO have all properties under $250k.**
Per-owner aggregation adds only **129 owners** over the $500k per-property floor (93 at $250k), out
of 7,196. **The portfolio mechanism is not the argument — the rent-vs-value mis-calibration is.**
Both halves reported; the conclusion survives on the stronger half.

### The resolution

**The floor decides what to MINT, not who to PURSUE.** Resolving ownership broadly is cheap and
reversible; ranking who to call is `v_priority_queue`'s job, and it already weighs owner-level value,
contactability and signal. **Mint broadly, rank narrowly** — which is exactly what Scott asked for.

**DECISION: no rent floor, eligible-set only** — mint the ~**6,811 of 10,415** gov properties whose
owner resolves on the same pass; skip the ~3,600 that would resolve nothing and match the retire
predicate on day one. Backlog **C2e**.

⚠️ **The one real cost is unmeasured and must be measured on the first tranche:** ~6,811 entities is
**+11% on a 62,368-entity graph**, landing on `v_lcc_merge_candidates`, search and every count
surface. **That is the gate's entire purpose and has never been quantified** — C2a had nothing
minted to measure it on. Stage the mint; gate tranche two on tranche one's measured noise.

⚠️ **gov only. Do not sweep dia in** — 84% of its un-minted owner slots hold an OPERATOR (P113).

## 2026-08-28 04:00 UTC — C2a landed; and the "$500k floor" turns out to be FIVE knobs, not one

Evidence: [`docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](../audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md).
Folded into the canonical page as **§4f**. **Nothing minted, no floor changed.**

### ⚠️⚠️ Cross-thread collision caught — read this before touching any floor

`CLAUDE.md` (P161) states these are *"the same $500k knob as the gov asset-mint and
`CADENCE_SIGNAL_MIN_VALUE` — one number, not three."* **Measured today, that is FALSE as
implemented — there are FIVE independent objects sharing a value:**
`lcc_mint_gov_asset_entities --min-rent` (CLI) · `gov_research_gate_value_floor()` + its dia twin ·
`lcc_weak_role_value_floor()` · `lcc_chain_human_value_floor()` · `CADENCE_SIGNAL_MIN_VALUE` (env).

**And two Cowork threads are proposing to change two different ones this week** — **C2a** (this
thread) wants the asset-mint floor at $250k; **B1** (the automation window, prompt already drafted)
wants to split the *research-gate* floor by consumer. **Changing one does not move the others, and
the docs say it does.** Recorded as canonical §4g; fixing the CLAUDE.md sentence is backlog **C2d**.

### C2a corrected C2's own denominator

**32,289 / 16% included 6,657 ARCHIVED gov shells** that every feeder filters out by design — and
that are genuinely empty (2 of 6,657 carry a `true_owner_id`). Live: **25,633 properties, 5,096
anchors, 19.9%**. Conclusion unchanged; the quoted number was wrong. *(The 5,144 also counted 49
identities pointing at deleted properties.)*

### The finding: the resolve rate holds — the OWNERS degrade

gov technical resolution stays **58–76%** from $500k to under $50k, so *"does it still resolve"* was
the wrong question. What collapses is owner quality: **already-contactable owners 21.8% → 6.8% →
1.6%**, owners known outside the gov feed 9.7% → 1.3%, and the named rows become **cities, counties,
state DOTs, FedEx and private individuals**.

| floor (cumulative, gov) | minted | resolve | rate | net-new owners | already contactable |
|---|---:|---:|---:|---:|---:|
| ≥ $500k *(today)* | 1,779 | 1,218 | 68.5% | 928 | 170 |
| **≥ $250k** | 3,061 | 2,102 | 68.7% | **1,629** | **323** |
| ≥ $100k | 5,606 | 4,034 | 71.9% | 3,178 | 564 |

⚠️ **Mint the ELIGIBLE SET, not the band.** `lcc_mint_gov_asset_entities` takes its own row list, so
a $250k run mints the **2,102 that resolve on the same pass**, not 3,061 of which 959 sit
evidence-less and match the documented retire predicate on day one. That is the difference between
honouring *"evidence justifies the entity, never the reverse"* and merely citing it.

⚠️ **dia is a different problem and no floor fixes it** — **84% of its un-minted owner slots hold an
OPERATOR** (P113) and 73% of the would-resolve population has no rent on file. **Change nothing on
dia**; its levers are `is_operator_not_owner` and rent coverage (A5e).

**👤 The floor decision is Scott's.** Recommendation: **$250k now → re-measure → $100k as the hard
floor, never below.**

## 2026-08-28 03:20 UTC — C2a drafted; and the consolidation pass overturned a live verdict

**C2a prompt drafted** → `prompts/C2a-asset-mint-floor-resolve-curve-2026-08-28.md`. Pure
measurement: **at what rent floor does a minted asset actually resolve an owner?**, banded by domain,
with the operator exclusion, denominators stated per band, and a positive control. **Mints nothing;
the floor decision stays Scott's.**

### ⚠️ The consolidation caught two stale claims in the canonical connectivity doc

`docs/architecture/connectivity-and-open-threads.md` **already owned this topic** — its §4b is
literally *"the asset → owner → contact → cadence chain"*. So C2 was folded in as **§4e** rather
than left beside it, and the audit now banners to the canonical page. Two corrections that a future
chat would otherwise have inherited:

- **⚠️ BREAK-2's verdict is OVERTURNED.** It concluded *"cadence is a producer with no consumer
  (doctrine violation)"*. **Scott, 2026-08-27: the cadence layer is "absolutely a huge part of this
  build."** The layer is **intended and un-built-out, not orphaned** — it reads empty because Scott
  has not begun using LCC for BD, the effort so far having been the build itself. **So "1,728 never
  touched" measures an un-started pipeline, and the remedy is to finish the consumer, not to gate
  the producer harder.** A future chat reading BREAK-2 cold would have moved to retire it. The
  genuine defects it found still stand: the future-dated `last_touch_at` writer, `owner_user_id`
  present on only 7 rows, and cadences on unreachable parties.
- **⚠️ BREAK-3's "49.2% owner resolution coverage" is *of ASSETS*, not of properties.** It reads
  1,910 of **3,886 assets**; against all **32,289 properties** the same coverage is **13%**. They
  differ ~6× and both are correct. A denominator warning now sits on that heading — this is the same
  scoping trap that made me quote "101 contacts / 157 cadences" when the fleet-wide figures are
  **1,439 and 2,302**.

**Backlog rows C2a / C2b / C2c** carry the measurement, the Salesforce bridge, and the explicitly
unmeasured list.

## 2026-08-28 03:00 UTC — C2: the connectivity stall map. The gate is ASSET IDENTITY, not contacts.

Full writeup: [`docs/audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md`](../audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md).
**Diagnosis only — nothing written.** Scott reframed the target: measure where the chain
*property → recorded ownership → SPE/LLC control → true owner → the right contact → the right
prospecting bucket and broker → relative priority* actually stalls.

**It stalls at hop 3, and everything downstream is starved by it.**

| hop | count | of prior |
|---|---:|---:|
| properties (gov 20,493 + dia 11,796) | **32,289** | — |
| dia `true_owner` rows that are actually OPERATORS (P113) | 7,941 of 10,293 | — |
| **LCC asset anchors** | **5,144** | **16% of properties** ⚠️ **THE GATE** |
| resolved property→owner rows | **4,065** | 13% |
| distinct owner entities | 2,768 | |
| **owners with an active contact** | **1,439** | **52% of resolved owners** — the healthy hop |
| cadences | 2,302 | |

**⚠️ The Salesforce book is connected to the wrong side.** 9,793 SF-linked people are in LCC, 9,491
with an email, **9,129 (93%) carry a relationship edge — but only 669 (6.8%) reach a resolved
property owner.** They are attached to their employer org via the `works_at` Salesforce-account edge
(the same bare-SF signal **P112** disqualified and **P161** gated out of reachability). **The bridge
has no far bank**: there are only 4,065 property→owner rows for 32,289 properties. Contact
acquisition is *not* the bottleneck.

**The 16% is a DECISION, not a defect.** `lcc_mint_gov_asset_entities` **refuses to run without
`--min-rent`**, and CLAUDE.md states the doctrine directly — *"evidence justifies the entity, never
the reverse"* and *"asset-identity coverage is what gates owner resolution."* ⚠️ **Do not simply
drop the floor** — minting ~27,000 evidence-less assets re-creates the noise the gate prevents. The
measured question is **at what rent floor a minted asset actually resolves an owner**: P141 saw
**612 of 663 resolve at $500k (92%)** and no degradation in lower bands on small samples. Extending
that curve is the input to the decision.

### ⚠️ Corrections to my own earlier figures in this thread

- **"101 owners with a contact / 157 cadences" was scoped to owners above the $500k floor.**
  Fleet-wide it is **1,439 pivot contacts and 2,302 cadences** — ~10× larger. Both correct about
  different populations; quoting the scoped one as the system total understates it badly.
- **Two instrument errors preceded this map**, both caught only by reading named rows: counting
  *any* linked entity as a "person" returned **addresses** (`2 Mill St, Lawrence, MA 01840`) and
  inflated an "unclosed loop" **56×**; and `activity_events` attributes 23,232 events to just **253
  distinct people**, so it cannot answer "do we correspond with this person" — `email_bodies`
  (5,509 distinct addresses) is the record, keyed by **address**.

**Not measured, stated so nobody assumes it was:** historical ownership depth on dia; the
developer/investor/buyer prospecting-type split; Outlook/WebEx per contact (WebEx is not in the
schema at all); whether the 2,302 cadences carry a correct broker.

## 2026-08-28 02:30 UTC — N15d: the producer is proven fixed, by CONTROL rather than by wall clock

**The date rolled over and the check is finally readable — but the decisive evidence is not the
elapsed window.**

**Wall-clock arm (weak, and stated as weak):** 6.41 hours since the trigger, **2 entities created**,
**both keyed correctly**, `v_lcc_canonical_name_drift` still **0**.
`JACO SAVANNAH REALTY, INC.` → `jaco savannah realty`; `asset 4477` (gov mint) → `asset 4477`.
⚠️ **Neither is a case where the old and new normalizations DISAGREE**, so this shows the trigger
breaks nothing — it does not by itself show the trigger *corrects* a drifted writer. Two rows is a
thin sample and is reported as such.

**Positive-control arm (decisive).** A row was inserted through the real writer path carrying a
**deliberately wrong** `canonical_name` — `century park` — exactly what the outgoing aggressive
normalizer produces, inside a self-rolling-back transaction:

> **writer supplied `century park`; the trigger stored `century park partners`; corrected = true.**
> Residue after rollback: **0 rows.**

**The trigger overrides a drifted writer on a live insert.** That is the mechanism proven, not the
absence of failures inferred — the distinction the N15d audit itself drew when it refused to claim
a pass off an empty population.

### ⚠️ And the control closes the exact hazard CLAUDE.md has warned about for months

`Century Park Partners` vs `Century Park Properties LLC` is *the* documented example of why
`lcc_normalize_entity_name` is banned for identity. Measured on the live rule:

| name | new key (live) | old aggressive normalizer |
|---|---|---|
| `Century Park Partners LLC` | `century park partners` | `century park` |
| `Century Park Properties LLC` | `century park properties` | `century park` |

**`would_falsely_link = false`.** Under the old rule both collapse to `century park`, so
`ensureEntityLink` would have linked two different companies **automatically, with no human
review**. That failure mode is now closed and demonstrated side by side.

**Verdict: N15d substantially passed.** The producer is fixed — mechanism proven and no drift over a
real production window. A full-day wall-clock read is still worth taking (daily mint counts range
0–8), but the risk it was guarding is materially retired.

⏳ **Still pending: cron 241 at 06:55 UTC** — `tier0_auto` writes remain **0**; that window has not
come round yet today.

## 2026-08-27 22:25 UTC — N19 executed: 14 groups merged, and Montecito Medical came into view

Scott approved the 19 signal-bearing pairs. **⚠️ They were not 19 pairs — they were 14 GROUPS**, and
merging pairwise would have been wrong: `National Government Properties` had an entity that is a
*loser* in one pair and a *winner* in two others, and `American Realty Capital`'s single loser
mapped to **three different winners**. Resolved to one winner per `(canonical key, entity_type)`
group by P195's ownership-first rule, then merged every other member in. **22 losers, all
reversible.**

| | before | after |
|---|---:|---:|
| live entities | 62,368 | **62,346** (−22) |
| `lcc_entity_merge_log` | 44 | **66** (+22) |
| **National Government Properties — relationships** | 349 | **358**; 2 assets, $4,246,846 |
| **American Realty Capital — relationships** | 87 | **95** |
| collision pairs remaining | 73 | **45** (the 24 husks + 9 cross-type) |
| `canonical_name` drift | 0 | **0** |
| Tier 0 ask / auto | 82 / 9 | **82 / 9** |

### ⚠️ Two gated counters moved, and both are the merge WORKING

- **Parked 137 → 141.** All four new cards are **Montecito Medical**. Before the merge its
  **$1.62M of rent sat on a different entity from the one carrying its domain candidates**, so the
  candidate-bearing entity was below the $500k floor and produced no cards at all. Consolidated, one
  entity now carries both and enters the Tier 0 population with 4 domain cards (2
  `employer_on_file_differs`, 2 `no_employer_on_file`). **An owner that was invisible because its
  value and its people lived on separate rows** — precisely the class this arc exists to fix.
- **`auto_mergeable` 3,040 → 3,038.** Verified: **0 of tonight's 14 winners still heads an
  auto-mergeable group**, and **0 winners were themselves merged away** — the −2 is exactly the two
  groups this pass resolved.

**Held deliberately: the 24 husk pairs** ($0 rent, ≤5 edges) and the **9 cross-`entity_type` pairs**
(`David Siegel`, `Dennis Needleman`, `Constance Cincotta`, `Alexandria` each exist as both a person
and an organization — a shared key is correct, identity is not).

⚠️ **Two naming oddities surfaced and are NOT merge questions:** `Constance Cincotta` is typed
**organization** while also existing as a person, and `Alexandria` is typed **person** though it
reads as a city. The org↔org and person↔person merges are still correct — these are data-quality
items for the junk/naming lane, recorded so they are not mistaken for merge errors.

## 2026-08-27 22:10 UTC — N15d still vacuous; the N15e collision set is the actionable output

### ⏳ N15d re-checked and it is STILL not readable — 2.08 hours, ZERO entities created

Measured 22:09 UTC: **0 entities created since the trigger went live at 20:05**, so the detector
still has an empty population and would return 0 regardless of what the producer does. **Not run,
not claimed.** The wall-clock arm remains due 2026-08-28, and this second empty read is itself
evidence the ~4/day rate is bursty rather than steady — a full day is the minimum honest window.

### ⭐ The 47 entities / 73 pairs N15e surfaced are a real, value-ranked decision set

`v_lcc_n15e_canonical_collision_candidates`, split:

| slice | pairs | note |
|---|---:|---|
| byte-identical **and** same `entity_type` | **46** (43 unordered) | the safe population |
| …of those, carrying **rent** | **6** | **$8.13M** combined |
| …no rent but real deal history (>5 edges) | **13** | |
| …husks (≤5 edges, no rent) | **24** | batch-able |
| **cross-`entity_type`** | **9** | ⚠️ **never merge** — person↔organization |

**Head of the list is the Gardner shape again: `National Government Properties` — 2 assets,
$4.25M rent, and 354 relationships across the pair.** A firm in the core government market whose
deal history is split, invisible until the key collapsed. Then `Montecito Medical` ($1.62M, and it
appears in two pairs so it may be a 3+ member group), `American Realty Capital` (×2),
`1121 California Avenue LLC`, `DP Brighton LLC`, `The Fischbach Company LLC`.

**695 relationships sit across the 43 pairs.** This is the same class as N3h — duplicates carrying
transaction history that the survivor under-reports (P177) — and it is the direct product of N15c
+ N15e collapsing the key. **Nothing merged; awaiting Scott.**

⚠️ **The 9 cross-type pairs are excluded by construction, not by judgement.** `David Siegel`,
`Dennis Needleman`, `Constance Cincotta` and `Alexandria` each exist as both a person and an
organization. A shared canonical key is correct there; treating it as identity is the person/org
conflation `sf-account-link.js` exists to prevent.

## 2026-08-27 20:45 UTC — N15e and N18 both landed; and BOTH corrected numbers I had briefed

Audits: [`N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md`](../audits/N15d_N15e_PRODUCER_VERIFY_AND_HELD_RECOMPUTE_2026-08-27.md)
· [`N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md`](../audits/N18_ATTRIBUTED_RENT_SELF_COMPARISON_2026-08-27.md).

### N15e — applied. Every live entity now keys correctly.

**537 rewritten, `v_lcc_canonical_name_drift` 537 → 0, no class at all.** All 62,368 live entities
key to `lcc_entity_canonical_key(name)`. Gates: `auto_mergeable` **3,040 → 3,040**, Tier 0
**82 / 9 / 137 unmoved**, `lcc_owner_domain_core` byte-identical (same md5 before and after),
ledger 537/537, round trip run and rolled back, suite 4,772 pass. **47 entities / 73 pairs**
surfaced as duplicate candidates — surfaced, not merged, as specified.

### ⏳ N15d did NOT pass — and refusing to claim it did is the right call

The trigger landed 20:03–20:05 UTC; the check ran at 20:26. **Elapsed window 21 minutes, entities
created in it ZERO.** At ~4/day — one per six hours — a detector over an empty population returns 0
regardless of what the producer does. **That is exactly the Class 11 "a detector that cannot fail is
not evidence" trap, and reporting a pass would have been literally true and completely
uninformative.** **The wall-clock re-run is still due 2026-08-28**, and even a full day at ~4/day is
weak (daily counts range 0–8).

⚠️ **N15b's recurrence query is not published**, so "re-run it" was not literally executable. Three
reconstructions were built against pre-backfill values rebuilt from the ledger; all three reproduce
the burst (1,760–1,789 vs 1,789) and the most-recent date exactly, and put the trickle at **70–94
against the quoted 79**. Quote the band, not the 79 as if reproduced.

### ⚠️ My briefed UNIQUE figure was stale — 3,930 is now 6,608

I wrote *"3,930 groups violate it today"* into both the backlog and the N15d prompt. That is the
**pre-N15c** number: **collapsing keys is precisely what creates collisions.** 3,930 → **6,584**
after N15c's backfill → **6,608** after N15e. **The honest input to Scott's UNIQUE-key decision is
6,608**, 68% above the figure the question was framed against. My own dated-claim trap, caught on a
number rather than a blocker, and one query would have caught it.

### N18 — fixed, and it corrected the mechanism I had described

**1 → 5 distinct values** ($431,643 – $2,226,661); **1,602 ms → 128 ms**; buffers **2,102,242 →
3,904**. Guard `test/sql-self-comparison-guard.test.mjs`, 5 mutations verified RED.

⚠️ **The fabricated value is the domain-wide MAX, not the SUM** — N15c §6 said "sum" and **I
repeated it in the N18 brief**. The gov-wide sum is **$3.52B**; $34,920,891.77 is the gov-wide
`max(annual_rent)`. The real shape is `props × domain_max`. ⚠️ **And "one distinct value" was a
property of the surviving 6-row slice, not an invariant** — all six carry `props = 1`; across the
full 277-candidate population the broken expression takes **11 distinct values, up to $279M**. The
Class 11 signal was real; the explanation attached to it was not.

⚠️ **The ranking was not merely wrong, it was arbitrary.** Both sort keys were constant, so the
"value-prioritized" worker returned whatever the plan emitted. Corrected, **every position moved
except rank 4** (Heritage 5→1; one row overstated 20.4×).

⚠️ **It was a LIVE-ONLY defect — the repo never carried it.** The newest committed body was correct;
the live view had been hand-patched twice and never committed. Same class as the gov A4b migration
found this afternoon. A rebuild from the repo would have silently reverted N15c's repoint
(**267 → 196**). The migration therefore carries the WHOLE view body.

**Recorded as playbook Class 19** — *a predicate that constrains nothing* — with the detector, the
comment-stripping caveat, and all three traps.

## 2026-08-27 20:25 UTC — two prompts drafted; and the N15e objection shrank under measurement

**Two prompts, deliberately not three.** `prompts/N15d-producer-check-and-held-row-recompute-2026-08-27.md`
folds N15d and N15e into one because **N15d GATES N15e** — if the producer is still minting
key-disagreement duplicates, recomputing the residue is polishing the output of a live leak. The
prompt says stop-and-report if Unit 1 fails. `prompts/N18-developer-attributed-rent-self-comparison-2026-08-27.md`
is the second.

### ✅ Scott approved recomputing the 537 — and the measurement makes it a stronger yes

The stated objection was *"recomputing discards a captured string some of them preserve."*
Measured: that applies to **58 of 537 (11%)**, not all of them — and
`lcc_n15c_canonical_backfill_log.old_canonical_name` **already preserves the old value**, so for
those 58 nothing is destroyed; it moves from a key column to a ledger, which is where provenance
belongs. **A dedup key is not an archive.**

**⚠️ 39 held rows will collide with a live entity, and that is the BENEFIT.** Read on named rows,
the collisions are **byte-identical names the stale key was hiding**: `1121 California Avenue LLC` ↔
`1121 California Avenue LLC`, `Alex Lyman` ↔ `Alex Lyman`, `Crest Properties` ↔ `Crest Properties`,
`Block RE Services` ↔ `Block Re Services`. The prompt requires them **surfaced, never merged** —
merging stays a human confirm through `lcc_merge_entity`.

**⚠️ Several collide ACROSS `entity_type`** — `David Siegel`, `Dennis Needleman`,
`Constance Cincotta` and `Alexandria` each exist as both a **person** and an **organization**. A
shared key is correct; reading it as identity is the person/org conflation `sf-account-link.js`
exists to prevent, and the prompt forbids a cross-type merge proposal. And **`American Realty
Capital` colliding with `American Realty Capital Trust` is Scott's adopted rule working**, not a
defect — named so nobody "fixes" it later.

### N18 confirmed still broken, live

`v_lcc_developer_classification_candidates.attributed_rent`: **6 rows, exactly 1 distinct value —
$34,920,892**, the gov-wide sum, on every row. The predicate correlates
`pof.source_property_id = pof.source_property_id`, a column against itself. A single distinct value
across every row is the Class 11 signal. It is also ~1,509 ms of the view's 1,666 ms (a P118
correlated subplan at `loops=385`). The prompt requires the corrected **ranking** to be graded on
named rows — an operator has been classifying against a constant.

## 2026-08-27 20:05 UTC — N15c COMPLETE: `canonical_name` has ONE writer, live

Full writeup: [`docs/audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md`](../audits/N15c_CANONICAL_NAME_SINGLE_WRITER_2026-08-27.md).
**The trigger is applied, the backfill has run, and every gate held.**

**Deploy precondition verified BEFORE applying the trigger, not assumed.** Live `/version` on
`tranquil-delight` returns **`d8fcfbfef94a`** — the N15c merge commit itself — and `git_pinned` was
corroborated by reading the SOURCE at that sha: `legacyCanonicalName` + the dual-read
`canonical_name=in.(current,legacy)` present, the `entities-handler.js` inline copies gone,
`sync.js`/`domains.js` routed through the shared function. That check is the whole reason the order
was safe (P131: *check the fix against the deployed sha*).

| gate | result |
|---|---|
| **invisible to `ensureEntityLink`'s own lookup** | **10,336 → 537** — and the 537 are *exactly* the held rows |
| `v_lcc_canonical_name_drift` | only `held_stale_name_repair` = **537**; nothing else |
| rows rewritten / ledgered | 15,402 / **15,402** (reversible by `batch_tag='n15c_go'`) |
| **`auto_mergeable`** | **3,040 → 3,040** — the gate that proves the merge detector was untouched |
| Tier 0 lane | ask **82** / auto **9** — unmoved |
| rows keyed to the empty string | **114 → 0** (98 now on the `dc:` namespaced fallback) |

**Named rows read correctly, including Scott's decision:** `Rainier Rockford DST Trust` and
`Rainier Rockford Llc` **both key `rainier rockford`** — a DST and its LLC are one true owner, as
decided. `671 Poplar LLC` → `671 poplar`; `BALTARA ENTERPRISES, L.P.` → `baltara enterprises l p`.

**⚠️ The writer census was wrong three times running — 7 → 8 → 10**, plus a twelfth normalization
hiding in a dead defensive ternary in `operations.js`. `api/sync.js` and `api/domains.js` were both
missed by grep. **That is the argument for fixing it at the DATABASE**: a `BEFORE INSERT OR UPDATE
OF name` trigger does not care how many writers exist, and it closes the staleness class in the
same stroke. It returns `NEW` unconditionally (P196) and is `UPDATE OF name`, not a bare `UPDATE`,
so the 537 held rows stay held.

**A real firm was rescued from the empty key.** 114 entities shared `canonical_name = ''` — among
them **18 copies of `Partners Group`**, a real firm whose two semantic tokens are *both* stripped by
the outgoing normalizer, leaving it keyed identically to `--` junk. It now keys `partners group`,
which also makes it visible to the merge detector for the first time — **that is N10's held
`partnersgroup` group**, now groupable.

**⏳ The Class 8 check is tomorrow, and it is the one that matters.** A backfill is not a fixed
producer. Re-run the recurrence query: post-fix mints of disagreeing pairs should read **0** against
the pre-fix **~4/day** (79 in 21 days — never the burst-blended 1,879/30d, off ~24×).

**👤 Two decisions still Scott's:** the **537 held rows** (`canonical_name` left stale after `name`
was repaired — recomputing discards a captured string some preserve, e.g. `Scott W. Beynon` still
keyed `buyer contactsscott w beynon 801 568 1031 p`), and whether `canonical_name` becomes an
**enforced UNIQUE key** (3,930 groups violate it today).

## 2026-08-27 19:15 UTC — N15c drafted: the BUILD prompt, and two measurements that changed its shape

**Lane split confirmed with Scott:** this thread continues the **N15b → N15c** line (entity
identity / `canonical_name`); **the other thread owns A5 and the `gap_resolved` auto-close class**
(playbook Class 18). N15c says so explicitly and tells Claude Code not to touch
`handleGenerateResearchTasks` or the research lanes.

**Checked first that the build was unclaimed** — no N15b/N15c migration, no competing prompt, and
`lcc_r2_w1_canonicalizer_source_registry` (which *sounds* like this machinery) is provenance
bookkeeping for `field_source_priority`, not a dedup key. Reviewing existing machinery before
building, per doctrine.

**⚠️ Two live measurements changed the prompt's shape, and the first would have been a real bug:**

- **Do NOT point `canonical_name` at `lcc_owner_domain_core`.** N15b recommended it and Scott's
  decision endorsed its *token rule* — but the function ends `string_agg(tok, '')`, **no
  separator**. It matches only **1,973 of 62,368** rows today. Measured over 43,219 organization
  entities: **space-joined gives 37,519 distinct keys, no-separator gives 37,404 — those 115 fewer
  keys are false collisions** (the `Gate Way`/`Gateway` hazard). The adopted key is the **token
  stoplist, joined with SPACES**, built as **one token list with two join styles** so
  `lcc_owner_domain_core` keeps byte-identical output for P187/P188/P198.
- **The writer census missed one — there are EIGHT.** `field_source_priority` carries
  `entities.canonical_name → w8_u5_naming_hygiene@40`. It also means this column sits inside the
  provenance system, so the new writer must be registered or `v_field_provenance_unranked` flags
  drift.

Also sized for the prompt: **75 organization entities reduce to an empty key** under the adopted
rule and need a named fallback (the P189 blind-spot precedent). And the producer is confirmed live
again — **+5 live entities in ~40 minutes** between two of today's measurements.

**Still Scott's, and the prompt says surface-don't-guess:** the 540 stale rows (recomputing
discards a captured string some preserve) and whether `canonical_name` becomes an enforced UNIQUE
key (**3,930 groups violate it today**).

## 2026-08-27 19:00 UTC — A5 was ALREADY DONE and I recommended re-sending it; playbook Class 18

**⚠️ My recommendation to send A5 to Claude Code was wrong — it had already completed and merged**
(PR #1840, `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`, 182 lines, plus 50 lines
into `CLAUDE.md` and 8 into the backlog). **The prompt file was still sitting in `prompts/`
un-filed, and I read the prompt folder as the record of what is outstanding.** It is not — the
**audit** is. Filed to `done/` now. *Check `docs/audits/` for the round's output before
recommending that a prompt be sent.*

### Why A5 matters more than the filing slip: two "healthy" lanes were instrument readings

**`815 open` is `1000 − 185`** — the leftover of a truncated window. `handleGenerateResearchTasks`
reads a **29,643-row** feed with `limit=2000`, PostgREST caps the response at **1,000**, and the
auto-close guard is written `if (feed.length < limit)` → **1000 < 2000 → true**, so it fires over a
truncated slice and closes everything outside it as `gap_resolved`. **All 596 "completions" are that
auto-close; 170 of 183 sampled owners still have `salesforce_id IS NULL` — 93% false.**

**⚠️ And it invalidates the lane the re-audit had just called healthiest.** gov
`property_missing_recorded_owner` — *"908 completions in 30 days, ~23/day, clears in ~7 weeks, leave
it alone"* — has its open count pinned at **exactly 1,000**, **885 of 885** completions are the same
auto-close, and **146 of 146** sampled properties still have `recorded_owner_id IS NULL`. **Zero
real work in 30 days, and it cannot clear, because its open count is a constant.**

Recorded as **playbook Class 18** — *an open count that is really a query window, and a terminal
status nobody earned*. The durable rules: **compare the guard against the RETURNED row count, never
the limit you asked for** (same footgun as `CAND_LIMIT = 1200`, P123); **check who writes the
terminal status before ranking lanes by completion rate** — the re-audit switched to rates
specifically to avoid being fooled and was fooled anyway; and **a round number is a bug signal**.

### Parallel windows — the division, for the record

Two Cowork threads plus Claude Code share this repo. **This thread is the P-series** (P186–P198,
Tier 0 owner-contact, entity merges). **The other thread is the A-series** (A0–A5, the
ownership-history lane and the automation re-audit) — branches `docs/reaudit-and-a5-diagnosis`,
`docs/kickoff-refresh-and-a2b-a4b-reconcile`. Claude Code lands on `claude/*` branches.
**Neither chat reads the other; the handoff is the repo** — `CLAUDE.md`, `STATUS.md`, the canonical
pages and the playbook. That is the design, and it is why a prompt left un-filed causes a
cross-thread duplicate-work risk (§4a's "check whether the other audit window already fixed it",
now demonstrated on a prompt rather than a workflow file).

## 2026-08-27 18:45 UTC — the gov lock hid a migration that was RUNNING BUT NOT MERGED

Clearing GovernmentProject's orphaned `.git/HEAD.lock` (0 bytes, sandbox-owned, dated **2026-08-20**)
revealed **two files staged and never committed**:
`sql/20260827_gov_a4b_transition_clean_legal_form_gate.sql` and
`tests/unit/test_a4b_transition_clean_gate.py`.

**⚠️ `add` and `commit` take DIFFERENT locks.** `add` takes `index.lock`; `commit` takes
`HEAD.lock`. With an orphaned `HEAD.lock`, **staging succeeds and committing fails — and
`git status` looks tidy**, which is why this sat for a week without anyone noticing.

**Verified live before assuming a gap: the gov database is CORRECT.** All three functions exist on
`scknotsqkcheojiaewwh` and read **8 of 8 on named rows** — `EGP 17101 BROOMFIELD LLC`,
`CA-10880 WILSHIRE LIMITED PARTNERSHIP` and `JBG/12420 PARKLAWN, L.L.C` clean; `Houston, Harris
County, Texas 77007` and the other two junk names rejected.

**So this is the MIRROR of the doctrine this repo documents everywhere.** CLAUDE.md carries
*"merged is not running"* in several places; this is **running and not merged**. A DB-only change
ships instantly, which is precisely why nothing forces the commit, and the repo quietly stops being
a record of what the database does. Recorded as gov `CLAUDE.md` critical rule **12**, plus a row in
`GITHUB-WORKFLOW.md`'s error table. **The check is `git log --oneline -3 -- sql/<file>`, never "the
function works."** Same family as P194: a second copy that is correct beats no copy at all.

## 2026-08-27 18:30 UTC — N15b decision 1 ANSWERED; N17 recorded; and a false "lost work" alarm

**✅ Scott's decision on the N15b token rule: a DST, its Trust and its LLC are ONE entity — the
TRUE OWNER.** `Rainier Rockford DST Trust` = `Rainier Rockford Llc`; `SE VALPO LLC` = `Se Valpo
Dst`; Syndicated Equities likewise. **So `lcc_owner_domain_core`'s `trust|dst|reit` strip is
CORRECT and is the adopted rule** — what the N15b audit listed as that rule's "named residue" is
the *desired* behaviour, not a defect. N15b is now **ready to build**; decisions 2 (recompute the
540 stale rows) and 3 (enforce UNIQUE — 3,930 groups violate it today) remain open.

**New backlog row N17 — the aspirational feature, recorded so it is not lost:** individual
investors as direct owners in our target markets, *and* knowing they hold **partial positions in a
DST / TIC / JV** on similar deals. ⚠️ **This must NOT be built by splitting the `canonical_name`
dedup key** — that decision went the other way. Fractional interest is a **relationship, not an
identity split**: model it on `entity_relationships` the way `lcc_owner_sponsor_domain` models
sponsor→SPE. Unsized.

### ⚠️ A false "my edits were lost" alarm — the third instrument failure in this arc

After the two genuine lock incidents, the reflex became *rewrite it.* **Wrong twice running.** A
`grep -rl` over a file list containing one non-existent path exited **2**, the `$( )` came back
empty, and the loop reported **`MISSING` for every pattern** — including ones plainly present.
Harness "changed on disk" notices rendered a **cached older copy** and corroborated it.
**The data was fine**: disk and `HEAD` both matched (`grep -c` 2 = 2), local `HEAD` == `origin/main`,
mtimes seconds old. **Rule added to `GITHUB-WORKFLOW.md` §2a: before concluding content was lost,
compare DISK against HEAD with `cat-file` — index-free and safe — and never trust a `grep -rl`
sweep over an explicit file list.** Nothing was rewritten.

**👤 GovernmentProject has an orphaned `.git/HEAD.lock`** — 0 bytes, owned by the sandbox uid,
dated **2026-08-20 12:32**, i.e. a week old. Same class as the life-command-center incident; the
sandbox cannot remove it. PowerShell one-liner supplied.

## 2026-08-27 17:05 UTC — N15b landed (measurement only); N3h executed; Gardner's deal history reunited

### N3h — 9 merges, and the one that mattered

Scott approved; all 9 merged, **all 9 reversible**. **Gardner Tanenbaum Holdings: relationships
270 → 512 (+242)**, assets 17 → 22. That firm's transaction history was split across two live
entities, so the survivor every surface points at was reporting **half its own deal history** — the
P177 failure, and prospecting ranks on precisely that signal. Live entities 62,365 → 62,356;
`ask` 84 → 83; `auto` 9 and parked 137 unchanged; **`auto_mergeable` 3,043 → 3,040, which is exactly
the three groups resolved**; 0 duplicate groups left on the three winners.

**At $0 current rent on all nine losers, no rent-ranked surface would ever have surfaced this.** It
was found only by chasing a guard counter that moved by 2 — the discipline, not a detector.
⚠️ Gardner's `min_loser_sim` 0.667 was read before merging: it is `Gardner Tanenbaum` vs
`Gardner Tanenbaum Holdings`, a suffix, not a different party.

### N15b — measurement only, nothing written, and it corrected TWO of my prompt's premises

Full writeup: [`docs/audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md`](../audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md).

**Headline: 10,340 live entities (16.6%) are invisible to `ensureEntityLink`'s own lookup by their
own name.** That is the duplicate factory stated as one number. `canonical_name` has **seven
authors**, four live and distinguishable — including **two JS copies of the same rule that drifted
apart on a single character** (`[^a-z0-9\s]` → space vs deleted). ⚠️ It has **no unique
constraint** — a de-facto dedup key nothing enforces.

**⚠️ My prompt was wrong twice, and both corrections matter:**
- **"3,400 rows match no known normalization → a third author"** → adding the two JS rules takes the
  unexplained set to **540**, and they are not a normalizer at all: they are `canonical_name` left
  **stale after `name` was later repaired** (`Scott W. Beynon` still keyed
  `buyer contactsscott w beynon 801 568 1031 p`). That is the *inverse* failure and needs a
  different fix — recompute on name change.
- **The entire `auto_mergeable` gate I specified is unsatisfiable**: `v_lcc_merge_candidates`
  **does not read `canonical_name`**. It groups on `lcc_normalize_entity_name(e.name)`; the column
  is a dead passthrough. **Rewriting it cannot move `auto_mergeable`.** I asserted a blast radius
  without checking the view definition — the exact "read the function, not its name" failure this
  file keeps recording.

**The real blast radius is elsewhere and one surface is already broken:**
`v_lcc_developer_classification_candidates` joins `canonical_name` against
`lcc_normalize_entity_name(developer_name)` and is **~19% blind — 222 of 274 resolve today, 269
would if aligned**. Nobody had noticed.

**Recurrence is a burst plus a trickle: quote 79 in 21 days (~4/day), never the blended 1,879/30d**
— off by ~24×. Confirmed live: entities rose 62,363 → 62,365 in the ~30 minutes between two of
today's measurements.

**Recommendation (not applied):** adopt the `lcc_owner_domain_core` **token rule** (pure legal forms
only, keep every semantic token), enforced by a `BEFORE INSERT OR UPDATE OF name` trigger that
returns NEW unconditionally, and delete the inline copy in `entities-handler.js`. ⚠️ **Not**
`lcc_normalize_entity_name` — banned for identity, NULL for 1,070 entities, and as a *link* key it
would silently auto-link `Century Park Partners` to `Century Park Properties LLC` with no human
review.

**👤 Three questions for Scott** in §6 of the audit: which token rule (the `trust|dst|reit` residue
is a real judgement — should a DST and its LLC share a dedup key?); whether the 540 stale rows get
recomputed (it discards a captured string some of them preserve); and whether `canonical_name`
becomes an enforced unique key (**3,930 groups would violate it today**).

## 2026-08-27 16:40 UTC — merge state confirmed; docs cross-linked; N15b drafted

**Everything is on `main`.** PR #1830 (P198 view + audit + migration) and #1833 (the merge results
+ lock postmortem + backlog cleanup) both merged; all eight files verified present in
`origin/main` by content, not by `git status`. Two other branches landed in parallel: **#1831/#1832
(A4b — the corrected P138 street-number guard, with `test/a4b-guard-redraft.test.mjs`)** and a fix
for a future-dated timestamp in the ownership-lane doc.

**Housekeeping:** the A4b prompt is filed to `prompts/done/` (its audit and code shipped).
~~**`A2b-repeat-transfer-flicker` correctly stays open — it has no audit and was never run.**~~
**A2b SHIPPED later the same day and is now filed to `prompts/done/` too** — see
`docs/audits/A2b_REPEAT_CONVEYANCE_COLLAPSE_2026-08-27.md`. ⚠️ Its prompt name is a misnomer that
this arc kept repeating: **the mechanism is NOT the `gsa_lease_diff` flicker** (that one has a
return leg and is caught by `is_oscillating_pair`); it is per-lease fan-out plus cross-source lag.

**⚠️ Two canonical pages now exist for one entity graph, and they did not know about each other.**
`tier0-owner-contact-system.md` (person↔owner, P186–P198) and `ownership-history-lane.md`
(A1–A4b) **share `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner entities themselves**
— a merge confirmed in one changes the chains in the other. Reciprocal pointers added to both, and
to `CURRENT-STATE.md` §6. That is the failure the consolidation pass exists to prevent: not a
missing doc, but two correct docs with no edge between them.

**Next prompt drafted: `prompts/N15b-canonical-name-one-normalizer-2026-08-27.md`** — the producer
behind every duplicate round we have run. Grounded fresh: of **62,363** live entities only
**46,045 (73.8%)** have `canonical_name` matching `lcc_normalize_entity_name`, **42,260** match
`lower(name)` verbatim, and **3,400 match NEITHER** — a third author, or a stale rule. The two big
buckets overlap, which is exactly why it survived: the disagreement is invisible until two writers
meet on the same name.

## 2026-08-27 16:28 UTC — P198 §5: three merges DONE; 9 more duplicates surfaced; and a lost-work postmortem

Easterly, Cambridge and Gardner merged through `lcc_merge_entity`. **Six cards became three.**
Easterly is now ONE card: **$114,864,150 / 89 assets / 7 eligible people** — the pre-merge combined
total exactly, 0 lost. Lane `ask` **87 → 84**; `auto` 9 and parked 137 unchanged; pairs 696 → 684;
live entities 62,366 → 62,363. **All three `reversible = true`** (snapshots 67 / 27 / 14 rows).
Winners by P195's **ownership-first** rule, not rent (Easterly REIT owns 79 assets vs 10).

**Both pairs already carried the SAME confirmed contact on both sides** — Alison Bernard on both
Easterly entities, Constance MacOn on both Cambridge entities. Scott had confirmed the same person
twice, once per duplicate. Nothing lost to the pivot fold, and the double-confirm is independent
evidence the duplicates were real.

**⚠️ `auto_mergeable` moved 3,041 → 3,043 and chasing it found the next thing.** Benign in itself
(each winner now heads a byte-identical group that was already auto-mergeable; the added assets
flipped two winner selections) — but it surfaced **9 MORE duplicate entities on the same three
firms, all at $0 current rent** and therefore invisible to every rent-ranked surface: Easterly 3,
Cambridge 2, **Gardner 4 — one of which alone holds 240 relationships while the asset-holding
entity holds 13 assets. That firm's deal history is split across two live entities** (the P177
failure). **Not merged — an approval of three named pairs is not extended by inference.** Backlog
**N3h**.

### ⚠️ POSTMORTEM — Cowork's own `git status` orphaned `.git/index.lock`, and clearing it discarded a turn of doc edits

The lock that blocked three of Scott's commands was **0 bytes and owned by the sandbox uid** —
`git status` is not read-only, it refreshes the index and takes the lock, and the sandbox can
neither reuse nor unlink it. `GITHUB-WORKFLOW.md` §2a previously blamed "a Windows git process";
that was wrong and is corrected, and §6 rule 4 no longer exempts `status`/`diff`.

**Worse, and now recorded: after the stale lock was removed, the next index-writing command
reconciled the working tree to HEAD and SILENTLY DISCARDED all seven uncommitted doc edits.**
`git status` went from 7 modified files to clean between two commands, `git add` staged nothing,
and `git commit` reported *"nothing to commit."* Nothing warned. The edits were reconstructed by
hand. **A long-held stale lock means the index and the working tree have diverged — treat clearing
it as a destructive operation and commit or stash BEFORE the first git command after removal.**

## 2026-08-27 15:10 UTC — P198: the tightening I recommended was measured and REFUTED

Full writeup: [`docs/audits/P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md`](../audits/P198_PREFIX8_ARM_IS_LOAD_BEARING_2026-08-27.md).
Migration `20260827230000_lcc_p198_tier0_coproposed_owner_duplicates.sql`, applied live.
**Lane unchanged by construction: ask 87 / auto 9 / parked 137 / pairs 696, before and after.**

**Last turn I recommended tightening `ev_company_matches_owner` because two `ask` cards rest on a
generic word stem (`innovati`, `corporat`). Measured: the prefix-8 arm is the ONLY link evidence
on 28 of 87 ask cards / $146.9M**, including Easterly at $85.0M, and it is the un-park mechanism
for **25 of 32 `weak_partial`** cards (P194 un-parks on `n_link_evidence > 0`, and for those 25
this arm *is* that evidence — the `no link evidence` column reads **0** for that whole band).
Tightening it would have parked ~$147M of reach to remove five wrong cards worth ~$5.6M.
**Not shipped. Closed, do not re-raise.**

**P179 Class 2, read backwards.** That rule says measure the throughput of whatever a *promotion*
would displace. The mirror: **before demoting a rule, measure what depends on it.** A rule's false
positives are visible on the surface; what it holds up is not.

Read all 44 prefix-8 rows: the top by rent is entirely correct (Easterly, Cambridge, Carnegie,
Franklin Street, Woodbranch, Westfield, the Briarcliff SPE family). **5 of 30 cards are wrong** —
a shared given name (Michael Downing ← Michael Development), place words (Westlake ← Westlake
Farms; Maple Tree ← Mapletree), generic words (Corporate Plaza, Innovation 2100 ← an *operator*).
Stated residue, each a one-second reject because P188 put the employer and match key on the card.

**Built instead: 3 owner-merge decisions.** Easterly is the #1 *and* #3 card — one firm as two
entities, both proposing Andrew Pulliam. New read-only view
`v_lcc_tier0_coproposed_owner_duplicates`. ⚠️ **The broad signal was rejected on the way**:
co-proposal alone (same person + same domain on two owners) is **95 pairs, 88 of them unrelated
names — 7% precision, worse than the domain-keyed fix P189 already rejected at 25%.** Narrowed to
a shared 8-char core opening it is 7 pairs: Easterly ✅, Gardner-Tannenbaum ✅ (spelling variant),
Cambridge ⚠️ probable, and 4 sibling-SPE pairs that must never merge (UIRC Douglas AZ / Van Horn
TX are different properties in different states). **No `auto_mergeable` column, deliberately** —
`lcc_apply_fuzzy_merges` loops on that flag.

**⚠️ Two instrument failures, both caught by implausibility.** `min(a.owner_name)` collapsed both
sides of each pair to one string, reporting **95 / 95 identical / 0 / 0** — everything in one
bucket and nothing anywhere else is a bug signal (P182); keyed properly it is 0 / 7 / 88, the
opposite conclusion. And **`lcc_name_has_spe_marker` is named backwards** — it detects a
PORTFOLIO marker and returns FALSE for every name containing the literal string "SPE".

## 2026-08-27 14:30 UTC — DOC CONSOLIDATION: twelve Tier 0 audits now have ONE door

**New canonical page: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md).**
Anything about matching a person to an owner, the Decision Center Tier 0 lane, the sponsor map, or
owner-entity merges starts there. It carries live state (measured 2026-08-27 14:26 UTC), the objects
that exist, **seven decisions already made that must not be re-litigated**, **ten traps already paid
for**, and open items split three ways — ⏳ pending a dated verification · 👤 needs Scott · 🔴 build.

**The per-round audits are unchanged and they stay** — they are the evidence, and a claim in the
canonical page is only as good as the round that measured it. All seven Tier 0 audit files
(P186/P188/P189/P194/P195/P196/P197) now open with a banner pointing at the canonical page, so a
future chat reads ~4 KB to decide which ~118 KB it actually needs.

**Why this was worth a turn.** The arc spans twelve documents and the same four mistakes were
available to make in each of them — the sorted-token core, evidence that attests the person rather
than the link, a gate that re-creates the join it filters, and dormancy measured on the wrapper. Two
of those were in fact made twice. A trap list is only a guard if it is on the path someone walks.

**Housekeeping in the same pass:** prompt 197 and its response filed to `done/`; the response folder
is empty of live items. ⚠️ The sandbox cannot delete on the mounted drive — the two originals are
removed by a `Remove-Item` line in the PowerShell, not by Cowork.

## 2026-08-27 — A3: the ownership `mismatch` lane is a REPRESENTATION question (74 chains → 12 decisions)

Full writeup: [`docs/audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md`](../audits/A3_OWNERSHIP_MISMATCH_SPONSOR_FAMILY_2026-08-27.md).
Migration `20260827180000_lcc_a3_ownership_mismatch_sponsor_family.sql`, applied live to LCC Opps.
**Nothing writes. No confirmation is seeded. `mismatch` is still 74 until Scott confirms.**

**Re-measured the POPULATION first.** The brief said 73; A2 landed in between and drained `agrees`
380 → 90, so the lane is **74 chains / 46 owners / $403.0M**. Split:
`sponsor_family_candidate` **32 chains / 12 owners / 12 DECISIONS** (Boyd Watterson 20:1),
`unexplained` 31 / 27 / $344.6M, `name_variant` 11 / 10. Per-class rent double-counts — three owners
span two classes, so quote the distinct $403.0M.

**The prescribed key was measured and rejected.** A bare sponsor token is not bounded — `east` names
**226** live entities, `boyd` **129** (including the surname `Boyd Alexander`) — and
`lcc_owner_sponsor_domain`'s `sponsor_token` PK cannot carry `madison` (proposed by two owner
entities) or `egp` (Easterly **and** EastGroup). The confirm registry `lcc_ownership_sponsor_family`
is therefore keyed **(sponsor entity, token)**, resolved through `lcc_entity_survivor`. This is not
the second-registry drift: the **detector** is shared — P196's guards are extracted into
`lcc_name_reads_as_street` / `lcc_name_has_spe_marker` and P196 re-issued to call them (0 of 696
Tier 0 rows changed).

**P196's SPE-marker arm drops 24 of 27 genuine rows here** (a GSA SPE is named for its city and
agency, not "Propco") — not applied, predicate not weakened. The other three guards are applied with
measured cost: street fires 3× changing **0** outcomes, brokerage 0, person costs exactly **2** real
false negatives (`City of Oakland`, `Glenn Olds` — both `lcc_looks_like_person` false positives,
named not patched).

**A contact confirm does not settle an ownership fact** (P188 restated): the 8 existing
`lcc_owner_sponsor_domain` rows resolve **0 of 74**, so inheriting buys nothing and would let a
~4-of-6 gate decide ownership. It rides the card as `also_confirmed_for_contacts`; nothing inherits.

`sponsor_spe` is a **fifth action, deliberately not `agrees`** — folding it there would hand it to
A2's write path. Positive control (self-rolling-back): with `boyd` confirmed, mismatch **74 → 54**,
sponsor_spe **0 → 20**, human_actionable **92 → 72**, and `agrees`/`no_records`/`all_guarded`
**unmoved**; rolled back with 0 residue. P180 equivalence on the split view: **0 rows differ** both
directions. `npm test` 4,684 pass / 0 fail. New guard mutation-verified RED on six mutations.

**Residue sized, surface NOT built** (31 chains / 27 owners / $344.6M). Follow-on **A3b**, named not
built: teach A2's apply path to consume `sponsor_spe`.

## 2026-08-27 13:00 UTC — P197: the Tier 0 lane read ONE employer source, by ONE key

Full writeup: [`docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md`](../audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md).
Migration `20260827170000_lcc_p197_tier0_employer_resolver.sql`, applied live to LCC Opps.

**`no_employer_on_file` 67 → 54 cards** ($131.2M → $113.6M); parked 142 → 137; `ask` 82 → **87**
(+$7.6M). `auto` unchanged at 9 — **the same 9 cards**, 0 lost / 0 gained. Card universe 233 → 233,
0 in / 0 out. **Nothing was minted** — no `unified_contacts` row, no pivot write, no entity touched.

### The prompt's premise was half right, and the wrong half is the finding

P197 framed the parked pile as *"a missing hub row"* and prescribed reconciling 92 people into
`unified_contacts`. Measured, the blocking population is **73 eligible people** and only **4** lack a
hub row that exists. For the rest the employer is already on file somewhere the lane cannot read:
**20** in `lcc_sf_list_membership.company_name` (6,781 such rows — the lane has never read one),
**20** on `entities.metadata->>'company'`, **56** genuinely nowhere. So the defect is that the lane
resolves "employer on file" from ONE table by ONE key. Shipped `lcc_tier0_employer_on_file` —
one ranked resolver, `hub_email > hub_entity_id > sf_campaign > entity_capture` — instead of a
reconciler. Minting hub rows would have fixed 4 of 73.

### ⚠️ The obvious version is destructive, and it was measured on named rows before being rejected

"Copy whatever company we hold onto the card" manufactures employers. Neither non-hub source is an
employer register: over the parked population they carry **city/zip strings** (`Southbury, CT 06488`,
`Hollywood, FL 33021`), the **person's own name** (`Steve Blumer`), a P188-named junk label
(`Inco Commercial`, on two people sharing ONE mailbox) and stale firms (`Pop Local` for someone
@edwardsrealtyco.com, `The Carpet Shop` @corporaterealty1.com, `Community Trust Bk` proposed against
a **health-centre** owner). `contact_company` feeds `ev_company_matches_owner` — the only signal that
attests the LINK — so an invented employer colliding with an owner name manufactures exactly the
claim P188 established these signals cannot make. **The gate is email-domain corroboration**; the hub
tiers stay ungated because the hub IS the system of record. Probed on 8 named rows with stated
expected answers (4 resolve, 4 reject): **8 of 8 correct** — the positive control that makes the
zeros believable (P182).

### ⚠️ The 5,440 orphan count is 247 too high, and the producer is Salesforce, not the sidebar

**247 of those person entities DO have a hub row** — linked by `entity_id`, which the email-keyed
detector structurally cannot see. True count **5,193**. The producer is **live**: 542 in 30 days, 94
in 7, one the day of the audit — and it is Salesforce (`metadata->'salesforce'` on 3,994;
`external_identities` `salesforce/Contact` 4,032 vs `costar/contact` 1,767), not the hypothesised
CoStar sidebar. Duplicate risk on any future reconcile was checked rather than assumed: of 3,874
orphans carrying an SF contact id, **exactly 1** already has a hub row under it.

### The general rule was sized, not chosen

Gate populations over the 5,193, quoted before choosing: **SF campaign 1,475** (the only
discriminating gate) · correspondence **33** · has an edge 4,903 (94%) · person-shaped 5,131 (99%).
**No hub rows minted** — 1,475 rows into the surface Scott works is a decision with a blast radius,
and it would not have cleared the Tier 0 blockage anyway (a hub row with no `company_name` answers
nothing the lane asks). Filed as backlog **N14** for Scott.

### Left honestly

54 cards / $113.6M still park as `no_employer_on_file` **and that is correct** — a genuine
acquisition gap, not plumbing. Of the 13 that moved, **5 became `ask`** and **8 became
`employer_on_file_differs`** (honest rejects — progress over a non-judgement, but not a call;
reported separately). ⚠️ **Two of the 5 new `ask` cards rest on a generic word stem** —
`ev_company_matches_owner`'s shared-8-char arm fires on `innovati` (*Innovation 2100 LLC* ←
"Innovative Renal Care", a dialysis **operator**) and `corporat`. Pre-existing property of that
comparator, now exercised more often; stated rather than papered over, and the card shows the
employer, its source and the match key so a wrong one is a one-second reject.

**Proven, not asserted:** `auto` is the same 9 cards; `match_strength`/`n_eligible` changed on 0 of
233; and the view got **faster** — 793.9 ms → 553.6 ms, buffers 32,841 → 22,820, because the plan
was pushing the old hub join down to all 7,890 people and the resolver is bounded to the ~600 matched
pairs. Guard `test/tier0-employer-resolver.test.mjs` (7 tests, **all 7 mutation-verified RED**).
Suite 4,673 pass / 0 fail.


## 2026-08-27 06:00 UTC — P196: the shared merge path is REVERSIBLE (N11 ✅), and parked Tier 0 cards say why (N3e ✅)

Full writeup: [`docs/audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md`](../audits/P196_MERGE_REVERSIBILITY_AND_PARK_REASONS_2026-08-27.md).
Migrations `20260827150000_lcc_p196_merge_entity_reversible.sql` and
`20260827160000_lcc_p196_tier0_park_reasons.sql`, both applied live to LCC Opps.

### Unit 1 — `lcc_merge_entity` had no undo, and it is not the dormant path

`lcc_merge_entity` now snapshots the whole loser side, **folds `owner_contact_pivot` fill-blanks
before the dedup DELETE can destroy it**, calls the reconcile with `p_snapshot => true`, and writes
an action-labelled backup row before every P160 dedup/repoint. `lcc_unmerge_entity(loser)` is the
reversal; `lcc_entity_merge_log` is the ledger; `v_lcc_entity_merge_reversibility` is the instrument.

**Three corrections to N11 as filed, each of which changes what the fix had to be:**

1. **⚠️ "DORMANT, NOT ARMED" DESCRIBES THE LOOP, NOT THE FUNCTION.** N11's measurement was right that
   nothing calls `lcc_apply_fuzzy_merges` (re-confirmed: 0 cron rows, 0 repo callers). But
   `lcc_merge_entity` itself has **nine human-verdict call sites in `api/`** and the entity table
   says they fire — **285 merges in the last 30 days, 176 in the last 7.** The irreversible pivot
   delete has been running all along. Reading the loop's disposition as the function's is how a live
   path gets filed as latent.
2. **⚠️ "UNCORRELATED EXISTS" IS NOT THE BUG.** `owner_contact_pivot` and `lcc_property_owner` are
   both PRIMARY KEY `(entity_id)`, so at most one row exists per entity and the un-correlated
   `EXISTS` is *equivalent* to a correlated one. Correlating it changes nothing. The bug is that the
   statement **DELETES content instead of FOLDING it**, with no ledger. Worth stating because
   "correlate the EXISTS" is a one-line change that would have looked like the fix.
3. **⚠️ `p_snapshot => true` ALONE WOULD HAVE LEFT THE WORST PATH UNTOUCHED.** The reconcile covers
   portfolio facts, identities, relationships, watchers and cadence. The four backrefs the **P160
   block inside `lcc_merge_entity`** handles — `lcc_property_owner`, `lcc_property_owner_evidence`,
   `owner_contact_pivot`, `bd_opportunities` — live in the caller, and **neither function
   snapshotted them in any mode.** The prescribed one-line fix would have made four tables
   recoverable and left the pivot exactly as it was.

**⚠️ AND THE ROUND TRIP CAUGHT A BUG REVIEW DID NOT — which is the whole reason the prompt demanded
one.** The first cut restored `entity_relationships` / `external_identities` / `watchers` with
`INSERT … ON CONFLICT (id) DO UPDATE`. Both tables carry a **BEFORE INSERT** survivor-resolving
trigger (P177/P178), and **P177's SKIPS a row that duplicates an edge the resolved entity already
holds** — it returns NULL, so the row never reaches `ON CONFLICT` and the `DO UPDATE` never runs.
Live on `Monaco Holdings`, three **byte-identical** `(loser → 4f1b724a, 'purchases')` edges: edge 1
restored, edges 2 and 3 were then duplicates of it, were silently skipped, and stayed on the
**winner** — while the unmerge returned `restored`. Fixed by repointing surviving rows with `UPDATE`
(both triggers are INSERT-only) and INSERTing only what was deleted, plus a
`restored_with_residue:relationships_not_restored=N` count so a partial restore can never read clean.

**Verified live before calling it done:** real merge → unmerge on `Monaco Holdings` → `Monaco
Holdings LLC` (an `auto_mergeable` byte-name duplicate; the merge dedup-DELETED a portfolio fact and
the loser's pivot and repointed 3 relationships, 1 identity, 1 property-owner edge). Full-row diff
over ten tables for both entities: **16 rows before, 16 after, 0 lost, 0 new**, `auto_mergeable`
**3,053 → 3,053**. The FOLD path — which Monaco could not exercise, both its pivots being blank — was
proven by a self-rolling-back gate: the loser's *"Alex Bias Test"* lands on the blank winner with
`active_source` **still `tier0_confirm`** (carried VERBATIM, never restamped — P194) and
`pivot_history[0].source='entity_merge_fold'`, then unwinds cleanly. 0 residue.

**Stated honestly:** `v_lcc_entity_merge_reversibility` reports **2,411 existing tombstones,
`reversible = false` for every one.** Those merges have no snapshot and never will.

**Not done, deliberately:** nothing wires up `lcc_apply_fuzzy_merges`. Reversibility lowers the cost
of being wrong; it does not make P195 §1's grading unnecessary. That is a decision, not a consequence.

**A2a is unblocked** — merge the 45 ambiguous parties and cron 244 applies the chains the same night.

### Unit 2 — the parked cards now say why, and the sponsor-shaped ones have a route

| park_reason | cards | owners | rent |
|---|---:|---:|---:|
| `employer_on_file_differs` | 76 | 67 | $96.3M |
| `no_employer_on_file` | 68 | 56 | $132.3M |
| `employer_not_comparable` | 2 | 2 | $1.9M |
| **parked, total** | **146** | **105** | **$180.3M** |

N3e's "$98M / 75 owners" is the **`differs` slice specifically**, not the whole pile. Those cards are
parked because the employer on file is not this owner — the gate working. `employer_not_comparable`
is kept separate on purpose: the comparator has a 6-char floor on both sides, so for those 2 it could
not run at all, and "could not run" is a different fact from "ran and disagreed" (the P181 shape).

**⚠️ ONE OF THE TWO PRESCRIBED FIXES WAS IMPLEMENTED, MEASURED AND REJECTED.** Normalising the company
string (strip `www`/`com`/punctuation) unparks **0 of 146 cards**, and the motivating row does not
survive its own fix: `Savlan Cc Property LLC` → `savlanccproperty` vs `savlancapital` fails
containment and then fails the 8-char prefix arm on `savlancc` vs `savlanca`. **The mismatch is at
character 8, not in the www/com noise.** The comparator is unchanged; Savlan is a sponsor-shaped park
and is routed as one.

**⚠️ AND THE NAIVE SPONSOR DETECTOR IS A NOISE GENERATOR AT ~25% PRECISION** — the same number P189
measured and rejected for domain-keyed merge grouping. Leading-brand-token equality alone returns 19
pairs dominated by **shared given names** (`George Kurz` ← *George's Inc*, which is P188's Gary
George trap in a new dress; two `JAMES` trusts ← a shared CPA at `jameshowardcpa.com`) and **place
words** (`MAPLE HILL` ← *Mapletree Investments*, a Singapore REIT; `Steel Station Rd` ← *Steel
Equities*). Three guards — the owner must carry an SPE/portfolio marker, must not read as a street,
must not be person-shaped — take it to **4 of 6, and the 4 are the top 4 by rent** (Gardner $8.0M,
Salus $5.3M, Oxford $2.5M, Savlan $2.0M; the 2 false ones sit at $1.26M and $0.84M). The view is
value-ranked for exactly that reason.

**⚠️ The un-park was NOT widened.** ask 77 / auto 9 / parked 146, before and after. Admitting person
evidence restores the Gary George noise P192 removed, and the guard goes RED if `n_person_evidence`
ever appears in that CASE.

**Operator surface:** `GET /api/tier0-auto-attach-tick` (already the ungated dry-run grade) now also
returns `parked.by_reason`, ten value-ranked examples with both compared strings, and
`sponsor_map_proposals` with the confirm SQL. Confirming is the existing curated
`insert into lcc_owner_sponsor_domain(...)` — one decision covering an SPE family. Nothing in Unit 2
writes.

**Verify by owners moved out of parked, never cards touched:** 105 parked owners / $180.3M today, of
which 4 confirmable sponsor proposals cover 4 owners / $17.7M.

## 2026-08-27 11:55 UTC — ⭐ 49% of person entities are not in the contacts hub; 92 block $132.3M

**The parked pile splits exactly, and the split is the finding.** Of 189 candidate people behind the
142 parked Tier 0 cards:

| | people | meaning |
|---|---|---|
| have a `unified_contacts` row | **97 — and all 97 carry an employer** | the `employer_on_file_differs` parks. **The gate working.** |
| **no hub row at all** | **92** | no employer, no title, no SF, no Outlook — **not a judgement, a missing row** |

So `no_employer_on_file` (**68 cards / $132.3M**) was never a decision anyone declined to make. The
data to make it is absent.

**Fleet-wide: `entities` (person, live, with an email) = 11,107; reconciled to `unified_contacts` =
5,667; ORPHANED = 5,440 (49%).** `unified_contacts` is what carries `company_name`, `title`,
`sf_contact_id`, `outlook_contact_id` — an orphan has none of them.

**⚠️ 49% orphaned is very likely CORRECT and must not be read as a defect count.** `entities` is the
graph (everyone ever seen — CoStar brokers, deed grantees, OM-extracted names); `unified_contacts`
is the hub (people we actually track). Playbook Class 9's corollary applies exactly: the detector
produces CANDIDATES. **A bulk reconcile would pour thousands of untracked broker records into the
surface Scott works** — the Consumption-Layer failure this codebase documents repeatedly.

**The actionable population is 92, not 5,440** — the ones already proposed as contacts for a named
owner above the rent floor. Each either resolves its card or converts it to an honest
`employer_on_file_differs` reject. **Prompt 197** specifies it, and insists the *cause* be diagnosed
first: if a live producer is still minting orphans, a one-shot reconcile is a chore repeated forever
(Class 8). Check `created_at` on the orphans.

### ⚠️ N9v is STILL UNVERIFIED — and the reason is timing, not failure
`TIER0_AUTO_ATTACH=true` is set and the redeploy is live. But **cron 241 last ran 06:55 UTC, which
was BEFORE the redeploy**, and that run is the one that reported `flag_off`. `active_source=
'tier0_auto'` is still 0 because **the tick has not run since**. The next run is **06:55 UTC
tomorrow** and is the first honest test — expect 0 → 9. *(A `GET` of the tick would settle it
immediately; `web_fetch` returned nothing usable from here, so this is unverifiable from Cowork.)*
**Do not diagnose before that run.** `feature_flags_registry` stays `off` until a tick reports
`writes > 0` — it describes the runtime, not the intent.


## 2026-08-27 11:45 UTC — four sponsor entries confirmed by Scott; 6 cards unparked, $19.8M

Scott confirmed the top four of P196 Unit 2's six sponsor proposals and rejected the bottom two.
`lcc_owner_sponsor_domain` **4 → 8 rows**.

| sponsor → domain | rent | corroborating employer on file |
|---|---|---|
| `gardner` → gardnercompanies.com | $7.99M | Douglas Gardner — **"Gardner Companies"** |
| `salus` → salusgroup.us | $5.28M | James Jacobson — "Salus Healthcare Real Estate Group LLC" |
| `oxford` → oxforddevelopment.com | $2.46M | Stephen Nicotra — "Oxford Development Company" |
| `savlan` → savlancapital.com | $1.99M | Zusha Tenenbaum — "WWW Savlancapital COM" *(the junk string that defeated the comparator)* |

**Rejected:** `royal` → royalamerican.com ($1.26M) and `maple` → maplestmanagement.com ($0.84M) —
a common word and a place-word collision (the Mapletree trap P196 measured at ~25% precision).

**⚠️ Blast radius measured BEFORE writing, because a sponsor token matches fleet-wide.** Each token
was checked against every owner in scope: `oxford` and `salus` match exactly 1 owner; `gardner` and
`savlan` match 2 — and in both cases the second is **the same firm** (`Gardner-Tannenbaum`, a
spelling-variant duplicate entity; `Savlan Capital`, the sponsor itself). No collateral.

**Effect — assert on the state delta, not the row count:** `parked` **146 → 142**, `ask`
**77 → 82** (6 cards moved, 2 of them the bonus same-firm owners), lane rent askable now **$254.9M**.

**⚠️ A correction to my own earlier reading, caught before writing.** In the P187 bench I recorded
*"Gardner Tanenbaum Holdings → Douglas Gardner @gardnercompanies.com — Achen-Gardner Construction"*
and marked it a probable false positive. Reading the authoritative row: his employer on file is
**"Gardner Companies"**, not Achen-Gardner. I had conflated two different rows. **A dated note in
my own write-up is a hypothesis to re-check, exactly like a dated blocker.**

**⚠️ Flagged on the Oxford card, and it is not a reason to reject the mapping:** the only candidate
at `oxforddevelopment.com` is Stephen Nicotra, title **"Summer Internship"**. The domain↔sponsor
link is sound; the *person* is not a pursuit target. This is the doctrine working as designed —
"do the people at this domain work for this owner" and "who do we call" are two decisions, and only
the first is answered by the map.


## 2026-08-27 11:35 UTC — ⚠️ N9v FAILED, diagnosed; P196 corrected three of my own claims

### ⚠️ THE AUTO-ATTACH FLAG IS SET IN RAILWAY AND **OFF AT THE RUNTIME**
The dated check came due and failed. Cron 241 fired **06:55:00 UTC**, `cron.job_run_details` says
**`succeeded`** — and that only means `lcc_cron_post` dispatched the HTTP request. Reading the
handler's own response instead:

```json
{"ok":true,"skipped":"flag_off","flag":"TIER0_AUTO_ATTACH","writes":0,"would_attach":9}
```

**HTTP 200, and the process does not see the variable.** Scott set `TIER0_AUTO_ATTACH=true` in the
Railway `tranquil-delight` env, but the *running* build was never redeployed after the change (or
the variable landed on a different service/environment). **A flag set is not a flag read.**

**The handler behaved correctly** — it named `skipped: flag_off` rather than silently writing
nothing, which is the whole reason this was diagnosable in one query instead of a hunt.

**⚠️ And I had made `feature_flags_registry` lie.** I flipped it to `on` when Scott set the
variable — recording the *intent*. The registry drives the daily brief's Dormant Capabilities
section, so it must describe the **runtime**. Reset to `off` with the evidence in `notes`.
**Flip it back only after a redeploy AND a tick reporting `writes > 0`.**

**Operator fix:** redeploy the `tranquil-delight` service, then re-run
`GET /api/tier0-auto-attach-tick` and confirm it no longer says `flag_off`.

### P196 shipped (#1809) — and corrected three things I had written

**Unit 1 — `lcc_merge_entity` is now reversible.** `lcc_unmerge_entity(loser)`,
`lcc_entity_merge_log` as ledger, `v_lcc_entity_merge_reversibility` as instrument.

1. **⚠️ "Dormant, not armed" described the LOOP, not the FUNCTION — and I measured the wrong
   thing.** I checked callers of `lcc_apply_fuzzy_merges` (still 0, correct) and concluded the
   irreversible path was not firing. **`lcc_merge_entity` has NINE human-verdict call sites, and
   285 entities were merged in 30 days — 176 in 7.** The irreversible pivot delete had been running
   all along. *Count the callers of the FUNCTION, not of the one wrapper you were told about.*
2. **"The uncorrelated `EXISTS` is the bug" was wrong.** Both tables are PK `(entity_id)`, so the
   predicate is already equivalent to a correlated one. The bug is that it **DELETES instead of
   FOLDING**, with no ledger. *Correlating it would have looked like a fix and moved nothing.*
3. **`p_snapshot => true` alone would have left the worst path untouched** — the four P160 backrefs
   live in `lcc_merge_entity`, not in the reconcile, and neither snapshotted them in any mode.

**The round trip caught a bug review did not** — exactly what the prompt insisted on. P177's
`BEFORE INSERT` trigger skips a duplicate edge, so `ON CONFLICT DO UPDATE` never fires: restoring
three byte-identical Monaco Holdings edges brought back **one**, left two on the winner, and the
unmerge still reported `restored`. Verified live: full-row diff over ten tables, 16 rows before and
after, 0 lost. **Honest limit: 2,411 pre-P196 tombstones read `reversible = false` and always will.**

**Unit 2 — parked cards now say why.** **146 parked / 105 owners / $180.3M** —
`employer_on_file_differs` 76 / $96.3M (the slice my "$98M" actually meant — the gate working),
`no_employer_on_file` 68 / $132.3M, `employer_not_comparable` 2. Decidability unchanged
(ask 77 / auto 9 / parked 146). **Both fixes I prescribed were measured rather than assumed, and
one was rejected:** company-string normalisation unparks **0 of 146** (Savlan fails at character 8,
`savlancc` vs `savlanca`, not on the `www`/`com` noise), and a naive sponsor detector reads **~25%
precision — the same figure P189 rejected**, with false positives on shared given names
(George Kurz ← George's Inc) and place words (MAPLE HILL ← Mapletree). Three guards take it to
**4 of 6, and the 4 are the top 4 by rent**, so the view is value-ranked and human-confirm-only.


## 2026-08-27 05:00 UTC — repo fully synced; CI skip path PROVEN; two git traps recorded

**State verified:** local `main` == `origin/main` (0 ahead / 0 behind), **zero conflict markers
anywhere in the repo** (the `claude/conflict-marker-guard-sxcpoy` branch merged as #1803 and
repaired `panel-redesign-verification.md`), A0 and A2 correctly filed in `prompts/done/`, and the
live prompt queue is exactly **196**. The only working-tree noise is the long-standing
`test/fixtures/healthcare-discovery/*.csv` modifications, which pre-date this arc.

**✅ The docs-only CI skip is proven.** It executed on the `fix/status-conflict-markers` PR and
reported green in seconds. Worth logging as its own event: §6 rule 3 says a CI job is not shipped
until green once on `main`, and **the skip branch of a conditional job is a second code path
needing its own first green run** — the PR that introduced it touched `.github/workflows/`, so it
ran the full suite and proved nothing about the skip.
⚠️ The docs-only path deliberately still runs `test/no-conflict-markers.test.mjs`: both marker
instances were `docs/*.md`, and the `STATUS.md` one **arrived through a documentation-only PR**.

### ⚠️ Two git traps, both caused by Cowork instructions, both now in `GITHUB-WORKFLOW.md`

**§2a — while `.git/index.lock` is held, sandbox `git status` is not trustworthy.** Cowork read the
tree as "two modified, two untracked" and drafted a recovery on it. There was an **unresolved merge
in progress** (`STATUS.md` was `UU`) that never appeared, because git cannot refresh the index
while the lock exists and answers from stale state. Every subsequent command assumed a clean tree:
`checkout -b` refused, the cherry-pick refused, and a later `git add -A` re-staged the very markers
§2b exists to prevent. **Same class as everything else in this file — a surface that answers
confidently instead of erroring.** Compounding it, the Cowork call piped `git status` through
`grep -v test/fixtures`, which would have hidden a `UU` line anyway: **filter what you show, never
what you judge from.**

**Resolution was the right one:** `git reset --hard origin/main`. It moves the branch pointer and
**does not delete commits** — the discarded work stayed reachable by sha. Two documentation notes
were rewritten from scratch rather than recovered, which is the cheaper trade against another
conflict resolution on the repo's hottest file.

**Dated checks at 04:32 UTC — both still pending, both still expected:** N9v auto-attach `0` writes
(cron 241 fires **06:55 UTC**); N9w sidebar `0.0%` stamped, last row **2026-08-26 22:49 UTC**, still
pre-reload.


## 2026-08-28 (Cowork) — B1 shipped: lane 336 → 1,237, and the badge correctly did NOT move

**Verified independently:** gov **any_history 1,272 → 2,173**, **chain_2plus 149 → 177**,
`lcc_entity_portfolio_facts` **13,077 → 14,010**, lane **1,237 completed / 644 open**.

**⚠️ The operator's badge stayed at 55 — before and after — and that is the whole point.** 123
newly-drafted `mismatch`/`all_guarded` cards are below $500k and held at
`human_gate='below_value_floor'`; **89% of the newly-drafted population routes to automation.**
*A value gate belongs on what reaches a human, not on what a cron applies* — which is exactly the
hypothesis B1 was built to test, now demonstrated rather than argued.

**Three corrections to my funnel audit, all measured by the build:**
1. **"1,548" spanned both domains** — gov 1,501 + dia 47 — and `trace_ownership_to_developer`
   carries a **further 983** below-floor skips **my audit never mentioned.**
2. **Only the gov slice has an automated consumer.** **dia has no
   `v_ownership_transitions_portfolio`**, so a dia task can never be drafted — dia and `trace` keep
   the $500k floor, **1,030 rows held by design**. Lowering their floor would have minted work no
   automation could touch, which is the failure this arc exists to prevent.
3. **The re-openable set was 1,414, not 1,548** (86 no longer suggested, 1 already open).

**⚠️ And the constraint has moved, which changes what to do next.** `any_history` rose **+901**
while `chain_2plus` rose only **+28** — **that is the population, not a shortfall**: only 210 of the
1,501 below-floor properties carry ≥2 guard-passing transitions. **The binding constraint on chain
DEPTH is now the A2-blocked `ambiguous_entity` residue — 126 links / 123 properties** — which is the
**A2a duplicate-entity class**, and it **applies unaided once merged.**

**Consolidation this round (beyond the prompt folders):**
- **`LOCAL-MODEL-GAP-AUDIT.md` R1** carried "545 open / 0 completions" as live status. Banner added:
  superseded, numbers historical, canonical doc named. **Its verdict — *deterministic plumbing, not
  Ollama* — was left intact and is the durable part**; that P131 lens has since predicted (a) or (c)
  correctly five more times.
- **`NEW-CHAT-KICKOFF.md`** updated to 1,237/644 with the goal metric and the badge-didn't-move
  explanation, so a fresh chat does not re-derive it.
- Swept for the superseded "545 / 0 completions" figure repo-wide: remaining hits are **dated audits
  and `prompts/done/`**, which are correct as an evidence trail and deliberately left alone.


## 2026-08-28 (Cowork) — BD funnel re-audit: the chain lane is starved by a floor that now gates FREE work

Scott redirected the audit: *"where are the biggest backlogs or locks — property by property, then
owner by owner, until we have a connected history of ownership of all our target markets back to
the developer."* **Every prior audit in this arc measured QUEUED WORK, which only sees the
symptom.** This one measures the **funnel**. → `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md`

**gov funnel:** 20,492 properties → **13,835 live** → 9,830 with a domain `true_owner` (71%) →
**6,362 with an LCC owner link (46%)** → 4,845 of those have **only the current owner** →
**1,517 with a chain (11%)** → **149 with 2+ HISTORICAL links (1.1%).**
*(dia is further along: 1,505 chains, 568 with 2+ historical, deepest chain **14** vs gov's 6.)*

**Against the stated goal — a connected history back to the developer — we are at 1.1%.**

### 🔒 The lock, and it is not a defect

**1,548 of 1,766 skips are `below_value_floor` at $500,000** (last 2026-07-31) — **five times the
314 the lane has completed.**

**The floor was right when set and is wrong now, for a reason that only became true yesterday.** It
exists because this was a **human research queue**, and nobody should hand-research a $50k
property — that is the same shared knob as the gov asset-mint floor and `CADENCE_SIGNAL_MIN_VALUE`.
**But since A2, the `agrees` bucket is applied automatically by cron 244 from a deterministic,
record-cited draft. No human sees it, so the marginal cost of a chain is now ~zero.** A floor sized
for operator attention is suppressing work that costs nothing — and suppressing exactly the
coverage Scott asked for.

**The fix is to SPLIT the floor by consumer, not remove it** — none/low for the automated path,
**$500k retained for anything reaching a person.** That distinction did not exist when the floor was
set, because the automated path did not exist. **B1 drafted** (`prompts/B1-*.md`), with the
guardrail that if the split cannot cleanly separate the two, **stop rather than lower both.**

**Three further locks, sized, not yet worked:**
- **~3,468 gov properties have a domain owner that never reached the entity graph** (9,830 vs
  6,362). Nothing downstream can touch them. ⚠️ **Ask why before building** — the gov
  `owner_needs_salesforce` lane just taught us a zero can be a **key-space artifact**, not a
  coverage fact.
- **74% of pivot owners have no active contact** (1,439 of 5,462) — known, already routed.
- **⚠️ The cadence surface is 99% overdue — 2,276 of 2,302.** A surface that is entirely red cannot
  distinguish urgent from stale, so it trains the operator to ignore it. **Badge-that-is-noise at
  the scale of a whole surface, and unaudited in this arc.**

**⚠️ Note for whoever picks this up: `establish_ownership_history` is fed by
`lcc_generate_chain_research_tasks` (cron 144), NOT by the A5a/A5c producer
(`handleGenerateResearchTasks`, crons 34/35).** Different function, different floor, different
bugs. Do not conflate them.


## 2026-08-27 (Cowork) — C1 answered: RETIRE. The consumer has existed since June, on another surface.

**The Salesforce research lanes should not get a consumer — they are a capture-less second copy of
one that already works.**

The Decision Center lane **`sf_link_candidate`** holds **3,369 owner↔SF-Account candidates**, each
carrying a resolved `001…` Account id, behind a verdict path (`api/admin.js:10764`) that **PATCHes
the exact column whose NULL-ness defines both research lanes** — null-guarded, provenance-logged,
reversible, with an Ollama pre-rank (cron 213). **Verified independently: 102 decisions, last
2026-08-14.** It already covers **360 of dia's and 1,347 of gov's** gap subjects.

The research lanes, by contrast, have **no capture path at all**: `completeResearch()` posts
`{research_task_id}` and writes nothing, neither lane has a capture button, and the seeder dedupes
on `status='queued'` only — so a completion is simply **re-minted** (4.84 tasks/subject on
`property_missing_recorded_owner`).

### ⚠️ Three corrections to my own brief, all measured

1. **My "gov: 0 of 108 resolve" was a KEY-SPACE ARTIFACT, not a coverage fact.** The lane emits
   `unified_contacts.unified_id`, and `external_identities` indexes gov only by `gov/true_owner`
   and `gov/asset` — **so that zero is structural and no amount of minting could change it.**
   Re-keyed via property → `true_owner_id`, **111 of 114 resolve.** ⚠️ But the names differ on
   **70 of 120** pairs (`ARCP GSPLTNY01, LLC` → **Nicholas Schorsch**; `INGOLD FAMILY INVESTMENTS
   LLC` → **Robert Ingold**) — that is **SPE↔sponsor, i.e. P188**, and attaching the sponsor's
   Account to a question asked about the SPE would be the same error P188 exists to prevent. Safe
   subset: 55 name-agreeing pairs → **2** with an SF Account. **My conclusion held, for a sharper
   reason than I gave.**
2. **NEW DEFECT — the gov lane reads one column and its only writer writes another.** Predicate =
   `unified_contacts.sf_account_id`; the verdict writes `recorded_owners.sf_account_id`. **1,961
   gov owners are already linked, 1,292 still read as a gap, and exactly 29 agree.** So **a human
   who works the Decision Center lane successfully does not clear the research task** — and
   **96 of the 1,675 admitted rows ($314.7M) is phantom work.** *Check the writer's column against
   the predicate's column by name, not by concept.*
3. **dia's two "27"s are different sets — overlap 3.** 27 admitted by the value gate; 27 whose
   entity carries an SF Account. I had treated them as one.

### ⚠️ My doctrine question failed on CAPABILITY before doctrine

I asked whether mass-creating SF Accounts violates *"LCC never writes back to clean SF."* The
prior question is simpler: **LCC's entire Salesforce surface is a read-only Power Automate proxy** —
`_shared/salesforce.js` records that Scott has no admin rights to register a Connected App, and a
grep for `sobjects` / `/services/data/v` returns **nothing**. Both lanes' generated instruction says
*"Link **or create** Salesforce account"* — **half of it has never been buildable.** No approval was
needed because there was nothing to approve. *A capability question you can settle with a grep is
cheaper than a doctrine question you take to the user.*

**P131: (a) 27 dia + 2 gov · (b) ZERO · (c) dominant.** A Salesforce id exists only in Salesforce —
no corpus states one, so a model would fabricate an 18-character id that looks exactly real.
**Fourth time this arc the top-ranked "LLM opportunity" measured as (a)+(c).**

### The recommendation, with numbers: automate 27 · retire 945 · gate 1,702 · repair 1,292

Filed **C1a–C1e**, sequenced: **repair the gov mirror first** (it resizes both lanes) → gate both
`lane_no_consumer` → retire on the A4 pattern → the 27 as **a new unit of `sf-link-reconcile.js`,
never a standalone writer** → register the missing dia `field_source_priority` ladder.

**It deliberately did not build the unambiguous 27-row fill**, because `sf_link_candidate`'s verdict
is the **single owner** of that column and carries the null-guard, provenance row and reversal. A
separate filler would be the second-writer defect (P119/P194/N15c). **Correct call.**

⚠️ **And the verification is inverted, which must be stated before anyone measures it:** if C1b/C1c
are taken, **real completions correctly stay at 0 and the lanes disappear instead.** That is the
success condition, not a failed metric. The numbers that move are `dia.true_owners.salesforce_id`
non-null (**822 → 849**) and the gov admitted count (**1,675 → 1,579**).


## 2026-08-27 (Cowork) — C1 drafted, and measuring first refuted the plan before it was written

The plan implied by A5 was *"automate the 293 that resolve ID-to-ID, retire the rest."* **Measured
against the OPEN QUEUE, that work does not exist:**

| lane | open | resolves to an LCC entity | **entity already has a `salesforce` identity** |
|---|---:|---:|---:|
| dia `true_owner_needs_salesforce` | 837 | **716 (86%)** | **27** |
| gov `owner_needs_salesforce` | 108 | **0** | **0** |

**⚠️ A5's "293" is across the full 6,324-gap population, not the open queue.** Both numbers are
correct and answer different questions — **but quoting 293 as available work would have sized the
build ~10× too big.** In the queue it is **27 (3%)**. *This is the "measure the queue, not the
source" lesson (P131) recurring: a queue is the residue the automation already picked over.*

**Two consequences that shape the whole design:**

1. **The gov lane has NO entity linkage — 0 of 108.** Those owners are not in
   `external_identities`, so **no ID-based automation can touch them**, now or after further
   minting — and **1,675 gov rows are admitted behind that.** It is the *owner* form of the
   documented "asset-identity coverage is what gates owner resolution" gate.
2. **Where dia does resolve (86%), the entity has no SF link either.** So the gap is genuinely
   **outside our systems** — not a join we forgot, and not something an LLM could read.

**C1 is written as diagnosis-first** (`prompts/C1-*.md`) with two doctrine checks the design must
clear before anyone builds: `sf-link-reconcile.js` runs the **opposite direction** (it mirrors an
existing `salesforce_id` *onto* the entity — **read a handler's direction before counting it as a
consumer**), and `CLAUDE.md` states LCC **never writes back to clean Salesforce**, so a consumer
that mass-creates Accounts may violate standing doctrine. It also asks whether the gov lane should
be minting at all before entity coverage exists — `lane_no_consumer` already exists as machinery
and precedent.

**And it says plainly that retirement is a success.** A4 retired 74 unanswerable tasks and that was
the right result. *"Retire two lanes and automate 27"* would be a better outcome than a consumer
nobody uses.


## 2026-08-27 21:40 UTC (Cowork) — A5c shipped. The producer is now CORRECT, GATED — and feeding lanes with zero consumers.

**A5c is complete and verified independently.** Pool **71,448 → 2,530 admitted (3.5%)**, gate in the
producer's **selection** (appended `gate_pass`/`gate_reason`/`gate_value` to `v_next_best_research`
on both domains), floor reused as-is at **$500k**, operators excluded by **recorded fact** rather
than a name test, placeholders via the existing predicate plus 13 anchored literals with a measured
blast radius of **7 rows / 0 real firms**.

**⚠️ Crons 34 and 35 are back ON — checked first, because it was the deliverable most likely to be
forgotten.** First live run: gov 161 + dia 182 = **343 minted, `closed: 0`,
`gate_reasons_seen: ["admitted"]`**. Cron 35 then fired on its own schedule at 21:09 and succeeded.
**Hundreds, not thousands.**

**A5a confirmed in production, not just in dry run:** the only `gap_resolved` closures in 30 hours
are **10, all in the 06:00 hour — before A5a deployed.** Zero since. The bug is fixed in the live
path.

**⚠️ The deploy check earned its keep, and this is the reusable part:** `/version` is unreachable
from the sandbox (proxy 403), so the deploy was confirmed **behaviourally** — and **two minutes
after the merge the gate was still absent, with `would_insert` still reading the ungated 2,586.**
Re-enabling the crons on "it merged" would have minted the entire flood with the gate sitting inert
in the database beside it. *Merged is not running* — again.

### 🎯 The finding that sets the next priority: a correct producer feeding a void

| lane | minted 4h | open | **real completions ever** |
|---|---:|---:|---:|
| `property_missing_county_record` | 109 | 109 | **0** |
| `owner_needs_salesforce` | 108 | 108 | **0** |
| `property_missing_recorded_owner` | 104 | 1,289 | **0** |
| `true_owner_needs_salesforce` | 22 | 837 | **0** |
| **`establish_ownership_history`** | 0 | 156 | **314** |
| `trace_ownership_to_developer` | 0 | 152 | **52** |

**Every lane this producer feeds has ZERO real completions, ever** (`outcome NOT ILIKE
'%gap_resolved%'`). The only two lanes in the system with genuine completions are the two this arc
built consumers for.

**So the work is now one level up.** A5a made the producer correct; A5c made it selective. **Neither
gives it a consumer** — and the Consumption-Layer doctrine is explicit that *no new producer ships
without a named consumer*. We have built an excellent pipeline into a void, and the honest next
question is **who consumes `owner_needs_salesforce`** — 1,675 admitted rows, **$4.01B, 66% of
everything the fleet will mint**, first-ever emission, no consumer.

**⚠️ And `establish_ownership_history` cannot be starved by any of this** — it is fed by
`v_lcc_ownership_chain_completeness`, a *different* generator. My guardrail question, answered
directly.

**Also filed by A5c, none built:** **A5g** (`owner_needs_sos`, 24,077 rows, emits nothing —
`lane_no_consumer` recorded per row because SOS-direct is bot-walled; the gate makes the zero
explicit rather than pretending), **A5h** (watch the gov SF lane), **A5d** (~1,844 pre-gate open
tasks stay open; the probe is ungated so none is falsely closed), **A5e** (`value_unknown` is 20,487
rows — a **rent-coverage** problem, not a value one), **A5f** (`is_operator_not_owner` unset on 11
real operators).

**One behaviour to expect and not misread:** with cron 35 at `limit=300`, gov's head is the same top
300 each run, so it inserts 0 until cron 34's daily `limit=2000` walks further — and that run reaches
2,000 of gov's 2,332 admitted, leaving **~332 unminted**. `admitted_head_exhausted: false` says
gov's feed is a **floor**. That is a cap, not completeness.


## 2026-08-27 20:07 UTC (Cowork) — crons 34/35 PAUSED pending A5c; and a false alarm worth recording

### ⚠️ I raised an alarm that was wrong. Recording it, because the reasoning is the reusable part.

Crons 34 and 35 post with `target => 'vercel'`, and `lcc_cron_post_log` shows **3,092 posts to
"vercel" in 24h across 44 endpoints vs 41 to "railway"**. Given P194 — *a retired deployment that
still answers is a second writer* — that reads exactly like the whole cron fleet executing on the
Vercel build retired 2026-07-20. I nearly reported it as the highest-priority defect in the system.

**It is not.** `lcc_cron_post` branches **only** on `target = 'edge'`; **everything else, including
the literal string `'vercel'`, falls through to the same Railway URL** (vault `lcc_railway_url`,
fallback `tranquil-delight`). **`'vercel'` is a historical label with no routing effect.**

The corroborating detail that *looked* damning — cron 35's 19:39 response lacking `mint_head` /
`membership_complete` — has a mundane cause: **A5a merged at 19:41:45, two minutes later.** That run
predates the fix. My 20:00 dry run, same host, returned all the new fields.

**The lesson: `git merge-base` has an equivalent for runtime routing — read the function, not the
label.** P194's rule is right and I applied it to the wrong evidence; a label that names a dead host
is not proof traffic reaches one. **Checking cost one query and would have cost a full false
escalation.**

### Crons 34 and 35 are DISABLED (`cron.alter_job(..., active := false)`)

A5a is live and verified — dry run: `membership_complete: true` (7 chunks), **`would_close: 0` on
both domains.** The bug is fixed.

**But it also revealed the flood, now measured: `would_insert` = 1,000 gov + 1,586 dia = 2,586** on
one `limit=2000` run, and **cron 35 fires every 30 minutes** — so the backlog would mint within
hours and continue into the **5,509 gaps that never had a task**. With **84% owning zero properties**
and operators/placeholders carrying **81% of the apparent value**, that is the badge-that-is-noise
failure, aimed at the lanes this arc just cleaned.

**Paused rather than throttled** — a smaller limit still mints the same pool, just slower.
⚠️ **Re-enabling is part of A5c's deliverable**, explicitly, so the pause cannot be forgotten.

**A5c drafted** (`prompts/A5c-value-gate-research-task-producer-2026-08-27.md`): reuse the existing
**$500k** knob rather than inventing a floor; exclude operators via the **existing**
`is_operator_not_owner` flag (P113: never write a second name-based operator test); **unknown rent
is not small** (P161 measured that trade); value **per owner**, never per task; and the gate goes in
the **producer's selection**, not a downstream filter. It also requires enumerating every lane this
producer feeds — **`establish_ownership_history` must not be starved**, since it is the one lane with
genuine completions.


## 2026-08-27 19:xx UTC (Cowork) — A5a merged AND deployed, but has not RUN yet. Do not read the counts yet.

**A5a merged as PR #1849** (both checks green before merge, on the post-Update-branch head).
⚠️ **Claude Code correctly flagged it as inert until a redeploy** — the P131 trap. **Checked rather
than assumed:** live `/version` is `d8fcfbfe` (#1850), and `git merge-base` confirms **A5a IS in the
deployed build**, with **0 commits un-deployed**. It rode in on the N15c merge.

**But it has not executed.** Cron 34 fires at **06:35 UTC**, and the counts are unchanged:
`property_missing_recorded_owner` 1,185 open / `true_owner_needs_salesforce` 815 open, with
`gap_resolved` in the last 24h still 9 and 1 — **all pre-fix**. Nothing here is evidence either way
yet.

### ✅ Dry run PASSED — the fix works, on both domains

`generate-research-tasks&domain=both&limit=2000&dry_run=1`, HTTP 200:

| domain | `membership_complete` | chunks | `would_close` | `would_insert` |
|---|---|---:|---:|---:|
| government | **true** | 7 | **0** | **1,000** |
| dialysis | **true** | 7 | **0** | **1,586** |

**`would_close` is 0 on BOTH** — including dia, which A5a had not measured and expected might be
legitimately non-zero. **Zero false closures.** `membership_complete: true` with 7 chunks means the
feed is genuinely exhausted rather than truncated. The bug is fixed.

### ⚠️ But `would_insert` = 2,586, and the producer has no value gate yet

**This is the flood A5a's own prompt warned about**, now measured. And it is sooner than the 06:35
run: **cron 35 (`generate-research-tasks-inc`) fires every 30 minutes** at `limit=300`, so minting
begins within the hour and continues until the pool drains — and **5,509 gaps have never had a
task**, so 2,586 is the near-term head, not the total.

**84% of that population owns zero properties**, and operators/placeholders (`DaVita Inc.` 2,626
properties, `Independent` 754) carry 81% of the apparent value. Minting it un-gated is precisely the
badge-that-is-noise failure the Consumption-Layer doctrine exists to prevent — *no new producer
ships without a value gate.*

**It is not dangerous** — these are research tasks, not production writes, and every one is
reversible. The cost is that two lanes get noisier **before** A5c makes them cleaner.

**Scott's call, and the pause is trivially reversible:**
```sql
select cron.alter_job(34, active := false);   -- daily 06:35, limit 2000
select cron.alter_job(35, active := false);   -- every 30 min, limit 300
-- undo: cron.alter_job(<id>, active := true);
```
⚠️ **Cost of pausing:** this generator serves **several** dia+gov lanes, so pausing starves all of
them, not just this one. It has been mis-closing for months, so a day's pause is cheap — but say it
out loud rather than pausing silently.

⚠️ **The verification is inverted, restated because it will look wrong:** success is
`gap_resolved`-per-day falling to ~0 and the **pinned open counts (1,000 / 815) moving.** **Open
counts going UP is the fix working** — real gaps that were being silently closed now stay visible.

**Bookkeeping note:** this was labelled A5c in the hand-off but the response file and the work are
**A5a**. A5c has not been sent. Flagged so the record does not drift.

### Still open, deliberately

- **A5b-repair — ~2,044 falsely-closed subjects.** Claude Code's recommendation, which I agree with:
  **re-label first** (kills the corrupted metric, adds zero surface), then let the corrected producer
  re-mint whatever ranks. **Do not re-open before the producer is proven correct** — that just
  refills a broken window.
- **A5c is now the priority, and it is time-sensitive.** Without a value gate, the corrected producer
  gives gov `owner_needs_salesforce` its **first 430 tasks** while **24,077 `owner_needs_sos` rows
  stay unreachable** — a flood into one lane and continued invisibility for another. **84% of the
  population owns zero properties.**


## 2026-08-27 (Cowork) — A5a drafted: fix the producer before repairing anything it broke

`prompts/A5a-truncated-feed-auto-close-2026-08-27.md`. Three-part fix — compare against the
**returned** row count (not the requested limit), **page the feed at exactly 1,000** (a larger
stride silently skips rows), and add a **stable tiebreak** to `order=priority.desc`, since the gap
arm is a hard-coded `20 AS priority` and **6,324 rows tie at exactly 20**, making the "top 1,000"
arbitrary and paging non-deterministic.

**Four things the prompt insists on, each from a documented failure here:**

- **Fail CLOSED on ambiguity.** If the feed cannot be exhausted, skip the auto-close entirely and
  say so. A false closure silently asserts a gap was resolved; an open task merely waits.
- **Do NOT raise `limit`.** The cap is server-side — a bigger number changes nothing and re-creates
  the same lie (`CAND_LIMIT = 1200` is the documented precedent).
- **Do NOT re-open the ~5,377 falsely-closed tasks here.** That is a data repair with its own blast
  radius, and **repairing before the producer is correct just refills a broken window.** Filed as
  **A5b-repair**, sized not built, Scott's call.
- **Establish the fleet-wide blast radius first** — this generator serves multiple dia+gov lanes.
  Enumerate which it auto-closes, and check which open counts sit at a suspicious constant
  (**1,000, or `1000 − n`** — that is the signature, and it is cheap to check).

**⚠️ And the verification is inverted, which is why it is spelled out explicitly:** the success
signal is that false closures **stop**, which looks like nothing happening. **A rising open count is
the fix working** — real gaps that were being silently closed now stay visible. The number that must
fall is `gap_resolved`-per-day; the number that must *move* is the pinned constant.

One more consequence flagged in the prompt: **5,509 gaps have never had a task**, so a corrected
producer could mint them all at once — a flood into surfaces nobody can work. It must cap or
value-gate the first run and state which, because A5c exists precisely because **84% of that
population owns zero properties**.


## 2026-08-27 (Cowork) — ⛔ A5 refuted BOTH of my re-audit's headline calls. The metric was manufactured.

**The lane never stalled, because it was never work** — and the same bug invalidates the lane I told
Scott to leave alone.

| lane | "completed" | **auto-closed by the generator** |
|---|---:|---:|
| `property_missing_recorded_owner` | 4,781 | **4,781 (100%)** |
| `true_owner_needs_salesforce` | 596 | **596 (100%)** |
| `establish_ownership_history` | 314 | **0** ← the only real completions |

**One bug produces all of it.** `handleGenerateResearchTasks` reads a 29,643-row feed through a call
**PostgREST caps at 1,000 rows**, then auto-closes everything outside the window as `gap_resolved`.
The guard tests `feed.length (1000) < limit (2000)` — **the requested limit, not the returned cap** —
so it passes and fires *over a truncation*. Its own comment says *"never on a capped slice."*

- **`true_owner_needs_salesforce`: 815 open is `1000 − 185`**, leftover window slots, not a backlog.
  **170 of 183 sampled owners still have `salesforce_id IS NULL` — 93% of closures false.** The
  2026-06-22 "cliff" is the date the window saturated. **5,509 of 6,324 real gaps never had a task.**
- **`property_missing_recorded_owner` — my "healthiest lane, leave it alone" was exactly backwards.**
  Open pinned at **exactly 1,000**, 885/885 completions the same auto-close, 146/146 sampled still
  `recorded_owner_id IS NULL`. **Zero real work in 30 days, and it cannot clear, because its open
  count is a constant.**
- **The `983 → 439` improvement stands** — driven by `establish_ownership_history`, whose 314
  completions are **0% auto-closed** and backed by 304 written ownership facts.

### ⚠️ The lesson, and it is about my own method

I switched the re-audit from lifetime totals to **rates** *specifically* to avoid being fooled by a
stale cumulative number — and the rates were themselves manufactured. **Choosing a more rigorous
metric is not the same as validating it.** The missing question was one column deep: **who closed
these, and how?** `outcome` was right there, and every row said `gap_resolved`.

**Rule now in `CLAUDE.md`: before ranking anything by completions, check WHO closed them.** A status
set in bulk by a sweep is not throughput — the same trap as P119's `inbox_triaged`, where a bulk-set
status admitted the whole historical population.

**Two further findings worth keeping:**
- **81% of the apparent value in this lane is not an owner.** 5,338 of 6,324 (84%) own zero
  properties; operators and literal placeholders (`DaVita Inc.` 2,626 properties, `Independent` 754)
  carry 5,227 of 6,442 — the documented **P113 tenant-in-the-owner-slot** trap at scale. **963 are
  real prospectable owners.**
- **P131 category (a) + (c), (b) empty** — 293 resolve ID-to-ID via `external_identities`, ~6,031
  are not on-box at all, and **zero are unstructured-on-box, so an LLM would have nothing to read
  and would fabricate.** Third time in this arc that the top-ranked "LLM opportunity" wasn't one.

⚠️ **Caveat carried from A5, not to be dropped when these numbers get quoted:** the 93% and 100%
false-closure rates are **samples of 183 and 146 rows**, not full population scans.

**Backlog filed by A5: A5a** (fix the auto-close — a correctness bug costing ~900 false closures a
month **across all dia+gov NBA lanes**, and it is manufacturing the very number the re-audit ranked
on), **A5c** (value-gate 6,324 → 963), **A5d** (fill the 293), **A5e** (retire the 5,338). None
built. **A5a lands first** — every other measurement in this area is untrustworthy until it does.


## 2026-08-27 (Cowork) — RE-AUDIT of the original automation audit: the method worked, the next target is elsewhere

Scott asked to revisit the document that started this thread
(`DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`) and re-assess where the time should go. Re-measured
the whole surface rather than assuming.

| | audit (08-26) | now |
|---|---:|---:|
| open research tasks | ~3,000 | **2,747** |
| tasks in **never-completed** lanes | **983** | **439** |
| `establish_ownership_history` | 545 open / **0** done | **156 / 314** |

**The method is validated** — split a lane into the distinct jobs it is actually asking, give each
its own consumer. The 983 → 439 drop is essentially that one lane.

**⚠️ But a finding that will mislead anyone reading the fleet-wide number: completing a lane SEEDS
the next one.** `trace_ownership_to_developer` went **18 → 152 open** while completing 12 more —
A2's completions re-seeded it *by design* (once a property has ownership history, the next question
is who developed it). **Total open fell ~250 while completions rose 314.** Draining a lane converts
open work into *different* open work. **Judge a lane by its own completion rate, never by the fleet
open count**, or every success reads as a wash.

### 🎯 The re-assessed target is a lane nobody in this arc has looked at

Switching from lifetime totals to **rates** — which is what hid the stall in the first place:

| lane | open | done 7d | done 30d | verdict |
|---|---:|---:|---:|---|
| `property_missing_recorded_owner` | 1,185 | **159** | **908** | ✅ healthiest in the system, ~23/day → clears in ~7 weeks. **Leave it alone.** |
| **`true_owner_needs_salesforce`** | **815** | **1** | **26** | 🔴 **the target** |
| `owner_contact_manual` | 311 | 0 | 0 | 🔴 externally egress-blocked — a constraint, not a design gap |
| `trace_ownership_to_developer` | 152 | 12 | 38 | 🟡 slow, now fed by A2 |

**`true_owner_needs_salesforce` is the biggest addressable stall in the system.** 815 open, **596
lifetime completions** — so the machinery demonstrably works — and then **26 in 30 days, 1 in the
last 7.** It is bigger than the ownership lane ever was, it is *proven consumable* (unlike
`owner_contact_manual`), and it has never been split, measured for actionability, or asked the P131
question.

**A5 drafted as DIAGNOSIS ONLY** (`prompts/A5-*.md`) — establish whether it stopped or decayed (a
cliff and a slope have different causes), read real rows rather than inferring from the type name,
state the P131 category explicitly, and check whether the SF link already exists via another path,
since **A2 found 291 of 331 grantors were already minted by an unattached producer**. ⚠️ The prompt
explicitly forbids building a consumer, and warns off the obvious "four jobs under one label"
hypothesis — **six plausible premises have been refuted by measurement in this arc**, two of them
about this same family of lanes.

**Also filed: `confirm_true_owner`** (151 open / 35 ever / 0 recently) — the same *worked-once-then-
stopped* shape, smaller, worth the same treatment after A5 establishes the method (**A5b**).


## 2026-08-27 17:15 UTC (Cowork) — A2b + A4b landed; refreshed the kickoff doc, which carried a DANGEROUS instruction

**Lane: `all_guarded` 18 → 7, `awaiting_draft` 0 → 11** (the A4b recovery mid-flight, not a defect
— the drafter re-runs at 06:45 and cron 244 applies at 06:49). `agrees` 64 · `mismatch` 49 ·
`sponsor_spe` 25 · `no_records` 0. Verified `split_state='awaiting_draft'` with `action=NULL` is the
**designed** shape, so the distinct-state invariant holds — my initial worry there was unfounded.

**⚠️ A2b refuted my prompt's premise, and it had been repeated in three places.** I wrote it as the
P138 `gsa_lease_diff` flicker. It is not: **that flicker has a RETURN LEG** (`A→B` *and* `B→A`) and
is caught by `is_oscillating_pair`; this population has none. It is **one conveyance observed more
than once** — per-lease fan-out (a GSA building carries many leases and the lessor of record updates
on each separately: one distinct `lease_number` per date, **13 of 13** testable properties) plus
cross-source lag. **The correction is load-bearing:** if it *were* the flicker the direction would
be untrustworthy and collapsing unsafe; it is not, so the only thing wrong is that one fact is
stored several times. `CLAUDE.md` and the canonical doc now carry the correction — **the sixth
hypothesis of mine refuted by measurement in this arc.**

**A2b** collapsed 32 links → 15 across 14 tasks (**$26.2M per OWNER**; the per-link sum reads $88.5M,
a 3.4× overstatement). Fixed in the **drafter**, never the applier — the PK is right, the input was
wrong — and it removed a **phantom chain break**, since `A→B, A→B` reads as a gap. All 14 now report
`contiguous: true`.

**A4b** corrected the gov guard. **The 7 remaining `all_guarded` are correctly guarded, name by
name** — three punctuation-variant self-transitions, a CMBS trust artifact, a strict-prefix variant,
a concatenated brokerage, and one with six `Unknown` grantors. **There is no further recoverable
population there**, which is a real answer rather than a leftover.

### ⚠️ The kickoff doc had gone stale in a way that would have caused harm

`NEW-CHAT-KICKOFF.md` still instructed a future chat to verify reachability by
*"`reachability_harvest_review` passes 4"* — **the exact criterion measurement disproved.** A fresh
chat following it would have diagnosed a false failure on a healthy lane and spent a cycle on code
that was never broken. **Corrected, and the reason kept in place rather than deleted**, because the
generalisation is what matters: *before writing any verification, ask what the worker emits when it
succeeds and finds nothing.*

Also refreshed: the CI section (now "`npm test` is a required check; `main` is protected" rather
than "CI runs no tests"), and a pointer to the canonical lane doc + its Tier 0 sibling, with the
warning that **the two share `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner
entities**, so a merge confirmed in one changes the other.

**This is the third time a doc in this repo has aged into being actively wrong within days.** The
pattern is consistent: the *state* rots fast, the *lessons* do not. Files that carry both should
lead with the lesson.


## 2026-08-27 (Cowork) — consolidated the lane into ONE canonical doc; drafted A2b + A4b

**Seven documents now covered one subsystem** (`DATA_PROCESS_AUTOMATION_AUDIT`, A1, A2, A2a, A3,
A4, the V8 review) — the "one source per topic" rule broken by accretion, and a future chat would
have had to read all seven to learn what is true.

**Created `docs/architecture/ownership-history-lane.md`** — the living canonical reference: current
state, the five actions and their consumers, **eight invariants each earned by a live failure**,
what is left, and the dated audits as an explicit **evidence trail** (go there for *why*, come here
for *what is true now*). Wired into `CURRENT-STATE.md`'s doc map. The audits are unchanged — this
is consolidation by indexing, not by deletion.

⚠️ **`OWNERSHIP_RESEARCH_FREE_FIRST_PLAN.md` was deliberately NOT folded in** — despite the name it
is a different subsystem (LLC-research backlog / SOS / contact acquisition, 2026-07-29). Merging on
a name match would have been the same error this repo keeps documenting.

**Two prompts drafted, both unblocked:**

- **A4b — a P138 guard rejects any SPE named after a street number.** `\m[0-9]{5}\M` kills
  `EGP 17101 BROOMFIELD LLC` and `DE 10990 Wilshire, LLC`. **10 of 18 tasks recoverable, and the
  defect is wider than this lane** (it also drops links inside chains that *did* draft). The
  discriminator is already measured: junk carries **no legal form**, real SPEs always do. ⚠️ The
  prompt insists on **sizing the fleet-wide blast radius before touching the predicate**, fixing it
  in its home repo rather than forking a copy, and **splitting the two largest arms** —
  A4 identified the 5-digit arm *inside* them but did not establish it explains all 23 rows.
- **A2b — one conveyance recorded on several dates.** 14 tasks / 32 links; the `gsa_lease_diff`
  flicker surviving P131's `(from, to, date)` dedup *because the date differs*. **A producer fix,
  not an applier fix** — loosening the PK would write a history in which a party acquired the same
  asset three times. The prompt forces the real judgement into the open (**which date is true** —
  earliest / latest / when the lessor field changed) and requires the other observations be
  preserved as evidence, not deleted. It also asks whether the flicker is **still producing**,
  because that alone decides whether this ships a cron or a one-shot.

**Both carry the population-drift warning** — A2's counts (12/28) already read 14/32, and the
mismatch bucket moved 74 → 49 under the V8 confirms. **Re-measure, quote your own number.**


## 2026-08-27 14:00 UTC (Cowork) — V8 confirms APPLIED + A2a landed. Lane: 314 done / 156 open.

### V8 — six sponsors confirmed, and the lane moved exactly as predicted

Inserted the six clean rows (`boyd`, `highwoods`, `rxr`, `arc`, `east`, `sunflower`) into
`lcc_ownership_sponsor_family` on Scott's authority, with before/after captured:

| action | before | after |
|---|---:|---:|
| `mismatch` | 74 | **49** |
| `sponsor_spe` | 0 | **25** |
| `agrees` | 64 | 64 *(unmoved ✓)* |
| `all_guarded` | 18 | 18 *(unmoved ✓)* |

**Perfect conservation — 25 chains moved from `mismatch` to `sponsor_spe`, nothing else shifted**,
which is the invariant the review sheet specified. *(Predicted 24, actual 25 — the population moves
as A2a drains, so the estimate was stale rather than wrong.)*
**Reversal:** `delete from lcc_ownership_sponsor_family where confirmed_at::date = current_date;`

**Deliberately NOT confirmed, per the evidence check:** `commonwealth` (15 unrelated parties incl.
government bodies), `fgf` (**90 SPEs** — Scott's own note says they are Boyd subsidiaries, so
confirming to FGF Management could misattribute a Boyd program at scale), `madison` ×2 (duplicate
entities), `carrington` / `sequoia` (Scott's call, name-derived evidence only).

### A2a — merged the duplicate entities; lane 288 → 314

**Completed ever 288 → 314**, open 182 → **156**, last completion 13:51.
`ambiguous_entity` fell from ~50 blocked tasks to **18**.

**Three things it did right that are worth keeping:**
1. **Proved the round trip on the highest-stakes group first** — the only one where the destructive
   pivot dedup-delete fires: **153 rows before, 153 after, 0 lost, 0 new, 0 content differences.**
   Exactly the check the prompt demanded, because P195's and P196's reversals each failed their
   first live attempt.
2. **Stopped when the dry run disagreed with its own prediction** (26, not the 28 predicted) and
   found out why *before* applying.
3. **Verified `auto_mergeable` moved for the right reason** — the 12 groups that left are exactly
   the ones A2a resolved, with **0 auto-mergeable groups still holding any A2a winner or loser**.
   That is the difference between a counter moving and a counter moving *correctly*.

It also triggered cron 244's own apply function rather than waiting for 06:49, and said so — the
prompt asked for exactly that disclosure.

**Blocked residue now:** `ambiguous_entity` 18 · `no_entity` 18 · `placeholder` 15 ·
`repeat_transfer_unrepresentable` 14.

**Lane arc so far: 545 open / 0 completed for 69 days → 314 completed / 156 open**, with every
remaining item named and routed rather than pooled.


## 2026-08-27 (Cowork) — V8 reviewed: Scott's evidence condition was tested, and it changes 4 of 12

Scott answered all 12 sponsor proposals, approving three **conditionally**: *"so long as there is
more evidence than just the name."* **That condition was tested rather than taken as approval, and
it fails on two, is weak on one, and one row turned out worse than it looked.**

**What evidence exists at all: almost none.** Commonwealth, Carrington, Sequoia and FGF sponsor
entities carry **no email, no phone, no metadata company, 0–1 relationships**, and their only
`external_identities` row is **the `gov` source record itself** — the thing being matched, not
corroboration. gov `true_owners` adds nothing: no `contact_info`, no `sf_account_id`, no `state`.
The only available signal is **naming-program structure** (gov `true_owners`): `boyd` **140** SPEs,
`fgf` **90**, `B9 SEQUOIA` **5**, `carrington` 6, `commonwealth` 15.

- **⛔ Commonwealth — recommend NO.** The 15 "Commonwealth" entities are demonstrably different
  parties, **including government bodies**: `Commonwealth Of Virginia Department`,
  `Commonwealth Ports Authority`, `Commonwealth Partners, L.l.c.`, `5309 Commonwealth LLC`.
  `Commonwealth Owner LLC` has no distinguishing element. **Precisely the case the condition exists
  to catch.**
- **⚠️ FGF — HOLD, and it is the riskiest row in the set** *because of Scott's own note* that these
  are Boyd subsidiaries. The sponsor map is **forward-looking** and there are **90 FGF SPEs**, so
  confirming `fgf → FGF Management LLC` could misattribute a Boyd program at scale. **Settle
  Boyd↔FGF first** — no LCC relationship records it either way.
- **⚠️ Carrington — weak** (name-family only, $1.8M): recommend deferring rather than spending a
  judgement.
- **🟡 Sequoia — pattern evidence only.** `B9 SEQUOIA` is a consistent 5-member program, so `B9` is
  a program prefix rather than noise — which answers the specific worry without producing
  independent evidence. Scott's call, and the honest boundary of what we hold.

**Six clean confirms are ready** (Boyd incl. the JV, Highwoods, RXR, ARC, East Lake, Sunflower) —
**24 of 32 chains, the same coverage as the original recommendation without the two risky
attributions.** SQL and reversal in `docs/audits/V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md`.

### ⭐ Two pieces of Scott's domain knowledge that are model requirements, not review notes

1. **JV / fund / partnership ownership is MULTI-PARTY, and the model cannot express it.** Scott:
   connect SPEs to true owners as now, *"but link to **multiple true owners** for each true owner in
   the JV… investors will own assets outright, in JV, and maybe in a fund like a DST."* Today the
   chain is single-valued (`recorded owner → SPE → ONE true owner`). **`Boyd Watterson JV UBP` is
   the live worked example** — approved into Boyd, so its second partner is currently invisible.
   Filed as **P1c / J1–J4**, including the downstream question nobody has asked: what the
   prospecting surfaces do with a two-principal asset.
2. **"Lessee" is a REAL ownership interest, not a weaker one.** A ground lease splits fee (dirt)
   from leasehold (improvements); the leasehold SPE is the landlord counterparty to the tenant. So
   `Cr Sunflower Lessee LLC` is a genuine owner — **my flag on that row was wrong, and Scott's
   correction is the durable fact.** The model should distinguish fee / leasehold / both, or a
   ground-leased asset silently reads as one owner when it has two (**J3**).


## 2026-08-27 13:28 UTC (Cowork) — the on-box Analyst's Take produces for the first time; A2a drafted

**V9 ✅ / V7 ✅ — R8 Stage 1 works.** `LCC_DEFAULT_WORKSPACE_ID` set on `tranquil-delight`,
triggered through the **production path** (`lcc_cron_post` → `/api/briefing-analyst-take-tick`,
apply): **HTTP 200**, `flag.enabled: true`, and a **508-char take, `source = onprem_ollama`,
`generated_at` 13:28:48** against `existing_analyst_take_chars: 0`. The 400 is gone.

⚠️ **One check deliberately left open: the UNATTENDED run.** A manual trigger proves the *config*,
not the *schedule* — which is precisely what V7 was about (the 2026-08-26 774-char take was a
hand-run that read as a working pipeline for a day). **Cron 240 at 10:18 UTC weekdays, with
`generated_at` inside that window, is the real close.**

⚠️ **And two faults in the same chain stay open** — `/api/daily-briefing` → **401 Unauthorized**,
and `briefing-intel-snapshot` still warns *"Anthropic API 400: credit balance too low"*. Neither is
fixed by this; the on-box take exists to route around the second.

**Also worth recording: `?generate=1` is write-free by design, so a NULL take after calling it
proves nothing.** The first attempt returned an empty body (the on-box model exceeding a 30s fetch
cap) and a still-NULL column — which looks exactly like failure and was not. Verification went
through `lcc_cron_post` instead, i.e. the path the cron actually uses.

**V8 and V9 are both MANUAL, not Claude Code prompts** — worth stating since it was asked:
V9 was an env var (done). **V8 is a judgement only Scott can make** — *is this SPE family actually
this sponsor's?* A3 built the machinery and correctly refused to auto-confirm; the rows require
`confirmed_by`, so they are SQL inserts, not a UI. **Boyd Watterson is 20 chains / $179.8M in one
decision.**

**A2a drafted** (`prompts/A2a-merge-duplicate-chain-entities-2026-08-27.md`) — merge the duplicate
entities blocking ~50 `agrees` chains; **no new applier needed**, cron 244 applies them the same
night. It is only safe now because 196 Unit 1 made `lcc_merge_entity` reversible, and the prompt
insists on **proving the round trip on this population first** — P195's reversal failed its first
live attempt on a GENERATED ALWAYS column, and P196's on a BEFORE-INSERT trigger defeating
`ON CONFLICT DO UPDATE`. It also bans `lcc_owner_strict_core` for identity here (A2 measured and
rejected it on this exact population) and asks whether `r9_chain_connect` is the *source* of these
duplicates — 291 of the 331 grantors A2 resolved are its unattached output.


## 2026-08-27 (Cowork) — A3 + A4 landed. The lane is 288 done / 182 open, and BOTH prompts corrected my premises.

**Lane state:** completed **288**, open **545 → 182**, skipped 1,766.
`no_records` is **gone from the split entirely** (74 retired). Remaining: `agrees` 90 ·
`mismatch` 74 · `all_guarded` 18.

### A4 — my "the guards are probably right" hypothesis was WRONG, and that is the finding

I wrote A4b expecting `is_oscillating_pair` to explain the 18, in which case retiring them was the
answer. Measured: **zero oscillating pairs.** The guards are **not** all correct — **10 of 18 would
be unblocked by a corrected guard.** The defect was found by computing which arm fires per name
rather than eyeballing, and checked for precision before proposing anything: the junk the guard
**correctly** catches has **no legal form** (`Houston, Harris County, Texas 77007`), while the real
SPEs all carry one. That is a clean discriminator, and it also drops links inside chains that
*did* draft — so the defect is wider than these 18. **Sized, not patched in that prompt.**

**Unit 1 shipped:** all **74 `no_records` retired**, terminal and dated, after verifying what the
seeder treats as terminal so they cannot be re-minted tonight.

### A3 — the machinery is built; the movement now needs 12 human confirmations

**⚠️ A3 rejected the key I prescribed, and was right to.** I said reuse `lcc_owner_sponsor_domain`
keyed on `sponsor_token`. Measured: **a bare token is not bounded** — `east` names **226** live
entities, `boyd` **129**, including the surname *Boyd Alexander* and addresses like
*100 East PropCo LLC*. In that table a wrong token merely fails to join to a person; **here it
would assert a false ownership fact.** And its PK cannot carry two cases already in the data:
`madison` is proposed by **two** owner entities, and `egp` names **both** Easterly Government
Properties *and* EastGroup Properties. So the registry is keyed **(sponsor entity, token)**.
**Not second-registry drift** — the detector is shared: P196's guards were extracted into
`lcc_name_reads_as_street` / `lcc_name_has_spe_marker` and P196 re-issued to call them, gated at
**0 of 696 Tier 0 rows changed.**

**Population re-measured: 73 → 74 chains / 46 owners / $403.0M** (A2 landed in between and drained
`agrees` 380 → 90).

**⚠️ P196's SPE-marker guard drops 24 of 27 genuine rows here** — a GSA SPE is named for its city
and agency (`BOYD SACRAMENTO GSA, LLC`), not "Propco". **Not applied, predicate not weakened** —
the correct call. The other three guards are applied with measured cost: street fires 3× changing
**0** outcomes, brokerage 0, and person costs **exactly 2** real false negatives, both
`lcc_looks_like_person` false positives (*City of Oakland* is not a person) — **named, not
patched.**

**Three deliberate non-actions worth keeping:** contact confirms were not inherited (they resolve
**0 of 74**, and would let a ~4-of-6 gate settle an ownership fact); `sponsor_spe` was not folded
into `agrees` (that would hand it to A2's *write* path); and the 11 `name_variant` cards were not
retired, because they ride `lcc_owner_strict_core` — which **A2 already rejected for writes on this
exact population**.

**Nothing has moved yet, and the writeup says so plainly: `mismatch` is still 74.** The positive
control proves the machinery — confirming `boyd` alone gives mismatch **74 → 54**, sponsor_spe
**0 → 20**, human_actionable **92 → 72**, with `agrees`/`no_records`/`all_guarded` unmoved — then
rolled back with **0 residue**. Residue sized at **31 chains / 27 owners / $344.6M**, characterised,
surface deliberately not built.

**👤 THE NEXT MOVE IS SCOTT'S: 12 sponsor confirmations**, ranked in
`v_lcc_ownership_sponsor_family_proposals`. **Boyd Watterson is 20 of them in one decision
($179.8M).** ⚠️ Read `token_entities_fleetwide` on each — `east` 226, `madison`/`fgf` 67, `arc` 46,
`commonwealth` 32, **`boyd` 129** — which is exactly why the key is (sponsor entity, token) and why
each confirm is per-sponsor rather than per-token.

**Three of my hypotheses have now been refuted by measurement in this arc** (A2b↔A3 shared
population, the gsa flicker, the oscillating-pair guard). Each was plausible, cheap to test, and
wrong — which is the argument for the measure-first discipline, not against it.


## 2026-08-27 (Cowork) — A3 measured before building it: the 73 "mismatches" are mostly sponsor↔SPE

**The A3 backlog row said "route the 73 to a data-integrity lane, both readings on the card."
Measured, that would have been the wrong build** — and the measurement was one query.

`action='mismatch'` means the chain's last recorded grantee ≠ the owner we hold, which reads as
*"our ownership record is contradicted."* The dominant pattern is **sponsor ↔ SPE**: the deed
records the **special-purpose entity holding title**, our field records the **sponsor**.
**Both are correct. It is a representation question, not a data error.**

| current owner on file | chains | example last-recorded grantees |
|---|---:|---|
| **Boyd Watterson Asset Management** | **24** (33%) | `BELTSVILLE GSA FDA, LLC`, `Boyd Bethesda III GSA, LLC` |
| Easterly Government Properties | 3 | `EGP 116 Suffolk LLC` |
| FGF Management | 2 | `GERMANTOWN MD I FGF, LLC`, `TYSONS CORNER VA III FGF, LLC` |
| Brookfield Asset Management | 2 | `1301 FANNIN OWNER LP`, `BOF DPC Denver West Park 54 LLC` |
| Blackstone | 1 | `BRE 1200 Wall Street Owner LLC` |
| Brent Waldman | 1 | `Waldman, Brent` — **name order, not a party difference** |

**So the build is ~4–8 SPONSOR decisions covering ~31+ chains** — reusing `lcc_owner_sponsor_domain`
(P190) and P193's inheritance — **not 73 cards.** Asking the Boyd Watterson question 24 times is
the badge-that-is-noise failure. The genuine integrity residue (`DEAMO LLC.` ← `LuLu Hsu`, and
grantees belonging to no family) is **~20–30**, and should be sized before a surface is built.

**⚠️ Two hypotheses tested and REFUTED — recorded so nobody re-walks them:**
1. **The `gsa_lease_diff` flicker does not explain these.** It predicted SPE↔parent *name
   similarity* on gsa-sourced chains; measured the **opposite** — only **7 of 47** gsa chains share
   an 8-char prefix with the current owner, against **21 of 27** non-gsa chains.
2. **No overlap with A2b** (46 vs 12 properties, zero shared).

**Guards carried into the prompt, each from a prior measured failure:** a lexical sponsor detector
is ~25% precise without P196's three guards (reuse `lcc_tier0_sponsor_brand_token`, do not write a
second); `lcc_is_spe_shell_name` **under-detects place-named SPEs** and `BELTSVILLE GSA FDA, LLC`
is exactly that shape; and **`Boyd Watterson Global` vs `…Asset Management` may be fund vs manager**
— human-confirm per sponsor, never auto-accept a shared token.

**✅ A2a is now UNBLOCKED** — prompt 196 Unit 1 landed. `lcc_unmerge_entity`,
`lcc_merge_snapshot_loser` and `lcc_merge_fold_pivot` are all live on LCC Opps, so the merge path
snapshots, folds the pivot, and reverses. A2a needs no new code: merge the pairs and cron 244
applies those chains the same night.

**Queue in this window: A3 (drafted), A4/A4b (drafted), A2a (now unblocked).**


## 2026-08-27 11:15 UTC (Cowork) — V1 ✅, V2 ✅, V7 ❌ root-caused; and a merge resurrected 31 archived files

**All three post-deploy verifications are now answered.**

- **V1 ✅ property-twin is writing again — 200 → 240**, last write **05:46:33**, inside cron 220's
  window. P135's paging fix works; the stall was the deploy cutoff exactly as diagnosed. Watch it
  keeps climbing toward the ~1,095 pending — a second plateau would mean a fixed window again.
- **V2 ✅** (confirmed 05:10) — 60 negative markers; the proposal count staying at 4 is correct.
- **V7 ❌ ROOT-CAUSED, and it is a config gap rather than a code defect.** Cron 240 fired at
  **10:18:00** and returned **HTTP 400**:
  `{"ok":false,"error":"Could not resolve workspace. Set X-LCC-Workspace or LCC_DEFAULT_WORKSPACE_ID."}`
  Today's snapshot row exists (10:00:16) with `analyst_take` **NULL**. **This settles V7's open
  question: the 2026-08-26 774-char take was a manual one-shot** (`generated_at` 20:51), never the
  pipeline. **Fix: set `LCC_DEFAULT_WORKSPACE_ID` on Railway, or send `X-LCC-Workspace` from job
  240.** ⚠️ **Two further faults in the same chain, not to be conflated with it:**
  `/api/daily-briefing` → **401 Unauthorized**, and `briefing-intel-snapshot` still warns
  *"Anthropic API 400: credit balance too low"* — the cloud-billing issue the on-box take exists to
  route around.

**⚠️ A merge resurrected all 31 archived worklogs.** They are tracked on `main` **at the root AND
in `docs/history/worklogs/`** — every file twice. Cause: the archive commit recorded them as
delete-at-root + create-in-history rather than renames, so a branch based on an older commit still
carrying the root copies re-added them on merge, silently and with no conflict. **Verified all 31
byte-identical to their archived copies before removing the root duplicates** — nothing lost.

**The durable lesson: a file MOVE is not conflict-safe across parallel branches.** Git resolved
"you deleted it / they still have it" by keeping the file, which is the safe default for content
and the wrong one for a move. **After archiving files, check the root again once other branches
merge** — and prefer landing a move when no long-lived parallel branch predates it.

**Still open in the automation window:** A4/A4b queued; A2a blocked on prompt 196 Unit 1; A3 needs
its own hypothesis test.


## 2026-08-27 05:10 UTC (Cowork) — V2 was never stalled. The verification was measuring the wrong output.

**`reachability_harvest_target_marker`: 60 markers, all written this morning, last at 04:40:19** —
inside cron 212's run. **V2 is healthy and P136 works.**

**⚠️ And `reachability_harvest_review` is still 4 — which is CORRECT.** P136's entire design is a
**negative marker** recording *checked, and empty*, so a target with no evidence stops being
re-selected forever. Targets with no evidence **correctly produce no proposal.** The proposal count
is therefore the one metric that reads zero while the fix works perfectly — and it is exactly what
the backlog row **and my scheduled 6am check** both asserted on. That check would have reported a
false failure on a lane that is fine.

**⚠️ Second trap in the same five minutes: cron 212 logs `timed_out: true` at exactly 60,000 ms.**
Per P123, `lcc_cron_post` stops listening at 60s while the handler runs to completion — the markers
landed **19 seconds in**. Read the worker's own output, never the caller's patience.

**Fixed in the same pass:** the scheduled check now asserts on `markers_total`, states plainly that
`reach_reviews` staying at 4 is expected, and tells its future self not to read a pg_net timeout as
failure. Backlog V2 → ✅ with the wrong criterion recorded rather than quietly replaced.

**New `CLAUDE.md` doctrine — the generalisation, because this will recur:**
*assert on the state delta* is necessary and **not sufficient; you must assert on the RIGHT delta.*
**Before writing a verification, ask what the worker emits when it succeeds and finds nothing.** If
that is a marker, a tombstone or a `checked_at`, **that** is the delta. It is the exact mirror of
the re-discovery-tally trap: `already_annotated` reads like throughput while nothing moves; a
negative-marker worker reads like a stall while everything moves. Both come from asserting on the
convenient counter instead of the one the design advances.

**Still open:** V1 (property-twin, cron 220 @ 05:45 — window had not arrived at 05:10) and V7
(Analyst's Take, cron 240 @ 10:18 weekdays).


## 2026-08-27 (Cowork, automation window) — ✅ THE LANE COMPLETED A TASK. 0 → 288 after 69 days.

**A2 shipped (PR #1805) and the acceptance test passed.** This was never about rows written:

| | before | after |
|---|---:|---:|
| `establish_ownership_history` completed **ever** | **0** (69 days) | **288** |
| open | 545 | **257** |
| historical ownership facts | 12,724 | **13,028** (+304, 280 owners, **$579.9M**) |

Nightly on **cron 244** (06:49 UTC — after the 05:10 seeder and 06:45 drafter), reversible by
batch tag: `select lcc_a2_unapply_ownership_chains('a2-20260827-r3')`. **A3/A4/A4b untouched at
exactly 73/74/18.**

**⚠️ The 92 `agrees` still open are NAMED, not residue** — and the largest is free:
- **48 tasks ($210.6M) blocked purely by duplicate LCC entities** (Duke Realty LP vs DUKE REALTY
  LIMITED PARTNERSHIP). **A2a needs no new code** — merge the pairs and cron 244 applies those
  chains the same night. Highest value-per-effort item currently in the backlog.
- **28 links are one conveyance recorded on several dates** — the `gsa_lease_diff` flicker.
  ⚠️ **I first wrote that this corroborated E4 and that "A2b and A3 are likely one upstream fix."
  MEASURED AND REFUTED within the hour:** 46 mismatch properties carry a `gsa_lease_diff` link,
  12 properties are blocked `repeat_transfer_unrepresentable`, and the **overlap is ZERO**.
  Same producer *name*, **disjoint populations, two distinct failure modes.** Fixing one does not
  fix the other, and **A3 cannot be collapsed into A2b.**
  **The lesson: a shared producer name is not a shared population.** Two findings that both cite
  `gsa_lease_diff` felt like one story; a single join showed they touch no property in common.
  Same shape as the P189 domain-grouping trap — plausible evidence answering a *different*
  question. **Join on the rows before merging two findings into one fix.**

**Three defects A2 found in its own code, none visible to a dry run** — each caught by measuring
the live write and fully reversed. Three clean round trips, which also **proved the reversal path
is a capability rather than a claim**:
1. An exact-match placeholder stoplist blocked `Previous Owner` but not `Previous Owner Name` /
   `… LLC` — 13 facts landed on placeholder entities.
2. `on conflict do nothing` + a fan-out join reported **365 inserts against 347 actual**.
3. **A partial apply flips the lane's own seed predicate** — one written link would have let R60
   Sweep A close 19 still-open tasks as `skipped`, leaving their remaining links unapplied *and
   invisible forever*.

**Also found: `r9_chain_connect` (cron 104) mints a prior-owner entity per chain name and attaches
it to nothing** — **291 of the 331 grantors A2 resolved are its unattached output.** A2 is its
missing consumer, which is why name resolution landed as high as it did. A producer that has run
for months with no consumer, discovered only because something finally consumed it.

**And `lcc_owner_strict_core` was tried for identity here and rejected on named rows** (it
collapses `BAMMF (8) LLC` onto `BAMMF (3) LLC`). The applier uses a narrower comparator,
unambiguous-only, through `lcc_entity_survivor`. The hazard travels with the technique, not the
function name — third time that lesson has been paid for.

### ✅ A0 shipped too — and the guard caught a second instance on its first CI run

`test/no-conflict-markers.test.mjs`, verified **red** on the pre-fix file. It found **two** damaged
files, not one, from **two different mechanisms**: a merge (`panel-redesign-verification.md`,
148 lines) and a **`git stash pop`** (`STATUS.md`). Both repaired; the genuine date conflict in
the first was **flagged rather than adjudicated**, per doctrine.

**⚠️ Two things worth keeping:**
- **Match marker CHARACTERS, never label text.** Stash-pop markers read `Updated upstream` /
  `Stashed changes` — a detector keyed on `HEAD` and a sha would have missed the second instance
  entirely.
- **The docs-only CI skip would have hidden the very population the guard exists for.** Both
  instances were `docs/*.md`, and PR #1801 was itself docs-only. The docs-only path now runs this
  one guard standalone (~1s, no `setup-node`, no `npm ci`). That was a deliberate step past A0's
  "docs + test only" guardrail and was flagged as such — **it should stand.** A guard that cannot
  see its own population is not a guard.

**Folders clean:** A0/A2 prompts and responses filed to `done/` (114 prompts, 41 responses). Live
queue in this window is **empty**; `196` belongs to the app window.


## 2026-08-27 (Cowork, automation window) — the merge procedure is now written from failures, not theory

Five PRs went through the new protected-`main` flow in one evening, and **every step of the
standard loop that failed got rewritten from the failure.** `docs/os/GITHUB-WORKFLOW.md` is now
the record of what actually goes wrong here, not a description of the happy path:

| what failed | how often | now in the doc |
|---|---|---|
| Direct push to `main` rejected (`Required status check "npm test" is expected`) | 1× | §1 — not transient; retrying never works, it needs a PR |
| Branch cut from a **stale base** because `git checkout main` / `git pull --rebase` refused a dirty tree and PowerShell carried on | **3×** | §0b + §4c — **clear the tree first, verify twice** |
| Conflict "resolved" by keeping both sides | 2× (one YAML, one prose) | §4b |
| Two windows fixing the same file independently | 2× | §4a — check `git log origin/main -5 -- <file>` first |
| Merge blocked by "out-of-date with base" **with both checks green** | 1× | §2 step 4 + §3 — **expect a third step**; a green check set goes stale when `main` moves |

**⚠️ The stale-base failure is structural here, not carelessness.** Cowork writes edits into the
working tree continuously, so **a dirty tree is this repo's normal state** — a procedure that
assumes a clean one fails most times it is run. That is why §0b now leads with `git status`
rather than mentioning it in passing.

**⚠️ And the "out-of-date" gate is the COMMON path, not an exception**, because two audit windows
commit to `main` all day. Two green checks are not sufficient on their own: they describe a base
the PR may no longer be merging into. Only the green set **after** "Update branch" describes what
actually lands.

**Also found, filed, and not yet fixed — committed conflict markers on `main`.**
`docs/architecture/panel-redesign-verification.md` lines **424–571** (148 lines) are an
unresolved merge committed as file content, from `5bbe8c0f`, unnoticed since. Git does not flag it
(no `UU` — the conflict *was* resolved, by committing the markers) and prose has no parser. Third
instance of the keep-both-sides class in one evening: in YAML it made a workflow unrunnable; here
it silently voided half a verification document. → prompt **A0**, backlog row **A0**.

**Queue (this window): A0** (conflict-marker guard + repair) and **A2** (apply the 380 `agrees`
chains). A2 is the priority — it is the one that makes `establish_ownership_history` complete a
task for the first time in 69 days, and the first prompt in this thread that **writes production
data** rather than adding a view.

**⏳ Still unverified: V1/V2/V7.** Measured 03:32 UTC — crons 212 (04:40), 220 (05:45), 239
(06:45), 240 (10:18) had not fired. Property-twin's last write was `2026-08-19 05:45:55`, exactly
cron 220's slot, which **confirms the cron fires and rules out a broken schedule** — consistent
with the undeployed-fix diagnosis. The 6am-CT scheduled check runs after all four windows.


## 2026-08-27 03:10 UTC (Cowork) — two follow-up measurements on P195's open items

### ⚠️ N11's blast radius is DORMANT, not armed — measured before treating it as an incident
The P195 entry below is right that `lcc_apply_fuzzy_merges` would auto-merge **3,053 groups with no
undo**. Measured what would fire it: **nothing does.** `cron.job` scan for `fuzzy|apply_fuzzy|
merge_entity` → **zero rows**; the only repo reference outside migrations is a *comment* in
`api/_shared/cre-registry.js`. So N11 is a **loaded gun, not a firing one** — the same disposition
CLAUDE.md gives `lcc_sync_property_owner_to_portfolio`. **Fix it before anything wires it up; do not
escalate it as live risk.** Reading "3,053 irreversible merges" without checking for a caller would
have produced exactly the wrong urgency.

### ⚠️ N3e RE-MEASURED — the parked cards are mostly parked CORRECTLY, and my first number was the instrument
I measured the 143 parked candidates as **"100% missing an employer"** — reading the JSON key
`contact_company`. **The key is `company`.** Corrected: **107 of 143 (74.8%) DO carry an employer.**
Class 11 again, and it was caught only because that answer contradicted a direct join to
`unified_contacts` (98 of 131 people had a company there). **Two measurements disagreeing is the
signal — check the key names before believing either.**

So these owners are not parked for want of data. They are parked because **the employer on file does
not match the owner**, which is the gate working as designed. Reading named rows, the *wrong* parks
fall into exactly two recognisable shapes:

| shape | example |
|---|---|
| **sponsor / SPE** — the P190/P193 relationship again | `OXFORD BIT GALLERY PLACE PROPERTY OWNER, LLC` ← Stephen Nicotra @ **Oxford Development Company**; `Salus Gov't Properties` ← **Salus Healthcare Real Estate Group LLC** |
| **junk-formatted company name defeating a string test** | `Savlan Cc Property LLC` ← Zusha Tenenbaum @ **"WWW Savlancapital COM"** |

Correct parks read plainly: `FORT WORTH TX I MG` ← Windsor Place Realty; `Ngp Vii Dayton Oh` ←
Dayton Street Partners (matched on the token `dayton`); the JP Morgan CMBS trust ← M.R. Champa LLC.

**Revised fix — and it is NOT the one N3e implies.** Do not widen the un-park (that restores the
Gary George noise). Instead: **show the park reason on the card**, and **route the sponsor-shaped
parks into the `lcc_owner_sponsor_domain` map** where the answer already lives. The population is
**75 owners / $98M**.

### Verification items still pending, both on schedule
- **N9v** — auto-attach: **0 writes at 03:10 UTC**, unchanged. Cron 241 fires **06:55 UTC**. Still
  expected; check after 07:00.
- **N9w** — sidebar: alert still open, no post-reload capture has landed. Still unproven either way.


## 2026-08-27 (Cowork) — P195: the byte-identical owner merge landed, and two traps in landing it

**66 entities merged into 56 survivors; $102,216,468 of current annual rent consolidated; 0 live
backrefs left on any tombstone; `auto_mergeable` unchanged at 3,053.** NGP Capital 5→1
($59.8M→$68.3M, **29→38 assets**), AVG Partners 4→1, GI Partners 3→1, JLB Capital 3→1, WMC 2→1,
NGP Group 3→1. Blind byte-identical groups **60 → 4**. Full writeup:
[`docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`](../audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md).

**⚠️ The prompt's premise was wrong for 4 of the 60 groups, and structurally so.**
`v_lcc_merge_candidates_normalizer_blind` selects names that reduce to NOTHING under the generic-CRE
stoplist — which is *both* acronym-named real firms ("NGP Capital" → `ngp`, under the normalizer's
4-char floor) *and* pure-generic fragments ("Capital", "Properties", "Partners Group"), which are
failed extractions. The three `Capital` rows span dia + gov with three DIFFERENT external identities;
17 of the 18 `Partners Group` rows are empty husks minted in two bursts on 2026-06-24/26. Merging
them fabricates a party. `lcc_p195_name_has_distinctive_residue` holds them (**4 groups / 25 entities
/ $158,846**, backlog **N10**). The held group worth reading is `capitalgroupproperties`: one member
carries a `costar/company` external_id of **`capital properties`** — a different company string.

**⚠️ `lcc_merge_entity` would have destroyed a live contact, silently.** It calls the reconcile with
`p_snapshot => false` (so every dedup DELETE is unrecoverable — `lcc_apply_fuzzy_merges` auto-merges
3,053 groups with no undo) and its `owner_contact_pivot` dedup `EXISTS` is **uncorrelated**: it asks
only whether the winner has a pivot at all. On `bamproperties` the winner held a pivot naming
**nobody** and the loser held the group's **only named contact, "Alex Bias"**. The driver now
snapshots the losing side and folds the pivot **fill-blanks** before merging; Alex Bias survives with
a `p195_merge_fold` provenance entry. Fixing the shared path is backlog **N11**; new playbook
**Class 15**.

**Round trip proven, and it caught a real bug.** Real merge → `lcc_p195_unmerge` → compare on
`dandmholdings`: zero residue. It failed first time on `428C9 is_current is GENERATED ALWAYS` — a
footgun already in `CLAUDE.md`, shipped past review in a `select *` restore. A reversal path that has
never been run is a claim, not a capability.

**Measured nil, with a positive control:** zero `(source_domain, source_property_id)` collisions
between members across all 60 groups, so the P175a ghost-vs-ENDED conflict never arose — against
**2,678** such collisions fleet-wide, which is what makes the zero believable.

**Class 8 scheduled, not remembered:** `v_lcc_p195_resurrection_watch` + `lcc_p195_check_resurrection()`
on **cron 243 (06:52 UTC)**, opening a deduped `p195_duplicate_owner_resurrection` alert when a
cleaned group re-accumulates. First run: `open_groups 0, regrown 0`. Read `regrown_groups`, never
`open_groups`.

**Still open, unchanged:** N3e (95 parked Tier 0 cards, $118M — do NOT widen the un-park), the
fcp/tmg sponsor entries pending Scott, N3c (bank/trustee scope rule), and the operator steps (reload
the unpacked extension, add `npm test` to branch protection, read `GET /api/tier0-auto-attach-tick`
to decide `TIER0_AUTO_ATTACH`). N3b is closed by this pass; N3a now covers only the
wording-difference half (Easterly ×2), whose obvious fix P189 already measured and rejected at 25%
precision.


## 2026-08-26 (Cowork) — P194: the Tier 0 auto-attach sweep, and what a "living loop" actually needs

Prompt 192 asked for four things. **One was built as specified; two came back different from the
brief when measured; the fourth has no input at all.** Full writeup:
[`docs/audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md`](../audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md).

**Re-measure first — the brief was two hours old and already stale.** P192's header says *ask 98 /
auto 11 / parked 146*. Live: **ask 78 / auto 9 / parked 146**. The 9 auto cards were re-read row by
row: **9/9 correct** (Deke Hunter @ hunterproperties.com, Joseph Paolino @ paolinoproperties.com,
John Bryant @ healthcarerealty.com, …). Four carry no link evidence and are still right — an exact
domain↔core match beats a CRM `company_name` string.

**⭐ §1 the sweep — `api/_handlers/tier0-auto-attach-tick.js`.** GET = ungated dry run, POST =
flag-gated (`TIER0_AUTO_ATTACH`, **off**), cron 241 at 06:55 (scheduled anyway, per P133 — an
unscheduled job is invisible). The prompt's "build it in the existing verdict path" was applied one
level deeper than written: the effect is extracted ONCE into
`_shared/tier0-attach-effect.js::applyTier0Attach`, and **`admin.js` now calls it too**, so the human
click and the sweep cannot drift. A test pins that the tier0 verdict block no longer PATCHes the pivot.

**⚠️ AND THE SWEEP WOULD HAVE SILENTLY DELETED TWO LIVE OPERATOR QUESTIONS.** The lane view excluded
owners whose pivot source was `<> 'tier0_confirm'`. `'tier0_auto'` satisfies that inequality, so the
first auto attach on an owner would have hidden **every other open card for that owner**. Measured
before shipping: **3 of 9 auto owners hold a second card, two of them live `ask`** — Healthcare
Realty Trust's `healthcarerea.com` and Capital Square 1031's `capitalsq.com`. The drain metric would
have *overstated* the work, because cards_open would fall by deletion rather than by answer.
**Durable rule: when you add a value to a column an exclusion tests with `<>`, go read the exclusion.**

**§2 the stoplist — now ONE function** (`lcc_is_consumer_mailbox_domain`); it was copied across three
migrations and had already drifted. Widening measured first: 41 people leave the pool, **exactly ONE
card leaves the lane** — `Frontier Hub LLC → frontier.net`, the known false positive.

**⚠️ The equivalence gate caught a regression I had already made.** The first rebuild predicted a
1-row diff and produced **20 removed / 1 added** (13 ngpv.com, 5 uirc.com, 1 jbg.com; George
Washington University resurrected). Cause: **P190 applied its `sponsor_map` arm and its
`is_not_prospected` gate LIVE and deliberately did not commit the view body** ("read the LIVE
definition as the authority"). The newest *committed* source therefore no longer described the
shipped view. **A migration that changes a view must carry the whole view** — "read the live
definition" makes the repo an unreliable source and guarantees the next rebuild regresses. Both are
now committed; the repo file is hash-verified against the applied statement.

**§2 of the prompt (the living loop) — the headline claim is true for ONE of the six signals it
lists.** A `weak_partial` card is un-parked only by `n_link_evidence > 0` (a candidate's
`contact_company` matching the OWNER) or a sponsor-map row. Correspondence, SF campaigns, SF
contacts, Outlook entries and titles all move `n_person_evidence`, **which the CASE never reads**:
**95 of 146 parked cards ($118M) already carry person evidence and are parked anyway.** The fix is
NOT to un-park on person evidence — that is the P188 Gary George finding (green on three person
signals for George Washington University, works at a poultry company) and would restore exactly the
noise P192 removed. Shipped the instrument instead: `v_lcc_tier0_park_watch`.

**§4 "start with the reject signal" — there are ZERO rejects.** `lcc_tier0_confirm_log` holds 27
attaches and nothing else; the 6 `reject` rows in `lcc_decisions` are `superseded` no-ops. Not built.
**And the obvious substitute is destructive:** running the rule on the 27 attaches, **16 open cards
collide with an already-attached domain and 0 of 16 are contradictions** — 13 are the NGP SPE family
on `ngpv.com`, the rest duplicate entities / sponsor↔program. A shared domain is corroboration or a
merge signal, never a contradiction. Note a lexical classifier gets this WRONG (`lcc_owner_domain_core`
buckets the NGP SPEs as "genuinely different"); the answer came from reading the names.

Suite **4,592 tests / 0 fail**; the new guard verified RED on the pre-fix predicate.


## 2026-08-26 — RECONCILED: 189, 192/194 and the sidebar P194 all merged. **Two of my own claims were refuted.**

Live state: Tier 0 lane **86 cards** (27 attaches logged), 146 parked, merge groups **5,222 → 5,343**
(+121 fallback), `auto_mergeable` **3,053 → 3,053** (proven unchanged), sponsor map 4 rows, sidebar
foreign-writer alert **open** (waiting on the extension reload).

### ✅ P189 — the merge detector's blind spot is fixed
`v_lcc_merge_candidates` now carries a namespaced `dc:<lcc_owner_domain_core>` fallback key. **RMR
Group appears** — the stated verification target. Newly visible: **121 groups / 300 entities /
$136.5M, of which 60 groups carry BYTE-IDENTICAL names ($102.4M)** — "NGP Capital" ×5, "AVG
Partners" ×4, "GI Partners" ×3. Safety was **proven, not asserted**: the blind population is all
`norm_name IS NULL`, zero empty-string, therefore disjoint from every existing group — gated against
a pre-migration snapshot at `auto_mergeable` 3,053 → 3,053, 0 pre-existing groups altered. Fallback
groups are forced `auto_mergeable = false` because `lcc_apply_fuzzy_merges()` loops that flag
straight into `lcc_merge_entity()`. **No entity was merged** — all 121 are proposals.

### ⚠️ MY RECOMMENDATION IN 189 §1b WAS MEASURED AND REJECTED
I wrote that grouping duplicates on the **shared email domain** was *"far better evidence than any
name comparison"* and said to consider it first. Graded over every same-domain owner pair: **4
net-new pairs, exactly 1 a genuine duplicate (Easterly). 25% precision.** The rest — plus 13 NGP
pairs — are **sponsor↔SPE**: the domain is shared *because an SPE family shares its sponsor's
domain*, i.e. real evidence answering a **different question**, the same shape as Gary George. A
domain-keyed view would have been a noise generator, so it was correctly not built.
*(Side findings kept: `jameshowardcpa.com` groups two unrelated owners through a shared CPA, and
`lcc_is_spe_shell_name` under-detects place-named SPEs — a stated gap, not a second detector.)*

### ⚠️ AND MY PROMPT 192 §2 WAS WRONG IN A WAY THAT MATTERS
I claimed that because decidability is computed live, *"a parked card returns to the queue
automatically the moment new evidence lands"*, and listed six signals. **True for exactly one of
them.** Only `n_link_evidence > 0` (or a sponsor row) un-parks. Correspondence, SF campaigns, SF
contact records and titles all move `n_person_evidence`, **which the decidability `CASE` never
reads**. Measured: **95 of the 146 parked cards ($118M) already carry person evidence and are parked
permanently** — Class 10 hiding inside a Class 10 fix.
**It was correctly NOT widened** — admitting person evidence restores exactly the Gary George noise
the triage removed. `v_lcc_tier0_park_watch` now makes the real mechanism observable. **The right
fix is a different resolution path for those 95, not a looser un-park.**
And §4 ("start with the reject signal") had **no input at all**: 27 attaches, **zero rejects** — a
consumer with no producer, so the demotion engine was correctly not built.

### ⚠️ CLASS 14 RECURRED INSIDE ITS OWN FIX
P191 narrowed the lane exclusion to `active_source <> 'tier0_confirm'`. P194 added a second value,
`'tier0_auto'` — **which satisfies that inequality**, so the first auto-attach would again have
hidden every other card for that owner (**3 of 9 auto owners hold a second card, two of them live
`ask`**). Worse, `cards_drained` would have *risen* because questions were deleted rather than
answered. Fixed to a SET. **When you add a value to a column an exclusion tests with `<>`, go read
the exclusion.**

### ✅ P194 (sidebar) — a retired Vercel deployment was a second writer
The Chrome extension had seven hardcoded fallbacks to the **retired Vercel deployment**, which still
serves and still holds the service key — so sidebar intake POSTs succeeded against a build frozen
before Prompt 61. The earlier "not a stale deploy" verdict was **run against the wrong deployment**:
the merge-base test interrogated Railway, and those rows were never on Railway. Fixed with one
`pickIntakeHost()`; a provenance-invariant detector (not a quality metric) now alerts on any channel
writing ≥5 rows in 7d with zero `_provider` stamps.

### 👤 OPERATOR STEPS OUTSTANDING
1. **Reload the unpacked extension** — the sidebar fix is inert until then, and the open alert is
   watching for exactly that.
2. **Add `npm test` to branch protection** on `main` (Settings → Branches). The workflow exists; a
   workflow is not a merge gate.
3. **Read `GET /api/tier0-auto-attach-tick`** (ungated, no writes) — the 9 proposals it lists are
   what should decide flipping `TIER0_AUTO_ATTACH`, not the 9/9 measured internally.


## 2026-08-26 (Cowork) — P193: SPE subsidiaries should inherit the sponsor's answer (Scott, from the lane)

Scott, working the lane: *"I'm seeing duplicates that are subsidiaries and matching the correct
contacts… these should be automatically merged or connected to the true owner parent once we have a
connected domain and person."* He was looking at `NGP VI ESSEX VT LLC → ngpv.com` directly above
`Ngp Vi Harlingen Tx LLC → ngpv.com` — same three candidates, same sponsor, asked twice.

**⚠️ This is NOT prompt 189's problem, and conflating them would corrupt the ownership record.**
Easterly ×2 and "NGP Capital" ×5 are **one firm recorded twice** → a merge. `NGP VI ESSEX VT LLC`
and `Ngp Vi Harlingen Tx LLC` are **legitimately distinct legal SPEs** holding different properties
→ a **parent relationship and inheritance, never a merge**. Both problems are live in the same NGP
name space at once, which is exactly why they must be kept apart.

**Measured: 19 of 107 workable cards are one question asked three times.**

| sponsor | SPE entities | rent | candidates | registered parent |
|---|---|---|---|---|
| `ngp` → ngpv.com | **13** | $26.1M | 3 | NGP Capital ✓ |
| `uirc` → uirc.com | 5 | $4.9M | 7 | UIRC, Urban Investment Research Corp. ✓ |
| `jbg` → jbg.com | 1 | $2.9M | 3 | — |

**19 cards → 3 questions (−84%)**, and the judgement was already recorded
(`lcc_owner_sponsor_domain.confirmed_by = 'scott 2026-08-26'`).

**⚠️ Most of the machinery already existed — checked before building.** `lcc_buyer_parents` holds
**25 human-curated parents including NGP Capital, UIRC, RMR, Boyd Watterson, Easterly and Realty
Income**; `v_lcc_entity_tier0_parent` already carries **85 parent proposals covering NGP/UIRC SPEs**.
The real gap is narrow: **`entity_relationships` has 0 parent edges and no parent TYPE exists** —
the enum is associated_with, brokers, deal_party, developed, finances, guaranteed_by, leases, owns,
purchases, sells.

**⚠️ Naming trap worth recording:** `lcc_buyer_parents.domain` is the VERTICAL (`dia`/`gov`), **not**
an email domain — it does not overlap `lcc_owner_sponsor_domain.email_domain` (P190) despite the
column name. Two meanings of "domain" one table apart; check before "consolidating" them.

**Shipped:** `v_lcc_tier0_sponsor_rollup` — read-only, one row per (sponsor, domain) with the SPE
list and the registered parent. **The bulk attach is deliberately NOT built in SQL** — the JS
verdict path carries the shape guards and re-reads the card at write time.

**⚠️ And the rollup must not collapse the WHICH-PERSON choice.** "Do the people at ngpv.com work for
the NGP SPEs?" is one judgement; "do we call Fran Cowan, Kim Phillips or David Kent?" is a second
one that stays on the card. **UIRC has seven candidates** — auto-picking there would be the P188
mistake at 5× the blast radius. Spec: `prompts/193-*.md`.


## 2026-08-27 — the gate is GREEN on `main`; two lessons from how it got there; A2 drafted

**Both PRs merged** (#1797 docs + standards; the CI fix superseded by P196). `test-suite.yml` on
`main` pins **`node-version: '24'`**, single key, and **has now been green on `main`** — which is
the bar `GITHUB-WORKFLOW.md` §6.3 sets before a new CI job counts as a gate rather than a badge.
The lockout section of that doc was **rewritten the same day it was written**: it described a
blocker that no longer exists and named the wrong branch and Node version.

**⚠️ Two durable lessons, both now in `CLAUDE.md` and `GITHUB-WORKFLOW.md` §4:**

1. **Two audit windows fixed the same infrastructure independently, hours apart.** The automation
   window branched `ci/test-suite-node-22`; the app window shipped **P196 pinning Node 24** to
   `main`. Same correct diagnosis, two defensible Node choices. **The prompt-numbering convention
   prevents filename collisions and does nothing for shared config files.** New rule: before
   PR-ing a fix to a workflow / `package.json` / a migration, run
   `git log origin/main -5 -- <file>` first. Seconds, and it would have made the branch
   unnecessary before it was pushed.
2. **⚠️ A conflict resolution that keeps BOTH sides can be structurally invalid, and no test
   catches it.** Resolving that branch against the new `main` left **two `node-version` keys in
   one `setup-node` step** (`'22'` and `'24'`). Each hunk was correct alone and each carried a
   reasoned comment block, so "keep both" felt like the conservative choice — for a **list** it
   usually is; for a **mapping** it is invalid. GitHub could not build a run, so the required
   check **never reported**. **Distinctive symptom worth memorising: *"Expected — waiting for
   status to be reported"* that no re-run fixes usually means an INVALID WORKFLOW FILE, not a
   queued run.** Re-running cannot help; there is nothing to re-run. The fix was to **abandon the
   branch, not repair it** — `main` already carried the fix, so the branch was finished, not
   broken.

**⏳ V1/V2/V7 are NOT yet verifiable and must not be read as failing.** Measured at **02:59 UTC**:
property-twin still 200, reachability still 4 — but crons 212 (04:40), 220 (05:45), 239 (06:45)
and 240 (10:18) **have not fired yet today.** The scheduled 6am-CT check runs after all four.
Reporting these as stalled right now would be the same "window not yet reached" error the check's
own prompt warns against.

**Next in this thread: `prompts/A2-auto-apply-agrees-chains-2026-08-27.md`** — apply the 380
`agrees` chains (450 links) into `lcc_entity_portfolio_facts` and complete their tasks.
**Acceptance is deliberately not "rows written":** it is
`establish_ownership_history … status='completed'` going above **zero for the first time in 69
days**. A run that writes 450 links and leaves 380 tasks open has consumed nothing — which is the
exact failure this whole arc exists to close.


## 2026-08-27 — ⛔ `main` IS PROTECTED AND CURRENTLY BLOCKED. Two standards docs.

The docs commit was rejected:

```
remote: - Required status check "npm test" is expected.
! [remote rejected] publish-c868140 -> main (push declined due to repository rule violations)
```

**Not a transient error.** `git push origin <branch>:main` is a **direct push to `main`**, and a
required status check cannot run without a pull request — so the rule engine rejects it before
anything else. Retrying never works. **Every change now goes branch → PR → both checks green →
merge.**

**⚠️ `main` is BLOCKED, which is the more urgent half.** *"npm test"* is required and
`test-suite.yml` on `main` is pinned `node-version: '20'` — three test files import Deno `.ts`
edge modules Node 20 cannot load, so the check has never been green on `main`. **No PR can pass it
until a one-file workflow fix lands.** The corrected file is `beb3aecd:.github/workflows/
test-suite.yml` (Node 22 + a comment block explaining why). ⚠️ **Do not cherry-pick that whole
commit** — it also edits `CLAUDE.md`, which has since moved 581 lines on `main`; take **only the
workflow file** onto a fresh branch off current `main`.

**Diagnosed and dismissed — not defects:**
- **CRLF warnings are correct behaviour.** `.gitattributes` exists and already normalises to LF
  (`* text=auto eol=lf`, `.ps1`/`.bat`/`.cmd` kept CRLF). Windows editors write CRLF; git converts
  on the way in, exactly as configured. Nothing to fix.
- `cannot pull with rebase: You have unstaged changes` → dirty tree (the 11
  `test/fixtures/healthcare-discovery/*.csv` predate this session). Stash or commit.
- `The upstream branch … does not match` → `git push origin HEAD`, **never `HEAD:main`**.

**⚠️ And a process trap worth recording: `git stash` silently swept a session's work.** Stashing to
clear the rebase block also stashed that turn's *tracked* doc edits (`CLAUDE.md`, `CURRENT-STATE`,
`STATUS`, the kickoff), while the two *untracked* new files survived on disk — so the branch that
got pushed carried the earlier commit and **none of the standards work**. It looked complete and
was half-missing. **`git stash` is not a scratch buffer; check `git stash list` before assuming a
branch has everything.** Recovered by re-applying the edits against current `main` rather than
popping a stash taken from a 49-commit-older base.

**Two standards docs, wired into `CLAUDE.md`, `CURRENT-STATE.md` and the kickoff:**

- **`docs/os/GITHUB-WORKFLOW.md`** — the standard loop with exact PowerShell, the wait-for-CI rule,
  a failure-mode table mapping every message above to its real cause, the unlock sequence, and six
  non-negotiables (never push to `main`; never merge before green; **a new CI job is not shipped
  until it has been green once on `main`**; never run git from the sandbox; *merged ≠ running*;
  Scott merges, Claude Code never merges its own PR).
- **`docs/os/DOCUMENTATION-MAP.md`** — where every artifact is filed, the five files that carry
  state, the lifecycle *found → shipped → retired-with-a-reason*, the two-window labelling and
  prompt-numbering convention, and a **"do not create"** list headed by *no new `.md` at the repo
  root* — **exactly how K13–K20 stayed invisible for 17 days.** It also encodes the pre-archive
  checklist that recovered them.


## 2026-08-27 (Cowork, automation window) — A1 shipped; E4 answered; and the CI gate we just built is red on main

**A1 is merged and live** (`542896a`, PR #1793). `v_lcc_ownership_history_lane_split` +
`v_lcc_ownership_history_lane_actions` verified against the live DB — the split matches the audit
exactly, with owner counts and value added:

| action | tasks | owners | links | annual rent | human-actionable |
|---|---:|---:|---:|---:|---|
| `agrees` | 380 | 360 | 450 | $714.7M | no — a confirmation |
| `mismatch` | 73 | **45** | 120 | $401.2M | **yes** |
| `no_records` | 74 | 62 | 0 | $278.5M | no — auto-retire |
| `all_guarded` | 18 | 18 | 0 | $33.5M | **yes** |

**Badge now reads 91, not 545.** Tasks with no draft: **0** (545/545, reported rather than
assumed). `awaiting_draft` and `unrecognised_payload` kept as distinct states.

**⏳ The acceptance test is still OPEN and this matters:** `establish_ownership_history` has
**still completed 0 tasks.** A1 splits; A2–A4b drain. A split that does not end in a completion is
a no-op with extra steps — do not read "A1 ✅" as the lane being fixed.

**E4 answered (I flagged it as "measure before building A3") — the mismatches PARTIALLY cluster.**
Links on the 73 chains by `citation.data_source`: **`gsa_lease_diff`/acquisition 50 links across
46 chains** · `costar_sidebar` 53 / 21 · `sales_transaction` 15 / 15 · `county_deed` 2 / 2 (chains
carry links from several sources, so these overlap). **46 of 73 chains touch `gsa_lease_diff`** —
the producer `CLAUDE.md` already documents as emitting an "acquisition" every time the GSA lessor
field flickers between an SPE and its parent, which is exactly the shape that leaves a chain ending
on the wrong side. **That is a hypothesis, not a verdict.** If it holds on the 46, most of A3 is one
upstream fix and only ~27 chains are genuine human judgements. Folded into A3; test before building
73 cards.

### ⚠️ N9 shipped and is RED ON MAIN — a badge, not a gate

`test-suite.yml` landed (PR #1792) and **has never once been green, including on `main`.** It was
pinned `node-version: '20'`, **copied from `boot-check.yml`**; three test files import Deno `.ts`
edge modules and **Node 20 cannot load a `.ts` file** (`ERR_UNKNOWN_FILE_EXTENSION` — 0 pass,
thrown before any test body runs). On Node 22 the suite is **4,606 pass / 0 fail**.
`boot-check.yml` correctly stays on 20 — it never imports a `.ts` module, which is exactly why
copying its pin was the wrong default.

**The one-line fix is on a pushed branch with no PR open, so `main` is still red.** Two operator
steps: merge it, then add *"npm test"* to branch protection as a **required** check. Without the
second, a red suite still merges — **PR #1793 proved it by merging 58 seconds after opening,
before CI finished.**

**Durable rules added to `CLAUDE.md`:** *a new CI job is not shipped until it has been green once
on `main`* (a job red on every run is a badge people learn to merge past — the precise failure N9
existed to close), and *"red on my PR" is not "my PR is broken"* — check the base branch first;
this one was red on `main` twice, and it was **not flaky**.

### Root-worklog consolidation — and it recovered five measured defects nobody had filed

31 one-off worklogs sat at the repo root; they are now `docs/history/worklogs/` + an `INDEX.md`.
**Scanned for open-work markers BEFORE moving** — 24 clean, 7 not — and everything actionable went
into `PLANNED-BACKLOG.md` **P10 as K13–K20**, each keeping its original measurement:

- **K13** `cm_gov_sold_cap_by_term_dot` uses the **old term ladder**, not `firm_term_years_at_sale`
  — **1,368 cap-eligible sales bucket differently**, and `cap_5to10` is labelled `6-10`. A stale
  view definition, *not* a data-ingestion failure (term data is 3,211/3,211 populated).
- **K14/K15** `cm_gov_lease_termination_rate_m/_q` can select a **corrupt partial snapshot** as its
  active denominator (Feb-2019: **11 lease keys vs ~8,050**), plus the corrupt source months
  themselves, which every other consumer can still hit.
- **K16** `cm_gov_rent_price_psf_q` has no display policy; pre-1997 is unreliable — **Scott's call**
  between 1997-06-30 and 2003-01-01.
- **K17** `cm_gov_market_turnover_m` — export crops at 2012 in code while the gov `cm_view_registry`
  has no `display_from`, so DB and export policy disagree.
- **K18** `cm_gov_core_cap_rate_dots` keeps a lease-derived fallback plotting **0 rows today** —
  fine now, a leak for future unbackfilled sales.
- **K19** the gov seller-sentiment `_8q` / `6+ yr` fix was **never mirrored to dia**.
- **K20** dia 23654's **Census-radius demographics write** (Prompt 16 item 3) never completed.

Four other flagged files matched on *follow-up* / *remaining* but their items were already closed in
the same file — read in full, nothing carried.

**⚠️ The durable lesson, and it is about our own process:** **a consolidation scoped to a directory
misses whatever sits outside it.** P141 was thorough inside `docs/` and still left five measured,
unfixed Capital-Markets chart defects invisible for **17 days** — they were never in any index,
including the backlog that exists precisely to hold unbuilt work. **Enumerate by file type across
the whole repo, not by folder, and grep candidates for open-work markers *before* moving them.**
Three live doc references were repointed to the new paths in the same change.


## 2026-08-26 (Cowork, automation window) — the end-to-end data-process audit: we are not short of automation, we are short of CONSUMPTION

Picked up the Ollama-hygiene thread in its broader framing — *audit our data processes end to end,
recommend where AI/automation raises productivity*. Full writeup:
`docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`.

**~3,000 research tasks and 419 decisions are open. 983 tasks sit in lanes that have NEVER
completed a single item** — one of them for 68 days. Meanwhile the auto-retire sweeps are working
well (9,605 skipped across the healthy lanes) and every assist is producing. The gap is not
production and not retirement; it is the middle.

**⭐ The biggest single win, and it needs no model at all.** `establish_ownership_history`:
**545 open, 0 completed in 68 days** — while **453 finished, deterministic, record-cited answers
sit in `lcc_clean_assist_proposals`** from P131/P133. Reading their confidence shows why nobody
works the lane: it is **three completely different jobs wearing one label.**

| bucket | n | what it really is | correct action |
|---|---|---|---|
| agrees with current owner | **380** | a **confirmation**, not a question — and it carries ~707 ownership links the BD spine is missing | auto-apply, no human |
| **⚠️ MISMATCH** | **73** | last recorded grantee **≠** our current owner — our record is contradicted | a data-integrity **alert**, not research |
| nothing on file | **92** | unanswerable from what we hold | auto-retire, terminal |

**The 73 is exactly the "~73 mismatch flags" backlog V3 predicted as "a free data-integrity
signal."** It is free, it is real, and it is buried under 472 items that are not questions.
A lane that mixes *confirm what you already believe* with *your ownership record is wrong* with
*this cannot be answered* trains the operator to skip all three — which is precisely what 68 days
of zero completions looks like.

**P131 lens: category (a) — already on-box and STRUCTURED. This is plumbing, not an LLM.** The
most promising-looking model opportunity in the system turned out to need no model. Third time
that lens has paid.

Filed as backlog **P1b / A1–A7**. Also flagged: six lanes with **zero** lifetime completions
(119 items) needing a consumer or honest retirement; `confirm_true_owner` **stalled** not dead
(35 decided once, 0 in 7d); `match_disambiguation` ranked for 81 days with **1** decision.

**Negatives recorded too** — no evidence the assists under-produce, no evidence the sweeps are too
aggressive, and **no new LLM opportunity surfaced by this pass.**

**Follow-up, same session — the structured payload corrected my own measurement twice.** Drafting
A1 meant checking whether the classifier I had measured with (`reason ilike '%does not match the
current owner%'`) was safe to build on. It is not — that is the **P182 trap**, a text detector over
prose the drafter generates. `proposed_link` already carries `terminates_at_current_owner`,
`draftable`, `insufficient_reason`, `continuity.contiguous` and `research_task_id`. Both methods
agree at **380 / 73 / 92**, so the finding stands — but only the structured one is buildable, and
it surfaced two corrections:

1. **⚠️ The 92 are TWO populations, not one.** **74 `no_transitions_on_file`** (genuinely nothing
   recorded) and **18 `all_transitions_guarded`** — transfers **do exist** and every one was
   rejected by a P138 guard. Those 18 are *"data we chose to distrust"*, not *"no data"*, and a
   marginally over-strict guard is recoverable. **Auto-retiring all 92 together would silently
   discard the recoverable half** — P181 recurring. Split into A4 (the 74) and **A4b** (the 18).
2. **The "~707 links" figure I published hours earlier is stale** — it was P131's original count.
   Measured now: **570 links across all 453 draftable chains, 450 of them in the 380 auto-appliable
   ones.** Corrected in the audit doc and backlog A2. Do not quote 707.

**Prompt drafted: `prompts/A1-ownership-lane-three-actions-2026-08-26.md`.** ⚠️ **New numbering
convention, because two windows are drafting prompts at once:** the automation window uses
**letters matching its backlog rows** (A1, A2, …); the app window keeps the **numeric** series
(189, 192, 194, …). They can no longer collide.

**A1 splits only** — no writes, no retirement, no auto-apply; A2/A3/A4/A4b each land separately and
reversibly. Its acceptance test is deliberately not "the view exists": it is
**`establish_ownership_history` completing its first task ever.**


## 2026-08-26 — ⚠️ TWO AUDIT WINDOWS ARE RUNNING IN PARALLEL. Know which one you are in.

Scott is running two Cowork chats against this repo at once. **They have different scopes and must
not cross**, or the same finding gets built twice or dropped by both.

| | **App audit** (desktop window) | **Data-process & automation audit** (this thread) |
|---|---|---|
| **Scope** | LCC the application — defects, lanes, surfaces, code fixes | Our **data processes end to end**, and where AI/automation (incl. the on-prem Ollama model) can raise productivity |
| **Owns** | prompts **189** (duplicate owner entities), **192** (Tier 0 auto-attach + living loop), **194** (sidebar extraction bypass) | the W5.3 / Ollama-hygiene lineage: `W53_AND_OLLAMA_HYGIENE_KICKOFF.md`, `LOCAL-MODEL-LEVERAGE-MAP.md`, `LOCAL-MODEL-GAP-AUDIT.md`, backlog **P2 (L1–L10)** + **N4–N7** |
| **Backlog rows** | N3a/N3b/N3c, AC1b–AC1d, AC2–AC10, N8/N8a | L1–L10, N4, N5, N6, N7, V6 |

**The split that matters and is easy to get wrong:** a *finding* about a data process stays here
even when its *code fix* goes there. The W5.3 sidebar-channel discovery is the worked example —
the measurement, the refuted seed hypothesis and the "split by channel, then split again" lesson
are **this** thread's output; prompt 194, which repairs the writer, is the **app** thread's.

**Do not action 189 / 192 / 194 from this chat.** They are drafted, correct, and dispatched.


## 2026-08-26 (Cowork, late) — sized the W5.3 channel split; the obvious next build is refuted

Scott asked what the email/PDF path would gain if it seeded from structured capture the way
sidebar does. **Measured answer: nothing. Do not build it.**

**The seed is not where sidebar's coverage comes from.** Sidebar is itself **two populations**:

| sidebar sub-population | rows (30d) | OM-class | cap | NOI |
|---|---|---|---|---|
| **rich seed** — CoStar *page* capture (`asking_price`, `cap_rate`, `tenant_name`, `domain_property_id`) | 101 | **0** | **0%** | **0%** |
| **bare seed** — document capture (`tags` only) | 249 | 76 | 36% (**87%** in the OM subset) | 34% |

**65 of the 101 rich-seed rows carry a `cap_rate` in the seed and 0 carry one in the snapshot**;
identical-value counts for cap/price/tenant are all **0**. The high-coverage OM rows are the ones
with *no* structured hints. Sidebar's quality is a **genuine extraction**, not an echo of CoStar —
so the 87%-vs-65% gap is not an argument for seeding email. Recorded as backlog **N8b 🚫** so the
idea is not re-raised off that gap.

**⚠️ This also refutes the hypothesis I put in the audit doc and prompt 194 four hours ago.**
Corrected in both, plus `CLAUDE.md` — the wrong lead would have cost Claude Code a session.
**Corrected hypothesis: a distinct sidebar DOCUMENT-extraction path with its own older prompt** —
good enough to out-recall the email path, predating Prompt 61.

**The lesson generalises past this table:** "split by channel" was right and **not sufficient** —
the channel that mattered had to be split again. The unsplit sidebar average (36% cap) and the
document-only average (87%) differ by 51 points and describe different things. **A population
defined by WHERE a row entered can still hold two populations defined by WHAT entered.**

**New question opened (N8a):** the 101 page captures carry structured CRE data that never reaches
the extraction snapshot. `CLAUDE.md` says `sidebar-pipeline.js` writes the domain DBs directly —
**a docs assertion, unverified.** If it is being dropped, that is a real capture loss. Folded into
prompt 194 rather than assumed either way.


## 2026-08-26 (Cowork, late) — V1/V2 were never broken. They were never DEPLOYED.

Picked up the P0 "verify, don't build" tier. Both stalled lanes have **one cause**, and it is not
in their code. The build serving all day was `bb26453a`, cut at **16:03 UTC**:

| fix | merged | vs cutoff | production |
|---|---|---|---|
| P131 ownership-chain drafter | 15:18 UTC | **before** | ✅ 545 rows |
| P135 property-twin | 18:16 UTC | after | ❌ 0 |
| P136 reachability | 18:56 UTC | after | ❌ 0 |

Same day, same author, same quality — the only variable was which side of the deploy cutoff they
landed on. **⚠️ I had escalated these hours earlier to "a second stall to diagnose." That was
wrong, and it was one `git merge-base --is-ancestor` away from being obviously wrong.** Corrected
in `PLANNED-BACKLOG.md` V1/V2 and `CURRENT-STATE.md` §4 rather than quietly reworded.

**Two traps inside the diagnosis, both nearly fatal to it:**
- **`/version` reports `git_pinned: true`** — a claim, not proof. What made it safe was the
  sibling lane: P131 shipped 3 hours earlier and writes 545 rows/night, so the boundary between
  the two IS the answer.
- **A DB migration ships instantly; the JS reading it does not.** P192/P193 visibly moved the Tier
  0 lane counts (views + migrations) while P135/P136 did nothing — the same "deploy" was
  half-applied. Never infer a JS change shipped because its SQL half works. Likewise a `pg_cron`
  job existing proves nothing about the JS it calls.

**Cleared, mid-diagnosis, by PR #1789 (23:13 UTC).** `/version` moved `bb26453a` → `870445f1`
while I was measuring; **0 commits are now un-deployed.** A "redeploy Railway" recommendation
written five minutes earlier would have shipped stale — the re-measure doctrine applied to the
deploy itself.

**Also found: R8 Stage 1 is a ONE-SHOT, not a pipeline** — and `CURRENT-STATE.md`, written the
same day, already called it "LIVE and producing." The 774-char take carries
`generated_at = 20:51 UTC` against a row created at 10:00 and a cron firing at **10:18**, so cron
240 did not write it; it was generated by hand during the P138 session. → backlog **V7**.

**Nothing is proven until the lanes move.** Three verifications, all tomorrow:

| lane | cron | window (UTC) | passes when |
|---|---|---|---|
| property-twin | 220 | 05:45 | proposals pass **200** |
| reachability-harvest | 212 | 04:40 | `reachability_harvest_review` passes **4** |
| Analyst's Take | 240 | 10:18 (weekdays) | a take lands with `generated_at` **inside** that window |

New `CLAUDE.md` doctrine: **"MERGED" IS NOT "RUNNING"** — run
`git merge-base --is-ancestor <fix> <deployed>` *before* any other hypothesis about a worker that
writes nothing.


## 2026-08-26 (Cowork, evening) — picked up the W5.3 / Ollama-hygiene thread; it was measuring the wrong population

Scott: *"pick up the thread that the W5.3 and Ollama hygiene campaign last left off."* The
**hygiene half (W8) is complete** — U1/U2/U3/U4/U5 all shipped, all `on`; its only open items are
the two stalled lanes (V1/V2). **The W5.3 half is what was still open**, and the open end was not
the one the backlog described.

**The backlog row (L8) asked for "a re-grade on ~50 fresh intakes post-Prompt-61." That re-grade
already happened on 2026-08-11 (102 extractions) and upgraded the verdict to "validated."** What
nobody checked is *what population it graded.*

**`staged_intake_extractions` is fed by three channels with different INPUT types, and only two
ever run the hardened prompt.** Last 30 days:

| channel | rows | `_provider` stamped | hardened (P61) schema |
|---|---|---|---|
| **sidebar** | **350** (56%) | 67 | **0 — zero, ever** |
| email | 261 | 87 | 69 |
| folder_feed | 9 | 8 | 7 |

All seven P61 keys are **structurally absent** from sidebar snapshots (not null within them), so
this is a different prompt, not a coverage shortfall. **A fleet-wide coverage number therefore
moves with the channel MIX, not with prompt quality** — and the Aug 7–11 grading window is exactly
when a 64-row sidebar backfill landed.

**On OM-class docs the unhardened channel BEATS the hardened one on every field** — sidebar NOI
80% / cap 87% / building SF 96% / responsibilities 78%, against email 52 / 65 / 65 / 44. Not a
verdict on the prompt: sidebar reads **structured CoStar page data**, email runs **AI extraction
over a PDF**. Comparing them measures the input. **The verdict reverts to UNPROVEN for the
email/PDF path — not refuted**, and the first unmixed reading of that path (NOI 52%, tenant 60%,
responsibilities 44%) is stated without a conclusion attached, because none is established.

**Three hypotheses ruled out, recorded so nobody re-walks them:** stale deploy (live `/version` =
`bb26453abc01`, and `git merge-base --is-ancestor` confirms it **includes** the P61 commit — the
tempting answer, checked and wrong); a second writer (repo-wide grep: exactly **one** insert site,
`intake-extractor.js:751`, with `stripNonSaleKeys` + `ensureProviderStamp` on the two lines above
it); a flow writing the table directly (none). **The remaining candidate is the `seed_data` /
extraction-race interaction** — that 96%-building-SF profile is what a structured capture looks
like, not a full-key LLM return — and it needs **runtime evidence**, which is why it goes to Claude
Code as **prompt 194** rather than being guessed at here.

**Also found: `_provider` stamp coverage is decaying, not fixed.** The post-93 "100% (87/87
backfilled)" was a **backfill, not a repaired writer** — 08-10: 64/64, then 08-14 1/9, 08-19 0/4,
**08-26 0 of 21**. Class P176: *a one-shot repair of a recurring producer is a chore you repeat
silently forever.* → backlog **V6**.

**Reconciled prompts 139 / 140 / 141** (responses filed to `responses/done/`):

- **139 shipped** (PR #1787) — and its response surfaced something bigger than the prompt.
  **⚠️ NO WORKFLOW RUNS `npm test` ON A PR.** `boot-check.yml` is the only PR check and it runs
  `npm run check:boot` — a `node --check` sweep plus a `server.js` import. **The 4,551-test suite
  never executes in CI**, which is how #1786 merged green carrying a red suite and duplicated
  `<script>` tags. Every "guarded by `test/*.test.mjs`" claim across `CLAUDE.md` is a **local**
  regression detector, not a merge gate. It is the exact mirror of the 2026-07-20 incident
  `boot-check.yml`'s own header describes — that one produced the workflow; its twin was left
  standing. Fix is small, offline, and already scoped (`npm ci && npm test` on `pull_request`);
  **not built, because widening a lane PR into a CI-policy change is Scott's call** → backlog N9.
- **140 merged** (PR #1788), **grade still outstanding, flag still off.** The endpoint ships with
  the Railway redeploy; the sandbox has no `OLLAMA_URL` so every model path was stubbed and no
  real sample exists. Prompt moved to `done/`; the grade is carried as an operator step (N2).
- **141 shipped** (`07b2f845`) — CURRENT-STATE + PLANNED-BACKLOG created, STATUS trimmed to
  2,440 lines, preservation manifest in `docs/history/DOCS_CONSOLIDATION_2026-08-26.md`.

**Re-measured, unchanged, now escalated:** property-twin **still exactly 200 / 0 in 7d** (two
nightly windows since P135 merged); reachability-harvest **still 4 / 0 in 7d** (13 days). Both
flags read `on`. These have stopped being "awaiting verification."

**Healthy and moving:** clean-assist **45 → 63 in nine hours**; ownership-chain 545/545.
**Scott's Tier 0 lane is draining — 27 confirms logged today**, lane 109 → **87 open** (78 `ask`
/ $237M, 9 `auto` / $10M). ⚠️ **Do not attribute that −22 to the confirms alone** — **P193 (SPE
sponsor inheritance) also merged to `main` today** (`18c55acf`) and removes cards by design, and
P191 restored some. The three effects are mixed in one number; separating them needs
`lcc_tier0_confirm_log` diffed against the lane, which nobody has done. Prompt 193 filed to
`prompts/done/` (merged; no response docx — it landed as a direct commit).

Docs updated: `CLAUDE.md` (two new footguns), `CURRENT-STATE.md` (§1 CI row, §2 intake caveat,
§4 health table, §7 three new overturned claims), `PLANNED-BACKLOG.md` (N1 ✅, N2 ⏳, **N8/N9/V6
new**, L8 premise rewritten), `ROLLOUT_STATUS.md` (W5.3 corrected in place),
`NEW-CHAT-KICKOFF.md` (rewritten).


## 2026-08-26 (Cowork) — DIVISION OF LABOUR: Scott works the lane, the builds run in parallel

Scott asked whether to work the Decision Center lane now or wait. **Work it now — the two tracks do
not block each other.**

**Scott's track (nothing I build changes these judgements):** the 98 `ask` cards, top-down. Top of
queue today — Easterly ×2 → **attach Pulliam, not Shuler** (acquisitions vs deal execution);
TIAA-CREF (2 candidates); RMR Group (19 candidates at rmrgroup.com, Adam Portnoy among them, plus a
separate `rmrgroupinc.com` card that is a **different firm** — reject it on its own merits);
Prologis; Cunningham; Genesis Financial; Cambridge (two domains, one is Cambridge Management Ltd —
likely a different firm). Two `auto` cards (AVG Partners, Agree Realty → Joey Agree) are
one-click confirms.

**Duplicate-entity exposure at the top is small and known: 2 of the top 20 cards** (the two Easterly
entities asking the same question). Answering both is not wasted — the P189 merge consolidates them
afterwards. ⚠️ Note the naive check under-reports it: grouping the queue by `lcc_owner_domain_core`
returns "no duplicates" because Easterly's two entities produce *different* cores
(`easterlygovproperties` vs `easterlygovernmentproperties`). **Same blind spot as
`lcc_normalize_entity_name`, one function over** — a wording difference defeats any single
normalizer, which is why P189 needs a fallback key AND a wording pass.

**Build track (parallel, no operator input needed):** prompt 189 (duplicate entities — now the top
priority, `v_lcc_merge_candidates` blind to 1,089 orgs) and prompt 192 (auto-attach sweep through
the existing JS verdict path + the living-loop signals).

**Newly surfaced while ranking:** `Truist Bank → truist.com` ($6.2M, **15 candidates**) and other
bank/trustee owners are in the queue. A bank appearing as owner-of-record is usually a trustee or
lender, not a prospect — worth its own scope question rather than 15 person-picks.

**Folder cleanup:** prompts **139** (clean-assist xref interleave — shipped, CLAUDE.md carries the
P139 section) and **141** (docs consolidation — commit `07b2f845`) moved to `prompts/done/`.
**140** stays live: `OWNERSHIP_CHAIN_ROLE_LABELS` is still ungraded and still off. Live queue is now
exactly three files: 140, 189, 192.


## 2026-08-26 (Cowork) — P192: stop asking questions the data already answers. 255 cards → 109.

Scott, after working the lane: *"only propose the strongest candidates… only asking the human when
we absolutely need it… this is not a final determination but an ongoing pursuit… a dynamic and
living thing."* Plus: *"I still see a number of duplicate firms."*

**⚠️ Both observations have ONE cause.** Most apparent "duplicate firms" are one owner shown twice
because its SECOND domain card is a weak match nobody should be asked about — *Cunningham
Development Co → cunninghamdevco.com* (real) sitting directly above *Cunningham Development Co →
cunninghamwalters.com* (a different firm, zero evidence). **Gating on decidability removed most of
the apparent duplication without touching entity resolution.**

**The missing axis: "link evidence" was never sufficient on its own, in either direction.**
Prologis → prologis.com has ZERO link evidence and is near-certain; Westlake Village Natomas →
`westlakefarmsinc.com` HAS link evidence and is **a farm**. What was missing is how strongly the
domain identifies the owner, computed from the P187 order-preserving core: `exact` /
`domain_is_core_prefix` / `core_is_domain_prefix` / `curated_sponsor` / `weak_partial`.

| decidability | cards | owners | rent |
|---|---|---|---|
| `ask` — the operator's queue | 98 | 90 | $394M |
| `auto` — exact match, ONE candidate | 11 | 11 | $26M |
| `parked_domain_only` — never shown | 146 | 105 | $231M |

**Operator queue 255 → 109 (−57%) with no strong card lost.** Verified on named rows:
Easterly/easterlyreit.com still visible, Prologis still visible, while `crystalmgmt.com` and
`cunninghamwalters.com` — the two weak cards at the top of Scott's screenshot — are gone.

**⚠️ Auto-attach is `exact` ONLY, and one tier of match strength is the whole difference.** The 11
exact/single-candidate cards read **11/11 correct** (Agree Realty → Joey Agree, Paolino Properties
→ Joseph Paolino, AVG Partners → Arnold Schlesinger). The next tier down, `domain_is_core_prefix`,
reads ~9/12 and its failures are severe: **JP Morgan Chase CMBS Trust → jpmorgan.com** (a
securitization vehicle, not the bank, not a prospect) and **Frontier Hub LLC → frontier.net** (an
ISP — `frontier.com` is in the consumer stoplist, `.net` is not).

**⚠️ The 11 `auto` cards STAY VISIBLE and flagged** until the sweep that writes them exists. Hiding
a card nobody attaches is Class 7 (correct-and-invisible = not built).

**The living half is designed, not built** — `docs/claude-code/prompts/192-*.md`. Key property
already true: decidability is **computed live, never stored**, so a parked card returns to the
queue automatically the moment correspondence, an SF campaign, a title or a sponsor entry lands.
**Converting it to a stored status without building the sweep that clears it would be Class 10 +
Class 12**, both already paid for here.

**Still needs prompt 189 in parallel** — P192 removes *apparent* duplication only. Easterly is 2
real entities and "NGP Capital" is 5; no card triage fixes that.


## 2026-08-26 (Cowork) — P191: the lane closed cards it had no business closing (found by working it)

**Scott worked the first five Tier 0 cards and noticed duplicate companies. Reviewing what was
written found a real defect — in the lane, not in his judgement.**

**All four attaches are mechanically correct**: written, logged in `lcc_tier0_confirm_log`,
reversible, pivot and `entity_relationships` consistent. Nothing to undo for correctness.

**The defect: attach was per-OWNER while the card is per-(OWNER, DOMAIN).**
`v_lcc_tier0_owner_contact_lane_open` filtered `where not owner_already_has_contact`, and that flag
is derived per owner. P188's write-up explicitly claims *"rejecting one never closes the other"* —
true for reject (keyed on `subject_ref`), **false for attach**. So attaching any one domain card
closed every other domain card for that owner.

**What it cost, on the highest-value lane in the system:** the attach landed on
`easterlypartners.com` — **Alison Bernard, 0 emails, no SF, no Outlook, no campaign** (the card's
own counters read link 0 / person 0) — and silently suppressed the `easterlyreit.com` card holding
**Andrew Pulliam: 109 emails, in Salesforce, in the GSA Buyer campaign, 37 edges, EVP-Acquisitions**
— the doctrinal pursuit target. No signal was given that a better card had just closed.

**Fixed (P191):** closes only the (owner, DOMAIN) actually decided, discriminating on
`owner_contact_pivot.active_source = 'tier0_confirm'` so the 1,381 owners with contacts from
elsewhere stay excluded and the lane does not inflate. Measured: cards **260 → 256**,
easterlyreit.com **0 → 2** (7 candidates each), easterlypartners.com stays 0, Boyd Watterson stays
0. **No revert needed** — the verdict path supersedes rather than overwrites, so attaching Pulliam
on the restored card makes him active and leaves Bernard on the bench.

**New playbook Class 14 — a WRITE whose scope is wider than the QUESTION it answers.** Detector:
compare the key of the *question* to the key of the *exclusion*, check **every verdict type
separately** (reject was correct, attach was not — testing reject would have "proved" the design
sound), and after the first real verdicts diff the open list: one attach should remove one card.

**⚠️ And duplicates stopped being abstract.** Easterly is two owner entities, so the same question
was answered twice and the same person attached to both. **"NGP Capital" is five entities** — the
$8.5M one still has an open `ngpv.com` card asking what was already answered for the $59.8M one.
This is now duplicated operator work on the top lane, which raises prompt 189 above everything else.


## 2026-08-26 (Cowork) — P190: Scott's two Tier 0 decisions, applied live

**Decision 1 — "drop all universities."** Scott's explicit call, made with the cost stated: it
removes **George Washington ($23.8M) and Georgetown ($8.0M)** along with the public ones. Coherent
with doctrine — a university is an institutional owner-occupier, not a net-lease investor we show
deals to. **Prospecting only; ownership reconciliation is untouched.**
New `lcc_owner_name_is_not_prospected()` = public body OR university, composed rather than
overloading `lcc_owner_name_is_public_body` (Georgetown is not a public body, and that predicate
has two other consumers). University test measured fleet-wide: **87 organisations, all read and
confirmed genuine**; the trailing-"University" arm needed a negative guard because
`Nahmco Llc-s Series 2015 University` is a private LLC. 15/15 named-row gate including the
place-name traps ("Boyd College Station TX LLC", "University Park Plaza LLC").

**Decision 2 — the curated sponsor→domain map, 4 of 6 confirmed.** `lcc_owner_sponsor_domain`
(human rows only, `confirmed_by` required) seeded with **ngp→ngpv.com, uirc→uirc.com,
hpi→hpitx.com, jbg→jbg.com**. Scott explicitly **deferred fcp and tmg** — *"I'm unsure on that
fourth one and would need to google and check SF and our records to confirm"* — so they are NOT
seeded. This is the replacement for the acronym RULE that P187 measured at ~30–40% and rejected.

**Result:** candidate pairs **558 → 650**, owners **208 → 226**, open lane cards **237 → 260**.
The sponsor arm alone contributes **93 pairs / 25 owners / $123.4M**, of which **NGP is 17 owners
and $105.5M** across its SPE variants — the single largest coverage gain of the whole Tier 0 arc,
and unreachable by any rule. GWU → 0 ✓, Georgetown → 0 ✓, Boyd Watterson → 2 ✓, RMR → 20 ✓.

**⚠️ A deliberate inconsistency held for one round:** `v_lcc_top_seller_prospects` (4,118 rows,
would drop 17) and `v_lcc_owner_contact_decidability` (311 rows, would drop 2) still call
`lcc_owner_name_is_public_body` directly, so universities remain in THEIR scope. Repointing a
4,118-row seller surface blind at the end of a session was the wrong trade; **close it next.**

**⚠️ Postgres caught a real mistake here.** The first attempt at the view rewrite dropped
`match_arm`/`match_key`, which P188 had appended, and failed with `42P16 cannot drop columns from
view`. `CREATE OR REPLACE VIEW` is append-only for columns — re-read the live column list before
rewriting a view someone else has extended.


## 2026-08-26 (Cowork) — Tier 0 owner-contact arc COMPLETE: P186 → P187 → P188 (all merged, live)

**The bench that reads "— none" on top owners now has a working consumer.** Three prompts, each
correcting the one before it — the corrections are the point.

**P186** (PR merged) — `v_lcc_tier0_owner_contact_candidates` **58,694 ms → 252 ms (124×)**,
0-row equivalence diff both directions. ⚠️ *The recorded cause was wrong on both halves*: the rent
function was 0.3% and the two `EXISTS` 0.09%; 99.5% was a keyless join at `loops = 5,624,400`. A
prefix match on a metacharacter-free token is an equality join. Also: **public bodies out of
prospecting scope** per Scott (`lcc_owner_name_is_public_body` widened, 27/27 named-row gate, OBO
guard; ownership reconciliation untouched) and no blanket `university` rule — GWU $23.8M and
Georgetown $8.0M are private and must stay.

**P187** (PR merged) — the matcher was structurally blind to the biggest owners. `length(token)>=5`
yielded **zero tokens** for NGP/RMR/TIAA/USAA/GI/HPI/AVG; `watterson` could not prefix-match
`boydwatterson`; the stoplist ate "Realty Income Corporation" entirely. Fixed with
`lcc_owner_domain_core()` (**order-preserving** — `lcc_owner_strict_core` SORTS to
`assetboydmanagementwatterson`) plus an 8-char prefix-equality arm. Pairs 2,314 → 558, top-of-book
precision 76–80% → **~91%**. **Boyd Watterson ($179.8M), RMR incl. Adam Portnoy, Realty Income incl.
Sumit Roy, TIAA-CREF, GI Partners, AVG, Cole Capital visible for the first time.** Acronym arm
built, measured and **rejected**: 27.6% of owner names are entirely uppercase (the SPE naming
convention), so it produced `BOYD DEL RIO GSA LLC` → **dell.com**.

**P188** (PR #1785, merged, redeploy live) — the consumer: federated Decision Center lane
`tier0_owner_contact`, **558 pairs → 283 cards → 237 actionable / 171 owners / $695M**, one card per
(owner, DOMAIN), verdicts attach/reject/research, reversible via `lcc_tier0_confirm_log`.
**Nothing is written to `owner_contact_pivot` until Scott clicks.**

**Four corrections worth more than the features:**
1. **Evidence attests the PERSON, not the LINK.** Split: `company_confirms_employer` 164 vs
   `company_matches_owner` 99. Gary George (George's Inc, a poultry company) carries three of four
   signals for George Washington University.
2. **⚠️ P187's fan-out gate re-created the exact cross product P186 removed** —
   `Rows Removed by Join Filter: 6,222,095`, invisible because the gate returns 160 rows.
   3,099 ms → 1,263 ms. **A gate that filters a join is part of that join.**
3. **⚠️ Measuring a gate is not shipping a gate** — P186 measured the token fan-out gate, reported
   its effect, and never wrote it into the view.
4. **⚠️ Precision is a curve; quote the band.** ~91% covers only the top **10 cards / 7 owners /
   $521M** (the 45th pair sits at $16.38M). $16M→$2M is ungraded; `rentBand()` returns
   `precision: null` rather than interpolating. And **`v_owner_contact_enrich_queue` is the wrong
   drain metric** — 6 rows total, 2 of this lane's 171 owners.

**NEW DEFECT FOUND WHILE RECONCILING (→ Prompt 189): `lcc_normalize_entity_name` returns NULL for
1,089 live organisations carrying $185.1M of rent** — RMR Group, GI Partners, AVG Partners, MMI
Capital among them. `v_lcc_merge_candidates` groups on that column, so the duplicate-entity
detector is **structurally blind to all 1,089**. It also misses Easterly's two entities
(`easterly gov reit` vs `easterly government`). Duplicates measured in the live lane: Cambridge
$13.2M, Cunningham $10.6M, Gray Harbor, Procacci — plus Easterly ×2 (4 cards for one firm),
NGP ×3, Boyd Watterson ×8.

**Open for Scott:** public universities (Memphis/UNC public and in scope vs GWU/Georgetown private
and must stay); the six sponsor→domain entries (NGP→ngpv.com is $59.8M + ~$26M across 10 SPEs,
plus UIRC, HPI, JBG, FCP, TMG). **Work the lane top-down — the 10 `measured_high` cards first.**

Docs: `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`,
`docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md`, playbook **Class 13**.


## 2026-08-26 (Cowork) — R8 Stage 1 SCOPED: on-box "Analyst's Take" (Prompt 138)

Production-health arc fully closed (all 9 assists healthy; P137 provenance ladder wired). Moved to the R8
net-new build (daily-briefing prose, per Scott's pick of the safer first pilot). **Re-measure-before-build
finding:** the brief already has an "Analyst's Take — AI-generated narrative" section + a
`briefing_intel_snapshot.analyst_take` column + renderer, but the field is **EMPTY** (length 0 for
2026-08-24/25/26) — the section renders nothing. Generator = a **cloud Claude** call in the
`briefing-intel-snapshot` edge fn (`api.anthropic.com`, model `claude-sonnet-4-6`), gated on
`ANTHROPIC_API_KEY`; unset → *"skipped AI generation"* → null. **P138** builds the on-box replacement: a Node
tick (`/api/briefing-analyst-take-tick`, flag `BRIEFING_ANALYST_TAKE_ONPREM`) that assembles the PRIVATE
signals (pipeline rollup, scored priorities, deal-propagation delta, work counts, hot contacts) via the
existing `briefing-data.js` fetchers, generates a 2–4 paragraph take in Scott's voice via
`invokeOnPremGeneration` (fail-soft, never fabricate), and upserts `analyst_take` into today's snapshot row
before the ~12:30 UTC send. Doctrine: private synthesis stays on-box; public market/news sections keep their
cloud path. First net-new on-box GENERATION build (vs the annotation assists).

**P138 SHIPPED (PR #1783, commit 9614a6f) + GRADED CLEAN (Cowork, live).** Tick `/api/briefing-analyst-take-tick`,
flag `BRIEFING_ANALYST_TAKE_ONPREM` (OFF), cron 240 (10:18 UTC, no-ops while off), doc
`docs/architecture/briefing-analyst-take-onprem.md`. **Correction:** the cloud path failed on Anthropic
**BILLING** (credit balance too low), NOT a missing key — my P138 diagnosis was wrong; capital_markets is
empty for the same reason (untouched). I ran the `?generate=1` dry-run through Railway (which has OLLAMA_URL;
the sandbox does not, so CC couldn't) → **583-char, 2-paragraph take, every claim traceable to a real signal
(hot contacts Fadi Seman/Joseph Zehia, work-queue state, Archbold/Valley MOB correspondence deltas, cadence),
no fabrication.** Voice is slightly generic-assistant (tuning follow-up, not a blocker). **Gate steps
remaining (Scott):** (1) `supabase functions deploy briefing-intel-snapshot --project-ref
xengecqvemvfknjvbvrq --no-verify-jwt` (the omit-when-null guard — do BEFORE any manual snapshot re-fire);
(2) flip `BRIEFING_ANALYST_TAKE_ONPREM` on. Then the brief renders a real Analyst's Take nightly.

**R8 STAGE 1 NOW FULLY LIVE (2026-08-26).** Edge fn deployed (Scott); `BRIEFING_ANALYST_TAKE_ONPREM` flipped
ON (registry — the tick reads env-override-then-registry via `flagEnabled`, so no Railway var needed). Fired
one write: today's `briefing_intel_snapshot.analyst_take` = **774 chars, `analyst_take_meta.source =
onprem_ollama`** (proves on-box generation), grounded in real signals, no fabrication. Cron 240 fills it
nightly. The dead 3-year-empty section is now populated on-box. Only open R8 items: the voice-tightening
tuning (slightly generic tone) and Stage 2 (CM book copy).

**Two small follow-ups drafted (139, 140) + a consolidation prompt (141):**
- **P139** — interleave the clean-assist provenance lane so P137's 433 ladder-decidable cards surface ahead
  of the no-ladder `dia_xref` backlog (two incomparable rank scales sharing one budget; xref `1001` >
  field_provenance ≤1000). Low urgency (cron drains xref over ~a day).
- **P140** — grade the dormant `OWNERSHIP_CHAIN_ROLE_LABELS` Layer-2 (Ollama labels a transfer type on chain
  links, never alters them; party-presence guard). Dry-run sample → grade → flip if clean.
- **P141** — docs consolidation: slim STATUS + one current-state index + one lossless Planned/Backlog list
  (never drop a contemplated feature), archive older narratives to `docs/history/`.

## 2026-08-26 (Cowork) — P134/P135/P136 SHIPPED (assist production-health fixes); folder cleaned

All three stalled-assist prompts merged and reconciled:
- **P135 (property-twin cursor) — LIVE-VERIFIED.** PR merged + redeployed; live dry-run now reads
  `fresh:895 / remaining:895` (was `fresh:0` against 1,095 pending). The window advances; the lane drains
  toward 1,095 over nightly runs. Assert on the proposal-count delta past 200.
- **P136 (reachability target window) — MERGED, migration live.** No-evidence target marker
  (`reachability_harvest_target_marker`) so the window advances + evidence-JOIN target selection; new
  `v_lcc_reachability_harvest_target_marker_summary`. JS shipped on the redeploy. **First live POST is
  Scott's call** (it writes real proposals) — tell is `targets_with_evidence>0 / proposed>0`, then watch
  `reachability_harvest_review` climb past 16. (PR body's "73 new tests" is wrong; real 12 added, suite
  4,442→4,453.)
- **P134 (clean-assist context enrichment) — MERGED; `member_property_ids` views live on gov+dia.** Per-lane
  evidence context + `skipped_no_evidence` / `no_evidence_reasons` / `coherence_downgraded` fields + a
  decisive-at-0-confidence coherence guard. **`OLLAMA_CLEAN_ASSIST` STAYS OFF pending a re-grade:**
  `POST /api/ollama-clean-assist-tick?limit=20`, keep on only if most proposals quote real evidence and
  `uncertain` lands on genuine ties.

**Clean-assist RE-GRADE PASSED → FLIPPED ON (2026-08-26).** Enriched 20-item sample: 8/14 grounded (sf_link
4/4, incl. a `merge@0.99` on Realty Income citing the actual strict_core; owner_reconcile 4/4 grounded
abstentions), 6 correctly SKIPPED with named `no_evidence_reasons`, property_merge noise eliminated. Cleared
the Consumption-Layer bar; `OLLAMA_CLEAN_ASSIST` now `state=on` (cron 200 hourly), the 14 proposals kept in
the lane. **Follow-up DIAGNOSED → Prompt 137.** `provenance_conflict` 4/4 punt because P134 built the CONSUMER side
(`clean-assist-context.js` computes `ladder_says` from `c.current_priority`/`c.priority_ladder`) but the
PRODUCER side was never wired — `v_field_provenance_conflict_classified` has `attempted_priority` but **no
`current_priority`**, and nothing in `admin.js` joins it, so `ladder_says` is always
`unregistered_source_no_ladder_answer`. Measured: a join to `field_source_priority` on
`(target_table, field_name, current_source)` resolves **454/454** conflicts — **433 ladder-decidable**, 21
genuine ties. P137 = add `current_priority` + `priority_ladder` to the view (append) + the handler's
`select=` (the exact "diff view columns vs select" lesson). Turns ~95% of the lane from punt into a
grounded keep_current/accept_attempted.

**P137 SHIPPED (PR #1782 merged).** View columns (`current_priority`, `priority_ladder`) live on LCC Opps
now; `select=` change + tick cursor shipped on the redeploy. Data layer PROVEN (join resolves 454/454,
433 decidable). **But the live payoff is currently MASKED by a rank-scale issue (CC caveat 2):** the 65-row
`dia_xref` backlog ranks `1001` (`1000 + severity`) — ABOVE every ladder-bearing `field_provenance` row
(`_provImportance` ≤ 1000) — so the cursor drains xref first, and xref has **no ladder by design** (dia
sales-price cross-ref, correctly `uncertain`). Re-grade runs so far only reached xref rows (correctly
abstaining, one now naming the specific fields + "registered field_source_priority" = enrichment IS
reaching the model). **Ladder-bearing verification is gated on draining ~50 more xref rows** (hourly cron
200 does this over ~a day) OR a small follow-up to re-rank the xref constant so the two interleave — left as
Scott's call because `rank_value` also orders the human-facing Decision Center lane.

**Assist production-health is now GREEN across the board** — 6 were already healthy, the 2 stalled lanes are
fixed (P135 live, P136 merged), clean-assist enriched + re-graded + flipped ON. The recurring lesson, now proven
three times in one arc: a producer keyed on "already processed" needs a marker/cursor that ADVANCES, or it
silently re-checks the same residue forever while looking healthy.

**Folder cleaned (2026-08-26).** All loose prompts filed to `docs/claude-code/prompts/done/` (98 total) and
134/135/136 responses to `responses/done/` (33). **Finding: none of the loose prompts were un-sent** — the
whole backlog (18–97 waves, 119, 182, 184, 134–136) was already-shipped work never filed; git log confirms
182 (PR #1778) and 184 (`claude/prompt-184-hub-and-spoke`) merged. `prompts/` and `responses/` are now empty
of loose files.

## 2026-08-26 (Cowork) — Research page task list was DEAD (P132, SHIPPED); P133 cron; NEXT_STEP_AI ON

**Finding while walking Scott to the R1 review cards.** The Research page rendered "0 tasks" for EVERY
lane/status — the lane picker (`?view=research_lanes`) was healthy (establish_ownership_history 545 open,
answerable) but the task-fetch itself 500'd. v2 leaked the cause: PostgREST **`table name
"research_tasks_users_1" specified more than once`** — `api/queue.js` embedded `users` twice
(assignee + creator) with no distinct alias, in BOTH the v1 (`case 'research'`) and v2 (`v2GetResearch`)
branches. So the entire operator-facing research list had been unreachable — which is exactly why every
lane read "0 completions ever" (Dead-End Class 3/7: exists but can't display). The 453 P131
ownership-chain drafts were fine in `lcc_clean_assist_proposals` the whole time; they rendered onto cards
that never appeared.

**Prompt 132 — SHIPPED + LIVE-VERIFIED (2026-08-26).** Named-alias fix (`assignee:users!…` /
`creator:users!…`) in both research paths. CC's `select=` parser sweep found a **THIRD** instance of the
same bug: `getOversight` in `api/operations.js` embedded `users` twice for escalated_by/escalated_to —
worse because it's read as `escalations.data || []` with **no `.ok` check**, so the 400 silently rendered
as "no open escalations." All three aliased (`escalated_by_user:users!…` / `escalated_to_user:…`).
General-invariant guard test added (no `select=` in `api/` may embed two relations to one response key),
verified red-on-break. Full suite 4406/0/6-skip. CLAUDE.md footgun entry added. **Live check:
`GET /api/queue?view=research&status=active&research_type=establish_ownership_history` → `count=545,
items=50, err=None`** — the entire Research page (and the R1 review surface) is now reachable.

**Prompt 133 — SHIPPED + APPLIED LIVE.** pg_cron `lcc-ownership-chain-draft` (jobid **239**,
`45 6 * * *` — 06:45 UTC, not the proposed 06:50, which is `lcc-owner-deed-autofix`; 06:45 was the only
free minute in the block and lands after `generate-research-tasks` at 06:35, which mints the lane rows)
POSTs `/api/ownership-chain-draft-tick` via `lcc_cron_post` with `{"apply":true,"limit":100,
"trigger_source":"cron"}`. Verified end-to-end by firing the exact cron command: HTTP **200**,
`timed_out=false`, `open_lane_rows:545 / already_drafted:545 / fresh:0 / written_draftable:0` — the
correct quiet-night disposition, 0 rows written. Registry note updated (`OWNERSHIP_CHAIN_DRAFT` was
already `state='on'`); the cron is deliberately NOT gated on the flag. New observability
`lcc_ownership_chain_draft_run_log` + `v_lcc_ownership_chain_draft_run_health` /
`_stalled_runs` on the P123 open-before-the-work lifecycle. **DB side is live now; the run-log WRITE is
JS and ships on the next Railway redeploy of merged `main`** — until then runs are observable only via
`lcc_cron_post_log` + `net._http_response`. Reverse: `SELECT cron.unschedule('lcc-ownership-chain-draft');`

**NEXT_STEP_AI — FLIPPED ON (env already set; registry flipped by Cowork).** Inline-only (no standalone
tick) — runs inside `deal-comms-propagate-tick` / `intake-tagged-comm` / `intake-correspondence`,
deterministic-first, fails null → today's generic to-do. Zero-spend dry-run of `classifyDeterministic`
over 10 real inbound messages: **6/6 clear-intent classified correctly** (wants_call→schedule_call,
declined→log_pass, accepted→advance_to_contract, requests_docs→send_info, will_get_back→follow_up,
counter_offer→review_offer); the 4 escalations were the genuinely ambiguous ones (correctly deferred to
Ollama). `feature_flags_registry.NEXT_STEP_AI` now `state=on`.

**OLLAMA_CLEAN_ASSIST dry-run — HELD OFF (2026-08-26).** No GET dry-run mode, so generated a 12-item
**inert** sample (flag on → `POST` limit=12 → 12 proposed / 0 failed), graded it, then flipped OFF +
deleted the sample (reversible, nothing canonical touched). Grade: safe (abstains, never fabricates) but
**low-value** — 6/12 (`property_merge` + `provenance_conflict`) were content-free "insufficient evidence"
because the candidate lanes hand the model a thin `context` payload; 3/12 `owner_reconcile` correctly
abstained on initials-only pairs; 1 `sf_link` `merge` had an incoherent `0.00` confidence. Flipping it on
(hourly cron 200 exists, no-ops while off) would flood the Decision Center with uncertain noise — the
Consumption-Layer failure. **→ Prompt 134** enriches the per-lane context (real competing values) + adds
a verdict/confidence coherence guard; re-validate a sample before re-enabling. Lesson: a "just flip it"
assist can still be a noise producer — grade against the Consumption-Layer bar, not just the safety bar.

**Assist-flag sweep — the "dormant lanes to flip" plan is essentially DONE (2026-08-26).** Measured
`feature_flags_registry`: **9 of 10 assist flags are `on`** (only `OLLAMA_CLEAN_ASSIST` off, held pending
Prompt 134). So the LOCAL-MODEL-LEVERAGE-MAP §2 "flip for fast leverage" framing is stale — nothing left
to activate. The work is now PRODUCTION HEALTH, and the first check already found a silent stall:
**`PROPERTY_TWIN_ASSIST` is ON but produced 200 annotations in one run (2026-08-19) and 0 since, while
1,095 rows are pending** — the tick pulls the first-200 window, finds all 200 annotated (`fresh:0`), and
no-ops forever (never paginates to rows 201–1,095). → **Prompt 135** (query-level anti-join / keyset cursor
+ honest `remaining` count + guard). Reinforces the doctrine: assert on the produced delta, never the flag.

**Production-health pass complete (2026-08-26).** Checked all 9 ON assists by write-delta: **6 healthy** —
`ownership_chain_draft` (545, today), `junk-prescreen` / `naming-hygiene` / `dup-pair` (cursor-advancing),
`match-disambig` (1,270; 33 in 7d; caught up), `sf-link-assist` (247; 47 in 7d; caught up) — plus
`NEXT_STEP_AI` (inline). **2 stalled:** `PROPERTY_TWIN_ASSIST` (confirmed stuck → P135) and
`W9_2_REACHABILITY_HARVEST` (**16 ever / 0 in 11d** vs ~15k unreachable pool). **Diagnosed 2026-08-26
(confirmed stall, NOT exhaustion):** cron 212 fires nightly but a bounded POST shows a fixed **120-target
window** (60/domain) with `donors_found:0 / with_evidence:0` for those 120 — while the evidence pool holds
5,000 intake + 4,305 comms names + 2,042 signature phones. It re-checks the same 120 unresolvable owners
every night and never advances. → **Prompt 136** (mark no-evidence targets so the window advances + select
targets by an evidence JOIN + honest counts + guard). **Structural tell: the two stalled lanes are the only
ones without an advancing cursor/marker.**
Doc note: the SF-assist flag is `W9_3_RESCORE` in code, not `W9_3_SF_ASSIST`. Full table in
`docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` §2.

**Git state (2026-08-26):** a merge of origin `2d205aff` (P132/P133) into local `main` is in progress with a
STATUS.md conflict — **markers resolved by Cowork** (kept P132 + origin's richer P133, dropped the dupe). The
`.git/index.lock` is held by the Windows-side process (`Operation not permitted` from the sandbox), so Scott
must clear the lock + finish the merge commit (see chat for the exact PowerShell).

**Net:** R1 is now genuinely reachable (P132 was the hidden gate). Manual review path for the 453 drafts:
Research page → `establish_ownership_history` lane → each card shows its drafted chain (`chainDraftHTML`)
→ open property → Ownership tab → set recorded/true owner → Save (P179 capture). Prioritize the
~73 current-owner mismatch flags.

## W6.5 Stage 2 Units 1–5 (2026-08-20, Cowork) — detail.js 18,481 → 16,203 lines, byte-identical

The highest-value W6 unit (it de-risks the Edit-truncation incidents). Five regions extracted from
`detail.js` into classic sibling scripts. **Every region sha256-verified byte-identical before/after the
move; every unit mutation-tested before commit.**

| Unit | File | Lines | Note |
|---|---|---|---|
| 1 | `detail-rent.js` | 301 | rent source-tier policy + escalation parser |
| 2 | `detail-tab-documents.js` | 238 | Documents tab — also carried the client-dossier builders it surfaces |
| 3 | `detail-panel-shell.js` | 739 | panel geometry, resizers, minimize tray, companion dock — **19 window exports** |
| 4+5 | `detail-entity-tabs.js` | 1,143 | entity tab bodies (Unit 5 = the five Unit 4 missed) |

**THE MAP WAS WRONG THREE TIMES, and each correction was load-bearing.** Its line ranges were stale for
every unit. Its `detail-entity.js` range would have swallowed the PANEL SHELL — window management, which
`detail-tab-registry.test.mjs` pins to `detail.js`. And its entity/contact ranges OVERLAPPED, because the
two clusters interleave *around* that shell — so "extract the entity tabs" was never one region-move.
**Unit 3 lifting the shell out is what made Unit 4 contiguous at all.**

**Three defects found in the machinery itself:**
1. **Stage 1 had shipped a broken test.** `_fedCardHTML` moved to `dc-lanes.js` while `_cleanAssistHTML`
   stayed in `ops.js` — fine in production's shared global scope, a ReferenceError in an isolated eval
   sandbox. Fixed, and became **recipe step 5b**: grep `test/` for the moved function BEFORE extracting.
2. **`verify:deploy` never probed a front-end file.** It checked `/version` + `/api/*` only, so a new
   script that failed to ship would 404 in the browser with the gate green. Now probes all 13 local
   `<script src>`, asserting on the BODY (the SPA catch-all can return 200 with index.html).
   `--wait[=sec]` added for the push→verify loop.
3. **Unit 4 silently left five `_entityTab*` bodies behind and no guard noticed** — the tab-registry
   guard asks whether a tab reaches a renderer that EXISTS, and it did. *"Reachable" and "in the right
   module" are different properties.* The load-order guard now asserts the second one.

Guards: **113 assertions** across `detail-tab-registry`, `frontend-module-load-order`, `panel-redesign`.
Remaining (map §2b): #6 `_entityTabOverview` + its helper cluster, #7 contact openers. The entity
dispatcher and the shared completeness-rail / Next-Step chrome stay in `detail.js` by design.

---
## P121 (2026-08-20) — the staging→Processed ordering hazard is CLOSED (Flow 6 vs the mirror)

**Migration `20260820160000_lcc_p121_staging_processed_single_owner.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`), so the data layer is live now. The `api/sync.js` + `api/_shared/todo-completion.js`
changes ship on the next Railway redeploy of merged `main` → then run `npm run verify:deploy`.**

**Cowork reconcile-verified live 2026-08-20 (PR #1764 merged):** `staged_at` + `todo_completed_at` columns
present, `lcc_todo_completion_mark_filed` RPC live, **stranded detector = 0** (was 61), mirror worklist
drained to **0**. And the P120 backlog fully cleared through the executor — `move_outcome` now **329 moved +
15 already_out**. **✅ Both Scott-side items now DONE (2026-08-21):** (1) `main` redeployed + git-pinned
(`/version` 527d78f9b05c) — the P121 JS is live, so Flow 6 no longer asserts a move it didn't make. (2) The
Flow-6 PA flow (`LCC To Do Completion Poll`) had its `Move_email_(V2)` + `Flag_email_(V2)` actions deleted
(inside `Condition_Match`→If-yes) — the move queue is now the SINGLE owner of the mailbox move; Flow 6 only
records completion via `lcc_todo_completion_mark_filed`. Single-owner email-orchestration loop COMPLETE. **Judgment call to note:** the
61 re-queued messages all qualify via the `inbox_triaged` arm (P119's bulk-archive smell) — CC let them drain
(reversible); a one-line predicate parks them instead if preferred.

P120's own §"Known ordering hazard" went from latent to REACHABLE the moment its executor started filling the
staging folder (first placements **2026-08-20 19:42–20:15Z, 81 messages**, with 240 more still draining at
25/run × 4 runs/hr). Two consumers reacted to one event — a staged email's To Do completing — and **both keyed
on the transient `processing_log.outcome='staged'`**: Flow 6 flipped it to `filed` (stamping
`move_status='moved'` for a move it never performed), and the W7.6 mirror's worklist was gated on it. Flow 6
winning the race dropped the row off the mirror's worklist and left the message in staging forever while every
surface read `filed`/`moved`.

**The fix — a durable anchor, and one owner per transition:**

| transition | owner |
|---|---|
| Inbox → staging, Inbox → `Processed/*` | the P120 move queue |
| staging → `Processed/*` (+ unflag) | the W7.6 mailbox mirror, ONLY |
| Flow 6 (To Do completion) | **informational** — records the disposition, moves nothing |

- **`processing_log.staged_at`** — stamped by `lcc_move_queue_ack` on a GENUINE move whose destination is
  `lcc_staging_folder_name()`, never on an `already_out` ack ("the message wasn't in the Inbox" does not prove
  "it is in staging"). Backfilled from the 81 proven placements, 0 anomalies. The mirror worklist gate widens
  to `staged_at IS NOT NULL OR outcome='staged'`.
- **Flow 6 stops lying.** `markFiled` routes to `rpc/lcc_todo_completion_mark_filed` and never writes
  `move_status`/`moved_at`/`move_outcome`. Dispositions: `mirror_owns_move`, `retargeted_to_final` (never
  staged + still queued ⇒ retarget the queue row to `final_target_folder` so the move queue delivers it
  straight to Processed), `no_move_state_change`, `already_resolved`. **Both race interleavings are safe by
  construction** — an executor ack naming staging still stamps `staged_at`, so the mirror picks it up.
- **A ledger verdict predating the current placement no longer excludes a row.**

**⚠️ A SECOND, ALREADY-LIVE STRANDING CLASS FOUND WHILE GROUNDING THIS — 61 messages.** Of the 81 the executor
placed in staging, **61 were already invisible to the mirror**: they carry pre-P119 ledger rows
`parked=true` / `not_found_or_not_in_source_folder`, acked **2026-08-07..09** — days BEFORE the placement, back
when the folder really was empty and the verdict was CORRECT. The P119 retire sweep cannot catch it (it only
ever moves a row TOWARD terminal, never re-queues). Detector `v_lcc_mailbox_mirror_stranded`; reversible
re-enqueue `lcc_mailbox_mirror_requeue_stranded(dry_run default true)` + cron `lcc-mailbox-mirror-requeue`
(06:35 UTC), prior state preserved verbatim in `lcc_mailbox_reconcile_ledger.requeue_prior`.

**⚠️ AND A THIRD GAP THE GATES EXPOSED — the mirror had no closure arm Flow 6 could trigger.** The native
Flagged-email model creates no `action_items`, so **0 of 103** staged messages have any and the `todos_done`
arm is structurally dead for them; 27 still have an untriaged `inbox_item`, so `inbox_triaged` can't fire
either. Completing a To Do would have flipped the row to `filed` with **nothing** ever publishing the move.
Added arm **`todo_completed`** (`processing_log.todo_completed_at`), first in reason priority.

**Measured by state delta, not tallies:**

| | before | after |
|---|---|---|
| mirror worklist | **0** | **61** (all `staged_at`-proven; pre-P121 gate publishes 0 of them) |
| `v_lcc_mailbox_mirror_stranded` | 61 (`stale_park`) | **0** |
| ledger `parked` | 3,935 | 3,884 (−51 re-queued, tagged) |
| messages the live mirror moved OUT of staging | 0 ever | **25 within the hour** |

Synthetic gates A/B/C (self-rolling-back, **0 residue**): Flow 6 winning the race leaves the row ON the mirror
worklist (was: dropped); a never-staged row retargets and stays off the mirror; a completed To Do on an
untriaged item publishes `reason=todo_completed`. Tests: `test/todo-completion.test.mjs` 21 pass, including a
mutation-checked guard that `markFiled` cannot re-acquire a `move_status` stamp, and one asserting the SQL
`lcc_staging_folder_name()` matches the JS `STAGING_FOLDER`.

**Remaining operator step (not a blocker):** the Flow 6 PA flow still performs its own Move + Flag-clear. LCC
now publishes `move:false` / `clear_flag:false` / a `contract` note on that worklist but cannot stop a PA
action it does not own. Until that edit lands the two movers race **benignly** — the loser acks
`ErrorItemNotFound` → `already_out` → terminal success under P119. A redundant Graph call, not a stranded
message.

---
## P128 (2026-08-25) — the U3 conflict-card test asserts the CONTRACT, not the expression text

`test/w8-u3-conflict-card.test.mjs` greps `api/admin.js` for the honest-badge total. It pinned the
**literal** `out.total = (u3OpenCnt || 0) + (u3ConfCnt || 0)`, which **Prompt 89's null-guard rewrote**
to `(u3OpenCnt == null && u3ConfCnt == null) ? null : (u3OpenCnt || 0) + (u3ConfCnt || 0)`. Runtime
behaviour was correct the whole time; only the assertion was stale. Provenance: commit `1e9238e`
("Desktop Changes.") both rewrote that line and last touched the test, so it has been red since.

**Re-pinning the new literal would just rot again**, so the assertion now tests the contract. It anchors
on the `out.total =` assignment (a stable structural token), extracts the right-hand side and evaluates
it over both probes: `(3,2)→5`, `(3,0)→3`, `(3,null)→3`, `(null,2)→2`, **`(null,null)→null`** — the
honest-badge guard P89's own comment documents ("report null, NOT 0, so the lane header does not read
'1 shown · 0 workable' over a workable card"). The surviving shape check is tightened from a bare
`status=eq.conflict')` to the full `opsCnt('w8_u3_link_review?status=eq.conflict')` call.

**Mutation-tested in both directions** (a green test that cannot fail is not a measurement): reverting
`admin.js` to the pre-P89 expression fails the both-null case; dropping `u3ConfCnt` from the sum fails
the sum case. `api/admin.js` is byte-unchanged — `git diff origin/main HEAD` is exactly one file.

**⚠️ Correction — P127's STATUS said "1 pre-existing failure." The real count was 4, and is now 3.**
Measured by the pass/fail list, not the exit code: **4,363 pass / 3 fail** (was 4,372 tests / 4 fail).
P126's entry above recorded "4,283 pass / **4 fail**" and was right; P127 under-counted. So the state
delta from this round is exactly **−1 failure, the one targeted** — the suite is *not* "now clean," and
saying so would repeat the dated-claim trap the doctrine section warns about.

**The 3 that remain are pre-existing, in files this round never touched, and reproduce in isolation**
(so they are not cross-test interference). Unlike the U3 case these are **behavioural** assertions, not
stale greps — each is worth its own look, and none is in scope here:

| test | assertion failing | shape |
|---|---|---|
| `auto-scrape-listings.test.js` | "expected ±3y lower bound in URL" — the query issues `sale_date=gte.<listing_date>&lte.<+3y>`, i.e. no `−3y` lower bound; handler 502s | test and code disagree on whether the window is ±3y or on/after listing_date |
| `folder-feed-enrich-mode.test.mjs` | "disambiguation decision emitted" `false !== true` — enrich + no match creates nothing AND emits nothing | a producer that should route ambiguity to a review lane appears not to |
| `ollama-clean-assist.test.mjs` | "clean-assist worker must not call `properties?`" `true !== false` | a guardrail (assist annotates, never writes canonical data) is currently violated |

The third is the one to look at first — it is the P106-class invariant that the assist layer **annotates
and never writes canonical data**, and the guard is red.

> **⚠️ Superseded — all three "shape" readings in the table above were wrong, and the errors ran the same
> way each time: the assertion text was read as a description of the code.** P129 found #3 was a drifted
> block-grep, not a P106 breach. P130 found #1's 502 was the test's own assertion thrown inside the
> handler's `try/catch` (the −3y bound it demands is what the June-2026 backdating fix deliberately
> REMOVED), and #2's producer does route ambiguity to the review lane — it correctly declines only the
> ZERO-candidate card, per the Prompt 91 producer guard. **All four were stale tests; zero were code
> defects.** See the P130 entry.

**Close-out:** test-only; no runtime code, no migration, nothing waits on a redeploy. Branch
`claude/fix-conflict-card-test-grep-sm7lav`.

---
## P130 (2026-08-26) — the last two suite failures: BOTH stale tests, suite is 4,367 / 0

Verdict per failure, each measured independently before any edit. **Neither was a code defect; no handler
byte changed** (`git status` = exactly the two test files). The prompt's prior on #1 — "a 502 smells like a
real handler defect, start here" — was wrong, and the way it was wrong is the reusable lesson.

### 1. `auto-scrape-listings.test.js` — the 502 was the TEST's own assertion, thrown inside the handler

**Classification: stale test, superseded intent.** The failing assertion was
`assert.ok(target.includes('sale_date=gte.2023-01-1'), 'expected ±3y lower bound in URL')` — raised inside
the test's `global.fetch` stub. `handleAutoScrapeListings` wraps each listing in `try/catch`, so the stub's
`AssertionError` landed in `summary.errors` as `{stage:'process'}`, and the handler's own status rule
(`totalErrs > 0 && 0 successes → 502`) returned 502. **The 502 was manufactured by the assertion it was
reporting** — a self-inflicted error, not an independent defect. Read the error message inside the JSON
body before treating an HTTP status from a stubbed handler as evidence.

The `−3y` lower bound the test demanded is exactly what was REMOVED to fix the **June-2026 dia off_market
backdating incident**: it matched a pre-listing sale (a prior owner's deal), and the RPC then stamped
`off_market_date` = run date, collapsing years of exits into one month. `api/admin.js:12383-12394` carries
the full incident comment. The window is now floored at the listing's **market-entry date**
(`on_market_date`, fallback `listing_date`) with the 3y recency headroom kept on the upper bound only.
Making that test green by "fixing" the handler would have re-shipped the incident.

**Fix (test-only):** re-anchored on the entry-floored window, and turned into a real regression guard —
it now asserts the lower bound IS the market-entry date, adds an explicit
`assert.ok(!/sale_date=gte\.202[0-3]/…)` so the pre-entry bound cannot come back, and gives the fixture an
`on_market_date` distinct from `listing_date` so the test proves the floor reads market-entry while the
closest-sale distance still measures from `listing_date`. The out-of-window `sale_id:'old'` (2024-12-01)
fixture row was dropped — PostgREST would never return it under the real filter, so keeping it made the
stub lie about the DB. **Proved non-vacuous by mutation:** re-introducing `entryMs − windowDays` in the
handler turns the test red (7/8) with `expected market-entry lower bound in URL: …gte.2023-01-15`;
`api/admin.js` restored byte-identical afterwards.

### 2. `folder-feed-enrich-mode.test.mjs` — asserting the pre-Prompt-91 intent

**Classification: stale test, superseded intent.** `assert.equal(res.emitted_disambiguation, true)` failed
because `emitMatchDisambiguation` (`api/_handlers/intake-matcher.js:672`) carries an explicit **Prompt 91
producer guard**: zero candidates → `{emitted:false, skipped:'empty_candidates'}`, no `lcc_open_decision`.
A card with no candidates asks a human to "pick one of nothing" — unworkable by construction, and it still
inflates the lane badge (honest-counts violation). The test's `UNMATCHED` fixture carries no `candidates`,
so it drove exactly the branch P91 exists to suppress. The promoter already reads the returned `{emitted}`
so `emitted_disambiguation` stays honest — the flag was right; the assertion was a round behind.

This is **not** an intentionally-unbuilt path, so no `it.skip` was warranted, and inventing an emit to
satisfy the test would have been fabrication against this repo's own Consumption-Layer doctrine.

**Fix (test-only):** the single `it()` now pins BOTH branches of the P91 contract — zero candidates →
`emitted_disambiguation === false` **and** `lcc_open_decision` NOT called (guarding P91 against
regression), then a second arm with two real candidates → `emitted_disambiguation === true`,
`lcc_open_decision` called, candidates carried onto `p_context`, and still nothing created. Folded into
one `it()` deliberately so the suite total stays 4,373 and "no other test moved" is checkable by count.

### Verification (by the pass/fail LIST, not the exit code)

`npm test` → **tests 4373 · pass 4367 · fail 0 · skipped 6 · todo 0**. Baseline was 4,365 pass / 2 fail /
6 skip = the same 4,373 total, so no test was added, removed, or skipped. All 6 skips are pre-existing and
unrelated (1 chart-spec, 5 RCA parsers gated on a local file path); **zero `it.skip` was added this round**
— green means green. The two target files: 11 tests, 11 pass, 0 skip.

**Close-out:** test-only. No runtime code, no migration, nothing waits on a Railway redeploy. This closes
the test-hygiene segment (P126 → P128 → P129 → P130); **next item is key rotation.**

**Durable lesson for the arc tally — the stale-vs-real score is now 4 stale, 1 real.** P126 `</table>`,
P128 U3 `out.total`, P129 drifted block boundary, and now BOTH of P130's. Every one of them looked like a
code defect from the assertion text, and P130's #1 wore an HTTP 502 on top. **Classify before you fix, and
when a red test names an intent, go read whether that intent was deliberately superseded** — in both P130
cases the superseding commit had left a full explanatory comment sitting directly above the code.

---
## P126 (2026-08-25) — draft-assist appends Scott's real branded signature; the draft is send-ready

Closes the P125 v6 follow-up ("no signature block"). The generated draft ended at the model's sign-off
("…Thanks.") with no name/title/company/phone, so Scott hand-added his block on every save.

**Two variants, selected the way he actually signs** (`api/_shared/email-signature.js`):
`in_reply_to != ''` ⇒ **`docs/os/voice/signatures/signature-reply.html`** (compact, self-contained, no logo);
`in_reply_to == ''` ⇒ **`signature-full.html`** (service line, D/E/A rows, address, service-line tagline,
northmarq.com). Ambiguous ⇒ the reply block (it asserts strictly less). The variant is chosen from the SAME
`inReplyTo` const handed to the flow, so the block can never disagree with the shape of the draft created.

**⚠️ The prompt named two repo files that do not exist in the repo or on any remote branch** — that
extraction lived in a local Cowork session and was never pushed (checked every `refs/remotes/*`). Rather than
block, both blocks were re-extracted **verbatim from the same authoritative source an `.eml` extraction reads**:
Scott's own top-posted HTML in LCC Opps `email_bodies.body_html`. Nothing was transcribed from a doc.

**⚠️ And the docs would have been wrong.** `docs/os/skills/offer-submission-SKILL.md` + the offer-submission
design doc describe ONE block carrying the Tulsa address. Measured over his **592** signature-bearing sent
messages of the last 120 days, the top-posted **reply** block carries the street address **0 times** and the
service line in 9% — the address belongs to the **new-email** block and otherwise appears only inside quoted
history. Following the docs would have stamped an address on every reply his real replies do not carry. The
docs' *"service-line tagline"* placeholder also never resolved to a literal anywhere in the repo; the real
string is **"Commercial Real Estate | Debt + Equity | Investment Sales | Loan Servicing | Fund Management"**,
now captured rather than invented. (Another instance of the dated-doc trap in the CLAUDE.md doctrine section.)

**The `cid:` logo is deliberately absent.** His full block opens with `<img src="cid:2d92bd11-…" width="84"
height="75">` (4,221 bytes — the 4.2 KB `northmarq-logo.png`), a reference to an attachment part of *that*
message. A generated draft has no such part, so it would render broken on every send. Per the prompt's stated
fallback the `<img>` is stripped and the styled text kept. To restore it, host the PNG at a stable public
`https://` URL (a `data:` URI is not a substitute — Outlook desktop blocks them); note that also turns every
send into a read receipt for the recipient, so it is Scott's call, not a default.

**Doctrine held.** Never fabricate AND never re-type — both blocks are stored assets, and there is NO runtime
path that parses a signature out of sent mail (the corpus carries a Stan Johnson era block and a Team Briggs
block; parsing at request time would silently pick a stale title). Nothing configured ⇒ append NOTHING and
report `signature.status = "not_configured"`, never a guess. **Never double-sign** — detection reuses the
corpus cleaner's `SIGNATURE_ANCHORS` rather than forking a second "what a signature looks like" (the
normaliser drift CLAUDE.md warns about), and fails CONSERVATIVE: a false positive skips the append (the
pre-P126 status quo), a false negative would ship a doubly-signed draft. **Above the quote by construction** —
the flow composes `concat(body_html, <createReply quote>)`, so end-of-our-html IS above the quote; a test pins
that order. And the appended block cannot poison the voice corpus: `cleanEmailBody` cuts it with the same
anchors used to detect it (tested).

**One refactor worth noting:** `body_html` is now built ONCE, before the dry-run response, instead of only
inside the save branch. The GET used to describe a body no code had rendered, so the signature would have been
verifiable only by actually saving; now `draft.body_html` on the dry run is byte-identical to what a save
posts. `test/draft-assist.test.mjs`'s P124 assertion was updated to the hoisted shape (same property guarded).

Files: `api/_shared/email-signature.js` (new), `docs/os/voice/signatures/signature-{reply,full}.html` (new),
`api/draft-assist.js`, `test/draft-assist-signature.test.mjs` (new, 28 tests). Full suite 4,283 pass / 4 fail —
the 4 are **pre-existing** (verified on a clean tree: `auto-scrape-listings`, `folder-feed-enrich-mode`,
`ollama-clean-assist`, `w8-u3-conflict-card`). Ships on the Railway redeploy of merged `main` →
`npm run verify:deploy`. **Open for Scott: confirm both blocks before they are the default** (below), and
decide the logo question.

---
## P127 (2026-08-25) — the signature loader sanitizes; a dirty asset can no longer reach a draft

The durable half of the P126 catch below. The assets are clean today (reply **857 B**, full **1,253 B** — both
verified below with a parser, not a regex); the point of this round is that "the bytes happen to be clean" was
the *only* thing between a recipient and someone else's mail, and that is not a control.

**New `api/_shared/html-sanitize.js`** — a **tokenizing** sanitizer, deliberately not a regex strip. It walks
the markup with a tokenizer that respects quoted attribute values and raw-text elements, then rebuilds from an
**allowlist** of tags and attributes: `script`/`style`/`iframe`/`form`/`svg`/… dropped with their content,
`img`/`link`/`meta`/`input` dropped outright, every `on*=` handler refused (an allowlist is the only defence
that holds — a denylist misses `onauxclick`), any non-`http(s)`/`mailto:`/`tel:` URL dropped (so `cid:`,
`javascript:`, `data:` all go), `url(`/`@import`/`expression(` styles dropped, unknown tags **unwrapped** so a
strange wrapper can't take the block with it, and the tag stack rebalanced. `loadSignatureHtml` routes **every**
source through it — both env overrides included; there is no trusted branch — as does `appendSignature`'s
caller-supplied override.

- **It reuses the corpus cleaner's boundary sets, it does not fork them.** `QUOTE_BOUNDARY_TAGS` /
  `REPLY_MARKERS` / `MIN_LEAD_CHARS` come from `voice-corpus-clean.js::_internals` — the same definitions that
  cut a quoted chain off an exemplar. A private copy is the normaliser drift CLAUDE.md warns about: the loader
  would eventually pass through something the cleaner calls a quote. A test greps for a local copy and fails on
  one. (It also resets `lastIndex` on that shared `/g` regex — a stateful `.test()` would make whoever ran
  second skip a boundary.)
- **`MIN_LEAD_CHARS` earns its keep here for the same reason it exists there.** Outlook writes an EMPTY
  `<div id=appendonsend>` on a freshly composed message; cutting at a boundary that sits before any real text
  would delete the whole signature, so a leading sentinel is **unwrapped**, not treated as a cut.
- **It degrades toward LESS signature, never a leak.** Over the 8 KB ceiling after cleaning, or nothing left
  but removable content, or unparseable ⇒ `html: null` ⇒ `signature.status = "not_configured"` ⇒ **nothing is
  appended** and the note says why. A dirty asset costs a hand-typed signature; a leaked one costs a recipient
  seeing someone else's mail. Nothing is truncated mid-tag.
- **Removal is observable — the P126 failure was that it wasn't.** The dry run now carries
  `signature.sanitized_removed` + `sanitize_rejected`, and the loader warns once per source on stderr.
  **`sanitized_removed: []` is the only healthy value.** It also reports what sat *below* a cut
  (`below-cut:img`): a cut subsumes what it discards, so without that the warning for the exact P126 asset
  would have read `["quoted-thread"]` and never mentioned the four tracking pixels that were the whole story.

**The leak is tested directly, not by proxy.** `test/draft-assist-signature-sanitize.test.mjs` (56 tests)
rebuilds the exact shape P126 shipped — the real block, then the LinkedIn notification email with its pixels,
its `cid:` logo and the Outlook quote header — feeds it through `appendSignature` (the real call path) and
asserts the body handed to the flow carries no `<img>`, no `linkedin`, no `cid:`, no quoted header, and still
carries name/title/phone/email. It also pins the evasions a regex strip misses (`<IMG\n SRC=…>`,
`<img/src=…>`, an unclosed `<script>`, a `>` inside a quoted attribute).

**Both committed assets are re-verified with the tokenizer, not a regex:** every tag balanced and closed, no
`img`/`script`/`style`/`link`/`iframe`/`svg`/`meta`/`form`, every URL pointing only at `mailto:`/`tel:`/
northmarq.com, no `on*` attribute, no LinkedIn/`From:`/`Sent:`/`wrote:` residue in the text, the exact contact
facts present (address + tagline on FULL only, absent from REPLY), each fact appearing exactly once, and each
asset sanitizing to itself with **zero** removals — i.e. the sanitizer is a net here, not a crutch.

**One pre-existing P126 test was failing against the merged bytes and is fixed:** it asserted the body ends
with `</table>`, but the assets are div-based — precisely the "tests ran against a different copy than shipped"
gap. It now compares against the block the loader actually resolves.

**Close-out:** ships on the Railway redeploy of merged `main` → `npm run verify:deploy`. Until then the safety
still rests on the assets being clean (they are).

## P128 (2026-08-24) — stale w8-u3 test fixed; ⚠️ suite is NOT clean (3 real failures remain)

Reviewed + reconciled. PR #1771 merged (d9f5370). The `w8-u3-conflict-card` test now asserts the *contract*
(u3 total = null when both counts null, else the sum — the honest-badge guard) instead of a source-grep P89
broke; mutation-verified both ways, `api/admin.js` byte-unchanged.

**⚠️ Correction — the "lone remaining failure" premise (mine, inherited from P127) was WRONG.** Measured off
the pass/fail LIST, not the exit code: **4,363 pass / 3 fail** (was 4,372 / 4; P128 fixed exactly the U3 one).
**P126 was right at "4 fail"; P127's "1 pre-existing" undercounted, and prompt 128 inherited it.** The suite is
NOT clean. The 3 remaining are **pre-existing, behavioural (not stale greps), reproduce in isolation, in files
this session never touched:**
- **`ollama-clean-assist.test.mjs`** — "clean-assist worker must NOT call `properties?`" is RED → the P106-class
  invariant (assist layer ANNOTATES, never writes/reads canonical). → **P129 DONE (PR #1772, dbde27b,
  test-only): verdict = (B) DRIFTED BLOCK-GREP, NOT a breach.** The `ollama-clean-assist` worker is
  annotation-only as designed (P106 intact); the test's extracted block had drifted into an adjacent `admin.js`
  handler that legitimately calls `properties?`. Re-anchored the test; suite **4,365/2**. This was the THIRD
  slice-a-source-region stale test in one arc (P126 `</table>`, P128 U3, P129) — durable footgun line added to
  `CLAUDE.md` (§W6.5 Step 5b corollary). **2 behavioural failures remain** (`auto-scrape-listings` — scrape URL
  missing −3y bound, handler 502s; `folder-feed-enrich-mode` — enrich+no-match emits no disambiguation) — real
  gaps, separate follow-ups → **P130 DONE (PR #1773, test-only): BOTH were STALE tests asserting SUPERSEDED
  intent, ZERO code defects.** (1) `auto-scrape-listings` — the 502 was self-inflicted (the test's own fetch
  stub threw an assert that the handler caught → errors>0 → 502); the −3y bound it demanded is EXACTLY what was
  removed to fix the **June-2026 dia off_market backdating incident** (`api/admin.js:12383` comment) — "fixing"
  the handler would have re-shipped it. Re-anchored on the `on_market_date` market-entry floor + a guard so the
  pre-entry bound can't return; mutation-proved. (2) `folder-feed-enrich-mode` — asserting PRE-P91 intent; P91's
  producer guard suppresses a zero-candidate disambiguation card (asking a human to pick nothing + inflating the
  badge = Consumption-Layer failure). Re-anchored to pin both arms of the P91 contract. **Suite now GREEN:
  4,373 tests · 4,367 pass · 0 fail · 6 pre-existing skips.** ✅ **TEST-HYGIENE SEGMENT CLOSED.**
  **Arc tally: 4 stale tests, 1 real defect** — every one looked like a code defect from the assertion text
  alone; in each case the superseding commit had left a full explanatory comment directly above the code, and
  reading it WAS the diagnosis. (CC corrected the P128-era table, which had read all 3 by assertion text —
  all 3 readings were wrong; historical entry left with a superseded-note.)
- `auto-scrape-listings.test.js` — URL missing the −3y lower bound; handler 502s.
- `folder-feed-enrich-mode.test.mjs` — enrich + no-match emits no disambiguation decision.
  → **BOTH CLOSED by P130 (test-only). Suite 4,365/2 → 4,367/0.** Verdict on both: **STALE TEST asserting a
  SUPERSEDED intent** — neither handler is defective, and the P130 prompt's framing ("a 502 smells like a real
  handler defect") did not survive measurement. See the P130 entry below.

CC left all three (P128 was scoped test-only) and offered to take the ollama-clean-assist one next. **Doctrine
reminder this whole P126→128 run reinforced: read the pass/fail LIST, never `node --test`'s exit code** (it
returned 0 over real failures three times this arc).

## Capstone 2026-08-24 — draft-assist arc COMPLETE + live; next-up = security/hygiene

The full email arc shipped this session and is live (redeploy confirmed by Scott): **intake fixed → forward
capture + contact-history flows → voice v3 → deal-grounded, recipient-matched, full-body retrieval → threaded
Outlook reply → branded signature → load-time sanitizer.** draft-assist end to end: real thread → correct deal
→ Scott's voice → threaded draft with signature, in Drafts, never sent. Prompt **128** queued (fixes the lone
stale test so the suite reads truly green — test-only). Also shipped this session: P118 cron fixes, P119 mailbox
mirror, P120 move-queue executor, P122 CM packet cursor, P123 deal-matcher, health surface 3,987 → ~24.

**⏭ Recommended next step — SECURITY/HYGIENE, not a feature:**
1. **Rotate `LCC_API_KEY`. — DEFERRED 2026-08-24 (Scott's call):** hold until the app is a workable version in
   regular use with users beyond Scott; the naive swap breaks ~10 live PA flows + Vault + Railway under
   `LCC_ENV=production`, so do it as the deliberate multi-user-onboarding task (preferably via the dual-key
   `LCC_API_KEY_PREVIOUS` approach for zero downtime). Exposure meanwhile is a private repo + this chat, not
   public. Original note: It's now genuinely exposed — pasted in chat curl/IRM commands repeatedly this
   session AND embedded in the committed PA flow export zips (`private/power-automate/exports/…`). Rotate per
   `docs/AUTH_ENFORCEMENT_ROLLOUT.md`; verify readiness FIRST via `GET /api/diag?kind=auth-ready`
   (`would_pass_in_production` must be true); **never flip `LCC_ENV` before the key is set** (that = total
   sign-in lockout, per CLAUDE.md). After rotating, update the key in every PA flow + Railway + Supabase Vault
   (`lcc_api_key`) that carries it.
2. **Commit the session's doc/prompt work** — 12 uncommitted working-tree files (STATUS, prompts 122–128,
   signature assets). All engine PRs (#1760–1770) already merged to origin; these Cowork docs are the residue.
3. Older standing items still open: the 475 MB `.pst` history rewrite (unblocks local `git push`), CF token
   rotations, W6.5 Stage 2 frontend decomposition, U4 first-of-month report, the parked Online Archive backfill
   (needs a Purview export from IT).

## P127 (2026-08-24) — signature load-time sanitizer shipped (the durable fix)

Reviewed + reconciled. PR #1770 merged (local `ea561ca3`). `loadSignatureHtml` now sanitizes every signature
before use: strips `<img>`/`<script>`/`<style>`/handlers + anything past an Outlook quote boundary
(`appendonsend`/`divRplyFwdMsg`/`From:`), bounds size (>8 KB after cleaning ⇒ `not_configured`, nothing
appended), and surfaces removals (`signature.sanitized_removed` / `sanitize_rejected` + a once-per-source
stderr warning). **59 new tests replay the exact P126 dirty bytes through the real `appendSignature` path and
assert no `<img>`/`linkedin`/`cid:`/quoted-header survives while name/title/phone/email do.** Both committed
assets re-verified clean with an HTML tokenizer — **857 B (reply) / 1,253 B (full)**, image-free, mailto/tel/
northmarq.com only, exact facts once (Tulsa address on FULL only). Ships on the Railway redeploy; assets are
clean now regardless, so the sanitizer is defense-in-depth.

**⚠️ Honest-measurement note (CC self-corrected — worth keeping):** CC first reported "full suite green / exit
0," then retracted it — `node --test` returned 0 *despite* a failing test, and its grep watched for a `# fail`
marker the dot reporter never emits. Both "green" signals were measurement artifacts, not measurements —
exactly the repo doctrine "assert on the STATE DELTA, never the worker's exit status." The real state (CORRECTED
by P128 — this "1" was itself an undercount; it was actually **4 fail**, matching P126): the U3 case was
`test/w8-u3-conflict-card.test.mjs` — a stale source-grep that Prompt 89's null-guard
invalidated (it greps `api/admin.js` for a line P89 rewrote), fails identically on HEAD~1, untouched by P127.
Same class as the `</table>` stale assertion CC fixed in the P126 signature test. **Optional one-line follow-up**
to fix that grep (CC offered); not blocking (CI here only runs the boot check).

## P126 (2026-08-24) — signature append shipped; ⚠️ Cowork caught DIRTY runtime assets (fixed) → prompt 127

Reviewed + reconciled. PR #1769 merged (local `57329e58`). CC built the context-aware signature append
(`api/_shared/email-signature.js`: reply vs full variant, conservative already-signed detection reusing the
corpus `SIGNATURE_ANCHORS`, `body_html` now rendered once so the dry-run equals the save, 28 tests). It also
correctly stripped the `cid:` logo (a `cid:` ref renders broken in a generated draft, and a hosted remote image
would turn every send into a read-receipt) and corrected a real offer-submission doc error (the Tulsa address
lives in the FULL block only — 0 of 592 recent reply blocks carry it).

**⚠️ Cowork catch — the committed signature ASSETS draft-assist reads at runtime were DIRTY.**
`docs/os/voice/signatures/signature-reply.html` merged at **12.7 KB carrying a LinkedIn notification email + 4
tracking-pixel `<img>`s + a broken `cid:` logo** below the real signature; `signature-full.html` similar.
`loadSignatureHtml` only strips HTML comments, so `appendSignature` would have stapled a LinkedIn email +
tracking pixels onto **every reply** — invisible in the JSON, visible only on open. CC's tests passed because
they ran against its trimmed branch copies, not the bytes that actually merged (add/add conflict resolution
kept the un-trimmed side). **Fix:** Cowork replaced both with clean, balanced, branded hand-authored HTML
(final committed sizes **857 B reply / 1,253 B full** — an earlier note said 1.7/5.1 KB, that was the messy
regex draft, superseded; 0 `<img>`, 0 LinkedIn/quote leak, phone+email+address+tagline intact, Futura-PT /
Northmarq-blue). **Durable fix → prompt 127:** add a load-time sanitizer to `loadSignatureHtml` (strip
img/script/style/handlers + anything past a quote boundary; assert size) so a dirty asset can never leak again,
+ a test that feeds the exact P126 dirty bytes and asserts they're neutralized. **Uncommitted:** the two cleaned
asset files (Scott commits). Live signature verify still needs the redeploy + a save.

## P125 (2026-08-21) — draft-assist retrieval + threading + deal-context, all six items fixed

Reviewed + reconciled. **#1768 merged, local main at `6b33e7e7`, `/version`=`6b33e7e75f06` — the JS half is LIVE.**
CC found the root causes deeper than the prompt framed:
- **"Full-body" was a length heuristic wrong about 62% of Scott's mail.** `FULL_BODY_MIN_CHARS=300` inferred
  provenance from size; measured over 777 body_html rows, median cleaned prose is **160 chars** (his voice is
  "short and punchy"), so 438 genuine full bodies were mislabeled "preview-era." Now provenance is carried from
  WHICH body column at load, not re-derived by length.
- **corpus_size 395**: `loadCorpus` paged the newest 3,000 of the whole 28,090-row store then filtered to Scott
  in JS → only 565 of his 1,188 seen. Author filter pushed into PostgREST.
- **Recipient-blind ranker**: the embedding ranker accepted `recipientEmail` and ignored it (so Susan's 55
  backfilled emails changed nothing); deterministic weighted recipient below bucket. Now full-body + exact-
  recipient are a hard PARTITION, not score terms; `cc` now read (3 of Susan's 55 are cc-only).
- **Deal context never attempted** (item 6): facts loaded only `if(entityId)`; now reads the hourly
  deal-matcher's verdict, thread-scoped — Susan's thread resolves to *DaVita Dialysis – The Villages – FL*,
  stage non_refundable.
- **Threading (item 5): 3 flow defects fixed** — double Response on both branches, `toRecipients` PATCHed onto
  a reply, unguarded empty `$filter`; every response now echoes `threaded`+`conversationId` (the seam couldn't
  distinguish a threaded reply from a fresh draft before). Flow def reconciled to the tenant (Graph passthrough,
  `$authentication`, ContentType). **⏭ threading UNPROVEN until re-import** — Cowork re-packaged as
  `LCC-CreateOutlookDraft-import-v5.zip`; `outlook_draft.threaded` reads `null` until then.
- Tests 47→76; suite 4,258 (4 pre-existing failures). PR #1768.

**✅ VERIFIED LIVE 2026-08-21 (2nd real save, after v5 re-import):** all six upgrades confirmed in one response —
`corpus_size` **773** (full_bodies 517), **full_body_exemplars 5 / preview_only 0 / recipient_matched 5**,
`voice_confidence` now "5 FULL past email bodies … SHORT by choice, not truncated," `facts.source
=deal_spine_via_deal_match_thread` (entity 17218fd0…, DaVita–The Villages), `fact_validation.clean=true`,
deal-aware subject, and **`outlook_draft.threaded=true`** (v5 re-import took). Draft saved, Sent untouched.
Minor observability nit: `conversation_matches_thread` came back blank (the flow echoes `threaded` but not
`conversationId` for the seam to compare) — cosmetic, not functional; optional tiny follow-up.

**v6 (Cowork flow re-package, 2026-08-21) — threading fully proven + quote preserved.** The first threaded
draft had correct headers (In-Reply-To + full References + Thread-Index) but read as bare because
`Set_reply_body` PATCH *replaced* the body, wiping the createReply-seeded quote. Fixed: PATCH now prepends
`body_html` ABOVE `body('Create_draft_reply')?['body']?['content']` (repo `flow-lcc-create-outlook-draft.json`
updated + re-packaged `LCC-CreateOutlookDraft-import-v6.zip`). Post-re-import save: **`threaded=true`,
`conversation_id` populated, `conversation_matches_thread=true`** — threading definitively confirmed via the
seam. ⏭ **Open follow-up: no signature block** — draft-assist emits a sign-off but not Scott's Northmarq
signature; the draft isn't send-ready. Drafted **prompt 126** (append canonical signature, sourced
conservatively, above the quote, never fabricated). Quote-preservation (v6) to be eyeballed on the newest draft.

## 🎉 2026-08-21 — draft-assist is LIVE end-to-end: the app drafted an email in Scott's voice, in Outlook

First real save succeeded through the whole chain: captured history → v3 voice profile → `/api/draft-assist?save=true`
→ the imported `LCC Create Outlook Draft` PA flow → **a draft in Outlook Drafts**, to the right contact
(Susan Holdsworth), **Sent empty** (save-not-send held). `saved:true`, real `draft_id` + `web_link`, no error.
The PA flow was hand-packaged by Cowork from the bare definition (PA import needs a package .zip, not a bare
Logic App def): three import blockers fixed in sequence — (1) declare `$authentication` + add the auth ref to
every OpenApiConnection action; (2) `CreateDraftMessageV3` isn't in this tenant → converted to a Graph
`POST /me/messages` passthrough (draft, never sends); (3) every `HttpRequest` with a Body needs
`ContentType: application/json` or Graph 400s "Empty Content-Type provided". Final gotcha: the flow was toggled
OFF — a disabled flow's HTTP trigger returns 400/502.

**Two refinements from the live save → folded into prompt 125:** the draft came out as a FRESH email, not a
threaded reply (createReply/seam `in_reply_to` path), and it lacked deal context (`facts.source=no_entity_relational`).
Plus the retrieval-grounding gap already in 125 (drafting from 5 preview openings, not the 55 full-body Susan
emails now in the corpus). 125 now covers all three.

---
## 2026-08-21 (P125) — draft-assist retrieval: four defects, all measured live, all root-caused

**JS-only + a flow re-import. Ships on the next Railway redeploy of merged `main` → `npm run verify:deploy`.**
No migration, no `field_source_priority` change. Full suite 4,258 tests, 0 new failures (2 pre-existing on
`main`, both in `auto-scrape-listings`, unrelated).

**1. The corpus loader spent its whole page budget on other people's mail.** `loadCorpus` paged the newest
3,000 rows of the WHOLE store and only then dropped everything not authored by Scott. Live: `email_bodies`
holds **28,090** body-bearing rows of which **1,188** are his — so that window contained just **565**, and
`retrieval.corpus_size` reported a number far below the corpus that exists. `SCOTT_FROM` is now a PostgREST
filter on both stores (`from_email=in.(…)` / `metadata->>from_email=in.(…)`); the JS gate stays as the
authority. The whole outbound corpus (1,188 + 951 `activity_events` = 2,139) now fits in one cap with headroom,
and the payload reports `corpus_full_bodies` + `corpus_truncated` — **assert on full bodies, never row count.**

**2. ⚠️ THE FULL-BODY TEST WAS A LENGTH HEURISTIC, AND IT WAS WRONG ABOUT 62% OF SCOTT'S REAL EMAILS.**
`FULL_BODY_MIN_CHARS = 300` infers provenance from size — and Scott's voice is short *by design* (the profile's
own first rule). Measured over the 777 Scott-authored rows carrying a real `body_html`, after the cleaner strips
the quoted chain and signature:

| cleaned prose | rows | |
|---|---|---|
| < 12 chars | 71 | correctly dropped as boilerplate — `"AWESOME!"`, `"Just did!"` |
| **12–299 chars** | **438** | **genuine full bodies the heuristic called "preview-era openings"** |
| ≥ 300 chars | 268 | |

Median cleaned prose is **160 characters**. That is why `voice_confidence` kept reporting *"preview-era OPENINGS
only (~255-char cap)"* over a corpus that is nothing of the kind — it was measuring length, not provenance.
Provenance is a fact held at load time (which body column the text came from), so it is now carried
(`exemplar.full_body`) and the length test survives only as a fallback for callers that supply none.
`exemplarBodyCoverage` reports its `basis` so the fallback can never be mistaken for a real read.

**3. The embedding ranker was entirely recipient-blind — and that is invisible from outside.** It scored cosine
plus a 0.02 bucket nudge and nothing else, so `target.recipientEmail` was accepted and discarded: backfilling
Susan Holdsworth's 55 full-body emails changed the retrieved set by **nothing**, because no term could see them.
The deterministic ranker *did* weight recipient (+2) — so the two rankers disagreed about what relevance means,
and which one ran depended only on whether Ollama answered. Both now read one `recipientMatchLevel` (to 2 / cc
1.5 / domain 1 — **cc was never read at all before**, and 3 of Susan's 55 rows are cc-only).

**A weight that can lose is indistinguishable from one that is not there.** So the two guarantees are a hard
ordered PARTITION (`selectExemplars`), not score terms: `full body + exact recipient` → `full body` →
`preview + exact recipient` → `preview`. Full-body is the outer key (a preview evidences a greeting and nothing
else); exact recipient is the inner one. **A domain-only match is deliberately NOT a tier** — a colleague at the
same firm is a different person. Lower tiers only ever fill slots a higher tier could not, so a thin corpus is
never starved. Applied around *whichever* ranker won, so the guarantee no longer depends on Ollama.

**4. Deal resolution did not fail — it did not exist.** Facts were loaded only `if (entityId)`, so a dry-run
supplying just a recipient reported `facts.source: no_entity_relational` for a live, named, in-progress deal.
Nobody had asked. `resolveDealEntity` now reads the verdict the hourly deal-email matcher **already records**
(`activity_events.source_type='lcc:deal_match'`, `external_id` = the RFC internetMessageId, `entity_id` = the
deal) — no new matching heuristic. Thread-scoped, not message-scoped, because the matcher is budget-bounded and
skips already-attributed mail: **verified live** — the exact reply target draft-assist picked for Susan had no
row of its own, and its conversation resolved to `DaVita Dialysis - The Villages - FL` (`17218fd0-…`, stage
`non_refundable`, expected close 2026-08-21). An unresolved deal now names the rung that came up empty
(`thread_not_attributed_to_a_deal` ≠ "no deal exists").

**5. The threading outcome was unobservable, which is why a live save was needed to notice it.**
`{ok, draft_id, web_link}` is identical for a threaded reply and a fresh message. Three real defects in the flow
definition: `Respond_Success` ran `runAfter: Is_Reply: [Succeeded]` — after **both** branches — so the reply path
**responded twice** and the second read a null `body('Create_draft')`; `Set_reply_body` PATCHed `toRecipients`
onto a reply draft that already carries the thread's recipients; and an empty `$filter` result built
`/me/messages//createReply`. Fixed: one responder per path, body-only PATCH, a `Thread_Message_Found` guard that
falls back to a standalone draft **and says so**. Every response now echoes `threaded` (+ `conversationId`), the
seam surfaces `conversation_matches_thread`, and a requested-but-unthreaded save returns a `threading_warning`.
`threaded: null` ≠ `false` — "an older import" and "it did not thread" are different facts.

**The repo definition had also drifted from the tenant.** Per the hand-package notes above, `CreateDraftMessageV3`
does not exist in this tenant, `$authentication` must be declared and referenced, and every `HttpRequest` with a
Body needs `ContentType: application/json`. All three are now in the committed definition — a definition that only
describes a flow nobody can import cannot be reasoned about.

**⚠️ REMAINING GATE (Scott/Cowork, live):** re-import `flow-lcc-create-outlook-draft.json` and re-run the
acceptance test in `docs/architecture/flows/outlook-draft-reply-executor.md`. Until then `outlook_draft.threaded`
will read `null` and threading stays unverified.

## 2026-08-21 Cowork reconcile — P122/P123/P124 verified; ⚠️ REDEPLOY PENDING (draft-assist safety)

All three landed and each corrected my prompt's premise. **DB layers verified live on LCC Opps:** P122 crons
`cm-gov-packet-refresh` (start) + `cm_packet_refresh_tick` (per-min) armed, 0 open alerts for that source (gov
packet updated_at moved 2026-08-14 → 2026-08-21, 41→45/45 charts); P123 `v_lcc_deal_match_run_health` +
`duration_ms` present; P124 `PA_OUTLOOK_DRAFT_FLOW` registered, profile → v3.0.0.

**⚠️ THE JS HALVES OF P123 + P124 ARE NOT DEPLOYED.** `/version` = `527d78f9b05c`, unchanged since P121 — the
P123/P124 merges (PR #1767 / #1765) have NOT redeployed. Consequences until a Railway redeploy of `main` +
`verify:deploy`:
- **P124 (safety):** `DRAFT_ASSIST` is **ON** (since 2026-08-14) with the **old contaminated classifier** live —
  `purpose=cold_bd` still draws from the personal-mail sump (89.7% of `cold_bd_outreach` was bunk-notes/meal-
  plans/football, 0 cold BD). A save to an institutional owner would be in the wrong register. **Action: redeploy
  promptly, OR flip `DRAFT_ASSIST` off until then; and check Outlook Drafts for anything created this past week
  (depends on `PA_OUTLOOK_DRAFT_URL` being set on Railway).**
- **P123 (benign):** matcher keeps completing (~80s) but pg_net keeps timing out at 60s → `no_response` alerts
  persist until the v2.2 engine (bulk pre-fetch, work budget, run-log-opened-first) deploys.

**Premise corrections worth carrying:** P122 — pg_net queue inserts are TRANSACTIONAL, so the statement-timeout
abort rolled back every fired request: 0 HTTP calls delivered in 7 runs, and the gov packet lives in the DOMAIN
DB (gov), not LCC Opps `cm_report_snapshots` (empty). P123 — not broken/not a matcher timeout: `no_response` is
a pg_net 60s cap while Railway finishes+logs ok; "6 in 24h" was a ~6h retention artifact = 100% of calls; the
cost was ~680 sequential N+1 round-trips, not the DB. P124 — `DRAFT_ASSIST` was already ON (not gated off), and
`email_bodies`-first dedup is one sort-direction from silent total failure (866/0 vs 614/614). Dry-run is
Scott's on-box step (GaryBuilt Ollama unreachable from cloud); build sheet
`docs/architecture/flows/outlook-draft-reply-executor.md`.

## 2026-08-21 runs review — email loop healthy; 2 unrelated lanes to watch

Deploy live + git-pinned (`/version` = `527d78f9b05c`). **Email-orchestration loop all green:** move queue
fully drained (`move_outcome` 329 moved + 15 already_out, 0 pending), mirror worklist 0, stranded detector 0,
jobs clean (433 extract + 14 doc-text, 0 failed). Open alerts back to **29** (from the 3,987 park storm). Two
NON-email items worth a look, neither urgent, neither ours from this week:
- ~~**`cm-gov-packet-refresh` cron failing** (09:15Z) — the one CC left open in P118; recurring,
  capital-markets gov packet lane. Candidate for its own prompt.~~ **FIXED in P122 (2026-08-21)** —
  in-transaction `pg_sleep` blew the statement timeout AND rolled back every queued pg_net request,
  so the gov packet had refreshed zero times in 7 days. See the P122 entry below.
- ~~**`/api/pipeline/match-deal-emails-cron` — 6 `no_response` in 24h**~~ **FIXED in P123 (2026-08-21).**
  Not the same class as the P118 subplan timeouts, and **not 6 of 24** — `net._http_response` is pruned to a
  ~6-hour window, so 6 was the whole retained sample: **100% of hourly calls timed out**, every one at exactly
  60,000 ms (`lcc_cron_post`'s `timeout_milliseconds`). The DB was never the bottleneck (~100 ms per deal);
  the handler was making ~680 sequential PostgREST round trips per run to rediscover already-done work, and
  Railway kept finishing at ~80 s and writing an `ok=true` run-log row after pg_net had already given up.
  See the P123 entry below.
- Transient (self-heal): `SF→LCC Retry&Dead-letter` flow_failure, `cre-owner-backfill` 502, `dup-pair-tick`
  no_response — single occurrences.

## P123 (2026-08-21) — `match-deal-emails-cron` `no_response`: a 60 s wall, not a crash

**Migration `20260821180000_lcc_p123_deal_match_run_log_observability.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`).** Handler + engine changes ship on the next Railway redeploy of merged `main`
(then `npm run verify:deploy`).

**The diagnosis inverted the premise, twice.**
1. **It was never broken.** `DEAL_EMAIL_MATCH_CRON` is on, and `lcc_deal_match_run_log` has a complete
   `ok=true`, `error_count=0` row for **every** hour. The P122-era count=exact fix held.
2. **It was never a DB timeout.** `lcc_cron_post` posts with `timeout_milliseconds := 60000`; the handler
   took ~75–90 s (cron fires :17:00, the log row lands :18:15–:18:30). pg_net gave up at exactly
   60,000 ms — `net._http_response.timed_out = true`, *"Timeout of 60000 ms reached"* — on **every**
   retained call. "6 in 24h" was the retention window (~6 h), not a 25% failure rate.
3. **The real cost was round trips, not SQL.** Profiled with the handler's actual query shape (P118
   method): the per-deal candidate scan is an index scan at **~99 ms**, so all 36 deals ≈ 3.6 s. The other
   ~75 s was **~680 sequential PostgREST calls** — one idempotency GET plus one roster-edge GET *per matched
   email* — spent rediscovering that all 341 matches were already attributed, every hour.
   **Not a dead worker, and worth stating precisely:** 282 real attributions landed in the last 14 days
   and mail is flowing (692 Outlook events in 7 days). The defect was the CONSTANT re-discovery cost —
   paid in full hourly however little was new — and `already_attributed: 341` reading like throughput
   when it is a re-scan tally. P159a applied to cost rather than output.

**The fix (engine v2.2 + handler + migration).**
- **Bulk pre-fetch** of the attributed-key set and the existing `deal_party` edge set (two paged reads)
  turns both per-email probes into in-memory Set hits. Fails **closed** — a failed prefetch aborts the run
  rather than assuming nothing is attributed and re-POSTing hundreds of rows against the unique index.
- **Candidate query carries core tenant AND city to the DB.** Substring ⊇ the word-boundary test applied in
  memory, so no match can be lost; the candidate set and its payload of full email bodies collapse.
- **Every multi-row read pages at 1000.** PostgREST caps a response at 1000 rows regardless of `limit=`, so
  the old `CAND_LIMIT = 1200` silently returned 1000 and dropped real matches. Truncation is now counted
  (`candidates_truncated`), never silent.
- **Work budget** — `deadline_ms` (default 40 s, inside the 60 s window), `max_writes`, and a deal `cursor`.
  A run stops on a deal *boundary* and hands the next run `cursor_end`, so no backlog can push one
  invocation past the response window. `budget_stopped` reports it out loud.
- **The run-log row is OPENED before the work** (`status='started'`) and PATCHed closed with
  `duration_ms`/stats. Previously the row could only be written on the way out, so a run that genuinely died
  mid-flight left *nothing* and looked identical to one that never fired. A row stuck at `started` is now
  the signature of a dropped run (`v_lcc_deal_match_stalled_runs`); `v_lcc_deal_match_run_health` is the
  per-run line.
- **A failed candidate READ is now an ERROR, not "this deal has no mail"** — the old `cand.data || []`
  swallow made a broken query indistinguishable from a quiet inbox. This is a deliberate behavior change;
  the test that asserted the old swallow was rewritten to assert the new contract.

**Matching logic is untouched** — core-tenant + city + word-boundary + digest exclusion are byte-for-byte
v2.1. Guards: `test/deal-email-match-cron.test.mjs` (9 tests) pins zero per-email round trips, the
fail-closed prefetch, open-before-work ordering, both budget stops, cursor wrap, and the city push-down.

**Verify after the redeploy** (the honest check is the delta, not the tally):
```sql
-- no_response must go to 0, and duration_ms must sit well under 60000
select run_id, status, ok, duration_ms, deals_scanned, deals_total,
       cursor_start, cursor_end, budget_stopped, emails_attributed, already_attributed
  from v_lcc_deal_match_run_health limit 12;
select count(*) from v_lcc_deal_match_stalled_runs;          -- expect 0
select l.request_id, r.timed_out, r.status_code
  from lcc_cron_post_log l left join net._http_response r on r.id = l.request_id
 where l.endpoint = '/api/pipeline/match-deal-emails-cron'
   and l.created > now() - interval '6 hours';               -- expect timed_out = false
```

## P122 (2026-08-21) — `cm-gov-packet-refresh` fixed: the gov CM packet had refreshed ZERO times in 7 days

**Migration `20260821120000_p122_cm_packet_refresh_cursor.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`). Data/cron layer only, no Railway deploy.** Runbook:
`docs/capital-markets/CM_PACKET_REFRESH_RUNBOOK.md`.

**The break.** `cm_gov_packet_refresh_chunked(p_batch 4, p_sleep 50)` looped the gov chart catalog
firing `net.http_post` per batch with `PERFORM pg_sleep(50)` — **fifty seconds** — between them, all
inside ONE statement. Live: 31 gov charts ÷ 4 = 8 batches × 50s = **400s of in-transaction sleep
against a 120s `statement_timeout`**. Cancelled on every run, 7/7 from 08-15 to 08-21.

**⚠️ And it delivered NOTHING — not "some batches got through".** `net.http_post` is async but its
queue insert is **transactional** (pg_net 0.20.0 INSERTs into `net.http_request_queue`; the worker
only reads *committed* rows). The statement timeout aborts the transaction, so every already-"fired"
request rolled back with it. Proven two ways: a `DO` block that http_posts then `RAISE`s left 0 rows
in the queue and produced 0 responses; and the **state delta** — the gov Q2-2026 row in gov
`cm_report_snapshots` sat at `updated_at = 2026-08-14 20:00:12` across all 7 runs. A single delivered
batch would have bumped it. **Durable rule: a rolled-back `net.http_post` is a silent no-op — never
assume partial delivery from a mid-loop abort.**

**The fix — cursor across invocations.** The serialization intent was right (`mergeRefreshPacket` is a
read-modify-write on one snapshot row, so overlapping merges lose charts); doing it with a multi-minute
sleep in one statement was not. Now `cm_packet_refresh_start('gov')` (daily 09:15, same job name so
the alert `source` stays stable) freezes the catalog into `cm_packet_refresh_cursor`, and
`cm_packet_refresh_tick('gov')` (new job, every minute) fires ONE batch and advances — milliseconds
per tick, no sleep, statement timeout never approached. Idles instantly once covered. Per-batch ledger
`cm_packet_refresh_log` + `v_cm_packet_refresh_health`.

**⚠️ Caught live on the first cycle — A TIMED-OUT pg_net RESPONSE IS NOT COMPLETION, IT IS THE
OPPOSITE.** The first guard advanced as soon as a response row existed. Batch 1 fired 17:00:00.78 at
the inherited `timeout_milliseconds=55000`; pg_net gave up at 17:00:55; the tick read that as "done"
and fired batch 2 at 17:01:00 — but batch 1's merge only upserted at **17:01:09.90, nine seconds
later**. Batch 2 had already read the pre-batch-1 packet, so its merge would have written back stale
copies of batch 1's charts — precisely the lost update the serialization exists to prevent. A 4-chart
gov subset merge measures **~69s**, so 55s was abandoning a request the server was still working on.
Corrected: timeout → 170s, and completion now requires a response that is **NOT `timed_out`**
(fail-forward past `p_max_wait_sec` 300 so a lost response can't stall a cycle).

**Verified by state delta, not return values.** A full clean cycle was driven end-to-end by the
production cron (17:03:10 → 17:20:00): **8/8 batches fired, 0 unreconciled, tick job 23/23 succeeded,
0 failures.** Gov Q2-2026 `cm_report_snapshots.updated_at` **2026-08-14 20:00:12 → 2026-08-21
17:19:16** — first movement in 7 days — and populated charts **41 → 45 of 45**.

**Batch 3 returned a 502** (`cap_rate_ttm_by_quarter, case_for_renewal, cash_leveraged_returns,
core_cap_rate_dot_plot`) — surfaced in the ledger, not silent. Because the merge is non-regressing
those charts kept their existing rows (`cap_rate_ttm_by_quarter` still 354) and simply retry next
cycle. `batches_ok` counts pg_net 2xx and is **not** proof the packet changed — always confirm with
the domain `updated_at` delta.

Synthetic/composed + `DataTable`/`kpi_block` templates stay excluded — documented residual, not a
failure. The 7 stale `cron_failure` alerts for this source resolved with a P122 note (open alerts
30 → 23, 0 for this source). `cm_gov_packet_refresh_chunked` is dropped; reversal runbook in the
migration foot. Cost of the per-minute tick: +1,440 `cron.job_run_details` rows/day on ~5,774/day,
bounded by the existing `cleanup-cron-history` 7-day prune — ~+3 MB steady state.

## P120 (2026-08-20) — the app now MOVES emails: move-queue executor built (was: nothing ever drained it)

**Migration `20260820140000_lcc_p120_move_queue_executor.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`), so the data layer is live now. The two new sub-routes ship on the next Railway
redeploy of merged `main` → run the deploy gate `npm run verify:deploy` and confirm
`/api/move-queue-worklist` + `/api/move-queue-ack` return JSON, not the SPA HTML.**

**Cowork reconcile-verified live 2026-08-20 (PR #1763 merged @ 37fa2e7):** LCC side all present —
`v_lcc_move_queue_worklist` (n=**340**: 325 staged + 15 duplicate), `lcc_move_queue_ack` RPC, auto-retire
cron, `MOVE_QUEUE_EXECUTOR` flag registered **off**, both routes mounted in `server.js` (L421–422).
**✅ LIVE 2026-08-20 — the app now moves emails.** All three activation steps done: `main` redeployed,
`MOVE_QUEUE_EXECUTOR=true` set on `tranquil-delight` + registry flipped `on`, and the **Flow 7 PA executor built
+ running** (`LCC — Move Queue Executor`, 15-min recurrence). First manual run: **22 `moved` + 3 `already_out`,
0 parked, worklist 340 → 315.** Recurrence drains the rest at ~25/run. Flow-build footguns hit + fixed live:
the guard used `equals(skipped,'')` but the flag-on response OMITS `skipped` (PA `equals(null,'')`=false) → wrap
in `coalesce(...,'')`; the ack URL had `/api-move-queue-ack` (should be `/api/move-queue-ack`); and the msg-id
expr must be `first(body('Find_message')?['value'])?['id']` (the `)` after `['value']`, not around the whole). **⚠️ Ordering hazard to close before/with rollout
(CC-flagged, not fixed):** Flow 6 (`todo-completion-poll`) flips `staged→filed` WITHOUT moving, while the
mirror gates on `outcome='staged'` — if Flow 6 wins the race a message sits in staging forever reading
`filed/moved`. Latent while staging was empty, **now reachable (drainer live 2026-08-20) → drafted as
prompt 121** (`121-staging-move-vs-flow6-ordering-hazard.md`): decouple the mirror worklist from the transient
`outcome` flip (anchor on the mirror ledger), stop Flow 6 asserting a move it didn't make, heal any stranded.

**The break (measured live, 4 independent confirmations).** `staged/pending 325 · duplicate/pending 15 ·
filed/moved 16 · needs_review/skipped 47`. **All 16 `moved` rows carry `outcome='filed'` AND
`target_folder = final_target_folder`** — the signature of the Flow 6 `todo-completion-poll` `staged→filed`
flip; `intake.js` never emits `outcome='filed'`. **So the move executor stamped ZERO rows, ever.** Root cause:
`processing-complete.js` writes the queue row and returns the event in the intake HTTP *response*; the mover
relay (`POST /api/webhooks/processing-complete` → `pa-move-message.js`) is real and correct but has **no
caller** (the only `postMoveMessage` call site is the relay itself) and **never wrote `move_status` on any
path** — no queue endpoint to poll, no stamp-back. `briefing-data.js:297` and the P119 migration header had
both already recorded it. The index `ix_processing_log_move_queue` existed for a drainer nobody wrote.

**Built.** `v_lcc_move_queue_worklist` (actionable-only: has a move key + destination, not parked, outside the
1h backoff; FIFO) · `lcc_move_queue_ack()` (the SINGLE stamp-back path; idempotent) ·
`lcc_move_queue_retire_cleared_parks(dry_run default true)` · handler `api/_handlers/move-queue.js` +
sub-routes `GET /api/move-queue-worklist` / `POST /api/move-queue-ack` (batch-capable) · flag
`MOVE_QUEUE_EXECUTOR` registered in `feature_flags_registry` (state `off`) · PA build sheet
`docs/architecture/flows/move-queue-executor.md` (Flow 7).

**P119 semantics reused, not reinvented** — MESSAGE-not-in-source-folder = terminal SUCCESS on the first ack
(`move_outcome='already_out'`, no retry/park/alert); DESTINATION-folder-not-found = real break → 1h backoff →
park after 5 → deduped `move_queue_parked` alert. The classifier remains the single SQL owner
`lcc_mailbox_mirror_error_is_terminal()`; a test asserts there is **no JS copy**.

**Honest counts:** `move_status='moved'` covers BOTH a real relocation and an already-gone no-op. The
move-DELTA is `move_outcome='moved'`; the ack response reports `moves_performed` separately from `counts`.

**Verified:** 13/13 JS tests + full suite green; live self-rolling-back synthetic gate **11/11 PASS, 0 residue**
(real move · msg-not-found terminal at attempts=0 · dest-folder retries · backoff excludes · park-after-5 with
exactly 1 alert · parked excluded · idempotent re-ack · ack resolves the alert · unknown-message honest ·
clear_flag true for duplicate / false for staged). **The gate caught a real bug pre-ship:** the first cut used
`move_status='error'`, which `processing_log_move_status_check` rejects — the schema already had `move_failed`.

**⏭ Scott's live steps (the backlog does NOT drain until these run):** redeploy + deploy gate → dry-run
`GET /api/move-queue-worklist?force=1&limit=5` → build the PA flow from the Flow 7 sheet → set
`MOVE_QUEUE_EXECUTOR=true` in Railway + flip the registry row to `on`. Then verify by **state delta**
(`select move_outcome, count(*) …` and the falling worklist count), never by the run's own tally.

**⚠️ Ordering hazard surfaced (not fixed here):** once staging fills, Flow 6 flips `staged→filed` *without
moving anything* while the W7.6 mirror (which does the moving) gates its worklist on `outcome='staged'` — if
Flow 6 wins the race the message sits in staging forever while the DB reads `filed`/`moved`. Latent while
staging was empty; reachable now. Close it before/with the `MAILBOX_MIRROR` rollout.

**Also corrected:** `docs/KNOWN_ISSUES.md` called this same symptom **"Impact: cosmetic only"** and recommended
**deleting the `pending_moves` briefing clause** — i.e. removing the only live indicator that the loop was
open. Entry rewritten as RESOLVED with the durable lesson: before calling an unmaintained counter cosmetic, ask
what it would look like if the underlying work were genuinely not happening.

## P150a–P160 (2026-08-19/20, Cowork) — the contact pipe was dead for 3 weeks; owner resolution 2,716 → 4,064

**Not filed as prompt files** — these were done live in Cowork against the DBs. They exist as
`supabase/migrations/20260930120900…20260930121600*.sql` (LCC),
`GovernmentProject/sql/20260819_gov_p155*…20260820_gov_p157*.sql`,
`DialysisProject/supabase/migrations/20260820_dia_p157*.sql`, plus
`GovernmentProject/src/ingest_sam_public_extract.py` and
`docs/RUNBOOK_sam_public_extract_cron.md`. Full narrative in `docs/audits/ROLLOUT_STATUS.md` session log.

**Theme: every failure reported healthy.** Three-week-dead pipes behind green crons; a value gate present
in code and inert in the data; a worker reporting `drillthrough: 37` while draining 6.

| Unit | What |
|---|---|
| P150a/b, P154 | Merge tombstones: evidence stranded, **30 merged-away entities still in the prospect list**, $32.5M double-counted, one live A→B/B→A **merge cycle**. `lcc_entity_survivor()` (hop-capped 20). |
| P151 | Public bodies out of prospects — 234 owners / $87.2M of unworkable BD. Guard matches the governmental FORM, not the word "city" (`Space Center Kansas City Inc` is private). |
| P152 | `lcc_owner_name_is_agent()` — CMBS servicers / trustee banks / OBO managers are not principals. Deferred by P146, P148a and P149; closed here. **60 community banks and 17 individual trustees deliberately NOT matched.** |
| P153 | Article/punctuation duplicate merges (told Scott "5 pairs", merged 86 — all verified genuine). |
| P155 | **The SAM value gate was inert.** `deal_value` used a join path empty for exactly the owners its top tier selects, so ~10 scarce daily lookups went out **alphabetically by UUID**. 131/131 tier-0 owners have rent (max $26.3M) via the other path. |
| P156/a/b/e/f/g | **SAM public monthly BULK extract** — one API request instead of 23,000. Railway (per the standing hosting rule; I built it on GH Actions first and Scott caught it). Layout guard, placeholder-POC guard (**GSA's sample is anonymised to "JOHN DOE" — an `--apply` would have written a fictional person onto 1,117 owners**), per-table uniqueness (union rule was discarding 5.1× the coverage), matcher 7.09s→2.03s. |
| **P157/P157a** | **6 gov + 4 dia `v_*_portfolio` views had `security_invoker=on` → anon got HTTP 200 `[]`.** `lcc_owner_contact_signals` frozen **2026-07-28 → 2026-08-20** with crons 136/137 green throughout. Fixing it exposed a second bug (`21000` on duplicate keys) **dormant only because of the first**. |
| P158/a | New pursuit state **`NAMED LEAD — find their line`** + `v_lcc_named_lead_worklist` — 61 owners / $121.5M we can name but not dial (USAA Real Estate → Joseph Capra, $62.0M). NOT marked reachable (P112). |
| P159/a | Enrich queue 4,472 → **757 actionable**; useful work 32% → 88%; real drain 6 → 16/run. Cron 139 now hourly `limit=100`. |
| P160 | `lcc_merge_entity` repoints the ownership/BD backrefs the reconcile never moved + cycle guard + terminal-survivor resolution. Cleaned **63 dead owners / 99 stranded pivots** it had already created. |

**Near-misses worth remembering** (all caught by measuring before applying): adding `&` as an org marker
would have retyped **119 people and touched 66 resolved owners** — the population is married couples
(`Amy & Richard Gonzalez`); a `bank ... trust` agent arm would have swallowed **60 community banks**;
a `by <brokerage>` rejection guard would have discarded **197 real owners** wearing a capture artifact.

**Book after:** 4,120 prospects / $3.77B — 509 pursuing, 61 named leads, 3,547 needing a contact.

**Operator (Scott):** confirm `SAM_API_KEY` (repo convention, NOT the edge function's `SAM_GOV_API_KEY`)
and gov `SUPABASE_URL` on the new Railway service. Cron `0 0 9 * *` is deliberate — the entity cron
empties the daily quota at 00:15, so any later slot is rate-limited every month.

---

## P119 (2026-08-20) — mailbox-mirror park storm root-caused + auto-retire shipped

**Migration `20260820120000_lcc_p119_mailbox_mirror_not_found_terminal.sql`, applied live to LCC Opps
(`xengecqvemvfknjvbvrq`). No Railway deploy required for the fix itself** (view + RPC + sweep are all
data-layer); the JS change is comment/test only.

**Cowork reconcile-verified live 2026-08-20 (PR #1762 merged @ 5c9862e):** open `mailbox_mirror_parked` = **0**,
total open alerts = **27** (real surface holds), the `cowork-mirror-backlog-retire-20260820` tag intact at 3,960
(auto-retire sweep correctly did NOT re-touch it), `lcc_mailbox_mirror_error_is_terminal` + retire sweep +
`lcc-mailbox-mirror-retire` cron all present, and 1 ack already recorded `already_out` (terminal-success path
live). ⏭ **Real remaining blocker (surfaced, not fixed):** all 323 `processing_log.outcome='staged'` rows sit
`move_status='pending'` back to 2026-07-21 — nothing drains the queue that populates "Intake Staged, Not
Completed", so the mirror correctly but silently acks `already_out` and moves nothing. **That staged-queue
drainer is the next piece of work → drafted as prompt 120** (`120-staged-move-drainer-app-moves-emails.md`):
the `processing_log` move queue is populated (`target_folder`/`move_status`) but only 16 `filed` rows ever
executed — build the move-executor so the app actually relocates emails (Scott's stated goal), reusing P119's
`not_found`=terminal-success semantics. Minor: the PA mover omits `reason` on its failure ack (3,963 ledger
rows `reason=NULL`) — one-line flow fix, in the runbook A5b.

**⚠️ The leading hypothesis below (double-mover race) was RIGHT about the mechanism and WRONG about the
scale — it accounts for 7 of 3,960 rows (0.2%).** Measured live:

- **The mover has moved ZERO messages, ever.** `lcc_mailbox_reconcile_ledger` = 3,963 rows since
  2026-08-06, **0 with `moved=true`**, 100% `last_error='not_found_or_not_in_source_folder'`.
- **100% of the 3,960 parks qualified via the `inbox_triaged` arm** — none via `todos_done` or
  `thread_replied`. And `archived` is not deliberate triage: 2,319 rows were archived in one bulk sweep on
  2026-06-04, another 580 on 2026-06-16.
- **The real cause is producer over-emission.** The worklist had **no source-folder-membership predicate** —
  it published every `inbox_items` row with `source_type='flagged_email'` (4,051) as a move against a folder
  those messages never entered. Split of the 3,960 parks: **3,649 (92.1%) no `processing_log` decision at
  all** (Apr–May 2026 capture, predates the move queue) · 245 (6.2%) `staged` · 45 (1.1%) `needs_review`
  (by design left in place) · 14 (0.4%) `duplicate` · **7 (0.2%) `filed`** — the actual double-mover class.
- **Stale-folder-binding is moot, not ruled in or out.** It's PA-side and unreadable from LCC, but a correct
  binding would still find nothing, because nothing populates the folder (below).

**Fixes:**
1. **Producer gate** — the worklist now requires `processing_log.outcome='staged'` (LCC itself routed the
   message to "Intake Staged, Not Completed"). Producer anchor **4,051 → 323 (−92.0%)**. Ownership rule:
   the intake flow owns Inbox→Processed and Inbox→staging; the mirror owns staging→Processed *only*.
2. **`not_found` is TERMINAL SUCCESS** — a not-in-source-folder ack records `outcome='already_out'`,
   `action='noop'`, attempts 0, no park, no alert, and resolves any open park alert for that message.
   Classifier `lcc_mailbox_mirror_error_is_terminal()` is a narrow allowlist and is the **single owner** of
   that decision (never re-implemented in JS — test-enforced). A **destination**-folder-not-found
   (`ErrorFolderNotFound`, stale `processedFolderId`) still retries, parks and alerts.
3. **Auto-retire sweep** `lcc_mailbox_mirror_retire_cleared_parks(dry_run default true)` + cron
   `lcc-mailbox-mirror-retire` (06:25 UTC). Resolves open parks whose premise cleared, normalises those
   ledger rows so they can't re-park, returns `alerts_left_open` as the honest count of genuinely stuck
   moves. Touches `resolved_at IS NULL` only ⇒ **idempotent and never rewrites the
   `cowork-mirror-backlog-retire-20260820` batch**. Reverse by `resolved_note LIKE 'p119-mirror-auto-retire:%'`.

**Verified live:** 16/16 named terminal-classifier cases pass (including the destination-folder case that
must still alert); a self-rolling-back synthetic gate covers terminal ack → already_out + 0 alerts, re-ack
idempotence, destination-folder break → parks + 1 alert, sweep dry-run mutates nothing, sweep real retires
the cleared park and normalises its ledger row, **and leaves the genuinely-stuck park open** — `all_pass=t`,
**0 residue**. The 3 still-retrying ledger rows all classify terminal on their next ack ⇒ **no new parks**.
Open `mailbox_mirror_parked` = **0**; the 27 real alerts stay visible. JS/tests: 15/15 in
`test/mailbox-reconcile.test.mjs`.

**⏭ Open upstream gap (surfaced, NOT fixed here — it is not a mirror bug).** All **323**
`processing_log` rows with `outcome='staged'` are still `move_status='pending'`, back to 2026-07-21 — the
queue that moves a staged email *into* "Intake Staged, Not Completed" **has never been drained** (the only
rows it ever moved were 16 `filed` ones, 2026-07-21→23). So the staging folder is not being populated and
the mirror will keep correctly + quietly acking `already_out`. **Draining that queue is the next piece of
work.** Also: the PA mover omits `reason` on its failure ack (all 3,963 ledger rows have `reason=NULL`) —
one-line flow fix noted in the runbook.

---

## P118 (2026-08-20) — two overnight cron failures fixed live on LCC Opps

Both surfaced in the 2026-08-20 overnight-verification sweep below. Three migrations, all **live on LCC
Opps (`xengecqvemvfknjvbvrq`), no Railway deploy**: `20260930121200` / `121300` / `121400`.

**Cowork reconcile-verified live 2026-08-20 (PR #1761 merged @ 381ed62):** `field_provenance` = 1.371M
(drained from 1.66M, still shedding), prune guards BOTH FK columns, `idx_entities_norm_name_org` present,
audit row 187741 alive, **0 open `cron_failure` for either fixed job**. Premise corrections from CC accepted:
`lcc_normalize_entity_name(text)` IS `IMMUTABLE` (enabled the index that actually cleared the tick), and
neither cron was an overnight blip. ⏭ **Follow-up flagged by CC, not urgent:** `lcc_feed_owner_signal_addresses`
is still a per-row loop (fast enough now behind the index; set-based rewrite if its 433-row feed grows).

**🔭 NEW finding from the reconcile — health-surface is 99% noise.** `v_lcc_health_alerts_open` = **3,982
open, of which 3,958 are `mailbox_mirror_parked`** (the intake "Processed"-folder mover failing
`not_found_or_not_in_source_folder` and parking one alert per email, still firing 2026-08-20 04:04Z). This
buries the ~24 real alerts (9 http_failure, 5 cron_failure on OTHER jobs, 3 sidebar_promote, etc.) — the
classic Consumption-Layer "999+ badge trains the operator to ignore the surface." Likely cause: the
flagged-intake flow ALREADY moves the email to Processed on success (its Condition → `Move_email_(V2)`), so
the separate mailbox-mirror mover then can't find it in the source folder.

**✅ Immediate cleanup done (Cowork 2026-08-20):** all 3,960 (100% `not_found_or_not_in_source_folder`, terminal
after 5×+park) retired reversibly — `resolved_at` set + `resolved_note` tag `cowork-mirror-backlog-retire-20260820`.
**Health surface 3,987 → 27 real alerts** (cron_failure 6, http_failure 10, flow_failure 3, sidebar_promote 3,
resolver_calibration_drift 3, lcc_health_red 2 — now visible). Reversible by the note tag.
**✅ Durable fix SHIPPED — see the P119 section at the top of this file** (2026-08-20). Note the hypothesis
in the paragraph above is only 0.2% of the story: the mirror had moved **zero** messages ever, and the real
cause was a worklist with no source-folder-membership gate publishing the whole historical flagged inbox.
The tagged backlog was NOT re-cleared.

**⚠️ Scope correction — neither was an overnight blip.** Resolving the alert backlog showed both crons had
been failing on EVERY scheduled run for weeks: **`field-provenance-prune` on 16 days back to 2026-07-25**,
**`lcc-owner-address-feed` on 10 days back to 2026-08-11**. The nightly `cron_failure` alert fired each
time and was read each morning as a fresh one-off. So `field_provenance` had been growing entirely
unpruned for ~4 weeks (to 1.66M) — the disk-pressure → **sign-in-lockout** path, not a cosmetic cron.
21 stale alerts were closed with a P118 note (the unrelated `cm-gov-packet-refresh` alert left open).
**Lesson: a recurring alert that reads as "new today" is worth one `group by job` over the alert history
before triaging it as fresh.**

**(a) `field-provenance-prune` — FK 23503 on the SECOND resolution pointer.**
`field_provenance_resolutions` references `field_provenance` through **two** FK columns; the 2026-08-06
fix guarded `current_provenance_id` only, so a row referenced solely via `attempted_provenance_id`
(id 187741) passed the guard. Because the delete is `where id = any(v_ids)` over a 5,000-id batch,
**one referenced id failed the entire batch** — the prune deleted *nothing* while `field_provenance`
grew to 1.66M. Guard added for both columns, in the dry-run count and the batch CTE.
**Measured: 1,663,282 → 1,371,524 = 291,758 rows pruned, 0 remaining candidates**, all 3 resolutions
and all 6 referenced provenance rows intact (187741 alive). `attempted_provenance_id` is deliberately
NOT nulled to make those rows prunable — it is the audit record of what a resolution *tried* to write.

**(b) `lcc-owner-address-feed` — correlated subplan in the resolver.**
`lcc_resolve_owner_address_observation_entities` recomputed `lcc_normalize_entity_name(e.name)` for every
org entity, for every observation row (`loops=5`, ~1,021 ms each, 45,325 rows removed by filter).
Hoisted into a `norm_org` CTE + LEFT JOIN; earliest-`created_at` tiebreak preserved (`e.id` appended only
to make ties deterministic). Timed in ONE session: old 5,091.8 ms/5 rows (~45 s at 44) → new **1,216 ms at
the full 44 rows, flat** — cost no longer scales with input rows. Equivalence proven on a match-rich
104-row sample (44 unresolved + 60 already-resolved): 58 matched by both, **0-row diff both directions**.

**(c) The fix that actually cleared the timeout — a third instance of the same antipattern.**
(b) alone was **not sufficient**. `lcc_owner_address_feed_tick()` has two halves, and the *feed* half
(`lcc_feed_owner_signal_addresses`) loops row-by-row over 433 signals calling
`lcc_record_owner_address_observation`, whose entity-fallback branch runs the **same** full-table
normalize scan — ~86 ms/row, ~37 s per tick. It is a per-row API called from several places, so it cannot
be hoisted; it needed an index. Added `idx_entities_norm_name_org` on
`(lcc_normalize_entity_name(name), created_at) WHERE entity_type='organization' AND merged_into_entity_id
IS NULL`. **998.756 ms → 0.099 ms, 2,903 → 4 buffers (~10,000x)**, sort node gone.
**End-to-end: the tick went from statement-timeout (>120 s) to 755 ms; the real pg_cron path now
succeeds in 0.7–2.5 s and the prune cron in 23.7 s with no FK error.** `entities_resolved` advanced —
unresolved observations 44 → 43 (only 1 of the 44 has a genuine org match; the rest are honestly
unmatchable, not starved).

### Lessons (durable)

- **The correlated-subplan antipattern recurs — check EVERY layer of a tick, not the one named in the
  error.** The alert's CONTEXT named the resolver, and fixing it left the cron still failing. A wrapper
  that calls two functions needs both timed separately before you claim the fix.
- **A per-row API cannot be hoisted — that is when a functional index is the right answer.** Hoist when
  you control the query; index when the call is the interface.
- **⚠️ A partial index is only usable if the query's predicates IMPLY the index predicate.** Adding
  `AND name IS NOT NULL` to the index WHERE made it valid-but-never-used: the query never states it, and a
  non-STRICT plpgsql function gives the planner no way to infer it. Cost an unexplained "index built,
  nothing got faster" round.
- **`lcc_normalize_entity_name(text)` IS IMMUTABLE** (`pg_proc.provolatile='i'`) — a functional index on it
  is legal. The prompt's premise that it was not was wrong; check `provolatile`, don't assume.
- **Verify a prune by the row-count DELTA, never by its return value.** An MCP/client disconnect at 60 s
  rolls the whole function's transaction back, so a delta of 0 reads identically to "nothing to prune" —
  the candidate set had to be probed with a `LIMIT` to tell them apart. The honest verification path was
  to run both through **one-shot pg_cron jobs** (the real production path), then unschedule them.
- **`count(*)` over a scalar subquery optimizes the subquery away.** The first timing run showed the
  "old" correlated form at 2.3 ms — the planner had elided it. Force it with `count(<the column>)`.
- **Build a small index NON-concurrently.** A cancelled `CREATE INDEX CONCURRENTLY` leaves an INVALID
  index that must be dropped before retrying; at 43k rows the plain build takes seconds.

## 2026-08-20 overnight verification

- **Worker queue clean:** last 24h = `outlook.message.extract` 1,331 **done** (0 failed/stuck) + `cre.doc.text`
  13 done. Forward sweep + intake draining normally.
- **Intake stayed healthy post-fix (13h):** email channel finalized 7 / review 3 / discarded 7 / failed 1 —
  OMs finalizing normally, so the Select-bug fix holds. Last email intake 2026-08-20 11:26Z.
- **16 new health alerts (15h), none blocking, but note:** 11 `mailbox_mirror_parked` (the Processed-folder
  MOVER failing 5x on some just-intaken emails, e.g. the DS0PR05MB9718 OM thread — intake itself succeeded,
  only the tidy-up move parked); 2 `cron_failure` on **`lcc-owner-address-feed`** (failed 05:07Z — **fixed, see P118 above**); 1 `http_failure` no_response to `/api/link-propagation-tick` (transient); 1 `http_failure` **401 to
  `/api/daily-briefing`** (auth). Follow-ups: owner-address-feed cron + the briefing 401.
- **Git:** local repo has a stale lock (`.git/HEAD.lock` + `.git/objects/maintenance.lock` + tmp_obj\_\*)
  left by a sandbox commit racing Git's background `maintenance`. Sandbox can't unlink them (perms). Cleared
  locally by Scott; durable fix = `git maintenance unregister --force` + stop committing from the sandbox on
  this repo. Also uncommitted staged WIP present (CLAUDE.md + p143–p152 migrations + supersession-tie-lane
  doc) awaiting Scott's commit; push still blocked by the 475 MB .pst blob at f85b2c98 (history rewrite pending).

## Milestone 2026-08-19 — email capture end-to-end: forward sweep + contact-history pull live, v2 voice distilled, LCC Intake root-caused & fixed

**Session (Cowork) built and verified live:**

1. **LCC Intake folder "not processing" — ROOT-CAUSED & FIXED (highest impact).** Flagged OMs never reached
   `staged_intake_items`. Cause was NOT attachments (my first hypothesis, wrong): the `LCC Flagged Email
   Intake` flow had been enhanced (post-2026-08-11) to add `body_html` + `to/cc_recipients` via
   `Select`→`Join` actions that read `triggerOutputs()?['body/toRecipients']` as a Graph array — but the
   **`When an email is flagged (V3)` trigger returns To/Cc as semicolon STRINGS**, so `Select` errored every
   run (`'from' … is of type 'String'. The value must be an array`) and killed the flow before the intake
   POST. Fix: deleted the 4 Select/Join actions, repointed `to_recipients/cc_recipients` to the trigger
   strings directly, kept `Get_email_(V2)` (body_html) + the (correct) attachment loop. **Verified live:**
   the 337 E. Coronado Rd. OM finalized from its real 7.28 MB PDF; backlog drained; junk still discarded.
   Doc reconciled: `docs/architecture/flows/lcc-flagged-email-intake.md` (incident + live export
   `LCCFlaggedEmailIntake_20260819220833.zip`). **Recovery:** 4 real-attachment OMs discarded Aug 4–14
   (Oceanside CA, Scarborough ME GSA-DHS, two Aug-5 PDFs) — reflag to retry; the rest of the discards were
   correctly body-only junk.

2. **Forward-capture sweep LIVE.** New recurring PA flow (every 30 min): Graph `GET /me/messages`
   filtered `sentDateTime ge utcNow-2h and isDraft eq false`, per-message → bridge → worker drain. Spans
   Sent+Inbox; the 2h/30min trailing window self-heals gaps and the `internet_message_id` upsert makes
   overlaps free. Verified: 53 jobs/run all `done`, tracked bodies landing into timeline + corpus. Keeps
   the LCC current going forward (both tracking history AND voice).

3. **On-demand contact-history pull LIVE.** New instant PA flow: text input `emailAddress` → Graph
   `$search="participants:{addr}"` with `@odata.nextLink` paging → bridge → drain. Pulls a contact's FULL
   primary-mailbox history (all folders). Verified vs klargent@northmarq.com: 30+ bodies, dedup-safe.

4. **v2 voice distilled on-prem.** `voice-distill.mjs` ran on GaryBuilt (qwen2.5:14b), **760 usable
   Scott-authored** corpus, guards working (46,136 not-from-Scott, 76 app-briefings, 221 self-addressed all
   excluded); wrote `docs/os/voice/briggs-voice-attributes.json`. Per-context signal confirmed (internal
   terse/no-signoff; LOI formal/70% signoff; cold-BD long-form). ⏭ fold attributes into
   `BRIGGS-WRITING-VOICE.md` once the json syncs to the repo; Scott to read/approve before it's the default.

5. **Online Archive backfill PARKED (no IT).** The older SENT-mail voice history lives in the
   auto-expanding online archive, which no Outlook client route can reach (Copy/Move/Export-to-PST all see
   the primary mailbox only; Graph can't see the archive). Requires a Purview Content Search export (IT) —
   deferred per Scott. Primary-mailbox received history already back to 2022-11 (Inbox/Archive swept).

## Milestone 2026-08-18 — the voice profile is re-distilled on full bodies (Prompt 117), and three premises were wrong

**`BRIGGS-WRITING-VOICE.md` v2.0.0** — the sign-off / paragraph-shape / long-form sections that Stage 1
honestly marked LOW-confidence are now **counted off whole emails**, not inferred. Corpus basis, live
2026-08-18: **609 distinct Scott-authored messages after guards — 399 with a FULL body (2026-05-04 →
2026-08-17) + 210 preview-only openings (2022-11-14 → now)**; 129 long-form (≥400 chars), 55 ≥900.

**Three grounded corrections — each one would have quietly wrecked the result:**
1. **"7,851 Scott-authored sent full bodies" is not Scott's mail.** It counts `email_bodies` rows with
   `is_sent=true` that carry a body, but `is_sent` is unreliable on this store — its top senders are inbound
   newsletters (govtribe 1,346, seekingalpha 1,105, salesforce 1,773) and only **1** of the 654 Scott-from
   full bodies has it set. **Scott-from full bodies = 654 → 399 usable.**
2. **`from_email` is NOT authorship.** 118 of 654 are self-addressed — **74 are the app's OWN LCC Morning
   Briefing / Weekly Deep Dive** — and ~107 open by addressing Scott (inbound filed under his address).
   Un-guarded, the profile would have learned the briefing template and other people's voices, and
   draft-assist retrieval could have quoted the app's own briefing back at Scott as an exemplar of his
   voice. New `voiceCorpusExclusion()` gates both surfaces.
3. **The upgrade would have cancelled itself.** All 654 full bodies ALSO exist in `activity_events` as
   ~255-char previews, and BOTH corpus loaders deduped **preview-first** — so every full body would have
   been discarded as a duplicate and the re-distill would have re-learned the openings. Fixed:
   `email_bodies` is drained first in `voice-distill.mjs` and `api/draft-assist.js`.

**Cleaner verified on real full-body shapes.** 24% of full bodies carried NO text reply marker — Outlook's
quote boundary is a div attribute (`id="appendonsend"` / `divRplyFwdMsg`) that vanishes with the tags.
`htmlToText` now emits a sentinel there, min-lead-guarded so an empty div on a fresh compose can't empty the
body (52 emptied → 0). **Retention over the 654: raw body averages 7,537 chars → 1,303 kept (17.3%) — ~83%
of a typical full body is quoted chain + signature + disclaimer.**

**What the corpus actually says about his voice (new):** **86.7% of his emails have no sign-off at all**;
**"Best regards," is the ONLY closer he uses** (13.3%) and it is an EXTERNAL marker — 24.7% of external
follow-ups and 31.3% of LOI/offer threads vs **2.3%** internal; **"Thanks," never appears as a closing
line** (v1 guessed it did). LOI/offer upgrades **LOW → MEDIUM-HIGH** (83 full bodies); cold-BD is still thin
in count (18) but now full-length (median 2,640 chars); listing-announcement (n=1) stays flagged LOW.

**Code:** `voice-corpus-clean.js` (+`cleanEmailBodyDetailed` so the sign-off stays measurable after the
cleaner trims it, `voiceCorpusExclusion`, `bodyShape`, `redactExcerpt`); `voice-distill.mjs` extended with a
no-model deterministic layer (`--stats-only`), `--dry-run`, stratified length+recency sampling, a long-form
pass, and **mechanical verbatim enforcement** (an excerpt that is not a literal substring of the sample is
dropped, so a hallucinated example can't reach the committed profile); draft-assist `voice_confidence` now
reports per-draft FULL-BODY coverage from the retrieved exemplars' real lengths. Tests: 45 + 15 + 33 green.

**⏭ Scott's step (on-prem):** run `node scripts/voice-distill.mjs` on GaryBuilt with `OLLAMA_URL` set (it
refuses without it — the corpus never touches a cloud model), fold the qualitative attributes in, then read
v2 and answer: *does this sound like me now, sign-offs and all?* It should not be the default voice source
until you have.

## Milestone 2026-08-17 — voice corpus FILLING (24 → 654 full bodies); the `upsert_409` was an FK, not a conflict

**Prompt 116 closed the real, final blocker. `email_bodies` full bodies: 24 → 654** (all `body_format='html'`,
324–248,516 chars, verified `<html>…</html>` intact), `upsert_409` errors → 0, and the PA sweep has walked back
to **2026-05-03** and counting. The voice corpus is finally filling from Scott's real Sent history.

**The true root cause — my Prompt-116 premise was half wrong (it was NOT a merge-duplicates conflict):**
- `upsert_409` was a **foreign-key violation (SQLSTATE 23503)**, which PostgREST maps to HTTP 409 *identically*
  to a unique conflict (23505) — so the status code was unreadable. The live Postgres log named it:
  `violates foreign key constraint "email_bodies_source_user_id_fkey"`.
- `email_bodies.source_user_id` FKs `public.users(id)`. **The sweep sent the `lcc_users` id
  `1d3f7321-…` where the working forward path sends the `public.users` id `b0000000-…-0001`** — same person,
  disjoint id spaces (the exact P116 id-collision footgun in CLAUDE.md). Every one of the 10,510 bad-id jobs
  409'd; the 112,030 good-id jobs never did. **⚠ This traces to Cowork's own sweep walkthrough + the
  `OUTLOOK_BODY_SWEEP_FLOW.md` doc, which specified the `lcc_users` id in the `X-LCC-Source-User-Id` header.**
- Wider than reported: the same bad id was also silently killing `activity_events` timeline writes (423 FK
  rejections/24h, swallowed as best-effort). And the PA sweep was correct all along — the bodies were on disk.

**The fix (`api/_shared/source-user-id.js` — the P116 `resolveSourceUserId`):** normalizes ANY inbound id to a
real `public.users.id` (pass-through → `lcc_users` → email → `users` → null), wired into both handlers (also
covers `meetings.source_user_id` + `activity_events.actor_id`). An unresolvable id writes NULL into the nullable
provenance column rather than 409'ing the whole row — losing a mailbox stamp is recoverable, losing a 250 KB body
isn't. `body_persist_detail` now carries the DB's own code/message so the next 409 self-diagnoses. 11 new tests
(FK-first, merge-duplicates-when-asked, DO-UPDATE-payload-cols-only; mutation-checked). PR **#1758** (merged to
origin/main; migration `20260914120000` — retimestamped off a P118 collision).

**Live counts:** 654 = 465 blank rows filled + 165 rows the FK had blocked from existing + 24 from P115. Re-run
probe 0/0/0 (idempotent); 630 reversal rows.

**UPDATE 2026-08-18 — corpus filling fast post-redeploy:** handler fix confirmed live (new sweep jobs 0 × `upsert_409`).
Sent Items exhausted at 654 (folder only retains ~3.5 months, back to May 3 — older mail auto-archived). Pointed the
sweep at the primary-mailbox **Archive folder** (id `…ETAAA=`, 8,781 items) → **`email_bodies` full bodies 654 →
5,110 → 8,631** across resume runs, walking back to **2022-11-04**, zero 409s throughout. **Archive floor CONFIRMED
2026-08-18** (a resume from 2022-11-04 returned 0 older). **⚠ CORRECTION (Prompt 117 re-grounding): the 8,631 is
NOT 7,851 of Scott's sent mail — that was the unreliable `is_sent` flag** (its top "senders" are govtribe 1,346 /
seekingalpha 1,105 / salesforce 1,773; only ~1 of the Scott-from rows carries it). The **8,631 is mostly RECEIVED
correspondence** (the Archive is Scott's archived *inbound*, back to Nov 2022) — a real BROAD-corpus enrichment
(harvest / attribution / draft-assist context), but **not voice**. **Scott's actual SENT voice corpus = 644
full bodies, window 2026-05-03 → 08-17 (~3.5 months)** — verified `from_email ∈ {sabriggs,teambriggs}@northmarq`.
So the primary-mailbox VOICE corpus is still recent-only; **older sent mail lives in the Online Archive** (separate
mailbox, Graph `/me/mailFolders` can't reach it — the remaining voice-history source). The **Inbox sweep (42,644)**
serves the BROADER received-corpus goal Scott named ("all correspondence to enrich the LCC"), NOT voice.
**2026-08-18: Inbox sweep started (after an ASCII-in-URI fix — a non-breaking space from paste) → broad corpus
8,631 → 11,827 full bodies (+3,196 received), 0 409s. Inbox is 42,644 → needs resume-across-runs to finish.**
Voice distill v2 (PR #1760) merged; the on-prem `node scripts/voice-distill.mjs` run is Scott's step
(`--stats-only` first, then GaryBuilt with `OLLAMA_URL`).
Skip junk folders (Sync Issues 71,180, Deleted, Junk, RSS, Clutter).

**⚠ REMAINING STEPS (Scott):**
1. **Railway redeploy of merged main** — the DB backfill is live (hence 654), but the **handler fix isn't
   deployed yet**, so the ongoing sweep is STILL 409'ing new jobs. Redeploy makes it durable.
2. **After redeploy, keep the sweep running** — it walks back a chunk per run (currently at May 2026); re-run to
   continue toward the full ~23K. Newly-swept + any still-409'd jobs then fill in place (fill-blanks, idempotent).

**Doc correction:** `OUTLOOK_BODY_SWEEP_FLOW.md` `X-LCC-Source-User-Id` should be the `public.users` id
`b0000000-0000-0000-0000-000000000001` (the handler now normalizes either, but the doc's `lcc_users` id was the
trigger). 116 prompt/response filed to `done/`.

---

## Milestone 2026-08-15 — voice corpus body-capture PROVEN end-to-end (0 → 24 full bodies)

**Prompt 115 closed the last blocker on the voice corpus. Verified live: `email_bodies` rows with a >255-char
body went 0 → 24** (all `body_format='html'`, 5.7K–248K chars, full `<html>…</html>`). The whole chain is now
proven: Graph sweep → `/api/bridges?_route=ingest` → allowlist (`body` passes, Prompt 114) → queue → worker →
`handleOutlookMessageExtract` → `email_bodies` full body.

**The bug was handler-side, and 115 found THREE defects (two beyond the scoped one):**
1. **Brittle body split** — `bodyFmt === 'html'` dropped content on any casing/shape variance. Fixed: JSON.parse
   if `p.body` is a stringified JSON, lowercase/trim `contentType`, and **sniff HTML from content when
   contentType is missing** — non-empty content ALWAYS lands in `body_html`/`body_text` now.
2. **⚠ Corpus self-drain (the important catch):** the bodyless 5-min forward sweep was upserting explicit
   `body_*: null`, so a re-touch of an already-filled row **erased** its body (last-writer-wins). Fixed: body
   columns are now **omitted, not nulled**, when there's no content — a filled body survives a later bodyless
   touch; a fresh bodyless row still lands NULL by default (no fabrication).
3. **Silent write failure** — `opsQuery` returns `{ok:false}` (doesn't throw) and the handler ignored it, so a
   rejected write looked like a stored body. Now checked + logged as `result.body_persist_error` (+20s timeout);
   deliberately does NOT fail the job (a retry would double-count `total_emails_sent`).

**Backfill applied live** (migration `20260907120000`) — the 24 already-swept rows filled straight from their
stored `enrichment_jobs` payloads, idempotent + reversible, no re-sweep needed. (24 not 25: one swept message has
no tracked party, so the privacy gate correctly created no row — not a miss.) 12 new tests pass; the 6 full-suite
failures are pre-existing on main, unrelated. PR #1755 (handler fix on origin/main).

**Correction to the earlier diagnosis:** my "even the correct-shape payload stored nothing" read was two sweeps
confounded — the 18:41 object-shape sweep likely wrote fine; the 18:55 `setProperty` re-sweep (which dropped
contentType) then nulled the same rows. The `setProperty` flow tweak is unnecessary — the original flow shape was
correct; revert it.

**Two steps remain for the full corpus:**
1. **Railway redeploy of merged main** — the handler fix ships then (the backfill is data-layer, already live).
   Until redeploy, forward sweeps still hit the old handler.
2. **After redeploy, re-run the backward sweep** (`OUTLOOK_BODY_SWEEP_FLOW.md`) to fill the rest of the
   **23,169-row** corpus in place (merge-duplicates updates existing rows; the null-erasure guard makes repeated
   sweeps safe now).

Housekeeping: 115 prompt + response filed to `done/` (Claude Code noted it couldn't find a `done/` dir — it's
`docs/claude-code/prompts/done/`; filed manually).

---

## Post-redeploy status — 2026-08-16 (Cowork): handler fix LIVE, but corpus still 24 — sweep flow is body-broken

PR #1755 merged + redeployed (handler fix live). Corpus body count is **still 24**, and the job data (last 24h,
`outlook.message.extract`) explains it — it is NOT a handler regression:
- **19,184 jobs = the existing INBOUND bridge** (`from` = string, **no `body` in payload**). High-volume Inbox
  ingestion that carries no body → can't fill the corpus. (If inbound bodies are ever wanted, that flow needs the
  same `$select=body`; separate from the voice-corpus/sent goal.) Note the volume — ~19K/day; worth confirming
  it's not a runaway scheduled sweep.
- **50 jobs = Scott's sweep flow's `setProperty` runs** — **bodyless** (the `setProperty` tweak stripped the body).
- **25 jobs = Scott's ORIGINAL 18:41 run** — full bodies → these are the 24 that landed (24 not 25: one no-tracked-party).

**So to backfill the 23,578-row corpus, Scott's sweep flow needs TWO changes before re-running:**
1. **Revert the `setProperty` tweak** back to `"body": @{items('Apply_to_each')?['body']}` — the original shape
   carried the full body; the handler fix now persists it. (`setProperty` was never needed; it broke the body.)
2. **Add backward pagination** (OUTLOOK_BODY_SWEEP_FLOW.md Phase 2 / Part A backward pass) — the current flow has
   no `$filter`, so it only grabs the 25 most-recent Sent and re-running re-pulls the same 25. Cursor walk:
   `&$filter=sentDateTime lt @{variables('cursor')}`, `$top=25&$orderby=sentDateTime desc`, set `cursor`=oldest
   per page, stop on a short page.

With both in + the fix live, body-carrying jobs fill `email_bodies` in place; repeated sweeps are safe (the
null-erasure guard from 115). **Cowork can't trigger PA flows — Scott runs the sweep; Cowork watches the count.**

---

## Last night's runs — 2026-08-15 (Cowork review)

All live crons fired and produced; nothing red. Highlights:
- **Twin assist (106) — FIRST cron fired 05:46 UTC → 40 annotations.** The `property_twin` lane is now pre-ranked
  + sorted (deterministic merges bulk-confirmable, LLM residue scored). New capability live and working.
- **Reachability harvest — 12 open** proposals (04:40 UTC run; accruing after Scott worked the first batch).
- **W9.6 owner-attribution — 8 NEW open** proposals (05:05 UTC; lane refilled after Scott cleared the prior 22 —
  the `correspondence_entity_owner_llc` metric will keep climbing as these are worked).
- **Contact-acquisition — 1 open.**
- **Full-body corpus (`email_bodies`) — still 0 >255-char bodies, EXPECTED:** the Prompt-114 allowlist fix
  UNBLOCKS ingestion (`body` now allowed on `outlook.messages`, verified live) but the Graph body-sweep that
  actually re-pulls bodies isn't built yet (`docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` is Scott's PA build). Bodies
  start landing once that sweep runs.

**Open lanes for Scott right now:** twin assist (40, mostly one-click merges), W9.6 owner-attribution (8),
reachability (12), contact-acq (1) — plus the standing junk / naming / owner-reconcile / SF-assist lanes.

**⚠ Prompt-number collision (housekeeping):** parallel Claude Code streams both used **114** — `114-backward-body-capture-via-bridge.md`
(this voice-corpus task, = `done/114-voice-corpus-body-sweep.md`) and `114-review-lane-drain-and-c360-fold-in.md`
(a separate owner/lane task). **Next prompt should be 115+** to avoid further collision.

---

## Session 2026-08-17 (Cowork) — P116 reviewed + the redesign's manual checks CLOSED

### Prompt 116 = DONE (PR #1757), applied live — and it corrected me twice

**Result verified independently: brokerage-as-owner 46 → 5**, all `relationship_graph`;
`domain_true_owner` 4 → **0**; `supersession` held at **0**. The 5 remaining are exactly the deliberate
abstains. Assets with a resolved owner 2,294 → **2,275** — *down by design*, because 19 class-(b) owners were
removed and "Unresolved" is the honest state.

**My collision count was wrong, and the reason matters.** I measured collisions with an exact
lowercase compare and reported **17 colliding / 1 ambiguous**. 116 re-scored and found **21 colliding /
4 ambiguous** (BGC-Havasu, Century Park Partners, Mielkemark, MLC Ranch). More importantly it found that
`lcc_normalize_entity_name` — the obvious tool — **strips semantic tokens**, collapsing
`Century Park Partners` and `Century Park Properties LLC` to the same core. Using it would have re-pointed a
property onto **a different company**. It built `lcc_owner_strict_core()` (SQL mirror of the
regression-tested JS `strictOwnerCore`) and re-scored on an identity-safe basis. It also surfaced a third
abstain I never saw: `Michael Moore by Matthews™` is a **person** whose clean twin is an **organization** —
the person/org conflation. Final class (a): **16 repoint · 6 strip · 4 ambiguous · 1 type-shape.**

**My design reasoning was inverted on one point.** I wrote that renaming "makes the duplication invisible."
The opposite is true: `v_lcc_merge_candidates` groups on the *normalized name* needing ≥2 members, and
`"DP Brighton LLC by Marcus & Millichap"` normalizes to `dp brighton by marcus millichap` — which never
groups with `dp brighton`. **That is precisely why it has been invisible.** So renaming the loser is what
*surfaces* the pair to the existing detector; 15 of 16 now appear in the lane (4 already auto-mergeable),
and the 16th (the person) got a `person_duplicate_unmerged` lane rather than being left as silent residue.

It also caught something I had not considered: **`lcc_property_owner_evidence` must be re-pointed too**,
otherwise the next reconcile pass re-elects the duplicate and silently undoes the fix. Proven by re-running
the live feeder over all 41 touched assets: 22 kept the corrected owner, 19 returned `no_evidence`, and the
brokerage count stayed at 5 — **the Unit-4 guard on `relationship_graph` holds.**

**New backlog surfaced, not acted on:** 45 `guard_blocked_candidate` rows — pre-existing assets with
brokerage-named evidence and no resolved owner. Review view total 70.

### Manual checks CLOSED — all green (build `6efd9c27fcc7`)

M-1 ✅ · **M-2 ✅ divider splits, total conserved 720/620 → 920/420** · **M-3 ✅ owner docks beside the
property** · **M-4 ✅ swap exchanges primary/companion** · **M-5 ✅ tray chip carries the real subject name** ·
M-6 ✅ · **UI-4 ✅ fixed and verified live** (owner attached, CTA present, prospecting tier A).

Two caveats: M-2 was proven by driving the divider directly — a real pointer drag landed on the wrong strip
because of my screenshot-vs-CSS pixel conversion, so **pointer hit-targeting at the seam is worth one human
drag**. And I misread panel geometry three times by measuring during the slide-in animation; with the
wrong-query-shape and cold/warm errors that is **five measurement-condition mistakes**, now a standing rule.

### Revised plan

| # | Item | Note |
|---|---|---|
| 1 | **Side-by-side full detail** (Scott's ask) | The companion is still a summary card. Blocked on renderers writing to singleton `#detailBody`/`#detailTabs` — the real work is parameterising a mount root. **The last open item on the redesign itself.** |
| 2 | **UI-5** ladder shows the same name twice on the operator-elevation path | Small, cosmetic, well understood |
| 3 | 45 `guard_blocked_candidate` + 4 ambiguous + 1 person-dup | Human review lanes, surfaced and waiting |
| 4 | 15 merge candidates now visible in `v_lcc_merge_candidates` | 4 auto-mergeable |
| 5 | Perf remainder | Cross-region transport only — architectural, deliberately parked |

**Recommend next: the side-by-side panel** — it's the one thing Scott explicitly asked for that is still
outstanding, and everything else is now either verified, surfaced for human review, or parked with reasons.

## Session 2026-08-16b (Cowork) — brokerage-as-owner classified; the obvious fix was wrong

Branch **`claude/brokerage-owner-prompt-116`**. Analysis + prompt only — **no data changed**.

Exact split of the 46: **(a) 27 suffix-polluted** (`"<owner> by <brokerage>"` — owner correct, name carries
a CoStar artefact) · **(b) 19 rows / 7 distinct pure brokerages** (owner wrong): Marcus & Millichap,
Capital Pacific, Stan Johnson Co, Lee & Associates, NAI Pfefferle, Svn®, Trammell Crow Co (CBRE).

**⚠️ The obvious fix — strip the suffix — is wrong.** The dry-run produced 27 clean, plausible names, but
**17 of the 27 collide with an entity that already exists under the clean name** (`Mielkemark LLC` has
*two*). This is a **duplicate-entity problem, not a naming problem**: the CoStar capture minted
`"X LLC by Broker"` as a separate entity from the existing `"X LLC"`. Renaming in place would create two
identically-named entities — hiding the duplication and leaving the property pointed at the duplicate, with
its own split portfolio, cadence and contact history.

Corrected design is **prompt 116**: re-point the owner to the existing clean entity and file the polluted one
through the *existing* `lcc_merge_entity` path; abstain on the ambiguous 2-candidate case; strip in place only
where no clean twin exists; remove class (b) into a reversible ledger + review **view**; and — the durable
part — **add the brokerage guard to the `relationship_graph` feeder, which produced 42 of the 46** and will
otherwise re-create them. The supersession feeder already has that guard and produced **0**.

I stopped at the prompt rather than implementing: 17 of these need entity **merges**, which is the repo's
most safety-critical machinery, and I have been reminded three times this week that rushing here produces
wrong claims.

### ⚠️ Deploy mismatch — UI-4 is NOT live

The redeploy at `a4fc7beb0d79` contains the **docs** commit (`2bbd4e27`), not the UI-4 fix (`6f7ae2d7`).
Verified by fetching the served `detail.js` — the fix markers are absent. `claude/ui4-asset-lookup-by-id` is
still 1 ahead of main. **Manual checks M-2/3/4/5 remain blocked** until it merges.

Useful check before declaring a deploy done:
```powershell
git branch --no-merged main    # anything listed is NOT deployed
```

## Session 2026-08-16 (Cowork) — Prompt 115 reviewed + VERIFIED in the browser

**Prompt 115 = DONE** (PR #1756), migration `20260911120000_lcc_p115_bd_worklist_decorrelate.sql` already
applied live. It found **three** correlated subplans in `v_lcc_contact_writeback_candidates`, not the one I
diagnosed — each at `loops=1648`: `sf_account_id` (~1.9 s), `rank_value` (~20.5 s, 8.99 M buffer hits),
`rank_property_count` (~7.5 s). Decorrelated: **30,610 ms → 590 ms (51.9×)**, buffers 10.7 M → 232 k, zero
`loops=1648` nodes remaining.

Equivalence was checked properly: `EXCEPT` both directions **and** an md5-per-row multiset check (because
`EXCEPT` is set-wise and would hide a multiplicity change) — **0 rows differ**, 5,054 = 5,054. One semantic
change, `sf_account_id` from an arbitrary `LIMIT 1` to `min()`, was de-risked *before* the edit by
confirming **0 of 1,648 candidates map to more than one SF Account** — byte-identical today, deterministic
from here. It also measured the `ch` branch as instructed and **left it alone** (269 ms of the 30.6 s).

### The verification 115 couldn't do — I did it in the browser

115 was blocked from Railway by its sandbox proxy and explicitly asked that 51.9× be treated as a DB result
until confirmed. **Confirmed** (no redeploy needed — the view reads per request):

| Endpoint | Original | Pre-115 warm | Post-115 warm | |
|---|---|---|---|---|
| `bd_worklist&limit=5` | 8,192 ms | 8,171 ms | **2,485 ms** | **3.3×** ✔ |
| `decisions?summary=1` | 16,199 ms | 10,100 ms | **8,620 ms** | **−47%** ✔ |
| `priority-queue?limit=5` | — | 5,776 ms | 5,314 ms | flat |
| wall-clock to last API | — | 13,925 ms | **12,664 ms** | |

**⚠️ I nearly got this wrong a second time.** The *first* post-115 load read **8,178 ms** and I started
writing "P115 didn't translate" — that was a **cold** call; the next warm load was 2,485 ms. Same class of
error as §4.2d (measuring `LIMIT 5` instead of the handler's `LIMIT 150`): the number was real, the
condition was wrong. **Standing rule: label every timing cold/warm; never conclude from one sample.**

### Where `bd_worklist` time now lives — and it is not LCC

Isolated with the endpoint's own `?type=` filter, warm, twice each:
`suspected_sale` **1,847 ms** (gov, cross-region) · `ownership_chain` 674 · `contact_writeback` **600**
(the view 115 rewrote) · `owner_source_conflict` 504 · `loan_maturity` 249 · **all 1,870** (≈ the slowest,
as expected for a parallel fan-out).

**The LCC view is no longer the bottleneck.** The floor is `v_suspected_sale` on gov. Further work starts
there, not in LCC.

### Revised plan — perf thread is effectively closed

Remaining perf items are all **cross-region transport**, which is architectural (three Supabase projects in
three regions) and not worth chasing before the product work:
1. `decisions?summary=1` 8.6 s — the `count=exact` per federated lane in `fetchFederatedSource` is the last
   tractable term.
2. `priority-queue` 5.3 s — ~250 ms of DB; the rest is handler + transport. **115 correctly refused to
   invent a SQL fix here.**
3. `v_suspected_sale` (gov) — the new `bd_worklist` floor.

**Recommended next is product, not perf:** the **brokerage-as-owner cleanup** (46 rows, two classes,
detector already built) and the **outstanding manual checks** M-2/3/4/5 on the panel divider.

## Session 2026-08-15i (Cowork) — BROWSER re-measure, and a retraction

Driven directly in Scott's browser (Claude-in-Chrome) against merged build `41e03651a6b9`, two consecutive
loads to separate cold-start. Full detail: `panel-redesign-verification.md` §4.2d.

| Endpoint | Original | Warm now | |
|---|---|---|---|
| `decisions?summary=1` | 16,199 ms | **10,100 ms** | **−38%** ✔ |
| `bd_worklist&limit=5` | 8,192 ms | **8,171 ms** | ❌ **no change** |
| `priority-queue?limit=5` | not captured | **5,776 ms** | ⚠ new |
| wall-clock to last API | — | 13.9 s | |

### ⚠️ Retraction — my "bd_worklist 4.2× faster" claim does not apply

I measured `v_lcc_bd_worklist` at `LIMIT 5` **with no ORDER BY**, which short-circuits after five rows. The
handler runs `ORDER BY rank_value DESC LIMIT 150`, and an ORDER BY materialises the **whole view**:

| shape | execution |
|---|---|
| `LIMIT 5`, no ORDER BY *(what I measured)* | 321 ms |
| `ORDER BY … LIMIT 25` | **18,561 ms** |
| `ORDER BY … LIMIT 150` *(the handler)* | **19,320 ms** |

**The limit is irrelevant** — so the fix I was about to ship (shrink the handler's `CAP` 150 → ~3× limit)
would have done nothing. That would have been my third wrong claim on this endpoint; measuring first is the
only reason it didn't ship.

**Real cause, now precisely located:** `SubPlan 2` is a correlated aggregate running **1,648 times** — once
per candidate person — each re-aggregating ~3,681 organizations *and* linearly re-filtering the entire
15,981-row `owner_link` CTE (`Rows Removed by Filter: 15981`, per loop). The index + ANALYZE were correct
and durable (they fixed the CTE seq scan and the planner estimates) but cannot fix a per-row correlated
subquery. That needs a **view rewrite** → **prompt 115**, written and grounded in the plan output. Not
attempted here: it changes a shared BD surface (home rail, My Day, worklist) and deserves its own dry-run
rather than being bolted onto a pass I have already been wrong about twice.

**Honest scoreboard:** `decisions?summary=1` genuinely improved by 6.1s. The stats/index work is correct but
did not move the endpoint it was aimed at. `bd_worklist` and `priority-queue` remain open and are now
diagnosed rather than guessed at.

## Session 2026-08-15h (Cowork) — Marketing: 12 sequential round-trips → throttled-parallel

Branch **`claude/marketing-throttled-pager`**. Frontend only — ships on the next Railway redeploy.

**Two of my own assumptions were wrong, and checking them changed the fix:**
1. *"`select=*` is wasteful."* It isn't — `v_opportunity_domain_classified` is a **matview with 21 columns
   and the mapper reads 19**. A hand-written column list would save ~2 fields and add drift risk against a
   matview. Left as `*`.
2. *"Just parallelise the pages."* **That was shipped and rolled back twice** — QA-27 on dia, QA-33 on gov —
   because N concurrent page requests overwhelm Vercel/Supabase/browser when dashboards stack pagers in a
   `Promise.all`. R2-W-6 reverted dia to serial and wrote the correct answer in the comment:
   *"A throttled-parallel approach (concurrency=4) is the better long-term fix; deferred for both gov + dia."*

**So I built the deferred fix at exactly that concurrency**, rather than repeating the reverted one:
`diaQueryAllThrottled(table, select, params, concurrency = 4)` in `dialysis.js`. Page 0 is fetched with
`includeCount` to plan the rest; results land in a positional array so output order matches the serial
version regardless of completion order; the 2-minute fuse is preserved; **no usable count ⇒ falls back to
the proven serial `diaQueryAll` rather than guessing a page count and silently truncating.**

Marketing's hand-rolled 15-page sequential loop now calls it. **12 sequential round-trips → 3 waves of 4.**
The deferred-retry path stays serial on purpose — it only fires when the first attempt returned zero, and
parallelising a retry after a failure turns a blip into an outage.

Tests: new `test/dia-throttled-pager.test.mjs` (9). The load-bearing ones assert the **concurrency cap
holds at 50 pages** — a future "simplification" to `Promise.all(pages.map(…))` is exactly the twice-reverted
regression, so it now fails loudly. **70 pass** across the three perf/UI suites.

## Session 2026-08-15g (Cowork) — decisions?summary=1: stop paging history for badges

Branch **`claude/decisions-summary-perf`** (`6cf0c443`) · migration
`20260910120000_lcc_decision_excluded_counts.sql` **applied live**.

**Two hypotheses disproved before changing anything** (recorded so nobody re-tests them): it was **not the
SQL** (`v_lcc_decision_open_counts` runs in **85ms**) and **not sequential federation** (`admin.js:8453`
already uses `Promise.all`).

**The actual cost:** summary mode called `fetchExcludedRefs(type)` **once per federated lane**. That function
pages every non-open `subject_ref` for the type in **1000-row sequential pages** and materialises them into a
Set — purely so the caller can read `.size`. Roughly **18 sequential cross-region round-trips to produce 17
integers** (LCC Opps us-east-1, dia us-west-1, gov us-west-2). Summary now reads them all in **one query**
from `v_lcc_decision_excluded_counts`.

**`count(DISTINCT subject_ref)`, not `count(*)`** — `fetchExcludedRefs` builds a *Set*, so `.size` is a
distinct count. `match_disambiguation` has **1,231 decided rows but only 1,044 distinct refs**; a plain
`count(*)` would have under-reported that badge by 187 and every other duplicated lane likewise. Verified
equivalent across all 16 live decision types — **zero mismatches**.

**Fails safe:** if the view read fails (missing view/grant) the code falls back to the paged Set rather than
defaulting the exclusion to 0, which would silently *overstate* every federated badge. The LIST branch is
unchanged — it needs the actual refs, not the size.

Tests: new `test/decisions-summary-perf.test.mjs` (5). One failed first time by matching the code **comment**
that names `fetchExcludedRefs` — the same trap as `panel-redesign.test.mjs`, so it now strips comments before
asserting. **61 pass** across both suites.

### Remaining perf work
1. **Marketing 11,831-row / 12-round-trip pull** — `select=*`, sequential pages, whole table fetched to
   compute mostly counts and one filtered page.
2. **`count=exact` elsewhere** — `fetchFederatedSource` still does one exact count per lane
   (`admin.js:7267`), and `admin.js:566`/`domCount` do `select=*&limit=1` with `count=exact` purely for
   badge numbers. Now the dominant remaining term; measure per-lane before changing.
3. **Cross-region latency** — three Supabase projects in three regions; every federated lane is a
   cross-country round trip. Architectural, not a quick fix.

## Session 2026-08-15f (Cowork) — page-load performance: stale stats + a missing index

Migration `20260909120000_lcc_perf_stats_and_rel_type_index.sql`, applied live.
Triggered by Scott's console capture, which showed a worse daily problem than the panel defects:
`bd_worklist&limit=5` **8,192ms for five rows**, `decisions?summary=1` **16,199ms**, Marketing pulling
**11,831 rows in 12 round-trips** on load.

**Root cause 1 — `entity_relationships` statistics were 26 days stale.** 114,145 rows, last analyzed
2026-07-21, 8,882 modifications since. Autoanalyze fires at 10% of the table (~11,464 rows here), so it sat
under the threshold and drifted for a month. The planner then estimated **2,261 rows where 5 were returned**
and chose plans whose correlated subplans re-scanned **~42,000 organizations per output row**. Fixed at
source by lowering the scale factor — the repo already does this for ~20 smaller tables; the two biggest and
hottest had been missed.

**Root cause 2 — no index on `entity_relationships.relationship_type`.** The bd_worklist CTE seq-scanned
114,145 rows for the 15,981 `associated_with` edges, then re-filtered that CTE once per output row. Indexes
existed on `from_entity_id`/`to_entity_id` only.

| `v_lcc_bd_worklist LIMIT 5` (warm) | before | after |
|---|---|---|
| Planning | 145.3 ms | **15.3 ms** |
| Execution | 1,334.1 ms | **321.3 ms** |
| CTE `owner_link` | Seq Scan, 71 ms | **Index Only Scan, 21 ms** |

Scott's 8,192ms was a cold cache; both changes cut buffer reads as well as CPU, so the cold path benefits
too — but the honest claim is the **warm 4.2×**. Re-measure from the browser for the real number.

**A hypothesis I disproved, recorded so nobody re-tests it:** I assumed `decisions?summary=1` was slow
because the federated lanes ran sequentially. They don't — `api/admin.js:8453` already uses `Promise.all`,
and the underlying `v_lcc_decision_open_counts` runs in **85ms**. The remaining leads are **cross-region
latency** (LCC Opps us-east-1, dia us-west-1, gov us-west-2 — every lane is a cross-country round trip) and
**`Prefer: count=exact`**, which forces a full scan purely to produce a badge number (`admin.js:566` does
`select=*&limit=1` with count=exact). A lane badge needs an honest order of magnitude, not an exact count.

**Also open:** Marketing's 11,831-row / 12-round-trip pull — `select=*`, sequential pages, whole table
fetched to compute what is mostly counts and one filtered page.

### ⚠️ Note on the divider retest
Scott retested the drag on build `5dedbb9f2026`, which is **before** the divider fix (`d4bf43cd`,
branch `claude/panel-divider-split`, unmerged). The geometry was unchanged because that build still has the
74px-travel clamp. Merge + redeploy before retesting.

## Session 2026-08-15e (Cowork) — P112 A2 enrolment + the four sweeps nobody scheduled

Migration `20260908120000_lcc_p112_a2_enrol_and_schedule.sql`, applied live, batch `a2_enrol_20260815`.
Write-up: `connectivity-and-open-threads.md` §4d.

**The bigger gap, found on the way in: NONE of the P112 sweeps were scheduled.** 112's write-up flagged only
`resume`; in fact **no cron referenced any P112 function** — retire, resume and stamp were built, verified,
and never ran again, so the consumption loop the prompt existed to close had not closed. Now scheduled
06:20–06:35 daily in dependency order **retire → resume → enrol → stamp** (jobids 226–229). All four
dry-ran to **0** first, so this is maintenance, not a pending bulk change.

**A2 — my raw count overstated it a fourth time.** 1,420 owners → 110 reachable → 99 with no active cadence
(*the number I quoted*) → **44 pass the same gate the retire sweep uses**, measured via the **canonical
`lcc_entity_cadence_reachable()`** rather than my ad-hoc query — which is precisely why my number kept
disagreeing. **41 enrolled**; the other ~58 fail the value gate and are **correctly excluded, not a gap**.
Active surface 278 → **319**. Re-run enrols 0.

### ⚠️ NEW UNIT (not fixed) — brokerages recorded as property owners, 46 rows

The first dry-run put **Marcus & Millichap** ($4.99M) at the top of the enrolment list — one step from
cold-prospecting a competitor's brokerage as a landlord. 42 rows from `relationship_graph`, 4 from
`domain_true_owner`, **0 from `supersession`** (the guard I added yesterday held). Two classes:
**(a) ~35 suffix-polluted** (`DP Brighton LLC by Marcus & Millichap`) — owner correct, name carries the
CoStar `by <broker>` suffix that `detail.js` only strips *on render*, so the pollution rides into exports,
comps and dedupe; **(b) ~11 pure brokerages** — owner wrong. `lcc_owner_name_is_brokerage()` is the
ready-made detector. **This is the next data unit.**

### Revised plan

1. **Brokerage-as-owner cleanup** (46 rows, two classes) — highest-value data unit; the detector exists.
2. **UI-0** — the uncaught JS error on the Ownership tab. Still needs one console line from Scott
   (diagnostic in `panel-redesign-verification.md` §4.3); it is the only HIGH I cannot close blind.
3. **Re-run manual checks M-2/3/4/5** — the UI-1/2/3 fixes are now merged and deployed but unverified.
4. **Side-by-side panels** — blocked on renderers writing to singleton `#detailBody`/`#detailTabs`.
5. **34 assets with a NULL `domain`** — silently excluded from every coverage rollup.
6. **Supersession review view** — 323 assets awaiting human verdicts (236 ties · 59 person · 18 brokerage).

## Session 2026-08-15d (Cowork) — SUPERSESSION tier shipped: owner resolution 49.2% → 59.0%

Branch **`claude/owner-supersession-tier`** · migration `20260907120000_lcc_owner_supersession_tier.sql` ·
**applied live**, batch `supersede_20260815`. Full write-up: `connectivity-and-open-threads.md` §4c.

**The defect.** `lcc_reconcile_property_owner` sets `confidence = top_score / SUM(all scores)` — the
winner's **share of the vote** — with recency decay floored at 0.25, so a 20-year-old transaction never
stops voting. Ownership is a **chain with a most-recent link**, not an election. Live: **741** assets had
evidence and no owner; **all 741 multi-candidate, NOT ONE passed the 0.55 gate** (avg share 0.407). More
evidence makes it *worse*. **295** already carried a curated `domain_true_owner` and still lost.

**Two guards the live dry-run forced — the design changed because of the data:**
1. **Brokerages were about to be written as property owners** — `Matthews™`, `Colliers`,
   `Coldwell Banker Commercial®`, `PeerRealty`: the broker on the transaction modelled as the purchaser.
   `entity_type` said `organization` for every one, so the shape guard could not catch it; only sampling
   the **names** did.
2. **An operator leaked** ("Satellite Dialysis") — root cause a **flag-coverage gap at source**:
   "Satellite Healthcare" (56 properties) was already flagged `is_operator_not_owner`, its sibling rows for
   the same operator were NULL. Fixed in dia and propagated **by ID**, per CLAUDE.md's "use the existing
   flag, never write a second name-based operator test."

| | Before | After |
|---|---|---|
| assets with a resolved owner | 1,910 (49.2%) | **2,294 (59.0%)** |
| owner entities | 1,118 | **1,420** |
| `reachable_hero_effective` | 228 | **262** |

418 written · ledger reconciles exactly · **re-run resolves 0** · reversible by batch tag.
**323 assets to `v_lcc_owner_supersession_review`** (236 ties · 59 person · 18 brokerage · 10 no-org-marker)
— a **VIEW, not a table**, so it self-drains and cannot become another un-consumed producer (Prompt 114's
lesson).

**New hygiene finding:** assets rose 384 while 418 rows were written — the other **34 targets are
`entity_type='asset'` with a NULL `domain`**, so every `domain in ('dia','gov')` rollup silently
under-reports them.

**Still true:** resolving an owner does not make them reachable. The *share* stays ~20% because each
resolved asset adds owners to the denominator — quote the absolute count. **~478 owners remain solvable
only via the paused SOS-direct path.**

### ⚠️ TWO branches to merge, in this order — `main` has NEITHER

```powershell
git checkout main
git merge claude/panel-ui-defects-manual-run   # UI-1/2/3 + the entityLink apostrophe fix
git merge claude/owner-supersession-tier       # this session's data work + docs
git push origin main
```

A sandbox `git merge` could not run (VS Code holds `index.lock` continuously). Any conflict will be
additive text in `STATUS.md` / `panel-redesign-verification.md` — keep both sides.

## Session 2026-08-15 — Prompt 114 (voice corpus): the bridge fills `email_bodies`, and its allowlist was stripping `body`

**Root-caused why the voice corpus (`email_bodies`) has 23,169 rows ALL with empty body**, and fixed it.

- **`email_bodies` is written by EXACTLY ONE path** — the bridge handler
  `handleOutlookMessageExtract` (`api/_shared/bridge-handlers-outlook.js`), reached via
  `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages` → worker drain. It reads the
  FULL Graph body (`p.body.content`) and upserts on `(workspace_id, internet_message_id)` with
  merge-duplicates (so a backward re-sweep fills existing empty-body rows). **This SUPERSEDES the Prompt-110
  assumption that `/api/intake?_route=outlook-message`/`outlook-sent` feed the corpus — they don't**
  (`intake.js` writes body to `staged_intake_items`/`activity_events`, never `email_bodies`; confirmed —
  `intake.js` is not among the `email_bodies` writers).
- **THE BLOCKER (found via the "verify contract live first" house rule):** the ingest receiver strips any
  field not on the bridge's per-object allowlist (`applyAllowlist`) BEFORE enqueue. The `outlook.messages`
  `Message` allowlist did **not** include `body`, so the full body was dropped at ingest and every row landed
  `body_text = body_html = NULL`. A sweep would have "succeeded" green while filling nothing.
- **Fixed:** migration `supabase/migrations/20260905120000_lcc_p114_outlook_body_allowlist.sql` adds `body`
  to that allowlist (**applied live** to LCC Opps — config is live-immediately, no deploy). Reversible.
- **Scope decision surfaced (Part 1):** the handler's tracked-contact gate means the corpus = deal/BD-relevant
  mail (recommended Option A, no writer change). Tracked-vs-untracked split can't be measured from LCC data
  (untracked traffic is never stored) — needs a mailbox-side count. `email_bodies.is_sent` is a weak heuristic
  (from-not-tracked), NOT "Scott sent it"; the reader correctly gates on `from ∈ SCOTT_FROM`.
- **Readers confirmed (Part 3):** `draft-assist.js::loadCorpus` + `voice-corpus-clean.js::pickBestBody` already
  read `body_text`/`body_html` (fallback → `body_preview`), gated on presence not length — no reader change.
- **Deliverable:** `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` — the backward+forward Graph→bridge sweep,
  copy-paste (full-`body` `$select`, `X-LCC-Source-User-Id` = Scott's `lcc_user_id`, `records[]` array,
  high-water-mark backward bound, worker drain). The Graph sweep is Scott's PA build; the live
  POST-through-endpoint + worker-drain is the operator step (the ingest blocker that would have made it
  silently no-op is now removed).

## Session 2026-08-15 (Cowork) — property + owner panel redesign (IA + panel shell)

Spec: **`docs/architecture/property-owner-panel-redesign-2026-08.md`** (normative target state; supersedes the
open P1.5 / P1.6 / P3.3 items in `property-tab-ux-review.md` + `contact-owner-sidebar-design.md`).
Trigger: Scott's walkthrough opening a true owner (Rem Management) from a dia comp — owner-CRM content on a
property tab, one owner name rendered four times, tab bar wrapping, no way to widen/move/park a panel.

**Placement rule adopted:** the property panel answers *what is this asset and what is it worth*; the owner
panel answers *who controls it and what do I do about them*. The owning panel renders the interactive version;
the other renders a read-only one-liner that links across.

**Shipped (frontend only — no DB, no API; ships on the next Railway redeploy of merged `main`):**
- **Panel shell.** Widths are now CSS vars `--panel-primary-w` (520→**720**) / `--panel-companion-w` (480→**620**)
  so `.companion-panel` + the resizer strips track the primary (they were hard-coded `right:520px` in three
  places — the reason the primary was never widened). Added drag-to-resize with persisted width
  (`lcc.panelw.*`, double-click resets), a **⇄ swap** control in both headers (promote the companion into the
  wide slot), and a **minimize tray** holding any number of parked panels — replacing the single vertical
  restore tab that was hard-coded to the label "Property" even when it held an owner.
  `DUAL_DOCK_MIN_WIDTH` 980→1180. At 720px the 7 property tabs fit one row.
- **Property `Ownership & CRM` → `Ownership`.** Removed from the tab: Ownership Assistant, contact roster +
  contact-edit inputs, Recent Touchpoints, Salesforce Activity Feed, Log Call/Activity form, Draft Email engine,
  per-row CRM-coverage bar, per-row "Sync & Begin Prospecting". Every destination already existed on the owner
  panel, so this was a deletion + a hand-off, not new construction. Added **`Work this owner →`** (hero on the
  Current Owner card + footer repeat) as the seam between the property ladder and the owner ladder.
  Also: `Log Touchpoint` dropped from Overview Actions (a touchpoint is logged against a party, not a building);
  Research Notes relocated to Overview › AI Research; completeness rail capped 6→4 chips (it wrapped to two rows
  and pushed the Next-step card off screen); owner-ladder collapses to ONE card when recorded == true owner.
- **Owner panel:** rail chip pointed at the dead tab name `Portfolio` → `Ownership`; Deal tab's Property
  Reference no longer repeats the Property tab's tenant/guarantor/term/SF snapshot.

**Review-caught defects fixed before hand-off (a verification agent read the whole diff):**
1. **`_udSaveOwnership` would have nulled `true_owners.contact_1_name` on every save** once the contact inputs
   were removed (`contactName` read null, payload still sent the key). Now gated on `_contactFormPresent` and
   the key is OMITTED when the form isn't rendered — never-clobber doctrine.
2. `_udWorkOwnerCta` double-escaped the owner name (`esc()` then `.replace(/'/…)` matches nothing), producing a
   broken `onclick` for any name with an apostrophe. Both it and the older "research owner →" link now use an
   `encodeURIComponent`/`decodeURIComponent` round-trip.
3. Tray de-dupe signature ignored the companion descriptor's `propertyId`, collapsing every dock-parked property
   to one chip. 4. Swap/restore lost the property summary (dock rendered "(property)"). 5. Tray restore routed on
   a never-cleared `_activePrimaryKind`, which could dock a lone companion with no primary beside it.
   6. Cache-busters bumped on `app.js`/`detail.js`/`ops.js` + added to `styles.css` (a half-cached client would
   have had the new CSS hiding the old restore tab = un-recoverable minimize). 7. Resizer strips moved INSIDE
   their panel's left edge so they stop covering the neighbouring panel's scrollbar. 8. Width clamps are now
   viewport-aware (independent 1100+900 maxima could push the companion off-screen on a smaller monitor).
   9. `_ownerDrawerBeginProspecting` scrolled to the deleted `#udLogCallForm`; now opens the owner panel.
   10. Owner-name normalizer could report false agreement on an empty residue; requires ≥4 chars.
   Also removed a pre-existing stray `</div>` in the Current Ownership section.

**Verified:** `node --check` on detail.js / app.js / ops.js; `node --test test/w3-6-comp-lane-clarity.test.mjs
test/cm-native-chart-injector.test.mjs` → 221 pass / 0 fail; div-balance check on every touched renderer
(`_udTabOwnership`, `_udOwnershipLadder` both branches, `_udCurrentOwnerCard`, `_udOwnerHandoffCard`,
`_udResearchNotesSection`, `_udWorkOwnerCta`) → balanced; orphaned handlers (`_loadTouchpoints`,
`_loadActivityFeed`, `_loadEmailTemplates`, `_udSubmitLogCall`, `_udGenerateDraft`, `_udOwnerBeginProspecting`)
confirmed DOM-guarded so they no-op rather than throw.

**Follow-ons (deliberately not built):** free-floating draggable windows with a window manager (validate the
docked-resize model in use first); relocating `Diligence & Vendors` off the owner Deal tab to property Documents;
deleting the now-unreachable CRM handlers once Scott confirms the move; the lease-dedupe / cap-recompute data
work (Findings B/C) is unchanged and still open.

### Verification pass (same session) — `docs/architecture/panel-redesign-verification.md`

Standing rule adopted: **no design item is done until it has a row in the evidence matrix with a check
someone else could run.** New suite `test/panel-redesign.test.mjs` — **47/47 pass** (behavioural: the new
pure functions sliced out of the live `detail.js`; structural: assertions that the CRM surfaces really left
the property tab, that widths are var-driven, that cache busters move together).

**Two live defects were caught by the first test run, after a full review had passed them:**
- **The viewport width clamp did not work.** Each panel was clamped against the *other panel's minimum*, so
  on a 1400px screen primary→920 and companion→860 were each "valid" while totalling 1780. Now budgets
  against the other panel's *actual* width.
- **The apostrophe fix was still broken.** `encodeURIComponent` does NOT escape `'` — `O'Brien Holdings LLC`
  still emitted a raw quote and the `onclick` was still a SyntaxError. New `_jsStrArg()` percent-escapes
  `'` and `"` explicitly; the test now *parses and invokes* the emitted handler rather than pattern-matching it.

**Live data audit (LCC Opps, read-only) — the chain the layout drives:**
assets 3,886 → **1,396 (35.9%) with a resolved owner** → 690 owner entities → **104 (15.1%) reachable by any
route** (50 via the org record + 60 via a linked person) → 134 on cadence, **all 134 overdue**.
- **The binding constraint is contact reachability, not UI.** The `Work this owner →` hand-off resolves to
  *"Find a contact"* for ~85% of owners, and that chain is paused / CI-blocked. The redesign did not create
  the gap — it stopped hiding it (the old property-tab Log Call form let you log activity against an owner
  you had no way to contact).
- **Cadence is a producer with almost no consumer:** of 1,905 rows, **1,728 (91%) have never been touched**,
  only **23** are due in the future, only **7** carry a rep, oldest overdue **2021-09-06**. Textbook
  Consumption-Layer failure; flagged, not fixed here.
- **Data-quality defect surfaced:** 3 cadence rows carry `last_touch_at` in the FUTURE (max 2026-10-15) — a
  writer is stamping a scheduled date into the completed-touch column.

## Session 2026-08-15c (Cowork) — prompts 111–114 ALL DONE + merged; plan revised

PRs **#1750 / #1751 / #1753 / #1754** merged to `main` (`e7999e79`). Prompts + responses archived to
`docs/claude-code/prompts/done/` and `responses/done/`. Consolidated end-state:
`docs/architecture/panel-redesign-verification.md` **§3.0**.

| Leg | Start of day | Now |
|---|---|---|
| assets with a resolved owner | 1,396 (35.9%) | **1,910 (49.2%)** |
| distinct owner entities | 690 | **1,118** |
| `reachable_hero_effective` | 56 (8.1%) | **228 (20.4%)** |
| reachable-in-data / invisible-in-UI | 47 | **0** ✅ |
| cadence active surface (nothing deleted) | 1,214 | **278** (1,627 reversibly paused) |
| cadence rows with a rep | 7 | **37** |
| `last_touch_at` in the future | 3 | **0** ✅ |

**Each prompt overturned its own brief's premise — that is the useful part:**
- **111** — the gap is *decision-maker discovery*, not contact enrichment (585 of 586 unreachable owners had
  no person known). My "1,469 gov manager names" headline sat almost entirely off this population (22 gain a
  name, **0** gain a contact). The pipe wasn't broken, it was **aimed elsewhere**.
- **114** — the review lane was **not** 101 decision-makers: 22 person-shaped, **77 organization-shaped**
  (mostly transaction counterparties captured by the CoStar sidebar), 2 blocked. **A single "confirm" button
  would have written the wrong shape for most of the backlog.** Three shape-aware verdicts instead.
- **112** — the cause was **not** a bulk stamp or a missing consumer. R63's `bdSignalFromFacts` accepted a
  **bare Salesforce identity** as a BD signal; that one arm carried **930 of 1,113** prospecting cadences
  (897 never touched, **0** with an open opportunity). The $500k floor was short-circuited before it was ever
  consulted. SF is a capture surface, so the gate was admitting the whole SF contact book.
- **113** — P0.2 own-deal buyer **skipped as data-thin** (17 assets, below the brief's own 50 floor); P0.3 was
  promotion not capture (1,699 assets had an owner never promoted). **The operator guard blocked MORE than
  the feeder promoted** — dia files the tenant in the owner slot on 7,926 of 11,783 properties.

**My published numbers were wrong three times** (§3.0.1): the 104-reachable baseline, the "94 unreachable on
cadence" figure (does not reproduce), and "the rep backfill is a dead end" (it wasn't — 30 resolvable).
**Rule adopted: quote `v_lcc_owner_reachability.reachable_hero_effective` and the canonical predicates —
never hand-roll a reachability query.**

### Still open after 111–114

| # | Item | Size / note |
|---|---|---|
| **UI-0** | Uncaught JS error on the property Ownership tab | **HIGH** — needs one console line; diagnostic in verification §4.3 |
| **UI-1/2/3** | Resize doesn't drag · owner chip only sometimes docks · swap does nothing | manual run 2026-08-15 |
| **SxS** | Full detail side-by-side (Scott) — blocked on renderers writing to singleton `#detailBody`/`#detailTabs` | spec §1.2 superseded; consequences in verification §4.2 |
| **112 A2** | **89 reachable owners have NO active cadence** — never built; grew 65 → 89 with the owner population | the only item that *adds* pipeline |
| **112** | `lcc_p112_resume_workable_cadences` built but **not scheduled** | one cron line; closes the auto-resolve loop |
| **112** | 68 cadence rows overdue > 1 yr on stale date arithmetic | re-baselining question, flagged not fixed |
| **113** | **Resolver supersession tier — sized at +465 assets, not built.** `lcc_reconcile_property_owner` sums evidence with decay floored at 0.25, so a thrice-sold building reads as three competing claims (conf 0.33–0.50). **876 assets have evidence but fail the 0.55 gate — the next lever is the resolver, not another feeder.** | awaiting go-ahead |
| **114** | 84 lane rows awaiting human verdicts (forecast 64 reject · 11 same_party · 8 attach · 18 no lean) | needs a human, by design |
| — | Railway redeploy for all merged JS halves, then `npm run verify:deploy` | DB halves already live |
| — | ~250 stale local branches at 0 commits ahead of main | housekeeping |

**Recommended next:** UI-0 → UI-1/2/3 → 112 A2 + the resume cron (small, adds pipeline) → 113 resolver
supersession (+465, biggest remaining data win) → side-by-side.

## Session 2026-08-15b (Cowork) — reviewed the 111 response + Scott's manual-check run

**Prompt 111 = DONE** (PR #1750, branch `claude/owner-reachability-gap-904h3v`, migration already applied
live). **Manual checks M-1…M-12 = partially run**, evidence in `responses/manual checks.docx`.

### 111 corrected this project's own headline number
The "104 of 690 reachable" baseline **I wrote** counted any graph route, but `buildContact360` never walks
`entity_relationships` — so 60 of those owners still saw *"Find a contact"*. **Hero-true was 56 (8.1%).**
Both definitions are now columns on `v_lcc_owner_reachability`; **quote `reachable_hero`**. Recorded as V-3
in the verification doc, with the lesson: *measure the number the operator experiences, not the one the
schema permits.*

111 also caught (V-4) that reusing `dup-pair-planner.ownerCore` for identity made `Realty Income Corporation`
fail to match itself, and scored `Agree Realty Corp` vs `Agree Holdings LLC` at **1.0** — a would-be
automatic write onto the **wrong owner**, caught only by a live dry-run. Now a `CLAUDE.md` footgun.

**Result:** `reachable_hero` **56 → 92 of 690** (batch `ocp_20260815`, 39 fields / 36 owners, ledgered +
idempotent). Lead sizes measured: A (gov `manager_name`) 22 gain a name / **0 gain a contact** — my prompt's
1,469 headline sat almost entirely off this population; B (Salesforce) 19; C (contacts we already hold) 74,
36 auto-safe → built; **D (only via the paused SOS path) ~478 = 82%** — the measured cost of that flag.
The pipe wasn't broken, it was **aimed elsewhere**: `owner_contact_pivot` has 5,159 rows but intersects the
panel's owner graph on 48 of 586.

### Manual run: the IA landed, the panel-shell interactions did not
✅ 720px panel · 7 tabs on one row · 4-chip rail · CRM stack gone from the Ownership tab · ladder collapsed to
ONE card for Rem Management (was 4) · `Work this owner →` renders · Resolve Data Gaps 4→1 · Log Touchpoint
gone from Overview.
❌ **UI-1** resize does not drag · **UI-2** owner chip only sometimes opens the dock · **UI-3** swap does
nothing · **UI-0 (HIGH)** an *uncaught JS error* fires on the Ownership tab — that toast is `index.html`'s
global `onerror` handler, so a real exception/rejection is running. A static pass found no missing references
in `_udTabOwnership` (23 identifiers, all defined), so it is runtime/async. **Needs the console line before
any fix** — diagnostic snippet in `panel-redesign-verification.md` §4.3.

### Design change from Scott (supersedes spec §1.2 in part)
> *"I think we want to see the full detail side-by-side instead of a placeholder that you can swap over to
> the primary."*

The companion dock's summary card is rejected; both slots should host the **full tabbed panel**. This demotes
⇄ swap from "the way to reach detail" to a convenience. **The blocking work is not layout** — every renderer
writes into the singleton ids `#detailBody`/`#detailTabs`/`#detailHeader` and must be parameterised by a
mount root; plus the dual-dock width floor (720+620 > 1180), the tab bar at 620px, and `?d=` encoding only
one subject. Consequences catalogued in `panel-redesign-verification.md` §4.2.

### Queue re-ordered — **114 → 112 → 113**

| Prompt | Change |
|---|---|
| **114 (NEW)** review-lane drain + `buildContact360` fold-in | Created by 111, which left **101 candidates in a lane with no consumer** and proved attaching a person changes nothing because the hero can't see linked people (**47 owners reachable in data, invisible in UI**). The two defects must ship together — either alone looks like a failure. **Run before 112.** |
| **112** cadence | Restated to hero-true: **107 of 134 cadences (80%) are on unreachable owners** (was 94 on the loose definition). New **Unit A2** — the inverse defect: **65 reachable owners have no cadence at all**, so the actionable population is idle while the un-actionable one generates the noise. That is the only unit here that adds pipeline. |
| **113** owner feeders | Added: use `reachable_hero`, never a hand-rolled query; **every asset this resolves enlarges 111's problem** (~87% of new owners will be unreachable, so a good result *lowers* the reachability %) — report absolute counts and pre-state the denominator effect; and a newly-resolved owner must **not** auto-enrol into a cadence. |

### Queued from the audit — prompts 111 / 112 / 113 (drafted, not started)

The three measured flow breaks are registered in `docs/architecture/connectivity-and-open-threads.md` §4b
with a drafted prompt each. Recommended order is **111 → 112 → 113**: 111 unblocks the constraint, 112 stops
the noise that would otherwise swamp whatever 111 unlocks, 113 widens the funnel once the downstream can
carry it.

| Prompt | Break | Headline number | Core finding to act on |
|---|---|---|---|
| **111** owner reachability | BREAK-1 (HIGH — blocks the redesigned flow) | 104/690 owners reachable (**15.1%**) | **585 of 586 unreachable owners have NO person known at all** — this is decision-maker *discovery*, not contact enrichment. Two unlocks need no new fetching: **80** already carry an SF identity, and gov `recorded_owners.manager_name` is populated on **1,469** rows while the LCC owner graph shows **1** named person → a domain→entity **propagation** gap. |
| **112** cadence consumption | BREAK-2 (HIGH — doctrine violation) | **1,728/1,905 (91%) never touched**, 23 due in future, 7 with a rep | **94 owners are on a cadence with no way to contact them** — un-actionable by construction. Includes the `last_touch_at`-in-the-future writer bug (3 rows) and the upstream rep stamp (backfill already proven a dead end). Explicitly licences *retiring* the population rather than building more consumption around it. |
| **113** owner resolution feeders | BREAK-3 (MEDIUM — known, improving) | 1,396/3,886 assets (**35.9%**) | P0.2 own-deal buyer + P0.3 deed→evidence, still unbuilt. Up from ~2% in July, so **size each feeder before building** — the likely win is *promotion* of `recorded_owners` we already hold, not new capture. |

Each prompt carries its grounded baseline, the re-run SQL, the standing discipline (fill-blanks · unambiguous ·
provenance · reversible · idempotent · dry-run default), and an explicit out-of-scope list. All three require
reporting a **before/after** against `panel-redesign-verification.md` §3.2 rather than asserting success.

### ⚠️ Environment: the Cowork sandbox mount denies file DELETE (rename is allowed)

Root cause of the recurring "git lock" errors, verified this session. Git cannot unlink `index.lock` /
`HEAD.lock` after any command that rolls the lock back (e.g. `git status`), so the stale lock blocks the NEXT
command. `.git/_to_delete/` had **31** swept locks going back to 2026-07-31 and `.git/objects` **812** orphan
`tmp_obj_*` files — debris, not corruption. Also **unset a stale `core.hooksPath`** pinned to a dead session
mount (`/sessions/charming-blissful-clarke/...`). Commits still work (git finishes with a *rename*, which is
permitted). **Standing rule: run git writes and pushes from Windows**; from Cowork, sweep locks first. Full
runbook + cleanup commands in §5 of the verification doc.

## Session 2026-08-14 (Prompt 110) — fuller email-body ingestion (past the ~255-char bodyPreview cap)

- **Finding.** The correspondence store keeps only Graph's `bodyPreview` (~255 chars);
  `email_bodies.body_text/body_html` are empty on ~all rows — capping draft-assist RAG (openings, not full
  precedent), the voice profile's sign-off/long-form fidelity (Stage-1 LOW-confidence), and the harvest
  signature-phone arm (can't see full signatures).
- **Key discovery — the ingestion CODE was already ready.** `api/intake.js` already reads
  `payload.body_text`/`body_html`, clamps them (100K/200K), and prefers them over `bodyPreview`; the bridge
  writer already fills `email_bodies.body_text/body_html`. The fields are empty only because the PA flows post
  `bodyPreview` only. **Forward-only flow change + small consumer wiring — NOT a rebuild.**
- **Part A (Scott's step, documented).** Copy-paste PA click-path (mirrors the W9.4 doc): add a "Get email
  (V3)" action after the trigger (Message Id = trigger id, Include Attachments = No), then add
  `"body_html": <Get email V3 → Body>` to the "POST to LCC" body on the flagged-inbound / Sent-Items / bridge
  flows. No LCC redeploy for the endpoint. Verification query on `email_bodies` (text_len/html_len ≫ 255).
- **Part B (code, this PR).** New shared `pickBestBody`/`htmlToText` in `api/_shared/voice-corpus-clean.js`
  (full `body_text` → tag-stripped `body_html` → capped preview → `''`; on-prem regex only, nothing egresses).
  `api/draft-assist.js` `loadCorpus` selects + prefers full bodies (email_bodies + activity_events metadata);
  `api/admin.js` harvest signature arm reads the full body from metadata before the preview. Forward-compatible
  — falls back to the preview cleanly. Cap comment updated; deterministic cleaning unchanged. Guardrail:
  same corpus-hygiene doctrine (Scott's outbound; strip quoted chains; on-prem only).
- **Part C (scoped, NOT built).** ~23K historical rows have empty bodies; `internet_message_id` is stored.
  Recommended: a bounded/resumable PA "Get email (V3) by message-id" backfill loop keyed on
  `internet_message_id`, forward-only-first — its own future unit. (Graph server-side fetch is the fragile
  alternative — delegated auth, likely not reachable from Railway.)
- **Tests.** `test/voice-corpus-clean.test.mjs` (+9 for the helpers), `test/draft-assist.test.mjs` (29),
  `test/reachability-harvest-planner.test.mjs` (50), `test/outlook-recipients.test.mjs` — all green.
- **Docs.** `docs/audits/W10_FULL_BODY_INGESTION_2026-08-14.md` (Part A click-path + Part C feasibility),
  ROLLOUT_STATUS W10.3 line, W10 kickoff "deferred" note retired, `BRIGGS-WRITING-VOICE.md` upgrade-path note.

## Session 2026-08-14 (Prompt 109) — draft-assist flag consistency + fact-validator precision

- **Part A — flag gate now honors env OR registry (the bug).** `api/draft-assist.js` POST-save gate read
  `flagOn(process.env.DRAFT_ASSIST)` ONLY, with no registry fallback — so Cowork flipping the
  `feature_flags_registry` row to `on` (done 2026-08-14) did NOT enable saves; the endpoint still reported
  `save_skipped: DRAFT_ASSIST flag is OFF`. Fixed to the house env-OR-registry pattern via a NEW shared resolver
  `api/_shared/feature-flag.js` (`flagEnabled` + `fetchFeatureFlag`) mirroring `comms-owner-attribution-tick.js`
  / admin.js `w93FlagEnabled`. Precedence: an explicitly-set `DRAFT_ASSIST` env var wins (on OR off — ops
  override); else the registry `state='on'` enables it. **So the already-flipped registry row enables POST-save on
  the next redeploy with no Railway env var.** GET dry-run unchanged (always on).
- **Part B — fact-validator proper-name false-positive.** `validateDraftFacts` flagged **"Quick Check"** (from
  the subject "Quick Check-In") as an ungrounded `proper_name`. Tightened the Title-Case detector with a
  `NAME_STOPWORDS` set (Quick/Check/Follow/Up/Touch/Base/…): a multi-word run made up ENTIRELY of common
  capitalized English words is benign boilerplate and is NOT flagged; a run with any non-stopword token
  ("Kingsbarn Capital", "Boyd Watterson") is still flagged; ungrounded numbers/dates are still STRIPPED
  (cardinal-sin guard intact).
- **Tests:** `test/draft-assist.test.mjs` — the flag structural test now asserts the shared env-or-registry
  resolver (not `process.env` alone) + a unit test for the resolver's precedence; 7 new Part-B name-validator
  cases. **29 pass.** Additive, reversible, one PR.

## Session 2026-08-14 (Cowork, latest) — draft-assist LIVE + 108 backfill verified

- **Prompt 108 (comms_owner_bridge provenance) reviewed + verified live.** Backfill landed: `field_provenance`
  `comms_owner_bridge` **0 → 22**, all 22 in `v_field_provenance_current`; `v_field_provenance_unranked` adds 0
  (fsp row pre-existed — no new drift). Root cause matched the diagnosis (swallowed catch + `JSON.stringify(ownerEid)`
  double-encoded into the `jsonb` param); the response also corrected `p_target_database` `'lcc'`→`'lcc_opps'`
  (the ops-local convention) and factored an RPC-args builder + regression test (23 pass). **✅ Writer fix MERGED + LIVE (PR #1746, redeploy live 2026-08-14)** —
  `origin/main` carries `buildOwnerBridgeProvenanceArgs` + `p_value` as the raw id (double-encoding gone), so
  FUTURE W9.6 confirms now stamp `comms_owner_bridge` provenance correctly. Durable. (Note: Scott's LOCAL checkout
  was briefly behind — `ahead 1 / behind 2` — a sync/pull brings it current; production was never affected.)
- **W10 Stage 2 draft-assist REVIEWED LIVE + FLIPPED ON.** Scott ran two `GET /api/draft-assist` dry-runs on his
  box; both generated on-prem (`qwen2.5:14b`, GaryBuilt reachable). **Voice is accurate** — terse, "Stay tuned",
  "Got it" (echoing his real retrieved exemplars); **never-fabricate proven** — a non-existent `entity_id` yielded
  ALL "Not on file" + `fact_validation.clean=true`, zero invented facts. Corpus 434, deterministic retrieval
  (embedding model not installed → fell back as designed), `voice_confidence` honest about the ~255-char cap. GET dry-run is live and works well.
  **⚠ CORRECTION (later 2026-08-14): registry flip alone does NOT enable POST-save.** A live POST returned
  `saved:false / save_skipped: DRAFT_ASSIST flag is OFF` even with `feature_flags_registry.DRAFT_ASSIST='on'`,
  because **`api/draft-assist.js:260` gates ONLY on `process.env.DRAFT_ASSIST`** — it has NO registry fallback,
  unlike every cron tick (W9.6/harvest/twin check env-OR-`feature_flags_registry.state`, which is why THOSE
  registry flips genuinely worked — verified by their output). So draft-assist is the lone inconsistency.
  **→ Prompt 109 SHIPPED + merged to origin/main** (verified in tree: `api/_shared/feature-flag.js` +
  draft-assist.js now calls `fetchFeatureFlag('DRAFT_ASSIST')`+`flagEnabled`): **Part A** the save gate now honors
  env-OR-registry via the shared resolver, so the already-on registry row enables POST-save on the next Railway
  redeploy — no env var needed (explicit env still overrides); **Part B** `NAME_STOPWORDS` — benign Title-Case
  phrases ("Quick Check-In", "Following Up") no longer false-flagged, real names + fabricated figures still caught.
  29 tests. **Remaining for actual saves:** redeploy origin/main + `PA_OUTLOOK_DRAFT_URL` set on the service.

## Milestone 2026-08-14 — W9.6 lane fully worked; the last connectedness link is now CONSUMED

Scott worked all **22** W9.6 owner-attribution proposals → **22 confirmed / 0 rejected**, 22
`comms_owner_attribution_apply_log` writes landed, lane empty. **Payoff (the metric this unit existed to
raise): `v_lcc_w9_5_link_coverage.correspondence_entity_owner_llc` moved 2.5% (6/241) → 9.3% (24/259).**
Real owner LLCs now carry their correspondence history (ADM Camarillo, Anchor Point Capital, Atwater
Enterprises, Boyd Watterson, DaVita Healthcare Partners, Easterly Partners, …). Each confirmed bridge also
feeds the W9.2 reachability create-contact arm owner-linked threads it couldn't see before (the arms compound).
- **One observability nuance (not a data issue):** `field_provenance` shows **0** `comms_owner_bridge` rows —
  the confirm appends the owner entity to `activity_events.metadata.linked_entity_ids` (a jsonb-array append,
  tracked reversibly by the apply_log), and the provenance ledger (built for scalar curated-field writes) isn't
  stamping the array append. The reversible record (apply_log) is intact and the metric moved correctly; only
  the provenance *visibility* of these bridges is missing.
  - **RESOLVED — Prompt 108 (W9.6 provenance follow-up, 2026-08-14):** the 0-rows was NOT the array-append shape
    — the confirm writer DID call `lcc_merge_field`, but (a) inside a swallowed `catch (_e) {}` that hid the
    failure and (b) passed `p_value: JSON.stringify(ownerEid)`, double-encoding the jsonb param. Fixed both:
    the catch now logs loudly (`console.warn` on non-ok / thrown), and `p_value` is the RAW owner id (the RPC
    casts to jsonb) via the new single builder `buildOwnerBridgeProvenanceArgs` (`api/_shared/comms-owner-attribution.js`),
    stamping `p_target_database='lcc_opps'` (the ops-local convention). **Backfilled all 22 historical bridges**
    (migration `20260814140000_lcc_w9_6_comms_owner_bridge_provenance_backfill.sql`, applied live — one
    provenance row per bridge keyed on each review's `sample_activity_id`, idempotent, reversible by
    `source_run_id='w9_6_provenance_backfill:2026-08-14'`). **Verified live: `field_provenance` `comms_owner_bridge`
    = 22 write rows, all 22 in `v_field_provenance_current`; `v_field_provenance_unranked` adds 0 for
    `comms_owner_bridge` (fsp row already registered — no new drift).** Regression guard: 3 tests in
    `test/comms-owner-attribution.test.mjs` assert `p_value` is the bare id (never `JSON.stringify`).
- **Twin assist (106):** first cron run is 05:45 UTC **2026-08-15** (flag flipped after today's run window), so
  the property_twin lane will be pre-ranked/sorted tomorrow morning (0 annotations now is expected).

## Session 2026-08-14 — Prompt 107 (W10 Stage 2): retrieval-grounded drafting `/api/draft-assist` SHIPPED

**New endpoint `/api/draft-assist` — a Scott-voiced DRAFT generator grounded in his real sent-email corpus + the deal spine. Flag `DRAFT_ASSIST` OFF; GET dry-run is live for review.**

- **What.** `GET /api/draft-assist?purpose=&intent=&recipient=&entity_id=` assembles a draft and returns it + the retrieved exemplar ids + the facts used (+ "Not on file" gaps) + a `voice_confidence` note — **writes nothing**. `POST` (flag-gated on `DRAFT_ASSIST`, `save=true`) saves the draft to Outlook Drafts via the offer-submission `createOutlookDraftViaPA` seam. **NEVER sends.**
- **Doctrine, enforced structurally (not just by prompt):** (1) never-send — the only outbound call on the path is the save-not-send draft seam; (2) never fabricate — facts come from `buildDealPacket`→`extractDealFacts` ("Not on file" for gaps) and the generated draft is run through `validateDraftFacts`, which **strips any number/date not grounded in the facts or the retrieved exemplars** and flags ungrounded names; (3) strategy stays verbal (prompt forbids it); (4) **on-prem generation only — `invokeOnPremGeneration` fails CLOSED, no cloud fallback**, so Scott's corpus never egresses; (5) honest `voice_confidence` about the opening-only (~255-char) corpus cap.
- **Retrieval.** `loadCorpus` reads `activity_events` + `email_bodies`, gates on the `SCOTT_FROM` from-address set (**outbound-only**), cleans via `voice-corpus-clean`, buckets via `classifyDraftType`. Ranks with on-prem Ollama embedding-KNN (`nomic-embed-text`) when reachable, else a deterministic bucket+recipient+recency ranker (serviceable on opening-length text).
- **Files.** Core (pure/testable) `api/_shared/draft-assist-core.js`; handler `api/draft-assist.js`; on-prem seam added to `api/_shared/ai.js` (`invokeOnPremGeneration` + `invokeOnPremEmbeddings`, both fail-closed); mounted in `server.js`; migration `20260901120000_lcc_w10_2_draft_assist_flag.sql` (registers `DRAFT_ASSIST`); tests `test/draft-assist.test.mjs` (**21 pass**); sample sheet `docs/audits/W10_STAGE2_SAMPLE_DRAFTS.md`.
- **U4 hook** left wired (draft-vs-sent edit-distance); send-side capture is a documented TODO seam (not built — it's heavy).
- **Operator step:** redeploy → run a couple of `GET /api/draft-assist?...` and read the sample drafts ("does this sound like me?") → flip `DRAFT_ASSIST`→on (Cowork) to enable Outlook-draft saves. On-prem generation needs `OLLAMA_URL` set on the Railway service; without it GET honestly 502s "failing closed".
- **⚠ Cowork reconcile (2026-08-14): the flag migration was NOT applied by the PR — Cowork caught + applied it live.** Same deploy-ordering slip as W9.1 Stage 2 (migration in repo, never run on LCC Opps). `20260901120000_lcc_w10_2_draft_assist_flag.sql` applied to LCC Opps (additive/idempotent, `ON CONFLICT DO UPDATE`); **`DRAFT_ASSIST` now registered = off** (off_since 2026-09-01), so it shows in the Dormant-Capabilities digest as designed. Response reviewed — clean; doctrine enforced structurally (never-send / fact-validator / fail-closed-no-cloud-egress), 21 tests, one pre-existing unrelated failure confirmed on baseline. 107 response → `responses/done/`.

## Session 2026-08-14 (Cowork, later) — 105 + 106 reviewed & reconciled; CRLF class fixed repo-wide

**Both responses reviewed, verified live, docs reconciled, folder cleaned. Tree fully synced (`main...origin/main`).**

- **Prompt 105 — repo line-ending normalization: SHIPPED to all THREE repos** (each own branch/commit/PR:
  life-command-center **#1738**, Dialysis **#7376**, government-lease **#381**). Root `.gitattributes`
  (`* text=auto eol=lf`, explicit LF text types, `eol=crlf` for `.ps1/.bat/.cmd`, binary block; Dialysis got
  `*.xls binary` for its 34 .xls) + a single `git add --renormalize .` commit per repo — verified pure CRLF→LF
  (zero content changes, no binaries touched, no Windows scripts flipped). **`.gitattributes` confirmed present
  in the LCC tree.** The CRLF-churn class that blocked syncs 3× is now fixed at the repo level; the commit body
  documents the one-time `git rm --cached -r . && git reset --hard` fallback for any Windows checkout still
  showing churn after re-pull.
- **Prompt 106 — property_twin assist: VERIFIED LIVE (flag OFF, ready for review→flip).** Confirmed against
  LCC Opps: flag `PROPERTY_TWIN_ASSIST` = **off**, migration `20260814130000` applied, `lcc_clean_assist_proposals`
  source CHECK widened (accepts `property_twin_assist`), cron `property-twin-assist-tick` scheduled (05:45 UTC,
  jobid 220, no-op while off). Planner `api/_shared/property-twin-assist-planner.js` in tree. See the dedicated
  106 entry below for the full build. **Flip gate (same as 104):** the `?score=1` dry-run needs the authed tick,
  so live per-class counts confirm at the next cron run or a manual tick call — I'll confirm then.
- **Docs reconciled:** ROLLOUT_STATUS gained the property_twin-assist entry (106's own branch edit to it was
  dropped in a merge; re-added). STATUS 104→SHIPPED and the 106 entry already landed via the merges.
- **Folder cleaned:** prompt 105 → `prompts/done/` (104/106 already there); responses 105/106 → `responses/done/`.
- **106 FLIPPED LIVE (Cowork, 2026-08-14) after a clean `?score=1` review.** Dry-run (200 fresh of 1,245
  pending): deterministic decisive 81 (20 bulk-confirmable merges + 61 co-located `not`), LLM residue 119,
  `scan_errors:[]`; verbatim validator dropped non-verbatim LLM quotes (`quote_not_verbatim`), same-address
  operator-change pairs → `uncertain`, Ollama responding. `PROPERTY_TWIN_ASSIST` = on; cron 05:45 UTC now
  annotates + sorts the lane (never merges).
- **104 `?score=1` reviewed — healthy, no flip needed (flag `W9_2_REACHABILITY_HARVEST` already ON).** The
  bounded 120-target window produced 0 `create_contact` candidates, so `create_fanout_suppressed` /
  `create_brokerage_suppressed` are honestly 0 (nothing to suppress in-window — NOT a defect; the guard is
  deployed + unit-tested against the Sharrow fan-out fixture, and fires in production when a fan-out/brokerage
  create_contact candidate appears). Harvest pool still large (dia 4,238 / gov 10,633 unreachable); comms index
  healthy (9,278 header name-pairs, 3,543 signature phones) — the arm walks the pool nightly.

---

## Prompt 106 (2026-08-14) — property_twin lane: deterministic pre-rank + Ollama assist (annotation-only)

**Built the two-layer assist that pre-ranks + sorts the dia property_twin review lane (~1,245 pending) so
Scott clears the 792 same-operator merges fast and spends judgment on the conflict/ambiguous residue.** The
assist ANNOTATES + SORTS — it NEVER merges (the dia `dia_merge_property_reversible` stays a human, reversible
verdict). Layer 1 = a NO-LLM deterministic classifier (`api/_shared/property-twin-assist-planner.js`, reuses
`nameSimilarity`); Layer 2 = Ollama on the uncertain residue with a verbatim-evidence-quote precision floor
and the co-located-plaza footgun few-shot. Store = existing `lcc_clean_assist_proposals` (source
`property_twin_assist`). Tick `GET/POST /api/property-twin-assist-tick` (dry-run `?score=1&n=`; flag-gated
apply; per-class/per-suggest honest counts; `scan_errors`; budget floor). Lane shows the suggestion + evidence,
sorts easy-first, bulk-confirms deterministic merges only (each a human verdict). Migration `20260814130000`
applied live to LCC Opps (source CHECK widened, flag `PROPERTY_TWIN_ASSIST` OFF, U4 self-measure table/RPC/
view, cron `property-twin-assist-tick` 05:45 UTC jobid 220). Tests `test/property-twin-assist.test.mjs` (31
pass) incl. the deterministic classifier, verbatim validator, annotation-never-verdict structural guard, and
the co-located footgun fixture. **Live steps:** redeploy → `?score=1` review → Cowork flips
`PROPERTY_TWIN_ASSIST`.


## Session 2026-08-14 (Cowork) — END-TO-END CONNECTEDNESS AUDIT (verdict→write→consumer, all lanes)

**Traced every lane from Scott's manual verdict → the write → the downstream consumer, live. The loop is
CLOSED in every category. Scott worked a large batch over ~36h; here is what landed and what didn't.**

### ✅ Working end-to-end (verified live)
- **Hygiene lanes — highest throughput, fully closed.** Junk-entity: **203 confirmed → 207 `junk_review_batch`
  reversible ledger rows** (entities soft-retired, FK-referenced → conflict not delete). Naming-hygiene: **350
  confirmed → 368 `naming_hygiene_batch` rows → 40 `field_provenance` `w8_u5_naming_hygiene` writes** (name
  fields stamped; canonical collisions → conflict). Every verdict reversible + provenance-tagged.
- **Resolver-training loop closed.** Owner-reconcile/dup lane → **48 `entity_match_labels` in 36h**
  (w8_u2_ollama_pair 41 `distinct` + 2 `same_party`; w8_u3_shared_email 5 `distinct`) → feeds the W4.4 nightly
  retrain corpus. The "reject is productive" design is real: 41 hard-negatives captured.
- **BD-payoff arm delivering (the point of the whole campaign).** Reachability harvest: **2 confirmed →
  `reachability_harvest_apply_log` status=applied → 2 owners that had ZERO contacts now have a reachable one**
  (Eric Dowling `edowling@boydwatterson.com`→Boyd Watterson; Oscar Peterson `opeterson@uirc.com` +816-682-8097
  →UIRC). Contact-acquisition: **4 confirmed → applied** (2 broker_of_record: Bob Safai / AJ Belt; 2 crossref
  attaches: Nigel Hebborn / Christine Russi Couture) into the entity graph.
- **W9.3 auto-writers landing provenance-stamped.** Re-score `splink_v2` 22 writes; donor-handoff
  `sf_account_contact_expansion` 13 writes (SF keys onto blank contacts) — both in `field_provenance`, last 36h.
- **W9.6 producing.** First cron run 05:05 UTC minted **22 owner-attribution proposals** into
  `comms_owner_attribution_review` (Path A + tightened Path B). Fill-blanks guards healthy repo-wide
  (`folder_feed_lease` 12 `conflict` decisions correctly recorded, not clobbered — now that we fsp-ranked it).

### ⚠ Not landing yet / gaps (honest)
1. **W9.6 lane is the one un-consumed link.** 22 proposals sit at **0 decided**, so `v_lcc_w9_5_link_coverage`
   `correspondence_entity_owner_llc` is still **2.5% (6/241)** — it only rises once Scott works the lane. This
   is the single highest-leverage next action (it also feeds the reachability harvester more owner contacts).
2. **Precision signal is near-zero on the hygiene lanes.** Junk 203 confirm / **0 reject**; naming 350 confirm /
   **0 reject**. Deterministic renames are safe to bulk-confirm, but ~0 rejects means we're not learning where
   the proposer errs on those two lanes (contrast the resolver lane's healthy 41/43 negatives). Recommend
   spot-rejecting a few genuinely-wrong cards to keep the precision floor honest — or accept if the pre-filter
   is truly clean (the batch ledgers make any over-confirm reversible).
3. **Reachability create_contact could tighten.** 2 of the first 4 harvest cards were **rejected** (shared-broker
   `create_contact` — both were **Philip Sharrow `<philip.sharrow@scopecre.com>` fanned across Boyd Watterson AND
   BLOOMINGTON IRS**), the same brokerage/shared-contact noise we fixed in W9.6 Path B. The human gate caught
   them. **→ Prompt 104 SHIPPED 2026-08-14** (`docs/claude-code/prompts/done/104-w9-2-create-contact-precision.md`):
   two deterministic guards on the `create_contact` mint arm ONLY (the deterministic fill-blanks arm untouched) —
   a **fan-out cap** (`RH.createContactFanoutSuppressed`, `HARVEST_MINT_FANOUT_MAX`=2: a contact keyed by email
   (else name) proposed for ≥2 distinct owners → suppress, catches Sharrow; counter `fanout_suppressed`) and a
   **brokerage/advisor-contact guard** (`coaIsBrokerageContact` = reuse of W9.6 `isBrokerageOwnerName` + a new
   `isBrokerageEmail` domain stoplist incl. `scopecre.com` → never mint an advisor as the owner's own contact;
   counter `brokerage_contact_suppressed`). Per-reason counts surfaced in the tick; planner-only, reversible,
   proposal-only unchanged. Tests extended (`test/reachability-harvest-planner.test.mjs`, 44 pass).
4. **owner_reconcile scale.** 43 worked vs a **3,416** open pool — drain rate is slow relative to the pile (not a
   defect; needs sustained work or a bulk-assist). ORE-native seeder pairs (vs the dup-pair subset) are the bulk.

### Net
Every category is connected verdict→write→consumer with reversible ledgers + provenance. The chain now visibly
*produces value* (2 new reachable owners, 4 graph attaches, 43 resolver labels, 575 hygiene fixes in a day). The
only link waiting on a human pass is W9.6 owner-attribution. Docs updated (this entry + ROLLOUT connectedness note).

---

## Session 2026-08-13 (Cowork, later) — prompt 103 reconciled; W9.6 FLIPPED LIVE; folder cleaned

**Prompt 103 (W9.6 Path-B precision + fsp hygiene) reviewed, verified live post-redeploy, and W9.6 flipped ON.**
All PRs merged + Railway redeploy live (Scott).

- **Part A — Path-B precision (the flip gate): SHIPPED + verified live.** Three deterministic guards (no LLM):
  (1) internal-team exclusion — reused the exported `INTERNAL_DOMAINS` (`northmarq.com`/`stanjohnsonco.com`)
  from `voice-corpus-clean.js`, so Scott/Toby are never an owner-attribution subject; (2) brokerage-target
  guard — new deterministic `isBrokerageOwnerName` / `lcc_is_brokerage_owner_name` stoplist drops brokerages
  mislabeled `true_owner` (logged as a KNOWN upstream ORE labeling issue, NOT fixed here); (3) tie-tightening —
  `relationship` tier now accepts only ownership/employment roles (`works_at`/`contact_at` or `metadata->>'role'`
  in the owner/manager set), keeping `active_contact` via `owner_contact_pivot`. RPC gained `rel_role`,
  `drop_reason`, and a `p_include_dropped` param (direct calls noise-free by default; the tick pulls tagged
  noise for honest per-reason drop counts). **Verified live:** Path B clean **28** survivors, **0 internal /
  0 brokerage**, all 5 key owners survive (Boyd Watterson, Kingsbarn, Realty Income, Easterly); dropped-when-
  included **13** (brokerage 10 / internal 2 / loose 1). Path A unchanged (3, always clean). 20 tests green.
- **Part B — `folder_feed_lease` fsp hygiene: SHIPPED + verified.** fsp rows registered for the drift fields at
  the established `folder_feed_lease@45 warn` rank (14 dia.leases fields total). **Drift 39 → 34 baseline;
  `folder_feed_lease` now 0 in `v_field_provenance_unranked`.**
- **W9.6 FLIPPED ON (Cowork, this session)** after the live re-review of the tightened sample met the flip gate.
  `W9_6_COMMS_OWNER_ATTRIBUTION` state=on, off_since cleared. Nightly cron 05:05 UTC now proposes owner-
  attribution edges (Path A property bridges + tightened Path B) into the `comms_owner_attribution_review`
  lane — proposal-only, human-gated, reversible. It lifts W9.5's `correspondence_entity_owner_llc` (2.5%
  baseline) as verdicts confirm, and each confirmed bridge also feeds the reachability create-contact arm.
- **Migration bookkeeping note:** MCP `apply_migration` records under apply-time versions
  (`20260813120707 lcc_w9_6_pathb_precision` + `20260813120838 ..._loose_edge`), NOT the repo filename version
  (`20260830120000`). Same pattern as every prior migration this campaign; effects verified live, repo file is
  the durable source. A future `db push` re-applying the repo file is safe (CREATE OR REPLACE + ON CONFLICT).
- **Folder cleanup:** prompts 100–103 → `prompts/done/`; responses 100/102/103 → new `responses/done/`.
  `responses/` now holds only README + `done/`.
- **⚠ DOC RECONCILE (Cowork, this session):** planning to flip the "remaining dark" Wave 9 units, I found
  **W9.3 (all 3 flags) has been LIVE since 2026-08-08 and W9.1 Stage 1 since 2026-08-12** — the ROLLOUT_STATUS
  rows falsely still said "BUILT — flag OFF." Corrected all rows + the W9 kickoff summary. **Live health
  verified, all conservative:** W9.3 re-score gov 2,000 / dia 2,000 scored → ~72 exact-unique auto-links
  applied (gov 52 / dia 20), **1 conflict correctly guarded (not overwritten)**, 12 → needs_review;
  W9.3 SF-assist 80 annotation-only pre-ranks (zero curated writes); W9.3 donor-handoff slow unique-match
  SF-key fills (gov 5 last night, input-thin as designed); W9.1 green, 5 proposals night one, human-gated.
  **Net: every INTERNAL Wave 9 unit is now LIVE and producing** (W9.1/W9.2/W9.3/W9.4/W9.5/W9.6); only
  W9.1-Stage-2 SOS-direct stays walled (external, `W9_1_SOS_DIRECT` off).

---

## Session 2026-08-13 (Cowork) — prompts 100 + 102 reconciled; harvest's first live night verified

**Both responses reviewed against live LCC Opps and reconciled. Nothing to re-open; two findings logged.**

**Prompt 102 — W9.6 correspondence→owner-LLC attribution (BUILT, verified live, flag OFF).**
- Closes the last major internal linkage gap: correspondence is stamped with the deal/party/property
  entity the resolver found (brokers/buyers/sellers), never the owning LLC → W9.5 measured
  correspondence→owner-LLC at 2.5% (6/241). Two deterministic-first paths: **A** property→owner
  bridge (asset entity → its single current `true_owner`, conf 1.0, unambiguous-only, value-ranked);
  **B** correspondent-person→owner (`owner_contact_pivot` active contact or unambiguous person→owner
  edge; shared-token bridges rejected — the W9.1 false-bridge lesson).
- **Verified live:** migration `20260829120000` applied; flag `W9_6_COMMS_OWNER_ATTRIBUTION` = **off**
  (off_since 2026-08-13); fsp row registered on `public.activity_events.linked_entity_ids @ priority 45
  record_only` (provenance `comms_owner_bridge`); **W9.5 baseline held at exactly 6/241 = 2.5%** (the
  owner-restricted union did NOT dilute the denominator — confirmed against `v_lcc_w9_5_link_coverage`).
  Path-A 3 candidates / Path-B 40 unambiguous live. New DC lane `comms_owner_attribution_review` fully
  75-wired. 27 tests green. Confirm-writer appends the owner ops entity to `metadata.linked_entity_ids`
  — that one anchor feeds BOTH the owner-record history AND the reachability create-contact arm (arms
  compound). Pushed to `claude/comms-owner-attribution-6flfnt` (PR #1714).
- **Live gate — REVISED after Cowork's live dry-run (2026-08-13): DO NOT FLIP YET.** Ran the Path-A/Path-B
  RPCs directly. **Path A (property_bridge, 3) is clean + flip-ready.** **Path B (person_match, 40) carries
  ~9 noise rows (~23%):** 2 internal-team correspondents (Scott 828 rows / Toby 128 → "Stan Johnson Co" via a
  loose `relationship` tie — the loudest cards by volume) + 7 brokerage-as-owner targets (Avison Young/Newmark/
  Kidder/Transwestern/Coldwell mis-modeled as `true_owner`). Human-gated so no bad writes, but below the flip
  bar (the "noise trains the operator to ignore the lane" anti-pattern). → **Prompt 103 drafted** (Path-B
  precision: drop internal-team, guard brokerage targets, tighten the tie) — flip after that lands + redeploy.
  Finding recorded in the dry-run doc.

**Next Claude Code prompt queued: 103** (`docs/claude-code/prompts/103-w9-6-pathb-precision-and-fsp-hygiene.md`)
— **Part A** W9.6 Path-B precision (the flip gate); **Part B** register `folder_feed_lease` fsp rows for the 5
dia.leases responsibility fields (clears last night's drift 39→~34). One PR.

**Deploy still pending Scott:** merge PRs #1714 (W9.6) + #1715 (voice) → Railway redeploy of merged main. W9.6's
tick/cron and the name-backfill route are not in production until then (DB layers already live).

**Prompt 100 — W10 Stage 1 voice profile (SHIPPED, no surface changed, awaiting Scott's read).**
- `BRIGGS-WRITING-VOICE.md` + pure `api/_shared/voice-corpus-clean.js` (19 tests) + on-prem
  `scripts/voice-distill.mjs` (ollama-only, refuses to run if `OLLAMA_URL` unset — corpus never egresses).
- **Honest cap finding preserved:** the correspondence store keeps only Graph `bodyPreview` (~255-char cap);
  `body_text`/`body_html` empty. So the signal is Scott's email *openings* (~31 words) — strong for
  greeting/opening voice, LOW-confidence for sign-offs/long-form (flagged, not faked). Corpus ~926 distinct
  Scott-authored sent emails (Nov 2022→Aug 2026); cold-BD bucket THIN (14). No LLM read the prose in v1
  (deterministic SQL + small anonymized sample); the ollama distiller is the operator's on-prem enrichment
  step (same "mechanism built, heavy pass is Scott's" pattern as SOS/SAM). Pushed to
  `claude/voice-profile-scott-corpus-qofank` (PR #1715).
- **Scott's step:** read `BRIGGS-WRITING-VOICE.md` — does it sound like you? — before any Stage 2 (RAG drafting).

**Last night's runs (checked live):**
- ✅ **Reachability harvest's FIRST live cron fired 04:40 UTC 2026-08-13** — 1 batch, **4 open deterministic
  proposals**, health **green** (`v_lcc_reachability_harvest_health`: proposals_24h 4, open 4, dropped 0,
  LLM 0, applied 0, flag on). All 4 are real owner-email fills for owners with no contact on file, exactly
  matching the dry-run: **Boyd Watterson Global** (Eric Dowling `edowling@boydwatterson.com`; Philip Sharrow
  `philip.sharrow@scopecre.com`), **UIRC** (Oscar Peterson `opeterson@uirc.com`), **BLOOMINGTON IRS LLC**
  (Philip Sharrow). Awaiting Scott's lane verdicts — the harvest is now *growing the callable owner pool*.
- ⚠️ **New provenance drift (34→39):** last night a `folder_feed_lease` lease-ingest wrote 5 dia.leases
  responsibility fields (`guaranty_scope`, `hvac/parking/structure/roof_responsibility`, 02:4x UTC) with
  **no `field_source_priority` rows** → `v_field_provenance_unranked` flags them. Not from W9.6 (that source
  is properly ranked). Fix = register 5 fsp rows for `folder_feed_lease` on those dia.leases fields (additive,
  reversible) — folded into next-steps below, not silently applied (its authority rank vs om_extraction/costar
  needs Scott's call).


- **Google Document AI is live end-to-end** (was silently broken since ~07-17: the `GOOGLE_DOCAI_PROCESSOR`
  edge secret pointed at a Custom Extractor → `entity_types` 400 → ALL OCR fell to gpt-4o at 6–14×). Fixed
  by repointing to OCR processor `projects/108926230693/locations/us/processors/5ecc6339861c88e1`; verified
  (deed tick: 8 pages `google_docai`/`cloud_cheap`). docai-ocr edge fn v19 now echoes the processor on GET.
- **NEW `api/_shared/office-text.js`** (zero-dep docx/xlsx text; byte-sniffed — PA flow lies about mime) wired
  into `runLeaseExtraction` + `extractDocumentText` BEFORE the OCR tiers; unreadable office → terminal
  `office_no_text` (never re-queues to OCR). 15 tests + fixtures; commit `62e4aef5`, merged + deployed.
- **Crons 160/167/169 reactivated** (deed + CRE doc-text, 30-min ticks). Office needs_ocr queue (11) fully
  drained; Richardson 2840 (15.6MB/40pp rotated scan) OCR'd off-box → enriched. Lease corpus (~214 pending)
  draining via temp cron 217 + self-cleanup cron 218 (auto-unschedules both at eligible=0).
- **Registry:** `feature_flags_registry.OCR_CLOUD_DOCAI` (on, notes current). Docs updated:
  `docs/architecture/document-capture-and-ocr-status.md` (FINAL STATE box = the durable runbook),
  `CLAUDE.md` OCR section, `docs/UW4_LEASE_OCR.md` banner. **Do not re-provision OCR from scratch.**
- Optional knobs left unset: `AI_OCR_MODEL=gpt-4o-mini`, `INTAKE_OCR_MAX_BYTES=20000000`.

