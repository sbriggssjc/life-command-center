# B6d-pri — a service failing ~1,000 times a day and reporting success

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6d-pri`
(+ the throttle half of `B6d-cms-restart`).
**Repo:** **Dialysis** (`src/`, `scripts/cron/`). **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**.
**Evidence:** Railway `public-record-ingest` logs, **2026-08-31 06:03 → 16:42, one deployment,
1,001 lines: 502 error / 499 info.**

---

## 0. What the logs proved, and why none of it alerted

**The service exits 0 every day.** That is the single reason four separate defects have been
invisible: **nothing downstream distinguishes "ran and did nothing" from "ran and worked."**

**Four defects, all live, all in one 10-minute run:**

| # | count | what |
|---:|---:|---|
| 1 | **1** | 🎯 **`CMS ingestion recently run (3 days ago < 30); skipping.`** → `Cron complete` → `Stopping Container`. **This is the two-month CMS outage.** |
| 2 | **496** | `null value in column "reason" of relation "pending_updates" violates not-null constraint` (**23502**) |
| 3 | **486** | `Failed to mark stale <uuid>: Supabase Postgres DSN not configured (SUPABASE_DB_DSN / SUPABASE_DB_POSTGRES_URL / SUPABASE_DB_URL)` |
| 4 | **10** | `column properties._new_property does not exist` (**42703**) |

⚠️ **And immediately after ~500 consecutive failures it logs `Pending updates cleanup complete`.**
**That line is the defect this whole audit arc is about, in one place.**

---

## 1. Defect 1 — the throttle keys on the last ATTEMPT, not the last SUCCESS 🎯

**This is the highest-value fix in the prompt.** The run skips because *"3 days ago < 30"* — but
**3 days ago is 2026-08-27, an `abandoned` run.** The last **success** is **2026-06-25**.

**So a failed run buys 30 days of silence, and the next failure buys another 30.** That is the entire
two-month outage, and it is self-perpetuating.

- **Key the throttle on the last SUCCESSFUL run.** A failure must not satisfy a freshness gate.
- ⚠️ **B6d-cms reported removing this throttle and the log is from AFTER that PR merged.** **Establish
  whether the deployed code contains that change before writing a second fix** — *merged is not
  running*, and this would be its fourth appearance in this arc. If the fix is present and the
  throttle still fired, the fix missed this path; say which.
- ⚠️ **A skip writes NO `ingestion_tracker` row**, which is why the tracker showed "no attempts since
  08-27" while the cron ran daily. **A skip must emit a row with a reason** — that is B6a's rule
  (*a skipped step must emit, not vanish*) applied one layer down, inside the ingester.

## 2. Defect 2 — `pending_updates.reason` is NOT NULL and the writer omits it

**Verified on dia:** `reason` is `NOT NULL`; the table holds **1,959 rows**. Every write from this
path fails **23502**, 496 times in one run.

- **Find the writer and give it a real reason string** — ⚠️ **not a placeholder.** The failing row
  already carries `stale` in another column and `public_record_ingest` as its source; **a reason
  that restates the source is not a reason.** Whatever the operator needs to see when they triage
  the row is the reason.
- **Do not "fix" this by dropping the NOT NULL.** A pending update nobody can explain is not
  actionable, and this table feeds a human queue.

## 3. Defect 3 — a missing env var kills the whole mark-stale path

`SUPABASE_DB_DSN` (or `SUPABASE_DB_POSTGRES_URL` / `SUPABASE_DB_URL`) **is not set on the Railway
service.** 486 failures in one run.

👤 **Scott is setting this** — see the handoff. **Your job is the code side:** confirm which of the
three names the code actually reads and in what order, **and make its absence LOUD** rather than a
per-row warning repeated 486 times. **A missing configuration should fail the step once, clearly,
not degrade into a wall of identical lines.**

## 4. Defect 4 — `properties._new_property` does not exist

**Verified on dia: there is no such column.** 42703, 10×, in the comparison step. Find the reference
and either repoint it or remove it. ⚠️ **Check whether the comparison is silently returning "no
change" for those rows** — a comparison that errors may be counted as "nothing to update," which
would make this a data defect and not just a log defect.

---

## 5. ⚠️ Rules

**5a. Fix the HONEST COUNT, not just the four defects.** `Pending updates cleanup complete` after
~500 failures is what let this run for months. **Report attempted / succeeded / failed, and exit
non-zero when a step fails wholesale.** Without that, the next defect hides exactly the same way.

**5b. ⚠️ The service exiting 0 is why nothing alerted — and that is a REGISTRY gap too.** B6a built
a producer registry with declared skips; **this pipeline's runs live in `ingestion_tracker`, not
that surface.** **Ask whether `public-record-ingest` is registered at all.** If it is not, a
freshness bound on a downstream table was the only thing that could ever have caught this — which
took two months.

**5c. Report `rows_upserted`, never `rows_fetched`**, and **never** the log line's own claim.

**5d. Python, in the Dialysis repo** — every network call carries its own `timeout=`. ⚠️ **SIGALRM
is not sufficient** (`CLAUDE.md`: *it does not bound a blocked C-level socket read*), and the
2026-06-23 hangguard prompt proposed exactly that — **so if it shipped, it may look applied and
still hang.**

**5e. Do not bundle the D1 work.** That is in flight separately.

## 6. Verification

- **`max(medicare_clinics.source_last_seen)` advances past 2026-06-25** — the state delta.
- **The `feed_stale` alert for `medicare_clinics` auto-resolves.** Read the alert ledger, not the log.
- **A skip emits a tracker row with a reason**, and a run that skips is distinguishable from a run
  that succeeded.
- **`pending_updates` writes succeed** — row count moves off 1,959 with real `reason` values.
- **The 42703 and the DSN warnings are gone from a full run's logs**, and a missing DSN now fails
  loudly once.
- **A wholesale-failed step exits non-zero.**
- Guards mutation-verified RED, comments stripped before matching.

## 7. Deliverable

`docs/audits/B6d_pri_PUBLIC_RECORD_INGEST_REPAIR_2026-08-31.md`, plus the **BUILD-TURN-PROTOCOL
closing checklist**: `PLANNED-BACKLOG.md` (`B6d-pri`, `B6d-cms-restart`), the Dialysis repo's
`CLAUDE.md` if a durable footgun appears, `data-coherence-invariants.md` **I4** if §5b turns out to
be structural, and a STATUS entry.

⚠️ **If the CMS run still hangs once the throttle is corrected, STOP and report that** — it means the
2026-06-23 hang is still live underneath and the throttle was merely hiding it. **That is a finding,
not a failure**, and it is the one thing the last two months of silence could not tell us.
