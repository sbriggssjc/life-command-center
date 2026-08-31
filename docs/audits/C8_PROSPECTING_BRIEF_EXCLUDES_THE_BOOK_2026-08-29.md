> 📍 **CANONICAL PAGE: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md) §3.**
> **Diagnosis only — nothing written.** Started as **C4b** (`user_owner` is 0); C4b resolved as inert,
> and the same gate on a **second, live, operator-facing surface** did not.
>
> ## ✅ SHIPPED 2026-08-31 — and the prediction in §3 was off by one, for a reason
>
> Migration `20260831120000` appends `is_resolved_owner` + `is_brokerage` to
> `v_bd_cadence_dashboard`; `handleProspectingBrief` composes them with `BD_OWNER_ROLES`.
> Guard `test/c8-prospecting-brief-gate.test.mjs`.
>
> **Landed 80 → 126, not 127.** Every other number reproduced exactly (311 / 80 / $442,805,301 /
> 231 / 47 / $515,176,327.54 / 3 / 181). ⚠️ **§3 predicted 127 because §2 sized the brokerage
> population by reading only the EXCLUDED half.** There are **4** brokerages among the 311, not 3 —
> **`Stan Johnson Co` carries `owner_role='buyer'` and was being SHOWN** ($238,700). Making the
> guard explicit on both arms drops it, so the delta is **+47 − 1**. *A population counted on one
> side of a gate is not the population.*
>
> ⚠️ **The three-row false-positive read §3 asked for, done on all four.**
> `Coldwell Banker Commercial Realty` ✅ genuine · `Stan Johnson Co` ✅ genuine (the one the guard
> actually decides) · `Northmarq Support` ✅ our own firm · **`Clark Matthews` ❌ the documented P116
> false positive** — bare `\mmatthews\M` matched a person's SURNAME. **It costs nothing here:** he
> is `unknown`, owns no asset, and fails the OR arm regardless. The guard is outcome-bearing for
> exactly one of the four.
>
> ⚠️ **At the default `limit=10`, 9 of 10 call-sheet slots change** — Easterly enters at rank 2,
> and NGP Capital / USAA / US Fed Properties Trust / Elman / Trammell Crow / Beacon reach page 1 for
> the first time. **This is a reach fix, not a count fix.**
>
> 🔴 **Two defects found while shipping, both filed, neither fixed here:** **C8a** the fallback
> branch is ungated *and structurally dead* (`engagement_score` is 0 on all 30,714 gov
> `unified_contacts` rows), and **C8c** the handler maps `c.name` / `c.company_name` /
> `c.annual_rent` while the view supplies `entity_name` / (none) / `rank_value`, so **every row on
> the sheet renders "Unknown … rent unknown"** — pre-existing, unaffected by C8, and it blunts C8's
> entire benefit.

# C8 — the prospecting brief hides $515M of resolved owners to exclude 3 brokerages

**Measured live 2026-08-29 on LCC Opps.**

> ## The one-line finding
>
> `handleProspectingBrief` (`api/operations.js:4805`) — **the call sheet** — gates on
> `owner_role IN ('developer','user_owner','buyer','seller_flipper','operator')`, excluding
> `unknown`. Of the **311** eligible cadence rows it shows **80**. Of the **231** it excludes,
> **47 are resolved property owners carrying $515.2M** — **more rank-value than the $442.8M it
> shows** — and only **3** are flagged brokerages. **Easterly Gov Properties ($114.9M, 85
> properties), NGP Capital ($68.3M, 31), USAA Real Estate ($62.0M), US Fed Properties Trust
> ($53.7M, 35), Gardner Tanenbaum, GI Partners, Trammell Crow, Clarion Partners** are all excluded.

---

## 1. C4b first — and it is inert

C4b asked whether `user_owner` should be filled or removed. Measured:

| declared in `BD_OWNER_ROLES` | live entities |
|---|---:|
| `developer` | 586 (+120 overrides) |
| `buyer` | 3,481 |
| `operator` | 11 |
| **`user_owner`** | **0** |
| **`seller_flipper`** | **0** |
| *`unknown`* — **not in the declared list** | **62,823 (93.9%)** |

**Two of five declared roles have never been written, and the value covering 93.9% of entities is
not in the vocabulary at all.**

⚠️ **Removing `user_owner` from the four remaining `effective_owner_role = ANY (...)` predicates is
a literal no-op** — it matches zero rows, so nothing changes. **My previous sizing of C4b as
"governs 46% of the surface" conflated the GATE with the ARM.** The *gate* on P0.4/P0.5 is
load-bearing; the `user_owner` *token inside it* is inert.

### ⚠️ And the P0.4 gate is genuinely load-bearing — Class 23 in mirror image

| P0.4 `resolve_ownership_control` universe | entities |
|---|---:|
| with the role gate | **703** |
| without it | **66,167** |

**94×.** Unlike `gov_owner_props`, the P0.4/P0.5 arms have **no bounding JOINs** — they read
`entity_effective_role` directly. **So the 62,554 figure C4 §5 wrongly applied to `gov_owner_props`
is CORRECT here.** It was the right number attached to the wrong arm.

⚠️ **That is the Class 23 lesson stated positively: the same predicate on two arms of one view has
completely different blast radii, and each must be measured separately.** P0.4 keeps its gate.

## 2. The real finding — the same defect, a different surface

`handleProspectingBrief` is the operator-facing call sheet. Its gate carries a comment explaining
itself:

> *"BD-target gate: require a classified owner_role for ALL contacts. Brokers and unclassified
> intermediaries have owner_role='unknown' and must be excluded regardless of domain."*

**The intent is correct and the mechanism is not.** Measured over the 311 eligible rows:

| | rows | rank value |
|---|---:|---:|
| **shown today** (passes `BD_OWNER_ROLES`) | **80** | $442,805,301 |
| **excluded as `unknown`** | **231** | — |
| …**that ARE resolved property owners** | **47** | **$515,176,328** |
| …flagged as a brokerage | **3** | — |
| …neither (genuinely unclassified) | 181 | — |

**The gate excludes 3 brokerages and 47 real owners, and the excluded owners carry more value than
everything it shows.**

### Read on named rows — the top 18 excluded, all `unknown`

| owner | rank value | current properties | resolved owner | brokerage? |
|---|---:|---:|:--:|:--:|
| **Easterly Gov Properties (REIT)** | **$114,864,150** | **85** | ✅ | ❌ |
| **NGP Capital** | $68,324,766 | 31 | ✅ | ❌ |
| **USAA Real Estate** | $62,034,450 | 8 | ✅ | ❌ |
| **US Fed Properties Trust** | $53,661,661 | 35 | ✅ | ❌ |
| Brandywine Realty Trust | $34,920,892 | 0 | ❌ | ❌ |
| Elman Investors | $28,989,914 | 30 | ✅ | ❌ |
| Trammell Crow Co | $24,146,509 | 1 | ✅ | ❌ |
| Beacon Capital Partners | $23,832,093 | 0 | ✅ | ❌ |
| GIC Real Estate | $22,298,666 | 1 | ✅ | ❌ |
| Cambridge Holdings | $13,194,671 | 2 | ✅ | ❌ |
| Global Net Lease | $12,646,253 | — | ✅ | ❌ |
| Saban Capital Group | $10,401,645 | 5 | ✅ | ❌ |
| Gardner Tanenbaum Holdings | $9,215,041 | 22 | ✅ | ❌ |
| AVG Partners | $8,850,294 | 1 | ✅ | ❌ |
| GI Partners | $8,620,434 | 1 | ✅ | ❌ |
| DaVita HealthCare Partners | $7,721,255 | 0 | ❌ | ❌ |
| Clarion Partners | $7,626,303 | 0 | ✅ | ❌ |
| JLB Capital | $4,451,154 | 8 | ✅ | ❌ |

**16 of 18 are resolved owners. Zero are brokerages.** These are the names the Tier 0 arc spent
twelve rounds resolving and P198 merged — **Easterly is the single largest owner in the system and
it is not on the call sheet.**

⚠️ **CORRECTED 2026-08-29 by [C9](C9_MERGE_BACKLOG_REACHES_THE_OPERATOR_SURFACES_2026-08-29.md) —
this paragraph originally called `Brandywine Realty Trust` at $34.9M / 0 properties "the N18
fabricated `attributed_rent` value." That is REFUTED.** Brandywine genuinely owns the highest-rent
gov property (11504) and the value is real. **What is wrong is which entity carries it:** three live
entities share `canonical_name = 'brandywine realty'`, none merged — the assets and contact on one,
the cadence and 36 edges on another. **A duplicate-entity split, not a fabrication.** See C9.

## 3. The fix — C6's rule, on the second surface

**Do not drop the gate.** The comment's concern is real: 181 of the excluded rows are genuinely
unclassified, and the brief is a call sheet. Apply **C6's principle** — admit on the **per-asset
fact** rather than the party label:

> `owner_role IN (BD_OWNER_ROLES)` **OR** *the entity is a resolved owner in `lcc_property_owner`* —
> and in both arms, **not** `lcc_owner_name_is_brokerage(entity_name)`.

~~**Predicted: 80 → 127 rows**~~ ⚠️ **SHIPPED AT 126** — see the header. +47 resolved owners
(**$515,176,327.54**, exact) **minus 1**: `Stan Johnson Co`, a brokerage the role arm was admitting,
which this section did not see because it counted brokerages only among the EXCLUDED rows. The 181
unclassified stay out. **The brokerage guard becomes explicit rather than a side effect of the role
label** — which is what the comment always intended.

⚠️ **`lcc_owner_name_is_brokerage` has a documented false positive** — it matches bare `\mmarcus\M`
/ `\mnai\M`, so a genuine "Marcus Family Trust" trips it (P116). At 3 rows the blast radius is
readable; **read all 3 before shipping.**

## 4. What was NOT measured

- **Whether the 181 "neither" rows should ever surface.** They are unresolved and unflagged; that is
  C4a's question, not this one.
- **Whether the 80 currently shown are correct.** They were counted, not read.
- **The `seller_flipper` arm** — 0 rows, same status as `user_owner`, not separately investigated.
- ~~**Whether any other handler carries `BD_OWNER_ROLES` or an equivalent.** Not swept.~~
  ✅ **SWEPT 2026-08-29 — see §5 below. The result bounds the whole problem.**
- **dia.** The named rows are gov-dominant; no dia-specific measurement was made.


## 5. ✅ The sweep — there is no third surface

This audit originally left *"whether any other handler carries an equivalent gate"* unmeasured.
**Leaving it unswept is exactly how the prospecting brief survived C6**, so it was closed the same
day.

**JS side** — `grep -rn "owner_role"` across `api/` and the root SPA files returns 22 hits. **Exactly
one is a FILTER**: `api/operations.js:4807-4808` (this audit's subject). Every other hit is either a
**display projection** (`owner_role: row.effective_owner_role`, the dossier/detail renderers), a
**`select=` column list**, or a **write** (`sidebar-pipeline.js` seeding `owner_type`). None gates a
population.

**DB side** — over all 14 `public` views whose definition mentions `owner_role`, testing for a
predicate form (`= ANY`, `IN (`, `<>`, `!=`, `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM`):

| view | filters on `owner_role`? |
|---|:--:|
| **`v_priority_queue_live`** | ✅ **yes** (C6 cleared the four gov deal-timing arms; P0.4/P0.5/P5/P4 keep theirs, correctly) |
| `v_bd_cadence_dashboard` · `v_priority_queue` · `v_priority_queue_enriched` · `v_entities_effective_role` · `v_entity_portfolio_all` · `v_lcc_merge_candidates` · `v_lcc_developer_classification_candidates` · `v_lcc_canonical_twin_candidates` · `v_lcc_listing_event_queue` · `v_lcc_operator_affiliates` · `v_lcc_operator_effective_portfolio` · `v_lcc_ownership_chain_completeness` · `v_lcc_trigger_band_properties` | selects only |

**So the entire system contains exactly TWO role gates: one view and one handler.** C6 fixed the
first; **C8 completes the Class 24 remediation.**

⚠️ **Positive control (Class 11):** the detector fired on the known true positive
(`v_priority_queue_live`, `set_form = true`) and correctly classified `v_bd_cadence_dashboard` as
*selects only* — its gate lives in JS, which matches reading the handler directly. **The zeros are
believable because the detector demonstrably can fire.**

⚠️ **Stated limits.** `pg_views.definition` is **deparsed**, not what was written (P182) — `NOT IN`
renders as `<> ALL`, which this regex does catch, but a gate expressed as a **JOIN to a role table**,
inside a **function**, or in an **RLS policy** would not match. Materialized views were not
separately enumerated. **The sweep covers views and the JS handlers; it is not a proof over every
possible expression.**
