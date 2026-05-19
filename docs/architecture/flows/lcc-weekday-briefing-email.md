# Flow Detail: LCC Weekday Briefing Email

Status: PROPOSED (Round 2 finding R2-M-5)
Last updated: 2026-05-19
Flow export: (to be added once flow is built — `LCCWeekdayBriefingEmail_YYYYMMDDHHMMSS.zip`)
Definition path: `Microsoft.Flow/flows/.../definition.json`

## Intent

Deliver the daily briefing to Scott's inbox every weekday (Mon–Fri), parallel
to the existing `LCC Daily Briefing` Teams flow. Closes the proactive-delivery
gap caught by Round 2 finding R2-M-5: today the weekday briefing posts only
to Teams, and the email-flavoured briefing runs only Saturday/Sunday — there
is no surface where Scott reliably sees the briefing every morning.

## Why this exists (audit context)

- `LCC Daily Briefing` flow (Mon–Fri, 12:30 UTC trigger): posts an adaptive
  card to a Teams channel via `/api/daily-briefing?action=snapshot&role_view=broker`.
- `LCC Morning Briefing` flow (Sat–Sun, 12:00 UTC trigger): emails Scott via
  Office 365 from `/api/briefing-email`.

Today Mon–Fri there is no email; Sat–Sun there is no Teams post. If Scott's
day starts in email (most weekdays), he doesn't see the briefing until he
opens Teams. If a flow goes to dead-letter mid-week, the only signal is the
Teams card he might miss.

This flow makes weekday email delivery additive — it doesn't replace the
Teams post, both run on the same schedule. The combined Mon–Fri pattern
becomes: Teams card + email simultaneously. The Sat–Sun morning flow stays
as it is.

## Trigger

- Type: `Recurrence`
- Frequency: `Week`
- Interval: `1`
- Schedule: `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`
- Start time: `2026-05-20T12:30:00Z` (matches `LCC Daily Briefing` cadence
  so the email lands at the same wall-clock moment as the Teams card)

Same trigger time as the existing weekday Teams flow on purpose — Scott
sees both at the same instant; the email is the durable copy, the Teams
card is the glanceable copy.

## High-Level Action Topology

1. Trigger on weekday `Recurrence`.
2. `HTTP` GET:
   - URL: `https://life-command-center-nine.vercel.app/api/briefing-email`
   - Header: `X-LCC-Key` (Vault-managed; same secret the Sat/Sun flow uses)
   - Optional query: `?role_view=broker` (to mirror the Teams flow's
     role-scoped payload)
3. `Parse_JSON` on the response.
4. `Compose` (optional) — format the subject line as
   `LCC briefing — @{formatDateTime(utcNow(), 'ddd MMM d')}`.
5. `Send_an_email_(V2)` via the `shared_office365` connector:
   - To: `sbriggssjc@gmail.com` (and any additional broker recipients
     captured in the briefing payload's `email_recipients[]`)
   - From: Scott's primary Office 365 mailbox (delegated send not required)
   - Subject: from Compose step 4
   - Body: HTML rendered from the briefing payload — strategic priorities,
     today's queue, sync exceptions, template alerts. Same body the Sat/Sun
     `LCC Morning Briefing` flow already produces.
   - Importance: `Normal`
6. **Failure fault branch** (dead-letter): on `HTTP` step failure (5xx or
   timeout), POST to `/api/admin?_route=dead-letter` with
   `flow_name='LCC-WeekdayBriefingEmail'`, `step='HTTP-briefing-email'`,
   and the response body. Same dead-letter pattern documented in
   `dead-letter-fault-branch-runbook.md`.

## Contract and Data Dependencies

- Endpoint dependency: `/api/briefing-email` (already serves the Sat/Sun
  morning flow — no API change needed; this flow reuses it verbatim)
- Header dependency: `X-LCC-Key` (Vault secret, no change)
- Email delivery dependency: `shared_office365` connector
- Optional escalation dependency: dead-letter handler (registered in
  `power-automate-observability-standards.md`)

## Configuration Notes

- The Sat/Sun `LCC Morning Briefing` flow runs at 12:00 UTC; this weekday
  flow runs at 12:30 UTC to match the existing Teams flow. The two morning
  flows are non-overlapping by day-of-week, so there is no risk of double
  delivery on any single day.
- Recipients list: keep the To: line scoped to Scott initially. When
  additional brokers are added to the LCC workspace, populate
  `email_recipients[]` in `/api/briefing-email`'s response and have the
  flow iterate over the array via `Send_an_email_(V2)` inside a
  `For_each_recipient` block.
- Templates: reuse the existing email body template from `LCC Morning
  Briefing` so weekday and weekend emails look identical. If the templates
  diverge later (e.g., add a "what happened over the weekend" section to
  Monday's email), extend the API response with a `email_template_variant`
  field and switch on it in the flow's `Compose` step.

## Key Risks

1. **Inbox fatigue.** Five additional emails per week is meaningful if the
   briefing duplicates information already in Teams. Mitigation: deliver
   both, but make the Teams card a one-liner ("Today's briefing: 3 deals,
   2 sync errors, 1 template flagged — open email for details") and the
   email the full digest. Captured as follow-up: R2-M-5b.
2. **Office 365 throttling.** `shared_office365` has the standard 250
   sends/day limit per connector. Scott's connector is well under that.
   No mitigation needed today.
3. **Payload drift between Sat/Sun and weekday consumers.** The same
   `/api/briefing-email` serves both; any breaking response change today
   already breaks the weekend flow. Net-new risk surface from this flow:
   zero.
4. **Holiday handling.** If Scott is on PTO Monday and doesn't want the
   email, today there is no opt-out switch. Mitigation: add a
   `briefing_pause_until` row to the user_settings table; have the API
   return `{paused: true}` and have the flow skip the email send. Captured
   as follow-up: R2-M-5c.

## Recommended Improvements (deferred follow-ups)

- **R2-M-5b**: shrink the weekday Teams card to a one-liner that links to
  the full email.
- **R2-M-5c**: implement a user-facing PTO/pause switch.
- **R2-M-5d**: unify the Sat/Sun and weekday flows into a single
  `LCC-Briefing-Daily` flow with a day-of-week branch — both currently
  use the same email body, the only meaningful difference is the trigger
  schedule.

## Evidence Snapshot

- Trigger: `Recurrence` weekday schedule (Mon–Fri)
- Top actions: `HTTP`, `Parse_JSON`, `Compose`, `Send_an_email_(V2)`
- Connector map: `shared_office365`
- Existing Sat/Sun reference: `flows/lcc-morning-briefing.md` — copy
  verbatim except for the schedule.

## Change Tracking Hooks

- Snapshot hash (pre-change): `N/A` (new flow)
- Snapshot hash (post-change): `TBD`
- Last validated run id (success): `TBD`
- Last validated run id (failure path): `TBD`

## Closes / blocks

- Closes: **R2-M-5** (HIGH) from `audit/ROUND_2_FINDINGS_2026-05-19.md`
- Captures follow-ups: R2-M-5b, R2-M-5c, R2-M-5d (above)
- Does NOT close: **R2-M-7** (Power Automate dead-letter pane is in-app
  only) — but adds the dead-letter fault branch from this flow's day one,
  so the new flow's failures are visible from the start.

## How to build

1. In Power Automate, clone the existing `LCC Morning Briefing` flow.
2. Rename the clone to `LCC Weekday Briefing Email`.
3. Change the `Recurrence` schedule from `Saturday, Sunday` to
   `Monday, Tuesday, Wednesday, Thursday, Friday`.
4. Change the start time from `2026-04-11T12:00:00Z` to
   `2026-05-20T12:30:00Z` (or whatever Mon 12:30 UTC is when you ship).
5. Add a fault branch on the `HTTP` step per
   `dead-letter-fault-branch-runbook.md`. Use `flow_name='LCC-WeekdayBriefingEmail'`.
6. Save, run once manually, verify the email lands in Scott's inbox.
7. Export the flow as a ZIP, add to `flow exports/` per the audit pattern.
8. Add an entry to `FLOW_CHANGES_LOG.md`.

Expected build time: ~20 minutes (mostly the clone + schedule edit).
