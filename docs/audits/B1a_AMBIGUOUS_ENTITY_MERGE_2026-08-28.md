# B1a — merging the duplicate entities that blocked the chains, and the premise that did not survive it

**2026-08-28 · LCC Opps (`xengecqvemvfknjvbvrq`) · no migration, no new code · merge batch
`b1a-20260828-r1` · apply batch `a2-chain-b1a-20260828`**

## The only numbers that count

```
research_tasks where research_type='establish_ownership_history'
  status='completed' : 1,237  →  1,302     (+65)
  status open        :   644  →    579

lcc_entity_portfolio_facts : 14,010 → 14,076   (+66)
gov any_history            :  2,173 →  2,238   (+65)
gov chain_2plus            :    177 →    178   (+1)     ← the goal metric
```

**59 groups / 63 losers merged; 52 groups held with reasons named; 65 tasks completed and 66
historical ownership facts written by A2's own function, unchanged.** No merge driver was built:
A2a's `lcc_a2a_merge_ambiguous_chain_entities` already covered this population, because its plan
view is derived from the live lane.

| | before | after |
|---|---:|---:|
| `ambiguous_entity` blocked links | 126 | **57** |
| …properties / parties | 123 / 111 | 55 / 52 |
| `no_entity` | 49 / 47 | **49 / 47 (untouched)** |
| `placeholder` | 44 / 31 | **44 / 31 (untouched)** |
| `repeat_transfer_unrepresentable` | 2 / 1 | **4 / 2** (a task moved — see below) |
| live entities | 64,356 | 64,293 (**−63**) |
| tombstones | 2,473 | 2,536 |
| `auto_mergeable` | 3,038 | 3,005 |
| `v_lcc_portfolio_ownership_conflict` | 0 | **0** |
| `human_actionable` badge | 55 | **55 (unmoved)** |
| dia `any_history` / `chain_2plus` | 1,626 / 568 | **1,626 / 568 (untouched)** |

**Merges performed is an input, not an outcome.** 63 losers is the cost side; the outcome is the
65 tasks and 66 facts.

---

## ⚠️ The premise is refuted: duplicate entities were the binding constraint on chain EXISTENCE, not chain DEPTH

The brief said *"duplicate entities are now the binding constraint on chain DEPTH."* They were not.
The batch drained 69 links out of `ambiguous_entity` and moved `chain_2plus` by **one**.

That +1 is **the whole ceiling for this population, not a shortfall**, and it was measurable
before and after:

| of the 65 completed properties | count |
|---|---:|
| now carry exactly **1** historical link (→ `any_history` only) | **64** |
| now carry **≥2** (→ `chain_2plus`) | **1** |
| whose task plan carried ≥2 applicable links **at all** | **1** |

**64 of the 65 tasks were structurally incapable of producing a chain.** Unblocking them was still
worth doing — it is +65 properties that now have *any* recorded history — but it could never have
been depth.

### The forward-looking version of the same measurement

If the **entire** remaining A2-blocked residue were unblocked tomorrow, the total `chain_2plus`
available from it is **12 properties**:

| blocked reason | properties | would reach `chain_2plus` |
|---|---:|---:|
| `ambiguous_entity` | 55 | **1** |
| `no_entity` | 47 | **1** |
| `placeholder` | 31 | **8** |
| `repeat_transfer_unrepresentable` | 2 | **2** |

And across the whole remaining open lane (132 tasks with a plan): **99 carry exactly one link**,
26 carry two, 7 carry three or more, max 6. **Chain depth in this portfolio is source-limited, not
blocker-limited** — gov's ownership feed mostly records one transition per property. The next
`chain_2plus` movement does not come from the blocked residue; it comes from records that do not
exist on file yet.

> Reproduce it:
> ```sql
> with blocked as (select source_domain, source_property_id, blocked_reason, count(*) bl
>                    from v_lcc_ownership_chain_apply_blocked group by 1,2,3),
>      existing as (select source_domain, source_property_id,
>                          count(*) filter (where not is_current) hist
>                    from lcc_entity_portfolio_facts group by 1,2)
> select b.blocked_reason, count(*) props,
>        count(*) filter (where b.bl + coalesce(e.hist,0) >= 2) would_reach_2plus
>   from blocked b left join existing e using (source_domain, source_property_id)
>  group by 1;
> ```

This is the same lesson B1 learned one level up (*"`any_history` moved 7× harder than
`chain_2plus`, and that is the POPULATION, not a shortfall"*), now confirmed one level down. The
backlog row **B1-res** should be re-labelled accordingly: it is a chain-**existence** item worth
~12 more depth properties in total, not the depth unlock it was filed as.

---

## The round trip, proven on the hardest group in the cohort

P195's reversal failed its first live attempt (`428C9`, a `GENERATED ALWAYS` column); P196's failed
on a BEFORE-INSERT trigger silently defeating `ON CONFLICT DO UPDATE`, restoring one of three
byte-identical edges **while reporting `restored`**. Neither was findable by reading the code.

A2a chose its probe as *the group where the destructive pivot path fires*. **In this cohort that
path fires nowhere** — measured before the batch, no merge-eligible group has two pivot-bearing
members, and the batch's pivot notes are only `loser_has_no_pivot` and
`winner_has_no_pivot_row_repoints`. So the probe was chosen on the risk that **is** present here:

**10 of the 59 merge-eligible groups carry a loser edge that duplicates one the winner already
holds** — the exact P196 partial-restore shape — and 2 carry a self-loop.
**`rrrealtygroup`** maximises both: 3 duplicate edges + 1 self-loop + 11 relationships + 3 external
identities + 1 pivot + 1 owned asset.

```
merge    xids_repointed 1 · external_identities_moved 1 · cadence_repointed 1
         er_selfloop_deleted 1 · er_from_repointed 0 · er_to_repointed 0
         (the 3 duplicate edges were dedup-DELETED — the P196 case)
unmerge  losers_reversed 1 → "restored"
diff     19 rows before / 19 after across entities, portfolio facts, external identities,
         relationships, pivot, property-owner, owner evidence, cadence, opportunities
         → LOST 0 · NEW 0 · CONTENT_DIFFERS 0   (updated_at excluded)
         relationship ids identical; loser live again; group back in the plan;
         ambiguity groups 111 · auto_mergeable 3,038 · conflicts 0 · facts 14,010 · 0 open ledger rows
```

All three deleted edges and the self-loop came back byte-identically. **P196's partial restore did
not recur.** The probe batch and its ledger rows were removed afterwards.

---

## Held: 52 groups, every one named

| verdict | groups |
|---|---:|
| `held:name_variant_beyond_case` | **42** |
| `held:person_typed_member` | 9 |
| `held:rival_identity_same_system` | 1 |

`held:person_typed_member` covers `robertclark`, `johnfrew`, `abdallahtaha`, `stevebeckman`,
`harrychaplin`, `sunilpuri` (person-shaped) plus `matancompanies`, `precorruffin`, `fdstonewater`
(firms carrying one mistyped `person` row — the cheapest of the held set to release once someone
retypes that row). The gate reads the **recorded `entity_type`**, never `lcc_looks_like_person`,
which A2a measured returning TRUE for six real organisations on this same lane.

### ⚠️ Two of the three corroboration signals the brief named are structurally unobservable

The brief said identity beyond byte-identical-after-case *"needs corroboration (shared
`external_identities`, shared assets, overlapping portfolio facts)."* Measured over the 42 held
groups, all three return **0** — and three zeros in a row is the Class 11 implausibility signal, so
each detector was pointed at a known positive before being believed:

| corroboration signal | held groups | fleetwide positive control | verdict |
|---|---:|---:|---|
| shared `external_identities` triple | 0 | **0** | ⚠️ **structurally impossible** |
| shared owned asset | 0 | **0** | ⚠️ **structurally impossible** |
| overlapping portfolio fact | 0 | **3,923** | ✅ genuine zero |

- `external_identities` is UNIQUE on `(workspace_id, source_system, source_type, external_id)` —
  **excluding `entity_id`** (P178). Two live entities can therefore *never* share one identity
  triple. The test cannot return non-zero anywhere in the database.
- `lcc_property_owner` is keyed on `entity_id` = **the asset**, with `owner_entity_id` a plain
  column. One asset has exactly one owner row, so two entities can never share an asset either.

Reporting "0 of 42 have a shared identity, therefore unprovable" would have been **restating a
unique constraint as a finding**. Only the portfolio-fact test can fire, and its zero is real:
40 of the 42 groups are an empty husk paired with a populated row, exactly as A2a found. **The 42
stay held, and the reason is that no observable evidence exists — not that the evidence was
checked and found absent.**

---

## ⚠️ A task moved rather than drained, again

`repeat_transfer_unrepresentable` went **2 → 4 links / 1 → 2 properties.** A2a saw the identical
effect and named the rule: **a duplicate entity can mask a second defect, and merging it is what
makes the second one visible.** Expect a repair to move rows *between* blocked reasons, and count
the destinations. The prediction accounted for it in advance: 68 tasks were blocked by
`ambiguous_entity` alone, **3 of them carried a second blocked reason**, so the forecast was 65
completions. Actual: **65.**

---

## The `placeholder` finding: refuted, and it is the guard working

The brief flagged `placeholder` — 5 distinct parties across 31 properties — as *"almost certainly
the cheapest win on the board."* It is not a win at all.

| string | links | properties |
|---|---:|---:|
| `Previous Owner` | 18 | 15 |
| `Previous Owner Name` | 16 | 14 |
| `Previous Owner Name Unknown` | 7 | 7 |
| `Previous Owner LLC` | 2 | 2 |
| `Prior Owner` | 1 | 1 |

All five are decorated variants of one placeholder, and **all five are already caught** by A2's
`lcc_a2_is_placeholder_party` via its anchored prefix `^(previous|prior|former|original)owner`.
They are not a predicate gap and not a merge candidate:

- **The placeholder is the GRANTOR.** The rows read `Previous Owner → Third Avenue Partners, LLC`,
  `Previous Owner → EMC (AIKEN), LLC`. A2 writes a fact for the party whose tenure *ended*, and
  that party is literally unnamed. Writing it would invent an owner — lane invariant 4, *at a chain
  gap, report, never bridge*.
- **Blast radius re-measured** over the now-64,356-entity population: still **exactly 3** live
  entities match the prefix, and all three hold **0 portfolio facts** (A2's cleanup held).
- The shared `lcc_is_placeholder_owner_name` still catches **0 of 3** — a real but deliberate gap
  (A2 scoped its guard narrowly on the `lcc_p131_is_document_row_label` precedent, because a false
  positive in the shared guard deletes a real owner while here it costs one unwritten link).

So `placeholder` 44 links / 31 properties is **correctly and permanently blocked**. Ironically it
is also the largest single depth reservoir in the residue (8 of the 12 available `chain_2plus`
properties) — and that value is unrecoverable by design.

---

## Gates

- **Round trip proven on the real rows, before the real run** (above): 19/19, 0 lost, 0 new, 0 changed.
- **`is_current` invariant:** **0 of 66** written facts read current.
- **Ledger 1:1 with effect:** 66 `fact_inserted` + 65 `task_completed` = 131 rows, against a
  +66 table delta and a +65 completion delta.
- **No partial applies:** 0 tasks carry a `fact_inserted` ledger row while still open.
- **Completion rule holds:** of the 65 completed properties, **0** still suggest
  `establish_ownership_history`; 64 moved to `trace_ownership_to_developer`, 1 left the worklist.
  ⚠️ The first cut of this gate joined `task_completed` ledger rows on `source_property_id`, which
  those rows carry as **NULL** — it matched nothing and returned a comfortable 0. Re-run against
  `fact_inserted`, which does carry the property. *A gate that cannot see its population is not a gate.*
- **No tombstone retains a portfolio fact:** 0 across the 63 losers.
- **No new ownership conflicts:** `v_lcc_portfolio_ownership_conflict` 0 before and after.
- **P175a checked, not assumed:** 0 portfolio-fact key collisions and 0 asset collisions between
  members across the merge cohort — believable against a **3,923** fleetwide positive control.
- **Scope untouched:** `no_entity` 49/47, `placeholder` 44/31, `mismatch` 120, `all_guarded` 58,
  `no_records` 173, `sponsor_spe` 43, `human_actionable` 55, and all of dia — every one unchanged.
- **`auto_mergeable` 3,038 → 3,005**, and the −33 is the merged groups leaving the candidate set.
  **One** auto-mergeable group still contains a B1a party and it is benign: `Alafia River Front Inc`
  (a surviving winner) heads a separate *normalized-key* group against a different entity
  `Alafia River Front`, with **0** B1a losers in it — the P198 shape, checked rather than waved through.

## Reversal

```sql
select * from public.lcc_a2_unapply_ownership_chains('a2-chain-b1a-20260828');  -- the 66 facts
select * from public.lcc_a2a_unmerge('b1a-20260828-r1');                        -- the 63 merges
```
Reverse in that order — the facts sit on the merge winners.

## What this does NOT claim

- **Nothing is scheduled.** The duplicate producer recurs (N15c fixed `canonical_name`'s
  single-writer defect; `v_lcc_a2a_ambiguity_merge_plan` is derived from the live lane, so a group
  that comes back reappears there). Re-running the dry run is the watch.
- **57 `ambiguous_entity` links remain**, held for the reasons above, worth **1** `chain_2plus`.
- **A3 / A4 / A4b untouched.** `mismatch` 120 and `all_guarded` 58 still await Scott's sponsor confirms.
- **The apply was triggered by hand**, not by cron 244 — that fires 06:49 UTC and had already run.
  Tomorrow's run should be a quiet no-op on this population.
