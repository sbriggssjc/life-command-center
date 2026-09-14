# The build-turn protocol — definition of done for EVERY change

**Created 2026-08-28** from Scott's standing requirement:

> *"Incorporate this repository clean and self-improvement process — documentation, plans, designs,
> next steps — at every turn of every build we make on the LCC app or its components or processes,
> so we have one cohesive building system that's always up to date with the latest information,
> history, architecture and plans, so the latest chat can always pick a topic up fresh with the
> latest information."*

> 📍 **This is the definition of done. A change is not finished when the code works — it is finished
> when the next session can pick the topic up cold and be right.**
> Applies to every build, audit, migration, prompt and fix, in every repo (LCC, government-lease,
> Dialysis), by any surface (Claude Code, Cowork, the app-audit window).

---

## 0. Why this exists — the cost of skipping it, measured

Every item below was **found by accident** in a single week, each after months of silence, and each
because a previous turn shipped correct code without closing the loop:

| skipped step | what it cost |
|---|---|
| open intent never filed | **25 planned items** existed in no backlog — one an entire unexecuted Supabase 3→1 consolidation plan. Archiving would have destroyed them silently. |
| stale claim never bannered | a design doc reading *"Status: not executed"* about a cutover that **shipped three months earlier**; a runbook step that would now **import a stale snapshot over the authoritative hub**. |
| verification asserted, not run | `record_skip` reported as fixed on the strength of **registry** rows; the emission path had never once executed. |
| a detector never positive-controlled | a freshness monitor that **evaluated nothing for 33 days with 0 alerts open** — it went quiet at the exact moment it went blind. |
| parallel windows not reconciled | two honest measurements of one population **disagreed 10×**, and the later one recommended reverting a build that had already shipped. |

**None of these produced an error.** That is the point: the failure mode that matters looks exactly
like success, so *closing the loop is the only thing that catches it.*

---

## 1. The eight steps

### ① MEASURE before concluding — and enumerate every table that could carry the fact

A conclusion of *"the data isn't there"* or *"we must acquire it"* is **the most expensive available**
and earns the highest burden of proof. Check the tables **not** named after the answer.
*(Cost of skipping: gov had never consumed its own sales table — 9,514 named sellers, 1.8% consumed.)*

### ② VERIFY on the state delta, never on a tally, a status, or a flag

Never `succeeded`, never `already_*`, never "the cron is active". **Ask what the worker EMITS when it
succeeds and finds nothing** — if that is a negative marker, *that* is the delta.
**Positive-control every zero**: point the detector at a known positive before believing it.

### ③ DEPLOY-CHECK before diagnosing

`/version` + `git merge-base --is-ancestor <fix-sha> <deployed-sha>`. **Never parse a handler
response** — `/api/*` is auth-enforced, so a probe returns `401` and a grep of that body reads as
*"the field is absent."* A DB migration ships instantly; the JS that reads it does not.

### ④ RECONCILE against parallel work

The other window may have measured this, fixed this, or be mid-flight on it. ***Merged is not
running*** has a mirror: ***in flight is not unbuilt.*** **When two honest measurements disagree,
find the measurement that does not depend on the disputed key** rather than adjudicating keys.

### ⑤ UPDATE the canonical docs in the SAME change

Not a follow-up. The living pages, whichever the topic touches:

| topic | canonical page |
|---|---|
| what is LIVE / flagged-off / planned | `docs/os/CURRENT-STATE.md` |
| everything unbuilt-but-intended | `docs/os/PLANNED-BACKLOG.md` |
| how sources connect, and must | `docs/architecture/data-coherence-invariants.md` |
| route-level connectivity | `docs/architecture/connectivity-and-open-threads.md` |
| durable invariants & footguns | `CLAUDE.md` (+ the domain repo's own) |
| repeatable defect classes | `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` |
| the running worklog | `docs/claude-code/STATUS.md` |
| where anything is filed | `docs/os/DOCUMENTATION-MAP.md` |

**A dated audit is EVIDENCE and stays.** A living page is STATE and gets corrected.

### ⑥ CORRECT what is now false — in place, never silently

Supersede with a banner that names the old claim, the new truth, and the measurement. **Retain the
durable half.** ⚠️ **Correct your OWN wrong calls just as loudly** — a repo whose errors are quietly
deleted teaches the next session to trust things it shouldn't.

### ⑦ EXTRACT before you archive — the gate that cannot be skipped

Before any file moves: **read it**, pull every unbuilt/deferred/"next step" item, grep
`PLANNED-BACKLOG.md`, and **file what is missing FIRST**. Then check inbound references
(path-anchored ones break, bare names don't). **Distinguish ARCHIVE from RELOCATE — archiving live
reference material is the more expensive mistake.** Full procedure: `DOCUMENTATION-MAP.md` §6z.

### ⑧ LEAVE THE NEXT STEP NAMED

A recommendation with its size, its blockers and its sequencing — including *"do not build this"*
where that is the answer. **Update `NEW-CHAT-KICKOFF.md` if the live thread moved.**

---

## 2. The closing checklist

Every prompt ends with it; every turn answers it.

- [ ] **State delta measured** — before/after, on the population that must move, not a tally
- [ ] **Zeros positive-controlled** — the detector has been seen firing
- [ ] **Deploy state established** — `/version` + merge-base, not a handler probe
- [ ] **Parallel work reconciled** — nothing here contradicts the other window unmeasured
- [ ] **Canonical pages updated** — CURRENT-STATE / BACKLOG / the topic's living doc
- [ ] **Stale claims bannered in place**, mine included
- [ ] **Open intent filed** before anything was archived or closed
- [ ] **Next step named**, with size and sequencing
- [ ] **STATUS entry written** — what moved, what it cost, what was learned
- [ ] **Guards mutation-verified RED**, comments stripped before matching

---

## 3. ⚠️ The three that get skipped, and why

**"I'll update the docs after."** There is no after — the context that made the correction obvious is
gone by the next turn. **The doc update is part of the change, not a chore that follows it.**

**"It's obviously fine, no need to measure."** Every entry in §0 was obviously fine. The four-day-old
"clean bill of health" that the deed-acquisition conclusion rested on was obviously fine, and one
join disproved it.

**"The archive is just old files."** It contained 25 planned features. **Nothing errors when you
delete intent.**

---

## 4. What this is NOT

Not ceremony, and not a reason to inflate a small change. A one-line fix needs a one-line STATUS
entry and nothing else. **The test is a question, not a word count:**

> **Can the next session pick this topic up cold, from the canonical pages alone, and be right?**

If yes, the turn is done. If it would have to re-derive what you just learned, re-measure what you
just measured, or trust a page that is now false — it is not.
