# STATUS archive — Claude Code queue, 2026-08-20 → 2026-08-28 (Cowork Tier 0 / A-series / P121–P130 block)

> **Moved verbatim from `docs/claude-code/STATUS.md` on 2026-09-02** (second cut that day; the file was 9,216
> lines against the ~8,000 rule after the first cut). This is the contiguous block that sat at lines
> 6605–9212: the 2026-08-26/27 Cowork entries (Tier 0 P186–P198, A1–A5c, C1, B1, the two-windows note),
> two 2026-08-28 Cowork entries (B1, the BD funnel re-audit), and the numeric-window P121–P130 /
> draft-assist entries dated 2026-08-20 → 2026-08-26. ⚠️ `STATUS.md` is NOT strictly date-sorted (two
> windows append to it) — this block was chosen as a contiguous span, not a date range.
>
> **Nothing was dropped.** Every still-open item from this span was already carried into
> `docs/os/PLANNED-BACKLOG.md` and the canonical topic pages (`tier0-owner-contact-system.md`,
> `ownership-history-lane.md`, `bd-ranking-and-priority-queue.md`, `producer-health-and-ci-enforcement.md`)
> during the 2026-09-02 consolidation. Where an entry here disagrees with a canonical page, **the page wins.**

---

## 2026-08-28 (Cowork) — B1 shipped: lane 336 → 1,237, and the badge correctly did NOT move

**Verified independently:** gov **any_history 1,272 → 2,173**, **chain_2plus 149 → 177**,
`lcc_entity_portfolio_facts` **13,077 → 14,010**, lane **1,237 completed / 644 open**.

**⚠️ The operator's badge stayed at 55 — before and after — and that is the whole point.** 123
newly-drafted `mismatch`/`all_guarded` cards are below $500k and held at
`human_gate='below_value_floor'`; **89% of the newly-drafted population routes to automation.**
*A value gate belongs on what reaches a human, not on what a cron applies* — which is exactly the
hypothesis B1 was built to test, now demonstrated rather than argued.

**Three corrections to my funnel audit, all measured by the build:**
1. **"1,548" spanned both domains** — gov 1,501 + dia 47 — and `trace_ownership_to_developer`
   carries a **further 983** below-floor skips **my audit never mentioned.**
2. **Only the gov slice has an automated consumer.** **dia has no
   `v_ownership_transitions_portfolio`**, so a dia task can never be drafted — dia and `trace` keep
   the $500k floor, **1,030 rows held by design**. Lowering their floor would have minted work no
   automation could touch, which is the failure this arc exists to prevent.
3. **The re-openable set was 1,414, not 1,548** (86 no longer suggested, 1 already open).

**⚠️ And the constraint has moved, which changes what to do next.** `any_history` rose **+901**
while `chain_2plus` rose only **+28** — **that is the population, not a shortfall**: only 210 of the
1,501 below-floor properties carry ≥2 guard-passing transitions. **The binding constraint on chain
DEPTH is now the A2-blocked `ambiguous_entity` residue — 126 links / 123 properties** — which is the
**A2a duplicate-entity class**, and it **applies unaided once merged.**

**Consolidation this round (beyond the prompt folders):**
- **`LOCAL-MODEL-GAP-AUDIT.md` R1** carried "545 open / 0 completions" as live status. Banner added:
  superseded, numbers historical, canonical doc named. **Its verdict — *deterministic plumbing, not
  Ollama* — was left intact and is the durable part**; that P131 lens has since predicted (a) or (c)
  correctly five more times.
- **`NEW-CHAT-KICKOFF.md`** updated to 1,237/644 with the goal metric and the badge-didn't-move
  explanation, so a fresh chat does not re-derive it.
- Swept for the superseded "545 / 0 completions" figure repo-wide: remaining hits are **dated audits
  and `prompts/done/`**, which are correct as an evidence trail and deliberately left alone.


## 2026-08-28 (Cowork) — BD funnel re-audit: the chain lane is starved by a floor that now gates FREE work

Scott redirected the audit: *"where are the biggest backlogs or locks — property by property, then
owner by owner, until we have a connected history of ownership of all our target markets back to
the developer."* **Every prior audit in this arc measured QUEUED WORK, which only sees the
symptom.** This one measures the **funnel**. → `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md`

**gov funnel:** 20,492 properties → **13,835 live** → 9,830 with a domain `true_owner` (71%) →
**6,362 with an LCC owner link (46%)** → 4,845 of those have **only the current owner** →
**1,517 with a chain (11%)** → **149 with 2+ HISTORICAL links (1.1%).**
*(dia is further along: 1,505 chains, 568 with 2+ historical, deepest chain **14** vs gov's 6.)*

**Against the stated goal — a connected history back to the developer — we are at 1.1%.**

### 🔒 The lock, and it is not a defect

**1,548 of 1,766 skips are `below_value_floor` at $500,000** (last 2026-07-31) — **five times the
314 the lane has completed.**

**The floor was right when set and is wrong now, for a reason that only became true yesterday.** It
exists because this was a **human research queue**, and nobody should hand-research a $50k
property — that is the same shared knob as the gov asset-mint floor and `CADENCE_SIGNAL_MIN_VALUE`.
**But since A2, the `agrees` bucket is applied automatically by cron 244 from a deterministic,
record-cited draft. No human sees it, so the marginal cost of a chain is now ~zero.** A floor sized
for operator attention is suppressing work that costs nothing — and suppressing exactly the
coverage Scott asked for.

**The fix is to SPLIT the floor by consumer, not remove it** — none/low for the automated path,
**$500k retained for anything reaching a person.** That distinction did not exist when the floor was
set, because the automated path did not exist. **B1 drafted** (`prompts/B1-*.md`), with the
guardrail that if the split cannot cleanly separate the two, **stop rather than lower both.**

**Three further locks, sized, not yet worked:**
- **~3,468 gov properties have a domain owner that never reached the entity graph** (9,830 vs
  6,362). Nothing downstream can touch them. ⚠️ **Ask why before building** — the gov
  `owner_needs_salesforce` lane just taught us a zero can be a **key-space artifact**, not a
  coverage fact.
- **74% of pivot owners have no active contact** (1,439 of 5,462) — known, already routed.
- **⚠️ The cadence surface is 99% overdue — 2,276 of 2,302.** A surface that is entirely red cannot
  distinguish urgent from stale, so it trains the operator to ignore it. **Badge-that-is-noise at
  the scale of a whole surface, and unaudited in this arc.**

**⚠️ Note for whoever picks this up: `establish_ownership_history` is fed by
`lcc_generate_chain_research_tasks` (cron 144), NOT by the A5a/A5c producer
(`handleGenerateResearchTasks`, crons 34/35).** Different function, different floor, different
bugs. Do not conflate them.


## 2026-08-27 (Cowork) — C1 answered: RETIRE. The consumer has existed since June, on another surface.

**The Salesforce research lanes should not get a consumer — they are a capture-less second copy of
one that already works.**

The Decision Center lane **`sf_link_candidate`** holds **3,369 owner↔SF-Account candidates**, each
carrying a resolved `001…` Account id, behind a verdict path (`api/admin.js:10764`) that **PATCHes
the exact column whose NULL-ness defines both research lanes** — null-guarded, provenance-logged,
reversible, with an Ollama pre-rank (cron 213). **Verified independently: 102 decisions, last
2026-08-14.** It already covers **360 of dia's and 1,347 of gov's** gap subjects.

The research lanes, by contrast, have **no capture path at all**: `completeResearch()` posts
`{research_task_id}` and writes nothing, neither lane has a capture button, and the seeder dedupes
on `status='queued'` only — so a completion is simply **re-minted** (4.84 tasks/subject on
`property_missing_recorded_owner`).

### ⚠️ Three corrections to my own brief, all measured

1. **My "gov: 0 of 108 resolve" was a KEY-SPACE ARTIFACT, not a coverage fact.** The lane emits
   `unified_contacts.unified_id`, and `external_identities` indexes gov only by `gov/true_owner`
   and `gov/asset` — **so that zero is structural and no amount of minting could change it.**
   Re-keyed via property → `true_owner_id`, **111 of 114 resolve.** ⚠️ But the names differ on
   **70 of 120** pairs (`ARCP GSPLTNY01, LLC` → **Nicholas Schorsch**; `INGOLD FAMILY INVESTMENTS
   LLC` → **Robert Ingold**) — that is **SPE↔sponsor, i.e. P188**, and attaching the sponsor's
   Account to a question asked about the SPE would be the same error P188 exists to prevent. Safe
   subset: 55 name-agreeing pairs → **2** with an SF Account. **My conclusion held, for a sharper
   reason than I gave.**
2. **NEW DEFECT — the gov lane reads one column and its only writer writes another.** Predicate =
   `unified_contacts.sf_account_id`; the verdict writes `recorded_owners.sf_account_id`. **1,961
   gov owners are already linked, 1,292 still read as a gap, and exactly 29 agree.** So **a human
   who works the Decision Center lane successfully does not clear the research task** — and
   **96 of the 1,675 admitted rows ($314.7M) is phantom work.** *Check the writer's column against
   the predicate's column by name, not by concept.*
3. **dia's two "27"s are different sets — overlap 3.** 27 admitted by the value gate; 27 whose
   entity carries an SF Account. I had treated them as one.

### ⚠️ My doctrine question failed on CAPABILITY before doctrine

I asked whether mass-creating SF Accounts violates *"LCC never writes back to clean SF."* The
prior question is simpler: **LCC's entire Salesforce surface is a read-only Power Automate proxy** —
`_shared/salesforce.js` records that Scott has no admin rights to register a Connected App, and a
grep for `sobjects` / `/services/data/v` returns **nothing**. Both lanes' generated instruction says
*"Link **or create** Salesforce account"* — **half of it has never been buildable.** No approval was
needed because there was nothing to approve. *A capability question you can settle with a grep is
cheaper than a doctrine question you take to the user.*

**P131: (a) 27 dia + 2 gov · (b) ZERO · (c) dominant.** A Salesforce id exists only in Salesforce —
no corpus states one, so a model would fabricate an 18-character id that looks exactly real.
**Fourth time this arc the top-ranked "LLM opportunity" measured as (a)+(c).**

### The recommendation, with numbers: automate 27 · retire 945 · gate 1,702 · repair 1,292

Filed **C1a–C1e**, sequenced: **repair the gov mirror first** (it resizes both lanes) → gate both
`lane_no_consumer` → retire on the A4 pattern → the 27 as **a new unit of `sf-link-reconcile.js`,
never a standalone writer** → register the missing dia `field_source_priority` ladder.

**It deliberately did not build the unambiguous 27-row fill**, because `sf_link_candidate`'s verdict
is the **single owner** of that column and carries the null-guard, provenance row and reversal. A
separate filler would be the second-writer defect (P119/P194/N15c). **Correct call.**

⚠️ **And the verification is inverted, which must be stated before anyone measures it:** if C1b/C1c
are taken, **real completions correctly stay at 0 and the lanes disappear instead.** That is the
success condition, not a failed metric. The numbers that move are `dia.true_owners.salesforce_id`
non-null (**822 → 849**) and the gov admitted count (**1,675 → 1,579**).


## 2026-08-27 (Cowork) — C1 drafted, and measuring first refuted the plan before it was written

The plan implied by A5 was *"automate the 293 that resolve ID-to-ID, retire the rest."* **Measured
against the OPEN QUEUE, that work does not exist:**

| lane | open | resolves to an LCC entity | **entity already has a `salesforce` identity** |
|---|---:|---:|---:|
| dia `true_owner_needs_salesforce` | 837 | **716 (86%)** | **27** |
| gov `owner_needs_salesforce` | 108 | **0** | **0** |

**⚠️ A5's "293" is across the full 6,324-gap population, not the open queue.** Both numbers are
correct and answer different questions — **but quoting 293 as available work would have sized the
build ~10× too big.** In the queue it is **27 (3%)**. *This is the "measure the queue, not the
source" lesson (P131) recurring: a queue is the residue the automation already picked over.*

**Two consequences that shape the whole design:**

1. **The gov lane has NO entity linkage — 0 of 108.** Those owners are not in
   `external_identities`, so **no ID-based automation can touch them**, now or after further
   minting — and **1,675 gov rows are admitted behind that.** It is the *owner* form of the
   documented "asset-identity coverage is what gates owner resolution" gate.
2. **Where dia does resolve (86%), the entity has no SF link either.** So the gap is genuinely
   **outside our systems** — not a join we forgot, and not something an LLM could read.

**C1 is written as diagnosis-first** (`prompts/C1-*.md`) with two doctrine checks the design must
clear before anyone builds: `sf-link-reconcile.js` runs the **opposite direction** (it mirrors an
existing `salesforce_id` *onto* the entity — **read a handler's direction before counting it as a
consumer**), and `CLAUDE.md` states LCC **never writes back to clean Salesforce**, so a consumer
that mass-creates Accounts may violate standing doctrine. It also asks whether the gov lane should
be minting at all before entity coverage exists — `lane_no_consumer` already exists as machinery
and precedent.

**And it says plainly that retirement is a success.** A4 retired 74 unanswerable tasks and that was
the right result. *"Retire two lanes and automate 27"* would be a better outcome than a consumer
nobody uses.


## 2026-08-27 21:40 UTC (Cowork) — A5c shipped. The producer is now CORRECT, GATED — and feeding lanes with zero consumers.

**A5c is complete and verified independently.** Pool **71,448 → 2,530 admitted (3.5%)**, gate in the
producer's **selection** (appended `gate_pass`/`gate_reason`/`gate_value` to `v_next_best_research`
on both domains), floor reused as-is at **$500k**, operators excluded by **recorded fact** rather
than a name test, placeholders via the existing predicate plus 13 anchored literals with a measured
blast radius of **7 rows / 0 real firms**.

**⚠️ Crons 34 and 35 are back ON — checked first, because it was the deliverable most likely to be
forgotten.** First live run: gov 161 + dia 182 = **343 minted, `closed: 0`,
`gate_reasons_seen: ["admitted"]`**. Cron 35 then fired on its own schedule at 21:09 and succeeded.
**Hundreds, not thousands.**

**A5a confirmed in production, not just in dry run:** the only `gap_resolved` closures in 30 hours
are **10, all in the 06:00 hour — before A5a deployed.** Zero since. The bug is fixed in the live
path.

**⚠️ The deploy check earned its keep, and this is the reusable part:** `/version` is unreachable
from the sandbox (proxy 403), so the deploy was confirmed **behaviourally** — and **two minutes
after the merge the gate was still absent, with `would_insert` still reading the ungated 2,586.**
Re-enabling the crons on "it merged" would have minted the entire flood with the gate sitting inert
in the database beside it. *Merged is not running* — again.

### 🎯 The finding that sets the next priority: a correct producer feeding a void

| lane | minted 4h | open | **real completions ever** |
|---|---:|---:|---:|
| `property_missing_county_record` | 109 | 109 | **0** |
| `owner_needs_salesforce` | 108 | 108 | **0** |
| `property_missing_recorded_owner` | 104 | 1,289 | **0** |
| `true_owner_needs_salesforce` | 22 | 837 | **0** |
| **`establish_ownership_history`** | 0 | 156 | **314** |
| `trace_ownership_to_developer` | 0 | 152 | **52** |

**Every lane this producer feeds has ZERO real completions, ever** (`outcome NOT ILIKE
'%gap_resolved%'`). The only two lanes in the system with genuine completions are the two this arc
built consumers for.

**So the work is now one level up.** A5a made the producer correct; A5c made it selective. **Neither
gives it a consumer** — and the Consumption-Layer doctrine is explicit that *no new producer ships
without a named consumer*. We have built an excellent pipeline into a void, and the honest next
question is **who consumes `owner_needs_salesforce`** — 1,675 admitted rows, **$4.01B, 66% of
everything the fleet will mint**, first-ever emission, no consumer.

**⚠️ And `establish_ownership_history` cannot be starved by any of this** — it is fed by
`v_lcc_ownership_chain_completeness`, a *different* generator. My guardrail question, answered
directly.

**Also filed by A5c, none built:** **A5g** (`owner_needs_sos`, 24,077 rows, emits nothing —
`lane_no_consumer` recorded per row because SOS-direct is bot-walled; the gate makes the zero
explicit rather than pretending), **A5h** (watch the gov SF lane), **A5d** (~1,844 pre-gate open
tasks stay open; the probe is ungated so none is falsely closed), **A5e** (`value_unknown` is 20,487
rows — a **rent-coverage** problem, not a value one), **A5f** (`is_operator_not_owner` unset on 11
real operators).

**One behaviour to expect and not misread:** with cron 35 at `limit=300`, gov's head is the same top
300 each run, so it inserts 0 until cron 34's daily `limit=2000` walks further — and that run reaches
2,000 of gov's 2,332 admitted, leaving **~332 unminted**. `admitted_head_exhausted: false` says
gov's feed is a **floor**. That is a cap, not completeness.


## 2026-08-27 20:07 UTC (Cowork) — crons 34/35 PAUSED pending A5c; and a false alarm worth recording

### ⚠️ I raised an alarm that was wrong. Recording it, because the reasoning is the reusable part.

Crons 34 and 35 post with `target => 'vercel'`, and `lcc_cron_post_log` shows **3,092 posts to
"vercel" in 24h across 44 endpoints vs 41 to "railway"**. Given P194 — *a retired deployment that
still answers is a second writer* — that reads exactly like the whole cron fleet executing on the
Vercel build retired 2026-07-20. I nearly reported it as the highest-priority defect in the system.

**It is not.** `lcc_cron_post` branches **only** on `target = 'edge'`; **everything else, including
the literal string `'vercel'`, falls through to the same Railway URL** (vault `lcc_railway_url`,
fallback `tranquil-delight`). **`'vercel'` is a historical label with no routing effect.**

The corroborating detail that *looked* damning — cron 35's 19:39 response lacking `mint_head` /
`membership_complete` — has a mundane cause: **A5a merged at 19:41:45, two minutes later.** That run
predates the fix. My 20:00 dry run, same host, returned all the new fields.

**The lesson: `git merge-base` has an equivalent for runtime routing — read the function, not the
label.** P194's rule is right and I applied it to the wrong evidence; a label that names a dead host
is not proof traffic reaches one. **Checking cost one query and would have cost a full false
escalation.**

### Crons 34 and 35 are DISABLED (`cron.alter_job(..., active := false)`)

A5a is live and verified — dry run: `membership_complete: true` (7 chunks), **`would_close: 0` on
both domains.** The bug is fixed.

**But it also revealed the flood, now measured: `would_insert` = 1,000 gov + 1,586 dia = 2,586** on
one `limit=2000` run, and **cron 35 fires every 30 minutes** — so the backlog would mint within
hours and continue into the **5,509 gaps that never had a task**. With **84% owning zero properties**
and operators/placeholders carrying **81% of the apparent value**, that is the badge-that-is-noise
failure, aimed at the lanes this arc just cleaned.

**Paused rather than throttled** — a smaller limit still mints the same pool, just slower.
⚠️ **Re-enabling is part of A5c's deliverable**, explicitly, so the pause cannot be forgotten.

**A5c drafted** (`prompts/A5c-value-gate-research-task-producer-2026-08-27.md`): reuse the existing
**$500k** knob rather than inventing a floor; exclude operators via the **existing**
`is_operator_not_owner` flag (P113: never write a second name-based operator test); **unknown rent
is not small** (P161 measured that trade); value **per owner**, never per task; and the gate goes in
the **producer's selection**, not a downstream filter. It also requires enumerating every lane this
producer feeds — **`establish_ownership_history` must not be starved**, since it is the one lane with
genuine completions.


## 2026-08-27 19:xx UTC (Cowork) — A5a merged AND deployed, but has not RUN yet. Do not read the counts yet.

**A5a merged as PR #1849** (both checks green before merge, on the post-Update-branch head).
⚠️ **Claude Code correctly flagged it as inert until a redeploy** — the P131 trap. **Checked rather
than assumed:** live `/version` is `d8fcfbfe` (#1850), and `git merge-base` confirms **A5a IS in the
deployed build**, with **0 commits un-deployed**. It rode in on the N15c merge.

**But it has not executed.** Cron 34 fires at **06:35 UTC**, and the counts are unchanged:
`property_missing_recorded_owner` 1,185 open / `true_owner_needs_salesforce` 815 open, with
`gap_resolved` in the last 24h still 9 and 1 — **all pre-fix**. Nothing here is evidence either way
yet.

### ✅ Dry run PASSED — the fix works, on both domains

`generate-research-tasks&domain=both&limit=2000&dry_run=1`, HTTP 200:

| domain | `membership_complete` | chunks | `would_close` | `would_insert` |
|---|---|---:|---:|---:|
| government | **true** | 7 | **0** | **1,000** |
| dialysis | **true** | 7 | **0** | **1,586** |

**`would_close` is 0 on BOTH** — including dia, which A5a had not measured and expected might be
legitimately non-zero. **Zero false closures.** `membership_complete: true` with 7 chunks means the
feed is genuinely exhausted rather than truncated. The bug is fixed.

### ⚠️ But `would_insert` = 2,586, and the producer has no value gate yet

**This is the flood A5a's own prompt warned about**, now measured. And it is sooner than the 06:35
run: **cron 35 (`generate-research-tasks-inc`) fires every 30 minutes** at `limit=300`, so minting
begins within the hour and continues until the pool drains — and **5,509 gaps have never had a
task**, so 2,586 is the near-term head, not the total.

**84% of that population owns zero properties**, and operators/placeholders (`DaVita Inc.` 2,626
properties, `Independent` 754) carry 81% of the apparent value. Minting it un-gated is precisely the
badge-that-is-noise failure the Consumption-Layer doctrine exists to prevent — *no new producer
ships without a value gate.*

**It is not dangerous** — these are research tasks, not production writes, and every one is
reversible. The cost is that two lanes get noisier **before** A5c makes them cleaner.

**Scott's call, and the pause is trivially reversible:**
```sql
select cron.alter_job(34, active := false);   -- daily 06:35, limit 2000
select cron.alter_job(35, active := false);   -- every 30 min, limit 300
-- undo: cron.alter_job(<id>, active := true);
```
⚠️ **Cost of pausing:** this generator serves **several** dia+gov lanes, so pausing starves all of
them, not just this one. It has been mis-closing for months, so a day's pause is cheap — but say it
out loud rather than pausing silently.

⚠️ **The verification is inverted, restated because it will look wrong:** success is
`gap_resolved`-per-day falling to ~0 and the **pinned open counts (1,000 / 815) moving.** **Open
counts going UP is the fix working** — real gaps that were being silently closed now stay visible.

**Bookkeeping note:** this was labelled A5c in the hand-off but the response file and the work are
**A5a**. A5c has not been sent. Flagged so the record does not drift.

### Still open, deliberately

- **A5b-repair — ~2,044 falsely-closed subjects.** Claude Code's recommendation, which I agree with:
  **re-label first** (kills the corrupted metric, adds zero surface), then let the corrected producer
  re-mint whatever ranks. **Do not re-open before the producer is proven correct** — that just
  refills a broken window.
- **A5c is now the priority, and it is time-sensitive.** Without a value gate, the corrected producer
  gives gov `owner_needs_salesforce` its **first 430 tasks** while **24,077 `owner_needs_sos` rows
  stay unreachable** — a flood into one lane and continued invisibility for another. **84% of the
  population owns zero properties.**


## 2026-08-27 (Cowork) — A5a drafted: fix the producer before repairing anything it broke

`prompts/A5a-truncated-feed-auto-close-2026-08-27.md`. Three-part fix — compare against the
**returned** row count (not the requested limit), **page the feed at exactly 1,000** (a larger
stride silently skips rows), and add a **stable tiebreak** to `order=priority.desc`, since the gap
arm is a hard-coded `20 AS priority` and **6,324 rows tie at exactly 20**, making the "top 1,000"
arbitrary and paging non-deterministic.

**Four things the prompt insists on, each from a documented failure here:**

- **Fail CLOSED on ambiguity.** If the feed cannot be exhausted, skip the auto-close entirely and
  say so. A false closure silently asserts a gap was resolved; an open task merely waits.
- **Do NOT raise `limit`.** The cap is server-side — a bigger number changes nothing and re-creates
  the same lie (`CAND_LIMIT = 1200` is the documented precedent).
- **Do NOT re-open the ~5,377 falsely-closed tasks here.** That is a data repair with its own blast
  radius, and **repairing before the producer is correct just refills a broken window.** Filed as
  **A5b-repair**, sized not built, Scott's call.
- **Establish the fleet-wide blast radius first** — this generator serves multiple dia+gov lanes.
  Enumerate which it auto-closes, and check which open counts sit at a suspicious constant
  (**1,000, or `1000 − n`** — that is the signature, and it is cheap to check).

**⚠️ And the verification is inverted, which is why it is spelled out explicitly:** the success
signal is that false closures **stop**, which looks like nothing happening. **A rising open count is
the fix working** — real gaps that were being silently closed now stay visible. The number that must
fall is `gap_resolved`-per-day; the number that must *move* is the pinned constant.

One more consequence flagged in the prompt: **5,509 gaps have never had a task**, so a corrected
producer could mint them all at once — a flood into surfaces nobody can work. It must cap or
value-gate the first run and state which, because A5c exists precisely because **84% of that
population owns zero properties**.


## 2026-08-27 (Cowork) — ⛔ A5 refuted BOTH of my re-audit's headline calls. The metric was manufactured.

**The lane never stalled, because it was never work** — and the same bug invalidates the lane I told
Scott to leave alone.

| lane | "completed" | **auto-closed by the generator** |
|---|---:|---:|
| `property_missing_recorded_owner` | 4,781 | **4,781 (100%)** |
| `true_owner_needs_salesforce` | 596 | **596 (100%)** |
| `establish_ownership_history` | 314 | **0** ← the only real completions |

**One bug produces all of it.** `handleGenerateResearchTasks` reads a 29,643-row feed through a call
**PostgREST caps at 1,000 rows**, then auto-closes everything outside the window as `gap_resolved`.
The guard tests `feed.length (1000) < limit (2000)` — **the requested limit, not the returned cap** —
so it passes and fires *over a truncation*. Its own comment says *"never on a capped slice."*

- **`true_owner_needs_salesforce`: 815 open is `1000 − 185`**, leftover window slots, not a backlog.
  **170 of 183 sampled owners still have `salesforce_id IS NULL` — 93% of closures false.** The
  2026-06-22 "cliff" is the date the window saturated. **5,509 of 6,324 real gaps never had a task.**
- **`property_missing_recorded_owner` — my "healthiest lane, leave it alone" was exactly backwards.**
  Open pinned at **exactly 1,000**, 885/885 completions the same auto-close, 146/146 sampled still
  `recorded_owner_id IS NULL`. **Zero real work in 30 days, and it cannot clear, because its open
  count is a constant.**
- **The `983 → 439` improvement stands** — driven by `establish_ownership_history`, whose 314
  completions are **0% auto-closed** and backed by 304 written ownership facts.

### ⚠️ The lesson, and it is about my own method

I switched the re-audit from lifetime totals to **rates** *specifically* to avoid being fooled by a
stale cumulative number — and the rates were themselves manufactured. **Choosing a more rigorous
metric is not the same as validating it.** The missing question was one column deep: **who closed
these, and how?** `outcome` was right there, and every row said `gap_resolved`.

**Rule now in `CLAUDE.md`: before ranking anything by completions, check WHO closed them.** A status
set in bulk by a sweep is not throughput — the same trap as P119's `inbox_triaged`, where a bulk-set
status admitted the whole historical population.

**Two further findings worth keeping:**
- **81% of the apparent value in this lane is not an owner.** 5,338 of 6,324 (84%) own zero
  properties; operators and literal placeholders (`DaVita Inc.` 2,626 properties, `Independent` 754)
  carry 5,227 of 6,442 — the documented **P113 tenant-in-the-owner-slot** trap at scale. **963 are
  real prospectable owners.**
- **P131 category (a) + (c), (b) empty** — 293 resolve ID-to-ID via `external_identities`, ~6,031
  are not on-box at all, and **zero are unstructured-on-box, so an LLM would have nothing to read
  and would fabricate.** Third time in this arc that the top-ranked "LLM opportunity" wasn't one.

⚠️ **Caveat carried from A5, not to be dropped when these numbers get quoted:** the 93% and 100%
false-closure rates are **samples of 183 and 146 rows**, not full population scans.

**Backlog filed by A5: A5a** (fix the auto-close — a correctness bug costing ~900 false closures a
month **across all dia+gov NBA lanes**, and it is manufacturing the very number the re-audit ranked
on), **A5c** (value-gate 6,324 → 963), **A5d** (fill the 293), **A5e** (retire the 5,338). None
built. **A5a lands first** — every other measurement in this area is untrustworthy until it does.


## 2026-08-27 (Cowork) — RE-AUDIT of the original automation audit: the method worked, the next target is elsewhere

Scott asked to revisit the document that started this thread
(`DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`) and re-assess where the time should go. Re-measured
the whole surface rather than assuming.

| | audit (08-26) | now |
|---|---:|---:|
| open research tasks | ~3,000 | **2,747** |
| tasks in **never-completed** lanes | **983** | **439** |
| `establish_ownership_history` | 545 open / **0** done | **156 / 314** |

**The method is validated** — split a lane into the distinct jobs it is actually asking, give each
its own consumer. The 983 → 439 drop is essentially that one lane.

**⚠️ But a finding that will mislead anyone reading the fleet-wide number: completing a lane SEEDS
the next one.** `trace_ownership_to_developer` went **18 → 152 open** while completing 12 more —
A2's completions re-seeded it *by design* (once a property has ownership history, the next question
is who developed it). **Total open fell ~250 while completions rose 314.** Draining a lane converts
open work into *different* open work. **Judge a lane by its own completion rate, never by the fleet
open count**, or every success reads as a wash.

### 🎯 The re-assessed target is a lane nobody in this arc has looked at

Switching from lifetime totals to **rates** — which is what hid the stall in the first place:

| lane | open | done 7d | done 30d | verdict |
|---|---:|---:|---:|---|
| `property_missing_recorded_owner` | 1,185 | **159** | **908** | ✅ healthiest in the system, ~23/day → clears in ~7 weeks. **Leave it alone.** |
| **`true_owner_needs_salesforce`** | **815** | **1** | **26** | 🔴 **the target** |
| `owner_contact_manual` | 311 | 0 | 0 | 🔴 externally egress-blocked — a constraint, not a design gap |
| `trace_ownership_to_developer` | 152 | 12 | 38 | 🟡 slow, now fed by A2 |

**`true_owner_needs_salesforce` is the biggest addressable stall in the system.** 815 open, **596
lifetime completions** — so the machinery demonstrably works — and then **26 in 30 days, 1 in the
last 7.** It is bigger than the ownership lane ever was, it is *proven consumable* (unlike
`owner_contact_manual`), and it has never been split, measured for actionability, or asked the P131
question.

**A5 drafted as DIAGNOSIS ONLY** (`prompts/A5-*.md`) — establish whether it stopped or decayed (a
cliff and a slope have different causes), read real rows rather than inferring from the type name,
state the P131 category explicitly, and check whether the SF link already exists via another path,
since **A2 found 291 of 331 grantors were already minted by an unattached producer**. ⚠️ The prompt
explicitly forbids building a consumer, and warns off the obvious "four jobs under one label"
hypothesis — **six plausible premises have been refuted by measurement in this arc**, two of them
about this same family of lanes.

**Also filed: `confirm_true_owner`** (151 open / 35 ever / 0 recently) — the same *worked-once-then-
stopped* shape, smaller, worth the same treatment after A5 establishes the method (**A5b**).


## 2026-08-27 17:15 UTC (Cowork) — A2b + A4b landed; refreshed the kickoff doc, which carried a DANGEROUS instruction

**Lane: `all_guarded` 18 → 7, `awaiting_draft` 0 → 11** (the A4b recovery mid-flight, not a defect
— the drafter re-runs at 06:45 and cron 244 applies at 06:49). `agrees` 64 · `mismatch` 49 ·
`sponsor_spe` 25 · `no_records` 0. Verified `split_state='awaiting_draft'` with `action=NULL` is the
**designed** shape, so the distinct-state invariant holds — my initial worry there was unfounded.

**⚠️ A2b refuted my prompt's premise, and it had been repeated in three places.** I wrote it as the
P138 `gsa_lease_diff` flicker. It is not: **that flicker has a RETURN LEG** (`A→B` *and* `B→A`) and
is caught by `is_oscillating_pair`; this population has none. It is **one conveyance observed more
than once** — per-lease fan-out (a GSA building carries many leases and the lessor of record updates
on each separately: one distinct `lease_number` per date, **13 of 13** testable properties) plus
cross-source lag. **The correction is load-bearing:** if it *were* the flicker the direction would
be untrustworthy and collapsing unsafe; it is not, so the only thing wrong is that one fact is
stored several times. `CLAUDE.md` and the canonical doc now carry the correction — **the sixth
hypothesis of mine refuted by measurement in this arc.**

**A2b** collapsed 32 links → 15 across 14 tasks (**$26.2M per OWNER**; the per-link sum reads $88.5M,
a 3.4× overstatement). Fixed in the **drafter**, never the applier — the PK is right, the input was
wrong — and it removed a **phantom chain break**, since `A→B, A→B` reads as a gap. All 14 now report
`contiguous: true`.

**A4b** corrected the gov guard. **The 7 remaining `all_guarded` are correctly guarded, name by
name** — three punctuation-variant self-transitions, a CMBS trust artifact, a strict-prefix variant,
a concatenated brokerage, and one with six `Unknown` grantors. **There is no further recoverable
population there**, which is a real answer rather than a leftover.

### ⚠️ The kickoff doc had gone stale in a way that would have caused harm

`NEW-CHAT-KICKOFF.md` still instructed a future chat to verify reachability by
*"`reachability_harvest_review` passes 4"* — **the exact criterion measurement disproved.** A fresh
chat following it would have diagnosed a false failure on a healthy lane and spent a cycle on code
that was never broken. **Corrected, and the reason kept in place rather than deleted**, because the
generalisation is what matters: *before writing any verification, ask what the worker emits when it
succeeds and finds nothing.*

Also refreshed: the CI section (now "`npm test` is a required check; `main` is protected" rather
than "CI runs no tests"), and a pointer to the canonical lane doc + its Tier 0 sibling, with the
warning that **the two share `lcc_merge_entity`, `lcc_owner_sponsor_domain` and the owner
entities**, so a merge confirmed in one changes the other.

**This is the third time a doc in this repo has aged into being actively wrong within days.** The
pattern is consistent: the *state* rots fast, the *lessons* do not. Files that carry both should
lead with the lesson.


## 2026-08-27 (Cowork) — consolidated the lane into ONE canonical doc; drafted A2b + A4b

**Seven documents now covered one subsystem** (`DATA_PROCESS_AUTOMATION_AUDIT`, A1, A2, A2a, A3,
A4, the V8 review) — the "one source per topic" rule broken by accretion, and a future chat would
have had to read all seven to learn what is true.

**Created `docs/architecture/ownership-history-lane.md`** — the living canonical reference: current
state, the five actions and their consumers, **eight invariants each earned by a live failure**,
what is left, and the dated audits as an explicit **evidence trail** (go there for *why*, come here
for *what is true now*). Wired into `CURRENT-STATE.md`'s doc map. The audits are unchanged — this
is consolidation by indexing, not by deletion.

⚠️ **`OWNERSHIP_RESEARCH_FREE_FIRST_PLAN.md` was deliberately NOT folded in** — despite the name it
is a different subsystem (LLC-research backlog / SOS / contact acquisition, 2026-07-29). Merging on
a name match would have been the same error this repo keeps documenting.

**Two prompts drafted, both unblocked:**

- **A4b — a P138 guard rejects any SPE named after a street number.** `\m[0-9]{5}\M` kills
  `EGP 17101 BROOMFIELD LLC` and `DE 10990 Wilshire, LLC`. **10 of 18 tasks recoverable, and the
  defect is wider than this lane** (it also drops links inside chains that *did* draft). The
  discriminator is already measured: junk carries **no legal form**, real SPEs always do. ⚠️ The
  prompt insists on **sizing the fleet-wide blast radius before touching the predicate**, fixing it
  in its home repo rather than forking a copy, and **splitting the two largest arms** —
  A4 identified the 5-digit arm *inside* them but did not establish it explains all 23 rows.
- **A2b — one conveyance recorded on several dates.** 14 tasks / 32 links; the `gsa_lease_diff`
  flicker surviving P131's `(from, to, date)` dedup *because the date differs*. **A producer fix,
  not an applier fix** — loosening the PK would write a history in which a party acquired the same
  asset three times. The prompt forces the real judgement into the open (**which date is true** —
  earliest / latest / when the lessor field changed) and requires the other observations be
  preserved as evidence, not deleted. It also asks whether the flicker is **still producing**,
  because that alone decides whether this ships a cron or a one-shot.

**Both carry the population-drift warning** — A2's counts (12/28) already read 14/32, and the
mismatch bucket moved 74 → 49 under the V8 confirms. **Re-measure, quote your own number.**


## 2026-08-27 14:00 UTC (Cowork) — V8 confirms APPLIED + A2a landed. Lane: 314 done / 156 open.

### V8 — six sponsors confirmed, and the lane moved exactly as predicted

Inserted the six clean rows (`boyd`, `highwoods`, `rxr`, `arc`, `east`, `sunflower`) into
`lcc_ownership_sponsor_family` on Scott's authority, with before/after captured:

| action | before | after |
|---|---:|---:|
| `mismatch` | 74 | **49** |
| `sponsor_spe` | 0 | **25** |
| `agrees` | 64 | 64 *(unmoved ✓)* |
| `all_guarded` | 18 | 18 *(unmoved ✓)* |

**Perfect conservation — 25 chains moved from `mismatch` to `sponsor_spe`, nothing else shifted**,
which is the invariant the review sheet specified. *(Predicted 24, actual 25 — the population moves
as A2a drains, so the estimate was stale rather than wrong.)*
**Reversal:** `delete from lcc_ownership_sponsor_family where confirmed_at::date = current_date;`

**Deliberately NOT confirmed, per the evidence check:** `commonwealth` (15 unrelated parties incl.
government bodies), `fgf` (**90 SPEs** — Scott's own note says they are Boyd subsidiaries, so
confirming to FGF Management could misattribute a Boyd program at scale), `madison` ×2 (duplicate
entities), `carrington` / `sequoia` (Scott's call, name-derived evidence only).

### A2a — merged the duplicate entities; lane 288 → 314

**Completed ever 288 → 314**, open 182 → **156**, last completion 13:51.
`ambiguous_entity` fell from ~50 blocked tasks to **18**.

**Three things it did right that are worth keeping:**
1. **Proved the round trip on the highest-stakes group first** — the only one where the destructive
   pivot dedup-delete fires: **153 rows before, 153 after, 0 lost, 0 new, 0 content differences.**
   Exactly the check the prompt demanded, because P195's and P196's reversals each failed their
   first live attempt.
2. **Stopped when the dry run disagreed with its own prediction** (26, not the 28 predicted) and
   found out why *before* applying.
3. **Verified `auto_mergeable` moved for the right reason** — the 12 groups that left are exactly
   the ones A2a resolved, with **0 auto-mergeable groups still holding any A2a winner or loser**.
   That is the difference between a counter moving and a counter moving *correctly*.

It also triggered cron 244's own apply function rather than waiting for 06:49, and said so — the
prompt asked for exactly that disclosure.

**Blocked residue now:** `ambiguous_entity` 18 · `no_entity` 18 · `placeholder` 15 ·
`repeat_transfer_unrepresentable` 14.

**Lane arc so far: 545 open / 0 completed for 69 days → 314 completed / 156 open**, with every
remaining item named and routed rather than pooled.


## 2026-08-27 (Cowork) — V8 reviewed: Scott's evidence condition was tested, and it changes 4 of 12

Scott answered all 12 sponsor proposals, approving three **conditionally**: *"so long as there is
more evidence than just the name."* **That condition was tested rather than taken as approval, and
it fails on two, is weak on one, and one row turned out worse than it looked.**

**What evidence exists at all: almost none.** Commonwealth, Carrington, Sequoia and FGF sponsor
entities carry **no email, no phone, no metadata company, 0–1 relationships**, and their only
`external_identities` row is **the `gov` source record itself** — the thing being matched, not
corroboration. gov `true_owners` adds nothing: no `contact_info`, no `sf_account_id`, no `state`.
The only available signal is **naming-program structure** (gov `true_owners`): `boyd` **140** SPEs,
`fgf` **90**, `B9 SEQUOIA` **5**, `carrington` 6, `commonwealth` 15.

- **⛔ Commonwealth — recommend NO.** The 15 "Commonwealth" entities are demonstrably different
  parties, **including government bodies**: `Commonwealth Of Virginia Department`,
  `Commonwealth Ports Authority`, `Commonwealth Partners, L.l.c.`, `5309 Commonwealth LLC`.
  `Commonwealth Owner LLC` has no distinguishing element. **Precisely the case the condition exists
  to catch.**
- **⚠️ FGF — HOLD, and it is the riskiest row in the set** *because of Scott's own note* that these
  are Boyd subsidiaries. The sponsor map is **forward-looking** and there are **90 FGF SPEs**, so
  confirming `fgf → FGF Management LLC` could misattribute a Boyd program at scale. **Settle
  Boyd↔FGF first** — no LCC relationship records it either way.
- **⚠️ Carrington — weak** (name-family only, $1.8M): recommend deferring rather than spending a
  judgement.
- **🟡 Sequoia — pattern evidence only.** `B9 SEQUOIA` is a consistent 5-member program, so `B9` is
  a program prefix rather than noise — which answers the specific worry without producing
  independent evidence. Scott's call, and the honest boundary of what we hold.

**Six clean confirms are ready** (Boyd incl. the JV, Highwoods, RXR, ARC, East Lake, Sunflower) —
**24 of 32 chains, the same coverage as the original recommendation without the two risky
attributions.** SQL and reversal in `docs/audits/V8_SPONSOR_FAMILY_REVIEW_2026-08-27.md`.

### ⭐ Two pieces of Scott's domain knowledge that are model requirements, not review notes

1. **JV / fund / partnership ownership is MULTI-PARTY, and the model cannot express it.** Scott:
   connect SPEs to true owners as now, *"but link to **multiple true owners** for each true owner in
   the JV… investors will own assets outright, in JV, and maybe in a fund like a DST."* Today the
   chain is single-valued (`recorded owner → SPE → ONE true owner`). **`Boyd Watterson JV UBP` is
   the live worked example** — approved into Boyd, so its second partner is currently invisible.
   Filed as **P1c / J1–J4**, including the downstream question nobody has asked: what the
   prospecting surfaces do with a two-principal asset.
2. **"Lessee" is a REAL ownership interest, not a weaker one.** A ground lease splits fee (dirt)
   from leasehold (improvements); the leasehold SPE is the landlord counterparty to the tenant. So
   `Cr Sunflower Lessee LLC` is a genuine owner — **my flag on that row was wrong, and Scott's
   correction is the durable fact.** The model should distinguish fee / leasehold / both, or a
   ground-leased asset silently reads as one owner when it has two (**J3**).


## 2026-08-27 13:28 UTC (Cowork) — the on-box Analyst's Take produces for the first time; A2a drafted

**V9 ✅ / V7 ✅ — R8 Stage 1 works.** `LCC_DEFAULT_WORKSPACE_ID` set on `tranquil-delight`,
triggered through the **production path** (`lcc_cron_post` → `/api/briefing-analyst-take-tick`,
apply): **HTTP 200**, `flag.enabled: true`, and a **508-char take, `source = onprem_ollama`,
`generated_at` 13:28:48** against `existing_analyst_take_chars: 0`. The 400 is gone.

⚠️ **One check deliberately left open: the UNATTENDED run.** A manual trigger proves the *config*,
not the *schedule* — which is precisely what V7 was about (the 2026-08-26 774-char take was a
hand-run that read as a working pipeline for a day). **Cron 240 at 10:18 UTC weekdays, with
`generated_at` inside that window, is the real close.**

⚠️ **And two faults in the same chain stay open** — `/api/daily-briefing` → **401 Unauthorized**,
and `briefing-intel-snapshot` still warns *"Anthropic API 400: credit balance too low"*. Neither is
fixed by this; the on-box take exists to route around the second.

**Also worth recording: `?generate=1` is write-free by design, so a NULL take after calling it
proves nothing.** The first attempt returned an empty body (the on-box model exceeding a 30s fetch
cap) and a still-NULL column — which looks exactly like failure and was not. Verification went
through `lcc_cron_post` instead, i.e. the path the cron actually uses.

**V8 and V9 are both MANUAL, not Claude Code prompts** — worth stating since it was asked:
V9 was an env var (done). **V8 is a judgement only Scott can make** — *is this SPE family actually
this sponsor's?* A3 built the machinery and correctly refused to auto-confirm; the rows require
`confirmed_by`, so they are SQL inserts, not a UI. **Boyd Watterson is 20 chains / $179.8M in one
decision.**

**A2a drafted** (`prompts/A2a-merge-duplicate-chain-entities-2026-08-27.md`) — merge the duplicate
entities blocking ~50 `agrees` chains; **no new applier needed**, cron 244 applies them the same
night. It is only safe now because 196 Unit 1 made `lcc_merge_entity` reversible, and the prompt
insists on **proving the round trip on this population first** — P195's reversal failed its first
live attempt on a GENERATED ALWAYS column, and P196's on a BEFORE-INSERT trigger defeating
`ON CONFLICT DO UPDATE`. It also bans `lcc_owner_strict_core` for identity here (A2 measured and
rejected it on this exact population) and asks whether `r9_chain_connect` is the *source* of these
duplicates — 291 of the 331 grantors A2 resolved are its unattached output.


## 2026-08-27 (Cowork) — A3 + A4 landed. The lane is 288 done / 182 open, and BOTH prompts corrected my premises.

**Lane state:** completed **288**, open **545 → 182**, skipped 1,766.
`no_records` is **gone from the split entirely** (74 retired). Remaining: `agrees` 90 ·
`mismatch` 74 · `all_guarded` 18.

### A4 — my "the guards are probably right" hypothesis was WRONG, and that is the finding

I wrote A4b expecting `is_oscillating_pair` to explain the 18, in which case retiring them was the
answer. Measured: **zero oscillating pairs.** The guards are **not** all correct — **10 of 18 would
be unblocked by a corrected guard.** The defect was found by computing which arm fires per name
rather than eyeballing, and checked for precision before proposing anything: the junk the guard
**correctly** catches has **no legal form** (`Houston, Harris County, Texas 77007`), while the real
SPEs all carry one. That is a clean discriminator, and it also drops links inside chains that
*did* draft — so the defect is wider than these 18. **Sized, not patched in that prompt.**

**Unit 1 shipped:** all **74 `no_records` retired**, terminal and dated, after verifying what the
seeder treats as terminal so they cannot be re-minted tonight.

### A3 — the machinery is built; the movement now needs 12 human confirmations

**⚠️ A3 rejected the key I prescribed, and was right to.** I said reuse `lcc_owner_sponsor_domain`
keyed on `sponsor_token`. Measured: **a bare token is not bounded** — `east` names **226** live
entities, `boyd` **129**, including the surname *Boyd Alexander* and addresses like
*100 East PropCo LLC*. In that table a wrong token merely fails to join to a person; **here it
would assert a false ownership fact.** And its PK cannot carry two cases already in the data:
`madison` is proposed by **two** owner entities, and `egp` names **both** Easterly Government
Properties *and* EastGroup Properties. So the registry is keyed **(sponsor entity, token)**.
**Not second-registry drift** — the detector is shared: P196's guards were extracted into
`lcc_name_reads_as_street` / `lcc_name_has_spe_marker` and P196 re-issued to call them, gated at
**0 of 696 Tier 0 rows changed.**

**Population re-measured: 73 → 74 chains / 46 owners / $403.0M** (A2 landed in between and drained
`agrees` 380 → 90).

**⚠️ P196's SPE-marker guard drops 24 of 27 genuine rows here** — a GSA SPE is named for its city
and agency (`BOYD SACRAMENTO GSA, LLC`), not "Propco". **Not applied, predicate not weakened** —
the correct call. The other three guards are applied with measured cost: street fires 3× changing
**0** outcomes, brokerage 0, and person costs **exactly 2** real false negatives, both
`lcc_looks_like_person` false positives (*City of Oakland* is not a person) — **named, not
patched.**

**Three deliberate non-actions worth keeping:** contact confirms were not inherited (they resolve
**0 of 74**, and would let a ~4-of-6 gate settle an ownership fact); `sponsor_spe` was not folded
into `agrees` (that would hand it to A2's *write* path); and the 11 `name_variant` cards were not
retired, because they ride `lcc_owner_strict_core` — which **A2 already rejected for writes on this
exact population**.

**Nothing has moved yet, and the writeup says so plainly: `mismatch` is still 74.** The positive
control proves the machinery — confirming `boyd` alone gives mismatch **74 → 54**, sponsor_spe
**0 → 20**, human_actionable **92 → 72**, with `agrees`/`no_records`/`all_guarded` unmoved — then
rolled back with **0 residue**. Residue sized at **31 chains / 27 owners / $344.6M**, characterised,
surface deliberately not built.

**👤 THE NEXT MOVE IS SCOTT'S: 12 sponsor confirmations**, ranked in
`v_lcc_ownership_sponsor_family_proposals`. **Boyd Watterson is 20 of them in one decision
($179.8M).** ⚠️ Read `token_entities_fleetwide` on each — `east` 226, `madison`/`fgf` 67, `arc` 46,
`commonwealth` 32, **`boyd` 129** — which is exactly why the key is (sponsor entity, token) and why
each confirm is per-sponsor rather than per-token.

**Three of my hypotheses have now been refuted by measurement in this arc** (A2b↔A3 shared
population, the gsa flicker, the oscillating-pair guard). Each was plausible, cheap to test, and
wrong — which is the argument for the measure-first discipline, not against it.


## 2026-08-27 (Cowork) — A3 measured before building it: the 73 "mismatches" are mostly sponsor↔SPE

**The A3 backlog row said "route the 73 to a data-integrity lane, both readings on the card."
Measured, that would have been the wrong build** — and the measurement was one query.

`action='mismatch'` means the chain's last recorded grantee ≠ the owner we hold, which reads as
*"our ownership record is contradicted."* The dominant pattern is **sponsor ↔ SPE**: the deed
records the **special-purpose entity holding title**, our field records the **sponsor**.
**Both are correct. It is a representation question, not a data error.**

| current owner on file | chains | example last-recorded grantees |
|---|---:|---|
| **Boyd Watterson Asset Management** | **24** (33%) | `BELTSVILLE GSA FDA, LLC`, `Boyd Bethesda III GSA, LLC` |
| Easterly Government Properties | 3 | `EGP 116 Suffolk LLC` |
| FGF Management | 2 | `GERMANTOWN MD I FGF, LLC`, `TYSONS CORNER VA III FGF, LLC` |
| Brookfield Asset Management | 2 | `1301 FANNIN OWNER LP`, `BOF DPC Denver West Park 54 LLC` |
| Blackstone | 1 | `BRE 1200 Wall Street Owner LLC` |
| Brent Waldman | 1 | `Waldman, Brent` — **name order, not a party difference** |

**So the build is ~4–8 SPONSOR decisions covering ~31+ chains** — reusing `lcc_owner_sponsor_domain`
(P190) and P193's inheritance — **not 73 cards.** Asking the Boyd Watterson question 24 times is
the badge-that-is-noise failure. The genuine integrity residue (`DEAMO LLC.` ← `LuLu Hsu`, and
grantees belonging to no family) is **~20–30**, and should be sized before a surface is built.

**⚠️ Two hypotheses tested and REFUTED — recorded so nobody re-walks them:**
1. **The `gsa_lease_diff` flicker does not explain these.** It predicted SPE↔parent *name
   similarity* on gsa-sourced chains; measured the **opposite** — only **7 of 47** gsa chains share
   an 8-char prefix with the current owner, against **21 of 27** non-gsa chains.
2. **No overlap with A2b** (46 vs 12 properties, zero shared).

**Guards carried into the prompt, each from a prior measured failure:** a lexical sponsor detector
is ~25% precise without P196's three guards (reuse `lcc_tier0_sponsor_brand_token`, do not write a
second); `lcc_is_spe_shell_name` **under-detects place-named SPEs** and `BELTSVILLE GSA FDA, LLC`
is exactly that shape; and **`Boyd Watterson Global` vs `…Asset Management` may be fund vs manager**
— human-confirm per sponsor, never auto-accept a shared token.

**✅ A2a is now UNBLOCKED** — prompt 196 Unit 1 landed. `lcc_unmerge_entity`,
`lcc_merge_snapshot_loser` and `lcc_merge_fold_pivot` are all live on LCC Opps, so the merge path
snapshots, folds the pivot, and reverses. A2a needs no new code: merge the pairs and cron 244
applies those chains the same night.

**Queue in this window: A3 (drafted), A4/A4b (drafted), A2a (now unblocked).**


## 2026-08-27 11:15 UTC (Cowork) — V1 ✅, V2 ✅, V7 ❌ root-caused; and a merge resurrected 31 archived files

**All three post-deploy verifications are now answered.**

- **V1 ✅ property-twin is writing again — 200 → 240**, last write **05:46:33**, inside cron 220's
  window. P135's paging fix works; the stall was the deploy cutoff exactly as diagnosed. Watch it
  keeps climbing toward the ~1,095 pending — a second plateau would mean a fixed window again.
- **V2 ✅** (confirmed 05:10) — 60 negative markers; the proposal count staying at 4 is correct.
- **V7 ❌ ROOT-CAUSED, and it is a config gap rather than a code defect.** Cron 240 fired at
  **10:18:00** and returned **HTTP 400**:
  `{"ok":false,"error":"Could not resolve workspace. Set X-LCC-Workspace or LCC_DEFAULT_WORKSPACE_ID."}`
  Today's snapshot row exists (10:00:16) with `analyst_take` **NULL**. **This settles V7's open
  question: the 2026-08-26 774-char take was a manual one-shot** (`generated_at` 20:51), never the
  pipeline. **Fix: set `LCC_DEFAULT_WORKSPACE_ID` on Railway, or send `X-LCC-Workspace` from job
  240.** ⚠️ **Two further faults in the same chain, not to be conflated with it:**
  `/api/daily-briefing` → **401 Unauthorized**, and `briefing-intel-snapshot` still warns
  *"Anthropic API 400: credit balance too low"* — the cloud-billing issue the on-box take exists to
  route around.

**⚠️ A merge resurrected all 31 archived worklogs.** They are tracked on `main` **at the root AND
in `docs/history/worklogs/`** — every file twice. Cause: the archive commit recorded them as
delete-at-root + create-in-history rather than renames, so a branch based on an older commit still
carrying the root copies re-added them on merge, silently and with no conflict. **Verified all 31
byte-identical to their archived copies before removing the root duplicates** — nothing lost.

**The durable lesson: a file MOVE is not conflict-safe across parallel branches.** Git resolved
"you deleted it / they still have it" by keeping the file, which is the safe default for content
and the wrong one for a move. **After archiving files, check the root again once other branches
merge** — and prefer landing a move when no long-lived parallel branch predates it.

**Still open in the automation window:** A4/A4b queued; A2a blocked on prompt 196 Unit 1; A3 needs
its own hypothesis test.


## 2026-08-27 05:10 UTC (Cowork) — V2 was never stalled. The verification was measuring the wrong output.

**`reachability_harvest_target_marker`: 60 markers, all written this morning, last at 04:40:19** —
inside cron 212's run. **V2 is healthy and P136 works.**

**⚠️ And `reachability_harvest_review` is still 4 — which is CORRECT.** P136's entire design is a
**negative marker** recording *checked, and empty*, so a target with no evidence stops being
re-selected forever. Targets with no evidence **correctly produce no proposal.** The proposal count
is therefore the one metric that reads zero while the fix works perfectly — and it is exactly what
the backlog row **and my scheduled 6am check** both asserted on. That check would have reported a
false failure on a lane that is fine.

**⚠️ Second trap in the same five minutes: cron 212 logs `timed_out: true` at exactly 60,000 ms.**
Per P123, `lcc_cron_post` stops listening at 60s while the handler runs to completion — the markers
landed **19 seconds in**. Read the worker's own output, never the caller's patience.

**Fixed in the same pass:** the scheduled check now asserts on `markers_total`, states plainly that
`reach_reviews` staying at 4 is expected, and tells its future self not to read a pg_net timeout as
failure. Backlog V2 → ✅ with the wrong criterion recorded rather than quietly replaced.

**New `CLAUDE.md` doctrine — the generalisation, because this will recur:**
*assert on the state delta* is necessary and **not sufficient; you must assert on the RIGHT delta.*
**Before writing a verification, ask what the worker emits when it succeeds and finds nothing.** If
that is a marker, a tombstone or a `checked_at`, **that** is the delta. It is the exact mirror of
the re-discovery-tally trap: `already_annotated` reads like throughput while nothing moves; a
negative-marker worker reads like a stall while everything moves. Both come from asserting on the
convenient counter instead of the one the design advances.

**Still open:** V1 (property-twin, cron 220 @ 05:45 — window had not arrived at 05:10) and V7
(Analyst's Take, cron 240 @ 10:18 weekdays).


## 2026-08-27 (Cowork, automation window) — ✅ THE LANE COMPLETED A TASK. 0 → 288 after 69 days.

**A2 shipped (PR #1805) and the acceptance test passed.** This was never about rows written:

| | before | after |
|---|---:|---:|
| `establish_ownership_history` completed **ever** | **0** (69 days) | **288** |
| open | 545 | **257** |
| historical ownership facts | 12,724 | **13,028** (+304, 280 owners, **$579.9M**) |

Nightly on **cron 244** (06:49 UTC — after the 05:10 seeder and 06:45 drafter), reversible by
batch tag: `select lcc_a2_unapply_ownership_chains('a2-20260827-r3')`. **A3/A4/A4b untouched at
exactly 73/74/18.**

**⚠️ The 92 `agrees` still open are NAMED, not residue** — and the largest is free:
- **48 tasks ($210.6M) blocked purely by duplicate LCC entities** (Duke Realty LP vs DUKE REALTY
  LIMITED PARTNERSHIP). **A2a needs no new code** — merge the pairs and cron 244 applies those
  chains the same night. Highest value-per-effort item currently in the backlog.
- **28 links are one conveyance recorded on several dates** — the `gsa_lease_diff` flicker.
  ⚠️ **I first wrote that this corroborated E4 and that "A2b and A3 are likely one upstream fix."
  MEASURED AND REFUTED within the hour:** 46 mismatch properties carry a `gsa_lease_diff` link,
  12 properties are blocked `repeat_transfer_unrepresentable`, and the **overlap is ZERO**.
  Same producer *name*, **disjoint populations, two distinct failure modes.** Fixing one does not
  fix the other, and **A3 cannot be collapsed into A2b.**
  **The lesson: a shared producer name is not a shared population.** Two findings that both cite
  `gsa_lease_diff` felt like one story; a single join showed they touch no property in common.
  Same shape as the P189 domain-grouping trap — plausible evidence answering a *different*
  question. **Join on the rows before merging two findings into one fix.**

**Three defects A2 found in its own code, none visible to a dry run** — each caught by measuring
the live write and fully reversed. Three clean round trips, which also **proved the reversal path
is a capability rather than a claim**:
1. An exact-match placeholder stoplist blocked `Previous Owner` but not `Previous Owner Name` /
   `… LLC` — 13 facts landed on placeholder entities.
2. `on conflict do nothing` + a fan-out join reported **365 inserts against 347 actual**.
3. **A partial apply flips the lane's own seed predicate** — one written link would have let R60
   Sweep A close 19 still-open tasks as `skipped`, leaving their remaining links unapplied *and
   invisible forever*.

**Also found: `r9_chain_connect` (cron 104) mints a prior-owner entity per chain name and attaches
it to nothing** — **291 of the 331 grantors A2 resolved are its unattached output.** A2 is its
missing consumer, which is why name resolution landed as high as it did. A producer that has run
for months with no consumer, discovered only because something finally consumed it.

**And `lcc_owner_strict_core` was tried for identity here and rejected on named rows** (it
collapses `BAMMF (8) LLC` onto `BAMMF (3) LLC`). The applier uses a narrower comparator,
unambiguous-only, through `lcc_entity_survivor`. The hazard travels with the technique, not the
function name — third time that lesson has been paid for.

### ✅ A0 shipped too — and the guard caught a second instance on its first CI run

`test/no-conflict-markers.test.mjs`, verified **red** on the pre-fix file. It found **two** damaged
files, not one, from **two different mechanisms**: a merge (`panel-redesign-verification.md`,
148 lines) and a **`git stash pop`** (`STATUS.md`). Both repaired; the genuine date conflict in
the first was **flagged rather than adjudicated**, per doctrine.

**⚠️ Two things worth keeping:**
- **Match marker CHARACTERS, never label text.** Stash-pop markers read `Updated upstream` /
  `Stashed changes` — a detector keyed on `HEAD` and a sha would have missed the second instance
  entirely.
- **The docs-only CI skip would have hidden the very population the guard exists for.** Both
  instances were `docs/*.md`, and PR #1801 was itself docs-only. The docs-only path now runs this
  one guard standalone (~1s, no `setup-node`, no `npm ci`). That was a deliberate step past A0's
  "docs + test only" guardrail and was flagged as such — **it should stand.** A guard that cannot
  see its own population is not a guard.

**Folders clean:** A0/A2 prompts and responses filed to `done/` (114 prompts, 41 responses). Live
queue in this window is **empty**; `196` belongs to the app window.


## 2026-08-27 (Cowork, automation window) — the merge procedure is now written from failures, not theory

Five PRs went through the new protected-`main` flow in one evening, and **every step of the
standard loop that failed got rewritten from the failure.** `docs/os/GITHUB-WORKFLOW.md` is now
the record of what actually goes wrong here, not a description of the happy path:

| what failed | how often | now in the doc |
|---|---|---|
| Direct push to `main` rejected (`Required status check "npm test" is expected`) | 1× | §1 — not transient; retrying never works, it needs a PR |
| Branch cut from a **stale base** because `git checkout main` / `git pull --rebase` refused a dirty tree and PowerShell carried on | **3×** | §0b + §4c — **clear the tree first, verify twice** |
| Conflict "resolved" by keeping both sides | 2× (one YAML, one prose) | §4b |
| Two windows fixing the same file independently | 2× | §4a — check `git log origin/main -5 -- <file>` first |
| Merge blocked by "out-of-date with base" **with both checks green** | 1× | §2 step 4 + §3 — **expect a third step**; a green check set goes stale when `main` moves |

**⚠️ The stale-base failure is structural here, not carelessness.** Cowork writes edits into the
working tree continuously, so **a dirty tree is this repo's normal state** — a procedure that
assumes a clean one fails most times it is run. That is why §0b now leads with `git status`
rather than mentioning it in passing.

**⚠️ And the "out-of-date" gate is the COMMON path, not an exception**, because two audit windows
commit to `main` all day. Two green checks are not sufficient on their own: they describe a base
the PR may no longer be merging into. Only the green set **after** "Update branch" describes what
actually lands.

**Also found, filed, and not yet fixed — committed conflict markers on `main`.**
`docs/architecture/panel-redesign-verification.md` lines **424–571** (148 lines) are an
unresolved merge committed as file content, from `5bbe8c0f`, unnoticed since. Git does not flag it
(no `UU` — the conflict *was* resolved, by committing the markers) and prose has no parser. Third
instance of the keep-both-sides class in one evening: in YAML it made a workflow unrunnable; here
it silently voided half a verification document. → prompt **A0**, backlog row **A0**.

**Queue (this window): A0** (conflict-marker guard + repair) and **A2** (apply the 380 `agrees`
chains). A2 is the priority — it is the one that makes `establish_ownership_history` complete a
task for the first time in 69 days, and the first prompt in this thread that **writes production
data** rather than adding a view.

**⏳ Still unverified: V1/V2/V7.** Measured 03:32 UTC — crons 212 (04:40), 220 (05:45), 239
(06:45), 240 (10:18) had not fired. Property-twin's last write was `2026-08-19 05:45:55`, exactly
cron 220's slot, which **confirms the cron fires and rules out a broken schedule** — consistent
with the undeployed-fix diagnosis. The 6am-CT scheduled check runs after all four windows.


## 2026-08-27 03:10 UTC (Cowork) — two follow-up measurements on P195's open items

### ⚠️ N11's blast radius is DORMANT, not armed — measured before treating it as an incident
The P195 entry below is right that `lcc_apply_fuzzy_merges` would auto-merge **3,053 groups with no
undo**. Measured what would fire it: **nothing does.** `cron.job` scan for `fuzzy|apply_fuzzy|
merge_entity` → **zero rows**; the only repo reference outside migrations is a *comment* in
`api/_shared/cre-registry.js`. So N11 is a **loaded gun, not a firing one** — the same disposition
CLAUDE.md gives `lcc_sync_property_owner_to_portfolio`. **Fix it before anything wires it up; do not
escalate it as live risk.** Reading "3,053 irreversible merges" without checking for a caller would
have produced exactly the wrong urgency.

### ⚠️ N3e RE-MEASURED — the parked cards are mostly parked CORRECTLY, and my first number was the instrument
I measured the 143 parked candidates as **"100% missing an employer"** — reading the JSON key
`contact_company`. **The key is `company`.** Corrected: **107 of 143 (74.8%) DO carry an employer.**
Class 11 again, and it was caught only because that answer contradicted a direct join to
`unified_contacts` (98 of 131 people had a company there). **Two measurements disagreeing is the
signal — check the key names before believing either.**

So these owners are not parked for want of data. They are parked because **the employer on file does
not match the owner**, which is the gate working as designed. Reading named rows, the *wrong* parks
fall into exactly two recognisable shapes:

| shape | example |
|---|---|
| **sponsor / SPE** — the P190/P193 relationship again | `OXFORD BIT GALLERY PLACE PROPERTY OWNER, LLC` ← Stephen Nicotra @ **Oxford Development Company**; `Salus Gov't Properties` ← **Salus Healthcare Real Estate Group LLC** |
| **junk-formatted company name defeating a string test** | `Savlan Cc Property LLC` ← Zusha Tenenbaum @ **"WWW Savlancapital COM"** |

Correct parks read plainly: `FORT WORTH TX I MG` ← Windsor Place Realty; `Ngp Vii Dayton Oh` ←
Dayton Street Partners (matched on the token `dayton`); the JP Morgan CMBS trust ← M.R. Champa LLC.

**Revised fix — and it is NOT the one N3e implies.** Do not widen the un-park (that restores the
Gary George noise). Instead: **show the park reason on the card**, and **route the sponsor-shaped
parks into the `lcc_owner_sponsor_domain` map** where the answer already lives. The population is
**75 owners / $98M**.

### Verification items still pending, both on schedule
- **N9v** — auto-attach: **0 writes at 03:10 UTC**, unchanged. Cron 241 fires **06:55 UTC**. Still
  expected; check after 07:00.
- **N9w** — sidebar: alert still open, no post-reload capture has landed. Still unproven either way.


## 2026-08-27 (Cowork) — P195: the byte-identical owner merge landed, and two traps in landing it

**66 entities merged into 56 survivors; $102,216,468 of current annual rent consolidated; 0 live
backrefs left on any tombstone; `auto_mergeable` unchanged at 3,053.** NGP Capital 5→1
($59.8M→$68.3M, **29→38 assets**), AVG Partners 4→1, GI Partners 3→1, JLB Capital 3→1, WMC 2→1,
NGP Group 3→1. Blind byte-identical groups **60 → 4**. Full writeup:
[`docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`](../audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md).

**⚠️ The prompt's premise was wrong for 4 of the 60 groups, and structurally so.**
`v_lcc_merge_candidates_normalizer_blind` selects names that reduce to NOTHING under the generic-CRE
stoplist — which is *both* acronym-named real firms ("NGP Capital" → `ngp`, under the normalizer's
4-char floor) *and* pure-generic fragments ("Capital", "Properties", "Partners Group"), which are
failed extractions. The three `Capital` rows span dia + gov with three DIFFERENT external identities;
17 of the 18 `Partners Group` rows are empty husks minted in two bursts on 2026-06-24/26. Merging
them fabricates a party. `lcc_p195_name_has_distinctive_residue` holds them (**4 groups / 25 entities
/ $158,846**, backlog **N10**). The held group worth reading is `capitalgroupproperties`: one member
carries a `costar/company` external_id of **`capital properties`** — a different company string.

**⚠️ `lcc_merge_entity` would have destroyed a live contact, silently.** It calls the reconcile with
`p_snapshot => false` (so every dedup DELETE is unrecoverable — `lcc_apply_fuzzy_merges` auto-merges
3,053 groups with no undo) and its `owner_contact_pivot` dedup `EXISTS` is **uncorrelated**: it asks
only whether the winner has a pivot at all. On `bamproperties` the winner held a pivot naming
**nobody** and the loser held the group's **only named contact, "Alex Bias"**. The driver now
snapshots the losing side and folds the pivot **fill-blanks** before merging; Alex Bias survives with
a `p195_merge_fold` provenance entry. Fixing the shared path is backlog **N11**; new playbook
**Class 15**.

**Round trip proven, and it caught a real bug.** Real merge → `lcc_p195_unmerge` → compare on
`dandmholdings`: zero residue. It failed first time on `428C9 is_current is GENERATED ALWAYS` — a
footgun already in `CLAUDE.md`, shipped past review in a `select *` restore. A reversal path that has
never been run is a claim, not a capability.

**Measured nil, with a positive control:** zero `(source_domain, source_property_id)` collisions
between members across all 60 groups, so the P175a ghost-vs-ENDED conflict never arose — against
**2,678** such collisions fleet-wide, which is what makes the zero believable.

**Class 8 scheduled, not remembered:** `v_lcc_p195_resurrection_watch` + `lcc_p195_check_resurrection()`
on **cron 243 (06:52 UTC)**, opening a deduped `p195_duplicate_owner_resurrection` alert when a
cleaned group re-accumulates. First run: `open_groups 0, regrown 0`. Read `regrown_groups`, never
`open_groups`.

**Still open, unchanged:** N3e (95 parked Tier 0 cards, $118M — do NOT widen the un-park), the
fcp/tmg sponsor entries pending Scott, N3c (bank/trustee scope rule), and the operator steps (reload
the unpacked extension, add `npm test` to branch protection, read `GET /api/tier0-auto-attach-tick`
to decide `TIER0_AUTO_ATTACH`). N3b is closed by this pass; N3a now covers only the
wording-difference half (Easterly ×2), whose obvious fix P189 already measured and rejected at 25%
precision.


## 2026-08-26 (Cowork) — P194: the Tier 0 auto-attach sweep, and what a "living loop" actually needs

Prompt 192 asked for four things. **One was built as specified; two came back different from the
brief when measured; the fourth has no input at all.** Full writeup:
[`docs/audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md`](../audits/P194_TIER0_AUTO_ATTACH_AND_LIVING_LOOP_2026-08-26.md).

**Re-measure first — the brief was two hours old and already stale.** P192's header says *ask 98 /
auto 11 / parked 146*. Live: **ask 78 / auto 9 / parked 146**. The 9 auto cards were re-read row by
row: **9/9 correct** (Deke Hunter @ hunterproperties.com, Joseph Paolino @ paolinoproperties.com,
John Bryant @ healthcarerealty.com, …). Four carry no link evidence and are still right — an exact
domain↔core match beats a CRM `company_name` string.

**⭐ §1 the sweep — `api/_handlers/tier0-auto-attach-tick.js`.** GET = ungated dry run, POST =
flag-gated (`TIER0_AUTO_ATTACH`, **off**), cron 241 at 06:55 (scheduled anyway, per P133 — an
unscheduled job is invisible). The prompt's "build it in the existing verdict path" was applied one
level deeper than written: the effect is extracted ONCE into
`_shared/tier0-attach-effect.js::applyTier0Attach`, and **`admin.js` now calls it too**, so the human
click and the sweep cannot drift. A test pins that the tier0 verdict block no longer PATCHes the pivot.

**⚠️ AND THE SWEEP WOULD HAVE SILENTLY DELETED TWO LIVE OPERATOR QUESTIONS.** The lane view excluded
owners whose pivot source was `<> 'tier0_confirm'`. `'tier0_auto'` satisfies that inequality, so the
first auto attach on an owner would have hidden **every other open card for that owner**. Measured
before shipping: **3 of 9 auto owners hold a second card, two of them live `ask`** — Healthcare
Realty Trust's `healthcarerea.com` and Capital Square 1031's `capitalsq.com`. The drain metric would
have *overstated* the work, because cards_open would fall by deletion rather than by answer.
**Durable rule: when you add a value to a column an exclusion tests with `<>`, go read the exclusion.**

**§2 the stoplist — now ONE function** (`lcc_is_consumer_mailbox_domain`); it was copied across three
migrations and had already drifted. Widening measured first: 41 people leave the pool, **exactly ONE
card leaves the lane** — `Frontier Hub LLC → frontier.net`, the known false positive.

**⚠️ The equivalence gate caught a regression I had already made.** The first rebuild predicted a
1-row diff and produced **20 removed / 1 added** (13 ngpv.com, 5 uirc.com, 1 jbg.com; George
Washington University resurrected). Cause: **P190 applied its `sponsor_map` arm and its
`is_not_prospected` gate LIVE and deliberately did not commit the view body** ("read the LIVE
definition as the authority"). The newest *committed* source therefore no longer described the
shipped view. **A migration that changes a view must carry the whole view** — "read the live
definition" makes the repo an unreliable source and guarantees the next rebuild regresses. Both are
now committed; the repo file is hash-verified against the applied statement.

**§2 of the prompt (the living loop) — the headline claim is true for ONE of the six signals it
lists.** A `weak_partial` card is un-parked only by `n_link_evidence > 0` (a candidate's
`contact_company` matching the OWNER) or a sponsor-map row. Correspondence, SF campaigns, SF
contacts, Outlook entries and titles all move `n_person_evidence`, **which the CASE never reads**:
**95 of 146 parked cards ($118M) already carry person evidence and are parked anyway.** The fix is
NOT to un-park on person evidence — that is the P188 Gary George finding (green on three person
signals for George Washington University, works at a poultry company) and would restore exactly the
noise P192 removed. Shipped the instrument instead: `v_lcc_tier0_park_watch`.

**§4 "start with the reject signal" — there are ZERO rejects.** `lcc_tier0_confirm_log` holds 27
attaches and nothing else; the 6 `reject` rows in `lcc_decisions` are `superseded` no-ops. Not built.
**And the obvious substitute is destructive:** running the rule on the 27 attaches, **16 open cards
collide with an already-attached domain and 0 of 16 are contradictions** — 13 are the NGP SPE family
on `ngpv.com`, the rest duplicate entities / sponsor↔program. A shared domain is corroboration or a
merge signal, never a contradiction. Note a lexical classifier gets this WRONG (`lcc_owner_domain_core`
buckets the NGP SPEs as "genuinely different"); the answer came from reading the names.

Suite **4,592 tests / 0 fail**; the new guard verified RED on the pre-fix predicate.


## 2026-08-26 — RECONCILED: 189, 192/194 and the sidebar P194 all merged. **Two of my own claims were refuted.**

Live state: Tier 0 lane **86 cards** (27 attaches logged), 146 parked, merge groups **5,222 → 5,343**
(+121 fallback), `auto_mergeable` **3,053 → 3,053** (proven unchanged), sponsor map 4 rows, sidebar
foreign-writer alert **open** (waiting on the extension reload).

### ✅ P189 — the merge detector's blind spot is fixed
`v_lcc_merge_candidates` now carries a namespaced `dc:<lcc_owner_domain_core>` fallback key. **RMR
Group appears** — the stated verification target. Newly visible: **121 groups / 300 entities /
$136.5M, of which 60 groups carry BYTE-IDENTICAL names ($102.4M)** — "NGP Capital" ×5, "AVG
Partners" ×4, "GI Partners" ×3. Safety was **proven, not asserted**: the blind population is all
`norm_name IS NULL`, zero empty-string, therefore disjoint from every existing group — gated against
a pre-migration snapshot at `auto_mergeable` 3,053 → 3,053, 0 pre-existing groups altered. Fallback
groups are forced `auto_mergeable = false` because `lcc_apply_fuzzy_merges()` loops that flag
straight into `lcc_merge_entity()`. **No entity was merged** — all 121 are proposals.

### ⚠️ MY RECOMMENDATION IN 189 §1b WAS MEASURED AND REJECTED
I wrote that grouping duplicates on the **shared email domain** was *"far better evidence than any
name comparison"* and said to consider it first. Graded over every same-domain owner pair: **4
net-new pairs, exactly 1 a genuine duplicate (Easterly). 25% precision.** The rest — plus 13 NGP
pairs — are **sponsor↔SPE**: the domain is shared *because an SPE family shares its sponsor's
domain*, i.e. real evidence answering a **different question**, the same shape as Gary George. A
domain-keyed view would have been a noise generator, so it was correctly not built.
*(Side findings kept: `jameshowardcpa.com` groups two unrelated owners through a shared CPA, and
`lcc_is_spe_shell_name` under-detects place-named SPEs — a stated gap, not a second detector.)*

### ⚠️ AND MY PROMPT 192 §2 WAS WRONG IN A WAY THAT MATTERS
I claimed that because decidability is computed live, *"a parked card returns to the queue
automatically the moment new evidence lands"*, and listed six signals. **True for exactly one of
them.** Only `n_link_evidence > 0` (or a sponsor row) un-parks. Correspondence, SF campaigns, SF
contact records and titles all move `n_person_evidence`, **which the decidability `CASE` never
reads**. Measured: **95 of the 146 parked cards ($118M) already carry person evidence and are parked
permanently** — Class 10 hiding inside a Class 10 fix.
**It was correctly NOT widened** — admitting person evidence restores exactly the Gary George noise
the triage removed. `v_lcc_tier0_park_watch` now makes the real mechanism observable. **The right
fix is a different resolution path for those 95, not a looser un-park.**
And §4 ("start with the reject signal") had **no input at all**: 27 attaches, **zero rejects** — a
consumer with no producer, so the demotion engine was correctly not built.

### ⚠️ CLASS 14 RECURRED INSIDE ITS OWN FIX
P191 narrowed the lane exclusion to `active_source <> 'tier0_confirm'`. P194 added a second value,
`'tier0_auto'` — **which satisfies that inequality**, so the first auto-attach would again have
hidden every other card for that owner (**3 of 9 auto owners hold a second card, two of them live
`ask`**). Worse, `cards_drained` would have *risen* because questions were deleted rather than
answered. Fixed to a SET. **When you add a value to a column an exclusion tests with `<>`, go read
the exclusion.**

### ✅ P194 (sidebar) — a retired Vercel deployment was a second writer
The Chrome extension had seven hardcoded fallbacks to the **retired Vercel deployment**, which still
serves and still holds the service key — so sidebar intake POSTs succeeded against a build frozen
before Prompt 61. The earlier "not a stale deploy" verdict was **run against the wrong deployment**:
the merge-base test interrogated Railway, and those rows were never on Railway. Fixed with one
`pickIntakeHost()`; a provenance-invariant detector (not a quality metric) now alerts on any channel
writing ≥5 rows in 7d with zero `_provider` stamps.

### 👤 OPERATOR STEPS OUTSTANDING
1. **Reload the unpacked extension** — the sidebar fix is inert until then, and the open alert is
   watching for exactly that.
2. **Add `npm test` to branch protection** on `main` (Settings → Branches). The workflow exists; a
   workflow is not a merge gate.
3. **Read `GET /api/tier0-auto-attach-tick`** (ungated, no writes) — the 9 proposals it lists are
   what should decide flipping `TIER0_AUTO_ATTACH`, not the 9/9 measured internally.


## 2026-08-26 (Cowork) — P193: SPE subsidiaries should inherit the sponsor's answer (Scott, from the lane)

Scott, working the lane: *"I'm seeing duplicates that are subsidiaries and matching the correct
contacts… these should be automatically merged or connected to the true owner parent once we have a
connected domain and person."* He was looking at `NGP VI ESSEX VT LLC → ngpv.com` directly above
`Ngp Vi Harlingen Tx LLC → ngpv.com` — same three candidates, same sponsor, asked twice.

**⚠️ This is NOT prompt 189's problem, and conflating them would corrupt the ownership record.**
Easterly ×2 and "NGP Capital" ×5 are **one firm recorded twice** → a merge. `NGP VI ESSEX VT LLC`
and `Ngp Vi Harlingen Tx LLC` are **legitimately distinct legal SPEs** holding different properties
→ a **parent relationship and inheritance, never a merge**. Both problems are live in the same NGP
name space at once, which is exactly why they must be kept apart.

**Measured: 19 of 107 workable cards are one question asked three times.**

| sponsor | SPE entities | rent | candidates | registered parent |
|---|---|---|---|---|
| `ngp` → ngpv.com | **13** | $26.1M | 3 | NGP Capital ✓ |
| `uirc` → uirc.com | 5 | $4.9M | 7 | UIRC, Urban Investment Research Corp. ✓ |
| `jbg` → jbg.com | 1 | $2.9M | 3 | — |

**19 cards → 3 questions (−84%)**, and the judgement was already recorded
(`lcc_owner_sponsor_domain.confirmed_by = 'scott 2026-08-26'`).

**⚠️ Most of the machinery already existed — checked before building.** `lcc_buyer_parents` holds
**25 human-curated parents including NGP Capital, UIRC, RMR, Boyd Watterson, Easterly and Realty
Income**; `v_lcc_entity_tier0_parent` already carries **85 parent proposals covering NGP/UIRC SPEs**.
The real gap is narrow: **`entity_relationships` has 0 parent edges and no parent TYPE exists** —
the enum is associated_with, brokers, deal_party, developed, finances, guaranteed_by, leases, owns,
purchases, sells.

**⚠️ Naming trap worth recording:** `lcc_buyer_parents.domain` is the VERTICAL (`dia`/`gov`), **not**
an email domain — it does not overlap `lcc_owner_sponsor_domain.email_domain` (P190) despite the
column name. Two meanings of "domain" one table apart; check before "consolidating" them.

**Shipped:** `v_lcc_tier0_sponsor_rollup` — read-only, one row per (sponsor, domain) with the SPE
list and the registered parent. **The bulk attach is deliberately NOT built in SQL** — the JS
verdict path carries the shape guards and re-reads the card at write time.

**⚠️ And the rollup must not collapse the WHICH-PERSON choice.** "Do the people at ngpv.com work for
the NGP SPEs?" is one judgement; "do we call Fran Cowan, Kim Phillips or David Kent?" is a second
one that stays on the card. **UIRC has seven candidates** — auto-picking there would be the P188
mistake at 5× the blast radius. Spec: `prompts/193-*.md`.


## 2026-08-27 — the gate is GREEN on `main`; two lessons from how it got there; A2 drafted

**Both PRs merged** (#1797 docs + standards; the CI fix superseded by P196). `test-suite.yml` on
`main` pins **`node-version: '24'`**, single key, and **has now been green on `main`** — which is
the bar `GITHUB-WORKFLOW.md` §6.3 sets before a new CI job counts as a gate rather than a badge.
The lockout section of that doc was **rewritten the same day it was written**: it described a
blocker that no longer exists and named the wrong branch and Node version.

**⚠️ Two durable lessons, both now in `CLAUDE.md` and `GITHUB-WORKFLOW.md` §4:**

1. **Two audit windows fixed the same infrastructure independently, hours apart.** The automation
   window branched `ci/test-suite-node-22`; the app window shipped **P196 pinning Node 24** to
   `main`. Same correct diagnosis, two defensible Node choices. **The prompt-numbering convention
   prevents filename collisions and does nothing for shared config files.** New rule: before
   PR-ing a fix to a workflow / `package.json` / a migration, run
   `git log origin/main -5 -- <file>` first. Seconds, and it would have made the branch
   unnecessary before it was pushed.
2. **⚠️ A conflict resolution that keeps BOTH sides can be structurally invalid, and no test
   catches it.** Resolving that branch against the new `main` left **two `node-version` keys in
   one `setup-node` step** (`'22'` and `'24'`). Each hunk was correct alone and each carried a
   reasoned comment block, so "keep both" felt like the conservative choice — for a **list** it
   usually is; for a **mapping** it is invalid. GitHub could not build a run, so the required
   check **never reported**. **Distinctive symptom worth memorising: *"Expected — waiting for
   status to be reported"* that no re-run fixes usually means an INVALID WORKFLOW FILE, not a
   queued run.** Re-running cannot help; there is nothing to re-run. The fix was to **abandon the
   branch, not repair it** — `main` already carried the fix, so the branch was finished, not
   broken.

**⏳ V1/V2/V7 are NOT yet verifiable and must not be read as failing.** Measured at **02:59 UTC**:
property-twin still 200, reachability still 4 — but crons 212 (04:40), 220 (05:45), 239 (06:45)
and 240 (10:18) **have not fired yet today.** The scheduled 6am-CT check runs after all four.
Reporting these as stalled right now would be the same "window not yet reached" error the check's
own prompt warns against.

**Next in this thread: `prompts/A2-auto-apply-agrees-chains-2026-08-27.md`** — apply the 380
`agrees` chains (450 links) into `lcc_entity_portfolio_facts` and complete their tasks.
**Acceptance is deliberately not "rows written":** it is
`establish_ownership_history … status='completed'` going above **zero for the first time in 69
days**. A run that writes 450 links and leaves 380 tasks open has consumed nothing — which is the
exact failure this whole arc exists to close.


## 2026-08-27 — ⛔ `main` IS PROTECTED AND CURRENTLY BLOCKED. Two standards docs.

The docs commit was rejected:

```
remote: - Required status check "npm test" is expected.
! [remote rejected] publish-c868140 -> main (push declined due to repository rule violations)
```

**Not a transient error.** `git push origin <branch>:main` is a **direct push to `main`**, and a
required status check cannot run without a pull request — so the rule engine rejects it before
anything else. Retrying never works. **Every change now goes branch → PR → both checks green →
merge.**

**⚠️ `main` is BLOCKED, which is the more urgent half.** *"npm test"* is required and
`test-suite.yml` on `main` is pinned `node-version: '20'` — three test files import Deno `.ts`
edge modules Node 20 cannot load, so the check has never been green on `main`. **No PR can pass it
until a one-file workflow fix lands.** The corrected file is `beb3aecd:.github/workflows/
test-suite.yml` (Node 22 + a comment block explaining why). ⚠️ **Do not cherry-pick that whole
commit** — it also edits `CLAUDE.md`, which has since moved 581 lines on `main`; take **only the
workflow file** onto a fresh branch off current `main`.

**Diagnosed and dismissed — not defects:**
- **CRLF warnings are correct behaviour.** `.gitattributes` exists and already normalises to LF
  (`* text=auto eol=lf`, `.ps1`/`.bat`/`.cmd` kept CRLF). Windows editors write CRLF; git converts
  on the way in, exactly as configured. Nothing to fix.
- `cannot pull with rebase: You have unstaged changes` → dirty tree (the 11
  `test/fixtures/healthcare-discovery/*.csv` predate this session). Stash or commit.
- `The upstream branch … does not match` → `git push origin HEAD`, **never `HEAD:main`**.

**⚠️ And a process trap worth recording: `git stash` silently swept a session's work.** Stashing to
clear the rebase block also stashed that turn's *tracked* doc edits (`CLAUDE.md`, `CURRENT-STATE`,
`STATUS`, the kickoff), while the two *untracked* new files survived on disk — so the branch that
got pushed carried the earlier commit and **none of the standards work**. It looked complete and
was half-missing. **`git stash` is not a scratch buffer; check `git stash list` before assuming a
branch has everything.** Recovered by re-applying the edits against current `main` rather than
popping a stash taken from a 49-commit-older base.

**Two standards docs, wired into `CLAUDE.md`, `CURRENT-STATE.md` and the kickoff:**

- **`docs/os/GITHUB-WORKFLOW.md`** — the standard loop with exact PowerShell, the wait-for-CI rule,
  a failure-mode table mapping every message above to its real cause, the unlock sequence, and six
  non-negotiables (never push to `main`; never merge before green; **a new CI job is not shipped
  until it has been green once on `main`**; never run git from the sandbox; *merged ≠ running*;
  Scott merges, Claude Code never merges its own PR).
- **`docs/os/DOCUMENTATION-MAP.md`** — where every artifact is filed, the five files that carry
  state, the lifecycle *found → shipped → retired-with-a-reason*, the two-window labelling and
  prompt-numbering convention, and a **"do not create"** list headed by *no new `.md` at the repo
  root* — **exactly how K13–K20 stayed invisible for 17 days.** It also encodes the pre-archive
  checklist that recovered them.


## 2026-08-27 (Cowork, automation window) — A1 shipped; E4 answered; and the CI gate we just built is red on main

**A1 is merged and live** (`542896a`, PR #1793). `v_lcc_ownership_history_lane_split` +
`v_lcc_ownership_history_lane_actions` verified against the live DB — the split matches the audit
exactly, with owner counts and value added:

| action | tasks | owners | links | annual rent | human-actionable |
|---|---:|---:|---:|---:|---|
| `agrees` | 380 | 360 | 450 | $714.7M | no — a confirmation |
| `mismatch` | 73 | **45** | 120 | $401.2M | **yes** |
| `no_records` | 74 | 62 | 0 | $278.5M | no — auto-retire |
| `all_guarded` | 18 | 18 | 0 | $33.5M | **yes** |

**Badge now reads 91, not 545.** Tasks with no draft: **0** (545/545, reported rather than
assumed). `awaiting_draft` and `unrecognised_payload` kept as distinct states.

**⏳ The acceptance test is still OPEN and this matters:** `establish_ownership_history` has
**still completed 0 tasks.** A1 splits; A2–A4b drain. A split that does not end in a completion is
a no-op with extra steps — do not read "A1 ✅" as the lane being fixed.

**E4 answered (I flagged it as "measure before building A3") — the mismatches PARTIALLY cluster.**
Links on the 73 chains by `citation.data_source`: **`gsa_lease_diff`/acquisition 50 links across
46 chains** · `costar_sidebar` 53 / 21 · `sales_transaction` 15 / 15 · `county_deed` 2 / 2 (chains
carry links from several sources, so these overlap). **46 of 73 chains touch `gsa_lease_diff`** —
the producer `CLAUDE.md` already documents as emitting an "acquisition" every time the GSA lessor
field flickers between an SPE and its parent, which is exactly the shape that leaves a chain ending
on the wrong side. **That is a hypothesis, not a verdict.** If it holds on the 46, most of A3 is one
upstream fix and only ~27 chains are genuine human judgements. Folded into A3; test before building
73 cards.

### ⚠️ N9 shipped and is RED ON MAIN — a badge, not a gate

`test-suite.yml` landed (PR #1792) and **has never once been green, including on `main`.** It was
pinned `node-version: '20'`, **copied from `boot-check.yml`**; three test files import Deno `.ts`
edge modules and **Node 20 cannot load a `.ts` file** (`ERR_UNKNOWN_FILE_EXTENSION` — 0 pass,
thrown before any test body runs). On Node 22 the suite is **4,606 pass / 0 fail**.
`boot-check.yml` correctly stays on 20 — it never imports a `.ts` module, which is exactly why
copying its pin was the wrong default.

**The one-line fix is on a pushed branch with no PR open, so `main` is still red.** Two operator
steps: merge it, then add *"npm test"* to branch protection as a **required** check. Without the
second, a red suite still merges — **PR #1793 proved it by merging 58 seconds after opening,
before CI finished.**

**Durable rules added to `CLAUDE.md`:** *a new CI job is not shipped until it has been green once
on `main`* (a job red on every run is a badge people learn to merge past — the precise failure N9
existed to close), and *"red on my PR" is not "my PR is broken"* — check the base branch first;
this one was red on `main` twice, and it was **not flaky**.

### Root-worklog consolidation — and it recovered five measured defects nobody had filed

31 one-off worklogs sat at the repo root; they are now `docs/history/worklogs/` + an `INDEX.md`.
**Scanned for open-work markers BEFORE moving** — 24 clean, 7 not — and everything actionable went
into `PLANNED-BACKLOG.md` **P10 as K13–K20**, each keeping its original measurement:

- **K13** `cm_gov_sold_cap_by_term_dot` uses the **old term ladder**, not `firm_term_years_at_sale`
  — **1,368 cap-eligible sales bucket differently**, and `cap_5to10` is labelled `6-10`. A stale
  view definition, *not* a data-ingestion failure (term data is 3,211/3,211 populated).
- **K14/K15** `cm_gov_lease_termination_rate_m/_q` can select a **corrupt partial snapshot** as its
  active denominator (Feb-2019: **11 lease keys vs ~8,050**), plus the corrupt source months
  themselves, which every other consumer can still hit.
- **K16** `cm_gov_rent_price_psf_q` has no display policy; pre-1997 is unreliable — **Scott's call**
  between 1997-06-30 and 2003-01-01.
- **K17** `cm_gov_market_turnover_m` — export crops at 2012 in code while the gov `cm_view_registry`
  has no `display_from`, so DB and export policy disagree.
- **K18** `cm_gov_core_cap_rate_dots` keeps a lease-derived fallback plotting **0 rows today** —
  fine now, a leak for future unbackfilled sales.
- **K19** the gov seller-sentiment `_8q` / `6+ yr` fix was **never mirrored to dia**.
- **K20** dia 23654's **Census-radius demographics write** (Prompt 16 item 3) never completed.

Four other flagged files matched on *follow-up* / *remaining* but their items were already closed in
the same file — read in full, nothing carried.

**⚠️ The durable lesson, and it is about our own process:** **a consolidation scoped to a directory
misses whatever sits outside it.** P141 was thorough inside `docs/` and still left five measured,
unfixed Capital-Markets chart defects invisible for **17 days** — they were never in any index,
including the backlog that exists precisely to hold unbuilt work. **Enumerate by file type across
the whole repo, not by folder, and grep candidates for open-work markers *before* moving them.**
Three live doc references were repointed to the new paths in the same change.


## 2026-08-26 (Cowork, automation window) — the end-to-end data-process audit: we are not short of automation, we are short of CONSUMPTION

Picked up the Ollama-hygiene thread in its broader framing — *audit our data processes end to end,
recommend where AI/automation raises productivity*. Full writeup:
`docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`.

**~3,000 research tasks and 419 decisions are open. 983 tasks sit in lanes that have NEVER
completed a single item** — one of them for 68 days. Meanwhile the auto-retire sweeps are working
well (9,605 skipped across the healthy lanes) and every assist is producing. The gap is not
production and not retirement; it is the middle.

**⭐ The biggest single win, and it needs no model at all.** `establish_ownership_history`:
**545 open, 0 completed in 68 days** — while **453 finished, deterministic, record-cited answers
sit in `lcc_clean_assist_proposals`** from P131/P133. Reading their confidence shows why nobody
works the lane: it is **three completely different jobs wearing one label.**

| bucket | n | what it really is | correct action |
|---|---|---|---|
| agrees with current owner | **380** | a **confirmation**, not a question — and it carries ~707 ownership links the BD spine is missing | auto-apply, no human |
| **⚠️ MISMATCH** | **73** | last recorded grantee **≠** our current owner — our record is contradicted | a data-integrity **alert**, not research |
| nothing on file | **92** | unanswerable from what we hold | auto-retire, terminal |

**The 73 is exactly the "~73 mismatch flags" backlog V3 predicted as "a free data-integrity
signal."** It is free, it is real, and it is buried under 472 items that are not questions.
A lane that mixes *confirm what you already believe* with *your ownership record is wrong* with
*this cannot be answered* trains the operator to skip all three — which is precisely what 68 days
of zero completions looks like.

**P131 lens: category (a) — already on-box and STRUCTURED. This is plumbing, not an LLM.** The
most promising-looking model opportunity in the system turned out to need no model. Third time
that lens has paid.

Filed as backlog **P1b / A1–A7**. Also flagged: six lanes with **zero** lifetime completions
(119 items) needing a consumer or honest retirement; `confirm_true_owner` **stalled** not dead
(35 decided once, 0 in 7d); `match_disambiguation` ranked for 81 days with **1** decision.

**Negatives recorded too** — no evidence the assists under-produce, no evidence the sweeps are too
aggressive, and **no new LLM opportunity surfaced by this pass.**

**Follow-up, same session — the structured payload corrected my own measurement twice.** Drafting
A1 meant checking whether the classifier I had measured with (`reason ilike '%does not match the
current owner%'`) was safe to build on. It is not — that is the **P182 trap**, a text detector over
prose the drafter generates. `proposed_link` already carries `terminates_at_current_owner`,
`draftable`, `insufficient_reason`, `continuity.contiguous` and `research_task_id`. Both methods
agree at **380 / 73 / 92**, so the finding stands — but only the structured one is buildable, and
it surfaced two corrections:

1. **⚠️ The 92 are TWO populations, not one.** **74 `no_transitions_on_file`** (genuinely nothing
   recorded) and **18 `all_transitions_guarded`** — transfers **do exist** and every one was
   rejected by a P138 guard. Those 18 are *"data we chose to distrust"*, not *"no data"*, and a
   marginally over-strict guard is recoverable. **Auto-retiring all 92 together would silently
   discard the recoverable half** — P181 recurring. Split into A4 (the 74) and **A4b** (the 18).
2. **The "~707 links" figure I published hours earlier is stale** — it was P131's original count.
   Measured now: **570 links across all 453 draftable chains, 450 of them in the 380 auto-appliable
   ones.** Corrected in the audit doc and backlog A2. Do not quote 707.

**Prompt drafted: `prompts/A1-ownership-lane-three-actions-2026-08-26.md`.** ⚠️ **New numbering
convention, because two windows are drafting prompts at once:** the automation window uses
**letters matching its backlog rows** (A1, A2, …); the app window keeps the **numeric** series
(189, 192, 194, …). They can no longer collide.

**A1 splits only** — no writes, no retirement, no auto-apply; A2/A3/A4/A4b each land separately and
reversibly. Its acceptance test is deliberately not "the view exists": it is
**`establish_ownership_history` completing its first task ever.**


## 2026-08-26 — ⚠️ TWO AUDIT WINDOWS ARE RUNNING IN PARALLEL. Know which one you are in.

Scott is running two Cowork chats against this repo at once. **They have different scopes and must
not cross**, or the same finding gets built twice or dropped by both.

| | **App audit** (desktop window) | **Data-process & automation audit** (this thread) |
|---|---|---|
| **Scope** | LCC the application — defects, lanes, surfaces, code fixes | Our **data processes end to end**, and where AI/automation (incl. the on-prem Ollama model) can raise productivity |
| **Owns** | prompts **189** (duplicate owner entities), **192** (Tier 0 auto-attach + living loop), **194** (sidebar extraction bypass) | the W5.3 / Ollama-hygiene lineage: `W53_AND_OLLAMA_HYGIENE_KICKOFF.md`, `LOCAL-MODEL-LEVERAGE-MAP.md`, `LOCAL-MODEL-GAP-AUDIT.md`, backlog **P2 (L1–L10)** + **N4–N7** |
| **Backlog rows** | N3a/N3b/N3c, AC1b–AC1d, AC2–AC10, N8/N8a | L1–L10, N4, N5, N6, N7, V6 |

**The split that matters and is easy to get wrong:** a *finding* about a data process stays here
even when its *code fix* goes there. The W5.3 sidebar-channel discovery is the worked example —
the measurement, the refuted seed hypothesis and the "split by channel, then split again" lesson
are **this** thread's output; prompt 194, which repairs the writer, is the **app** thread's.

**Do not action 189 / 192 / 194 from this chat.** They are drafted, correct, and dispatched.


## 2026-08-26 (Cowork, late) — sized the W5.3 channel split; the obvious next build is refuted

Scott asked what the email/PDF path would gain if it seeded from structured capture the way
sidebar does. **Measured answer: nothing. Do not build it.**

**The seed is not where sidebar's coverage comes from.** Sidebar is itself **two populations**:

| sidebar sub-population | rows (30d) | OM-class | cap | NOI |
|---|---|---|---|---|
| **rich seed** — CoStar *page* capture (`asking_price`, `cap_rate`, `tenant_name`, `domain_property_id`) | 101 | **0** | **0%** | **0%** |
| **bare seed** — document capture (`tags` only) | 249 | 76 | 36% (**87%** in the OM subset) | 34% |

**65 of the 101 rich-seed rows carry a `cap_rate` in the seed and 0 carry one in the snapshot**;
identical-value counts for cap/price/tenant are all **0**. The high-coverage OM rows are the ones
with *no* structured hints. Sidebar's quality is a **genuine extraction**, not an echo of CoStar —
so the 87%-vs-65% gap is not an argument for seeding email. Recorded as backlog **N8b 🚫** so the
idea is not re-raised off that gap.

**⚠️ This also refutes the hypothesis I put in the audit doc and prompt 194 four hours ago.**
Corrected in both, plus `CLAUDE.md` — the wrong lead would have cost Claude Code a session.
**Corrected hypothesis: a distinct sidebar DOCUMENT-extraction path with its own older prompt** —
good enough to out-recall the email path, predating Prompt 61.

**The lesson generalises past this table:** "split by channel" was right and **not sufficient** —
the channel that mattered had to be split again. The unsplit sidebar average (36% cap) and the
document-only average (87%) differ by 51 points and describe different things. **A population
defined by WHERE a row entered can still hold two populations defined by WHAT entered.**

**New question opened (N8a):** the 101 page captures carry structured CRE data that never reaches
the extraction snapshot. `CLAUDE.md` says `sidebar-pipeline.js` writes the domain DBs directly —
**a docs assertion, unverified.** If it is being dropped, that is a real capture loss. Folded into
prompt 194 rather than assumed either way.


## 2026-08-26 (Cowork, late) — V1/V2 were never broken. They were never DEPLOYED.

Picked up the P0 "verify, don't build" tier. Both stalled lanes have **one cause**, and it is not
in their code. The build serving all day was `bb26453a`, cut at **16:03 UTC**:

| fix | merged | vs cutoff | production |
|---|---|---|---|
| P131 ownership-chain drafter | 15:18 UTC | **before** | ✅ 545 rows |
| P135 property-twin | 18:16 UTC | after | ❌ 0 |
| P136 reachability | 18:56 UTC | after | ❌ 0 |

Same day, same author, same quality — the only variable was which side of the deploy cutoff they
landed on. **⚠️ I had escalated these hours earlier to "a second stall to diagnose." That was
wrong, and it was one `git merge-base --is-ancestor` away from being obviously wrong.** Corrected
in `PLANNED-BACKLOG.md` V1/V2 and `CURRENT-STATE.md` §4 rather than quietly reworded.

**Two traps inside the diagnosis, both nearly fatal to it:**
- **`/version` reports `git_pinned: true`** — a claim, not proof. What made it safe was the
  sibling lane: P131 shipped 3 hours earlier and writes 545 rows/night, so the boundary between
  the two IS the answer.
- **A DB migration ships instantly; the JS reading it does not.** P192/P193 visibly moved the Tier
  0 lane counts (views + migrations) while P135/P136 did nothing — the same "deploy" was
  half-applied. Never infer a JS change shipped because its SQL half works. Likewise a `pg_cron`
  job existing proves nothing about the JS it calls.

**Cleared, mid-diagnosis, by PR #1789 (23:13 UTC).** `/version` moved `bb26453a` → `870445f1`
while I was measuring; **0 commits are now un-deployed.** A "redeploy Railway" recommendation
written five minutes earlier would have shipped stale — the re-measure doctrine applied to the
deploy itself.

**Also found: R8 Stage 1 is a ONE-SHOT, not a pipeline** — and `CURRENT-STATE.md`, written the
same day, already called it "LIVE and producing." The 774-char take carries
`generated_at = 20:51 UTC` against a row created at 10:00 and a cron firing at **10:18**, so cron
240 did not write it; it was generated by hand during the P138 session. → backlog **V7**.

**Nothing is proven until the lanes move.** Three verifications, all tomorrow:

| lane | cron | window (UTC) | passes when |
|---|---|---|---|
| property-twin | 220 | 05:45 | proposals pass **200** |
| reachability-harvest | 212 | 04:40 | `reachability_harvest_review` passes **4** |
| Analyst's Take | 240 | 10:18 (weekdays) | a take lands with `generated_at` **inside** that window |

New `CLAUDE.md` doctrine: **"MERGED" IS NOT "RUNNING"** — run
`git merge-base --is-ancestor <fix> <deployed>` *before* any other hypothesis about a worker that
writes nothing.


## 2026-08-26 (Cowork, evening) — picked up the W5.3 / Ollama-hygiene thread; it was measuring the wrong population

Scott: *"pick up the thread that the W5.3 and Ollama hygiene campaign last left off."* The
**hygiene half (W8) is complete** — U1/U2/U3/U4/U5 all shipped, all `on`; its only open items are
the two stalled lanes (V1/V2). **The W5.3 half is what was still open**, and the open end was not
the one the backlog described.

**The backlog row (L8) asked for "a re-grade on ~50 fresh intakes post-Prompt-61." That re-grade
already happened on 2026-08-11 (102 extractions) and upgraded the verdict to "validated."** What
nobody checked is *what population it graded.*

**`staged_intake_extractions` is fed by three channels with different INPUT types, and only two
ever run the hardened prompt.** Last 30 days:

| channel | rows | `_provider` stamped | hardened (P61) schema |
|---|---|---|---|
| **sidebar** | **350** (56%) | 67 | **0 — zero, ever** |
| email | 261 | 87 | 69 |
| folder_feed | 9 | 8 | 7 |

All seven P61 keys are **structurally absent** from sidebar snapshots (not null within them), so
this is a different prompt, not a coverage shortfall. **A fleet-wide coverage number therefore
moves with the channel MIX, not with prompt quality** — and the Aug 7–11 grading window is exactly
when a 64-row sidebar backfill landed.

**On OM-class docs the unhardened channel BEATS the hardened one on every field** — sidebar NOI
80% / cap 87% / building SF 96% / responsibilities 78%, against email 52 / 65 / 65 / 44. Not a
verdict on the prompt: sidebar reads **structured CoStar page data**, email runs **AI extraction
over a PDF**. Comparing them measures the input. **The verdict reverts to UNPROVEN for the
email/PDF path — not refuted**, and the first unmixed reading of that path (NOI 52%, tenant 60%,
responsibilities 44%) is stated without a conclusion attached, because none is established.

**Three hypotheses ruled out, recorded so nobody re-walks them:** stale deploy (live `/version` =
`bb26453abc01`, and `git merge-base --is-ancestor` confirms it **includes** the P61 commit — the
tempting answer, checked and wrong); a second writer (repo-wide grep: exactly **one** insert site,
`intake-extractor.js:751`, with `stripNonSaleKeys` + `ensureProviderStamp` on the two lines above
it); a flow writing the table directly (none). **The remaining candidate is the `seed_data` /
extraction-race interaction** — that 96%-building-SF profile is what a structured capture looks
like, not a full-key LLM return — and it needs **runtime evidence**, which is why it goes to Claude
Code as **prompt 194** rather than being guessed at here.

**Also found: `_provider` stamp coverage is decaying, not fixed.** The post-93 "100% (87/87
backfilled)" was a **backfill, not a repaired writer** — 08-10: 64/64, then 08-14 1/9, 08-19 0/4,
**08-26 0 of 21**. Class P176: *a one-shot repair of a recurring producer is a chore you repeat
silently forever.* → backlog **V6**.

**Reconciled prompts 139 / 140 / 141** (responses filed to `responses/done/`):

- **139 shipped** (PR #1787) — and its response surfaced something bigger than the prompt.
  **⚠️ NO WORKFLOW RUNS `npm test` ON A PR.** `boot-check.yml` is the only PR check and it runs
  `npm run check:boot` — a `node --check` sweep plus a `server.js` import. **The 4,551-test suite
  never executes in CI**, which is how #1786 merged green carrying a red suite and duplicated
  `<script>` tags. Every "guarded by `test/*.test.mjs`" claim across `CLAUDE.md` is a **local**
  regression detector, not a merge gate. It is the exact mirror of the 2026-07-20 incident
  `boot-check.yml`'s own header describes — that one produced the workflow; its twin was left
  standing. Fix is small, offline, and already scoped (`npm ci && npm test` on `pull_request`);
  **not built, because widening a lane PR into a CI-policy change is Scott's call** → backlog N9.
- **140 merged** (PR #1788), **grade still outstanding, flag still off.** The endpoint ships with
  the Railway redeploy; the sandbox has no `OLLAMA_URL` so every model path was stubbed and no
  real sample exists. Prompt moved to `done/`; the grade is carried as an operator step (N2).
- **141 shipped** (`07b2f845`) — CURRENT-STATE + PLANNED-BACKLOG created, STATUS trimmed to
  2,440 lines, preservation manifest in `docs/history/DOCS_CONSOLIDATION_2026-08-26.md`.

**Re-measured, unchanged, now escalated:** property-twin **still exactly 200 / 0 in 7d** (two
nightly windows since P135 merged); reachability-harvest **still 4 / 0 in 7d** (13 days). Both
flags read `on`. These have stopped being "awaiting verification."

**Healthy and moving:** clean-assist **45 → 63 in nine hours**; ownership-chain 545/545.
**Scott's Tier 0 lane is draining — 27 confirms logged today**, lane 109 → **87 open** (78 `ask`
/ $237M, 9 `auto` / $10M). ⚠️ **Do not attribute that −22 to the confirms alone** — **P193 (SPE
sponsor inheritance) also merged to `main` today** (`18c55acf`) and removes cards by design, and
P191 restored some. The three effects are mixed in one number; separating them needs
`lcc_tier0_confirm_log` diffed against the lane, which nobody has done. Prompt 193 filed to
`prompts/done/` (merged; no response docx — it landed as a direct commit).

Docs updated: `CLAUDE.md` (two new footguns), `CURRENT-STATE.md` (§1 CI row, §2 intake caveat,
§4 health table, §7 three new overturned claims), `PLANNED-BACKLOG.md` (N1 ✅, N2 ⏳, **N8/N9/V6
new**, L8 premise rewritten), `ROLLOUT_STATUS.md` (W5.3 corrected in place),
`NEW-CHAT-KICKOFF.md` (rewritten).


## 2026-08-26 (Cowork) — DIVISION OF LABOUR: Scott works the lane, the builds run in parallel

Scott asked whether to work the Decision Center lane now or wait. **Work it now — the two tracks do
not block each other.**

**Scott's track (nothing I build changes these judgements):** the 98 `ask` cards, top-down. Top of
queue today — Easterly ×2 → **attach Pulliam, not Shuler** (acquisitions vs deal execution);
TIAA-CREF (2 candidates); RMR Group (19 candidates at rmrgroup.com, Adam Portnoy among them, plus a
separate `rmrgroupinc.com` card that is a **different firm** — reject it on its own merits);
Prologis; Cunningham; Genesis Financial; Cambridge (two domains, one is Cambridge Management Ltd —
likely a different firm). Two `auto` cards (AVG Partners, Agree Realty → Joey Agree) are
one-click confirms.

**Duplicate-entity exposure at the top is small and known: 2 of the top 20 cards** (the two Easterly
entities asking the same question). Answering both is not wasted — the P189 merge consolidates them
afterwards. ⚠️ Note the naive check under-reports it: grouping the queue by `lcc_owner_domain_core`
returns "no duplicates" because Easterly's two entities produce *different* cores
(`easterlygovproperties` vs `easterlygovernmentproperties`). **Same blind spot as
`lcc_normalize_entity_name`, one function over** — a wording difference defeats any single
normalizer, which is why P189 needs a fallback key AND a wording pass.

**Build track (parallel, no operator input needed):** prompt 189 (duplicate entities — now the top
priority, `v_lcc_merge_candidates` blind to 1,089 orgs) and prompt 192 (auto-attach sweep through
the existing JS verdict path + the living-loop signals).

**Newly surfaced while ranking:** `Truist Bank → truist.com` ($6.2M, **15 candidates**) and other
bank/trustee owners are in the queue. A bank appearing as owner-of-record is usually a trustee or
lender, not a prospect — worth its own scope question rather than 15 person-picks.

**Folder cleanup:** prompts **139** (clean-assist xref interleave — shipped, CLAUDE.md carries the
P139 section) and **141** (docs consolidation — commit `07b2f845`) moved to `prompts/done/`.
**140** stays live: `OWNERSHIP_CHAIN_ROLE_LABELS` is still ungraded and still off. Live queue is now
exactly three files: 140, 189, 192.


## 2026-08-26 (Cowork) — P192: stop asking questions the data already answers. 255 cards → 109.

Scott, after working the lane: *"only propose the strongest candidates… only asking the human when
we absolutely need it… this is not a final determination but an ongoing pursuit… a dynamic and
living thing."* Plus: *"I still see a number of duplicate firms."*

**⚠️ Both observations have ONE cause.** Most apparent "duplicate firms" are one owner shown twice
because its SECOND domain card is a weak match nobody should be asked about — *Cunningham
Development Co → cunninghamdevco.com* (real) sitting directly above *Cunningham Development Co →
cunninghamwalters.com* (a different firm, zero evidence). **Gating on decidability removed most of
the apparent duplication without touching entity resolution.**

**The missing axis: "link evidence" was never sufficient on its own, in either direction.**
Prologis → prologis.com has ZERO link evidence and is near-certain; Westlake Village Natomas →
`westlakefarmsinc.com` HAS link evidence and is **a farm**. What was missing is how strongly the
domain identifies the owner, computed from the P187 order-preserving core: `exact` /
`domain_is_core_prefix` / `core_is_domain_prefix` / `curated_sponsor` / `weak_partial`.

| decidability | cards | owners | rent |
|---|---|---|---|
| `ask` — the operator's queue | 98 | 90 | $394M |
| `auto` — exact match, ONE candidate | 11 | 11 | $26M |
| `parked_domain_only` — never shown | 146 | 105 | $231M |

**Operator queue 255 → 109 (−57%) with no strong card lost.** Verified on named rows:
Easterly/easterlyreit.com still visible, Prologis still visible, while `crystalmgmt.com` and
`cunninghamwalters.com` — the two weak cards at the top of Scott's screenshot — are gone.

**⚠️ Auto-attach is `exact` ONLY, and one tier of match strength is the whole difference.** The 11
exact/single-candidate cards read **11/11 correct** (Agree Realty → Joey Agree, Paolino Properties
→ Joseph Paolino, AVG Partners → Arnold Schlesinger). The next tier down, `domain_is_core_prefix`,
reads ~9/12 and its failures are severe: **JP Morgan Chase CMBS Trust → jpmorgan.com** (a
securitization vehicle, not the bank, not a prospect) and **Frontier Hub LLC → frontier.net** (an
ISP — `frontier.com` is in the consumer stoplist, `.net` is not).

**⚠️ The 11 `auto` cards STAY VISIBLE and flagged** until the sweep that writes them exists. Hiding
a card nobody attaches is Class 7 (correct-and-invisible = not built).

**The living half is designed, not built** — `docs/claude-code/prompts/192-*.md`. Key property
already true: decidability is **computed live, never stored**, so a parked card returns to the
queue automatically the moment correspondence, an SF campaign, a title or a sponsor entry lands.
**Converting it to a stored status without building the sweep that clears it would be Class 10 +
Class 12**, both already paid for here.

**Still needs prompt 189 in parallel** — P192 removes *apparent* duplication only. Easterly is 2
real entities and "NGP Capital" is 5; no card triage fixes that.


## 2026-08-26 (Cowork) — P191: the lane closed cards it had no business closing (found by working it)

**Scott worked the first five Tier 0 cards and noticed duplicate companies. Reviewing what was
written found a real defect — in the lane, not in his judgement.**

**All four attaches are mechanically correct**: written, logged in `lcc_tier0_confirm_log`,
reversible, pivot and `entity_relationships` consistent. Nothing to undo for correctness.

**The defect: attach was per-OWNER while the card is per-(OWNER, DOMAIN).**
`v_lcc_tier0_owner_contact_lane_open` filtered `where not owner_already_has_contact`, and that flag
is derived per owner. P188's write-up explicitly claims *"rejecting one never closes the other"* —
true for reject (keyed on `subject_ref`), **false for attach**. So attaching any one domain card
closed every other domain card for that owner.

**What it cost, on the highest-value lane in the system:** the attach landed on
`easterlypartners.com` — **Alison Bernard, 0 emails, no SF, no Outlook, no campaign** (the card's
own counters read link 0 / person 0) — and silently suppressed the `easterlyreit.com` card holding
**Andrew Pulliam: 109 emails, in Salesforce, in the GSA Buyer campaign, 37 edges, EVP-Acquisitions**
— the doctrinal pursuit target. No signal was given that a better card had just closed.

**Fixed (P191):** closes only the (owner, DOMAIN) actually decided, discriminating on
`owner_contact_pivot.active_source = 'tier0_confirm'` so the 1,381 owners with contacts from
elsewhere stay excluded and the lane does not inflate. Measured: cards **260 → 256**,
easterlyreit.com **0 → 2** (7 candidates each), easterlypartners.com stays 0, Boyd Watterson stays
0. **No revert needed** — the verdict path supersedes rather than overwrites, so attaching Pulliam
on the restored card makes him active and leaves Bernard on the bench.

**New playbook Class 14 — a WRITE whose scope is wider than the QUESTION it answers.** Detector:
compare the key of the *question* to the key of the *exclusion*, check **every verdict type
separately** (reject was correct, attach was not — testing reject would have "proved" the design
sound), and after the first real verdicts diff the open list: one attach should remove one card.

**⚠️ And duplicates stopped being abstract.** Easterly is two owner entities, so the same question
was answered twice and the same person attached to both. **"NGP Capital" is five entities** — the
$8.5M one still has an open `ngpv.com` card asking what was already answered for the $59.8M one.
This is now duplicated operator work on the top lane, which raises prompt 189 above everything else.


## 2026-08-26 (Cowork) — P190: Scott's two Tier 0 decisions, applied live

**Decision 1 — "drop all universities."** Scott's explicit call, made with the cost stated: it
removes **George Washington ($23.8M) and Georgetown ($8.0M)** along with the public ones. Coherent
with doctrine — a university is an institutional owner-occupier, not a net-lease investor we show
deals to. **Prospecting only; ownership reconciliation is untouched.**
New `lcc_owner_name_is_not_prospected()` = public body OR university, composed rather than
overloading `lcc_owner_name_is_public_body` (Georgetown is not a public body, and that predicate
has two other consumers). University test measured fleet-wide: **87 organisations, all read and
confirmed genuine**; the trailing-"University" arm needed a negative guard because
`Nahmco Llc-s Series 2015 University` is a private LLC. 15/15 named-row gate including the
place-name traps ("Boyd College Station TX LLC", "University Park Plaza LLC").

**Decision 2 — the curated sponsor→domain map, 4 of 6 confirmed.** `lcc_owner_sponsor_domain`
(human rows only, `confirmed_by` required) seeded with **ngp→ngpv.com, uirc→uirc.com,
hpi→hpitx.com, jbg→jbg.com**. Scott explicitly **deferred fcp and tmg** — *"I'm unsure on that
fourth one and would need to google and check SF and our records to confirm"* — so they are NOT
seeded. This is the replacement for the acronym RULE that P187 measured at ~30–40% and rejected.

**Result:** candidate pairs **558 → 650**, owners **208 → 226**, open lane cards **237 → 260**.
The sponsor arm alone contributes **93 pairs / 25 owners / $123.4M**, of which **NGP is 17 owners
and $105.5M** across its SPE variants — the single largest coverage gain of the whole Tier 0 arc,
and unreachable by any rule. GWU → 0 ✓, Georgetown → 0 ✓, Boyd Watterson → 2 ✓, RMR → 20 ✓.

**⚠️ A deliberate inconsistency held for one round:** `v_lcc_top_seller_prospects` (4,118 rows,
would drop 17) and `v_lcc_owner_contact_decidability` (311 rows, would drop 2) still call
`lcc_owner_name_is_public_body` directly, so universities remain in THEIR scope. Repointing a
4,118-row seller surface blind at the end of a session was the wrong trade; **close it next.**

**⚠️ Postgres caught a real mistake here.** The first attempt at the view rewrite dropped
`match_arm`/`match_key`, which P188 had appended, and failed with `42P16 cannot drop columns from
view`. `CREATE OR REPLACE VIEW` is append-only for columns — re-read the live column list before
rewriting a view someone else has extended.


## 2026-08-26 (Cowork) — Tier 0 owner-contact arc COMPLETE: P186 → P187 → P188 (all merged, live)

**The bench that reads "— none" on top owners now has a working consumer.** Three prompts, each
correcting the one before it — the corrections are the point.

**P186** (PR merged) — `v_lcc_tier0_owner_contact_candidates` **58,694 ms → 252 ms (124×)**,
0-row equivalence diff both directions. ⚠️ *The recorded cause was wrong on both halves*: the rent
function was 0.3% and the two `EXISTS` 0.09%; 99.5% was a keyless join at `loops = 5,624,400`. A
prefix match on a metacharacter-free token is an equality join. Also: **public bodies out of
prospecting scope** per Scott (`lcc_owner_name_is_public_body` widened, 27/27 named-row gate, OBO
guard; ownership reconciliation untouched) and no blanket `university` rule — GWU $23.8M and
Georgetown $8.0M are private and must stay.

**P187** (PR merged) — the matcher was structurally blind to the biggest owners. `length(token)>=5`
yielded **zero tokens** for NGP/RMR/TIAA/USAA/GI/HPI/AVG; `watterson` could not prefix-match
`boydwatterson`; the stoplist ate "Realty Income Corporation" entirely. Fixed with
`lcc_owner_domain_core()` (**order-preserving** — `lcc_owner_strict_core` SORTS to
`assetboydmanagementwatterson`) plus an 8-char prefix-equality arm. Pairs 2,314 → 558, top-of-book
precision 76–80% → **~91%**. **Boyd Watterson ($179.8M), RMR incl. Adam Portnoy, Realty Income incl.
Sumit Roy, TIAA-CREF, GI Partners, AVG, Cole Capital visible for the first time.** Acronym arm
built, measured and **rejected**: 27.6% of owner names are entirely uppercase (the SPE naming
convention), so it produced `BOYD DEL RIO GSA LLC` → **dell.com**.

**P188** (PR #1785, merged, redeploy live) — the consumer: federated Decision Center lane
`tier0_owner_contact`, **558 pairs → 283 cards → 237 actionable / 171 owners / $695M**, one card per
(owner, DOMAIN), verdicts attach/reject/research, reversible via `lcc_tier0_confirm_log`.
**Nothing is written to `owner_contact_pivot` until Scott clicks.**

**Four corrections worth more than the features:**
1. **Evidence attests the PERSON, not the LINK.** Split: `company_confirms_employer` 164 vs
   `company_matches_owner` 99. Gary George (George's Inc, a poultry company) carries three of four
   signals for George Washington University.
2. **⚠️ P187's fan-out gate re-created the exact cross product P186 removed** —
   `Rows Removed by Join Filter: 6,222,095`, invisible because the gate returns 160 rows.
   3,099 ms → 1,263 ms. **A gate that filters a join is part of that join.**
3. **⚠️ Measuring a gate is not shipping a gate** — P186 measured the token fan-out gate, reported
   its effect, and never wrote it into the view.
4. **⚠️ Precision is a curve; quote the band.** ~91% covers only the top **10 cards / 7 owners /
   $521M** (the 45th pair sits at $16.38M). $16M→$2M is ungraded; `rentBand()` returns
   `precision: null` rather than interpolating. And **`v_owner_contact_enrich_queue` is the wrong
   drain metric** — 6 rows total, 2 of this lane's 171 owners.

**NEW DEFECT FOUND WHILE RECONCILING (→ Prompt 189): `lcc_normalize_entity_name` returns NULL for
1,089 live organisations carrying $185.1M of rent** — RMR Group, GI Partners, AVG Partners, MMI
Capital among them. `v_lcc_merge_candidates` groups on that column, so the duplicate-entity
detector is **structurally blind to all 1,089**. It also misses Easterly's two entities
(`easterly gov reit` vs `easterly government`). Duplicates measured in the live lane: Cambridge
$13.2M, Cunningham $10.6M, Gray Harbor, Procacci — plus Easterly ×2 (4 cards for one firm),
NGP ×3, Boyd Watterson ×8.

**Open for Scott:** public universities (Memphis/UNC public and in scope vs GWU/Georgetown private
and must stay); the six sponsor→domain entries (NGP→ngpv.com is $59.8M + ~$26M across 10 SPEs,
plus UIRC, HPI, JBG, FCP, TMG). **Work the lane top-down — the 10 `measured_high` cards first.**

Docs: `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`,
`docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md`, playbook **Class 13**.


## 2026-08-26 (Cowork) — R8 Stage 1 SCOPED: on-box "Analyst's Take" (Prompt 138)

Production-health arc fully closed (all 9 assists healthy; P137 provenance ladder wired). Moved to the R8
net-new build (daily-briefing prose, per Scott's pick of the safer first pilot). **Re-measure-before-build
finding:** the brief already has an "Analyst's Take — AI-generated narrative" section + a
`briefing_intel_snapshot.analyst_take` column + renderer, but the field is **EMPTY** (length 0 for
2026-08-24/25/26) — the section renders nothing. Generator = a **cloud Claude** call in the
`briefing-intel-snapshot` edge fn (`api.anthropic.com`, model `claude-sonnet-4-6`), gated on
`ANTHROPIC_API_KEY`; unset → *"skipped AI generation"* → null. **P138** builds the on-box replacement: a Node
tick (`/api/briefing-analyst-take-tick`, flag `BRIEFING_ANALYST_TAKE_ONPREM`) that assembles the PRIVATE
signals (pipeline rollup, scored priorities, deal-propagation delta, work counts, hot contacts) via the
existing `briefing-data.js` fetchers, generates a 2–4 paragraph take in Scott's voice via
`invokeOnPremGeneration` (fail-soft, never fabricate), and upserts `analyst_take` into today's snapshot row
before the ~12:30 UTC send. Doctrine: private synthesis stays on-box; public market/news sections keep their
cloud path. First net-new on-box GENERATION build (vs the annotation assists).

**P138 SHIPPED (PR #1783, commit 9614a6f) + GRADED CLEAN (Cowork, live).** Tick `/api/briefing-analyst-take-tick`,
flag `BRIEFING_ANALYST_TAKE_ONPREM` (OFF), cron 240 (10:18 UTC, no-ops while off), doc
`docs/architecture/briefing-analyst-take-onprem.md`. **Correction:** the cloud path failed on Anthropic
**BILLING** (credit balance too low), NOT a missing key — my P138 diagnosis was wrong; capital_markets is
empty for the same reason (untouched). I ran the `?generate=1` dry-run through Railway (which has OLLAMA_URL;
the sandbox does not, so CC couldn't) → **583-char, 2-paragraph take, every claim traceable to a real signal
(hot contacts Fadi Seman/Joseph Zehia, work-queue state, Archbold/Valley MOB correspondence deltas, cadence),
no fabrication.** Voice is slightly generic-assistant (tuning follow-up, not a blocker). **Gate steps
remaining (Scott):** (1) `supabase functions deploy briefing-intel-snapshot --project-ref
xengecqvemvfknjvbvrq --no-verify-jwt` (the omit-when-null guard — do BEFORE any manual snapshot re-fire);
(2) flip `BRIEFING_ANALYST_TAKE_ONPREM` on. Then the brief renders a real Analyst's Take nightly.

**R8 STAGE 1 NOW FULLY LIVE (2026-08-26).** Edge fn deployed (Scott); `BRIEFING_ANALYST_TAKE_ONPREM` flipped
ON (registry — the tick reads env-override-then-registry via `flagEnabled`, so no Railway var needed). Fired
one write: today's `briefing_intel_snapshot.analyst_take` = **774 chars, `analyst_take_meta.source =
onprem_ollama`** (proves on-box generation), grounded in real signals, no fabrication. Cron 240 fills it
nightly. The dead 3-year-empty section is now populated on-box. Only open R8 items: the voice-tightening
tuning (slightly generic tone) and Stage 2 (CM book copy).

**Two small follow-ups drafted (139, 140) + a consolidation prompt (141):**
- **P139** — interleave the clean-assist provenance lane so P137's 433 ladder-decidable cards surface ahead
  of the no-ladder `dia_xref` backlog (two incomparable rank scales sharing one budget; xref `1001` >
  field_provenance ≤1000). Low urgency (cron drains xref over ~a day).
- **P140** — grade the dormant `OWNERSHIP_CHAIN_ROLE_LABELS` Layer-2 (Ollama labels a transfer type on chain
  links, never alters them; party-presence guard). Dry-run sample → grade → flip if clean.
- **P141** — docs consolidation: slim STATUS + one current-state index + one lossless Planned/Backlog list
  (never drop a contemplated feature), archive older narratives to `docs/history/`.

## 2026-08-26 (Cowork) — P134/P135/P136 SHIPPED (assist production-health fixes); folder cleaned

All three stalled-assist prompts merged and reconciled:
- **P135 (property-twin cursor) — LIVE-VERIFIED.** PR merged + redeployed; live dry-run now reads
  `fresh:895 / remaining:895` (was `fresh:0` against 1,095 pending). The window advances; the lane drains
  toward 1,095 over nightly runs. Assert on the proposal-count delta past 200.
- **P136 (reachability target window) — MERGED, migration live.** No-evidence target marker
  (`reachability_harvest_target_marker`) so the window advances + evidence-JOIN target selection; new
  `v_lcc_reachability_harvest_target_marker_summary`. JS shipped on the redeploy. **First live POST is
  Scott's call** (it writes real proposals) — tell is `targets_with_evidence>0 / proposed>0`, then watch
  `reachability_harvest_review` climb past 16. (PR body's "73 new tests" is wrong; real 12 added, suite
  4,442→4,453.)
- **P134 (clean-assist context enrichment) — MERGED; `member_property_ids` views live on gov+dia.** Per-lane
  evidence context + `skipped_no_evidence` / `no_evidence_reasons` / `coherence_downgraded` fields + a
  decisive-at-0-confidence coherence guard. **`OLLAMA_CLEAN_ASSIST` STAYS OFF pending a re-grade:**
  `POST /api/ollama-clean-assist-tick?limit=20`, keep on only if most proposals quote real evidence and
  `uncertain` lands on genuine ties.

**Clean-assist RE-GRADE PASSED → FLIPPED ON (2026-08-26).** Enriched 20-item sample: 8/14 grounded (sf_link
4/4, incl. a `merge@0.99` on Realty Income citing the actual strict_core; owner_reconcile 4/4 grounded
abstentions), 6 correctly SKIPPED with named `no_evidence_reasons`, property_merge noise eliminated. Cleared
the Consumption-Layer bar; `OLLAMA_CLEAN_ASSIST` now `state=on` (cron 200 hourly), the 14 proposals kept in
the lane. **Follow-up DIAGNOSED → Prompt 137.** `provenance_conflict` 4/4 punt because P134 built the CONSUMER side
(`clean-assist-context.js` computes `ladder_says` from `c.current_priority`/`c.priority_ladder`) but the
PRODUCER side was never wired — `v_field_provenance_conflict_classified` has `attempted_priority` but **no
`current_priority`**, and nothing in `admin.js` joins it, so `ladder_says` is always
`unregistered_source_no_ladder_answer`. Measured: a join to `field_source_priority` on
`(target_table, field_name, current_source)` resolves **454/454** conflicts — **433 ladder-decidable**, 21
genuine ties. P137 = add `current_priority` + `priority_ladder` to the view (append) + the handler's
`select=` (the exact "diff view columns vs select" lesson). Turns ~95% of the lane from punt into a
grounded keep_current/accept_attempted.

**P137 SHIPPED (PR #1782 merged).** View columns (`current_priority`, `priority_ladder`) live on LCC Opps
now; `select=` change + tick cursor shipped on the redeploy. Data layer PROVEN (join resolves 454/454,
433 decidable). **But the live payoff is currently MASKED by a rank-scale issue (CC caveat 2):** the 65-row
`dia_xref` backlog ranks `1001` (`1000 + severity`) — ABOVE every ladder-bearing `field_provenance` row
(`_provImportance` ≤ 1000) — so the cursor drains xref first, and xref has **no ladder by design** (dia
sales-price cross-ref, correctly `uncertain`). Re-grade runs so far only reached xref rows (correctly
abstaining, one now naming the specific fields + "registered field_source_priority" = enrichment IS
reaching the model). **Ladder-bearing verification is gated on draining ~50 more xref rows** (hourly cron
200 does this over ~a day) OR a small follow-up to re-rank the xref constant so the two interleave — left as
Scott's call because `rank_value` also orders the human-facing Decision Center lane.

**Assist production-health is now GREEN across the board** — 6 were already healthy, the 2 stalled lanes are
fixed (P135 live, P136 merged), clean-assist enriched + re-graded + flipped ON. The recurring lesson, now proven
three times in one arc: a producer keyed on "already processed" needs a marker/cursor that ADVANCES, or it
silently re-checks the same residue forever while looking healthy.

**Folder cleaned (2026-08-26).** All loose prompts filed to `docs/claude-code/prompts/done/` (98 total) and
134/135/136 responses to `responses/done/` (33). **Finding: none of the loose prompts were un-sent** — the
whole backlog (18–97 waves, 119, 182, 184, 134–136) was already-shipped work never filed; git log confirms
182 (PR #1778) and 184 (`claude/prompt-184-hub-and-spoke`) merged. `prompts/` and `responses/` are now empty
of loose files.

## 2026-08-26 (Cowork) — Research page task list was DEAD (P132, SHIPPED); P133 cron; NEXT_STEP_AI ON

**Finding while walking Scott to the R1 review cards.** The Research page rendered "0 tasks" for EVERY
lane/status — the lane picker (`?view=research_lanes`) was healthy (establish_ownership_history 545 open,
answerable) but the task-fetch itself 500'd. v2 leaked the cause: PostgREST **`table name
"research_tasks_users_1" specified more than once`** — `api/queue.js` embedded `users` twice
(assignee + creator) with no distinct alias, in BOTH the v1 (`case 'research'`) and v2 (`v2GetResearch`)
branches. So the entire operator-facing research list had been unreachable — which is exactly why every
lane read "0 completions ever" (Dead-End Class 3/7: exists but can't display). The 453 P131
ownership-chain drafts were fine in `lcc_clean_assist_proposals` the whole time; they rendered onto cards
that never appeared.

**Prompt 132 — SHIPPED + LIVE-VERIFIED (2026-08-26).** Named-alias fix (`assignee:users!…` /
`creator:users!…`) in both research paths. CC's `select=` parser sweep found a **THIRD** instance of the
same bug: `getOversight` in `api/operations.js` embedded `users` twice for escalated_by/escalated_to —
worse because it's read as `escalations.data || []` with **no `.ok` check**, so the 400 silently rendered
as "no open escalations." All three aliased (`escalated_by_user:users!…` / `escalated_to_user:…`).
General-invariant guard test added (no `select=` in `api/` may embed two relations to one response key),
verified red-on-break. Full suite 4406/0/6-skip. CLAUDE.md footgun entry added. **Live check:
`GET /api/queue?view=research&status=active&research_type=establish_ownership_history` → `count=545,
items=50, err=None`** — the entire Research page (and the R1 review surface) is now reachable.

**Prompt 133 — SHIPPED + APPLIED LIVE.** pg_cron `lcc-ownership-chain-draft` (jobid **239**,
`45 6 * * *` — 06:45 UTC, not the proposed 06:50, which is `lcc-owner-deed-autofix`; 06:45 was the only
free minute in the block and lands after `generate-research-tasks` at 06:35, which mints the lane rows)
POSTs `/api/ownership-chain-draft-tick` via `lcc_cron_post` with `{"apply":true,"limit":100,
"trigger_source":"cron"}`. Verified end-to-end by firing the exact cron command: HTTP **200**,
`timed_out=false`, `open_lane_rows:545 / already_drafted:545 / fresh:0 / written_draftable:0` — the
correct quiet-night disposition, 0 rows written. Registry note updated (`OWNERSHIP_CHAIN_DRAFT` was
already `state='on'`); the cron is deliberately NOT gated on the flag. New observability
`lcc_ownership_chain_draft_run_log` + `v_lcc_ownership_chain_draft_run_health` /
`_stalled_runs` on the P123 open-before-the-work lifecycle. **DB side is live now; the run-log WRITE is
JS and ships on the next Railway redeploy of merged `main`** — until then runs are observable only via
`lcc_cron_post_log` + `net._http_response`. Reverse: `SELECT cron.unschedule('lcc-ownership-chain-draft');`

**NEXT_STEP_AI — FLIPPED ON (env already set; registry flipped by Cowork).** Inline-only (no standalone
tick) — runs inside `deal-comms-propagate-tick` / `intake-tagged-comm` / `intake-correspondence`,
deterministic-first, fails null → today's generic to-do. Zero-spend dry-run of `classifyDeterministic`
over 10 real inbound messages: **6/6 clear-intent classified correctly** (wants_call→schedule_call,
declined→log_pass, accepted→advance_to_contract, requests_docs→send_info, will_get_back→follow_up,
counter_offer→review_offer); the 4 escalations were the genuinely ambiguous ones (correctly deferred to
Ollama). `feature_flags_registry.NEXT_STEP_AI` now `state=on`.

**OLLAMA_CLEAN_ASSIST dry-run — HELD OFF (2026-08-26).** No GET dry-run mode, so generated a 12-item
**inert** sample (flag on → `POST` limit=12 → 12 proposed / 0 failed), graded it, then flipped OFF +
deleted the sample (reversible, nothing canonical touched). Grade: safe (abstains, never fabricates) but
**low-value** — 6/12 (`property_merge` + `provenance_conflict`) were content-free "insufficient evidence"
because the candidate lanes hand the model a thin `context` payload; 3/12 `owner_reconcile` correctly
abstained on initials-only pairs; 1 `sf_link` `merge` had an incoherent `0.00` confidence. Flipping it on
(hourly cron 200 exists, no-ops while off) would flood the Decision Center with uncertain noise — the
Consumption-Layer failure. **→ Prompt 134** enriches the per-lane context (real competing values) + adds
a verdict/confidence coherence guard; re-validate a sample before re-enabling. Lesson: a "just flip it"
assist can still be a noise producer — grade against the Consumption-Layer bar, not just the safety bar.

**Assist-flag sweep — the "dormant lanes to flip" plan is essentially DONE (2026-08-26).** Measured
`feature_flags_registry`: **9 of 10 assist flags are `on`** (only `OLLAMA_CLEAN_ASSIST` off, held pending
Prompt 134). So the LOCAL-MODEL-LEVERAGE-MAP §2 "flip for fast leverage" framing is stale — nothing left
to activate. The work is now PRODUCTION HEALTH, and the first check already found a silent stall:
**`PROPERTY_TWIN_ASSIST` is ON but produced 200 annotations in one run (2026-08-19) and 0 since, while
1,095 rows are pending** — the tick pulls the first-200 window, finds all 200 annotated (`fresh:0`), and
no-ops forever (never paginates to rows 201–1,095). → **Prompt 135** (query-level anti-join / keyset cursor
+ honest `remaining` count + guard). Reinforces the doctrine: assert on the produced delta, never the flag.

**Production-health pass complete (2026-08-26).** Checked all 9 ON assists by write-delta: **6 healthy** —
`ownership_chain_draft` (545, today), `junk-prescreen` / `naming-hygiene` / `dup-pair` (cursor-advancing),
`match-disambig` (1,270; 33 in 7d; caught up), `sf-link-assist` (247; 47 in 7d; caught up) — plus
`NEXT_STEP_AI` (inline). **2 stalled:** `PROPERTY_TWIN_ASSIST` (confirmed stuck → P135) and
`W9_2_REACHABILITY_HARVEST` (**16 ever / 0 in 11d** vs ~15k unreachable pool). **Diagnosed 2026-08-26
(confirmed stall, NOT exhaustion):** cron 212 fires nightly but a bounded POST shows a fixed **120-target
window** (60/domain) with `donors_found:0 / with_evidence:0` for those 120 — while the evidence pool holds
5,000 intake + 4,305 comms names + 2,042 signature phones. It re-checks the same 120 unresolvable owners
every night and never advances. → **Prompt 136** (mark no-evidence targets so the window advances + select
targets by an evidence JOIN + honest counts + guard). **Structural tell: the two stalled lanes are the only
ones without an advancing cursor/marker.**
Doc note: the SF-assist flag is `W9_3_RESCORE` in code, not `W9_3_SF_ASSIST`. Full table in
`docs/os/LOCAL-MODEL-LEVERAGE-MAP.md` §2.

**Git state (2026-08-26):** a merge of origin `2d205aff` (P132/P133) into local `main` is in progress with a
STATUS.md conflict — **markers resolved by Cowork** (kept P132 + origin's richer P133, dropped the dupe). The
`.git/index.lock` is held by the Windows-side process (`Operation not permitted` from the sandbox), so Scott
must clear the lock + finish the merge commit (see chat for the exact PowerShell).

**Net:** R1 is now genuinely reachable (P132 was the hidden gate). Manual review path for the 453 drafts:
Research page → `establish_ownership_history` lane → each card shows its drafted chain (`chainDraftHTML`)
→ open property → Ownership tab → set recorded/true owner → Save (P179 capture). Prioritize the
~73 current-owner mismatch flags.

## W6.5 Stage 2 Units 1–5 (2026-08-20, Cowork) — detail.js 18,481 → 16,203 lines, byte-identical

The highest-value W6 unit (it de-risks the Edit-truncation incidents). Five regions extracted from
`detail.js` into classic sibling scripts. **Every region sha256-verified byte-identical before/after the
move; every unit mutation-tested before commit.**

| Unit | File | Lines | Note |
|---|---|---|---|
| 1 | `detail-rent.js` | 301 | rent source-tier policy + escalation parser |
| 2 | `detail-tab-documents.js` | 238 | Documents tab — also carried the client-dossier builders it surfaces |
| 3 | `detail-panel-shell.js` | 739 | panel geometry, resizers, minimize tray, companion dock — **19 window exports** |
| 4+5 | `detail-entity-tabs.js` | 1,143 | entity tab bodies (Unit 5 = the five Unit 4 missed) |

**THE MAP WAS WRONG THREE TIMES, and each correction was load-bearing.** Its line ranges were stale for
every unit. Its `detail-entity.js` range would have swallowed the PANEL SHELL — window management, which
`detail-tab-registry.test.mjs` pins to `detail.js`. And its entity/contact ranges OVERLAPPED, because the
two clusters interleave *around* that shell — so "extract the entity tabs" was never one region-move.
**Unit 3 lifting the shell out is what made Unit 4 contiguous at all.**

**Three defects found in the machinery itself:**
1. **Stage 1 had shipped a broken test.** `_fedCardHTML` moved to `dc-lanes.js` while `_cleanAssistHTML`
   stayed in `ops.js` — fine in production's shared global scope, a ReferenceError in an isolated eval
   sandbox. Fixed, and became **recipe step 5b**: grep `test/` for the moved function BEFORE extracting.
2. **`verify:deploy` never probed a front-end file.** It checked `/version` + `/api/*` only, so a new
   script that failed to ship would 404 in the browser with the gate green. Now probes all 13 local
   `<script src>`, asserting on the BODY (the SPA catch-all can return 200 with index.html).
   `--wait[=sec]` added for the push→verify loop.
3. **Unit 4 silently left five `_entityTab*` bodies behind and no guard noticed** — the tab-registry
   guard asks whether a tab reaches a renderer that EXISTS, and it did. *"Reachable" and "in the right
   module" are different properties.* The load-order guard now asserts the second one.

Guards: **113 assertions** across `detail-tab-registry`, `frontend-module-load-order`, `panel-redesign`.
Remaining (map §2b): #6 `_entityTabOverview` + its helper cluster, #7 contact openers. The entity
dispatcher and the shared completeness-rail / Next-Step chrome stay in `detail.js` by design.

---
## P121 (2026-08-20) — the staging→Processed ordering hazard is CLOSED (Flow 6 vs the mirror)

**Migration `20260820160000_lcc_p121_staging_processed_single_owner.sql` — APPLIED LIVE to LCC Opps
(`xengecqvemvfknjvbvrq`), so the data layer is live now. The `api/sync.js` + `api/_shared/todo-completion.js`
changes ship on the next Railway redeploy of merged `main` → then run `npm run verify:deploy`.**

**Cowork reconcile-verified live 2026-08-20 (PR #1764 merged):** `staged_at` + `todo_completed_at` columns
present, `lcc_todo_completion_mark_filed` RPC live, **stranded detector = 0** (was 61), mirror worklist
drained to **0**. And the P120 backlog fully cleared through the executor — `move_outcome` now **329 moved +
15 already_out**. **✅ Both Scott-side items now DONE (2026-08-21):** (1) `main` redeployed + git-pinned
(`/version` 527d78f9b05c) — the P121 JS is live, so Flow 6 no longer asserts a move it didn't make. (2) The
Flow-6 PA flow (`LCC To Do Completion Poll`) had its `Move_email_(V2)` + `Flag_email_(V2)` actions deleted
(inside `Condition_Match`→If-yes) — the move queue is now the SINGLE owner of the mailbox move; Flow 6 only
records completion via `lcc_todo_completion_mark_filed`. Single-owner email-orchestration loop COMPLETE. **Judgment call to note:** the
61 re-queued messages all qualify via the `inbox_triaged` arm (P119's bulk-archive smell) — CC let them drain
(reversible); a one-line predicate parks them instead if preferred.

P120's own §"Known ordering hazard" went from latent to REACHABLE the moment its executor started filling the
staging folder (first placements **2026-08-20 19:42–20:15Z, 81 messages**, with 240 more still draining at
25/run × 4 runs/hr). Two consumers reacted to one event — a staged email's To Do completing — and **both keyed
on the transient `processing_log.outcome='staged'`**: Flow 6 flipped it to `filed` (stamping
`move_status='moved'` for a move it never performed), and the W7.6 mirror's worklist was gated on it. Flow 6
winning the race dropped the row off the mirror's worklist and left the message in staging forever while every
surface read `filed`/`moved`.

**The fix — a durable anchor, and one owner per transition:**

| transition | owner |
|---|---|
| Inbox → staging, Inbox → `Processed/*` | the P120 move queue |
| staging → `Processed/*` (+ unflag) | the W7.6 mailbox mirror, ONLY |
| Flow 6 (To Do completion) | **informational** — records the disposition, moves nothing |

- **`processing_log.staged_at`** — stamped by `lcc_move_queue_ack` on a GENUINE move whose destination is
  `lcc_staging_folder_name()`, never on an `already_out` ack ("the message wasn't in the Inbox" does not prove
  "it is in staging"). Backfilled from the 81 proven placements, 0 anomalies. The mirror worklist gate widens
  to `staged_at IS NOT NULL OR outcome='staged'`.
- **Flow 6 stops lying.** `markFiled` routes to `rpc/lcc_todo_completion_mark_filed` and never writes
  `move_status`/`moved_at`/`move_outcome`. Dispositions: `mirror_owns_move`, `retargeted_to_final` (never
  staged + still queued ⇒ retarget the queue row to `final_target_folder` so the move queue delivers it
  straight to Processed), `no_move_state_change`, `already_resolved`. **Both race interleavings are safe by
  construction** — an executor ack naming staging still stamps `staged_at`, so the mirror picks it up.
- **A ledger verdict predating the current placement no longer excludes a row.**

**⚠️ A SECOND, ALREADY-LIVE STRANDING CLASS FOUND WHILE GROUNDING THIS — 61 messages.** Of the 81 the executor
placed in staging, **61 were already invisible to the mirror**: they carry pre-P119 ledger rows
`parked=true` / `not_found_or_not_in_source_folder`, acked **2026-08-07..09** — days BEFORE the placement, back
when the folder really was empty and the verdict was CORRECT. The P119 retire sweep cannot catch it (it only
ever moves a row TOWARD terminal, never re-queues). Detector `v_lcc_mailbox_mirror_stranded`; reversible
re-enqueue `lcc_mailbox_mirror_requeue_stranded(dry_run default true)` + cron `lcc-mailbox-mirror-requeue`
(06:35 UTC), prior state preserved verbatim in `lcc_mailbox_reconcile_ledger.requeue_prior`.

**⚠️ AND A THIRD GAP THE GATES EXPOSED — the mirror had no closure arm Flow 6 could trigger.** The native
Flagged-email model creates no `action_items`, so **0 of 103** staged messages have any and the `todos_done`
arm is structurally dead for them; 27 still have an untriaged `inbox_item`, so `inbox_triaged` can't fire
either. Completing a To Do would have flipped the row to `filed` with **nothing** ever publishing the move.
Added arm **`todo_completed`** (`processing_log.todo_completed_at`), first in reason priority.

**Measured by state delta, not tallies:**

| | before | after |
|---|---|---|
| mirror worklist | **0** | **61** (all `staged_at`-proven; pre-P121 gate publishes 0 of them) |
| `v_lcc_mailbox_mirror_stranded` | 61 (`stale_park`) | **0** |
| ledger `parked` | 3,935 | 3,884 (−51 re-queued, tagged) |
| messages the live mirror moved OUT of staging | 0 ever | **25 within the hour** |

Synthetic gates A/B/C (self-rolling-back, **0 residue**): Flow 6 winning the race leaves the row ON the mirror
worklist (was: dropped); a never-staged row retargets and stays off the mirror; a completed To Do on an
untriaged item publishes `reason=todo_completed`. Tests: `test/todo-completion.test.mjs` 21 pass, including a
mutation-checked guard that `markFiled` cannot re-acquire a `move_status` stamp, and one asserting the SQL
`lcc_staging_folder_name()` matches the JS `STAGING_FOLDER`.

**Remaining operator step (not a blocker):** the Flow 6 PA flow still performs its own Move + Flag-clear. LCC
now publishes `move:false` / `clear_flag:false` / a `contract` note on that worklist but cannot stop a PA
action it does not own. Until that edit lands the two movers race **benignly** — the loser acks
`ErrorItemNotFound` → `already_out` → terminal success under P119. A redundant Graph call, not a stranded
message.

---
## P128 (2026-08-25) — the U3 conflict-card test asserts the CONTRACT, not the expression text

`test/w8-u3-conflict-card.test.mjs` greps `api/admin.js` for the honest-badge total. It pinned the
**literal** `out.total = (u3OpenCnt || 0) + (u3ConfCnt || 0)`, which **Prompt 89's null-guard rewrote**
to `(u3OpenCnt == null && u3ConfCnt == null) ? null : (u3OpenCnt || 0) + (u3ConfCnt || 0)`. Runtime
behaviour was correct the whole time; only the assertion was stale. Provenance: commit `1e9238e`
("Desktop Changes.") both rewrote that line and last touched the test, so it has been red since.

**Re-pinning the new literal would just rot again**, so the assertion now tests the contract. It anchors
on the `out.total =` assignment (a stable structural token), extracts the right-hand side and evaluates
it over both probes: `(3,2)→5`, `(3,0)→3`, `(3,null)→3`, `(null,2)→2`, **`(null,null)→null`** — the
honest-badge guard P89's own comment documents ("report null, NOT 0, so the lane header does not read
'1 shown · 0 workable' over a workable card"). The surviving shape check is tightened from a bare
`status=eq.conflict')` to the full `opsCnt('w8_u3_link_review?status=eq.conflict')` call.

**Mutation-tested in both directions** (a green test that cannot fail is not a measurement): reverting
`admin.js` to the pre-P89 expression fails the both-null case; dropping `u3ConfCnt` from the sum fails
the sum case. `api/admin.js` is byte-unchanged — `git diff origin/main HEAD` is exactly one file.

**⚠️ Correction — P127's STATUS said "1 pre-existing failure." The real count was 4, and is now 3.**
Measured by the pass/fail list, not the exit code: **4,363 pass / 3 fail** (was 4,372 tests / 4 fail).
P126's entry above recorded "4,283 pass / **4 fail**" and was right; P127 under-counted. So the state
delta from this round is exactly **−1 failure, the one targeted** — the suite is *not* "now clean," and
saying so would repeat the dated-claim trap the doctrine section warns about.

**The 3 that remain are pre-existing, in files this round never touched, and reproduce in isolation**
(so they are not cross-test interference). Unlike the U3 case these are **behavioural** assertions, not
stale greps — each is worth its own look, and none is in scope here:

| test | assertion failing | shape |
|---|---|---|
| `auto-scrape-listings.test.js` | "expected ±3y lower bound in URL" — the query issues `sale_date=gte.<listing_date>&lte.<+3y>`, i.e. no `−3y` lower bound; handler 502s | test and code disagree on whether the window is ±3y or on/after listing_date |
| `folder-feed-enrich-mode.test.mjs` | "disambiguation decision emitted" `false !== true` — enrich + no match creates nothing AND emits nothing | a producer that should route ambiguity to a review lane appears not to |
| `ollama-clean-assist.test.mjs` | "clean-assist worker must not call `properties?`" `true !== false` | a guardrail (assist annotates, never writes canonical data) is currently violated |

The third is the one to look at first — it is the P106-class invariant that the assist layer **annotates
and never writes canonical data**, and the guard is red.

> **⚠️ Superseded — all three "shape" readings in the table above were wrong, and the errors ran the same
> way each time: the assertion text was read as a description of the code.** P129 found #3 was a drifted
> block-grep, not a P106 breach. P130 found #1's 502 was the test's own assertion thrown inside the
> handler's `try/catch` (the −3y bound it demands is what the June-2026 backdating fix deliberately
> REMOVED), and #2's producer does route ambiguity to the review lane — it correctly declines only the
> ZERO-candidate card, per the Prompt 91 producer guard. **All four were stale tests; zero were code
> defects.** See the P130 entry.

**Close-out:** test-only; no runtime code, no migration, nothing waits on a redeploy. Branch
`claude/fix-conflict-card-test-grep-sm7lav`.

---
## P130 (2026-08-26) — the last two suite failures: BOTH stale tests, suite is 4,367 / 0

Verdict per failure, each measured independently before any edit. **Neither was a code defect; no handler
byte changed** (`git status` = exactly the two test files). The prompt's prior on #1 — "a 502 smells like a
real handler defect, start here" — was wrong, and the way it was wrong is the reusable lesson.

### 1. `auto-scrape-listings.test.js` — the 502 was the TEST's own assertion, thrown inside the handler

**Classification: stale test, superseded intent.** The failing assertion was
`assert.ok(target.includes('sale_date=gte.2023-01-1'), 'expected ±3y lower bound in URL')` — raised inside
the test's `global.fetch` stub. `handleAutoScrapeListings` wraps each listing in `try/catch`, so the stub's
`AssertionError` landed in `summary.errors` as `{stage:'process'}`, and the handler's own status rule
(`totalErrs > 0 && 0 successes → 502`) returned 502. **The 502 was manufactured by the assertion it was
reporting** — a self-inflicted error, not an independent defect. Read the error message inside the JSON
body before treating an HTTP status from a stubbed handler as evidence.

The `−3y` lower bound the test demanded is exactly what was REMOVED to fix the **June-2026 dia off_market
backdating incident**: it matched a pre-listing sale (a prior owner's deal), and the RPC then stamped
`off_market_date` = run date, collapsing years of exits into one month. `api/admin.js:12383-12394` carries
the full incident comment. The window is now floored at the listing's **market-entry date**
(`on_market_date`, fallback `listing_date`) with the 3y recency headroom kept on the upper bound only.
Making that test green by "fixing" the handler would have re-shipped the incident.

**Fix (test-only):** re-anchored on the entry-floored window, and turned into a real regression guard —
it now asserts the lower bound IS the market-entry date, adds an explicit
`assert.ok(!/sale_date=gte\.202[0-3]/…)` so the pre-entry bound cannot come back, and gives the fixture an
`on_market_date` distinct from `listing_date` so the test proves the floor reads market-entry while the
closest-sale distance still measures from `listing_date`. The out-of-window `sale_id:'old'` (2024-12-01)
fixture row was dropped — PostgREST would never return it under the real filter, so keeping it made the
stub lie about the DB. **Proved non-vacuous by mutation:** re-introducing `entryMs − windowDays` in the
handler turns the test red (7/8) with `expected market-entry lower bound in URL: …gte.2023-01-15`;
`api/admin.js` restored byte-identical afterwards.

### 2. `folder-feed-enrich-mode.test.mjs` — asserting the pre-Prompt-91 intent

**Classification: stale test, superseded intent.** `assert.equal(res.emitted_disambiguation, true)` failed
because `emitMatchDisambiguation` (`api/_handlers/intake-matcher.js:672`) carries an explicit **Prompt 91
producer guard**: zero candidates → `{emitted:false, skipped:'empty_candidates'}`, no `lcc_open_decision`.
A card with no candidates asks a human to "pick one of nothing" — unworkable by construction, and it still
inflates the lane badge (honest-counts violation). The test's `UNMATCHED` fixture carries no `candidates`,
so it drove exactly the branch P91 exists to suppress. The promoter already reads the returned `{emitted}`
so `emitted_disambiguation` stays honest — the flag was right; the assertion was a round behind.

This is **not** an intentionally-unbuilt path, so no `it.skip` was warranted, and inventing an emit to
satisfy the test would have been fabrication against this repo's own Consumption-Layer doctrine.

**Fix (test-only):** the single `it()` now pins BOTH branches of the P91 contract — zero candidates →
`emitted_disambiguation === false` **and** `lcc_open_decision` NOT called (guarding P91 against
regression), then a second arm with two real candidates → `emitted_disambiguation === true`,
`lcc_open_decision` called, candidates carried onto `p_context`, and still nothing created. Folded into
one `it()` deliberately so the suite total stays 4,373 and "no other test moved" is checkable by count.

### Verification (by the pass/fail LIST, not the exit code)

`npm test` → **tests 4373 · pass 4367 · fail 0 · skipped 6 · todo 0**. Baseline was 4,365 pass / 2 fail /
6 skip = the same 4,373 total, so no test was added, removed, or skipped. All 6 skips are pre-existing and
unrelated (1 chart-spec, 5 RCA parsers gated on a local file path); **zero `it.skip` was added this round**
— green means green. The two target files: 11 tests, 11 pass, 0 skip.

**Close-out:** test-only. No runtime code, no migration, nothing waits on a Railway redeploy. This closes
the test-hygiene segment (P126 → P128 → P129 → P130); **next item is key rotation.**

**Durable lesson for the arc tally — the stale-vs-real score is now 4 stale, 1 real.** P126 `</table>`,
P128 U3 `out.total`, P129 drifted block boundary, and now BOTH of P130's. Every one of them looked like a
code defect from the assertion text, and P130's #1 wore an HTTP 502 on top. **Classify before you fix, and
when a red test names an intent, go read whether that intent was deliberately superseded** — in both P130
cases the superseding commit had left a full explanatory comment sitting directly above the code.

---
## P126 (2026-08-25) — draft-assist appends Scott's real branded signature; the draft is send-ready

Closes the P125 v6 follow-up ("no signature block"). The generated draft ended at the model's sign-off
("…Thanks.") with no name/title/company/phone, so Scott hand-added his block on every save.

**Two variants, selected the way he actually signs** (`api/_shared/email-signature.js`):
`in_reply_to != ''` ⇒ **`docs/os/voice/signatures/signature-reply.html`** (compact, self-contained, no logo);
`in_reply_to == ''` ⇒ **`signature-full.html`** (service line, D/E/A rows, address, service-line tagline,
northmarq.com). Ambiguous ⇒ the reply block (it asserts strictly less). The variant is chosen from the SAME
`inReplyTo` const handed to the flow, so the block can never disagree with the shape of the draft created.

**⚠️ The prompt named two repo files that do not exist in the repo or on any remote branch** — that
extraction lived in a local Cowork session and was never pushed (checked every `refs/remotes/*`). Rather than
block, both blocks were re-extracted **verbatim from the same authoritative source an `.eml` extraction reads**:
Scott's own top-posted HTML in LCC Opps `email_bodies.body_html`. Nothing was transcribed from a doc.

**⚠️ And the docs would have been wrong.** `docs/os/skills/offer-submission-SKILL.md` + the offer-submission
design doc describe ONE block carrying the Tulsa address. Measured over his **592** signature-bearing sent
messages of the last 120 days, the top-posted **reply** block carries the street address **0 times** and the
service line in 9% — the address belongs to the **new-email** block and otherwise appears only inside quoted
history. Following the docs would have stamped an address on every reply his real replies do not carry. The
docs' *"service-line tagline"* placeholder also never resolved to a literal anywhere in the repo; the real
string is **"Commercial Real Estate | Debt + Equity | Investment Sales | Loan Servicing | Fund Management"**,
now captured rather than invented. (Another instance of the dated-doc trap in the CLAUDE.md doctrine section.)

**The `cid:` logo is deliberately absent.** His full block opens with `<img src="cid:2d92bd11-…" width="84"
height="75">` (4,221 bytes — the 4.2 KB `northmarq-logo.png`), a reference to an attachment part of *that*
message. A generated draft has no such part, so it would render broken on every send. Per the prompt's stated
fallback the `<img>` is stripped and the styled text kept. To restore it, host the PNG at a stable public
`https://` URL (a `data:` URI is not a substitute — Outlook desktop blocks them); note that also turns every
send into a read receipt for the recipient, so it is Scott's call, not a default.

**Doctrine held.** Never fabricate AND never re-type — both blocks are stored assets, and there is NO runtime
path that parses a signature out of sent mail (the corpus carries a Stan Johnson era block and a Team Briggs
block; parsing at request time would silently pick a stale title). Nothing configured ⇒ append NOTHING and
report `signature.status = "not_configured"`, never a guess. **Never double-sign** — detection reuses the
corpus cleaner's `SIGNATURE_ANCHORS` rather than forking a second "what a signature looks like" (the
normaliser drift CLAUDE.md warns about), and fails CONSERVATIVE: a false positive skips the append (the
pre-P126 status quo), a false negative would ship a doubly-signed draft. **Above the quote by construction** —
the flow composes `concat(body_html, <createReply quote>)`, so end-of-our-html IS above the quote; a test pins
that order. And the appended block cannot poison the voice corpus: `cleanEmailBody` cuts it with the same
anchors used to detect it (tested).

**One refactor worth noting:** `body_html` is now built ONCE, before the dry-run response, instead of only
inside the save branch. The GET used to describe a body no code had rendered, so the signature would have been
verifiable only by actually saving; now `draft.body_html` on the dry run is byte-identical to what a save
posts. `test/draft-assist.test.mjs`'s P124 assertion was updated to the hoisted shape (same property guarded).

Files: `api/_shared/email-signature.js` (new), `docs/os/voice/signatures/signature-{reply,full}.html` (new),
`api/draft-assist.js`, `test/draft-assist-signature.test.mjs` (new, 28 tests). Full suite 4,283 pass / 4 fail —
the 4 are **pre-existing** (verified on a clean tree: `auto-scrape-listings`, `folder-feed-enrich-mode`,
`ollama-clean-assist`, `w8-u3-conflict-card`). Ships on the Railway redeploy of merged `main` →
`npm run verify:deploy`. **Open for Scott: confirm both blocks before they are the default** (below), and
decide the logo question.

---
## P127 (2026-08-25) — the signature loader sanitizes; a dirty asset can no longer reach a draft

The durable half of the P126 catch below. The assets are clean today (reply **857 B**, full **1,253 B** — both
verified below with a parser, not a regex); the point of this round is that "the bytes happen to be clean" was
the *only* thing between a recipient and someone else's mail, and that is not a control.

**New `api/_shared/html-sanitize.js`** — a **tokenizing** sanitizer, deliberately not a regex strip. It walks
the markup with a tokenizer that respects quoted attribute values and raw-text elements, then rebuilds from an
**allowlist** of tags and attributes: `script`/`style`/`iframe`/`form`/`svg`/… dropped with their content,
`img`/`link`/`meta`/`input` dropped outright, every `on*=` handler refused (an allowlist is the only defence
that holds — a denylist misses `onauxclick`), any non-`http(s)`/`mailto:`/`tel:` URL dropped (so `cid:`,
`javascript:`, `data:` all go), `url(`/`@import`/`expression(` styles dropped, unknown tags **unwrapped** so a
strange wrapper can't take the block with it, and the tag stack rebalanced. `loadSignatureHtml` routes **every**
source through it — both env overrides included; there is no trusted branch — as does `appendSignature`'s
caller-supplied override.

- **It reuses the corpus cleaner's boundary sets, it does not fork them.** `QUOTE_BOUNDARY_TAGS` /
  `REPLY_MARKERS` / `MIN_LEAD_CHARS` come from `voice-corpus-clean.js::_internals` — the same definitions that
  cut a quoted chain off an exemplar. A private copy is the normaliser drift CLAUDE.md warns about: the loader
  would eventually pass through something the cleaner calls a quote. A test greps for a local copy and fails on
  one. (It also resets `lastIndex` on that shared `/g` regex — a stateful `.test()` would make whoever ran
  second skip a boundary.)
- **`MIN_LEAD_CHARS` earns its keep here for the same reason it exists there.** Outlook writes an EMPTY
  `<div id=appendonsend>` on a freshly composed message; cutting at a boundary that sits before any real text
  would delete the whole signature, so a leading sentinel is **unwrapped**, not treated as a cut.
- **It degrades toward LESS signature, never a leak.** Over the 8 KB ceiling after cleaning, or nothing left
  but removable content, or unparseable ⇒ `html: null` ⇒ `signature.status = "not_configured"` ⇒ **nothing is
  appended** and the note says why. A dirty asset costs a hand-typed signature; a leaked one costs a recipient
  seeing someone else's mail. Nothing is truncated mid-tag.
- **Removal is observable — the P126 failure was that it wasn't.** The dry run now carries
  `signature.sanitized_removed` + `sanitize_rejected`, and the loader warns once per source on stderr.
  **`sanitized_removed: []` is the only healthy value.** It also reports what sat *below* a cut
  (`below-cut:img`): a cut subsumes what it discards, so without that the warning for the exact P126 asset
  would have read `["quoted-thread"]` and never mentioned the four tracking pixels that were the whole story.

**The leak is tested directly, not by proxy.** `test/draft-assist-signature-sanitize.test.mjs` (56 tests)
rebuilds the exact shape P126 shipped — the real block, then the LinkedIn notification email with its pixels,
its `cid:` logo and the Outlook quote header — feeds it through `appendSignature` (the real call path) and
asserts the body handed to the flow carries no `<img>`, no `linkedin`, no `cid:`, no quoted header, and still
carries name/title/phone/email. It also pins the evasions a regex strip misses (`<IMG\n SRC=…>`,
`<img/src=…>`, an unclosed `<script>`, a `>` inside a quoted attribute).

**Both committed assets are re-verified with the tokenizer, not a regex:** every tag balanced and closed, no
`img`/`script`/`style`/`link`/`iframe`/`svg`/`meta`/`form`, every URL pointing only at `mailto:`/`tel:`/
northmarq.com, no `on*` attribute, no LinkedIn/`From:`/`Sent:`/`wrote:` residue in the text, the exact contact
facts present (address + tagline on FULL only, absent from REPLY), each fact appearing exactly once, and each
asset sanitizing to itself with **zero** removals — i.e. the sanitizer is a net here, not a crutch.

**One pre-existing P126 test was failing against the merged bytes and is fixed:** it asserted the body ends
with `</table>`, but the assets are div-based — precisely the "tests ran against a different copy than shipped"
gap. It now compares against the block the loader actually resolves.

**Close-out:** ships on the Railway redeploy of merged `main` → `npm run verify:deploy`. Until then the safety
still rests on the assets being clean (they are).

## P128 (2026-08-24) — stale w8-u3 test fixed; ⚠️ suite is NOT clean (3 real failures remain)

Reviewed + reconciled. PR #1771 merged (d9f5370). The `w8-u3-conflict-card` test now asserts the *contract*
(u3 total = null when both counts null, else the sum — the honest-badge guard) instead of a source-grep P89
broke; mutation-verified both ways, `api/admin.js` byte-unchanged.

**⚠️ Correction — the "lone remaining failure" premise (mine, inherited from P127) was WRONG.** Measured off
the pass/fail LIST, not the exit code: **4,363 pass / 3 fail** (was 4,372 / 4; P128 fixed exactly the U3 one).
**P126 was right at "4 fail"; P127's "1 pre-existing" undercounted, and prompt 128 inherited it.** The suite is
NOT clean. The 3 remaining are **pre-existing, behavioural (not stale greps), reproduce in isolation, in files
this session never touched:**
- **`ollama-clean-assist.test.mjs`** — "clean-assist worker must NOT call `properties?`" is RED → the P106-class
  invariant (assist layer ANNOTATES, never writes/reads canonical). → **P129 DONE (PR #1772, dbde27b,
  test-only): verdict = (B) DRIFTED BLOCK-GREP, NOT a breach.** The `ollama-clean-assist` worker is
  annotation-only as designed (P106 intact); the test's extracted block had drifted into an adjacent `admin.js`
  handler that legitimately calls `properties?`. Re-anchored the test; suite **4,365/2**. This was the THIRD
  slice-a-source-region stale test in one arc (P126 `</table>`, P128 U3, P129) — durable footgun line added to
  `CLAUDE.md` (§W6.5 Step 5b corollary). **2 behavioural failures remain** (`auto-scrape-listings` — scrape URL
  missing −3y bound, handler 502s; `folder-feed-enrich-mode` — enrich+no-match emits no disambiguation) — real
  gaps, separate follow-ups → **P130 DONE (PR #1773, test-only): BOTH were STALE tests asserting SUPERSEDED
  intent, ZERO code defects.** (1) `auto-scrape-listings` — the 502 was self-inflicted (the test's own fetch
  stub threw an assert that the handler caught → errors>0 → 502); the −3y bound it demanded is EXACTLY what was
  removed to fix the **June-2026 dia off_market backdating incident** (`api/admin.js:12383` comment) — "fixing"
  the handler would have re-shipped it. Re-anchored on the `on_market_date` market-entry floor + a guard so the
  pre-entry bound can't return; mutation-proved. (2) `folder-feed-enrich-mode` — asserting PRE-P91 intent; P91's
  producer guard suppresses a zero-candidate disambiguation card (asking a human to pick nothing + inflating the
  badge = Consumption-Layer failure). Re-anchored to pin both arms of the P91 contract. **Suite now GREEN:
  4,373 tests · 4,367 pass · 0 fail · 6 pre-existing skips.** ✅ **TEST-HYGIENE SEGMENT CLOSED.**
  **Arc tally: 4 stale tests, 1 real defect** — every one looked like a code defect from the assertion text
  alone; in each case the superseding commit had left a full explanatory comment directly above the code, and
  reading it WAS the diagnosis. (CC corrected the P128-era table, which had read all 3 by assertion text —
  all 3 readings were wrong; historical entry left with a superseded-note.)
- `auto-scrape-listings.test.js` — URL missing the −3y lower bound; handler 502s.
- `folder-feed-enrich-mode.test.mjs` — enrich + no-match emits no disambiguation decision.
  → **BOTH CLOSED by P130 (test-only). Suite 4,365/2 → 4,367/0.** Verdict on both: **STALE TEST asserting a
  SUPERSEDED intent** — neither handler is defective, and the P130 prompt's framing ("a 502 smells like a real
  handler defect") did not survive measurement. See the P130 entry below.

CC left all three (P128 was scoped test-only) and offered to take the ollama-clean-assist one next. **Doctrine
reminder this whole P126→128 run reinforced: read the pass/fail LIST, never `node --test`'s exit code** (it
returned 0 over real failures three times this arc).

## Capstone 2026-08-24 — draft-assist arc COMPLETE + live; next-up = security/hygiene

The full email arc shipped this session and is live (redeploy confirmed by Scott): **intake fixed → forward
capture + contact-history flows → voice v3 → deal-grounded, recipient-matched, full-body retrieval → threaded
Outlook reply → branded signature → load-time sanitizer.** draft-assist end to end: real thread → correct deal
→ Scott's voice → threaded draft with signature, in Drafts, never sent. Prompt **128** queued (fixes the lone
stale test so the suite reads truly green — test-only). Also shipped this session: P118 cron fixes, P119 mailbox
mirror, P120 move-queue executor, P122 CM packet cursor, P123 deal-matcher, health surface 3,987 → ~24.

**⏭ Recommended next step — SECURITY/HYGIENE, not a feature:**
1. **Rotate `LCC_API_KEY`. — DEFERRED 2026-08-24 (Scott's call):** hold until the app is a workable version in
   regular use with users beyond Scott; the naive swap breaks ~10 live PA flows + Vault + Railway under
   `LCC_ENV=production`, so do it as the deliberate multi-user-onboarding task (preferably via the dual-key
   `LCC_API_KEY_PREVIOUS` approach for zero downtime). Exposure meanwhile is a private repo + this chat, not
   public. Original note: It's now genuinely exposed — pasted in chat curl/IRM commands repeatedly this
   session AND embedded in the committed PA flow export zips (`private/power-automate/exports/…`). Rotate per
   `docs/AUTH_ENFORCEMENT_ROLLOUT.md`; verify readiness FIRST via `GET /api/diag?kind=auth-ready`
   (`would_pass_in_production` must be true); **never flip `LCC_ENV` before the key is set** (that = total
   sign-in lockout, per CLAUDE.md). After rotating, update the key in every PA flow + Railway + Supabase Vault
   (`lcc_api_key`) that carries it.
2. **Commit the session's doc/prompt work** — 12 uncommitted working-tree files (STATUS, prompts 122–128,
   signature assets). All engine PRs (#1760–1770) already merged to origin; these Cowork docs are the residue.
3. Older standing items still open: the 475 MB `.pst` history rewrite (unblocks local `git push`), CF token
   rotations, W6.5 Stage 2 frontend decomposition, U4 first-of-month report, the parked Online Archive backfill
   (needs a Purview export from IT).

## P127 (2026-08-24) — signature load-time sanitizer shipped (the durable fix)

Reviewed + reconciled. PR #1770 merged (local `ea561ca3`). `loadSignatureHtml` now sanitizes every signature
before use: strips `<img>`/`<script>`/`<style>`/handlers + anything past an Outlook quote boundary
(`appendonsend`/`divRplyFwdMsg`/`From:`), bounds size (>8 KB after cleaning ⇒ `not_configured`, nothing
appended), and surfaces removals (`signature.sanitized_removed` / `sanitize_rejected` + a once-per-source
stderr warning). **59 new tests replay the exact P126 dirty bytes through the real `appendSignature` path and
assert no `<img>`/`linkedin`/`cid:`/quoted-header survives while name/title/phone/email do.** Both committed
assets re-verified clean with an HTML tokenizer — **857 B (reply) / 1,253 B (full)**, image-free, mailto/tel/
northmarq.com only, exact facts once (Tulsa address on FULL only). Ships on the Railway redeploy; assets are
clean now regardless, so the sanitizer is defense-in-depth.

**⚠️ Honest-measurement note (CC self-corrected — worth keeping):** CC first reported "full suite green / exit
0," then retracted it — `node --test` returned 0 *despite* a failing test, and its grep watched for a `# fail`
marker the dot reporter never emits. Both "green" signals were measurement artifacts, not measurements —
exactly the repo doctrine "assert on the STATE DELTA, never the worker's exit status." The real state (CORRECTED
by P128 — this "1" was itself an undercount; it was actually **4 fail**, matching P126): the U3 case was
`test/w8-u3-conflict-card.test.mjs` — a stale source-grep that Prompt 89's null-guard
invalidated (it greps `api/admin.js` for a line P89 rewrote), fails identically on HEAD~1, untouched by P127.
Same class as the `</table>` stale assertion CC fixed in the P126 signature test. **Optional one-line follow-up**
to fix that grep (CC offered); not blocking (CI here only runs the boot check).

## P126 (2026-08-24) — signature append shipped; ⚠️ Cowork caught DIRTY runtime assets (fixed) → prompt 127

Reviewed + reconciled. PR #1769 merged (local `57329e58`). CC built the context-aware signature append
(`api/_shared/email-signature.js`: reply vs full variant, conservative already-signed detection reusing the
corpus `SIGNATURE_ANCHORS`, `body_html` now rendered once so the dry-run equals the save, 28 tests). It also
correctly stripped the `cid:` logo (a `cid:` ref renders broken in a generated draft, and a hosted remote image
would turn every send into a read-receipt) and corrected a real offer-submission doc error (the Tulsa address
lives in the FULL block only — 0 of 592 recent reply blocks carry it).

**⚠️ Cowork catch — the committed signature ASSETS draft-assist reads at runtime were DIRTY.**
`docs/os/voice/signatures/signature-reply.html` merged at **12.7 KB carrying a LinkedIn notification email + 4
tracking-pixel `<img>`s + a broken `cid:` logo** below the real signature; `signature-full.html` similar.
`loadSignatureHtml` only strips HTML comments, so `appendSignature` would have stapled a LinkedIn email +
tracking pixels onto **every reply** — invisible in the JSON, visible only on open. CC's tests passed because
they ran against its trimmed branch copies, not the bytes that actually merged (add/add conflict resolution
kept the un-trimmed side). **Fix:** Cowork replaced both with clean, balanced, branded hand-authored HTML
(final committed sizes **857 B reply / 1,253 B full** — an earlier note said 1.7/5.1 KB, that was the messy
regex draft, superseded; 0 `<img>`, 0 LinkedIn/quote leak, phone+email+address+tagline intact, Futura-PT /
Northmarq-blue). **Durable fix → prompt 127:** add a load-time sanitizer to `loadSignatureHtml` (strip
img/script/style/handlers + anything past a quote boundary; assert size) so a dirty asset can never leak again,
+ a test that feeds the exact P126 dirty bytes and asserts they're neutralized. **Uncommitted:** the two cleaned
asset files (Scott commits). Live signature verify still needs the redeploy + a save.

## P125 (2026-08-21) — draft-assist retrieval + threading + deal-context, all six items fixed

Reviewed + reconciled. **#1768 merged, local main at `6b33e7e7`, `/version`=`6b33e7e75f06` — the JS half is LIVE.**
CC found the root causes deeper than the prompt framed:
- **"Full-body" was a length heuristic wrong about 62% of Scott's mail.** `FULL_BODY_MIN_CHARS=300` inferred
  provenance from size; measured over 777 body_html rows, median cleaned prose is **160 chars** (his voice is
  "short and punchy"), so 438 genuine full bodies were mislabeled "preview-era." Now provenance is carried from
  WHICH body column at load, not re-derived by length.
- **corpus_size 395**: `loadCorpus` paged the newest 3,000 of the whole 28,090-row store then filtered to Scott
  in JS → only 565 of his 1,188 seen. Author filter pushed into PostgREST.
- **Recipient-blind ranker**: the embedding ranker accepted `recipientEmail` and ignored it (so Susan's 55
  backfilled emails changed nothing); deterministic weighted recipient below bucket. Now full-body + exact-
  recipient are a hard PARTITION, not score terms; `cc` now read (3 of Susan's 55 are cc-only).
- **Deal context never attempted** (item 6): facts loaded only `if(entityId)`; now reads the hourly
  deal-matcher's verdict, thread-scoped — Susan's thread resolves to *DaVita Dialysis – The Villages – FL*,
  stage non_refundable.
- **Threading (item 5): 3 flow defects fixed** — double Response on both branches, `toRecipients` PATCHed onto
  a reply, unguarded empty `$filter`; every response now echoes `threaded`+`conversationId` (the seam couldn't
  distinguish a threaded reply from a fresh draft before). Flow def reconciled to the tenant (Graph passthrough,
  `$authentication`, ContentType). **⏭ threading UNPROVEN until re-import** — Cowork re-packaged as
  `LCC-CreateOutlookDraft-import-v5.zip`; `outlook_draft.threaded` reads `null` until then.
- Tests 47→76; suite 4,258 (4 pre-existing failures). PR #1768.

**✅ VERIFIED LIVE 2026-08-21 (2nd real save, after v5 re-import):** all six upgrades confirmed in one response —
`corpus_size` **773** (full_bodies 517), **full_body_exemplars 5 / preview_only 0 / recipient_matched 5**,
`voice_confidence` now "5 FULL past email bodies … SHORT by choice, not truncated," `facts.source
=deal_spine_via_deal_match_thread` (entity 17218fd0…, DaVita–The Villages), `fact_validation.clean=true`,
deal-aware subject, and **`outlook_draft.threaded=true`** (v5 re-import took). Draft saved, Sent untouched.
Minor observability nit: `conversation_matches_thread` came back blank (the flow echoes `threaded` but not
`conversationId` for the seam to compare) — cosmetic, not functional; optional tiny follow-up.

**v6 (Cowork flow re-package, 2026-08-21) — threading fully proven + quote preserved.** The first threaded
draft had correct headers (In-Reply-To + full References + Thread-Index) but read as bare because
`Set_reply_body` PATCH *replaced* the body, wiping the createReply-seeded quote. Fixed: PATCH now prepends
`body_html` ABOVE `body('Create_draft_reply')?['body']?['content']` (repo `flow-lcc-create-outlook-draft.json`
updated + re-packaged `LCC-CreateOutlookDraft-import-v6.zip`). Post-re-import save: **`threaded=true`,
`conversation_id` populated, `conversation_matches_thread=true`** — threading definitively confirmed via the
seam. ⏭ **Open follow-up: no signature block** — draft-assist emits a sign-off but not Scott's Northmarq
signature; the draft isn't send-ready. Drafted **prompt 126** (append canonical signature, sourced
conservatively, above the quote, never fabricated). Quote-preservation (v6) to be eyeballed on the newest draft.

## 🎉 2026-08-21 — draft-assist is LIVE end-to-end: the app drafted an email in Scott's voice, in Outlook

First real save succeeded through the whole chain: captured history → v3 voice profile → `/api/draft-assist?save=true`
→ the imported `LCC Create Outlook Draft` PA flow → **a draft in Outlook Drafts**, to the right contact
(Susan Holdsworth), **Sent empty** (save-not-send held). `saved:true`, real `draft_id` + `web_link`, no error.
The PA flow was hand-packaged by Cowork from the bare definition (PA import needs a package .zip, not a bare
Logic App def): three import blockers fixed in sequence — (1) declare `$authentication` + add the auth ref to
every OpenApiConnection action; (2) `CreateDraftMessageV3` isn't in this tenant → converted to a Graph
`POST /me/messages` passthrough (draft, never sends); (3) every `HttpRequest` with a Body needs
`ContentType: application/json` or Graph 400s "Empty Content-Type provided". Final gotcha: the flow was toggled
OFF — a disabled flow's HTTP trigger returns 400/502.

**Two refinements from the live save → folded into prompt 125:** the draft came out as a FRESH email, not a
threaded reply (createReply/seam `in_reply_to` path), and it lacked deal context (`facts.source=no_entity_relational`).
Plus the retrieval-grounding gap already in 125 (drafting from 5 preview openings, not the 55 full-body Susan
emails now in the corpus). 125 now covers all three.

---

---

