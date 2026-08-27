# End-to-end data-process audit — where the operator's hands are actually required

> # ⛔ THE RE-AUDIT BELOW WAS WRONG ON BOTH ITS HEADLINE CALLS. Read this first (A5, 2026-08-27).
>
> **Every completion count in this document — and every ranking built on one — was measured on a
> metric that is 100% manufactured in the two biggest lanes.**
>
> | lane | "completed" | **auto-closed by the generator** |
> |---|---:|---:|
> | `property_missing_recorded_owner` | 4,781 | **4,781 (100%)** |
> | `true_owner_needs_salesforce` | 596 | **596 (100%)** |
> | `establish_ownership_history` | 314 | **0** ← the only real completions |
>
> **The cause is one bug.** `handleGenerateResearchTasks` reads a 29,643-row feed through a call
> **PostgREST caps at 1,000 rows**, then auto-closes everything outside the window as
> `gap_resolved`. Its guard compares `feed.length (1000) < limit (2000)` — **the requested limit,
> not the returned cap** — so it passes and fires over a truncation. Its own comment says *"never on
> a capped slice."*
>
> **Consequences for this document, stated plainly:**
>
> 1. **`true_owner_needs_salesforce` never stalled — it was never work.** **815 open is `1000 − 185`**,
>    the leftover slots in a truncated window, not a backlog. The "596 lifetime completions, so the
>    machinery is proven consumable" premise is **refuted**: 170 of 183 sampled owners still have
>    `salesforce_id IS NULL`. **93% of those closures were false.** The 2026-06-22 cliff is simply
>    the date the window saturated. **5,509 of 6,324 real gaps have never had a task at all.**
> 2. **`property_missing_recorded_owner` is NOT "the healthiest lane in the system."** Its open count
>    is pinned at **exactly 1,000** — the same artifact — 885 of 885 monthly completions are the same
>    auto-close, and 146 of 146 sampled properties still have `recorded_owner_id IS NULL`.
>    **Zero real work in 30 days, and it cannot clear, because its open count is a constant.**
>    My "leave it alone" recommendation was exactly backwards.
> 3. **The `983 → 439` improvement still stands** — it was driven by `establish_ownership_history`,
>    whose completions are real (0% auto-closed, backed by 304 written ownership facts).
>
> ### ⚠️ The lesson, which is bigger than the bug
>
> The re-audit switched from lifetime totals to **rates** specifically to avoid being fooled by a
> stale cumulative number — and the rates were themselves manufactured. **Choosing a more rigorous
> metric is not the same as validating it.** The missing question was one column deep:
> **who completed these, and how?** `outcome` was right there.
>
> **Rule: before ranking anything by completions, check WHO closed them.** A status set in bulk by a
> sweep is not throughput — the same trap as P119's `inbox_triaged`, where a bulk-set status admitted
> the entire historical population.
>
> **Also worth stating: 81% of the apparent value in this lane is not an owner.** Of 6,324 real gaps,
> 5,338 (84%) own zero properties, and operators/placeholders (`DaVita Inc.` 2,626 properties,
> `Independent` 754) carry 5,227 of 6,442 — the documented P113 tenant-in-the-owner-slot trap at
> scale. **963 are real prospectable owners.**
>
> **P131 category: (a) + (c), with (b) empty** — 293 resolve ID-to-ID via `external_identities`;
> ~6,031 are not on-box at all; **zero are unstructured-on-box, so an LLM would have nothing to read
> and would fabricate.** Third time in this arc.
>
> ⚠️ **Caveat carried from A5:** the 93% and 100% false-closure rates are samples of 183 and 146
> rows, not full population scans.
>
> ---
>
> # 🔁 RE-AUDIT 2026-08-27 (evening) — ⛔ SUPERSEDED, see above
>
> ## ⛔ SUPERSEDED IN PART, 2026-08-27 (late) — READ `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md` FIRST
>
> **The completion-rate table below is measuring an instrument artifact, and two of its three
> verdicts are wrong.** `generate-research-tasks` reads a **29,643-row** dia feed (and the gov feed)
> through a call **PostgREST caps at 1,000 rows**, then auto-closes every open task outside that
> window as `gap_resolved` — because its guard compares the **requested** `limit` (2000) against a
> **capped** response. Measured consequences:
>
> | claim below | measured 2026-08-27 |
> |---|---|
> | `true_owner_needs_salesforce` — *"proven consumable, 596 lifetime completions"* | **Refuted.** All 596 are the auto-close; **170 of 183 sampled (93%) still have `salesforce_id IS NULL`.** Nobody ever worked one. **`815 open` is `1000 − 185`** — leftover window slots, not a backlog |
> | `property_missing_recorded_owner` — *"healthiest lane in the system, 908/30d, leave it alone"* | **Refuted.** Open pinned at **exactly 1,000** (the cap); **885 of 885** completions are the same auto-close; **146 of 146** sampled properties still have `recorded_owner_id IS NULL`. **Zero real work in 30 days**, and it cannot clear because its open count is a constant |
> | `owner_contact_manual` — egress-blocked | **Unchanged and still correct** |
>
> **The durable lesson:** the re-audit switched from lifetime totals to completion *rates*
> specifically to avoid being fooled — and was fooled anyway, because **the rate was computed over a
> terminal status that no human or worker ever writes.** Before ranking lanes by throughput, check
> **who writes the terminal status** and **verify on the underlying rows** that the premise actually
> cleared. `gap_resolved` is a re-discovery artifact (P159a) that reads exactly like work.
> Fix is backlog **A5a**; `establish_ownership_history` (this arc's lane, a different producer with
> real verdicts) is unaffected.
>
> **Read this block first. §1–§3 below are the original audit and several of their numbers are now
> historical.**
>
> ## What changed
>
> | | audit (08-26) | now (08-27) |
> |---|---:|---:|
> | open research tasks | ~3,000 | **2,747** |
> | tasks in **never-completed** lanes | **983** | **439** |
> | `establish_ownership_history` | 545 open / **0** done | **156 open / 314 done** |
>
> The 983 → 439 drop is almost entirely one lane. **The method — split a lane into the distinct
> jobs it is actually asking, give each its own consumer — is validated.**
>
> ## ⚠️ But completing a lane SEEDS the next one, and that must not read as failure
>
> `trace_ownership_to_developer` went **18 → 152 open** while completing 12 more. A2's completions
> re-seeded it *by design*: once a property has ownership history, the next question is who
> developed it. **Total open fell only ~250 while completions rose 314** — because draining a lane
> converts open work into *different* open work. **Judge a lane by its own completion rate, never by
> the fleet-wide open count**, or every success will look like a wash.
>
> ## 🎯 The re-assessed answer to "where should we spend time"
>
> Measured completion **rates** (the audit originally used lifetime totals, which hide a stall):
>
> | lane | open | done 7d | done 30d | verdict |
> |---|---:|---:|---:|---|
> | `property_missing_recorded_owner` | 1,185 | **159** | **908** | ✅ **healthiest lane in the system** — ~23/day, clears in ~7 weeks. **Leave it alone.** |
> | **`true_owner_needs_salesforce`** | **815** | **1** | **26** | 🔴 **THE TARGET — see below** |
> | `owner_contact_manual` | 311 | 0 | 0 | 🔴 egress-blocked; a known external constraint, not a design gap |
> | `establish_ownership_history` | 156 | 314 | 314 | ✅ this arc |
> | `trace_ownership_to_developer` | 152 | 12 | 38 | 🟡 slow, and now fed by A2 |
>
> ### ⭐ `true_owner_needs_salesforce` is the biggest addressable stall in the system
>
> **815 open. 596 lifetime completions — so it demonstrably works. But 26 in 30 days and 1 in the
> last 7.** At that rate the backlog never clears in any meaningful horizon.
>
> **It is a better target than anything left in the ownership lane**, for three reasons:
> 1. **Bigger than the ownership lane ever was** (815 vs 545).
> 2. **Proven consumable** — unlike `owner_contact_manual` (0 lifetime completions, externally
>    blocked), this one has closed 596. The machinery exists and something slowed it.
> 3. **Nobody has looked at it in this arc.** It has never been split, measured for actionability,
>    or asked the P131 question — *is the answer already on-box and structured?*
>
> **⚠️ Do not assume it is the same shape as the ownership lane.** The obvious hypothesis — "it is
> four jobs under one label" — is exactly the kind of premise this arc refuted six times. **Measure
> first:** what fraction is answerable, what stopped in the last 30 days, and does the answer
> already exist somewhere (Salesforce, the hub, the sponsor map)?
>
> ## Decision lanes — three still dead, and one is now the outlier
>
> `junk_entity_name` is **thriving** (1,334 decided, **90 in 2 days**). Unchanged and still dead:
> `milestone_confirm` **57 open / 0 ever**, `match_disambiguation` 14 / **1**,
> `confirm_true_owner` **151 open / 35 ever / 0 recently** — the last is the one worth a look, since
> like `true_owner_needs_salesforce` it *worked once* and then stopped.

> ## ✅ STATUS 2026-08-27 — the headline finding has been ACTED ON. Read this before quoting §2.
>
> This audit's central claim was **`establish_ownership_history`: 545 open, 0 completed in 68
> days.** That is no longer true, and the correction is the point of the audit rather than a
> footnote:
>
> | | at audit (08-26) | now (08-27) |
> |---|---|---|
> | completed **ever** | **0** | **288** |
> | open | 545 | **257** |
> | historical ownership facts | — | **+304** (12,724 → 13,028), 280 owners, **$579.9M** |
>
> **A1** split the lane into its four real actions (view + honest badge: 91, not 545). **A2**
> applied the `agrees` bucket and completed the tasks — nightly on **cron 244** (06:49 UTC),
> reversible by batch tag (`lcc_a2_unapply_ownership_chains('a2-20260827-r3')`).
>
> **The 92 `agrees` still open are named, not residual:** **48 tasks ($210.6M) blocked purely by
> duplicate LCC entities** (→ **A2a**, which needs *no new code* — merge the pairs and cron 244
> applies them the same night), and **28 links that are one conveyance recorded on several dates**
> — the `gsa_lease_diff` flicker (→ **A2b**, a producer fix, which also bears directly on **A3**
> and on this audit's **E4**).
>
> **§1's other rows are NOT re-measured** and keep their 2026-08-26 dates. The 983-tasks-in-
> never-completed-lanes figure predates A2 and is now roughly **695**.

**Measured 2026-08-26 (Cowork), live against LCC Opps `xengecqvemvfknjvbvrq`.**
Continues the thread opened by `W53_AND_OLLAMA_HYGIENE_KICKOFF.md`: *audit our data processes end
to end, and recommend where AI / automation — including the on-prem Ollama model — raises
productivity.*

> **Scope note.** This is the **data-process & automation** audit window. The parallel **app**
> audit (desktop) owns prompts 189 / 192 / 194 and the Tier 0 lane defects. A *finding* about a
> data process belongs here; a *code fix* to the app belongs there.

---

## 1. The headline

**~3,000 research tasks and 419 decisions are open. 983 of the tasks sit in lanes that have never
completed a single item — some for 68 days.**

The system is not short of automation. It is short of **consumption**: several producers are
healthy and their output has nowhere to land. This is the Consumption-Layer doctrine
(`CLAUDE.md`) measured across the whole surface rather than one lane at a time.

### Research tasks — by throughput, not by size

| lane | open | ever completed | skipped | oldest | verdict |
|---|---|---|---|---|---|
| `property_missing_recorded_owner` | 1,189 | **4,772** | 6,515 | 97d | ✅ working well |
| `true_owner_needs_salesforce` | 816 | **595** | 849 | 96d | ✅ working |
| `property_missing_true_owner` | 0 | 386 | 203 | 97d | ✅ **finished** |
| `trace_ownership_to_developer` | 18 | 40 | 1,400 | 82d | ✅ working |
| **`establish_ownership_history`** | **545** | **0** | 1,690 | 68d | 🔴 §2 — the big one |
| `owner_contact_manual` | 311 | **0** | 5 | 60d | 🔴 egress-blocked (known) |
| `npi_missing_inventory` | 62 | **0** | 141 | 20d | 🟡 69% unanswerable (P181) |
| `confirm_tenant_mismatch` | 26 | **0** | 0 | 64d | 🔴 no consumer |
| `npi_new_registration` | 17 | **0** | 0 | 20d | 🔴 no consumer |
| `state_lease_distress_review` | 8 | **0** | 0 | 21d | 🔴 no consumer |
| `person_email_merge_review` | 8 | **0** | 0 | 14d | 🔴 no consumer |
| `confirm_deed_transfer_sale` | 4 | **0** | 0 | 42d | 🔴 no consumer |

**Read the `skipped` column as good news** — the auto-retire sweeps are real and working
(6,515 + 1,690 + 1,400 closed without human touch). The problem is never that too much is
retired; it is the zero-completion column.

### Decision lanes — mostly healthy, four are not

Draining: `junk_entity_name` (1,332 decided, **88 in the last 7d**), `naming_hygiene_review` (454),
`owner_reconcile` (215), `junk_entity_review` (218), `property_twin` (174), `sf_link_candidate`
(102), `sf_link_collision` (84), `exact_name_merge` (62), `tier0_owner_contact` (**33 today** —
Scott working it).

Not draining:

| lane | open | ever decided | age | note |
|---|---|---|---|---|
| `confirm_true_owner` | **152** | 35 | 82d | 0 decided in 7 days — stalled, not dead |
| `milestone_confirm` | **56** | **0** | 21d | never once consumed |
| `match_disambiguation` | 14 | **1** | 81d | a ranked lane nobody works |
| `sf_link_conflict` / `sf_contact_account_mismatch` | 10 | **0** | 42–69d | small, silent |

## 2. ⭐ The single biggest productivity win: `establish_ownership_history` — the answers are
   already computed and nobody can act on them

**545 open tasks. 0 ever completed in 68 days. And 453 of them already have a finished,
deterministic, record-cited answer sitting in `lcc_clean_assist_proposals` (P131/P133).**

The drafts are not LLM guesses — they are built from `gov.ownership_history` with a **record
reference** as the citation, which cannot be hallucinated. Their confidence encodes *chain
quality*, and that turns out to split the lane into **three completely different actions that are
currently presented as one undifferentiated "go research this" queue:**

| bucket | n | links | what it actually is | correct action |
|---|---|---|---|---|
| **Agrees with the current owner** | **380** | **450** | the recorded chain ends at the owner we already hold. A **confirmation**, not a question. (337 contiguous, 43 with disclosed gaps) | **auto-apply** — write the historical links, no human |
| **⚠️ MISMATCH** | **73** | 120 | the last recorded grantee **≠** our current owner. Either our owner is wrong or the chain is incomplete. | **a data-integrity ALERT**, not a research task — highest value per item in the whole audit |
| **Not draftable** | **92** | 0 | ⚠️ **two different facts under one label** — see below | **two different actions** |

> **⚠️ The 92 are NOT one population, and the prose hid it.** The structured payload splits them:
> **74 `no_transitions_on_file`** — genuinely nothing recorded, unanswerable from what we hold →
> auto-retire; and **18 `all_transitions_guarded`** — **transfers DO exist and every one was
> rejected by the P138 guards** (self-transition, oscillating pair, unclean name, missing
> `true_owner_id`). Those 18 are not "no data", they are "data we chose to distrust", and a guard
> that is slightly too strict is recoverable. **Retiring both identically would silently discard
> the recoverable half** — the P181 lesson (one label covering two different facts) recurring.

### ⚠️ Classify from the STRUCTURED payload, never from the rendered `reason`

My first measurement bucketed on `reason ilike '%does not match the current owner%'` — a text match
on generated prose, which is the **P182 trap** (a detector structurally unable to survive a wording
change). It happened to be right, and it was verified against the structured fields rather than
trusted: `proposed_link` already carries **`terminates_at_current_owner`**, **`draftable`**,
**`insufficient_reason`**, `continuity.contiguous` and `research_task_id`. Both methods return
**380 / 73 / 92 exactly** — but only the structured one is safe to build on, and only it exposes
the 74/18 split above. **The production classifier must read those booleans.**

> **Correction, same change:** an earlier draft of this audit and backlog row V3 cited **"~707
> links"**, carried over from P131's original run. Measured now: **570 links across all 453
> draftable chains, of which 450 belong to the 380 auto-appliable ones.** 707 is stale — do not
> quote it.

**Nobody has completed one in 68 days because every item looks identical from the outside.** A
lane that mixes "please confirm what you already believe" with "your ownership record is
contradicted" with "this is unanswerable" trains the operator to skip all three.

- The **73** exactly matches the "~73 current-owner-vs-deed mismatch flags" that backlog row V3
  predicted as *"a free data-integrity signal."* It is free, it is real, and it is buried.
- The **380** carry **450** historical ownership links that the BD spine is missing — the lane
  exists precisely because `owner_links <= 1` in `lcc_entity_portfolio_facts`. Applying them is a
  genuine data enrichment, not a bookkeeping no-op.

**P131 lens:** this is category **(a)** — *the answer is already on-box and STRUCTURED*. It needs
**deterministic plumbing, not an LLM.** No model should be added anywhere in this path.

## 3. Ranked recommendations

Ordered by operator-time saved per unit of build effort. Every one satisfies the producer/consumer
rules (named consumer · value gate · auto-retire predicate · actionable-only surface · honest counts).

| # | Recommendation | Effort | Why it ranks here |
|---|---|---|---|
| **A1** | **Split `establish_ownership_history` into its three real actions** (agrees / mismatch / not-on-file) before automating anything. | S | Everything else in §2 depends on it. Cheap: the classifier is `confidence = 0` and the `does not match the current owner` predicate already in `reason`. |
| **A2** | **Auto-apply the 380 "agrees" chains** — write the historical owner links through the existing merge/provenance path, reversible by batch tag, dry-run first. | M | Removes 380 of 545 items from a human queue and adds ~707 missing ownership links. **Never through a new SQL writer that skips the shape gates.** |
| **A3** | **Route the 73 mismatches to a data-integrity lane**, value-ranked, with both readings on the card (our owner may be wrong OR the chain incomplete — do not presume). | S | The highest-value-per-item finding in this audit, and it is currently invisible. |
| **A4** | **Auto-retire the 92 "not on file"** with a terminal, dated state that re-opens if new records land. | S | Auto-retire doctrine. Stops 92 permanently-unanswerable items ageing into "overdue". |
| **A5** | **Give `milestone_confirm` (56) a consumer or retire it**; same question for `confirm_tenant_mismatch` (26), `npi_new_registration` (17), `state_lease_distress_review` (8), `person_email_merge_review` (8), `confirm_deed_transfer_sale` (4). | S each | 119 items across six lanes with **zero** lifetime completions. Per doctrine, a producer with no consumer should not have shipped; the honest fix is often retirement, not a surface. |
| **A6** | **Re-measure `confirm_true_owner` (152 open, 0 in 7d, 82d).** It decided 35 once, so it is *stalled*, not dead — a different diagnosis. | S | Find what stopped, per the "what advances the working set?" test. |
| **A7** | **Decide `match_disambiguation`'s fate.** It is a ranked lane with **1** lifetime decision. Either surface it or stop ranking it. | S | Ranking a queue nobody works is spend with no return. |

**Ollama-specific opportunities remain as ranked in `PLANNED-BACKLOG.md` P2 (L1–L10) and N4–N7** —
unchanged by this audit, with one caveat now measured: **do not reach for the model on A1–A4.**
The lane that looked like the best LLM candidate in the system turned out to be pure plumbing.

## 4. What this audit did NOT find

Recording the negatives, because they are what stop the next pass re-walking the same ground.

- **No evidence the assists are under-producing.** `ownership_chain_draft` 545, `w9_3_sf_assist`
  247, `ollama_clean_assist` 72 and climbing (45 → 63 → 72 across today). The two that read zero
  were **undeployed, not broken** (see the STATUS entry for the deploy-cutoff diagnosis).
- **No evidence the auto-retire sweeps are too aggressive** — 9,605 skipped across three lanes with
  healthy completion counts alongside.
- **No new LLM opportunity surfaced by this pass.** The biggest apparent one (§2) is deterministic.
  That is the P131 lens working as designed, for the third time.

## 5. Areas for further exploration (opened by this pass, not yet measured)

Recorded so they are not lost. **None is a recommendation yet** — each needs its own measurement
before it can be ranked honestly, and several may refute themselves the way N8b did.

| # | Question | Why it is worth asking |
|---|---|---|
| **E1** | **Is the `skipped` state hiding work, or genuinely retiring it?** 9,605 tasks are skipped across three lanes. The healthy lanes' skips look like a working auto-retire — but nobody has sampled them. If even 5% were skipped for a fixable reason, that is ~480 recoverable items. | The A4b shape at scale: a bulk state whose members were never individually assessed (cf. the P119 `inbox_triaged` trap, where a bulk-set status admitted the whole historical population). |
| **E2** | **What is the actual completion *rate* of the healthy lanes, and is it decaying?** `property_missing_recorded_owner` shows 4,772 lifetime completions — a cumulative number, which this repo has been burned by twice (P176, V6). **Measure the 7-day rate, not the total.** | A lane can read healthy on a lifetime figure while having stopped weeks ago. |
| **E3** | **Where does Scott's time actually go, as opposed to where the queues are?** This audit measured *queued work*, which is a proxy. The Tier 0 lane got 27–33 verdicts today; every other lane got ~0. **The real productivity question is what he does that never enters a queue at all** — email triage, call prep, LOI review, book copy. | The biggest automation wins may not be visible in any table measured here. Likely needs asking him, not querying. |
| **E4** | ✅ **ANSWERED — and the tempting follow-on was REFUTED.** Measured: **46 of 73** mismatch chains carry a `gsa_lease_diff` link (50 links), vs `costar_sidebar` 21 chains and `sales_transaction` 15. A2 then hit `gsa_lease_diff` from a different direction (28 links, *one conveyance on several dates* → **A2b**), which looked like corroboration. **It is not.** Joined on property: 46 mismatch properties, 12 repeat-transfer properties, **overlap = 0.** Same producer *name*, **disjoint populations, two distinct failure modes** — **A3 cannot be collapsed into A2b.** ⚠️ **A shared producer name is not a shared population; join on the rows before merging two findings into one fix.** The gsa-flicker hypothesis for the 46 remains worth testing **on its own terms**. | *(original question below)* |
| ~~E4~~ | **Do the 73 mismatches cluster by source or by guard?** If most trace to one `data_source` (e.g. `gsa_lease_diff`, already known to emit oscillating pairs), the fix is upstream and cheap rather than 73 individual judgements. | Turns a 73-item human lane into possibly one producer fix. **Measure before building A3.** |
| **E5** | **Is `owner_contact_manual` (311, zero completions, 60 days) genuinely egress-blocked, or has that become a dated blocker?** P131 measured 6 decidable / 310 blocked, but the standing doctrine is that a dated blocker is a hypothesis. | 311 items is the second-largest dead lane; the cost of re-testing is one query. |
| **E6** | **What would the CM quarterly book copy (R8 Stage 2 / backlog N4) actually save?** It is ranked the top new on-box build, on the strength of "templated, private, repetitive" — **which has never been measured in hours.** | Before building the highest-ranked new automation, size its return the way this audit sized the lanes. |

## 6. Reproduction

```sql
-- research lanes by throughput (the zero-completed column is the finding)
select research_type,
 count(*) filter (where status in ('queued','in_progress')) open_,
 count(*) filter (where status='completed') ever_completed,
 count(*) filter (where status='skipped') skipped,
 (current_date - min(created_at)::date) oldest_days
from research_tasks group by 1 order by open_ desc;

-- decision lanes
select decision_type,
 count(*) filter (where status='open') open_,
 count(*) filter (where decided_at is not null) ever_decided,
 count(*) filter (where decided_at > now()-interval '7 days') decided_7d
from lcc_decisions group by 1 order by open_ desc;

-- the three-way split of the ownership-history lane
select case
   when confidence = 0 then 'a_no_records_on_file'
   when reason ilike '%does not match the current owner%' then 'c_MISMATCH_integrity_flag'
   else 'b_agrees_with_current_owner' end bucket,
 count(*) n, round(avg(confidence)::numeric,2) avg_conf
from lcc_clean_assist_proposals
where source='ownership_chain_draft' group by 1 order by 1;
```
