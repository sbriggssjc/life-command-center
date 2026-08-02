# Claude Code queue — STATUS  (updated 2026-08-01, session 2f)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 18 | New PA flow failures (Health surface) + migration hygiene | P1 | open |
| 16 | Live-apply & config | — | only **CENSUS_API_KEY** remains (items 1-2 + 12/13 applied live) |
| 07 | Data-backlog index (0-6 closed; 7-8: relocation live, census pending) | index | — |

## Needs Scott / a deploy (not code)
- **CENSUS_API_KEY** -> Railway Variables + .env.local (radius demographics; 994 properties uncovered).
- **App redeploy** so prompt 10's PA-endpoint + auth fixes go live, then let PA retry (SF Opp Sync / LCC Get Artifact).
- **Copilot / Claude Northmarq connector import** of the updated Swagger/package + LCC API key (prompt 11 live step).
- Merge any still-open branch PRs (e.g. Dialysis #7355 cap-rate).

## Done (in `done/`)
01 cap-rate · 02 deal spine + 06 schema · 03 broker role · 04 loan propagation · 05 resolver · 08 Deal-tab UI ·
09 #710 (applied live, audit green) · 10 PA flows (app-side; deploy pending) · 11 comps (code; connector import
pending) · 12 LCC Health surface (**applied live** — reports #710 green + new amber flows) · 13 property/contact
connectivity (**applied live**) · 14 gov CI (green) · 16 items 1-2 (live) · 17 data-integrity (live: 35724
is_northmarq=true) · followups 2/3/4/5/6/7/8. 15 RETIRED.

## Migrations applied live by Cowork (Supabase MCP)
#710 field_source_priority (LCC Opps) · relocation+competition (Dialysis) · lcc_health_surface (LCC Opps, w/
connector_type::text fix) · lcc_contact_property_deal_reverse_reads (LCC Opps).

## Process: see `README.md`.
