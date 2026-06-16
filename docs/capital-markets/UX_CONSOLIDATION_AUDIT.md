# Life Command Center — Data Quality / Review / Merge Surfaces: UX Consolidation Audit

## Executive Summary

The Life Command Center has **13 distinct top-level pages/surfaces** presenting review/merge/dedup/reconciliation work, split across **3 primary categories**:

1. **Decision-driven surfaces** (Review Console, Priority Queue) — unified lanes for structured verdicts
2. **Domain-specific data quality pages** (Data Quality, Research, Sync Health) — metrics + work items
3. **Entity-centric surfaces** (Unified Contacts, Entities page) — search + merge + link operations

Significant overlap exists: **Property merging, entity merging, and "Create Follow-up" appear in 5+ places**. A single user must visit at least **8 separate pages** to handle all manual-review work.

---

## DETAILED SURFACE CATALOG

### PAGE 1: **Decision Center** (Review Console)
- **File**: `ops.js` → `renderReviewConsolePage()` (line 1419)
- **URL/Nav**: `navTo('pageReviewConsole')`
- **API Endpoint**: 
  - `GET /api/decisions?summary=1` → decision lane counts
  - `GET /api/review-counts` → SOS owner-link counts
- **Handler**: `api/operations.js` → `/api/decisions` route (proxies to decision database)

**Sub-surfaces (decision lanes):**

#### Lane 1.1: **Confirm the True Owner**
- **Type**: `confirm_true_owner`
- **Render Function**: `renderDecisionLane('confirm_true_owner')` (line 1701)
- **API**: `GET /api/decisions?type=confirm_true_owner&limit=50`
- **Actions**: 
  - `dcVerdict(id, 'correct')` → Confirm current owner
  - `dcVerdict(id, 'stale')` → Mark stale, propose new owner
  - `dcVerdict(id, 'research')` → Send to research
- **Write Target**: `decisions` table via `POST /api/decision-verdict`

#### Lane 1.2: **Buyer Parents & SF Mapping**
- **Type**: `confirm_buyer_parent` + `map_sf_parent_account`
- **Render Function**: `renderBuyerParentLane()` (line 1864)
- **API**: `GET /api/decisions?type=confirm_buyer_parent&limit=50` + `GET /api/decisions?type=map_sf_parent_account&limit=50`
- **Actions**:
  - `dcMap(id, sfId, sfName)` → Map to Salesforce parent
  - `dcVerdict(id, 'confirm_sponsor')` → Confirm sponsor
  - `dcVerdict(id, 'research')` → Research needed
- **Write Target**: `decisions` table + Salesforce sync

#### Lane 1.3: **Staged Intake — Needs Review**
- **Type**: `intake_disposition`
- **Render Function**: `renderFederatedLane('intake_disposition')` (line 2002)
- **API**: `GET /api/decisions?type=intake_disposition&limit=50`
- **Actions**:
  - `dcFed(i, 'create_property')` → Create new property
  - `dcFed(i, 'research')` → Research first
  - `dcFed(i, 'dismiss')` → Reject intake
- **Write Target**: `decisions` + `intake_staging` tables
- **Additional CTA**: Routes to Inbox for re-extraction

#### Lane 1.4: **Property Merges & Duplicates**
- **Type**: `property_merge`
- **Render Function**: `renderFederatedLane('property_merge')` (line 2002)
- **API**: `GET /api/decisions?type=property_merge&limit=50`
- **Actions**:
  - `dcFed(i, 'merge')` → Keep one property, discard the other
  - `dcFed(i, 'keep_distinct')` → Record as same-location versions
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: `decisions` table + property consolidation edge writes

#### Lane 1.5: **Duplicate Entities — Merge**
- **Type**: `merge_duplicate_entities`
- **Render Function**: `renderFederatedLane('merge_duplicate_entities')` (line 2002)
- **API**: `GET /api/decisions?type=merge_duplicate_entities&limit=50`
- **Actions**:
  - `dcFed(i, 'merge')` → Merge into canonical entity
  - `dcFed(i, 'keep_separate')` → Record as distinct entities
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: `decisions` + entity consolidation
- **Note**: Entity merging also appears in Data Quality (section 4) and Unified Contacts (section 6)

#### Lane 1.6: **Data Conflicts & Provenance**
- **Type**: `provenance_conflict`
- **Render Function**: `renderFederatedLane('provenance_conflict')` (line 2002)
- **API**: `GET /api/decisions?type=provenance_conflict&limit=50`
- **Actions**:
  - `dcFed(i, 'prefer_source')` → Prefer one source for a field
  - `dcFed(i, 'correct')` → Enter correct value
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: `field_provenance` + `source_precedence` tables

#### Lane 1.7: **Pending Updates (Gov)**
- **Type**: `pending_update`
- **Render Function**: `renderFederatedLane('pending_update')` (line 2002)
- **API**: `GET /api/decisions?type=pending_update&limit=50`
- **Actions**:
  - `dcFed(i, 'apply')` → Accept proposed update
  - `dcFed(i, 'reject')` → Reject update
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: `gov_change_events` table (domain-specific)

#### Lane 1.8: **CMS ↔ Property Link Suspects**
- **Type**: `cms_link_suspect`
- **Render Function**: `renderFederatedLane('cms_link_suspect')` (line 2002)
- **API**: `GET /api/decisions?type=cms_link_suspect&limit=50`
- **Actions**:
  - `dcFed(i, 'confirm')` → Link is correct
  - `dcFed(i, 'break')` → Break link (calls `dcCmsUnlink()`)
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: `cms_match` table via `/api/cms-match?action=link`

#### Lane 1.9: **Junk Entity Names**
- **Type**: `junk_entity_name`
- **Render Function**: `renderDecisionLane('junk_entity_name')` (line 1701) + `renderExactMergePanel()` (line 1816) + `renderJunkBucketPanel()`
- **API**: 
  - `GET /api/decisions?type=junk_entity_name&limit=50`
  - `GET /api/junk-bucket` → classification buckets
  - `GET /api/exact-merge` → bulk merge previews
- **Actions**:
  - `dcVerdict(id, 'rename', {new_name})` → Rename entity
  - `dcVerdict(id, 'merge', {target_entity_id})` → Merge to correct entity
  - `dcVerdict(id, 'leave_flagged')` → Leave as junk flag
  - Bulk action: merge entire bucket at once
- **Write Target**: `entities` + `decisions` tables

#### Lane 1.10: **Implausible Values**
- **Type**: `implausible_value`
- **Render Function**: `renderFederatedLane('implausible_value')` (line 2002)
- **API**: `GET /api/decisions?type=implausible_value&limit=50`
- **Actions**:
  - `dcImplausibleCorrect(i)` → Enter corrected value (e.g., sale price)
  - `dcFed(i, 'accept')` → Accept as-is
  - `dcFed(i, 'research')` → Research needed
- **Write Target**: Property financial fields

#### Lane 1.11: **Intake Match Disambiguation**
- **Type**: `match_disambiguation`
- **Render Function**: `renderDecisionLane('match_disambiguation')` (line 1701)
- **API**: `GET /api/decisions?type=match_disambiguation&limit=50`
- **Actions**:
  - `dcVerdict(id, 'pick', {property_id})` → Select correct property from candidates
  - `dcVerdict(id, 'create_property')` → Create new property instead
  - `dcVerdict(id, 'research')` → Research needed
- **Write Target**: `intake_staging` + new property creation

#### Lane 1.12: **LLC Research Dead-Letters**
- **Type**: `llc_research_dead`
- **Render Function**: `renderDecisionLane('llc_research_dead')` (line 1701)
- **API**: `GET /api/decisions?type=llc_research_dead&limit=50`
- **Actions**:
  - `dcVerdict(id, 'resolve_manually')` → Open SOS research task
  - `dcVerdict(id, 'retry')` → Retry automated lookup
  - `dcVerdict(id, 'park')` → Park the request
- **Write Target**: `decisions` + research task creation

#### Lane 1.13: **Availability Bot-Blocks**
- **Type**: `availability_checker_botblock`
- **Render Function**: `renderDecisionLane('availability_checker_botblock')` (line 1701)
- **API**: `GET /api/decisions?type=availability_checker_botblock&limit=50`
- **Actions**:
  - `dcVerdict(id, 'verify')` → Manual verification of top 5 listings
  - `dcVerdict(id, 'acknowledge')` → Acknowledge alert
- **Write Target**: `decisions` + `availability_checker_status` tables

#### Lane 1.14: **Owner-Contact Links to Confirm** (SOS weak links)
- **Type**: Built-in; separate call to `/api/review-counts`
- **Render Function**: `renderSosLinkWorklist()` (line 1497)
- **API**: `GET /api/resolve-owner-link?limit=100`
- **Actions**:
  - `resolveOwnerLink(linkId, 'confirm')` → Confirm weak link
  - `resolveOwnerLink(linkId, 'reject')` → Reject link
- **Write Target**: `sos_owner_links` table via `POST /api/resolve-owner-link`

---

### PAGE 2: **Priority Queue**
- **File**: `ops.js` → `renderPriorityQueuePage(band)` (line 2382)
- **URL/Nav**: `navTo('pagePriorityQueue')`
- **API Endpoint**: `GET /api/priority-queue?limit=150&band=<band>`
- **Handler**: `api/operations.js` → proxies to queue database

**Key Features**:
- Band filter: `All`, `P-BUYER`, `P1`, `P3`, `P5`, `P8`, `P0.4`, `P-CONTACT`
- Each row is an owner entity or property with state-aware CTA:

**Actions** (state-dependent):
- `pqOpenProperty(id)` → Open property detail page (resolve owner → link → create lead)
- `pqOpenGovernmentBuyer(id)` → Open Government Buyer opportunity
- `pqResolveOwner(id)` → Navigate to owner resolution ladder
- `navTo('pageMyWork')` → Bulk "Open top N" action for unlinked properties

**Write Target**: Action creation via `/api/operations?action=open_opportunity` or `/api/operations?action=create_lead`

**Overlap**: "Create Follow-up" appears here via property detail page

---

### PAGE 3: **Data Quality**
- **File**: `ops.js` → `renderDataQualityPage()` (line 3038)
- **URL/Nav**: `navTo('pageDataQuality')`
- **API Endpoints**:
  - `GET /api/entities?action=quality` → summary metrics
  - `GET /api/entities?action=quality_details` → detailed sections
- **Handler**: `api/_handlers/entities-handler.js` (line 50)

**Sub-sections & Actions**:

#### Section 3.1: **Domain Health Summary**
- **Render**: `renderDomainHealthSummary()` (async hydration)
- **API**: `GET /api/domain-health?summary=1`
- **Metrics**: Side-by-side dia/gov charts (sales, ownership, entities, SF-link) over 30 days

#### Section 3.2: **Duplicate Candidates**
- **Render**: Part of `renderDataQualityPage()`
- **Data**: `detail.duplicate_candidates` from `/api/entities?action=quality_details`
- **Actions**:
  - `qualityAddAlias(entityId, name)` → Add alias to entity (also in Low Completeness)
  - `qualityMergeDuplicate(entityIds, names)` → Merge first pair only
  - `createQualityFollowup(title)` → Create follow-up task
- **Write Target**: `entity_aliases` / `entities` (merge) via `/api/entities?action=add_alias` or `/api/entities?action=merge`
- **Overlap Note**: Same merge operation as Lane 1.5 (Duplicate Entities — Merge) and Unified Contacts merge queue

#### Section 3.3: **Unlinked Entities**
- **Data**: `detail.unlinked_entities` from `/api/entities?action=quality_details`
- **Actions**:
  - `qualityLinkIdentity(entityId, name)` → Open entity link dialog
  - `navTo('pageEntities')` → Navigate to Entities page to review
  - `createQualityFollowup(title)` → Create follow-up task
- **Write Target**: `external_identities` via `/api/entities?action=link`

#### Section 3.4: **Stale Identities** (7+ days old)
- **Data**: `detail.stale_identities` from `/api/entities?action=quality_details`
- **Actions**:
  - `qualitySetPrecedence('*', source, 60)` → Prefer source for a field
  - `createQualityFollowup(title)` → Create follow-up task
- **Write Target**: `source_precedence` table

#### Section 3.5: **Low Completeness** (< 60% filled)
- **Data**: `detail.low_completeness` from `/api/entities?action=quality_details`
- **Actions**:
  - `qualityAddAlias(entityId, name)` → Add alias to entity
  - `createQualityFollowup(title)` → Create follow-up task
- **Write Target**: `entity_aliases`

#### Section 3.6: **Orphaned Actions** (entity missing)
- **Data**: `detail.orphaned_actions` from `/api/entities?action=quality_details`
- **Actions**:
  - `navTo('pageTeamQueue')` → Navigate to Team Queue to reassign/delete
- **Write Target**: `action_items` table (via Team Queue)

#### Section 3.7: **Source Precedence**
- **Data**: `detail.source_precedence` from `/api/entities?action=quality_details`
- **Actions**:
  - `qualitySetPrecedence(field, source, precedence)` → Edit precedence rule
- **Write Target**: `source_precedence` table
- **Note**: Manual reconciliation tool; no merge/dedup, just ranking

#### Section 3.8: **Provenance Conflicts** (lazy-loaded)
- **Render**: `renderProvenanceConflictWidgets()` (out-of-band)
- **API**: `GET /api/entities?action=quality_provenance&limit=1` + `GET /api/entities?action=quality_provenance_review_queue&limit=200`
- **Actions**: (similar to Lane 1.6)
  - Set precedence / correct field value
- **Write Target**: `field_provenance` table

#### Section 3.9–3.11: **Domain Data Quality** (dialysis, government, ops)
- **Render**: `renderDiaDataQualityWidgets()`, `renderGovDataQualityWidgets()`, `renderOpsDataQualityWidgets()` (lazy-loaded)
- **API**: Domain-specific queries (dia/gov Supabase)
- **Actions**: Vary by domain (see Dialysis & Gov sections in detail.js)

---

### PAGE 4: **Entities**
- **File**: `ops.js` → `renderEntitiesPage(page)` (line 1197)
- **URL/Nav**: `navTo('pageEntities')`
- **API Endpoint**: 
  - `GET /api/entities?page=<n>&per_page=25` (paginated list)
  - `GET /api/entities?action=search&q=<term>&entity_type=<type>` (search)
- **Handler**: `api/_handlers/entities-handler.js`

**Features**:
- Search by name (≥2 chars, server-side)
- Type filter: `all`, `person`, `organization`, `asset`
- Pagination (25 per page)

**Actions**:
- Click entity → `viewEntity(entityId)` → opens detail slide panel

**Detail Panel Actions**:
- Link to external identity
- Edit name / add alias
- View relationships
- (No merge button directly; must use Data Quality page or Unified Contacts)

**Write Target**: Entity detail mutations via `/api/entities?id=<uuid>` (PATCH)

---

### PAGE 5: **Research**
- **File**: `ops.js` → `renderResearchPage(page)` (line 3788)
- **URL/Nav**: `navTo('pageResearch')`
- **API Endpoint**: `GET /api/queue?view=research&page=<n>&limit=50`
- **Handler**: `api/queue.js` (operations.js sub-route)

**Features**:
- Filter: `Active`, `Completed`, `All`
- Pagination
- Research task list with status + due date + assignee

**Actions**:
- Click task → opens task detail (slide panel or modal)
- `completeResearchTask(taskId, outcome, notes)` → Log completion
- `createFollowup(title, dueDate, assignee)` → Create action from research
- `reopenResearchTask(taskId)` → Reopen task

**Write Target**: `research_tasks` + `action_items` tables

**Overlap**: "Create Follow-up" appears here (also in Data Quality, Priority Queue detail, etc.)

---

### PAGE 6: **Unified Contacts**
- **File**: `contacts-ui.js` → `renderContactsPage()` (line 55)
- **URL/Nav**: `navTo('pageContacts')`
- **API Endpoint**: `GET /api/contacts?action=<action>&<params>`
- **Handler**: `api/_handlers/contacts-handler.js`

**Sub-tabs**:

#### Tab 6.1: **All Contacts** (default tab)
- **Data**: Unified contact list with engagement scoring
- **Search**: By name / email / phone
- **Filter**: Class (business / personal)
- **Sort**: Engagement score descending
- **Actions**:
  - Click contact → open detail slide panel
  - Inline messaging (Teams / WebEx / SMS)

#### Tab 6.2: **Hot Leads**
- **Data**: Filtered view (engagement_score ≥ 60)
- **Actions**: Same as All Contacts

#### Tab 6.3: **Merge Queue**
- **Render**: `buildMergeQueue()` (line 762)
- **Data**: `GET /api/contacts?action=merge_queue`
- **Display**: Match score (%), match method, contact pair
- **Actions**:
  - `executeMerge(queueId, contactA, contactB)` → Merge with A as keeper
  - `dismissMergeAction(queueId)` → Dismiss suggestion
- **Write Target**: `/api/contacts?action=merge` (POST)
- **Overlap Note**: Same merge operation as:
  - Data Quality section 3.2 (Duplicate Candidates)
  - Lane 1.5 (Duplicate Entities — Merge)
  - Priority Queue property detail (cross-vertical owners)

#### Tab 6.4: **Data Quality**
- **Render**: `buildDataQuality()` (line 819)
- **Metrics**: Total, Hot Leads, WebEx Linked, Pending Merges, Stale Emails/Phones
- **Actions**:
  - Load Hot Leads (metric card click)
  - Load Merge Queue (metric card click)
- **Write Target**: N/A (read-only dashboard)

---

### PAGE 7: **Sync Health**
- **File**: `ops.js` → `renderSyncHealthPage()` (line 4635)
- **URL/Nav**: `navTo('pageSyncHealth')`
- **API Endpoints**:
  - `GET /api/connectors?action=list`
  - `GET /api/sync?action=health`
- **Handler**: `api/admin.js` (connectors) + `api/sync.js` (health)

**Sections**:

#### Section 7.1: **Connector Status Cards**
- **Display**: Per-connector status (active, healthy, degraded, error)
- **Actions**:
  - `triggerSync(connectorType)` → Sync Now
  - `reconnectConnector(type)` → Reconnect if disconnected
  - `removeConnector(id, name)` → Delete connector
- **Write Target**: Connector account updates via `/api/connectors`

#### Section 7.2: **Sync Summary**
- **Metrics**: Healthy, Degraded, Errors, Outbound success rate

#### Section 7.3: **Queue Drift**
- **Metrics**: Open SF tasks, last SF pull, estimated gap
- **Status**: Drift flag (red if gap detected)

#### Section 7.4: **Recent Errors**
- **Display**: Unresolved sync errors (if any)
- **Actions**: (varies; often "Reconnect" or "Dismiss")

**Write Target**: Connector state via `/api/connectors`, sync log acknowledgment

---

### PAGE 8: **Ops Health**
- **File**: `ops.js` → `renderOpsHealthPage()` (line 1312)
- **URL/Nav**: `navTo('pageOpsHealth')`
- **API Endpoint**: `GET /api/ops-health`
- **Handler**: `api/admin.js`

**Sections**:
- Failing crons (with retry/inspect actions)
- Stalled workers (restart, inspect logs)
- Open alerts (acknowledge, dismiss)
- Write-failure pile-ups (retry, escalate)

**Actions**:
- `retryJob(jobId)` → Retry failed job
- `restartWorker(workerId)` → Restart stalled worker
- `acknowledgeAlert(alertId)` → Dismiss alert

**Write Target**: Ops state tables (cron status, alert state)

**Note**: Primarily operational; not a user-facing review/dedup surface, but included because it routes to manual intervention.

---

### PAGE 9: **Metrics Dashboard**
- **File**: `ops.js` → `renderMetricsPage()` (line 4314)
- **URL/Nav**: `navTo('pageMetrics')`
- **API Endpoint**: `GET /api/metrics?summary=1`
- **Handler**: `api/operations.js` (proxies to metrics database)

**Sections**:
- Team open actions (count)
- Escalations (count)
- Research completion rate
- Deal velocity (by stage)

**Actions**: (mostly navigation to related pages)
- Click metric → `navTo('pageTeamQueue')` or other detail page

**Write Target**: N/A (read-only dashboard)

---

### PAGE 10: **Inbox (Triage)**
- **File**: `app.js` → `renderInboxTriage()` (called via `navTo('pageInbox')`)
- **URL/Nav**: `navTo('pageInbox')`
- **API Endpoint**: `GET /api/queue?view=inbox&limit=50`
- **Handler**: `api/queue.js`

**Features**:
- Inbox item list (new intake, flagged emails, tasks)
- Status filter (new, triaged, in-progress, cancelled)
- Triage actions

**Actions**:
- `triageItem(itemId, decision)` → Triage (promote, dismiss, snooze)
- Click item → open detail modal (image preview, metadata, extraction results)
- `reextractItem(itemId)` → Re-run extraction
- `dismissItem(itemId)` → Dismiss intake
- `createProperty(intakeId)` → Create property from intake

**Write Target**: `inbox_items` + `intake_staging` + property creation

**Overlap**: Staged intake review also appears in Lane 1.3 (Decision Center)

---

### PAGE 11: **Team Queue**
- **File**: `app.js` → `renderTeamQueue()` (called via various navTo calls)
- **URL/Nav**: `navTo('pageTeamQueue')` or `navTo('pageMyWork')`
- **API Endpoint**: `GET /api/queue?view=team_queue&limit=100`
- **Handler**: `api/queue.js`

**Features**:
- All unresolved action items (across team)
- Filter by assignee, status, priority, domain
- Bulk assignment / triage

**Actions**:
- `reassignItem(itemId, userId)` → Assign to team member
- `escalateItem(itemId, managerId)` → Escalate
- `closeItem(itemId)` → Mark done
- `bulkAssign(itemIds, userId)` → Bulk assign
- `bulkTriage(itemIds, status)` → Bulk change status

**Write Target**: `action_items` table

**Overlap**: Orphaned actions from Data Quality (section 3.6) route here

---

### PAGE 12: **My Work** (Personal Task Board)
- **File**: `app.js` → Personal action items assigned to current user
- **URL/Nav**: `navTo('pageMyWork')`
- **API Endpoint**: `GET /api/operations?action=oversight`
- **Handler**: `api/operations.js`

**Features**:
- Assigned actions (overdue, due today, due later, completed)
- Quick-action buttons

**Actions**:
- Click action → route to property/entity detail page
- Mark complete
- Reassign

**Write Target**: `action_items` table

---

### PAGE 13: **Cadence Dashboard**
- **File**: `ops.js` → `renderCadenceDashboard()`
- **URL/Nav**: Called from Priority Queue page button
- **API Endpoint**: `GET /api/operations?action=cadence_dashboard&limit=200`
- **Handler**: `api/operations.js`

**Features**:
- Outreach cadence status (upcoming/active/completed)
- Contact engagement history
- Cadence stage progression

**Actions**:
- `advanceCadence(cadenceId, nextStage)` → Move to next stage
- `selectProspectingContact(cadenceId, contactId)` → Select contact for outreach
- `logCall(cadenceId, notes)` → Log call activity

**Write Target**: `cadence_events` + `action_items` tables

---

## SUMMARY: OVERLAPPING SURFACES & DUPLICATE WORK TYPES

### **Entity/Contact Merging** (appears in 5 places)
1. **Data Quality** → "Duplicate Candidates" (section 3.2) → `qualityMergeDuplicate()`
2. **Decision Center Lane 1.5** → "Duplicate Entities — Merge" → `dcFed(i, 'merge')`
3. **Decision Center Lane 1.9** → "Junk Entity Names" → `dcVerdict(id, 'merge')`
4. **Unified Contacts Tab 6.3** → "Merge Queue" → `executeMerge()`
5. **Entities page** (detail panel) → Link/merge operations (implicit)

**Issue**: A user doesn't know which merge surface to use. All route to the same underlying `entities` merge endpoint, but UX is fragmented.

---

### **"Create Follow-up" Task** (appears in 6+ places)
1. **Data Quality** → All sections (3.1–3.11) → `createQualityFollowup(title)`
2. **Decision Center lanes** → (implicit in verdict handling, e.g., research verdict)
3. **Priority Queue** → Property detail banner → `createFollowup()`
4. **Research page** → Task completion → `createFollowup()`
5. **Entities page** → (via detail panel, if implemented)
6. **Inbox** → Item triage → (via modal)

**Issue**: Same action, different triggers, inconsistent naming.

---

### **Property Merging** (appears in 2 places)
1. **Decision Center Lane 1.4** → "Property Merges & Duplicates" → `dcFed(i, 'merge')`
2. **Priority Queue** → Property detail → (implicit, via resolve owner action)

**Issue**: Limited visibility; most users likely use Priority Queue without realizing there's a dedicated review lane.

---

### **Owner-Contact Linking** (appears in 3 places)
1. **Decision Center Lane 1.14** → "Owner-Contact Links to Confirm" → `resolveOwnerLink()`
2. **Entities page** → Detail panel → `qualityLinkIdentity()`
3. **Data Quality section 3.3** → "Unlinked Entities" → `qualityLinkIdentity()`

**Issue**: Same work (confirm SOS weak links) appears twice; inconsistent entry points.

---

### **Source Precedence / Provenance Conflict** (appears in 2 places)
1. **Data Quality section 3.4** → "Stale Identities" → `qualitySetPrecedence()`
2. **Data Quality section 3.7** → "Source Precedence" → `qualitySetPrecedence()` (manual edit)
3. **Decision Center Lane 1.6** → "Data Conflicts & Provenance" → `dcFed(i, 'prefer_source')`

**Issue**: Overlapping work; section 3.4 & 3.7 are two views of the same data.

---

## DISTINCT PAGES A USER MUST VISIT FOR ALL MANUAL-REVIEW WORK

**Minimum count: 8 pages**

1. **Decision Center** (Review Console) — 14 decision lanes
2. **Priority Queue** — Owner/property qualification
3. **Data Quality** — Entity completeness, dedup, linkage, provenance
4. **Unified Contacts** — Contact dedup, engagement scoring
5. **Research** — Research task tracking
6. **Inbox** — Staged intake disposition
7. **Team Queue** — Action distribution, escalation
8. **Sync Health** — Connector status, queue drift

**Optional (domain-specific or operational)**:
- Entities page (search/filter, but not required for dedup)
- Metrics Dashboard (read-only, navigation hub)
- Ops Health (alerts, operational issues)
- Cadence Dashboard (outreach tracking, not review/dedup)

---

## DECISION LANE METADATA (for Reference)

| Lane | Type | Count | Intro | Actions | Write Target |
|------|------|-------|-------|---------|--------------|
| 1.1 | confirm_true_owner | variable | Stale-vs-current owner verdicts | correct, stale, research | decisions |
| 1.2 | confirm_buyer_parent + map_sf_parent_account | variable | Confirm sponsors · map to Salesforce | confirm_sponsor, map, research | decisions + SF |
| 1.3 | intake_disposition | variable | Create property · re-extract · dismiss | create_property, research, dismiss | decisions + intake_staging |
| 1.4 | property_merge | variable | Same property? merge or keep distinct | merge, keep_distinct, research | decisions + property edges |
| 1.5 | merge_duplicate_entities | variable | Same entity? merge or keep separate | merge, keep_separate, research | decisions + entity consolidation |
| 1.6 | provenance_conflict | variable | Which value is right? | prefer_source, correct, research | field_provenance + source_precedence |
| 1.7 | pending_update | variable | Apply or reject proposed updates | apply, reject, research | gov_change_events |
| 1.8 | cms_link_suspect | variable | Right clinic for this property? | confirm, break, research | cms_match |
| 1.9 | junk_entity_name | variable | Rename · merge · leave flagged | rename, merge, leave_flagged + bulk | entities |
| 1.10 | implausible_value | variable | Is this sale price real? | correct, accept, research | property financial fields |
| 1.11 | match_disambiguation | variable | Multiple candidates — pick one | pick, create_property, research | intake_staging + property |
| 1.12 | llc_research_dead | variable | Resolve manually · retry · park | resolve_manually, retry, park | decisions + research tasks |
| 1.13 | availability_checker_botblock | variable | Verify listings manually or acknowledge | verify, acknowledge | decisions + availability_checker_status |
| 1.14 | (SOS owner-contact) | variable | Confirm or reject weak links | confirm, reject | sos_owner_links |

---

## RECOMMENDATIONS FOR UX CONSOLIDATION

1. **Centralize entity merging** into a single, reusable modal/panel (called from all 5 surfaces)
   - Route all merge operations through one decision type or unified handler
   - Consistent outcome tracking

2. **Create a "Relationship Work" review lane** in Decision Center for:
   - Owner-contact linking (SOS weak links)
   - Owner-property linking
   - Entity-external-identity linking
   - Currently scattered across Data Quality (3.3), Decision Center (1.14), and Entities page

3. **Consolidate "Provenance Conflict" work** into one place:
   - Merge Data Quality sections 3.4 & 3.7 + Decision Center Lane 1.6
   - Single review lane with both automated alerts + manual precedence editing

4. **Create a "Follow-up Creation" shared component**:
   - Single modal that appears from all 6+ surfaces
   - Consistent field capture (title, due date, assignee, context)
   - Standardized logging in `action_items` + activity trail

5. **Audit decision_type enumeration** in the database:
   - 14 lanes × ~1 decision_type each = 14+ decision types in the decisions table
   - Rationalize down to ~8–10 logical work types (owner, property, entity, provenance, intake, research, availability, junk)
   - Reduce cognitive load for developers + users

6. **Redesign the Priority Queue filter** to surface decision-lane counts:
   - Show "14 decisions pending" badge on the main nav
   - Route to Decision Center, not buried in a secondary page

7. **Unify "Data Quality" metrics** across pages:
   - Same metrics appear in Data Quality page (3.1) + Unified Contacts tab (6.4) + Sync Health (7.2+)
   - Single source of truth; cache the aggregation

---

## FILE LOCATIONS & FUNCTION INDEX

### Frontend Render Functions
- `ops.js` line 1419 → `renderReviewConsolePage()` — Decision Center
- `ops.js` line 1701 → `renderDecisionLane(type)` — Seeded decision lanes (1.1, 1.9, 1.11–1.13)
- `ops.js` line 1864 → `renderBuyerParentLane()` — Lane 1.2
- `ops.js` line 2002 → `renderFederatedLane(type)` — Federated decision lanes (1.3–1.8, 1.10)
- `ops.js` line 1497 → `renderSosLinkWorklist()` — Lane 1.14
- `ops.js` line 2382 → `renderPriorityQueuePage(band)` — Priority Queue
- `ops.js` line 3038 → `renderDataQualityPage()` — Data Quality
- `ops.js` line 1197 → `renderEntitiesPage(page)` — Entities
- `ops.js` line 3788 → `renderResearchPage(page)` — Research
- `ops.js` line 4314 → `renderMetricsPage()` — Metrics
- `ops.js` line 1312 → `renderOpsHealthPage()` — Ops Health
- `ops.js` line 4635 → `renderSyncHealthPage()` — Sync Health
- `contacts-ui.js` line 55 → `renderContactsPage()` — Unified Contacts

### Backend API Handlers
- `api/_handlers/entities-handler.js` — /api/entities (GET/POST/PATCH)
- `api/operations.js` — /api/operations (GET/POST), /api/decisions, /api/decision-verdict, /api/context, /api/chat
- `api/queue.js` — /api/queue (research, inbox, team_queue, work_counts)
- `api/admin.js` — /api/connectors, /api/sync, /api/ops-health, /api/metrics
- `api/_handlers/contacts-handler.js` — /api/contacts (merge_queue, link, search, etc.)
- `api/_handlers/folder-feed.js` — /api/folder-feed-tick (SharePoint intake pipeline)
- `api/_handlers/intake-extractor.js` — /api/intake (extraction, staging)

### Core Decision Logic
- `ops.js` line 2193 → `dcVerdict(id, verdict, payload)` — Records decision verdict
- `ops.js` line 2046 → Decision verdict POST to `/api/decision-verdict`
- `ops.js` line 1845 → `applyExactMerge(btn)` — Bulk merge within junk bucket
- `ops.js` line 3930 in operations.js → `qualityMergeDuplicate()` — Quality page merge

### Contact Merging
- `contacts-ui.js` line 787 → `executeMerge(queueId, contactA, contactB)` — Unified Contacts merge
- `app.js` line 3965 → `ucMerge(keepId, mergeId, queueId)` — Contact merge handler

---

## Conclusion

The Life Command Center has built a comprehensive manual-review ecosystem with **14 distinct decision lanes + 13 top-level pages**. However, **significant overlap exists in entity merging, follow-up creation, and provenance work**, forcing users to navigate multiple surfaces to complete a single logical task. A UX consolidation pass should aim to:

- **Unify merge operations** into a single reusable component
- **Centralize follow-up task creation** with consistent metadata capture
- **Consolidate provenance/precedence work** into one decision lane
- **Create a "Relationship Work" lane** for all linking operations
- **Expose decision lane counts** in the main navigation to improve discoverability

The current architecture is **functional but fragmented**, with users needing to understand which of 5+ merge surfaces to use, which of 6+ follow-up creation flows to invoke, and which page owns a given piece of work.

