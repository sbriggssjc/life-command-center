# B6d-pri — a service failing ~1,950 times a day and reporting success (2026-08-31)

> ⚠️ **CONTEXT ADDED 2026-09-01 (PR1) — READ THIS BEFORE ACTING ON ANYTHING BELOW.**
> **Every defect this audit found and fixed is real. What it could not see is what the service
> IS.** `public_record_ingest.py` **contains no county record fetch on either domain** — dia's one
> external call asks **gpt-4o to recall** parcel and tax facts from a prompt seeded with the
> property's own address *and the owner we already hold*; gov snapshots the assessor **portal
> homepage**. So this audit repaired the throughput of a **generator**, not of an acquisition path.
>
> **Nothing here needs reverting** — a producer that runs correctly is a prerequisite either way,
> and the fixes stand. But **do not read this page as evidence that the public-records lane is
> healthy or worth wiring.** Its output was measured on 2026-09-01: the model leg emits almost
> nothing, as **zeros**, which reached ~8,800 curated dia rows and every `tax_delinquent` value in
> both domains before PR1a/PR1b nulled them.
>
> **Canonical page: [`../architecture/public-records-source-lane.md`](../architecture/public-records-source-lane.md).**
> The real acquisition step is **PR1d** (`REGRID_API_KEY` — a complete vendor client that has never
> run), not more throughput on this one.
>
> **The durable lesson this audit could not have drawn: fixing a producer's RELIABILITY says
> nothing about the VALIDITY of what it produces.** Both questions have to be asked, and the second
> one is answered by reading what the external call talks to.

**Repo:** Dialysis (`src/`) · **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`
**Evidence:** Railway logs, 2026-08-31 06:03 → 16:42, one deployment, 1,001 lines (502 error / 499 info)
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` · `data-coherence-invariants.md` **I4**
**Backlog:** `B6d-pri`, and it settles the open question on `B6d-cms-restart`

---

## 0. The one-line answer

**The CMS fix that shipped 2026-08-29 is not running.** The 2026-08-31 log emits a message
that was **deleted from `main` two days earlier**. Everything else in this audit is real and is
fixed here, but the two-month `medicare_clinics` outage is a **deploy gap**, not a fifth defect.

Four defects were live in that one run. All four are fixed. The fifth thing — the reason all
four survived months of daily execution — is that the service **exits 0 no matter what**, and
one line, `Pending updates cleanup complete`, is logged immediately after ~500 consecutive
write failures.

---

## 1. Defect 1 — the throttle is already fixed and is not deployed 🎯

The brief asks: *"Establish whether the deployed code contains that change before writing a
second fix."* It does not.

```
log 2026-08-31 06:03  CMS ingestion recently run (3 days ago < 30); skipping.
```

That is the format string `"CMS ingestion recently run (%d days ago < 30); skipping."`,
**deleted by `fc342b3` (B6d-cms, merged 2026-08-29 as PR #7379)** and present nowhere in `main`:

```
$ grep -rn "recently run" --include=*.py src/
(no matches — only a test docstring)
```

The arithmetic corroborates it to the day. `main()`'s pre-fix `days_ago` came from
`get_last_ingestion_meta()`, which took the newest `ingestion_tracker` row of **any** status:

| | value |
|---|---|
| newest tracker row of any status | `2026-08-27 06:12:43`, `run_status='abandoned'` |
| run timestamp | `2026-08-31 06:03` |
| elapsed | 3.99 days → `.days` = **3** |
| logged | *"3 days ago < 30"* ✓ |

Under the **fixed** code the same run reads `days_ago` from the last *successful* ingest
(`2026-06-25`, 67 days) **and applies no throttle at all**, so it would have proceeded.

**Therefore: the brief's premise ("a failed run buys 30 days of silence") is correct, it is the
mechanism B6d-cms already fixed, and no second fix belongs in the code.** Keying the throttle on
the last SUCCESS is `INGESTED_RUN_STATUSES = ("success",)`, already in `main`.

- ⚠️ **This also explains the gap B6d-cms-restart was chasing.** That row asks why there was *no
  attempt at all* on 08-28/29/30 against a daily schedule. There was: the cron fired and took the
  pre-fix throttle branch, which **returns before writing anything**. A skip that emits nothing is
  indistinguishable from a cron that never ran. The 08-31 run was **not killed** — it skipped and
  exited cleanly, in ten seconds. *Why earlier runs were killed remains open and still needs
  Railway deploy logs; it is no longer the explanation for the current silence.*
- **Second, weaker signal, stated as weaker:** the log's DSN message names three env vars, while
  every version of that message in git history names six plus the `PG*` fallback. Consistent with
  an older image, but the prompt may have compressed the line, so it corroborates rather than
  proves.

### What WAS still missing, and is fixed here

**A skip must emit a row, with a reason.** The `maybe_skip_if_unchanged` branch in `main()`
returned having written nothing to `ingestion_tracker` — so *"skipped, dataset unchanged"* and
*"never ran"* were the same absence on the surface everyone reads for this pipeline. It now
writes a row with the reason. This is B6a's rule (*a skipped step must emit, not vanish*) one
layer down, inside the ingester.

The status is `recorded`, which is the pipeline's existing vocabulary for a skip **and is
deliberately not in `INGESTED_RUN_STATUSES`** — so these rows can never re-arm the change-detection
watermark the way a crashed run did.

👤 **Nothing in this change ingests anything.** The restart is still a Railway **Redeploy** (not
`FORCE_RUN=true` — see B6d-cms).

---

## 2. Defect 2 — `resolve_applied_updates` wrote `reason = NULL`

`src/clean_pending_updates.py::resolve_applied_updates` selected

```
update_id,file_name,field_name,table_name,property_id,new_value,created_at,note
```

— **no `reason`** — and then wrote `"reason": row.get("reason")` back into the stale-marking
payload. `row.get("reason")` was therefore always `None`, and

```sql
select is_nullable from information_schema.columns
 where table_name='pending_updates' and column_name='reason';   -- NO
```

so every stale row failed **23502**. Live population: **1,959 rows, 0 with a null reason, 1,952
older than the 7-day stale threshold** — i.e. essentially the whole table is attempted every run.

**Fix:** `reason` (and `notes`) are in the select, and the payload carries the row's **own**
reason forward. A blank reason **omits the key** rather than sending `None`, so the stored value
is left alone.

- ⚠️ **No placeholder is synthesised, deliberately.** The failing rows already carry `stale` in
  another column and `public_record_ingest` as their source; **a reason that restates the source is
  not a reason**, and the operator triaging the row needs the original.
- ⚠️ **Not fixed by relaxing the NOT NULL.** A pending update nobody can explain is not actionable,
  and this table feeds a human queue.
- The select list and the payload are **one contract**; a guard pins both.

---

## 3. Defect 3 — the missing DSN was a symptom, and it was masking the real error

`upsert_pending_update` tried PostgREST, and on **any** exception did this:

```python
except Exception as e:
    # Any PostgREST hiccup (incl. PGRST002) -> drop to psycopg
    pass
```

**That one line is why a caller bug read as an infrastructure problem for months.** The real
error — `null value in column "reason" … violates not-null constraint` — was swallowed, control
fell to the psycopg fallback, and the only message anyone ever saw came from *there*:
`Supabase Postgres DSN not configured`. Every diagnosis pointed at a missing env var.

⚠️ **Setting the DSN would have fixed nothing — it would have changed which error you get.**
Measured, not assumed:

- the fallback is `INSERT … ON CONFLICT`, not an update, and `_ensure_pending_updates_required_fields`
  fills only `field_name` and `record_identifier`;
- `pending_updates` is NOT NULL on **`reason`, `entity`, `action`, `payload`, `file_name`** as well.

So the psycopg path would have failed too, differently — and, because it INSERTs, a fallback that
*did* satisfy those columns would have minted fresh queue rows for what was meant to be a status
flip. **The missing DSN has been accidentally preventing that.** Fixing defect 2 is what makes
defect 3's symptom disappear: the PostgREST update succeeds and the fallback is never reached.

**Fix:** the PostgREST error is captured and **leads** the raised message
(`postgrest=…; psycopg_fallback=…`); a missing DSN is reported **once per process** as the
configuration fact it is, instead of 486 identical lines, and the doomed attempt is skipped.

### ⚠️ And the fix nearly landed on dead code

`src/logging_helpers.py` defines `upsert_pending_update` **twice** — once at line 560, and once as
`upsert_pending_update_v2` — then rebinds the plain name at the bottom of the module:

```python
upsert_pending_update = upsert_pending_update_v2
```

`inspect.getsourcelines(lh.upsert_pending_update)` returns **line 4528**. Two definitions of one
name in one module: **the later silently wins**, and the first patch went to the body nobody
reaches. This is the LCC front-end duplicate-definition footgun, in Python, inside a single file.
Both bodies are fixed; a guard is **parametrised over both names**, and a second guard pins that
the *live binding* is the fixed body — so removing the rebinding fails loudly instead of silently
reinstating the unfixed implementation.

---

## 4. Defect 4 — `properties._new_property` is a pseudo-field, not a column

```sql
select count(*) from information_schema.columns
 where table_name='properties' and column_name='_new_property';   -- 0
```

**65 live rows** name it. The reconciliation did `properties.select("_new_property")` → **42703**,
the surrounding `except` printed and swallowed it, `matched` stayed `False`, and the row fell
through to the stale branch.

**Answering the brief's question directly: yes — the comparison was silently reading as
"no change".** It is not a *wrong write* (nothing is written from a failed comparison), but the
row was permanently unreconcilable while being counted as ordinary, and nothing anywhere said so.

**Fix:** a leading-underscore field is settled by its name alone (no round trip); any other field
is checked once against the schema and **cached per distinct field, not per row**. The check
**fails open** — an introspection hiccup must not reclassify a real column as unreconcilable — and
the count is reported as `unreconcilable`, with the field names, rather than vanishing.

Live breakdown of the drain's population:

| table.field | rows | reconcilable |
|---|---:|---:|
| `ownership_history.recorded_owner_id` | 1,893 | 0 (no `property_id`/`new_value`) |
| `properties._new_property` | 65 | 65 → **all 42703** |
| `properties.(null)` | 1 | 0 |

---

## 5. The honest count — the defect that hid the other four

Immediately after ~500 consecutive failures the service logged **`Pending updates cleanup
complete`**, then exited **0**. Nothing downstream could distinguish *ran and did nothing* from
*ran and worked*.

**Fix:**

- `resolve_applied_updates` returns a **`DrainReport`** — `attempted / succeeded / failed /
  resolved / compare_failed / unreconcilable`, plus **deduplicated** failure samples (a distinct
  message is worth seeing once, not 500 times).
- `wholesale_failure` is the specific shape that hid here: **`attempted > 0 and succeeded == 0`**.
  An idle step is not a failure; partial success is not wholesale.
- The caller logs at **ERROR** and never phrases a failed drain as completion.
- `main()` returns an exit code and `__main__` uses it: **`EXIT_DRAIN_FAILED = 3`**, distinct from
  the existing `2` (preflight abort) so the two are tellable apart from Railway's run status alone.

**Ingestion still runs first.** The drain stays non-blocking — a broken queue must not stop
ingestion — but a non-blocking step now has to be *loud*.

### ⚠️ The 1,001 lines are a log-window cap, not a run boundary

496 + 486 + 10 + ~9 info = **1,001**, and 1,952 of 1,959 rows are past the stale threshold. So the
per-defect counts in the brief are **floors**: the true per-run attempt count is **~1,950, not
~500**. An observed count that lands exactly on a round window size is a reading of the
instrument, not of the population — the same shape as A5's `815 = 1000 − 185`.

---

## 6. §5b — the registry gap is structural, and the answer is no

**`public-record-ingest` is not registered anywhere, and neither is `cms-ingestion`.**

- `feed_freshness_registry` on dia holds **5 rows**, all *tables* (`medicare_clinics`,
  `clinic_financial_estimates`, `deed_records`, `loans`, `sales_transactions`). A feed registry is
  **table-keyed, and a producer is not a table** — B6a's own lesson.
- `ingestion_tracker` has **no health consumer**. B6a's `run_log` → `v_pipeline_task_health`
  surface is **gov-side only**; dia has `run_log` and no view over it.

So the 45-day freshness bound on `medicare_clinics` was the **only** thing that could ever have
caught this, and it took two months. **A failing producer should be louder than a stale table.**
That is `B6d-cms-escalation`, still open and deliberately not built here — bundling a new detector
would make it impossible to tell which change moved the number.

---

## 7. What was NOT done

- **No SIGALRM / hang-guard work** (§5d). The 2026-08-31 run did not hang — it skipped in seconds.
  The hang-guard rule stands and is untouched; whether the *earlier* killed runs were an OOM on the
  ~45-minute `medicare_ingestion` step is still `B6d-cms-restart`, and still needs Railway logs.
- **No D1 work** (§5e).
- **No retirement of the 1,893 unreconcilable `ownership_history` rows.** They are now counted and
  named; deciding their disposition is a separate call with its own reversibility.
- ⚠️ **`metrics.persist_run_summary` defines an inner `_insert()` and never calls it** — the
  function writes a `run_log` event and no summary row anywhere. Found while tracing the skip path,
  surfaced not fixed (**B6d-pri-metrics**): it is a different blast radius and mixing it in would
  obscure which change moved which number.

---

## 8. Verification

Measured, not claimed:

| check | result |
|---|---|
| guard suite | **21 tests, 21 pass** |
| mutations | **20/20 verified RED** (comments stripped before matching) |
| full suite | **2,957 passed / 44 failed**, failure set **byte-identical** to the pre-change baseline taken in the same session |
| `pending_updates` | 1,959 rows, `reason` NOT NULL, 0 nulls |
| `properties._new_property` | 0 columns — confirms the 42703 |

⚠️ **One guard passed its own mutation on the first attempt.** `assert "wholesale_failure" in body`
stayed GREEN when `if _report.wholesale_failure:` was gutted to `if False:` — because the local
flag `drain_wholesale_failure` **contains that substring**. A guard that matches a shape is
defeated by a variable name (the N15c lesson). It now asserts the **AST attribute access**, and
that form goes RED.

⚠️ **A second guard was slicing past the end of the function it named.** A "next `def`/`class`"
boundary ran through `upsert_pending_update_v2` into a module-level `try/except: pass` and matched
it. The slicer uses **`ast` line spans** now — the language's own boundary — never a scan or a line
number (the P126/P128/P129 block-slice lesson). Comments are stripped **after** slicing.

### Live verification, once deployed (state deltas, not logs)

1. **`max(medicare_clinics.source_last_seen)` advances past `2026-06-25`.** ⚠️ Never
   `medicare_clinics.updated_at` — its max is 2026-08-13, written by the reconciled-econ denorm,
   and it reported this feed healthy straight through the outage.
2. **The `feed_stale` alert for `medicare_clinics` auto-resolves.** Read the alert ledger.
3. **A skip emits a tracker row with a reason** — a skipped run is distinguishable from a
   successful one and from a run that never fired.
4. **`pending_updates` writes succeed** — the row count moves off **1,959** with real `reason`
   values, and `report.succeeded > 0`.
5. **No 42703 and no repeated DSN lines in a full run's logs**; a missing DSN appears **once**.
6. **A wholesale-failed step exits 3.**

⚠️ **Read `succeeded` / `rows_upserted`, never `attempted` or `rows_fetched`** — and never the log
line's own claim of completion, which is the thing this change exists to remove.

⚠️ **The sandbox cannot reach Railway or `data.cms.gov`** (`http=000`; `api.github.com` = 200), so
the deploy state is established textually and by tracker arithmetic, and the CMS run itself cannot
be exercised here.

---

## 9. Durable lessons

1. **Before writing a fix for a logged message, grep `main` for that message.** It cost one command
   to learn the fix already existed and was not deployed. *Merged is not running* — fourth
   appearance in this arc.
2. **A bare `except: pass` before a fallback relocates every future diagnosis to the wrong layer.**
   The visible error must lead with the cause a caller can act on.
3. **Before setting the configuration a log asks for, check what happens if you do.** Here the
   answer was *a different NOT NULL violation, and possibly spurious INSERTs*.
4. **Two definitions of one name in one Python module: the later silently wins.** `inspect` tells
   you which body is live; grep does not.
5. **A count that lands on a round window size is a reading of the instrument.** 1,001 log lines
   were a viewer cap; the real figure was ~4× larger.
6. **A non-blocking step still has to be loud** — and the honest signal is `attempted > 0 and
   succeeded == 0`, reported and carried into the exit code.
