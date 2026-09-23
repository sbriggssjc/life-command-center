# GOV-COMPS-CAP — the Gov › Sales › Sales Comps list stops at 2,000 rows

Backlog: `GOV-COMPS-CAP`. Source: Scott, 2026-09-23 ("the sales comp list in the government sales tab is capped out at 2,000 sales even though we have more").

## Measured

- Live gov DB: `v_sales_comps` = **4,844** rows; `sales_transactions` = **15,172** rows.
- UI: the "Sales Comps (N)" pill is `govSalesComps.length` (`gov.js` ~9214), and Scott sees 2,000.
- Both loaders (`gov.js` ~9051–9063 and ~4460–4472) page `govQuery('v_sales_comps', …, {limit: 1000, offset})` and stop on the first short page. So something upstream returns a short page (or nothing) at offset 2000: the `govQuery` → `/api/...` proxy, the `data-query` edge function, a PostgREST max-rows setting, or a timeout on deep offsets. Find which. Don't guess.
- A comment at `gov.js` ~9930 says "v_sales_comps (2155 rows)", so it's stale.
- Dia's equivalent tab may share the loader or proxy. Check it.

## Ask

1. Find the cap and fix it at the source. Load the full list without holding thousands of rows in the browser if pagination or server-side filtering is the better design. Say which you chose, and why.
2. The pill count and the total must come from an exact count, not the loaded array length. "Loaded N of M" is fine; a silent cap is not (never fabricate).
3. Explain the 4,844 vs 15,172 gap (the view's definition: priced, verified or dated only?) in one paragraph in the response. If the view is excluding real comps it shouldn't, file that separately rather than changing it here.
4. Tests: a loader test against a fake paged API that returns more than 2 pages, and a guard that the pill uses the exact count. Each needs a mutation that turns it red.

## Done means

- Backlog row updated.
- Cache busters bumped as a set.
- Deploy = redeploy BOTH Railway services.
- Scott checks that the pill shows the full count.
