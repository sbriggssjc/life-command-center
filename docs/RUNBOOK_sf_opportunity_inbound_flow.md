# RUNBOOK — turn on the inbound Salesforce Opportunity sync

**Why:** `bd_opportunities.amount` is NULL on **all 614 rows** (45 open, 226
closed-won). Every deal in the BD spine is value-blind, which is why
`lcc_decision_entity_value` (P121) can only give an open opportunity a flat
$5,000 tier instead of its real size.

**Status when this was written (2026-08-17):**

| piece | state |
|---|---|
| handler `handleSalesforceOpportunityUpsert` | exists, maps `amount: p.Amount ?? null` |
| route `sf.opportunities` → `salesforce.opportunity.upsert` | registered in `api/bridges.js` |
| `connector_bridges` row | **seeded by P123** (was missing entirely) |
| parent-Account dependency | **satisfied** — 16,235 `salesforce/Account` identities already exist |
| Power-Automate flow | **missing — this runbook** |
| metadata → `bd_opportunities.amount` hop | **missing — see §5, and read it before you start** |

---

## ⚠️ 0. Read this first — the flow alone does NOT fill `bd_opportunities.amount`

`handleSalesforceOpportunityUpsert` appends the opportunity to
**`entities.metadata.salesforce.opportunities[]`**. It does **not** write the
`bd_opportunities` table.

So after this flow runs you will have SF Amounts *inside LCC*, but
`bd_opportunities.amount` will still be NULL and the BD spine will still be
value-blind. §5 is the second hop that closes it. Both halves are needed; the
flow is the one that requires you, the second is a migration.

I am flagging this up front because the obvious assumption — "build the flow,
amounts appear" — is wrong, and you would find out only after doing the work.

---

## 1. Prerequisites

- Power Automate with a Salesforce connection (the same one your existing
  Outlook mirror flow uses for its HTTP action pattern).
- `LCC_API_KEY` — the value already in your Railway env.
- Base URL: `https://tranquil-delight-production-633f.up.railway.app`

The only existing bridge is `outlook.messages`, so there is no sibling SF flow to
clone — but its **shape** (Get rows → build array → POST ingest → POST worker) is
exactly what you are copying.

---

## 2. Create the flow

**New flow → Scheduled cloud flow.** Name: `LCC — SF Opportunities → Bridge`.
Start time: any. Repeat every **1 hour**.

### Step 1 — Salesforce "Get records"

| field | value |
|---|---|
| Object type | `Opportunities` |
| Filter Query | `LastModifiedDate > LAST_N_DAYS:2` |
| Order By | `LastModifiedDate ASC` |
| Top Count | `2000` |

> Keep the `LAST_N_DAYS:2` window. The ingest is idempotent on `Id`, so overlap
> is harmless, and a fixed window is far easier to reason about than a stored
> watermark on the first pass.

### Step 2 — "Select" (Data Operation)

**From:** `body('Get_records')?['value']`

**Map** — switch to text mode and paste exactly:

```json
{
  "Id": "@{item()?['Id']}",
  "AccountId": "@{item()?['AccountId']}",
  "Name": "@{item()?['Name']}",
  "StageName": "@{item()?['StageName']}",
  "Amount": "@{item()?['Amount']}",
  "CloseDate": "@{item()?['CloseDate']}",
  "Probability": "@{item()?['Probability']}",
  "Type": "@{item()?['Type']}",
  "OwnerId": "@{item()?['OwnerId']}",
  "IsClosed": "@{item()?['IsClosed']}",
  "IsWon": "@{item()?['IsWon']}",
  "LastModifiedDate": "@{item()?['LastModifiedDate']}"
}
```

These are exactly the twelve fields on the bridge allowlist. Anything else is
dropped at ingest by design — that is the privacy contract, the same mechanism
that deliberately excludes message bodies on `outlook.messages`.

### Step 3 — HTTP: ingest

| field | value |
|---|---|
| Method | `POST` |
| URI | `https://tranquil-delight-production-633f.up.railway.app/api/bridges?_route=ingest&_source=salesforce&bridge=sf.opportunities` |
| Headers | `Content-Type: application/json`<br>`X-LCC-Key: <your LCC_API_KEY>`<br>`X-PA-Flow-Run: @{workflow()['run']['name']}` |

**Body:**

```json
{
  "workspaceId": "a0000000-0000-0000-0000-000000000001",
  "records": @{body('Select')}
}
```

Expected 200:

```json
{ "ok": true, "rows_in": 37, "rows_accepted": 37, "rows_dropped": 0 }
```

### Step 4 — HTTP: drain the worker

Ingest only **enqueues**; it does not process. Your Outlook flow already does
this second call, which is why its jobs complete ~13 seconds after creation.

| field | value |
|---|---|
| Method | `POST` |
| URI | `https://tranquil-delight-production-633f.up.railway.app/api/bridges?_route=worker&batch=200` |
| Headers | `X-LCC-Key: <your LCC_API_KEY>` |

Add a **Delay of 5 seconds** before this step so ingest has committed.

---

## 3. Test before scheduling

Run the flow once with **Test → Manually**. Then:

```sql
-- did rows land?
select count(*) opps_in_metadata,
       count(*) filter (where opp->>'amount' is not null) with_amount
from entities e,
     lateral jsonb_array_elements(coalesce(e.metadata->'salesforce'->'opportunities','[]'::jsonb)) opp;

-- did any job fail, and why?
select status, count(*), left(max(last_error),160) sample_error
from enrichment_jobs where job_type='salesforce.opportunity.upsert' group by 1;
```

**Expected failure you can ignore:** `account_not_yet_ingested:<id>` — the worker
retries with backoff. If *every* row shows it, the AccountIds in your SF org do
not match the 16,235 already in LCC; stop and tell me rather than widening the
handler.

---

## 4. Flip the registry flag

Once rows are landing:

```sql
update feature_flags_registry
   set state = 'on', off_since = null, updated_at = now()
 where flag = 'SF_OPPORTUNITY_INBOUND_SYNC';
```

Until you do, the daily briefing keeps printing it under **Dormant
Capabilities** — which is correct, and the point of P122.

---

## 5. The second hop — metadata → `bd_opportunities.amount`

Only build this **after** §3 shows amounts arriving; it is a no-op before that,
and shipping a no-op that looks healthy is the exact failure P122 was about.

```sql
-- Fill-blanks: only ever fills a NULL amount, matched on sf_opp_id.
update bd_opportunities b
   set amount = (opp->>'amount')::numeric,
       updated_at = now()
  from entities e,
       lateral jsonb_array_elements(
         coalesce(e.metadata->'salesforce'->'opportunities','[]'::jsonb)) opp
 where b.sf_opp_id = opp->>'id'
   and b.amount is null
   and (opp->>'amount') is not null
   and (opp->>'amount')::numeric > 0;
```

Verify, then re-check that the deal value actually reaches the ranking:

```sql
select count(*) total, count(amount) with_amount,
       round(percentile_cont(0.5) within group (order by amount)::numeric)::text median
from bd_opportunities;
```

When amounts are populated, **re-evaluate two decisions I made against the
current data**:

1. `lcc_decision_entity_value` (P121) gives an open opportunity a flat `5000`.
   That tier exists only because no amount was available — swap it for the real
   figure.
2. `milestone_confirm` was deliberately **not** value-ranked (P122): 38 of 40
   rows landed on that same flat tier, which would have replaced a useful
   0.5–1.0 extraction-confidence signal with noise. With real amounts the
   trade-off changes.

---

## Reversal

```sql
delete from connector_bridges where bridge_key = 'sf.opportunities';
-- and turn the Power-Automate flow off
```
