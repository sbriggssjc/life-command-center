<!-- Converted 2026-09-16 by Cowork from the root file `Power_Automate_Flow_Guide.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**Power Automate Flow Guide**

Salesforce Activities → Supabase Sync

Life Command Center — March 2026

# Overview

This guide walks you through creating a Power Automate flow that syncs your open Salesforce Opportunity activities into Supabase. Once synced, the Life Command Center can display accurate property intelligence by matching Salesforce records directly to your property databases, eliminating fuzzy title matching.

### What This Flow Does

  - Runs on a schedule (every 4 hours) or on-demand

  - Pulls all open Activities from Salesforce where NM Type = "Opportunity"

  - Sends each activity to your Supabase Edge Function via HTTP POST

  - Supabase upserts the data (inserts new, updates existing using sf\_task\_id)

  - Auto-links activities to existing contacts and true owners in your database

# Prerequisites

  - **License:** Power Automate Premium or included license (Salesforce connector requires premium)

  - **Salesforce connection** already configured in Power Automate

  - **Endpoint URL:** https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/activities

  - **Supabase Anon Key** (your Dialysis DB anon key, stored in LCC settings)

### Optional: Sync Secret

You can optionally set a SYNC\_SECRET in your Supabase Edge Function secrets (Dashboard → Edge Functions → ai-copilot → Secrets). If set, include it as a header: x-sync-secret: \<your-secret\>. If not set, the endpoint works without it, protected by the Supabase anon key auth.

# Flow Architecture

The flow has 4 main stages:

| **\#** | **Stage**            | **Description**                                             |
| ------ | -------------------- | ----------------------------------------------------------- |
| **1**  | **Trigger**          | Recurrence schedule (every 4 hours) or manual button        |
| **2**  | **Query Salesforce** | Get open Task records where NM Type = "Opportunity"         |
| **3**  | **Transform Data**   | Map Salesforce fields to Supabase column names using Select |
| **4**  | **POST to Supabase** | Send batch to Edge Function /sync/activities endpoint       |

# Step-by-Step Instructions

## Step 1: Create the Flow

1.  Go to **make.powerautomate.com** and sign in with your Microsoft account.

2.  Click **Create** → **Scheduled cloud flow**.

3.  Name it: **Sync SF Activities to Supabase**

4.  Set the recurrence: **Every 4 hours** (adjust as needed).

5.  Click **Create**.

## Step 2: Query Salesforce Tasks

Add a new step and search for the Salesforce connector. Select "Get records (SOQL query)" or "Get records".

**If using SOQL query, enter:**

> SELECT Id, Subject, Who.FirstName, Who.LastName,
> 
> Who.Email, WhoId, Account.Name, AccountId,
> 
> Account.BillingStreet, Account.BillingCity,
> 
> Account.BillingState, OwnerId, Owner.Name,
> 
> NM\_Type\_\_c, ActivityDate, NM\_Notes\_\_c,
> 
> TaskSubtype, Status
> 
> FROM Task
> 
> WHERE NM\_Type\_\_c = 'Opportunity'
> 
> AND Status \!= 'Completed'
> 
> AND OwnerId = '\<YOUR\_SF\_USER\_ID\>'

### Finding Your Salesforce User ID

In Salesforce, click your profile picture → Settings → check the URL. The ID is the 18-character string starting with 005. Or run this SOQL in Developer Console:

> SELECT Id FROM User WHERE Username = 'sabriggs@northmarq.com'

**If using the "Get records" action (non-SOQL) instead:**

  - **Object type:** Task

  - **Filter query:** NM\_Type\_\_c = 'Opportunity' AND Status \!= 'Completed'

  - **Fields:** Id, Subject, WhoId, AccountId, NM\_Type\_\_c, ActivityDate, NM\_Notes\_\_c, TaskSubtype, Status

## Step 3: Transform with Select Action

This step maps Salesforce field names to the Supabase column names your Edge Function expects.

6.  Add a new step: search for "Select" (under Data Operations).

7.  Set "From" to the value output from the Salesforce step (the array of records).

8.  Switch to Map mode (click the toggle icon on the right side).

9.  Set up the field mapping as shown below:

| **Supabase Key (left side)** | **Salesforce Value (right side)**       |
| ---------------------------- | --------------------------------------- |
| sf\_task\_id                 | Id                                      |
| subject                      | Subject                                 |
| first\_name                  | Who.FirstName (or Who/FirstName)        |
| last\_name                   | Who.LastName (or Who/LastName)          |
| sf\_contact\_id              | WhoId                                   |
| company\_name                | Account.Name (or Account/Name)          |
| sf\_company\_id              | AccountId                               |
| company\_address             | Account.BillingStreet                   |
| company\_city\_state         | concat(BillingCity, ', ', BillingState) |
| assigned\_to                 | Owner.Name (or Owner/Name)              |
| nm\_type                     | NM\_Type\_\_c                           |
| activity\_date               | ActivityDate                            |
| nm\_notes                    | NM\_Notes\_\_c                          |
| task\_subtype                | TaskSubtype                             |
| email                        | Who.Email (or Who/Email)                |
| status                       | Status                                  |

### Note on Related Object Fields

Power Automate may show related fields as Who/FirstName or Account/Name (with slashes). If dot notation doesn't work, try slash notation or use the dynamic content picker.

**For company\_city\_state, you may need a Compose action:**

> concat(items('Apply\_to\_each')?\['Account'\]?\['BillingCity'\],
> 
> ', ', items('Apply\_to\_each')?\['Account'\]?\['BillingState'\])

## Step 4: POST to Supabase Edge Function

10. Add a new step: search for "HTTP" (premium connector).

11. Configure the HTTP action as follows:

| **Method** | POST                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| **URI**    | https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/activities |

**Headers:**

> Content-Type: application/json
> 
> Authorization: Bearer \<YOUR\_DIALYSIS\_DB\_ANON\_KEY\>
> 
> apikey: \<YOUR\_DIALYSIS\_DB\_ANON\_KEY\>

**Body:**

> {
> 
> "activities": @{body('Select')}
> 
> }

The body wraps the Select output (your mapped array) in an "activities" key. The Edge Function accepts batches and upserts them using the sf\_task\_id unique constraint.

## Step 5: Test and Verify

12. Click **Save**, then click **Test** → **Manually** → **Run flow**.

13. Check the flow run history. Each step should show a green checkmark.

14. Verify the HTTP response shows: **{ "success": true, "upserted": \<count\> }**

15. Check Supabase: Dashboard → Table Editor → salesforce\_activities. You should see your synced records.

# Troubleshooting

| **Error**                          | **Solution**                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 401 Unauthorized                   | Check that both Authorization (Bearer \<key\>) and apikey headers use your correct Supabase anon key.                          |
| Unauthorized — invalid sync secret | Your SYNC\_SECRET header doesn't match. Either remove the secret from Supabase or fix the header value.                        |
| No activities provided             | The Select output is empty or body format is wrong. Check SOQL returns results and body is { "activities": @{body('Select')} } |
| missing sf\_task\_id               | The Salesforce Id field isn't mapping correctly. Ensure sf\_task\_id maps to the Salesforce record Id.                         |
| Related fields are null            | Who.FirstName may not be available if WhoId is a Lead. Add null-safe expressions or condition checks.                          |
| Timeout on large batches           | The endpoint processes 50 records at a time. For 500+ activities, add a LastModifiedDate filter.                               |

# What Happens After Sync

Once your Salesforce activities are in Supabase, the Life Command Center gains several advantages:

  - **Direct property matching:** Instead of fuzzy title matching, LCC can use sf\_company\_id and sf\_contact\_id to link activities to the exact properties and contacts in your databases.

  - **Activity history:** The Pre-Call Briefing panel can show past touchpoints, call notes, and engagement history for each prospect.

  - **Auto-linking:** The Edge Function automatically links activities to existing contacts and true owners when sf\_contact\_id or sf\_company\_id matches.

  - **AI context:** The Claude copilot sidebar can reference your actual Salesforce notes when giving pre-call advice.

# Future Enhancements

Once this sync is working, we can build on it:

  - **Incremental sync:** Add a LastModifiedDate filter so only recently changed activities sync, reducing API calls.

  - **Completed activity sync:** Extend the SOQL to also pull completed tasks (calls, emails) for full engagement history.

  - **Bi-directional sync:** Use Power Automate to write call logs back to Salesforce from LCC.

  - **Email history:** A separate flow to sync email activity from Outlook/Salesforce for full communication timeline.

  - **Real-time triggers:** Replace scheduled sync with a Salesforce trigger that fires on task create/update for near-instant sync.

*Generated for Scott Briggs — Northmarq*
