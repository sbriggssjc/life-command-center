# EXT2a — a schedule line can carry the lease's own base/additional split; parse the line before trusting its figure

> **Small, pure-function, ground-truthed.** The EXT2 floor re-run fired the named residual risk on
> doc 255 and Scott spot-checked the actual lease (Chesterbrook Champaign, 2026-09-03). **Read
> first:** `responses/done/EXT2-floor-measurement.response.md` §2 ·
> `responses/done/EXT2-lease-defines-rent-and-tenant.response.md` §4 (the ordering decision + its
> named risk) · `api/_shared/bov-extract.js` (`resolveYear1Rent`, `resolveYear1TotalRent`,
> `cleanRentPeriod`, `amountFromAsStated`).

## 0. Ground truth (the lease was read; do not re-derive)

Exhibit B, verbatim: *"Months 1-60 - Base rent of $7,445 per month plus $1,019 per month for
equipment. Total payment each month $8,464."* Months 60–120 escalate **the $7,445** and drop
equipment to $530; months 121–180 use "the rental for year 1, **not including the equipment
payment**". The lease's own machinery defines base = $7,445; $8,464 is labelled "Total payment".

**Correct output for the 255 shape:** `year1_rent = 89,340` (source `schedule_period_1`, from the
period's OWN "Base rent" figure) · equipment in `additional_rent` · `year1_total_rent = 101,568`.
Current output: 101,568 / 113,796 — the schedule's total won and equipment was added again.

## 1. Build (two rules, one owner each)

**1a. `baseFromPeriodQuote(as_stated)`** — when a schedule period's quote itself states a
base/additional split (`Base|Minimum|Fixed rent of $X … plus $Y … [Total … $Z]`), the period's
rent figure is **X**, and each `plus` component is emitted as an `additional_rent` row for that
period (label from the quote's own wording, e.g. `equipment`) if not already present from the
top-level extraction (dedupe on label + amount — never double-emit). A period quote carrying only
one figure is unchanged. No arithmetic beyond reading labelled figures out of one quote — the same
class as `amountFromAsStated`. Prompt nudge: the schedule contract's `as_stated` should carry the
period's FULL line, not a bare figure (doc 255's came back as just `"$8,464"`); add one sentence to
the rules and keep the parser tolerant of both.

**1b. `resolveYear1TotalRent` composition guard** — when `year1_rent_source` is `schedule_*` and
the period quote did NOT yield a base/additional split (composition unknown), `year1_total_rent`
is **null** with note `schedule_composition_unknown` — **unless** the schedule figure equals the
top-level base quote (composition known: base alone; current behaviour stands). When 1a resolved
the split, total = base + the period's additional components (the 255 ground truth). A total must
never exceed base + all stated components, and equipment must appear exactly once — assert both.

## 2. Guard — extend `test/ext2-lease-defines-rent-and-tenant.test.mjs`

- The 255 shape WITH the full period line → 89,340 / 101,568 / `schedule_period_1`; the mutation
  that returns the total as base goes RED; the double-count mutation goes RED.
- The 255 shape with only `"$8,464"` as the period quote (today's degraded form) → `year1_rent`
  101,568 (the only figure the quote states — honest), `year1_total_rent` **null** +
  `schedule_composition_unknown` (the §1b guard; no double count even in the degraded case).
- A single-figure schedule (299 shape) unchanged; a schedule == base quote unchanged.
- Comments AND literals stripped before source assertions (the prompt's rules will name these
  figures); mutation-verify; report the RED count.

## 3. Verify

Floor re-run is Scott's (workstation) — expected on 255: both sides `year1_rent 89,340` when the
model returns the full period line, or an honest null total when it does not. Record
`responses/EXT2a-schedule-line-definition.response.md`; one line in
`ai-and-ocr-cost-strategy.md`'s EXT status; close backlog EXT2a in the same change.
