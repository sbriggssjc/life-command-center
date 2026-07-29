# RCM Lead Email Parsing — Claude Code Prompt

## Context

A Power Automate flow is now live that watches `Inbox/Property marketing/RCM` in Outlook. When an RCM (Real Capital Markets) email notification arrives, the flow:

1. Converts the HTML email body to plain text
2. POSTs to `https://life-command-center-nine.vercel.app/api/dia-query` with:
```json
{
  "table": "marketing_leads",
  "body": {
    "source": "rcm",
    "source_ref": "<email message ID>",
    "deal_name": "<email subject line>",
    "raw_body": "<plain text email body>",
    "status": "new"
  }
}
```

The flow sends the **raw email body** — no client-side parsing. The server needs to extract structured contact data from the raw text before inserting into `marketing_leads`.

## What needs to be built

### 1. Server-side RCM email parser

Add a new handler in `api/sync.js` (or a new `api/rcm-ingest.js` endpoint) that:

1. Receives the POST from Power Automate with `source`, `source_ref`, `deal_name`, `raw_body`, `status`
2. Parses the `raw_body` to extract structured contact fields
3. Inserts into `marketing_leads` with the parsed fields
4. Returns success/error

### 2. Parsing logic

RCM notification emails have a semi-structured format. The parser should extract:

- **Contact name** — look for patterns: `Name:`, `Contact:`, `Requestor:`, `From:` followed by a name
- **Email** — look for `Email:`, `E-mail:`, or extract any email pattern (regex: `[\w.+-]+@[\w-]+\.[\w.]+`)
- **Phone** — look for `Phone:`, `Tel:`, `Mobile:` or extract phone patterns (regex: `\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`)
- **Company** — look for `Company:`, `Firm:`, `Organization:`, `Affiliation:`
- **Inquiry type** — look for `Request Type:`, `Inquiry:`, `Action:` (e.g., "CA Request", "Request for Information", "Offer")
- **Property reference** — already in `deal_name` from the email subject, but also check body for `Property:`, `Listing:`, `Asset:`

**Parsing approach:**
```javascript
function parseRcmEmail(rawBody, subject) {
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

  // Extract by label
  const name = extractAfterLabel(['Name:', 'Contact:', 'Requestor:', 'Full Name:']);
  const company = extractAfterLabel(['Company:', 'Firm:', 'Organization:', 'Affiliation:']);
  const inquiryType = extractAfterLabel(['Request Type:', 'Inquiry:', 'Action:', 'Type:']);

  // Extract email via regex (more reliable than labels)
  const emailMatch = rawBody.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const email = emailMatch ? emailMatch[0] : null;

  // Extract phone via regex
  const phoneMatch = rawBody.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : null;

  // Split name into first/last
  let firstName = null, lastName = null;
  if (name) {
    const parts = name.split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(' ') || null;
  }

  return {
    lead_name: name,
    lead_first_name: firstName,
    lead_last_name: lastName,
    lead_email: email,
    lead_phone: phone,
    lead_company: company,
    deal_name: subject || null,
    activity_type: inquiryType || 'rcm_inquiry',
    activity_detail: inquiryType
  };
}
```

### 3. Insert into marketing_leads

After parsing, insert into `marketing_leads` via Supabase:

```javascript
const parsed = parseRcmEmail(body.raw_body, body.deal_name);

const insertPayload = {
  source: 'rcm',
  source_ref: body.source_ref,
  lead_name: parsed.lead_name,
  lead_first_name: parsed.lead_first_name,
  lead_last_name: parsed.lead_last_name,
  lead_email: parsed.lead_email,
  lead_phone: parsed.lead_phone,
  lead_company: parsed.lead_company,
  deal_name: parsed.deal_name,
  activity_type: parsed.activity_type,
  activity_detail: parsed.activity_detail,
  status: 'new',
  ingested_at: new Date().toISOString()
};

// Insert via Supabase REST API
const res = await fetch(`${DIA_SUPABASE_URL}/rest/v1/marketing_leads`, {
  method: 'POST',
  headers: {
    'apikey': DIA_SUPABASE_KEY,
    'Authorization': `Bearer ${DIA_SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify(insertPayload)
});
```

### 4. Deduplication

The `marketing_leads` table should have a unique index on `(source, source_ref)` to prevent duplicate inserts if the Power Automate flow fires multiple times for the same email:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_leads_source_ref
ON marketing_leads (source, source_ref)
WHERE source_ref IS NOT NULL;
```

Use `ON CONFLICT DO NOTHING` or check before insert.

### 5. Auto-match to Salesforce

After inserting the lead, attempt to match against Salesforce contacts:

```sql
-- Match by email
SELECT sf_contact_id, first_name, last_name, company_name
FROM salesforce_activities
WHERE email = :lead_email
LIMIT 1;
```

If matched, update the lead with `sf_contact_id` and `sf_match_status = 'matched'`.

### 6. Update the Power Automate flow endpoint

The current Power Automate flow POSTs to `/api/dia-query` which does a raw table insert. For proper parsing, either:

**Option A:** Add parsing logic inside `data-proxy.js` when `table = 'marketing_leads'` and `source = 'rcm'`

**Option B (recommended):** Create a dedicated endpoint `/api/rcm-ingest` that handles parsing + insert + SF matching. Update the Power Automate flow's HTTP action URL from `/api/dia-query` to `/api/rcm-ingest`.

Add to `vercel.json` rewrites if needed:
```json
{ "source": "/api/rcm-ingest", "destination": "/api/sync?_route=rcm-ingest" }
```

### 7. Frontend: RCM leads in Marketing tab

RCM leads should appear in the Marketing tab under the "RCM" source filter pill (already exists in the UI). The `loadMarketing` function already queries `marketing_leads` — once leads are inserted, they'll show up automatically.

To make them more useful, show parsed fields on the card:
- Lead name, company, email, phone
- Deal name (from email subject — this is the property they inquired about)
- Inquiry type (CA Request, Info Request, etc.)
- "RCM" badge

## Files to modify

| File | Change |
|------|--------|
| `api/sync.js` | Add RCM ingest route with email parsing logic |
| `vercel.json` | Add `/api/rcm-ingest` rewrite (if using dedicated endpoint) |
| `sql/` | Add unique index on marketing_leads (source, source_ref) |

## Testing

1. Forward an RCM notification email to the `Inbox/Property marketing/RCM` folder
2. Check Power Automate run history for success
3. Query `SELECT * FROM marketing_leads WHERE source = 'rcm' ORDER BY ingested_at DESC LIMIT 5` to verify the parsed data
4. Check the Marketing tab in LCC — RCM leads should appear under the RCM filter pill

## Sample RCM email patterns to handle

The parser should be resilient to these common variations:

```
Pattern 1: Label-value on same line
Name: John Smith
Email: jsmith@example.com
Phone: (555) 123-4567
Company: ABC Realty Group

Pattern 2: Label-value with colons and extra whitespace
Contact:   Jane Doe
E-mail:    jane@investment.com
Tel:       555-987-6543
Firm:      XYZ Capital Partners

Pattern 3: Inline text with extractable data
John Smith from ABC Realty (jsmith@example.com, 555-123-4567) has requested...

Pattern 4: HTML remnants in plain text conversion
Name John Smith Email jsmith@example.com Phone (555) 123-4567
```

The regex-based extraction (for email and phone) handles all patterns. The label-based extraction covers Patterns 1 and 2. Pattern 3 falls back to regex. Pattern 4 also falls back to regex.
