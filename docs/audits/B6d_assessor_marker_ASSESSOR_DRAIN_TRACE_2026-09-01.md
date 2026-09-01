# B6d-assessor-marker — the assessor drain had no trace, and the trace is the verdict

**Date:** 2026-09-01 · **Repo:** Dialysis · **DB:** Dialysis_DB `zqzrriwuavgrquhisnoa`
**Shipped:** `src/assessor_queue_marker.py` (new), `src/assessor_enrichment.py`,
`tests/test_b6d_assessor_marker.py` (28 tests, **23/23 mutations RED**).
**Not shipped, deliberately:** no cron, no enqueuer, no yield fix.

---

## 1. The finding

`python -m src.assessor_enrichment --from-queue 25` was run manually on 2026-09-01 — its
first execution ever — and returned `processed 25, enriched 0, fields_updated 0, errors 0`
in **114.8 s**. ~4.6 s per property of real elapsed work, and no record of what that work
found. Verified live afterwards over all 1,365 `property_metadata_backfill_queue` rows:

| probe | result |
|---|---|
| `attempts > 0` | **0 of 1,365** |
| `last_attempt_at` set | **0** |
| `last_error` set | **0** |
| `max(enqueued_at)` | **2026-05-21** — one-shot, no enqueuer |

So *the source genuinely has nothing for these parcels* (retire the lane) and *every call
is failing* (fix the adapter) were **indistinguishable from outside**, and they have
opposite remedies.

### Why nothing was ever written

`run_queue_batch` wrote a marker on exactly two paths, and neither could fire:

* the **success** path — never reached, because `apply_enrichment` returned 0 every time;
* the **exception** path — never reached, because nothing raised.

The two paths that actually ran — *the source returned nothing* and *the write filled
nothing* — wrote nothing at all. This is B6a's `record_skip` lesson at the row grain: a
branch that declines to act must still emit, or "skipped", "never selected" and "healthy
and quiet" render identically.

---

## 2. Unit 1 — what shipped

`src/assessor_queue_marker.py` owns the vocabulary (pure, no I/O, so the classification is
testable without a database or an API key, and each reason has exactly one definition
rather than a literal repeated per call site).

**Every processed row now writes `attempts + 1`, `last_attempt_at`, and a reason** — on
every outcome, success included (reason cleared).

| code | meaning |
|---|---|
| `skip:no_writable_gap` | not asked — every gap on this row is `land_area`/`tenant`, which this writer cannot close |
| `skip:no_address` | not asked — no street address to key on |
| `skip:no_locality` | not asked — address but no city, ZIP or county |
| `source:no_response` | asked — the source returned no usable record |
| `source:no_mapped_fields` | asked — record carried no value for any mapped field |
| `source:fields_already_present` | asked — values returned, every target already populated |
| `source:gap_not_closed` | asked — fields written, none of them a field this row's gap tests |
| `error:<Class>: <msg>` | the request or the write raised |

The `skip:` / `source:` / `error:` prefixes make the request-made split machine-readable.
Collapsing any two of these is the P181 defect the marker exists to remove — a genuine "no
coverage" and a hopeless "we never asked" are different findings with different fixes.

**The selection reads the marker back** (P136 — a marker nothing selects on changes
nothing), by two mechanisms, both needed:

* a **cooldown** filter (`ASSESSOR_QUEUE_RETRY_DAYS`, default 30) — what makes two
  consecutive runs structurally unable to return the same rows;
* an **order** of `last_attempt_at ASC NULLS FIRST`, then `priority`, then sale price —
  never-attempted first, then least-recently-attempted, so once every row carries a marker
  the drain keeps rotating instead of parking. Value ranking is preserved one rung down.

**30 days is sized from the two clocks that can change the answer**, not picked for
roundness: our inputs turn over daily-to-weekly (`public_record_ingest` fills the APN;
the nightly pg_cron pass fills address/locality), while the assessor's own record turns
over on an annual assessment cycle. At the drain script's own "recommended weekly", each
row gets ~1 retry per month instead of ~4.

Also fixed on the way through, each a defect the silence was hiding:

* **`stats["fields_updated"] += len(fields)`** — `apply_enrichment` returns an **int**, so
  the first genuine fill this worker ever produced would have raised `TypeError` and been
  counted as an error. Latent only because it never once succeeded.
* **A failed selection returned `[]`** — indistinguishable from an empty queue, so a broken
  read would report a clean, quiet, successful run forever. It raises now, and `main()`
  exits `EXIT_MARKER_FAILED = 3`.
* **A failed marker write was swallowed** by `except Exception: pass` — a marker that
  silently fails to land reproduces the whole defect. Counted as `marker_write_failures`,
  and non-zero exits 3.
* **`apply_enrichment` returned a bare `0` for four different situations.** An `outcome`
  sink now names which.

The marker touches **only** `attempts` / `last_attempt_at` / `last_error`. `status` and
`resolved_at` stay owned by the closure trigger — two writers for one state transition is
the defect these repos keep re-paying for.

---

## 3. Unit 2 — the reason distribution

⚠️ **The live run could not be executed from this sandbox** — no `OPENAI_API_KEY`, no
Supabase env, and running it would incur real AI spend and write to production. Stated,
not worked around. What follows is measured against the live DB.

### 3a. The two-run distinct-ids proof — run live, on production data, rolled back

A `DO` block ran both selections against the real view and `RAISE`d to roll back
(**verified 0 residue afterwards: `attempts<>0` = 0, `last_attempt_at` = 0, `last_error` = 0**):

| selection | run 1 | run 2 | **overlap** |
|---|---:|---:|---:|
| pre-B6d (priority + price) | 25 | 25 | **25 — identical rows, forever** |
| marker-aware (this change) | 25 | 25 | **0** |

Identical ids twice *is* the diagnosis (Dead-End playbook Class 12). And the first run of
both selections is **the same 25 rows** — the change alters *rotation*, not *ranking*.

### 3b. The `skip:` tier is fully determinable without any API call

| reason | head 25 | all 662 open |
|---|---:|---:|
| `reaches_the_source` | 21 (84%) | **435 (65.7%)** |
| `skip:no_writable_gap` | 4 (16%) | **223 (33.7%)** |
| `skip:no_address` | 0 | 4 (0.6%) |

### 3c. ⚠️ The largest reason is a COLUMN MISMATCH, not a coverage gap

The closure trigger `resolve_metadata_backfill_queue_on_property_update` re-tests each gap
against `NEW.land_area` and `NEW.tenant`. `apply_enrichment` writes **`lot_sf`**, never
`land_area`, and has **no `tenant` mapping at all**.

**`land_area` is in ACRES and `lot_sf` is in SQUARE FEET.** Measured over 3,702 properties
carrying both: **0 are equal**, median ratio **exactly 43,560**, 3,490 (94%) within 0.1%.

Consequences, over the 662 open rows:

* **223 (34%) have ONLY unwritable gaps** — a perfect answer cannot close them, ever;
* **203 more are mixed** — a perfect answer narrows `missing_fields` and the row *stays open*;
* only **236 (36%)** could possibly be **closed** by this worker.

This is the C1 "lane predicate column vs writer column" defect: the two sides are on
different columns and nothing errors. Here it is worse than C1 — the columns hold the same
fact in different **units**, so the fix is a conversion, not a new source.

### 3d. ⚠️ There is no county assessor adapter. The "adapter" is GPT-4o's memory.

`src/assessor_enrichment.py` contains **no HTTP call of any kind** — no `requests`, no
`httpx`, no `urlopen`, no county URL. Its only external call is one
`client.chat.completions.create(model="gpt-4o", ...)` asking the model to recall assessor
data. The 4.6 s/property is OpenAI latency.

This is the **same finding the gov repo already recorded one domain over** (gov CLAUDE.md,
ORE Phase A1): *"the originating audit assumed the assessor scraper already fetches parcels
… It does NOT — gov parcels are AI echoes of the recorded owner … There is NO pipeline that
fetches an assessor parcel-detail page."* It is true on the dia side too, and nothing in
this module's name, docstring or cron script says so.

### 3e. The module's own stated premise holds for 9% of the queue

The docstring says it *"uses the parcel APNs already in the database"* and *"runs as a
second-pass enrichment after `public_record_ingest` has populated `parcel_records` with
APNs."* Live:

* **490 of 662 open rows (74%) have no APN link at all**;
* of the **435** that reach the source, **375 (86%) have no APN** — the prompt is sent with
  `APN: Unknown`;
* of the head 25 the worker actually processed, **5 had an APN**.

### 3f. The inputs are static, so the cooldown has little to surface

`parcel_records` for open-queue properties: **180 rows, 0 created in the last 30 days,
newest 2026-07-13.** Fleet-wide `parcel_records` is alive (14 new in 30 days, newest
2026-08-31) — but none of it lands on this population.

### 3g. ⚠️ The internal auto-resolve is also nearly exhausted

All 703 `captured` rows closed via the trigger — i.e. some *other* writer updated
`properties`. But the pace has collapsed:

| month | resolved |
|---|---:|
| 2026-05 | 14 |
| 2026-06 | 174 |
| 2026-07 | **510** |
| 2026-08 | **5** |
| 2026-09 | 0 |

At 5/month the remaining 662 take ~11 years. **"The other paths will handle it" is not
true either** — which is worth saying plainly, because it is the argument that would
otherwise make retiring this lane feel free.

---

## 4. Verdict — **RETIRE the AI lane; the only defensible fix is a 1-line unit conversion**

The reasons support retiring, and the honest form of that is not "the queue is fine".

**Retire the AI-recall drain.** It cannot be graded into working:

* it contacts no assessor — it asks GPT-4o to recall parcel-level assessor facts, which is
  the fabrication risk this repo's own data-write discipline forbids (*"never fabricate — a
  field the source doesn't state stays blank"*). A model that returns `year_built: 1987` for
  an address it has never seen is indistinguishable from one that knows;
* it is asked with `APN: Unknown` on **86%** of the rows it would reach, i.e. without the
  key its own docstring says it depends on;
* its one real run wrote **0 fields on 25 properties**;
* even at 100% accuracy it could **close only 236 of 662 rows (36%)**.

**Do NOT wire the cron.** `scripts/cron/metadata-backfill-queue.sh` is currently unscheduled
(`dia_producer_registry.enabled = false`, "SCHEDULE UNCONFIRMED"). Scheduling it would drain
662 rows once, then run empty forever against a queue whose `max(enqueued_at)` is
2026-05-21 — and would spend ~$0.01 × 435/month to keep writing `enriched: 0`.

**Name the adapter fix, and it is not an adapter.** The single highest-value change here is
**`land_area = lot_sf / 43,560`** in `apply_enrichment`'s field map — a unit conversion,
already proven by 3,702 paired rows. That alone takes the closable population from **236 to
439 (36% → 66%)** *for any source*, including the internal pg_cron pass and any future real
assessor fetcher. **It is filed, not shipped**, because it is a yield change and the brief
scoped this to the marker.

**The ~646 genuine remaining gaps stay open for a different source** rather than being
falsely owned by a lane that cannot fill them. A documented ceiling beats a weekly job that
produces nothing.

---

## 5. Backlog

| id | item |
|---|---|
| **B6d-assessor-landarea** | `land_area = lot_sf / 43560` in `apply_enrichment`. Closable population 236 → 439. Cheapest, highest-yield, source-agnostic. |
| **B6d-assessor-tenant** | `tenant` has no writer in this path at all. Decide whether it belongs in this queue. |
| **B6d-assessor-retire** | Retire the AI-recall lane per §4; keep `dia_producer_registry.enabled = false`. |
| **B6d-assessor-enqueuer** | The queue is a one-shot (`max(enqueued_at)` 2026-05-21) with no enqueuer. Any future producer needs one *before* a schedule. |
| **B6d-assessor-realfetch** | If assessor data is genuinely wanted, it needs a per-county fetcher (the SOS Unit-F pattern), not a recall prompt. Size *after* the unit fix, when the residual gap is known rather than assumed. |
| **B6e-ci-mask** | Untouched, as instructed. `ci.yml` uses `\|\| echo` 5× so no test here can fail a merge. Tests were run locally. |

---

## 6. Verification

* `python3 -m pytest tests/test_b6d_assessor_marker.py -q` → **28 passed**, run locally
  (CI cannot fail — B6e-ci-mask).
* **23/23 mutations RED**, function-scoped via `ast` spans.
  ⚠️ The mutation harness itself had to be fixed first: a whole-file
  `replace(old, new, 1)` for `stats["fields_updated"] += fields` landed on **`run_batch`
  (line 344)** instead of `run_queue_batch` (564) — the same expression exists twice — and
  the mutation "survived" a test that was in fact correct. **A mutation scoped to a file
  rather than to the function it names can silently grade the wrong code.**
* Two survivors were genuine test gaps, both from **stubbing the function under test**:
  `_write_marker` and `enrich_property` were monkeypatched, so mutating their real bodies
  changed nothing. Both now have direct unit tests.
* Live two-run proof (§3a) ran against production and rolled back; **0 residue verified**.
