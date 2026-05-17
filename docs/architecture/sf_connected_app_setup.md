# Salesforce Connected App Setup — Server-Side File Fetch

**Goal:** Stand up a Connected App in NorthMarq's Salesforce org so the LCC `intake-salesforce-files` edge function can authenticate via OAuth 2.0 **Client Credentials Flow** and pull file bytes server-side. This collapses Flow 6 from "5 PA inner actions per file" → "1 server call drains all discovered rows."

This is the Anthropic-recommended path because:
- Client Credentials Flow bypasses the SSO gateway that blocked the username/password flow
- The edge function already has all the code (`?action=fetch` is deployed v6 ACTIVE)
- Power Automate's job collapses to just discovery + manifest POST — no more brittle expression-writing per file

## Prerequisite

You'll need Salesforce admin rights to create a Connected App. If your account is read-only in Setup, ping your SF admin to do the setup steps below and just hand back the Consumer Key + Consumer Secret.

## Step 1 — Create the Connected App

1. In Salesforce, click the gear icon (top right) → **Setup**.
2. In the Setup quick-find box, type `App Manager`, then click **App Manager** under Apps.
3. Click **New Connected App** (top right).
4. Choose **Create a Connected App** in the dialog (NOT "Create an External Client App").
5. Fill the Basic Information section:
   - **Connected App Name:** `LCC File Backfill`
   - **API Name:** `LCC_File_Backfill` (auto-fills)
   - **Contact Email:** `sbriggssjc@gmail.com`
6. In the API (Enable OAuth Settings) section, check **Enable OAuth Settings**.
   - **Callback URL:** `https://login.salesforce.com/services/oauth2/success` (placeholder — Client Credentials Flow doesn't actually use it)
   - **Selected OAuth Scopes:** Add these two:
     - `Manage user data via APIs (api)`
     - `Perform requests on your behalf at any time (refresh_token, offline_access)`
   - **Enable Client Credentials Flow:** check this box (toward the bottom of the OAuth section)
   - Leave everything else default.
7. Click **Save**, then **Continue** on the warning page about waiting 2-10 minutes for changes to propagate.

## Step 2 — Configure the run-as user

1. Back in App Manager, find your new "LCC File Backfill" app, click its row's down-arrow → **Manage**.
2. Click **Edit Policies** at the top.
3. Scroll to the **Client Credentials Flow** section.
4. In the **Run As** field, pick an integration user. The integration user needs:
   - API Enabled permission
   - Read access to `ContentVersion`, `ContentDocument`, `ContentDocumentLink`
   - Read access to `Comp__c`, `Property__c`, `Listing__c`, `Opportunity` (whatever object types you want to backfill from)
   - **Recommended:** Use a dedicated integration license user. If you don't have one, an admin user works for testing but should be replaced with a dedicated integration user for production.
5. **Save**.

## Step 3 — Capture credentials

1. Still in the LCC File Backfill app's Manage view, click **View** (or scroll to **API (Enable OAuth Settings)**).
2. Click **Manage Consumer Details** (small link near top). SF will email you a verification code; enter it.
3. Copy and paste these to a temporary scratchpad (DON'T commit to git):
   - **Consumer Key** → this is `SF_CLIENT_ID`
   - **Consumer Secret** → this is `SF_CLIENT_SECRET`

## Step 4 — Identify your instance URL

NorthMarq's My Domain URL is the instance URL. Open any Salesforce record and look at the URL bar — it'll be like:

```
https://northmarqcapital.lightning.force.com/...
```

The instance URL (for API calls) is the `.my.salesforce.com` form. Either:
- `https://northmarqcapital.my.salesforce.com`
- or whatever `Setup → Company Settings → My Domain` shows as the "Current My Domain URL"

This is `SF_INSTANCE_URL`.

## Step 5 — Wire secrets into the edge function

Once you have the three values, hand them to me in chat (or paste them yourself into Supabase Dashboard → Settings → Edge Functions → secrets) and I'll deploy + smoke-test:

```
SF_INSTANCE_URL=https://northmarqcapital.my.salesforce.com
SF_CLIENT_ID=<from Step 3>
SF_CLIENT_SECRET=<from Step 3>
```

After secrets are set, the smoke test is one curl:

```
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-PA-Webhook-Secret: <PA_WEBHOOK_SECRET>" \
  -d '{"vertical":"dia","limit":2}' \
  "https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-salesforce-files?action=fetch"
```

Expected response shape (per-vertical stats):

```json
{
  "ok": true,
  "mode": "server-side fetch",
  "by_vertical": {
    "dia": { "discovered": 2, "stored": 2, "failed": 0, "skipped": 0, "errors": [] }
  }
}
```

And `sf_files` for both rows flips from `ingestion_status:"discovered"` → `"stored"`, with `storage_path` set and `extraction_status:"queued"`.

## What this unblocks

- Two pending OMs (`file_id:5,6` from the Jurupa Valley DaVita Comp) land in `salesforce-files` bucket
- All future Flow 6 manifest runs auto-fetch their bytes via a cron-triggered `?action=fetch` call (separate scheduled flow, ~5 min to build)
- No more PA inner-action complexity for byte movement
- Path generalizes cleanly to gov vertical (gov DB has the same edge function + schema)

## Failure modes worth knowing

- **OAUTH_APP_BLOCKED:** SF org may require the org admin to approve the app before Client Credentials Flow works. Setup → Manage Connected Apps → find LCC File Backfill → set "OAuth policies" → "Permitted Users" to `Admin approved users are pre-authorized`, then add a profile/permission set that includes your integration user.
- **invalid_grant:** Usually means the run-as user lacks API access. Verify Profile → Administrative Permissions → API Enabled is checked.
- **Object not accessible:** Run-as user lacks read perms on `ContentVersion` (or whichever object). Check object-level security on the run-as user's profile/permission set.
