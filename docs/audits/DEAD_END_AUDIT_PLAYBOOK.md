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

## What to audit next

Ordered by expected yield, not by ease:

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
4. **Crons that succeed and change nothing** — join `cron.job_run_details` to a row-count
   delta on the table each job is supposed to write. The doctrine is already in `CLAUDE.md`
   (cron 136/137 ran green for three weeks writing nothing); there is no detector yet.
5. **The `establish_ownership_history` producer** — 545 open, 0 completed, emits one task per
   property with no value gate. Either give it a consumer or stop it producing; P165a added
   the auto-retire predicate but the value gate is still missing.

---

## The habit, in one line

**Read the named rows before you believe the aggregate, and before you write.**

Every avoided disaster this session came from that: 103 individual owners nearly cleared
(P164) — caught by reading names; a re-attach loop that would have made P162–P164 look
successful while changing nothing (P163b) — caught by asking what the worker does *after* the
guard; an AR Global person nearly attached to Global Net Lease (P170) — caught by reading
nine rows before a write of nine rows.
