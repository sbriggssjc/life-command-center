# Claude Code prompt — converge on a single cap-rate-of-record (kill the 3-field divergence)

> Run in the **DialysisProject** repo, in the SAME Claude Code session as the
> `rent_at_sale` work — the two are coupled (`calculated_cap_rate` is derived from
> `rent_at_sale`, so fixing rent without fixing cap-of-record just moves the problem).

```
Establish a single, authoritative cap-rate-of-record per dialysis sale and make every
downstream chart, comp, and view read ONLY that field. Today cap rate is stored in three
competing columns and each view COALESCEs them in a different order, so the same sale shows
different cap rates on different charts. The business rule must be: we either KNOW the cap
rate (one trusted value + provenance) or we DON'T (null) — never "pick one of three."

## Environment
- Supabase "Dialysis_DB", ref `zqzrriwuavgrquhisnoa`, schema `public`. Use Supabase MCP/CLI.
- Migrations + ingestion code live in this repo. Follow the repo git rules (feature branch
  off origin/main, PR, copy/paste merge + test commands). Record provenance; never clobber
  a manual override.

## What the audit found (measured 2026-06-01, 3,853 investment/resale sales)
- Coverage: `calculated_cap_rate` 2,480 rows, `stated_cap_rate` 1,251, raw `cap_rate` 1,696;
  943 (24%) have NONE.
- The two reported fields agree: `stated` vs raw `cap_rate` disagree >25 bps on only 148 rows.
- `calculated_cap_rate` is the outlier: disagrees with stated on 523, with raw on 778.
- 1,104 of the `calculated_cap_rate` values exactly equal `rent_at_sale / sold_price` — it is
  a DERIVED field built on the (separately broken) rent, which is why it runs high
  (e.g. NM deals: calculated avg 7.36% vs broker-stated 6.77% vs raw 6.67%; the published
  deck's NM figure is 6.70%, matching the reported caps, NOT calculated).
- Interim chart fix already shipped (R66o): the NM-vs-Market view now COALESCEs
  stated -> raw -> calculated. This prompt is the durable replacement.

## Tasks
1. DECIDE the canonical model. Recommended: a single `cap_rate` of record (reuse the existing
   `cap_rate` column as the authoritative field, OR add `cap_rate_final` if you'd rather not
   overload it) plus:
     - `cap_rate_source` enum/text: 'broker_stated' | 'source_reported' | 'noi_derived' |
       'manual' | null
     - keep `cap_rate_quality` for the implausibility flag.
   Document the decision in a migration comment + repo doc.
2. SOURCE PRIORITY (highest trust first), applied at write time and in a backfill:
     a. manual override (never clobbered)
     b. broker_stated  (`stated_cap_rate`)         -> source='broker_stated'
     c. source_reported (raw `cap_rate` as ingested from CoStar/CMS/etc., when distinct from
        the derived calc)                            -> source='source_reported'
     d. noi_derived (`rent_at_sale`/`sold_price`) ONLY when rent_at_sale passes the
        post-fix reconciliation gate from the rent_at_sale work -> source='noi_derived'
     e. else NULL + source=null  (we genuinely do not know — that's allowed and correct)
   Band-check 4-12% and respect `cap_rate_quality='implausible_unverified'` (null it).
3. STOP trusting `calculated_cap_rate` as primary. Do not delete it (audit history), but it
   must never outrank a reported cap. After the rent fix it can be recomputed as a clean
   noi_derived candidate, used only at priority (d).
4. TRACE + FIX the writers. Find every place that sets any of the three cap fields (OM-intake
   extractor, CoStar sidebar pipeline, CMS/CSV import, manual edits) and route them through a
   single helper that writes the canonical field + source + provenance. New sales get a
   cap-of-record automatically.
5. BACKFILL the canonical field for all existing rows by the priority ladder, writing
   provenance rows. Produce a before/after table: rows with a trusted cap, rows still null,
   and the source-mix (% broker_stated / source_reported / noi_derived).
6. POINT THE VIEWS at the one field. Update the cap-rate-consuming views to read the canonical
   field directly and drop their inline COALESCE:
     `cm_dialysis_cap_ttm_m`, `cm_dialysis_cap_quartile_m`, `cm_dialysis_valuation_index_m`,
     `cm_dialysis_nm_vs_market_m`, `cm_dialysis_market_quarterly_master_m` (+ `_m_mat`),
     `cm_dialysis_sold_cap_by_term_m`, the Core Cap dot plot, NM Notable Transactions, and any
     `v_sales_comps` consumer. Grep the repo + DB for `calculated_cap_rate`,
     `stated_cap_rate`, and `coalesce(... cap_rate ...)` to find them all.
7. VALIDATE: (a) every listed view returns the SAME cap for the same sale; (b) NM-vs-Market NM
   line ~6.6-6.8% and the gap vs market ~45-63 bps (matches deck p.38); (c) count of sales
   with a trusted cap vs null is sensible and the 24% "none" cohort is genuinely unknown, not
   a pipeline miss.

## Government parity (note, lower priority)
The gov DB ("government", ref scknotsqkcheojiaewwh) already uses a single `sold_cap_rate`
column on `sales_transactions`, so it doesn't have the 3-field problem — but confirm it has a
`cap_rate_source` provenance tag and the same band/quality handling, and mirror the helper so
gov stays single-source-of-truth too.

## Constraints / non-goals
- Don't invent cap rates. If no trusted source exists, leave null — "we don't know" is a valid,
  correct state and better than surfacing a derived-from-bad-rent number.
- Never clobber a manual override.
- Coordinate with the rent_at_sale fix: noi_derived caps are only trustworthy AFTER rent
  reconciles (SUM(rent)/SUM(price) ~ avg cap). Until then, noi_derived stays at the bottom of
  the ladder.
```
