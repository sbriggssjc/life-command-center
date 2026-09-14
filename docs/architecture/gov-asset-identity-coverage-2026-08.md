# gov asset-identity coverage — what actually caps the owner subsystem, 2026-08-18

**Status:** measured, nothing built. This is a sizing document for a decision, not
a change.

Companion to [`dia-ownership-master-bridge-2026-08.md`](dia-ownership-master-bridge-2026-08.md)
and the P138 work in the **GovernmentProject** repo
(`sql/20260818_gov_p138*.sql`).

---

## 1. The claim I made, and the correction

While building the gov ownership-transition feeder I said LCC holds asset
identities for "2,235 of gov's 20,480 properties — 10.9%", and called that the
bottleneck. **That denominator was wrong**, and worth correcting before anyone
plans against it.

LCC does not track gov properties primarily through `external_identities`:

| | gov | dia |
|---|---|---|
| `lcc_property_attributes` | **13,823** | 17,085 |
| `lcc_entity_portfolio_facts` (current) | 6,740 | 2,235 |
| `external_identities(source_type='asset')` | **2,235** | 1,714 |

**Only 3,948 asset entities exist in total, across both domains.** They are
minted selectively, and the BD path — portfolio facts, top-prospect ranking,
cadence — does not need them. Attributes and portfolio facts key on
`(source_domain, source_property_id)` directly.

## 2. What the asset entity actually gates

One subsystem: **property-owner resolution.**

`lcc_property_owner_evidence`, `lcc_property_owner`, the supersession candidates
view and `lcc_supersede_property_owner()` all key on an **entity UUID**. A
property with no asset entity therefore cannot carry owner evidence, cannot get
a resolved owner, and cannot appear in supersession — regardless of how much
evidence exists for it.

Current scale of that subsystem:

| | |
|---|---|
| assets with owner evidence | 3,046 |
| … of which carry an asset identity | 2,563 (1,627 gov · 945 dia) |
| assets with a **resolved** owner | 2,716 |

## 3. The measured gap, on the correct denominator

Of the **13,823** gov properties LCC already holds attributes for:

| | properties | with rent | annual rent | avg rent |
|---|---|---|---|---|
| **has** an asset entity | 2,232 | 1,235 | $1,530.2M | $1.24M |
| **no** asset entity | **11,591** | **9,802** | **$5,938.5M** | $606k |

So LCC already knows about **$5.94B of gov annual rent** on properties that
cannot participate in owner resolution at all. The covered set skews to higher
rent ($1.24M vs $606k average), so some value-selection clearly happened — but
9,802 rent-bearing properties is not a rounding error.

## 4. What the gov feeder would reach, with and without expansion

The P138 view (`v_ownership_transitions_portfolio`) offers a dated, guarded,
ID-verified owner transition. Two samples, both drawn deterministically by hash:

| population | sampled | feedable | rate |
|---|---|---|---|
| gov properties that **have** an asset entity | 390 | 64 | **16.4%** |
| gov properties with rent and **no** asset entity | 434 | 133 | **30.6%** |

The uncovered population is feedable at nearly **double** the rate — which makes
sense, since asset entities were minted where LCC already had ownership signal,
and the transitions are precisely the properties where ownership moved.

| | reach |
|---|---|
| feeder against existing asset entities | **~367 assets** |
| feeder if entities are minted where evidence exists | **~3,000 assets** |

**Roughly 8×.** That is the whole argument for treating coverage as the lever
rather than the feeder.

## 5. Where a value gate would land

Rent bands for the 9,802 rent-bearing gov properties with no asset entity,
with the 30.6% rate applied:

| band | properties | annual rent | est. feedable |
|---|---|---|---|
| ≥ $2.0M | 616 | $3,022.7M | 188 |
| $1.0M – 2.0M | 615 | $868.3M | 188 |
| $500k – 1.0M | 1,212 | $838.3M | 371 |
| $250k – 500k | 1,802 | $647.3M | 551 |
| $100k – 250k | 2,545 | $421.6M | 779 |
| < $100k | 3,012 | $140.4M | 922 |

The distribution is heavily bottom-weighted by COUNT and heavily top-weighted by
VALUE. A **$500k floor** takes 2,443 properties carrying **$4,729M (80% of the
rent)** and yields ~747 feedable assets — versus 9,802 properties for the
remaining 20% of value. That is the shape a value gate exists for.

## 6. Why this is not simply "mint 11,591 asset entities"

Consumption-Layer doctrine (CLAUDE.md) is explicit: no new producer without a
named consumer, a value gate, an auto-retire predicate, and a ranked, capped,
actionable-only surface. Minting entities at ingestion scale is exactly the
failure mode it exists to prevent — and an asset entity with no evidence
attached is pure noise in every entity count and search result.

The honest framing is the inverse: **evidence justifies the entity.** Mint an
asset entity only where a verified gov transition exists AND the property clears
the rent floor. Then every minted entity has a consumer on day one, and the
retire predicate is "no evidence remains".

## 7. Recommendation

1. **Register the source first** — `gov_ownership_transition` in the tier `CASE`
   of `v_lcc_owner_supersession_candidates` and in `field_source_priority`
   (suggest **18**: above `rel_purchase` at 20, because it is the domain's own
   recorded transfer rather than an edge inferred from a relationship, but in the
   **same supersession tier** so the *date* rather than the source decides
   between them). Cheap, reversible, no writes.
2. **Build the resolver on the P136b pattern** — cross-project read, dry-run
   default, fill-blanks, proposals. Gate at the **$500k** floor for the first
   pass: ~747 assets, 80% of the value.
3. **Mint asset entities only inside that gate**, in the same pass, so entity and
   evidence arrive together.
4. **Do not** extend below $500k until the first pass has been reviewed. The
   bottom two bands are 5,557 properties for $562M — the worst count-to-value
   ratio in the table.

## 8. Caveats on these numbers

- Both feedable rates are **hash-sampled** (390 and 434 rows), not full joins.
  They are stable samples but they are samples; the resolver's dry-run will give
  the exact figure and should be believed over this document.
- The 30.6% rate is applied uniformly across rent bands in §5. It may well vary
  by band — higher-value properties plausibly have more recorded transitions —
  in which case the value-gated yield is **understated**.
- `annual_rent` on `lcc_property_attributes` is a mirrored domain figure and
  inherits whatever staleness the gov sync has.
