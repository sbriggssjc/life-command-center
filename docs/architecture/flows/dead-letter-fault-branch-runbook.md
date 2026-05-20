# Runbook — Standard Dead-Letter Fault Branch

Last updated: 2026-05-14
Companion to: `../power-automate-observability-standards.md` (control #4 — dead-letter / fault branch) and `../lcc-microsoft-salesforce-pipeline-gap-analysis.md` (backlog item #2).
Landing migration: `supabase/migrations/20260514120000_lcc_flow_run_failures_dead_letter_plane.sql` (applied to LCC Opps 2026-05-14).

## What this is

The reusable pattern for wiring any Power Automate flow's failure path into the central dead-letter / flow-health plane. Before this, a flow failure lived only in that flow's own 28-day run history — 29 separate blind spots, and the only portfolio-wide signal was the platform's 14-day-consecutive-failure auto-disable (which silently took `HTTP Init LLC` offline for two weeks). After this, every guarded flow that fails writes one durable, queryable record and opens one de-duplicated alert in the same `lcc_health_alerts` pane the daily briefing already reads.

## The landing zone (already built)

On **LCC Opps** (`xengecqvemvfknjvbvrq`):

- **`flow_run_failures`** — append-only forensic log: `flow_name`, `flow_run_id`, `correlation_id`, `failed_action`, `error_kind`, `error_code`, `error_detail`, `payload`, `severity`, plus `resolved_at` / `resolved_note`.
- **`lcc_record_flow_failure(...)`** — the single ingestion RPC. Inserts a `flow_run_failures` row AND opens a de-duplicated `lcc_health_alerts` row (`alert_kind='flow_failure'`, one open alert per flow per 24h). `SECURITY DEFINER`, `execute` granted to `anon` — so a flow only needs the publishable key, never table access.
- **`v_flow_run_failures_open`** — triage view, open failures newest-first.
- **`lcc_resolve_flow_failure(failure_id, note)`** — mark a failure handled (service_role).

No edge function sits in front of it — the flow POSTs straight to the PostgREST RPC endpoint. Fewer moving parts on the dead-letter path is the point: if the dead-letter call itself is fragile, you lose the very record you are trying to keep.

## The ingestion contract

A flow's fault branch makes one HTTP action:

- **Method:** `POST`
- **URI:** `https://xengecqvemvfknjvbvrq.supabase.co/rest/v1/rpc/lcc_record_flow_failure`
- **Headers:**
  - `apikey`: `<LCC Opps publishable key>`
  - `Authorization`: `Bearer <LCC Opps publishable key>`
  - `Content-Type`: `application/json`
- **Body** (PostgREST maps each key to the RPC's named parameter):

```json
{
  "p_flow_name": "<the flow's display name, hard-coded>",
  "p_flow_run_id": "@{workflow()?['run']?['name']}",
  "p_correlation_id": "@{<the flow's correlation_id, if it carries one, else omit>}",
  "p_failed_action": "<name of the guarded Scope or action>",
  "p_error_kind": "has_failed",
  "p_error_code": "@{<optional: status code of the failed action>}",
  "p_error_detail": "@{substring(string(result('<Guarded_Scope_name>')), 0, 900)}",
  "p_payload": @{triggerBody()}
}
```

Notes on the expressions:
- `workflow()?['run']?['name']` is the Power Automate run id — the thing you paste into the run-history URL to open the exact failed run.
- `result('<Scope>')` returns the array of action results inside a Scope, including the error objects of whatever failed — `string(...)` + `substring(...,0,900)` keeps it inside the RPC's 1000-char truncation.
- `p_payload` should be whatever context makes the failure diagnosable — `triggerBody()` for HTTP/email-triggered flows, or a relevant `outputs(...)` for scheduled flows.
- `p_error_kind` is `has_failed` on the failure branch and `has_timed_out` if you wire a separate timeout branch; use `logical_failure` when a Condition catches a soft-failure body (an HTTP 200 whose body says `ok:false`).

The publishable key is low-sensitivity (it is the client-facing key, gated by the fact that `anon` can only `execute` this one RPC) — but per the standing P0 it should still move to a Power Platform **environment variable** rather than living inline in each flow. Until then, paste it into the two header fields.

## The flow-side pattern

The robust shape is **Scope + run-after + Terminate**:

```
[ Main_Scope ]   <- wrap the flow's real work in a Scope
      |
      | (Configure run after: "has failed" AND "has timed out")
      v
[ PostDeadLetter ]   <- the HTTP POST above
      |
      v
[ Terminate (status: Failed) ]   <- preserves the Failed run status
```

Why each piece:
- **Scope** — gives you one thing to attach the run-after to, and `result('Main_Scope')` then yields every inner action's result/error in one expression. If the flow is small and the failure point is a single action, you can attach the run-after directly to that action instead of introducing a Scope.
- **Configure run after = has failed / has timed out** — this is what makes `PostDeadLetter` run *only* on failure.
- **Terminate (Failed)** — without it, a successful `PostDeadLetter` as the last action can flip the overall run to Succeeded and *hide* the original failure. Terminate-Failed records the dead-letter and keeps the run honestly red.
- **Retry policy on `PostDeadLetter`** — set to `Fixed interval`, count 2, interval `PT5S`. The dead-letter call should be best-effort and fast, not retry for minutes.

For flows that already wrap work in a Scope (or already have a clear single guarded action), you only add `PostDeadLetter` + `Terminate`.

## Validation

After wiring a flow:
1. Force a failure in non-prod (or trigger the flow with a payload you know will fail an action).
2. Confirm the run shows **Failed** (Terminate preserved it) and `PostDeadLetter` shows **Succeeded** in the run history.
3. On LCC Opps: `select * from v_flow_run_failures_open where flow_name = '<flow>';` — expect one row with the run id and error detail.
4. `select * from lcc_health_alerts where alert_kind='flow_failure' and source='<flow>' and resolved_at is null;` — expect one open alert.
5. Re-run the failing payload again within 24h — confirm a *second* `flow_run_failures` row but **no second** `lcc_health_alerts` row (de-dup working).
6. Resolve the test: `select lcc_resolve_flow_failure(<id>, 'validation test');` and clear the test alert.

## Rollout

Per the observability standard's wave plan, wire the fault branch into flows in this order: Wave 2 first (the two flagged-email intake paths, `LCCSFFlow1`, the three Salesforce sync flows, the SF mutation flows), then Wave 4 (briefing, Teams-post, email-to-ToDo, recovery/unflag). Each flow wired moves a ☐ to ✅ in the observability compliance matrix's "Dead-letter" column.

## Change log

- 2026-05-14 — Runbook created alongside the `flow_run_failures` landing migration. First flow wired: see `FLOW_CHANGES_LOG.md`.
- 2026-05-14 — Wave 2 complete. Fault branch rolled into 5 flows: `LCC Flagged Email Intake`, `LCC Outlook Intake to Teams`, `LCC SF Flow 1` (the `LCCSFFlow1` queue worker), `Sync SF Tasks to Supabase`, `Sync SF Activities to Supabase`. See `FLOW_CHANGES_LOG.md` entry "Gap #2 Wave 2". Editor nuance added below.
- 2026-05-14 — **Wave 4 complete — Gap #2 closed.** Fault branch rolled into the remaining 20 long-tail flows (SF mutation ×3, email-triggered ×4, Teams-post ×3, briefing ×2, HTTP orchestration ×3, sync/recovery ×5). 26 flows total now on the dead-letter plane; the two calendar sync flows are the lone deliberate exception. See `FLOW_CHANGES_LOG.md` entry "Gap #2 Wave 4 COMPLETE" for the full per-flow list with flow IDs and terminal-action names. Scheduled-flow nuance added below.
- 2026-05-20 — **`SF -> LCC: *` family wired (Round 3, R3-M-3d).** 7 flows built after the campaign were off the plane; all wired this round. **Plane now covers 33 flows** (26 + the `LCC Weekday Briefing Email` clone + these 7). Firing confirmed end-to-end in production (R3-M-3c): the briefing flow's real failures produced matching `flow_run_failures` rows + `flow_failure` alerts 1:1. Added the "Practical wiring tips" section below (copy-paste method, read-only Code view, safe fire-test). See `FLOW_CHANGES_LOG.md` 2026-05-20 entry.

## Editor nuance — typed body vs. pasted body

In the new designer, *typing* a JSON body that contains a bare unquoted `@{...}` token (`"p_payload": @{body('X')}`) leaves it as literal text and trips the "Enter a valid JSON" validator — the on-paste token→chip conversion that makes the bare form valid does not fire on typed input. Two ways to handle it:

- **Pasted body** (email-triggered flows in Wave 2): paste the JSON; PA converts `@{...}` segments to chips and the bare `@{triggerBody()}` form is accepted.
- **Typed body** (scheduled flows in Wave 2): keep the body valid JSON as-typed by quoting the payload expression — `"p_payload": "@{string(body('X'))}"`. `string()` makes it an explicit JSON-string scalar; PA still interpolates `@{...}` inside quoted strings at runtime, so the RPC receives the context body as a jsonb string scalar (fully diagnosable, slightly less queryable than a nested object).

## Scheduled-flow payload nuance (Wave 4)

`triggerBody()` only exists on flows whose trigger carries a body — HTTP request, email, manual button. **Recurrence-triggered (scheduled) flows have no `triggerBody()`** — referencing it leaves `p_payload` null. For scheduled flows, use one of:

- `"p_payload": "@{string(workflow()?['run'])}"` — the run object (id, name, type). Always resolvable, and the run id alone opens the exact failed run in the 28-day history. This is the default for scheduled flows in Wave 4 (`To Do - LCC Sync`, the two `Sync Flagged Emails` flows, `Unflag Completed Email Tasks`).
- `"p_payload": "@{string(outputs('<UpstreamAction>'))}"` — when a specific upstream action's output *is* the diagnostic context. The two briefing flows use `outputs('HTTP')` because the briefing data fetch is what the failed Post/Send was trying to deliver.

## Long-flow nuance — the skip cascade (Wave 4)

For long multi-action flows (`HTTP Init LLC` is 13 actions, `To Do - LCC Sync` is a 9-pair fan-out), you do **not** need to wrap every action in a Scope or attach a fault branch to each. Attach the single `PostDeadLetter` after the flow's *terminal* action with run-after = has-failed **/ is-skipped /** has-timed-out. When any action mid-flow fails, Power Automate skips all subsequent actions including the terminal one — the `is-skipped` leg then fires `PostDeadLetter`. One fault branch per flow catches the whole chain. The trade-off: the dead-letter row names the terminal action as `p_failed_action`, not the true mid-flow culprit — but the run id in the row opens the run history where the real failure point is obvious.

## Practical wiring tips (added 2026-05-20, from wiring the SF -> LCC family)

The fastest, least error-prone way to add the fault branch is to **copy an existing
PostDeadLetter and paste it**, so the URL/headers/retry/body all carry over intact
and the only per-flow edit is `p_flow_name`:

1. **Copy.** Open a wired *scheduled* flow that uses the generic payload (e.g.
   `Unflag Completed Email Tasks`). Right-click its `PostDeadLetter` card →
   **Copy action**. The PA "My clipboard" persists across flow navigation.
2. **Paste.** In the target flow, right-click the **`+` directly below the
   terminal action** → **Paste an action**. (Scroll to the bottom first on long
   flows.) This brings the headers + retry + a body whose `p_payload =
   @{string(workflow()?['run'])}` resolves in *any* flow — so no payload edit is
   needed, only `p_flow_name`.
3. **Edit `p_flow_name` in Parameters → Body — NOT Code view.** Code view is
   **read-only** in the new designer ("Cannot edit in read-only editor"). In the
   Body field, select the value to **end of line including the closing quote**
   (double-click first word → `Shift+End`) and retype `New Name",` in one go.
   Selecting only the inner words risks deleting the closing quote, which
   stringifies the whole body (`"body": "{\n…}"`) and trips "Enter a valid JSON".
   Verify in Code view that `"body": {` is still an object and the line reads
   `"p_flow_name": "…",`.
4. Then set run-after on the terminal action (uncheck Is successful; check Has
   failed / Is skipped / Has timed out) and add `Control → Terminate` (defaults to
   Failed). Save.

### Safe fire-test (no Teams-channel noise)

To deliberately exercise the chain without the every-30-min Teams push (R3-M-2)
grabbing it: build a throwaway `Manual trigger → failing Compose (e.g.
`@{int('x')}`) → PostDeadLetter → Terminate(Failed)` flow, and set the
PostDeadLetter body's **`"p_severity": "info"`**. The push is error-severity-only,
so an `info` alert never reaches the channel. Confirm the row via
`v_flow_run_failures_open`, resolve with `lcc_resolve_flow_failure(<id>, '…')`,
then turn the test flow off. (In practice a synthetic test is rarely needed — the
chain is already proven by real production failures; see R3-M-3c.)
