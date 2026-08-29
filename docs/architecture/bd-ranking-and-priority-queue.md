# BD Ranking & the Priority Queue — the canonical page

> 📍 **ALL work on the ranked call list starts here.** One door into C4 → C5 → C6: what the queue
> is, why it reaches 4% of resolved owners, what has been measured, what is decided, and what is
> deliberately still open.
>
> **Sibling canonical pages:** [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md)
> (the chain end to end — this page owns its **last hop**) ·
> [`tier0-owner-contact-system.md`](tier0-owner-contact-system.md) (person ↔ owner) ·
> [`ownership-history-lane.md`](ownership-history-lane.md) (ownership depth) ·
> [`account-based-contact-intelligence.md`](account-based-contact-intelligence.md) (**who** to call
> and **in what tone** — this page decides *whether the signal fires*, that one decides *the pitch*).
>
> **Status: C6 SHIPPED 2026-08-29** — `gov_owner_props` now gates P1/P2/P3/P8 on *holds a current
> gov asset* **AND** *is reachable*, replacing the party-level role gate. **P1 74 → 149 · P2 32 → 95 ·
> P3 61 → 163 · P8 76 → 213; 303 owners, every one callable.** P5, P0.4, P0.5, P-CONTACT, P-BUYER, P4
> and all of dia unchanged (positive-controlled). Migration
> `supabase/migrations/20261002110000_lcc_c6_current_holding_seller_bands.sql`; evidence
> [`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](../audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md).
> **C4a (the pitch/bucket) and C4b (`user_owner`) remain open and are Scott's.**

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
- **`developer` has a producer that is exhausted, not broken** —
  `lcc_developer_classification_log` = **285 rows lifetime**, candidates view down to **2 open**. It
  keys on `properties.developer_name`, so it can only find parties a domain DB already labelled.
  ⚠️ **That is the N18 view** — whose ranking N18 found was arbitrary, not knowing it sits upstream
  of the ranked call list.

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

### C6 — SHIPPED 2026-08-29

The role predicate in `gov_owner_props` is replaced by *holds a current gov asset* (the
`f.is_current = true` join that was already there) **AND is reachable**. **P1/P2/P3/P8 only.**
All four predicted deltas hit exactly; six bands and all of dia held, positive-controlled at
1,681/565 (the same P5 shape with its gate dropped). **0 unreachable rows emitted.** Full evidence:
[`C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md`](../audits/C6_CURRENT_HOLDING_SELLER_BANDS_2026-08-29.md).

**Reachability = `owner_contact_pivot.active_contact_entity_id IS NOT NULL`** — the fact the Tier 0
arc (P188/P194) *writes* and `v_owner_contact_enrich_queue` already keys on.

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

## 6. Broker assignment — hop 6, barely started

| | |
|---|---:|
| `touchpoint_cadence` rows | 2,301 |
| …carrying `owner_user_id` | **48 (2%)** |
| `v_priority_queue` rows carrying `owner_user_id` | **14 of 1,646 (0.9%)** |

BREAK-2 measured 7 in August; 48 now — real movement, still ~2%.

⚠️ **C6 made this worse in relative terms, not better:** the queue grew by 377 deal-timing rows and **none of them carries an owner.** A ranked call list that belongs to nobody is the next constraint — **C4c**.

⚠️ **Do NOT re-derive the mapping in JS. Three different user tables:**
`touchpoint_cadence.owner_user_id` FKs `users(id)`; `lcc_entity_owner_override.owner_user_id` FKs
`lcc_users(lcc_user_id)`; **none of the `lcc_users` ids exist in `public.users`**, so stamping the
override id FK-violates on every row. **The bridge is email, resolved once by
`lcc_cadence_point_person(uuid)` / `v_lcc_entity_point_person`.**

## 7. Decisions — made, open, and refused

| | |
|---|---|
| ✅ **`buyer` exclusion is a category error** | C4e, answered by C5 §2 on named rows |
| ✅ **P5 keeps the role gate** | 83% of the flood, weakest signal, cross-domain |
| ✅ **Reachability gates the widening** | P112; converts 2,719 owners → 303 callable. **Shipped as the pivot's `active_contact_entity_id`, not `reachable_hero_qualified`** — the latter is an aggregate with no membership surface and a different population (C6 §4) |
| ✅ **C6 shipped — the band fires on current holding** | 2026-08-29; four predictions hit exactly, six bands + dia held |
| 👤 **C4a — what promotes an owner out of `unknown`** | **Scott's, doctrine not code.** Recorded facts available, none adopted: portfolio shape · `purchases` edges (repeat investor vs one-off — his own distinction, already modelled) · `is_operator_not_owner` (P113) · deed/B5 party roles |
| 👤 **C4b — `user_owner`: fill the arm or remove it** | Leaving it is how C4 stayed invisible |
| 🔴 **C4d — marketing / deal-execution actions are not inventoried** | The other half of "compared to the balance of the leads or marketing activities." **That inventory does not exist today**; a cross-surface weighting cannot be built until it does |
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
