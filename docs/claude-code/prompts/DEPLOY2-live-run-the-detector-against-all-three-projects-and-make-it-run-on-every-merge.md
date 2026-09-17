# DEPLOY2-live — run the unapplied-migration detector live against all three projects, fix its two window defects, and make it run on every merge

**Filed:** 2026-09-17 (Cowork). **Owner:** LCC (`scripts/build-brief-collector.mjs` / the DEPLOY2 detector
module, `.github/workflows/`, `test/`). **Read first:** backlog rows `DEPLOY2-unapplied` (the design and
its pre-measurement: 885 files / 742 unique timestamps, filename order ≠ recency) and `DEPLOY2-coverage`
(the two window defects, measured); `docs/os/BUILD-TURN-PROTOCOL.md` ③ (the hand check that replaces
you until you run).

## Why now

Three migrations merged and never applied in two days — `20261102210000_lcc_flags_geocode_on_geocodio_daily_cap.sql`
(LCC Opps; the Geocodio cap ran uncapped-by-design until Cowork applied it), `20260917120000_lcc_pri2_on_reason_first_order.sql`
(LCC Opps; **the Priority tab returned 502** with the flag ON until Cowork applied it), and ID3d's
migration landing in the wrong repo. The detector that exists to catch this has never run live, and its
shipped window would have missed two of the three (`dialysis/` excluded; filename-sorted window).

## What to build

1. **Fix the window** (DEPLOY2-coverage a + b): include `supabase/migrations/dialysis/**` (this repo
   owns Dialysis_DB schema — `CLAUDE.md` doctrine table; `government/` stays excluded, it is retired);
   select the window by **git add-date** (`git log --diff-filter=A --format=%ct -- <file>`), not by
   filename sort; default window = files added in the last 30 days, plus any file named in the PRs
   being checked.
2. **Run it live, now, against all three projects** with the credentials the collector already uses
   (LCC Opps `xengecqvemvfknjvbvrq`, Dialysis_DB `zqzrriwuavgrquhisnoa`; government is read-only
   evidence — report, never apply; its owner is `government-lease`). For each file in the window:
   the object(s) it declares (`CREATE TABLE/VIEW/FUNCTION/TRIGGER/INDEX`, `ALTER TABLE … ADD COLUMN`,
   `cron.schedule`) → present live? For functions and views also **body-hash**: `md5(pg_get_functiondef)`
   / `md5(pg_get_viewdef)` against the file's `CREATE` block normalised the same way (existence alone
   passed XB2-precision). Output: a table `file · project · object · state (applied / missing /
   stale-body / unparseable)`; the first live run's table goes into the response verbatim.
3. **Make it run on every merge to `main`**: a GitHub Actions job on `push: main` that runs the
   detector over the files the merge added and **fails the job** (not the merge — it is after the
   fact) with the table, posting it as a commit comment; plus the existing daily collector run. A
   red job is the signal Cowork's loop step 4a currently supplies by hand.
4. **Do not apply anything.** Missing/stale objects are reported; Cowork applies from the repo file
   with a fingerprint (protocol ③). If the first run finds more than the three known incidents, list
   them with the PR that merged each (`git log --diff-filter=A --format='%h %s' -- <file>`).
5. Tests: the add-date window catches a file with an old timestamp added yesterday; `dialysis/` is in
   and `government/` is out; a stale-body view is reported as `stale-body`, not `applied`; a positive
   control with a fixture migration whose object does not exist.

## Prohibitions

- ⛔ Nothing applied to any database. ⛔ No gov-project writes. ⛔ Do not rename the collector's
  existing outputs (XB1/XB2 consumers read them).

## Reporting

The first live table for all three projects; the three known incidents shown as caught; any new
finds with their PR; the CI job's first run link. **Parked:** anything you noticed out of scope, one
line each (goes to `docs/claude-code/PARKING-LOT.md`). If any step was skipped, say so.
