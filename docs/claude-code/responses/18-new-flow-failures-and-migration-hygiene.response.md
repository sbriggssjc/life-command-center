# Prompt 18 response — New PA flow failures + migration hygiene

Date: 2026-08-03
Status: partially complete; repo hygiene fixed, live PA designer actions still require tenant access.

## What changed in the repo

- Fixed `supabase/migrations/20260801180000_lcc_health_surface.sql`: the `connectors` CTE now selects `connector_type::text AS check_name`, matching the version Cowork applied live.
- Added a regression assertion in `test/lcc-health-surface.test.mjs` so a future edit cannot reintroduce the enum/text `UNION` bug silently.

## Power Automate triage

No Power Automate management connector is installed in this Codex session, so I could not open run history or edit flows directly. I reconciled the current Health-surface prompt against the existing live-triage docs:

- `docs/os/ERROR-TRIAGE.md`
- `docs/os/architecture/scott-pa-flows-reference.md`
- `docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md`

The amber counts are a seven-day rolling failure signal, not proof each flow is still actively failing after prior fixes.

Live Railway `/api/ops-health?flow_window_hours=168` check on 2026-08-03 confirms these are amber rows with older timestamps:

| Flow | Live health count | Latest health timestamp | Current root cause / disposition | Required confirmation |
|---|---:|---|---|---|
| `Unflag Completed Email Tasks` | 187 | 2026-07-29 08:45 CT | Retired artifact from the pre-2026-07-20/21 custom To-Do model. Prior live triage says it was turned Off on 2026-07-29. Remaining amber count should decay out of the seven-day window if it stays Off. | In Power Automate, confirm the flow is Off and no new run exists after 2026-07-29. |
| `To Do - Life Command Center Sync` | 46 | 2026-07-29 08:00 CT | Same retired custom To-Do model. Prior live triage says it was turned Off on 2026-07-29. | Confirm Off and no new run after 2026-07-29. |
| `HTTP-Switch` | 14 | 2026-08-01 11:30 CT | Earlier SOQL/OData escaping issue had been fixed; later docs classify the 2026-07-28 failure as likely transient/watch. If new runs fail, pull the red action and error before changing flow logic. | Check latest failed run. If red action is Salesforce query/filter, verify the apostrophe escaping is still present. |
| `RCM_Power_Automate` | 6 | 2026-07-31 16:35 CT | Existing runbook flags RCM/LoopNet feeder/backfill flows for stale `*.vercel.app` host and/or missing `X-PA-Webhook-Secret` once Railway auth is enforced. | Repoint URI to the Railway host and confirm `X-PA-Webhook-Secret` is present if the endpoint requires PA webhook auth. Run one manual test. |
| `SF -> LCC: Daily Bulk File Backfill` | 4 | 2026-07-30 07:37 CT | Prior live triage fixed the manifest `HTTP` body from brittle `@json(concat(...))` to a native JSON body on 2026-07-29. Remaining amber count should decay if no new failed runs occur. | Confirm latest run succeeds; if failing, inspect the inner red action under `Apply_to_each_1` and compare against the native JSON body in `scott-pa-flows-reference.md`. |
| `LoopNet_Power_Automate` | 3 | 2026-07-28 18:53 CT | Same likely stale host/auth class as RCM. Low count and docs already point to stale `*.vercel.app` host. | Repoint to Railway, verify webhook secret/header, run one manual test. |

## Health-surface interpretation

The two highest-count flows should not be repaired in-place unless Power Automate shows they were turned back On or still do needed work. They were intentionally retired and replaced by:

- `LCC Processing Complete -> Move Message`
- `LCC To-Do Completion Poll`

If those replacement flows are green, the correct fix for `Unflag Completed Email Tasks` and `To Do - Life Command Center Sync` is to keep them Off and let the seven-day failure window expire.

## Verification performed

- Local migration file now matches the live fixed view shape for `connector_type::text`.
- Local test coverage now asserts the cast.
- Focused test passed: `node --test test/lcc-health-surface.test.mjs`.
- Live health read from Railway succeeded for the PA rows above; the two highest-count retired flows have no latest health timestamp after 2026-07-29.

## Still needed in Power Automate

1. Open each named flow's latest run history.
2. Confirm the two retired To-Do flows are Off and have no new runs.
3. Confirm SF Bulk Backfill latest run succeeds after the 2026-07-29 native JSON-body fix.
4. Repoint RCM/LoopNet hosts to Railway if they still reference Vercel, confirm webhook auth headers, and run manual tests.
5. Re-check `v_lcc_health_surface` after the next hourly tick and after the seven-day window ages out.
