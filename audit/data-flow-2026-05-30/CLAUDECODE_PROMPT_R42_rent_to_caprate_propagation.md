# Claude Code — R42: propagate new rent/NOI → recompute cap rates (stop freezing caps at ingest)

## Why (audit live 2026-06-16 — see AUDIT_rent_to_caprate_propagation_2026-06-16.md)
Cap rates are computed only when the SALE/LISTING row changes (the `auto_cap_rate` triggers).
The **`leases` and `property_financials` tables have no cap-rate recompute** — so when we
learn the real rent/NOI AFTER a sale was ingested, the sale's derived cap rate is never
refreshed. The daily `*-propagate-recompute-tick` cron only propagates sale info, NOT caps.
Quantified: **~20% of recent gov live sales (32/161) carry a derived cap that drifts >50bps**
(max ~9.6 pts) from what current rent would yield. dia is partly mitigated (its
`v_sales_comps` projects rent at refresh) but the STORED dia caps + the bypass loader are
still frozen. Goal: the derived cap always reflects best-known rent — propagate at the source.

## Unit 1 — recompute caps when rent/NOI changes (bounded daily pass, both domains)
Prefer a **cron recompute pass over a per-lease trigger** (a trigger would recompute a
property's whole sale history on every lease edit — heavy). Extend the existing daily
`gov-propagate-recompute-tick` / `dia-propagate-recompute-tick` (or add a sibling) to:
- Find properties whose **`leases` / `lease_escalations` / `property_financials` changed in
  the lookback window** (`updated_at` within N hours, matching the cron cadence).
- For each, recompute the cap rate on that property's `sales_transactions` (live),
  `available_listings` (active), and `property_sale_events` via the authoritative function
  (`gov_compute_cap_rate` / the dia equivalent), and **rewrite the `cap_rate_history` derived
  value + the trigger-managed displayed cap field** (`sold_cap_rate`/`asking_cap_rate`/
  `cap_rate`) — preserving the RAW ingested cap for audit (don't overwrite a raw-source cap;
  update the derived ledger + the computed-source rows, per the existing
  `cap_rate_source`/`income_source` provenance).
- Idempotent (re-run changes nothing if rent unchanged); bounded per tick; logs count
  recomputed. Reuse the existing compute function — don't reimplement the hierarchy.

## Unit 2 — one-time backfill of the currently-stale set (reversible, gated)
Recompute caps for all live sales/listings whose derived cap drifts from the current
computation (the ~20% gov + the dia stale set). Snapshot prior `cap_rate_history` rows +
displayed caps to a reversible backup (mirror R37/R40). **Produce a before/after diff for
Scott** of every changed cap — and if `cap_rate_history` / the recomputed caps feed the
**published CM export** (the gov CLAUDE.md says analytics should prefer the history table),
gate the backfill on his sign-off (it's a correctness improvement toward best-known rent, but
it changes published-adjacent derived values). The RAW ingested broker cap stays untouched.

## Unit 3 — make every comp surface read the fresh value
Confirm the dia loader `loadDiaSalesCompsFromTxns` (which bypasses `v_sales_comps`) reads the
projected/recomputed cap, not the frozen stored one — so the projecting view, the bypass
loader, and the stored ledger all agree. If it reads the frozen value, repoint it to the
recompute (or to the projecting view).

## Guards / house rules
- Reuse the authoritative compute function + existing provenance columns; preserve RAW
  ingested caps; idempotent + bounded; reversible backfill with snapshot + before/after.
  Respect the cap-rate range guards (`chk_*_cap_rate_range`) — recomputes outside
  [0.005,0.30] are dropped, not stored (as the function already does). ≤12 LCC `api/*.js`
  (this is gov/dia SQL + crons, not LCC api). `node --check` / `py_compile` as relevant;
  suite green. DB migrations applied live after a dry-run (same gate as R37/R38), CM-feeding
  backfill after Scott's before/after sign-off.
- Verify live: after a lease/NOI update for a property, the next recompute tick refreshes that
  property's sale/listing caps (derived-now == stored); the ~20% drift collapses to ~0;
  raw ingested caps unchanged; dia view, loader, and stored ledger agree.

## Bottom line
Today a cap rate is frozen at the rent we knew when the sale was ingested. R42 makes new
rent/NOI propagate back to recompute the derived cap across the property's sales & listings —
so the cap rate (the core analytic) always reflects the best rent we've ingested, the
self-improving accurate picture the rest of this engagement has been building toward.
