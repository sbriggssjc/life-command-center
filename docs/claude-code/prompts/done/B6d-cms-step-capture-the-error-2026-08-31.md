# B6d-cms-step — the error channel has never worked, and a "reason" that says nothing

**Window:** data-process & automation audit (lettered prompts).
**Backlog rows:** `B6d-cms-step` **+ `B6d-pri-reason`** (bundled — same file, same class).
**Repo:** **Dialysis** (`src/run_cms_ingestion.py`, the pending-updates drain).
**DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**.

---

## 0. Why these two are one prompt

Both are the same defect wearing different clothes: **a field that exists to carry meaning, written
with nothing in it.** One drops the error text; the other writes `unknown_reason`. **Fixing one and
not the other would leave the lesson half-learned.**

---

## 1. 🚨 `error_summary` is NULL on **47 of 47** runs since 2026-06-01

Measured on `ingestion_tracker`, all statuses, 2026-06-01 → today:

| run_status | runs | `error_summary` NULL | never finished |
|---|---:|---:|---:|
| `abandoned` | 24 | **24** | 0 |
| `failed` | **10** | **10** | 0 |
| `success` | 6 | 6 | 0 |
| `recorded` | 3 | 3 | 3 |
| `started` | 2 | 2 | **2** |
| `partial` | 2 | 2 | 0 |
| **total** | **47** | **47** | 5 |

**This is not one run missing its error. The column has never been written — not once, in three
months, across ten explicit failures.** ⚠️ **So "capture the exception on the `medicare_ingestion`
step" understates it: the error CHANNEL has never worked.**

**What we do know** comes from the instrumentation B6d-pri added, and it works: the 2026-08-31 run
(18:30:26 → 18:38:16, `failed`) carries
`notes: {"current_step": "medicare_ingestion", "heartbeat_at": "…18:38:14"}`. **We know WHERE it
dies and have never once known WHY.**

⚠️ **And two rows from that same session remain `started` with `finished_at` NULL — the orphan shape
re-forming**, which is what the lock-reclaim later relabels `abandoned`.

## 2. ⚠️ Six runs reported `success` while the data did not move

`success` × 6, newest **2026-07-30** — yet `max(medicare_clinics.source_last_seen)` is **2026-06-25**
and **0 clinics have been refreshed since**. **A run can report success without advancing the
clinical data**, which is the honest-count failure this audit arc keeps finding.

**Establish what those six actually did** (`rows_fetched` / `rows_upserted`), and **if `success` can
be returned on a no-op, that is a third defect** — say so and treat it as one.

## 3. `B6d-pri-reason` — the placeholder that satisfied the constraint

**437 rows created 2026-08-31 carry `reason = 'unknown_reason'`** (first and last seen that day, so
entirely the new fix's output). `B6d-pri` §2 asked for a real reason and said *not a placeholder*.

⚠️ **The same table already demonstrates the standard**, which is why this is fixable rather than a
judgement call:

| existing reason | rows |
|---|---:|
| `public_record_ai_no_yield` | 1,893 |
| *"Salesforce auto-created property — verify accuracy and check for duplicates"* | 65 |
| *"unmatched property_id during financial propagation"* | 1 |

- **Derive the reason from the branch that creates the row.** The writer knows why it is queuing —
  that knowledge is being discarded at the last step.
- **Backfill the 437**, or mark them so an operator can tell them apart from real ones.
- ⚠️ **In operator terms the current state is a REGRESSION**: before, these writes failed loudly
  (~500 errors/run); now they succeed silently and **437 unactionable rows sit in a human triage
  queue.** **A loud failure is more useful than a quiet placeholder.**

---

## 4. ⚠️ Rules

**4a. Do not paper the error channel with a generic string.** `str(e)` alone is barely better than
NULL for a step that wraps many calls. **Record the exception type, the message, and the step** —
and if a traceback is available, its last frame. **The test is whether the next reader can act
without re-running anything.**

**4b. A terminal status must be reachable.** `started` with `finished_at` NULL on 2 of the last runs
means the process dies before it can close its own row. **P123: open the row before the work, close
it after — and a crash must still leave a terminal state**, which usually means a `finally` or an
outer handler, not a wider try.

**4c. ⚠️ Do NOT widen a `try` to make the error appear.** Swallowing more to log more is how
`properties._new_property` silently read as *"no change"* for 65 rows — B6d-pri found that the
swallowed 42703 was a **data** defect, not a log defect. **Catch, record, and re-raise or fail the
step.**

**4d. `success` must mean the data moved.** If §2 shows it can be returned on a no-op, tie it to
`rows_upserted > 0` or introduce a distinct outcome. **Do not leave two different facts sharing one
status value** — that is the `filtered_multi_tenant` lesson (Class 26) in a different table.

**4e. This prompt does NOT fix the underlying hang.** Its job is to make the next failure legible.
⚠️ **Expect the run to still fail afterwards — that is success for this change**, and the error text
it produces is what the actual repair will be built on.

**4f. Python, in the Dialysis repo** — every network call carries its own `timeout=`. **SIGALRM is
not sufficient** (`CLAUDE.md`: *it does not bound a blocked C-level socket read*), and the
2026-06-23 hangguard proposed exactly that.

## 5. Verification

- **A deliberately-failed step writes a non-NULL `error_summary`** naming the exception type and
  message — **demonstrated, not asserted.**
- **A killed run still reaches a terminal status** (no `started` + `finished_at` NULL).
- **`pending_updates` writes carry a derived reason**; `unknown_reason` count stops growing and the
  437 are backfilled or marked.
- **`success` is reconciled with `rows_upserted`** — and if the six July successes were no-ops, that
  is reported.
- ⚠️ **`max(medicare_clinics.source_last_seen)` is NOT expected to move** — this change makes the
  failure legible, it does not repair it. **Report the error text you captured; that is the
  deliverable.**
- Guards mutation-verified RED, comments stripped before matching.

## 6. Deliverable

`docs/audits/B6d_cms_step_ERROR_CHANNEL_2026-08-31.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (`B6d-cms-step`, `B6d-pri-reason`, and a new row for whatever the
captured error turns out to be), the Dialysis `CLAUDE.md` if a durable footgun appears, and a STATUS
entry.

⚠️ **The single most valuable line in the writeup will be the actual exception text from
`medicare_ingestion`.** Everything else here is plumbing so that line can exist. **If you capture it,
paste it verbatim** — two months of silence have been about not having it.
