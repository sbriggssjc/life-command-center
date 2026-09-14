# EXT2a — a schedule line can carry the lease's own base/additional split (2026-09-03)

Ground truth (Scott, doc 255, Chesterbrook Champaign lease, Exhibit B, verbatim):

> Months 1-60 - Base rent of $7,445 per month plus $1,019 per month for equipment. Total
> payment each month $8,464.

Base = $7,445 (Exhibit B's own escalation machinery re-states this figure at months 60–120 and
121–180, "not including the equipment payment"). $8,464 is labelled "Total payment" — a composite,
never the base.

## What shipped

- **`baseFromPeriodQuote(asStated)`** (`api/_shared/bov-extract.js`) — reads a base/additional
  split directly out of ONE schedule period's own verbatim quote ("Base rent of $X ... plus $Y ...
  for `<label>`"). Pure, no arithmetic beyond reading labelled figures out of one quote — the same
  class as `amountFromAsStated`.
- **`cleanRentPeriod`** now calls it: when a period's own quote states the split, the period's
  `base_rent.amount` becomes the BASE figure (never the quote's own stated total), and the
  components ride as a period-scoped `additional_rent` array (annualized via the SAME
  `annualizeRent`, basis inherited from the resolved base basis — `period_quote_split` as the
  source tag throughout).
- **`resolveYear1Rent`** returns which period it selected (`year1_period`) so the caller can pull
  its components in.
- **`extractTenantFromLease`** merges the selected year-1 period's own components into the
  top-level `additional_rent` list, deduped on `(kind, amount)` — not `(label, amount)`, because the
  model's top-level "Equipment Rent" and the period quote's bare "equipment" are the same component
  under two labels that both normalize to the same `kind`.
- **`resolveYear1TotalRent`** gained an optional third `opts` argument
  (`{year1RentSource, baseRentYear1, periodSplitFound}`), fully backward compatible (every existing
  call/test omits it and gets the old behaviour unchanged). New rule: when `year1_rent` came from
  the SCHEDULE and the period's own quote did **not** state its composition (no split found) and the
  schedule figure differs from the top-level base-rent quote, the total is **null** with
  `year1_total_rent_note: 'schedule_composition_unknown'` — we genuinely don't know whether the
  period figure already includes the top-level `additional_rent`, so adding it would double-count
  (the original doc-255 defect) and silently dropping it would understate.
- **Prompt nudge** — one sentence added telling the model a schedule period's `base_rent.as_stated`
  must be the period's FULL line, not a bare total figure, so the split is available to read when it
  exists. The parser stays tolerant of the degraded form (a bare figure) — no split found, honest
  behaviour unchanged (the schedule's only stated figure is what it reports).

## Verified

Doc 255 shape, full period quote → `year1_rent 89,340` (source `schedule_period_1`),
`additional_rent` carries one `equipment` row at `annual_rent 12,228`, `year1_total_rent 101,568`,
`year1_total_rent_note null`. Degraded shape (period quote is just `"$8,464.00 per month"`) →
`year1_rent 101,568` (the only figure the quote states), `additional_rent null`,
`year1_total_rent null` / `no_additional_rent_stated` — unchanged from pre-EXT2a. Composition-unknown
case (schedule states a different, unsplit figure than the top-level base quote, and the lease
separately states an equipment component) → `year1_total_rent null` /
`schedule_composition_unknown`, never a guess in either direction. Single-figure schedules and a
schedule figure that equals the top-level base quote are both unaffected.

## ⚠️ A stray apostrophe inside a regex character class re-triggered the exact class of bug this
file's own comments warn about

`[a-z0-9 /&'-]` — a literal apostrophe inside a `RegExp` LITERAL, not a string — was picked up by
the test file's own literal-blanking regex (`test/ext1-lease-rent-basis-quoted-dates.test.mjs`),
which cannot tell a regex apostrophe from a string delimiter. It opened an unbalanced "string" scan
that swallowed roughly 20 lines of real code between it and the next stray `'`, and every source
assertion downstream started reading blanks. This is the OCR1c apostrophe-in-prose bug one syntax
class over — a bare `'` inside a regex character class is just as dangerous to a naive
comment/literal stripper as one inside a comment sentence. Fixed with `\x27` instead of a literal
apostrophe in the character class. **The lesson for future regex literals in this file: prefer
`\x27` over a bare `'` inside a character class**, since nothing in the source itself tells a reader
(or a stripper) that the apostrophe isn't a string delimiter.

## Guard

`test/ext2-lease-defines-rent-and-tenant.test.mjs` — 6 new tests: the doc-255 full-quote shape, the
no-double-count-with-a-top-level-duplicate case, the degraded bare-figure shape, the
composition-unknown guard, an unaffected single-figure schedule, and a schedule figure matching the
top-level base quote. All new + all 39 total pass; the whole `bov-extract`-touching test population
(162 tests across 15 files) is green.

## Status

Backlog **EXT2a** closed. `ai-and-ocr-cost-strategy.md` EXT status line updated in the same change
(see below).
