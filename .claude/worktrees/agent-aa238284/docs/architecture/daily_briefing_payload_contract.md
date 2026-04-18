# Daily Briefing Payload Contract (Wave 1 Slice)

## Endpoint
- `GET /api/daily-briefing?action=snapshot`

## Purpose
Provide one read-only unified daily briefing payload that combines:
- Morning briefing intelligence payloads (structured primary, HTML optional)
- LCC operational signals (work counts, my work, inbox summary, unassigned work, sync health)

## Morning payload expectations

## Structured payload (primary)
Configured via:
- `MORNING_BRIEFING_STRUCTURED_URL`

Expected (minimum useful shape):
```json
{
  "source_system": "morning_briefing",
  "summary": "Top market takeaways",
  "highlights": [],
  "sector_signals": [],
  "watchlist": [],
  "source_links": [],
  "html_fragment": "<optional>"
}
```

Supported aliases in current LCC parser:
- `executive_summary`
- `briefing_summary`
- nested `global_market_intelligence.*`

## HTML payload (optional/fallback)
Configured via:
- `MORNING_BRIEFING_HTML_URL`

Accepted responses:
- `text/html` body
- JSON with `html` or `html_fragment`

## Degraded behavior
- If structured payload is unavailable:
  - `status.completeness = "degraded"`
  - `status.missing_sections` includes `global_market_intelligence.structured_payload`
  - HTML-only fallback is included when available
- If both structured and HTML are unavailable:
  - `status.missing_sections` also includes `global_market_intelligence.html_fragment`

## LCC config/env requirements
- Required existing LCC auth/ops vars:
  - `OPS_SUPABASE_URL`
  - `OPS_SUPABASE_KEY`
  - auth headers for caller (`Authorization` or `X-LCC-Key`)
- New optional integration vars:
  - `MORNING_BRIEFING_STRUCTURED_URL`
  - `MORNING_BRIEFING_HTML_URL`

## Query params
- `action=snapshot` (required)
- `role_view` (optional): `broker` or `analyst_ops`

## Example response shape
```json
{
  "briefing_id": "2026-04-03:workspace:ws-1:user:user-1:role:broker",
  "as_of": "2026-04-03T13:00:00.000Z",
  "workspace_id": "ws-1",
  "role_view": "broker",
  "status": {
    "completeness": "full",
    "missing_sections": []
  },
  "global_market_intelligence": {
    "source_system": "morning_briefing",
    "summary": "Rates steady; cap-rate spread focus remains critical.",
    "highlights": [],
    "sector_signals": [],
    "watchlist": [],
    "html_fragment": "<div>Morning briefing...</div>",
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
    "work_counts": {},
    "inbox_summary": {},
    "unassigned_work": [],
    "sync_health": {}
  },
  "actions": []
}
```

