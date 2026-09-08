# BUILD 01 — SF Opportunity Sync (the spine's first step)
_Build spec. The inbound mirror of the SF drainer._ Makes deals visible with stages, ensures the deal entity, and
IS the dossier-at-BOV trigger. Everything in Domain E (dossier/cadence/monitor/NBA) depends on this.

## Shape (LCC-brokered, like everything else)
**PA flow pulls SF Opportunities → POSTs each to an LCC endpoint → LCC resolves the entity, upserts `bd_opportunities`,
ensures the dossier.** Smarts stay in LCC; the flow just moves data. (Mirror of drainer: there LCC→flow→SF; here SF→flow→LCC.)

## Part A — LCC endpoint (engine, `mcp/`): `POST /api/pipeline/ingest-opportunity`
Body (from the flow, per opportunity):
```json
{ "sf_opp_id":"006…", "name":"…", "stage_name":"BOV|ELA|LOI Executed|In Escrow|Non-Refundable|Closed",
  "amount":123, "close_date":"YYYY-MM-DD", "owner_sf_user_id":"005…",
  "property_address":"…", "property_name":"…", "vertical":"dia|gov|cre" }
```
Logic:
1. **Resolve the deal entity** (asset): match `entities` (entity_type=asset) by `property_address`/`property_name`
   (ilike / normalized_address). If none → **create** via the fact-fabric merge (source `salesforce`) so it's provenanced.
   *Refuse-to-guess on multiple matches → return candidates (like resolveEntity).* 
2. **Map stage:** `stage_name` → `bd_opportunities.stage`; `is_open = stage_name != 'Closed'`.
3. **Map owner:** `owner_sf_user_id` → `lcc_users` (a `sf_user_id` lookup) → `owner_user_id`.
4. **Upsert `bd_opportunities`** on `sf_opp_id`: `{ entity_id, sf_opp_id, stage, is_open, amount,
   expected_close_date, owner_user_id, vertical, last_synced_at=now }`. (PostgREST `on_conflict=sf_opp_id`,
   `resolution=merge-duplicates` — idempotent, per H5.)
5. **Ensure dossier scaffold** — the entity now exists; the dossier is its projection (no extra write). If `stage_name`
   is a contractual stage (LOI Executed / In Escrow / Non-Refundable) and no milestone timeline exists → flag for PSA
   timeline population (FP/E5).
6. Return `{ entity_id, bd_opportunity_id, created_entity: bool }`.
> Engine code, ~like `sf-writeback.js`: `opsQuery`, `enc`, resolve + upsert. Register in `mcp/server.js`;
> proxy route in root `server.js` (the `ai-read` pattern). Author it in `mcp/` (deploy-context lesson).

## Part B — Power Automate flow: "SF → LCC Opportunity Sync"
- **Trigger:** Recurrence (e.g., every 15 min) — robust like the drainer. *(Alt: SF "when a record is created/modified".)*
- **Get Opportunities:** Salesforce **Get records** (Opportunity) where `StageName` ∈ the six stages AND
  `LastModifiedDate` > last run (delta). Select: Id, Name, StageName, Amount, CloseDate, OwnerId, + the property
  fields you map (address/account).
- **Apply to each →** HTTP POST to `{LccHost}/api/pipeline/ingest-opportunity` with `X-LCC-Key`, body per the schema above.
- **On 409 (ambiguous entity match):** route to a "Review — opportunity unresolved" list (don't guess).
- Reuse the exact HTTP/expression patterns from the drainer (Parse JSON via **sample data**, `items('Apply_to_each')?['…']`).

## What it unlocks (immediately)
- `bd_opportunities` carries your real pipeline (stage/amount/close/owner) → the **cadence-scan** endpoint (BUILD 02)
  has real deals to rank; the **dossier** exists at BOV; the **monitor** can watch contractual stages.

## Config to confirm before building
1. **The SF property field** on your Opportunity that identifies the asset (address / a Property lookup / the Account) —
   drives entity resolution.
2. **`lcc_users.sf_user_id`** populated for owner mapping (RBAC H1 depends on this too).
3. Your **`LccHost`** (tranquil-delight URL) + `X-LCC-Key` (same as the drainer).

## Bake-ins folded here (per design)
- **R4 idempotency** — upsert on `sf_opp_id` (done above).
- Entity creation goes through the **fact-fabric merge** (FP), not an ad-hoc insert — so the brain learns the deal with provenance.
