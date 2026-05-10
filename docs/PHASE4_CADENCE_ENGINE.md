# Phase 4 — Cadence Engine Alerts

Phase 4 is the proactive surface that turns the data Phases 1–3 ingested
into **alerts the user actually sees**. A daily cron sweeps two views and
emits two kinds of alert:

- **going_cold** — a tracked SF contact has gone N days without a call,
  email, or meeting. (Default `N=30`.)
- **heating_up** — a fellow Northmarq rep is hammering one of our tracked
  accounts: 5+ touches in the last 90 days with at least one in the last
  7 days. (Configurable.)

Both alerts land as rows in `cadence_alerts` (with daily dedupe so the
cron is safe to over-run) and trigger Teams adaptive cards via the
existing `sendTeamsAlert` helper.

> **Function count: still 12.** Phase 4 plugs into `api/bridges.js` as
> `_route=cadence`. The cron URL is `/api/cadence-tick` (rewrite to
> `/api/bridges?_route=cadence`).

This is **distinct** from `cadence-engine.js`. That module schedules
per-contact touchpoints ("what should you send Bob next, and when"). Phase
4 is the cross-data **alerter** ("which contacts/accounts deserve attention
right now"). They're complementary; both will eventually feed the same UI
inbox.

## What ships

| Component | Path | Purpose |
|-----------|------|---------|
| Migration | `supabase/migrations/20260607000000_phase4_cadence_alerts.sql` | `cadence_alerts` table with daily-dedupe unique index. |
| Helper   | `api/_shared/cadence-alerts.js` | `runCadenceTick(workspaceId, options)` — runs both rules, emits alerts, sends Teams cards. |
| Router   | `api/bridges.js` (updated) | Adds `_route=cadence`. |
| Rewrite  | `vercel.json` | `/api/cadence-tick` → `/api/bridges?_route=cadence`. |

## Alert rules (v1)

### going_cold

```sql
SELECT * FROM v_contact_engagement
WHERE days_since_last_touch >= :cold_days   -- default 30
  AND sf_contact_id IS NOT NULL             -- only SF-tracked contacts
ORDER BY days_since_last_touch DESC;
```

- **Subject**: the unified contact (`subject_kind='contact'`,
  `subject_id=unified_contacts.unified_id`).
- **Severity**: `high` if `days_since_last_touch >= 60`, else `info`.
- **Message**: `"<Name> hasn't been contacted in <N> days"`.
- **Teams card facts**: contact, company, days since, last channel.

### heating_up

```sql
SELECT * FROM v_competitive_touches
WHERE workspace_id = :ws
  AND touches_90d  >= :heat_min_touches      -- default 5
  AND last_touch_at >= now() - :heat_recency_days::interval  -- default 7d
  AND account_entity_id IS NOT NULL
ORDER BY touches_90d DESC;
```

- **Subject**: the account entity (`subject_kind='account'`,
  `subject_id=entity uuid`).
- **Severity**: `high` if `touches_90d >= 10`, else `info`.
- **Message**: `"<Rep> has <N> recent touches with <Account>"`.
- **Teams card facts**: account, rep, touches/90d, last touch date,
  channel mix.
- **Dedupe is per-account**: if multiple reps are heating up the same
  account on the same day, only the first emits. The details payload
  records which rep triggered it. Per-rep alerts is a v2 enhancement
  (synthetic subject_id of "account+rep").

## Daily-dedupe model

```
unique (workspace_id, alert_type, subject_kind, subject_id, emitted_on_date)
```

- Re-running the tick within the same day is idempotent — duplicate
  inserts collide and silently no-op (Prefer=resolution=ignore-duplicates).
- A different `alert_type` against the same subject can still emit
  ("Bob is going_cold AND we have a stale_opportunity with him").
- Tomorrow, the same alert_type can re-emit if the underlying condition
  still holds (the `emitted_on_date` is part of the key).

## Cron setup

The tick is workspace-scoped. The simplest production setup is one PA
flow per workspace, scheduled daily at 8am local:

```
Recurrence (daily, 8am)
  ↓
HTTP — POST https://<host>/api/cadence-tick?workspace=<workspace-uuid>
  Headers:
    X-LCC-Key: <LCC_API_KEY>
```

Optional query params (override defaults):

| Param | Default | Meaning |
|-------|---------|---------|
| `cold_days` | 30 | "Going cold" threshold in days |
| `heat_min_touches` | 5 | Touches in last 90d to qualify as "heating up" |
| `heat_recency_days` | 7 | Last touch must be within this many days |
| `max_emit` | 25 | Max alerts to emit per type per run |

## Env vars

| Env var | Required? | Purpose |
|---------|-----------|---------|
| `TEAMS_CADENCE_WEBHOOK_URL` | recommended | Dedicated Teams channel for cadence alerts. |
| `TEAMS_INTAKE_WEBHOOK_URL`  | optional fallback | If `TEAMS_CADENCE_WEBHOOK_URL` is unset, alerts go here. |
| `LCC_APP_BASE_URL`          | optional | Base URL for "Open in LCC" deep-links on the Teams cards. |

If neither Teams webhook is set, `cadence_alerts` rows still land in the
DB; the response will include `teams_alerts.webhook_configured=false`. The
UI inbox can render alerts directly from the table — Teams is just a push
channel on top.

## Response shape

```json
{
  "ok": true,
  "workspace_id": "<uuid>",
  "duration_ms": 1240,
  "going_cold": { "detected": 12, "emitted": 7 },
  "heating_up": { "detected":  3, "emitted": 1 },
  "teams_alerts": { "sent": 8, "failed": 0, "webhook_configured": true }
}
```

`detected` = rows the rule matched. `emitted` = rows that newly inserted
into `cadence_alerts` (i.e., not already alerted today). The difference is
duplicate suppression at work.

## Verifying

```sql
-- Today's alerts, newest first
select alert_type, severity, subject_label, message, details
from cadence_alerts
where workspace_id = '<ws>' and emitted_on_date = current_date
order by emitted_at desc;

-- Open alerts (not yet acknowledged)
select alert_type, count(*) from cadence_alerts
where workspace_id = '<ws>' and acknowledged_at is null
group by alert_type order by count desc;

-- A specific contact's alert history
select alert_type, message, emitted_at, acknowledged_at
from cadence_alerts
where subject_id = '<unified_contact uuid>'
order by emitted_at desc;
```

## Acknowledge / resolve flow

There's no Phase 4 endpoint to acknowledge alerts yet — that's a tiny
follow-up:

```sql
update cadence_alerts
set acknowledged_at = now(),
    acknowledged_by = '<user uuid>'
where id = '<alert uuid>';
```

A `_route=cadence&action=ack&id=<uuid>` action on `api/bridges.js` is the
natural place; same pattern as `_route=admin&action=backfill_mappings`.
Adding it doesn't move the function count.

## What's deferred

- **Per-user assignment.** Today every alert lands with `assigned_to=null`
  and broadcasts to the workspace Teams channel. The right next step is
  to derive `assigned_to` for each subject:
  - For `going_cold`: the LCC user who has the most recent touch with
    that contact in `salesforce_activity_log` (resolved through Phase
    1.5's `external_user_mappings`), or the SF contact's account owner.
  - For `heating_up`: anyone who has touched the account, EXCEPT the
    rep doing the heating-up.

  Once `assigned_to` is populated, the Teams card can `@mention` and
  per-user inbox views become trivial.
- **stale_opportunity rule.** SF Opportunities live in
  `entities.metadata.salesforce.opportunities[]` after Phase 1. A rule
  like "open opp where `last_modified` is > 30 days old AND `close_date`
  has passed" is straightforward to add to `cadence-alerts.js`.
- **silent_account rule.** Accounts where ALL tracked contacts are
  going_cold simultaneously — a stronger signal than a single contact
  going dark.
- **In-LCC inbox UI.** `cadence_alerts` is queryable today, but a
  dedicated UI surface (with acknowledge/resolve buttons) would make
  the alerts genuinely usable without leaving LCC.
- **Threshold tuning.** Defaults (30/5/7) are a guess. After a week of
  real data, expect to tune. Per-workspace overrides could go in a
  `cadence_thresholds` table later.
- **Acknowledge endpoint.** See the SQL snippet above; trivial to add as
  a `_route=cadence&action=ack` action.
