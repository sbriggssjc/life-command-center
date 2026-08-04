# Prompt 28 — Comps workbook: P0 hotfix + appraisal-grade quality (fields, counts, outliers, cap discipline)

Reviewed a live Copilot-generated workbook (`TheVillagesFLDialysis_SalesComps_202608.xlsx`, 16 sold + 9 on-market)
and the ChatGPT failure. Fixes below, most-blocking first.

## 1. P0 HOTFIX — ChatGPT workbook 500 "enforceHttpResponseSize is not defined"
`mcp/server.js:24` imports `{ boundHttpToolResult, jsonLen }` from `./http-response-bound.js` but lines 1983 &
1987 (the one-shot `/api/comps` route) call **`enforceHttpResponseSize`**, which isn't imported → ReferenceError
on every ChatGPT workbook call (Copilot's MCP path avoids it). **Add `enforceHttpResponseSize` to that import.**
Add a regression test that the HTTP `/api/comps` one-shot route returns 200 (not a ReferenceError).

## 2. Counts — 20-25 SOLD *and* all similar ON-MARKET, as SEPARATE sets (not 25 combined)
Today the appraisal cap (~25) is applied to the COMBINED set → 16 sold + 9 on-market = 25. Scott wants the target
(20-25) to apply to **SOLD comps only**, with **all** similar **on-market** listings in their own set (not
competing for the same slots). Use two independent caps: sold target ~20-25; on-market = the full similar set.

## 3. Field completeness — the one-shot workbook drops fields the engine returns
In the produced workbook these are BLANK for essentially every row even though the RPC returns them: **LAND,
BUILT (year_built), EXP (lease_expiration) → so TERM can't compute, EXPENSES/lease_type, BUMPS, RENEWAL OPTIONS**,
and **CHAIRS/PATIENTS** on most rows. The 2-step skill path maps these; the one-shot server-side path
(`runGenerateCompsFromRequest`) is mapping only a subset. **Map every engine field the template has a column for**
(land, year_built, lease_expiration, expenses/lease_type, bumps, renewal_options, chairs, patient_count, plus the
rent/price/date fields already flowing). Verify against `rpc_query_comps`'s projection — nothing populated upstream
should be blank in the workbook.

## 4. Outlier / broken-record exclusion (even in appraisal mode)
The set includes records that wreck the analysis: **Birmingham AL $76,500 sale** (rent $146,976 → ~192% cap),
**Coral Springs $18.3M "Multi-Property Sale"** (~0.95% cap), portfolio-/partial-allocated sales, and a duplicate
(Pembroke Pines 8100 Johnson St appears twice, r19/r20). Appraisal mode currently includes unreliable comps
wholesale. **Exclude implausible/broken economics** (cap outside ~3.5%–10%, sale price ≪ NOI, portfolio-allocated
prices that aren't a single-asset cap) from the PRIMARY set — drop or route to a clearly-labeled
"Secondary / market-range" section — and **dedupe** same-address/same-date rows. These must never pollute the
primary value-support set or the cap-rate stats.

## 5. Cap-rate stats are computed wrong
The summary showed Range 4.22%–9.00%, **Median 8.75%, Weighted Avg 3.98%** — a weighted avg BELOW the range
minimum is mathematically impossible (mixing list vs sold caps and/or the garbage rows above). **Recompute cap
range/median/weighted-avg on the reliable SOLD set only**, using SOLD cap = NOI ÷ sold price consistently; the
weighted avg must fall within [min,max].

## 6. Appraisal cap DISCIPLINE — the most important quality rule
Scott: *"when justifying a price for an appraiser, we never want to show a higher cap rate or lower value than
what we're appraising."* The subject is ~6.00% cap; this set's median is **8.75%** — that argues for a materially
LOWER value and actively hurts the appraisal. **In appraisal mode, weight cap-rate PROXIMITY to the subject
heavily in `scoreComp`, lead the primary set with the most-comparable comps at/around/below the subject cap, and
push higher-cap outliers to the labeled secondary section.** The primary set's central tendency should support,
not undercut, the subject value. (Do NOT fabricate or drop legitimate comps to manipulate — exclude only broken
records per §4 and RANK for comparability; the higher-cap real comps still appear, just as clearly-separated
market-range support.)

## 7. Subject resolution — now essential, not secondary
Every subject field came back "Not on file", so cap-proximity (§6) has no anchor. **Resolve the actual
under-contract Villages deal record** (tenant, credit/guarantor, remaining term, building SF, chairs, and the
6.00% cap) and pin the subject so similarity + cap-proximity rank against the real asset. If the deal record
isn't linkable yet, accept an explicit subject override (address/tenant/cap) in the request/params.

## Verify
- ChatGPT workbook request returns a real download link (no ReferenceError).
- Workbook has ~20-25 SOLD comps AND a separate full ON-MARKET set; LAND/BUILT/EXP/TERM/EXPENSES/BUMPS/RENEWAL/
  CHAIRS/PATIENTS populated wherever the engine has them; no 192%/0.95% cap rows; no duplicate addresses.
- Cap stats reconcile (wavg within range); primary set clusters near the subject ~6% cap with higher-cap comps in
  a labeled secondary section.
- With the Villages subject pinned, ranking visibly tightens to comparable-credit FL dialysis near the subject cap.
