# B6d-cms-escalation — dia has five producers and no health surface over any of them

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6d-cms-escalation`.
**Repo:** **Dialysis** (+ LCC only if an alert path needs wiring). **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4** (this is its
structural half). **Playbook:** Class 21.

---

## 0. This is the answer to "why did it take two months?"

The CMS outage is closed — `source_last_seen` moved, the `feed_stale` alert **auto-resolved
2026-09-01**. **But nothing in that chain was designed to catch it.** What actually surfaced it was a
**45-day freshness bound on a downstream table**, which is why the delay was two months rather than
two days.

**B6a built a producer-health surface for gov. dia never got one.** Verified 2026-09-01:

| | gov | **dia** |
|---|---|---|
| producer health view | ✅ `v_pipeline_task_health` | ❌ **does not exist** |
| producer run table | `run_log` (5,813 rows) | `ingestion_tracker` (292 rows) |
| any producer-registry object | ✅ | ❌ **zero** |
| `feed_freshness_registry` | per-feed | **5 rows, TABLE-keyed — not producer-keyed** |
| producers writing runs | — | **5 distinct**, newest 2026-09-01 |

**So dia runs five ingestion producers and has no surface that can say whether any of them is
healthy.** The only instrument pointing at them is a freshness bound on the *output* — which cannot
distinguish *"the producer failed"* from *"the source published nothing."*

---

## 1. What to build — port gov's view, do not invent a new one

gov's `v_pipeline_task_health` already carries **exactly the columns this needs**, several of them
earned the hard way:

```
step_name · last_outcome_at · status · last_outcome · last_error · age_days
last_success_at · skip_reason · skip_declared
p90_gap_days · gap_observations · expected_max_age_days · is_overdue
```

⚠️ **`last_success_at` is separate from `last_outcome_at`, and that distinction is precisely what
this whole thread was about** — the CMS throttle keyed on the last *attempt* and bought itself 30
days of silence per failure. **Port that separation deliberately; it is not incidental.**

⚠️ **This is a PORT WITH A COLUMN MAPPING, not a copy.** gov reads `run_log`; dia's run table is
`ingestion_tracker` with different columns — `run_status`, `started_at`, `finished_at`,
`error_summary`, and a producer identified by `task_name` **or** `source`. **Map them explicitly and
say what you mapped.**

---

## 2. ⚠️ Rules

**2a. 🚨 ENUMERATE PRODUCERS FROM THE SCHEDULER, NOT FROM `ingestion_tracker`.** The tracker's 5
distinct producers are **only those that have ever written a row**. **A producer that has never
emitted is invisible to it** — which is the entire Class 21 lesson, and building the registry from
the tracker would rebuild the blindness one level up. **Enumerate from the Railway cron services,
`scripts/cron/*`, and the GH workflows; then anti-join against the tracker.** *A scheduled producer
with zero rows ever is the highest-value row this view can contain.*

**2b. A missing producer must EMIT, not vanish.** Same rule, restated: a registered producer with no
run in its expected window is a **row that says so**, never an absent row.

**2c. ⚠️ `last_error` will be EMPTY at first, and that is honest — do not paper over it.**
`error_summary` was NULL on **47 of 47** dia runs; `B6d-cms-step` is fixing that channel. **Build the
column, expect it blank, and say in the writeup that it is blank pending that fix.** A view that
shows `last_error` as always-null must not be read as "no errors."

**2d. Ground the expectation in measured cadence, not a default** — B6d's lesson. The view already
has `p90_gap_days` and `gap_observations` for exactly this. ⚠️ **Below three observations, say
`cannot_be_sized_from_data` rather than dressing a guess as a measurement.**

**2e. ⚠️ `success` is not currently trustworthy on dia.** Six runs reported `success` (newest
2026-07-30) while `source_last_seen` stayed at 2026-06-25 and 0 clinics were refreshed. **If
`B6d-cms-step` has not yet tied `success` to `rows_upserted`, note that `last_success_at` inherits
that weakness** — and say so rather than letting the view imply more than the data supports.

**2f. Do not build an alert until the view is honest.** An alerting surface over an untrustworthy
`success` would manufacture false all-clears. **View first, alert second**, and the alert should
reuse the existing `lcc_health_alerts` path rather than inventing a second one.

**2g. Python/SQL in the Dialysis repo** — every network call carries its own `timeout=`.

## 3. Verification

- **The view exists on dia and lists every SCHEDULED producer**, including any with zero runs ever.
- **A deliberately-silenced producer shows as overdue** — positive-controlled, seen firing, then
  restored. ⚠️ *A surface that would show a dead producer but has never been seen doing so is a
  claim, not a detector* — that is the rule that made B6a trustworthy.
- **The five known producers appear with honest cadences**, and any sized from fewer than three
  observations say so.
- **`last_error` blank is explained, not hidden.**
- **No alert ships on an untrustworthy `success`.**
- Guards mutation-verified RED, comments stripped before matching.

## 4. Deliverable

`docs/audits/B6d_cms_escalation_DIA_PRODUCER_HEALTH_2026-09-01.md`, plus the **BUILD-TURN-PROTOCOL
closing checklist**: `PLANNED-BACKLOG.md` (`B6d-cms-escalation`),
**`data-coherence-invariants.md` I4 — its detector row currently reads as gov-only and should record
dia's state either way**, the Dialysis `CLAUDE.md` if a durable footgun appears, and a STATUS entry.

⚠️ **If enumerating the schedulers turns up producers nobody knew were scheduled — or scheduled
producers that have never run — that is the finding, and it outranks the view.** Report it first.
**The view is the instrument; what it reveals on its first honest run is the point.**
