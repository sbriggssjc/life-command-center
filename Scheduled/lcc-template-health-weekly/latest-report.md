# LCC Template Health Report

**Week of:** May 4, 2026
**Lookback window:** 120 days
**Run mode:** Live API call to `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=health` with `X-LCC-Key` from `.env.local`. HTTP 200, payload parsed cleanly.

> Note: scheduled task asked for the report at `C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`, but that folder isn't in the session's connected mounts. Same as last week, the report was written to the LCC workspace path. To restore the OneDrive destination, connect that folder to Cowork or update the SKILL.md to write here permanently.

---

## Executive Summary

Third consecutive week with no change. The endpoint is healthy and returning a clean payload, but no broker sends have been recorded in the last 120 days, so the refinement loop still has nothing to score. All 14 active templates are flagged `stale`; zero need revision; zero are underperforming.

| Metric | This week | Last week | Notes |
|---|---|---|---|
| Total templates evaluated | 14 | 14 | unchanged |
| Need revision (edit rate >40%) | **0** | 0 | no sends → no edit data |
| Underperforming vs targets | **0** | 0 | `template_performance` empty |
| Stale (no sends 90+ days) | **14** | 14 | every template |
| Healthy | 0 | 0 | |
| Revisions flagged | 0 | 0 | |
| Revision suggestions generated | 0 | 0 | |

**System insight:** *"All templates are healthy — edit rates and performance metrics are within acceptable ranges."*

## What needs attention this week

Nothing in the templates themselves. The recurring action item — unchanged from the last two reports — is **start sending**. Without `template_sends` rows, every metric (`avg_edit_distance_pct`, `open_rate_pct`, `reply_rate_pct`, `deal_advance_rate_pct`) is `null` and the health evaluator has nothing to flag.

If sends *are* happening but in Outlook directly, the missing piece is calling `record_send` so a row lands in `template_sends`. Without that, this report stays "all stale" indefinitely.

Suggested first templates to wire into a real cadence (same as prior weeks):

- **T-001 First Touch** (seller_bd) — clear cold-outreach trigger
- **T-004 Listing Announcement** (buyer_bd) — fires on every new listing
- **T-013 GSA Lease Award Congratulations** (seller_bd, gov) — tied to a known signal source (FRPP / GSA awards)

## Templates Needing Revision

**None.** Endpoint returned `revisions_flagged: 0`, `revision_suggestions: []`.

## Active Template Inventory (unchanged)

| ID | Name | Category | Version | Sends in 120d | Status |
|---|---|---|---|---|---|
| T-001 | First Touch | seller_bd | v3 | 0 | stale |
| T-002 | Cadence Follow-Up | seller_bd | v3 | 0 | stale |
| T-003 | Capital Markets Update | mass_marketing | v4 | 0 | stale |
| T-004 | Listing Announcement | buyer_bd | v1 | 0 | stale |
| T-005 | Early Look Preview | buyer_bd | v1 | 0 | stale |
| T-006 | OM Download Follow-Up | buyer_bd | v1 | 0 | stale |
| T-007 | Seller Weekly Activity Report | seller_communication | v1 | 0 | stale |
| T-008 | BOV Delivery Cover | seller_bd | v2 | 0 | stale |
| T-009 | Closing Announcement | listing_marketing | v1 | 0 | stale |
| T-010 | Cold Ownership Inquiry | research_outreach | v1 | 0 | stale |
| T-011 | Listing BD — Same Asset Type / Same State | buyer_bd | v1 | 0 | stale |
| T-012 | Listing BD — Owner Located Near Listing | buyer_bd | v1 | 0 | stale |
| T-013 | GSA Lease Award Congratulations | seller_bd | v2 | 0 | stale |
| T-014 | Report Request Fulfillment | seller_bd | v1 | 0 | stale |

## Run Notes

- Endpoint: `POST /api/operations?_route=draft&action=health` on `life-command-center-nine.vercel.app`
- Auth: `X-LCC-Key` header (Bearer token format returns 401 — the project uses the custom key header)
- Body: `{"lookback_days": 120}`
- Response: HTTP 200, 14 evaluations, all `status: "stale"`, no error flags
