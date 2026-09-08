# BUILD 01B — Power Automate flow: "SF Deal → LCC Opportunity Sync"

Part B of BUILD 01. Part A (the LCC engine endpoint `POST /api/pipeline/ingest-opportunity`)
is deployed and proven. This flow feeds it from Salesforce.

## Salesforce data model (confirmed in-org, 2026-07-27)

- The object **labeled "Deal" is the standard `Opportunity` object** (relabeled). Standard
  field API names apply: `Id`, `Name`, `StageName`, `OwnerId`, `Amount`, `CloseDate`.
- `StageName` is a single **mixed** picklist (24 active values) shared across debt, equity,
  and investment-sales record types. Stage alone is NOT a safe filter → filter by **Record Type**.
- Team Briggs deal record types (Scott-confirmed) — the backbone scope:
  - `Sale Deal - Commercial`
  - `Sale Deal Lost`
  - `IS - Buy Side (CM)`
  - `IS - Off-Market (CM)`
  - `IS - Co-Broke Buyer`
  - `IS - Referral`
- Excluded (lending/servicing, NOT the backbone): Debt Deal, Debt Deal Lost, Equity Deal,
  Equity Deal Lost, Servicing, and the MF/1031/Misc types.

## Why a scheduled SOQL poll (not a create/modify trigger)

Northmarq's Opportunity object carries the entire firm's debt + equity + servicing pipeline,
so a per-record "When a record is created or modified" trigger would fire on thousands of
non-Briggs changes and filter them out after the fact. A scheduled poll with a SOQL
`Filter Query` filters to the six record types **in the query**, so only Team Briggs deals
ever enter the flow. It's stateless (uses a SOQL date literal, no cross-run variable),
and the endpoint's idempotent upsert makes overlapping windows safe.

## Flow definition

**Name:** `SF Deal → LCC Opportunity Sync`

### 1. Trigger — Recurrence
- Interval: **30 minutes** (tune later).

### 2. Salesforce — "Get records" (List records)
- Salesforce **Object type:** `Opportunities`
- **Filter Query** (SOQL `WHERE`, without the word WHERE):

```
RecordType.Name IN ('Sale Deal - Commercial','Sale Deal Lost','IS - Buy Side (CM)','IS - Off-Market (CM)','IS - Co-Broke Buyer','IS - Referral') AND LastModifiedDate >= LAST_N_MINUTES:35
```

- The 35-minute window on a 30-minute recurrence gives a 5-minute overlap so nothing slips
  between runs; the idempotent upsert absorbs the overlap.
- Make sure the retrieved fields include: `Id`, `Name`, `StageName`, `OwnerId`, `Amount`,
  `CloseDate` (the connector returns standard fields by default).

### 3. Apply to each — over the returned records
Inside the loop, one **HTTP** action (or your existing LCC connector's raw POST):

- **Method:** POST
- **URI:** `https://life-command-center-production.up.railway.app/api/pipeline/ingest-opportunity`
  - (or the proxy host `https://tranquil-delight-production-633f.up.railway.app/...` — both work)
- **Headers:**
  - `Authorization: Bearer <LCC_API_KEY>`
  - `Content-Type: application/json`
- **Body:**

```json
{
  "sf_opp_id":   "@{items('Apply_to_each')?['Id']}",
  "name":        "@{items('Apply_to_each')?['Name']}",
  "stage_name":  "@{items('Apply_to_each')?['StageName']}",
  "owner_sf_user_id": "@{items('Apply_to_each')?['OwnerId']}",
  "amount":      "@{items('Apply_to_each')?['Amount']}",
  "close_date":  "@{items('Apply_to_each')?['CloseDate']}"
}
```

(Adjust the `items('Apply_to_each')` name to match your loop's actual name.)

## Endpoint contract (Part A — already live)

Request body: `sf_opp_id` (the Opportunity Id), `name` ("Tenant - City, State"),
`stage_name` (SF StageName label), and optional `owner_sf_user_id`, `amount`, `close_date`,
`vertical`, `property_address`.

Behavior:
- Resolves the deal to an existing LCC asset by **city + state** (tenant token breaks
  collisions); creates a source-tagged asset only if none exists.
- Upserts `bd_opportunities` idempotently on `(workspace_id, sf_opp_id)`.
- Maps the six canonical sale stages (`BOV → bov`, `ELA → ela`, `LOI Executed → loi_executed`,
  `In Escrow → in_escrow`, `Non-Refundable → non_refundable`, `Closed → closed`). **Any other
  stage is kept, not dropped** — normalized to a slug and flagged `metadata.unmapped_stage`
  with `metadata.sf_stage_label`. Watch for these to learn the buy-side / co-broke stage
  vocabulary and extend `STAGE_MAP`.
- `Closed` = won; any stage containing lost/dead/withdrawn = closed-lost (sets `closed_at`,
  `closed_won=false`).
- Inherits `vertical` from the resolved entity's `domain` when the flow doesn't send one.
- Maps `owner_sf_user_id` → `lcc_users.salesforce_owner_id` (all 4 users mapped).

Response (200): `{ ok, entity_id, created_entity, bd_opportunity_id, stage, unmapped_stage, needs_psa_timeline }`.
- `409 ambiguous` (with `candidates`) when a city+state has multiple assets and the tenant
  token doesn't disambiguate — resolve those by hand for now.

## Open follow-ups (post-Part-B)
- Reconcile `unmapped_stage` rows into `STAGE_MAP` once we see the buy-side/co-broke stages.
- Decide whether `Non-Refundable` / `In Escrow` should auto-populate PSA milestone dates
  (the endpoint already returns `needs_psa_timeline` as the trigger signal).
