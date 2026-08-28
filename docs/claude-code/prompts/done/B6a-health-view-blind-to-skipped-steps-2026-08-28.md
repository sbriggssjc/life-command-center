# B6a — a SKIPPED step emits nothing, and the health view is built on emitted rows

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6a`.
**Repo:** primarily **government-lease** (`pipeline_runner.py`, `v_pipeline_task_health`).
**Playbook:** `DEAD_END_AUDIT_PLAYBOOK.md` **Class 21**.
**Contract:** `docs/architecture/data-coherence-invariants.md` **I4**.

---

## 0. Why this is first

B6 swept 19 owner/lessee-change signals and found the real gaps were not acquisition gaps. **Four
ingestion producers have been dead since March–April 2026 — behind an all-green health view.**

The mechanism: `pipeline_runner` guards the GSA diff on a local folder that is **always empty on
CI**. The guard task logs **"Task completed"**, the guarded `run_task` is **never invoked**, so it
**writes no `run_log` row**, and therefore **has no row in `v_pipeline_task_health`** — which is
computed over emitted rows.

> **A FAILED step is a red row. A SKIPPED step is NO row.**
> A health surface built on emitted rows cannot distinguish *skipped* from *never scheduled* from
> *healthy and quiet*. All three render identically: absence.

**gov §16 built `v_pipeline_task_health` precisely to stop green from masking a failed step. It
closed the failure case and left the skip case open** — and the skip case is the one that then hid
four producers for five months. **A guard that covers one of two cases reads, on the surface, exactly
like a guard that covers both.**

**B6a fixes the blindness. It does NOT restart the producers — that is B6b.** Order matters: restart
them first and you cannot tell whether they stay up, because the instrument that would tell you is
the broken thing.

---

## 1. What to build

**A producer's health must be computed against what was EXPECTED, not against what was observed.**

1. **A registry of expected producers and their cadence.** Enumerate every scheduled ingestion task
   (gov + dia + LCC crons and `pipeline_runner` tasks) with an expected frequency. **Check first
   whether one already exists** — `feature_flags_registry` is the precedent for making "off"
   visible, and there may already be a task table. ⚠️ **Do not build a second registry beside an
   existing one**; extend it.
2. **A SKIP is a first-class outcome with a reason.** Emit the run row **at the guard site**, before
   the guard decides. ⚠️ **Adding a `skipped` status to the run-log schema changes nothing on its
   own** — if the runner still returns early without writing, the row never exists. **The fix is at
   the emission point, not the vocabulary.** Follow P123: **open the row before the work, close it
   after** — a row stuck at `started` is the signature of a run that died mid-flight.
3. **A health view over EXPECTED vs OBSERVED**, so silence is loud. `last_success_at` older than N
   expected cadences ⇒ a deduped `lcc_health_alerts` row that auto-resolves on the next success.

---

## 2. ⚠️ Rules

**2a. Positive-control the detector, or you have rebuilt the original bug.** A surface that
*would* show a silent producer but has never been seen doing so is a claim, not a detector.
**Deliberately silence one task and prove the view goes red**, then restore. This whole class exists
because a view nobody stress-tested read green for five months (P182: point every detector at a
known positive before trusting its zero).

**2b. A legitimate skip must be declarable, or the surface becomes the noise it replaces.** Some
tasks *should* skip — a domain with no such source, a flag deliberately off, a weekly task on a
daily runner. **A skip with a declared reason is healthy; an undeclared skip is the finding.** If
every skip alerts, the surface trains the operator to ignore it, which is the Consumption-Layer
failure at the scale of a health view.

**2c. Read the four dead producers' history before you model the schema** — what they emitted when
healthy is what the registry must be able to express. Do not design against the two you find first.

**2d. Report `producers_silent_vs_expected`, never `runs_observed`.** A runs-observed count is a
re-discovery tally that reads exactly like throughput (P159a). And **a green board on day one is
suspicious** — reconcile it against the four known-dead producers, which must all read RED.

**2e. Do not "fix" a producer you find dead along the way.** Name it, size it, leave it. B6b/B6c
own the restarts, and mixing a repair into an instrument change makes it impossible to tell which
one moved the number.

**2f. This is `pipeline_runner` — Python, in government-lease.** ⚠️ **Every network call must carry
its own `timeout=`** (SIGALRM does not bound a blocked C-level socket read). And note the CI-empty
local folder is the *trigger*, not the bug: the bug is returning without emitting.

---

## 3. Verification

- **The four known-dead producers read RED** on the new surface. That is the acceptance test.
- **The detector has been seen RED on a deliberate silence and green after** (§2a).
- **A declared skip does not alert; an undeclared one does** — both verified on named tasks.
- **Nothing was restarted in this prompt** — producer state is unchanged; only visibility moved.
- **Guards mutation-verified RED**, comments stripped before matching (a migration/PR header that
  quotes the broken pattern will otherwise satisfy a naive grep — the A5c/N18 defect).

---

## 4. Deliverable

`docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`, folded into
`docs/architecture/data-coherence-invariants.md` **I4** (updating its detector-status table — it
currently reads *"exists but blind to skips"*), the gov repo's own CLAUDE.md §16 (whose stated
purpose this completes), a backlog update, and a STATUS entry.

**If a registry already exists and the honest fix is three lines at the guard site, say so and
stop.** A small correct change beats a new subsystem — and two of B6's seven ranked gaps already
ended in *don't build*.
