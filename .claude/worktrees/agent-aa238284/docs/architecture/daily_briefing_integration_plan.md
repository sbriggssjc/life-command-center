# Daily Briefing Integration Plan

## Purpose
Integrate the existing Morning CRE / market briefing system into one unified LCC Daily Briefing Agent so the team has a single daily operational and intelligence surface.

This plan keeps:
- `life-command-center` (LCC) as Copilot-facing orchestration and interaction layer
- GovernmentProject and DialysisProject as domain execution engines
- Morning briefing system as the market/macro intelligence engine

## Decision Summary
- Build one briefing system, not two.
- Morning briefing repo remains the producer of market intelligence.
- LCC becomes the aggregator, role-aware formatter, and Microsoft surface router.
- LCC should consume **both**:
  - structured briefing payloads (canonical machine-readable source)
  - HTML output (fallback and email-ready rendering)

---

## 1) What stays in Morning Briefing repo vs what lives in LCC

### Morning Briefing repo (intelligence engine)
- Own market/macro/sector data collection and normalization.
- Own synthesis logic in `briefing.py`.
- Own intelligence-specific architecture and setup docs (`architecture.md`, setup docs).
- Produce daily intelligence artifacts:
  - structured JSON payload (required)
  - HTML briefing body (optional but recommended)
- Own intelligence quality logic (source weighting, freshness, narrative generation, citation policy).

### LCC repo (orchestration + user interaction)
- Own Daily Briefing Agent contract for Copilot and Microsoft surfaces.
- Own aggregation of:
  - Morning intelligence payload
  - LCC work/queue/sync signals
  - Government/Dialysis domain signals already available through LCC query paths
- Own role-specific view composition (broker, analyst/ops, manager).
- Own delivery surfaces:
  - LCC homepage cards
  - Teams daily briefing card
  - Outlook fallback digest
- Own action links from briefing into existing LCC workflows (triage, assign, promote, review).

---

## 2) Should LCC consume structured payload, HTML output, or both?

## Recommendation
Consume **both**, with structured payload as authoritative.

### Why structured payload is required
- Enables role-based filtering and section ordering.
- Supports Teams Adaptive Cards and Copilot action grounding.
- Enables deterministic merging with LCC queue/sync/domain signals.
- Supports scoring/prioritization logic for listing-driven production.

### Why HTML should still be consumed
- Fast Outlook fallback with minimal transformation.
- Preserves formatting for narrative morning read.
- Useful for leadership distribution when card rendering is limited.

### Contract precedence
1. Structured JSON is the canonical integration contract.
2. HTML is auxiliary rendering content.
3. If HTML is missing, LCC renders from structured payload.
4. If structured payload is missing, LCC can show HTML-only fallback with a degraded-state flag.

---

## 3) Integration architecture for LCC homepage, Teams, and Outlook fallback

## Proposed flow
1. Morning repo generates daily intelligence artifacts.
2. LCC scheduled orchestrator pulls intelligence artifacts.
3. LCC composes unified briefing by joining intelligence with LCC operational/domain signals.
4. LCC stores a daily snapshot (cache/table/file-backed, implementation choice in LCC).
5. LCC serves role-scoped briefing views to homepage and outbound notification surfaces.

## LCC composition inputs (existing code paths)
- Workload and priorities:
  - `GET /api/queue-v2?view=work_counts`
  - `GET /api/queue-v2?view=my_work`
  - `GET /api/queue-v2?view=inbox`
  - `GET /api/queue-v2?view=research`
- Team routing/manager visibility:
  - `GET /api/workflows?action=unassigned`
  - `GET /api/workflows?action=oversight` (manager only)
- Sync/ingestion risk:
  - `GET /api/sync?action=health`
- Intake recent summaries:
  - `GET /api/intake-summary`
- Domain context available through existing LCC domain query/proxy routes:
  - `GET /api/gov-query` (rewritten to `api/data-proxy?_source=gov`)
  - `GET /api/dia-query` (rewritten to `api/data-proxy?_source=dia`)

## New LCC orchestration endpoint (recommended)
- `GET /api/daily-briefing?action=snapshot` (`to_be_implemented`)
- Behavior:
  - Pull latest Morning structured+HTML artifact
  - Compose with LCC operational/domain signals
  - Return unified payload with role view projection

## Surface mapping
- LCC homepage:
  - Primary JSON-driven cards, optional embedded HTML intelligence section
  - Drill-through links to queue/review actions
- Teams daily briefing:
  - Adaptive Card rendered from unified JSON sections
  - Action buttons: View queue, triage inbox, assign/unassigned, view sync issues
- Outlook fallback:
  - HTML digest body (Morning HTML + LCC operational summary blocks)
  - Deep links back into LCC pages

---

## 4) Proposed Daily Briefing payload schema

```json
{
  "briefing_id": "2026-04-02:workspace:<workspace_id>:user:<user_id_or_team>",
  "as_of": "2026-04-02T11:30:00.000Z",
  "timezone": "America/Chicago",
  "workspace_id": "<workspace_id>",
  "audience": "user|team|manager",
  "role_view": "broker|analyst_ops|manager",
  "status": {
    "completeness": "full|degraded",
    "missing_sections": []
  },
  "global_market_intelligence": {
    "source_system": "morning_briefing",
    "summary": "Top macro + CRE takeaways",
    "highlights": [],
    "sector_signals": [],
    "watchlist": [],
    "html_fragment": "<optional html block>",
    "source_links": []
  },
  "user_specific_priorities": {
    "today_top_5": [],
    "my_overdue": [],
    "my_due_this_week": [],
    "recommended_calls": [],
    "recommended_followups": []
  },
  "team_level_production_signals": {
    "work_counts": {
      "open_actions": 0,
      "inbox_new": 0,
      "research_active": 0,
      "sync_errors": 0,
      "overdue": 0
    },
    "unassigned_work": [],
    "queue_drift": {},
    "open_escalations": []
  },
  "domain_specific_alerts_highlights": {
    "government": {
      "highlights": [],
      "review_required": [],
      "freshness_flags": []
    },
    "dialysis": {
      "highlights": [],
      "review_required": [],
      "freshness_flags": []
    }
  },
  "actions": [
    {
      "label": "Open My Queue",
      "type": "link",
      "target": "/?tab=queue"
    }
  ]
}
```

### Notes
- `global_market_intelligence` should be sourced from Morning payload directly.
- All other sections are LCC-composed.
- `status.completeness` makes degraded modes explicit and auditable.

---

## 5) User role views

## Broker view
- Priority on:
  - top calls/follow-ups
  - listing pursuit tasks due today/this week
  - key market talking points for owner/buyer outreach
- Reduced ops noise; only blocking sync/domain issues shown.

## Analyst / Operations view
- Priority on:
  - intake backlog
  - triage/review queues
  - sync errors and queue drift
  - domain review-required items (gov/dia)
- Includes high-fidelity operational diagnostics.

## Manager view
- Priority on:
  - team production posture (overdue, unassigned, escalations)
  - bottlenecks by person/domain
  - summarized market context for direction-setting
- Includes oversight panel (`/api/workflows?action=oversight`) and risk flags.

---

## 6) Recommended implementation sequence

## Phase 1: Minimal integration (single briefing path)
- Build `GET /api/daily-briefing?action=snapshot` in LCC as read-only orchestrator.
- Consume Morning structured payload (required) and HTML (optional).
- Compose with existing LCC signals:
  - queue work counts
  - my work
  - inbox
  - unassigned
  - sync health
- Deliver to:
  - Teams daily card
  - LCC homepage summary section
- Keep one schedule/orchestrator pipeline in LCC.

## Phase 2: Personalized daily briefing
- Add role projection and user-specific weighting.
- Add broker call-sheet block and manager team-health block.
- Add Outlook fallback digest generated from same unified payload.
- Add explicit degraded-state handling and telemetry.

## Phase 3: Expanded intelligence and agent behavior
- Add richer domain highlights from gov/dia query surfaces.
- Add Copilot follow-on suggestions from briefing (triage, assign, draft outreach).
- Add performance feedback loop:
  - which briefing recommendations were acted on
  - lift on outreach cadence, queue resolution, and listing pursuit throughput.

---

## 7) Dependencies, risks, and non-goals

## Dependencies
- Morning repo must provide a stable structured payload artifact daily.
- LCC auth must stay hardened for automation surfaces (`LCC_API_KEY`, `X-LCC-Key`).
- Existing LCC queue/sync/workflow endpoints must remain stable.
- Teams/Outlook delivery paths must share one payload source (no divergent logic).

## Risks
- Contract drift between Morning payload shape and LCC parser.
- Duplicate briefing generation in multiple places if ownership is not enforced.
- Overloading briefing with low-signal operational noise.
- Partial data conditions (Morning available, LCC stale; or vice versa).

## Mitigations
- Version Morning payload schema (`schema_version` field).
- Enforce single orchestration endpoint in LCC for all surfaces.
- Add completeness/degraded markers and source timestamps per section.
- Keep role-specific projection rules explicit and testable.

## Non-goals
- Rebuilding Morning intelligence logic inside LCC.
- Moving domain business rules from GovernmentProject/DialysisProject into LCC.
- Introducing a second independent daily briefing generator in Teams or Power Automate.
- Redesigning entire queue/workflow architecture.

---

## 8) Exact recommended file ownership boundaries between repos

## Morning Briefing repo owns
- `briefing.py` (market intelligence generation)
- `architecture.md` (intelligence architecture)
- setup/run docs for intelligence jobs
- New/maintained export contract docs for:
  - structured briefing payload
  - HTML briefing output

## LCC repo owns
- `docs/architecture/daily_briefing_integration_plan.md` (this plan)
- `docs/architecture/copilot_action_registry.md` action contract for `get_daily_briefing_snapshot`
- LCC orchestration endpoint implementation:
  - `api/daily-briefing.js` (`to_be_implemented`)
- LCC surface adapters:
  - homepage renderer wiring
  - Teams card payload/template wiring
  - Outlook fallback formatter wiring

## GovernmentProject and DialysisProject own
- Domain ingestion, review, promotion, and authoritative writes.
- Domain-specific business rules and canonical status transitions.
- LCC should consume domain signals via existing query/proxy surfaces only.

---

## Best first integration slice

Implement **one read-only unified snapshot** in LCC:
- Endpoint: `GET /api/daily-briefing?action=snapshot` (`to_be_implemented`)
- Inputs:
  - Morning structured payload (plus HTML if available)
  - `GET /api/queue-v2?view=work_counts`
  - `GET /api/queue-v2?view=my_work`
  - `GET /api/queue-v2?view=inbox`
  - `GET /api/workflows?action=unassigned`
  - `GET /api/sync?action=health`
- Output:
  - unified payload for Teams + LCC homepage
- Rollout:
  - start with broker + manager default views
  - enable analyst/ops projection in next increment

This slice delivers immediate leverage (one morning command center) without changing domain engines or duplicating intelligence generation.
