# B6 — every signal that reports a change of OWNER or LESSEE, and what consumes it

**Date:** 2026-08-28 · **Kind:** AUDIT + DESIGN, nothing built · **Backlog:** `B6`
**Parent:** B5 (in flight) · **Playbook:** `DEAD_END_AUDIT_PLAYBOOK.md` **Class 20**
**Projects read:** gov `scknotsqkcheojiaewwh` · dia `zqzrriwuavgrquhisnoa` · LCC Opps `xengecqvemvfknjvbvrq`

---

## 0. The headline, in one paragraph

Nineteen signals across the two domains can report a change of owner or lessee. **Most of them are
already consumed** — the deed layer is at 98.5%, the CoStar sidebar writes both parties, and gov's
sales table turns out to be 97% represented in `ownership_history` under other provenance labels.
The real gaps are not acquisition gaps. They are **four dead producers that all stopped in
March–April 2026**, **two link columns whose data types make them unpopulatable**, **a corroboration
engine whose 561 disagreements produce no next action**, and **an authority ladder that does not
know the two largest sources writing into it.** The single largest recoverable signal — thirteen
years of GSA landlord changes — deflates **28.6×** from its raw count and is gated behind a
detector that has **no scheduled caller at all**.

⚠️ **Two numbers in the B6 brief are corrected below** (§2, §6): the `38,213` landlord-change
signal is **1,338 net-new** after deflation, and `property_sale_events`' empty link columns are a
**type defect**, not neglect.

---

## 1. The signal → consumer matrix

Volume is `raw` unless a deflated figure is given. "→ OH" = reaches `ownership_history` (gov) /
`ownership_history` (dia). "→ comps" = reaches `sales_transactions`. Empty cells are stated, not
left blank.

### gov (`scknotsqkcheojiaewwh`)

| # | signal | volume | → ownership history | → comps | standing? | corroborates | next action |
|---|---|---|---|---|---|---|---|
| G1 | **`gsa_lease_change_facts`** `landlord_change_flag` | 356,291 rows; **38,213 flagged / 8,845 leases**, 2013-02→2026-02 → deflated **4,845 conveyances / 3,675 props** → **1,338 net-new / 1,202 props** | partial — 6,648 rows / 3,704 props as `gsa_lease_diff`, **last written 2026-03-27** | no | ✅ **RESTARTED 2026-08-28 (B6b)** — now **374,257 rows to snapshot 2026-07-01**, scheduled on the Monday `gsa-sync`. ⚠️ It was not merely uncalled: `derive_change_facts` read `gsa_inventory_snapshot_lines` (frozen) while the live job writes `gsa_snapshots`. Deflated **+72 net-new / +63 props** | ❌ **not on the `field_source_priority` ladder** | `prospect_leads.lead_source='ownership_change'` — 7,729 leads, 2,041 worked (26%), **0 in 90 days, dead since 2026-03-31** |
| G2 | `gsa_snapshots` (raw feed) | 1,201,873; **live**, 30,685/90d | via G1 only | no | ✅ live — Mon `0 5 * * 1` → `src/gsa_auto_sync` | — | — |
| G3 | `gsa_lease_events` | 233,666 — `modified` 161k / `renewed` 40k / `expired` 19.8k / `new_award` 12.7k; live 15,367/90d | ⚠️ **THIS CELL IS REFUTED (B6b, 2026-08-28): it DOES carry old/new lessor pairs — 16,907 rows, 16,492 usable, 1,176 in 90d, newest 2026-08-05.** `changed_fields` is a jsonb **STRING** holding JSON text, so `changed_fields ? 'lessor_name'` is structurally unable to match and returns a confident 0 of 201,212. Correct probe: `(changed_fields #>> '{}')::jsonb ? 'key'`. The lane is restartable — backlog **B6b-lead** | no | ✅ live | — | ✅ `gsa_new_award` 7,522 leads, **2,863 worked** — the healthiest lane in the matrix |
| G4 | `gsa_lease_timeline` (`landlord_change_count`) | 16,471 | no | no | ❌ dead, last 2026-03-11, same writer as G1 | — | — |
| G5 | **`sales_transactions`** seller side | 15,111; **9,686 named-seller + dated + linked / 4,742 props** | **169 rows** labelled `sales_transaction` — but only **269 rows / 215 props** are genuinely absent from the whole store (§6) | is the comps store | ✅ live, 4,539/90d | — | — |
| G6 | **`property_sale_events`** | 5,208; 5,097 seller names, 5,065 buyer names, 4,832 property_id | **0 — structurally impossible** (§3) | **0 — structurally impossible** | ❌ dead, last 2026-04-06 | — | none |
| G7 | `deed_records` | 5,804; **876 grantor / 5,706 grantee / 779 usable as a transition** | ✅ **5,716 rows / 4,162 props — 98.5% consumed** | no | ✅ live, 227/90d | ✅ `recorded_deed`@3 | — |
| G8 | **`parcel_owner_xref`** (assessor vs recorded) | 9,723; **8,838 corroborates / 561 diverges / 362 props** | 319 of the 362 diverging properties already carry the assessor's name as `new_owner` | no | ✅ live, 314/90d | ✅ **this IS the corroboration engine, and it already works** | ❌ **none for `diverges`** (§4) |
| G9 | `state_lease_events` `lessor_change` | 617 rows / **123 `lessor_change`**; live | **0 — `property_id` is NULL on 100% of all 617 rows** | no | ✅ live 617/90d — ⚠️ **gov `CLAUDE.md` §21's "silent 6+ weeks" is SUPERSEDED**, the producer restarted | — | `state_lease_lessor_change` 99 leads, **0 worked** |
| G10 | `available_listings.seller_name` | 3,131 rows, **68 named sellers** | 10 | — | ✅ live | — | — |
| G11 | `tax_records.mailing_owner` | 2,755 | not a transition (no counterparty, no date) | no | — | — | `tax_mailing_verify` — 8 tasks, all complete |
| G12 | `entity_registry_records` (SOS) | 8,405 | manager/address only — **not a change signal** | no | ✅ live 224/90d | ✅ `sos_registry`@55 | — |
| G13 | `sam_entities` / `sam_lease_opportunities` | 288 / 6,484 | no | no | ⚠️ **`sam.gov_lease_opportunities` = the ONLY step `v_pipeline_task_health` reports failing — HTTP 401, 2026-08-24** | — | — |
| G14 | `federal_lease_awards` | 9,974; **11 in 90 days** | no | no | ~dormant | — | — |
| G15 | `ownership_research_queue` | 17,665 — **100% `complete`**, every task type, last created 2026-06-22 | — | — | drained | — | ✅ **suspicion refuted** (§7) |

### dia (`zqzrriwuavgrquhisnoa`)

| # | signal | volume | → ownership history | standing? | note |
|---|---|---|---|---|---|
| D1 | **`sales_transactions` seller exit** | 3,702 named-seller rows | ✅ **2,974 rows / 1,614 props — the dominant source** | ⚠️ **BOTH**: a one-shot backfill (`20260522140200`, 90 lines, no cron) **and** a standing forward writer in `sidebar-pipeline.js` gated `domain === 'dialysis'` | §5 |
| D2 | `ownership_history` with **NULL `ownership_source`** | **6,922 of 9,896 rows (69%)**, 1,751 carrying an end date | — | — | ⚠️ untraceable provenance — the Class-20 detector is blind to 69% of dia's store |
| D3 | `property_sale_events` | 2,730; **`ownership_history_id` populated on 52** | 52 | ❌ dead, last 2026-04-16 | ✅ **the positive control for G6** (§3) |
| D4 | `clinic_npi_registry_history` (operator change) | 31,157, **28,743 in 90 days** | not linked to ownership | ✅ very live | operator ≠ owner (P113) — a lessee signal with no consumer measured here |
| D5 | `available_listings.seller_name` | **2,081 named sellers** (vs gov's 68) | not measured as feeding OH | ✅ live | largest unexamined dia signal |
| D6 | `tax_records.mailing_owner` | 969 | no | — | — |
| D7 | `deed_records` | 151 | 14 as `deed_extraction` | live | dia has essentially no deed layer |

---

## 2. ⚠️ The 38,213 landlord-change signal deflates 28.6×

The brief warned to deflate before quoting. Measured, every stage:

| stage | rows | note |
|---|---:|---|
| `landlord_change_flag = true` | **38,213** | the headline |
| both old and new names present | 38,055 | |
| **name keys actually differ** | **20,271** | ⚠️ **46.7% of the flag is a re-spelling.** The flag is computed on raw string inequality, not on a normalized key |
| both sides pass `gov_owner_name_is_transition_clean` | 19,880 | the A4b guard |
| resolve to a property via `lease_number` | 13,225 | −33%: 6,655 rows sit on leases with no property |
| **distinct (property, from, to) conveyances** | **4,845 / 3,675 props** | the per-lease fan-out (A2b): 2.7 observations per conveyance |
| non-oscillating (P138 `is_oscillating_pair`) | 4,655 | 190 flicker pairs dropped |
| **net-new vs the whole `ownership_history`** | **1,338 rows / 1,202 props** | |

**1,338 is worth having, and it adds DEPTH, not just breadth** — it spreads across all fourteen
years (64 in 2013, 104 in 2016, 312 in 2023, 195 in 2024), so it reaches back past the window the
current store covers.

**And it is a FLOOR.** `gsa_snapshots` is live and holds **2026-03, 2026-05, 2026-06 and 2026-07**;
`gsa_lease_change_facts` stops at **2026-02-01**. Four monthly snapshots have never been diffed. **↳ ANSWERED by B6b 2026-08-28: the floor lifted to 1,406 rows / 1,263 properties (+72 / +63). ⚠️ The backlog was 5 dates, not 4 (2018-03-01 too), and 15 further undiffed dates are correctly REFUSED because an existing diff already spans them — deriving those would double-observe conveyances the store already holds.**
(⚠️ **2026-04-01 is missing from the raw feed entirely** — a separate gap, not caused by this.)

---

## 3. ⚠️ `property_sale_events` — the connective tissue cannot hold its own keys

This is the table Scott's framing describes: it exists to bind a comp to an ownership-history row.
It carries `ownership_history_id` and `sales_transaction_id`. **Both are populated on 0 of 5,208
rows, and neither can ever be populated:**

| column | type | target | target type |
|---|---|---|---|
| `property_sale_events.ownership_history_id` | **bigint** | `ownership_history.ownership_id` | **uuid** |
| `property_sale_events.sales_transaction_id` | **bigint** | `sales_transactions.sale_id` | **uuid** |

Neither carries a FK constraint — the only FK on the table is `fk_pse_property`. A writer attempting
either assignment raises `22P02 invalid input syntax for type bigint`. `buyer_id` and `seller_id`
are likewise 0 of 5,208 while `buyer_name`/`seller_name` are ~98% populated.

**Positive controls, both directions:**
- `property_id` on the same table is populated on **4,832 of 5,208** — the table is written, the
  columns are not inert for lack of a writer.
- **dia's identical table has `ownership_history_id bigint` against an `ownership_id integer` PK —
  compatible — and it is populated on 52 rows.** The same design, on the sibling domain, with a
  workable type, is non-zero. That is what makes gov's zero a **type defect** rather than
  "nobody got round to it."

**This is why a comp and an ownership fact about the same conveyance cannot be reconciled to each
other in gov.** Everything downstream is doing name matching because the id path does not exist.

---

## 4. The corroboration engine already exists — and its disagreements go nowhere

`parcel_owner_xref` compares the **assessor's** owner against **our recorded** owner, per property,
and stamps a verdict: **8,838 `corroborates` / 561 `diverges` / 223 `generic_skipped` / 101
`filled`**. It runs (`propagate-parcel-owner-to-property`, gov cron 21, every 30 min) and 314 rows
were processed in the last 90 days. **This is exactly the "sources working against each other"
Scott asked for, and it is built.**

What is missing is the consumer for the disagreement:

- **319 of the 362 diverging properties already carry the assessor's name as a `new_owner` in
  `ownership_history`.** So for those, the *history* knows about the change and
  `properties.recorded_owner_id` still points at the superseded party. That is a **propagation gap
  between the store and the current-owner pointer**, not an acquisition gap — and it is the
  cheapest fix in this audit.
- The remaining **43 properties** carry an assessor owner that appears nowhere in our history. That
  is genuine net-new acquisition signal, and it is small.

`diverges` produces **no research task, no decision-lane card, and no lead**. It is a verdict with
no reader.

---

## 5. dia's seller-exit producer, found in code — and the comment that scoped gov out

Per rule 3a I did not date this off `updated_at`. In code it is **two things**:

1. **One-shot backfill** — `supabase/migrations/dialysis/20260522140200_dia_backfill_oh_seller_exits.sql`,
   90 lines, two passes, **no cron**. Its own header records the pre-state: *"of 3,007 sales with a
   buyer, only 12 (0.4%) had a matching ownership_history row CLOSED at the seller side."*
2. **A standing forward writer** — `api/_handlers/sidebar-pipeline.js:9367`, which is where the
   `sales_transactions_seller_exit` label is minted, gated:

```js
if (domain === 'dialysis' && sellerId) {
```

**So dia is only half-covered by a standing producer.** New sales arriving through the CoStar
sidebar get a seller-exit row; sales arriving by any other channel do not, and the backfill will not
run again. dia has **2,974 seller-exit rows against 3,702 named-seller sales** — an 80% ratio that
will decay. **That is a Class 8 finding on dia** (a one-shot repair of a recurring producer),
reported here and deliberately not fixed.

### ⚠️ The comment above that gate is the load-bearing part

```
// Gov OH already captures the seller via the prior_owner text field on the
// (single-event) transfer row above, so no separate seller OH row is needed for gov.
```

**That claim is true, and its scope is narrower than the conclusion drawn from it.** The gov branch
15 lines up does write `prior_owner: sale.seller` — verified, and gov `ownership_history` holds
3,161 `costar_sidebar` rows of which 1,982 carry both parties. **But it is a statement about the
sidebar's own writes**, and gov `sales_transactions` holds 15,111 rows from six other channels. The
design asymmetry between the domains is deliberate and documented; the documentation just does not
cover the population B5 is about.

---

## 6. ⚠️ B5's `3,080 / 2,114` ceiling — I could not reproduce it, and the scope is why

> ## ⛔ SUPERSEDED 2026-08-28 — B5 SHIPPED BEFORE THIS WAS READ, AND THE SHIPPED RESULT REFUTES §6's CONCLUSION. DO NOT ACT ON THE `~270–370` FIGURE OR REVERT B5.
>
> §6's recommendation — *"RESIZE BEFORE BUILDING; may not clear the bar"* — was written against a
> build that had **already run**. Verified live on the gov DB after the batch:
>
> | check | result |
> |---|---|
> | rows B5 actually wrote | **2,776** (`data_source='sales_transaction_seller_exit'`), 2,000 properties |
> | **traceable to `ownership_change_stub*` (§6's circularity objection)** | **2 of 2,776 — 0.07%** |
> | provenance of the rest | `excel_master` 1,222 · `costar_export` 625 · `costar_sidebar` 141 · `gov_master_backfill_r71` (the tail) |
> | **properties that had NO ownership history at all before B5** | **677** — B5 gave them their first |
> | properties that had some and gained a link | 1,323 |
> | gov `ownership_history` | 16,177 → **18,953** |
> | transitions view | 9,595 → **12,371** rows · 4,698 → **5,555** properties |
> | `properties.recorded_owner_id` populated | **9,312, unmoved** (the trigger bug held) |
>
> **The circularity objection was correct in principle and empirically nil in effect** — B5's guards
> already excluded the stubs. **677 properties gaining a first-ever transition is decisive and does
> not depend on the key debate at all**: a row that duplicated existing knowledge could not create
> history for a property that had none.
>
> **Why the two measurements disagreed:** B5 keys its anti-join on the **party pair**, §6 keyed on
> **(property, prior-owner, exact date)**. B5 measured that against an already-recorded pair the
> sale row is **later 217 times and earlier 34** — the *opposite* of A2b's 26-of-26 — so the date is
> not a safe key here and A2b's earliest-wins rule does **not** transfer. §6's own headline finding
> (a 26× swing on one population and one key) is right, and is the reason it landed on the wrong
> number: **it is a caution about METHOD, not a sizing.**
>
> **Durable lesson — the two-windows problem arrived as two CONTRADICTORY MEASUREMENTS of one
> population, which is worse than a merge conflict because neither side errors.** Both were run
> honestly, hours apart, and only one had run the build. **When two measurements of one population
> disagree, find the measurement that does not depend on the disputed key** (here: *did this
> property have any history before?*) rather than adjudicating the keys. And **before writing
> "resize before building" about work in flight, check whether it has already shipped** —
> `merged is not running` has a mirror, *in flight is not unbuilt*.
>
> **§6 is retained verbatim below** because its scope-sensitivity table is the durable content and
> is unaffected. Only its conclusion and the §9 row-6 recommendation are void.

B5 (in flight) sizes the gov seller-exit feeder at **3,080 net-new rows / 2,114 properties**,
anti-joined on *(property, normalized prior-owner name, exact date)*. Running that same key I get
**366 rows / 291 properties**. The gap is not the normalizer or the guards — **it is which rows you
anti-join against**, and the sensitivity is extreme:

| anti-join target | net-new rows | props |
|---|---:|---:|
| `ownership_history` **where `data_source='sales_transaction'`** (the source bucket) | **9,517** | 4,635 |
| `ownership_history` **entire store**, exact-date key | **366** | 291 |
| `ownership_history` **entire store**, no date in the key | **269** | 215 |

**A 26× swing on one population and one key.** B5's 3,080 sits between the two, so I cannot
attribute it precisely — **I am not claiming to have found B5's bug.** What I can state is that the
ceiling is uninterpretable without its scope, and that on the whole store the population is small.

The reason is visible in the source split of gov's 9,686 named-seller sale rows:

| `data_source` | named-seller rows | **not present in `ownership_history`** |
|---|---:|---:|
| `costar_sidebar` | 3,176 | **52** |
| `ownership_change_stub` | 2,940 | **0** |
| `excel_master` | 1,308 | 23 |
| `costar_export` | 828 | **151** |
| `ownership_change_stub_spe_rename` | 373 | **0** |
| `county_deed` | 19 | 0 |

⚠️ **`ownership_change_stub*` (3,313 rows, 34% of the population) must be excluded — the arrow runs
the other way.** `supabase/migrations/government/20260617_gov_r37_sales_writer_cleanup.sql` names it
`legacy_ownership_stub` and states *"The mechanism is retired (R37)"*; every gov and dia sales-dedup
pass ranks it priority **9** (lowest) and excludes it from being a dedup survivor. These are sale
rows **minted from ownership history**. Feeding them back is circular.

**Recommendation to B5: re-derive the ceiling against the whole store, excluding
`ownership_change_stub*`, and report the residue by channel.** On my measurement the honest target
is **~270–370 rows over ~215–291 properties**, concentrated in `costar_export` (151) — not 3,080.
This does not refute B5's premise (gov genuinely has no seller-exit *feeder*); it resizes the prize
by an order of magnitude, which changes whether the build is worth it.

---

## 7. Measured and refuted — things that look like gaps and are not

Reporting these matters as much as the gaps; three of the four would have been expensive.

- **`ownership_research_queue` (17,665 rows) is not a stalled backlog.** Every row is
  `task_status='complete'`, across all six task types (`deed_owner_verify` 5,755,
  `entity_registry_verify` 5,438, `parcel_verify` 5,438, `entity_resolution` 1,018,
  `tax_mailing_verify` 8, `mortgage_extract` 8). It had a consumer and it drained. My Class-2 and
  Class-18 suspicions were both wrong.
- **Deeds are not unconsumed.** 5,716 `ownership_history` rows across 4,162 properties derive from
  the deed layer — **98.5% of 5,804 `deed_records`**. But only **876 carry a grantor** and 779 are
  usable as a transition, so **4,937 of the consumed rows are one-sided** (grantee only, unable to
  chain). **The deed gap is EXTRACTION, not consumption** — which supports B5's parent finding that
  county-deed acquisition is the wrong first lever.
- **gov `state_lease_events` is no longer stale.** gov `CLAUDE.md` §21 records the producer as
  *"SILENT for 6+ weeks, all 577 rows stamped `processed_at=2026-06-23`"*. Measured today: **617
  rows, all created within 90 days, events running to 2026-08-05.** The producer restarted. §21
  should be corrected. (Its `property_id` is still NULL on 100% of rows, so the 123 `lessor_change`
  events still cannot reach `ownership_history` — that half of the note stands.)
- **`gsa_lease_events` is not a landlord signal.** It carries `lessor_name` but no old/new pair; its
  four event types are lifecycle (`modified`/`renewed`/`expired`/`new_award`). It answers *change of
  LESSEE*, which is the other half of Scott's ask, and it answers it well — 7,522 leads, 2,863
  worked.

---

## 8. ⚠️ Why the four dead producers all died in March–April 2026

`gsa_lease_change_facts` (2026-03-11) · `gsa_lease_timeline` (2026-03-11) ·
`prospect_leads.ownership_change` (2026-03-31) · `property_sale_events` (2026-04-06) ·
dia `property_sale_events` (2026-04-16).

**No pg_cron job on either project produces any of them.** They are Python, run through
`pipeline_runner` on GitHub Actions. The schedules exist and fire — `ci.yml` runs
`pipeline_runner --monthly` on `0 4 5 * *`, and `v_pipeline_task_health` shows the monthly pipeline
ran on **2026-08-05**. So the schedule is not the problem.

Two independent causes, and the second is the durable lesson:

**(a) The landlord-change detector has no scheduled caller.** `gsa_lease_change_facts` and
`gsa_lease_timeline` are written **only** by `src/ingest_gsa_historical.py`, which is reachable from
`src/run_pipeline.py:172` (the 9-step orchestrator, *not* what CI runs) and from its own
`__main__` CLI. The live Monday job (`src/gsa_auto_sync`) imports `run_diff` from
`gsa_monthly_diff` — which writes `gsa_snapshots` and `gsa_lease_events`, and **not** the change
facts. **The raw feed and the derived change layer have different writers, and only one of them is
scheduled.**

**(b) ⚠️ A SKIPPED STEP EMITS NOTHING, AND A HEALTH VIEW BUILT ON EMITTED ROWS CANNOT SEE IT.**
In `pipeline_runner.py`:

```python
latest_file = runner.run_task("Find latest GSA inventory", find_latest_gsa)

# Step 2-3: Ingest + Diff
if latest_file and not runner.dry_run:
    ...
    runner.run_task("GSA ingest + diff", ingest_and_diff)
```

`find_latest_gsa()` globs a **local folder** (`GSA_DOWNLOAD_FOLDER`) and returns `None` when it is
empty — which it always is on a fresh CI checkout. The task itself **succeeds**, and
`v_pipeline_task_health` duly reports `find_latest_gsa_inventory` = **ok / "Task completed" /
2026-08-24**. The guarded `run_task` on the next line is then **never invoked**, so it writes **no
`run_log` row**, so it has **no row in `v_pipeline_task_health`** — and a step with no row reads as
absence, not as failure.

**This is the exact mirror of the fix gov already shipped.** `CLAUDE.md` §16 built
`v_pipeline_task_health` and `completed_with_errors` so that *"the orchestrator must NOT report a
green `completed` over failed sub-tasks."* That closed the **failed** case. **The skipped case was
left open, and it is invisible in a different way**: a failed step is a red row, a skipped step is
no row. Today the view shows one failing step (SAM, HTTP 401) and otherwise all green, over a
pipeline whose landlord-change detector has not run in five months.

It is also the A5a lesson arriving in a health view rather than a lane: **a producer that has never
emitted has no row to `GROUP BY`.** Enumerate the steps the orchestrator *declares*, not the ones
that logged.

---

## 9. The corroboration ladder does not know its two biggest sources

`field_source_priority` carries a full ladder for `gov.ownership_history`:

`manual_edit`/`manual_resolution`@1 > `recorded_deed`@3 > `county_records`@5 > `rca_sidebar`@50 >
`costar_sidebar`@60 > `crexi_sidebar`@65 > `crexi_sidebar_description`@70.

**There is no rung for `gsa_lease_diff` (6,648 rows) and none for `sales_transaction` (169).** The
largest single producer of gov ownership history is unranked in the ladder that exists to adjudicate
between producers. This is the `v_field_provenance_unranked` drift class, landing on the ownership
store itself.

The same is true one layer up: `lcc_property_owner_evidence` (12,479 rows) is fed by exactly four
sources — `rel_purchase` 5,667, `domain_true_owner` 2,829, `rel_owns` 2,459,
`gov_ownership_transition` 1,484 (plus `sf_seller` 32, `manual` 8). **No deed source, no
GSA-lease-diff source, no seller-exit source.** So when a GSA lessor-of-record change and a recorded
deed disagree, **nothing can adjudicate them** — and per Scott's own Sunflower framing, in a ground
lease or an SPE structure **both can be correct at once**, which is a review lane, never a silent
winner.

---

## 10. Proposed architecture — signal → evidence → store → next action

**Reuse the existing path. Do not add a parallel one.** The pieces all exist; what is missing is
that four of the sources never reach the ladder, and one hop is type-broken.

```
  SIGNAL                      EVIDENCE                   STORE                    NEXT ACTION
  ──────                      ────────                   ─────                    ───────────
  gsa_lease_change_facts ─┐
  deed_records            ├─► domain-side portfolio ──► lcc_property_owner_    ─► v_priority_queue
  sales_transactions      │   view, guards applied      evidence (ranked by       / prospect_leads
  parcel_owner_xref       │   (the P138                 field_source_priority)    / a review lane
  state_lease_events      ┘   v_ownership_transitions_        │                    when sources
                              portfolio pattern)              ▼                    contradict
                                                        ownership_history
                                                        + sales_transactions
                                                        joined by property_sale_events
```

Four rules for anything built on this:

1. **One shape for a new signal: a gov/dia-side portfolio view alongside
   `v_ownership_transitions_portfolio`,** carrying the guards already calibrated on named rows
   (`gov_owner_name_is_transition_clean`, `gov_strip_brokerage_suffix` — strip, never reject,
   `is_oscillating_pair`, the anchored `Previous Owner%` block). **Add no new name comparator**;
   the sanctioned one is `lcc_ownership_chain_name_key`.
2. **Every new source gets a `field_source_priority` rung, argued explicitly.** A GSA
   lessor-of-record change is *who the government pays*; a recorded deed is *who holds title*.
   Suggested: `recorded_deed`@3 stays top of the observed sources; `gsa_lease_diff` belongs **below**
   `county_records`@5 and above the sidebars — it is authoritative about the payee, not about title.
   `sales_transactions_seller_exit` is one historical transaction, tier-comparable with
   `rel_purchase`.
3. **A contradiction is a review lane, never a tie-break.** Sponsor↔SPE and ground-lease
   fee-vs-leasehold both produce genuine disagreement where both sides are right (A3, P188).
   `v_lcc_portfolio_ownership_conflict` is the existing precedent — 12 conflicts, never
   auto-resolved.
4. **The A2 apply path (`lcc_ownership_chain_apply`, cron 244) stays the single writer** of an
   ownership fact. New signals supply evidence into it; none of them writes
   `lcc_entity_portfolio_facts` directly.

---

## 11. Ranked gaps — with the deflators applied

Ranked by *what would actually move*, not by raw volume. Two of the seven end in "do not build."

| # | gap | sized | cost | verdict |
|---|---|---|---|---|
| **1** | **Restart the GSA landlord-change detector.** Give `ingest_gsa_historical` a scheduled caller, and fix the skipped-step blindness in `pipeline_runner` (§8b) so the next silent skip is visible. | **1,338 net-new transitions / 1,202 properties**, spanning 2013→2026, plus 4 undiffed monthly snapshots | small — a schedule and a guard | **BUILD.** Highest ratio in the audit, and it revives `prospect_leads.ownership_change` (2,041 historically worked) |
| **2** | **The skipped-step guard on its own.** `run_task` should record a `skipped` outcome with a reason when a guarded step is bypassed; `v_pipeline_task_health` should enumerate declared steps, not logged ones. | unblocks detection for **every** guarded step in the pipeline, not just this one | small | **BUILD FIRST** — it is why nobody saw #1 for five months |
| **3** | **Fix `property_sale_events`' two link columns** (`bigint` → `uuid`) and add the FKs. | the comp↔ownership join for **5,208 gov rows**; dia's compatible copy proves the linker works | small, additive; the writer is dormant so nothing regresses | **BUILD.** This is the connective tissue Scott named |
| **4** | **Give `parcel_owner_xref.diverges` a consumer.** | **362 properties**, of which **319** need only a `recorded_owner_id` repoint (the history already agrees) and **43** are genuine net-new | small — the detector already runs | **BUILD.** Cheapest real correction here |
| **5** | **Register `gsa_lease_diff` and `sales_transaction` on the `gov.ownership_history` ladder**, and add the missing evidence sources to `lcc_property_owner_evidence`. | makes **6,817 rows** adjudicable that currently are not | small | **BUILD** — prerequisite for #1 and B5 both |
| **6** | ~~**gov seller-exit feeder (B5).**~~ ⛔ **VOID — B5 SHIPPED.** | **Actual: 2,776 rows / 2,000 properties**, of which **677 had NO prior ownership history at all**. The `~270–370` estimate and the circularity objection are refuted — **2 of 2,776 (0.07%)** trace to `ownership_change_stub*`. | shipped | ✅ **DONE. Do not resize, do not revert** — see the §6 supersession banner |
| **7** | **`state_lease_events.property_id`** — 123 `lessor_change` events, 99 leads, 0 worked, and no property link | 123 events; **0 of 617 rows carry a property_id** | needs an address matcher for state inventories | **DO NOT BUILD YET.** The leads it already produces are 0% worked — fix the consumer before widening the producer (P179 Class 2) |
| — | **dia D1 Class 8** — the seller-exit backfill was one-shot; non-sidebar dia sales get no seller exit | 2,974 of 3,702, decaying | — | **REPORT ONLY**, per B5 §1c |
| — | **dia D2** — 69% of dia `ownership_history` has NULL `ownership_source` | 6,922 rows | — | **REPORT ONLY.** The Class-20 detector is blind to it |

---

## 12. Detector hygiene notes for whoever runs this next

- ⚠️ **`ownership_source` and `data_source` are NOT controlled vocabularies.**
  `lcc_entity_portfolio_facts.ownership_source` has **2,978 distinct values over 14,076 rows** —
  it embeds record ids (`county_deed:<uuid>`, `gov_master_backfill_r71|h=<md5>`). A naive
  `group by ownership_source` returns thousands of singleton buckets and is unreadable. **Split on
  `:` and `|` first.** Doing so moves gov `county_deed` from an apparent 1 row to **1,614**.
- ⚠️ **The Class-20 provenance `group by` is only as good as its label coverage.** dia has **1,967
  facts (536 historical) with NULL `ownership_source`** in LCC and **6,922 of 9,896 (69%)** in its
  own store. A source-bucket comparison across domains silently under-reports dia.
- ⚠️ **An anti-join scoped to a provenance bucket answers a different question than one scoped to
  the store** — measured at a **26× difference** here (§6). State which you used.
- **Positive controls used in this audit** (P182): `property_id` populated on `property_sale_events`
  while its link columns are 0; dia's compatible copy of the same column non-zero; the deed anti-join
  returning 98.5% rather than a suspiciously clean 0 or 100%.

---

## 13. What I did not measure

- **dia D5** — 2,081 named sellers on dia `available_listings`, vs gov's 68. Not traced to a
  consumer. Largest unexamined item in the matrix.
- **dia D4** — `clinic_npi_registry_history`, 28,743 rows in 90 days, an operator-change signal.
  Operator ≠ owner (P113), so it is a lessee signal; whether anything consumes it is untested.
- **Whether the 43 genuinely-net-new `parcel_owner_xref` divergences are real** — read on named
  rows, not sampled.
- **`mortgage_records` / `loans`** — a refi names a borrower and is an owner *assertion*, not an
  owner *change*. Excluded deliberately.
- **The gov `2026-04-01` snapshot gap** — noted, not diagnosed.
