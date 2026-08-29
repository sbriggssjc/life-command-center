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
> **Status: DIAGNOSED, NOT YET BUILT.** Nothing in C4/C5 was written to a live system. The build is
> **C6**, prompt at `docs/claude-code/prompts/C6-per-asset-band-eligibility-with-reachability.md`.

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

### The bands, as of 2026-08-28

| band | reason | rows | of which resolved owners |
|---|---|---:|---:|
| **P0.4** | `resolve_ownership_control` | **552** | 58 |
| **P-CONTACT** | `select_prospecting_contact` | **231** | 130 |
| **P0.5** | `open_bd_opportunity_needed` | **148** | 46 |
| P8 | `agency_active_solicitations` | 76 | 49 |
| P1 | `lease_expiry_24mo` | 74 | 34 |
| P3 | `ten_year_window` | 62 | 27 |
| P5 | `aged_building_value_add` | 58 | 43 |
| P2 | `firm_term_ending_24mo` | 32 | 18 |
| P-BUYER | recent buyer activity | 22 | 17 |
| P4 | `recent_acquisition_streak` | 12 | 9 |

**931 of 1,267 rows (73%) are data-completion work, not calls.** ~336 are deal-timing signals.
**Only 256 of 5,992 resolved owners (4.3%) appear anywhere in the queue.**

⚠️ The 73% is **not itself a defect** — P0.4/P0.5 are doctrinal producers with named consumers. But
a surface three-quarters data-completion trains the operator to skim it, which is the
badge-that-is-noise failure one level up.

## 3. ⚠️ The gate — the single most important fact on this page

Every gov deal-timing band (P1/P2/P3/P8) reads one CTE:

```sql
gov_owner_props AS (
  SELECT ... FROM entity_effective_role eer
    JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id
         AND f.is_current AND f.source_domain = 'gov'          -- ← the per-asset fact, already here
    JOIN lcc_property_attributes   a ON a.source_domain = f.source_domain
         AND a.source_property_id = f.source_property_id
  WHERE eer.effective_owner_role = ANY (ARRAY['developer','user_owner'])   -- ← the entire gate
)
```

`effective_owner_role` = `COALESCE(entities.behavioral_override, entities.owner_role)`.

**It reconciles to the row:** gov properties with a current owner fact + attributes + a lease
expiring ≤24 months = **1,216**; add the role predicate = **74**; observed P1 = **74**.
**Not value-gated, not cadence-gated, not opportunity-gated, not stale.**

### The role column

| `effective_owner_role` | live entities (66,874) | reachable by `gov_owner_props` | of 5,992 resolved owners |
|---|---:|---:|---:|
| `unknown` | **62,554 (93.5%)** | **2,521** | **4,314 (72%)** |
| `buyer` | 3,591 | **2,432** | 1,567 |
| `developer` | 715 (1.07%) | 235 | 111 |
| **`user_owner`** | **0** | **0** | **0** |
| `operator` | — | 2 | — |

- ⚠️ **`user_owner` has no producer anywhere.** Named in the gate, in P0.4/P0.5 and in the doctrine;
  **written by nothing, ever.** Dead-End **Class 22**.
- **`developer` has a producer that is exhausted, not broken** —
  `lcc_developer_classification_log` = **285 rows lifetime**, candidates view down to **2 open**. It
  keys on `properties.developer_name`, so it can only find parties a domain DB already labelled.
  ⚠️ **That is the N18 view** — whose ranking N18 found was arbitrary, not knowing it sits upstream
  of the entire ranked call list.

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

### The invisible population

**1,924 owners hold a current gov property with a P1/P2/P3 signal and are invisible** — 1,052
`buyer`, 871 `unknown`. **224 are contactable today.** ⚠️ C4's "56 contactable" was P1-only and
`unknown`-only; **224 is the figure to quote.**

⏰ **173 owners have a gov lease expiring within 90 days and are on no surface; 14 contactable.**
The named callable list (top 25 by top-asset rent) is tabulated in
[`C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md`](../audits/C5_CALLABLE_TODAY_AND_THE_BUYER_EXCLUSION_2026-08-28.md) §4.

⚠️ **`lcc_property_attributes` carries a DATE, not an OUTCOME** — renewal, extension and holdover
are indistinguishable in that column. **Read the asset before acting on any expiry date.**

### C6 — the build

Replace the role predicate in `gov_owner_props` with *holds a current gov asset* (already joined)
**AND is reachable**. **P1/P2/P3/P8 only.**

| band | today | after |
|---|---:|---:|
| P1 `lease_expiry_24mo` | 74 | **149** |
| P2 `firm_term_ending_24mo` | 32 | **95** |
| P3 `ten_year_window` | 62 | **163** |
| P8 `agency_active_solicitations` | 76 | **213** |
| **total** | **244 rows** | **497 rows / 303 owners** |

**Must not move:** P5 (58) · P0.4 (552) · P0.5 (148) · P-CONTACT (231) · P-BUYER (22) · P4 (12) ·
all dia.

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
| `v_priority_queue` rows carrying `owner_user_id` | **14 of 1,267 (1%)** |

BREAK-2 measured 7 in August; 48 now — real movement, still ~2%.

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
| ✅ **Reachability gates the widening** | P112; converts 2,719 owners → 303 callable |
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
| `docs/claude-code/prompts/C6-...md` | the build, with predicted deltas to assert against |

**Canonical section:** `connectivity-and-open-threads.md` **§4o + §4p**.
