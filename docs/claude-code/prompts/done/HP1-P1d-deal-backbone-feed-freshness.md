# HP1-P1d — Nothing was watching the Salesforce opportunity feed. Make a dead producer impossible to miss.

**Repo: life-command-center** (owns LCC Opps `xengecqvemvfknjvbvrq`). Closes the last open item of HP1's
Finding 2. Small in code, and the **gate is a positive control**, not a green dashboard.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §HP1 (rows `HP1-P1a-fix` ✅, `HP1-P1a-nullsf` ❓, `HP1-P1a-dup` ⚠️,
`HP1-P1d`) · `docs/claude-code/STATUS.md` 2026-09-12 entries · `docs/audits/B6a_SKIPPED_STEP_HEALTH_BLINDNESS_2026-08-28.md`
and `B6a_FOLLOWUP_FRESHNESS_MONITOR_2026-08-28.md` · `docs/audits/B6d_FEED_EXPECTATION_GRADING_2026-08-29.md` ·
`mcp/opportunity-sync.js` (`ingestBatch`, post-Unit-3) · `CLAUDE.md` Core doctrines (B6a, P159a, P180, Class 11,
honest counts).

---

## Why this, why now — measured live 2026-09-12, and it is worse than "the table wasn't registered"

HP1-P1a proved the Salesforce opportunity feed delivered **608 records every 30 minutes for 36 days** while
**100% of its writes failed** on a duplicate key, under an HTTP 200. Fixed and verified: the 12:47 UTC run on
2026-09-12 wrote **608 UPDATEs, 0 inserts** — the first UPDATE that path has ever produced.

The question this prompt answers is **why nothing noticed for 36 days.** Three findings, all measured:

**1. `feed_freshness_registry` has exactly TWO active rows.** `om_intake` (`staged_intake_items.created_at`) and
`salesforce_sync` (`sf_sync_log.created_at`). That is the whole watched surface.

**2. 🚨 The row named `salesforce_sync` watches a DIFFERENT Salesforce pipe, and was correctly green the entire
time.** `sf_sync_log` logged **220,845 rows across all 39 days** of the outage — `sync_type` `object_intake`
(195,552 ok / 28,493 skipped / 16 error) and `crawl_run` (949 ok). **The opportunity ingest writes nothing to
`sf_sync_log` at all.** So the monitor was not merely silent: a reader checking "is the Salesforce feed healthy?"
got a confident **yes**, every day, from a row whose name says Salesforce and whose contents are a different
producer. Do not "extend" that row. It is correctly scoped to what it watches; the opportunity feed simply has no
watcher.

**3. The registry's shape cannot express this assertion.** It keys on `(src_table, ts_column)` and asks *did a
timestamp move on a table*. `bd_opportunities` has **at least two producers** — it holds **619** rows against the
feed's **608**, and the row with the newest `last_synced_at` had `sf_opp_id IS NULL` (that is `HP1-P1a-nullsf`).
A table-keyed row would therefore have gone **green on an LCC-side write while the Salesforce pipe was dead** —
precisely the B6a trap, and the reason the backlog already says *register the FEED, not the table.*

**Machinery that already exists and must be reviewed before anything new is built:** `producer_runs`
(`run_id, producer, lane, started_at, finished_at, duration_ms, status, skip_reason, trigger_source,
facts_written, facts_superseded, facts_expired, cost_usd, error_count, detail`). It is **producer-keyed** and it
already carries `facts_written` and `skip_reason` — the exact two columns this defect needed. It holds **2 rows**:
built for the exec-briefs producers and effectively unused. Extending it is very likely the right answer; say so
with reasons, or say why not.

---

## 1. Decide where the assertion lives — and justify it

Pick one, in writing, having read both:

- **(a) Extend `producer_runs`** to cover ingest producers, and have `ingestBatch` write one row per run carrying
  `total`, `succeeded`, `failed` (→ `facts_written` / `error_count`). A run that writes zero is then *visible as a
  run*, not as an absence.
- **(b) Add a producer-keyed lane to `feed_freshness_registry`** (a `producer` / `attribution_predicate` column) so
  a feed can be watched by *the subset of rows it is responsible for*, not by the table.

**(a) is the likely answer** — it records the run itself rather than inferring it from a side effect, which is the
whole lesson of this outage. But `producer_runs` being near-empty means you must check whether anything reads it
before you make it load-bearing. **Report what reads `producer_runs` today.**

## 2. The freshness assertion, with an honest predicate

Whatever the home, the alert must be on **the Salesforce-attributable subset**:

```sql
max(last_synced_at) filter (where sf_opp_id is not null)
```

⚠️ **Not `max(last_synced_at)`** (a second producer keeps it fresh — measured, 619 vs 608) and ⚠️ **not
`max(updated_at)`** (LCC-side writers move it; that column is what hid this outage for six weeks — HP1-P1a's own
corrected finding, proof row *Succasunna NJ* `last_synced_at` 09-07 vs `updated_at` 09-10).

Threshold: derive it from the measured cadence the way B6d derived the existing two (state the measurement). The
flow is every 30 minutes; a tolerance of hours, not days, is the point — **36 days is not a threshold problem, it
is a no-watcher problem**, so do not ship a 7-day expectation here just because the other two rows have one.

## 3. Reconcile with the detector that already shipped — do not duplicate it

Unit 3 of HP1-P1a-fix made `ingestBatch` return **non-2xx when `total > 0 && succeeded === 0`**. That is an
HTTP-layer detector and it now exists. State plainly how the two relate: the HTTP one catches *a run that fails*,
this one catches *a run that never happens*. **Neither covers the other**, and the 36-day outage would have been
caught by the HTTP one only if someone were reading Power Automate's run bodies — nobody was; the flow history was
green throughout. Say in the write-up which failure each catches and which failure neither catches.

## 4. 🚨 The gate is a POSITIVE CONTROL — this is the deliverable

**Class 11: a detector that has never fired is not a detector.** A green reading proves nothing. Required, pasted:

1. The alert reading **now**, with the feed healthy → **green**, with the actual timestamp and computed age.
2. The same alert against a **simulated stale feed**, in a **rolled-back transaction** (back-date the
   Salesforce-attributable `last_synced_at` values) → **fires**, with the alert text it would emit.
3. The alert evaluated against the **historical outage window** (2026-08-04 → 2026-09-12): confirm it **would have
   fired**, and on roughly which date it first would have.
4. Proof that a **write by the non-Salesforce producer does NOT clear it** — the B6a trap, tested directly:
   touch a row with `sf_opp_id IS NULL`, show the alert **still fires**. **If this one does not hold, stop and
   report — the assertion is table-keyed in disguise.**

If any of the four does not hold, **report it and stop**. Do not adjust the expectation to fit the reading.

## 5. Wire it to somewhere a human actually looks

Name the surface and wire it: the existing health/inbox lane, not a new dashboard. A monitor nobody reads is the
same failure with extra steps. If the honest answer is "there is no surface that Scott reads daily," say that and
propose the smallest one rather than inventing a page.

## 6. What NOT to do

- Don't touch the `salesforce_sync` registry row. It is correct for what it watches.
- Don't register `bd_opportunities` table-keyed "for now." That is the defect, shipped.
- Don't backfill or repair `bd_opportunities` data — the feed is healthy and healing itself.
- Don't resolve `HP1-P1a-nullsf` here (identifying the LCC-side producer). **Do** report what you learn about it
  in passing, since the predicate in §2 depends on it being real — and it is: 619 vs 608, measured.
- Don't add a `LastModifiedDate` filter to the PA flow. The full refresh is what heals a backlog.

## Guard + ship

Tests: the predicate (including a row with `sf_opp_id IS NULL` that must **not** satisfy it), the threshold
computation, the positive control as an actual test rather than a one-time probe, and the historical-window
replay. Full suite green. Branch → PR → CI → merge → redeploy **both** Railway services (note: the SF ingest path
is served by `tranquil-delight`, which mounts the MCP in-process via `mountLccMcp(app)` — **HP1-P1a-dup** — so the
standalone MCP is not in this path, but MCP-tool changes still need it).

⚠️ **The standalone MCP has no `/version` route** (`Cannot GET /version`) — "merged is not running" cannot be
verified there. See backlog **DEPLOY1-mcp-version**; fixing it is a fair side-quest if it is two lines.

## Ship + record

Update `PLANNED-BACKLOG.md` (`HP1-P1d`, and note the `salesforce_sync`-is-a-different-pipe finding wherever feed
health is described), `CURRENT-STATE.md`, `STATUS.md`, and the B6a follow-up audit doc — that doc's thesis now has
its sharpest real instance, and it should say so.

Report: where the assertion lives and why, what reads `producer_runs` today, the measured cadence behind the
threshold, **all four positive-control readings pasted**, the surface it is wired to, and anything learned about
the non-Salesforce producer.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
