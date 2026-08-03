# Comps triage — the engine is fine; the requests are under-shaped (2026-08-03)

## What Scott saw
ChatGPT (comps now connected) could only reach ~9 dialysis comps nationwide, and one "structured" query returned
just 1 (DaVita Pasco WA). It concluded the backend was hiding the historical dialysis universe. It isn't.

## Ground truth (measured directly against Dialysis_DB `zqzrriwuavgrquhisnoa`)
- `sales_transactions`: 4,773 rows; **3,022** are `transaction_state='live' AND sold_price>0 AND not excluded` —
  exactly the RPC's gate. `v_sales_comps` (the rich matview) is built from those same 3,022.
- Coverage: **sold_date 1985 → 2026, 48 states, 100+ in Florida alone.** The historical universe is fully present.
- `rpc_query_comps` works: `limit=5`→5, `limit=100`→100, `limit=100 FL`→100, `limit=100 since 2010`→100.
- Engine (`query_comps`) with **states=[FL] + include_unreliable_noi=true + limit=15** → **14 FL comps**, DaVita+
  Fresenius mix, 0 excluded. So the engine surfaces the inventory fine when asked correctly.

## Why the agents saw only 3–9 (three compounding causes, none a data/deploy bug)
1. **Reliability gate is ON by default.** Most dialysis comps carry an imputed/modeled cap (cap derived from
   estimated rent), so `noiIsReliable` excludes them unless `include_unreliable_noi:true`. The reliable-only
   nationwide subset really is ~9 — that's the filter, not the universe.
2. **Default limits are small** (`query_comps` 40, `synthesize_comps` 25) **and the RPC is most-recent-first**
   (`top … order by sort_date desc limit p_limit`). So a small limit returns only the newest handful; historical
   depth needs a bigger limit and/or a date window. Even FL@limit15 came back all 2025–2026 (the 14 newest FL).
3. **`p_tenant` is a single ILIKE substring, not a list.** ChatGPT's "all operators (DaVita, Fresenius, US Renal,
   DCI…)" structured query almost certainly passed that operator list as ONE tenant string →
   `... ilike '%davita, fresenius, us renal…%'` matches ~nothing → the "1 record" result. For all operators,
   leave tenant NULL.

## Immediate no-code workaround (unblocks the appraiser set today)
Ask the agent to pull with these explicit params (or the NL equivalents):
- `verticals=[dialysis]`, `comp_type=sale`, **`include_unreliable_noi=true`** ("include estimated-NOI comps"),
  **no tenant filter** ("all operators"), **`limit=100`**, and geography-tiered: first `states=[FL]`, then a
  Southeast set (`GA,AL,SC,NC,TN,MS,FL`), then national; add `date_from=2010-01-01` for historical depth.
- Then curate/rank the returned rows to the 20–30 most similar to The Villages. Keep the review flags as notes.

## Design fixes (prompt 23)
1. Add an **appraisal/full-set mode** (or make the comps-engine skill default for appraisal asks): high limit,
   `include_unreliable_noi=true`, tenant NULL, geo-tiered — so brokers don't have to know the flags.
2. **Rank before truncate.** The RPC caps to the most-recent `p_limit` *before* similarity ranking, so large
   pulls skew to recent national sales over similar FL ones. Score by similarity (geo, credit, term, size, cap,
   recency) and cap after, or push geo/date scoping so the recency window still contains the similar set.
3. **Surface `excluded_unreliable_noi` prominently** in the agent's answer so "9 of 214 shown; 205 excluded as
   estimated-NOI — say 'include estimated NOI' to see them" is obvious, not silent.
4. Consider accepting a **tenant list** (or splitting on commas) so multi-operator requests don't collapse to 0.
