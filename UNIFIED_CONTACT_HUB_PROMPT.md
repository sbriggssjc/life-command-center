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
| WebEx call history | unknown | by phone | via WebEx REST API — caller/callee, duration, timestamps |
| WebEx people directory | org-wide | varies | via WebEx People API — org contacts |
| iPhone contacts | unknown | most | via Exchange sync (business) or iCloud CardDAV (personal) |

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
  webex_person_id TEXT,     -- WebEx People API person ID
  teams_user_id TEXT,       -- Microsoft Teams user ID (from Graph API)
  icloud_contact_id TEXT,   -- Apple iCloud contact ID (via CardDAV or Exchange sync)

  -- Engagement signals (auto-updated from WebEx, Outlook, Calendar)
  last_call_date TIMESTAMPTZ,       -- most recent WebEx or logged call
  last_email_date TIMESTAMPTZ,      -- most recent email exchange (sent or received)
  last_meeting_date TIMESTAMPTZ,    -- most recent calendar meeting as attendee
  total_calls INTEGER DEFAULT 0,    -- lifetime call count from WebEx + logged calls
  total_emails_sent INTEGER DEFAULT 0,
  engagement_score NUMERIC DEFAULT 0, -- computed: recency + frequency + depth

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
CREATE INDEX idx_uc_webex ON unified_contacts (webex_person_id) WHERE webex_person_id IS NOT NULL;
CREATE INDEX idx_uc_engagement ON unified_contacts (engagement_score DESC) WHERE contact_class = 'business';

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
email:          SF > Outlook > Calendar > Supabase
phone:          SF > Outlook > WebEx > iPhone > Supabase
mobile_phone:   iPhone > Outlook > SF
title:          SF > Outlook
company_name:   SF > Gov contacts > Dia activities > Outlook
city/state:     SF > Gov contacts
last_call_date: WebEx > SF logged calls (most recent wins)
engagement:     Auto-computed from WebEx + Outlook + Calendar signals
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

#### D. WebEx → Unified Contacts (call history + contacts)

WebEx Calling exposes call history and contact data via the Webex REST API (`https://webexapis.com/v1/`).

**Call History Ingest:**
- **Trigger:** Scheduled Edge Function or Power Automate flow runs every 2 hours
- **API:** `GET https://webexapis.com/v1/telephony/calls/history?type=placed,received&max=200`
  - Requires a WebEx Integration token with `spark:calls_read` scope
  - Returns caller/callee phone number, name, duration, timestamp, direction
- **Action:** For each call record:
  1. Match the phone number against `unified_contacts` (Tier 1 phone match)
  2. If matched: update `last_call_date`, increment `total_calls`, recalculate `engagement_score`
  3. If not matched: create a new contact stub with phone number and name from WebEx
  4. Log in `contact_change_log` with `source = 'webex'`

**WebEx People Directory Sync:**
- **API:** `GET https://webexapis.com/v1/people?max=500` (org directory)
- **Action:** Cross-reference org contacts with unified hub. Useful for matching internal Northmarq team members and distinguishing them from external contacts.

**WebEx Authentication:**
- Create a WebEx Integration at `developer.webex.com` for the Northmarq org
- Store the access token in Vercel env var `WEBEX_ACCESS_TOKEN`
- Token refresh handled by the integration's OAuth flow
- Scopes needed: `spark:calls_read`, `spark:people_read`

**Engagement Signal from WebEx:**
```sql
-- When a call is logged from WebEx:
UPDATE unified_contacts SET
  last_call_date = :call_timestamp,
  total_calls = total_calls + 1,
  engagement_score = compute_engagement_score(last_call_date, last_email_date, last_meeting_date, total_calls),
  updated_at = now()
WHERE unified_id = :matched_contact_id;

-- Engagement score formula (recency-weighted):
-- score = (days_since_last_call < 7 ? 30 : days < 30 ? 20 : days < 90 ? 10 : 0)
--       + (days_since_last_email < 7 ? 20 : days < 30 ? 15 : days < 90 ? 5 : 0)
--       + (total_calls > 10 ? 20 : total_calls > 5 ? 15 : total_calls > 0 ? 10 : 0)
--       + (days_since_last_meeting < 7 ? 15 : days < 30 ? 10 : days < 90 ? 5 : 0)
```

#### E. iPhone/iCloud → Unified Contacts

iPhone contacts reach the unified hub through two paths:

**Path 1: Exchange ActiveSync (recommended — already working)**
If the iPhone is configured with the Northmarq Exchange/M365 account (which it likely is), all business contacts already sync to Outlook/Exchange. The Outlook sync flow (Section B above) captures these automatically. No additional integration needed for business contacts.

**Path 2: iCloud Personal Contacts (for personal contact separation)**
Personal contacts stored only in iCloud need a separate sync path:

- **Option A — CardDAV Sync (simplest):**
  - iCloud exposes contacts via CardDAV at `https://contacts.icloud.com`
  - A scheduled Edge Function authenticates with app-specific password and fetches vCards
  - Parse vCard format → extract name, email, phone, company
  - All iCloud-only contacts default to `contact_class = 'personal'`

- **Option B — Shortcut + Power Automate (no-code):**
  - Create an iOS Shortcut that exports contacts as JSON and POSTs to a webhook
  - Power Automate receives the webhook and calls `/api/sync/contact-ingest` for each
  - Run manually or on a weekly schedule via iOS automation

- **Option C — Exchange sync covers everything (easiest):**
  - Configure iPhone to sync ALL contacts (not just business) to Exchange
  - The Outlook flow captures everything
  - Use domain-based classification to separate personal from business
  - This is the recommended approach unless you specifically want iCloud contacts isolated

**iPhone-specific considerations:**
- Contacts edited on iPhone → synced to Exchange → picked up by Outlook flow → merged into hub
- New contacts added on iPhone during calls → same path
- Contact photos from iPhone can be synced if the hub stores `photo_url` (optional, adds complexity)

#### F. Microsoft Teams → Unified Contacts (messages + calls)

Teams is in the M365 ecosystem so it's accessible via Microsoft Graph API and Power Automate connectors.

**Teams Chat Message Tracking:**
- **Trigger:** Power Automate "When a new chat message is received" (Teams connector)
- **Action:** For each message from a non-internal sender:
  1. Extract sender name and email from the message metadata
  2. Match against `unified_contacts` by email
  3. If matched: update `last_email_date` (Teams messages count as digital correspondence), recalculate `engagement_score`
  4. If not matched: create a contact stub
  5. Log in `contact_change_log` with `source = 'teams'`
- **Classification:** Teams messages from external contacts → `business`. Internal Northmarq team members → skip (or track separately for team collaboration metrics)
- **Note:** Only track 1:1 and group chats with external participants. Ignore internal-only channels.

**Teams Call Records:**
- **API:** Microsoft Graph `GET /communications/callRecords` (requires `CallRecords.Read.All` permission)
- **Trigger:** Power Automate scheduled flow (every 2 hours) or webhook subscription via Graph
- **Action:** For each call record:
  1. Extract participant phone numbers or Teams user IDs
  2. Match against `unified_contacts` by phone or email
  3. Update `last_call_date`, increment `total_calls`, recalculate `engagement_score`
  4. Track call duration for engagement depth scoring
- **Authentication:** Uses the same M365 OAuth token as the Outlook connector — no separate setup needed
- **Important:** Teams calls and WebEx calls may overlap if both systems are used. Deduplicate by timestamp + phone number to avoid double-counting.

**Teams Presence Awareness (bonus):**
- Microsoft Graph Presence API (`/users/{id}/presence`) can show who's currently available
- Could surface in the LCC Marketing tab: "Available on Teams" badge next to contacts who are online
- Low priority but a nice-to-have for knowing the best time to reach someone

#### G. iPhone Calls & Texts → Unified Contacts

iOS does not expose call logs or iMessage/SMS history to external APIs. There are several practical workarounds:

**Path 1: Teams/WebEx as Primary Calling App (recommended)**
If all business calls go through Teams or WebEx (which have API access), iPhone native call logs are redundant for business contacts. Personal calls stay private by default since the LCC never sees them.

**Path 2: iOS Shortcuts for Call Log Export**
- Create an iOS Shortcut that runs after each call:
  - Trigger: "When phone call ends" automation (requires iOS 16+)
  - Action: Get details of the last call (contact name, phone number, duration)
  - Action: POST to a Power Automate webhook URL with the call data
  - Power Automate ingests to `/api/sync/contact-ingest` with `source = 'iphone_call'`
- **Limitation:** iOS prompts for confirmation before running call-triggered automations, so it's not fully silent. The user must tap "Run" after each call.
- **Personal wall:** The Shortcut can check the contact's group — if they're in a "Personal" contact group, skip the POST.

**Path 3: iPhone Call Forwarding to Teams**
- Configure iPhone to forward all calls through Teams Phone (if using Teams Calling)
- All call records then appear in the Teams call log → captured by the Teams Call Records flow
- This effectively merges iPhone and Teams calling into a single source

**Path 4: iMessage/SMS via Mac Continuity**
- If the user has a Mac with Messages synced via iCloud:
  - The Messages database is stored locally at `~/Library/Messages/chat.db` (SQLite)
  - A scheduled script could query recent messages, extract sender phone numbers
  - POST to the contact hub for engagement tracking
- **Privacy consideration:** This captures iMessage/SMS content — should only extract metadata (sender, timestamp, direction) not message text
- **Personal wall:** Filter by contact group or phone number pattern to exclude personal conversations

**Recommended approach:** Use Path 1 (Teams/WebEx for business calls) + Path 2 (iOS Shortcut for any calls that go through native dialer). This captures all business call activity without exposing personal communications.

#### H. Unified Contacts → Salesforce (propagate back)
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

**Flow 3: WebEx Call History Sync**
```
Trigger: Recurrence (every 2 hours)
Action 1: HTTP GET to https://webexapis.com/v1/telephony/calls/history
  Headers: Authorization: Bearer {WEBEX_ACCESS_TOKEN}
  Query: type=placed,received&max=200
Action 2: For each call record:
  - Extract: callerNumber, calledNumber, name, duration, startTime, direction
  - POST to /api/sync/contact-ingest with body:
    { source: 'webex', phone: callerNumber, first_name: ..., engagement: { call_date: startTime, duration: duration } }
```

**Flow 4: Teams Chat & Call Tracking**
```
Trigger A: When a new chat message is received (Teams connector)
Condition: Sender is external (not @northmarq.com)
Action: POST to /api/sync/contact-ingest with body:
  { source: 'teams', email: senderEmail, first_name: ..., engagement: { message_date: timestamp } }

Trigger B: Recurrence (every 2 hours) — poll call records
Action 1: HTTP GET to Microsoft Graph /communications/callRecords
Action 2: For each call with external participants:
  - POST to /api/sync/contact-ingest with body:
    { source: 'teams_call', phone: participantPhone, engagement: { call_date: startTime, duration: duration } }
```

**Flow 5: iPhone Call Log via iOS Shortcut (optional)**
```
Trigger: iOS Shortcut "When phone call ends" automation
Action: Shortcut extracts contact name, phone number, duration
Action: POST to Power Automate webhook URL
Power Automate: POST to /api/sync/contact-ingest with body:
  { source: 'iphone_call', phone: callerNumber, first_name: contactName,
    engagement: { call_date: now, duration: callDuration } }
Note: User must tap "Run" on the iOS prompt after each call
```

**Flow 6: Contact Update Propagation (outbound)**
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
6. **WebEx call history sync** — Power Automate flow pulling call records every 2 hours
7. **Teams chat & call tracking** — Power Automate flows for Teams messages + Graph API call records
8. **iPhone/iCloud path** — Configure Exchange sync to capture all contacts; iOS Shortcut for native call log export
9. **Personal/business classification** — Auto-classify + manual override in LCC
10. **Engagement scoring** — Compute scores from WebEx + Teams + Outlook + Calendar signals; surface "hot contacts" in Marketing tab
11. **Propagation** — Push changes back to SF and Outlook
12. **Self-healing** — Stale detection, duplicate detection, merge suggestions

### Files to create/modify

| File | Change |
|------|--------|
| `sql/unified_contacts.sql` | Schema for unified_contacts + contact_change_log + engagement score function |
| `api/sync.js` | Add contact-ingest, unified contact endpoints, WebEx/Teams handlers |
| `app.js` | Update Marketing/Prospects to query unified_contacts; add engagement score badges |
| Power Automate | New flows: Outlook sync, calendar attendees, WebEx calls, Teams chat/calls, iPhone shortcut webhook |
| Vercel env vars | Add `WEBEX_ACCESS_TOKEN` for WebEx API authentication |
| iPhone Settings | Ensure contacts sync to Exchange; install iOS Shortcut for call log export |
| M365 Admin | Grant `CallRecords.Read.All` permission for Teams call record API access |

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
