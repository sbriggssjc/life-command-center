# B5 — gov has never consumed its own sales table. Give it the seller-exit feeder dia already has.

**Window:** data-process & automation audit (lettered prompts). **Backlog row:** `B5`.
**Source:** `docs/audits/BD_PIPELINE_FUNNEL_AUDIT_2026-08-28.md` §3c (which **corrects §3b — read
both**). **Canonical:** `docs/architecture/ownership-history-lane.md` §3a.

---

## 0. Why this exists, and what it corrects

A1 → B1a took `establish_ownership_history` from **0 completions in 69 days → 1,302**, and B1a
then **closed the lane as a source of chain DEPTH**: 64 of its 65 completions carried exactly one
link, and the entire remaining blocked residue is worth **12** `chain_2plus` properties.

**I then concluded the constraint was external — that we must acquire county deeds — and I was
wrong.** That conclusion rested on gov holding only **876 grantor-bearing `deed_records` of 5,804**
and **325 deed documents** for 13,835 properties. Both numbers are correct. **The conclusion was
not**, because I measured the tables *named after* the answer and stopped.

**One `group by` overturned it.** `lcc_entity_portfolio_facts.ownership_source`:

| domain | source | historical facts | properties |
|---|---|---:|---:|
| **dia** | **`sales_transactions_seller_exit`** | **2,207** | **1,584** |
| gov | `gov_ownership_chain` (the A1→B1a lane) | 1,356 | 1,302 |
| gov | `gsa_lease_diff` | 976 | 821 |
| gov | `county_deed` | 104 | 104 |
| **gov** | **`sales_transactions_seller_exit`** | **— does not exist —** | **0** |

**dia's dominant source of ownership history is its own sales table.** When a sale is recorded, the
SELLER's ownership interval is closed out — a historical ownership fact by construction. **gov has
never had that feeder**, and this also answers **B4** (why dia's deepest chain is 14 and gov's 6).

**Sizing, measured 2026-08-28 (gov, `exclude_from_property_linking = false`):**

- `sales_transactions`: **14,645 rows / 5,321 properties**, sale dates **1970 → 2026-08-19**
- **9,514 rows carry a named `seller`**; **4,697 properties** have a named seller *with a date*
- `ownership_history` has consumed **`data_source='sales_transaction'` = 169 rows — 1.8%**
- anti-joined on (property, normalized prior-owner name, exact date):
  **3,080 net-new rows across 2,114 properties**
- for scale: gov today has **178** properties with a chain and **2,238** with any history

---

## 1. ⚠️ Read these before writing anything

**1a. `3,080 / 2,114` is a CEILING I am handing you to DISPROVE, not a target.** Four known
deflators, each of which you must measure and report separately:

- **resolution** — every seller must resolve **ID-to-ID** (never by name). Expect the A2 residue
  classes (`ambiguous_entity`, `placeholder`, `no_entity`) to take a share.
- **A2b** — the anti-join keys on an **exact date**, so *one conveyance recorded on several dates*
  counts as several net-new rows. `costar_sidebar` (3,161 rows) and a sale row will disagree by
  months on the same sale. **`collapseRepeatedConveyances` already solves this class — reuse it.**
- **overlap** — `gsa_lease_diff` already covers **3,704 properties**.
- **depth ≠ coverage** — a seller-exit closes an interval. It only produces `chain_2plus` where the
  **buyer** is also known and resolvable. **Report the coverage delta and the depth delta as two
  numbers.** B1 moved `any_history` +901 and `chain_2plus` +28; do not blend them.

**1b. The `developer` column is NOT the path to "back to the developer."** It is populated on
**32 rows / 30 properties**. The developer is reached by **extending the chain until it
terminates**, not by reading a field. Do not build anything on that column.

**1c. ⚠️ I could not date dia's feeder, and you must not assume it is standing.**
`lcc_entity_portfolio_facts` has **no creation timestamp** — only `updated_at`, which the nightly
`lcc_finalize_entity_portfolios` re-upsert touches on **11,828 of 14,076 rows every day** (I read
"all written today" off it first and it was an artifact). **No SQL function on LCC Opps contains
`seller_exit`.** So:

- **Find dia's producer in code before porting it.** It may live in the **Dialysis** repo, or be a
  retired one-shot script.
- **If it is a one-shot, say so** — then gov needs a *standing* feeder, **and dia has a Class 8
  problem of its own** (a one-shot repair of a recurring producer is a chore repeated silently
  forever). Report that as a finding; do not fix dia in this prompt.

**1d. Do not build a second writer.** The A2 apply path (`lcc_ownership_chain_apply` / cron 244) is
the **single owner** of writing an ownership fact from a chain. B5 supplies **evidence/transitions**
into the existing path — it does not write `lcc_entity_portfolio_facts` itself. If the natural shape
is a gov-side view alongside `v_ownership_transitions_portfolio`, prefer that.

**1e. Guards are inherited, not re-invented.** Placeholder names, brokerage suffixes
(`gov_strip_brokerage_suffix` — **strip, never reject**), self-transitions, oscillating pairs, and
the anchored `Previous Owner%` prefix block all already exist and were each calibrated on named
rows. **Reuse them. Do not add a new name comparator** — and note `lcc_owner_strict_core` was
**measured and rejected** for this population (A2: `BAMMF (8) LLC == BAMMF (3) LLC`); the sanctioned
one here is `lcc_ownership_chain_name_key`.

**1f. Fill-blanks, provenance-tagged, reversible, dry-run default, batch-reversible by tag.**
Register the new source in `field_source_priority`. Place it on the supersession ladder
**deliberately and argue for the rung**: a recorded sale is one historical transaction, so it is
tier-comparable with `gov_ownership_transition` / `rel_purchase` — say where it lands and why.

---

## 2. What to do

1. **Locate dia's `sales_transactions_seller_exit` producer** (LCC repo, Dialysis repo, or a
   script). Report *what* it is, *whether it is scheduled*, and *what it does with*: an unnamed
   seller, a null date, a seller equal to the buyer, and a property with several sales.
2. **Grade the gov population before building** — of the 9,514 named sellers, how many are
   placeholders, brokerages, operators, agencies, or already represented? Report on **named rows**,
   not a rate.
3. **Build the gov feeder** to the shape above (gov-side portfolio view + the LCC-side ingestion
   into the existing apply path), dry-run default.
4. **Run the dry run and report the four deflators from §1a**, then apply if the grade holds.
5. **Report both deltas**: gov `any_history` (2,238 today) and `chain_2plus` (178 today), plus lane
   completions (1,302) and `lcc_entity_portfolio_facts` (14,076).

## 3. Verification

- **Assert on the state delta**, never on the feeder's own tally, and **never on
  `already_present`** — that is a re-discovery counter that reads exactly like throughput.
- **Report `written` from the INSERT's own `RETURNING` set**, not from a join back to the plan —
  `on conflict do nothing` over-reported by 18 rows in A2 and the dry run could not see it.
- **`human_actionable` must not move** (it held at **55** through B1 and B1a). If it rises, the
  feeder is routing work to a person that should have gone to automation — say so.
- **Verify the reversal by RUNNING it** on a handful of real rows before the batch (P195: a
  reversal never run is a claim, not a capability), and mind
  `lcc_entity_portfolio_facts.is_current` — it is **GENERATED ALWAYS**.
- **Positive-control any zero** you report (P182).

## 4. Deliverable

`docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`, folded into
`docs/architecture/ownership-history-lane.md`, plus the backlog row and a STATUS entry.
**If the grade says this should not ship, say so and stop** — A3, P196, P198 and C1 all ended
that way, and each was worth more than the build would have been.
