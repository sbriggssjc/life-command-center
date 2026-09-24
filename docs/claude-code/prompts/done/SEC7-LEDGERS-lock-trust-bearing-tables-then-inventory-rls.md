# SEC7-LEDGERS — anon can write the tables the app trusts to decide identity (phase 1 of SEC7)

Backlog: `SEC7` (refreshed), `DIA-REDIRECTS-ANON-WRITE`, `MERGELOG-GAP-broken-chains`. Source: MERGELOG-GAP (CC) + Cowork round 77 live measurement.

## Measured (Cowork, 2026-09-24, live)

These tables have RLS **off** and `anon` holds INSERT/UPDATE/DELETE, so anyone with the public key can write them through PostgREST:

| DB | table | why it matters |
|---|---|---|
| dia | `dia_property_redirects` | `dia_resolve_property_id()` and the LCC merge-log reconcile follow it, so one row can move LCC entities |
| dia | `dia_property_merge_backup` | the undo store for reversible merges |
| gov | `gov_property_merge_backup` | the same, on gov |
| gov | `gov_agency_aliases` | GOV-REGISTRY2's resolver reads it, so a row can re-point an agency |

- **Scale:** tables with RLS off and anon-writable number **60** on Dialysis_DB, **50** on gov and **124** on LCC Opps. The old `SEC7` row said "34 exposed tables"; it's stale.
- **Context:**
  - `property_merge_log` and `properties` have RLS on (gov `properties` has anon read-only).
  - `government_agencies` has RLS on with authenticated read.
- **Broken chains:** 15 `dia_property_redirects` rows resolve to no live survivor (`MERGELOG-GAP-broken-chains`), e.g. 37613 → 35601. Nobody knows yet whether any came from a bad write.

## Ask

1. **Inventory writers before locking anything.** For each of the four tables above, find every writer and the role it runs as:
   - SQL functions and their SECURITY DEFINER status;
   - cron jobs;
   - edge functions (service role?);
   - LCC `domainQuery` calls (which key?);
   - Power Automate flows.
   Use `postgres_logs` / `edge_logs` for the last 7 days to catch writers the code search misses.
2. **Lock the four tables.**
   - Revoke INSERT/UPDATE/DELETE from `anon` and `authenticated`; keep reads only where a named reader needs them.
   - Enable RLS with a service-role policy, following the `government_agencies` pattern.
   - Every legitimate writer must still work. Prove it by exercising each one once (rolled back where possible).
   - Add a guard (SQL test or LCC test via `has_table_privilege`) that fails if anon regains write.
3. **Broken chains.** For each of the 15, find where the kept row went (a later redirect, a merge backup, a hard delete) from evidence. Repair the chain where the evidence is unambiguous and log it; otherwise report. Say whether any row looks like a non-merge write.
4. **Inventory the rest, don't flip it.** For the 60 / 50 / 124 tables, classify each: trust-bearing ledger / operator data / cache or log / unused. List the top 20 by risk with their writers. Flipping them is a later phase (SEC7-phase-2). Run anything risky on a Supabase branch first, as SEC7 says.

Tests: the privilege guard, plus each writer still succeeding after the lock. Each needs a mutation that turns it red.

## Done means

- `SEC7` row refreshed with the real counts.
- `DIA-REDIRECTS-ANON-WRITE` and `MERGELOG-GAP-broken-chains` updated.
- Gov migrations in government-lease; dia migrations in the repo that owns them (CLAUDE.md).
- No Railway deploy unless LCC code changes.
