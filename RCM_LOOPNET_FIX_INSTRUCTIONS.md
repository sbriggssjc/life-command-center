# RCM & LoopNet Lead Ingestion — Fix & Build Instructions

## Diagnosis: Why RCM Leads Aren't Landing

**Evidence:**
- `marketing_leads` table: **0 rows** (table exists with correct schema, all indexes in place)
- Vercel runtime logs for `/api/rcm-ingest`: **0 hits** in the past 7 days
- The code path, parsing logic, SF matching, and CRM task creation in `api/sync.js` lines 1084-1349 are all correct

**Root cause — two issues, both must be fixed:**

### Issue A: Auth wall blocks Power Automate webhook

`handleRcmIngest()` at line 1134 calls `authenticate(req, res)` which walks this decision tree:

1. Check for `Authorization: Bearer <jwt>` header → PA sends none → skip
2. Check for `X-LCC-Key` header → PA sends none → skip
3. If `LCC_API_KEY` env var is **not set** → transitional mode → auth passes ✅
4. If `LCC_API_KEY` env var **is set** → returns 401 ❌

**If `LCC_API_KEY` is configured in Vercel**, every PA webhook gets a silent 401. Even if it's not set today, it will break the moment you enable real auth.

**Fix:** The RCM ingest (and future LoopNet ingest) endpoints are **webhooks from Power Automate**, not user-facing API calls. They should bypass user auth entirely and instead validate using a shared webhook secret.

### Issue B: No RCM emails may have arrived

It's possible the PA flow is correctly pointing at `/api/rcm-ingest` but simply no new RCM notification emails have landed in `Inbox/Property marketing/RCM` since March 23. This is hard to verify without checking the PA flow run history. The auth fix + test endpoint below will let you confirm independently.

---

## Fix 1: Add Webhook Auth Bypass for PA Endpoints

**File:** `api/sync.js`

**What to change:** Before the `authenticate()` call in `handleRcmIngest()`, add a webhook secret check that bypasses user auth. Do the same for the new LoopNet handler.

### Step 1: Add webhook secret env var

Add a new Vercel environment variable:
```
PA_WEBHOOK_SECRET=<generate a random 32+ char string>
```

This same secret must be added as a header in the Power Automate HTTP actions for both RCM and LoopNet flows.

### Step 2: Create a shared webhook auth helper

At the top of `api/sync.js` (after the existing imports, around line 16), add:

```javascript
// Webhook secret for Power Automate ingestion endpoints (RCM, LoopNet, etc.)
// Bypasses user auth — PA flows send this in X-PA-Webhook-Secret header
const PA_WEBHOOK_SECRET = process.env.PA_WEBHOOK_SECRET;

function authenticateWebhook(req) {
  // If no webhook secret is configured, allow all requests (transitional)
  if (!PA_WEBHOOK_SECRET) return true;
  const provided = req.headers['x-pa-webhook-secret'] || '';
  if (!provided || provided.length !== PA_WEBHOOK_SECRET.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}
```

### Step 3: Update `handleRcmIngest` to use webhook auth

Replace lines 1129-1140 of `handleRcmIngest`:

**BEFORE:**
```javascript
async function handleRcmIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const user = await authenticate(req, res);
  if (!user) return;

  const ws = primaryWorkspace(user);
  if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
    return res.status(403).json({ error: 'Operator role required' });
  }
```

**AFTER:**
```javascript
async function handleRcmIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Webhook endpoints accept PA_WEBHOOK_SECRET instead of user auth
  if (!authenticateWebhook(req)) {
    // Fall back to standard user auth (allows browser-based testing)
    const user = await authenticate(req, res);
    if (!user) return;
    const ws = primaryWorkspace(user);
    if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
  }
```

This means: if the PA webhook secret header is present and valid, skip user auth. If not, fall back to normal auth (so the endpoint still works from the browser/dev tools).

### Step 4: Same pattern for `handleRcmBackfill`

Apply the identical webhook auth bypass to `handleRcmBackfill()` at line 1357.

---

## Fix 2: Add a Test/Health Endpoint for Lead Ingestion

**File:** `api/sync.js`

Add a new route in the main handler (around line 71, after the rcm-backfill dispatch):

```javascript
  // Dispatch to lead ingest test/health check
  if (req.query._route === 'lead-health') {
    return handleLeadHealth(req, res);
  }
```

Add a rewrite in `vercel.json`:
```json
{ "source": "/api/lead-health", "destination": "/api/sync?_route=lead-health" }
```

Add the handler function (after `handleRcmBackfill`):

```javascript
async function handleLeadHealth(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const checks = {
    dia_configured: !!(DIA_SUPABASE_URL && DIA_SUPABASE_KEY),
    webhook_secret_configured: !!PA_WEBHOOK_SECRET,
    timestamp: new Date().toISOString()
  };

  // Check marketing_leads table access
  if (checks.dia_configured) {
    try {
      const countRes = await fetch(
        `${DIA_SUPABASE_URL}/rest/v1/marketing_leads?select=lead_id&limit=1`,
        { headers: { 'apikey': DIA_SUPABASE_KEY, 'Authorization': `Bearer ${DIA_SUPABASE_KEY}` } }
      );
      checks.marketing_leads_accessible = countRes.ok;
      if (!countRes.ok) checks.marketing_leads_error = await countRes.text();
    } catch (e) {
      checks.marketing_leads_accessible = false;
      checks.marketing_leads_error = e.message;
    }
  }

  return res.status(200).json(checks);
}
```

After deploying, hit `https://life-command-center-nine.vercel.app/api/lead-health` to verify the pipeline is wired up.

---

## Fix 3: Build LoopNet Lead Ingestion

LoopNet inquiry emails follow a similar pattern to RCM but with different labels. The handler mirrors the RCM flow with a LoopNet-specific parser.

### Step 3a: Add route dispatch

In `api/sync.js` main handler, add after the rcm-backfill dispatch (around line 70):

```javascript
  // Dispatch to LoopNet ingest
  if (req.query._route === 'loopnet-ingest') {
    return handleLoopNetIngest(req, res);
  }
```

### Step 3b: Add Vercel rewrite

In `vercel.json`, add alongside the rcm-ingest rewrite:

```json
{ "source": "/api/loopnet-ingest", "destination": "/api/sync?_route=loopnet-ingest" }
```

### Step 3c: Add the LoopNet email parser

Add this after `parseRcmEmail` (around line 1127):

```javascript
// ============================================================================
// LoopNet Email Parser
// LoopNet inquiry notifications typically contain:
//   - Property name in subject or "Listing:" / "Property:" label
//   - Contact info with Name/Email/Phone/Company labels
//   - Sometimes a free-form "Message:" section
//   - Various formats: structured labels, inline text, HTML-converted plaintext
// ============================================================================

function parseLoopNetEmail(rawBody, subject) {
  const lines = rawBody.split('\n').map(l => l.trim()).filter(Boolean);

  function extractAfterLabel(labels) {
    for (const label of labels) {
      for (const line of lines) {
        if (line.toLowerCase().startsWith(label.toLowerCase())) {
          return line.substring(label.length).trim().replace(/^[:\s]+/, '');
        }
      }
    }
    return null;
  }

  // LoopNet uses various label formats depending on the notification type
  const name = extractAfterLabel([
    'Name:', 'Full Name:', 'Contact Name:', 'From:', 'Sender:',
    'Inquirer:', 'Prospect Name:', 'Buyer Name:'
  ]);

  const company = extractAfterLabel([
    'Company:', 'Firm:', 'Organization:', 'Brokerage:', 'Company Name:',
    'Buyer Company:', 'Investor Group:'
  ]);

  const inquiryType = extractAfterLabel([
    'Inquiry Type:', 'Request Type:', 'Type:', 'Action:', 'Interest:',
    'Lead Type:', 'Inquiry About:'
  ]);

  const propertyRef = extractAfterLabel([
    'Property:', 'Listing:', 'Property Name:', 'Property Address:',
    'Listing Name:', 'Asset:', 'Subject Property:'
  ]);

  const message = extractAfterLabel([
    'Message:', 'Comments:', 'Notes:', 'Additional Info:', 'Inquiry Message:'
  ]);

  // Extract email — LoopNet sometimes wraps in angle brackets or markdown links
  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  // Extract phone — US format with optional extension
  const phoneMatch = rawBody.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(\s*(x|ext\.?|extension)\s*\d+)?/i);
  const phone = phoneMatch ? phoneMatch[0] : null;

  // Extract listing ID if present (LoopNet numeric IDs)
  const listingIdMatch = rawBody.match(/(?:Listing\s*(?:ID|#|Number)[:\s]*)([\d]+)/i);
  const listingId = listingIdMatch ? listingIdMatch[1] : null;

  // Split name into first/last
  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  // Deal name: prefer subject line, fall back to property ref from body
  let dealName = subject || propertyRef || null;
  // Strip common LoopNet subject prefixes
  if (dealName) {
    dealName = dealName
      .replace(/^(New\s+)?LoopNet\s+(Inquiry|Lead|Request)\s*[-:–]\s*/i, '')
      .replace(/^(RE|FW|Fwd):\s*/i, '')
      .trim();
  }

  return {
    lead_name: name,
    lead_first_name: firstName,
    lead_last_name: lastName,
    lead_email: email,
    lead_phone: phone,
    lead_company: company,
    deal_name: dealName,
    listing_id: listingId,
    activity_type: inquiryType || 'loopnet_inquiry',
    activity_detail: message || inquiryType || null
  };
}
```

### Step 3d: Add the LoopNet ingest handler

Add this after `handleRcmBackfill` (or wherever convenient):

```javascript
// ============================================================================
// LOOPNET INGEST — Parses LoopNet inquiry emails into marketing_leads
// POST /api/loopnet-ingest
// ============================================================================

async function handleLoopNetIngest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Webhook auth (same as RCM)
  if (!authenticateWebhook(req)) {
    const user = await authenticate(req, res);
    if (!user) return;
    const ws = primaryWorkspace(user);
    if (!ws || !requireRole(user, 'operator', ws.workspace_id)) {
      return res.status(403).json({ error: 'Operator role required' });
    }
  }

  if (!DIA_SUPABASE_URL || !DIA_SUPABASE_KEY) {
    return res.status(500).json({ error: 'DIA Supabase not configured' });
  }

  const { source_ref, deal_name, raw_body, status } = req.body || {};

  if (!raw_body) {
    return res.status(400).json({ error: 'raw_body is required' });
  }

  const parsed = parseLoopNetEmail(raw_body, deal_name);

  const insertPayload = {
    source: 'loopnet',
    source_ref: source_ref || null,
    lead_name: parsed.lead_name,
    lead_first_name: parsed.lead_first_name,
    lead_last_name: parsed.lead_last_name,
    lead_email: parsed.lead_email,
    lead_phone: parsed.lead_phone,
    lead_company: parsed.lead_company,
    deal_name: parsed.deal_name,
    listing_id: parsed.listing_id,
    activity_type: parsed.activity_type,
    activity_detail: parsed.activity_detail,
    notes: raw_body,
    status: status || 'new',
    ingested_at: new Date().toISOString()
  };

  try {
    const insertUrl = `${DIA_SUPABASE_URL}/rest/v1/marketing_leads`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': DIA_SUPABASE_KEY,
        'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation,resolution=ignore-duplicates'
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(insertRes.status).json({
        error: 'Failed to insert marketing lead',
        detail: errText
      });
    }

    const inserted = await insertRes.json();
    const lead = Array.isArray(inserted) ? inserted[0] : inserted;

    if (!lead || !lead.lead_id) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        message: 'Lead already exists (duplicate source_ref)',
        source_ref
      });
    }

    // Auto-match to Salesforce by email (same logic as RCM)
    let sfMatch = null;
    if (parsed.lead_email) {
      try {
        const sfUrl = new URL(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`);
        sfUrl.searchParams.set('select', 'sf_contact_id,sf_company_id,first_name,last_name,company_name,assigned_to');
        sfUrl.searchParams.set('email', `eq.${parsed.lead_email}`);
        sfUrl.searchParams.set('limit', '1');

        const sfRes = await fetch(sfUrl.toString(), {
          headers: {
            'apikey': DIA_SUPABASE_KEY,
            'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        if (sfRes.ok) {
          const sfData = await sfRes.json();
          if (Array.isArray(sfData) && sfData.length > 0 && sfData[0].sf_contact_id) {
            sfMatch = sfData[0];

            await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
              method: 'PATCH',
              headers: {
                'apikey': DIA_SUPABASE_KEY,
                'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                sf_contact_id: sfMatch.sf_contact_id,
                sf_match_status: 'matched'
              })
            });
          }
        }
      } catch (sfErr) {
        console.error('SF match attempt failed:', sfErr.message);
      }
    }

    // Create salesforce_activities task so lead appears in CRM hub
    let sfActivityId = null;
    try {
      const contactId = sfMatch ? sfMatch.sf_contact_id : `loopnet-lead-${lead.lead_id}`;
      const taskSubject = parsed.deal_name
        ? `LoopNet: ${parsed.deal_name}`
        : `LoopNet Inquiry – ${parsed.lead_name || parsed.lead_email || 'New Lead'}`;
      const noteSnippet = parsed.activity_detail
        || (raw_body || '').substring(0, 300) + ((raw_body || '').length > 300 ? '…' : '');

      const sfActivityPayload = {
        subject: taskSubject,
        first_name: sfMatch?.first_name || parsed.lead_first_name || null,
        last_name: sfMatch?.last_name || parsed.lead_last_name || null,
        company_name: sfMatch?.company_name || parsed.lead_company || null,
        email: parsed.lead_email,
        phone: parsed.lead_phone,
        sf_contact_id: contactId,
        sf_company_id: sfMatch?.sf_company_id || null,
        nm_type: 'Task',
        task_subtype: 'Task',
        status: 'Open',
        activity_date: new Date().toISOString().split('T')[0],
        nm_notes: noteSnippet,
        assigned_to: sfMatch?.assigned_to || 'Unassigned',
        source_ref: `loopnet:${source_ref || lead.lead_id}`
      };

      const sfActRes = await fetch(`${DIA_SUPABASE_URL}/rest/v1/salesforce_activities`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation,resolution=ignore-duplicates'
        },
        body: JSON.stringify(sfActivityPayload)
      });

      if (sfActRes.ok) {
        const sfActData = await sfActRes.json();
        const sfAct = Array.isArray(sfActData) ? sfActData[0] : sfActData;
        sfActivityId = sfAct?.activity_id || null;

        if (sfActivityId) {
          await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads?lead_id=eq.${lead.lead_id}`, {
            method: 'PATCH',
            headers: {
              'apikey': DIA_SUPABASE_KEY,
              'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ sf_activity_id: sfActivityId })
          });
        }
      } else {
        console.error('SF activity creation failed:', await sfActRes.text().catch(() => ''));
      }
    } catch (sfActErr) {
      console.error('SF activity creation error:', sfActErr.message);
    }

    // Refresh CRM rollup
    try {
      await fetch(`${DIA_SUPABASE_URL}/rest/v1/rpc/refresh_crm_rollup`, {
        method: 'POST',
        headers: {
          'apikey': DIA_SUPABASE_KEY,
          'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });
    } catch (refreshErr) {
      console.warn('CRM rollup refresh skipped:', refreshErr.message);
    }

    return res.status(201).json({
      ok: true,
      lead_id: lead.lead_id,
      sf_activity_id: sfActivityId,
      parsed: {
        lead_name: parsed.lead_name,
        lead_email: parsed.lead_email,
        lead_phone: parsed.lead_phone,
        lead_company: parsed.lead_company,
        deal_name: parsed.deal_name,
        listing_id: parsed.listing_id,
        activity_type: parsed.activity_type
      },
      sf_match: sfMatch ? {
        sf_contact_id: sfMatch.sf_contact_id,
        name: `${sfMatch.first_name || ''} ${sfMatch.last_name || ''}`.trim()
      } : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
```

### Step 3e: Also add redirect in data-proxy.js

In `api/data-proxy.js`, after the RCM redirect block (around line 176), add a similar LoopNet redirect:

```javascript
    // Redirect LoopNet marketing_leads POSTs to the dedicated loopnet-ingest handler
    if (source === 'dia' && table === 'marketing_leads' && req.method === 'POST'
        && req.body && req.body.source === 'loopnet' && req.body.raw_body) {
      try {
        const { default: syncHandler } = await import('./sync.js');
        req.query._route = 'loopnet-ingest';
        return syncHandler(req, res);
      } catch (importErr) {
        console.error('LoopNet redirect failed, falling back to raw insert:', importErr.message);
      }
    }
```

---

## Fix 4: RLS Policy for marketing_leads

RLS is enabled on `marketing_leads` but the table is empty, which could mean RLS is blocking the service_role inserts (unlikely but worth verifying). Check that `DIA_SUPABASE_KEY` is the **service_role** key, not the anon key.

Run this SQL to verify and add a permissive policy if needed:

```sql
-- Check existing RLS policies
SELECT policyname, permissive, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'marketing_leads';
```

If there are no INSERT policies, add one for the service role:

```sql
-- Allow service_role full access (this is the key the API uses)
CREATE POLICY "service_role_all" ON marketing_leads
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

Or if you want to be more targeted:

```sql
-- Allow inserts from any authenticated role (service_role bypasses RLS anyway,
-- but this also enables anon-key access if needed)
CREATE POLICY "allow_insert_marketing_leads" ON marketing_leads
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "allow_select_marketing_leads" ON marketing_leads
  FOR SELECT
  USING (true);

CREATE POLICY "allow_update_marketing_leads" ON marketing_leads
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
```

---

## Fix 5: Update the Frontend Source Filter

**File:** `app.js` — The LoopNet source filter pill already exists (line 1547):
```javascript
if (srcCounts['loopnet']) html += `<span class="pill ..."...>LoopNet ...`;
```

No frontend changes needed — `loadMarketing()` already fetches from `marketing_leads` with no source filter, and the pill rendering dynamically shows source tabs based on what's in the data.

---

## Power Automate Flow Instructions

### RCM Flow Update (verify existing)

The existing "RCM Email Watcher" flow should already be configured per the `POWER_AUTOMATE_UPDATE_GUIDE.md`. Verify:

1. **Trigger:** "When a new email arrives" → Folder: `Inbox/Property marketing/RCM`
2. **Action 1:** "Html to text" → convert email body
3. **Action 2:** HTTP POST:
   - **URI:** `https://life-command-center-nine.vercel.app/api/rcm-ingest`
   - **Headers:**
     - `Content-Type`: `application/json`
     - `X-PA-Webhook-Secret`: `<the PA_WEBHOOK_SECRET value>`  ← **ADD THIS**
   - **Body:**
     ```json
     {
       "source": "rcm",
       "source_ref": "@{triggerOutputs()?['body/id']}",
       "deal_name": "@{triggerOutputs()?['body/subject']}",
       "raw_body": "@{body('Html_to_text')?['text']}",
       "status": "new"
     }
     ```

### NEW: LoopNet Flow

Create a new Power Automate flow **"LoopNet Email Watcher"** — identical structure to RCM:

1. **Trigger:** "When a new email arrives (V3)"
   - Folder: `Inbox/Property marketing/LoopNet`
   - Include Attachments: No
   - Only with Attachments: No

2. **Action 1:** "Html to text"
   - Content: `@{triggerOutputs()?['body/body']}`

3. **Action 2:** HTTP POST
   - **URI:** `https://life-command-center-nine.vercel.app/api/loopnet-ingest`
   - **Method:** POST
   - **Headers:**
     - `Content-Type`: `application/json`
     - `X-PA-Webhook-Secret`: `<the PA_WEBHOOK_SECRET value>`
   - **Body:**
     ```json
     {
       "source_ref": "@{triggerOutputs()?['body/id']}",
       "deal_name": "@{triggerOutputs()?['body/subject']}",
       "raw_body": "@{body('Html_to_text')?['text']}",
       "status": "new"
     }
     ```

4. **Save and turn on the flow**

---

## Testing Checklist

### 1. Deploy the code changes to Vercel

After making all changes to `api/sync.js`, `api/data-proxy.js`, and `vercel.json`:
- Commit and push
- Verify deployment succeeds on Vercel

### 2. Check lead health endpoint

```
GET https://life-command-center-nine.vercel.app/api/lead-health
```

Expected response:
```json
{
  "dia_configured": true,
  "webhook_secret_configured": true,
  "marketing_leads_accessible": true,
  "timestamp": "2026-03-24T..."
}
```

If `marketing_leads_accessible` is false, the RLS policy or DIA_SUPABASE_KEY is the problem.

### 3. Test RCM ingest manually

```bash
curl -X POST https://life-command-center-nine.vercel.app/api/rcm-ingest \
  -H "Content-Type: application/json" \
  -H "X-PA-Webhook-Secret: <your_secret>" \
  -d '{
    "source": "rcm",
    "source_ref": "test-rcm-001",
    "deal_name": "Test RCM Property - Dallas, TX",
    "raw_body": "Name: John Test\nEmail: jtest@example.com\nPhone: (555) 123-4567\nCompany: Test Realty Group\nRequest Type: CA Request\n\nI am interested in the property listing.",
    "status": "new"
  }'
```

Expected: 201 with `lead_id`, parsed fields, and `sf_match` (null for test data).

### 4. Test LoopNet ingest manually

```bash
curl -X POST https://life-command-center-nine.vercel.app/api/loopnet-ingest \
  -H "Content-Type: application/json" \
  -H "X-PA-Webhook-Secret: <your_secret>" \
  -d '{
    "source_ref": "test-loopnet-001",
    "deal_name": "LoopNet Inquiry - MOB Portfolio - Austin, TX",
    "raw_body": "Name: Jane Investor\nCompany: Capital Partners LLC\nEmail: jinvestor@capitalpartners.com\nPhone: (512) 555-9876\nInquiry Type: Property Tour Request\nProperty: MOB Portfolio - Austin, TX\nMessage: Interested in scheduling a tour of the medical office portfolio.",
    "status": "new"
  }'
```

### 5. Verify in LCC

1. Open `life-command-center-nine.vercel.app`
2. Navigate to Marketing tab
3. Test leads should appear with RCM and LoopNet source badges
4. Check that parsed fields (name, email, phone, company) display correctly

### 6. Clean up test data

```sql
DELETE FROM marketing_leads WHERE source_ref IN ('test-rcm-001', 'test-loopnet-001');
DELETE FROM salesforce_activities WHERE source_ref IN ('rcm:test-rcm-001', 'loopnet:test-loopnet-001');
```

### 7. Forward a real email

Forward a real RCM or LoopNet notification email to the respective inbox folder and check that the PA flow fires and the lead appears in LCC.

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `api/sync.js` | Add `authenticateWebhook()` helper; update `handleRcmIngest` and `handleRcmBackfill` auth; add `parseLoopNetEmail()`; add `handleLoopNetIngest()`; add `handleLeadHealth()` route + handler; add route dispatch for `loopnet-ingest` and `lead-health` |
| `api/data-proxy.js` | Add LoopNet redirect block (mirrors RCM redirect) |
| `vercel.json` | Add rewrites: `/api/loopnet-ingest` and `/api/lead-health` |
| **Vercel env** | Add `PA_WEBHOOK_SECRET` variable |
| **Supabase SQL** | Verify/add RLS policies on `marketing_leads` |
| **Power Automate** | Add `X-PA-Webhook-Secret` header to RCM flow; create new LoopNet flow |
