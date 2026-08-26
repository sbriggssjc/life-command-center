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

**⚠️ REFINEMENT (P179, 2026-08-26): "unreachable" does not always mean "rank it higher", and
assuming it does will make you demote healthy work.** Ranking `establish_ownership_history`
from a flat 100 to priority 30 left it at **row 1,528 — page 62** of the global list. The
tempting next move is to push down whatever sits above. Measured first: the 1,527 rows ahead
were two lanes with **4,772 and 595 lifetime completions**, one of them completing rows that
same day. They are not noise; they are the system working.

So the question "why can't the operator reach this?" has at least three different answers, and
they need different fixes:

| cause | fix |
|---|---|
| the lane is unranked / flat-defaulted | rank it (P174) |
| the lane is ranked but genuinely behind more valuable work | a FILTER or lane picker, not a re-rank |
| the lane is ranked and reachable but has no way to answer | a capture path (Class 3 / P173 / P179) |

**Before promoting anything, measure the throughput of what it would displace.** A lane one
filter-click away with its best work on page 1 is reachable; a lane at page 62 of an
undifferentiated list is not — and the difference is navigation, not priority.

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

### Class 8, fourth instance and closure (P178, 2026-08-26)

`external_identities` — 45 stranded, 26 created post-merge, same trigger pattern, 45 repointed
with **0 collisions** (the unique key excludes `entity_id`, so the P177 dedup class barely
exists here) and **0 domain-anchor identities affected**.

**Status: the class is closed.** Four live producers found and fixed in one day — portfolio
facts ($71.8M), the junk-lane seed flag, relationship edges (41 survivors' deal history),
identities. The re-sweep leaves only by-design history, backups, and one held human judgement.

**What made all four findable was a single question**, asked of a table nobody suspected:
*"was this row written AFTER the thing that should have removed it?"* Three of the four had
been running for weeks against surfaces that all read healthy. Run this sweep after any bulk
merge, and before believing any count that joins `entities`.

---

## Class 9 — a RECEIVER with no SENDER (built, wired, never fed)

**Symptom:** a capability is fully implemented — endpoint, matching rule, UI badge, schema
columns — and no data has ever reached it. Distinct from Class 5: there is **no flag**, so it
does not appear in `feature_flags_registry`, and nothing anywhere reports it as off. It is
invisible by construction.

**First run (2026-08-26).** Scott assumed his LinkedIn→Outlook contact sync was reaching the
LCC. `api/_handlers/contacts-handler.js` accepts `outlook_contact_id`, carries a **Tier-3 match
rule** on it and renders an Outlook source badge; `unified_contacts` has the columns. Measured:
**0 of 31,038 rows populated, `last_synced_outlook` = never.** The receiver had been complete
and unfed since before the table had 31,000 rows. Building the one missing Power Automate flow
landed **2,809 contacts, 1,130 titles and 98 acquisitions contacts** in 88 minutes — against a
prior title coverage of 1.9%.

**Detector — enumerate external-system id / sync columns and count what is populated:**

```sql
do $$
declare r record; n bigint; tot bigint;
begin
  create temp table _unfed(tbl text, col text, populated bigint, total bigint) on commit drop;
  for r in
    select c.table_name t, c.column_name c
    from information_schema.columns c
    join information_schema.tables tb on tb.table_name=c.table_name and tb.table_schema='public'
    where c.table_schema='public' and tb.table_type='BASE TABLE'
      and (c.column_name ~ '^(sf|outlook|icloud|webex|teams|iphone|linkedin|zoom)_.*_id$'
           or c.column_name ~ '^last_synced_'
           or c.column_name ~ '_(external|source)_id$')
  loop
    begin
      execute format('select count(*) filter (where %I is not null), count(*) from %I', r.c, r.t) into n, tot;
      if tot > 100 then insert into _unfed values (r.t, r.c, n, tot); end if;
    exception when others then null; end;
  end loop;
end $$;
select * from _unfed where populated = 0 or populated < total*0.01 order by total desc;
```

**Live result after fixing the Outlook one — SIX more, clustered in the same subsystem:**

| table.column | populated | of |
|---|---|---|
| `unified_contacts.last_synced_calendar` | 0 | 32,833 |
| `unified_contacts.webex_person_id` | 0 | 32,833 |
| `unified_contacts.icloud_contact_id` | 0 | 32,833 |
| `unified_contacts.teams_user_id` | 0 | 32,833 |
| `lcc_sf_list_membership.sf_lead_id` | 0 | 7,186 |
| `listing_bd_runs.sf_deal_id` | 0 | 1,472 |

The contacts handler ships `ingest_calendar_contacts`, `ingest_webex_calls`, `send_teams` and
`send_webex` — **every one built, every one with zero data.** Whether each is worth feeding is a
separate judgement (Webex/Teams may simply not be used); the point is that *nobody knew*.

**⚠️ Corollary: a zero column is not automatically a defect.** Some receivers were built for
tools the firm does not use. The detector produces CANDIDATES; each needs the question "is
there a sender, and should there be?" answered on its own terms. Record the verdict either way
so the next sweep does not re-litigate it.

**The general question: for every integration we can RECEIVE, does anything SEND?** Grep for
the write path, then count the rows. A receiver is cheap to build and invisible when unused,
which is why these accumulate.

**VERDICTS RECORDED 2026-08-26 (P182) — do not re-litigate these:**

| candidate | populated | verdict |
|---|---|---|
| `unified_contacts.last_synced_calendar` + the whole `meetings` table | 0 / 32,833 | **DEFECT — fixed target identified.** The receiver is built and P116-hardened; a live sync points at another project with a schema that drops attendees. See the Class 9 refinement above. |
| `unified_contacts.teams_user_id` | 0 / 32,833 | **Not a defect.** `sendTeamsMessage` resolves via `contact.email \|\| contact.teams_user_id`; email is the primary path and is populated. Teams is used; the column is an unused optimisation. |
| `unified_contacts.webex_person_id` | 0 / 32,833 | **Not a defect — but invisible.** Needs `WEBEX_CLIENT_ID`/`_ACCESS_TOKEN`, no flow, no evidence Webex is used (Northmarq uses Teams). **Absent from `feature_flags_registry`** — add a row so Class 5 can see it. |
| `unified_contacts.icloud_contact_id` | 0 / 32,833 | **Not a defect.** No sender, no stated intent. |
| `lcc_sf_list_membership.sf_lead_id` | 0 / 7,186 | **Not a defect.** All 7,186 carry `sf_contact_id`, **zero carry neither** — the lists in scope are Contact-based campaigns. |
| `listing_bd_runs.sf_deal_id` | 0 / 1,472 | **Not a defect.** Table is live (254 runs/30d); CLAUDE.md documents the `sf_deal_id` stamp as gated on a live SF connector, and it is written to `sf_deal_staging`. |

**Use a CONTROL column.** These zeros are only trustworthy because `last_synced_outlook`
(2,809) and `last_email_date` (880) prove the same query shape finds data when data exists.
A sweep of all-zero columns with no populated control is measuring the query, not the system.

---

## Class 10 — an EXCLUSION with no counterpart that PROMOTES

**Symptom:** a surface excludes a population on the grounds that it is "already handled", and
nothing handles it. The exclusion is correct in isolation; the system has a hole where the
handler was assumed to be.

> **⚠️ AND WHEN YOU FIX ONE, THE RELEASE GATE IS THE HARD PART — NOT THE DETECTION.**
> P182a, 2026-08-26. The fix for this class is a sweep that closes items whose premise
> cleared. Written against "the owner now has an `active_contact_entity_id` that doesn't
> restate the owner name", it matched **115 tasks. Only 5 qualified.** Reading them:
> **104 were SELF-ECHOES with zero email and zero phone** — the owner's own name copied into
> the contact slot ("Alan Cohen" → Alan Cohen, "Avalon Companies" → Avalon Companies). Closing
> those would have suppressed 104 owners from the acquisition lane while nobody could be
> called: the premise had not cleared at all. That is the **P164 phantom-contact shape**, one
> apply away.
>
> **A NAME IS NOT A CONTACT. REACHABILITY IS.** Gate on email-or-phone, not on the presence of
> a row.
>
> **And the obvious discriminator was also wrong.** Splitting "an individual owner is
> legitimately their own contact" from "an org as its own contact" via
> `lcc_owner_name_has_org_marker` put **PS Business Parks, Rexford Industrial, Sterling Bay,
> Foulger Pratt and FD Stonewater** in the INDIVIDUAL bucket — a firm without a legal suffix
> reads as a person. Class 4 inside a Class 10 fix.
>
> **Close as `skipped`, never `completed`.** The premise cleared; nobody did the work. Marking
> them completed credits the lane with completions that never happened **and corrupts the
> Class 2 detector**, which keys on that exact status.

**First run (2026-08-26).** `v_owner_contact_worklist` excludes any owner that already has a
linked person — correct, they need no contact *acquisition*. But **nothing promotes that person
into `owner_contact_pivot`**, which is what the engine and the panel actually read. Measured
over the 120 suppressed owners ($875.3M): 72 work as designed, 37 have an empty pivot, and
**11 have no pivot row at all — $240.5M, suppressed AND invisible**, including Easterly
($85.0M), NGP Capital ($59.8M), US Fed Properties Trust ($53.7M) and Elman Investors ($29.0M).
Their panels read "— none" while a person sat in the graph.

**Detector — find the exclusions, then ask what promotes:**

> **⚠️ THE DETECTOR ORIGINALLY PUBLISHED HERE COULD NOT FIRE. It is corrected below.**
> It grepped `pg_views.definition` for `NOT\s+EXISTS`, but **Postgres deparses view
> definitions when it stores them** — `NOT EXISTS (...)` becomes `NOT (EXISTS (...)`, and
> `x NOT IN (...)` becomes `NOT (x IN (...)` / `<> ALL`. The published regex requires
> whitespace between the tokens; the stored form has `(`. Measured on LCC Opps 2026-08-26:
> **0 of 210 views matched**, including `v_owner_contact_worklist` — the very view this class
> was written to describe, which contains four exclusions. See Class 11.

```sql
-- Candidate exclusions across every view. Matches the DEPARSED forms Postgres stores,
-- plus the LEFT JOIN / IS NULL anti-join idiom the original detector never considered.
select viewname,
       (length(definition) - length(replace(definition,'NOT (EXISTS','')))/11        as n_not_exists,
       (length(upper(definition)) - length(replace(upper(definition),'<> ALL','')))/6 as n_not_in_all,
       definition ~* 'NOT \(\w[\w.]* IN '                                            as has_not_in_subq
from pg_views
where schemaname = 'public'
  and (definition ~* 'NOT \(EXISTS' or definition ~* '<> ALL' or definition ~* 'NOT \(\w[\w.]* IN ')
  and viewname ~* '(worklist|queue|candidate|review|prospect|target|actionable|unreach|gap)'
order by n_not_exists desc, viewname;
```

**Corrected first run (2026-08-26): 22 views**, where the published detector found zero.
For reference, the three idioms across all 210 public views: `NOT (EXISTS` 21,
`<> ALL` 10, `LEFT JOIN … IS NULL` 72.

For each hit, ask the two questions the detector cannot: **what population does this exclude,
and what is supposed to serve it?** Then verify that thing actually does, by counting the
excluded rows that reached the downstream surface. If the answer is "I assumed something else
picked it up", that is the defect.

**⚠️ Two hypotheses were discarded on the way to this one, both plausible:** that two
definitions of owner rent disagreed (they matched to the dollar), and that the suppression came
from broker links we may not call (measured fleet-wide: **zero** owners suppressed by
broker-only links). Either would have produced a confident, wrong fix.

---

### Class 10 refinement — an exclusion keyed on an OPEN state that nothing ever CLEARS (P182)

The first instance was *"excluded because it is already handled, and nothing handles it."*
The second shape is nastier because the exclusion is genuinely correct when written:

`v_owner_contact_enrich_queue` excludes owners with an **open** `owner_contact_manual`
task — added by P159 so the automated worker stops burning ticks on rows only a human can
resolve. Correct. But **all 316 of those tasks are `status='queued'` and not one has moved
to any other status in two months.** There is no auto-retire sweep for the lane, so the
exclusion never expires: the owner is removed from automated processing *permanently*, by a
state that nothing in the system clears.

Measured: **115 owners ($102.4M) already have a genuine named active contact in
`owner_contact_pivot`** — the exact field the panel and the engine read — while their card
still says *find the contact*. Gba Associates LP ($27.2M, Vincent Forte) and Reston Va II FGF
($25.3M, Joseph Capra) have been queued **43 days**.

**The rule: an exclusion that keys on a mutable state needs a counterpart that clears that
state.** This is doctrine rule 2 (auto-retire) applied to the *exclusion* rather than to the
queue. Ask: *what event sets this state false, and does anything ever fire it?*

**Two guards it had to survive, either of which would have inflated the number:**
`works_at` is the weak Salesforce org edge (P161) — split by type before calling an owner
reachable (here: **all 185 edges `associated_with`, zero `works_at`**, so the trap did not
apply); and a pivot contact that merely restates the owner name is not a contact (P131) —
5 of 120 were self-echoes, leaving 115.

**And report the number the consumer sees.** Lane-wide 115/316 = 36% are already answered,
but on **page 1 only 3 of 25** are. Both are true; only the second describes the operator's
experience.

### Class 9 refinement — the sender exists, and writes to the WRONG receiver (P182)

Class 9's first instance was *no sender at all*. The harder variant: a sender is live,
healthy and fresh — pointed at a different datastore with a **lossy schema**.

The LCC calendar bridge (`calendar.event.link`) is fully built: attendee→contact matching,
`entity_links`, a `meetings` upsert, an `activity_events` append, and the **P116**
`resolveSourceUserId` fix applied to `meetings.source_user_id`. Measured: `meetings`
**0 rows**, `last_meeting_date` **0/32,833**, `last_call_date` **0/32,833** — against
controls that prove the method (`last_synced_outlook` 2,809, `last_email_date` 880).

Meanwhile both calendar flows POST to **a different Supabase project** — `dia.calendar_events`,
**1,007 rows synced the same day** — and *that table has no `attendees` column*. The meetings
are captured and **every attendee is discarded at ingest**: the ORE Unit C shape, where the
parser found the addresses and then stripped them.

**So "is there a sender?" is the wrong question on its own.** Ask **"is there a sender, where
does it point, and does the schema it writes keep the field this receiver exists to consume?"**
A live green sync is not evidence that the signal survives.

---

## Class 11 — a DETECTOR that cannot fire

**Symptom:** an audit query returns empty, and empty reads as *clean*. The detector is
subtly unable to match anything, so it certifies health forever — the playbook's own
failure mode (*a surface that answers confidently instead of erroring*) turned on the
audit tooling itself.

**First run (2026-08-26).** The Class 10 detector above greps `pg_views.definition` for
`NOT\s+EXISTS`. Postgres **deparses** a view when it stores it, so the text is
`NOT (EXISTS (` — never `NOT EXISTS`. It matched **0 of 210 views**, including the one
view Class 10 was written from. Corrected, it matches 22. The zero was not a finding; it
was the instrument.

**The same trap in other clothes** (all three have bitten this codebase):

- **the stored form differs from the written form** — `pg_views` deparsing here;
  `reloptions` storing `security_invoker=on` so a test for `'%security_invoker=true%'`
  returns the exact opposite of the truth (P157).
- **the signal is not emitted in the path being measured** — counting rows in
  `r40_merge_reconcile_backup` to prove merges ran through the reconcile, when
  `lcc_merge_entity` passes `p_snapshot := false` and the table is empty for every
  normal merge (Class 8).
- **the column checked is not the column that exists** — reporting three tables
  "unmeasurable, no `updated_at`" when all three carry `created_at` (P177).

**Detector for the detector — run before trusting any zero:**

1. **Point it at a known positive.** Name a row/view/table you are certain should match. If
   it does not, the instrument is broken, not the system. (`v_owner_contact_worklist` has
   four exclusions; a Class 10 detector that misses it is wrong by construction.)
2. **Compare against a coarser count.** 0 of 210 views containing *no* anti-join of any
   kind is not plausible for a mature schema. An implausibly clean result is a bug signal.
3. **Ask what the datastore normalises.** SQL text, reloptions, JSON key order, case
   folding, whitespace — anything you grep as text may not be stored as written.
4. **Use a control column.** F1's zeros were only trustworthy because `last_synced_outlook`
   (2,809) proved the same query shape finds data when data exists.

**⚠️ A regex bug found while writing this, worth keeping:** Postgres POSIX regex does
**not** use `\b` for a word boundary (`\b` is backspace) — it is `\y` / `\m` / `\M`. A
pattern like `~* '\bEXISTS\b'` silently returns **0 matches** rather than erroring. Same
class, one layer down.


## Class 12 — a WORKER whose cursor is its own output, re-checking the same residue

**Symptom:** a scheduled worker fires on time, reports success, and its output table has not
grown in weeks. The backlog behind it is enormous. Nothing errors, and the flag reads `on`.

**First runs (2026-08-26).** Two of ten local-model assists, and they were the only two
without a paging scan:

| lane | flag | output | pool behind it |
|---|---|---|---|
| property-twin assist (P135) | `PROPERTY_TWIN_ASSIST` on | 200 rows, **0 in 7d** | 1,095 pending twin reviews |
| reachability harvest (P136) | `W9_2_REACHABILITY_HARVEST` on | 16 rows EVER, **0 in 11d** | ~15k unreachable contacts |

**The distinction that matters, and P136 is why it is a separate class from P135.** Both took
a fixed first window; only one of them could be fixed by paging.

- **property-twin's annotations ARE its cursor.** An annotated row self-excludes, so lifting
  the window was the whole fix.
- **reachability-harvest's proposals are keyed `(arm, contact, field)` — a target that yields
  NOTHING leaves no trace.** Its diagnostic read `targets:120, donors_found:0,
  with_evidence:0` against a 15k pool: the same 120 selected, found empty, and silently
  forgotten, every night for eleven days. **A worker whose only cursor is its own output
  cannot page past work that produces no output.** It needs a NEGATIVE marker — *checked, and
  empty* — dated and expiring, so the exclusion clears when new evidence lands (Class 10
  refinement, applied to the worker's own window).

**And the second half: blind rank picked targets that could not be resolved.** The harvest
ranked the unreachable pool and *then* asked whether evidence existed for the top 120 —
`with_evidence: 0` — while `evidence_sources` on the very same response read
`{ intake: 5000, comms_names: 4305 }` and `comms_scan.harvestable: 7926`. The evidence was
never scarce; nothing joined the two sides. **Ask what a producer JOINS on, not just what it
orders by.** Ranking an unjoined pool is the P179 lesson (three causes of "unreachable", only
one fixed by ranking) arriving from the producer side.

**Detector — run it against every scheduled worker with an output table:**

1. `max(created_at)` on the output vs the cron's last successful run. A worker green for N
   days with output frozen for N days is this class until proven otherwise.
2. **Diff the working set across two consecutive runs.** Identical target ids twice is the
   whole diagnosis. This is what the P135/P136 regression guards assert.
3. Ask **what would make a target stop being selected.** If the only answer is "it produces
   output", every empty target is permanent residue.
4. Read the worker's own counters for a *re-discovery* tally (`already_annotated`,
   `already_attributed`, `already_drafted`, `no_donor`). A large one against zero writes is
   the cost of confirming nothing changed, not throughput (P123/P159a).
5. Report `remaining_untargeted` and `scan_capped` so a **drained pool** is distinguishable
   from a **stuck window**. Neither P135 nor P136 could tell the two apart before the fix,
   which is precisely why both survived.

**⚠️ Do not fix this with a bigger window.** Raising the 120 to 1,000 would have produced
proposals once and stalled again at row 1,001, with the failure now more expensive to see.
The fix is a cursor that advances and a selection that joins.


## Class 13 — a MATCHING RULE whose eligibility test silently excludes the highest-value population

**Symptom:** a matcher runs fast, returns thousands of rows, and reads as a rich, healthy bench.
The rows it returns are real. The population it *cannot* return is invisible, because a row that
never becomes eligible produces no output, no error and no counter. Distinct from Class 12 (a
worker that re-checks the same residue): here the target is never selected *even once*.

**First run (P186, 2026-08-26).** `v_lcc_tier0_owner_contact_candidates` matches owner-name tokens
against person email domains. 2,358 candidate pairs across 346 owners — plausible, and the named
rows in it are correct. Then the *complement* was measured: 41 owners at ≥ $5M ($902M of rent)
with an EMPTY bench. Probing their real email domains directly found **≈51 people at 9 of those
owners ($358M) already sitting in `entities`**, including **Boyd Watterson ($179.8M, the single
largest owner)**, Adam Portnoy (RMR's CEO) and Sumit Roy (Realty Income's CEO).

Three causes, all inside the eligibility test rather than the data:

| cause | effect |
|---|---|
| `length(token) >= 5` | NGP, RMR, TIAA, USAA, GI, HPI, AVG yield **zero tokens** — acronym firms are structurally excluded, and they are the institutional buyers |
| prefix-only matching (`sld LIKE tok \|\| '%'`) | `watterson` cannot match `boydwatterson`; the owner fails on its own domain |
| a stoplist that can consume the whole name | "Realty Income Corporation" → realty/income/corporation all stoplisted → **zero tokens** (the documented `ownerCore` → empty-string failure, in a new place) |

**Detector — measure the COMPLEMENT, and probe it directly:**

1. List the population the matcher is supposed to serve, and subtract what it returns. **Rank the
   remainder by value.** A matcher is judged by who it misses at the top, not by how much it emits.
2. For the top misses, **look the answer up by hand** — one probe per owner against the domain a
   human would guess. If the data is there, the rule is the defect.
3. Ask **what makes a row ELIGIBLE**, and whether any legitimate target fails that test before
   matching is even attempted. Length floors, stoplists and prefix anchors are the usual suspects,
   and all three are invisible in the output.

**⚠️ The premise that sent me here was wrong, which is why measuring the complement matters.**
The design doc said these owners needed the Salesforce-by-email-domain path. Measured:
`sf_campaign_members_at_org` is **0 for all 41**. The Salesforce route yields nothing at the org
level — and the people were already in `entities` the whole time. *"The names were never missing,
the LINKS were"* was correct, and still pointed at the wrong link.

**⚠️ And the obvious fix carries a documented trap.** `lcc_owner_strict_core` looks like the
right normaliser and **sorts its tokens**: `'Boyd Watterson Asset Management, LLC'` →
`assetboydmanagementwatterson`, which does not contain `boydwatterson`. CLAUDE.md already warns
about this for acronym initials; it applies to domain matching identically.

**Related, from the same round — a bar that answers the wrong question.** The evidence bar
(Salesforce campaign membership, SF contact, Outlook, correspondence) attests that a PERSON is
real and known to us. It says nothing about whether that person works for THIS owner. **Gary
George at `georgesinc.com` — a poultry company — passes all three tests for George Washington
University.** Before adding evidence to a matcher, state which of the two questions each signal
answers; recall and link-precision are not the same axis, and loosening one does not improve the
other.

---

## What to audit next

> **⚠️ CURRENT BACKLOG LIVES IN `docs/claude-code/prompts/186-continuation-handoff-2026-08-26.md`**
> — priority-ranked, with what is known vs assumed for each item. The list below is the
> historical audit trail; 186 is the working queue. Items 0–5 here are closed.

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

   ~~**NEXT (P178): `external_identities`**~~ — **DONE 2026-08-26.** 45 stranded, 26 created
   post-merge, dominated by the CoStar sidebar. Fixed with the P177 trigger pattern: **45
   repointed, 0 dedup-deleted.** Measuring first corrected two assumptions I had written into
   this very item:

   - I said "an identity is keyed `(source_system, source_type, external_id)` so resolution can
     collide." **The unique key is `(workspace_id, source_system, source_type, external_id)` and
     EXCLUDES `entity_id`** — so a repoint cannot normally collide at all (it would need the
     ghost and survivor to hold the same identity in *different workspaces*). Measured: **0
     collisions.** The guard is still there and still skips rather than raises, but the
     three-way disposition P175 needed does not arise here.
   - **None of the 45 were domain-anchor identities** — zero `asset`, zero `true_owner`. The
     `true_owner` join that resolves a domain owner to an LCC entity BY ID (the one CLAUDE.md
     singles out) was clean. That is the difference between 45 vendor rows and the entire
     owner-resolution path, and it was worth checking before assuming severity.

   **✅ CLASS 8 IS CLOSED.** Full re-sweep of every entity-referencing column carrying a
   `created_at` (excluding this work's own repair logs, which record ghosts by design) leaves:
   61 `exact_name_merge` cards (**by design** — the card records *which* entity was merged away;
   0 open), 1 `sf_contact_account_mismatch` held for a human by P172, 8 void self-referential
   edges left deliberately, and two backup/reconcile tables. **No live producer remains.** Four
   were found and closed in a single day: P175 (portfolio facts, $71.8M), P176 (junk-lane seed
   flag), P177 (relationship edges, 41 survivors' deal history), P178 (identities).

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
5. **The `establish_ownership_history` producer** — **MEASURED 2026-08-26, and TWO of this
   item's own claims were wrong.** It said "0 completed, no value gate, never consumed."

   - **It HAS a value gate.** `below_value_floor` has swept **1,548** tasks (`p_min_value`,
     recorded in `outcome.reason`). P165a shipped the floor *and* the auto-retire.
   - **It IS consumed.** Status counts are **1,690 skipped / 545 queued** — the auto-retire
     closed 1,690, of which 142 were `chain_gap_resolved_or_changed` (the premise clearing on
     its own, still happening through 2026-08-21). "0 completed" was true and "never consumed"
     was false. **Same trap as Class 2's timestamp bug, one level up: `completed` is not the
     only closure status.** Read the whole status distribution, never one value.

   **The real defect is Class 3, not a missing gate.** The 545 remaining are above the floor
   with an unresolved premise — genuine work — and the Research card renders the "Find the
   contact" button **only for `owner_contact_manual`** (`ops.js`, the P173 gate). An
   `establish_ownership_history` card offers Complete / Follow-up / Dismiss / Assist, and
   `completeResearch()` posts only `{ research_task_id }`. So working one destroys it and
   captures nothing.

   **The ranking is also inverted at the bottom, and this is the ordering trap:** by owner
   (deduped, never by task — the 4.65× double-count),

   | priority band | owners | rent | owners ≥ $5M |
   |---|---|---|---|
   | 50–60 (top of lane) | 94 | $259.5M | 5 |
   | 61–80 | 101 | $67.8M | 0 |
   | 81–99 | 46 | $39.2M | 0 |
   | **100 (bottom)** | **214** | **$709.7M** | **31** |

   Nearly 3× the value and 6× the high-value owners sit in the worst slot — the P174 shape
   again (a graduated rank with a large residue dumped at a flat default).

   **⚠️ ORDER MATTERS AND THE OBVIOUS ORDER IS WRONG.** Re-ranking first would promote 214
   owners' worth of *unanswerable* work onto page 1, displacing the contact lane P174 just
   made reachable — strictly worse than leaving it buried. **Capture path first, then rank.**

   **✅ BOTH DONE 2026-08-26 (P179), in that order.** The card now offers "Open ownership →"
   (`researchOpenOwnership`), reusing the property panel's existing Ownership tab — no second
   write surface, mirroring P173. It routes on `domain` + `source_record_id` (the payload uses
   `select=*`, so both were already there); **a test asserts it is NOT wired to `entity_id`**,
   because the task's subject is a property whose ownership chain is unresolved, which makes
   the linked owner the disputed thing rather than the destination. Then ranked by owner rent,
   deduped: 30 / 45 / 65 / 85 → 36 owners ≥ $5M lifted off the flat 100.

   **⚠️⚠️ AND THE RANK ALONE DID NOT MAKE IT REACHABLE — Class 7 again, caught by measuring
   instead of declaring victory.** After ranking to priority 30 the first card still sat at
   **row 1,528, page 62** of the global list.

   **The fix was NOT to demote what sat above it, and checking that is the whole lesson.** The
   1,527 rows ahead are `true_owner_needs_salesforce` (816) and `property_missing_recorded_owner`
   (665) — and **both lanes are healthy and actively worked**, 4,772 and 595 lifetime
   completions, the former completing rows the same day. Demoting drained, real work to surface
   a newer lane would have been the actual defect. P174's note that page 1 was "25 of 25
   true_owner_needs_salesforce, 0 actionable" was about the *contact* lane's actionability, not
   a claim that those cards are noise — and it would have been easy to misread it as licence.

   **Reachability for this lane is the page's `research_type` FILTER, not the global rank.**
   With the lane selected, page 1 now holds **19 distinct owners / $395.0M**, top owner $179.8M.
   *(The naive per-task sum said $809.8M — a 2× double-count. Rank and report per OWNER.)*
   **A ranked lane one filter-click away is a different thing from a lane buried at page 62;
   do not conflate them, and do not "fix" page 1 by demoting healthy work.**
5b. ~~**NEW (P179): the Research page has a type filter but no LANE PICKER.**~~ — **DONE
   2026-08-26 (P180).** `v_lcc_research_lane_summary` + `GET /api/queue?view=research_lanes` +
   chips on the Research page. **It found 14 lanes, not the five this work had been reasoning
   about** — and the two answerable ones carry $1.08B and $754.9M.

   **Three honest-count rules came out of building it, two of them mutation-tested:**

   - **Value is per OWNER, never per task** (2× / 4.65× double-count otherwise).
   - **NULL is not zero.** The first version returned `0` for lanes whose tasks carry no
     `entity_id` — which renders "$0" and reads as *worthless*. Six lanes are in that state and
     **the two largest are the highest-throughput work in the system** (4,772 and 595
     completions). "$0" would have invited exactly the wrong triage. NULL now means "cannot be
     sized" and renders an em-dash — while a GENUINE $0 (8 owners, no known rent) stays $0.
   - **`answerable` is curated, not inferred** — the UI is the authority on whether a capture
     path exists, so it is an explicit list. **When a new capture path ships, update that list
     in the same change**, or the picker under-reports what the operator can do.

   **Newly surfaced by it:** `npi_missing_inventory` — 203 open, 0 completed, 0 skipped.
   ~~a third genuinely dead lane~~ — **that call was WRONG, twice over. See 5c.**

5c. **NEW CLASS-9 CANDIDATE (P181, 2026-08-26): value-gated but not DECIDABILITY-gated.**
   Chasing `npi_missing_inventory` produced two wrong conclusions before the data corrected
   each one, and the pattern is worth more than the fix:

   - **"A third dead lane"** — the tasks were created 2026-08-06..08-15. The lane was **three
     weeks old**. "Zero completions ever" on a new lane is not the same claim as zero on a
     year-old one, and the phrase conceals the difference. *Check the age before calling
     anything dead.*
   - **"It needs a capture path"** — the tasks carry a ready-made `metadata.deep_link`, so a
     button looked obvious. Checking the destination first: **NPI is display-only in the clinic
     panel.** The button would have been the exact P173 trap it was meant to fix. *Verify the
     destination can accept an answer before routing anyone to it.*

   **What was really there:** an NPPES lookup worker had already run — 7,088 rows in
   `npi_registry_lookups`. For the 504 missing-NPI clinics, **all 504 had a lookup, 480 returned
   a candidate, and 0 were applied**, every one `low_confidence`/`no_match`. That is the worker
   *abstaining correctly* under never-guess, and the research tasks are the intended escalation
   of its residue. The lane was the designed flow working.

   **The actual defect: one label covering two different facts.** `low_confidence` was applied
   to everything, so a genuine judgement call and a hopeless one looked identical:

   | best-match score | clinics | reading |
   |---|---|---|
   | ≥ 0.75 | 50 | a real human call |
   | 0.50–0.75 | 141 | weak |
   | **< 0.50** | **289** (avg 0.28) | **not "low confidence" — no match at all** |

   Of the 203 queued tasks, **141 (69%) were unanswerable by anyone**, burying the 15 that were.
   The producer capped by patient volume and never asked whether the question could be answered.
   **The Consumption-Layer "actionable-only" rule has TWO axes — value AND decidability — and a
   lane can pass one while failing the other.**

   Fixed: 141 retired (`no_plausible_npi_match`, reversible, tagged), 47 → priority 60, 15 →
   priority 30. Lane 203 → 62. Gate confirmed **0 tasks scoring ≥ 0.50 were retired**, and two
   independent computations agreed on 15/47/141 before anything was written.

   **Still open:** the 15 (and arguably the 47) want a BINARY VERDICT surface — "is clinic X the
   same facility as NPPES org Y?", clinic name/address beside `best_match_org`/`npi_address`.
   That is a Decision Center lane, not a research card. Until it ships they remain notify-only,
   and the lane picker correctly reports `answerable = false`.

5d. **⭐ NEW AND HIGHEST BD VALUE (2026-08-26): an EXCLUSION with no counterpart that
   PROMOTES.** Found by walking the BD chain end-to-end for the top owners rather than auditing
   a queue. Of the 81 resolved owners at ≥ $5M ($1.475B): 12 have a contact, 16 are in the
   acquisition lane, **29 have no contact and are not in the lane, and 24 have no
   `owner_contact_pivot` row at all** — i.e. the contact engine cannot see them.

   **Mechanism (verified, and two wrong hypotheses discarded on the way):**
   `v_owner_contact_worklist` deliberately excludes any owner that already has a linked person
   (`associated_with`/`contact_at`/`works_at`) or an SF Contact — correct, since those need no
   *acquisition*. **But nothing promotes that linked person into `owner_contact_pivot`.** The
   exclusion assumes a downstream surface picks the person up; none does. Measured over the 120
   suppressed owners ($875.3M):

   | state | owners | rent |
   |---|---|---|
   | pivot names an ACTIVE contact — working as designed | 72 | $332.3M |
   | pivot row exists but names nobody | 37 | — |
   | **no pivot row at all — suppressed AND invisible** | **11** | **$240.5M** |

   The 11 include **Easterly Gov Properties ($85.0M, 79 assets), NGP Capital ($59.8M), US Fed
   Properties Trust ($53.7M), Elman Investors ($29.0M)** — top-tier prospects that read
   "— none" in the panel while a person sits in the graph. This is P114's `reachable_via` gap
   one level down: solved for the PANEL, never for the pivot the engine reads.

   **⚠️ TWO HYPOTHESES I HAD TO DISCARD — both plausible, both wrong, each caught by measuring:**
   - *"Two definitions of owner rent disagree."* They agree exactly ($85,049,576 both ways).
   - *"They're suppressed by BROKER links we're forbidden to call."* Easterly's linked persons
     are visibly CBRE/JLL/Newmark/Cushman/Avison Young — so this looked certain. Measured
     fleet-wide: **zero** owners are suppressed by broker-ONLY links; 8 are mixed (Easterly also
     carries two personal-email contacts). The broker edges are real and still wrong per Scott's
     doctrine — but they are not what causes the suppression, and shipping that story would have
     fixed the wrong thing. *(Note `v_lcc_prospecting_edge_review` did NOT contain the Easterly
     broker edges, so using it as the broker test returned a false zero — the P166 surface is
     narrower than its name suggests.)*

   **The fix is a promoter, not a wider worklist:** resolve the linked person through the
   existing P161-gated `owner-reachable-via` logic (which already excludes brokers via
   `NON_REACHABLE_ROLES` and value-gates weak `works_at` associations) and write it into
   `owner_contact_pivot` as the active contact. Owners whose only links are brokers should fall
   THROUGH to acquisition rather than be suppressed. Not built here — it deserves a deliberate
   design, since it decides who Scott calls.

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
