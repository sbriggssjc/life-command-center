# B6e-fred — green in CI, dead since birth, and the sweep was the bigger finding

**Date:** 2026-09-01 · **Backlog:** `B6e-fred` · **Repo:** Dialysis · **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**
**Found by:** `v_dia_producer_health`'s first honest run (B6d-cms-escalation)

---

## 0. Headline

Three findings, in ascending order of importance:

1. **The FRED workflow has never written a row** — not "stopped writing 25 days ago". The 2026-08-07
   "recovery" was a hand-run.
2. **The fix was already merged before this session started** (`e0ec3fc`, 2026-09-01 12:53 UTC) and
   **has still never executed.** Merged is not running.
3. 🚨 **The `| tee`-without-`pipefail` shape is a CLASS, and a second live instance was found** in
   `public-record-ingest-daily.yml`. Per the brief, that outranks the FRED fix — and the reason it
   survived is the sharper lesson: **a guard for this exact defect already existed and was scoped to
   the one file the previous audit happened to be looking at.**

---

## 1. The measurement

| check | value |
|---|---|
| `economic_indicators` rows / distinct series | 8,316 / 5 (incl. `DGS10`) |
| max `observation_date` | **2026-08-06** |
| max `created_at` | **2026-08-07 19:59:41 UTC** |
| rows created since 2026-08-10 | **0** |
| observations after 2026-08-07 | **0** |
| scheduled runs 2026-08-10 → 08-31 | **16, all green** |

### ⚠️ "Dead for 25 days" understates it — it has never worked

The brief and the B6d note both read the 2026-08-07 write as the producer's last success. It was not
this producer at all. Grouped by minute, `economic_indicators` has exactly **one** write event ever:

| minute | rows | series |
|---|---:|---|
| 2026-08-07 19:59 | 86 | CPIAUCSL, DGS10, FEDFUNDS, MORTGAGE30US, UNRATE |

The two workflow runs that day finished at **19:47:34** and **19:55:20**. The write landed at
**19:59:41** — after both. Runs #1 and #2 that day failed *visibly*; #3 and #4 went green and wrote
nothing. **The workflow was added on 2026-08-07 to fix a silent stall and has been silently stalled
from its first green run.** Whatever wrote those 86 rows was a hand-run, and it is the only reason
the table is not empty from May.

---

## 2. Mechanism — two defects that compound

**a. The module dies at import.** Any `src.*` import runs `src/__init__.py` → `utils_shared` →
`match_utils` → `gpt_usage_logger` → `from postgrest.exceptions import APIError`. **Reproduced live
in this sandbox** while setting up the guard run: installing `requests`/`python-dotenv`/`numpy` was
not enough, and the traceback was byte-for-byte the documented one —
`ModuleNotFoundError: No module named 'postgrest'`. Not one line of ingest code runs.

**b. `| tee` throws the exit code away.** In bash a pipeline's status is its **last** command unless
`set -o pipefail` is set. GitHub's **default** shell for a `run:` step on Linux is `bash -e {0}` —
**with no pipefail** — so `python -m src.ingest_fred_to_dialysis … | tee fred_run.log` returns
*tee's* zero.

**The two compound in a specific way worth naming:** the script's own honest guard
`sys.exit(0 if result["total_written"] > 0 else 1)` was **defeated twice over** — it never ran (a),
and its exit code would have been discarded anyway (b). A script can be written correctly and still
be unable to report failure.

### ⚠️ A third, quieter defect: the watchdog already knew and only warned

The workflow's freshness step called `dia_check_fred_staleness` and, on `{"status": "stale"}`,
printed `::warning::` and passed. **Every one of the 16 green runs printed that.** The signal was
produced, rendered, and discarded. `e0ec3fc` made it `exit 1`.

---

## 3. 🚨 The sweep — the class, not the instance

Every `run:` step in every Dialysis workflow, checked for a pipeline:

| workflow | piped step | pipefail in that step? | verdict |
|---|---|---|---|
| `fred-ingest-daily.yml` | `python -m src.ingest_fred_to_dialysis … \| tee` | ✅ (added `e0ec3fc`) | fixed, **never executed** |
| `public-record-ingest-daily.yml` | `bash scripts/cron/public-record-ingest.sh 2>&1 \| tee` | ❌ **none** | 🔴 **FIXED THIS ROUND** |
| `salesforce-object-sync.yml` | `python -m src.sf_object_sync … \| tee` | ✅ `set -euo pipefail`, same step | already correct |
| `ci.yml` | *(none — see below)* | n/a | clean |
| `deploy-admin-dashboard.yml` | none | n/a | clean |

**2 of 3 piped producer steps were broken.** That is a class, not a coincidence.

### ⚠️ The second instance is worse than it looks, and B6d-pri is why

`scripts/cron/public-record-ingest.sh` sets `set -euo pipefail` **internally** (line 24) and so exits
non-zero correctly. B6d-pri had just made `main()` return `EXIT_DRAIN_FAILED = 3` precisely so a
wholesale drain failure would be loud. **That entire fix was being discarded one layer up by this
pipe.** A correct exit code is worth nothing if the caller pipes it into `tee`.

Note also the asymmetry with FRED: this workflow is a `workflow_dispatch`-only fallback (the live
producer is the Railway cron `0 7 * * *`, which runs the script directly and is unaffected). So the
blast radius is smaller — **but the defect is identical, and the fallback is exactly what someone
reaches for when the primary host is down**, i.e. the moment you most need a truthful exit code.

### ⚠️ Why the existing guard did not catch it

`test_b6d_cms_escalation_producer_health.py::test_fred_workflow_sets_pipefail_before_piping_to_tee`
already existed. It is scoped to `FRED_WORKFLOW` — **the one file that audit was looking at.**
`public-record-ingest-daily.yml` carried the identical defect and was never examined.

> **A guard written for an instance does not cover the class.** When a defect is found in one file,
> the guard belongs on the *shape*, over the whole population — otherwise the next instance is
> invisible by construction. This is the repo's own recurring lesson (*a guard that cannot see the
> population it exists for is not a guard*) arriving on a guard that was itself written to close a
> silent-failure defect.

It was also a **file-wide `find()`**: `pipefail` appearing *somewhere* in a workflow would satisfy it
regardless of which step it sat in. `salesforce-object-sync.yml` happens to be correct, but only a
step-anchored check can prove that (the B6c-dup lesson: *a file-wide grep for a predicate that
legitimately appears twice is not a guard*).

---

## 3b. 🚨 Second pass: `ci.yml` cannot fail on its own subject matter

`| tee` is one exit-code-masking idiom. **`|| echo` is another**, and `ci.yml` uses it five times.
The decisive one is the test job:

```
pytest tests/ -v --tb=short --ignore=tests/integration/ 2>/dev/null || echo "Tests completed (some may have been skipped)"
```

`|| echo` swallows pytest's exit code, so **the step always succeeds**; `2>/dev/null` discards the
traceback so you cannot see why. **3,042 tests are collected and not one of them can fail CI.** Every
guard in `tests/` — the mutation-verified B6d ones, and the one added this round — is a regression
detector that **no merge gate enforces.** This is the LCC repo's documented *"NO WORKFLOW RUNS
`npm test` ON A PULL REQUEST"* finding, in the Dialysis repo, in a different disguise.

| line | masked | effect |
|---|---|---|
| 89 | `pytest … 2>/dev/null \|\| echo` | **the whole suite cannot fail** |
| 137–138 | `python -c "import src.main" 2>/dev/null \|\| echo` | **the import check cannot fail** |
| 108 | `pip-audit … 2>/dev/null \|\| echo` | vulnerability scan cannot fail |
| 114 | `! grep -rE "(sk-…)" … \|\| echo` | secrets grep cannot fail (plus `continue-on-error: true`) |

⚠️ **The cruellest instance is 137–138.** That import check is *exactly* what would have caught FRED's
`ModuleNotFoundError: postgrest`. **The repo already has the detector; it simply cannot fail.**

**Not flipped, deliberately.** Turning a never-enforced 3,042-test suite into a merge gate is the
documented *"a NEW CI job is not shipped until it has been green once on `main`"* trap — if the suite
is red it blocks every merge, and **whether it is green is unmeasured.** It cannot be established from
this sandbox (a `--collect-only` run gave 3,042 collected / 3 collection errors, but those errors are
an incomplete local `flask` install — a sandbox artifact, not evidence about CI). **Measure first,
then gate.** Backlog **B6e-ci-mask**.

**The `| tee` guard does not catch this, and correctly so** — it masks `||` as boolean OR precisely so
it can detect pipes. **Exit-code masking is a wider class than piping**: `|| echo`, `|| true`,
`2>/dev/null`, `continue-on-error: true` and `set +e` all belong to it. Extending the guard now would
ship a test that is red on every run with no safe way to green it — the exact anti-pattern above.

---

## 4. 🚨 The operator exposure — the exhibit does not show a gap, it shows a wrong number

`economic_indicators` has exactly two consumers, and both are Capital Markets book exhibits:
**`cm_dialysis_macro_rates_m`** and **`cm_dialysis_macro_rates_q`** — the macro-rate exhibits in the
Dialysis State of the Market book, i.e. a client deliverable.

The intuitive expectation is a hole after 2026-08-07. **There is no hole.** The monthly view still
emits a row for `period_end = 2026-08-31` and the quarterly view one for `2026-09-30`. What is behind
the August row:

| series | observations behind "August 2026" | window |
|---|---:|---|
| `DGS10` | **3** | Aug 3 – Aug 5 |
| `MORTGAGE30US` | **1** | Aug 6 only |
| `FEDFUNDS`, `UNRATE`, `CPIAUCSL` | **0** | → NULL |

So the exhibit renders **a complete-looking monthly average of the 10-year Treasury from three
business days**, and **a "monthly average" 30-year mortgage rate that is one single weekly print**,
inside a 21-business-day month. Two of the five series are simply blank.

> **A stale feed that carries forward is more dangerous than one that goes blank.** A missing bar
> prompts a question; a plausible bar does not. This is the P180 lesson (*NULL is not zero*) with the
> sign flipped — here a partial period is rendered as if it were a complete one.

**👤 Operator action, not mine to take:** establish whether a book or CM export was generated after
2026-08-07. If one went out, the August/Q3 macro point is wrong and that is a **correction to issue**,
not merely a pipeline to fix. I did not regenerate anything — per the brief, that is a separate
decision (§3d).

---

## 5. What was done, and what was NOT

**Done this round (Dialysis repo):**
- `.github/workflows/public-record-ingest-daily.yml` — `set -o pipefail` before the pipe, with the
  mechanism written down at the site.
- `tests/test_b6e_pipefail_workflow_guard.py` — **class-wide**, step-anchored, 10 tests.
- `INFRASTRUCTURE.md` — job map gains `fred-ingest-daily.yml` and `metadata-backfill-queue.sh`, plus
  a standing note on *why* the map being incomplete is what hid the producer.
- `dia_producer_registry.notes` for `fred_ingest` — rewritten to say **merged, not yet executed**
  (it still described the pre-fix state, which is now false).

**Already merged before this session (`e0ec3fc`, PR #7383, 2026-09-01 12:53 UTC):** the dependency
install, the `set -o pipefail`, and the fail-on-stale gate in `fred-ingest-daily.yml`. Re-doing it
was unnecessary; **verifying it had actually run was not, and it has not.**

**Deliberately NOT done:**
- **No CM view or export was regenerated** (§4 — operator's call).
- **The `sys.exit` guard's send-vs-write counter was left alone.** `_upsert_batch` returns
  `len(rows)` and posts with `Prefer: return=minimal`, so `total_written` counts rows **SENT**, not
  rows changed — the documented *a send counter is not a write counter* trap. It is real but
  secondary (the guard is about crash-vs-no-crash), and changing exit semantics is a behaviour change
  that deserves its own round. Filed **B6e-fred-sendcount**. It is also why §7's verification is a
  DB delta and not the script's own tally.
- **No run ledger added** — `fred_ingest` still reads `no_run_ledger` in `v_dia_producer_health`,
  correctly and with a stated `blindness_reason`. That is **B6e-ledger**, which covers **three**
  producers; doing one of them here would be half a pattern.

---

## 6. ⚠️ The blocker — the live re-run is operator-gated

**I could not execute the fix, and could not backfill.** Both were attempted:

- `workflow_dispatch` on `fred-ingest-daily.yml` → **HTTP 403 "Resource not accessible by
  integration"**. This session's GitHub token has no Actions write scope.
- Running the ingest directly → **no `FRED_API_KEY`, no `SUPABASE_SERVICE_ROLE_KEY`**, and
  **no egress**: `api.stlouisfed.org` returns `http=000`, `connect_rejected` by the agent proxy.

So: **the gap is NOT backfilled, and the fix is still unproven.** Same class as the documented CMS
and SOS egress blockers — stated rather than papered over.

The next scheduled run is **2026-09-02 11:30 UTC**, and it is the first that will carry the fix
(today's fired at ~11:30 UTC, **before** the 12:53 merge). A `workflow_dispatch` with
`observation_start=2026-08-01` would both prove it and close the gap in one run — FRED serves history
for all five series, and the upsert is idempotent on `(series_id, observation_date)`.

---

## 7. Verification — assert on rows, and expect red first

1. ✅ **The state delta is the only proof:** `max(economic_indicators.created_at)` advances past
   **2026-08-07 19:59:41**, and `max(observation_date)` past **2026-08-06**. Not a green check, not a
   clean log, not the script's `TOTAL: n rows written` line (§5).
2. ⚠️ **If the dependency fix is wrong, the workflow will now go RED — that is success, not
   regression.** A loud failure is the improvement. Do not restore the green by reverting `pipefail`.
3. **Guard:** `python -m pytest tests/test_b6e_pipefail_workflow_guard.py -q` → 10 passed.
   **Mutation-verified RED on 7 of 7:** pipefail removed from public-record / from fred / from
   salesforce; `_has_pipe` neutered; pipefail moved to *after* the pipe; `shell: bash` acceptance
   removed; comment stripper disabled. Baseline green after each restore.
4. **Positive control is in the guard itself** — it writes a known-bad workflow, asserts the detector
   fires, and deletes it. A detector only ever seen returning zero is a claim, not a detector.
5. `v_dia_producer_health` for `fred_ingest` reflects reality: `no_run_ledger`, with the
   `blindness_reason` naming why, and `notes` now stating merged-not-executed.

### Two guard defects found by my own mutation pass, both worth recording

- **Comparing an offset from a masked string against one from the raw string.** The first cut flagged
  the *already-correct* FRED step, because `${{ }}` masking shortened the text under one index and not
  the other. Masking now preserves **length**, and both searches run over the same masked string.
- **A hand-escaped character class got the quoting wrong and produced a false positive on `ci.yml`.**
  That file greps for `"(sk-[a-zA-Z0-9]{20,}|eyJ...)"` — the `|` is **regex alternation inside a
  quoted string**, not a pipeline. My class excluded backslashes, so the span containing `\.` never
  matched and the bar leaked through. Replaced with a character scan. **A detector that cries wolf is
  how a real finding gets ignored** — and `shell: bash` is likewise accepted, because GitHub runs it
  as `bash --noprofile --norc -eo pipefail {0}`, so flagging it would be a second false positive.

---

## 8. Durable rules

1. **Never pipe a producer without `pipefail`.** GitHub's default `run:` shell on Linux is `bash -e
   {0}` — no pipefail. `shell: bash` is the other valid answer.
2. **A green run is not a state delta.** The rule this repo states for crons holds identically for
   workflows: assert on rows written, never the runner's exit status.
3. **A guard written for an instance does not cover the class** — and it must be **step-anchored**,
   not a file-wide grep.
4. **A stale feed that carries forward is more dangerous than one that goes blank.** Before sizing a
   staleness incident, look at what the consumer actually renders — a partial period presented as a
   whole one is a wrong number, not a missing one.
5. **Two green runs and a write do not mean the write came from the runs.** Compare write timestamps
   against run completion times before crediting a producer with its own table's contents.
6. **A producer missing from the human-readable job map is a producer nobody will look for.** Add the
   row in the same change that adds the job.

---

## 9. Follow-ups filed

| id | what |
|---|---|
| **B6e-fred-verify** | 👤 Operator: dispatch `fred-ingest-daily.yml` with `observation_start=2026-08-01` to prove the fix and close the 25-day gap in one run. Verify by the `created_at` delta. |
| **B6e-fred-cm-exposure** | 👤 Operator: establish whether a book/CM export went out after 2026-08-07. If so the August/Q3 macro point is built from 3 days and needs correcting. |
| **B6e-fred-sendcount** | `_upsert_batch` returns rows SENT (`return=minimal`), so the script's `sys.exit` guard cannot distinguish a real write from an idempotent no-op. |
| **B6e-ci-mask** | 🚨 `ci.yml` masks exit codes in 5 places; **3,042 tests cannot fail CI**, and neither can the import check that would have caught this very bug. Measure the suite green on `main` FIRST, then remove the masking. |
| **B6e-ledger** | Unchanged — three dia producers still emit no run row. |
