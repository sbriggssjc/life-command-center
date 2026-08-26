# Prompt 133 — Schedule the ownership-chain drafter (P131) as a nightly cron

## Context
P131 shipped the deterministic ownership-chain drafter: `POST /api/ownership-chain-draft-tick`
(flag `OWNERSHIP_CHAIN_DRAFT`, now ON), which drafts `establish_ownership_history` research cards from
`gov.v_ownership_transitions_portfolio` into `lcc_clean_assist_proposals` (source
`ownership_chain_draft`). It was drained manually (6 POST runs → `already_drafted:545, fresh:0`). New
lane rows (as gov transitions land / new assets mint) currently get **no draft until someone re-runs it
by hand**. A one-shot repair of a recurring producer is a chore repeated silently forever — pair it
with a sweep (CLAUDE.md doctrine).

## Ask
Add a **pg_cron job on LCC Opps** that POSTs the tick nightly via `lcc_cron_post` (the existing
Vault-key → `pg_net` → Railway `/api/*` path used by the other scheduled sweeps).

- **Schedule:** once daily, off-peak, staggered from the existing 05:45/06:25/06:35/06:40 jobs — e.g.
  **06:50 UTC**. Pick a free minute; don't collide.
- **Endpoint:** `POST /api/ownership-chain-draft-tick` (apply mode). The handler already caps at 100
  rows/run and is idempotent (`already_drafted` vs `fresh`), so a nightly run is safe and cheap; on a
  quiet night it writes 0.
- **Bounded + honest:** the handler already reports `written_draftable` / `already_drafted` / `fresh`.
  Log the run to whatever run-log table the sibling ticks use (open the row before the work, close it
  after — a row written only on the way out can't record a mid-flight drop). If it stays capped at 100
  and there's a backlog, that's fine — the next night continues; just don't report "done" when capped.
- **No-op when flag off:** if `OWNERSHIP_CHAIN_DRAFT` is unset the handler already no-ops; the cron
  firing is harmless. Keep it that way (don't gate the cron itself on the flag).

## Registry
The tick is flag-gated; ensure `OWNERSHIP_CHAIN_DRAFT` has (or gets) a `feature_flags_registry` row
with `state='on'` and the cron noted, so the dormant-capability surface stays honest.

## Verify
- `cron.job` shows the new entry; after the first fire, the run-log row reads a real disposition
  (`already_drafted:545` today, `fresh:N` when new transitions exist).
- Reversible: the drafts remain `delete from lcc_clean_assist_proposals where source='ownership_chain_draft'`.

## Deploy
DB-only (pg_cron on LCC Opps) — live immediately, no Railway redeploy. If a run-log table or registry
row needs a migration, apply it first. Commit with the repo trailer.
