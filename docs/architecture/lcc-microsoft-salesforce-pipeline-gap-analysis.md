# LCC ↔ Microsoft / Salesforce Pipeline — Gap Analysis

Last updated: 2026-05-14
Owner: LCC Control Plane / architecture-audit track
Companion docs: `power-automate-flow-audit.md` (portfolio registry), `power-automate-observability-standards.md` (the reliability bar), `flows/FLOW_CHANGES_LOG.md` (change ledger).

## Purpose

The 2026-05-13/14 remediation campaign fixed the *flows that exist* — recovered the disabled and failing ones, closed injection and null-handling defects, hardened the calendar and SF-mutation paths. This document answers the next question: **given the 29 flows that exist, what is missing from the integration architecture itself?** It maps the current data pipeline between LCC/Supabase and the Microsoft 365 + Salesforce universe, then names the structural gaps and the flows/processes that do not yet exist.

## Current pipeline map (what exists today)

**Microsoft 365 → LCC (inbound).** Outlook email is the workhorse: flagged work email and new LoopNet / RCM email feed the LCC intake pipeline through four flows (`LCC Flagged Email Intake`, `LCC Outlook Intake`, `LoopNet Power Automate`, `RCM Power Automate`). Outlook calendar feeds Supabase through two recurrence flows (`LCC - Personal Calendar Sync`, `Outlook Calendar - LCC Sync`) into the `calendar_events` table. Microsoft To Do is pulled hourly into a OneDrive sync artifact (`To Do - LCC Sync`).

**LCC → Microsoft 365 (outbound).** Teams receives briefings and ops alerts (`LCC Daily Briefing`, `LCC Morning Briefing`, the two `HTTP-Postmessagechat` flows, `Manual ForEach Post`). Microsoft To Do receives tasks created from flagged email (`Flagged Email to To Do`, `Flagged Personal Email to To Do`), and flag state is reconciled by the `Unflag Completed Email Tasks` / `Recovery - Reflag Completed Emails` pair.

**Salesforce ↔ LCC.** Outbound from LCC: `HTTP-Switch` (Account/Contact lookup), `Complete SF Task` (Task update), `GovLease Lead Sync` (Lead upsert), `Log Activity to SF from LCC` (Task create), and `LCCSFFlow1` (1-minute queue worker doing find/link against `sf_sync_queue`). Inbound to Supabase: `Sync SF Tasks to Supabase` and `Sync SF Activities to Supabase` poll Salesforce on 4-6 hour recurrences and push normalized rows to the `ai-copilot` edge function.

## The gaps

**Status at a glance (2026-05-14):** Gap #3 (central dead-letter / health-observability plane) — ✅ **CLOSED**. Gaps #1, #2, #4, #5, #6, #7 — still open. Gap #7 (secret management) is the standing P0 and the single highest-priority item; it requires Scott to rotate credentials directly. The rest are build-it work, not defects.

### 1. Salesforce inbound is poll-only — no event-driven path

Every Salesforce → LCC path is a `Recurrence` poll (4h, 6h). There is no Change Data Capture, Platform Event, or Outbound Message → LCC webhook. Consequence: LCC's view of Salesforce lags reality by up to a full poll interval, and a missed poll window silently widens that gap. **Missing flow:** a Salesforce-triggered (or SF-CDC-subscribed) push that notifies LCC on Task/Activity/Lead/Opportunity change in near-real-time, with the polls demoted to a reconciliation backstop.

### 2. Salesforce object coverage is partial

The sync flows cover `Task`, `Activity`, and `Lead`. `Account`, `Contact`, and `Opportunity` are touched only by ad-hoc lookup (`HTTP-Switch`) and the find/link queue worker — they are not continuously synced as first-class objects. **Missing flows:** Account/Contact bidirectional sync and an Opportunity sync, so the LCC pipeline view and the Salesforce system-of-record do not drift.

### 3. No central dead-letter / health-observability plane

Failures scatter across 29 separate flow run-histories. There is no single table or pane that answers "what failed in the last 24h and why." The platform's only safety net is the 14-day-consecutive-failure auto-disable — which is exactly what silently took `HTTP Init LLC` offline for two weeks before anyone noticed. **✅ RESOLVED 2026-05-14** — the `flow_run_failures` table + `lcc_record_flow_failure` RPC landing zone is built on LCC Opps and the standard `PostDeadLetter` fault branch is wired into all 26 active flows (starter + Wave 2 + Wave 4); every flow failure now lands in one queryable forensic row and opens one de-duplicated `lcc_health_alerts` row that the hourly `lcc-cron-health-check` + daily briefing already surface. The two calendar sync flows are the lone deliberate exception (separate hardening). See backlog item #2 and `flows/FLOW_CHANGES_LOG.md`.

### 4. To Do and Calendar integration is one-directional

To Do is pulled into LCC; tasks created in LCC do not push back to To Do. Calendar is read from Outlook into Supabase; LCC cannot write or update Outlook calendar events. **Missing flows:** an LCC → Microsoft To Do task push, and an LCC → Outlook Calendar write path, if the product intent is for LCC to be an authoring surface and not just a mirror.

### 5. No Teams inbound channel

Teams is write-only — LCC posts to it. There is no Teams message / adaptive-card action → LCC path, so a user cannot action something from a Teams card and have it flow back. **Missing flow:** a Teams webhook / message-action trigger → LCC, if interactive Teams cards are on the roadmap.

### 6. Environment & deployment gaps (process, not flows)

- **No non-prod environment.** "Clone-first repair" today means save-as a copy *into the same production environment* with a `-NONPROD` suffix and a swapped trigger. A real non-prod environment would remove the risk of test executions touching live systems.
- **No contract tests / CI for flows.** Flows are hand-edited in the portal. There is no automated check that a change did not break a payload contract — the `['records']`-vs-`['value']` defect and the `base64ToBinary` bug both shipped silently.
- **Inconsistent schema versioning.** `schema_version` exists on a handful of flows (Log Activity to SF, the two calendar flows) but is not portfolio-wide, so there is no uniform way to evolve a contract safely.

### 7. Secret management (the open P0)

Exported flow definitions still carry plaintext credentials (the `Sync Flagged Emails to Supabase` push variant carries a plaintext apikey; the broader P0 from the initial audit covers embedded bearer/service-role keys). **Missing process:** rotate the exposed keys, move every secret to a Power Platform secure reference / environment variable (or Key Vault), and re-export to confirm redaction. Until this is done it is the single highest-priority item in the portfolio.

## Prioritized backlog — what to build next

1. **P0 — Rotate exposed keys + move secrets to secure references.** Closes the one RED flow and the standing P0. Owner action (credential rotation must be done by Scott directly in Vercel/Supabase/Power Platform).
2. **✅ DONE (P1) — Central dead-letter / `flow_health` table + standard fault-branch wiring.** Highest leverage: turned 29 blind spots into one queryable pane and removed the risk of another silent 14-day outage. **Landing zone built 2026-05-14** — `flow_run_failures` table + `lcc_record_flow_failure` RPC applied to LCC Opps; threads into the existing `lcc_health_alerts` pane. Reusable pattern in `flows/dead-letter-fault-branch-runbook.md`. **Wave 2 complete 2026-05-14** — fault branch wired into 6 flows (starter + 5 high-traffic/SF). **Wave 4 complete 2026-05-14** — fault branch rolled into the remaining 20 long-tail flows (SF mutation ×3, email-triggered ×4, Teams-post ×3, briefing ×2, HTTP orchestration ×3, sync/recovery ×5). **26 flows total are now on the dead-letter plane.** The lone deliberate exception is the two calendar sync flows (`LCC - Personal Calendar Sync`, `Outlook Calendar - LCC Sync`) — hardened separately in the 2026-05-13 campaign with their own `correlation_id`/`schema_version`/retry handling; folding them into the generic `PostDeadLetter` pattern is deferred, not missed. Gap #2 is **closed** — every flow failure now lands in one queryable `flow_run_failures` row and opens one de-duplicated `lcc_health_alerts` row that the daily briefing already surfaces. Per-flow evidence: `flows/FLOW_CHANGES_LOG.md` entries "Gap #2 …".
3. **P1 — Salesforce event-driven inbound (CDC / Platform Event → LCC webhook).** Removes the multi-hour staleness in LCC's Salesforce view; demote the existing polls to reconciliation.
4. **P2 — Account / Contact / Opportunity sync coverage.** Close the object-coverage gap so the pipeline view matches the system of record.
5. **P2 — Observability retro-fit (Waves 2-4 of the observability standard).** Correlation IDs, retry policies, schema versioning across the high-traffic and long-tail flows.
6. **P3 — Bidirectional To Do / Calendar, Teams inbound.** Only if LCC is meant to be an authoring surface for these, not just a mirror — confirm product intent first.
7. **P3 — Non-prod environment + a lightweight flow contract-test harness.** Removes the structural risk that hand-edits ship breakage silently.

## How this connects to the other docs

- The **observability standard** (`power-automate-observability-standards.md`) is the *quality bar* for any flow, existing or new — its compliance matrix is the per-flow backlog.
- This **gap analysis** is the *architecture backlog* — the flows and processes that do not exist yet.
- The **flow audit registry** (`power-automate-flow-audit.md`) is the *portfolio inventory* — what exists and its current status.
- The **change log** (`flows/FLOW_CHANGES_LOG.md`) is the *evidence ledger* — every change, with validation and rollback.

Together: the registry says what we have, the standard says how good it must be, the gap analysis says what we still need to build, and the change log proves what was done.

## Change log

- 2026-05-14 — Document created at the close of the 2026-05-13/14 remediation campaign. Pipeline mapped, seven structural gaps named, prioritized backlog set.
- 2026-05-14 — Backlog item #2 (dead-letter plane) advanced: Wave 2 complete — fault branch wired into 6 flows (starter + 5 Wave-2 flows). Remaining is the Wave 4 long tail.
- 2026-05-14 — **Backlog item #2 / Gap #3 CLOSED.** Wave 4 complete — fault branch rolled into the remaining 20 long-tail flows; 26 flows total on the dead-letter plane. Calendar sync flows are the lone deliberate exception. Gap #2 is the first structural gap from this analysis to close end-to-end.
- 2026-05-20 — **Gap #3 coverage extended (Round 3 finding R3-M-3d).** The Round 3 audit's coverage sweep verified the 26 above are genuinely wired, and caught a real gap: the 7-flow `SF -> LCC: *` family (built ~2026-05-16/17, *after* the campaign) was never on the plane. All 7 wired this round (Object Sync, Property Promotion, File Discovery & Move, Daily Bulk / On-demand File / On-demand Backfill, Retry & Dead-letter). **Plane now covers 33 flows** (26 + the R2-M-5 weekday-briefing clone + these 7). Deliberate exceptions unchanged (2 calendar sync flows + the pending `LCC Outlook Calendar Write`). The original "26 flows" line above is point-in-time; treat 33 as current. See `flows/FLOW_CHANGES_LOG.md` 2026-05-20 entry. Open follow-up: a controlled fire-test (R3-M-3c) to prove the run-after→PostDeadLetter chain fires on a real failure; and the standing P0 — the anon key is now inline in 33 flows, so a single shared dead-letter child flow is the DRY/secret-hygiene fix.
