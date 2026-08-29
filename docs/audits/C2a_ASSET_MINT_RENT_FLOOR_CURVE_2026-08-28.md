> **📍 CANONICAL PAGE: [`docs/architecture/connectivity-and-open-threads.md`](../architecture/connectivity-and-open-threads.md) §4e** — this file is the
> EVIDENCE for one measurement. **Diagnosis only — nothing was minted, no floor was changed, no
> row was written to any database.** The floor decision is Scott's; §7 hands him the numbers.

# C2a — at what rent floor does a minted asset actually RESOLVE an owner?

**Measured live 2026-08-28 against LCC Opps (`xengecqvemvfknjvbvrq`), gov (`scknotsqkcheojiaewwh`)
and dia (`zqzrriwuavgrquhisnoa`).**

> ## The one-line finding
>
> **The gov resolve rate does NOT degrade — but the OWNERS it resolves do, and sharply.** Technical
> resolution holds 58–76% from $500k all the way to under $50k. What collapses below ~$100k is
> everything that makes an owner worth having: owners already carrying a contact fall
> **21.8% → 6.8% → 1.6%**, owners known to us outside the gov feed fall **9.7% → 1.3%**, and the
> named rows stop being landlords and start being **cities, counties, state DOTs, FedEx and private
> individuals**. **dia is a different question entirely** — no floor helps it, because **84% of its
> un-minted owner slots hold an OPERATOR**, and 73% of its would-resolve population has no rent on
> file at all.
>
> **Recommendation: stage gov to $250k now, re-measure, and treat $100k as the hard floor. Never go
> below it. Change nothing on dia.**

---

## 1. ⚠️ Three denominator corrections before any number below is read

**(a) `32,289 properties` and `16% asset coverage` (C2 / §4e) include 6,657 ARCHIVED gov shells.**
gov `v_property_owner_facts_portfolio` and `v_property_attributes_portfolio` both filter
`COALESCE(status,'active') <> 'archived'`, so those rows are invisible to every feeder by design.
They are also genuinely empty: of 6,657 archived gov properties, **2 have a `true_owner_id` and 1
has rent**. Excluding them:

| | properties | LCC asset anchors | coverage |
|---|---:|---:|---:|
| gov (non-archived) | 13,837 | 3,422 | **24.7%** |
| dia (live) | 11,796 | 1,674 | **14.2%** |
| **fleet** | **25,633** | **5,096** | **19.9%** |

**So the gate is 20%, not 16%.** (The 5,145 / 5,144 headline count includes 49 identities pointing
at properties that no longer exist — 3 gov, 46 dia.) This does not change C2's conclusion; it
changes the number quoted for it.

**(b) BREAK-3's 49.2% is of ASSETS. C2's 13% is of PROPERTIES. This file's percentages are of the
NO-ASSET SLICE of a rent band** — i.e. "if we minted the properties in this band that have no asset
entity, what share would resolve an owner". Three different denominators, all correct about
different questions. Every table below states its own.

**(c) ⚠️ The LCC mirror is a valid instrument for gov and NOT for dia — this was checked, not
assumed.** `lcc_property_owner_facts` reproduces gov's own rent histogram **exactly**
(2,965 / 2,058 / 2,826 / 1,384 / 1,804 / 2,800 in both), so the gov curve is measured in LCC. It
**over-reports dia** (193 vs 188, 973 vs 944, 13,053 vs 7,641) because 5,519 mirrored dia rows
point at properties the twin-merge work deleted — `lcc_apply_property_owner_facts_page` upserts and
never deletes. All 5,519 lack a `true_owner_effective_id`, so they could only ever inflate a
denominator, never a numerator; the dia curve is nonetheless measured **at dia**, with the LCC
eligibility verdict shipped in as an id list. **A mirror that matches on one domain is not thereby
validated on the other.**

## 2. How "would resolve" is computed — the feeder's own logic, not a re-implementation

Read from `v_lcc_domain_owner_candidates` and `lcc_ingest_domain_owner_evidence`
(migration `20260906120000`). A property would resolve when, **by ID and never by name**:

1. it has a `true_owner_effective_id` (`COALESCE(merged_into_true_owner_id, true_owner_id)`);
2. `true_owner_is_operator` is false — the **recorded dia flag**, never a name test (P113);
3. `lcc_owner_name_promotable(true_owner_name)` — placeholder / federal-tenant / brokerage rejects;
4. `external_identities(<dom>, 'true_owner', <toid>)` resolves to a live entity;
5. that entity is not in `lcc_owner_operator_block`;
6. **and — the guard the candidate view does NOT apply —** the entity's own name is not a brokerage.
   `lcc_reconcile_property_owner` filters `lcc_owner_name_is_brokerage(ce.name)` *inside the scoring
   CTE*, so a candidate that clears the view can still score zero evidence and never resolve. It
   costs **5 gov properties** and is included here.

**A freshly minted asset resolves deterministically.** Confidence is `top_score / total_score`; a
new entity carries exactly one evidence row (`domain_true_owner`, weight 5.0), so confidence is
**1.000 ≥ the 0.55 gate** and the write always happens. This is why "eligible" and "resolved" are
the same number here, and why P113's 809 → 514 does **not** apply: those were *existing* assets
already carrying competing evidence.

## 3. ⚠️ The instrument was controlled three ways, because a flat curve is a bug signal

CLAUDE.md and playbook Class 11 both say a rate that fails to degrade must be treated as an
instrument fault until proven otherwise. It was:

- **Mutation control.** The identical query with the identity join pointed at `recorded_owner_id`
  instead of `true_owner_effective_id` returns **0 resolutions in every band, across all 6,688
  rows.** The join is doing real work; it is not matching everything.
- **A population that DOES degrade, through the same query shape.** dia falls monotonically
  **18.5% → 12.2% → 7.9% → 5.3% → 1.6%**. The shape can report a bad band.
- **The rejecting arms fire.** gov `no_true_owner` runs 377–816 per band and `no_owner_entity`
  11–101; nothing is being waved through.

The flat gov curve is real. **What it is measuring is narrower than it looks** — see §5.

## 4. gov — the curve. Denominator: 13,837 non-archived properties

| rent band | properties | have an asset entity | no asset | **would resolve if minted** | rate of no-asset | net-new owner entities | of which ≥$500k of gov rent *as an owner* |
|---|---:|---:|---:|---:|---:|---:|---:|
| **≥ $500k** *(current floor)* | 2,965 | 1,186 | 1,779 | **1,218** | **68.5%** | 928 | **928** |
| $250–500k | 2,058 | 776 | 1,282 | **884** | **69.0%** | 701 | 78 |
| $100–250k | 2,826 | 281 | 2,545 | **1,932** | **75.9%** | 1,549 | 19 |
| $50–100k | 1,384 | 86 | 1,298 | **896** | **69.0%** | 735 | 2 |
| < $50k | 1,804 | 90 | 1,714 | **1,003** | **58.5%** | 817 | 0 |
| **rent unknown** | 2,800 | 1,003 | 1,797 | **878** | **48.9%** | 531 | 5 *(524 hold no priced property at all)* |

Owner entities are assigned to their **highest** band, so the column is disjoint and sums to the
true distinct total of **5,261**. Per-property "value" would double-count them by 1.2–1.4×.

**The guard residue, guard by guard, on the no-asset slice:**

| band | no true owner on file | operator-blocked | name-blocked | owner has no LCC entity | brokerage (at reconcile) |
|---|---:|---:|---:|---:|---:|
| ≥ $500k | 533 | 0 | 7 | 21 | 0 |
| $250–500k | 377 | 0 | 7 | 14 | 0 |
| $100–250k | 576 | 0 | 9 | 25 | 3 |
| $50–100k | 389 | 0 | 2 | 11 | 0 |
| < $50k | 672 | 0 | 23 | 16 | 0 |
| unknown | 816 | 0 | 0 | 101 | 2 |
| **total** | **3,363** | **0** | **48** | **188** | **5** |

Every row balances (`no_asset = would_resolve + the five guards`). **Operator-blocked is 0 on gov by
construction** — its `true_owner_is_operator` is a constant `false` (the tenant is a federal agency),
so the arm exists and correctly has nothing to catch. **The dominant residue is not a guard at all:
3,363 properties (54% of everything that would not resolve) simply have no `true_owner_id` in the
gov database.** That is a capture gap, not a policy one, and no floor touches it.

## 5. ⚠️ The finding that decides this: the rate holds, the OWNERS do not

The same net-new owner sets, measured on recorded facts rather than on the resolve rate:

| band | net-new owners | already carry an active contact | known beyond the gov feed (≥2 identities) | carry a Salesforce identity | public bodies *(lower bound)* |
|---|---:|---:|---:|---:|---:|
| ≥ $500k | 928 | **170 (18.3%)** | 90 (9.7%) | 67 | 24 |
| $250–500k | 701 | **153 (21.8%)** | 53 (7.6%) | 48 | 14 |
| $100–250k | 1,549 | **241 (15.6%)** | 88 (5.7%) | 77 | 45 |
| $50–100k | 735 | **50 (6.8%)** | 17 (2.3%) | 14 | 38 |
| < $50k | 817 | **13 (1.6%)** | 11 (1.3%) | 7 | **147 (18%)** |
| unknown | 531 | 17 (3.2%) | 8 (1.5%) | 8 | 9 |

**Read on named rows, which is where this became obvious.** Fourteen would-resolve rows from each
extreme, taken at random (bottom band) and by rent (top band):

| ≥ $500k | < $50k |
|---|---|
| LCOR · Centerpoint · Pershing Road Development Co LLC · TWO CON LLC · Greenebaum & Rose · The Downes Company · Belz Enterprises · USAA Real Estate · The Durst Organization · PARCEL 49C LP · Potomac Center North Inc | **Transportation, Hawaii Department Of** · **CITY OF SALEM** · **CITY OF MERCED** · **COUNTY OF DAWSON** · **BROOME COUNTY** · **Federal Express Corporation** · **Peninsula Airways Inc** · **Bank of Colorado** · **Taralunga Vlad** · **Robert A Crane** · REC Properties LLC · Bauer Properties LLC · Two Greenville Park LP · Ace Industrial Properties Inc |

The top band is a list of institutional landlords. The bottom band is mostly **municipalities, state
agencies, corporate occupiers and private individuals** — parties that resolve perfectly and are not
prospects. Roughly 4 of the 14 bottom-band rows are genuine small landlords.

- **⚠️ `public bodies` above is a LOWER BOUND and must be read as one.**
  `lcc_owner_name_is_not_prospected` catches `CITY OF …` and `COUNTY OF …` and **misses
  `BROOME COUNTY`** (county as a suffix) and **`Transportation, Hawaii Department Of`**. And
  `lcc_looks_like_person` returns **true** for `CITY OF SALEM`, `COUNTY OF DAWSON` and
  `BROOME COUNTY` — the documented two-capitalised-tokens false positive (A3 / P196). **Neither
  shared guard is a prospectability classifier, and a new one was deliberately not written**: a
  second name classifier is the normaliser drift this repo has paid for a dozen times. The honest
  statement is the lower bound plus the named-row read, not a precise share.
- **The aggregation hypothesis was tested and refuted.** "Small per property but big per owner" is
  the obvious defence of a lower floor, and it is false here: of the 701 owners unlocked by
  $250–500k only **78** reach $500k of gov rent when their whole gov portfolio is summed, and of the
  1,549 unlocked by $100–250k only **19** do. Low-band gov owners are overwhelmingly single-asset
  holders. (Owner totals are gov-only; the gov and dia owner-entity sets overlap by **15**, so this
  is a rounding error, not a caveat.)
- **⚠️ One named guard gap, sized not patched.** `lcc_owner_name_promotable` blocks
  `general services administration` but **not the bare acronym `GSA`**, which sits in the gov owner
  slot on **3 properties carrying $56.7M of rent** — including the third-largest would-resolve row
  in the system. `United States Postal Service` (46 properties, $46.8M) is correctly blocked.
  Three properties is a human look, not a regex change: broadening a `contains` rule is exactly the
  P158a mistake, and `Federal Building LLC`, `GSA Group LLC` and `Gsa-Irs St. Louis Property, LLC`
  are all real private landlords sitting next to it.

## 6. dia — the floor is the wrong knob. Denominator: 11,796 live properties

| rent band | properties | have an asset entity | no asset | **would resolve** | rate of no-asset | no true owner | **operator-blocked** | name / entity guards |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ≥ $500k | 188 | 80 | 108 | **20** | **18.5%** | 11 | 76 | 1 |
| $250–500k | 944 | 330 | 614 | **75** | **12.2%** | 42 | 484 | 13 |
| $100–250k | 2,236 | 581 | 1,655 | **131** | **7.9%** | 109 | 1,385 | 30 |
| $50–100k | 590 | 79 | 511 | **27** | **5.3%** | 37 | 441 | 6 |
| < $50k | 197 | 12 | 185 | **3** | **1.6%** | 18 | 163 | 1 |
| rent unknown | 7,641 | 592 | 7,049 | **788** | **11.2%** | 1,212 | 4,231 | 818 |

Three facts make a dia floor meaningless:

1. **The operator trap is the whole story.** 6,780 of dia's 10,122 no-asset properties (67%, and
   **84% of those that carry an owner at all**) point at a `true_owners` row flagged
   `is_operator_not_owner` — DaVita, Fresenius, U.S. Renal Care in the landlord slot. No rent floor
   moves that; only the flag does.
2. **The current $500k floor admits 108 dia properties in total, of which 20 would resolve.** dia is
   a small-box asset class; only **188 of 11,796 dia properties are priced at $500k at all**.
3. **⚠️ A dia rent floor gates on rent COVERAGE, not value.** dia prices only **4,155 of 11,796
   properties (35%)**, so 7,049 of the 10,122 no-asset properties land in `rent unknown` — and that
   band holds **788 of the 1,044 dia properties that would resolve (75%)**. Gating them out is the
   A5c `value_unknown` finding again: a coverage gap wearing a value judgement. **Unknown is not
   zero.**

Fleet-wide the dia eligible set is **784 owner entities**, 745 of them net-new, of which **90 (11.5%)
are known beyond the dia feed**, 56 carry a Salesforce identity and **40 (5.1%) already have an
active contact** — a materially worse contact rate than gov's top three bands.
⚠️ dia's owner-quality columns are **fleet-wide, not band-split**: splitting them needs a third
cross-database round trip and the population is too small to change the answer. Stated, not implied.

## 7. 👤 The floor decision — cumulative, for Scott

Each row is **everything at or above that floor**, gov only. Owners are deduped across bands.

| floor | properties minted | would resolve | rate | net-new owner entities | …already contactable | …≥$500k as an owner |
|---|---:|---:|---:|---:|---:|---:|
| **≥ $500k** *(today)* | 1,779 | 1,218 | 68.5% | 928 | 170 | 928 |
| **≥ $250k** | 3,061 | 2,102 | 68.7% | **1,629** | **323** | 1,006 |
| **≥ $100k** | 5,606 | 4,034 | 71.9% | **3,178** | **564** | 1,025 |
| ≥ $50k | 6,904 | 4,930 | 71.4% | 3,913 | 614 | 1,027 |
| all priced | 8,618 | 5,933 | 68.8% | 4,730 | 627 | 1,027 |
| + rent unknown | 10,415 | 6,811 | 65.4% | 5,261 | 644 | 1,032 |

For scale: `lcc_property_owner` holds **4,065** resolved rows over **2,768** owner entities today.
A $250k floor takes that to ~6,167 rows / ~4,397 owners (**+52% / +59%**); $100k roughly doubles it.

**Recommended: $250k now, re-measure, $100k as the hard floor, and never below it.**

- **$500k → $250k is a clear win and the cheapest step.** The resolve rate is flat (68.5% → 69.0%),
  the contact rate is the **highest of any band (21.8%)**, and 78 of the 701 new owners clear the
  $500k owner-level floor on their own portfolios. Nothing about this band looks like noise.
- **$250k → $100k is defensible but is where the owners get small.** It is the largest single
  unlock (+1,549 owners, +241 already contactable, resolve rate *rises* to 75.9%), and only **19** of
  those owners reach $500k of gov rent. That is a real BD population, just a different one — small
  local landlords, one asset each. **Take it as a second step, after the first has been worked**,
  not in the same pass.
- **Below $100k, stop.** Contactability falls off a cliff (6.8%, then 1.6%), owners known outside
  the gov feed fall to 1–2%, the measured public-body share rises to at least 18%, and the named
  rows are cities and counties. This is where minting starts manufacturing exactly the surface noise
  the gate exists to prevent.
- **⚠️ Do not mint the band — mint the ELIGIBLE SET inside it.** The mint caller supplies its own row
  list (`lcc_mint_gov_asset_entities` takes `p_rows`), so the run can be restricted to properties
  that will resolve on the same pass. At $250k that is **2,102 properties minted, 100% of which
  carry evidence immediately**, instead of 3,061 of which 959 would sit evidence-less and match the
  documented retire predicate on day one. This is the difference between honouring *"evidence
  justifies the entity, never the reverse"* and merely citing it.
- **Change nothing on dia.** Its lever is `is_operator_not_owner` and its rent coverage (A5e), not a
  floor. A dia floor of any value admits almost nothing.

## 8. What was NOT measured — stated so nobody assumes it was

- **The noise cost was not modelled.** A $250k mint adds ~2,102 asset entities to a 62,368-entity
  graph (+3.4%); a $100k mint adds ~4,034 (+6.5%). Their effect on `v_lcc_merge_candidates`,
  search and every count surface is the *reason the gate exists* and it was **not quantified here** —
  minting nothing meant there was nothing to measure it on. It should be measured on the first
  staged batch before the second.
- **Whether a resolved low-band owner converts to a call.** "Already has an active contact" is a
  proxy for BD reachability, not evidence of it.
- **The 3,363 gov properties with no `true_owner_id`** — 54% of the non-resolving residue, and the
  single largest lever left after the floor. It is a gov-side capture question, untouched here.
- **`v_lcc_domain_owner_candidates`' `ambiguous` and `self_reference` arms** are structurally
  inapplicable to a fresh mint (one new entity per property, no prior identity), so they are absent
  from every table above rather than reported as zero.
- **dia owner quality by band** (§6), and **dia's 1,063 vs 1,061** — grouping dia's would-resolve set
  by domain `true_owner_effective_id` rather than by LCC entity overstates distinct owners by
  **0.19%**, because two domain owner ids can point at one merge survivor. Measured, not assumed.

## 9. Re-measure

Every figure above is reproducible from three queries: the gov band table and its owner-quality
table run entirely on LCC Opps off `lcc_property_owner_facts` + `lcc_property_attributes` +
`external_identities`; the dia table runs at dia with the LCC eligibility verdict shipped in as a
property-id list. **Re-run the §1(c) histogram comparison first** — if the LCC mirror stops
reproducing gov's own rent histogram exactly, the gov numbers are being measured on a stale
instrument and nothing below it can be trusted.
