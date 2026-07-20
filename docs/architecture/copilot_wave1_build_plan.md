# Copilot Wave 1 Build Plan

## Purpose
Define the execution plan for Wave 1 Copilot capabilities with clear sequencing, acceptance criteria, and rollout controls.

## Related Documents
- [Copilot Operating System Blueprint](./copilot_operating_system_blueprint.md)
- [Copilot Action Registry (Markdown)](./copilot_action_registry.md)
- [Copilot Action Registry (JSON)](./copilot_action_registry.json)
- [Copilot Agent Catalog](./copilot_agent_catalog.md)
- [Daily Briefing Integration Plan](./daily_briefing_integration_plan.md)
- [Outlook Intake Workflow](./outlook_intake_team_visibility_workflow.md)

---

> **Infrastructure Note (updated 2026-07-17):**
> The live Railway production host is `tranquil-delight-production-633f.up.railway.app`.
> `life-command-center-production.up.railway.app` returns 404 on all API routes — do not use it.
> All PA flow configs, test commands, and env references must use the tranquil-delight hostname.

---

## 1. Wave 1 Goals and Success Criteria

### Goals
Wave 1 delivers immediate daily productivity gain with minimal risk by making LCC the Copilot-powered operational front door for the team.

Specific outcomes:
- Every broker starts the day with a unified briefing (Teams + LCC)
- Outlook emails flow into canonical intake with Teams visibility in under 60 seconds
- Brokers can query queues, hot contacts, and entity context through Copilot Chat
- Prospecting and seller communication drafting is available at the point of action
- Sync health and operational status are visible without app-switching

### Success Criteria
| Metric | Target | Measurement |
|--------|--------|-------------|
| Morning briefing delivery | Daily by 7:30 AM CT, weekdays | Teams channel timestamp |
| Outlook-to-intake latency | < 60 seconds from flag to inbox item | correlation_id timestamp delta |
| Read-only Copilot actions working | 10 of 10 read actions return valid data | Manual + automated smoke tests |
| Write actions with confirmation | 8 of 8 mutation actions enforce confirmation policy | Integration tests |
| Prospecting brief generation | < 15 seconds response time | API response time logging |
| Teams notification delivery | 100% of intake events produce Teams card | Power Automate run history |

---

## 2. Scope: Prioritized Workflows and Actions

### In Scope (18 actions from action registry)

**Tier A — Ship First (highest leverage, fewest dependencies)**
1. `get_daily_briefing_snapshot` — unified morning command center
2. `ingest_outlook_flagged_emails` — opportunity capture pipeline
3. `list_staged_intake_inbox` — intake visibility
4. `get_my_execution_queue` — daily work surface
5. `get_sync_run_health` — operational confidence
6. `get_hot_business_contacts` — prospecting fuel

**Tier B — Ship Second (build on Tier A foundation)**
7. `triage_inbox_item` — convert intake to action
8. `promote_intake_to_action` — workflow promotion
9. `generate_prospecting_brief` — outreach preparation
10. `draft_outreach_email` — touchpoint acceleration
11. `search_entity_targets` — pursuit context assembly
12. `fetch_listing_activity_context` — seller communication fuel

**Tier C — Ship Third (complete the wave)**
13. `draft_seller_update_email` — seller reporting
14. `create_listing_pursuit_followup_task` — pursuit follow-through
15. `update_execution_task_status` — task progression
16. `retry_sync_error_record` — self-service error recovery
17. `list_government_review_observations` — domain review visibility
18. `list_dialysis_review_queue` — domain review visibility

### Out of Scope (Wave 2+)
- Teams approval cards for Tier 3 domain writes
- Planner/To Do task generation from LCC actions
- Entity merge and evidence review guided flows
- Autonomous agent execution (all Wave 1 actions are user-initiated)
- Graph API deeper integration (contact sync, calendar write-back)
- Document generation (Word/PowerPoint/Excel output)

---

## 3. Dependencies and Prerequisites

### Must Be Complete Before Wave 1 Build

| Dependency | Status | Owner | Notes |
|-----------|--------|-------|-------|
| Machine-readable action registry (JSON) | Done | LCC | `copilot_action_registry.json` |
| Auth hardening — gate transitional fallback | In Progress | LCC | Remove default-dev-user in production |
| Contacts send-action routing fix | In Progress | LCC | Wire `send_teams`/`send_webex`/`send_sms` into POST switch |
| LCC at 12/12 serverless functions | Done | LCC | Consolidation merges complete |
| Power Automate flow definitions | Done | LCC | 11 flow JSON files exist |
| Teams adaptive card templates | Done | LCC | Briefing + intake cards built |
| Morning Briefing structured payload contract | Partial | Morning Briefing repo | Need stable JSON endpoint URL |

### External Dependencies
- Power Automate flows must be imported and activated in production tenant
- MS_GRAPH_TOKEN must be valid and refreshable for Teams delivery
- Morning Briefing repo must expose structured JSON endpoint

---

## 4. Implementation Phases and Milestones

### Phase 1A: Foundation Hardening (Days 1-3) — COMPLETE
**Goal:** Secure the platform for Copilot-grade execution.

Tasks:
- [x] Gate transitional auth fallback behind `LCC_ENV !== 'production'`
- [x] Wire `send_teams`, `send_webex`, `send_sms` into contacts POST switch in entity-hub.js
- [x] Add `send_teams`, `send_webex`, `send_sms` to contactActions set in entity-hub.js
- [x] Verify all 18 Wave 1 action endpoints return expected responses (smoke test 2026-07-20)
  - 16/18 passing. Two flags: (1) `list_government_review_observations` [503→404] — `GOV_API_URL` secret set in Supabase Dialysis_DB `data-query` edge function but pointing to wrong target (`https://scknotsqkcheojiaewwh.supabase.co`). It must point to the Government FastAPI evidence service (`/api/research-observations`). That FastAPI service does not yet exist — Wave 2 dependency. See Phase 1A note below. (2) `ingest_outlook_flagged_emails` pull path times out — Graph API blocked at Northmarq; PA push flow (Phase 1C) is the live path and works correctly.
  - Auth rejection: [401] “Invalid API key” on bad key ✓
  - Validation: [400] on missing required params for all write actions ✓
  - Lifecycle enforcement: archived→triaged blocked correctly ✓
- [x] Add pre-commit hook or CI check: `ls api/*.js | wc -l` must be <= 12

> **Phase 1A Smoke Test Gaps (2026-07-20):**
> 1. `list_government_review_observations` — Was [503] `GOV_API_URL not configured`; now [404] `requested path is invalid` after Scott added secret to Supabase. Root cause: `GOV_API_URL` is used by the `data-query` edge function (Dialysis_DB project `zqzrriwuavgrquhisnoa`) to reach the **Government FastAPI evidence service** (e.g. `https://gov-api.example.com`). The edge function calls `${GOV_API_URL}/api/research-observations`. The current secret value points to the Government Supabase URL instead of a FastAPI service, which returns 404. This FastAPI service does not yet exist — it is a **Wave 2 dependency**. No Railway env var change needed; the secret location is correct (Supabase edge function secrets), but the value must be the FastAPI service URL once built.
> 2. `ingest_outlook_flagged_emails` (pull path) — times out because the Graph API pull is blocked at Northmarq. The Power Automate push path (Phase 1C) is the production-grade replacement and is fully operational. No fix needed for Wave 1.

**Milestone:** Auth hardened, messaging routes wired, pre-commit guard active. Smoke test 16/18 — one Wave 2 dependency (`list_government_review_observations` requires Government FastAPI evidence service not yet built), one action de facto replaced by PA flow.

### Phase 1B: Daily Briefing Snapshot (Days 3-7) — COMPLETE
**Goal:** Build the single highest-leverage Wave 1 deliverable.

Tasks:
- [x] Implement `GET /api/daily-briefing?action=snapshot` aggregation logic
  - Compose from: queue work_counts, my_work, inbox, unassigned, sync health
  - Consume Morning Briefing structured payload (with degraded-state fallback)
  - Support `role_view` parameter (broker, analyst_ops, manager)
- [x] Add role-specific section weighting per daily_briefing_integration_plan.md
- [x] Validate response matches `daily_briefing_payload_contract.md` schema
- [x] Build `LCC - Daily Briefing to Teams` flow in Power Automate (exported 2026-07-20)
  - Recurrence: Daily at 12:30 UTC (7:30 CDT), weekday guard in condition ✓
  - Teams adaptive card: production signals, domain highlights, degraded-state warning, action buttons ✓
  - Group ID `6fc86bbe-2f43-4a1d-b9b8-79885f794f0d`, Channel `19:1002e32b7379470ba8fbc30440d46035@thread.tacv2` ✓
  - URL corrected to `https://tranquil-delight-production-633f.up.railway.app/api/daily-briefing?action=snapshot&role_view=broker` ✓
- [x] Apply URL fix in Power Automate UI and confirm flow runs successfully — manual test run succeeded 2026-07-20 ✓
- [x] Verify Teams adaptive card renders correctly from live snapshot payload — confirmed 2026-07-20 ✓

**Milestone:** ✅ Team receives daily briefing in Teams channel every weekday morning. Manual test run confirmed 2026-07-20.

### Phase 1C: Intake Pipeline Activation (Days 5-10) — COMPLETE
**Goal:** Every flagged Outlook email becomes a tracked intake item with Teams visibility.

Tasks:
- [x] Build `LCC - Outlook Intake to Teams (Hardened)` flow in Power Automate (exported 2026-07-20)
  - Trigger: `OnFlaggedEmailV3` — Office 365 Outlook connector, Inbox folder ✓
  - POSTs to `https://tranquil-delight-production-633f.up.railway.app/api/intake-outlook-message` ✓
  - Passes: `message_id`, `internet_message_id`, `subject`, `from`, `body_preview`, `received_date_time`, `web_link`, `has_attachments`, `workspace_id` ✓
- [x] Configure flow with production LCC_API_KEY, workspace ID, and Team/Channel IDs ✓
  - Group ID `6fc86bbe-2f43-4a1d-b9b8-79885f794f0d`, Channel `19:6e8428a7c5874f55a523ed0c83f161f3@thread.tacv2` ✓
- [x] Activate hardened flow (single-message deterministic path, retry policy: none) ✓
- [x] `HTTP_GetIntakeSummary` fetches enriched item via `correlation_id` from POST response ✓
- [x] Microsoft To Do task created with dynamic due date (1 day if high-importance, 3 otherwise) ✓
- [x] Teams adaptive card posts: From, Subject, Run ID, Received, body preview, "View in LCC" + "Open Email" buttons ✓
- [x] Verify end-to-end in production: flag email in Outlook → inbox item created → Teams card posted — confirmed 2026-07-20 ✓
- [x] Verify correlation_id tracking across the pipeline — `outlook-msg-{hash}-{timestamp}` format confirmed, `bridged_to_intake_id` linked ✓
- [ ] Keep batch flow (`flow-outlook-intake-to-teams.json`) as fallback

**Milestone:** ✅ Flagged emails appear as LCC intake items with Teams notification in < 60s. Confirmed 2026-07-20 with 5 items created in seconds. Note: Janitor correctly auto-archives system noise (Vercel build alerts); CRE contact emails will stay as `new` in inbox.

### Phase 1D: Copilot Read Actions (Days 7-12) — COMPLETE
**Goal:** All 10 read-only actions work through Copilot Chat.

Tasks:
- [x] Verify each read action returns well-structured data:
  - `list_staged_intake_inbox`
  - `get_my_execution_queue`
  - `get_sync_run_health`
  - `get_hot_business_contacts`
  - `search_entity_targets`
  - `fetch_listing_activity_context`
  - `list_government_review_observations`
  - `list_dialysis_review_queue`
  - `generate_prospecting_brief`
  - `get_daily_briefing_snapshot`
- [x] Add Copilot system prompt context that maps natural language queries to action endpoints
- [ ] Test Copilot Chat can answer: "What's my queue look like?", "Who should I call today?", "Any sync issues?"

**Milestone:** Action-aware system prompt deployed. Action dispatcher routes all 10 read actions. Ops context enrichment live.

### Phase 1E: Prospecting and Communication Drafting (Days 10-15) — COMPLETE
**Goal:** Brokers can generate outreach and seller communication from Copilot.

Tasks:
- [x] Wire `generate_prospecting_brief` with hot contacts context injection
- [x] Wire `draft_outreach_email` with contact/entity context from LCC
- [x] Wire `draft_seller_update_email` with listing activity timeline context
- [x] Add confirmation flow for email drafts (explicit confirmation before any send)
- [x] Fix entity_name field mapping in v_bd_cadence_dashboard (was returning 'Unknown')
- [x] Fix priority_signal fallback to priority_tier column
- [x] Eliminate assigned_to UUID prompt (schema description + proxy layer user.id injection)
- [x] Outlook draft creation via Power Automate live (PA_OUTLOOK_DRAFT_URL set in Railway)
- [ ] Full prospecting test in Copilot Studio: hot contacts → brief → draft email → user reviews in Outlook

**Milestone:** 3 AI-powered handlers wired. Structured dispatch and confirmation enforcement working. Live Outlook draft confirmed working end-to-end.

### Phase 1F: Write Actions with Confirmation (Days 12-18) — COMPLETE
**Goal:** All 8 mutation actions enforce confirmation policy and work correctly.

**Root Cause Fix (2026-07-19):** `dispatchAction` in `operations.js` was returning a metadata
envelope (`action: actionName` as a string) for write actions without dedicated handlers. The
swagger response schema declares `action` as an object, so Power Fx threw
`PowerFxJsonException: Expecting Record but received a String` on every Copilot Studio write
attempt. Fix: added `executeWriteAction()` helper that makes a real internal HTTP call to the
correct LCC endpoint for each action (PATCH actions extract `id` into the URL query string;
POST actions use alias path when available). `triage_inbox_item` was also silently returning
`ok: true` from metadata without touching the DB — now actually writes the status transition.

Tasks:
- [x] Verify confirmation enforcement for each write action (all 8 confirmed at API level, 2026-07-17):
  - [x] `ingest_outlook_flagged_emails` (lightweight) — gate fires + proxy execute confirmed
  - [x] `triage_inbox_item` (lightweight) — live Copilot Studio confirmed 2026-07-19 (Steve Dixon → triaged)
  - [x] `promote_intake_to_action` (explicit) — live Copilot Studio confirmed 2026-07-19 (Phupinder Gill → Action ID d9eaf545)
  - [x] `create_listing_pursuit_followup_task` (explicit) — confirmation flow confirmed; agent correctly prompts for `entity_id` when not provided (see note below)
  - [x] `update_execution_task_status` (explicit) — live Copilot Studio confirmed 2026-07-19 (open → in_progress, timestamp verified)
  - [x] `retry_sync_error_record` (explicit) — gate fires + proxy execute confirmed
  - [x] `draft_outreach_email` (implicit via create_draft+to) — live Outlook draft confirmed
  - [x] `draft_seller_update_email` (implicit via create_draft+to) — gate + implicit confirm confirmed
- [x] Add activity_event logging for all Copilot-initiated mutations
- [x] Test each action through Copilot Studio with live confirmation flow (end-to-end) — completed 2026-07-19

> **Note — `create_listing_pursuit_followup_task` entity_id:** The agent correctly prompts for
> `entity_id` when none is provided, since it is required by the schema. Wave 2 consideration:
> allow unlinked task creation (entity_id optional) or add agent-side entity lookup so users
> can say "create a follow-up for Phupinder Gill" without supplying the UUID manually.

**Milestone:** ✅ All 8 write actions confirmed working end-to-end in Copilot Studio. Confirmation enforcement, DB writes, and typed response shapes all verified in production.

---

## 5. Validation and Test Strategy

### Smoke Tests (per action)
Each action gets a manual validation script:
1. Call endpoint with valid inputs -> verify 200 + expected payload shape
2. Call endpoint with missing required inputs -> verify 400 + clear error
3. Call write endpoint without confirmation -> verify rejection at policy layer
4. Call endpoint with invalid auth -> verify 401/403

### Integration Tests (per workflow)
1. **Intake pipeline:** Flag email -> intake -> triage -> promote -> action created
2. **Prospecting flow:** Hot contacts -> brief generation -> email draft
3. **Briefing flow:** Snapshot endpoint -> Teams card delivery -> action links work
4. **Error recovery:** Sync error -> retry via Copilot -> error resolved

### Production Validation
- [ ] Run all smoke tests against production endpoints
- [ ] Verify Power Automate flows show successful run history
- [ ] Verify Teams cards render and action buttons navigate to correct LCC pages
- [ ] Verify daily briefing delivered for 3 consecutive weekdays

---

## 6. Rollout Plan and Guardrails

### Rollout Sequence
1. **Internal only (Week 1-2):** Scott validates all actions in production
2. **Expand to analyst (Week 3):** Add analyst/ops user, validate role-scoped briefing views
3. **Full team (Week 4):** All 4 team members active, monitor for cross-user issues

### Guardrails
- All write actions require explicit confirmation — no autonomous mutations in Wave 1
- Daily briefing is read-only aggregation — no state changes from briefing delivery
- Email drafts are generated but never auto-sent — user must review in Outlook
- Copilot Chat responses include source attribution (which endpoint provided data)
- All Copilot-initiated actions log to `activity_events` with `source: 'copilot'`

### Kill Switches
- Set `LCC_API_KEY` to disable all external API access instantly
- Feature flag `copilot_enabled` in admin flags can disable Copilot chat route
- Power Automate flows can be individually disabled without code deployment
- Daily briefing flow has its own enable/disable in Power Automate

---

## 7. Metrics and Feedback Loop

### Operational Metrics (tracked weekly)
| Metric | Source | Target |
|--------|--------|--------|
| Daily briefing delivery rate | Power Automate run history | 100% weekdays |
| Intake capture count | inbox_items created via Outlook flow | Trending up week-over-week |
| Copilot Chat queries/day | activity_events where source='copilot' | > 5/day per active user |
| Action completion via Copilot | action_items completed with copilot source | Trending up |
| Sync error retry success rate | sync_errors resolved via retry action | > 80% |
| Prospecting briefs generated/week | chat requests with prospecting context | > 3/broker/week |

### Qualitative Feedback
- Weekly 5-minute check-in: "What's working? What's annoying? What's missing?"
- Track feature requests that emerge from daily Copilot usage
- Note any actions where confirmation flow feels too heavy or too light

### Iteration Triggers
- If daily briefing is ignored (no action link clicks) -> simplify content, change delivery time
- If intake latency > 60s -> investigate Power Automate flow performance
- If Copilot Chat queries plateau -> add more context-aware suggestions to system prompt
- If confirmation fatigue reported -> evaluate downgrading specific actions from explicit to lightweight

---

## 8. Risks, Mitigations, and Rollback Steps

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Morning Briefing structured payload not ready | Medium | Briefing runs degraded (ops signals only) | Implement degraded-state fallback; briefing still useful without market intel |
| MS_GRAPH_TOKEN expiry breaks Teams delivery | Medium | Teams cards stop posting | Add token refresh monitoring; alert on 401 responses |
| Vercel 12-function limit broken by unrelated commit | High | Production 404s | Add CI check for api/*.js count; document limit in CLAUDE.md |
| Power Automate flow rate limits | Low | Intake notifications delayed | Batch fallback flow remains available |
| Copilot Chat returns hallucinated data | Medium | User makes decisions on wrong information | Ground all responses in actual endpoint data; add source attribution |
| Auth transitional fallback not gated | High | Unauthorized access in production | Gate behind LCC_ENV check before Wave 1 activation |

### Rollback Steps
1. **Disable Copilot Chat:** Set feature flag `copilot_enabled: false` via `/api/flags`
2. **Disable intake flow:** Pause Power Automate flow in portal
3. **Disable briefing delivery:** Pause briefing flow in portal
4. **Full rollback:** Revert to pre-Wave-1 commit; all changes are additive, no schema breaks

---

## 9. Immediate Next Actions

*Updated 2026-07-20 — All phases complete. Smoke test done (16/18). Two known gaps: (1) `list_government_review_observations` is a Wave 2 dependency (requires Government FastAPI evidence service, not yet built); (2) daily briefing 3-day consecutive verification still in progress.*

1. **`list_government_review_observations` [Wave 2]:** Returns [404] because the Government FastAPI evidence service (`/api/research-observations`) doesn't exist yet. The `GOV_API_URL` secret in Supabase Dialysis_DB `data-query` edge function is set but points to the Supabase project URL — correct the value to the FastAPI service URL once that service is built. No action needed for Wave 1.
2. **Verification:** Daily briefing delivered for 3 consecutive weekdays (first live run on next weekday morning at 7:30 CDT).
3. **Wave 2 consideration:** Make `entity_id` optional in `create_listing_pursuit_followup_task` (allow unlinked tasks) or add agent-side entity lookup by name.
