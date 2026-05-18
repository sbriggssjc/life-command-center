# Item #10 Phase B — client_errors telemetry loop

Closes the second half of Item #10. Phase A made errors visible
to the user (toasts + console with tags). Phase B persists them
centrally so we can see patterns across users and time.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/10B-client-errors-telemetry
node audit/patches/10B-client-errors-telemetry/apply.mjs --dry
node audit/patches/10B-client-errors-telemetry/apply.mjs --apply
git add -A
git commit -F audit/patches/10B-client-errors-telemetry/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/10B-client-errors-telemetry -m "Merge audit/10B-client-errors-telemetry: client_errors telemetry"
git push origin main
```

The SQL migration is already applied on LCC Opps via MCP (it ran
instantly — pooler is healthy again). The `.sql` file is committed
for repo provenance.

## Smoke test (post-deploy)

In devtools console:

```js
// Generate a synthetic error and force a flush
setTimeout(() => { throw new Error('telemetry smoke test'); }, 0);
await new Promise(r => setTimeout(r, 200));
lccFlushErrors();
```

Then on LCC Opps via Supabase Studio:

```sql
SELECT * FROM public.client_errors ORDER BY id DESC LIMIT 5;
```

You should see a row with:
- `label = 'JS error'`
- `tier = 'error'`
- `message` containing 'telemetry smoke test'
- `user_email`, `workspace_id`, `url`, `user_agent` populated
- `code` matching the `[E-XXXX]` tag shown in the toast

Volume rollup (rolling 24h):

```sql
SELECT * FROM public.v_client_error_rollup;
```

Shows count + distinct_users + distinct_workspaces + sample_codes grouped by `label, tier`.

## How it works

```
Browser:
  lccReportError('label', err)
    → console.error('[LCC E-XXXX]', ...)
    → showToast(...)          (rate-limited, Phase A)
    → _lccQueueClientError(record)

  every 30s OR on beforeunload OR buffer hits 10:
    POST /api/admin?_route=client-error  { batch: [...] }

API:
  handleClientErrorReport
    → normalize + validate
    → opsQuery POST → public.client_errors on LCC Opps

LCC Opps:
  public.client_errors  ← rows persisted
  public.v_client_error_rollup  ← 24h aggregation view
```

## What's not in this patch (Phase C follow-ups)

- **Sweep ~50 ad-hoc `console.warn + showToast` call sites.** They still
  work via Phase A's helpers, but only the ones that go through
  `lccReportError` get persisted in `client_errors`. The migration is
  one site at a time.
- **Settings widget** showing the user's recent error volume + a "clear"
  button + a "report to support" link.
- **"Top errors this week" admin dashboard** built on
  `v_client_error_rollup`.
- **Volume-threshold alerting** — cron job that POSTs to Slack when a
  label exceeds a threshold within a window.
