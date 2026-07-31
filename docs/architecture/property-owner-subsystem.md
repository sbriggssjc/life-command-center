# Property-Owner Subsystem — finding, design, status (2026-07-31)

## The finding that reframed P0.2 (important)
The existing **"owner reconciliation engine"** (`lcc_owner_evidence` → `lcc_reconcile_owner` →
`lcc_entity_owner_override.owner_user_id`) does **not** resolve the property owner. It resolves the
**point person** — the lcc_user (Scott/Kelly/Sarah/Nate) who *works* the deal. Proof: all 102 rows in
`lcc_entity_owner_override` are `set_by='reconciled'` and **every** `owner_user_id` is an lcc_user (0
are entities). And **My Work scoping reads that exact column** (`v_my_work_scoped.pointperson_user_id`).

So `owner_user_id` is a **point-person** field, not a property-owner field. The property "Owner"
displayed on the panel had **no backing model at all** — which is exactly why it fell back to the
operator/tenant name ("Fresenius Medical Care"). Feeding buyer/owner *entities* through the existing
engine (the original P0.2 plan) would have written entity ids into the point-person column and
**corrupted the My Work scoping** shipped this same day. P0.2 was therefore rebuilt as a **separate**
subsystem that touches none of the point-person machinery.

Two distinct concepts, now cleanly separated:
| Concept | Store | Used for |
|---|---|---|
| **Point person** (who works the deal) | `lcc_entity_owner_override.owner_user_id` → lcc_user | My Work / Team Queue scoping |
| **Property owner** (who owns the building) | `lcc_property_owner.owner_entity_id` → entity | Property panel Owner field, BD targeting |

## What was built (migration `20260818290000`, live)
- **`lcc_property_owner_evidence`** — evidence rows `(entity_id, candidate_owner_entity, source, weight,
  observed_at, detail)`; PK `(entity_id, candidate, source)`.
- **`lcc_property_owner`** — the reconciled result: `entity_id → owner_entity_id, owner_name,
  confidence, margin, source, resolved_at`. **This is what the property panel should read.**
- **`lcc_record_property_owner_evidence(...)`** — upsert one evidence row.
- **`lcc_reconcile_property_owner(entity_id, min_conf=0.55, write=true)`** — recency-decayed weighted
  vote (same proven math as the point-person reconciler), writes the winning **owner entity**.
- **`lcc_ingest_relationship_property_owner(limit, entity_id)`** — feeds the ownership graph we already
  have: `owns` (current owner, weight 3) and `purchases` (buyer/new owner, weight 4, recency-weighted
  by `effective_from`) → evidence → reconcile. Bounded by `limit`; skips already-resolved assets.

## Coverage achieved this session
Ran the feeder in batches over the ownership graph: **1,768 property owners resolved** (from an
effective baseline of 0 real property owners). Spot-check of results = clean, real ownership entities
(Brixmor, Boyd Watterson Asset Management, CHCT Arizona LLC, W.D. Schorsch LLC, Net Lease Alliance,
Rockwell Debt-Free Props …) — **not** operators/tenants. ~63% of assets-with-graph resolved; the rest
had multiple candidates below the 0.55 confidence bar (left unresolved, honestly).

## Wiring — DONE (2026-07-31, ships next redeploy)
The property panel reads owner from the **domain** `v_ownership_current` view, not from OPS, so the
resolved owners are surfaced at the point the panel resolves the LCC entity:
1. **`/api/entities?action=lookup_asset`** (`entities-handler.js`) now attaches `entity.property_owner`
   = the `lcc_property_owner` row (`owner_entity_id, owner_name, confidence, source`) for every hit —
   additive, best-effort.
2. **`detail.js`** merges it into `ownership` when the domain row has no real owner (absent, or the
   operator-as-owner fallback): sets `true_owner` / `true_owner_name`, clears `true_owner_is_operator`,
   stamps `owner_source:'lcc_property_owner'`. Domain deed data still wins when present. Combined with
   the P0.1 guard, the panel now shows the **reconciled owner** where we have one and **"Unresolved"**
   where we don't — never the operator.

## Remaining wiring
1. **Our own deals: SF-seller feeder.** Our 40 open listings have almost no `owns`/`purchases` graph
   linkage (only 2), so 0 resolved from the graph. Their owner = our client/seller, which lives in the
   SF opportunity (Account) and the primary contact — a separate feeder
   (`lcc_ingest_sf_seller_property_owner`) that records the SF Account/seller as the property owner for
   our listings. Highest-value next step for *our* deals specifically.
3. **Bulk + cadence.** Re-run the feeder as new `owns`/`purchases` land (e.g. from the correspondence/
   comps pipelines); consider a scheduled sweep like the deal-correspondence backfill.
4. **Repo mirror — DONE.** Migration `20260818290000_property_owner_subsystem.sql` is applied live and
   mirrored into `supabase/migrations/`; this doc is saved into `docs/architecture/`.

## Why this matters (ties to P0.6)
The P0.6 audit found ~98% of 4,837 assets had no reconciled owner. This subsystem is the mechanism
that closes that gap using data already in the graph — 1,768 resolved in one session — while keeping
the property-owner truth cleanly separate from the point-person truth that drives My Work.
