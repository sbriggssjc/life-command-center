# Touchpoint Execution Agent — Build Roadmap

**Goal:** Turn LCC from a "data + drafting" system into a 1-click outbound machine that knows who to contact → why → drafts it → logs it → learns from it.

---

## What Already Exists (80% Foundation)

| Capability | Status | Where |
|---|---|---|
| Context Packets (property + contact) | ✅ Built | `context_packets` table, operations.js |
| Template Library | ✅ Built | `templates` table, `_shared/templates.js` |
| Template Send Tracking | ✅ Built | `template_sends` with edit_distance_pct, opened, replied, deal_advanced |
| Template Refinement Engine | ✅ Built | `_shared/template-refinement.js` — flags high-edit templates, suggests rewrites |
| Signal Feedback Loop | ✅ Built | `_shared/signals.js`, `signal_feedback_rules` table |
| Copilot Action Dispatch | ✅ Built | 15 operations via Copilot Studio custom connector |
| Draft Outreach Email | ✅ Built | `draft_outreach` handler in operations.js |
| Draft Seller Update | ✅ Built | `draft_seller_update` handler |
| Batch Draft Generation | ✅ Built | `generate_batch_drafts` action |
| Listing BD Pipeline | ✅ Built | `run_listing_bd_pipeline` action |
| Record Template Send | ✅ Built | `record_template_send` action → logs to template_sends |
| Workflow Engine (My Work) | ✅ Built | `queue-v2` views, execution queue |

## What's Missing (The Last 20%)

### Phase 1: Smart Template Selection Engine (1-2 days)

**Current state:** User manually picks a template or the AI drafts from scratch.
**Target state:** System auto-selects the best template based on context signals.

**Build:**
- New function `selectOptimalTemplate(contact, entity, relationship_stage)` in `_shared/templates.js`
- Decision logic:
  ```
  IF owner + no prior touch + lease < 5yr remaining → T-001 First Touch (lease-expiry angle)
  IF owner + prior touch + no response 30d → T-003 Follow-Up (market update angle)
  IF buyer + downloaded OM + no response 48hr → T-006 OM Follow-Up (urgency)
  IF owner + active listing + weekly cadence → T-010 Seller Update
  ```
- Feed `template_sends` performance data into selection: prefer templates with higher reply rates for similar contact/property profiles
- Expose as new action: `suggest_template` (Tier 0, read-only)

### Phase 2: Personalization Engine (1-2 days)

**Current state:** AI drafts reference general context. Sometimes generic.
**Target state:** Every draft is forced to use specific data points from the contact/property packet.

**Build:**
- Update `handleDraftOutreachEmail` to ALWAYS pull the contact's context packet before drafting
- Inject mandatory personalization fields into the AI prompt:
  - `relationship.last_touchpoint` (date + type)
  - `deal_history` (prior transactions, if any)
  - `property.lease_remaining`, `property.cap_rate`, `property.tenant_credit`
  - `market.recent_comps` (nearby sales)
  - `suggested_outreach.angle` (from template selector)
- Add prompt guard: "You MUST reference at least 2 specific data points from the contact/property context. Never use generic phrases like 'we specialize in net lease.'"
- **Owner targeting rule:** System prompt must include: "The BD target is the property OWNER (landlord/investor), never the tenant/operator. When a property is leased to DaVita/GSA/Fresenius, the email goes to the person or entity that owns the real estate."

### Phase 3: Touchpoint Execution Layer (2-3 days)

**Current state:** Agent drafts email → user copies to Outlook manually.
**Target state:** One-click: Generate → Review → Send → Log → Signal.

**Build:**
- New action: `execute_touchpoint` (Tier 2, explicit confirmation)
  - Input: `{ contact_id, template_id?, intent, channel: "email"|"call_log" }`
  - Steps:
    1. Pull contact context packet
    2. Auto-select template (Phase 1) or use provided template_id
    3. Generate personalized draft (Phase 2)
    4. Return draft for review
    5. On `_confirmed: true` with `_send: true`:
       - Send via Outlook API (MS Graph `sendMail`)
       - Log to `template_sends` with context_packet_id
       - Write signal to `copilot_signals`
       - Create follow-up To Do task (if cadence says so)
       - Update contact's `last_touchpoint` in entity hub
- Requires: `MS_GRAPH_TOKEN` with `Mail.Send` permission (same token needed for To Do)

### Phase 4: Batch Segment Execution (1-2 days)

**Current state:** `generate_batch_drafts` exists but requires manual send.
**Target state:** "Email all 85 government owners" → personalized batch with pacing.

**Build:**
- New action: `execute_batch_touchpoints` (Tier 3, explicit confirmation)
  - Input: `{ segment_filter, template_id?, intent, pacing_minutes: 2 }`
  - Steps:
    1. Query contacts matching segment filter
    2. For each contact: pull packet → select template → personalize → queue
    3. Show preview of first 3 drafts for approval
    4. On confirmation: send with pacing (2-min intervals for deliverability)
    5. Log all sends, write signals, create follow-up tasks
- Add `batch_execution_runs` table to track batch status and results

### Phase 5: Outreach Effectiveness Engine (Ongoing)

**Current state:** `template_sends` tracks opens, replies, deal_advanced. `template-refinement.js` flags underperformers.
**Target state:** Per-contact learning that feeds back into template selection and timing.

**Build:**
- New materialized view: `mv_contact_outreach_effectiveness`
  - Per contact: response_rate, preferred_channel, best_subject_patterns, best_time_of_day
  - Per segment: avg_response_by_template, avg_response_by_angle
- Feed into `selectOptimalTemplate` (Phase 1)
- Feed into `execute_touchpoint` timing recommendations
- New briefing section: "Outreach Effectiveness This Week" — touches sent, response rate, meetings booked
- Track KPI: **Touches per hour per broker** (the real leverage metric)

### Phase 6: BD Command Center Metrics

**Build:**
- New action: `get_bd_metrics` (Tier 0)
  - Output: emails_sent_today, emails_sent_week, response_rate, meetings_booked, avg_edit_distance, touches_per_hour
- Surface in daily briefing as "BD Performance" section
- Add to Copilot Studio agent as a tool

---

## Recommended Build Order

| Priority | Phase | Effort | Impact |
|---|---|---|---|
| 🔴 Now | Phase 2: Personalization Engine | 1 day | Immediate draft quality improvement |
| 🔴 Now | Agent Instructions Update | 30 min | Fix owner vs tenant targeting |
| 🟡 Next | Phase 1: Smart Template Selection | 1-2 days | Reduces decision fatigue |
| 🟡 Next | Phase 3: Touchpoint Execution | 2-3 days | The "1-click send" unlock |
| 🟢 Soon | Phase 5: Effectiveness Engine | 1-2 days | Compounding intelligence |
| 🟢 Soon | Phase 4: Batch Execution | 1-2 days | Scale multiplier |
| 🔵 Later | Phase 6: BD Metrics | 1 day | Behavior change + accountability |

---

## MS Graph Token Setup (Required for Phase 3)

To enable send-from-Outlook and To Do task creation:

1. Go to **Azure Portal** → **Entra ID** → **App Registrations** → New Registration
2. Name: "LCC API Integration"
3. Permissions: `Mail.Send`, `Tasks.ReadWrite`, `User.Read`
4. Grant admin consent
5. Create client secret
6. Store in Vercel env vars: `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_TENANT_ID`
7. Implement token refresh flow in `_shared/graph-auth.js`

This replaces the current static `MS_GRAPH_TOKEN` with a proper OAuth flow.
