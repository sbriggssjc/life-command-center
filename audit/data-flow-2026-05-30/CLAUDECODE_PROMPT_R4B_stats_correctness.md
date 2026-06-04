# Claude Code prompt — R4-B: dashboard stats correctness + data quality

Paste into Claude Code, run from the **life-command-center** repo. From the
2026-06-04 round-4 live audit: the domain dashboards assert numbers that are
artifacts of query caps or stale data. The app must never present a LIMIT as a
total.

---

## Verified evidence (live gov/dialysis overviews, 2026-06-04)

1. **Aggregates over capped results, labeled as totals:**
   - Gov TTM Sales: "ALL-TIME COMPS **1,000** total in database" + "ALL-TIME
     VOLUME $21,043M (979 priced)" + "AVG SALE PRICE $21,493,884 across all
     comps" — gov holds ~2.6k sales; 1,000 is the fetch cap and the avg is
     computed over whatever slice loaded.
   - "GSA EVENTS YTD **500**" / "GSA TOTAL RENT $1,762M — 500 leases tracked"
     / "FRPP **1,000** federal properties" — all caps.
   - Prospect Pipeline: "TOTAL LEADS 1,000+ · PIPELINE VALUE **$28,025M+** ·
     AVG LEAD VALUE $28,025K" — avg = total/1000 exactly (computed over the
     loaded page; footer admits "11,537 leads (top 1,000 loaded)"). $28M/lead
     is also a value-plausibility failure (same family as the $950M fix —
     check what `estimated value` feeds the sum).
   - Today "Team Pulse: **3000** RESEARCH" — round cap.
2. **Gov lease-expiration risk implausible:** "EXPIRING < 1 YEAR 7,722 =
   72.3% of portfolio"; action item "7571 leases expiring within 6 months";
   distribution 0–1yr = 7,718 yet Expired/<0 = 4. With avg firm term 1.7yrs
   this pattern says `lease_expiration`/`term_remaining` are stale or
   defaulted for a large cohort (GSA refresh gap? daily recompute not running
   on the gov DB? expired leases never aging out?). FORENSIC FIRST: find the
   cohort (group expiring-<1yr rows by data source + last-update), then fix
   the pipeline/recompute, then the dashboard number self-corrects. Do NOT
   just re-bucket the chart.
3. **Duplicate SF closed-sale rows:** dialysis "Recent closed sales" lists the
   identical deal 10× ("DaVita Dialysis - Huntingdon - TN, Team Briggs, $2.2M,
   2025-12-19"). Find whether the dupes are in the synced data (sf_sync /
   deal rows) or the rendering query (missing DISTINCT/dedupe-by-deal-id).
   Fix at the right layer. Also: closed-by-year shows 2024 = 37 deals/$153M
   vs 2023 = 781 and 2025 = 240 — check whether 2024 is a sync gap.
4. **Stuck-forever widgets (dialysis):** Clinical Metrics ("loading full
   patient data..."), Clinic Financial Estimates, Listings Needing
   Confirmation, LLC Research Queue ("unavailable" on gov) — these never
   resolved in a multi-minute session. Check the endpoints/queries behind
   each; fix or fail visibly (an error state, not eternal "loading...").
5. **Agency-name pollution (note + cheap win only):** "POTOMAC/METROPOLITAN/
   TRIANGLE/DC SERVICES DIVISION" rank in top agencies by rent — vendor/
   division names, not agencies (the lease-expiration action item even
   surfaces "TRIANGLE SERVICES DIVISION" as a tenant). If there's a cheap
   classifier/exclusion (e.g. `% SERVICES DIVISION` → vendor, exclude from
   agency rollups or map to USPS), take it; otherwise document as a data-
   quality backlog item with row counts. The page already flags 3,712
   Unknown-agency properties ($1,225M rent) — leave that for enrichment.

## Approach

- For every dashboard stat: totals/averages must come from server-side
  aggregates (PostgREST `count=exact`, aggregate RPCs, or the existing
  data-query edge function) — never computed client-side over a page-limited
  array. Sweep the gov + dialysis overview loaders for `.length`-as-total and
  sum/avg-over-fetched-rows patterns; fix the class.
- Where a true total is expensive, label honestly ("top 1,000 by value") and
  show the real total from a count query.
- The lease-expiration forensic may land DB-side (gov project
  `scknotsqkcheojiaewwh`) — recompute/refresh job or data fix + whatever
  cron/trigger keeps `term_remaining` current (GovernmentProject CLAUDE.md
  says enrich_properties/sync_properties_from_sources recompute daily —
  verify that actually runs against this DB).

## Verify + ship

- Gov overview shows true all-time comp count (~2.6k) and a sane avg; pipeline
  avg-lead-value is computed over all leads (and implausible estimated values
  are flagged/excluded, with the same doctrine as the prior magnitude fix);
  GSA/FRPP tiles show real totals.
- Lease-expiration forensic results reported in the PR (cohort, root cause,
  fix applied); the <1yr share moves to something defensible.
- Recent-closed-sales shows 10 distinct deals; 2024 finding reported.
- Stuck widgets either render data or render an explicit error state.
- `node --check`; function count = 12; migrations idempotent + ordering noted.
