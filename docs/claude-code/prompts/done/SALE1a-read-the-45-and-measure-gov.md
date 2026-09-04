# SALE1a + SALE1b — read the 45 rows with a proven mechanism (not the 132), decide null-vs-reset per row, and measure gov

**Repo: `life-command-center`.** Target **Dialysis_DB `zqzrriwuavgrquhisnoa`**, then **gov
`scknotsqkcheojiaewwh`**. **A reading task with a small, per-row, reversible write at the end.**
83 live comps are currently computing cap rates off prices in this view, which is why it is next.

**Read first:** `docs/claude-code/STATUS.md` 2026-09-03 SALE1 entries (both the ship and the
verification) → backlog **SALE1a** / **SALE1b** → the migrations `20261009130000` (eligibility) and
`20261009140000` (the review view `v_dia_sale1_price_review`) → `CLAUDE.md` § A2b (the earliest-date
rule and *why* it was chosen — the same "which observation is real" question, already answered once
for dates).

## What is settled — do not re-derive

SALE1 shipped and is verified: the `upsertDomainSales` re-match PATCH no longer overwrites a
non-null `sold_price` (>1% disagreement keeps the recorded price and stamps
`[price-disagreement …]`); dia's `sale_notes_raw` is gated to `isMostRecentSale` matching gov;
**31 rows / $66.1M** flipped out of comps on the source's own markers; `nominal still in comps` = 0.
`v_dia_sale1_price_review` holds **165 rows — 132 `ledger_disagreement` + 33 `deed_says_undisclosed`
— and nothing has been reset.**

**The 132 was split on 2026-09-03 and must not be treated as 132 defects:**

| slice | count | reading |
|---|---:|---|
| current price == one of the property's OWN listing prices | **45** | the proven Hillsboro mechanism — **this is the population to read** |
| current price == a sibling sale on the same property | 41 | overlaps the above; a second observation of one conveyance |
| clean 12× unit artifact (`$64,583.57` vs `$775,000`) | 1 | the ledger row is a MONTHLY figure, not a sale price |
| within 2% of the ledger value | 8 | a view-tolerance question, not a defect |
| balance | — | modest revisions consistent with a later source correcting a bad master import |

**87 of the 132 are still in comps; 83 carry a live `cap_rate_final`.**

## SALE1a — the read

1. **Read all 45 named rows.** For each: current `sold_price`, the earliest `cap_rate_history`
   observation, the matching listing price, the deed record's own `raw_payload` price (or
   "Not Disclosed"), `transaction_type`, and whether it is in comps with a cap rate. **Classify
   each into exactly one of:** `propagated_from_listing` (reset or null) · `genuine_revision` (a
   later, better source corrected a bad import — leave it) · `undisclosed` (deed states no price →
   null) · `undecidable` (say so, leave it, and say what evidence would settle it).
2. ⚠️ **The reset rule, and it is the whole risk in this task.** `cap_rate_history` records what was
   **FIRST RECORDED**, never what is **TRUE** — Hillsboro's $1,233,000 came from a
   `dia_master_sales` import, and for a deed CoStar itself labels "Nominal Transfer" the price may
   be meaningless regardless. **Reset to the ledger value only where the DEED corroborates it.
   Otherwise NULL.** A missing comp beats a wrong comp (the rule already applied to 8090's
   "Not Disclosed"). **Do not reset on the ledger alone.**
3. **Handle the 8 within-2% rows as a view fix, not a data fix** — decide the tolerance
   (the guard uses >1%; the view appears looser) and state it. **1 row is a 12× unit artifact** —
   exclude it from the view by rule, not by id, so the next monthly-figure ledger row is also
   excluded.
4. **Write per-row, reversible, batch-tagged**, with the pre-state snapshotted, exactly as the
   eligibility migration did. **Cap-rate consequence:** any row whose price changes must have its
   derived `cap_rate_final` / `calculated_cap_rate` recomputed or nulled in the same change —
   leaving a cap rate derived from a price you just nulled is worse than what you started with.
   Quote how many of the 83 move.
5. The **41 sibling-sale matches** that are not also listing-matches are an **A2b comp-COUNT**
   question, not a price defect — size them, say so, and leave them. Do not widen
   `dedup_natural_key` (A2b measured what that collapses).

## SALE1b — measure gov

The `upsertDomainSales` guard is shared, so gov is protected going forward. **Whether gov has the
same historical damage is unmeasured.** Does gov have a `cap_rate_history` equivalent (a trigger
logging `price_at_event`)? If yes, run the identical ledger check and report the counts in the same
shape. **If gov has no such ledger, say so plainly** — that is a real answer, and it means gov's
historical price corruption is unmeasurable by this method, which is worth knowing before anyone
claims gov is clean.

## Verify on

- The 45 classified, with named rows on each side and the deed evidence quoted per reset.
- Rows written, with the batch tag and the reversal statement.
- `v_dia_sale1_price_review` before/after; the 12× rule and the tolerance rule stated.
- Comps affected: how many of the 83 lost or changed a cap rate.
- gov: the ledger check run, or the honest "gov has no equivalent ledger".

## What NOT to do

- No bulk reset. No reset on `cap_rate_history` alone. No `dedup_natural_key` change. Do not touch
  the 235 "matches earliest" rows — the price was never corrupted there.

## Report back

The 45-row classification · the writes with their reversal · cap-rate movement · the two view rules ·
gov's answer · anything that outranks this.
