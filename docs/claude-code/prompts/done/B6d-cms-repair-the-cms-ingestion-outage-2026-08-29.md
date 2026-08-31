# B6d-cms — a two-month CMS ingestion outage against a source that IS publishing

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6d-cms`.
**Repo:** **Dialysis** (`cms-ingestion-daily.yml` → `src/run_cms_ingestion.py`).
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**.
**Source:** `docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md` §11 + the registry's
`expectation_basis` for `medicare_clinics`.

---

## 0. Why this is the top of the queue

B6d graded all 25 feed expectations. **24 were either fine or mis-sized. This one is a real
break — and it is the one everybody assumed was a mis-sized SLA**, including the prompt that ordered
the grading. It survived only because that prompt said *measure CMS's actual cadence before widening
the bound*.

**It is also the highest operator cost on the board:** `medicare_clinics` is dia's clinical spine —
it feeds BOV and OM exhibits, CMS quality data, patient volumes and the dialysis comps narrative.
**Every dialysis deliverable Scott produces is running on data that stopped updating in June.**

---

## 1. What is measured, and it is worse than the audit recorded

**`ingestion_tracker`, CMS rows, re-verified 2026-08-29 (Cowork):**

| run_status | count | newest attempt | note |
|---|---:|---|---|
| `success` | **116** | **2026-06-25** | ← **the last success, ~2 months ago** |
| `failed` | **40** | **2026-08-26** | still trying, still failing |
| `abandoned` | **16** | **2026-08-27** | ⚠️ these carry **`dataset_modified_date = 2026-08-25`** |
| `partial` | 31 | 2026-06-25 | |
| `recorded` | 24 | 2026-06-25 | |

**CMS published on 2026-08-25. We attempted. The runs failed or were abandoned.**

⚠️ **The audit recorded "27 failed + 6 abandoned" and I measure 40 + 16 — the audit was correct when
written and FAILURES ARE STILL ACCRUING DAILY.** Quote the delta, not a snapshot.

**And the SLA was never the problem — this is the measurement that settles it.** The feed's own gap
history is **p50 2d · p90 18.5d · max 41d ever**. The current age is **65d — above the largest gap
this feed has ever had.** *A bound above a feed's observed maximum is not a mis-sized bound.*

---

## 2. What to do

1. **Read the failures before theorising.** `ingestion_tracker.error_summary` / `error_log` on the
   40 `failed` rows, and the GitHub Actions logs for `cms-ingestion-daily.yml`. **Name the error.**
2. **Distinguish `failed` from `abandoned`** — 16 rows never reached a terminal status, which is a
   different mechanism (a killed job, a timeout, a crash before the tracker was closed) from a run
   that failed cleanly. ⚠️ **P123: open the run row before the work, close it after — an abandoned
   row is the signature of a run that died mid-flight**, and the two classes may have two causes.
3. **Check the obvious externals first**, since a two-month clean break usually is one: a **CMS API
   or schema change** on 2026-06-25, an **expired credential**, a **changed dataset id / URL**, a
   **rate limit**, or a **runner change**. ⚠️ **`SAM_API_KEY` next door needs re-issuing (B6d-sam) —
   check whether a shared credential rotation took both out.**
4. **Fix, re-run, and confirm the state delta** — `medicare_clinics.source_last_seen` advances and
   the `feed_stale` alert **auto-resolves on its own**.
5. **Then ask why nobody noticed for two months** — see §3b. That is the durable half.

---

## 3. ⚠️ Rules

**3a. Do NOT widen the SLA.** It is 45 days against a feed whose worst-ever gap is 41. **The bound
is doing its job and is the only reason this was found.** If the repair changes the feed's real
cadence, re-grade it with a stated basis (the registry has `expectation_basis` for exactly this) —
but never as a way to close the alert.

**3b. The producer failed 40 times and nothing escalated — that is a second defect, and it is the
one that generalises.** B6a made *skipped* steps visible; **this is a step that RAN and FAILED,
repeatedly, without reaching anyone.** ⚠️ Its runs are in `ingestion_tracker`, **not** the
`run_log`/`v_pipeline_task_health` surface B6a fixed. **Ask whether this pipeline is registered in
B6a's producer registry at all** — if it is not, the freshness alert was the *only* thing that could
ever have caught it, and it took two months because the feed's own bound is 45 days. **A failing
producer should be louder than a stale table.**

**3c. Report `rows_upserted`, never `rows_fetched`.** A run that fetched and upserted nothing is not
a success, and this tracker carries both.

**3d. `facility_patient_counts` is a DIFFERENT feed with a different cadence** — CMS publishes it
~annually and `cms_dataset_updates` shows `cms_patient_counts` last modified **2026-03-24**, checked
daily since. **Do not fold the two together, and do not "fix" the patient-counts feed because it
also looks old.** It is not stale; it is annual.

**3e. Python, in the Dialysis repo** — every network call carries its own `timeout=` (SIGALRM does
not bound a blocked C-level socket read).

---

## 4. Verification

- **`medicare_clinics.source_last_seen` advances past 2026-06-25** — that is the state delta.
- **The `feed_stale` alert auto-resolves.** ⚠️ Read the alert ledger, not the run log.
- **The error is NAMED in writing**, even if the fix is one line or an operator action.
- **`ingestion_tracker` shows a `success` with a non-zero `rows_upserted`.**
- **The escalation gap (§3b) is answered** — is this pipeline in B6a's registry, and if not, should
  it be?
- Guards mutation-verified RED, comments stripped before matching.

## 5. Deliverable

`docs/audits/B6d_cms_INGESTION_REPAIR_2026-08-29.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (B6d-cms), `data-coherence-invariants.md` **I4** if the escalation
gap turns out to be structural, the Dialysis repo's own `CLAUDE.md` if a durable footgun appears,
and a STATUS entry.

⚠️ **If the cause is an external change that needs Scott's action** — a re-issued key, a new CMS
dataset registration, an account — **say so plainly and stop.** Half the value here is a named cause;
`B6d-sam` next door is exactly that shape (`SAM_API_KEY` needs re-issuing), and an honest handoff
beats a workaround that hides the dependency.
