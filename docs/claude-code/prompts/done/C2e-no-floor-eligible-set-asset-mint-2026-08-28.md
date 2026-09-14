# C2e — the no-floor, eligible-set asset mint (gov only), staged, with the noise cost measured

> **Read first:** `docs/architecture/connectivity-and-open-threads.md` **§4f, §4g, §4h** (the
> canonical chain state and Scott's decision), `docs/audits/C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`
> (the curve — do not re-run it), `CLAUDE.md` §"Asset-identity coverage is what gates owner
> resolution" and the **Consumption-Layer doctrine**, `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md`
> Classes 8, 11, 18.
>
> ⚠️ **This WRITES to production.** It mints entities and identities. Everything below is
> dry-run-first, staged, batch-tagged and reversible. **Do not run tranche two in this prompt.**

---

## The decision this implements

**Scott, 2026-08-28: no minimum rent floor.** *"We want to resolve all ownership and pursue the
relative next most valuable contact based on all considerations… bigger deals doesn't always mean
better… our sweet spot tends to be single-tenant deals from $2M to $20M, through volume with repeat
seller clients."*

Two facts that produced it, both established by measurement:

- **The gate is on GROSS ANNUAL RENT, not deal value.** At ~7% cap the $2M–$20M sweet spot is
  **$140k–$1.4M of rent**, so the $500k floor sat at ≈**$7.1M of value** and excluded the bottom
  two-thirds of the target range.
- **The floor decides what to MINT, not who to PURSUE.** Ranking is `v_priority_queue`'s job
  (doctrinal bands P0–P8), and it already weighs owner value, contactability and signal.
  **Mint broadly, rank narrowly.**

⚠️ **What "no floor" does NOT mean.** It does not mean mint everything. It means **drop the rent
predicate and keep the evidence predicate** — mint only properties whose owner **resolves on the
same pass**. C2a measured that at roughly **6,811 of 10,415** gov properties; the ~3,600 that
resolve nothing would sit evidence-less and match the documented retire predicate on day one.
**Re-measure both numbers; do not trust these.**

## Unit 1 — the eligible set, dry run

Build the row list the way the feeder already does — **ID-to-ID**: domain `true_owner_id` →
`external_identities(source_system='gov', source_type='true_owner', external_id=<id>)` → a live
entity. **Never by name** (the `Realty Income Corporation` → `""` footgun). Reuse
`lcc_ingest_domain_owner_evidence` / `v_lcc_domain_owner_candidates` logic; **do not re-implement
the resolver.**

Report, before writing anything:

| | |
|---|---|
| gov non-archived properties with no asset entity | (C2a: 10,415) |
| …whose owner resolves on the same pass — **the eligible set** | (C2a: ~6,811) |
| …skipped, by reason, **named** | evidence-less / no `true_owner_id` / guard-blocked by guard name |
| distinct owner entities gained | dedup matters — one owner may hold many |
| **rent distribution of the eligible set** | so Scott can see the sweet-spot band actually arrives |

⚠️ **Exclude the 6,657 ARCHIVED gov shells** — every feeder filters them (`COALESCE(status,'active')
<> 'archived'`) and they are genuinely empty (2 of 6,657 carry a `true_owner_id`). C2's original
32,289 / 16% included them; live is **25,633 / 5,096 / 19.9%**.

## Unit 2 — mint TRANCHE ONE only, then measure the noise

**Stage it.** Mint a first tranche — suggest the **top ~2,000 of the eligible set by owner-level
portfolio rent**, so the highest-value owners land first and the noise measurement has a real
population without committing the whole set.

Use `lcc_mint_gov_asset_entities(p_rows jsonb, p_batch text, p_dry_run boolean DEFAULT true)`.
⚠️ **It takes a ROW LIST — there is no `--min-rent` inside it**; the old floor was a caller-side
convention in the feeder script, and both C2a and the earlier notes described it wrongly.
**Identities before entities** (P141), batch-tagged, reversible by `metadata->>'mint_batch'`.

### ⚠️ Then measure the cost the gate exists to prevent — this is the point of staging

**It has never been quantified.** C2a could not measure it because nothing had been minted. Before
and after tranche one, report:

| surface | why |
|---|---|
| `v_lcc_merge_candidates` rows **and `auto_mergeable`** | ⚠️ `lcc_apply_fuzzy_merges` loops on that flag — a move here is the highest-risk outcome of this whole change |
| `v_lcc_merge_candidates_normalizer_blind` | the P189 blind population |
| `v_lcc_canonical_name_drift` | must stay **0** (N15c/N15e) |
| Tier 0 lane ask / auto / parked | must not move — assets are not owners |
| entity count, and % growth on the 62,368 baseline | ~2,000 ≈ +3.2% |
| `v_lcc_tier0_coproposed_owner_duplicates`, `v_duplicate_candidates` | duplicate surfaces |

**If `auto_mergeable` moves, name the groups.** An unexplained move is a stop, not a footnote —
that gate has held at 3,040 through N15c, N15e, N19 and P198 and every movement so far has been
explained group by group.

## Unit 3 — recommend tranche two, do not run it

On the measured noise, recommend whether to mint the remaining ~4,800: at what rate the surfaces
degraded, whether any surface degraded **non-linearly**, and what tranche two would cost. **Hand the
call back to Scott.**

## Traps already paid for

- **⚠️ gov ONLY. Do not sweep dia in.** No floor helps dia: **84% of its un-minted owner slots hold
  an OPERATOR** (`is_operator_not_owner`, the P113 trap) and 73% of its would-resolve population has
  no rent on file. Its levers are the operator flag and rent coverage (A5e).
- **A minted entity with no evidence and no portfolio fact has no consumer** — that is the gov
  feeder's own retire predicate, and it is exactly what the eligible-set filter exists to avoid.
- **Honest counts.** Report minted vs already-present vs the **write delta measured by
  `count=exact` before and after**. A send counter is not a write counter; `inserted: N` is a
  derivation counter.
- **A round number is a bug signal** (Class 18). If a count comes back at exactly 1,000 or 2,000,
  check for a query cap before believing it. **PostgREST caps responses at 1,000 rows regardless of
  `limit`.**
- **An implausibly clean result is a bug signal** (Class 11). Point every before/after detector at a
  known positive first.
- **⚠️ The "$500k floor" is FIVE independent knobs** (canonical §4g) — `lcc_mint_gov_asset_entities`'s
  caller · `gov_research_gate_value_floor()` + dia twin · `lcc_weak_role_value_floor()` ·
  `lcc_chain_human_value_floor()` · `CADENCE_SIGNAL_MIN_VALUE`. **This prompt changes ONLY the mint
  caller.** The other Cowork thread's **B1** is changing the research gate; the two do not move
  together despite what `CLAUDE.md` currently says (fix filed as **C2d**).

## Verify by

**Not by rows minted.** By: the eligible-set count with skips named by reason; the **owner
resolution delta** (`lcc_property_owner` rows and distinct owner entities, today 4,065 / 2,768); the
**asset-coverage delta** against the live denominator (5,096 / 25,633 = 19.9%); and the **noise
table before and after**, with `auto_mergeable` explained if it moves at all.

---

## Not in scope

- **Tranche two** — recommend it, do not run it.
- **dia.**
- **The Salesforce bridge (C2b)** — downstream; most of it connects itself once owners exist, and
  `sf_link_candidate` is the existing consumer to extend, never a second one (C1).
- **A5 / A5a / A5c / B1 and the research-task lanes** — the other Cowork thread.

## Still open elsewhere (do not action)

**👤 Scott:** whether `canonical_name` becomes an enforced UNIQUE key (**6,608** violating groups —
⚠️ not the 3,930 quoted pre-N15c); the fcp/tmg sponsor entries; **N3c** bank/trustee scope; **N13**
test-suite pruning.
**Carried:** **C2b** (SF bridge) · **C2c** (unmeasured: dia ownership depth, developer/investor/buyer
split, Outlook per contact, **WebEx is not in the schema at all**, broker assignment on 2,302
cadences) · **C2d** (the five-floors doc fix) · **N19b** · **N3a** · **N16** · **N17**.
