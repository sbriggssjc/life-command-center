# DEPLOY2-drop-aware — the unapplied-migration check goes red when a later migration deliberately DROPs an earlier one's objects

**Filed:** 2026-09-18 (Cowork round 32, from SBN-13 — the GitHub "Run failed: DEPLOY2 — merged-migration
application check - main (6656f86)" mail, 11:41 UTC). **Owner:** LCC (`scripts/build-brief-collector.mjs`,
`test/`, `.github/workflows/deploy2-unapplied-check.yml`). **Read first:** the DEPLOY2-unapplied header in
the collector (lines ~205–290), backlog `DEPLOY2-unapplied`, `DEPLOY2-coverage`, `DEPLOY2-stale-body`.

## Measured (Cowork, 2026-09-18)
Every declared object in the current migration window exists live on Dialysis_DB and LCC Opps **except
two**: `dia_recon1_lease_active_past_expiration_guard()` and `trg_dia_recon1_lease_active_guard`, declared by
`20260917180000_dia_recon1_…` and **dropped on purpose** by `20260917220000_dia_recon2_…` (`drop trigger if
exists …; drop function if exists …`) — the RECON2 rule that a lease never goes inactive on date alone. The
check reads their absence as "RECON1 merged but never applied" and fails `main`. It will fail on every run
until the window rolls past RECON1. (The 4 annotations in the mail = 2 missing objects × the two reports;
confirm from the run log.)

## Build
In the collector's window parse, also collect `DROP FUNCTION|TRIGGER|VIEW|TABLE|INDEX|TYPE|POLICY [IF EXISTS]
<name>` statements (comments stripped, same as CREATE). An object whose latest in-window statement is a DROP
(by filename order) is **retired**, not probed; report it as `retired_by <later file>` at `info`, never
`unapplied`. A CREATE after a DROP re-arms the probe. Test with the RECON1/RECON2 pair (must go green) and a
control where a DROP precedes the CREATE (must still probe). Keep everything else untouched — `DEPLOY2-stale`
/ `-coverage` are separate rows.

⛔ No probe-RPC change. ⛔ STATUS entry labelled **(CC)**. **Parked:** one line each.
