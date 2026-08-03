# Claude Code queue — STATUS  (updated 2026-08-03, session 2h)

## Open (in `prompts/`)
| # | Prompt | Priority | State |
|---|--------|----------|-------|
| 22 | MCP server unification (one URL) + protocol bump for Copilot | P0 | **open — unblocks Copilot MCP + fixes 2-server drift** |
| 21 | Copilot Studio -> /mcp connect + publish | P1 | readiness DONE; Part 2 **blocked on 22** (/mcp 404s at canonical URL) |
| 18 | Recurring PA flow failures + migration hygiene | P1 | **code DONE** (cast + test); tenant-side PA checks remain for Scott |
| 19 | Run census demographics backfill | P1 | **blocked — CENSUS_API_KEY set but returns "Invalid Key"** |

## This session's returned responses (reconciled 2026-08-03)
- **07** data-backlog index — reconciled: prompts 0-6 closed, 7/8 carry-forward (7 applied live earlier; 8 = census). -> done.
- **16** live-apply — items 1-2 live+verified; item 3 (census) blocked. Claude Code found the loaded CENSUS_API_KEY is effectively blank/invalid. -> done (census tracked in 19).
- **18** PA flows — repo migration hygiene fixed (`connector_type::text`) + regression test; `node --test` passes.
  Claude Code **cannot edit Power Automate** (no PA connector). Finding: the amber flows are mostly **stale/retired**,
  not actively failing — the two biggest (Unflag Completed Email Tasks 253, To Do Sync 63) last ran Jul 29 (retired).
- **19** census — ran the backfill; **Census returns "Invalid Key"** for the configured key. 0 rows written; coverage still 85. Needs a valid key.
- **20** ChatGPT trim — DONE: queryComps 224 / synthesizeComps 200 chars; YAML parses; structure unchanged. Ready to re-import. -> done.
- **21** Copilot MCP readiness — DONE: **`/mcp` 404s at tranquil-delight** (that host is the root app; MCP is a *separate* deployed service). Server code is close to streamable-HTTP but advertises `protocolVersion 2024-11-05`. -> spawned **prompt 22**.

## Needs Scott (not code)
- **Census:** obtain a VALID key at api.census.gov/data/key_signup.html (current one authenticates as Invalid),
  set in Railway Variables + .env.local, then re-run prompt 19.
- **Power Automate (tenant):** confirm retired flows **Unflag Completed Email Tasks** + **To Do Sync** are turned
  **Off** (so they stop showing amber); verify **SF Daily Bulk File Backfill** latest run; repoint **RCM** +
  **LoopNet** flows if they still point at stale Vercel hosts.
- **ChatGPT:** re-import the trimmed `lcc-openapi.yaml` into the "Briggs CRE Analyst" GPT (prompt 20 done).
- **After prompt 22 deploys:** connect the LCC Deal Agent to `/mcp` + publish to M365 channel (prompt 21 Part 2).

## Done (in `done/`)
01-14 (see prior), 16 (items 1-2 live; census->19), 17 data-integrity, 20 ChatGPT trim, 07 index. 15 RETIRED.
Session 2h added: 07, 16, 20 prompts -> done; all 7 returned responses -> done.

## Migrations applied live by Cowork (Supabase MCP)
#710 field_source_priority · relocation+competition (Dialysis) · lcc_health_surface (connector_type::text) ·
lcc_contact_property_deal_reverse_reads.

## Process: see `README.md`.
