# LCC Round 3 Audit Findings — 2026-05-19

**Companion to:** `ROUND_2_FINDINGS_2026-05-19.md` and `AUDIT_PROGRESS.md`
**Trigger:** During the Round 2 Power Automate work, the parent `LCC Morning Briefing Email` flow (Sat/Sun) was observed Failed on its last several runs. The new `LCC Weekday Briefing Email` clone inherits the same config — so it would fail Monday 12:30 UTC. This doc captures the diagnosis.

---

## R3-M-1. ✓ Verified · [CRITICAL] Briefing email flow fails — 400 "Could not resolve workspace"

**Status:** 🟧 REVIEW (root cause confirmed; one-line env fix)

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

**Status:** 🟦 PENDING

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

**Status:** 🟦 PENDING

The briefing flow's missing `X-LCC-Workspace` is one instance of a class: a
Vercel-side requirement (`LCC_DEFAULT_WORKSPACE_ID`, or any env/header contract)
that flows built at different times may or may not satisfy. Any flow that GETs
an `/api/*` endpoint requiring workspace context, and was built before
`LCC_DEFAULT_WORKSPACE_ID` was expected, has the same latent 400.

### Fix
Inventory every Power Automate flow that calls an LCC `/api/*` endpoint and
verify each sends the headers that endpoint requires (`X-LCC-Key`,
`X-LCC-Workspace`, `X-LCC-User-Id` as applicable) OR that the corresponding
`LCC_*` env defaults are set on Vercel. Prefer the env-default approach —
it's the single-source-of-truth fix. Candidates to check:
`LCC Flagged Email Intake`, `LCC Outlook Intake`, the `SF -> LCC: *` family,
`HTTP-Switch`, any flow with an `HTTP` action targeting `life-command-center-nine.vercel.app`.

---

## Severity rationale (R3-M-1)
CRITICAL: silent production failure with no reliably-seen alert; blocks the
just-shipped R2-M-5; the one-line env fix also protects every other
workspace-requiring caller.
