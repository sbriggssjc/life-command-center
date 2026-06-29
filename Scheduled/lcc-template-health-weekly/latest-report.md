# LCC Template Health — Weekly Pulse

**Run:** Monday, June 29, 2026 · 8:00 AM CT
**Lookback window:** 120 days
**Endpoint:** `POST /api/operations?_route=draft&action=health` (Railway, live, `X-LCC-Key`)

## At a glance

| Metric | Count |
|---|---|
| Templates evaluated | 14 |
| **Need revision** (edit rate > 40%) | **0** |
| Underperforming vs targets | 1 |
| Stale (no sends in 120 days) | 13 |
| Healthy | 0 |

**Bottom line:** No templates need a revision this week — broker edit rates are
acceptable across the board (and no template has enough edit samples to flag).
One template is underperforming on open/reply, and nearly the whole library is
unused. The real signal here is **adoption, not copy quality**.

## Needs revision (high edit rates)

None. `revisions_flagged: 0` — no template is being heavily rewritten by hand,
and none has a large enough edit sample to evaluate edit distance yet.

## Underperforming vs targets — 1

**T-001 · First Touch** (seller_bd, v3)

- Sends (120d): 5 — all on 2026-06-26
- Open rate: 0% vs 35% target
- Reply rate: 0% vs 5% target
- Edit distance: no samples
- Engine revision suggestion: none flagged

Caveat worth keeping in mind: the mailto/copy send path carries **no open- or
reply-tracking signal**, so a 0% open/reply on 5 same-day sends is most likely a
*measurement gap*, not proof the copy is failing. Treat this as "watch as volume
builds," not "rewrite now." It becomes a real quality signal once tracked sends
(or logged replies) accumulate.

## Stale — 13 (no sends in 120 days)

T-002 Cadence Follow-Up · T-003 Capital Markets Update · T-004 Listing
Announcement · T-005 Early Look Preview · T-006 OM Download Follow-Up ·
T-007 Seller Weekly Activity Report · T-008 BOV Delivery Cover · T-009 Closing
Announcement · T-010 Cold Ownership Inquiry · T-011 Listing BD — Same Asset
Type/Same State · T-012 Listing BD — Owner Located Near Listing · T-013 GSA
Lease Award Congratulations · T-014 Report Request Fulfillment

## What to do this week

1. **Adoption is the lever, not copy.** 13 of 14 templates have zero sends and
   the one active template only fired 5 times (one day). Nothing to rewrite —
   the work is getting outreach flowing through the draft → mark-sent loop.
2. **T-001 First Touch** is the only template producing data. Keep using it and
   let the numbers build before judging the copy; the 0% open/reply is almost
   certainly the open-tracking gap, not the message.
3. **Re-check next Monday.** Once a few templates clear the edit-sample floor,
   the engine will start surfacing real revision suggestions
   (`high_performing_templates` populates after ≥3 sends per template).

---
*Output-path note: the task's configured destination
(`C:\Users\scott\OneDrive\Documents\Claude\Scheduled\lcc-template-health-weekly\latest-report.md`)
was not reachable from this session's connected folders, so the report was
written under the connected `life-command-center` workspace instead. Same as
last week's run.*
