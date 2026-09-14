# Prompt 18 — New PA flow failures (from the live Health surface) + migration hygiene
- Priority: P1
- Status: open (drafted 2026-08-01)
- Related: prompt 12 (LCC Health surface, now live), prompt 10, `done/12-lcc-health-surface.response.md`
- Response file: `../responses/18-new-flow-failures-and-migration-hygiene.response.md`

## Context
The LCC Health surface (`v_lcc_health_surface`, applied live) is now reporting. #710 is green and all connectors
(Outlook/Copilot/Salesforce) are green, but it surfaced **recurring PA flow failures** not previously triaged:
`Unflag Completed Email Tasks` (253), `To Do - Life Command Center Sync` (63), `HTTP-Switch` (14),
`RCM_Power_Automate` (6), `SF -> LCC: Daily Bulk File Backfill` (5), `LoopNet_Power_Automate` (3).
Also: the health migration `supabase/migrations/20260801180000_lcc_health_surface.sql` had a type bug — the
`v_lcc_health_surface` `connectors` CTE selected `connector_type` (enum) into a text `UNION`; Cowork applied the
**fixed** version live (`connector_type::text`), but the repo file still has the bug.

## Prompt (copy/paste to Claude Code)
```
1. Triage + fix the recurring Power Automate flows the LCC Health surface now reports as amber:
   Unflag Completed Email Tasks (253 failures), To Do - Life Command Center Sync (63), HTTP-Switch (14),
   RCM_Power_Automate (6), SF -> LCC: Daily Bulk File Backfill (5), LoopNet_Power_Automate (3). For each pull the
   recent run error, root-cause (auth/token, changed schema, null handling, throttling), fix, and confirm green.
   Prioritize the two highest-count (Unflag Completed Email Tasks, To Do Sync).
2. Migration hygiene: update supabase/migrations/20260801180000_lcc_health_surface.sql so the connectors CTE
   casts connector_type::text (the live DB already has the corrected view; make the repo file match so a
   re-apply won't fail on "UNION types text and connector_type cannot be matched").
Report root cause per flow + confirm the health surface goes green for them.
```

## Verify
The named flows run green on the Health surface; the repo health migration file matches the live (fixed) view.
