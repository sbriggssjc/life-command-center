# Prompt 12 — LCC Health surface (connector/flow/DB observability)
- Priority: **P1** (prevents week-long silent failures like today's)
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/error-triage-2026-08-01.md`, `power-automate-observability-standards.md`, `power-automate-remediation-plan.md`
- Response file: `../responses/12-lcc-health-surface.response.md`

## Prompt (copy/paste to Claude Code)
```
Today's error wave (20 Power Automate flows failing incl. SF Deal->LCC Opportunity Sync 74 and LCC Get Artifact
685; Daily DB Checks failing on field_source_priority schema drift #710; Boot Check crash) only surfaced through
scattered weekly digests. Build a single "LCC Health" surface + daily digest so failures don't hide for a week:
1. Collect signals into one place: (a) PA flow run health — success/fail counts + last error per flow, via the
   Power Automate Management/Analytics API or a lightweight flow that logs each run outcome to Supabase; (b) the
   Daily DB Checks / field-source-priority audit annotations; (c) Boot Check + Railway deploy/health; (d)
   connector reachability probes for SF / Outlook / Sharefile / CoStar / the LCC MCP.
2. Store in a health table (e.g. lcc_health_events: source, check, status, count, last_error, first_seen, ts).
3. Surface: an LCC app "Health" panel (red/amber/green per subsystem, click through to the failing flow run /
   DB annotation) + a daily Ollama-summarized health digest (Teams/email) that states what's failing, since
   when, and the likely fix — grounded in the collected signals, no fabrication.
4. Alert on thresholds (a flow failing > N times, a DB check red, a failing deploy) so issues escalate same-day.
Verify: replay today's incidents and confirm the surface would have flagged SF Opportunity Sync + LCC Get
Artifact + #710 on 2026-08-01, not a week later.
```

## Verify
An LCC Health panel + daily digest that shows PA flow health, DB-check status, deploy/boot status, and connector
reachability; today's incidents would have been caught same-day.
