# Briefing Email & Alert Audit — 2026-06-05

Triggered by: two copies of the LCC daily briefing arriving ~7:32/7:35 AM, plus
the weekly PA "6 of your flow(s) have failed" digest. Audit covers the duplicate
flow, the briefing email itself, and the Teams alert channel.

---

## 1. Root cause of the double email — RESOLVED

Two different scheduled flows were both live, each calling the briefing pipeline
and sending its own email at ~7:30 AM CT:

| Flow | Created | Status before | Status after |
|---|---|---|---|
| **LCC Morning Briefing v2** (`63156e98`) | May 23 | On — ran Jun 5, 7:30 AM, succeeded | **On (keeper)** |
| **LCC Weekday Briefing Email** (`90fbb308`) | May 19 | On — ran Jun 5, 7:30 AM, succeeded | **Off (disabled Jun 5, 7:39 AM)** |

It was two flows each running once — not one flow double-firing. v2 (per
`docs/BRIEFING_EMAIL_FLOW_v2.md`) is the intended replacement; the May 19 flow
was never retired when v2 went live Jun 1. The old flow is **disabled, not
deleted** — watch Saturday/Monday; if only one email arrives, delete it after a
week.

**Rollback:** flow details page → Turn on
(`.../flows/90fbb308-cf5a-4daa-958b-b840992a7b15/details`).

API-call impact: halves the daily briefing-email render calls, Outlook sends,
and any downstream `/api/briefing-email` + edge reads from PA.

## 2. Other flow-inventory findings (review recommended)

1. **`Sync Flagged Emails to Supabase` exists twice** (`b53a73db` and
   `47568a01`), both Scheduled, both modified 3 wk ago. If both are On, every
   poll against Graph + Supabase is doubled — same class of waste as the
   briefing dup. Verify run histories; turn one off.
2. **`LCC Morning Briefing Email` (`6ec55229`) runs weekends at 7:00 AM**
   (May 30/31, 24/23...). The v2 spec says weekends are *intentionally
   excluded* because the intel-snapshot cron is Mon–Fri — so the weekend send
   re-mails Friday's stale snapshot. Either retire it or add a weekend variant
   of the snapshot cron. Decide deliberately; not changed today.
3. **`SF -> LCC: Daily Bulk File Backfill` is still on and failing daily**
   (7 failures this week; alert #475 open). Runbook
   (`sf_daily_bulk_backfill_RUNBOOK.md`) Option A: turn it off. Option B:
   ~4 edits to finish the outer Comp loop. Pick one — it's the single largest
   contributor to the PA failure digest.
4. `LCC SF Flow 1 — Link Contacts & Companies`: **85 failures/week** in the
   digest — worth its own triage session.

## 3. Briefing email content audit (Jun 5 Weekly Deep Dive)

What works: strong information density, market strip up top, vertical TTM
stats, AI Analyst's Take, sector news with links, ops footer with snapshot
timestamp.

Issues, in priority order:

1. **"Today's Game Plan" is empty** — the #1 actionable section renders
   "No calendar, tasks, or recommended calls surfaced. Send Outlook + To Do
   data via Power Automate." v2's ~4-5s run time (spec predicts 8–12s with
   connectors) says the flow is calling GET (or POST with empty body) and
   skipping the calendar/To Do steps in the spec §Steps 1–4. Wire them up —
   this turns the email from a market report into a daily operating tool.
2. **Duplicate rows inside the email** — OM Intakes (24h) lists
   506 N Patterson and 198 N Springfield twice each. Dedup on
   (address, broker, price) or intake hash at the query.
3. **Internally inconsistent metrics** — "Pipeline: 0 open opportunities" vs
   "Opps Opened: 5 (7d)" in Research Progress; "Touchpoints: 0" and
   "% Prospected: 0%" look like broken counters (canonical dia/gov vertical
   alias issue is the usual suspect), not real zeros. A metric that's always
   zero trains the reader to skip the section.
4. **Section order buries action under reference.** Current: markets → game
   plan → analyst → capital markets → vertical stats → week in numbers → deal
   intel → priorities → research → new on market → news → ops. Recommended:
   game plan / urgent & due / priorities first (what do I do today?), then new
   on market + deal intel (what changed in my book?), then markets/analyst
   (context), news last. Keep the one-line market strip at top as is.
5. **Subject line is static.** Put the actionable counts in it:
   `LCC Daily — 2 due · 6 new OMs · 10Y 4.48%`. Scannable from the inbox,
   and makes a duplicate send instantly obvious.
6. **News appears twice** — Sector Watch and "What We're Reading" repeat the
   same MedCity/Bisnow items. Merge into one section with a "why it matters"
   line, cap at ~5 items.
7. Minor: literal `&middot;` HTML entity leaks into the plain-text part of the
   Ops & Queue line; "Inbox new: 1427" is noise without a delta (show
   new-since-yesterday instead).

## 4. Teams alert channel audit (`LCC Channel Alerts`)

Observed in the channel capture:

1. **Same alert posted 4× ** — `pg_net:no_response [geocode-tick]` appeared
   four times, each as its own "LCC Health Alerts — 1 open (error)" card. The
   poster re-sends every open alert on every tick instead of posting on
   state change. Fix: post once on open, once on resolve; while open, at most
   one hourly rollup ("3 alerts open, oldest 6h"). Dedup key:
   `(alert_kind, source)` + open-state.
2. **Empty error detail** — alerts read "…returned no_response … in last 24h:"
   with nothing after the colon. Matches the known fault-branch gap (only the
   Logic App run header is posted, so `error_detail` is empty). Failures are
   undiagnosable from the alert; you must go dig. Include the response body /
   error snippet and a deep link to the failing run.
3. **Redundant header** — "LCC Health Alerts — 1 open (error)" followed by a
   bracketed source repeats itself. One line per alert:
   `🔴 geocode-tick: 1 no_response in 24h · open 0.1h · [runbook] [run]`.
4. **No severity routing or ack** — everything is "error". Recommend:
   error = post immediately; warning = daily rollup only; and an
   Acknowledge/Snooze action (Adaptive Card button → sets
   `lcc_health_alerts.snoozed_until`) so a known issue (e.g. the half-built
   bulk-backfill flow) stops re-alerting while you decide.
5. **Two overlapping failure channels** — PA's weekly "flows have failed"
   digest duplicates what `lcc-cron-health-check` + the Teams channel already
   cover, but with a 0–7 day lag. Once flow_failure alerts carry real error
   detail, unsubscribe from the PA digest (link in the digest footer) and keep
   LCC as the single source of truth.

## 5. Net effect on API calls

- Briefing render + send: **2×/day → 1×/day** (done today).
- Flagged-email sync: potentially **2× → 1×** polling (pending verification, §2.1).
- Bulk backfill: daily guaranteed-failure run eliminated when §2.3 Option A/B
  is executed.
- Teams webhook posts: ~4× reduction once alert dedup (§4.1) ships.

## 6. Watch plan

- **Sat Jun 6 / Mon Jun 8:** confirm exactly one briefing email arrives. If
  zero or two, re-check both flows' run histories before touching anything.
- After 7 clean days: delete `LCC Weekday Briefing Email`.
- Alert #475 (bulk backfill) stays open until §2.3 is decided.
