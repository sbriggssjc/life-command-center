# CFE-RUNAWAY — the CMS financial-estimates writer is exact-counting a 1.24M-row table on every insert, and it is grinding Dialysis_DB down

**Repo:** **`Dialysis`** (Railway service `cms-ingestion`, project `handsome-luck`) — this prompt is
filed from `life-command-center` per the established convention (see `B6d-cms-repair-the-cms-
ingestion-outage-2026-08-29.md`, same repo, same shape) but **all code changes land in `Dialysis`,
not `life-command-center`.** **DB:** dia `zqzrriwuavgrquhisnoa`. **Backlog:** `CFE-RUNAWAY`
(`life-command-center` `docs/os/PLANNED-BACKLOG.md`).

> **Read `Dialysis`'s own `CLAUDE.md` / STATUS-equivalent and branch-protection rules FIRST — this
> prompt is written from `life-command-center`'s house doctrine (measure before fixing, log-only
> before enforce, never fabricate) but does not know `Dialysis`'s own CI/branch conventions. Follow
> that repo's actual rules for how a PR reaches its main branch.**

---

## 0. Why this is the top of the queue

**Confirmed live, 2026-09-10, from Railway logs Scott exported and from Supabase's own logs:**
every record this pipeline writes to `clinic_financial_estimates` triggers **two additional,
completely unfiltered reads of the same table** — `GET .../clinic_financial_estimates?select=*&limit=1`
and `GET .../clinic_financial_estimates?select=created_at&limit=1`, both with **no filter at all**.
Supabase/PostgREST computes an exact row count for these before returning even `limit=1`, and at
**1.24M+ rows** it usually can't finish inside the statement timeout. Measured in a 14-minute window:
**46 records inserted, 46 `select=*` probes (36 timed out = 78%), 35 `select=created_at` probes (31
timed out = 89%)** — extrapolated, roughly 200 inserts/hour and 300–400 statement timeouts/hour,
continuously, for weeks. This is `docs/claude-code/STATUS.md`'s **CFE-RUNAWAY** entry
(`life-command-center`, 2026-09-09): **7,547 statement timeouts in 24h**, cron jobs failing to
start, dialysis dashboard reads 500ing 30% of the time — all downstream of this one writer.

**This is not a new failure mode for this pipeline.** `Dialysis`'s own `run_cms_ingestion.py` has a
documented history this session should read before touching anything: a 30-day throttle latched by
its own crashes (`B6d-cms`), an unguarded pre-loop window with no heartbeat (`B6d-cms-preloop`), a
double-tracker-row bug (`B6d-cms-doublerow`), and an orphan sweep with no `dataset_id`/`source`
filter (`B6d-cms-orphan-scope`) — all fixed or filed in `life-command-center`'s
`docs/os/PLANNED-BACKLOG.md`. **`B6d-cms-restart` is still open and unresolved: "why was every CMS
run being killed?"** This unit's finding — timeouts on every insert, causing 500s, which may be
crashing the process, which Railway then restarts, which starts the whole pass over — may be the
answer to that exact open question, just in a different phase of the same pipeline (financial
estimates, not the clinic ingest itself). **Check whether this IS `B6d-cms-restart`'s mechanism
before treating it as unrelated.**

---

## 1. What is measured — read this before opening any file

**The write shape, per record** (confirmed from Railway's own Python logging,
`src.supabase_execute_wrapper` / `src.propagation_utils` / `src.schema_introspection_loader` /
`src.utils_shared`):

1. `GET clinic_financial_estimates?select=...&medicare_id=eq.<id>&estimate_source=eq.cms_patient_count&is_latest=eq.True&limit=1` — keyed lookup, fine, uses an existing index.
2. `PATCH clinic_financial_estimates?estimate_id=eq.<old>` — retires the prior "latest" row, 204, fine.
3. `POST clinic_financial_estimates` — inserts the new row, 201, fine.
4. **`GET clinic_financial_estimates?select=*&limit=1`** — no filter. Exact-counted. Times out ~78% of the time.
5. **`GET clinic_financial_estimates?select=created_at&limit=1`** — no filter. Exact-counted. Times out ~89% of the time.

Steps 4 and 5 run **once per record**, not once per batch — the log timestamps land within
milliseconds to a couple seconds of each record's POST, for every record. Whatever emits them is
almost certainly `src/supabase_execute_wrapper.py` itself (its log line is literally
`supabase.execute table=None op=unknown …` — the wrapper isn't even capturing which table/op it
ran, which is its own separate defect worth fixing while in that file) or a "confirm the write" /
"get row count for reporting" helper called right after every save. **Find the actual call site —
grep the codebase for `.select(` chained with `count=` or `count="exact"`, and for anything that
runs after a `clinic_financial_estimates` upsert unconditionally.**

**Two more defects, same log window, almost certainly the same code path:**

- **Silent schema drift, every record:** `Skipping field 'payer_mix_assumptions' - not in Supabase
  schema for 'facility_patient_counts'.` (and four more: `medicare_share_assumed`,
  `medicaid_share_assumed`, `revenue_medicaid`, `commercial_share_assumed`) — the code's model
  computes these fields and then **silently drops them** because the live `facility_patient_counts`
  table has no matching columns. This may be intentional (a schema guard doing its job) or it may
  be five fields of real data being computed and thrown away on every run, undetected until now.
  **Name which. If intentional, this should log once at startup, not per-record. If not, it's either
  a missing migration or dead code that should be deleted.**
- **`Propagating to properties: {'estimated_annual_revenue': <value>}` immediately followed by
  `WARNING: [schema_guard] Dropped invalid fields for properties: estimated_annual_revenue …` and
  `WARNING: Invalid propagation target`** — every attempt to propagate the computed revenue estimate
  into the `properties` table fails, every time, silently continuing. **Find out whether this ever
  worked, and whether `properties.estimated_annual_revenue` is stale everywhere as a result** — that
  would matter to BOV/OM exhibits pulling from `properties` on the dia side.

**Collateral damage, same window, confirmed via Supabase logs:** while this ran, `v_next_best_action`,
`salesforce_activities`, `v_calendar_events_app`, `v_property_cms_link_suspect`, `rpc/exec_sql`, and
`salesforce_tasks` all 500'd within the same seconds — this is `life-command-center`'s
COPILOT-SYNC-500 backlog row, live, not historical. **Fixing this unit should make that row
re-measurable for the first time.**

**Table growth, from `life-command-center`'s earlier read:** `clinic_financial_estimates` is
**1,243,401 rows / 771 MB**, and weekly insert history shows a **monthly** cadence (~144k/week every
4 weeks) until **2026-08-24**, after which it became **continuous** (421k in one week on 08-31). The
`08-28 → 09-01` gap in daily counts (nothing written for four days, then a burst) is consistent with
a crash-restart-replay pattern, not a scheduling change. **`is_latest` stays correct (36,538 rows,
matching historical baselines) — it is the HISTORY rows piling up, not the current-state data, that
is the growth problem**, which matters for how aggressively any retention cleanup can move.

---

## 2. Units

### Unit 1 — name the exact call site and its cause

1. Find the function issuing the two unfiltered `select=*`/`select=created_at` probes. Read
   `src/supabase_execute_wrapper.py` first — its logging (`table=None op=unknown`) suggests it isn't
   even told what it's executing, which will make this harder to find by log alone; grep call sites
   instead of trusting the log line.
2. Determine WHY it runs per-record: is it a health-check, a "did my insert commit" verification, a
   row-count-for-a-progress-bar, or leftover debug code? Name the actual purpose before deciding the
   fix — a verification check has a cheap replacement (`select=estimate_id` on the row just written,
   not a blind `limit=1` on the whole table); a row count for reporting should run once at the end
   of a batch, not per record, and should use `Prefer: count=planned` or skip counting.
3. Confirm whether these two calls, or the schema-drop/propagation-failure logging next to them, are
   inside a broader `except`/retry loop that could explain the crash-restart pattern — this is where
   `B6d-cms-restart`'s open question may get answered. If a timeout here raises unhandled and kills
   the process, say so plainly and trace it up to whatever supervises the cron.

### Unit 2 — remove the per-record full-table probe

Replace steps 4–5 from §1 with whatever the real purpose turns out to be, costing O(1) instead of a
full-table exact count:
- Verification → re-select the just-written row by its own key (`estimate_id=eq.<new_id>`), not an
  unfiltered `limit=1`.
- Reporting/telemetry → move it out of the per-record path entirely; if a "has this table changed"
  or "row count" signal is needed for anything, compute it once per run (or use `Prefer:
  count=estimated`, which reads `pg_class` statistics instead of scanning).
- If it turns out to be genuinely unused/vestigial, delete it and say so.

**Do not** add retry/backoff around the existing calls as a substitute for removing them — that
would keep hammering the table, just with delays between hits, and would not stop the collateral
500s on unrelated tables during the run.

### Unit 3 — crash-safety, if Unit 1 found the process dies on this timeout

If a `57014` (`statement timeout`) here is what's killing the process (not caught, or caught and
re-raised): catch it, log it honestly as a skip for that record (do not silently continue as
success), and make sure the run's own checkpoint/watermark only advances past records it actually
finished — so a Railway restart resumes rather than replays the whole pass. Read `B6d-cms`'s fix for
`get_last_ingestion_meta` before reinventing a watermark scheme; this pipeline already has scar
tissue about a crashed run corrupting its own resume point.

### Unit 4 — the two defects next to the fix, decided not just noted

1. The five `facility_patient_counts` fields being dropped (§1) — name whether this is intentional
   (then quiet the per-record log to once-at-startup) or a real gap (then either add the migration
   or delete the dead code that computes values nobody stores).
2. The `properties.estimated_annual_revenue` propagation failure (§1) — find out whether it has
   *ever* succeeded, and if not, whether any current dia exhibit or BOV path reads that column
   expecting it to be current. Fix the propagation target or remove the attempt; don't leave it
   warning silently forever either way.

### Unit 5 — retention, named but scoped conservatively

`clinic_financial_estimates` has ~1.2M rows from repeated full passes since 2026-08-24, almost all
history (`is_latest=false`). **Do not delete anything in this unit without Scott's sign-off** — name
the row counts by age/pass and propose a retention rule (e.g., keep N most recent history rows per
`medicare_id`+`estimate_source`, or a date cutoff), but land it as a proposal + a count query, not an
executed `DELETE`, unless Scott has already approved a specific cutoff by the time this is written.

### Unit 6 — tests / verification, in this repo's own idiom

Read how `Dialysis` structures its own test suite (if any) before assuming `life-command-center`'s
`node --test` conventions apply — this is a Python repo. Whatever the fix, it needs: a test proving
the per-record path no longer issues an unfiltered `select=*`/`select=created_at` (mock the Supabase
client, assert on call args, not on log text); and, if Unit 3 applies, a test proving a simulated
timeout on one record does not corrupt the run's resume point for the next run.

---

## Out of scope — say so

- Setting or rotating any Railway/Supabase secret (unrelated to this unit).
- `B6d-cms-restart`'s own remaining open question, if this unit's finding does NOT explain it —
  leave that row as-is rather than forcing a connection that isn't there.
- Any `life-command-center` code or docs — this unit's code changes are entirely in `Dialysis`. The
  `life-command-center` side (STATUS.md, PLANNED-BACKLOG.md CFE-RUNAWAY row) gets updated separately,
  in `life-command-center`, once this is verified live.
- Executing the retention `DELETE` from Unit 5 — proposal only, this round.

## Verify on

- Paste the exact call site(s) found in Unit 1, with file + line.
- Before/after: with the fix applied, a single record write to `clinic_financial_estimates` issues
  no unfiltered full-table read (grep the code path, and/or a captured request log from a local or
  staging run).
- Whatever this repo's CI requires, green — paste the pass/fail summary, not just "tests pass."
- State plainly whether Unit 3's crash-safety work applies, and if so, whether it explains
  `B6d-cms-restart`.
- Unit 4's two decisions stated explicitly (intentional-and-quieted, or fixed) — not left as open
  questions in the response.
- Unit 5's retention proposal as counts + a rule, no `DELETE` executed.
