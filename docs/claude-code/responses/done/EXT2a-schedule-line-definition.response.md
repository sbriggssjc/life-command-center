# EXT2a — response (reconciled from desktop copy, 2026-09-03)

PR #2098, branch `claude/schedule-period-rent-split-r5l2zo`. **Merged.**

## What shipped

- **`baseFromPeriodQuote(as_stated)`** — reads a base/additional split directly out of a
  schedule period's own verbatim quote. Ground-truthed against doc 255's actual lease text
  (base $7,445/mo, equipment $1,019/mo; $8,464 is the labelled "Total payment," never base).
- **`cleanRentPeriod`** now uses the period's own base figure (never its stated total) when a
  split is found, and carries the components as a period-scoped `additional_rent` list.
- **`resolveYear1Rent`** returns the selected period so `extractTenantFromLease` can merge its
  components into the top-level `additional_rent`, deduped on `(kind, amount)`.
- **`resolveYear1TotalRent`** gained a backward-compatible `opts` arg and a
  `schedule_composition_unknown` guard for the case where a schedule figure disagrees with the
  top-level base quote and no split was found — null rather than guessing either way.
- One prompt sentence nudges the model to quote the period's **full line**, not a bare total.

## Guard

`test/ext2-lease-defines-rent-and-tenant.test.mjs` extended per spec §2 — the full-line 255
shape, the degraded bare-total 255 shape (null total + `schedule_composition_unknown`, no
double count), the unchanged single-figure (299) and schedule-equals-base shapes. Full suite
green (`npm test` exit 0). New-area coverage: 39/39.

## A bug found and fixed along the way

A literal apostrophe inside a regex character class (`[a-z0-9 /&'-]`) tripped the test file's
naive comment/literal-blanking regex — it blanked ~20 lines of real code and made an unrelated
test fail. Fixed with `\x27`. **Transferable lesson:** a literal-blanking regex written for one
file's quoting style can be defeated by a character class containing an unescaped delimiter
elsewhere in the same source; the fix generalizes to any future guard doing string-literal
stripping over source that also contains regex literals.

## Result for the 255 shape

`year1_rent = 89,340` (source `schedule_period_1`) · equipment lands in `additional_rent` ·
`year1_total_rent = 101,568` (unchanged, now correctly composed rather than double-counted).
Was 101,568 / 113,796 before this fix.
