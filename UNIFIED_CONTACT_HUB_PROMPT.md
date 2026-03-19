# Unified Contact Hub — Claude Code Prompt

## Vision

Build a self-learning, self-healing unified contact graph that syncs across Salesforce, Outlook/Microsoft 365, Supabase (both Gov and Dialysis), and Calendar — with a hard wall between **personal** and **business** contacts.

## Current Data Landscape

| Source | Records | Has Email | Key Fields |
|--------|---------|-----------|------------|
| SF contacts import (Gov DB) | 34,002 | 33,368 | sf_contact_id, first_name, last_name, email, phone, mobile_phone, title, account_name, mailing_city/state |
| Gov contacts table | 4,732 | 587 | name, entity_type, contact_type, email, phone, sf_contact_id, sf_account_id |
| SF activities (Dia DB) | ~15K unique contacts | embedded | sf_contact_id, first_name, last_name, email, phone, company_name |
| True owners (Gov DB) | 1,863 | — | owner name, entity info |
| Recorded owners (Gov DB) | 13,060 | — | owner name from county records |
| Outlook contacts | unknown | all | via Microsoft Graph API / Power Automate |
| Calendar attendees | unknown | most | extracted from Exchange calendar events |

## Architecture

### 1. Schema: `unified_contacts` table (Gov Supabase)

```sql
CREATE TABLE unified_contacts (
  unified_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification
  contact_class TEXT NOT NULL DEFAULT 'business',  -- 'business' | 'personal'
  -- Personal contacts are NEVER synced to Salesforce, never shown in CRM views,
  -- and never included in marketing/prospecting. They exist only for the user's
  -- personal calendar and Outlook integration.

  -- Canonical fields (the "resolved" best value for each)
  first_name TEXT,
  last_name TEXT,
  full_name TEXT GENERATED ALWAYS AS (
    COALESCE(first_name || ' ' || last_name, first_name, last_name)
  ) STORED,
  email TEXT,               -- primary email
  email_secondary TEXT,     -- alternate email
  phone TEXT,               -- primary phone
  mobile_phone TEXT,
  title TEXT,
  company_name TEXT,
  city TEXT,
  state TEXT,
  website TEXT,

  -- Business-specific fields (NULL for personal contacts)
  entity_type TEXT,         -- 'individual' | 'llc' | 'trust' | 'corporation' etc.
  contact_type TEXT,        -- 'owner' | 'broker' | 'buyer' | 'developer' | 'lender'
  industry TEXT,
  is_1031_buyer BOOLEAN DEFAULT false,
  total_transactions INTEGER DEFAULT 0,
  total_volume NUMERIC DEFAULT 0,
  avg_cap_rate NUMERIC,

  -- Source linkages (foreign keys to each system)
  sf_contact_id TEXT,       -- Salesforce Contact ID
  sf_account_id TEXT,       -- Salesforce Account ID
  gov_contact_id UUID,      -- contacts table in Gov DB
  dia_contact_id UUID,      -- contacts table in Dia DB (if exists)
  true_owner_id UUID,       -- true_owners match
  recorded_owner_id UUID,   -- recorded_owners match
  outlook_contact_id TEXT,  -- Microsoft Graph contact ID

  -- Field provenance: which source provided each canonical field
  -- Format: {"field_name": {"source": "salesforce", "updated_at": "2026-03-18T..."}}
  field_sources JSONB DEFAULT '{}',

  -- Matching metadata
  match_confidence NUMERIC DEFAULT 0,  -- 0-1 score from entity resolution
  match_method TEXT,        -- 'email_exact' | 'name_company_fuzzy' | 'phone_exact' | 'manual'
  merge_history JSONB DEFAULT '[]',  -- array of {merged_from, merged_at, fields_updated}

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_synced_sf TIMESTAMPTZ,
  last_synced_outlook TIMESTAMPTZ,
  last_synced_calendar TIMESTAMPTZ
);

-- Indexes for fast matching
CREATE UNIQUE INDEX idx_uc_email ON unified_contacts (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_uc_sf_contact ON unified_contacts (sf_contact_id) WHERE sf_contact_id IS NOT NULL;
CREATE INDEX idx_uc_outlook ON unified_contacts (outlook_contact_id) WHERE outlook_contact_id IS NOT NULL;
CREATE INDEX idx_uc_name_company ON unified_contacts (LOWER(last_name), LOWER(company_name));
CREATE INDEX idx_uc_phone ON unified_contacts (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_uc_class ON unified_contacts (contact_class);
CREATE INDEX idx_uc_updated ON unified_contacts (updated_at DESC);

-- Audit log for every change
CREATE TABLE contact_change_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unified_id UUID REFERENCES unified_contacts(unified_id),
  change_type TEXT NOT NULL,  -- 'create' | 'merge' | 'update' | 'classify' | 'delete'
  source TEXT NOT NULL,       -- 'salesforce' | 'outlook' | 'calendar' | 'manual' | 'system'
  fields_changed JSONB,      -- {"email": {"old": "x@y.com", "new": "x@z.com"}}
  merged_from UUID,          -- if merge, which contact was absorbed
  changed_by TEXT,            -- user who initiated
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ccl_unified ON contact_change_log (unified_id, changed_at DESC);
```

### 2. Personal vs Business Classification

The `contact_class` field controls visibility:

- **`business`** — visible in CRM, Marketing tab, prospecting, synced to/from Salesforce
- **`personal`** — ONLY visible in personal calendar views and personal Outlook. Never synced to SF. Never shown in business CRM views. Never included in marketing outreach.

**Auto-classification rules:**
```
IF source = 'salesforce' → business (always)
IF source = 'outlook' AND email domain IN company_domains → business
IF source = 'outlook' AND email domain = personal domains (gmail, yahoo, hotmail, etc.)
   AND no SF match → personal (default, user can override)
IF source = 'calendar' AND meeting has SF deal reference → business
IF source = 'calendar' AND meeting category = 'personal' → personal
```

**User override:** The LCC should have a simple toggle on any contact card to reclassify between personal and business. This writes to `contact_class` and logs the change.

### 3. Entity Resolution / Matching Logic

When a new contact arrives from any source, the matcher runs:

**Tier 0 — Email exact match** (highest confidence):
```sql
SELECT * FROM unified_contacts WHERE LOWER(email) = LOWER(:incoming_email)
```
→ If found: merge (update fields from source, log changes)

**Tier 1 — Phone exact match** (high confidence):
```sql
SELECT * FROM unified_contacts
WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(:incoming_phone, '[^0-9]', '', 'g')
```
→ If found + name similarity > 0.7: merge

**Tier 2 — Name + Company fuzzy match** (medium confidence):
```sql
SELECT *, similarity(LOWER(full_name), LOWER(:incoming_name)) as name_sim
FROM unified_contacts
WHERE LOWER(company_name) = LOWER(:incoming_company)
  AND similarity(LOWER(full_name), LOWER(:incoming_name)) > 0.6
ORDER BY name_sim DESC LIMIT 3
```
→ If top match > 0.8: auto-merge. If 0.6-0.8: flag for review.

**Tier 3 — Name-only fuzzy match** (low confidence):
→ Only flag for review, never auto-merge

### 4. Field-Level Authority Resolution

When merging, each field uses a priority hierarchy:

```
email:        SF > Outlook > Calendar > Supabase
phone:        SF > Outlook > Supabase
mobile_phone: SF > Outlook
title:        SF > Outlook
company_name: SF > Gov contacts > Dia activities > Outlook
city/state:   SF > Gov contacts
```

**"Most recent wins" tiebreaker:** If two sources have the same priority level, take the most recently updated value.

**Self-healing:** If an email bounces (detected via Outlook delivery failure), automatically flag it as stale. If a phone is disconnected (detected via WebEx call failure), flag it. The system learns which data is current.

### 5. Sync Flows

#### A. Salesforce → Unified Contacts (ingest)
- **Trigger:** Nightly batch OR on-demand via the existing `sf_contacts_import` sync
- **Action:** For each SF contact, run entity resolution against `unified_contacts`. Create or merge.
- **Classification:** Always `business`

#### B. Outlook → Unified Contacts (ingest)
- **Trigger:** Power Automate flow runs every 4 hours
- **Action:** Microsoft Graph API `GET /me/contacts` with `$select=givenName,surname,emailAddresses,businessPhones,mobilePhone,companyName,jobTitle`
- **Classification:** Auto-classify using domain rules. Personal domains → `personal`, company domains → `business`, unknown → `business` (default to not lose deals)

#### C. Calendar → Unified Contacts (ingest)
- **Trigger:** Existing calendar sync flow (already running)
- **Action:** Extract attendee names + emails from calendar events. Run entity resolution.
- **Classification:** If meeting subject references a deal (pattern match against SF subjects) → `business`. If meeting is in personal calendar category → `personal`.

#### D. Unified Contacts → Salesforce (propagate back)
- **Trigger:** When a business contact is updated in Supabase (phone change, email correction, etc.)
- **Action:** Push update to SF via the existing `/api/sync/log-to-sf` endpoint
- **NEVER:** push personal contacts to SF

#### E. Unified Contacts → Outlook (propagate back)
- **Trigger:** When a contact is updated from a non-Outlook source
- **Action:** Microsoft Graph API `PATCH /me/contacts/{outlook_contact_id}`
- **Personal contacts:** sync normally (Outlook is the personal contact store)
- **Business contacts:** sync only if Outlook is missing the data

### 6. Power Automate Flows Needed

**Flow 1: Outlook Contact Sync (inbound)**
```
Trigger: Recurrence (every 4 hours)
Action 1: HTTP GET to Microsoft Graph /me/contacts?$top=500&$select=...
Action 2: For each contact:
  - POST to /api/sync/contact-ingest with body: { source: 'outlook', ... }
```

**Flow 2: Calendar Attendee Extraction**
```
Trigger: When a calendar event is created or updated
Action 1: Extract attendee list (name + email)
Action 2: For each attendee:
  - POST to /api/sync/contact-ingest with body: { source: 'calendar', ... }
```

**Flow 3: Contact Update Propagation (outbound)**
```
Trigger: When an HTTP request is received (webhook from Supabase)
Condition: If source != 'outlook' AND outlook_contact_id IS NOT NULL
Action: HTTP PATCH to Microsoft Graph /me/contacts/{id}
```

### 7. API Endpoints

Add to the existing Vercel API:

```javascript
// POST /api/sync/contact-ingest
// Receives a contact from any source, runs entity resolution, creates or merges
{
  source: 'salesforce' | 'outlook' | 'calendar' | 'manual',
  contact_class: 'business' | 'personal' | null, // null = auto-classify
  first_name, last_name, email, phone, mobile_phone,
  company_name, title, city, state,
  sf_contact_id, outlook_contact_id, // optional source IDs
}

// GET /api/contacts/unified?class=business&search=...
// Returns unified contacts, filtered by class

// PATCH /api/contacts/unified/:unified_id
// Update a contact (triggers propagation to source systems)

// POST /api/contacts/unified/:unified_id/classify
// Reclassify between personal and business
{ contact_class: 'personal' | 'business' }

// GET /api/contacts/unified/:unified_id/history
// Returns the change log for a contact
```

### 8. LCC Frontend Integration

In `app.js`, the Marketing tab should:
- Only show contacts where `contact_class = 'business'`
- The contact card should show source badges (SF, Outlook, Calendar) indicating where the data came from
- A small "Personal" toggle should allow reclassifying a contact
- The Prospects search should query `unified_contacts` instead of separate tables

### 9. Self-Learning / Self-Healing

**Stale data detection:**
- If an email hasn't been part of any calendar event or email exchange in 12 months → flag as "stale"
- If a phone hasn't been associated with any logged call in 12 months → flag as "stale"
- Surface stale contacts in a "Data Quality" widget on the Marketing tab

**Duplicate detection:**
- Nightly job scans for potential duplicates: same email but different unified_id, or high name+company similarity across records
- Surface in a "Merge Suggestions" queue in the LCC

**Auto-enrichment:**
- When a new calendar meeting is created with a known contact, update their `last_synced_calendar` timestamp
- When an email is sent to a contact (detected via Outlook sent items), update engagement recency
- This feeds into the "hot lead" scoring — contacts with recent engagement bubble to the top

### 10. Implementation Priority

1. **Schema** — Create `unified_contacts` and `contact_change_log` tables in Gov Supabase
2. **Initial seed** — Bulk import SF contacts (34K) as the baseline, all classified as `business`
3. **Entity resolution function** — PostgreSQL function or Edge Function that matches incoming contacts
4. **Contact ingest API** — `/api/sync/contact-ingest` endpoint
5. **Outlook sync flow** — Power Automate flow for inbound Outlook contacts
6. **Personal/business classification** — Auto-classify + manual override in LCC
7. **Propagation** — Push changes back to SF and Outlook
8. **Self-healing** — Stale detection, duplicate detection, merge suggestions

### Files to create/modify

| File | Change |
|------|--------|
| `sql/unified_contacts.sql` | Schema for unified_contacts + contact_change_log |
| `api/sync.js` | Add contact-ingest and unified contact endpoints |
| `app.js` | Update Marketing/Prospects to query unified_contacts |
| Power Automate | New flows for Outlook sync + calendar attendee extraction |

### SQL Migration (ready to apply)

The schema above can be applied directly to the Gov Supabase project (`scknotsqkcheojiaewwh`). The initial SF seed query:

```sql
INSERT INTO unified_contacts (
  contact_class, first_name, last_name, email, phone, mobile_phone,
  title, company_name, city, state, sf_contact_id, sf_account_id,
  field_sources, match_confidence, match_method, last_synced_sf
)
SELECT
  'business',
  first_name, last_name, email, phone, mobile_phone,
  title, account_name, mailing_city, mailing_state,
  sf_contact_id, sf_account_id,
  jsonb_build_object(
    'email', jsonb_build_object('source', 'salesforce', 'updated_at', now()),
    'phone', jsonb_build_object('source', 'salesforce', 'updated_at', now()),
    'company_name', jsonb_build_object('source', 'salesforce', 'updated_at', now())
  ),
  1.0, 'sf_import', now()
FROM sf_contacts_import
WHERE sf_contact_id IS NOT NULL
ON CONFLICT (LOWER(email)) DO UPDATE SET
  sf_contact_id = EXCLUDED.sf_contact_id,
  sf_account_id = EXCLUDED.sf_account_id,
  last_synced_sf = now();
```
