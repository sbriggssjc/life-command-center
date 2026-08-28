# BD pipeline funnel — where ownership history actually locks

**Measured 2026-08-28 (Cowork), live against all three databases.**
Commissioned by Scott: *"reaudit the system to assess where the biggest backlogs or locks are —
data ingestion and processing driving forward to the next actionable step, property by property and
then owner by owner, until we have a connected history of ownership of all of our target markets
all the way back to the developer through now."*

> **Every prior audit in this arc measured QUEUED WORK.** That only ever sees the symptom. This one
> measures the **funnel** — property → owner → chain → developer → contact → next action — and asks
> where a property stops progressing.

---

## 1. The funnel (gov)

| stage | count | of live |
|---|---:|---:|
| properties | 20,492 | — |
| **live** (excl. 6,657 archived) | **13,835** | 100% |
| has a domain `true_owner` | 9,830 | 71% |
| **has an LCC owner link** | **6,362** | **46%** |
| …of which **only the current owner** | 4,845 | 76% of linked |
| **has a chain (2+ links)** | **1,517** | **11%** |
| **has 2+ HISTORICAL links** | **149** | **1.1%** |

dia, for contrast: 2,075 linked · 1,505 with a chain · 568 with 2+ historical · deepest chain **14**
(gov's deepest is 6). **dia is materially further along on chain depth than gov.**

**Owner → action** (both domains): 6,480 distinct current owners · 5,462 in `owner_contact_pivot` ·
**1,439 with an active contact (26%)** · 2,302 cadences, of which **2,276 are due (99%)**.

## 2. The locks, ranked

### ✅ Lock 1 — RESOLVED 2026-08-28 (B1). The floor is now split by consumer.

> **Shipped:** `supabase/migrations/20260828120000_lcc_b1_split_chain_value_floor.sql`.
> Writeup: [`B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md`](B1_CHAIN_VALUE_FLOOR_SPLIT_2026-08-28.md).
> Canonical: [`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md).
>
> ⚠️ **Three numbers below were corrected by the build, and they change what the finding means:**
> **(1)** "1,548" is `establish_ownership_history` across BOTH domains — gov 1,501 + dia 47 — and
> `trace_ownership_to_developer` carries a further 983 below-floor skips this audit never mentioned.
> **(2)** Only the gov slice has an automated consumer: **dia has no
> `v_ownership_transitions_portfolio`**, so a dia task can never be drafted. dia and
> `trace_ownership_to_developer` keep the $500k floor — 1,030 rows held by design.
> **(3)** The re-openable set is **1,414**, not 1,548: 86 are no longer suggested by the worklist
> and 1 already had an open task.

### 🔒 Lock 1 (as originally measured) — the $500k value floor is skipping 1,548 properties, and it now gates FREE work

**1,548 of 1,766 skips** in `establish_ownership_history` are `below_value_floor` at **$500,000**
(last applied 2026-07-31). That is **five times the 314 the lane has completed.**

**This was the right decision when it was made and is the wrong one now.** The floor exists because
the lane was a **human research queue** — and nobody should hand-research a $50k property. But
since **A2 (2026-08-27)** the `agrees` bucket is **applied automatically by cron 244** from a
deterministic, record-cited draft. **No human touches it. The marginal cost of a chain is now
approximately zero.**

So a floor sized for operator attention is now suppressing work that costs nothing — and it is
suppressing precisely the *coverage* Scott asked for. **A value gate belongs on what reaches a
human, not on what a cron applies.**

⚠️ **This is not "remove the floor."** The right shape is almost certainly **two floors**: none (or
a much lower one) for the automated `agrees` path, and the existing $500k for anything that
surfaces to a person (`mismatch`, `all_guarded`). **That distinction did not exist when the floor
was set, because the automated path did not exist.**

### 🔒 Lock 2 — ~3,468 gov properties have a domain owner that never reached the entity graph

9,830 have a `true_owner`; only 6,362 carry an LCC owner link. **Nothing downstream can touch the
difference** — not the chain, not contact resolution, not cadence. This is the documented
*"asset-identity coverage is what gates owner resolution"* gate, measured at the property level.

### 🔒 Lock 3 — 74% of pivot owners have no active contact

1,439 of 5,462. Known and already routed (Tier 0, contact acquisition, the egress-blocked SOS
path); recorded here for funnel completeness rather than as a new finding.

### 🔒 Lock 4 — the cadence surface is 99% overdue

**2,276 of 2,302 cadences are due.** A surface that is entirely red carries no signal: it cannot
distinguish urgent from stale, so it trains the operator to ignore it. **This is the
badge-that-is-noise failure at the scale of a whole surface**, and it has not been audited in this
arc.

## 3. Against Scott's stated goal

*"A connected history of ownership of all of our target markets all the way back to the developer."*

> ✅ **UPDATED 2026-08-28 after B1.** gov properties with **any** ownership history
> **1,272 → 2,173**; with a **chain (2+ historical links) 149 → 177**; the lane's completions
> **336 → 1,237** — and the operator's `human_actionable` badge did **not** move off **55**.
> ⚠️ **`any_history` moved 7× harder than `chain_2plus`, and that is the population, not a
> shortfall** — only 210 of the 1,501 below-floor properties carry ≥2 guard-passing transitions.
> **The binding constraint on chain DEPTH is now the A2-blocked residue** (`ambiguous_entity`
> 126 links / 123 properties, the A2a merge class), not the value floor.

**As measured: 149 of 13,835 live gov properties (1.1%) have two or more historical owner links.** The
machinery to change that is **built, proven and running** — A1 split the lane, A2 applies chains
nightly, A3/A4/A4b route the residue, and it produced **314 completions and 304 facts in one day**
after 69 days at zero.

**It is not short of machinery. It is short of population**, and the largest single reason is a
value floor that predates the automation.

## 4. Recommendation

1. ✅ **DONE (B1, 2026-08-28)** — floor split by consumer; 1,414 re-opened, reversibly.
   ⚠️ **The next constraint is NOT another floor:** it is the A2-blocked residue
   (`ambiguous_entity` 126 links / 123 properties — the A2a duplicate-entity merge, which applies
   unaided once done). `trace_ownership_to_developer` (983) and dia (516) remain gated, deliberately.
2. **Then measure the linkage gap (Lock 2)** — ~3,468 properties. Ask *why* the owner never became
   an entity before building anything; the gov `owner_needs_salesforce` lane just taught us that a
   zero can be a key-space artifact rather than a coverage fact.
3. **Audit the cadence surface separately (Lock 4)** — 99% overdue is its own finding.

⚠️ **Re-measure before acting.** The `establish_ownership_history` worklist currently suggests
**1,834** properties and `trace_ownership_to_developer` **1,729**; both move as A2 completes chains
and re-seeds the next question. Quote your own numbers.
