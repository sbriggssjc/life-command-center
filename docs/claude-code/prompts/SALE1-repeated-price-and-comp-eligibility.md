# SALE1 — one price propagated across several sales of the same property, and CoStar's own "not a comp" markers ignored

**Repo: `life-command-center`.** Target **Dialysis_DB `zqzrriwuavgrquhisnoa`** primarily, **gov
`scknotsqkcheojiaewwh`** for the mirror check. **Diagnosis first — this is comp data, so nothing is
deleted and nothing is auto-excluded until the mechanism is named.** Found live 2026-09-03 from a
single operator capture; Scott's standing requirement is that ingested sale prices be accurate.

**Read first:** `CLAUDE.md` § B6c-dup (`sales_transactions` is the canonical sale spine; PSE is a
capture surface; **`sale_date` is month-truncated for `costar_sidebar` — 87.4% day-1**, and
`dedup_natural_key` encodes exactly that granularity) → § A2b (*one conveyance recorded on several
dates*, and the earliest-date rule and why it was chosen) → `docs/architecture/broker-and-firm-identity.md`
(the composite-string class, same producer) → the dia `sales_transactions` cap-rate framework in
`CLAUDE.md` (`cap_rate_final` is DERIVED from `sold_price`, so a wrong price is a wrong cap rate on
every consumer).

## The trigger case — verify it first, it is the whole shape

**dia property 35612, `1507 Hillview Dr, Hillsboro, TX 76645`** (Fresenius Kidney Care) carries
**three sales at the identical `$1,593,750`**, all `transaction_state='live'`, all
`exclude_from_market_metrics = false`:

| sale_id | date | transaction_type | note |
|---|---|---|---|
| 8091 | 2009-03-23 | **Nominal Transfer** | Warranty Deed, Doc# 2009.25964 |
| 8090 | 2024-05-15 | *(null)* | "Type: Resale", Doc# 2024.156700 |
| 8224 | 2026-03-30 | Investment | **"This property underwent a change in title vesting and is therefore not suitable for sales comparable purposes."** |

Each produced a *different* `cap_rate_final` (5.24% / 7.48% / 7.84%) because `rent_at_sale` moved —
so **one price is generating three comps at three cap rates**, and at least two of the three events
are not arm's-length.

## What is already measured (verify, do not re-derive)

- **668 (property, price) groups / 1,517 rows / 568 properties** carry the same price on >1 sale.
- **272 groups span more than a year**; **166 of those still have 2+ rows in comps.**
- **The dedup machinery works and is structurally blind to this.** `dedup_natural_key` =
  `property | round(price/1000)*1000 | YYYY-MM` is UNIQUE-indexed and IS resolving the same-month
  case (485 collision groups, losers correctly `transaction_state='duplicate_superseded'` with a
  `dedup_group_id`). Property 26404 (Brookline MA) shows both halves: the 2016-11 and 2018-04 pairs
  are correctly deduped, while **2016-11 / 2018-04 / 2021-08 all at $10,260,000 are all live.**
  **The key cannot see a cross-month repeat, which is exactly the propagation shape.**
- **Comp-eligibility markers are not read:** `transaction_type ilike '%nominal%'` = **38 rows, 28 of
  them in comps**; CoStar's own *"not suitable for sales comparable purposes"* string appears on
  **1** row and it is in comps. `exclude_from_market_metrics` is true on 1,750 of 4,785 rows, so the
  column is used — just not by these signals.

## Answer these, in order

1. **Which row's price is real, and where did the others get it?** Take the 166 groups and split by
   how the price arrived: is `sold_price` on the older rows written by the same `data_source` as the
   newest? Read `notes` / `sale_notes_raw` — the Hillsboro rows carry a per-sale Doc# and a *shared*
   marketing blurb, which suggests the blurb (and possibly the price) came from ONE listing and was
   stamped across the history table. **Name the writer** (`sidebar-pipeline.js`, the historical CSV
   import, `process_sidebar_extraction`, the PSE trigger) and show the code path that assigns
   `sold_price` when the capture's history table has dates and parties but no per-row price.
2. **Is the repeat ever legitimate?** A property genuinely reselling at the same price years apart
   is possible (an intra-family transfer at the original basis, an option strike). Read named rows.
   Quote the share that is genuine vs propagated — do NOT assume all 166 are defects.
3. **Comp eligibility.** Should `transaction_type ilike '%nominal%'`, "change in title vesting", and
   "not suitable for sales comparable purposes" set `exclude_from_market_metrics`? These are the
   SOURCE's own statement about its own row, which is a different quality of evidence from an
   inference. Measure the blast radius on both domains before proposing it, and check what
   already consumes `exclude_from_market_metrics` (the CM books, `v_sales_comps`, the cap-rate
   ladder) so the effect is stated, not discovered.
4. **The cap-rate consequence.** For any row whose price turns out to be propagated,
   `cap_rate_final` / `calculated_cap_rate` are derived from it. Quantify how many comps in the
   current CM surfaces rest on a propagated price. ⚠️ This is the number that decides urgency.

## Build (only what the answers justify)

- If a writer is stamping a price it was not given: **fix the writer to leave `sold_price` NULL**
  rather than inherit (the standing rule — a field the source does not state stays blank), plus a
  reversible, batch-tagged correction of the affected historical rows. **A NULL price is a missing
  comp; a wrong price is a wrong comp** — say which rows you would null and let Scott confirm.
- If the answer is comp-eligibility: set `exclude_from_market_metrics` from the source's OWN markers
  only, in one owner, reversible by batch tag, never from a name or a heuristic.
- Either way, a **detector** for the cross-month repeat that the dedup key cannot see —
  a review view (no auto-resolve; two live rows at one price is a question, not a verdict), on the
  B6c-dup pattern.

## Verify on

- The 166 groups split into propagated / genuine, with named rows for each side.
- The writer named with a file:line, or explicitly ruled out with the run-ledger evidence
  (`bridge_runs` / capture ids) — **a code read alone is not the answer** (PR5c-entities-b-dupes).
- Blast radius of any `exclude_from_market_metrics` change, both domains, before and after.
- Comps resting on a propagated price: count + total value.
- Hillsboro 35612 specifically: which of the three is the real sale, and what the other two become.

## What NOT to do

- Do not delete a sale row. Do not widen `dedup_natural_key` to ignore the month without measuring
  what it then collapses (A2b: the party pair matters, and a genuine repeat sale exists). Do not
  infer "nominal" from a price or a name — read the source's own `transaction_type` / notes.

## Report back

The mechanism with its writer · propagated vs genuine split · the comp-eligibility measurement and
recommendation · the cap-rate exposure · the Hillsboro verdict · the detector · anything that
outranks this.
