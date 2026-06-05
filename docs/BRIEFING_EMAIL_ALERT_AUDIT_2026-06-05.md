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

## 5b. Fixes applied later the same day (2026-06-05 PM session)

1. **§2.1 done** — duplicate `Sync Flagged Emails to Supabase` (11:17 AM copy,
   `b53a73db`) turned off. The 6:32 AM copy (`47568a01`) does the real work.
2. **§2.2 done** — weekend `LCC Morning Briefing Email` (`6ec55229`) turned off.
3. **§2.3 done (Option B)** — Bulk File Backfill flow finished + fixed. The
   build was already complete; the real bug: the flow ran the
   download/upload chain even when the manifest returned `to_fetch: []`
   (already-stored file). Gov-stored files → `vertical ""` → dia-default
   lookup → 404 → daily failure; dia-stored files → re-downloaded from SF +
   re-uploaded to Storage + re-queued for AI extraction EVERY DAY. Fix: a
   `length(body('HTTP')?['to_fetch']) > 0` Condition wrapping the 4
   fetch/upload actions. Manual test: **succeeded, 6m59s** (vs 12-min daily
   failures since May 17). Alert #516 resolved. Follow-ups: fault branch
   still posts empty `error_detail`; `Get records 2` Top Count = 200 (no
   pagination past the first 200 Comps).
4. **§3.1–3.7 code fixes** — branch `claude/briefing-email-fixes-r1`
   (commit 711fbc3): action-first section reorder, subject with counts +
   10Y, OM-intake dedup, Sector Watch/Reading List dedup, `&middot;` leak.
   Plus two counter root-causes found and fixed: `is_closed` column doesn't
   exist on dia `salesforce_activities` (PostgREST 400 → "Pipeline: 0"
   forever; real open count is ~972) and Touchpoints=0 is a missing data
   feed (activity_events has no call/email/meeting rows) — added
   `fetchSfTouchpoints` fallback (gov SF activities alone: 362 in 7d).
   **Ships via Railway redeploy of merged main.**
5. **§4.1 done** — `lcc_health_alert_flap_suppression` migration applied
   live to LCC Opps. Root cause of the 4× geocode-tick spam: opener used a
   24h pg_net lookback, auto-resolver a 2h lookback → hourly
   open→notify→resolve flap for any transient failure. Fix: don't re-open
   for a failure occurrence already covered by a resolved alert, + per-key
   6h Teams notify cooldown. Verified: `lcc_check_cron_health()` now mints
   0 new alerts for the stale geocode-tick failure.
6. **Edge-side observation** — `intake-salesforce-files?action=stage-queued`
   hit a 546 (resource limit) after 90s on 2026-06-05; dia has a 100-row
   `extraction_status='queued'` backlog draining slowly. Separate issue,
   not addressed today.

## 5c. Final PA cleanup session (2026-06-05, after merge + Railway deploy)

1. **Flows deleted** (user-approved): `LCC Weekday Briefing Email`,
   `Sync Flagged Emails to Supabase` (11:17 copy), `LCC Morning Briefing
   Email` (weekend). Verified gone from My Flows.
2. **Backfill fault branch fixed** — added a `Filter array` action
   (`result('Apply_to_each_1')` where status = Failed) feeding
   PostDeadLetter; the dead letter now sends `p_failed_action` (real action
   name), `p_error_code`, and `p_error_detail` (first 3 failed results as
   JSON) instead of an empty detail + run header only.
3. **Backfill pagination fixed** — Get records 2 already had Top Count 5000
   + `LastModifiedDate desc` + tenant filter, but the SF connector caps at
   ~200/page, which is why runs only ever saw 200 Comps. Enabled Pagination
   (threshold 5000). First full-sweep run will be long (~30-45 min); once
   it completes clean, consider dropping Top Count to ~500 to cut daily SF
   calls (LastModifiedDate desc ordering means recent changes are always
   covered).
4. **Game Plan mystery solved — no build needed.** v2 already had
   Get events (V4) + List Tasks Folder V2 + POST body wired. Today's 7:30
   v2 run returned `personal_context_present: true` (calendar event posted
   fine). The empty-Game-Plan email analyzed in §3.1 was the now-deleted
   duplicate flow's body-less GET render. Residual nit: the render cache
   key deliberately ignores the POST body, so any same-day GET preview
   before the 7:30 POST could serve a body-less render — consider adding
   `personal_context_present` to the cache key in a future round.

## 6. Watch plan

- **Sat Jun 6 / Mon Jun 8:** confirm exactly one briefing email arrives. If
  zero or two, re-check both flows' run histories before touching anything.
- After 7 clean days: delete `LCC Weekday Briefing Email`.
- Alert #475 (bulk backfill) stays open until §2.3 is decided.
