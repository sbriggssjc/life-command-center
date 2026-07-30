# W2.3 — Watermark-based incremental mirror sync (2026-07-30)

**Branch:** `claude/lcc-watermark-incremental-sync-4ld5zx` · **Audit:** 3.3.4 / 3.3.5 ·
**Plan:** `docs/audits/LCC_Audit_Rollout_Plan.md` (W2.3)

## What shipped

Replaced the three page-ceiling `pg_net` mirror legs with a resumable keyset (watermark)
walk. All three migrations were **applied live** and are committed:

| File | Target | Change |
|---|---|---|
| `supabase/migrations/20260812140000_lcc_w2_3_watermark_mirror_sync.sql` | LCC Opps | watermark table, `source_updated_at` on the 3 mirrors, 3 apply helpers, `lcc_mirror_tick`, per-leg freshness, watchdog allowlist, cron repoint |
| `supabase/migrations/government/20260812140000_gov_w2_3_portfolio_updated_at.sql` | gov | append `updated_at` to `v_property_attributes_portfolio` + `v_property_owner_facts_portfolio` |
| `supabase/migrations/dialysis/20260812140000_dia_w2_3_portfolio_updated_at.sql` | dia | same append (forward-compat; see dia blocker below) |

### Mechanism (and why it is what it is)

- **Keyset, not offset.** Each full-mirror leg fetches `WHERE updated_at > wm ORDER BY
  (updated_at, property_id) LIMIT 1000`, advancing the watermark only on consumed HTTP-200
  pages. The **composite** `(updated_at, property_id)` cursor is mandatory: gov.properties has
  **1,126 rows sharing one `updated_at`**, so a strict `updated_at > wm` cursor would silently
  skip 126 of them at the page boundary. Backfill seeds at epoch → full incremental re-walk.
- **Multi-tick state machine, not a blocking loop.** Two hard constraints forced this:
  (1) `pg_net` dispatches a request only *after* the queuing txn commits; (2) **pg_cron runs
  each job in one atomic txn that forbids `COMMIT`** — verified live: a throwaway
  `CALL proc()` doing `COMMIT` failed with `invalid transaction termination`. So the walk is a
  plain function (`lcc_mirror_tick`) that **consumes the prior tick's response, then fires one
  next page**; `lcc-mirror-walk-tick` runs every 3 min and drives all 6 (leg,domain) pairs.
  Progress is durable per page → a lost/slow response resumes cleanly (no blind 24h discard).
- **Stale-overwrite guard (3.3.5).** Each mirror row stores the source `updated_at`
  (`source_updated_at`); a page whose row is older than the mirror's stored value is skipped.
  Proven: `stale_applied=0, fresh_applied=1`.
- **listing_events is a recency-window feed, not a forward mirror.** Sales' `updated_at` is
  churned by domain recompute crons — gov had **4,781 sales touched in 30d vs 4 sold** — so a
  persistent `updated_at` cursor would flood the operator queue (`v_lcc_listing_event_queue`)
  150×, violating the Consumption-Layer doctrine. listing_events keeps its `sale_date >= now()-30d`
  floor and keyset-pages by `sale_id` (cursor resets each cycle), which removes the latent
  1000-row cap without the flood.
- **Freshness + watchdog.** `lcc_check_bd_sync_freshness` now opens a per-`(leg,domain)`
  `bd_sync_leg_stale` alert. Every mirror/reconcile/signal/freshness cron is in the
  `lcc_check_disabled_critical_crons` allowlist. (The LCC watchdog can only see LCC `cron.job`;
  the per-leg freshness check is the cross-DB signal for a stalled domain-side pipeline.)

## Verification (live)

| leg | domain | status | mirror | source | parity |
|---|---|---|---|---|---|
| property_attributes | gov | ok | 13,518 | 13,518 | **exact**, `source_updated_at` 13,518/13,518 |
| property_owner_facts | gov | ok | 13,518 | 13,518 | **exact**, full backfill |
| property_attributes | dia | suspect_empty_source | 12,311 | 12,320 | blocked (see below), retained |
| property_owner_facts | dia | suspect_empty_source | 12,312 | 12,320 | blocked, retained |
| listing_events | dia | ok | 50 | window | no flood |
| listing_events | gov | ok | 32 | window | no flood |

- **Stale-guard:** set a mirror row's `source_updated_at=now()`, applied a page with an older
  source `updated_at` → 0 applied (row unchanged); applied a newer page → 1 applied (row won).
- **Freshness:** `lcc_check_bd_sync_freshness()` opened `bd_sync_leg_stale` for
  `property_attributes:dia` and `property_owner_facts:dia` (status `suspect_empty_source`);
  gov legs healthy.

## ⚠️ Pre-existing blocker discovered (NOT caused by W2.3)

`SET ROLE anon; SELECT count(*) FROM dia.v_property_owner_facts_portfolio` returns **0**
(gov = 13,518). gov.properties/true_owners carry `anon_read_*` RLS policies (`qual=true`) so
gov's `security_invoker` portfolio views are anon-readable; **dia's tables have no anon
policy**, so the dia views return `[]` to the anon `pg_net` key. The dia mirror was therefore
**already frozen** (the legacy offset sync hit the same wall). W2.3 causes no regression (dia
rows retained) and now makes the freeze **loud** via `suspect_empty_source`.

**Recommended fix (separate, security-reviewed — do NOT auto-expose dia data):** restore dia
anon-read parity with gov — either add `anon_read_properties`/`anon_read_true_owners`
(`qual=true`) on dia, or flip the dia portfolio views to `security_invoker=off` (definer) so
anon reads only the non-PII view columns. The dia `updated_at` companion is forward-compatible
— the walk self-heals the moment dia becomes anon-readable.

## How to re-verify

```sql
-- LCC Opps
SELECT leg, source_domain, last_run_status, last_run_rows, watermark_source_key
  FROM public.lcc_mirror_sync_watermark ORDER BY 1,2;
SELECT public.lcc_check_bd_sync_freshness();
SELECT source_domain, count(*), count(source_updated_at) FROM public.lcc_property_owner_facts GROUP BY 1;
-- vs gov/dia v_property_owner_facts_portfolio count(*)
```
