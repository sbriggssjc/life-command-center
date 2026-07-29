# LCC Property Intel Tab — Supabase Backend Changes

Send this to a Claude Code session with access to the Life Command Center repository and the Supabase Dialysis project (`zqzrriwuavgrquhisnoa`).

---

## Context

The LCC frontend now has two new write paths:

1. **Enhanced Ownership Save** — `_udSaveOwnership()` in `detail.js` now creates records in `recorded_owners`, `true_owners`, and `contacts`, then links them to `properties` via `recorded_owner_id` and `true_owner_id`.

2. **New "Intel" tab** — A new detail panel tab that lets users manually enter prior sale data, loan/debt info, cash flow/valuation data, and research notes. Each section writes to a different Supabase table:
   - Prior Sale → INSERT into `sales_transactions`
   - Loan/Debt → INSERT into `loans`
   - Cash Flow → PATCH on `properties` (fields: `last_known_rent`, `current_value_estimate`)
   - Research Notes → INSERT into `research_queue_outcomes`

These writes go through the existing PostgREST API proxy at `/api/dia-query.js` (dialysis) and `/api/gov-query.js` (government).

---

## Required Changes

### 1. Enable PostgREST Write Access (RLS Policies)

The API proxies use `service_role` keys, so RLS is bypassed. However, verify that the proxy handlers actually forward POST and PATCH methods properly. Check these files:

- `/api/dia-query.js` — verify it handles `POST` and `PATCH` methods and passes the `Prefer` header through
- `/api/gov-query.js` — same

**What to verify in each proxy:**
```javascript
// Must handle POST method for INSERTs:
if (req.method === 'POST') {
  // Forward to Supabase with body and headers including Prefer: return=representation
}

// Must handle PATCH method for UPDATEs:
if (req.method === 'PATCH') {
  // Forward to Supabase with filter params and body
}
```

If the proxies only handle GET, they need to be extended to support POST and PATCH with:
- Body forwarding (JSON)
- Filter parameter forwarding (for PATCH: `column=eq.value` style PostgREST filters)
- The `Prefer: return=representation` header must be forwarded on POST so the frontend can read back the created record's ID

### 2. Verify Table Permissions and Constraints

Run these checks to ensure the tables accept the writes the frontend will make:

```sql
-- Check that recorded_owners has a default UUID for recorded_owner_id
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'recorded_owners' AND column_name = 'recorded_owner_id';

-- Check that true_owners has a default UUID for true_owner_id
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'true_owners' AND column_name = 'true_owner_id';

-- Check that contacts has a default UUID for contact_id
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'contacts' AND column_name = 'contact_id';

-- Check that loans has auto-increment or serial for loan_id
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'loans' AND column_name = 'loan_id';

-- Check that sales_transactions has auto-increment for sale_id
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'sales_transactions' AND column_name = 'sale_id';
```

If any primary keys lack default values (UUIDs should have `gen_random_uuid()`, integers should have `nextval()`), add them:

```sql
-- Example fixes if needed:
ALTER TABLE recorded_owners ALTER COLUMN recorded_owner_id SET DEFAULT gen_random_uuid();
ALTER TABLE true_owners ALTER COLUMN true_owner_id SET DEFAULT gen_random_uuid();
ALTER TABLE contacts ALTER COLUMN contact_id SET DEFAULT gen_random_uuid();
-- For integer PKs, ensure sequences exist
```

### 3. Verify `properties` Table Accepts UUID Owner IDs

The frontend PATCHes `properties.recorded_owner_id` and `properties.true_owner_id` with UUID values from the created owner records. Verify these columns are the correct UUID type:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'properties' AND column_name IN ('recorded_owner_id', 'true_owner_id');
```

**IMPORTANT**: The `properties.true_owner_id` column is currently type `integer`, but `true_owners.true_owner_id` is type `uuid`. This is a type mismatch! The frontend will try to set `properties.true_owner_id = '<uuid>'` which will fail.

Options:
- **Option A** (recommended): Alter `properties.true_owner_id` to UUID type: `ALTER TABLE properties ALTER COLUMN true_owner_id TYPE uuid USING true_owner_id::uuid;` (only if no existing integer values — check first)
- **Option B**: Add a new `properties.true_owner_uuid` column of type UUID, and update the frontend to use that instead
- **Option C**: Use a lookup table or modify the frontend to store the integer ID instead

Check what values currently exist:
```sql
SELECT true_owner_id FROM properties WHERE true_owner_id IS NOT NULL LIMIT 10;
```

### 4. Add `updated_at` Triggers

Add automatic `updated_at` timestamp triggers to the write-target tables if they don't already have them:

```sql
-- Generic trigger function (may already exist)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to each table
CREATE TRIGGER set_updated_at BEFORE UPDATE ON recorded_owners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON true_owners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 5. Fix the Hemet Property (ICO Fund XV)

The ownership resolution for property_id 24199 (3050 W. Florida Ave, Hemet, CA) was saved before the fix. The data landed in `research_queue_outcomes` but not in the owner tables. Manually create the records:

```sql
-- Create recorded owner
INSERT INTO recorded_owners (name, normalized_name)
VALUES ('ICO Fund XV LLC', 'ico fund xv llc')
RETURNING recorded_owner_id;

-- Create true owner (use the recorded_owner_id from above if they have a link)
INSERT INTO true_owners (name, owner_type, contact_1_name, notes)
VALUES ('ICO Investment Group', 'llc', 'Alexander Moradi', 'Phone: (213) 270-8000 | Email: amoradi@icoinvestment.com')
RETURNING true_owner_id;

-- Create contact
INSERT INTO contacts (contact_name, contact_email, contact_phone, company, role)
VALUES ('Alexander Moradi', 'amoradi@icoinvestment.com', '(213) 270-8000', 'ICO Investment Group', 'owner')
RETURNING contact_id;

-- Link to property (use the UUIDs from above)
UPDATE properties
SET recorded_owner_id = '<recorded_owner_uuid_from_above>',
    true_owner_id = '<true_owner_id_from_above>'  -- NOTE: type mismatch issue, see section 3
WHERE property_id = 24199;
```

### 6. Extend API Proxy for Write Support (if not already supported)

Check if `/api/dia-query.js` handles POST and PATCH. If it only handles GET, here's the pattern to add:

```javascript
// In the handler function, after the existing GET logic:

if (req.method === 'POST') {
  const supabaseUrl = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  // Forward Prefer header if present
  if (req.headers['prefer']) {
    headers['Prefer'] = req.headers['prefer'];
  }
  const response = await fetch(supabaseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(req.body),
  });
  const data = await response.json();
  return res.status(response.status).json(data);
}

if (req.method === 'PATCH') {
  // Build PostgREST filter URL
  const filter = req.query.filter; // e.g., "property_id=eq.24199"
  const supabaseUrl = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const headers = {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const response = await fetch(supabaseUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(req.body),
  });
  return res.status(response.status).end();
}
```

---

## Testing Checklist

After making the changes:

1. **Test ownership save**: Open a clinic detail panel, go to Ownership tab, fill in owner info, click Save. Verify records appear in `recorded_owners`, `true_owners`, `contacts`, and the property's `recorded_owner_id`/`true_owner_id` are set.

2. **Test Intel tab — Prior Sale**: Enter a sale date, price, cap rate, buyer. Verify a new row appears in `sales_transactions` with the correct `property_id`.

3. **Test Intel tab — Loan**: Enter lender, amount, rate, maturity. Verify a new row appears in `loans` with the correct `property_id`.

4. **Test Intel tab — Cash Flow**: Enter rent, value, cap rate. Verify the `properties` row is updated with `last_known_rent` and `current_value_estimate`.

5. **Test Intel tab — Notes**: Enter research notes. Verify a new row appears in `research_queue_outcomes` with `queue_type = 'intel_research'`.

---

## Supabase Connection

- Project ID: `zqzrriwuavgrquhisnoa`
- Use the Supabase MCP tools (`execute_sql`, `apply_migration`) for all database changes
- The frontend writes go through `/api/dia-query.js` and `/api/gov-query.js` — these are Vercel serverless functions in the repo root
