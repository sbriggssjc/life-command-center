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

### Phase 1A: Foundation Hardening (Days 1-3)
**Goal:** Secure the platform for Copilot-grade execution.

Tasks:
- [ ] Gate transitional auth fallback behind `LCC_ENV !== 'production'`
- [ ] Wire `send_teams`, `send_webex`, `send_sms` into contacts POST switch in entity-hub.js
- [ ] Add `send_teams`, `send_webex`, `send_sms` to contactActions set in entity-hub.js
- [ ] Verify all 18 Wave 1 action endpoints return expected responses (manual smoke test)
- [ ] Add pre-commit hook or CI check: `ls api/*.js | wc -l` must be <= 12

**Milestone:** All existing endpoints healthy, auth hardened, messaging routes wired.

### Phase 1B: Daily Briefing Snapshot (Days 3-7)
**Goal:** Build the single highest-leverage Wave 1 deliverable.

Tasks:
- [ ] Implement `GET /api/daily-briefing?action=snapshot` aggregation logic
  - Compose from: queue work_counts, my_work, inbox, unassigned, sync health
  - Consume Morning Briefing structured payload (with degraded-state fallback)
  - Support `role_view` parameter (broker, analyst_ops, manager)
- [ ] Add role-specific section weighting per daily_briefing_integration_plan.md
- [ ] Validate response matches `daily_briefing_payload_contract.md` schema
- [ ] Activate `flow-daily-briefing-to-teams.json` in production Power Automate
- [ ] Verify Teams adaptive card renders correctly from snapshot payload

**Milestone:** Team receives daily briefing in Teams channel every weekday morning.

### Phase 1C: Intake Pipeline Activation (Days 5-10)
**Goal:** Every flagged Outlook email becomes a tracked intake item with Teams visibility.

Tasks:
- [ ] Verify `flow-outlook-intake-to-teams-hardened.json` is imported in Power Automate
- [ ] Configure flow with production LCC_API_KEY, workspace ID, and Team/Channel IDs
- [ ] Activate hardened flow (single-message deterministic path)
- [ ] Test end-to-end: flag email in Outlook -> inbox item created -> Teams card posted
- [ ] Verify correlation_id tracking across the pipeline
- [ ] Keep batch flow (`flow-outlook-intake-to-teams.json`) as fallback

**Milestone:** Flagged emails appear as LCC intake items with Teams notification in < 60s.

### Phase 1D: Copilot Read Actions (Days 7-12)
**Goal:** All 10 read-only actions work through Copilot Chat.

Tasks:
- [ ] Verify each read action returns well-structured data:
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
- [ ] Add Copilot system prompt context that maps natural language queries to action endpoints
- [ ] Test Copilot Chat can answer: "What's my queue look like?", "Who should I call today?", "Any sync issues?"

**Milestone:** Copilot Chat can answer operational questions using real LCC data.

### Phase 1E: Prospecting and Communication Drafting (Days 10-15)
**Goal:** Brokers can generate outreach and seller communication from Copilot.

Tasks:
- [ ] Wire `generate_prospecting_brief` with hot contacts context injection
- [ ] Wire `draft_outreach_email` with contact/entity context from LCC
- [ ] Wire `draft_seller_update_email` with listing activity timeline context
- [ ] Add confirmation flow for email drafts (explicit confirmation before any send)
- [ ] Test prospecting flow: hot contacts -> brief -> draft email -> user reviews in Outlook

**Milestone:** Broker can go from "Who should I call?" to a personalized email draft in under 2 minutes.

### Phase 1F: Write Actions with Confirmation (Days 12-18)
**Goal:** All 8 mutation actions enforce confirmation policy and work correctly.

Tasks:
- [ ] Verify confirmation enforcement for each write action:
  - `ingest_outlook_flagged_emails` (lightweight)
  - `triage_inbox_item` (lightweight)
  - `promote_intake_to_action` (explicit)
  - `create_listing_pursuit_followup_task` (explicit)
  - `update_execution_task_status` (explicit)
  - `retry_sync_error_record` (explicit)
  - `draft_outreach_email` (explicit — draft only, no send)
  - `draft_seller_update_email` (explicit — draft only, no send)
- [ ] Add activity_event logging for all Copilot-initiated mutations
- [ ] Test each action through Copilot Chat with confirmation flow

**Milestone:** All 18 Wave 1 actions operational with correct risk tier enforcement.

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
- Email drafts are generated but never auto-sent — user must copy to Outlook manually
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

1. Complete auth hardening (gate transitional fallback)
2. Complete contacts messaging route fix
3. Implement daily briefing snapshot aggregation
4. Import and activate hardened Outlook intake flow in Power Automate
5. Import and activate daily briefing Teams flow in Power Automate
6. Validate all 10 read-only actions return expected data
7. Begin prospecting flow wiring
