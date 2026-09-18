# PERF-SPQ1 — `/api/seller-prospect-queue` takes ~14 s; the chip counts are seven full-view COUNTs, one per request; Today and the BD lane wait on it

**Filed:** 2026-09-18 (Cowork round 33, from the HOME2-b live look). **Owner:** LCC (`api/_shared/seller-prospect-queue.js`,
`api/`, `supabase/migrations/` on LCC Opps, `test/`). **Read first:** the header of `api/_shared/seller-prospect-queue.js`
(P139 "lying badge" — every chip count is exact on purpose), `20260917120000_lcc_pri2_on_reason_first_order.sql`
(the view's current shape), backlog `PRI2-on`, `HOME2-b`, `UX-T1a`.

## Measured (2026-09-18 ~13:10 UTC)
- Browser, signed in, Railway `4d932d92`: `GET /api/seller-prospect-queue?chip=all&limit=5&offset=0` → **200 in 14.6 s**.
- LCC Opps: `explain analyze select * from v_lcc_seller_prospect_queue limit 5` → **0.86 s**, planning 20 ms. The view
  is not the 14 s. The route issues one page query plus **one `count=exact` request per chip** (`select=entity_id&limit=1`,
  Content-Range) — seven chips today (`all` 507, `newer_lease` 248, `debt` 72, `developer` 213, `no_linked_person` 353,
  `never_touched`, …), each a full materialisation of the view with its regex-heavy owner filters → ~1–2 s × 7, serial.
- Consequences seen: HOME2-b's BD lane renders *"Could not load."* on first paint (the honest label — but the API
  did answer, late); the Today panel's Significant section spins for ~15 s on load; Vercel's log had the sibling
  `priority-queue band-counts query threw: This operation was aborted` at 8 s.

## Build
1. **One counts query, not seven.** A view or RPC on LCC Opps that returns every chip's exact count in one pass
   over `v_lcc_seller_prospect_queue` (`count(*) filter (where …)` per chip), same definitions as the route's chip
   predicates — single source: generate the predicates from the same table the JS uses, or move the chip
   definitions into SQL and have the JS read them. Exactness stays (P139); only the trip count changes.
2. **Parallelise what remains** (`Promise.all` for page + counts) and measure the route end to end; target < 2 s.
3. If still > 2 s: a 60-second cached counts row (`lcc_seller_prospect_chip_counts` refreshed by a cron or on
   write), labelled with its `as_of` so the badge can say "as of 13:10" rather than lie.
4. Tests: chip predicates in SQL and JS agree (fixture), the route makes ≤ 2 upstream calls, a timing assertion
   against the live view in `verify:deploy` (warn, not fail).
5. Report before/after timings from the browser (not curl) and the query plan.

⛔ No count becomes approximate without an `as_of` label. ⛔ STATUS entry labelled **(CC)**; STATUS/backlog edited
only as on `origin/main` at commit time. **Parked:** one line each.
