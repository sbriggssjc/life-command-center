# Claude Code queue — STATUS  (updated 2026-08-03, session 2g)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 20 | Trim queryComps/synthesizeComps descriptions <=300 (ChatGPT Actions limit) | P1 | open |
| 21 | Copilot Studio -> /mcp direct (verify streamable-HTTP + auth, connect, publish) | P1 | open |
| 18 | New PA flow failures (Health surface) + migration hygiene | P1 | open |
| 19 | Run census demographics backfill | on hold | blocked on Census key (Scott's request erroring) |
| 16 | Live-apply & config | — | only **CENSUS_API_KEY** remains |
| 07 | Data-backlog index (0-6 closed; 7-8: relocation live, census pending) | index | — |

## Microsoft-surface triage (2026-08-03) — see `docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md`
- **Immediate no-code fix:** add the **GenerateComps** action to the LCC Deal Agent in Copilot Studio — that's
  the only reason the workbook export threw ConnectorOperationNotFound (query/synthesize now work).
- **ChatGPT 300-char error** = prompt 20 (two descriptions over limit; swagger already short — port the text).
- **Northmarq Claude (no connector)** = keep routing live comps through the Copilot LCC Deal Agent; admin can add
  the org MCP connector later.
- **Copilot Cowork** reuses the published Copilot Studio agent — no new backend; give the agent MCP tools (21).

## Needs Scott / a deploy (not code)
- **Copilot Studio:** add the GenerateComps action to the LCC Deal Agent (no-code, do now).
- **CENSUS_API_KEY** -> Railway Variables + .env.local (radius demographics; on hold — key request erroring).
- **App redeploy** so prompt 10's PA-endpoint + auth fixes go live, then let PA retry (SF Opp Sync / Get Artifact).
- Merge any still-open branch PRs.

## Done (in `done/`)
01 cap-rate · 02 deal spine + 06 schema · 03 broker role · 04 loan propagation · 05 resolver · 08 Deal-tab UI ·
09 #710 (applied live, audit green) · 10 PA flows (app-side; deploy pending) · 11 comps (code; connector import
pending) · 12 LCC Health surface (**applied live**) · 13 property/contact connectivity (**applied live**) ·
14 gov CI (green) · 16 items 1-2 (live) · 17 data-integrity (live) · followups 2/3/4/5/6/7/8. 15 RETIRED.

## Migrations applied live by Cowork (Supabase MCP)
#710 field_source_priority (LCC Opps) · relocation+competition (Dialysis) · lcc_health_surface (LCC Opps, w/
connector_type::text fix) · lcc_contact_property_deal_reverse_reads (LCC Opps).

## Process: see `README.md`.
