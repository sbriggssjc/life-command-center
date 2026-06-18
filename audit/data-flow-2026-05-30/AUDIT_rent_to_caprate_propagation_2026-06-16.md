# Audit — does new rent/NOI propagate to recompute cap rates? (live 2026-06-16)

**Question (Scott):** as leases / prior sales are ingested, do we propagate that rent/NOI
across the property's prior & future sales to (re)generate cap rates once we learn new rent?

## Verdict: NO — cap rates are frozen at ingest-time rent; new rent/NOI does not recompute them
Cap rates are DERIVED (NOI/price) by the cap-rate framework, but the recompute **only fires
when the SALE/LISTING row itself changes** — there is no path that recomputes a property's
existing cap rates when a LEASE or NOI lands later.

### Trigger map (gov; dia identical shape)
- Cap-rate compute triggers exist on **`sales_transactions`**, **`available_listings`**,
  **`property_sale_events`** (fire on INSERT/UPDATE of the sale/listing → snapshot cap rate
  from the rent known AT THAT MOMENT).
- **`leases`** triggers: supersede-expired, classify, normalize, agency-canonical,
  updated_at — **none recompute cap rates.** (dia's `normalize_lease_cap_rates` only
  normalizes the lease's own cap, not the property's sale caps.)
- **`property_financials`** (the NOI source): only `updated_at`. No cap-rate recompute.
- The daily cron **`gov-propagate-recompute-tick` → `propagate_sales_recompute()`** is
  misleadingly named: it only propagates latest **sale info** (date/price/grantor/grantee)
  onto `properties` — it does **not** touch cap rates. (`dia-propagate-recompute-tick` same.)

So: ingest a sale today → cap rate computed from whatever rent is known today. Learn the
real rent next week (lease lands) → the sale's cap rate is **never refreshed.**

## Quantified staleness (gov, live priced sales, last 3 years)
Comparing the DERIVED cap stored at ingest (`cap_rate_history`) vs the DERIVED cap recomputed
NOW with current rent (`gov_compute_cap_rate`) — same function, only the rent data differs:
- **161 sales with a derived history; 32 (~20%) drift > 50 bps; 36 > 25 bps; max drift ~9.6
  points.** ~1 in 5 recent gov sales carries a cap rate that current rent/NOI would change
  materially. (A raw-vs-derived cut was higher still, but this isolates true rent-staleness.)

## dia is PARTIALLY mitigated, not fixed
- dia `v_sales_comps` / `mv_sales_comps` **project rent to CURRENT_DATE** at refresh
  (`dia_project_rent_at_date`, cron `refresh-v-sales-comps`) — so the comps **view** an
  underwriter pulls reflects current rent. Good.
- BUT the **stored** `sold_cap_rate` / `cap_rate_history` on dia sales are still frozen at
  ingest, AND the dia loader `loadDiaSalesCompsFromTxns` **bypasses the view** (per the dia
  CLAUDE.md) → reads the frozen value. So dia surfaces are inconsistent: the projecting view
  is fresh, the stored value + bypass path are stale.

## Why it matters
Cap rate is the core analytic. A 20%-stale derived ledger means comps, the displayed cap on
sales, and anything reading `cap_rate_history` (incl. potentially the CM export, which the
gov CLAUDE.md says should prefer the history table) can show a cap rate computed from
rent we've since improved. The raw ingested broker cap is correctly preserved for audit; the
problem is the DERIVED value isn't refreshed when our rent knowledge improves.

## Fix doctrine → CLAUDE CODE PROMPT R42
When rent/NOI lands or changes for a property, recompute that property's sale / listing /
sale-event cap rates (rewrite `cap_rate_history` + the trigger-managed displayed cap), so the
derived cap always reflects best-known rent. Implement as a **bounded daily recompute pass**
(extend the existing propagate-recompute cron to detect properties whose leases/financials
changed in the lookback and recompute their caps) rather than a per-lease trigger (avoids
recomputing a property's whole sale history on every lease edit). Plus a **one-time backfill**
for the ~20% currently-stale set (reversible/snapshot; before/after for Scott if
`cap_rate_history` feeds the published CM export). Confirm the dia bypass loader reads the
projected/recomputed value so every comp surface agrees.
