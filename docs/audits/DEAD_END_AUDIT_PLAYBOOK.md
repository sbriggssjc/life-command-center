# Dead-end audit playbook

> Written 2026-08-22 after a session that found nine live defects by accident. Every one
> belonged to a *class*, and every class is detectable on purpose. This is the list of
> classes, the query or check that finds each, and what was found the first time it ran.
>
> **The unifying property: none of these surfaces as an error.** Every one reports success —
> a green cron, a non-zero count, a "resolved" flag, a passing tick. That is why they survive
> for months. *Assert on the state delta, never on the worker's own report.*

---

## Class 1 — an entity FK missing from the merge path

**Symptom:** rows point at a tombstoned entity. Nothing errors; the UI shows a name that no
longer exists.

**Detector:** `select * from lcc_audit_merge_path_coverage();` (P171)

**First run:** 27 columns uncovered, **9 with live strands, 370 rows** — largest
`lcc_decisions.subject_entity_id` (**286** Decision Center cards whose subject was merged away).

**Two traps this detector had to survive, both of which produced a wrong answer first:**

- **Declared FKs are not enough.** Enumerating `pg_constraint` misses
  `owner_contact_pivot.active_contact_entity_id` — the P167 defect — because it has no FK.
  Match on *column name*; the undeclared references are exactly the forgotten ones.
- **The merge path is more than one function.** Checking only
  `lcc_reconcile_tombstone_backrefs` reported `lcc_property_owner.owner_entity_id` as
  uncovered; P160 put that repoint in `lcc_merge_entity`. 28 apparent defects → 20 real.

**Repair is per-column, never blanket.** P167 proved "repoint to the survivor" is the obvious
answer and the wrong one: all three survivors were organisations, and repointing would have
made Boyd Watterson its own contact.

---

## Class 2 — a producer with no consumer

**Symptom:** a queue grows; nothing ever closes a row. The badge looks like work.

**Detector:**

```sql
select research_type,
       count(*) filter (where status in ('queued','in_progress')) as open_now,
       count(*) filter (where status='completed')                 as ever_completed,
       max(completed_at)::date                                    as last_completion
from research_tasks group by 1 having count(*) filter (where status='completed') = 0;
```

**First run:** **1,123 open tasks across SEVEN types with zero completions in system
history** — `establish_ownership_history` (545), `owner_contact_manual` (316),
`npi_missing_inventory` (203), and four more. Three *other* types are healthy
(`property_missing_recorded_owner` completed 1,007 in 30 days), which is what makes the
contrast credible rather than a measurement artefact.

**⚠️ CLOSURE IS A STATUS, NOT A TIMESTAMP — the first version of this detector was wrong.**
Run across seven other queues on 2026-08-22 it reported **two** as "NEVER CONSUMED":
`action_items` (148 open, 0 closed) and `lcc_owner_contact_propagate_review` (149 open,
0 closed). **Both were false.** `action_items` has **94 completed** and
`lcc_owner_contact_propagate_review` has **52 withdrawn** — neither ever stamps its
`completed_at` / `decided_at` column, so a timestamp test reads zero on a healthy queue.
Test the STATUS column; use the timestamp only for age.

That mis-measurement is itself a real (smaller) defect worth its own fix: **two tables close
rows without recording when**, which silently breaks every age, SLA and throughput analysis
over them — including this detector.

**⚠️ AND THE HYPOTHESIS THIS WAS BUILT TO TEST WAS REFUTED.** "7 of 10 research types are
never consumed, so the rot is probably systemic" — it is not. Corrected results:

| queue | open | closed ever | verdict |
|---|---|---|---|
| `lcc_decisions` | 2,358 | 2,687 (1,254 in 30d) | healthy |
| `lcc_health_alerts` | 12 | 5,223 | healthy |
| `junk_entity_review` | 63 | 218 | healthy |
| `action_items` | 54 | 94 | healthy (untimestamped) |
| `lcc_owner_contact_propagate_review` | 97 | 52 | healthy (untimestamped) |
| `contact_acquisition_review` | 9 | 5 | healthy |
| `comms_owner_attribution_review` | 9 | 22 | healthy |
| **`research_tasks` / `owner_contact_manual`** | **316** | **0** | **the only genuinely dead lane** |

The Decision-Center family is consumed. The research lane is the outlier, and Class 3 explains
why: it is the one work surface with no way to enter an answer. **Do not generalise a single
dead queue into a systemic claim without running the others.**

---

## Class 3 — a surface that notifies but cannot capture

**Symptom:** the lane has a consumer in principle (a human), and the human cannot act,
because there is nowhere to enter the answer.

**Detector:** for any page that renders work, grep its renderer for an input:

```bash
awk 'NR>=<start>&&NR<=<end>' ops.js | grep -cE "<input|<textarea|contenteditable"
```

**First run:** the Research page (`#/research`) returns **0**. Six buttons — Complete,
Follow-up, Dismiss, Run assistant, ChatGPT brief, Claude brief — and no field.
`completeResearch()` posts only `{ research_task_id }`, so "Complete" closes a task without
recording an answer.

**That is the real explanation for Class 2's `owner_contact_manual`.** 316 open, 0 completed,
not because nobody looked but because working it as designed destroys the task and captures
nothing. **Before concluding an operator ignored a queue, check that the queue can be
answered.**

The working capture path exists elsewhere: Owner panel → Contacts → "Select contact" →
`/api/operations?action=select_prospecting_contact`, with "+ Add new" for an unknown person.
Wiring the research card to that existing picker needs no new machinery.

---

## Class 4 — a guard that checks the label, not the substance

**Symptom:** a rule is correct and enforced, and the population it is meant to exclude walks
past it wearing a different label.

**First run:** `NON_REACHABLE_ROLES` excludes broker-ish *roles*. It reported **zero broker
edges on resolved owners** — true, and misleading. 47 competitor-broker edges (CBRE, Eastdil,
JLL) plus 33 of our own `@northmarq.com` colleagues were present, all stamped
`prospecting_contact`, which is not in the list. **80 wrong edges across 27 owners, $340.7M.**

**Check:** for every allow/deny list, ask what *other* attribute identifies the same
population (here: the email domain, not the role string) and measure that too.
Surface: `v_lcc_prospecting_edge_review` (P166).

---

## Class 5 — a dormant capability that looks like a quiet pipeline

**Symptom:** a flag-gated feature no-ops cleanly and indistinguishably from "nothing to do".

**Detector:** `select flag, state, off_since from feature_flags_registry where state <> 'on';`

**First run:** every external contact-acquisition adapter off since June —
`OWNER_ENRICH_SOS_URL`, `_ADDRESS_URL`, `_DEED_URL`, `W9_1_SOS_DIRECT`, all
`SOS_STATE_ADAPTERS.*`. Consequence: 249 owners ($454.6M) with no known person at the firm
have **no automated route to a contact at all**, and the research chain they fall into is
Class 2. The registry already exists for exactly this; it is under-read.

---

## Class 6 — a count that measures state, not throughput

**Symptom:** a number that is large, true, and not about work.

**First run, three instances:**

- The enrich queue read **1,406** while the worker's real working set was **160** — 88.6% of
  rows carried an `active_contact_entity_id` and could only ever return `already_linked`.
  *(And the honest correction: those rows were NOT burning ticks — the handler filtered them
  before fetching. A reporting defect, not a throughput one. Overstating it would have been
  the same sin as the tally it criticised.)*
- Task-summed rent read **$6.78B**; distinct-owner rent is **$1.46B**. Boyd Watterson's 27
  tasks × $179.8M is $4.7B of pure double-count. **Rank owners, not tasks.**
- `hero_gap` was documented as "UI-defect residue, drove 47 → 0". It is
  `effective − hero`, i.e. the *gain* from a fix. Driving it to 0 would destroy 274 owners'
  only contact route.

**Check:** for any headline number, ask *what changes if the system does nothing for a week?*
A count that does not move is inventory, not throughput.

---

## Class 7 — a capability that exists but is unreachable

**Symptom:** the feature is built, correct, tested and deployed. No operator will ever see it.

**First run:** P173 added a "Find the contact" button to `owner_contact_manual` cards — the fix
that made the system's only dead lane answerable. Hours later, P174 measured where those cards
actually appear. The Research page serves `priority.asc, created_at.asc`, 25 per page:

- **page 1 was 25 of 25 `true_owner_needs_salesforce`, zero actionable**
- the first `owner_contact_manual` card sat at **row 1,869 — page 75**

The button was on cards nobody would reach. **A fix that ships behind 74 pages of other work
has not shipped.**

**Cause:** the lane carried a FLAT priority 50 — the unranked default — while a neighbouring
lane had a hard 20. Two other producers in the same table *do* graduate their priorities
(21–25, 50–100), so the absence was specific to this one, not a table-wide convention.

**Detector — run this for ANY new action added to a ranked or paged surface:**

```sql
select min(rn) as first_row, ceil(min(rn)/25.0) as first_page
from (select research_type, row_number() over (order by priority asc, created_at asc) rn
        from research_tasks where status in ('queued','in_progress')) z
where research_type = '<the lane your new button lives on>';
```

**The general question: after building something, ask what the operator sees on the first
screen — not whether the thing works.** Correct-and-invisible is indistinguishable from
not-built, and it *tests* as success: 142/142 guards passed on a button at page 75.

**⚠️ Ranking is not just promotion.** 32 high-value tasks moved up AND 213 unsized ones moved
DOWN (below the old default). A blanket promotion of the whole lane would have inverted the
noise rather than removed it.

---

## Class 8 — a producer re-creates what the cleanup cleaned

**Symptom:** a defect you already fixed is back tomorrow. Repairs "don't stick", and the
cleanup function tests as correct because it *is* correct.

**First run (P175, 2026-08-26):** 119 tombstones carried 198 live portfolio facts worth
$71.8M of current annual rent. This looks exactly like Class 1 — an entity FK missing from
the merge path — and it is not. `lcc_reconcile_tombstone_backrefs` handles portfolio facts
correctly: it dedup-deletes collisions, then repoints the rest. **It moves them, and the
daily sync puts them back.**

**Cause, one line in `lcc_finalize_entity_portfolios`:**

```sql
WHERE EXISTS (SELECT 1 FROM entities e WHERE e.id = aggregated.entity_id)
```

**A tombstone still exists.** It is a row in `entities` carrying `merged_into_entity_id`, so
an existence check passes for every ghost. (This is Class 4 wearing different clothes — the
guard checks existence, not liveness.) The `entity_id` arrives as the *domain's*
`true_owner_id`, and the domain DBs know nothing about LCC merges, so every sync re-sends the
pre-merge id and the finalizer resurrects it.

**Detector — the question is "was this row written AFTER the cleanup that should have removed
it?":**

```sql
-- PREFER created_at. "Was this row CREATED after the merge?" is unambiguous;
-- updated_at can move on an unconditional touch (see the ON CONFLICT caveat below).
select case when f.created_at > e.updated_at
            then 'CREATED after the merge -> a live producer'
            else 'historical residue' end as verdict,
       count(*),
       count(*) filter (where f.created_at > now() - interval '30 days') as last_30d,
       max(f.created_at)::date as newest
from entities e join <table> f on f.entity_id = e.id
where e.merged_into_entity_id is not null
group by 1;
```

`entities` has no `merged_at`, so `e.updated_at` is the merge-time proxy. Any later touch of the
entity pushes it forward, which makes the test **conservative** — it under-reports, never invents.

All 92 then-measured ghosts returned **written after the merge, most recent = today**. That
single result is what separates "clean it up" from "find the producer" — and it is the whole
difference between a fix and a chore you repeat every morning.

**⚠️ Two false steps on the way, both worth keeping:**

1. **The first attribution test was meaningless.** "Did this merge run through the reconcile?"
   was answered by looking for rows in `r40_merge_reconcile_backup` — which is only written
   when `p_snapshot := true`, and `lcc_merge_entity` passes `false`. So the table is empty for
   *every* normal merge and "1 of 92 ran through reconcile" measured nothing at all. Before
   trusting a coverage signal, check that the signal is *emitted* in the path you are
   measuring.
2. **`updated_at` moves on an unconditional touch.** The `ON CONFLICT DO UPDATE` sets
   `updated_at = now()` whether or not anything changed, so "written today" proves the row is
   being *re-affirmed* daily — which is the point — but would not prove the values changed.
   State the claim you can support.

**The fix is at the producer, and the ordering matters:** resolve the id through
`lcc_entity_survivor` **before the GROUP BY**, not at the INSERT. Two pre-merge ids collapsing
to one survivor would otherwise arrive as duplicate keys in a single statement and Postgres
rejects it outright — *"ON CONFLICT DO UPDATE command cannot affect row a second time."*

**⚠️ And the repair itself needed three classes, not two — see P175a.** "The survivor already
holds this property, so the ghost row is a duplicate" is the obvious rule and it would have
destroyed live rent. Carrington, gov property 2654: ghost `is_current` with $1.7M and no end
date; survivor `is_current = false`, ended 2024-05-01. Those rows **contradict** each other
about whether the owner still holds the asset — deleting the ghost resolves the conflict
toward the stale side. The aggregate split (183/3) hid it completely; only reading a named row
with a stated expectation exposed it. Final disposition: 3 repoint, 183 dedup-delete, **12
conflicts surfaced in `v_lcc_portfolio_ownership_conflict` and not decided**.

### Class 8, second instance — it ate my own repair inside 24 hours (P176, 2026-08-26)

**P172 superseded 78 `junk_entity_name` cards whose subject had been merged away, and reported
80 → 2 open. By the next morning 10 of those exact cards were open again.** Not similar cards
— the same subjects, re-minted the same day, including the very names P172's own header quotes
as examples (JBG SMITH | Ares Management, Terreno Realty, InCommercial Property Group). 10 of
10 re-opened cards had a P172-superseded sibling.

**Cause: closing a card is not closing a lane.** The junk lane does not seed from
`lcc_decisions`; it seeds from a flag on the *entity*, `metadata->>'junk_name_flagged'`. P172
closed the symptom and left the seed, so the nightly seeder did exactly its job. The full
re-mint surface was **78 — precisely the number P172 had closed**; 10 had fired, 68 were queued
for later nights.

**The durable rule: when you retire an item, find the predicate the PRODUCER selects on and
clear that too.** Ask "what would make this row get created again tomorrow?" The B9 bulk worker
already knew this and says so in a comment — `delete meta.junk_name_flagged; // drop out of the
lane (seed predicate fails)`. The knowledge was in the codebase and the repair did not use it.
**Grep for how a lane is *seeded* before writing anything that closes its items.**

**Pair every such repair with a standing sweep** (cron 238, daily 06:40). A one-shot fix for a
recurring producer is a chore you repeat silently forever. Idempotent, so a no-op day is free.

**⚠️ Scope held narrow twice, and both mattered.** Only `junk_entity_name` —
**`exact_name_merge` (62 stranded, 0 open) has a tombstone subject BY DESIGN**, because the card
records *which* entity was merged away; "fixing" it would falsify the history it exists to
preserve. And only already-merged entities: **712 LIVE entities carry the same flag and were
left untouched**, because this is a merge-staleness fix, not a way to drain the junk lane.

**Also measured, not a defect:** 211 further junk cards on tombstones were minted BEFORE their
subject was merged, and are all already decided — ordinary staleness in closed history.

**⚠️ The meta-lesson: a verified result has a shelf life.** P172's write-up was true at the
moment of measurement and false by morning. Nothing in the verification gate was wrong; the
gate simply could not see the producer. For any repair of a populated table, **the gate should
be re-run a day later**, or replaced by a standing sweep that makes the question permanent.

### Class 8, third instance — and the detector's own blind spot (P177, 2026-08-26)

The sweep reported `entity_relationships` (184 stranded), `lcc_owner_reconcile_evidence` (203)
and `external_identities` (45) as **"unmeasurable — no `updated_at`"**, and I filed that as an
observability gap needing schema work. **All three have `created_at`**, which is the *better*
signal for this exact question. Re-running the detector against it answered all three
immediately, no migration required.

**Before declaring something unmeasurable, check the columns that ARE there.** A detector that
looks for one column name and reports absence as "unknowable" manufactures a blocker.

What it then found: `entity_relationships` had **131 edges created after their party was merged,
125 in the last 30 days** — in the party-role store the deal spine and reachability read, so
unlike a log table these are not inert. The population is transaction history
(listing_broker 48, true_seller 20, buyer 17, owner 12, …), so the BD cost is concrete:
**41 distinct survivors were under-reporting their own deal history**, which is precisely the
signal prospecting ranks on.

**Fix pattern worth reusing: a BEFORE INSERT trigger, not a patched caller.**
`insertEntityRelationship` is the single JS choke point, but a trigger also covers SQL writers,
costs no extra round trip, and cannot be bypassed by the next producer someone adds. It must
**skip rather than raise** in two cases — a resolved self-loop (which a CHECK constraint would
reject, breaking the ingestion that wrote it) and a duplicate of an edge the survivor already
holds (there is no unique constraint, so nothing else would catch the double-count).

**⚠️ And the first repair was half a repair — caught by its own gate.** It selected only rows
whose FROM endpoint was a tombstone; verification then read 0 stranded on `from` and **14 still
stranded on `to`**. An edge has two ends. (P118: fix every layer, not the one the error names.)
Write the gate to check every side of the thing you repaired, not the side you happened to fix.

---

## What to audit next

Ordered by expected yield, not by ease:

0. ~~**Class 8 across every table the merge path cleans**~~ — **SWEPT 2026-08-26, and it
   found a second live producer.** The detector was run across all 38 entity-referencing
   columns carrying stranded rows. Result:

   | table.column | stranded | verdict |
   |---|---|---|
   | **`lcc_decisions.subject_entity_id`** | **296** | **CLASS 8 — 81 genuinely re-created, 11 STILL OPEN, 10 created in the last 7 days** |
   | `lcc_entity_portfolio_facts.entity_id` | 12 | the held P175a conflicts (expected) |
   | `lcc_owner_evidence.entity_id` | 3 | Class 8, trivial volume |
   | **`entity_relationships.from_entity_id`** | **184** | ~~unmeasurable~~ → **CLASS 8: 131 created after the merge, 125 in the last 30 days. FIXED by P177** |
   | `entity_relationships.to_entity_id` | 14 | Class 8 — missed by the first repair, fixed in P177b |
   | `external_identities.entity_id` | 45 | ~~unmeasurable~~ → 26 created after the merge — **STILL OPEN, next up** |
   | `lcc_owner_reconcile_evidence.*` | 203 | ~~unmeasurable~~ → 0 created after the merge (historical residue) |
   | `lcc_boyd_reconcile_2026_07.entity_id` | 50 | one-off reconcile table, correctly historical |
   | 30 further columns | 1–50 each | mostly logs/backups (correctly historical) |

   **⚠️ The headline number was wrong on first read and self-inflicted.** The raw detector
   said 94 re-created on `lcc_decisions` — but **P172 had superseded 78 of those cards hours
   earlier**, and its own writes bumped `updated_at`. 13 of the 94 were mine. *When you run a
   "was this written after X" detector, exclude your own batch first*, or you will discover
   your own footprints and report them as the defect.

   ~~**NEXT (P176): `lcc_decisions` needs the same treatment as P175.**~~ — **DONE
   2026-08-26, and the diagnosis was wrong in an instructive way.** The predicted fix was "the
   minter must resolve `subject_entity_id` through `lcc_entity_survivor()`" — but the minter
   already filters `merged_into_entity_id=is.null` at scan time. Measuring instead of
   assuming split the 229 stranded junk cards cleanly: **211 were minted BEFORE their subject
   was merged** (ordinary staleness, all decided) and **18 while it was already a tombstone**,
   10 of them still open. Those 18 came from the *seed flag on the entity*, not from the
   minter. See "Class 8, second instance" above — the real fix was clearing
   `metadata->>'junk_name_flagged'`, plus cron 238. **A plausible root cause named before
   measurement pointed at the wrong function entirely.**

   **NEXT (P178): `external_identities`** — 45 stranded, **26 created after their entity was
   merged**, dominated by the CoStar sidebar (`costar/company` 18, `salesforce/Account` 3,
   `rca/company` 3; newest 2026-08-10). `lcc_reconcile_tombstone_backrefs` DOES move identities
   on merge, so this is Class 8 again: a producer re-minting them. The P177 pattern applies
   directly — a BEFORE INSERT trigger resolving `entity_id` through `lcc_entity_survivor()`.
   Note the `chk_external_identities_source_system` CHECK and the canonical-scheme rules in
   CLAUDE.md must be respected; and an identity is keyed `(source_system, source_type,
   external_id)`, so resolution can collide with the survivor's existing identity — skip, don't
   raise, exactly as P177 does.

   **Also still open:** `lcc_sync_property_owner_to_portfolio` carries the identical
   existence-not-liveness guard. It has no cron and no caller today (checked), so it was
   deliberately left alone rather than changed on suspicion — but it must be fixed before
   anything is ever wired to it.

1. ~~**Class 2 across the other queues**~~ — **DONE 2026-08-22, hypothesis refuted.** Six of
   seven are healthy; `owner_contact_manual` is the only genuinely dead lane. See the
   corrected table under Class 2. Still unchecked: `inbox_items`, `pending_updates`,
   `entity_match_candidates` (different seam names — they did not surface in the
   status-column scan and need locating first).
2. **`lcc_decisions` 286 stranded subjects** — Class 1's largest finding, and it sits on the
   Decision Center, the surface most likely to be trusted. Note the lane itself is HEALTHY
   (2,687 closed) — so this is 286 cards being worked against an entity that no longer
   exists, which is worse than a dead queue, not better.
3. **Two queues that close without stamping a closure time** — `action_items.completed_at`
   and `lcc_owner_contact_propagate_review.decided_at` are never written. Cheap to fix,
   and until it is, no age or throughput measure over those tables can be trusted.
3. **Class 3 across every work surface** — Decision Center lanes, inbox triage, the
   contact-acquisition review. Each one: can the operator actually record the answer?
4. **Crons that succeed and change nothing** — ⚠️ **ATTEMPTED 2026-08-25. THE DETECTOR DOES
   NOT WORK WELL ENOUGH TO SHIP, and the reason is worth more than the detector would have
   been.** Method: parse each cron's function for `insert into` / `update` targets, then count
   rows in those tables touched inside the run window.

   First version flagged **108 of 135 active jobs (80%)** — not a defect rate, a broken
   detector. Three bugs, all fixed: `lcc_cron_post` is an HTTP *dispatcher* whose real work
   happens at Railway (61 jobs — analysing it measures the messenger); the regex returned SQL
   keywords (`SET`, `SKIP`) as table names; and the timestamp probe only looked for
   `updated_at`/`created_at`.

   Fixed, it flagged 8. Checked by hand, those 8 are:

   | | count | |
   |---|---|---|
   | **no timestamp column at all** | 3 | `lcc_reusable_owner_contacts` (10,430 rows), `lcc_owner_evidence_cache` (43,161), `lcc_sf_comp_on_market` (1,696) — all healthy |
   | `*_inflight`, transient by design | 2 | empty is *correct*; rows are deleted after use |
   | weekly job, 1 run in a 7-day window | 2 | not enough signal |
   | ~~genuine candidate~~ | 1 | `lcc-owner-contact-review-autoretire` — **also not a defect**, see below |

   **The one "genuine candidate" was not one either. Final score: 0 of 8.** The sweep
   retires nothing while 97 rows sit pending, which looks damning — but the cron passes
   `false` (it runs live, not dry-run), and its own dry-run returns **empty**: none of the 97
   premises have cleared. Writing nothing is the correct answer. Same shape as P165a.

   **That is the deepest reason the method fails, and it is not fixable by parsing.** For an
   auto-retire sweep, a health check, or any guard, *writing nothing is the expected steady
   state*. "Ran clean, wrote nothing" is not a defect signal for that entire class of job.

   **The refined method, if anyone revisits it:** only evaluate jobs whose function is
   expected to write on EVERY run — syncs, refreshes, ingests — and exclude sweeps, guards and
   health checks by design. That is exactly why the P157 case was findable:
   `lcc_sync_owner_contact_signals` was supposed to write every run. A sweep that writes
   nothing is healthy; a *sync* that writes nothing is broken. The detector treated them alike.

   `lcc_audit_silent_crons()` was built, evaluated, and **DROPPED** rather than shipped. An
   audit function with a 0-for-8 hit rate is worse than no audit function, because someone
   will eventually trust its output.

   **The blocking limitation is not fixable by better parsing: a table with no timestamp
   column cannot distinguish "nothing was written" from "a write is unobservable."** Three of
   eight flags were exactly that, on tables holding tens of thousands of rows.

   ⚠️ **And a correction worth keeping:** this was briefly reported as having "independently
   rediscovered" the known P157 case (cron 136/137). It did not. It flagged that job because
   its only parsed write target is a transient inflight table that is always empty —
   coincidence, not detection. The P157 case was findable originally *because it had
   observable state*; this method would have missed it.

   **What would actually work** — and is the real prerequisite: give the write-target tables a
   timestamp. `lcc_reusable_owner_contacts`, `lcc_owner_evidence_cache` and
   `lcc_sf_comp_on_market` have no `_at` column at all, so no throughput measure over them is
   possible by any method. That observability gap is the item, not the parser.
5. **The `establish_ownership_history` producer** — 545 open, 0 completed, emits one task per
   property with no value gate. Either give it a consumer or stop it producing; P165a added
   the auto-retire predicate but the value gate is still missing. **It is now the largest
   never-consumed block sitting above the newly-ranked contact lane.**
6. **The observability gap (blocks Class 6, Class 8, and any future Class-4 detector)** —
   `lcc_reusable_owner_contacts` (10,430 rows), `lcc_owner_evidence_cache` (43,161) and
   `lcc_sf_comp_on_market` (1,696) have **no `_at` column at all**. No age, SLA, freshness or
   throughput measure over them is possible by any method. Cheap to add, and it is the
   prerequisite for the silent-cron question ever being answerable.

   ~~**Widened by the 2026-08-26 Class-8 sweep, which is now blocked on it.**~~ —
   **RETRACTED the same day. This was my detector's blind spot, not a schema gap.** I claimed
   `entity_relationships` (184 stranded), `lcc_owner_reconcile_evidence` (203) and
   `external_identities` (45) were unmeasurable for lack of `updated_at`. **All three have
   `created_at`**, which answers the Class-8 question *better* — "was this row CREATED after
   the merge?" is unambiguous where `updated_at` can move on a no-op touch. Re-running against
   it classified all three instantly and found P177's 131 live strands. No migration was ever
   needed. **A detector that looks for one column name and reports absence as "unknowable"
   manufactures a blocker** — and this one nearly sent a schema change up the priority list
   ahead of the real defect it was hiding.

   The genuine gap is narrower than stated: `lcc_reusable_owner_contacts`,
   `lcc_owner_evidence_cache` and `lcc_sf_comp_on_market` have **no `_at` column of any kind**,
   so freshness/throughput over them remains unanswerable.
7. **Two queues that close without a closure timestamp** — `action_items.completed_at`,
   `lcc_owner_contact_propagate_review.decided_at`. Same family as (6).
8. **Duplicate entities surfaced by the ranked contact lane** — "George Washington University"
   and "George Washington University (The)" ($23.8M + $23.4M, one prospect, two entities);
   "Penzance Management LLC" twice at identical rent in the priority-5 block. The ranked
   surface makes these obvious in a way the unranked one never did — **expect ranking to keep
   exposing duplicates, because it puts near-identical rows next to each other.**
9. **Class 7 on every other paged surface** — Decision Center lanes, inbox triage, My Work.
   Ask of each: what is on page 1, and is any of it actionable?
10. **A private-vs-public prospecting call for Scott** — George Washington University sits at
    priority 5. Doctrine excludes "public entities like a state or county"; GWU is a *private*
    university. Deliberately not decided by Claude (see P174).

---

## The habit, in one line

**Read the named rows before you believe the aggregate, and before you write.**

Every avoided disaster this session came from that: 103 individual owners nearly cleared
(P164) — caught by reading names; a re-attach loop that would have made P162–P164 look
successful while changing nothing (P163b) — caught by asking what the worker does *after* the
guard; an AR Global person nearly attached to Global Net Lease (P170) — caught by reading
nine rows before a write of nine rows.
