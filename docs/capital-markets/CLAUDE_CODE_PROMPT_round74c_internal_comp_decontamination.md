# Claude Code prompt — Round 74c: de-contaminate is_northmarq against the SF **Internal Comp** export

> Scott exported the SF **Comp** object (not the Deal/Opportunity object). The
> xlsx are gitignored/local-only, so the assistant **loaded them into a DB table
> CC can read directly** (verified against row/sold/sum-price checksums):
> - **dia** → `zqzrriwuavgrquhisnoa.public.sf_internal_comp_export` (280 rows, 262 Sold)
> - **gov** → `scknotsqkcheojiaewwh.public.sf_internal_comp_export` (127 rows, 113 Sold)
>   Columns: `sf_comp_id, property_type, gov_category, comp_name, tenant, city,
>   state, building_sf, sold_price, sold_cap_rate` (decimal, e.g. 0.063),
>   `sold_date, status` (`Sold`/`Available`/`Under Contract`). Source `Comp Type`
>   was `Internal` for all rows (filter to `status='Sold'` for the closed universe).
>   A snapshot table (`loaded_at` stamped) — the durable loop later reads `sf_comp_staging`.
>
> **Every row is `Comp Type = "Internal"`** = NM's own brokered comps (the export
> has zero External/market rows). So this IS the authoritative **NM curated-comp
> universe** — the thing the deck's value-prop chart is built on. No broker /
> Direct-Co-Broke columns (different schema than `data.xlsx`); the NM signal is
> the `Internal` type itself. **Confirm with Scott that `Internal` = NM-brokered
> before committing** (assistant's working assumption, strongly supported: all
> tenants are NM's known DaVita/Fresenius/SSA/GSA deals, no External rows).

## Schema (37 cols; the ones that matter)

`Id` (SF Comp Id, distinct — idempotency key), `Comp Type` (all `Internal`),
`Property Type`, `Gov. Category` (Federal/Local-State/None), `Comp Name`,
`Tenant`, `City`, `State`, `Zip Code`, `Building SF`, `NOI`, `Rent/SF`,
`Lease Term (yrs)`, `Term Remaining (At Sale)`, **`Sold Price`**, **`Sold Cap
Rate`** (decimal, e.g. 0.063 = 6.3%), **`Sold Date`**, `Listing Price`,
`List Cap`, **`Status`** (`Sold` / `Available` / `Under Contract`),
`Original List Price/Cap`, `Days on Market`, `Sale Conditions`.

Closed universe = **`Status='Sold'`**: dia 262, gov 113.

## What the assistant already verified (read-only)

- dia Internal-Sold caps: **all-time avg 6.62% / median 6.32%**; 2yr-TTM (sold
  2024-04→2026-03) n=20 avg 6.80% / median 6.78%. **The all-time median 6.32% ≈
  the deck's dia 6.38%** — strong evidence the deck's value-prop NM number is the
  curated Internal-comp median over a long window (resolves Task 5 for dia: it's
  a window+cohort answer on the curated comps, not a basis transform on the 2yr set).
- gov Internal-Sold caps: all-time avg 7.92% / median 8.00%; 2yr-TTM 8.37%. **This
  does NOT match the gov ~6.75% the master-derived flag produces** — a real
  population/window discrepancy. Investigate before switching gov to this basis;
  gov already reproduces the deck off the master import, so default to keeping gov
  as-is unless this reconciles.

## Task (dry-run → assistant's gate → commit; flag + provenance only)

1. **Match** each Internal **Sold** comp to our `sales_transactions` per vertical
   (dia DB / gov DB): `state` + `Sold Date` ±120d + `Sold Price` ±6%, confirm with
   `City` + `Tenant`. Report match rate + the SF `Id`↔`sale_id` map.
2. **Re-derive `is_northmarq`** against this authoritative NM set:
   - **add** `is_northmarq=true` on matched sales (tag
     `is_northmarq_source='salesforce_comp'`),
   - **remove** on currently-flagged sales that match **no** Internal comp —
     **conservatively**: the comp DB may be incomplete, so stage removes for the
     assistant's gate with the same competitor-broker spot-check as R74 (don't bulk-strip).
3. **Reconcile the three NM counts** and report: dia currently flagged **436** vs
   Internal-Sold **262** vs master **183**; gov flagged **66** vs Internal-Sold
   **113**. The Internal comp set is the curated NM target — quantify the gap and
   which currently-flagged sales fall outside it.
4. **Resolve the held R74 buckets** against this set: the 84 null-broker removes +
   144 non-city-confirmed adds + the 2 M&M contradictions (8327/13137).
5. **#20 value-prop (Task 5):** recompute the **dia** NM line on the Internal-comp
   basis over the deck's window; confirm it reproduces ~6.38%. For gov, report the
   Internal-vs-master discrepancy — do not switch gov bases until it reconciles.

## Guardrails

- Schema is the **Comp** object, not the Deal object — adapt `sf-nm-dryrun.mjs`
  (no broker/Direct-Co-Broke; `Internal`+`Sold` = NM-listed; buy-side can't be
  split from this object — note it, it's a minor population caveat).
- Dry-run plan JSON (per-vertical add/remove/net, new NM-vs-market TTM averages,
  30-row samples, the count of Internal comps matching nothing = import candidates)
  → assistant's independent SQL verification → commit.
- Flag-column + `is_northmarq_source` only. No price/term/cap writes. Idempotent on
  the SF `Id`. dia first (the flagship #20 lever), then the gov reconciliation.
