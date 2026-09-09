# `ai-copilot` sync callers — the four Power Automate flows (COPILOT-OPEN Unit 3)

The 24h caller inventory behind **COPILOT-OPEN** (`docs/os/PLANNED-BACKLOG.md`) identified four live
Power Automate flows POSTing to `ai-copilot` with **no credential at all**, distinguished only by
their Logic-Apps workflow id in the User-Agent (`azure-logic-apps/1.0 (workflow <id>)`). None of the
four ids matches any `flow_guid` in `docs/os/FLOW-REGISTRY.yaml`.

| workflow id | route called | volume/day | candidate flow |
|---|---|---:|---|
| `4eb7c46fdc244d4d949c1e5c6f85d41f` | `POST /sync/calendar-events` | 24 | Personal Calendar Sync |
| `5706ffc6bd394b5b8bc9117121aebb8b` | `POST /sync/activities` | — | (unidentified — Scott to open) |
| `e2598c91bad14348878447ba87c3629c` | `POST /sync/sf-tasks` | — | (unidentified — Scott to open) |
| `0216d3da9ae1442d80715428587e04da` | `POST /sync/flagged-emails` | — | (unidentified — Scott to open) |

## What each flow needs (one change, identical across all four)

Add a header to the flow's HTTP action that POSTs to `ai-copilot`:

```
X-PA-Webhook-Secret: <the same value the "SF -> LCC: Object Sync" flow already sends>
```

That is the only change. The route, method, and body are unchanged — `authenticateWebhook()`
(`supabase/functions/_shared/auth.ts`) only checks for the header's presence and value; it does not
change response shape.

## Procedure (👤 Scott)

1. Open each flow by pasting `https://make.powerautomate.com/environments/<env>/flows/<workflow-id>/details`
   substituting each id above — this resolves the flow's real name (recorded in the table once known).
2. Add the `X-PA-Webhook-Secret` header to its `ai-copilot` HTTP action, matching the value already
   used elsewhere (`PA_WEBHOOK_SECRET` on Railway / the Dialysis_DB edge function secret).
3. Save, then **re-export** the flow definition to
   `private/power-automate/exports/production/<date>/` — never hand-edit an exported flow JSON.
4. Tell Cowork/CC the flow's real name for each workflow id; register it in `FLOW-REGISTRY.yaml`
   with `state: verified_from_export` and `endpoint_families: [dialysis-ai-copilot-*]`, resolving
   PA5's "in neither list" for whichever of the four it turns out to be.

## Why this can't wait for the enforce flip

`COPILOT_AUTH_MODE` ships in `log` mode (see `supabase/functions/ai-copilot/index.ts` and
`docs/architecture/edge-function-deploy-drift.md`). Every request from these four flows will log a
`[copilot-auth] DENY-WOULD` line until this header is added — that is expected and is exactly what
the log window is for. **The flip to `enforce` is refused until all four flows carry the header**
(zero `DENY-WOULD` lines from anything but a known caller, for ≥3 days) — see the parent doc for the
flip procedure.
