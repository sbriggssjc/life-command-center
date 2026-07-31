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

## SF-seller feeder (our own listings) — BUILT ready-and-waiting (2026-07-31)
Our 40 open listings have ~0 `owns`/`purchases` graph edges, so 0 resolved from the graph. Their owner
= our client/seller = the deal's **SF Account**. `bd_opportunities` store `sf_opp_id` but NOT the
account, and no existing flow returns an opportunity's Account (owners_by_ids returns the owner *rep*).
So this is **connector-dependent**, the same posture as the correspondence flow. Built the LCC side
reusing existing machinery (no new reconciler, no rebuilt account logic):
- **`getSalesforceOpportunityAccounts(oppIds)`** (`salesforce.js`) — calls a NEW SF flow op
  `opportunities_by_ids` → `[{opp_id, account_id, account_name}]`. Inert until the op exists.
- **`POST /api/sf-seller-owner`** (`_handlers/sf-seller-owner.js`):
  - **Receiver mode** — body `{mappings:[{deal_entity_id, account_id, account_name, observed_at?}]}`
    → `ensureEntityLink` resolves the SF Account to an **org entity** (same choke point as
    `relatePersonToSfAccount`) → `lcc_record_property_owner_evidence` (source `sf_seller`, weight 4.5)
    → `lcc_reconcile_property_owner`. **Testable now**, no connector needed.
  - **Worker mode** — sweeps open deals (have `sf_opp_id`, no property owner) → `opportunities_by_ids`
    → resolve/record/reconcile. Inert until `SF_LOOKUP_WEBHOOK_URL` + the flow op exist.
- Weight 4.5 > `rel_owns` (3) / `rel_purchase` (4) so the client/seller wins on an open listing, while
  a later recorded purchase (recency-weighted) still transfers ownership after a close.
- **DB path validated** on a real open deal (recorded `sf_seller` evidence → reconciled → wrote
  `lcc_property_owner`, conf 1); synthetic test data removed.

**Connector op to add (Scott, mirrors the correspondence/SF-owner flows):** in the SF lookup flow,
add `operation == 'opportunities_by_ids'` → SOQL `SELECT Id, AccountId, Account.Name FROM Opportunity
WHERE Id IN :ids` → Respond `{ok:true, opportunities:[{Id, AccountId, AccountName}]}`. Then
`POST /api/sf-seller-owner` (worker) resolves our listings' owners.

## SF-seller feeder RESULT (2026-07-31) — our own listings resolved
After Scott added the `opportunities_by_ids` flow op, `POST /api/sf-seller-owner` (worker) resolved
**32 of our 40 open listings** (31 via `sf_seller`, 1 via graph) — up from 0. 8 remain unresolved
(the flow returned no Account for those opportunities). Owners are real seller/investor entities
(MFLP Properties, Mohr Rurik Capital Group, Sound Growth Partners, Mountain Seed, RCG Ventures,
ABG Holdings, Frontier Development, …).

**Fix applied (migration `20260818300000`):** `lcc_reconcile_property_owner` had hardcoded
`source='relationship_graph'`; it now records the winning candidate's actual evidence source(s)
(e.g. `sf_seller`). Re-reconciled our open deals to relabel.

**Data observation to confirm (not a bug):** the SF-seller owner is exactly the deal's Salesforce
**Opportunity Account**. For several deals that Account is a real landlord/investor (good); for the
DaVita listings it is `DaVita Healthcare Partners` — SF has the account set to the *operator/tenant*,
not the landlord. Whether that's a genuine sale-leaseback or SF labeling the account by tenant is a
Salesforce data-quality question. Per doctrine LCC reconciles around SF (never writes back); if those
should be the landlord, the fix is upstream in SF or a higher-authority feeder (deed/county).

## Remaining wiring
3. **Bulk + cadence.** Re-run the feeder as new `owns`/`purchases` land (e.g. from the correspondence/
   comps pipelines); consider a scheduled sweep like the deal-correspondence backfill.
4. **Repo mirror — DONE.** Migration `20260818290000_property_owner_subsystem.sql` is applied live and
   mirrored into `supabase/migrations/`; this doc is saved into `docs/architecture/`.

## Why this matters (ties to P0.6)
The P0.6 audit found ~98% of 4,837 assets had no reconciled owner. This subsystem is the mechanism
that closes that gap using data already in the graph — 1,768 resolved in one session — while keeping
the property-owner truth cleanly separate from the point-person truth that drives My Work.
