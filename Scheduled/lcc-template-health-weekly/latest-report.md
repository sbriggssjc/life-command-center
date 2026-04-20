# LCC Template Health Report

**Week of:** April 20, 2026
**Lookback window:** 120 days
**Run mode:** Direct Supabase query against `LCC Opps` (xengecqvemvfknjvbvrq).
The Vercel API endpoint defined in the scheduled-task SKILL.md cannot be reached
from the scheduler (see "Infrastructure" section below).

---

## Executive Summary

Nothing requires revision this week. The template system is still pre-launch:
14 active templates, **zero sends in the last 120 days**, zero broker
refinements logged, zero performance rows flagged. There is no edit-pattern
data to evaluate yet, so the "high edit rate" and "underperforming" checks
return zero by definition.

| Metric | Count | Notes |
|---|---|---|
| Total templates (latest version) | 14 | |
| Active (not deprecated) | 14 | |
| Templates with sends in last 120d | 0 | |
| Templates with zero sends | **14** | Same as last week |
| Need revision (≥5 sends & avg edit >40%) | 0 | No sends to evaluate |
| Underperforming vs targets | 0 | `template_performance` has no rows |
| Stale (no send in 90d) | 14 | All templates are pre-launch |
| Refinements logged in last 7d | 0 | `template_refinements` is empty |
| Sends logged in last 7d | 0 | `template_sends` is empty |

## Templates Needing Revision

**None.** No template has accumulated the minimum send volume (5 sends with
recorded `edit_distance_pct`) needed to trigger the revision rule. Once broker
outreach starts flowing through the draft pipeline, this section will list
template ID, name, average edit distance, and the auto-generated revision
suggestion from the `/api/operations?_route=draft&action=health` endpoint.

## Active Template Inventory (no change from last week)

| ID | Name | Category | Created |
|---|---|---|---|
| T-001 | First Touch | seller_bd | 2026-04-13 |
| T-002 | Cadence Follow-Up | seller_bd | 2026-04-13 |
| T-003 | Capital Markets Update | mass_marketing | 2026-04-14 |
| T-004 | Listing Announcement | buyer_bd | 2026-04-07 |
| T-005 | Early Look Preview | buyer_bd | 2026-04-07 |
| T-006 | OM Download Follow-Up | buyer_bd | 2026-04-07 |
| T-007 | Seller Weekly Activity Report | seller_communication | 2026-04-07 |
| T-008 | BOV Delivery Cover | seller_bd | 2026-04-07 |
| T-009 | Closing Announcement | listing_marketing | 2026-04-07 |
| T-010 | Cold Ownership Inquiry | research_outreach | 2026-04-07 |
| T-011 | Listing BD — Same Asset / Same State | buyer_bd | 2026-04-07 |
| T-012 | Listing BD — Owner Near Listing | buyer_bd | 2026-04-07 |
| T-013 | GSA Lease Award Congratulations | seller_bd (gov) | 2026-04-13 |
| T-014 | Report Request Fulfillment | seller_bd | 2026-04-07 |

## Action Items for the Week

1. **Start sending.** Two weeks of zero-send reports in a row. Until a broker
   actually drafts/sends from these templates, this scheduled run produces
   nothing actionable. Suggested first templates to wire into a real cadence:
   T-001 (First Touch), T-004 (Listing Announcement), T-013 (GSA Lease Award
   Congratulations) — each has clear targets and is tied to an active
   workflow.
2. **Fix the scheduled-task URL.** The `SKILL.md` for this task points to
   `https://life-command-center.vercel.app/...`, but the actual production
   deployment is `https://life-command-center-nine.vercel.app/...`. The wrong
   URL returns `DEPLOYMENT_NOT_FOUND`. See infrastructure note for the patch.
3. **Provision the production `LCC_API_KEY` for the scheduler.** Even with
   the corrected URL, the endpoint requires `X-LCC-Key` /
   `Authorization: Bearer`. The scheduler currently has no env access to the
   production key, so this report will keep falling back to direct Supabase
   queries until that is wired up.

## Infrastructure Note

The SKILL.md instructs the runner to POST to:

```
https://life-command-center.vercel.app/api/operations?_route=draft&action=health
```

That hostname returns `DEPLOYMENT_NOT_FOUND`. The live deployment (verified
this morning) is:

```
https://life-command-center-nine.vercel.app/api/operations?_route=draft&action=health
```

Calling the live URL with `X-LCC-Key` returns `{"error":"Invalid API key"}`
because the only key available to the scheduler is the *preview* key from
`.vercel/.env.preview.local`. The production key needs to be added to the
scheduled-task environment (or the SKILL.md should be updated to read it from
Supabase Vault the way `lcc_cron_post()` does).

Once both fixes are in place, the API path returns the richer payload that
includes auto-generated revision suggestions per template — this report will
then carry those through verbatim instead of recomputing from raw tables.

## Verification

- `template_definitions`: 14 latest-version rows, all `deprecated = false`.
- `template_sends`: 0 rows total, 0 in last 7d, 0 in last 30d, 0 in last 120d.
- `template_refinements`: 0 rows total.
- `template_performance.flagged_for_review`: 0 rows true.
- Direct query target: Supabase project `xengecqvemvfknjvbvrq` (LCC Opps).
