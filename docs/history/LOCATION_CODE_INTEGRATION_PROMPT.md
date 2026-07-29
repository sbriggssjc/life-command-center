# Location Code Integration — Claude Code Prompt

## Context

The Supabase schema changes are already done:
- `prospect_leads.location_code TEXT` column added with index
- `location_code_reference` table created and populated with 9,488 codes from `gsa_lease_events`
- Location codes follow the pattern `{STATE_ABBR}{4-digit number}` (e.g., `AK3166`, `TX0523`, `VA1234`)

What remains is the Python backend integration across 6 files. Work through these in order.

---

## 1. Capture location_code during lead creation — `lead_pipeline.py`

**File:** `lead_pipeline.py`
**Function:** `process_gsa_events()` around lines 455-573

The SELECT query that reads from `gsa_lease_events` (around line 455-460) doesn't include `location_code`. Add it.

Then the lead dict built around lines 555-573 doesn't include `location_code`. Add it.

```python
# In the SELECT from gsa_lease_events, add location_code:
# ... lease_number, location_code, address, city, state ...

# In the lead dict construction, add:
"location_code": event.get("location_code"),
```

Also ensure the INSERT statement that writes to `prospect_leads` includes `location_code` in its column list and values.

---

## 2. Use location_code in property matcher — `gsa_property_matcher.py`

**File:** `gsa_property_matcher.py`

The matcher currently runs 4 tiers of matching but never uses `location_code`. Add a Tier 0 exact-match step:

```python
# Tier 0: Exact location_code match against properties
# If the lead has a location_code, check if any property in the properties table
# has a matching location_code (via gsa_leases or gsa_lease_events join).
# This is especially valuable for address-missing leases.
```

Implementation approach:
- Before running the existing tiers, if the lead has a `location_code`, query:
  ```sql
  SELECT DISTINCT p.id
  FROM properties p
  JOIN gsa_leases gl ON gl.property_id = p.id
  JOIN gsa_lease_events gle ON gle.lease_number = gl.lease_number
  WHERE gle.location_code = :location_code
  ```
- If exactly 1 match → return it immediately as high-confidence
- If multiple matches → use as a tiebreaker/boost in subsequent fuzzy tiers (e.g., add +20 to match score)
- Log the match tier as `"tier0_location_code"`

Also use `location_code` as a tiebreaker in existing fuzzy tiers: when two candidates score equally, prefer the one whose linked `gsa_lease_events` share the same `location_code`.

---

## 3. Add location_code to AI research prompts — `ai_research.py`

**File:** `ai_research.py`

Three prompts need `location_code` added to their context:

### ENTITY_RESOLUTION_PROMPT
Add `location_code` to the property/lease context block so the AI can use it for disambiguation. Insert it near `lease_number`:
```
GSA Location Code: {location_code}
```

### COUNTY_LOOKUP_PROMPT
This is the most impactful. Location codes encode the state and can narrow county lookups significantly. Add:
```
GSA Location Code: {location_code} (format: STATE_ABBR + 4-digit code, e.g., TX0523 = Texas)
Use the state prefix from the location code to validate your county/state result.
```

### CONTACT_DISCOVERY_PROMPT
Add `location_code` to the property context so AI can reference it when searching for owner/contact info:
```
GSA Location Code: {location_code}
```

For all three: if `location_code` is None/empty, omit the line rather than showing "None".

---

## 4. Propagate location_code in address auto-backfill — `gsa_monthly_diff.py`

**File:** `gsa_monthly_diff.py`
**Function:** `_backfill_newly_available_addresses()`

This function patches `address`, `city`, `state` onto leads when a previously address-less lease gets an address. It should also patch `location_code`.

Find the UPDATE statement and add `location_code` to the SET clause:
```sql
UPDATE prospect_leads
SET address = :address,
    city = :city,
    state = :state,
    location_code = :location_code,
    updated_at = now()
WHERE ...
```

Also ensure the SELECT that fetches the new address data includes `location_code` from `gsa_lease_events`.

---

## 5. Add location_code to `lead_updater.py` show/update

**File:** `lead_updater.py`

### Show command
When displaying a lead's details (the `show` subcommand), include `location_code` in the output. Add it near `lease_number` in the display format:
```
Lease Number:    GS-07P-12345
Location Code:   TX0523
Address:         123 Main St, Dallas, TX 75201
```

### Update command
Allow `--location-code` as an updateable field so the team can correct it:
```python
# Add to argument parser:
parser.add_argument('--location-code', help='GSA location code')

# Add to the update dict if provided:
if args.location_code is not None:
    updates["location_code"] = args.location_code
```

---

## 6. Expose location_code in API endpoints — `main.py`

**File:** `main.py`

Find every endpoint that returns lead data and ensure `location_code` is included in the response. Key endpoints to check:

- `GET /leads` (list)
- `GET /leads/{lead_id}` (detail)
- `POST /leads` (create — accept location_code in body)
- `PATCH /leads/{lead_id}` (update — accept location_code in body)
- Any lead search/filter endpoints

If there's a Pydantic model or response schema for leads, add `location_code: Optional[str] = None` to it.

Also add a new endpoint for the reference table:
```python
@app.get("/location-codes")
async def list_location_codes(state: str = None, q: str = None):
    """Search location_code_reference table for validation/autocomplete."""
    query = supabase.table("location_code_reference").select("*")
    if state:
        query = query.eq("state", state.upper())
    if q:
        query = query.ilike("location_code", f"%{q}%")
    result = query.limit(50).execute()
    return result.data
```

---

## Verification

After all changes, run these checks:

1. **Lead creation test:** Process a GSA event that has a location_code and verify it appears in `prospect_leads`:
   ```sql
   SELECT lead_id, lease_number, location_code, address, city, state
   FROM prospect_leads
   WHERE location_code IS NOT NULL
   ORDER BY created_at DESC LIMIT 5;
   ```

2. **Property matcher test:** Find a lead with a location_code but no address, run the matcher, verify Tier 0 fires.

3. **API test:** `curl localhost:8000/leads?limit=1` and confirm `location_code` appears in the response.

4. **Reference table test:** `curl localhost:8000/location-codes?state=TX&q=TX05` returns matching codes.

---

## Files to modify (summary)

| File | Change |
|------|--------|
| `lead_pipeline.py` | Add location_code to SELECT, lead dict, and INSERT |
| `gsa_property_matcher.py` | Add Tier 0 exact location_code match + tiebreaker |
| `ai_research.py` | Add location_code to 3 prompt templates |
| `gsa_monthly_diff.py` | Add location_code to backfill UPDATE + SELECT |
| `lead_updater.py` | Add location_code to show + update commands |
| `main.py` | Add location_code to all lead endpoints + new /location-codes endpoint |
| `sql/` | Migration already applied — add a `.sql` file to track it in version control |

### SQL migration file to add (for version control):

Save as `sql/20260318_add_location_code.sql`:
```sql
ALTER TABLE prospect_leads ADD COLUMN IF NOT EXISTS location_code TEXT;
CREATE INDEX IF NOT EXISTS idx_prospect_leads_location_code ON prospect_leads (location_code) WHERE location_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS location_code_reference (
  location_code TEXT PRIMARY KEY,
  pbs_region TEXT,
  state TEXT,
  city TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO location_code_reference (location_code, state, city)
SELECT DISTINCT location_code, state, city
FROM gsa_lease_events
WHERE location_code IS NOT NULL AND location_code != ''
ON CONFLICT (location_code) DO NOTHING;
```
