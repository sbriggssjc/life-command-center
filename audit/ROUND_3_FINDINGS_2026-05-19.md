# LCC Round 3 Audit Findings — 2026-05-19

**Companion to:** `ROUND_2_FINDINGS_2026-05-19.md` and `AUDIT_PROGRESS.md`
**Trigger:** During the Round 2 Power Automate work, the parent `LCC Morning Briefing Email` flow (Sat/Sun) was observed Failed on its last several runs. The new `LCC Weekday Briefing Email` clone inherits the same config — so it would fail Monday 12:30 UTC. This doc captures the diagnosis.

---

## R3-M-1. ✓ Verified · [CRITICAL] Briefing email flow fails — 400 "Could not resolve workspace"

**Status:** ✅ DONE — root-caused + fixed + verified 2026-05-20. `LCC_DEFAULT_WORKSPACE_ID` env var set on Vercel + redeployed; manual briefing run returned 200 and the email delivered; the 3 stale `flow_run_failures` 400 rows + their alerts are resolved. (The one-line server-side env default covers every workspace-requiring endpoint, so no per-flow `X-LCC-Workspace` header is needed — see R3-M-3a note.)

> **Diagnosis correction:** An initial pass mis-read a stray 401 in the Vercel
> logs (an unauthenticated frontend probe at 00:24 UTC, unrelated to the flow's
> 12:00 UTC run) as the cause and pointed at a stale `X-LCC-Key`. The flow's own
> dead-letter payload — captured by the `flow_run_failures` plane built 2026-05-14 —
> is the authoritative source and shows the true error. **Auth passes; the
> failure is a missing workspace context.** Lesson: query `flow_run_failures`
> FIRST when a flow fails; it already captured the exact upstream HTTP body.

### Symptom
- `LCC Morning Briefing Email` (Sat/Sun 12:00 UTC) Failed on 2026-05-16 and
  2026-05-17.
- The new `LCC Weekday Briefing Email` clone (Mon-Fri 12:30 UTC) inherits the
  identical HTTP step config.

### Evidence — the flow's own dead-letter (LCC Opps `flow_run_failures`)
Both failures recorded `failed_action = "Send an email (V2)"`, `error_kind = has_failed`,
with this captured upstream HTTP response in `payload`:

```json
{
  "statusCode": 400,
  "body": { "error": "Could not resolve workspace. Set X-LCC-Workspace header or LCC_DEFAULT_WORKSPACE_ID." }
}
```

So the chain is:
1. The flow's `HTTP` GET to `/api/briefing-email` returns **400** (not 401 — auth passed).
2. The HTTP step is configured continue-on-failure, so the flow proceeds.
3. `Parse_JSON` parses the 400 error object instead of a briefing payload.
4. `Send an email (V2)` fails because there's no `subject`/`html`/`body` — the
   payload is an error object. The fault branch attributes the failure to the
   email step and records the upstream 400 body. Correct attribution; the email
   step is where execution actually died, the HTTP 400 is the upstream cause.

### Root cause
`api/_handlers/briefing-email-handler.js:366-373`:

```js
const workspaceId =
  req.headers['x-lcc-workspace'] || process.env.LCC_DEFAULT_WORKSPACE_ID || '';
if (!workspaceId) {
  res.status(400).json({
    error: 'Could not resolve workspace. Set X-LCC-Workspace header or LCC_DEFAULT_WORKSPACE_ID.',
  });
  return;
}
```

The flow sends `X-LCC-Key` (auth OK) but **not** `X-LCC-Workspace`, and
`LCC_DEFAULT_WORKSPACE_ID` is **not set** on Vercel. With neither present,
`workspaceId` is empty → 400. The endpoint never reaches the data-fetch stage.

This is the same drift class as Round 2's R2-W-1: a required input that one
side of an integration expects and the other side never supplies, failing
silently. The `X-LCC-Key` was a red herring — it's correct; the workspace
context is the gap.

### Fix (one of two; option A preferred)

**Option A — set the env var (preferred, fixes all callers in one place):**
Add to Vercel env (Production), then redeploy:
```
LCC_DEFAULT_WORKSPACE_ID = a0000000-0000-0000-0000-000000000001
```
(That is the single workspace on LCC Opps: **Briggs CRE** / slug `briggsland`.)
Optionally also set `LCC_SYSTEM_USER_ID` so the briefing's "my work" sections
resolve to Scott — without it, `userId` defaults to '' and the my-work counts
fall back to workspace-wide (handler line 374; not fatal, just less personalized).

This fixes the Sat/Sun flow, the new weekday flow, and any future caller that
doesn't send the header — no flow edits needed.

**Option B — add the header to each flow (only fixes the edited flows):**
In each briefing flow's `HTTP` GET step → Headers, add:
```
X-LCC-Workspace: a0000000-0000-0000-0000-000000000001
```
(The `X-LCC-Key` header is already correct — don't change it. The earlier
"update the key" guidance was based on the mistaken 401 read; the key works.)

### Verification (post-fix)
1. Manually run `LCC Morning Briefing Email`. Vercel log: `/api/briefing-email` → 200.
   Run history → Succeeded; email arrives.
2. Manually run `LCC Weekday Briefing Email`. Same.
3. Resolve the two open alerts:
   ```sql
   -- on LCC Opps
   UPDATE public.flow_run_failures
      SET resolved_at = now(), resolved_note = 'R3-M-1: set LCC_DEFAULT_WORKSPACE_ID'
    WHERE flow_name = 'LCC Morning Briefing Email' AND resolved_at IS NULL;
   UPDATE public.lcc_health_alerts
      SET resolved_at = now()
    WHERE alert_kind = 'flow_failure' AND source = 'LCC Morning Briefing Email' AND resolved_at IS NULL;
   ```

---

## R3-M-2. [HIGH] The alert WAS raised — but Scott never saw it (surfacing gap)

**Status:** ✅ DONE — live + verified end-to-end 2026-05-20. Decoupled Teams-push migration `20260520140000_lcc_r3_m2_health_alert_independent_teams_push.sql` applied; URL stored in Vault (`lcc_health_alert_webhook`, secret_id `ae678ddd-…`); pg_net 202 Accepted; dedup confirmed. **Re-pointed 2026-05-20** from Daily Briefing → the dedicated **LCC Alerts** channel (user created it): new Teams Workflows webhook (workflow `7c8c0f91…`) created on Team Briggs / LCC Alerts, Vault secret updated, synthetic test alert delivered + verified in-channel (202), test alert resolved. **Cleanup note:** the now-superseded "Send webhook alerts to Daily Briefing" PA workflow is idle (nothing references it) — safe to delete/disable when convenient.

### Build (applied on LCC Opps)
- `lcc_health_alerts.independent_notified_at` column (dedup tracking).
- `v_lcc_health_alerts_open` view (unresolved alerts, error-first, with age_hours). Confirmed 32 open / 8 error at build time.
- `lcc_notify_health_alerts_teams()` — reads vault `lcc_health_alert_webhook`; if absent returns `{status: dormant}` (verified). When set, POSTs open error-severity alerts to the Teams Incoming Webhook via `net.http_post`, independent of any LCC `/api` endpoint. Posts once per alert, re-nags ≤ daily while unresolved.
- pg_cron `lcc-health-alert-teams-push` `*/30 * * * *`, active=true, 7 days/week.

### Onboarding steps (✅ all completed 2026-05-20 — kept for the record)
1. ✅ Teams Workflows webhook created on Team Briggs / **LCC Alerts** channel (workflow `7c8c0f91…`).
2. ✅ URL stored in Vault (`lcc_health_alert_webhook`, secret_id `ae678ddd-…`); re-pointed from Daily Briefing to LCC Alerts.
3. ✅ Push fired + verified — synthetic test alert delivered in-channel (pg_net 202), then resolved. Dedup confirmed.

### Payload caveat (R3-M-2 webhook type)
The function emits a legacy **MessageCard** body, which classic Teams Incoming
Webhook connectors accept. Microsoft is retiring O365 connector webhooks in
favor of Power Automate **Workflows** webhooks, which expect an **Adaptive
Card** body shape. If the webhook the user creates is a Workflows webhook, the
`net.http_post` body in `lcc_notify_health_alerts_teams()` must be swapped to an
Adaptive Card envelope (`{type:'message', attachments:[{contentType:'application/vnd.microsoft.card.adaptive', content:{...}}]}`). Decide at webhook-creation time.

### Deferred follow-up
- **R3-M-2b**: pg_net is async — the function marks `independent_notified_at`
  optimistically. A robust version checks `net._http_response` for the POST's
  status on the next tick and only marks notified on a 2xx (re-fires on
  failure rather than waiting for the 24h re-nag).

### The real detection gap
The `flow_run_failures` + `lcc_health_alerts` plane (built 2026-05-14) worked
**perfectly** — it captured both failures and opened two `alert_kind='flow_failure'`
rows, both still unresolved. So detection isn't the gap. **Surfacing is.**

The alerts route into the daily briefing. But:
- The Sat/Sun briefing **email** is the very flow that's failing → it can't tell
  you about its own failure.
- The Mon-Fri briefing **Teams** card should carry the alert, but either it
  doesn't surface `lcc_health_alerts` prominently, or it isn't being read.

Net: a working alert pane with no reliably-seen front door — the exact
"collection without consequence" pattern from the original holistic audit,
now applied to operational health.

### Fix options
1. **Independent channel for health alerts** — don't let briefing-health ride
   only in the briefing itself (circular dependency: a broken briefing can't
   report that it's broken). Add a separate lightweight Teams/email/SMS push
   for any unresolved `lcc_health_alerts` of severity=error, on its own cron,
   using its own connection. Decouples "is the system healthy" from "did the
   briefing render."
2. **Surface `v_flow_run_failures_open` on the LCC home dashboard** — a
   persistent banner/chip (mirrors Round 2 R2-X-* "make the DB visible" theme).
3. **Auto-resolve + escalate** — if an `error` alert stays unresolved > 48h,
   escalate severity / change channel.

### Why this matters more than the original "build an auth canary" idea
The original R3-M-1c proposed a synthetic canary. But a canary would have been
redundant — the flow's own dead-letter already detected the failure. The actual
miss was that the **signal had no reliable destination**. Building another
detector on top of a working detector wouldn't have helped; fixing the last
mile (surfacing) would have.

---

## R3-M-3. [HIGH] Credential/config drift blast radius across Power Automate flows

**Status:** ✅ Active blast radius CLOSED by the R3-M-1 env fix · two structural sub-findings remain (R3-M-3a/b).

The briefing flow's missing `X-LCC-Workspace` is one instance of a class: a
Vercel-side requirement (`LCC_DEFAULT_WORKSPACE_ID`, or any env/header contract)
that flows built at different times may or may not satisfy.

### Data-driven inventory (2026-05-20)
1. **`flow_run_failures` — only ONE flow has ever recorded a failure:** `LCC
   Morning Briefing Email` (3 rows: May 16, May 17, and May 20 12:30 — all 400
   "could not resolve workspace", all now resolved). No other flow appears.
2. **Vercel logs — zero 400s on `/api/*` in the 2h after the fix.** The 14:27
   manual briefing run returned 200 (email delivered).
3. The May 20 12:30 row is the *weekday* flow's scheduled run, which fired
   ~1h45m BEFORE the env-var redeploy (~14:16 UTC) — i.e. pre-fix. Its next run
   (Thu 12:30 UTC) will succeed.

**Conclusion:** the active workspace-400 blast radius is closed. `LCC_DEFAULT_WORKSPACE_ID`
is a server-side default that covers every caller of every workspace-requiring
endpoint, regardless of whether each flow sends the header. No flow is currently
4xx-ing.

### R3-M-3a ⚠️ RETRACTED — premise was false; reframed as R3-M-3c (fire-test)
**Original claim (2026-05-20):** "Only the briefing flow(s) have a PostDeadLetter
fault branch; the other ~28 flows fail silently; dead-letter plane at ~3% coverage.
Fix: wire all 28 as a sprint."

**Retraction (2026-05-20, verified live in PA):** This claim was WRONG. It was
inferred from `flow_run_failures` showing only the briefing flow — but an empty
failure table means those flows *haven't failed since wiring*, NOT that they lack
wiring. Cross-checking the 2026-05-14 "Gap #2" campaign (gap-analysis doc +
`FLOW_CHANGES_LOG.md` Wave 2 + Wave 4) shows the standard
`PostDeadLetter → Terminate(Failed)` fault branch was rolled into **26 active
flows** that day, each posting to `lcc_record_flow_failure`. Two live spot-checks
confirmed the wiring is real and matches the log:
- `HTTP-Switch` (`c3744e93…`) — named in the original R3-M-3a as "silent", but the
  designer shows `manual → Switch → PostDeadLetter → Terminate` with the
  has-failed/skipped/timed-out run-after dots. ✅ wired.
- `Complete SF Task` (`06b7b1dc…`) — `manual → EscapeSubject → Get records →
  Condition → PostDeadLetter → Terminate`. ✅ wired.

So the re-wiring sprint is **NOT needed** and would be harmful (duplicate
PostDeadLetter/Terminate steps → double dead-letter rows). Deliberate exception
remains the two calendar sync flows (own hardening). Lesson: an audit finding
must distinguish "no signal because not instrumented" from "no signal because no
event" — R3-M-3a conflated the two. Verify instrumentation directly before acting.

### R3-M-3c ✅ DONE 2026-05-20 — firing IS proven, by production evidence (no synthetic test needed)
**Status:** ✅ DONE — verified end-to-end against the live LCC Opps DB, 2026-05-20.
The campaign's per-wave "validation" was only a curl test of the RPC, so the question was
whether the run-after → PostDeadLetter → row+alert chain actually fires on a real PA failure.
A direct DB check answers it: it already has, three times, in production. The briefing flow's
May 16/17/20 failures (HTTP `/api/briefing-email` returned 400 → terminal `Send an email (V2)`
was *skipped* → PostDeadLetter fired on the skip-cascade leg → posted to `lcc_record_flow_failure`)
produced **exactly 3 `flow_run_failures` rows AND 3 matching `flow_failure` error alerts**
(`lcc_health_alerts`, latest detected_at `2026-05-20 12:30:01`, count matches 1:1, all now
resolved). That is the complete chain — run-after fire, RPC ingestion, forensic row, de-duplicated
alert, and resolution — demonstrated on real failures, not composition or "standard platform
behaviour" hand-waving. The 33 wired flows carry the byte-identical PostDeadLetter action and the
same has-failed/skipped/timed-out run-after, so the mechanic is proven for the portfolio.
**Decision:** a synthetic fire-test was deliberately NOT run — it would have added an undeletable
"ZZ test" flow to the prod environment and risked a transient error alert in the LCC Alerts Teams
channel, for evidence already in hand. Minor residual: prod has exercised the *skip-cascade* leg
(the harder case); the direct *has-failed* / *has-timed-out* legs weren't separately fired, but
they are the same single platform mechanic. If ever desired, the safe way to exercise them is a
throwaway flow whose PostDeadLetter posts with `p_severity='info'` (the Teams push is error-only,
so no channel noise) — captured here, not needed now.

#### Original "firing never proven" writeup (now answered)
The genuine unmet need the 2026-05-14 campaign left open: **every wave's validation
was a curl test of the `lcc_record_flow_failure` RPC only.** No wave ever forced a
real flow to fail to confirm the run-after → PostDeadLetter → RPC → `flow_run_failures`
+ `lcc_health_alerts` chain actually fires in practice ("standard platform behaviour"
was assumed, not demonstrated). The one real-world fire we have is accidental: the
briefing flow's May 16/17/20 400s *did* land rows — which is real evidence the chain
works for at least that flow. **Fix:** a controlled fire-test on one safe/idempotent
wired flow (force its primary action to fail, confirm exactly one forensic row + one
de-duplicated alert, then revert). Safety-sensitive — pick a flow whose failure can't
corrupt live SF/Supabase data; do not fire-test a mutation flow. Pending Scott's pick.

### R3-M-3c-sweep ✅ DONE 2026-05-20 — full visual coverage sweep of all 43 cloud flows
Opened the live PA portfolio (43 cloud flows total) and verified PostDeadLetter+Terminate
presence directly (`find` for the canvas nodes; scroll-verified the long fan-out flows
since `find` only sees the rendered viewport — HTTP Init LLC and To Do - LCC Sync both
confirmed by scrolling to their terminal `… → PostDeadLetter → Terminate`). Result:

**✅ On the generic dead-letter plane — 27 flows, all confirmed wired:**
the 26 from the 2026-05-14 campaign (starter `Log Activity to SF from LCC`; Wave 2 ×5:
Flagged Email Intake, Outlook Intake to Teams, SF Flow 1, Sync SF Tasks, Sync SF
Activities; Wave 4 ×20) **plus** the R2-M-5 `LCC Weekday Briefing Email` clone.
Every one shows `… → PostDeadLetter (HTTP) → Terminate (Control)` with the
has-failed/skipped/timed-out run-after dots. The campaign's "26 flows" claim is TRUE.

**⚪ Deliberate exception / out of scope (8):** the two calendar sync flows
(`Outlook Calendar - LCC Sync`, `LCC - Personal Calendar Sync` — own hardening,
documented exception); `LCC Outlook Calendar Write` (pending, not yet On);
`Send webhook alerts to LCC Alerts` + `Send webhook alerts to Daily Briefing`
(these *are* the alerting mechanism — self-dead-lettering would be circular; the
second is the idle legacy flow already flagged for deletion); `Flagged Email to To
Do Task` (trivial 2-step `flag → Add a to-do`, makes NO LCC `/api` call, likely a
redundant duplicate — outside the "calls an LCC endpoint" criterion);
`NONPROD - HTTP Init LLC` clone; and 2× legacy `Dialysis` flows (1yr old, unrelated).

### R3-M-3d ✅ DONE 2026-05-20 — the `SF -> LCC: *` family is now on the dead-letter plane
**Status:** ✅ DONE — all 7 SF -> LCC flows wired with PostDeadLetter + Terminate(Failed),
verified each saved "ready to go". Method: copied the standard PostDeadLetter HTTP action
from a wired scheduled flow (Unflag Completed Email Tasks — clean `string(workflow()?['run'])`
payload that resolves in any flow), pasted via right-click "+" → Paste an action, set
`p_flow_name` per flow (Body field, select-to-end-of-line + retype incl closing quote — Code
view is read-only), set the terminal action's run-after to has-failed/skipped/timed-out, added
Control→Terminate (status Failed). Per-flow:
- `SF -> LCC: Retry & Dead-letter` (f7e7bc07) — terminal `Apply to each`. ✅ (keystone, done first)
- `SF -> LCC: Property Promotion` (c06b207e) — terminal `Promote Deals`. ✅
- `SF -> LCC: File Discovery & Move` (8cb891a2) — terminal `Apply to each`. ✅
- `SF -> LCC: Daily Bulk File Backfill` (3d8be768) — terminal `Apply to each 1`. ✅
- `SF -> LCC: On-demand File Backfill` (aaa452c0) — terminal `Apply to each`. ✅
- `SF -> LCC: On-demand Backfill` (4ffa81bd) — terminal `POST Backfill Complete`. ✅
- `SF -> LCC: Object Sync` (503d5519) — terminal `POST Crawl Complete`. ✅

Dead-letter plane now covers **33 flows** (26 from the 2026-05-14 Gap #2 campaign + the R2-M-5
weekday clone + these 7). Deliberate exceptions unchanged: the 2 calendar sync flows + the
pending LCC Outlook Calendar Write. Validation note: as with the original campaign, the
firing chain was not force-tested per flow (run-after is standard platform behaviour); the
ingestion contract + the briefing flow's real accidental fires remain the end-to-end proof.
A controlled fire-test (R3-M-3c) is still the open verification item. Standing P0 unchanged:
the anon key is now inline in 33 flows' PostDeadLetter headers — the DRY fix is a single shared
"dead-letter" child flow (future round).

#### Original gap writeup (now closed)
The sweep surfaced a genuine coverage gap the campaign couldn't have caught because
it post-dates it. A 7-flow `SF -> LCC: *` family was built ~2026-05-16/17 (3–4 days
ago; the campaign was 6 days ago) and **none of them carry the PostDeadLetter fault
branch:**
- `SF -> LCC: Object Sync` (`503d5519…`) — verified by scroll: ends at `POST Crawl
  Complete`, no fault branch.
- `SF -> LCC: Property Promotion` (`c06b207e…`) — `Recurrence → Promote
  Properties/Comps/Listings/Deals`, no fault branch.
- `SF -> LCC: File Discovery & Move` (`8cb891a2…`) — ends at `Apply to each`, no
  fault branch.
- `SF -> LCC: Daily Bulk File Backfill` (`3d8be768…`), `On-demand File Backfill`
  (`aaa452c0…`), `On-demand Backfill` (`4ffa81bd…`) — same vintage/design family.
- `SF -> LCC: Retry & Dead-letter` (`f7e7bc07…`) — `Recurrence → POST Retry Objects
  → POST Retry Files → Apply to each`. This is the family's **own domain-level retry
  reconciliation** (re-POSTs failed object/file batches from a server-side queue), NOT
  the generic flow-failure health plane — and ironically it *itself* has no
  PostDeadLetter, so if the retry flow dies, nothing surfaces.

Net: a hard failure of any `SF -> LCC` flow does **not** reach `flow_run_failures` /
`lcc_health_alerts` / the R3-M-2 Teams channel. This is the same class of risk the
Gap #2 campaign closed for the original 26 — just for flows added afterward. The
gap-analysis doc's "Gap #3 CLOSED — full active portfolio" is now stale and needs a
correction note (the portfolio grew).

**Decision needed (parallel to the calendar-flow exception):** fold the `SF -> LCC`
family into the generic PostDeadLetter plane (wire all 7, ~the same per-flow edit as
the campaign), OR treat the family as a deliberate exception that relies on its own
`Retry & Dead-letter` reconciliation (in which case that retry flow should at minimum
post to `lcc_record_flow_failure` so the *subsystem's* health is observable). Pending
Scott's call before any editing — re-wiring is the heavy/fragile contenteditable work
and shouldn't start until the design intent is confirmed.

### R3-M-3b ✅ DONE · [LOW] — cloned weekday flow mis-attributes failures
**Status:** ✅ DONE — fixed + saved in PA 2026-05-20.
`LCC Weekday Briefing Email` (the R2-M-5 clone) inherited the parent's
PostDeadLetter step with a hardcoded `flow_name = 'LCC Morning Briefing Email'`.
Its 12:30 failure today was recorded under the parent's name. **Fix applied:**
edited the weekday flow's PostDeadLetter `lcc_record_flow_failure` body to set
`p_flow_name = "LCC Weekday Briefing Email"`. The body now passes JSON validation
and the flow saved clean ("Your flow is ready to go"). Future weekday-flow
failures attribute correctly under their own name.

### Original fix note (still valid, now mostly satisfied)
Prefer the env-default approach over per-flow headers — it's the single-source-of-truth
fix and it's what closed this. Any *new* workspace-requiring endpoint should read
`process.env.LCC_DEFAULT_WORKSPACE_ID` as a fallback (the briefing-email handler's
pattern), so flows never need per-flow `X-LCC-Workspace` headers.

---

## R3-M-4. ✅ DONE · [MEDIUM] Stale `http_failure` alerts never auto-resolve

**Status:** ✅ DONE — root-caused + fixed + verified 2026-05-20. Migration `20260520150000_lcc_r3_m4_autoresolve_http_failure_alerts.sql`.

### Root cause (the 8 alerts R3-M-2 surfaced)
All 8 open error alerts were `[pg_net:no_response] N HTTP calls returned
no_response to unknown` — the oldest open ~22 days. Investigation:
- `net._http_response` retains only ~6h (153 rows, 09:15→15:10 today on inspection).
- **All 153 rows were 2xx. Zero no_response — currently and across the whole
  retained window.** So the underlying pg_net no_response problem is GONE,
  fixed by Round 76cw (pg_net timeout 5s→60s, 2026-04-28).
- The alerts lingered because `lcc_check_cron_health()` auto-resolves
  `cron_failure` alerts (when the job later succeeds) but has **no equivalent
  for `http_failure`**. Since pg_net prunes responses after ~6h, a cleared
  failure class can never be re-observed — so the alert stays open forever.
  New alerts also form roughly daily (the dedup window is 24h, with no
  resolution), which is why they accumulated.

### Fix
1. Resolved the 8 stale alerts with a root-cause note (immediate cleanup).
2. New `lcc_autoresolve_stale_http_alerts()` + cron `lcc-autoresolve-http-alerts`
   (`20 * * * *`, 5 min after the health check): resolves any open
   `http_failure` (`pg_net:*`) alert whose specific failure code (`no_response`
   or a numeric status) has NOT recurred in `net._http_response` in the last
   2h. Responses retain ~6h, so a 2h-clean window reliably means the failure
   cleared. If it recurs, `lcc_check_cron_health()` opens a fresh alert —
   correct flapping behaviour (resolve on clear, re-alert on recurrence).

### Verified
- 8 stale alerts → 0 open `http_failure`.
- Function runs clean (returns 0; nothing to resolve).
- Cron `lcc-autoresolve-http-alerts` active, schedule `20 * * * *`.

### Note
This is the meta-fix R3-M-2 implied: the independent Teams channel made the
stale alerts *visible*; R3-M-4 stops them *accumulating*. Together they fix
both the surfacing gap and the noise. A future consolidation could fold the
auto-resolve into `lcc_check_cron_health()` next to the cron_failure block.

---

## R3-M-5. ✅ DONE · [MEDIUM] Teams daily-briefing card posts hardcoded placeholder

**Status:** ✅ DONE — fixed + verified live 2026-05-20. Edited the `LCC Daily Briefing to Teams` flow (Approach A): HTTP GET URL changed to `/api/briefing-email`, Adaptive Card rebound (title→`body('HTTP')?['subject']`, body→`body('HTTP')?['text']`). Manual run Succeeded; the Daily Briefing channel card now shows real data (promoted OMs with broker/address/price, Queue Summary) — placeholder gone.

### Symptom
The `LCC Daily Briefing to Teams` Workflow posts a card every weekday reading
"LCC Daily Briefing — Placeholder — replace with snapshot data binding when
Phase 1B endpoint is live." Scott gets a fake card daily.

### Root cause (backend is fine — flow is the gap)
- `/api/daily-briefing?action=snapshot&role_view=broker` → `/api/admin?_route=edge-brief`
  → the **daily-briefing edge function** (`supabase/functions/daily-briefing/index.ts`,
  `action=snapshot`), which is a real ~1,100-line orchestration (it even filters
  placeholder stubs from real data, line 494) and returns 200 consistently.
- The same `briefing-data` pipeline produced the real **email** content verified
  in R3-M-1 (Strategic Priorities, 10 promoted OMs, Queue Summary).
- So the snapshot endpoint ("Phase 1B") IS live and returns real data. The
  placeholder is hardcoded in the Teams flow's Post-card action — the flow was
  stubbed before the endpoint existed and never rewired.

### Fix (two approaches; A is simpler)
- **A — reuse the working email summary.** Point the flow's HTTP GET at
  `/api/briefing-email` (already returns a clean `text` summary) and bind the
  card body to `body('Parse_JSON')?['text']`. One-field binding, real data,
  reuses the exact content that's already verified working. Lowest fragility.
- **B — bind to the structured snapshot.** Keep the `/api/daily-briefing?action=snapshot`
  GET and map individual snapshot fields into an Adaptive Card (today's
  priorities, queue counts, sync errors). Richer card, but more brittle
  field-by-field binding.

Recommend A for now (fastest path to real data); B later if a richer card is
wanted.

### Note
This is purely a Power Automate card-binding edit in the `LCC Daily Briefing
to Teams` workflow — no backend change. Pair it with R3-M-2's observation that
the Teams card is also where health alerts were *supposed* to surface; once the
card shows real data, it becomes a trustworthy daily surface again.

---

## Severity rationale (R3-M-1)
CRITICAL: silent production failure with no reliably-seen alert; blocks the
just-shipped R2-M-5; the one-line env fix also protects every other
workspace-requiring caller.
