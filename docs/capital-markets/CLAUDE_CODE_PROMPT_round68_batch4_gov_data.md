# Claude Code prompt — Round 68 batch 4: gov data investigations (R68-F) + valuation index gate (R68-G)

> Run in **life-command-center** (gov DB `scknotsqkcheojiaewwh` via migrations;
> canonical SQL to government-lease repo as usual). Addresses Scott's notes G1,
> G4, G7, G10, G13, G18, G19 — plus G2/G20 which ACTIVATE when Scott's gov
> master comp workbook lands (see Task 7). Receipts from live gov DB, 2026-06-04.

```
TASK 1 — G1: credit-tier classification collapse post-2021
VERIFIED: cm_gov_cap_by_credit_m months with data per year —
  federal 12/12 every year; state 6-12/yr through 2021 then ZERO 2022-2026;
  municipal ~0 except 2020-21.
The R66 classifier clearly resolves federal (GSA/agency patterns) but the
state/municipal paths stopped matching whatever the post-2021 capture writes.
Diagnose: what populated state/muni classification pre-2022 (tenant string?
agency link? lease source?) vs what recent rows carry. Fix the classifier to
cover the current data shape + backfill 2022-2026. Acceptance: state series
continuous through 2026 where deals exist; muni where defensible; n per tier
per quarter in the migration notes.

TASK 2 — G7: NM line gaps = labeling collapse, not market reality
VERIFIED: is_northmarq sales/yr: 2015-2022 = 8-18; 2023 = 2; 2024 = 5;
2025 = 5; 2026 = 0. Northmarq closed gov deals in those years — the broker
strings on recent (sidebar-era) rows are missing/unparsed. Diagnose the recent
rows' broker fields; extend the R66 backfill-from-broker-string to whatever
field the sidebar writes; check Salesforce as a corroborating source for NM
deals 2023-2026 (closed-won gov listings → match by property+date). Acceptance:
NM TTM line computable (gate n>=3) through 2025 if the deals exist in any source.

TASK 3 — G4: recent DOM halving
The Days-on-Market chart's most recent quarter cuts avg DOM nearly in half vs
the prior run-rate. Suspects: (a) the R68-A-style intake gap clipping
long-DOM listings out of the recent window; (b) sold-date vs off-market-date
drift after the availability-checker rounds; (c) a genuinely thin recent n.
Diagnose with receipts; fix only with evidence; gate if thin. Report the
DOM distribution (n, median, p25/p75) for the last 6 quarters.

TASK 4 — G18/G19: on-market counts + months-to-clear
G18: Market Turnover Monthly on-market counts are wrong vs reality.
G19: TTM turnover chart lacks the on-market summary + months-to-clear-inventory
series the deck shows. Both trace to gov listing-history coverage (the known
thin spot). Apply the R68-A playbook to gov: (a) link unlinked listings to
sales; (b) synthesize listing rows from sold deals (price-less, tagged,
same view INCLUDE/EXCLUDE discipline — copy the dia guard pattern verbatim);
(c) add months_to_clear = active_count / TTM monthly sales rate to the TTM
turnover view + chart series. Dry-run gate for the bulk writes (plan JSON →
verification → workstation commit), exactly like dia R68-A.

TASK 5 — G10: sentiment 10+ cohort + 2017-19 price-adjustment gaps
After Task 4's listing lift, re-test the gov seller-sentiment cohort series
(10+ recent gaps; price-adjustment % 2017-19). Apply rolling-3-month pooling
on the 10+ series only if needed (dia Task-3 precedent, label "3-mo pooled").
Genuine gaps documented, not fabricated.

TASK 6 — G13 (R68-G): valuation index min-n gate
Prior finding: the gov index reads priced comps >=500 SF at n=14 — too thin;
it shadows YoY moves and spikes 2025+. Add the min-n gate (TTM n>=12, matching
the dia index gate shipped in batch 3) + verify the 2025 segment against the
deduped count basis from R68-C. If the index still spikes after gating,
decompose which input moves it and report before changing anything else.

TASK 7 — G2/G20: firm-term reconciliation (ACTIVATES when the gov master
comp workbook is uploaded — do not start before)
The gov cap-by-remaining-lease-term charts are jumbled vs the master Excel's
smooth lines. When the workbook lands: extract its sales-comp sheet (terms,
caps, dates, prices) → fingerprint-match against gov sales (the dia identity
test: state + date <=90d + price <=3% + cap <=5bp on untouched source columns)
→ term backfill with --lock-mode=all + master_curated provenance (dia batch-3
pattern, dry-run → verification gate → workstation commit). Same for any
G5/G6 reconciliation once the PDF arrives (both tagged pdf_reconcile).

CONSTRAINTS
- Bulk writes (Tasks 4b, 7): dry-run plan JSON → verification gate →
  workstation commit. Everything else: migrations applied live as usual.
- Gov consumer-view parity: where multiple views feed the same chart family,
  they must agree (the R66x invariant, gov edition).
- Acceptance per task: before/after at Dec-2025 + the affected early periods,
  with n receipts.
```
