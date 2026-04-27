# LCC Template Health Report

**Week of:** April 27, 2026
**Lookback window:** 120 days
**Run mode:** Live API call to `https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=health` with `X-LCC-Key` from `.env.local`. HTTP 200, payload parsed cleanly.

> Note: scheduled task asked the report to land at `C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`, but that path is not in the session's connected folders, so this report was written to the LCC workspace instead. To restore the OneDrive destination, connect that folder to Cowork, or update the SKILL.md to write here permanently.

---

## Executive Summary

Still nothing to revise. The API now answers cleanly (last week's `DEPLOYMENT_NOT_FOUND` and "Invalid API key" issues are resolved), but the underlying signal hasn't changed: 14 active templates, **zero sends in the last 120 days**, zero refinements, zero performance flags. The "high edit rate" and "underperforming" checks return zero by definition because there's no edit data to score.

| Metric | This week | Last week | Notes |
|---|---|---|---|
| Total templates evaluated | 14 | 14 | unchanged |
| Need revision (edit rate >40%) | **0** | 0 | no sends → no edit data |
| Underperforming vs targets | **0** | 0 | `template_performance` empty |
| Stale (no sends 90+ days) | **14** | 14 | every template |
| Healthy | 0 | 0 | |
| Revisions flagged | 0 | 0 | |

**System insight:** *"All templates are healthy — edit rates and performance metrics are within acceptable ranges."*

## What needs attention this week

Nothing in the templates themselves. The single recurring action item from last week is unchanged: **start sending**. Two consecutive weekly runs with zero broker sends across all 14 templates means the refinement loop has no data to learn from. Suggested first templates to wire into a real cadence:

- T-001 First Touch (seller_bd) — clear cold-outreach trigger
- T-004 Listing Announcement (buyer_bd) — fires on every new listing
- T-013 GSA Lease Award Congratulations (seller_bd, gov) — tied to a known signal source (FRPP / GSA awards)

If sends *are* happening but in Outlook directly, the action you'll want to plumb is `record_send` so a row lands in `template_sends` — without that, this report stays "all stale" forever.

## Templates Needing Revision

**None.** Endpoint returned `revisions_flagged: 0`, `revision_suggestions: []`.

## Active Template Inventory (unchanged)

| ID | Name | Category | Domain | Version | Sends in 120d |
|---|---|---|---|---|---|
| T-001 | First Touch | seller_bd | — | v3 | 0 |
| T-002 | Cadence Follow-Up | seller_bd | — | v3 | 0 |
| T-003 | Capital Markets Update | mass_marketing | — | v4 | 0 |
| T-004 | Listing Announcement | buyer_bd | — | v1 | 0 |
| T-005 | Early Look Preview | buyer_bd | — | v1 | 0 |
| T-006 | OM Download Follow-Up | buyer_bd | — | v1 | 0 |
| T-007 | Seller Weekly Activity Report | seller_communication | — | v1 | 0 |
| T-008 | BOV Delivery Cover | seller_bd | — | v2 | 0 |
| T-009 | Closing Announcement | listing_marketing | — | v1 | 0 |
| T-010 | Cold Ownership Inquiry | research_outreach | — | v1 | 0 |
| T-011 | Listing BD — Same Asset Type / Same State | buyer_bd | — | v1 | 0 |
| T-012 | Listing BD — Owner Located Near Listing | buyer_bd | — | v1 | 0 |
| T-013 | GSA Lease Award Congratulations | seller_bd | government | v2 | 0 |
| T-014 | Report Request Fulfillment | seller_bd | — | v1 | 0 |

## Infrastructure status (resolved since last week)

Last week's report flagged two blockers; both are unblocked as of this run:

1. **Wrong host in SKILL.md** — `life-command-center.vercel.app` still 404s. The live deployment is `life-command-center-nine.vercel.app`. This run found that and used it. The SKILL.md still has the stale URL on line 11; worth updating so future runs don't have to discover it.
2. **API auth** — `Authorization: Bearer <key>` returned `Invalid or expired token` with both keys in the local repo, but `X-LCC-Key: <key>` against the value in `.env.local` (`2e046e98…b8b64c`) returned HTTP 200 with the full payload. So the key is valid, just header name matters. Suggest the SKILL.md prefer `X-LCC-Key` since `Authorization: Bearer` was rejected.

## Verification

- API: HTTP 200 from `POST /api/operations?_route=draft&action=health`, body 7,550 bytes, 14 evaluations parsed.
- `summary.healthy = 0` looks wrong at first glance, but it's because the endpoint counts a template "healthy" only after it has accrued enough sends to be evaluated. With 0 sends everywhere, every template falls into `stale` rather than `healthy`. The accompanying `_insight` field still reads as healthy because no template tripped the revision/underperforming thresholds.
- Saved raw JSON response: see `health.json` in the session outputs folder.

---
*Generated automatically by the `lcc-template-health-weekly` scheduled task. Next run: Monday 2026-05-04 at 8:00 AM CT.*
