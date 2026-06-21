# Claude Code — R61: self-healing GSA ingest (don't let a stale snapshot block a fresh file)

## Why (live activation, 2026-06-21)
The R57 discovery fix works — `gsa_auto_sync` now reaches gsa.gov (browser UA) and resolves the
latest file (`May-2026-External.xlsx` from gsa.gov, not the stale catalog). But on the live run it
reported **"up to date (latest ingested: 2026-06-01, available: 2026-05-01)"** and skipped the
ingest. Root cause: the OLD broken ingest had written **phantom snapshots** (2026-04-01 / 05-01 /
06-01) — stale March data (identical fingerprint `ba024…`) mislabeled with the run-month. The
"up to date" check is **purely date-based** (`latest_ingested_date >= available_date`), so a
future-dated stale snapshot makes it think we're current and it never pulls the real file.

The 3 phantom snapshots were deleted live (latest is now real `2026-03-01`; `v_gsa_source_health`
back to `ok`). This prompt makes the pipeline self-heal so it can't recur.

## House rules
gov Python (`src/gsa_auto_sync.py`), surgical/reversible, reuse the R57 content-hash machinery
(`gsa_source_pull_log` / the fingerprint). `py_compile` + tests green. No new infra.

## Unit 1 — make the freshness check content-aware (the core fix)
The "up to date" decision must not be fooled by a date label alone. When the latest available file
is resolved, compare its **content fingerprint** to the latest stored snapshot's fingerprint:
- If the available file's content **differs** from the latest stored snapshot → **ingest it**, even
  if its file-month date is ≤ the latest stored snapshot_date (because a ≥-dated stored snapshot
  may be a stale/mislabeled phantom). Label the new snapshot by the **file's own month** (already
  done in R57) and let the content-hash guard write it.
- If the available file's content **matches** the latest stored snapshot → genuinely up to date,
  skip (record `source_unchanged`, as R57 does).
This way a stale future-dated snapshot can never block a real fresher file — the decision is driven
by content, not by a possibly-wrong date label.

## Unit 2 — detect + self-heal phantom (mislabeled-stale) snapshots
Add a guard that flags/heals the phantom pattern the old ingest created: a snapshot whose content
fingerprint is **identical to an earlier month's** snapshot but labeled a **later** month (a stale
copy mislabeled by run-date). Options (pick the safe one):
- At minimum, **surface it** — extend `v_gsa_source_health` (or a sibling view) to report
  "N future-dated snapshots content-identical to an earlier month" so the R56 monitor flags it.
- Optionally **auto-heal** — on ingest, if the latest stored snapshot is a content-duplicate of an
  earlier month AND a different real file is available, treat the duplicate as non-authoritative
  (don't let it gate). Do NOT hard-delete historical snapshots automatically — flag for review;
  the one-time cleanup of the existing 3 was done manually.

## Unit 3 — never write a phantom again (root-cause guard)
Ensure the new code path cannot recreate the bug: a snapshot is only written labeled by the **file's
actual month** (never the run-date), and the R57 content-hash guard skips byte-identical writes. Add
a test: a run where the current-month file 404s and only an older file is available must ingest the
older real file (labeled its own month) rather than writing a run-dated stale copy.

## Verify (report back)
- A test proving Unit 1: given a stored snapshot dated later than an available file but with
  different content, the ingest re-ingests the available file (doesn't skip as "up to date").
- A test proving Unit 3: current-month 404 → ingest latest available, labeled by file month, no
  run-dated phantom.
- `v_gsa_source_health` (or sibling) reports phantom-pattern count (0 now, after the manual cleanup).
- `py_compile` + suite green; reversible.

## Bottom line
R57 made discovery reach the live files; R61 makes the freshness decision **content-aware** so a
stale/mislabeled snapshot can never again block a real fresher file, surfaces the phantom pattern to
the monitor, and guarantees the ingest labels by file-month — so the GSA feed self-heals instead of
silently freezing.
