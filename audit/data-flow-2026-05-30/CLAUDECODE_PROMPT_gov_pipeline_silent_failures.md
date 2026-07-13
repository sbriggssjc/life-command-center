# Claude Code (GovernmentProject) — fix 4 silent pipeline task failures + revive the alerter

## Why (grounded live on gov `scknotsqkcheojiaewwh` 2026-07-13)

Feed-freshness audit finding: the gov **core data is current** (gsa_snapshots +
gsa_lease_events to 2026-06-01, sales to 2026-06-23, listings to 2026-07-01,
deeds ingesting today, daily/weekly/monthly/quarterly pipelines all ran today).
**But four pipeline tasks fail on EVERY run and have since 2026-03-30 — ~3.5
months — silently**, because the alerter that should surface them
(`pipeline_alerts.py`) last ran **2026-03-31**. The orchestrator reports
"completed", so daily health looks green while core enrichment is broken.

From `run_log` (event_type='error'), failing on every run:

| Step | Error | First seen | Impact |
|---|---|---|---|
| `cross-propagation_link_records` | `23505 duplicate key ux_sales_transactions_dedup_live` — `Key (dedup_natural_key)=(23697\|000040500000\|2019-12) already exists` | 2026-03-30 (18×) | **HIGH** — a single dup collision aborts the whole cross-propagation step; new sale→property links + cross-table propagation don't complete |
| `extract_brokers, agencies, link_owners` | `23503 FK violation` — delete/update on `brokers` blocked by `broker_enrichment_rules_broker_id_fkey` (`broker_id=2f9141cd-… still referenced`) | 2026-03-30 (9×) | **HIGH** — broker/agency/owner-link extraction from new sales crashes; broker-competition + owner links frozen since March |
| `frpp_annual_auto-sync` | `HTTP 404` from `catalog.data.gov/api/3/action/package_search?q="Federal Real Property Profile"…` | 2026-05-08 (11×) | **MED** — data.gov catalog URL/query is dead; FRPP annual refresh (building_condition, utilization, metro, fed employee count) can't run |
| `identity_hygiene_aliases_+_dedup_dry-run` | `42703 column owner_aliases.alias_type does not exist` (hint: `alias_name`) | 2026-04-13 (24×) | **LOW** — schema drift; it's a dry-run (no writes lost) but the hygiene pass produces nothing |

Also stale (separate — manual/less-frequent feeds, confirm they're scheduled, not
silently dropped): **OPM workforce ingest** last run 2026-03-17 (118d), **SF
comps ingest** 2026-03-31 (104d), **propagation_worker.py** 2026-04-09 (95d).

## Unit 1 (META, most important) — revive failure surfacing

The root reason this ran silent for 3.5 months is the alerter stopped. Restore
visibility so the NEXT silent breakage can't hide:
- Re-enable / fix `pipeline_alerts.py` (`generate_and_send_alerts`) so it runs on
  the pipeline schedule again and emails/surfaces per-task failures from
  `run_log` / `ingestion_tracker`. Confirm why it stopped (2026-03-31) — likely
  its own bug or it was dropped from the schedule.
- The orchestrator should NOT report an overall "completed" when N sub-tasks
  errored — surface a `completed_with_errors` (it already does for
  sync_properties) AND alert. A green top-line over red sub-tasks is the failure
  mode to kill.
- Optional (nice): a tiny `v_pipeline_task_health` view (latest status per
  step_name from run_log) so the health is queryable / surfaceable in LCC.

## Unit 2 — cross-propagation sales-link: upsert, don't crash on the dedup key

The step does a bare INSERT into `sales_transactions` and dies on the first
collision with `ux_sales_transactions_dedup_live` (natural key
`property_id|lease|period`). Make the write **idempotent**: `ON CONFLICT (…dedup
key…) DO NOTHING` (or DO UPDATE to merge), or pre-check existence. A pre-existing
row is the normal case (re-propagating the same sale), not an error — it must
skip, not abort the batch. This is the same dedup-respect rule as the R37
sales-writer fix; apply it to the cross-propagation writer
(`cross_propagate.py` / `sync_properties_from_sources.py` — whichever owns the
sales-link insert). Verify the step completes clean after.

## Unit 3 — broker extraction: handle the broker_enrichment_rules FK

`extract_and_link.py` (extract_brokers/agencies/link_owners) tries to delete or
merge a `brokers` row that `broker_enrichment_rules` still references → FK
violation aborts the step. Fix the broker-dedup/merge path to either repoint the
`broker_enrichment_rules.broker_id` to the surviving broker BEFORE deleting the
loser, or delete/cascade the dependent rules, or skip the merge when a rule
references it. (Mirror the entity-merge "move backrefs before tombstone" rule.)
Verify the step completes and brokers/agencies/owner-links extract again.

## Unit 4 — frpp_annual_auto-sync: fix or fail-soft the data.gov URL

The `catalog.data.gov/api/3/action/package_search` query 404s — the endpoint or
query changed. Update to the current FRPP open-data dataset URL/API (see the FRPP
source in CLAUDE.md §3), OR make the step **fail-soft** (log + skip, don't error
the pipeline) since FRPP is an annual dataset. Preferably both: fix the URL and
make a fetch failure non-fatal so a future data.gov change doesn't re-break the
whole run.

## Unit 5 — identity-hygiene: fix the owner_aliases column drift

The dedup dry-run references `owner_aliases.alias_type`, which doesn't exist
(the column is `alias_name`, per the DB hint). Update the query to the real
column (confirm the intended semantics — is it filtering by a type, or reading
the name?). It's a dry-run so no data was lost, but fix so the hygiene pass runs.

## Unit 6 — confirm the stale manual feeds are scheduled

OPM workforce (118d), SF comps (104d), propagation_worker (95d) haven't run in
months. Confirm each is either (a) intentionally manual/annual and fine, or (b)
dropped from a schedule and should be restored. OPM headcount + SF comps feed
gov property enrichment + the CM comps report — if they're meant to be recurring,
re-schedule; if manual, note the cadence so it's not mistaken for a break.

## Boundaries / verify

- GovernmentProject (`src/*.py` — cross_propagate / sync_properties_from_sources,
  extract_and_link, ingest_frpp_annual/frpp_auto_sync, the identity-hygiene step,
  pipeline_alerts, pipeline_runner); idempotent writes (upsert on the dedup key),
  FK-safe deletes, fail-soft external fetches; no schema change needed except
  confirming column names. Reversible / additive.
- **Verify:** after the fix, a pipeline run shows 0 failed tasks in `run_log`
  (or only genuinely-new failures), `cross-propagation_link_records` +
  `extract_brokers…` complete clean, FRPP either syncs or skips without erroring,
  and `pipeline_alerts` runs + would surface a seeded test failure. Re-query
  `run_log WHERE event_type='error'` for the last run — the four recurring steps
  are gone.
- Standard repo rules: feature branch, `python -m pytest tests/ -x -q`, don't
  commit to main.

## Documentation

Update GovernmentProject CLAUDE.md: note the four fixed pipeline-task failures
(cross-propagation dedup-upsert, broker FK-safe merge, FRPP URL/fail-soft,
owner_aliases column), the revived `pipeline_alerts` + `completed_with_errors`
surfacing, and the rule that the orchestrator must not report green over failed
sub-tasks.

## Bottom line

The gov data feeds are current, but four enrichment/linking tasks have failed
silently on every run since late March — brokers, owner-links, and sale→property
cross-propagation have been frozen for 3.5 months — because the alerter died at
the same time. Fix the four (idempotent sales upsert, FK-safe broker merge, FRPP
URL/fail-soft, owner_aliases column) and, most importantly, revive the alerter so
green-over-red can't hide the next one.
