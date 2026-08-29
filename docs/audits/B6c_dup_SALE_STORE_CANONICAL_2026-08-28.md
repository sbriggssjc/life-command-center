# B6c-dup — the two sale stores disagreed about which is canonical

**Window:** data-process & automation audit (lettered prompts) · **Backlog:** `B6c-dup`
**Measured & shipped:** 2026-08-29 (the brief is dated 2026-08-28; the filename follows the brief)
**Contract:** [`BUILD-TURN-PROTOCOL.md`](../os/BUILD-TURN-PROTOCOL.md) ·
[`data-coherence-invariants.md`](../architecture/data-coherence-invariants.md) **I1 / I7**
**Source:** [`B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`](B6c_PROPERTY_SALE_EVENTS_2026-08-28.md) §5

**Outcome: the collision was real, the write path leaked, and the damage was ZERO.
Fixed forward. No backfill, because there was nothing to backfill.**

---

## 0. The answer, up front

| question | answer |
|---|---|
| Which store is canonical? | **`sales_transactions`.** 77 of 77 gov views that read a sale store read it, **all 30 `cm_gov*` Capital Markets views** included; **zero** read `property_sale_events`. |
| Does the write path leak? | **Yes — confirmed behaviourally.** An operator sale reaches `property_sale_events` and `properties.latest_sale_price`; `sales_transactions` delta **0**. |
| How many comps are missing? | **ZERO.** Keyed on `(property, YEAR-MONTH)`: 1,687 live twins, 7 quarantined, **0 with no twin in any state**, out of 1,694. Positive-controlled at 1,694. |
| How many "dangling" rows? | **ZERO.** The FK makes it impossible. The 321 are **`property_id IS NULL`** — a different defect with a different cause. |
| What shipped? | `trg_gov_pse_propagate_to_sale`, the single owner of PSE → spine; `detail.js`'s comment corrected; the unearned freshness expectation retired. |

**The brief's headline figures — 330 / $4.48B, then 9 / $558.8M — are both wrong, and so was
my own first re-measurement of 6 / $29.2M.** All three are artifacts of the same two mistakes.
§1 is the correction; it is the most transferable part of this document.

---

## 1. ⚠️ Three successive wrong numbers, two root causes

### 1a. The exact-date join is the wrong key, because the spine stores month-truncated dates

Every "orphan" count came from anti-joining `property_sale_events` against `sales_transactions`
on `(property_id, sale_date)` **exactly**. But `sales_transactions.sale_date` is **month-truncated
for its dominant source**:

| `data_source` | rows | on the 1st | % |
|---|---:|---:|---:|
| `costar_sidebar` | 7,865 | 6,871 | **87.4%** |
| `ownership_change_stub` | 2,940 | 2,940 | **100%** |
| `ownership_change_stub_spe_rename` | 373 | 373 | **100%** |
| `excel_master` | 1,342 | 118 | 8.8% |
| `costar_export` | 1,152 | 46 | 4.0% |

So an event dated `2022-08-04` and the spine row dated `2022-08-01` are **the same sale**, and an
exact-date join reports it as missing. Re-keyed on `(property, YEAR-MONTH)` the orphan count is
**0 of 1,694**, with an impossible-price positive control returning **1,694** — the detector fires,
the zero is real.

All six of the brief's named "orphans" have an **exact price twin** in the spine, 3–21 days apart,
**every twin on the 1st of the month**:

| sale_event_id | property | PSE date | spine date | gap | price (identical both sides) |
|---:|---:|---|---|---:|---:|
| 1275 | 23547 | 2022-08-04 | 2022-08-01 | 3d | $10,800,000 |
| 5044 | 23461 | 2013-11-06 | 2013-11-01 | 5d | $5,571,500 |
| 2202 | 905 | 2020-10-16 | 2020-10-01 | 15d | $4,000,000 |
| 5604 | 23525 | 2011-01-05 | 2011-01-01 | 4d | $3,280,000 |
| 3861 | 905 | 2016-07-19 | 2016-07-01 | 18d | $3,000,000 |
| 5831 | 23355 | 2004-12-22 | 2004-12-01 | 21d | $2,550,000 |

**This is the same class as P189's normalizer and A2's `strict_core`: a comparator structurally
unable to express the question returns a plausible number instead of an error.** The tell was
available for free — a ±31-day variant returned **0** while the exact-date variant returned 6. **Run
the neighbouring key before believing an anti-join.**

⚠️ **And `dedup_natural_key` already encodes the right granularity** —
`property | round(price/1000)*1000 | YYYY-MM`. The spine had been telling us its own join key all
along; three separate measurements used a stricter one anyway.

### 1b. `property_id IS NULL` is not a dangling reference — and the FK makes dangling impossible

The brief corrected 330 → 9 by finding that "321 of the 330 have a `property_id` that does not
exist in `properties` at all." Measured:

```
dangling (property_id set, target absent) ......... 0
property_id IS NULL .............................. 376
```

**Zero.** `fk_pse_property FOREIGN KEY (property_id) REFERENCES properties(property_id)
**ON DELETE SET NULL**` — so a dangling value cannot persist: deleting a property **nulls the
event's link instead**. 374 of the 376 are `costar_export`, **all** with `updated_at > created_at`,
and **321 of them were detached in a single batch on 2026-04-03** — a bulk property deletion
(merge/cleanup), silently, with no record on the event.

I reproduced the brief's mistake before catching it: my own first split used
`LEFT JOIN properties ... WHERE prop_live = false`, which lumps NULL in with dangling. **A left
join cannot distinguish "points nowhere" from "points at nothing."** Ask which one you mean, in
SQL, before counting.

**Consequence for the backlog:** `B6c-orphan`'s framing — *"I3 asks whether a link column can HOLD
its target's key; this asks whether the key it holds still EXISTS"* — rests on a premise the FK
rules out. The real question is narrower and different: **what should happen to an event whose
property was deleted?** Today: nothing, silently, forever.

### 1c. `transaction_state` was never read — and the "$529.6M invisible to the spine" is quarantine

Three live priced events sit on a spine row carrying a **NULL `sold_price`**, $529.6M including the
$379.5M row the brief flagged. That reads like a field-level gap. It is not:

| property | spine date | `transaction_state` | `exclude_from_market_metrics` |
|---:|---|---|---|
| 14363 | 2017-02-21 | `needs_review` | **true** |
| 13256 | 2023-06-01 | `duplicate_superseded` | **true** |
| 4485 | 2020-12-23 | `needs_review` | **true** |

**All three were deliberately quarantined.** Across the whole population: **1,687 live twins, 7
quarantined ($604.1M), 0 absent, and 0 live twins with a NULL price.** The spine is complete and
has already judged the residue. This is exactly the check the brief called for in rule 2c — and it
had to be run against `transaction_state`, not only against `exclude_from_property_linking`.

---

## 2. The finding that survived: the write path

`detail.js` carried, in its own comments, *"Canonical target: property_sale_events. The legacy
sales_transactions sink has been retired for write paths."* Both halves are false.

Confirmed **behaviourally**, in a rolled-back transaction, rather than by reading the propagation
code — which is what the brief's verification demanded:

```
PROBE(rolled back) property_id=1
  | sales_transactions   0 -> 0   (delta 0)   ← never reaches the comps spine
  | property_sale_events 0 -> 1   (delta 1)
  | properties.latest_sale_price = 12345678.00 ← PSE's own trigger works fine
```

**⚠️ And the leak has produced zero damage, because the path has never been used.** Every one of the
5,208 PSE rows comes from a bulk importer, each of which wrote `sales_transactions` independently;
inserts stopped **2026-04-06**:

| source | rows | first = last insert |
|---|---:|---|
| `ownership_change_stub` | 2,571 | 2026-03-27 |
| `excel_master` | 1,291 | 2026-03-05 |
| `costar_export` | 994 | 2026-03-09 |
| `ownership_change_stub_spe_rename` | 348 | 2026-03-27 |
| `county_deed:*` | 4 | 2026-04-06 |

**No operator-sourced row exists.** So this is a fix-before-it-bites, not a cleanup — and the
correct size of the build is small. **The historical completeness of the spine is not evidence that
propagation exists; it is evidence that both importers wrote both tables.** The first time somebody
uses the form, it leaks 100%.

---

## 3. The decision, in writing

> **`sales_transactions` is the canonical comps spine.**
> **`property_sale_events` is a capture / event surface that propagates into it.**

Not the other way round, and **not** by repointing 77 views. PSE keeps its three behavioural
triggers (close-listing, propagate-to-`properties`, cap-rate snapshot) and stays the panel's write
target; what it gains is an outbound path.

`detail.js` is corrected at all four sites (both write paths, both read paths), each carrying a
`B6c-dup` marker and the old wording quoted so the next reader knows what changed.

---

## 4. What shipped

**`sql/20260829_gov_b6cdup_pse_propagate_to_sales_transactions.sql`** (gov, applied 2026-08-29) —
`trg_gov_pse_propagate_to_sale`, AFTER INSERT on `property_sale_events`:

| gate | outcome |
|---|---|
| `property_id IS NULL` | `skipped_no_property_link` |
| no `sale_date` | `skipped_no_sale_date` |
| no price | `skipped_no_price` |
| `ownership_change_stub*` | `skipped_ownership_stub` |
| twin exists, **not live** | `skipped_spine_row_quarantined` |
| live twin, nothing to add | `skipped_already_in_spine` |
| live twin missing a field | **`filled_blanks`** (COALESCE only) |
| no twin | **`inserted`** |

- **Key:** `(property, YEAR-MONTH, price-to-$1k)` — §1a.
- **One owner per state transition:** this trigger is the only PSE → spine path. The panel must not
  gain a second write; a guard enforces that.
- **Fill-blanks:** never overwrites. ⚠️ **Dormant today** — 0 live spine rows carry a NULL price —
  so it is proven by a constructed round trip, not by data.
- **Routing through the spine is the point:** the insert fires the spine's own 16 triggers, so cap
  rate, firm term, agency, the Northmarq flag, listing-close and property propagation all derive
  for free. Verified: `cap_rate_history` +1 on the probe.
- **Fail-soft, never silent:** every decision — each skip, each failure with its SQLSTATE — lands in
  `gov_pse_propagation_log`. Kill switch: `gov_pse_propagation_enabled()`. Batch-reversible.
- **`field_source_priority`** (LCC Opps): `property_sale_events` registered at **priority 5** on
  `gov.sales_transactions.{sold_price, sale_date, sold_cap_rate, buyer, seller}` — above every
  captured source (`county_records` 10/15, `om_extraction` 35, `costar_sidebar` 60) because an
  operator typed it, below `manual_edit`/`manual_resolution` (1) because a direct curated edit still
  wins.

**`sql/20260829_gov_b6cdup_retire_pse_freshness_expectation.sql`** — the 45-day expectation on
`property_sale_events` is **retired, not resolved** (`is_active = false`, reason recorded in
`description`). Its bulk producer was retired on purpose and its only live producer is an operator
form with no cadence, so the SLA fired whenever nobody typed a sale for six weeks and then sat open
forever. **The expectation moved to where it belongs:** feed `sales_transactions` is already
registered at 45 days and reads **10 days old**, and B6c-dup is what makes operator sales reach it.
Verified: gone from `v_feed_freshness`, 2 stale feeds remain (B6a's registered dead producers),
0 open `feed_stale` alerts.

---

## 5. ⚠️ The quarantine gate — caught by the probe, one pass before it mattered

**The first version of the propagator filtered its twin lookup on `transaction_state = 'live'`.**
That is the natural thing to write, and it is wrong in a way no dry run shows: it makes a
**quarantined** twin *invisible*, so the propagator falls through to `INSERT` and mints a **fresh
live comp for a sale somebody deliberately excluded** — straight into the Capital Markets book.

The C3 probe case caught it: expected `filled_blanks`, got `inserted`. The lookup now spans **every**
`transaction_state`, prefers a live twin, and treats a non-live twin as a **named terminal skip**.

**The trade, stated:** a quarantined twin blocks that `(property, month, price-to-$1k)`. A genuinely
different sale in the same month at a different price still inserts, because the price tolerance is
part of the key. A blocked row is logged with the spine `sale_id` and the blocking state, never
silent.

**The generalisable lesson: a filter that narrows a lookup to the rows you want to ACT on will hide
the rows that should STOP you.** A dedup probe must see the whole population, including the part
that has been excluded — the same shape as A5c's mint/probe asymmetry, where sharing one filter
between two questions turned "we decided not to work this" into "this resolved."

⚠️ **A second defect surfaced the same way and proves the ledger's worth:** `v_fields || 'sold_price'`
raises **22P02 `malformed array literal`** (`text[] || <untyped literal>` parses the literal as an
array literal). The fail-soft handler recorded it as `outcome='failed'` with its SQLSTATE instead of
swallowing it. **A fail-soft path without a ledger would have made this a permanent silent no-op.**

---

## 6. Verification

| the brief asked | result |
|---|---|
| canonical decision written down | ✅ §3, plus the migration header |
| `detail.js` comment corrected | ✅ 4 sites, each `B6c-dup`-marked, old wording quoted |
| orphaned priced events on live properties → 0 | ✅ **already 0** on the correct key (1,694 checked, positive-controlled) |
| a NEW operator sale reaches `sales_transactions` | ✅ end-to-end, not by reading code (§7) |
| `sales_transactions` moves by exactly what propagated | ✅ counted from the INSERT's own `RETURNING`, never a plan join |
| the 321 sized and named, not touched | ✅ **376 `property_id IS NULL`**, 374 `costar_export`, 321 detached 2026-04-03 — untouched |
| guards mutation-verified RED, comments stripped | ✅ §8 |

### 7. The live round trip — all five paths, one rolled-back transaction

```
C1 new comp             ST 0 -> 1    inserted                       cap_rate_history +1
C2 month-truncated twin ST 24 -> 24  skipped_already_in_spine       (no duplicate)
C3 quarantined twin     ST 1 -> 1    skipped_spine_row_quarantined  (no resurrection)
C4 live null-price twin              filled_blanks {sold_price,sold_cap_rate,buyer,seller}
C5 populated field                   skipped_already_in_spine       (buyer NOT clobbered)
```

**Zero residue after rollback:** ledger 0 rows · `property_sale_events` 5,208 · `sales_transactions`
15,111 — all unchanged. (P195: a reversal path that has never been run is a claim, not a capability;
the same applies to a propagation path.)

### 8. Guards

- **`test/b6cdup-sale-store-canonical.test.mjs`** (LCC, 5 tests, **5/5 mutations RED**).
  ⚠️ **This is the one guard in the repo that CANNOT strip comments, because the defect IS a
  comment** — and the correction quotes the old wording verbatim, so a naive grep matches the fix.
  Resolved by **proximity, not presence**: the old claim may appear only within 8 lines of a
  `B6c-dup` marker. A third test pins that the markers still exist, so the proximity rule cannot go
  vacuously true. A fourth guards the *harm* rather than the wording — `detail.js` must never gain a
  client-side write to `sales_transactions`.
- **`tests/unit/test_b6cdup_pse_propagation.py`** (gov, 11 tests, **12/12 mutations RED**), comments
  stripped first — the migration header quotes every hazard it removes.
  ⚠️ **One assertion passed its own mutation and had to be rewritten.** The quarantine test grepped
  the whole file for `transaction_state IS DISTINCT FROM 'live'` — which **also appears in the twin
  lookup's `ORDER BY`** — so deleting the gate left it green. Re-anchored on the `IF … THEN` branch
  and on the named outcome inside it. **A file-wide grep for a predicate that legitimately appears
  twice is not a guard; anchor on the branch.**

---

## 9. What was deliberately NOT done

- **No backfill.** There is nothing to backfill (§1a).
- **The 376 unlinked events are untouched** — sized and named, `B6c-orphan` re-scoped (§1b).
- **The 7 quarantined twins are untouched.** They are the spine working.
- **dia is out of scope and is NOT the same shape.** dia: **72 views read `sales_transactions`, 2
  read `property_sale_events`** — a milder collision with real PSE consumers (`fn_listing_close_if_sold`
  reads `pse.sales_transaction_id`, which is why dia has that FK and gov does not). **Do not port
  this trigger to dia without re-measuring**; one repair per change. Filed **B6c-dup-dia**.
- **`B6c-oh` / `sales_transaction_id`** unchanged. B6c held them pending this decision; the decision
  is now made (PSE stays, as a capture surface), so they can proceed on their own terms.
