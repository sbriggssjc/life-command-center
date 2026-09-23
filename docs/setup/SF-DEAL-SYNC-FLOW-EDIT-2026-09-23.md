# SF Deal → LCC Opportunity Sync: the one edit that brings deal addresses + created dates (SF-BRIDGE1-flow)

Read from Scott's export `SFDeal→LCCOpportunitySync_20260923192426.zip` (2026-09-23, flow id `eb1181ba-7b33-482d-bf12-62f4243162fc`). The export is kept in the gitignored `private/power-automate/exports-2026-09-23/`, because it carries the LCC ingest bearer token. Never commit it.

## What the flow does today (from `definition.json`)

1. **Recurrence** every 30 min (since 2026-07-27 15:00 UTC).
2. **Get records** (Salesforce connector, `GetItems`) on `Opportunity`:
   - `$filter`: `RecordTypeId` in the 6 Team Briggs record types;
   - `$select`: `Id, Name, StageName, Amount, CloseDate, OwnerId, RecordTypeId`.
3. **HTTP** POST to `https://tranquil-delight-production-633f.up.railway.app/api/pipeline/ingest-opportunities`, with body `{"deals": <Get_records body/value>}`.

It never selects the related Property's address fields, `CreatedDate`, or `RecordType.Name`. LCC already reads all three if they arrive (`mcp/opportunity-sync.js` → `normalizeDeal` / `dealAddress`, which accepts the nested `Property2__r` shape). That's why 31 of 43 open deals have no address.

## The edit (about 5 minutes)

The standard **Get records** action can't pull fields from a related object. Replace it with **Execute a SOQL query**, from the same Salesforce connector and connection.

1. Open the flow → **Edit**. Above **Get records**, click **+** → **Salesforce** → **Execute a SOQL query**, and rename the new action `Get_deals_soql`.
2. Paste this query **exactly as one line**. Copy only the text inside the grey box: no backticks, and **not the word `sql`**. (Scott's first test on 2026-09-23 failed with `unexpected token: 'sql'` because the code-block language tag was pasted in front of `SELECT`.)
   ```text
   SELECT Id, Name, StageName, Amount, CloseDate, OwnerId, RecordTypeId, RecordType.Name, CreatedDate, Property2__c, Property2__r.Street__c, Property2__r.City__c, Property2__r.State_Province__c, Property2__r.Zip_Code__c FROM Opportunity WHERE RecordTypeId IN ('0128W0000007XGKQA2','0121I000000NnKgQAK','0128W000000ibTiQAI','0128W000000ibTlQAI','0128W000000ibTjQAI','0128W000000ibTkQAI')
   ```
   The query box must start with `SELECT`. If the run still fails, open the failed step's **Show raw inputs** and check that `queryParameters/query` starts with `SELECT`.
3. In the **HTTP** action, replace the **Body** with an expression. The records sit under `body/records`, **not** `body`:
   - Clear the Body box, click **fx** (Insert expression), and paste this, **without a leading `@`**:
     ```text
     json(concat('{"deals":', string(outputs('Get_deals_soql')?['body/records']), '}'))
     ```
   - ⚠️ Scott's second test (2026-09-23) failed at HTTP with **BadRequest**, and the run's input showed `deals.totalSize = 608`. The body had sent the whole SOQL result object (`{totalSize, done, records}`) as `deals`, and LCC's endpoint returns 400 `expected { deals: [ ... ] }` for anything that isn't an array. In the failed run's HTTP input, `deals` must be a **list** of records, not an object with `totalSize`.
   - `Get_deals_soql` is the action's internal name: the display name "Get deals soql" with spaces turned into underscores. If you named the action differently, use that name.
4. Delete the old **Get records** action. Nothing else references it.
5. **Save**, then **Test → Manually**. Check that the run's HTTP step returns 200.

**If step 2 errors on `Property2__c`:** the Opportunity → Property lookup has a different API name in our org, or field-level security hides it. In Salesforce, open **Setup → Object Manager → Opportunity → Fields & Relationships**, find the lookup to the Property object, and replace `Property2__` with its API name (keep the `__c` / `__r` endings). Then tell Cowork the name, so LCC's `dealAddress` can be matched to it.

## After the next 30-minute run, Cowork checks

- Open `bd_opportunities` with a `property_address`: 12 of 43 before the edit, so it should be well above 12 after.
- `CreatedDate` → `opened_at` only fills once the LCC side maps it. `normalizeDeal` doesn't read `CreatedDate` today, so that's filed as a small follow-up in `SF-BRIDGE1-flow`.
