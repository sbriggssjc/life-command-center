# Claude Code Prompt — GovernmentProject: TFC contacts-sync FK fix + Phase-2 auto-fetch (state lease)

**Repo: GovernmentProject (the gov Python pipeline), NOT life-command-center.**

## Context (read first)
- `docs/STATE_LEASE_INVENTORY_PIPELINE_PLAN.md` §9 (add-a-state recipe) + §10 (Phase 2
  automation — this prompt builds it).
- LCC repo `docs/STATE_LEASE_MULTI_STATE_ROLLOUT_PLAN.md` (the cross-repo plan) and
  `docs/STATE_GOV_LEASE_GAP_MEMO_2026-06-23.md` (origin; TX engine session wrap).
- The consumer side is DONE (LCC W5.2, live 2026-08-06): `state_lease_events` distress
  types → tasks, digest counts, and a 45-day producer-staleness alarm
  (`state_lease_producer_stale` in `lcc_health_alerts`). This prompt fixes the PRODUCER.

## Bug 1 (BLOCKING) — contacts sync is destructive and now violates an FK

Live failure (run #552, 2026-08-05, step 44 against gov db scknotsqkcheojiaewwh):

```
DELETE /rest/v1/contacts?data_source=eq.tfc_state_inventory → 409
23503: Key (contact_id)=(bd236f10-44a0-42bc-8454-3bd8cc1bb916) is still referenced
from table "true_owners" (true_owners_contact_id_fkey)
→ "State inventory sync failed" → step 44 ERROR → diff/events never run
```

The step's TFC-lessor→contacts sync does delete-and-recreate on
`data_source='tfc_state_inventory'`. Since the June build, at least one such contact was
promoted into `true_owners` — that promotion is the system WORKING (lessor → tracked
owner), and the ingest must never bulldoze it. Every future run fails the same way until
this is fixed, which means NO new state_lease_events ever flow.

**Fix:** replace delete-and-recreate with a non-destructive reconcile:
- Upsert TFC-derived contacts on a stable identity (data_source + normalized name — check
  the existing insert's dedupe key and mirror it; add a unique index if none exists).
- Contacts that disappeared from the current report: do NOT delete if referenced
  (true_owners or any other FK) — mark them (e.g. an `inactive_at`/metadata flag or simply
  leave them; follow the repo's existing soft-retire pattern if one exists). Unreferenced
  disappeared rows MAY be deleted if that was the old semantics, but prefer soft.
- The step must be idempotent and must NEVER abort the diff/eventing on a contacts-sync
  problem: wrap the sync so a failure there logs loudly + continues to the diff (the
  events are the product; the contacts mirror is enrichment).
- Add a regression test with a referenced contact fixture (FK present → run succeeds,
  contact preserved, diff still runs).

## Bug 2 (SMALL) — undated filenames are silently skipped

Run #552 skipped `ActiveLeaseSummaryReport.xls` / `...-May8.xlsx` / `....xlsx` with
"no parseable date": the snapshot date comes ONLY from a `- Month YYYY` filename suffix.
A fresh browser download never has that suffix, so the most natural operator action
silently ingests nothing.

**Fix:** filename date remains primary; add a fallback chain: (1) an as-of date parsed
from INSIDE the workbook if the report carries one (check the TFC sheet header), else
(2) the file's mtime month with a LOUD log line stating the assumption, else skip as
today. Keep the skip WARNING but make it actionable: print the exact rename pattern.

## Build — Phase-2 auto-fetch (the §10 unit)

Recon is DONE (2026-08-06): the stable machine URL is in the registry —
`state_lease_sources.dataset_urls[0]` = `https://web.tfc.texas.gov/home/showpublisheddocument/12`
(versionless endpoint, serves the CURRENT Active Lease Summary xls, no auth/JS; the
`/12/<stamp>` versioned form changes per upload — always use the versionless one).

Add a fetch pre-step to step 44 (flag-gated, e.g. `--auto-fetch` / config): for each
ACTIVE `state_lease_sources` row with non-empty `dataset_urls`:
1. Download `dataset_urls[0]` (respect a timeout; https only).
2. Content-hash the payload; compare against the latest stored snapshot's content
   fingerprint for that source (TFC may not repost monthly — if unchanged, log
   "unchanged since <date>", touch `last_run_at`, and STOP cleanly — no snapshot row).
3. If new: stage it into the state-dir with the dated-name convention
   (`<ReportName> - <Month YYYY>.xls`, month = current month), then proceed into the
   existing ingest → snapshot → diff → events → leads flow unchanged.
4. Update `last_run_at`/`last_snapshot_date` as the current code does.

**Scheduling + loud-failure:** register a monthly run using this repo's existing
recurrence mechanism (check how other recurring jobs run — Task Scheduler script, cron
doc, or runner; follow that precedent rather than inventing one). On ANY failure
(fetch, parse, diff), the run must surface loudly: log + write the failure into the
existing run_log/ingestion_tracker AND (if this repo already has a pattern for it)
notify; the LCC-side 45-day staleness alarm remains the backstop net — do not rely on
it as the only signal.

## Registry-driven, multi-state ready
Nothing TFC-specific may be hardcoded in the fetch pre-step: iterate the registry
(source_code, dataset_urls, format, cadence, lease_key_prefix). TX is simply the first
active row; LA/CA/FL onboard later as registry rows + parser adapters (LCC plan §3–§5).

## Verify (live, after merge)
1. Rename the pending downloads per Bug-2's pattern (or let auto-fetch stage a fresh one)
   and run step 44: the run must complete GREEN through diff/events even with the
   referenced contact present.
2. Confirm new `state_lease_events` rows exist (created_at > 2026-06-23) and report the
   event-type counts; the LCC `state-lease-consume` tick (GET dry-run) should then show
   a non-zero scan + the producer age reset.
3. Record results in the LCC repo `docs/audits/ROLLOUT_STATUS.md` (session log + a line
   in the multi-state plan §2) — cross-repo doc updates per standing practice.

## Do NOT
- Delete or orphan any contact referenced by true_owners (or any FK) — ever.
- Let a contacts-sync failure abort snapshot/diff/eventing again.
- Hardcode the TFC URL in code — it lives in the registry.
- Touch the LCC consumer side (W5.2) — it is verified live and out of scope.
