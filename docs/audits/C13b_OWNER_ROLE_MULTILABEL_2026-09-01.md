# C13b — the owner-role classification, as a SET of labels (2026-09-01)

> **Design:** [`../architecture/owner-role-classification.md`](../architecture/owner-role-classification.md)
> (the whole page). **Prompt:** `docs/claude-code/prompts/C13b-owner-role-multilabel.md`.
> **Migration:** `supabase/migrations/20261005120000_lcc_c13b_entity_roles_multilabel.sql`, applied
> live to LCC Opps (`xengecqvemvfknjvbvrq`). **Guard:**
> `test/c13b-entity-roles-multilabel.test.mjs` (11 tests, **19/19 mutations RED**).
>
> **Shipped:** `v_lcc_entity_roles` (one row per entity+role, with its evidence arm, dates and
> pacing), `v_lcc_user_owner_candidates`, `v_lcc_entity_role_ambiguity`, and the
> `lcc_entity_role_confirmation` input ledger (EMPTY — the `user_owner` lane is human-confirmed).
> **Nothing writes. No consumer was repointed. P0.4 is 555 before and after.**

## 1. What landed

| | before | after |
|---|---:|---:|
| entities carrying ≥1 role | 4,132 | **10,655** |
| entities carrying **≥2** roles | **0 (impossible)** | **946** |
| entities carrying 3 | 0 | 30 |
| role rows | — | 11,631 |
| duplicate (entity, role) pairs | — | **0** |
| **P0.4** | 555 | **555 — unchanged** |
| deal-timing bands P1/P2/P3/P8 | 621 | **621 — unchanged** |

| role | evidence arm | population | vs the design's figure |
|---|---|---:|---|
| `investor_owner` | ≥1 current portfolio fact | **6,447** | 6,469 − 22 guard-blocked ✅ |
| `former_owner` | held a fact that ended, holds none now | **3,786** | 3,801 − 15 ✅ |
| `developer` | the gov first-generation classifier (466) + manual override (252) | **718** | design said 715 / 769 — see §3 |
| `repeat_buyer` | **≥2 DISTINCT assets acquired** | **385** | ⚠️ design said **3,258** — see §2 |
| `one_off_owner` | person-typed, exactly 1 current asset | **142** | 143 − 1 ✅ |
| `operator` | mirror `true_owner_is_operator` (25) + stamped (1) + override (3) | **29** | design said 36 — that was a dia-side `true_owners` count, not an LCC entity count |
| `buyer` | manual override only, emitted verbatim | 124 | not in the derived vocabulary; see §5 |
| `user_owner` | human-confirmed | **0** | ≤13 expected; the ledger is empty by design |

### The full overlap matrix

| pair | entities |
|---|---:|
| `developer` + `investor_owner` | 258 |
| `developer` + `former_owner` | 245 |
| **`investor_owner` + `repeat_buyer`** | **167** |
| `investor_owner` + `one_off_owner` | 142 |
| `buyer` + `investor_owner` | 112 |
| `developer` + `repeat_buyer` | 18 |
| `former_owner` + `repeat_buyer` | 16 |
| `former_owner` + `operator` | 12 |
| `one_off_owner` + `repeat_buyer` | 11 |
| `buyer` + `former_owner` | 11 |
| `investor_owner` + `operator` | 9 |
| `operator` + `repeat_buyer` | 4 |
| `developer` + `operator` | 1 |

⚠️ **`one_off_owner` + `investor_owner` is 142 of 142 — the whole arm, by construction.**
`one_off_owner` is a REFINEMENT of `investor_owner` (a person holding one asset holds an asset), not
an alternative to it. A precedence ladder would have had to choose, and either choice loses a fact.

⚠️ **`investor_owner` + `operator` is 9** — Northwest Kidney Centers, Puget Sound Kidney Centers,
Satellite Dialysis, Fresenius Medical Care and five others own the real estate they operate in.
**Both labels are true and neither is suppressed**; `operator` on the row is exactly the signal a
consumer needs to treat that `investor_owner` differently. This is the multi-label model earning its
keep on the population P113 exists to protect.

## 2. ⚠️ `repeat_buyer` was 3,258 and is 401 — an EDGE COUNT IS AN OBSERVATION COUNT

The design, the prompt and C13 before them all carried **3,258** for "≥2 `purchases` edges". Keyed on
**distinct assets acquired** — which is what Scott's definition says, *"anyone that has acquired more
than one **asset** in our swimlane"* — it is **401**, and after the brokerage/placeholder guards
**385**.

**Read on named rows, the 2,857-entity difference is not repeat buyers:**

| owner | edges | distinct assets |
|---|---:|---:|
| `Korea Investment Corporation` | 2 | **1** (`2530 Crystal Dr`, twice, byte-identical metadata) |
| `Stoneforge Advisors LLC by ARA` | 5 | **1** (`1474 Rodeo Rd`) |
| `Richard & Barbara Barrett Trust` | 3 | **1** |
| `1300 Pine Avenue Llc` | 3 | **1** (`1300 Pine Ave`) |

`entity_relationships` has **no unique constraint on `(from, to, type)`** (P177), and `purchases` is
fed independently by `costar_sidebar`, `costar_deed` and `rca_deed`. The population is dominated by
**address-named single-asset SPEs** whose one conveyance was observed several times.

⚠️ **The obvious middle key was also measured and rejected.** Keying on `(asset, date)` gives **735**
— the extra 334 are one asset seen on two dates from two sources, which is A2b's documented
cross-source lag (`1849 Davisville Rd`: `costar_deed` 2010-06, `costar_sidebar` 2025-09;
`1330 S 16th St`: 2014 / 2022). Those are second observations, not second acquisitions.

**The head of the corrected list reads correct**: Boyd Watterson 275 assets, Easterly 92,
Government Properties Income Trust 55, Elman Investors 53, NGP Capital 48. And at the boundary
(exactly 2 assets) it reads correct too: AEI Capital, Acquest, Albany Road Real Estate Partners.

**Consequence for §4 of the prompt:** `investor_owner + repeat_buyer` was predicted at ~772 and is
**167**. That prediction was computed against the inflated 3,258. **946 entities carry ≥2 roles
against the predicted ~957**, so the multi-label finding itself is unaffected — only which pair
dominates it moved.

## 3. ⚠️ AN OVERRIDE REPLACES THE COLUMN AN ARM READS — 120 developers a human had already corrected

The first cut of the view emitted `developer` for every entity with `owner_role = 'developer'` and
added the override as a separate row, on the theory that multi-label means "both are true."

Measured live: **119 entities carry `owner_role = 'developer'` together with a human
`behavioral_override` of `buyer`**, and one with `operator`. Those overrides are not an additional
fact — they are somebody looking at the gov classifier's verdict and saying *this is not a
developer*. `v_entities_effective_role` has always read `coalesce(behavioral_override, owner_role)`
for exactly that reason.

`developer` **838 → 718**. The same rule is applied to the stamped-`operator` arm. The mirror
operator FLAG is independent evidence and is NOT suppressed by an override of a different value.

## 4. ⚠️ `one_off_owner` is emitted as specified and its "individual" half is UNVERIFIED

The arm is Scott's definition against the recorded fact: `entity_type = 'person'` and exactly one
current asset. **The recorded fact is wrong on roughly half of this arm.** Read on 20 named rows:

| top 10 by rent | reads as |
|---|---|
| Jamestown $22.8M · Gates Hudson $19.6M · Metropolitan Life Insurance $11.8M · Gladstone Commercial · Beverly Wilshire · Samaritan's Purse · SkyREM · Deoworks | **organisations, typed `person`** |
| Mohammed Mirza · Keith Kantrowitz | genuine individuals |

The lowest-rent 10 read the same way (`Alexandria`, `Apollo Global RE`, `AvalonBay`, `BREIT`,
`Basis Schools` against Albert Cabraloff, Amir Shams, Bharath Gangula, Brian Revis).

**No non-lexical corroboration exists**, and this was checked before concluding: of the 142,
**0** carry a `salesforce/Account` external identity, **0** an inbound `works_at` edge, **0** an
`org_type`. ⚠️ **`first_name`/`last_name` looks like the answer and is not** — it is a whitespace
split of the same string (`Metropolitan` / `Life Insurance`, `Samaritan's` / `Purse`) and is ABSENT
on a real individual (`Kalven Cederberg`), so it carries no independent information. That is the
P125 "a proxy for a fact you already hold is not a measurement" trap.

A name test is banned by §3 of the prompt, **and it would not work anyway**:
`lcc_looks_like_person` flags only **28 of 142** and is the documented two-capitalised-tokens false
positive (A2a held six real companies on it).

**So the arm ships as specified and the ambiguity is SURFACED, not patched**:
`v_lcc_entity_role_ambiguity.one_off_owner_rests_on_recorded_entity_type` lists all 142 and says
why. The blast radius is a label — every one of the 142 also carries `investor_owner`, so a wrong
`one_off_owner` removes nothing and admits nobody. **The upstream defect is
`entities.entity_type`** (349 live person-typed entities fail even the loose name test, and 979
`former_owner` rows are typed `organization` while reading as individuals) — filed as **C13c**.

## 5. Storage, and how `owner_role IN (...)` maps onto "has role X"

**A VIEW over the existing spine** (§1a), not a table, not a second roll-up, not a stamped column:

- **Derived** — Scott: *"this can change over time and isn't a one-time determination."* A view
  cannot go stale and is not a Class 8 chore.
- **`lcc_entity_portfolio_facts` IS the cross-DB roll-up already.** Every arm is computable from LCC
  Opps alone; a second aggregation would drift from the spine the panel and the queue already read.
- **`entities.owner_role` is left in place.** Retiring it is a separate decision.

**The mapping was MEASURED, and no consumer was repointed** (the design page §5 says *no change to
how a role is CONSUMED*). The one live `owner_role IN (...)` consumer is `handleProspectingBrief`'s
BD gate on `v_bd_cadence_dashboard`:

```
current:  owner_role IN (developer,user_owner,buyer,seller_flipper,operator) OR is_resolved_owner
becomes:  EXISTS (SELECT 1 FROM v_lcc_entity_roles r WHERE r.entity_id = d.entity_id) OR is_resolved_owner
```

Measured over the 308 eligible cadence rows: **126 → 130 (+4 admitted, −0 removed)** — the *"little
or none"* §4 predicted. Repointing it would need `has_bd_role` as a COLUMN on the view so the gate
stays in the SELECTION (A5c / C10); that is a separate change on a surface C8/C10/C11 have each just
fixed, and it is filed as **C13d** rather than bundled here.

### The manual override rides VERBATIM

`behavioral_override` values are `developer` 298 / `buyer` 124 / `operator` 3 (425 rows, 379 on live
entities — the design's "374" is stale, and **46 sit on merged-away tombstones** and are correctly
excluded). The override is emitted as its own row with `evidence_arm = 'manual_override'`, **in the
human's own words**. `buyer` is therefore a role token in the output and is *not* in the derived
vocabulary. Remapping it to `investor_owner` would be exactly the silent inference this design
exists to avoid, and would hand a consumer asking for `investor_owner` a false positive.

Every derived arm carries `behavioral_override is distinct from '<its own role>'`, so **one entity
can never emit the same role twice** (verified: 0 duplicate pairs across 11,631 rows).

## 6. Pacing — and no row reports absence as dormancy

| role | `active_2y` | `active_5y` | `quiet_5y_plus` | **`pacing_unknown`** |
|---|---:|---:|---:|---:|
| `investor_owner` | 355 | 1,079 | 2,827 | **2,186** |
| `repeat_buyer` | 94 | 80 | 210 | **1** |

Every row with a date carries one; every row without a date reads `pacing_unknown`. The quiet bucket
is named **`quiet_5y_plus`, never "dormant"** — a party can be quiet only in OUR record.

⚠️ **Each arm paces off ITS OWN dates, and their coverage differs by 33 points.** `repeat_buyer`
reads `entity_relationships.effective_from` (**23,557 of 23,847 edges dated, 98.8%**);
`investor_owner` reads `ownership_start_date` on current facts (**4,279 of 6,469 entities, 66%** —
the fact-level figure is 7,152 of 14,119 = 50.7%). `assets_acquired_dated` vs `assets_acquired` is on
every row so the blindness is visible rather than inferred.

⚠️ **The design's "2,627 repeat buyers dormant 5+ years" does not survive the §2 correction.** It was
computed over the edge-count population; on the corrected 401 it is **219**, and 98 are active within
2 years. **The dormancy was mostly the phantom SPEs, not missing dates** — which is a different
finding from C18's, and C18 (the `ownership_start_date` gap) is still real and still the highest-value
item in the design. Nothing here fills a date; that stays a data-acquisition problem.

## 7. The genuinely ambiguous — 298 rows, surfaced, never bucketed

| `ambiguity_kind` | rows |
|---|---:|
| `one_off_owner_rests_on_recorded_entity_type` | 142 |
| `spe_shell_named_single_asset` | 129 |
| `user_owner_candidate_unconfirmed` | 15 |
| `individual_single_asset_but_multi_acquisition` | 12 |

⚠️ **C13's "477 single-asset-but-active and 35 SPE-shell-named" DO NOT REPRODUCE, and the reason is
that the multi-label model dissolved them.** Both were artifacts of the single-valued precedence
ladder and of C13's org-inclusive `one_off_owner`: under a SET, an entity that holds one asset and
buys repeatedly is simply **both**, with no contradiction to resolve, and a single-asset
*organisation* is unambiguously `investor_owner` under Scott's broad definition. Re-derived against
the shipped arms the residue is the 12 / 129 above. **This is worth stating rather than quietly
reporting different numbers: a chunk of what C13 called ambiguity was an artifact of C13's shape.**

## 8. `user_owner` — 15 candidates, read, 0 confirmed

Re-measured over 8,551 held properties carrying a tenant (6,264 distinct owners): **6 exact core
matches, 15 including containment** (the design said 6 / 13; two have arrived since). Read on all 15:

- **10 genuine owner-occupiers** — Atlantis Healthcare Group, Centers for Dialysis Care, Concerto
  Missouri, Michigan Kidney Consultants, Northwest Kidney Centers, Wake Forest University, Gundersen
  Lutheran, Mayo Clinic Dialysis, Puget Sound Kidney Centers, Sanford Health.
- **5 of one failure shape** — an SPE or DST named after the tenant it houses:
  `FSC FMC Carbondale IL DST`, `USGBF NIAID LLC`, **`NOAA Maryland LLC`**,
  **`MORGANTOWN GSA USDA, LLC`** (both new since the design, both the same shape), and the ambiguous
  `Mena Dialysis`.

The lane needs an INPUT store or it is a consumer with no producer, so
`lcc_entity_role_confirmation` ships **empty**. `user_owner` reads 0 today and that is the design
working, not a gap.

⚠️ **`lcc_owner_name_is_not_prospected` is SURFACED, never suppressing.** 228 role-bearing entities
carry it — Wake Forest and Mayo among them — and every one keeps its roles. Whether we prospect them
is a separate gate on a separate surface.

## 9. Performance — profiled on the consumer's real query shape, and it changed the SHAPE

⚠️ **The first cut was eight `union all` branches over a MATERIALIZED `cand` CTE, and it was 48×
slower on the exact shape the documented consumer mapping issues.** A CTE referenced nine times is
always materialized, so `entity_id = ?` could not push down: the probe scanned all 13,280 candidates
nine times.

| shape | before | after |
|---|---:|---:|
| single-entity probe (`where entity_id = ?`) | **39,968 buffers** / ~686 ms | **1,787 buffers** / ~13 ms |
| ranked scan (`where role = ? order by rent desc limit 50`) | 39,966 buffers / ~718 ms | 39,967 buffers / ~362 ms |

**Buffers are the durable evidence** — wall-clock on this box is session-variable by 2–4× (documented
in `CLAUDE.md`), and the probe's 22× buffer reduction is not.

The fix was ONE `cand` scan (`not materialized`) with the arms as a LATERAL VALUES list. ⚠️ **On its
own that made the ranked scan 2.4× SLOWER** (718 → 1,759 ms), because inlining means an expression
referenced in all eight VALUES rows is evaluated eight times per candidate — 106,240 name-guard calls
instead of ~11,700. **Moving the two name guards to a single predicate over the surviving
(entity, arm) pairs is what made the inlined shape faster than the materialized one** rather than
worse. Both halves were needed; either alone is a regression on one shape.

**No `loops=` correlated subplan exists in either shape.** Materialization was therefore NOT
required and was not added (§1a: *do not materialize pre-emptively*).

## 10. Churn — derivation is still safe, and the design's number described one arm

**Portfolio-date churn over 90 days: 3 holdings ended, 1 started** — reproducing the design's figure
exactly. **But `purchases` edges gained 6,501 rows in the same window**, which is what would move
`repeat_buyer`. So *"the volatility is negligible"* is true of the portfolio-fact arms and false of
the acquisition arm.

⚠️ **That argues FOR a view, not against it.** A stamped column recomputed nightly would be stale
against 6,501 new edges; a view cannot be. And note `lcc_entity_portfolio_facts.updated_at` moved on
**14,113 of 14,119 rows in 90 days** — the documented nightly re-upsert — so it is useless as a churn
signal and was not used as one.

## 11. What this did NOT do

- **No lexical classifier.** No arm reads a name. Names appear only in the two exclusion guards
  (`lcc_owner_name_is_brokerage`, `lcc_is_placeholder_owner_name`), which cost 22 `investor_owner`,
  16 `repeat_buyer`, 15 `former_owner` and 1 `one_off_owner`.
- **No value floor** on the classification.
- **No re-implementation of `developer`** — it is read off the existing gov first-generation
  classifier. Its known defect (the builder-vs-first-net-lease-buyer discrimination, unverifiable on
  353 of 354 candidates for a chain-depth reason) is unchanged and stays C14/C15.
- **No date filling.** C18 is untouched; bundling it would make both unverifiable.
- **Nothing stamped, nothing written, no cron.**

## 12. Filed, not fixed

| id | |
|---|---|
| **C13c** | 🔴 **`entities.entity_type` is unreliable in BOTH directions and one arm now rests on it.** Roughly half of `one_off_owner`'s 142 are firms typed `person` (Jamestown, Metropolitan Life Insurance, Gladstone Commercial, AvalonBay, BREIT); **979 `former_owner` rows are typed `organization` and read as individuals** (`RICHARD LEBOS`, `MITCHELL IDOL`, `Kristen E Pigman`). No non-lexical corroboration exists today. Surfaced by `v_lcc_entity_role_ambiguity`; fixing the column is a bigger decision with its own blast radius. |
| **C13d** | 🟠 **Repoint `handleProspectingBrief`'s BD gate onto "has any role".** Measured **126 → 130 (+4 / −0)**. Needs `has_bd_role` as a COLUMN on `v_bd_cadence_dashboard` so the gate stays server-side in the SELECTION (A5c / C10), on a surface C8/C10/C11 have each just fixed. |
| **C13e** | 🔵 **Build the `user_owner` confirm surface.** The 15 candidates and the ledger exist; nothing renders them. Until then `user_owner` is permanently 0 — a consumer with a producer nobody can reach. |

## 13. How to verify

```sql
-- arms + evidence, and 0 duplicate (entity, role) pairs
select role, evidence_arm, count(*) from v_lcc_entity_roles group by 1,2 order by 1,2;

-- the finding: entities carrying more than one label
select n, count(*) from (select entity_id, count(*) n from v_lcc_entity_roles group by 1) x
group by 1 order by 1;                       -- 9,709 / 916 / 30

-- absence is never dormancy
select role, pacing, count(*) from v_lcc_entity_roles
where role in ('investor_owner','repeat_buyer') group by 1,2;

-- the safety property
select priority_band, count(*) from lcc_priority_queue_resolved
where priority_band = 'P0.4' group by 1;     -- must stay 555
```

⚠️ **Verify on the ARM POPULATIONS and the overlap matrix, never on the row count** — 11,631 rows
would be the same number if every entity carried one wrong label.
