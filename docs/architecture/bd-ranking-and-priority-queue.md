# BD Ranking & the Priority Queue — the canonical page

> 📍 **ALL work on the ranked call list starts here.** One door into C4 → C5 → C6: what the queue
> is, why it reaches 4% of resolved owners, what has been measured, what is decided, and what is
> deliberately still open.
>
> **Sibling canonical pages:** [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md)
> (the chain end to end — this page owns its **last hop**) ·
> [`tier0-owner-contact-system.md`](tier0-owner-contact-system.md) (person ↔ owner) ·
> [`ownership-history-lane.md`](ownership-history-lane.md) (ownership depth) ·
> [`owner-role-classification.md`](owner-role-classification.md) (**how an owner gets its role** — ⚠️ **§2e: the
> `developer` arm is BUILT and live in gov, not unbuilt as earlier claimed** —
> C4a's design, written to Scott's accuracy-first constraints) ·
> [`account-based-contact-intelligence.md`](account-based-contact-intelligence.md) (**who** to call
> and **in what tone** — this page decides *whether the signal fires*, that one decides *the pitch*).
>
> **Status: C6 SHIPPED 2026-08-29 · C8 SHIPPED 2026-08-31 (80 → 126 rows) · ✅ C8c FIXED as C10
> 2026-08-31 — the sheet renders real names and real portfolio values; count held at 126.**
> **C6 detail:** — `gov_owner_props` now gates P1/P2/P3/P8 on *holds a current
> gov asset* **AND** *is reachable*, replacing the party-level role gate. **P1 74 → 149 · P2 32 → 95 ·
> P3 61 → 163 · P8 76 → 213; 303 owners, every one callable.** P5, P0.4, P0.5, P-CONTACT, P-BUYER, P4
> and all of dia unchanged (positive-controlled). Migration
> `supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql`; evidence
> [`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](../audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md).
> ✅ **UX-T1a-gates SHIPPED 2026-09-03 — the queue's two coverage gates are now HONEST, and
> 941 of 1,635 queue rows have left the human surface.**
> `v_priority_queue_enriched` and `v_priority_queue_band_counts` carry **`human_surface`**
> (`lcc_priority_band_is_human_surface`): FALSE for the four bands that already have an automated
> consumer — **P0.4** 555 (A2/cron 244), **P-CONTACT** 216 (Tier 0 auto-attach), **P0.5** 148 (CRM
> hygiene), **P-BUYER** 22 (buyers are pursued by showing them deals) — TRUE for the **694**
> seller-timing rows (P8 213, P3 166, P1 147, P2 95, P5 59, P4 14). **A flag, not a filter: nothing
> is deleted, the automated consumers still read their bands, and an explicit `?band=` request
> still reaches a hidden one.** Fails OPEN — an unclassified band is shown.
> Also shipped: dia lease dates now reach `lcc_property_attributes` (**0 → 1,747**, so the
> doctrine's newer-lease gate is computable for the dia swimlane for the first time), and
> `v_lcc_bd_worklist` gained an owner-attributed **`loan_maturity`** arm (**0 → 172** rows / 109
> owners) over the new `lcc_loan_maturity` mirror.
> ⚠️ **The Part A audit's "loan_maturity has no producer" is TRUE of the VIEW and FALSE of the
> HANDLER** — `assembleBdWorklist` always fanned out to the domains' `v_loan_maturity_watch`. The
> gap was owner ATTRIBUTION (`entity_id: null`), which is what blocked an owner-keyed queue.
> Record: [`UX-T1a-gates.response.md`](../claude-code/responses/done/UX-T1a-gates.response.md);
> guard `test/uxt1a-gates-coverage.test.mjs` (18 tests, 19/19 mutations RED).
> **UX-T1a-queue (`v_lcc_seller_prospect_queue`, variant F) is UNBLOCKED and is the next step.**
>
> ✅ **C11 SHIPPED 2026-08-31 — the call-sheet arc (C6 → C8 → C10 → C11) is COMPLETE.** See **§4b**
> for the state of this surface: 126 rows, gated, legible, each stating its basis; **~4 defective
> rows remain** (C11b, C11c, one C9 split). ⚠️ **C11a is REFUTED** (sponsor↔SPE, not a defect) and
> **C9's 45 splits touch exactly 1 sheet row** — neither is a call-sheet priority.
> 🚨 **UX-T1a PART A MEASURED 2026-09-03 — THIS QUEUE IS 89.6% DISJOINT FROM THE DOCTRINE'S POPULATION.**
> Read [`../audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md`](../audits/UX_T1a_SELLER_QUEUE_MEASUREMENT_2026-09.md)
> before touching a band. Scott's §0b answers quantify the queue as **seller prospecting: $2.5M–$25M per
> property, a NEWER lease (first 2–3 years of its initial term), a reason to sell, an owner not yet reached.**
> Measured funnel: **8,858 current facts → 3,529 in band → 259 newer lease → 31 with a reason to sell → 23
> not reached.** Of those 259 in-band newer-lease assets, **27 appear here at the (owner, asset) grain and 232
> do not** — because **P1 `lease_expiry_24mo`, P2 `firm_term_ending_24mo` and P3 `ten_year_window` select
> assets LATE in their term, the opposite of "newer lease".** The two are near-disjoint populations, so the
> doctrine's queue is a **NEW view (`v_lcc_seller_prospect_queue`), not a re-rank of these bands** — and that
> is the number that decides it. ⚠️ Separately, **956 of 1,650 rows (58%) are not seller prospecting**:
> P0.4 `resolve_ownership_control` 555 · P-CONTACT `select_prospecting_contact` 231 · P0.5
> `open_bd_opportunity_needed` 148 · P-BUYER 22 — automation, CRM hygiene and buyer work, which §0.2 says
> never earns a card. Seller-timing bands are 694 (42%). **Hide them from the human surface, do not delete
> them** — they have automated consumers (A2/cron 244; C1's `sf_link_candidate`).
> **Part B is deliberately NOT built:** two gates are coverage gaps — dia has **no lease dates in
> `lcc_property_attributes` at all** (a mirror gap; dia `leases` holds 3,823 live leases / 1,940 properties)
> and the **debt** D has no LCC table despite **192 loans maturing inside 24 months** at source and an
> already-labelled `loan_maturity` slot on the home page that **was never implemented**. See backlog
> **UX-T1a-mirror-dia-lease** and **UX-T1a-debt**.
>
> **Open and Scott's: C4a** (the pitch/bucket). **C4b** (`user_owner`) is resolved as inert —
> ⚠️ **and "inert" now means *awaiting human confirmation*, not *unproduced*: C13b (2026-09-01)
> built the arm and its 13-candidate lane. See §5 and `owner-role-classification.md` §7.**
> **Open, sized, unbuilt: C9** (45 true-split merge groups), **C9b** (434 edge splits), **C9a** /
> **C10a** / **C8a** (design + dead-branch decisions), **C7a** (mailbox coverage — the precondition
> under all of it).

---

## 1. Where this sits in Scott's chain

His stated chain: *property → recorded ownership → SPE/LLC control → true owners → the right contact
with the right contact info → **the correct prospecting style in the correct buckets assigned to the
correct broker** → **the relative weighting of each contact and next BD action against all other
calls, marketing and deal-execution actions.***

Hops 1–5 are the connectivity arc (C2a–C2h, Tier 0, the ownership lane). **This page owns hops 6–7**,
and they were unmeasured until 2026-08-28.

## 2. What the queue is

`v_priority_queue` is a thin UNION over a **materialized cache** — `lcc_priority_queue_resolved`,
refreshed every 5 minutes by cron `lcc-priority-queue-refresh` — falling back to
`v_priority_queue_live` only when the cache is empty. **All logic lives in `v_priority_queue_live`.**

⚠️ **Measure the live view or refresh the cache, and say which.** Comparing a fresh live view to a
stale cache reads as "the change did nothing."

### The bands, as of 2026-08-29 (post-C6)

⚠️ **Two of the 2026-08-28 figures below had already drifted by the next day** — P3 read **61**, not
62, and P0.4 read **555**, not 552. Ordinary live drift, and it would have been misread as a
change-induced delta had the baseline not been re-taken in the same session. **Re-measure the
baseline, not just the blocker.**

| band | reason | rows (pre-C6) | **rows now** | owners now |
|---|---|---:|---:|---:|
| **P0.4** | `resolve_ownership_control` | 555 | **555** | 555 |
| **P8** | `agency_active_solicitations` | 76 | **213** | 118 |
| **P-CONTACT** | `select_prospecting_contact` | 231 | **231** | 231 |
| **P3** | `ten_year_window` | 61 | **163** | 127 |
| **P1** | `lease_expiry_24mo` | 74 | **149** | 100 |
| **P0.5** | `open_bd_opportunity_needed` | 148 | **148** | 148 |
| **P2** | `firm_term_ending_24mo` | 32 | **95** | 63 |
| P5 | `aged_building_value_add` | 58 | 58 | 36 |
| P-BUYER | recent buyer activity | 22 | 22 | 22 |
| P4 | `recent_acquisition_streak` | 12 | 12 | 12 |

**The four deal-timing bands went 243 → 620 rows / 497 assets / 303 owners** — the deal-timing share
of the surface roughly doubles, from ~19% to ~38%. ⚠️ **620 rows, 497 assets and 303 owners are
three different questions**: the queue emits one row per **(owner, property, band)**, so an asset
tripping both P1 and P8 emits two rows. Do not use them interchangeably.

**Data-completion work is now 934 of 1,646 rows (57%)** — P0.4 555 + P-CONTACT 231 + P0.5 148 —
against **620 deal-timing rows (38%)**. ⚠️ **Pre-C6 this read 931 of 1,267 (73%); both the numerator
and the denominator moved, so never compare the percentages alone.** The data-completion rows did
not fall — **the deal-timing rows roughly doubled underneath them.**

⚠️ The 57% is **not itself a defect** — P0.4/P0.5 are doctrinal producers with named consumers. But
a surface still more than half data-completion trains the operator to skim it, which is the
badge-that-is-noise failure one level up. **That is C4a's remaining prize, not C6's.**

## 3. ⚠️ The gate — RETIRED BY C6 on 2026-08-29. Read this before quoting anything below it.

**What runs today** (`gov_owner_props`, live-verified 2026-08-29):

```sql
gov_owner_props AS (
  SELECT ... FROM entity_effective_role eer
    JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id
         AND f.is_current AND f.source_domain = 'gov'      -- holds a CURRENT gov asset
    JOIN lcc_property_attributes   a ON a.source_domain = f.source_domain
         AND a.source_property_id = f.source_property_id
  WHERE EXISTS (SELECT 1 FROM owner_contact_pivot ocp     -- ← and is REACHABLE
                 WHERE ocp.entity_id = eer.entity_id
                   AND ocp.active_contact_entity_id IS NOT NULL)
)
```

**The `effective_owner_role` predicate is gone entirely** — no role filter remains on P1/P2/P3/P8.
`eer.effective_owner_role` is still SELECTed and still rendered on the card; it no longer decides
eligibility.

### What it used to be, and why that mattered

```sql
  WHERE eer.effective_owner_role = ANY (ARRAY['developer','user_owner'])   -- RETIRED 2026-08-29
```

`effective_owner_role` = `COALESCE(entities.behavioral_override, entities.owner_role)`. It
reconciled to the row: gov properties with a current owner fact + attributes + a lease expiring
≤24 months = **1,216**; add the role predicate = **74**; observed P1 = **74**. Not value-gated, not
cadence-gated, not opportunity-gated, not stale — **just the wrong grain** (§4, Class 24).

### The role column — still true, and still the reason C4a is open

| `effective_owner_role` | live entities (66,874) | reachable by `gov_owner_props` | of 5,992 resolved owners |
|---|---:|---:|---:|
| `unknown` | **62,554 (93.5%)** | **2,521** | **4,314 (72%)** |
| `buyer` | 3,591 | **2,432** | 1,567 |
| `developer` | 715 (1.07%) | 235 | 111 |
| **`user_owner`** | **0** | **0** | **0** |
| `operator` | — | 2 | — |

- ⚠️ **`user_owner` has no producer anywhere.** Named in the doctrine and — **still today** — in the
  **P0.4 and P0.5** arms, which C6 did not touch. **Written by nothing, ever.** Dead-End **Class 22**.
  Open as **C4b**.
  - ✅ **SUPERSEDED IN PART, 2026-09-01 (C13b).** `v_lcc_entity_roles` now exists and **carries a
    `user_owner` arm — which still reads 0, BY DESIGN**: Scott chose a **human-confirmed lane**
    (*"fairly infrequent"*) over an automated one, and the confirmation ledger ships empty. **So the
    count is unchanged and its MEANING is not** — *"nothing has ever written it"* has become *"the
    candidates are surfaced and nobody has confirmed one yet"* (**13 candidates**, 10 genuine on
    named rows). ⚠️ **Do NOT read the 0 as a dead arm any more, and do not "fix" it by automating
    it** — at n=13 reading them is both cheaper and strictly more accurate than any rule.
- **`developer` has a producer that is exhausted, not broken** —
  `lcc_developer_classification_log` = **285 rows lifetime**, candidates view down to **2 open**. It
  keys on `properties.developer_name`, so it can only find parties a domain DB already labelled.
  ⚠️ **That is the N18 view** — whose ranking N18 found was arbitrary, not knowing it sits upstream
  of the ranked call list.
  - ⚠️ **C13b corrected the count: `developer` is 718, not 838** — because **119 entities carry
    `owner_role='developer'` AND a human `behavioral_override` of `buyer`.** A manual override
    **REPLACES the column an arm reads; it does not sit beside it.** Emitting both would resurrect
    the machine call a human had already corrected.

### ✅ C8 (2026-08-29 diagnosed, SHIPPED 2026-08-31) — the role gate was on a SECOND surface

`handleProspectingBrief` (`api/operations.js`) — **the operator call sheet** — gated on
`owner_role IN ('developer','user_owner','buyer','seller_flipper','operator')`. Of **311** eligible
cadence rows it showed **80** ($442.8M); of the **231** excluded as `unknown`, **47 are resolved
property owners carrying $515.2M — more than everything it showed**. **Easterly ($114.9M, 85
properties), NGP Capital, USAA Real Estate, US Fed Properties Trust, Gardner Tanenbaum, GI Partners,
Trammell Crow, Clarion Partners** were all off the sheet. Evidence:
[`C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md`](../audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md).
**Same Class 24 defect as C6, different surface.** Shipped: admit on the per-asset fact
(`is_resolved_owner` — owns an asset in `lcc_property_owner`) **OR** a classified role, **AND NOT**
`is_brokerage`, on both arms. Migration `20260831120000` appends the two facts to
`v_bd_cadence_dashboard`; the policy stays in the handler. Guard
`test/c8-prospecting-brief-gate.test.mjs` (5 tests, 8 mutations RED).

| eligible cadence rows | before | after |
|---|---:|---:|
| served by the gate | **80** | **126** |
| rank value | $442,805,301 | **$957,742,929** |
| brokerages admitted | **1** | **0** |
| genuinely unclassified (`unknown`, no assets) | excluded (181) | excluded (181) |

⚠️ **THE PREDICTED 127 WAS 126, AND THE MISSING ROW IS THE FINDING.** The audit sized the brokerage
population by reading only the **excluded** half and found 3. There are **4**: **`Stan Johnson Co`
carries `owner_role='buyer'` and was being SHOWN** ($238,700). Making the guard explicit on both
arms drops it — so the delta is +47 −1, not +47. **A population counted on one side of a gate is not
the population.**

⚠️ **The four brokerage-flagged rows, read individually** (the P116 false-positive check the audit
asked for): `Coldwell Banker Commercial Realty` and `Stan Johnson Co` are genuine brokerages;
`Northmarq Support` is our own firm; **`Clark Matthews` is the documented false positive** — the
pattern matches bare `\mmatthews\M` and caught a person's SURNAME. It costs nothing: he is
`unknown`, owns no asset, and fails the OR arm regardless. **The guard changes the outcome for
exactly ONE of the four**, and that one is real.

⚠️ **At the default `limit=10`, NINE of the ten call-sheet slots change.** Easterly enters at rank 2
behind Boyd Watterson; NGP Capital, USAA Real Estate, US Fed Properties Trust, Elman Investors,
Trammell Crow and Beacon Capital all reach page 1 for the first time. This is a reach fix, not a
count fix.

### ✅ The role-gate sweep — there is no third surface (2026-08-29)

Over **all 14** `public` views mentioning `owner_role` and every JS hit in `api/` + the SPA:
**exactly TWO gates exist in the whole system** — `v_priority_queue_live` (the view) and
`api/operations.js:4807` (the prospecting brief). Everything else **selects** the column for
display, a `select=` list, or a write. **C6 fixed the first; C8 completes the Class 24
remediation.**

⚠️ **Positive-controlled** (Class 11): the detector fired on the known true positive and correctly
classified `v_bd_cadence_dashboard` as *selects only* — its gate is in JS. ⚠️ **Limits:**
`pg_views.definition` is deparsed (P182), and a gate expressed as a JOIN to a role table, inside a
function, or in an RLS policy would not match. **Views + JS handlers only.**

### ✅ C8 SHIPPED 2026-08-31 — 80 → 126, and two defects found on the way

Migration `20260831120000` appends `is_resolved_owner` + `is_brokerage` to
`v_bd_cadence_dashboard`; `handleProspectingBrief` composes them with `BD_OWNER_ROLES`. Guard
`test/c8-prospecting-brief-gate.test.mjs`.

⚠️ **Landed 126, not the predicted 127 — and the miss was informative.** Every other figure
reproduced exactly. **§2 sized the brokerage population by reading only the EXCLUDED half: there are
4 brokerages among the 311, not 3.** `Stan Johnson Co` carries `owner_role='buyer'` and **was being
shown**; making the guard explicit on both arms drops it, so the delta is **+47 − 1**.
**A population counted on one side of a gate is not the population.**

⚠️ **The P116 false positive appeared and cost nothing:** of the 4 flagged, `Coldwell Banker
Commercial Realty`, `Stan Johnson Co` and `Northmarq Support` are genuine; **`Clark Matthews` is the
documented bare-surname false positive** — but he is `unknown`, owns no asset, and fails the OR arm
anyway. **The guard is outcome-bearing for exactly one of the four.**

**At the default `limit=10`, 9 of 10 slots change** — Easterly enters at rank 2; NGP Capital, USAA,
US Fed Properties Trust, Elman, Trammell Crow and Beacon reach page 1 for the first time.
**This is a REACH fix, not a count fix.**

### ✅ C8c — the brief rendered "Unknown … rent unknown" on EVERY row — FIXED as C10 (2026-08-31)

`handleProspectingBrief` mapped `c.name` / `c.company_name` / `c.annual_rent` / `c.priority_signal`;
the view supplies **`entity_name`** / *(none)* / **`rank_value`** / *(none)*. **Four of six
meaningful fields were dead on the queue path** — only email, domain, days-overdue and phase
survived.

⚠️ **C8 had just put Easterly, NGP and 45 other resolved owners on this sheet and every one rendered
as "Unknown".** And it plausibly explains why the role gate went unexamined so long: **a sheet where
every row reads *"Unknown — unknown [mixed] … rent unknown"* is not one anyone works.** Two defects,
each making the other harder to see.

✅ **Fixed 2026-08-31 — rendering only; the gate, ordering and limit are untouched and the count
held at 126.** Easterly now reads *"$114,864,150 across 85 properties"*. Full writeup:
`docs/audits/C10_PROSPECTING_BRIEF_COLUMN_MAPPING_2026-08-31.md`; guard
`test/prospecting-brief-column-mapping.test.mjs` (5 mutations RED).

⚠️ **Two of the C10 brief's own predictions were wrong.** (1) *"every row has a `rank_value`"* — **4
of 126 are NULL**; they sort last so they are unreachable at `limit ≤ 25`, but the renderer prints
`not on file` and tests `Number.isFinite`, **not truthiness**, so a genuine **$0** survives as `$0`
(P180). (2) **`[mixed]` was never a mapping defect** — `domain` is genuinely NULL on **93 of 126
(74%)** — **and it was still wrong**, because rendering a null as `[mixed]` asserts the owner spans
verticals. The view carries a real `is_cross_vertical` column that nothing reads (**C10a**).

⚠️ **`/yr` was dropped from the value.** `rank_value` is relationship-derived for a large minority of
rows (**C9a**); *"Portfolio value"* is honest, but the `/yr` suffix still claimed an annual basis a
connected-property value does not have. The prompt now states that rule to the model too.

⚠️ **The defect had reached a WRITE surface.** `getFollowUpSuggestions` (`app.js:8674`) reads
`contacts[0].name`, so the chip read **"Draft email to Unknown"** and fired `draft_outreach_email`
with `contact_name: 'Unknown'`.

✅ **C10b — SHIPPED 2026-08-31 as C11.** *"Now the sheet is legible it will confidently name a
person at the wrong firm."* The sheet now states the BASIS on which each person is the contact: the
role recorded on the owner→contact `entity_relationships` edge — `prospecting_contact` 58 ·
`institution_decision_maker` 35 · `manager` 15 · **`works_at` 12** · `decision_maker` 1 · **no edge
at all 5** — with `works_at` labelled ***association only (Salesforce org edge), not evidence of
authority*** (the edge P161 measured and disqualified), and a null edge rendered as *"no
relationship on file"* rather than blank. Two appended view columns (`20260831140000`, applied) plus
one JS change; rows held at **126 → 126**. Writeup:
`docs/audits/C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md`.

⚠️ **Count the VALUE, not just the rows — it inverts the priority.** `works_at` is 10% of the sheet
and the **second-largest value block, $130.7M — 2.3× the 35 `institution_decision_maker` rows** —
and **3 of the current top 10** (USAA Real Estate, Gba Associates, Beacon Capital). The weakest
evidence sits at the head of the sheet and was rendering identically to `decision_maker`.

⚠️ **The corroboration figure recorded here was wrong: it is 22 of 113, not 16.**
`lcc_tier0_company_confirms_domain(p_company, p_sldn)` takes the second-level **LABEL**, and passing
the whole domain kills its reverse arm — losing `truist.com`, `brookfield.com`, `highwoods.com`,
`beaconcapital.com`, `acquestdevelopment.com` and `tiaa-cref.org`, all genuine on named rows. It is
**still a LOWER BOUND** (P188: Easterly's own confirmed contact is on `@centurytel.net`), it is
rendered as an **additive positive only**, and **nothing filters, ranks or demotes on it** —
doing so would drop ~91 real owners and re-create the Class 24 mistake C8 has just finished undoing
on this surface.

⚠️ **Re-measured 2026-08-31: only 12 of the 126 owners are on the Tier 0 confirm lane, so "route it
to Tier 0" is NOT the answer** — that lane selects on a different basis and does not cover this
population. **The fix is to PRINT THE BASIS, never to filter on corroboration**: filtering would
drop ~97 rows on a lower bound and re-create the Class 24 mistake C8 just fixed. Prompt:
`docs/claude-code/prompts/C11-prospecting-brief-show-the-relationship.md`.

🔴 **C8a — the fallback branch is ungated AND structurally dead** (`engagement_score` = 0 on all
30,714 gov `unified_contacts` rows). Not a `V2_MAP` gate failure: it is a different source that
never carried the gate and structurally cannot. **Do not repair it; decide whether to delete it.**

### ⚠️ C9 (2026-08-29) — the merge backlog now lands on these surfaces

Three live entities share `canonical_name = 'brandywine realty'`, none merged: **assets + contact on
one, cadence + 36 edges on another** — the P177/P198 split. **The detector is NOT broken**: it
surfaced the group at `member_count = 3, auto_mergeable = false` and correctly refused to auto-merge
genuine name variance. **It has never been reviewed.**

**181 of the 303 C6 callable owners (60%)** share a canonical name with another live entity — but
⚠️ **that is EXPOSURE, and the measured defect rate is far smaller.** Of **5,131** canonical-name
groups with ≥2 live organizations:

| | groups |
|---|---:|
| **TRUE splits** — facts on one member, cadence/contact on another | **45 (0.9%)** |
| **edge splits** — the fact-less twin holds MORE relationship edges (P177's shape) | **434** |

**Scope the review lane to the 45.** The 434 **under-rank** rather than misdirect a call (**C9b**).

⚠️ **A metric trap that fired here: `lcc_property_owner` is NOT `lcc_entity_portfolio_facts`.**
Counting "assets" via the resolved-owner table gave a plausible **33** that meant nothing — reading
the rows showed case-variant pairs where **both** members hold zero. **The deal-timing bands read
`lcc_entity_portfolio_facts` on `is_current`;** an entity can hold current facts and be correctly
queued with no `lcc_property_owner` row. Two ownership tables, two questions.

**C6 is what changed the cost.** Before it, 74 owners reached these bands and duplicates were
hygiene. Now **303 owners are on a call sheet ranked by a value that lives on whichever twin holds
the portfolio fact**, while the contact may be on the other. Evidence:
[`C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md`](../audits/C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md).

⚠️ **Do not bulk-merge** (P195's hazards stand; `lcc_apply_fuzzy_merges` is deliberately unwired).
**Winner rule is ownership-first** — the survivor is the asset+contact holder, not the
more-connected twin.

### ⚠️ C4b RESOLVED — and my earlier sizing of it was wrong

**Removing `user_owner` from the four remaining predicates is a literal no-op** (0 rows). The
earlier note here — *"a gate arm that has never matched a row still governs 46% of the surface"* —
**conflated the GATE with the ARM.** The gate on P0.4/P0.5 is load-bearing; the token inside it is
inert. Both `user_owner` **and `seller_flipper`** are 0 of 66,874, and `unknown` (93.9%) is **not in
the declared vocabulary at all**.

⚠️ **And the P0.4 gate is genuinely load-bearing — Class 23 in mirror image.** P0.4's universe is
**703 gated vs 66,167 ungated (94×)**, because unlike `gov_owner_props` the P0.4/P0.5 arms have **no
bounding JOINs**. **So the 62,554 figure C4 §5 wrongly applied to `gov_owner_props` is CORRECT
here** — it was the right number attached to the wrong arm. **The same predicate on two arms of one
view has completely different blast radii; measure each.** P0.4/P0.5/P5 keep their gate.

⚠️ **C6 removed the role gate from the four gov deal-timing bands ONLY. Four
`effective_owner_role = ANY (...)` predicates remain in the view** (live-verified 2026-08-29, count
taken off `pg_get_viewdef`): the two-value `('developer','user_owner')` form still gates **P0.4
(555) + P0.5 (148) + P5 (58) = 761 of the queue's 1,646 rows**, and `recent_acquirers`/P4 (12) uses
a three-value form that adds `'buyer'`. **So a gate arm that has never matched a row still governs
46% of the surface** — C4b is not cosmetic.

## 4. The two defects, and the fix

### Class 24 — a party-level label answering a per-asset question

**578 owners typed `buyer` hold a gov property with a lease expiring inside 24 months, carrying
$410.4M.** The labels are **correct** — Boyd Watterson (45 gov assets), Prologis, RMR Group, HC
Government Realty Trust genuinely are buyers. They are **also, right now, the owner of an expiring
building**. `owner_role` is a party-level identity; the bands ask a per-asset question — **and the
CTE has already joined `is_current = true`, then discards it.** A REIT is permanently a buyer and
permanently ineligible however many gov buildings it owns.

⚠️ **This class hides behind accurate data.** Every excluded label was right, so nothing looked
broken.

### The invisible population — ✅ the reachable half is CLOSED by C6

**As measured 2026-08-28 (pre-C6):** 1,924 owners held a current gov property with a P1/P2/P3 signal
and were invisible — 1,052 `buyer`, 871 `unknown` — of which **224 were contactable**.
⚠️ C4's "56 contactable" was P1-only and `unknown`-only; **224 was the figure to quote.**

**C6 surfaced the contactable ones. 303 owners now carry a deal-timing band.** ⚠️ **The
UNREACHABLE ~1,700 are still invisible, and that is deliberate** — surfacing them would emit
cadences that can never advance (P112). **They are a contact-acquisition backlog, not a queue
backlog**, and they are the Tier 0 / `v_owner_contact_enrich_queue` lane's population, not this
page's.

⏰ Pre-C6, 173 owners had a gov lease expiring within 90 days and were on no surface; 14 were
contactable. **All 14 now appear in P1** (17 rows). The named callable list (top 25 by top-asset
rent) is tabulated in
[`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md) §4.

⚠️ **`lcc_property_attributes` carries a DATE, not an OUTCOME** — renewal, extension and holdover
are indistinguishable in that column. **Read the asset before acting on any expiry date.**

### ⏰ P1 HAS A HARD LOWER EDGE — an asset leaves the band the morning after it expires (2026-08-31)

Re-measured two days after C6 shipped, on the day C5a's own deadline arrived. P1's predicate is
`lease_expiration >= CURRENT_DATE`, so **an asset drops out the day after its lease expires** —
silently, with no terminal state, and nothing recording that it was ever flagged.

**Live 2026-08-31: 6 P1 assets expire TODAY**, across 5 owners — Boyd Watterson (property 10776,
the row C5a named "three days out"), Greenleaf Management, Karen Curran, plus the pre-existing
`developer` owners Bains Holdings and Highwoods Realty.

⚠️ **5 of the 6 carry no other band on that asset**, and **Greenleaf Management and Karen Curran
have ZERO other queue rows at all** — tomorrow they leave the surface entirely. Boyd's *owner*
stays visible on its other 74 rows, which is the harder half to notice: **the asset stops being
flagged while the owner still looks covered.**

**This is not self-evidently a defect and must not be "fixed" by reflex.** A just-expired gov lease
is plausibly the peak seller conversation — holdover is a live tenancy — and the same column that
cannot tell renewal from termination cannot tell holdover from a vacated building (the
DATE-not-OUTCOME warning above, read the other way). Whether P1 should carry a short post-expiry
tail is a **band-semantics decision, not a view bug**. Sized here, not built: backlog **C6a**.

### C6 — SHIPPED 2026-08-29

The role predicate in `gov_owner_props` is replaced by *holds a current gov asset* (the
`f.is_current = true` join that was already there) **AND is reachable**. **P1/P2/P3/P8 only.**
All four predicted deltas hit exactly; six bands and all of dia held, positive-controlled at
1,681/565 (the same P5 shape with its gate dropped). **0 unreachable rows emitted.** Full evidence:
[`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](../audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md).

**Reachability = `owner_contact_pivot.active_contact_entity_id IS NOT NULL`** — the fact the Tier 0
arc (P188/P194) *writes* and `v_owner_contact_enrich_queue` already keys on.

✅ **Re-verified live 2026-08-31, two days on** — cache refreshed 3 min before the read and agreeing
with the live view on **all ten bands**; `unreachable_rows_emitted` **0**; `nongov_rows_in_gov_bands`
**0**; P5 still 58 against a positive control of 1,681 (565 dia). **P1 149 → 153 and P3 163 → 166 is
ordinary rolling-window drift, attributed exactly, not regression**: P1's 24-month upper edge
advanced two days and admitted **exactly 4** assets, with **0** falling off the lower edge (149+4=153).
⚠️ **The drift is NOT reachability** — 0 rows in the four bands have a pivot touched since C6. And
⚠️ `lcc_entity_portfolio_facts.updated_at` cannot attribute it either: the nightly re-upsert touches
most rows every day, so every source reads "written today" (the documented B4/B5 trap).

⚠️ **NOT `reachable_hero_qualified`, and `CLAUDE.md`'s instruction to quote it is not wrong.**
That instruction is about **reporting the reachability metric**; this is a **join predicate**, a
different job. `v_lcc_owner_reachability` is a **single-row aggregate** with no per-owner membership
to join to, and its `owners` CTE resolves through `lcc_property_owner` + asset entities — a
different population (overlap with the pivot: **263 of 1,441 / 495**). Reconstructing it inline
would be a second copy of a definition. It would also have gated *narrower* than what C5 graded —
**444 rows / 166 owners** instead of 620 / 303.

⏰ **All 14 owners with a gov lease expiring inside 90 days who were contactable and invisible now
appear in P1** (17 rows), in both the live view and the refreshed cache. **Boyd Watterson's
2026-08-31 is two days out.** ⚠️ Date ≠ outcome — read the asset.

## 4b. ✅ The call-sheet arc is COMPLETE — state as of 2026-08-31

C6 (gate) → C8 (admit resolved owners) → C10 (legibility) → C11 (contact basis) are all live.
**The sheet serves 126 rows, correctly gated, legible, each stating why that person is the contact.**

### ⚠️ C11a is REFUTED — `institution_decision_maker` 0-for-35 is the sponsor↔SPE pattern

It reads like a broken lane. Read on named rows it is the arc's most recurrent pattern:

| contact domain | rows | the owners using it |
|---|---:|---|
| **`ar-global.com`** | **6** | six `ARC GS…001, LLC` SPEs — **AR Global / American Realty Capital, the sponsor** |
| `princetonholdingsllc.com` | 2 | `HOUSTON TX I FGF` · `San Diego CA I FGF` |
| `usrealco.com` | 2 | `US Global Business Fund` · `US Union Square DC 999` |
| `hpitx.com` | 2 | `Hpi/Gsa - 1a` · `TEP Houston DHS` |
| gmail / aol | 7 | individual owners (`Pool Edwin J`, `Ronald J Rossiter`, `Crockett Ranch LP`) |

**34 contacts across 20 domains — they cluster because a sponsor's people serve its SPE family.**
The contacts are right; **`lcc_tier0_company_confirms_domain` structurally cannot confirm a
sponsor's domain against an SPE's name** (`ARC GSFFDME001` vs `ar-global`). Compare
`prospecting_contact`: 58 rows / 55 domains / 15 corroborated — near 1:1, a different provenance.

⚠️ **And the tempting fix was measured and rejected: wiring `lcc_owner_sponsor_domain` into the
corroboration signal rescues 1 of 34.** The map holds **8 confirmed rows**; only **4 sheet rows
fleet-wide** sit on a known sponsor domain, and `hpitx.com` — already confirmed — still fails
because `TEP Houston DHS` does not contain the `hpi` token. **Populate the map first (C2i); wiring
it is worthless until then.**

### ⚠️ C9's 45 true splits touch exactly ONE sheet row

**35 of the 126 rows sit in some canonical-name group; only 1 is a true split.** C9 remains a real
defect worth fixing on its own terms — but **it is not a call-sheet problem**, and this page should
not be read as saying it is.

### What is actually left on this surface — about 4 rows of 126

| | rows |
|---|---:|
| **C11b** — a cadence contact is **Scott himself** | 1 |
| **C11c** — brokerage guard is blind to a broker in the **contact** slot | 2 |
| **C9** — a true-split duplicate | 1 |

**The surface is in good shape. Further polishing here has sharply diminishing returns** — the
remaining leverage is upstream: **C4a** (what promotes an owner out of `unknown`, which still
governs the 57% data-work share) and **C7a** (mailbox coverage, the precondition under assignment,
voice, deal attribution and draft-assist alike).

## 5. ⚠️ The four traps, each of which produced a wrong answer first

1. **Class 23 — a predicate's blast radius belongs to the QUERY, not the column it names.** C4 first
   warned that widening to `unknown` admits **62,554 entities**. The CTE's two JOINs bound it to
   **2,521**, of which **3** are placeholder/brokerage names. **Wrong by 25×, in the cautious
   direction — which fails as a refusal**, gets written down, and is quoted as a reason not to ship.
2. **The naive per-asset rule is a 20× flood, not a narrow fix.** All five bands, all roles = **4,506
   rows / 3,622 owners**. **P5 is 83% of it** (58 → 1,681) and is the weakest signal in the set
   ("built 25+ years ago" implies no timing). **P5 keeps the role gate.**
3. ⚠️ **`aged_props` is NOT gov-scoped** — it joins `lcc_entity_portfolio_facts` with **no
   `source_domain` filter**, so **P5 covers dia** (26 → 565). Changing it is a cross-domain change;
   nothing in this arc has been.
4. **Reachability is load-bearing, not a nicety.** Without it the per-asset rule emits **3,235 rows
   over 2,719 owners of whom only 11% are contactable** — cadences that can never advance and only
   age into "overdue", the documented **P112** failure at scale. **Reachability is what converts a
   flood into a call list.**

## 6. Broker assignment — the bridge WORKS, is EMPTY, and building it now is premature

**Measured 2026-08-29 (C7).** Evidence:
[`C7_BROKER_ASSIGNMENT_IS_PREMATURE_2026-08-29.md`](../audits/C7_BROKER_ASSIGNMENT_IS_PREMATURE_2026-08-29.md).

| | |
|---|---:|
| `lcc_entity_owner_override` rows | **161** |
| …that resolve through `v_lcc_entity_point_person` | **161 (100%)** |
| **C6 deal-timing owners (P1/P2/P3/P8)** | **303** |
| …carrying an override / resolving a point person | **0 / 0** |
| `touchpoint_cadence` rows with `owner_user_id` | 48 of 2,304 (2%) |
| `v_priority_queue` rows with `owner_user_id` | 14 of 1,646 (0.9%) |

⚠️ **This is NOT a plumbing defect.** The documented three-user-table trap is real **and already
solved** — the email bridge resolves **100%** of what it is given. **What is missing is
assignments**, and the 161 that exist are **disjoint** from the 303 C6 owners. A propagation from
`lcc_entity_owner_override` → `touchpoint_cadence` would move **0 rows** for the population C6 just
surfaced: the **P137** class, reporting success while moving nothing.

⚠️ **Do NOT re-derive the mapping in JS.** `touchpoint_cadence.owner_user_id` FKs `users(id)`;
`lcc_entity_owner_override.owner_user_id` FKs `lcc_users(lcc_user_id)`; **none of the `lcc_users`
ids exist in `public.users`**, so stamping the override id FK-violates on every row. Go through
`lcc_cadence_point_person(uuid)` / `v_lcc_entity_point_person`.

### ⚠️ And there is no signal to derive an assignment from

*"Whoever corresponded with the contact owns the relationship"* is the obvious rule. Measured:
**263 of 303** C6 owners have a contact with an email; **13** have ever been emailed by anyone;
**1 distinct sender** across all of them. **One mailbox has ever been ingested**, so there is no
correspondence graph to assign from.

### The real reason, stated plainly

`lcc_users` holds **4** rows and one is active. Scott, this arc: *"I have not yet started to use the
LCC in our BD efforts."* **The queue belongs to nobody because the team has not started working it,
not because the bridge is broken.** Distributing 303 owners across four people, one active, solves
a problem nobody has yet.

⚠️ **Do NOT default-stamp all 303 to Scott.** That writes a fact nobody asserted into the column
every downstream surface reads as a real assignment — the "status nobody earned" failure (A5's
`gap_resolved`, B6b-lead's `filtered_multi_tenant`). A UI default or a filter is free; a written row
is not.

**The precondition worth building instead is mailbox coverage** — one ingested mailbox bounds every
relationship signal in the system, not just assignment (`contact-reconciliation-outbound.md` hits
the same limit on the outbound side). Filed as **C7a**; it was not filed anywhere before.

## 7. Decisions — made, open, and refused

| | |
|---|---|
| ✅ **`buyer` exclusion is a category error** | C4e, answered by C5 §2 on named rows |
| ✅ **P5 keeps the role gate** | 83% of the flood, weakest signal, cross-domain |
| ✅ **Reachability gates the widening** | P112; converts 2,719 owners → 303 callable. **Shipped as the pivot's `active_contact_entity_id`, not `reachable_hero_qualified`** — the latter is an aggregate with no membership surface and a different population (C6 §4) |
| ✅ **C6 shipped — the band fires on current holding** | 2026-08-29; four predictions hit exactly, six bands + dia held |
| ✅ **C8 shipped — the call sheet admits resolved owners** | 2026-08-31; 80 → **126** rows, +$515.2M. Predicted 127, landed 126 — the audit had counted brokerages on one side of the gate only |
| 🔴 **C8a — the brief's fallback branch is ungated AND structurally dead** | `engagement_score` is 0 on all 30,714 gov `unified_contacts` rows, so `gt.0` returns nothing; it also reads the frozen pre-cutover gov snapshot, not the `CONTACTS_HUB=ops` hub. A latent fail-open, not a live one |
| ✅ **C8c — every call-sheet row rendered "Unknown"** | **FIXED 2026-08-31 as C10.** Mapped onto the real columns; count held at 126, gate/order/limit untouched. Guard `test/prospecting-brief-column-mapping.test.mjs` (5 mutations RED) |
| ✅ **C10b — FIXED 2026-08-31 as C11** | The sheet now states the BASIS: the role on the recorded owner→contact edge (`prospecting_contact` 58 · `institution_decision_maker` 35 · `manager` 15 · **`works_at` 12, labelled *association only* per P161** · `decision_maker` 1 · **no edge 5**), plus employer corroboration as an ADDITIVE POSITIVE. ⚠️ **Corroboration is 22 of 113, not 16** — the old figure passed a whole domain into `p_sldn`, which wants the second-level LABEL. Rows held at 126; nothing filters or ranks on corroboration. `docs/audits/C11_CALL_SHEET_CONTACT_BASIS_2026-08-31.md` |
| 🔴 **C10a — `is_cross_vertical` is unread** | The view carries the honest source for "mixed"; the renderer now says `domain not on file` instead of asserting it |
| 👤 **C4a — what promotes an owner out of `unknown`** | ✅ **DESIGNED + CORRECTED 2026-08-31 — [`owner-role-classification.md`](owner-role-classification.md).** ⚠️ **Scott corrected both definitions.** **`user_owner` is the owner-OCCUPIER** (tenant acquires the fee to occupy) — **not "holds an asset", which was my draft and would have mislabelled 6,308 landlords.** Signal is **owner ≈ tenant on the same property**: **13 candidates, ~10 genuine**, and at that size **human confirmation beats any name rule** (accuracy first). **`former_owner`** = 3,795, all gov/dia, **191 contactable** — repeat sellers are the model. ⚠️ **Newly visible and bigger: no role describes the ordinary owns-and-leases-out landlord (6,308).** Five open questions in §6. |
| 👤 **C4b — `user_owner`: fill the arm or remove it** | ✅ **Settled in principle by C12: it is not a mistake to remove — it is a role with an obvious producer nobody built.** *Holds a current asset* is exactly what the token means (3,217 candidates). **Its disposition follows C4a's decision and should not be decided separately.** |
| 🔴 **C4d — marketing / deal-execution actions are not inventoried** | The other half of "compared to the balance of the leads or marketing activities." **That inventory does not exist today**; a cross-surface weighting cannot be built until it does |
| ⛔ **C4c broker assignment — do NOT build yet** | C7: the bridge resolves 161/161; **0 of the 303 C6 owners has an assignment** and the sets are disjoint, so a propagator moves 0 rows (P137). No derivation signal — 13 of 303 ever emailed, 1 sender. 4 users, 1 active |
| ❌ **Do NOT default-stamp the 303 to Scott** | Writes a fact nobody asserted into the column every surface reads |
| ❌ **Do NOT widen the gate to `unknown` alone** | Without reachability it is the P112 failure at scale |
| ❌ **Do NOT write a name-based role classifier** | ~25% raw in this arc (P189, A3), 7% (P198), 4-of-6 guarded. A role deciding *whether we call someone* is a worse home for that than a merge candidate |
| ❌ **`lcc_looks_like_person` is not a census** | `CITY OF SALEM`, `BROOME COUNTY`, `USAA Real Estate` (A2a/A3/P196) |

⚠️ **Firing a band is not choosing the pitch.** `account-based-contact-intelligence.md` is explicit
that acquisitions and disposition are different contacts, tones and buckets, and the buy-side
relationship is the funnel *into* the disposition conversation. C6 makes the signal visible; the
bucket is C4a.

## 8. Evidence trail

| audit | what it established |
|---|---|
| [`C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md`](../audits/C4_RANKING_LAYER_ROLE_GATE_2026-08-28.md) | the gate; `user_owner` = 0; the exhausted classifier; **§5 carries the 25× self-correction** |
| [`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md) | the `buyer` category error; the callable list; **§5b carries the P5/P8 sizing** |
| Dead-End playbook **Class 22 / 23 / 24** | gate arm that never matches · blast radius belongs to the query · party label vs per-asset question |
| [`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](../audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md) | **the build.** Four exact hits; the deparse-diff verification; why not `reachable_hero_qualified`; **§3 — the predicted "497 rows" is an ASSET count, not a row count** |
| `docs/claude-code/prompts/C6-...md` | the build brief, with the predicted deltas |

**Canonical section:** `connectivity-and-open-threads.md` **§4o + §4p + §4q**.
