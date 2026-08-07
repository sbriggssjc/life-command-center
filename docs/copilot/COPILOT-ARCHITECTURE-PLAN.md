# Copilot LCC — Architecture Plan (multi-agent, phased)

**Prepared 2026-08-07 · goal: the full intended LCC surface working reliably in Copilot Studio, no orchestration overload**

## Root cause (confirmed this session)

The LCC Deal Agent fails at orchestration start ("I'm sorry, I'm having trouble right now") — before any
tool is called. It is **not** auth, tool naming, the gzip response, or a broken connection. All of those were
tested and ruled out:

- Engine + data: healthy (live briefing pulled through the MCP path).
- Connection: healthy (custom-connector Test → HTTP 200, schema validation succeeded; the garbled Body panel
  was the test console showing the edge-gzipped stream, which the runtime decompresses).
- The failure is **configuration overload**, against Microsoft's own limits:
  - The `LCC Intelligence` connector exposes **95 operations** to one agent. Generative orchestration
    recommends **≤ 25–30 tools** (hard cap 128); Microsoft advises *splitting* the agent past **30–40 choices**.
  - The agent **instructions inline the full Canon v1.4.3 block**, over the **8,000-character** instructions limit.

The 95 count is inflated by design: the `copilot-spec-v2` generator emits every action THREE ways — discrete
PascalCase (`GetDailyBriefingSnapshot`), snake_case `/compat/` aliases (~48 duplicates), and the
`dispatchCopilotAction` gateway — plus typed ops. Most of those 95 are redundant.

## Decision

**End state: multi-agent (child agents).** It is the only option that carries the entire designed surface while
keeping every orchestration layer under limits. Single-slimmed-agent was rejected because it permanently caps the
surface at ~15–25 tools and drops designed capabilities.

**Path: hybrid / phased** — get Copilot working today at a sane tool count, then expand into child agents. This
de-risks the build (we validate the whole stack once before adding orchestration hops) and lets us confirm the
billing/harness question before committing to multi-agent.

## Phased plan

### Phase 0 — Foundation (server-side; benefits every path)
- **Claude Code:** slim `copilot-spec-v2` (in `api/_shared/action-schemas.js`) to emit ONLY discrete PascalCase
  operations — drop the ~48 `/compat/` snake_case aliases and the `dispatchCopilotAction` gateway. Result: the
  connector source drops from 95 → ~48 real operations, with no duplicate names and no catch-all gateway for the
  orchestrator to fall into. Add a guardrail test asserting the op set contains no compat/gateway entries.
  Redeploy `tranquil-delight` (+ standalone MCP for parity).
- **Confirm harness + billing** for the NorthMarq environment: whether child/connected agents run on the standard
  harness or the GitHub Copilot harness (Copilot Credits, usage-based), so multi-agent doesn't surprise on
  consumption. This gates Phase 2+.
- Leave `/api/copilot-spec` (full) and `/api/gpt-spec` (ChatGPT curated) unchanged.

### Phase 1 — Get Copilot working (interim single agent)
- On the LCC Deal Agent **Tools** page, disable everything except the ~15 essentials:
  GetDailyBriefingSnapshot, GetMyExecutionQueue, GetPipelineIntelligence, GetHotBusinessContacts, SearchEntities,
  GetRelationshipContext, GenerateProspectingBrief, DraftOutreachEmail, DraftSellerUpdateEmail,
  ListStagedIntakeInbox, TriageInboxItem, CreateTodoTask, LogCall