# B5 — gov had never consumed its own sales table. It does now.

**Date:** 2026-08-28 · **Backlog:** `B5` · **Source:** `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` §3c
· **Canonical:** `docs/architecture/ownership-history-lane.md` §3a

**Shipped.** gov `ownership_history` **16,177 → 18,953** (+2,776 transitions over 2,000 properties);
`v_ownership_transitions_portfolio` **9,595 → 12,371** rows / **4,698 → 5,555** properties; properties
with **2+ guard-passing links 1,376 → 2,118 (+742)**. Reversible by batch tag, idempotent (a re-run
plans 0).

---

## 0. The headline is not the feeder

Building B5 surfaced a **live, silent, unrecoverable data-destruction bug in a shared write path**,
and it had been firing for the life of the table.

`trg_propagate_ownership_to_property` is `AFTER INSERT OR UPDATE` on `gov.ownership_history` and ran:

```sql
UPDATE properties SET recorded_owner_id = NEW.recorded_owner_id, updated_at = NOW()
 WHERE property_id = NEW.property_id
   AND (latest_deed_date IS NULL OR NEW.transfer_date >= latest_deed_date);
```

There is **no guard on `NEW.recorded_owner_id`**. A dated row that names its parties as TEXT
(`prior_owner` / `new_owner`) but resolves no recorded owner — which is how `gsa_lease_diff`,
`deed_extraction` and every name-only producer writes — therefore **overwrote the property's resolved
recorded owner with NULL**. No error, no ledger, no provenance row, no way back.

| measured live 2026-08-28 | |
|---|---:|
| existing `ownership_history` rows that are dated **and** carry no `recorded_owner_id` | **7,567** |
| gov properties currently holding a `recorded_owner_id` | 9,312 |
| …of those, with `latest_deed_date IS NULL` (so **any** dated insert clears them) | 7,732 |
| **properties B5's first run alone would have destroyed the owner on** | **1,446 (15.5%)** |

**Proven on a real row, self-rolled-back, not inferred from reading the function.** Property 7370,
`recorded_owner_id 6cff8b28-…`, `latest_deed_date NULL`: one insert of a dated name-only row →
`nulled = t`.

**Fix — `sql/20260828_gov_b5a_ownership_propagate_fill_forward.sql` (applied).** Fill-forward: a row
that resolves an owner propagates exactly as before; a row that resolves nobody no longer speaks.
Positive-controlled **in both directions** on the same real row, because a guard that only ever
blocks is indistinguishable from a broken one:

```
before fix : nulled = t
after  fix : preserved = t   (name-only row)     propagated = t   (resolving row)
```

And confirmed on the real 2,776-row batch: **`props_with_recorded_owner` held at 9,312, unmoved.**

> ⚠️ **The trade, stated rather than glossed.** A conveyance to a party we cannot resolve arguably
> *should* retire a now-stale recorded owner. That is a real judgement and **nobody ever made it** —
> it was the accidental behaviour of an unguarded assignment, it destroyed the prior value with no
> record, and it is unrecoverable. If retiring a superseded owner is wanted it belongs in a
> deliberate, reversible sweep that records what it retired, not in a side effect of an unrelated
> INSERT. **Do not revert B5a to "unblock" a producer** — give that producer a resolved
> `recorded_owner_id` instead.

---

## 1. dia's producer: found, and it is two things

| | what | scheduled? |
|---|---|---|
| the backfill | `supabase/migrations/dialysis/20260522140200_dia_backfill_oh_seller_exits.sql` — a **one-shot migration**, two passes (close open rows, insert exits), 2,890 rows | **no** |
| the live writer | `api/_handlers/sidebar-pipeline.js::upsertDomainOwners` — writes a seller-exit row on every new dia sidebar capture | yes, at ingest |

Its handling of the edge cases asked for: **unnamed seller** → skipped (`if (domain==='dialysis' && sellerId)`);
**null date** → the migration requires `sale_date IS NOT NULL`; **orphan seller id** → skipped by an
`EXISTS` on `recorded_owners`; **several sales on one property** → the sidebar writer dedups on
`(property, owner, ownership_end = saleDate)`, the migration on a ±7-day window.

> ⚠️ **dia does NOT have a Class 8 problem.** The one-shot has a standing counterpart at ingest, so
> the population does not silently re-accumulate. That was the risk the brief flagged; it is not
> present.

**And gov's exclusion is written down, dated, and was true of exactly one channel.** The same
function comments: *"Gov OH already captures the seller via the prior_owner text field on the
(single-event) transfer row above, so no separate seller OH row is needed for gov."* Correct **for
sidebar captures** — and only **121** of B5's net-new rows are `costar_sidebar`. The bulk arrived
through paths that write `sales_transactions` and never touch `ownership_history` at all:

| sales `data_source` | net-new rows | properties |
|---|---:|---:|
| `excel_master` | 1,176 | 914 |
| `costar_export` | 570 | 479 |
| `gov_master_backfill_r71` (per-row hashes) | ~906 | ~906 |
| `costar_sidebar` | 121 | 95 |

> ⚠️ **The port is semantic, not literal — the two schemas model different things.**
> `dia.ownership_history` is **interval**-shaped (`recorded_owner_id` + `ownership_start` +
> `ownership_end`), so dia's producer closes an interval and writes a row with a NULL start.
> `gov.ownership_history` is **transition**-shaped (`prior_owner → new_owner @ transfer_date`). A gov
> sale therefore yields something *stronger* than a seller exit: a complete, dated, two-party
> transition, because the sale row names the buyer too. The `_seller_exit` suffix on the source tag
> is kept only so the two domains' provenance reads alike.

---

## 2. The ceiling, graded

The brief handed over **3,080 rows / 2,114 properties** to disprove. Graded:

```
  9,515  sale rows with a named, dated seller (exclude_from_property_linking = false)
   -137  no named buyer      → a transition needs both parties; the view's own WHERE
                               drops a NULL new_owner, so these contribute exactly zero
    -61  self-transition (A → A)
    -59  name variant (strict prefix extension / equal on the street key)
   -463  a party fails gov_owner_name_is_transition_clean
 ------
  8,795  guard-passing rows
 -6,231  the exact pair is already recorded on the same date
   -251  the exact pair is already recorded on ANOTHER date   ← see below
 ------
  2,776  NET-NEW DISTINCT LINKS over 2,000 properties
         (per (party, property): 2,593 pairs — the unit an ownership fact is stored in)
```

The dry run reproduced **2,776 / 2,000** exactly against an independently-written CTE. **`written`
came from the INSERT's own `RETURNING` set: planned 2,776, written 2,776, no over-report.**

### 2a. ⚠️ A2b's earliest-wins rule does NOT reproduce here, and that decided the anti-join key

A2b measured `costar_sidebar` vs `gsa_lease_diff` and found the independent record of the conveyance
**earlier 26 of 26**. On this population, of the 251 same-pair-different-date rows the sale row is
**later 217 times and earlier 34 — 6.4 : 1 the other way** (mean lag 293 days late vs 205 early).
Feeding them would hand the collapser 217 observations to discard to gain 34 dates nothing
corroborates. **So the anti-join keys on the PAIR at any date, not on the date.**

Quote A2b's rule for the population it was measured on. It is not a general fact about sale dates.

*Within* the feeder the same question has a different answer: several sale rows for one pair on one
property are duplicate comps of a single close, so those **do** collapse, to the **earliest** date,
for A2b's structural reason — `transfer_date` becomes the grantor's `ownership_end_date`, and a later
observation can only ever **overstate** a tenure. Collapsed in the **producer**, per A2b, never by
loosening the applier. Live: **88 collapsed repeats**.

### 2b. Guards, positive-controlled

They fire on almost nothing here — junk 2, brokerage 6, placeholder 2 over the net-new pairs. That is
a believable zero **only because the same guards over all 6,176 distinct sellers return junk 136,
placeholder 136, brokerage 20, not-clean 196.** They can fire; this population is genuinely clean.

> ⚠️ `gov_strip_brokerage_suffix` strips **nothing** here — 0 of 6,176. The curated Sold sheet carries
> no `by <brokerage>` artifact, so that guard is **inert on this source**, not protective. Stated
> rather than counted as a clean pass.

### 2c. Resolution — the deflator the brief named, measured on a sample

A2 resolves a grantor by `lcc_ownership_chain_name_key(entities.name) = grantor_key` requiring
**exactly one live entity**. Over a deterministic hash sample of **277 of the 1,994 distinct net-new
grantor keys**:

| | keys | share |
|---|---:|---:|
| resolves to exactly one live entity | 106 | **38.3%** |
| ambiguous (>1) — the A2a merge class, recoverable | 44 | 15.9% |
| `no_entity` | 127 | 45.8% |

This is a **sample, not a census** (±~6pp); the exact figure will come from A2's own residue once it
runs. **`no_entity` is substantially self-healing**: `r9_chain_connect` (cron 104, every 30 min,
active) already reads gov `sales_transactions.seller, buyer, developer` and mints an entity per chain
owner name — and A2 previously measured that **291 of the 331 grantors it resolved were r9's output**.

> **That is the cleanest statement of what B5 is.** r9 has been minting these sellers as entities for
> months and *nothing ever attached them*, because gov's `ownership_history` never carried the
> sales-derived transition. **B5 is the missing consumer for a producer that already mints the
> parties** — the A2 lesson, restated: before building a resolver, check whether an existing producer
> already minted them and simply never attached them.

The sample's names are the BD population, not noise: Boston Properties, Boyd Watterson, Brandywine,
Brookfield, Carlyle, Clarion, Colony Capital, CoreCivic, Cousins, Duke Realty, Easterly, Equity
Commonwealth, Fortress, Gardner Tanenbaum, Hillwood, KDC, Kennedy Wilson, LXP, Office Properties
Income Trust, Panattoni, Realty Income, Vereit, WP Carey.

---

## 3. ⚠️ Depth and coverage are two numbers, and the conversion is a third

**Coverage and depth, at the source (measured, live):**

| | before | after | Δ |
|---|---:|---:|---|
| transitions-view rows | 9,595 | 12,371 | +2,776 |
| transitions-view properties | 4,698 | 5,555 | **+857** (first transition ever) |
| properties with **2+** guard-passing links | 1,376 | 2,118 | **+742** |

**Predicted +751, realised +742 — reconciled, not hand-waved.** My simulation did not recompute the
per-property `is_oscillating_pair` flag; **38 properties carrying a B5 row are now flagged
oscillating** (234 fleet-wide), which correctly excludes all of their links. That is the guard firing
on newly-visible A→B/B→A pairs, i.e. working.

**But the source is not the fact.** `chain_2plus` counts entity-resolved facts in
`lcc_entity_portfolio_facts`, and today **1,376 view-level 2+ properties convert to only 178** —
a 12.9% conversion. Of the **751** properties this feeder takes to view-level 2+: 4 already have
`chain_2plus`, **297 hold exactly one historical fact** (one applied link makes them `chain_2plus`),
369 have ever been in the lane, **58 are open in it now**.

**So: do not read +742 as +742 `chain_2plus`.** The realistic near-term movement is bounded by the
lane and by resolution, not by the source. What B5 removes is the constraint B1a proved was binding —
B1a measured the entire remaining lane residue at **12** `chain_2plus` properties, i.e. the lane was
out of source. It no longer is.

---

## 4. ⚠️ The stale-draft trap, arriving for the third time

**Measured: 527 of 579 open gov tasks already carry a draft.** The drafter prepares from
`fresh` = open **and undrafted**, so those 527 drafts — every one built before B5's transitions
existed — **would never be rebuilt**, and B5 would convert on **52** tasks instead of 579.

This is the same failure A4b closed (a stale guard verdict) and A2b closed (a stale repeat-pair
collapse), arriving from a third direction (a stale link count).

**Fix — `runB5RedraftPass`** in `api/_handlers/ownership-chain-draft-tick.js`, plus
`v_lcc_ownership_chain_draft_open_link_counts` (LCC migration `20260828150000`), which is the single
owner of the comparison. Keyed on **state** — *"the planner now yields more links than this draft
used"* — never on B5, so it self-clears, needs no cron of its own, and equally catches the **next**
source (a county deed drop, an OCR batch) without knowing anything about it. It runs **before**
`fetchExistingDrafts()`, so the same 06:45 run re-drafts what it supersedes → 06:49 A2 apply.

It re-runs the **real planner** and supersedes only on a **strict increase**: an empty gov fetch or an
undraftable result supersedes nothing, because *"the fetch failed"* must never read as *"the chain got
shorter."*

---

## 5. ⚠️ Deploy ordering — the DB half is live, the JS half is not

The gov migrations ship **instantly** (§3's numbers are live now). The `runB5RedraftPass` change is
**JS on Railway** and needs a redeploy of merged `main`.

- **Tonight, without any deploy:** cron 144 (05:10) seeds, the drafter (06:45) drafts the **52**
  undrafted tasks against the new transitions, A2 (06:49) applies. Real but small.
- **After the deploy:** the pass rebuilds the **527** stale drafts, and the bulk converts.

This is the documented *"a DB migration ships INSTANTLY; the JS that reads it does not"* split — here
it is a **scheduling and deploy** matter, not a stale-deploy bug.

---

## 6. Blast radius, stated

- **`properties.recorded_owner_id`: unchanged at 9,312.** The whole point of B5a.
- **`is_latest_for_property` moves on 152 properties** (a B5 row becomes the newest transition), and
  **857** gain their first-ever transition. The P138–P141 supersession feeder
  (`scripts/feed-gov-ownership-transitions.mjs`) reads `is_latest_for_property` — it is a **manual
  CLI, not scheduled** (verified: no cron, no workflow), so there is **no automatic downstream
  effect**. It is dry-run-default, fill-blanks and tier-gated, so the next manual run is safe; the
  152 displacements are a stated consideration for whoever runs it.
- **`human_actionable` unmoved at 55.** B5 routes to automation, not to a person.
- **No second writer.** The feeder writes `ownership_history` and its own ledger. A2 (cron 244)
  remains the single owner of writing `lcc_entity_portfolio_facts`.

---

## 7. Reversal — run before the batch, not claimed

P195: a reversal that has never been run is a claim, not a capability.

```
gov_feed_sales_transitions(false,'b5_roundtrip_probe',5) → 5 written, 5 properties
  → all 5 carry both parties, data_source='sales_transaction_seller_exit', change_type='sale'
  → prop_untouched_by_trigger = true on 5 of 5   (B5a holding on a real feeder write)
gov_unfeed_sales_transitions('b5_roundtrip_probe')       → 5 deleted, 5 log rows deleted
  → residual rows 0, residual log 0, ownership_history back to 16,177, re-plan 2,776
```

Reverse the live batch with `select * from gov_unfeed_sales_transitions('b5_gov_20260828');`

---

## 8. How to verify — and what NOT to read

**Read `rows_written` / `props_touched`. Never `already_recorded`** — it is a re-discovery tally that
reads exactly like throughput (P159a); on a correct second run it is the whole population against 0
written. Likewise `collapsed_repeats` is **population-scoped** (a bug caught and fixed: under
`p_limit` it read 2,859 on a 5-row probe).

```sql
-- gov: the source (live now)
select verdict, count(*) from v_gov_sales_transition_feed_plan group by 1;   -- eligible 2,864 / already_recorded 5,931
select * from gov_feed_sales_transitions(true);                              -- planned_links must be 0 (idempotent)

-- LCC: the conversion (tomorrow 06:45/06:49, in full only after the deploy)
select count(distinct source_property_id) from lcc_entity_portfolio_facts
 where source_domain='gov' and ownership_end_date is not null;               -- 2,238 today
select count(*) from (select source_property_id from lcc_entity_portfolio_facts
 where source_domain='gov' and ownership_end_date is not null
 group by 1 having count(*)>=2) x;                                           -- 178 today
select count(*) from research_tasks
 where research_type='establish_ownership_history' and status='completed';   -- 1,302 today
select coalesce(sum(human_actionable_tasks),0) from v_lcc_research_lane_summary; -- 55, must NOT move
```

In the drafter's response read **`b5_redraft.now_deeper` / `.drafts_superseded`**, never
`open_drafted_checked` (a scan tally).

---

## 9. Guards

- `tests/unit/test_b5_sales_transition_feeder.py` (gov, 13 tests) — **all 13 mutation-verified RED**,
  including the B5a erase, the anti-join losing the grantee key, latest-instead-of-earliest, a
  narrowed `RETURNING`, an unscoped reversal, and `gov_owner_strict_core` creeping in (measured and
  **rejected** for this population by A2: `BAMMF (8) LLC == BAMMF (3) LLC`).
- `test/b5-chain-redraft-pass.test.mjs` (LCC, 10 tests) — **all 9 mutations verified RED**, including
  a non-strict comparison, a reversed comparison, superseding on an empty fetch, and moving the pass
  after `fetchExistingDrafts()`.
- Both strip comments before matching: each migration header discusses the erase, `transfer_date` and
  "earliest" at length, so a naive grep would match the prose documenting the guard and pass over its
  deletion — the A5c/N18 defect inside a test. Both carry a positive control for the stripper.
- Full LCC suite: **4,815 tests, 4,809 pass, 0 fail.**

---

## 10. Open, and deliberately not done

1. **The Railway deploy** — required for the 527 stale drafts. §5.
2. **The exact resolution rate** — sampled at 38.3% ±~6pp; A2's own residue will report it exactly.
3. **`no_entity` (45.8% of sampled keys)** — largely r9's to close on its 30-minute cadence. Not
   forced here; forcing it would mint entities ahead of the evidence that justifies them.
4. **dia is untouched.** Its feeder already exists and has a standing writer.
5. **The 152 `is_latest_for_property` displacements** — no automatic consumer; see §6.
