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
  ListStagedIntakeInbox, TriageInboxItem, CreateTodoTask, LogCallNote, SynthesizeComps, QueryComps.
  (After Phase 0, the compat dupes + gateway are already gone, so this is fast.)
- **Slim the instructions under 8,000 chars:** move the full Canon block into the **LCC-CANON knowledge file**
  (already uploaded); keep the instructions = router/flows + the tool map with CORRECT operation names + a pointer
  to the knowledge file for detailed rules.
- Republish; run the smoke test (briefing, queue, comps) against the known-good baseline.
- **Exit criteria:** briefing + queue + comps return live data in the test panel. This proves engine → connector
  → orchestration end-to-end.

### Phase 2 — Design the child-agent architecture
- Parent (LCC Deal Agent) becomes a thin **router**: canon knowledge + routing instructions, minimal/no direct tools.
- Child agents (each 3–5 tools, crisp non-overlapping descriptions):
  - **Briefing & Pipeline** — GetDailyBriefingSnapshot, GetMyExecutionQueue, GetPipelineIntelligence,
    GetWorkCounts, GetSyncRunHealth
  - **Comps** — SynthesizeComps, QueryComps, generateComps
  - **Contacts & Prospecting** — GetHotBusinessContacts, SearchEntities, GetRelationshipContext,
    GenerateProspectingBrief
  - **Outreach** — DraftOutreachEmail, DraftSellerUpdateEmail, DraftReplyFromInbox
  - **Intake & Triage** — ListStagedIntakeInbox, TriageInboxItem, CreateTodoTask, LogCallNote
- Write each child's focused instructions from the relevant canon block; define input/output passing where needed.

### Phase 3 — Build & test child agents
- Create each child agent; assign only its connector operations; give it a distinct description so the router
  delegates correctly (Microsoft: routing is driven by child name + description — avoid overlap).
- Wire children under the LCC Deal Agent; test routing per category against the smoke-test baseline; republish.

### Phase 4 — Roll the pattern to the full designed surface
- Bring back the remaining categories (email templates, listing-BD pipeline, document assembly, review queues,
  sync ops) as their own child agents or folded into existing ones — each staying within limits.
- This realizes the full intended design with no single orchestrator ever overloaded.

## Tradeoffs (accepted, eyes open)
- **Latency:** each request adds a parent → child orchestration hop.
- **Management surface:** more agents to test/govern (mitigated by the phased build + the smoke-test baseline).
- **Billing:** confirm harness/credits in Phase 0 before committing.

## Open / carried items
- Rotate `LCC_API_KEY` (exposed earlier) — refresh the connection credential when we touch the connector.
- The other three surfaces (ChatGPT, Personal-Claude, Northmarq) are unaffected by this Copilot work.
