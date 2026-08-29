# B6c-dup — the two sale stores disagree about which is canonical

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B6c-dup`.
**Contract:** `docs/os/BUILD-TURN-PROTOCOL.md` (definition of done) ·
`docs/architecture/data-coherence-invariants.md` **I1 / I7**.
**Source:** `docs/audits/B6c_PROPERTY_SALE_EVENTS_2026-08-28.md`.

---

## 0. The finding

**`detail.js` says in its own comments that `property_sale_events` is canonical and
`sales_transactions` is "legacy, retired for write paths." The database says the exact opposite.**

Verified independently (Cowork, 2026-08-28), on gov:

| check | result |
|---|---|
| views reading `sales_transactions` | **76** |
| views reading `property_sale_events` | **0** |
| `cm_gov*` Capital Markets views reading `sales_transactions` | **30** |
| `cm_gov*` views reading `property_sale_events` | **0** |
| propagation PSE → `sales_transactions` | **none** (the reverse direction exists) |

**So a sale an operator types into the property panel never reaches the comps spine.** Both stores
are individually correct with coherent consumers. **Nothing errors, and no component test can see
it, because it is a property of the CONNECTION** — the P0d thesis with an operator-facing cost.

---

## 1. ⚠️ The size, measured properly — and my first number was wrong

**I first reported 330 orphaned priced comps / $4.48B. That was inflated ~8× and you should not use
it.** Priced PSE rows (stubs excluded) with no matching `sales_transactions` row on
(property, exact date):

| source | orphan events | **on a LIVE property** | **dangling `property_id`** | live value | live w/ cap rate |
|---|---:|---:|---:|---:|---:|
| `costar_export` | 325 | **4** | **321** | $157.1M | 1 |
| `excel_master` | 5 | **5** | 0 | $401.7M | 4 |
| **total** | **330** | **9** | **321** | **$558.8M** | **5** |

**The honest headline is 9 orphaned priced sale events on live properties, $558.8M, 5 carrying a cap
rate.** ⚠️ **And that value is CONCENTRATED — a single `excel_master` row is $379.5M of the
$558.8M. Eyeball the nine individually; do not quote the sum as though it were a portfolio.**

⚠️ **The other 321 are a DIFFERENT DEFECT and must not be counted as missing comps: their
`property_id` does not exist in `properties` at all.** That is a dangling-reference / stale-import
problem, filed separately below. **I counted them as missing comps before checking, which is what
made my first number wrong.** *Check what a row points AT before counting it as absent from
somewhere else.*

---

## 2. What to decide, in order

**2a. Which store is canonical? Say it once, in writing, and make the code agree.**
The evidence says `sales_transactions` — 76 views, all 30 CM views, and the whole comps/BOV surface.
`detail.js`'s comment is the outlier. **Do not "fix" this by making 76 views read PSE.** The likely
correct shape is: **`sales_transactions` is the spine; `property_sale_events` is a capture/event
surface that must PROPAGATE into it** — which is exactly the direction that does not exist today.

**2b. Fix the ongoing leak (the write path) before any backfill.** Nine rows is a small backfill; a
write path that keeps producing orphans is a permanent one. **Class 8: a one-shot repair of a
recurring producer is a chore you repeat silently forever.**

**2c. Then decide the nine.** They are few enough to inspect by hand. **Some may be excluded by
design** — `sales_transactions` carries `exclude_from_property_linking`, `sales_exclusion_reason`,
`sales_record_classification`. **Check each of the nine against those rules before treating it as
missing**; a comp deliberately excluded from the spine is not a defect.

**2d. Do NOT touch the 321 dangling rows in this prompt.** Name and size them; they are a separate
decision (delete? re-point? were the properties archived and hard-deleted?).

---

## 3. ⚠️ Rules

**3a. One owner per state transition.** If PSE propagates into `sales_transactions`, that propagation
is the single writer of the resulting row — do not add a second path that the detail panel also uses
directly. **Two writers for one fact is how this started.**

**3b. Reuse the existing dedup key.** `sales_transactions.dedup_natural_key` is `GENERATED ALWAYS`
and must be omitted from INSERTs. ⚠️ **And there is a known false-negative in the dedup key already
filed as R6** — `(property, price±$1k, month)` misses same-property same-price sales days apart
(named instance: property 28549). **A propagation path will exercise that hole; account for it.**

**3c. Do not invent a new comparator or a new exclusion rule.** The classification, exclusion and
linking columns already exist and already govern what counts as a comp.

**3d. Fill-blanks, provenance-tagged, reversible, dry-run default, batch-reversible by tag.**
Register the propagation as a source in `field_source_priority` and say where it lands on the ladder.

**3e. The `feed_stale` alert on `property_sale_events` should be RE-SCOPED, not resolved.** B6c
established that its bulk producer was retired on purpose and its only live producer is an operator
form with no cadence — **so a 45-day SLA alerts whenever nobody types a sale for six weeks, then
sits open forever.** Either give it an SLA that matches an operator-driven surface or retire the
expectation. **A permanently-open alert for a healthy table is the badge-that-is-noise failure.**

---

## 4. Verification

- **The canonical decision is written down** in `docs/architecture/` and **`detail.js`'s comment is
  corrected to match**, whichever way it goes. *A code comment asserting the opposite of the database
  is how this survived.*
- **State delta:** orphaned priced events on live properties **9 → 0** (or → the number deliberately
  excluded, **with each exclusion named**).
- **A NEW operator-entered sale reaches `sales_transactions`** — test it end to end, not by reading
  the propagation code.
- **`sales_transactions` row count moves by exactly what was propagated** — assert on the INSERT's
  own `RETURNING`, not a plan join (A2 over-reported by 18 that way).
- **The 321 dangling rows are sized and named, not touched.**
- Guards mutation-verified RED, comments stripped before matching.

## 5. Deliverable

`docs/audits/B6c_dup_SALE_STORE_CANONICAL_2026-08-28.md`, plus the **BUILD-TURN-PROTOCOL closing
checklist**: `PLANNED-BACKLOG.md` (B6c-dup, and a new row for the 321), `data-coherence-invariants.md`
(**I1** — this is its cleanest example yet: *a consumer and a producer that each name a different
store as canonical*), `connectivity-and-open-threads.md` §4j, and a STATUS entry.

⚠️ **If the honest answer is that the nine are all legitimately excluded and the write path is
already correct, say so and stop** — the canonical decision and the corrected `detail.js` comment
are still worth the change on their own, because the next person to read that comment will otherwise
build on it.
