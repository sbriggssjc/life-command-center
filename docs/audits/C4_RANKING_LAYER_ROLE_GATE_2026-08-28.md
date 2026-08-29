> 📍 **CANONICAL PAGE FOR THIS TOPIC: [`docs/architecture/bd-ranking-and-priority-queue.md`](../architecture/bd-ranking-and-priority-queue.md)** — current state, decisions and traps.
> This audit is the dated EVIDENCE; the canonical page is what to read first.
> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4o.**
> **Diagnosis only — nothing written, no migration.** This closes the last hop of Scott's chain:
> *"the relative importance and impact that directs our next best touchpoint or call when compared
> to the balance of the leads or marketing activities we could complete."*
> ⚠️ **Numbered C4, not C3** — `C3` is already taken in `PLANNED-BACKLOG.md` by a C1-lane doctrine row
> ("do not mint further into a lane with no consumer"). Supersedes two same-round drafts,
> `C3_PRIORITY_QUEUE_IS_MOSTLY_DATA_WORK` and `C3_RANKING_LAYER_ROLE_GATE`, both deleted.

# C4 — the whole BD queue is gated on one unset column, and half that gate has never matched a row

**Measured live 2026-08-28 on LCC Opps, after the T1 + T2a mints. Cache verified fresh** (refreshed
4 minutes before the read; `lcc-priority-queue-refresh` runs every 5 min), so **none of this is
staleness** — the first thing ruled out.

> ## The one-line finding
>
> Every gov deal-timing band (P1/P2/P3/P8) reads one CTE, `gov_owner_props`, whose only filter is
> **`effective_owner_role IN ('developer','user_owner')`**. Fleet-wide, **`user_owner` is 0 of
> 66,874 live entities** — half the gate has never matched anything — and `developer` is **715
> (1.07%)**, produced by a classifier that reads `properties.developer_name` and has **drained
> itself: 285 rows lifetime, 2 candidates left**. **93.5% of entities sit at `unknown` and are
> structurally invisible to every BD band.**
>
> It is not value-gated, not cadence-gated, not opportunity-gated, and not stale. **The ranking
> layer is fully built and connected to almost nothing.**

---

## 1. The reconciliation is exact

| gov properties, current owner fact, lease expiring ≤ 24 months | |
|---|---:|
| …with a `lcc_property_attributes` row (i.e. the join succeeds) | **1,216** |
| …**and** the owner's role ∈ (`developer`, `user_owner`) | **74** |
| **P1 `lease_expiry_24mo` rows in the live queue** | **74** ✅ |

**1,216 → 74 on one predicate, and 74 is the observed band count to the row.** No other filter is
involved. The `lcc_property_attributes` join is *not* the constraint (it passes 1,216).

```sql
-- v_priority_queue_live, the CTE every gov band reads
gov_owner_props AS (
  SELECT ... FROM entity_effective_role eer
    JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id
         AND f.is_current AND f.source_domain = 'gov'
    JOIN lcc_property_attributes a ON a.source_domain = f.source_domain
         AND a.source_property_id = f.source_property_id
  WHERE eer.effective_owner_role = ANY (ARRAY['developer','user_owner'])   -- ← the entire gate
)
```

`effective_owner_role` is `COALESCE(entities.behavioral_override, entities.owner_role)`.

## 2. The role column, fleet-wide and on the owners we just resolved

| `effective_owner_role` | live entities (66,874) | of the **5,992 resolved owners** |
|---|---:|---:|
| `unknown` | **62,554 (93.5%)** | **4,314 (72%)** |
| `buyer` | 3,591 | 1,567 (26%) |
| `developer` | 715 (1.07%) | **111 (1.9%)** |
| **`user_owner`** | **0** | **0** |

**Two separate findings, and they need separating:**

- ⚠️ **`user_owner` has no producer anywhere.** Zero rows in 66,874. It is named in the gate, in the
  P0.4/P0.5 arms, and in the doctrine — and nothing has ever written it. **A gate arm that has never
  matched a row is indistinguishable from one that is absent**, which is why it survived this long.
- **`developer` has a producer, and that producer is nearly exhausted.**
  `lcc_developer_classification_log` holds **285 rows lifetime**;
  `v_lcc_developer_classification_candidates` is down to **2 open**. It keys on
  `properties.developer_name`, which is a narrow source by construction — it can only ever find
  parties a domain DB already labelled a developer. **It is working; it has simply run out of
  input.** (374 entities additionally carry a `behavioral_override`.)

## 3. What the queue therefore contains — 73% is data work, not calls

| band | reason | rows | resolved owners |
|---|---|---:|---:|
| **P0.4** | `resolve_ownership_control` | **552** | 58 |
| **P-CONTACT** | `select_prospecting_contact` | **231** | 130 |
| **P0.5** | `open_bd_opportunity_needed` | **148** | 46 |
| P1 | `lease_expiry_24mo` | 74 | 34 |
| P8 | `agency_active_solicitations` | 64 | 49 |
| P3 | `ten_year_window` | 62 | 27 |
| P5 | `aged_building_value_add` | 58 | 43 |
| P2 | `firm_term_ending_24mo` | 32 | 18 |
| P-BUYER | recent buyer activity | 22 | 17 |
| P4 | `recent_acquisition_streak` | 12 | 9 |

**931 of 1,267 (73%) are "finish the data."** ~336 are genuine deal-timing signals. And **only 256 of
5,992 resolved owners (4.3%)** appear anywhere in the queue.

⚠️ **The 73% is not itself a defect** — P0.4/P0.5 are doctrinally correct producers with named
consumers. But a surface that is three-quarters data-completion trains the operator to skim it,
which is precisely the badge-that-is-noise failure the Consumption-Layer doctrine exists to prevent.

## 4. ⚠️ Broker assignment is ~2%, and the obvious fix is a documented FK trap

| | |
|---|---:|
| `touchpoint_cadence` rows | 2,301 |
| …carrying `owner_user_id` | **48 (2%)** |
| `v_priority_queue` rows carrying `owner_user_id` | **14 of 1,267 (1%)** |

Scott's chain ends *"assigned to the correct broker on Team Briggs."* It is not happening. BREAK-2
measured 7 in August; 48 now — real movement, still ~2%.

⚠️ **Do not re-derive the mapping in JS.** `touchpoint_cadence.owner_user_id` FKs `users(id)`;
`lcc_entity_owner_override.owner_user_id` FKs `lcc_users(lcc_user_id)`; **none of the `lcc_users`
ids exist in `public.users`**, so stamping the override id onto a cadence FK-violates on every row.
The bridge is email, resolved once by `lcc_cadence_point_person(uuid)` / `v_lcc_entity_point_person`.
Documented footgun, documented answer.

## 5. ⚠️ SELF-CORRECTION — widening this gate admits 2,521 entities, not 62,554

**The first version of this audit said widening to `unknown` "admits 62,554 entities — every junk
name, every SPE husk, every counterparty" and called it the largest producer-without-a-value-gate
failure available. That was wrong for THIS CTE, by 25×, and it was wrong for a structural reason
worth recording.**

`gov_owner_props` does not read `entities` alone. It **already joins** `lcc_entity_portfolio_facts`
(current, gov) **and** `lcc_property_attributes`. Those joins are a value gate in everything but
name: an entity only reaches the CTE if it currently holds a gov property we hold attributes for.
**62,554 is the count of `unknown` entities fleet-wide; the count that can reach this CTE is 2,521.**

⚠️ **The lesson generalises: quote the population at the point the predicate is APPLIED, not at the
table it names.** I read the `WHERE` clause and reached for the column's fleet-wide distribution,
skipping the two JOINs directly above it. Same family as Class 19 — a predicate's blast radius is a
property of the query, not of the column.

### The population, measured on the 2,521

| | |
|---|---:|
| `unknown` entities reachable by `gov_owner_props` | **2,521** |
| …organization-typed | 2,438 |
| …person-typed | 83 |
| …already a resolved owner in `lcc_property_owner` | **1,952** |
| …**placeholder or brokerage names** | **3** |
| …holding ≥2 current assets | 231 |
| …carrying a `purchases` edge | 383 |
| …already contactable | 320 |

**Three junk names in 2,521.** The flood this warning predicted does not exist — the eligible-set
joins already removed it. Also newly visible: **`buyer` is 2,432 reachable entities**, a large
population the gate excludes deliberately, and an `operator` role exists (2 entities).

### What widening to `unknown` would actually produce

| band | today | + `unknown` |
|---|---:|---:|
| P1 `lease_expiry_24mo` | 74 | **553** |
| P2 `firm_term_ending_24mo` | 32 | **242** |
| P3 `ten_year_window` | 62 | **414** |
| distinct owners across the three | — | **997** |

The P1 delta alone is **479 rows over 449 owners carrying $148.0M** of annual rent (top asset per
owner). Named rows read as genuine gov landlords, not noise: `1101 WILSON OWNER, LLC`,
`131 SOUTH DEARBORN LLC`, `1515 FLAGLER PROPERTY LP`, `10 Canebrake, LLC` — the SPE shape this
whole arc has been resolving.

### ⚠️ But the real constraint is REACHABILITY, and it is severe

**Only 56 of those 449 new P1 owners (12.5%) are already contactable**; 39 have a cadence. Widening
the gate without pairing it to contact acquisition would emit **~393 owners nobody can call**, which
is precisely the **P112** failure already documented in `CLAUDE.md`: *never seed a cadence for a
party with no contact method and no named person, because it can never advance and only ages into
"overdue."*

**So the honest recommendation is sequencing, not refusal:** widening is *safe* (3 junk names) and
*valuable* ($148M, 449 owners), and it should follow — or ship gated on — the reachability
precondition the cadence engine already applies. The 56 contactable owners are the slice that is
actionable the day it ships.

## 5b. What still should NOT be done
- ⚠️ **Do not write a name-based role classifier.** Every lexical owner classifier measured in this
  arc landed at **~25% precision raw** (P189 domain-keyed merge, A3 sponsor tokens, P198
  co-proposal at 7%), and the guarded versions reached 4-of-6. A role that decides *whether we call
  someone* is a worse place for that than a merge candidate.
- ⚠️ **`lcc_looks_like_person` is not a census** — it returns true for `CITY OF SALEM`,
  `BROOME COUNTY`, `Hokanson Companies`, `USAA Real Estate` (A2a/A3/P196). It cannot be used to
  separate individual owners from firms.

## 6. The honest next question

**What evidence should promote an owner out of `unknown`?** It is a doctrine question, not a
regex one, and it is Scott's — the roles decide who gets prospected and in which style, which is
the "correct prospecting style in correct buckets" hop of his chain. Recorded facts already on hand
that could carry it, none adopted here:

- **Portfolio shape** — `lcc_entity_portfolio_facts` already knows how many assets an owner holds,
  in which domains, and their rent. *"Holds ≥N assets currently"* is a recorded fact, not a guess.
- **Acquisition history** — `entity_relationships` `purchases` edges already distinguish a party
  that buys repeatedly (investor) from one that bought once (one-off owner) — Scott's own
  distinction, in his own words, already modelled.
- **`is_operator_not_owner`** (P113) already separates the tenant-in-the-owner-slot case, and it
  is a *recorded flag*, not a name test.
- **The developer classifier** is exhausted on `developer_name` but that is one source; deed
  grantor/grantee history and the B5 sales feeder now carry party roles it has never read.

⚠️ **Whatever fills it needs a value gate and an auto-retire predicate before it emits**, or it
recreates the 931-row data-work flood one band up.

## 7. What was NOT measured

- **dia's equivalent bands.** gov only — `gov_owner_props` is gov-scoped by name and by filter.
- **Whether the 336 deal-timing rows are individually good.** Counted, not read.
- **Value.** No dollar figure is attached to the 1,216 or the 74. Ranking this population by rent
  is a separate measurement, and per §4g there are **five different $500k floors** in this system —
  any floor applied here must be named, not assumed.
- **Marketing and deal-execution actions** — the other half of *"compared to the balance of the
  leads or marketing activities."* Those live outside `v_priority_queue` entirely and were not
  enumerated. A true cross-surface weighting needs them inventoried first; **that inventory does
  not exist today.**
