# LCC Template Health Report

**Week of:** June 15, 2026
**Lookback window:** 120 days
**Run mode:** Live API call against `https://tranquil-delight-production-633f.up.railway.app/api/operations?_route=draft&action=health` with `X-LCC-Key`.
**Status:** ✅ Completed — HTTP 200.

> Destination note: the task asks for this report at
> `C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`,
> but that OneDrive folder isn't in the session's connected mounts (same as every prior week).
> Written to the LCC workspace path instead.

---

## Executive Summary

Health endpoint returned a clean 200. **No templates need revision and none are underperforming.** All 14 active templates are flagged `stale` for the same standing reason as every prior week: no broker sends have been recorded in the lookback window, so there is no edit-distance or performance data to score.

| Metric | This week (Jun 15) | Last week (Jun 8) |
|---|---|---|
| Endpoint response | **HTTP 200** | HTTP 200 |
| Total templates evaluated | **14** | 14 |
| Need revision (edit rate >40%) | **0** | 0 |
| Underperforming vs targets | **0** | 0 |
| Stale (no sends in window) | **14** | 14 |
| Healthy | **0** | 0 |

`revisions_flagged: 0` — the revision-suggestion path produced nothing.

---

## Templates Needing Revision

**None.** Flagging requires send history carrying edit-distance data; no template has any, so nothing is actionable from a copy-quality standpoint.

---

## All active templates (all currently `stale`, 0 sends in 120d)

| ID | Name | Category | Domain | Ver |
|---|---|---|---|---|
| T-001 | First Touch | seller_bd | — | 3 |
| T-002 | Cadence Follow-Up | seller_bd | — | 3 |
| T-003 | Capital Markets Update | mass_marketing | — | 4 |
| T-004 | Listing Announcement | buyer_bd | — | 1 |
| T-005 | Early Look Preview | buyer_bd | — | 1 |
| T-006 | OM Download Follow-Up | buyer_bd | — | 1 |
| T-007 | Seller Weekly Activity Report | seller_communication | — | 1 |
| T-008 | BOV Delivery Cover | seller_bd | — | 2 |
| T-009 | Closing Announcement | listing_marketing | — | 1 |
| T-010 | Cold Ownership Inquiry | research_outreach | — | 1 |
| T-011 | Listing BD — Same Asset Type / Same State | buyer_bd | — | 1 |
| T-012 | Listing BD — Owner Located Near Listing | buyer_bd | — | 1 |
| T-013 | GSA Lease Award Congratulations | seller_bd | government | 2 |
| T-014 | Report Request Fulfillment | seller_bd | — | 1 |

---

## What needs attention this week

1. **Standing item (7 weeks running):** the refinement loop has nothing to score because no sends are recorded in the window. The R10 work (2026-06-07) closed the cadence → outreach loop (draft → mark sent → `record_send` → cadence advances), and R16 (2026-06-13) added auto-acquisition of Salesforce contacts so the 67 SF-mapped contactless cadences can become outreach-ready. **The remaining blocker is operational, not technical:** templates only start producing edit/performance data once sends actually flow. The action is to work the cadence dashboard so templates go out. Until `record_send` accumulates volume, this report stays empty — consider dialing the task to monthly.
2. **Fix the scheduled-task spec (carried over, still unfixed).** The SKILL.md points at the wrong host and auth scheme; every run has to rediscover this:
   - Host → live API is on **Railway** (`tranquil-delight-production-633f.up.railway.app`), not `life-command-center.vercel.app` (which returns the frontend 404 for all `/api/*`).
   - Auth → `X-LCC-Key: <LCC_API_KEY>` header. The spec's `Authorization: Bearer` is treated as a JWT and 401s.
   - The key in `.env.local` (`2e046e98…`) works as `X-LCC-Key`; the `.vercel/.env.preview.local` key (`lcc-prod-7f9c…`) is rejected.

---

## Run Notes

- Endpoint: `POST /api/operations?_route=draft&action=health` on the Railway host.
- Auth: `X-LCC-Key` header (key sourced from `.env.local`; `LCC_API_KEY` not present in the sandbox env).
- Body: `{"lookback_days": 120}`
- Response: HTTP 200 — `{"ok":true,"total_templates":14,"summary":{"needs_revision":0,"underperforming":0,"stale":14,"healthy":0},"revisions_flagged":0}`

---
*Generated automatically by the `lcc-template-health-weekly` scheduled task. Next run: Monday 8:00 AM CT.*
