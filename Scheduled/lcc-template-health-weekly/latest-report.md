# LCC Template Health Report

**Week of:** June 1, 2026
**Lookback window:** 120 days
**Run mode:** Live API call against `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=health` with `X-LCC-Key` from `.env.local`.
**Status:** ✅ Completed — HTTP 200. Endpoint recovered from last week's HTTP 500.

> Destination note: the task asks for this report at
> `C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`,
> but that OneDrive folder isn't in the session's connected mounts (same as prior weeks).
> Written to the LCC workspace path instead.

---

## Executive Summary

The `draft` route is healthy again — the HTTP 500 that blocked last Monday's run has cleared, and the health endpoint returned a clean 200. **No templates need revision and none are underperforming.** All 14 active templates are flagged `stale` for the same standing reason as prior weeks: no broker sends have been recorded in the lookback window.

| Metric | This week | Last week (May 25) |
|---|---|---|
| Endpoint response | **HTTP 200** | HTTP 500 |
| Total templates evaluated | **14** | n/a — no data |
| Need revision (edit rate >40%) | **0** | n/a |
| Underperforming vs targets | **0** | n/a |
| Stale (no sends in window) | **14** | n/a |
| Healthy | **0** | n/a |

Cross-checked against the LCC Opps DB directly: `template_sends` has **0 rows all-time**, which confirms the "all stale" result is a data-availability artifact, not a copy-quality problem.

---

## Templates Needing Revision

**None.** Flagging requires ≥5 sends carrying edit-distance data; no template has any send history, so the revision-suggestion path produced nothing this week.

---

## All active templates (all currently `stale`)

| ID | Name | Category | Domain | Avg edit dist | Sends (120d) |
|---|---|---|---|---|---|
| T-001 | First Touch | seller_bd | — | — | 0 |
| T-002 | Cadence Follow-Up | seller_bd | — | — | 0 |
| T-003 | Capital Markets Update | mass_marketing | — | — | 0 |
| T-004 | Listing Announcement | buyer_bd | — | — | 0 |
| T-005 | Early Look Preview | buyer_bd | — | — | 0 |
| T-006 | OM Download Follow-Up | buyer_bd | — | — | 0 |
| T-007 | Seller Weekly Activity Report | seller_communication | — | — | 0 |
| T-008 | BOV Delivery Cover | seller_bd | — | — | 0 |
| T-009 | Closing Announcement | listing_marketing | — | — | 0 |
| T-010 | Cold Ownership Inquiry | research_outreach | — | — | 0 |
| T-011 | Listing BD — Same Asset Type / Same State | buyer_bd | — | — | 0 |
| T-012 | Listing BD — Owner Located Near Listing | buyer_bd | — | — | 0 |
| T-013 | GSA Lease Award Congratulations | seller_bd | government | — | 0 |
| T-014 | Report Request Fulfillment | seller_bd | — | — | 0 |

---

## What needs attention this week

1. **Standing item (5 weeks running):** the refinement loop has nothing to score because `template_sends` is empty all-time. Until `record_send` is wired into the send flow (Chrome extension / email path → `POST /api/operations?_route=draft&action=record_send`), this report will keep reading "14 stale, 0 actionable." Consider dialing this task to monthly until send volume appears.
2. **Fix the scheduled-task spec (carried over, still unfixed).** The SKILL.md continues to point at the wrong host and auth scheme; every run rediscovers this:
   - Host → `life-command-center-nine.vercel.app` (the bare `life-command-center.vercel.app` returns the frontend 404 for all `/api/*`).
   - Auth → `X-LCC-Key: <LCC_API_KEY>` header (the spec's `Authorization: Bearer` returns 401).
3. **Last week's 500 is resolved** — no further action needed there, but worth noting the `draft` route had a backend outage on May 25 that self-cleared.

---

## Run Notes

- Endpoint (corrected): `POST /api/operations?_route=draft&action=health` on `life-command-center-nine.vercel.app`
- Auth: `X-LCC-Key` header sourced from `.env.local`
- Body: `{"lookback_days": 120}`
- Response: HTTP 200 — `{"ok":true,"total_templates":14,"summary":{"needs_revision":0,"underperforming":0,"stale":14,"healthy":0}}`
- Independent verification: direct query of LCC Opps (`xengecqvemvfknjvbvrq`) — `template_sends` = 0 rows all-time, 14 active `template_definitions`.
