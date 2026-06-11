# Claude Code prompt — R76 remaining layers: E (design) + F (gov #20 cap basis, audit-first) + G (outlier)

> The R76 cohort/accuracy headline (Layer A) and the dia on-market/asking reconciliation
> (Layer C) are closed and blessed. These three remain from Scott's June-10 notes. E is
> pure chart-code (straight to gate). F needs Scott's decision but is AUDIT-FIRST. G is a
> quick outlier review. Receipts per item; per-item before/after at recent + a historical
> anchor; any write/exclusion dry-run → gate.

## Layer E — chart design (no data decisions; chart-code → gate)

- **E1 gov #18 Lease Termination** — STACK the two lease-term categories: firm + soft term
  counts as stacked bars (total height = total active lease inventory over time) + the
  rate line on the secondary axis. (R73 C2 was specced; verify it didn't land and finish.)
- **E2 gov #13 Cap by Credit Tier** — consistent cohort line styles (muni/state currently
  different line types — fix to match). Pair with credit-tier cohort n (still "missing
  data" — confirm genuine sparsity vs a filter dropping eligible rows).
- **E3 gov #26 Volume+Cap** — revisit combo chart type + brand palette (NM Blue → Sky →
  Aquamarine → … order) for legibility; confirm the R73 C4 secondary-axis separation
  landed.
- **E4 Y-axis labels + zoom** — add axis titles and sensible min/max to the flagged line
  charts so line movement is legible (dia note 2; gov note 24).

## Layer F — gov #20 cap basis (AUDIT-FIRST, then the accurate basis). Scott's gate.

Scott's instruction: **accuracy first, but FIRST ensure there are no outliers / clear
errors / ingestion gaps taking gov #20 unnecessarily higher.** Mirror the dia approach —
scrub the cohort, THEN choose the basis.

- **Phase 1 — AUDIT (receipts, read-only).** The gov #20 cohort (NM vs market caps):
  - List outlier caps (outside a sane band, e.g. <4% or >12%, or |z| beyond a threshold).
  - Ingestion duplicates / double-counted sales inflating either side.
  - Cap-quality / NOI-source issues (use the gov `cap_rate_quality` ladder — flag
    `market_implied` / pro-forma rows that may overstate).
  - Any sale-linked or mis-classified rows pulling NM or market unnaturally high.
  - Quantify per side (NM vs market), with a before/after-cleanup cap for each.
- **Phase 2 — present the two bases WITH the audit-cleaned numbers.** Curated Internal-comp
  basis (like dia → ~6.4%) vs raw market-universe view, and the spread each produces after
  the outlier/error scrub. **Scott picks the basis. No view change until his gate.**

## Layer G — dia 2022/23 outlier

- Scott: "huge outlier taking the data significantly up around 2022/23." Identify the chart
  + the sale(s) driving the spike. Confirm it's not the already-excluded HQ2 $93.5M. If a
  non-representative deal, band/exclude per the existing `exclude_from_market_metrics`
  policy; else document why it stays. Receipts: the sale(s), the chart, before/after.

## Guardrails

- E ships as chart-code → gate (re-export confirms render). F + G are receipts-first; any
  write/exclusion dry-run JSON → Scott's independent verification → commit. Per-item
  before/after at a recent + a historical anchor.
- Order: E and G can run now (no decisions). F: bring the Phase-1 audit + the two-basis
  spread to the gate for Scott's call.
