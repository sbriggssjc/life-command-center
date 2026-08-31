# LCC — Fresh Chat Kickoff (paste this to start a new Cowork context window)

*Regenerated 2026-08-26 (evening). Copy everything below the line into a new chat.*

> **Maintenance rule:** this file goes stale faster than anything else in the repo — it is a
> snapshot of "what's in flight," and in-flight things land. **Rewrite it at the end of any
> session that closes or opens a prompt.** The last version claimed 139/140/141 were still to be
> sent and that the Analyst's Take was flag-off; all four claims were wrong within a day.

---

You're helping Scott Briggs run **Life Command Center (LCC)** — a CRE business-development platform
(Northmarq / Team Briggs; dialysis + government net-lease). The connected folder is
`C:\Users\scott\life-command-center`.

**Read these first, in order, before doing anything (don't rebuild from scratch):**

1. `~/.claude/CLAUDE.md` (global) + the project `CLAUDE.md` — architecture invariants, DB topology,
   and the durable footguns. The footgun list is the most valuable thing in the repo; read it.
2. **`docs/os/CURRENT-STATE.md`** — the one-page "where are we": LIVE / flag-gated OFF and **why** /
   the live flag snapshot / the assist production-health table / the canonical-doc map.
3. **`docs/os/PLANNED-BACKLOG.md`** — the one ranked list of everything unbuilt-but-intended, every
   row citing its source. **Read it before proposing anything** — it is probably already there,
   possibly already measured and refuted.
4. `docs/claude-code/STATUS.md` — the running reconcile log, newest first. It is a *log*, not the
   state; pre-2026-08-13 entries are archived under `docs/history/`.

Then, only if the task touches them: `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md` (surfaces /
comps / deploy map) and `docs/os/LOCAL-MODEL-{LEVERAGE-MAP,GAP-AUDIT}.md` (where the on-prem model
is live/dormant, and the ranked gaps with their refuted premises).

**⛔ Before you hand Scott any git commands, read
[`docs/os/GITHUB-WORKFLOW.md`](../os/GITHUB-WORKFLOW.md).** `main` is protected — **branch → PR →
both checks green → merge.** A direct push to `main` is rejected outright and retrying never
works. **And [`docs/os/DOCUMENTATION-MAP.md`](../os/DOCUMENTATION-MAP.md) says where every
artifact is filed** — the repo root is code and config, never a new `.md`.

**Standing workflow:** Scott pastes Cowork-drafted prompts to Claude Code (CC), then pastes CC's
responses (as .docx) into `docs/claude-code/responses/`. Cowork reviews each against **live**
Supabase data, reconciles, updates STATUS + the affected docs, verifies migrations/flags live,
grades dry-run samples before flipping flags, and files finished prompts → `prompts/done/` and
responses → `responses/done/`. **Git: never run git from the sandbox** — the `.git/index.lock` is
held by Scott's Windows process; hand Scott the PowerShell (remove lock → add → commit →
pull --rebase → push).

**Standing doctrine (non-negotiable):** never fabricate (render "Not on file" / "Derived" /
"Conflict"); every assist is annotation/draft-only, reversible, human-confirmed; **assert on the
produced state-delta, never on `state=on` or a worker's own tally**; re-measure any dated blocker
before quoting it; private corpora (voice, deal correspondence, LOIs, comps) NEVER egress to a
cloud model — the on-prem Ollama box is the path for those. Use `AskUserQuestion` + a task list
for multi-step work.

**Live infra:** Railway `https://tranquil-delight-production-633f.up.railway.app` (JS ships on a
redeploy of merged `main`; **a deploy of engine code = redeploy BOTH** tranquil-delight and the
standalone MCP). Supabase: LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`,
Government `scknotsqkcheojiaewwh`.

---

## ⭐ The live thread if you are the DATA-PROCESS window (2026-08-28)

**The ownership-history lane is BUILT, WORKING and CLOSED as a source of chain depth.**
A1→B1a: completions **0 → 1,302**, gov `any_history` **1,272 → 2,238**, facts **12,724 → 14,076**,
`human_actionable` **flat at 55** throughout. **`chain_2plus` is 178** and B1a proved the remaining
blocked residue is worth **12 more** — 99 of 132 open tasks carry ONE link. **Do not go looking for
another blocker in this lane.**

**The live finding is Class 20 — sources we hold that nothing consumes.** gov has **never**
consumed its own `sales_transactions` as ownership history (**9,514 named sellers, 1.8% consumed,
3,080 net-new rows / 2,114 properties**) while dia derives **2,207 of its 2,757** historical facts
from exactly that source. Two more: **`gsa_lease_change_facts`** (336,303 rows; landlord change on
**38,213 / 8,845 leases**, 2013→2026) and **`property_sale_events`** (**5,208 rows whose
`ownership_history_id` and `sales_transaction_id` are populated on ZERO rows**).

- ✅ **B5 SHIPPED** — gov `ownership_history` **16,177 → 18,953** (+2,776 / 2,000 properties, **677
  with no prior history at all**); transitions view 4,698 → **5,555** properties.
- ✅ **B6 AUDITED** — 19 signals swept; ranked gaps **B6a–B6g**; two of seven end in *don't build*.
- ✅ **Deploy verified live 2026-08-28** — `/version` = `e3a0407d25bc`, and `385023cf`
  (`runB5RedraftPass`) is an ancestor. **The first conversion night is 2026-08-29, 06:45 → 06:49
  UTC.** **Baseline to measure the delta against** (post-B5, pre-conversion): facts **14,076** ·
  lane **1,302 completed / 579 open** · gov `chain_2plus` **178** · `any_history` **2,238** ·
  `human_actionable` **55**. Read `b5_redraft` / `written_draftable` / `facts_inserted`, **never**
  `already_drafted` or `links_already_present`. ⚠️ **Expect coverage to move far harder than depth**
  (B1: +901 vs +28) — that is the population, not a shortfall.
- ✅ **B6a SHIPPED** — gov producer registry + declared skips; the four producers dead since
  March–April 2026 read **RED** (170/170/150/144d vs a 45-day SLA); detector **seen red on a
  deliberate silence**. ⚠️ `record_skip` **not yet exercised by a real run** — the RED rows prove the
  registry, not the emission.
- ✅ **B6a-follow-up SHIPPED** — the alert chain is alive. gov **13 → 18 feeds** (the transport fix
  restored five that had been failing silently), both domains synced **today**, and **6 real
  `feed_stale` alerts** are open after 33 days of zero. **The transport was two different causes**
  (gov cold-start timeout, dia missing grant). Invariant **I11** now has a standing detector.
> 👤 **If Scott asks "what needs me?" → [`docs/os/OPERATOR-ACTIONS.md`](../os/OPERATOR-ACTIONS.md).**
> Three of the highest-value items in the system are blocked on him, not on a build: **rotate the
> committed `LCC_API_KEY` (SEC2)**, **pull the Railway logs for the live CMS outage
> (B6d-cms-restart)**, and **re-issue `SAM_API_KEY` (B6d-sam)**.
>
> ## 📍 STATE AS OF 2026-08-29 — the B-series is CLOSED. Read this block, not the B6b line below.
>
> **`B6b` ✅ shipped** (change layer live, self-healing on the Monday sync, both alerts auto-resolved).
> **`B6c` ✅ answered** (keep the table, retire the columns). **`B6c-dup` ✅ shipped** —
> `sales_transactions` is the canonical comps spine, `property_sale_events` is a capture surface that
> now propagates into it. **`B6b-lead` 🛑 graded and DELIBERATELY NOT RESTARTED.**
>
> ⚠️ **Three findings from that arc that will mislead you if you inherit the old numbers:**
> **(1)** `prospect_leads` `ownership_change` is **NOT** *"2,041 worked / 208 pushed to Salesforce"* —
> those are an **automated filter** and a **matched existing contact**; `sf_lead_id` is non-null on
> **0 of 7,729**. **The lane has no human consumer** (Class 26).
> **(2)** The `property_sale_events` orphan count is **ZERO**, after three wrong answers
> (330 → 9 → 6). The exact-date anti-join was the wrong key — `sale_date` is **month-truncated**
> for its dominant source (Class 25).
> **(3)** `changed_fields` on `gsa_lease_events` is a jsonb **STRING** on 86% of rows, so
> `changed_fields ? 'key'` returns a plausible **0** against a true **16,907** (Class 11).
>
> **Open `feed_stale` alerts are now a DECISION list, not a build list** — see the recommendation in
> `STATUS.md`. **Root `.md` is 70 → 10; five topic cleanup passes recovered 62 items that existed in
> no tracker** (P14 · P14b · P14c · P14d · P14e), plus **SEC2–SEC4**.

- ~~⭐ **NEXT — `B6b`: restart the four dead producers.**~~ ✅ **DONE — see the block above.** They are now visible AND alertable, which is
  the precondition B6a-follow-up existed to create. The alerts name them:
  `gsa_lease_change_facts` **170d** (the 336k-row landlord-change source), `gsa_lease_timeline` 170d,
  `prospect_leads_ownership_change` 150d, `property_sale_events` 144d.
- **Two residuals, both named, neither closed:** `record_skip` has **still not been exercised by a
  real run** (the RED rows prove the registry, not the emission); and gov's **cold-cache timeout is
  mitigated by retry, not cured** (`B6a-follow-up-b`).
- **Then:** **P0d / D1–D2** (the standing coherence detectors).
- 🔁 **Every turn now closes the loop — [`docs/os/BUILD-TURN-PROTOCOL.md`](../os/BUILD-TURN-PROTOCOL.md),
  `CLAUDE.md` Rule 00.** Read it before starting: it is the definition of done, and its eight steps
  are each earned by a measured failure from this week.
- **Read:** 🏛️ **`docs/architecture/data-coherence-invariants.md`** (the standing contract — I1–I10
  + new-database onboarding) · `ownership-history-lane.md` §3a/§3c ·
  `BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` §3b/§3c · `connectivity-and-open-threads.md` §4j ·
  playbook **Class 20 / Class 21**.
- ⛔ **`B6_…md` §6 is SUPERSEDED** — do not act on its `~270–370` resizing of B5 or revert it.

⚠️ **Four traps already paid for on this thread — do not repeat them.**
**(3)** **Connecting a new source runs code paths that have never seen that shape of row.** B5's
first insert exercised a propagation trigger that **nulled real recorded owners** — 7,567 rows
already damaged, 1,446 of 9,312 about to be. **Snapshot and positive-control both directions before
any batch that writes a new row shape.**
**(4)** **The two windows measured one population and disagreed by 10×, with neither erroring.**
B6 §6 advised *"resize before building"* about a build that had already shipped. **When two honest
measurements disagree, find the measurement independent of the disputed key** — here, *did this
property have any history before?* (677 did not). ***Merged is not running* has a mirror: *in flight
is not unbuilt*.**
**(1)** *"We must acquire the data"* was written into the audit as §3b on the strength of gov's thin
deed layer (876 grantor-bearing records of 5,804), and refuted one query later. **Acquisition is the
most expensive conclusion available; enumerate every table that could carry the fact first.**
**(2)** `lcc_entity_portfolio_facts` has **no creation timestamp** and the nightly re-upsert touches
**11,828 of 14,076 rows daily**, so **every source reads "written today."** Never date a feeder off
`updated_at` on an upserted table.

## Where things actually stand (measured 2026-08-26 evening)

**Scott is actively working the Tier 0 owner-contact lane** — 27 confirms logged today, lane
**109 → 93 open** (84 `ask` / 9 `auto`; re-measured 2026-08-27 16:30 UTC after P197 and the three
P198 owner merges — Easterly is now ONE card at $114.9M instead of four). That is the
highest-value operator surface in the system and it is draining. His track and the build track do
not block each other.
📍 **Anything Tier 0 → read [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md) FIRST.**
It is the one door into twelve rounds: live state, the objects, **seven decisions already made that
must not be re-litigated**, and **ten traps already paid for** (three of them were made twice).
*(That −22 is three effects mixed: Scott's confirms, P193's SPE inheritance removing cards, and
P191 restoring some. Don't quote it as a confirm rate.)*

**The local-model arc is essentially complete.** 30 flags `on`, 27 `off`, 2 `partial`. The on-box
daily-brief **Analyst's Take produces** (`source = onprem_ollama`). Clean-assist, ownership-chain
drafts, sf-link, junk pre-screen, naming hygiene, dup-pairs, match-disambig, next-step: all healthy.

**⭐ The biggest thing that happened in this arc: a dead research lane got a working consumer.**
`establish_ownership_history` sat at **545 open / 0 completed for 69 days** while 545 finished,
record-cited drafts sat unused. It is now **1,237 completed / 644 open** (A1→A2→A2a→A2b→A3→A4→A4b→B1),
with `lcc_entity_portfolio_facts` at **14,010**, and every remaining item named and routed rather
than pooled.

**The goal metric — a connected ownership history back to the developer — moved:** gov properties
with **any** ownership history **1,272 → 2,173**; with a **chain (2+ historical links) 149 → 177**.
⚠️ **`any_history` moved 7× harder than `chain_2plus`, and that is the POPULATION, not a
shortfall** — only 210 of the 1,501 below-floor properties carry ≥2 guard-passing transitions.
**The binding constraint on chain DEPTH is now the A2-blocked `ambiguous_entity` residue**
(126 links / 123 properties — the A2a duplicate-entity class, which applies unaided once merged),
**not the value floor.**

⚠️ **And the operator's badge did NOT move — `human_actionable` is 55, before and after B1.** That
is the design: **89% of the newly-drafted population routes to automation.** A value gate belongs
on what reaches a human, not on what a cron applies. **The whole subsystem is one document —
[`docs/architecture/ownership-history-lane.md`](../architecture/ownership-history-lane.md)** — read
that, not the seven dated audits behind it. Its sibling for entity identity is
`docs/architecture/tier0-owner-contact-system.md`; **the two share `lcc_merge_entity`,
`lcc_owner_sponsor_domain` and the owner entities**, so a merge confirmed in one changes the other.

**The method that produced it, which is the transferable part:** split a lane into the *distinct
jobs* it is actually asking, give each its own consumer, and **measure before building** — five
plausible hypotheses were refuted by one query each along the way (A2b↔A3 shared population, the
`gsa_lease_diff` flicker twice, the oscillating-pair guard, and a `sponsor_token` key that would
have asserted false ownership facts).

**✅ All three post-deploy verifications closed 2026-08-27 — V1, V2, V7/V9.** They were never
broken; their fixes had landed after a deploy cutoff. Property-twin resumed (200 → 240),
reachability is healthy, and the on-box Analyst's Take produces (`LCC_DEFAULT_WORKSPACE_ID` was
missing → HTTP 400). **Kept here only for the lesson, which recurs:**

> ⚠️ **The reachability check in this file used to read *"`reachability_harvest_review` passes 4"*.
> That criterion is WRONG and would report a false failure on a healthy lane.** P136's design emits
> a **negative marker** (`reachability_harvest_target_marker` — *checked, and empty*), so targets
> with no evidence **correctly produce no proposal**; the proposal count is the one metric that
> reads zero while the fix works. **Before writing any verification, ask what the worker emits when
> it succeeds and finds nothing.** Likewise a `pg_net` `timed_out: true` at 60,000 ms is **not**
> failure — `lcc_cron_post` stops listening while the handler runs on.

**Open and cheap — "verify," not "build":**

1. **⏳ One unattended run still unproven: the Analyst's Take on cron 240** (10:18 UTC weekdays,
   `generated_at` **inside** that window). It has been triggered manually and works; **a manual
   trigger proves the config, not the schedule** — which was V7's entire lesson.
2. **`OWNERSHIP_CHAIN_ROLE_LABELS` is built, merged (#1788), deployed, and still ungraded.** The
   endpoint is now live: `GET /api/ownership-chain-draft-tick?role_labels=1&generate=1` (ungated,
   write-free). Read `summary.providers` **first** — a cloud-fallback sample is not a grade of the
   on-box layer the flag turns on — then `chains_altered_by_layer2` must be **0**. → backlog N2.
3. **The `briefing-intel-snapshot` edge fn must carry `if (row.analyst_take == null) delete
   row.analyst_take;`** or a manual re-fire upserts NULL over the on-box take. → backlog V4.

**Two structural findings from 2026-08-26 that change how you read everything else:**

- ~~**CI RUNS NO TESTS.**~~ ✅ **FIXED 2026-08-27 — `npm test` is now a REQUIRED status check** and
  the gate has been green on `main`. **`main` is protected: you cannot push to it.** Branch → PR →
  both checks green → merge, and **expect a third step** ("Update branch") whenever `main` moves,
  which with two audit windows is most of the time. **Read
  [`docs/os/GITHUB-WORKFLOW.md`](../os/GITHUB-WORKFLOW.md) before handing Scott any git commands** —
  it is written from five PRs' worth of real failures, including three stale-base branches and two
  conflict resolutions that kept both sides (one of which made a workflow file *unrunnable*, so the
  required check never reported at all).
- **⚠️ `staged_intake_extractions` is not one population.** Three channels with different *input
  types* feed it, and the sidebar channel — **56% of rows, 0 hardened-schema extractions out of
  350** — has never run the Prompt-61 prompt. Any unsplit coverage number measures the channel
  **mix**, not the prompt. This reverts the W5.3 "validated" verdict to *unproven* (not refuted).
  → `docs/audits/W53_INTAKE_CHANNEL_PROVENANCE_2026-08-26.md`, backlog **N8 / L8 / V6**.

## ⚠️ Two audit windows run in parallel — establish which one you are before doing anything

| | **App audit** (desktop) | **Data-process & automation audit** |
|---|---|---|
| Scope | LCC the application — defects, lanes, surfaces, code | our data processes end to end + where AI/automation raises productivity |
| Owns | prompts **189 / 192 / 194**; backlog N3a–N3c, AC1b–AC10, N8/N8a | the W5.3 / Ollama-hygiene lineage; backlog **L1–L10, N4–N7, V6** |

**A *finding* about a data process belongs to the automation thread even when its *code fix*
belongs to the app thread.** The W5.3 sidebar discovery is the worked example. **Ask Scott which
window you are in if it is not obvious from his first message.**

**⚠️ Prompt-numbering convention (both windows draft prompts concurrently — they must not collide):**
the **app** window keeps the **numeric** series (189, 192, 194, 195…); the **automation** window
uses **letters matching its backlog rows** (A1, A2, A3…). Name the file for its row.

**Live prompt queue — three files in `docs/claude-code/prompts/`, all owned by the APP audit:**

| # | What | State |
|---|---|---|
| **189** | **Duplicate owner entities — the top build priority.** Step 1 shipped (`v_lcc_merge_candidates_normalizer_blind`: **121 groups / 300 entities / $136.5M** invisible to the normalizer). Remaining: the wording-difference blind spot (Easterly ×2) and the merge pass. **This is costing Scott operator time right now** — "NGP Capital" is five entities asking the same question. | 🔴 |
| **192** | Tier 0 auto-attach sweep + the living loop. Triage shipped (255 → 109 cards). Remaining: attach the `exact` single-candidate cards **through the existing JS verdict path** (never a new SQL writer that skips the shape gates), un-park signals, learning from `lcc_tier0_confirm_log`. **Auto-attach on `exact` ONLY** — the next tier down proposes *JP Morgan CMBS Trust → jpmorgan.com*. | 🟡 |
| **194** | Trace the sidebar-channel extraction bypass with runtime evidence (+ optionally the CI test workflow). | 🔴 new |

**Next net-new build after those:** R8 Stage 2 — capital-markets book copy on-box (higher-stakes,
client-facing; the same pattern as the brief's Analyst's Take).

Start by reading the four docs above, confirm the current state still matches (**re-measure; this
file is a snapshot**), then ask Scott what to pick up.
