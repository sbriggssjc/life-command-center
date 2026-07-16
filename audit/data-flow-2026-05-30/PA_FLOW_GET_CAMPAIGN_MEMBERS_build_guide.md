# Power Automate flow — "SF Get Campaign Members" → LCC /api/sf-list-import

Feeds the `/api/sf-list-import` route (PR #1412). Pulls your Salesforce Lists (Campaigns) +
their members (CampaignMembers) and POSTs them to the LCC, per campaign, fully paginated.
Read-only on Salesforce. Once built, set env **`SF_LIST_IMPORT_URL`** = this flow's HTTP-trigger
URL (or, if you POST straight to the LCC route, that route's URL + key).

## STEP 0 — verify the connector can read CampaignMember (2 min, do this first)
In a scratch flow: add **Salesforce → Get records**, Object type **Campaign Member**. If it
lists the object and returns rows, you're good (it's a standard object — it should). If the
managed package blocks it, tell me and we use the proven browser DOM-scrape as the one-time
bulk instead.

## STEP 1 — Trigger
**Recurrence** (e.g. weekly, or daily) — or **Manually trigger a flow** for the first run.
(These lists change slowly; weekly is plenty. The LCC route is idempotent, so re-runs are safe.)

## STEP 2 — Get the campaigns (the list catalog)
**Salesforce → Get records**
- Object type: **Campaign**
- Filter query: `IsActive = true` (optionally also exclude archives:
  `AND (NOT Name LIKE 'z\_%') AND (NOT Name LIKE 'New Name%') AND (NOT Name LIKE 'delete%')`)
- Select query (fields): `Id, Name, ParentId`
- **Pagination: ON**, threshold 100000 (there aren't many campaigns, but leave it on).

This gives every list's Id + Name + ParentId. (The LCC classifies buyer/seller from the
Name — "GSA Buyer", "SAB Seller Prospects" — so a parent lookup isn't required; pass
`parent_name` when you have it, but Name alone works.)

## STEP 3 — For each campaign, pull its members and POST them
**Apply to each** → output = `value` from Step 2.

Inside the loop:

**3a. Salesforce → Get records** (the members of THIS campaign)
- Object type: **Campaign Member**
- Filter query: `CampaignId = '@{items('Apply_to_each')?['Id']}'`
- Select query: `ContactId, LeadId, FirstName, LastName, Email, Phone, City, State,
  CompanyOrAccount, Type, Status, CampaignId`
- **⚠️ Pagination: ON**, threshold **≥ your largest list** (set 50000). This is the whole point —
  without it PA caps at 2,000 rows and silently truncates your big lists.

**3b. HTTP → POST** (to the LCC)
- URI: `@{parameters or the SF_LIST_IMPORT_URL}` (the `/api/sf-list-import` route, or a thin
  passthrough flow's URL)
- Headers: `Content-Type: application/json` + the LCC key header the other flows use
  (`X-LCC-Key`), if the route is called directly.
- Body:
  ```json
  {
    "campaign_id":   "@{items('Apply_to_each')?['Id']}",
    "campaign_name": "@{items('Apply_to_each')?['Name']}",
    "parent_id":     "@{items('Apply_to_each')?['ParentId']}",
    "members":       @{body('Get_records_2')?['value']}
  }
  ```
  (`Get_records_2` = the name of the 3a action. `members` is the raw CampaignMember array —
  the LCC route reads FirstName/LastName/Email/Phone/City/State/CompanyOrAccount/ContactId
  from each.)

That's it — one POST per campaign, each fully paginated. The LCC route reconciles every member
by email (no duplicates), relates them to their company, records the list membership
(product-type / buyer-seller / broker), and routes buyers → the P-BUYER buy-side pool, sellers →
owner-prospect + (when flagged) the institution registry.

## STEP 4 — env + flags
- **`SF_LIST_IMPORT_URL`** — the flow/route URL (required to engage the route).
- **`SF_LIST_SEED_INSTITUTION`** — default OFF. Turn ON when you want seller-list members whose
  company is a contactless registry-gap sponsor to actually SEED `lcc_institution_contacts`
  (which then fans out via Tier A). Off = it records the candidate but doesn't seed. Flip it on
  once we've eyeballed the first seller ingest.

## After it runs — I verify (Cowork)
GET dry-run first, then confirm live: GSA Buyer's 156 resolve by email with no dup persons,
each related to its company org; a large list's ingested count == its Vision GM "of N" total
(pagination working); seller companies matching registry gaps show as registry candidates; and
(with the flag on) the Tier A fan-out attaches a seeded sponsor contact across its SPEs.

## Fallback (if the connector can't read CampaignMember)
Skip the PA flow; I bulk-POST the already-scraped data (the 156 GSA buyers + the seller bucket)
straight to `/api/sf-list-import` per campaign. Slower to maintain (manual re-scrape) but works
today. The PA flow is the durable, self-updating path — prefer it.
