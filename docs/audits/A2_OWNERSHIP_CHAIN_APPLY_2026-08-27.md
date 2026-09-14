# A2 — apply the 380 `agrees` chains. The lane completes a task for the first time.

**2026-08-27 · LCC Opps (`xengecqvemvfknjvbvrq`) · migration `20260827130000`, applied live · cron 244**

## The only number that counts

```
research_tasks where research_type='establish_ownership_history'
  status='completed' :  0  →  288      (69 days at zero)
  status open        : 545 →  257
```

**288 tasks completed, 304 historical ownership facts written, $579.9M of owner rent.**
Read `facts_inserted` and `tasks_completed`; `links_already_present` is a re-discovery tally
that reads exactly like throughput (P159a) and on a quiet re-run it is the whole population
against 0 written.

| | before | after |
|---|---:|---:|
| `establish_ownership_history` completed ever | 0 | **288** |
| open | 545 | 257 |
| `agrees` bucket open | 380 | 92 |
| `lcc_entity_portfolio_facts` | 12,724 | 13,028 (**+304**) |
| …of those reading `is_current` | — | **0** |
| `v_ownership_chain_worklist` → `establish_ownership_history` | 2,177 | 1,891 |
| `v_ownership_chain_worklist` → `trace_ownership_to_developer` | 1,418 | 1,702 |
| `v_lcc_portfolio_ownership_conflict` | 0 | 0 |

## What a link licenses

A link is `<grantor> --(date)--> <grantee>`, and it licenses exactly ONE fact: **the grantor
owned this property until that date.** `ownership_end_date` is never null — `is_current` is
`GENERATED ALWAYS AS (ownership_end_date IS NULL)`, so a fact without one would read as a
CURRENT owner on every surface that ranks on it. `ownership_start_date` is the previous link's
date **only where that link handed off**; at a gap it stays NULL, because a break is reported,
never bridged. The last link's grantee is the current owner and already has a fact. `annual_rent`
and `sale_price` stay NULL: the link's price is what the grantor exited at, not what they paid.

## Identity: the measurement that shaped the design

The record carries an id for the **grantee** of a transfer (`new_owner_true_owner_id`,
name-verified) and **none at all for the grantor**. Over the 450 `agrees` links, only **9**
grantors are resolvable ID-to-ID as the previous link's grantee — 380 links are first-of-chain,
61 follow a gap. An ID-only path delivers 9 facts out of 450 and answers none of what the lane
exists for, since the lane's gap is literally the PRIOR owner.

So the grantor resolves **by name**, with the narrowest comparator this repo sanctions —
`lcc_ownership_chain_name_key` = `lower()` then strip non-alphanumerics, no token removal, no
sorting. It is the same rule `ownership-chain-draft-planner.js::chainNameKey` already uses to
decide chain continuity, so the applier and the drafter compare names the same way.

**⚠️ `lcc_owner_strict_core` was tried here and is wrong for this gate — verified on named rows.**
It drops tokens shorter than 2 characters and sorts the rest:

```
BAMMF (8) LLC        == BAMMF (3) LLC == BAMMF (9) LLC == BAMMF (S) LLC
F R M ASSOCIATES LLC == G B A Associates == J/4 Associates
                     == M.O.B. I ASSOCIATES, L.L.C.        core: "associates"
```

Four different SPEs, four different firms. It matched **393 of 396** distinct grantors against
some entity — the kind of implausibly clean number that is a bug signal, not a finding (P182).
The name-key matches 378, and sampled, its matches are byte-identical names.

Resolution is **unambiguous-only**: exactly one LIVE entity may carry the key, and it is resolved
through `lcc_entity_survivor()` with `merged_into_entity_id IS NULL` — existence is not liveness.

## Found on the way: a producer that mints entities and attaches them to nothing

**291 of the 331 unambiguously-matched grantors carry `metadata.source = 'r9_chain_connect'`.**
`/api/chain-connect-tick` (cron 104, every 30 minutes) reads the same
`v_lcc_ownership_chain_completeness`, pulls the same gov `ownership_history` prior/new owner
names, mints an entity per name through `ensureEntityLink` — **and then attaches it to nothing.**
It never writes a portfolio fact, so `owner_links` never grows, `chain_complete` stays false, and
the property is re-scanned forever. By the gov feeder's own retire predicate ("a minted entity
with no evidence and no portfolio fact has no consumer"), those 291 were retirable.

That is why resolution lands so high: the parties were already there, unattached. **A2 is the
missing consumer.** A2 itself never mints — `ensureEntityLink` resolves on
`normalizeCanonicalName`, which strips `group|partners|company|co`, the banned-for-identity
family, so minting through it could attach a chain to a different firm.

## The seed predicate — what stops a completed task coming back

`lcc_generate_chain_research_tasks` (cron 144, 05:10) excludes a property only when it carries an
OPEN task or a TERMINAL skip. **`completed` is not excluded**, so completing a task is not by
itself enough. What stops the re-mint is the FACT: `suggested_research_type` is
`establish_ownership_history` only while `owner_links <= 1`, and one historical fact takes it to
2, flipping the suggestion to `trace_ownership_to_developer`.

Verified live after the run: **0 of the 288 completed properties can be re-seeded into this lane**;
284 moved to `trace_ownership_to_developer` and 4 left the worklist entirely.

**The corollary is the completion rule.** A task completed *without* a fact would be re-seeded
tomorrow — silent churn that reads as a completion. So a task completes only when **every** link
reached a terminal good disposition. 92 stay open.

`trace_ownership_to_developer` is a **live** lane (40 completed / 18 open), not another dead one.

## The 128 blocked links, named

| reason | links | what it is |
|---|---:|---|
| `ambiguous_entity` | 54 | two or more live entities share the name key |
| `repeat_transfer_unrepresentable` | 28 | one conveyance recorded on several dates |
| `placeholder` | 26 | `Previous Owner` / `Previous Owner Name` — a cell, not a party |
| `no_entity` | 20 | no live entity carries the name (`Trammell Crow`, `Boyd Watterson Global`) |

**`ambiguous_entity` is LCC holding duplicates, not two different companies.** The set is
dominated by case-variant pairs — `Duke Realty Limited Partnership` /
`DUKE REALTY LIMITED PARTNERSHIP`, `Gate Properties LP` / `GATE PROPERTIES LP` — the exact
population P189/P195 work on. **48 of the 92 still-open tasks are blocked by ambiguity alone** (~~$210.6M~~ — **corrected
2026-08-27 by A2a: $72.0M, aggregated per OWNER**; the per-task sum is $76.7M and the per-link sum
$83.2M, and none of the three reproduces $210.6M, so that figure was simply wrong), so merging those
pairs unblocks them and the next nightly run applies them with no further work. A2 never picks a
winner: a byte-identical name is a merge question, not a licence (P195). **A2a did this: 26 of the 43
groups merged, 17 held with reasons named, 26 tasks drained. See
`docs/audits/A2a_AMBIGUOUS_ENTITY_MERGE_2026-08-27.md` — and note it found that merging a
case-variant pair can EXPOSE a `repeat_transfer_unrepresentable` the duplicate entity was
masking (2 tasks moved rather than drained).**

`v_lcc_ownership_chain_apply_blocked` carries the rival entity names for ambiguity and the
alternate dates for a repeat pair, so each follow-up is one query away.

## Three defects the live apply exposed in A2 itself

The apply ran, was measured, was found wrong, and was **reversed in full** — twice — before the
corrected run. All three are worth recording because **none of them was visible to a dry run**: each
one needed the real write and a real re-measurement of the surfaces downstream of it.

**1. An exact-match stoplist is defeated by a decorated placeholder.** The gate blocked
`Previous Owner` and the gov feed also writes `Previous Owner Name`, `Previous Owner Name Unknown`
and `Previous Owner LLC` — all of which had been minted as entities, and all of which sailed
through, taking **13 portfolio facts** with them. Neither shared guard catches any of them:
`lcc_is_placeholder_owner_name` lists `current owner` but not `previous owner`, and the JS
`isPlaceholderOwnerName` matches bare buyer/seller/escrow but not this. Fixed with an **anchored
prefix** (`^(previous|prior|former|original)owner`), blast radius measured before shipping per
P158a: over all 62,356 live entities it matches **exactly 3 rows, all three placeholders, none
holding a current portfolio fact**.

**2. `on conflict do nothing` + a fan-out join = a count that over-reports.** The run said
`facts_inserted: 365`; the table received **347**. The PK is `(entity_id, source_domain,
source_property_id)` — one interval per party per property — and 14 (grantor, property) pairs
carried more than one link, so 18 inserts were silently dropped while the ledger, fed from a join
back to the plan, logged all 365. Two fixes: the counter now comes from the INSERT's own
`RETURNING` set, and the repeat pairs are **blocked**, not silently collapsed.

**3. A PARTIAL apply flips the lane's seed predicate, and the residue then goes invisible.**
Writing ONE link of a chain takes `owner_links` to ≥2, which flips
`v_ownership_chain_worklist.suggested_research_type` to `trace_ownership_to_developer` — and R60
Sweep A then closes the **still-open** task as `skipped / chain_gap_resolved_or_changed` on its next
05:10 run, because the worklist no longer suggests this type. Measured on the corrected apply:
**17 tasks were partially applied and 19 of the 92 left open would have been swept the next
morning.** A skipped task leaves the open lane, so it leaves the split view, so it leaves the plan
and the blocked view — its remaining links become unapplied **and invisible, permanently**, and
merging the duplicate entities behind its `ambiguous_entity` blocks would then fix nothing, because
nothing would ever look at that task again.

Fixed by making the apply **all-or-nothing per task**: the write set is the links of *completable*
tasks only (`_a2_writable`). 18 fewer facts (322 → **304**), and `partially_applied` and
`would_be_swept` both measure **0** after the corrected run. The dry run counts the same write set,
so it describes what the apply does rather than what the plan wanted.

The current-owner start-date fill is deliberately **not** gated: it UPDATES an existing row rather
than adding one, so it cannot change `owner_links` and cannot flip the seed predicate.

They are not repeat ownership. Read on named rows, all 14 are ONE conveyance recorded several
times — `SENTINEL SQUARE I → WASHINGTON DC VI FGF` on 2020-02, 2020-03 **and** 2020-04;
`WASHINGTON OFFICE CENTER → WOC LLC` across three dates — i.e. the `gsa_lease_diff` lessor-field
flicker P138 documents, surviving the drafter's `(from, to, date)` dedup because the DATE differs.
Several are also missed name variants (`MILLENIUM TOWER` → `MILLENNIUM TOWER CORPORATION`,
`SP PLAZA LLC` → `S.P. PLAZA, L.C.`), which the P138 `is_name_variant` guard only catches as a
strict prefix extension.

**Picking the earliest date would be a guess about which record is real, and collapsing silently
would hide a producer defect** — so the pair is blocked and surfaced with its alternate dates. The
cost is 28 links / ~12 tasks; the gain is a precise worklist pointing at the drafter's dedup key
and the P138 name-variant guard. That is a deliberate trade, not an oversight.

## The current owner's acquisition date — the one fully ID-safe write

`agrees` means the last link's grantee IS the current owner, so that link's date is when they
acquired it. The entity comes from `v_lcc_ownership_chain_completeness.current_owner_entity_id`
(an id, not a name match) behind a **freshness gate** that re-checks the live current-owner name
against the drafted last grantee — a verdict recorded before the current state is stale (P121).

Measured: **343 already carry exactly this date** (the P138–P141 feeder wrote it, independently
corroborating the chain), **5 were blank and were filled**, **28 differ**, 4 have no current-owner
row. The 28 are surfaced in `v_lcc_ownership_chain_apply_conflict` and **do not block completion**:
the deliverable is the prior-owner history, and trading the lane's first drain for a metadata
disagreement would be the wrong call. That is a choice, stated here so it can be revisited.

## Gates

- **Reversal proven on real data before the real run, not asserted** (the P195 lesson). A capped
  3-task apply → `lcc_a2_unapply_ownership_chains` → re-measure: facts 12,726 → 12,724,
  `completed_ever` 2 → 0, open 545, `agrees` 380, **0 outcome residue, 0 unreversed ledger rows**,
  the filled owner start date restored to NULL. The two superseded full applies (347 facts / 305 tasks,
  then 322 / 288) were reversed the same way with the same result — three clean round trips.
- **`is_current` invariant:** 0 of 304 written facts read current.
- **Ledger 1:1 with the table:** 304 `fact_inserted` rows against 304 facts.
- **No new ownership conflicts:** `v_lcc_portfolio_ownership_conflict` 0 before and after.
- **`npm test`** with `test/ownership-chain-apply.test.mjs` (20 tests), **mutation-verified red on
  eleven separate breakages** and green on restore: re-deriving the classification instead of reading
  `action`; using `lcc_owner_strict_core` for identity; dropping the ambiguity gate; completing a
  task with blocked links; counting the ledger instead of the insert; allowing an undated link;
  bridging a chain gap; scheduling before the drafter; and emitting vocabulary the JS module does
  not carry; writing links of a non-completable task; and a dry run counted off the plan instead of
  the write set. Every assertion anchors on an identifier — a view name, a column, a quoted enum — and
  strips `--` comments, `comment on` docs and long prose literals first, because this migration's
  header deliberately names the things the code must not do.

## Schedule

`lcc-a2-ownership-chain-apply`, **cron 244, 06:49 UTC**, calling the SQL function directly (no
`lcc_cron_post`, so no Railway deploy is on the critical path — crons 103 and 144 already do this).
The ordering is load-bearing: **05:10** seed → **06:45** draft → **06:49** apply, so a row seeded
tonight is drafted and applied tonight. A one-shot repair of a recurring producer is a chore
repeated silently forever (P176).

## Reversal

```sql
select lcc_a2_unapply_ownership_chains('a2-20260827-r3');
select cron.unschedule('lcc-a2-ownership-chain-apply');
-- object teardown: see the foot of supabase/migrations/20260827130000_*.sql
```

## What this does NOT claim

- **92 `agrees` tasks are still open** and 128 links unapplied *(A2a took this to 64 open / 98 links on 2026-08-27)* — and, since the apply is
  all-or-nothing, **none of them has a partial chain**: each is intact and re-appliable the night
  after its blocker clears. 41 of those tasks need nothing but
  a duplicate-entity merge; 20 links need a party LCC does not hold; 28 need the drafter's dedup
  key widened or the P138 name-variant guard loosened.
- **A3 / A4 / A4b are untouched.** A2 reads `action='agrees'` and only that; the other three
  buckets are unchanged at 73 / 74 / 18.
- **`trace_ownership_to_developer` gained ~284 properties.** It is a live lane with 40 lifetime
  completions and a working consumer (`chain-classify-tick`, cron 102), so this is a handoff, not
  a second dead queue — but it is a handoff, and its drain rate is now worth watching.
