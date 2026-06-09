# Claude Code prompt — R11: value-ranking integrity (the queue ranks on missing rent)

Paste into Claude Code, run from the **life-command-center** repo. Audit
grounded live 2026-06-08. Headline: the priority queue, P-CONTACT lane,
Decision Center lanes, and buyer rollups all rank by
`current_annual_rent_total` — and that number is **$0 for most of the book**,
so "work the highest-value first" is currently ordering by noise.

## Grounded findings (live, 2026-06-08)

1. **dia portfolio rent is zero everywhere.** `lcc_entity_portfolio_facts`:
   gov 2,700 of 3,324 current edges carry rent; **dia 0 of 887**. Root cause:
   the portfolio sync's dia leg pulls the raw `dia.ownership_history` table
   and reads its `rent` column — which is **NULL on all 7,772 rows** (no
   writer ever populated it). dia rent actually lives in
   `leases.annual_rent` (with the projection doctrine — anchor rent +
   `dia_project_rent_at_date`). Note the asymmetry: the gov leg pulls a
   curated anon VIEW (`gov.v_ownership_history_portfolio`) that already joins
   rent; dia pulls a raw table (also the wrong PII posture per the BD-engine
   rule "extend the views, not the tables").
2. **No fallback rank source.** `lcc_property_attributes` (30k rows) carries
   lease dates/term/size but **no rent column** — so entities whose only
   property linkage is the owner-facts mirror or a representative property
   (most of P0.4 and P0.5) can't be ranked even when the domain DB knows the
   rent. Gov P0.4 has 117 $0 rows that are NOT dia — this is why.
3. **Rank-zero shares per band** (`v_priority_queue_enriched`,
   `current_annual_rent_total = 0`): P-CONTACT **304/306**, P0.4 415/499,
   P0.5 70/73, P7 68/68, P-BUYER 18/23, P5 21/39, P8 27/52, P1 28/54.
   The two lanes Scott works hardest (P-CONTACT, P0.4/P0.5) are effectively
   unranked.
4. **Orphan persons can never join to value.** The dia P-CONTACT rows are
   real people ("Scott E. Elliott", "Jim Colburn") seeded from old SF
   contacts with NO portfolio edge, NO source_property_id, NO entity
   relationships to assets — there is nothing to rank them by from property
   data. Separate sub-class from #1/#2.
5. Coverage math for the fix: dia has 2,150 properties with a current owner
   in ownership_history; 1,049 of the distinct ownership_history properties
   have an active lease with `annual_rent > 0` → roughly half of dia current
   edges gain a real rent immediately when the view lands; the rest reflect
   genuine lease-data gaps (honest zeros).

## Unit 1 — dia anon view + sync repoint (mirror the gov pattern)

1. **dia migration FIRST** (dia DB `zqzrriwuavgrquhisnoa`, the R6 rule):
   create `dia.v_ownership_history_portfolio` mirroring the gov view's
   column contract (`true_owner_id, property_id, transfer_date/ownership
   dates, annual_rent, sale_price, cap_rate, data_source`) — names only / no
   PII, anon+authenticated SELECT. `annual_rent` = the property's active
   lease rent, **projected to CURRENT_DATE per the dia rent doctrine**
   (anchor rent + `dia_project_rent_at_date` when anchor confirmed, else
   `leases.annual_rent`; reuse the `v_sales_comps` SQL helpers — do NOT
   reinvent the projection). Multi-active-lease properties: pick the primary
   (largest leased_area or most recent commencement; state the choice).
2. **Repoint the sync's dia leg** (`lcc_sync_entity_portfolio*` on LCC Opps)
   at the view with the gov-shaped select-cols; keep paging at 1000/page
   (the PostgREST cap lesson). The finalize's dia branch maps the same
   column names the gov branch uses — collapse the two branches if that
   stays readable.
3. **Run it once live; ANALYZE; refresh the rollup + queue caches.** Report
   before/after: dia current edges with rent (expect ~0 → several hundred),
   and the band rank-zero table from finding #3 re-run.

## Unit 2 — rent in property attributes (the fallback rank)

1. Add `annual_rent` (and `noi` where the domain carries it — gov does) to
   `lcc_property_attributes` + the attributes sync (both domains; the gov
   anon attributes view may need the column added FIRST, same deploy order).
2. `v_priority_queue_enriched` rank fallback:
   `COALESCE(NULLIF(rollup_rent,0), representative_property_rent)` — the
   representative property is already attached for P0.4/P0.5; join its
   attributes row. Keep the hot path cheap (the Slice-1 lesson — if the join
   measurably regresses the materialized refresh, put the fallback INSIDE
   `lcc_priority_queue_resolved`'s refresh instead of the live view).
3. P-CONTACT ordering: once 1+2 land, re-rank by the same coalesced value.
   Report the new top-10 P-CONTACT cards by value — that's Scott's contact-
   resolution worklist, now in money order.

## Unit 3 — the orphan persons (decide, don't bury)

The ~99 dia P-CONTACT persons (and any gov siblings) with zero property
linkage cannot be value-ranked. Don't fake a rank:

1. Classify them: persons whose cadence has `sf_contact_id` or an SF identity
   → they're real relationship contacts; persons with neither AND no
   relationships → likely import residue.
2. Real-relationship orphans: rank LAST within P-CONTACT but keep them, with
   the card showing "no linked property — link a property or work from SF
   context"; offer the existing entity-link/property-search affordance.
3. Residue (no SF tie, no relationships, no activity): soft-flag to the junk
   lane as a new bucket (`orphan_person_no_linkage`) for bulk disposition —
   same reversible pattern as the tenant-mix sweep. Report counts + 5
   spot-checks before flagging.

## Verify + ship
- Unit 1: dia edges with rent before/after; one dia entity spot-checked
  end-to-end (domain lease rent → view → portfolio fact → rollup → queue
  card value); gov path byte-identical (no regression).
- Unit 2: band rank-zero table re-run and reported; queue refresh latency
  still within the Slice-1 gate (<1.5s).
- Unit 3: classification counts; no hard-deletes; orphans either ranked-last
  or flagged with the audit trail.
- House rules: `node --check`; 12 functions; migrations idempotent; domain
  view migrations BEFORE the LCC sync repoint; constraint/cron ordering as
  established; ANALYZE after bulk loads; effect-first; report per-unit.
- DB-side (views, sync, backfill) may apply live per the standing posture;
  any JS (enriched-view consumers, P-CONTACT render) ships on the Railway
  redeploy.
