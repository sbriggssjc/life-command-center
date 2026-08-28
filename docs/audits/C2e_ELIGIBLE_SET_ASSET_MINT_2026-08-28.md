> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4i** —
> this file is the EVIDENCE. **Tranche one is APPLIED to production. Tranche two is NOT run.**
> Predecessor: [`C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md`](C2a_ASSET_MINT_RENT_FLOOR_CURVE_2026-08-28.md).

# C2e — the no-floor, eligible-set gov asset mint: tranche one, and the noise cost finally measured

**Applied live 2026-08-28 to LCC Opps (`xengecqvemvfknjvbvrq`). gov only. dia untouched.**

> ## The one-line finding
>
> **The cost the rent floor existed to prevent is, for asset minting, almost entirely not real.**
> `v_lcc_merge_candidates` and `v_lcc_merge_candidates_normalizer_blind` filter
> `entity_type = 'organization'`; minted assets are `entity_type = 'asset'`, so they are
> **structurally incapable** of entering either surface. Measured across a 2,000-entity mint:
> merge candidates **5,250 → 5,250**, `auto_mergeable` **3,038 → 3,038**, normalizer-blind
> **64 → 64**, canonical-name drift **0 → 0**. The whole observable noise cost was
> **+20 rows on `v_duplicate_candidates`** (8,138 → 8,158, +0.25%) and **+23 Tier 0 cards**,
> of which the `auto` band — the only one that can trigger an unattended write — **did not grow
> at all**.
>
> **Against that: 2,000 properties minted, 2,000 resolved an owner, 0 left evidence-less.
> `lcc_property_owner` 4,065 → 6,065 rows over 2,768 → 3,743 distinct owners (+975).**

---

## 1. Instrument controls, run before anything was written

C2a §9 says the gov numbers are only trustworthy while the LCC mirror reproduces gov's own rent
histogram. It does, **exactly**, in all six bands:

| band | LCC `lcc_property_attributes` | gov `v_property_attributes_portfolio` |
|---|---:|---:|
| ≥ $500k | 2,965 | 2,965 |
| $250–500k | 2,058 | 2,058 |
| $100–250k | 2,826 | 2,826 |
| $50–100k | 1,384 | 1,384 |
| < $50k | 1,804 | 1,804 |
| unknown | 2,800 | 2,800 |
| **total** | **13,837** | **13,837** |

Two further controls, because a clean number is a bug signal until proven otherwise (Class 11):

- **The drift detector can fire.** `v_lcc_canonical_name_drift` reads 0. Pointed at a deliberately
  wrong key (`lcc_entity_canonical_key(name||'ZZ')`) the same comparison returns **64,356** — every
  live entity. The zero is a fact, not a broken instrument.
- **The tombstone arm has nothing to catch, and the reason is known.** `owner_entity_tombstoned`
  is 0 because **0 of 8,919** gov `true_owner` identities point at a merged-away entity — P178's
  trigger resolves `entity_id` to the survivor at INSERT. An honest zero with a mechanism, not an
  unasked question.

## 2. The eligible set — the feeder's own logic, not a re-implementation

`v_lcc_c2e_asset_mint_plan` (migration `20260828140000`) mirrors
`v_lcc_domain_owner_candidates`' CASE arm for arm, plus the sixth guard C2a added
(`lcc_reconcile_property_owner` filters `lcc_owner_name_is_brokerage` *inside* its scoring CTE, so
a candidate can clear the view and still score zero evidence). Resolution is **ID-to-ID**
(`external_identities(gov,'true_owner',<toid>)`), never by name.

**Denominator: 13,837 non-archived gov properties** — the 6,657 archived shells stay excluded
(every feeder filters them; 2 of 6,657 carry a `true_owner_id`).

| status | properties | of which priced |
|---|---:|---:|
| **eligible — would resolve on the same pass** | **6,811** | 5,933 |
| `no_true_owner` — no `true_owner_id` in gov at all | 3,362 | 2,547 |
| `no_owner_entity` — owner has no LCC entity | 188 | 87 |
| `name_blocked` — `lcc_owner_name_promotable` rejects | 48 | 48 |
| `brokerage_at_reconcile` | 5 | 3 |
| `no_name` — no address to name the asset | 1 | 0 |
| `operator_blocked` | **0** *(gov `true_owner_is_operator` is constant false — the arm exists and correctly has nothing to catch)* | — |
| **total no-asset slice** | **10,415** | |

Reproduces C2a exactly. **5,499 distinct owner entities, 5,261 net-new.** Survivor-resolved owner
count is identical (5,499), so no merge indirection is hiding in the number.

**⚠️ The dominant residue is not a guard.** 3,362 properties (54% of everything that would not
resolve) simply have no `true_owner_id` in gov. That is a capture gap, and **no floor decision
touches it** — it is the largest lever left after this work.

## 3. Tranche one — what was minted

Owners taken **whole**, richest gov portfolio first, cut at `cum_props <= 2000`:
**`owner_rank <= 1145` = exactly 2,000 properties / 1,145 owners.**

Owners are kept whole deliberately — evidence lands per property, and a split owner is a
half-resolved owner.

Batch tag **`c2e_gov_eligible_t1_20260828`**. Top rows by rent are the expected institutional
federal assets (400 Dulany St Alexandria $62.3M · 14500 Botts Rd Kansas City $61.6M ·
1200 New Jersey Ave SE $48.3M).

**Honest counts — measured by row-count delta, never the function's own tally:**

| | before | after | delta |
|---|---:|---:|---:|
| entities minted in batch | — | 2,000 | +2,000 |
| identities minted in batch | — | 2,000 | +2,000 |
| **orphan entities (entity with no identity)** | — | **0** | — |
| live entities | 62,356 | 64,356 | **+2,000 (+3.21%)** |
| gov `asset` identities | 3,425 | 5,425 | +2,000 |
| plan view remaining | 6,811 | 4,811 | −2,000 |

`skipped` was 0, so `minted` and the delta agree exactly. The plan view **self-excludes** minted
rows, so it doubles as the live remaining-backlog surface and tranche two reads the same object.

**⚠️ `2000` is round BY CONSTRUCTION** (the `cum_props <= 2000` cut), not a query cap — and this ran
as direct SQL, where PostgREST's 1,000-row response cap never applies. Had the mint gone through
the feeder's PostgREST path, the row list would have silently truncated at 1,000.

## 4. Every minted entity carries evidence — the promise, verified

The mint alone would have left 2,000 evidence-less entities matching the documented retire
predicate. **Cron 225 (`lcc-domain-owner-feeder`, 05:50) is capped at 400 per run**, so left to the
schedule they would have sat that way for ~5 days. The ingest was therefore driven explicitly
(`lcc_ingest_domain_owner_evidence(false, N, 'c2e_t1_20260828')`, 4 batches, ~6 s per 400).

| | result |
|---|---:|
| minted | 2,000 |
| **with evidence** | **2,000** |
| **with a resolved owner in `lcc_property_owner`** | **2,000** |
| **evidence-less (matches the retire predicate)** | **0** |
| distinct owners resolved from the batch | 1,145 |

**Owner-resolution delta:** `lcc_property_owner` **4,065 → 6,065 rows** (+2,000);
**distinct owner entities 2,768 → 3,743 (+975)**. Of the batch's 1,145 owners, 975 had never
carried a resolved property before.

- **Cross-check that the plan was right:** minting moved the *production* candidate view's gov
  `eligible` count **3 → 2,003** — it agreed with the plan's verdict on **2,000 of 2,000** rows,
  with no new `ambiguous` and no new `no_owner_entity`.
- **⚠️ 4 dia rows rode along.** `lcc_ingest_domain_owner_evidence` has no domain parameter, so its
  4 pre-existing dia `eligible` assets were processed too. Cron 225 would have processed the same
  4 rows at 05:50 the same night; **no dia asset was minted** and dia `eligible` was 4 before and
  is 4 after. Stated rather than buried.

## 5. ⚠️ The noise cost — and why most of it was never possible

**This is what C2a could not measure and what the staging existed for.**

| surface | before | after | delta |
|---|---:|---:|---:|
| `v_lcc_merge_candidates` rows | 5,250 | 5,250 | **0** |
| **`auto_mergeable`** | **3,038** | **3,038** | **0** |
| `v_lcc_merge_candidates_normalizer_blind` | 64 | 64 | **0** |
| `v_lcc_canonical_name_drift` | 0 | 0 | **0** |
| `v_duplicate_candidates` | 8,138 | 8,158 | **+20** |
| `v_lcc_tier0_coproposed_owner_duplicates` | 4 | 5 | +1 |
| Tier 0 `ask` | 82 | 91 | +9 |
| Tier 0 **`auto`** | **9** | **9** | **0** |
| Tier 0 parked | 141 | 155 | +14 |
| live entities | 62,356 | 64,356 | +2,000 (+3.21%) |

### The merge surfaces are structurally immune, not merely unmoved

`v_lcc_merge_candidates` selects `WHERE e.entity_type = 'organization'`;
`v_lcc_merge_candidates_normalizer_blind` does the same. A minted asset is
`entity_type = 'asset'`. **It cannot enter either view at any volume.** The zeros above are a
property of the schema, not a small sample — which is why `auto_mergeable` (the gate that
`lcc_apply_fuzzy_merges` loops on, and the single highest-risk number in this change) held at
3,038 through a 2,000-entity mint.

**This substantially rewrites the case for the rent floor.** The floor was defended as protection
against merge-surface and duplicate noise. For *asset* minting that protection was largely
unnecessary — the graph cost is real but tiny and confined to `v_duplicate_candidates`.

### `v_duplicate_candidates` +20 — predicted before the write, matched exactly

That view groups **all** entity types on `canonical_name` with `count(*) > 1`, so it is the one
duplicate surface assets can reach. Predicted **+20 new groups / 28 rows landing in a group**
before minting; measured **+20**. The 20 groups are pairs of gov properties sharing an address
string (a building carrying two property records) — a real signal, and a small one.

### ⚠️ Tier 0 moved, and the brief said it must not — here is why

The brief expected Tier 0 to be flat because "assets are not owners". It moved: `ask` +9,
parked +14. **It is the pipeline working, and the mechanism was verified, not assumed.**

Of the cards now sitting on batch owners, restricted to owners whose **only** resolved property
came from this batch — i.e. owners for whom no Tier 0 card was previously possible:

| band | cards on owners resolvable ONLY via C2e |
|---|---:|
| `ask` | **9** — exactly the observed +9 |
| `auto` | **0** |
| parked | 18 (against a net +14, implying 4 pre-existing parked cards reclassified — not chased) |

Resolving an owner is what makes *"who do we call there"* askable; that is the
account-based-contact-intelligence doctrine, not noise. **The safety statement that matters:
zero `auto` cards landed on any owner C2e made resolvable**, so nothing in this change can produce
an unattended contact write.

### A producer proof N15d was waiting for

N15d recorded that the N15c `canonical_name` trigger had **never been exercised by a real
producer** — "zero entities have been minted since 18:00 UTC", so its zero-drift reading proved the
backfill and not the producer. This mint is that producer: **2,000 entities through a live write
path, all 2,000 on-key, `v_lcc_canonical_name_drift` still 0**, with the detector positive-controlled.

## 6. 👤 Tranche two — recommended, NOT run

**4,811 properties / 4,354 owners remain**, all still in `v_lcc_c2e_asset_mint_plan`.

### ⚠️ Tranche one tested the SAFEST population and does not license a linear extrapolation

The cut at owner-rank 1145 lands at **$543,782 of owner gov rent** — tranche one is *entirely above
the old $500k floor*. **It exercised none of the low-rent tail the no-floor decision is actually
about.** Two measurements say tranche two is worse, though not catastrophically:

| | tranche one (1,145 owners) | tranche two (4,354 owners) |
|---|---:|---:|
| already contactable | 244 (**21.3%**) | 472 (**10.8%**) |
| known beyond the gov feed (≥2 identities) | 148 (**12.9%**) | 192 (**4.4%**) |
| public bodies *(lower bound)* | 33 (2.9%) | 256 (5.9%) |
| within-batch name collisions | 8 / 2,000 (0.40%) | 60 / 4,811 (1.25%) |
| predicted new `v_duplicate_candidates` groups | 20 (1.00%) | **72 (1.50%)** |

Duplicate-group formation is **1.5× the rate** — mildly super-linear, not a cliff. Nothing degrades
non-linearly enough to stop on graph grounds.

### The cliff is inside tranche two, and it is about OWNERS, not noise

Splitting the remainder by owner-level gov rent reproduces C2a's predicted collapse almost exactly
(C2a projected 6.8% and 1.6% contactability; measured 6.6% and 1.5%):

| slice | properties | owners | already contactable | public body (LB) |
|---|---:|---:|---:|---:|
| **≥ $100k owner rent** | 2,570 | 2,300 | **396 (17.2%)** | 62 (2.7%) |
| $50–100k | 742 | 715 | 47 (**6.6%**) | 41 (5.7%) |
| < $50k | 821 | 803 | 12 (**1.5%**) | **143 (17.8%)** |
| rent unknown | 678 | 536 | 17 (3.2%) | 10 |

### Recommendation

**Run tranche two in two steps, not one.**

1. **T2a — owner rent ≥ $100k: 2,570 properties / 2,300 owners, 17.2% already contactable.**
   Statistically indistinguishable from tranche one's 21.3% and it clears the whole of Scott's
   stated $2M–$20M sweet spot ($140k–$1.4M of rent at a ~7% cap). **Run it.** Expect roughly
   +2,570 entities (+4%), ~+38 duplicate groups, ~+20 Tier 0 cards, and **no movement on
   `auto_mergeable`**.
2. **T2b — below $100k plus rent-unknown: 2,241 properties / 2,054 owners, ~3% contactable, 17.8%
   public bodies in the bottom band.** 👤 **Scott's call, and the argument has changed.** C2a
   recommended stopping here because minting would "manufacture surface noise" — **that premise is
   now measured and is largely false**; the graph barely notices. The remaining case against T2b is
   not noise but that these owners are mostly cities, counties, state DOTs, corporate occupiers and
   private individuals rather than prospects. Against that stands Scott's own rationale — *"resolve
   all ownership and pursue the relative next most valuable contact"* — and ranking is
   `v_priority_queue`'s job, not the mint's. **Both readings are defensible; this is a judgement
   about prospect quality, not a technical risk, and it should be made as one.**

**⚠️ Whatever is run, drive `lcc_ingest_domain_owner_evidence` explicitly afterwards.** Cron 225's
400/run cap means a 2,570-row tranche would otherwise leave up to 2,570 entities evidence-less —
matching the retire predicate — for the better part of a week.

## 7. Reversal

Batch-tagged and fully reversible. **Identities before entities** (P141):

```sql
-- 1. drop the resolved owners + evidence this batch created
delete from lcc_property_owner      where entity_id in (select id from entities where metadata->>'mint_batch'='c2e_gov_eligible_t1_20260828');
delete from lcc_property_owner_evidence where entity_id in (select id from entities where metadata->>'mint_batch'='c2e_gov_eligible_t1_20260828');
-- 2. identities, then entities
delete from external_identities     where metadata->>'mint_batch'='c2e_gov_eligible_t1_20260828';
delete from entities                where metadata->>'mint_batch'='c2e_gov_eligible_t1_20260828';
```

The provenance is honest by construction: every row carries
`metadata.minted_because = 'the gov true_owner resolves ID-to-ID to a live LCC entity on this same
pass (C2e eligible set); no rent floor applied per Scott 2026-08-28'`. The mint function previously
hard-coded a string claiming *"a verified dated gov ownership transition exists and the property
cleared the caller's rent floor"* — **false on both clauses for C2e** — so migration `20260828140100`
made the reason a caller argument, defaulting to the feeder's existing text so its behaviour is
unchanged. (Drop-then-create, because a defaulted 4th parameter otherwise makes every 3-arg call
42725 "function is not unique" — the N15d overload trap.)

## 8. What was NOT measured — stated so nobody assumes it was

- **Whether a resolved owner converts to a call.** "Already has an active contact" is a proxy for
  BD reachability, not evidence of it. Unchanged from C2a.
- **Search-surface and UI cost.** Entity count is +3.21%; its effect on the SPA's search and count
  tiles was not exercised.
- **The 4 reclassified Tier 0 parked cards** (18 new C2e-only cards against a net +14) were not
  chased to individual rows.
- **The 3,362 gov properties with no `true_owner_id`** — 54% of the non-resolving residue and the
  largest remaining lever. Untouched; a gov-side capture question.
- **`lcc_looks_like_person` counts are NOT a private-individual census.** It returns true for
  `CITY OF SALEM` / `BROOME COUNTY` (the documented two-capitalised-token false positive, A3/P196),
  which is also why every public-body figure here is a **lower bound**. No second name classifier
  was written — that is the normaliser drift this repo has paid for repeatedly.
- **dia.** Deliberately untouched: 84% of its un-minted owner slots hold an OPERATOR (P113) and 73%
  of its would-resolve population has no rent on file. Its levers are `is_operator_not_owner` and
  rent coverage (A5e), not a floor.
