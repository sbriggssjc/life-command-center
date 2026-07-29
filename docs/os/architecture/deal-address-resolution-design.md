# Deal-Property Address Resolution — extend the Owner Reconcile Engine (ORE)

_2026-07-28. Design note answering "how do we handle address mismatch resiliently, the way the rest of the
system does?" The answer: LCC already has the pattern (ORE, built for owners). Deal-property resolution should
adopt it identically instead of the bespoke `addr_key` I prototyped._

## The established pattern (what already exists)
LCC resolves owner addresses with an **observation → normalize → reconcile-with-confidence** engine:
- **`lcc_normalize_address(text)`** — the ONE canonical form (lowercase, strip punctuation, collapse spaces).
  Every source normalizes through it so addresses are comparable.
- **`lcc_owner_address_observations`** — each sighting is an *observation*, not an authority:
  `address_raw, addr_norm, city, state, source_surface, address_kind, matchable, authority, confidence,
  source_url, source_context, captured_at`. Many sources contribute; none has to be complete or correct.
- **`lcc_reconcile_match_threshold()`** — a config-driven score cutoff (default 60) in `lcc_reconcile_config`.
- **`lcc_owner_address_reconcile_sweep(limit, staleness)`** — a periodic sweep that scores observations against
  candidate entities and links above threshold, leaving the rest for review. Self-healing, multi-source, tunable.

**This is the resilient pattern.** The deal-property problem (a listing whose property can't be pinned to one
asset) is the same shape as the owner problem — so it should reuse the same engine, not a one-off.

## The design — mirror ORE for deals
### 1. Standardize normalization (retire the bespoke key)
Use `lcc_normalize_address` everywhere for deals — replace the ad-hoc `addr_key`/`reconcile_auto_by_address`
prototype so deal and entity addresses key identically. Add a light **street-prefix key** (house number + first
two non-directional street words) as a *secondary* score signal for near-matches ("2860 S US Hwy 83" vs
"2860 US Hwy 83 South"), fed into the score rather than used as a hard equality.

### 2. Deal address observations (new: `lcc_deal_address_observations`, mirror of the owner table)
Every source that can speak to a deal's property address records an observation with authority + confidence:

| Source (feed) | Authority | Notes |
|---|---|---|
| **SF Property** (`Property2__r.Street__c…`) | high | Blocked today (formula FLS + no connector relationship traversal). A feed slot for when access is granted. |
| **OM / marketing docs** (`staged_intake` → extraction; `lcc_cre_property_documents`) | high | **The key feed for TB's OWN listings** — the address is on the OM cover. 7,885 intake items already flow; extraction is the build. |
| **Matched deal emails** (the live matcher already links emails↔deals) | medium | Pull address strings from subject/body of attributed threads. |
| **Deal name city+state + candidate assets** | low | Geographic prior; the candidate set we already compute. |
| **Geocoding** (`Geocodio`, already wired) | — | Normalize + lat/long to break near-ties. |

### 3. Reconcile sweep (`reconcile_deal_addresses_sweep`)
For each deal with observations, score each candidate asset (normalized-address match + street-prefix + geo
proximity + tenant agreement via `lcc_property_attributes.tenant_short`) against the observation set; apply
`lcc_reconcile_match_threshold`. **Above → auto-link** via the `reconcile_entity` function we already built.
**Below → the review queue** — the existing `flagged-deals` + `reconcile-entity` endpoints. Never blocks the deal.

### 4. Why this is the robust answer
- **Multi-source & self-healing:** no single source must succeed; the SF block stops being fatal because OM
  extraction and email signals also feed observations. Add a new source = add a feed, nothing else changes.
- **Tunable & auditable:** one threshold, full provenance per observation, reversible merges (tombstones).
- **Action-directing:** resolved deals link automatically; the unresolved tail is a finite, shrinking review
  queue instead of a silent gap.

## Where the current 6 fit
They are simply today's **review-queue tail** — no automated feed has fired for them yet (SF blocked, SharePoint
crawl empty, market crawl doesn't hold TB's own listings). Resolving them by hand now = seeding the first
high-authority observations. As the OM-extraction feed comes online they'd auto-resolve, and future flags drain
through the sweep instead of piling up.

## Recommended phased build
1. **Phase 1 — foundation:** create `lcc_deal_address_observations`; rebuild the deal reconcile to score via
   `lcc_normalize_address` + threshold (aligns with ORE); seed observations from the candidate assets + deal
   city/state. Retire the ad-hoc `addr_key`.
2. **Phase 2 — the high-value feed:** OM/document address extraction from `staged_intake` → observations. This
   is what actually captures TB's own listing addresses (the thing no current source has).
3. **Phase 3 — sweep + secondary feeds:** the scored `reconcile_deal_addresses_sweep` on a schedule; add the
   matched-email and geocode feeds; wire the SF-Property feed if/when access is granted.
4. **Backstop:** the `reconcile-entity` review endpoint (built) always handles the residual tail.

## Backlog sweep — sweep v3 (2026-07-29)
Ran the flagged-deal reconcile backlog to ground (per the pre-rollout audit). Two safe extensions, migration
`20260729130000_deal_address_sweep_v3_closed_and_dedup.sql`:

- **`p_include_closed`** — v1/v2 only touched OPEN deals, so the closed won/lost backlog (on placeholder
  entities) was permanently unreconciled. v3 sweeps closed deals too (default off; 2-arg callers unaffected). A
  closed won deal linked to its real property becomes a proper comp; a closed-lost is market history.
- **addr_key dedup tie-break** — when every top-scored candidate is a duplicate row of ONE property (identical
  non-null `addr_key`), the tie is spurious → link. Hard-guarded (single non-null addr_key, no nulls in the set);
  genuinely distinct properties still fall to review. No confidence-bar change: a link still needs score ≥ threshold
  (a unique tenant+geo match = 70).

**Outcome (verified live):** flagged backlog **238 → 197** (41 auto-linked). Closed-TB 42→27, closed-non-TB
188→162, open-non-TB 8→8 (correctly untouched — no address). Integrity: 0 orphaned deals, 0 deals left pointing at
a tombstoned placeholder, open pipeline unchanged (40). Every link was a unique tenant match in the deal's own
city (spot-checked 39/39 — e.g. rebranded "American Renal"/"Innovative Renal Care" Arvada both consolidated to
one property). Reversible via `merged_into` tombstones.

**The residual 197 are honestly unresolvable without new data, not a defect:** ~150 have no tenant match in
`lcc_property_attributes` (score 10, awaiting an address observation) and ~35 are genuine multi-property ties
(several distinct buildings of a national operator in one city — need the specific street address or a human pick).
They drain automatically as the OM-extraction (A1f) and SF browser-read (A1g) address feeds come online. This is
the finite, shrinking review tail the engine was designed to produce — not a silent gap.
