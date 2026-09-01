# C13b — the owner-role classification, as a SET of labels

> ⛔ **This SUPERSEDES `C13-owner-role-derived-classification.md`, which must not be run** — it
> encodes a precedence-ordered single role, refuted on **957 entities**.

**Read first:** `docs/architecture/owner-role-classification.md` — **the whole page**; it is the
design and carries the measurements, Scott's definitions verbatim (§2c-i), and the corrections
(§2e, §6) · Dead-End playbook **Class 8, 22, 23, 24, 30, 31** · `CLAUDE.md` Consumption-Layer
doctrine and the honest-counts rules.

---

## 0. 👤 What Scott has ALREADY decided — do not re-ask these

| | decision |
|---|---|
| shape | ⚠️ **MULTI-LABEL.** *"I think these categories can exist multiple iterations per one account."* |
| `user_owner` | 👤 **human-confirmed lane**, ~13 candidates — *"fairly infrequent"* |
| `one_off_owner` | an **INDIVIDUAL** holding one target asset — **143**, not the 2,448 I first counted |
| `investor_owner` | deliberately **broad**; SPEs included; *"all of our prospects in the space"* |
| `repeat_buyer` | **≥2 acquisitions**, with **pacing as a weight, not a label** |
| `developer` | **first owner in the chain at the tenant's first action** — ✅ **already built**, §2e |
| guiding principle | **accuracy first, automation second**; resolution at the **entity** level |

### ✅ Both remaining questions ANSWERED by Scott, 2026-09-01 — nothing here is open

**1. `one_off_owner` is ALL SWIMLANES, not dia-only.** And the reason is a doctrine statement that
reaches further than this arm:

> *"one_off_owner should be a treatment we use across all swimlanes we use in the LCC. **We are
> pursuing clients first, not necessarily the product type itself.** We use the product type and
> expertise to develop relationships but **we want to sell all net lease product.**"*

**So the classification is NEVER domain-scoped.** Product type is a relationship-development
mechanism, not the target definition. ⚠️ **Treat any domain filter you find on a BD/prospecting
surface as a candidate defect, not a given** — but **do not remove any in this unit**; note them and
report. `one_off_owner` stays at the fleet-wide **143**.

⚠️ **AND STATE THE CEILING HONESTLY, because his answer exposes it.** *"All swimlanes"* is the
intent; **the spine can currently only express two.** `lcc_entity_portfolio_facts` carries
`source_domain` values **`dia` and `gov` — and nothing else** (14,119 rows). So a role computed off
the spine says "all swimlanes" and **means dia + gov**. That is a ceiling in what LCC INGESTS, not
in this classifier, and it must be reported as such rather than papered over by the label. Any other
net-lease product Scott transacts is invisible to every role arm until a domain feeds the spine.

**2. Storage — Scott: *"Your recommendation… Maybe it's some roll up from all other databases,
etc. Your call."*** See §1a. ⚠️ **The roll-up he is reaching for ALREADY EXISTS** — do not build a
second one.

## 1. What to build

### 1a. ✅ The storage decision — a VIEW over the existing spine, not a new table and not a new roll-up

**Build `v_lcc_entity_roles` on LCC Opps: one row per (entity, role), carrying the evidence arm and
the dates.** Reasons, in the order they bind:

- **It must be DERIVED, not stamped.** Scott: *"this can change over time and isn't a one-time
  determination."* A view cannot go stale, needs no cron, and is not a Class 8 chore.
- ⚠️ **THE CROSS-DATABASE ROLL-UP ALREADY EXISTS. `lcc_entity_portfolio_facts` IS it** — the BD
  spine, fed from gov and dia by the existing mirror/sync. **Every arm is computable from LCC Opps
  alone** (`lcc_entity_portfolio_facts`, `entity_relationships`, `entities`). **Do not add a second
  cross-DB aggregation** — that is the normaliser drift this repo documents a dozen times, and it
  would drift from the spine the panel and the queue already read.
- **Consumers map cleanly:** every one asks `owner_role IN (...)`, which becomes
  `EXISTS (SELECT 1 FROM v_lcc_entity_roles r WHERE r.entity_id = … AND r.role = …)`.

⚠️ **PROFILE IT WITH THE HANDLER'S REAL QUERY SHAPE BEFORE SHIPPING.** `entity_relationships` is
**115,744 rows** and `entities` is **69,448** — and this repo's documented footgun is that
`LIMIT 5` *without* the `ORDER BY` lies by ~100× (`v_lcc_bd_worklist`: 321 ms vs **30,610 ms**).
Reproduce the exact PostgREST path a consumer issues, filters included, and **check `loops=` in the
plan — any node whose `loops=` equals the output row count is a correlated subplan** that no index
will fix; hoist it and LEFT JOIN once.

**If and only if the profile demands it, materialize** — following the **existing** precedent
`lcc_priority_queue_resolved` (a refreshed cache plus a refresh function), **never** a stamped
column on `entities`. **Report the measurement either way; do not materialize pre-emptively.**

⚠️ **Leave `entities.owner_role` in place.** 4,132 entities carry a value and `behavioral_override`
(374) reads it. **Migrate consumers to the view first; retiring the column is a separate decision.**

**A per-entity, per-role record — a SET, not a column.** Each row carries the role, the evidence
that produced it, and its dates. Derived and **re-computed**, never a one-shot stamp (Class 8 —
Scott: *"this can change over time and isn't a one-time determination"*).

**Populations, re-measured live 2026-09-01** (the design page's numbers held; `investor_owner`
drifted 6,469 → 6,480, which is why you re-measure rather than quote):

| role | evidence | population | automated? |
|---|---|---:|---|
| `operator` | `is_operator_not_owner` / recorded `owner_type` (P113) | 36 | ✅ recorded flag |
| `user_owner` | owner ≈ tenant on the same property | 13 candidates | 👤 human-confirmed |
| `investor_owner` | ≥1 current portfolio fact | **6,480** | ✅ deterministic |
| `repeat_buyer` | ≥2 `purchases` edges | **3,258** | ✅ count |
| `former_owner` | held a fact that ENDED, holds none now | **3,801** | ✅ deterministic |
| `one_off_owner` | **individual** holding exactly one target asset — ⚠️ **ALL swimlanes, never domain-scoped** | **143** | ✅ deterministic |
| `developer` | the existing gov first-generation classifier (§2e) | 715 | ✅ **already built** |

⚠️ **The overlap is the whole point of the shape: 772 entities are `investor_owner` AND
`repeat_buyer` simultaneously** — the exact population Scott says *"might take a group from a seller
prospect to a buyer prospect… depending on the pacing."* **A scalar column destroys one of the two
labels on precisely the rows whose dual status decides how they are worked.**

**Mandatory on every row:** the evidence arm that produced it and a computed-at timestamp. ⚠️ **A
role with no recorded basis is the "status nobody earned" failure this repo has hit four times** —
A5's `gap_resolved`, B6b-lead's `filtered_multi_tenant`, C7's proposed default-stamp, P159a's
`drillthrough`. And **a manual `behavioral_override` always wins** — 374 entities carry one.

## 2. ⚠️ Pacing — surface it, and NEVER report absence as dormancy

Scott ties BD treatment to *pacing*: frequency and recency of acquisition.

| | |
|---|---:|
| portfolio facts | **14,119** |
| …carrying `ownership_start_date` | **7,152 (50.7%)** |
| **dateless facts** | **6,967** — gov 4,575 / dia 2,392, across **5,176 entities** |
| …of those, **CURRENT** holdings | **3,523** |

⚠️ **Roughly half of apparent "dormancy" is MISSING DATES, not inactivity.** Of repeat buyers,
2,627 read as dormant 5+ years — and that number is not trustworthy. **Emit `pacing_unknown`
wherever the dates are absent; never "dormant."** Reporting it otherwise is the P180
NULL-is-not-zero failure **on the single dimension Scott says drives seller-vs-buyer treatment.**

⚠️ **Do NOT attempt to fill the dates in this unit.** It is a separate data-acquisition problem
(backlog **C18**) and bundling it makes both unverifiable.

## 3. ⚠️ What this must NOT do

- **No lexical classifier.** No arm may read a NAME to decide a role. Names appear only in the
  existing exclusion guards (`lcc_owner_name_is_brokerage` 6 hits · `lcc_is_placeholder_owner_name`
  3 · `lcc_owner_name_is_not_prospected` 124). Every name-based owner classifier measured in this
  arc landed ~25% raw, 7%, or 4-of-6 guarded.
- **No value floor on the classification.** Scott's first constraint. Suppressing an accurate
  determination to protect a downstream band is the wrong trade — **fix the band, not the truth.**
- **No one-shot stamped backfill** (Class 8). Re-measure the churn first; that number is what makes
  derivation safe rather than noisy.
- **Do not let the prospecting guard suppress a role.** Wake Forest and Mayo are correctly
  `user_owner`; whether they are *prospected* is a separate gate.
- **Do not bake recency into `former_owner`.** Expose `last_ownership_end` beside the role.
- **Do not touch P0.4.** ⚠️ **If P0.4 moves, the routing is wrong — STOP.** C12 measured that
  classifying naively takes it from 555 rows to ~3,500, a 6× flood of a band nobody works.
- **Do not re-implement `developer`** (§2e — it is built and live). If you believe it is defective,
  say so and stop; do not build a second one. **A second classifier for one concept is the
  normaliser drift this repo warns about a dozen times.**
- ⚠️ **Do not classify the genuinely ambiguous.** The 477 single-asset-but-active and the 35
  SPE-shell-named are **an honest absence.** Surface them; do not bucket them.

## 4. Predicted deltas — assert against these

| | today | expected |
|---|---:|---:|
| entities carrying ≥1 role | 4,132 | **↑ substantially** |
| entities carrying **≥2** roles | **0 (impossible today)** | **~957** |
| …`investor_owner` + `repeat_buyer` | 0 | **~772** |
| `user_owner` | **0** | **≤13, human-confirmed only** |
| **P0.4** | **555** | **555 — UNCHANGED** |
| the deal-timing bands (P1/P2/P3/P8) | 620 | **unchanged** — C6 removed the role from them |
| the prospecting brief | 126 | **little or none** — C8's resolved-owner arm already admits most |

## 5. Report back

- Each arm's population against §4, and **the full overlap matrix** — not just the pairs named here.
- **The churn re-measurement**, and whether it still supports derivation.
- The storage shape you built and why; how existing `owner_role IN (...)` consumers were mapped onto
  *"has role X"*.
- **The 477 + 35 you left unclassified** — confirm they are surfaced, not bucketed.
- **`pacing_unknown` counts**, and confirmation that no row reports absence as dormancy.
- ⚠️ **Read 10 named rows per new arm before declaring it correct.** Every classification error in
  this arc was found by reading rows, not by checking a count — **including three of mine that a
  count would have passed** (`user_owner` at 6,308; `one_off_owner` at 2,448; `developer` called
  unbuilt when five generations existed).
