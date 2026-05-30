# Runbook — SJC Broker Contact Sync

**Goal:** get the internal SJC broker **Contact** records into
`dia.public.salesforce_contacts` so the deal book can attribute deals to an
**individual broker**, not just a team.

**Status:** ready to build. DB side is verified (table is upsert-ready, view
migration staged). Salesforce/Power Automate side must be built by Scott (SF
credentials live in the PA tenant).

---

## Background (why the obvious approach is wrong)

The task framing assumed broker contacts flow through the `intake-salesforce`
edge function "contact mapping in `sf-config.ts`". **That mapping does not
exist.** `intake-salesforce` only stages `property / comp / listing / deal` into
the `sf_*_staging` tables. The `salesforce_contacts` table (~5,000 rows, refreshed
daily) is written by a **separate flow doing direct PostgREST upserts**. This
runbook follows that real, existing path.

Consequences that satisfy the task's guard-rails for free:

- **No `sf_sync_log` rows** → the payload-retention policy is N/A (nothing to keep
  off success rows).
- **No watermark / allowlist** of any other flow is touched. The broker set is
  tiny (~30 contacts), so this flow **re-syncs the full set every run** — no
  watermark store needed at all.

---

## The data (verified on dia `zqzrriwuavgrquhisnoa`, 2026-05-29)

- `salesforce_contacts`: 5,002 rows. **0** of the 17 requested brokers present.
- Robust set ("every Contact broker on a deal") = **30 distinct `003…` Contact
  Ids** across `Listing_Broker_sjc__c`, `_2/_3/_4`, `Compliance_Broker_sjc__c`.
  Superset of the 17.
- Those same broker fields also hold **32 `a1s…` Ids** — these are a custom
  Broker/team **junction object**, NOT Contacts. **Exclude them** from any
  Contact SOQL (filter `startsWith('003')`).
- `salesforce_contacts` is upsert-ready: `UNIQUE (sf_contact_id)`; service-role
  can INSERT; RLS enabled (service role bypasses it).

### Reproduce the broker-Id list any time (run on dia)

```sql
WITH ids AS (
  SELECT raw_row->>'Listing_Broker_sjc__c'   AS b FROM sf_listing_staging
  UNION ALL SELECT raw_row->>'Listing_Broker_2_sjc__c'  FROM sf_listing_staging
  UNION ALL SELECT raw_row->>'Listing_Broker_3_sjc__c'  FROM sf_listing_staging
  UNION ALL SELECT raw_row->>'Listing_Broker_4_sjc__c'  FROM sf_listing_staging
  UNION ALL SELECT raw_row->>'Compliance_Broker_sjc__c' FROM sf_listing_staging
)
SELECT string_agg(DISTINCT quote_literal(b), ', ' ORDER BY quote_literal(b))
FROM ids WHERE b LIKE '003%';
```

---

## Build the Power Automate flow (Flow 6)

Full step-by-step is in [`.github/PA_FLOWS.md`](../../.github/PA_FLOWS.md) → "Flow 6:
SJC Broker Contact Sync". Summary:

1. **Trigger:** Recurrence, daily.
2. **Salesforce SOQL** — backfill with the explicit 30-Id `Contact` query (below),
   or robust dynamic (read the 5 broker lookups off the deal object → distinct
   `003…` Ids → `Contact WHERE Id IN (…)`).
3. **Select** → shape each Contact to the upsert columns.
4. **HTTP POST** the whole array to the Supabase REST upsert endpoint.

### Contact SOQL — backfill (the 30 current brokers)

```sql
SELECT Id, FirstName, LastName, Name, Email, Phone, AccountId,
       CreatedDate, LastModifiedDate
FROM Contact
WHERE Id IN (
  '0038W00002PR8mEQAT','0038W00002PR97EQAT','0038W00002PREhcQAH','0038W00002PREhiQAH',
  '0038W00002PREhkQAH','0038W00002PREhoQAH','0038W00002PREhtQAH','0038W00002PREhVQAX',
  '0038W00002PREhYQAX','0038W00002PREhzQAH','0038W00002PREhZQAX','0038W00002PREiaQAH',
  '0038W00002PREidQAH','0038W00002PREiUQAX','0038W00002PREivQAH','0038W00002PREixQAH',
  '0038W00002PREizQAH','0038W00002PREjbQAH','0038W00002PREjfQAH','0038W00002PREjiQAH',
  '0038W00002PREjoQAH','0038W00002PREjqQAH','0038W00002PREjsQAH','0038W00002PREjvQAH',
  '0038W00002PREjXQAX','0038W00002PREk0QAH','0038W00002PREkdQAH','0038W00002PREkeQAH',
  '0038W00002PREnGQAX','0038W00002RhHhKQAV'
)
ORDER BY LastModifiedDate ASC
```

### Supabase upsert (HTTP action)

```
Method:  POST
URI:     https://zqzrriwuavgrquhisnoa.supabase.co/rest/v1/salesforce_contacts?on_conflict=sf_contact_id
Headers:
  apikey:        <Dialysis_DB service-role key>
  Authorization: Bearer <Dialysis_DB service-role key>
  Content-Type:  application/json
  Prefer:        resolution=merge-duplicates,return=minimal
Body (a JSON array — one batched call):
  [
    { "sf_contact_id":"…","first_name":"…","last_name":"…",
      "email":"…","phone":"…","sf_account_id":"…" }
  ]
```

Never send `id` (surrogate PK, DB-assigned). Upsert keys on `sf_contact_id`;
re-runs are idempotent.

---

## Test the Supabase path WITHOUT Power Automate

Proves the URL / key / upsert work before wiring SF. Inserts one synthetic row,
then removes it.

```powershell
$DIA_KEY = "<Dialysis_DB service-role key>"
$base    = "https://zqzrriwuavgrquhisnoa.supabase.co/rest/v1/salesforce_contacts"

# upsert a throwaway test contact
Invoke-RestMethod -Method Post `
  -Uri "$base?on_conflict=sf_contact_id" `
  -Headers @{
    apikey        = $DIA_KEY
    Authorization = "Bearer $DIA_KEY"
    "Content-Type"= "application/json"
    Prefer        = "resolution=merge-duplicates,return=minimal"
  } `
  -Body (@(@{
    sf_contact_id = "0038W_TEST_PROBE"
    first_name    = "Probe"; last_name = "Tester"
    email = "probe@example.com"; phone = "(555) 555-0000"
    sf_account_id = $null
  }) | ConvertTo-Json)

# clean it up
Invoke-RestMethod -Method Delete `
  -Uri "$base?sf_contact_id=eq.0038W_TEST_PROBE" `
  -Headers @{ apikey = $DIA_KEY; Authorization = "Bearer $DIA_KEY" }
```

A 2xx with empty body on the POST = the path works.

---

## Acceptance (run on dia `zqzrriwuavgrquhisnoa`, after Flow 6 runs)

```sql
SELECT count(*) FROM salesforce_contacts
WHERE sf_contact_id IN (
  '0038W00002PR97EQAT','0038W00002PREhcQAH','0038W00002PREhYQAX','0038W00002PREhzQAH',
  '0038W00002PREhZQAX','0038W00002PREiaQAH','0038W00002PREidQAH','0038W00002PREiUQAX',
  '0038W00002PREixQAH','0038W00002PREizQAH','0038W00002PREjfQAH','0038W00002PREjiQAH',
  '0038W00002PREjoQAH','0038W00002PREjsQAH','0038W00002PREjXQAX','0038W00002PREkdQAH',
  '0038W00002RhHhKQAV');
```

Expect **17** (robust set lands ~30). A broker can legitimately be absent if its
SF Contact was deleted/merged — cross-check against the reproduce-the-list query.

---

## Self-maintaining broker list (the endpoint)

Applied live 2026-05-29 to **both** projects:
`v_sjc_broker_contact_ids` — a read-only view over `sf_listing_staging` returning the
distinct `003…` broker Contact Ids (a1s… junction Ids excluded). PA reads it instead
of a hard-coded `IN (…)`, so new brokers are picked up automatically.

```
GET https://zqzrriwuavgrquhisnoa.supabase.co/rest/v1/v_sjc_broker_contact_ids?select=sf_contact_id   (dia, 30 ids)
GET https://scknotsqkcheojiaewwh.supabase.co/rest/v1/v_sjc_broker_contact_ids?select=sf_contact_id   (gov, 29 ids)
Headers: apikey + Authorization: Bearer <that project's service-role key>
```
Repo: `supabase/migrations/{dialysis,government}/20260529280000_*_v_sjc_broker_contact_ids.sql`.

## Government vertical (parity build)

Government-tenanted SJC deals route to `gov.sf_listing_staging`
(`scknotsqkcheojiaewwh`) — 4,984 rows, **29** distinct `003…` brokers, 17 teams — but
gov had **no** `salesforce_contacts` table and **no** `v_sjc_deal_book`. Staged
migration `supabase/migrations/government/20260529290000_gov_sjc_broker_fanout.sql`
(⚠️ **not yet applied** — new table on the locked-down gov DB; apply via the team's
migration process) creates parity: `lcc_safe_numeric/date` helpers, the
`salesforce_contacts` table (RLS-locked, service-role-only), and `v_sjc_deal_book`
(+`broker_name`) + summary. The gov view filter adds the gov-specific
`Sale Deal - Multifamily` record type (verified present, 301 broker-bearing rows).

Run Flow 6 for both verticals — identical Contact SOQL, different broker-Id source and
upsert URL/key (see PA_FLOWS.md → Flow 6 → "Both verticals"). The gov upsert branch
404s until the gov migration above is applied, so apply it first.

## Then: turn on individual-broker attribution

Once contacts resolve, the LCC team applies the staged migration
[`supabase/migrations/dialysis/20260529270000_dia_v_sjc_deal_book_broker_name.sql`](../../supabase/migrations/dialysis/20260529270000_dia_v_sjc_deal_book_broker_name.sql),
which adds `broker_name` to `v_sjc_deal_book` (LEFT-resolves
`listing_broker_sf_id → salesforce_contacts.sf_contact_id`). It's non-breaking to
apply early — names just fill in as contacts land. Verify:

```sql
SELECT listing_broker_sf_id, broker_name, count(*)
FROM v_sjc_deal_book
WHERE sjc_team = 'Team Briggs'
GROUP BY 1,2 ORDER BY 3 DESC;
```

### Optional Phase 2 — simpler robust filter
If, after the first sync, the brokers cluster on one `sf_account_id` (the SJC house
account), the dynamic Contact SOQL can collapse to `WHERE AccountId='<house>'` and
the two-pass deal scan dropped:

```sql
SELECT sf_account_id, count(*) FROM salesforce_contacts
WHERE sf_contact_id LIKE '0038W%' GROUP BY 1 ORDER BY 2 DESC;
```
