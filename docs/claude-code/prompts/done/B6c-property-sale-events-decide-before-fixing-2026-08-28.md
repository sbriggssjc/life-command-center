# B6c — `property_sale_events`: decide whether it has a future BEFORE fixing its types

**Window:** data-process & automation audit (lettered prompts). **Backlog rows:** `B6c`, and it is
**D2's known instance**. **Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` (definition of done) ·
`docs/architecture/data-coherence-invariants.md` **I3** (link-column type audit).
**Source:** `docs/audits/B6_OWNERSHIP_CHANGE_SIGNAL_COVERAGE_2026-08-28.md`.

---

## 0. ⚠️ This is NOT "fix the bigint" — read §1 before writing a migration

B6 found `property_sale_events` — the table whose entire purpose is to **join transaction history
(comps) to ownership history** — carrying `ownership_history_id` and `sales_transaction_id` on
**5,208 rows with both populated on ZERO**. The cause is a type defect, confirmed exactly:

| gov column | type | its target | target PK type |
|---|---|---|---|
| `property_id` | `bigint` | `properties.property_id` | `bigint` ✅ |
| **`sales_transaction_id`** | **`bigint`** | `sales_transactions.sale_id` | **`uuid`** ❌ |
| **`ownership_history_id`** | **`bigint`** | `ownership_history.ownership_id` | **`uuid`** ❌ |

**The column cannot hold the value it is named for.** A writer raises `22P02`; nobody wrote one, so
nobody saw it. **There is no FK on either column**, so nothing declares the intent.

**The positive control is live and strong.** dia's identical table has **`integer`** PKs on both
targets — compatible with its `bigint` link columns — and links **2,432 of 2,730 rows (89%)** on the
sales side. *The design works. gov's instance is structurally impossible.*

---

## 1. 🚨 What I measured today, which changes the question

**Before fixing the types, look at what would be linked.** gov `property_sale_events`, by source:

| source | rows | newest row | party UUIDs | party names |
|---|---:|---|---:|---:|
| **`ownership_change_stub`** | **2,571** | 2026-03-27 | **0** | 2,571 |
| **`ownership_change_stub_spe_rename`** | **348** | 2026-03-27 | **0** | 348 |
| `excel_master` | 1,291 | 2026-03-05 | **0** | 1,277 |
| `costar_export` | 994 | 2026-03-09 | **0** | 928 |
| `county_deed:*` | ~4 | 2026-04-06 | **0** | 4 |

Three facts the type defect was hiding:

1. **56% of the table (2,919 rows) is `ownership_change_stub*` — the RETIRED, CIRCULAR mechanism**
   gov R37 explicitly retired. It is minted *from* ownership history, so linking it back to
   ownership history is a loop. (B6 raised this against B5; B5 measured **2 of 2,776** and shipped —
   but here it is **the majority of the population**, not a rounding error.)
2. **`buyer_id` and `seller_id` are `uuid` and populated on ZERO of 5,208 rows.** It is not only the
   two link columns that are empty — **every id column in this table is empty.** It holds text names
   only.
3. **The producer is dead** — newest row 2026-04-06, which is the 144-day `feed_stale` alert.

⚠️ **And on dia, where the link CAN be populated, `ownership_history_id` is set on 52 of 2,730 rows
(1.9%).** The sales side works at 89%; **the ownership side is barely used even where it is
possible.** So "fix the type and the join lights up" is not supported by the one working instance.

---

## 2. The question to answer first

**Does `property_sale_events` have a consumer, and is it the right table for the job?**

- **Grep for readers** of `property_sale_events` on both domains — app code, views, functions, MCP,
  exports. **If nothing reads it, fixing the type builds a link nobody follows** (Class 2), and the
  honest answer may be to **retire the table** rather than repair it.
- **Ask what it would tell us that we cannot already get.** `ownership_history` now carries the
  transitions (18,953 rows after B5) and `sales_transactions` carries the comps; LCC already joins
  them through the A2 apply path and `lcc_entity_portfolio_facts`. **Is this table a third
  representation of a relationship two stores already model?** If so, say so plainly.
- **If it DOES have a future, the 2,919 stub rows are the first decision**, not the types: linking a
  circular source into the ownership store is the thing B6 warned about.

---

## 3. If the answer is "repair it"

**3a. Type change on a live column is not additive — sequence it.** Follow the repo's rule:
**additive schema before the writer; a constraint that enforces writer output AFTER the writer
deploy.** Both columns are 100% NULL, which makes the change unusually safe — **say so, and prove it
(`count(*) where col is not null` = 0) rather than assuming.**

**3b. Add the FKs.** The absence of an FK is why this survived: nothing declared the intent, so
nothing checked it. **A nullable FK is cheap; a type mismatch is unpayable.**

**3c. Do not backfill from the stub sources** without a decision on §2's third bullet.

**3d. Register the table in B6a's producer registry** with an expected cadence, or a revived
producer goes dark the same way. **Its `feed_stale` alert must auto-resolve** — that is the
acceptance test, not a green run.

## 4. And run D2 while you are here — this is its known instance

**`docs/os/PLANNED-BACKLOG.md` D2** is the sweep this defect motivated. **One catalogue query finds
every instance across all three projects:** any column named `<table>_id` whose type ≠ that table's
PK type.

- Report every hit with row counts and whether the column is populated.
- ⚠️ **Expect false positives** — a `*_id` column may legitimately not be an FK (an external id, a
  vendor reference, a `source_ref`). **Name them as accepted, do not "fix" them.**
- **Positive-control the query** by confirming it finds the two known gov columns and the dia twin's
  compatible ones. **A sweep that returns nothing is a bug signal, not a clean bill of health**
  (P182).
- **Fix nothing else in this prompt** — name, size, rank. One repair per change.

## 5. Verification

- **The §2 question is ANSWERED in writing**, whichever way it goes.
- If repaired: both columns are `uuid`, both FKs exist, **link counts move off zero**, and the
  `feed_stale` alert auto-resolves. If retired: the table is dropped or tombstoned **and its alert
  is retired with it**, so the surface does not keep a permanent open alert for a dead table.
- **D2's sweep output is filed**, with accepted false positives named.
- Guards mutation-verified RED, comments stripped before matching.

## 6. Deliverable

`docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`, plus the **`BUILD-TURN-PROTOCOL.md` closing
checklist**: `PLANNED-BACKLOG.md` (B6c and **D2**), `data-coherence-invariants.md` **I3** (its
detector row currently reads ❌ none — D2's sweep is that detector), `connectivity-and-open-threads.md`
§4j, and a STATUS entry.

⚠️ **"Retire it" is a fully acceptable outcome and may be the right one.** A5, C1, A3, P196 and P198
all ended in *do not build*, and each was worth more than the build would have been. **What is not
acceptable is fixing the types without answering whether anything will ever read them.**
