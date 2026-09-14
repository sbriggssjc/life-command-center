# Connected-Agent Architecture (LCC + Surfaces + Work IQ)

**Status:** integrating design — this doc does **not** replace any canon. It ties the existing
pieces together and adds the Copilot connected-agent + Work IQ layer on top of them.
**Reconciles with (edit those, not this, for their domains):**
`SURFACE_CAPABILITY_PARITY.md` · `docs/copilot/DEAL-AGENT-SOURCE-OF-TRUTH.md` ·
`docs/copilot/agent-instructions.md` · `docs/architecture/copilot_agent_catalog.md` ·
`copilot_authoritative_architecture_plan.md` · `WRITE_SURFACE_POLICY.md`.
**Last written:** July 2026.

---

## 0. The consistency contract — what actually guarantees "same output, everywhere, every time"

The objective is **not** "one agent." It is: from any front door — Claude (Personal / Cowork /
Northmarq), Copilot, ChatGPT — every request on every topic (work **or** personal) resolves through the
same brain, the same rules, and the same memory, and returns a substantially identical result. That holds
because every front door **binds to the same canonical singletons and none of them forks**:

- **Brain (one).** LCC engines + data: comps, BOV/comps workbooks, property/contact/queue/pipeline, and the
  ingest → classify → route → learn pipeline — *"data enters once, routes everywhere"*
  (`lcc_intelligent_operating_system_v2.md`). *"LCC is the brain; Microsoft is where work gets delivered."*
- **Memory (one).** **Cortex** — `draft_and_log` signals, `log_memory`/`recall_memory`, email-relationship
  discovery, activity timelines. Write-gated (`log_memory` Claude/MCP-only).
- **Instruction & policy canon (one).** How each topic is handled — comps invariants, filing convention,
  email routing, logging/touchpoint cadence, writing voice, confirmation tiers. Authored once; every surface
  **renders** it, none **rewrites** it.
- **Knowledge / context (one).** BRIGGS-* frameworks + `BRIGGS-PERSONAL-CONTEXT` — work and personal.

**The only load-bearing rule:** *single-source every capability; every surface and agent binds to it, none
forks it.* The number of front doors and agents is **unconstrained** — add as many as you like. What must
stay exactly one is the **source of truth per capability**. ("One agent, one connector" was this rule in a
too-specific costume — its real job was to stop divergent forks of the LCC connector/instructions, which is
exactly what protects consistency. Keep the anti-fork intent; drop the accidental "only one agent" reading.)

**The enemy is drift** — the same topic answered differently on two surfaces because instructions or engines
were copied and diverged. Defenses: (a) engines are single-implementation and every surface calls the *same
handler* (parity-doc invariant — MCP and HTTP return byte-identical JSON); (b) instructions live in one canon
that surfaces *reference*, not re-author; (c) parity tests confirm identical outputs across surfaces.

### Canon invariants (authored once, enforced on every front door)
- **Email/Outlook/Teams comms route through LCC only** — `DraftOutreachEmail` / `DraftSellerUpdateEmail`
  (Power Automate → Outlook draft). Never Work IQ or any native M365 connector for email.
- **Confirmation tiers** — Tier 0 read · Tier 1 lightweight · Tier 2/3 explicit `user_confirmed: true`
  (`WRITE_SURFACE_POLICY.md`).
- **Read-only HTTP**; `log_memory` never exposed over HTTP.
- **System-of-record** — Gov/Dia read via LCC proxy only; canonical writes through audited paths.
- **Comps come only from `SynthesizeComps`/`QueryComps`**, rendered to the Team Briggs template; formula
  columns never overwritten.

---

## 1. The layer cake

```
KNOWLEDGE   BRIGGS-* context (incl. BRIGGS-PERSONAL-CONTEXT) + CONTEXT_ROUTER  ── voice, frameworks, personal
MEMORY      Cortex — signals · conversational memory · relationship/email discovery · timelines  (write-gated)
BRAIN       LCC engines — comps · BOV/comps workbooks · property/contact/queue/pipeline · orchestration
DATA        Supabase (OPS · Gov · Dia) + Salesforce
EXECUTION   Microsoft 365 (SharePoint / Word / Excel) — reached ONLY on the execution plane, in-tenant
```

Every surface is a **client** of Brain + Memory + Knowledge. Only the execution plane touches M365.

## 2. Two planes

- **Reasoning / authoring plane** — Personal Claude (MCP), Claude Cowork (skills + MCP),
  Northmarq Claude (Project, compose-and-hand-off), ChatGPT (OpenAPI). Models, drafts, pulls comps.
  Touches only LCC's own data — **no Northmarq-file egress**.
- **M365 execution plane** — the LCC Deal Agent + its connected specialists, inside Northmarq's tenant.
  The only place SharePoint/Word/Excel are touched. Governed by Work IQ (user-scoped + audited) and by
  LCC's confirmation tiers.

Handoff between planes: Claude reasons → produces a payload/artifact; the Deal Agent files or fetches it
in-tenant. For a workbook the reasoning plane can't reach (>5 MB), the Docs specialist edits it via
Office Scripts and hands the result back.

## 3. Surfaces (from `SURFACE_CAPABILITY_PARITY.md`) — unchanged

| Surface | Mechanism | Reaches |
|---|---|---|
| Personal Claude | MCP connector + personal skills | Brain + Cortex (all 12 tools incl. `log_memory`) |
| Claude Cowork | MCP tools + Cowork skills | Brain + Cortex |
| Northmarq Claude | Project prompt → `/bov`, `/comps` (no connector) | Brain (compose-and-hand-off) |
| ChatGPT | GPT Action (`lcc-openapi.yaml`, Bearer) | Brain read + comps (no `log_memory` by design) |
| **Copilot LCC Deal Agent** | **LCC Intelligence** connector **+ connected specialists (Work IQ)** | Brain + Cortex + **M365 execution** |
| LCC in-app Copilot | `/api/chat` | Brain orchestration |

The Copilot row is the only one that gains anything new here: the connected specialists.

## 4. The connected-agent model

Agents are **front doors, not the source of truth** — you can run as many as capability demands; consistency
is guaranteed by §0 (everything binds to the one brain/memory/canon), not by their count. In practice the
LCC Deal Agent stays the **orchestrator** and keeps every existing flow via the one LCC Intelligence
connector, and it gains **connected specialist agents** for capabilities that (a) LCC doesn't already provide
and (b) carry tool sets too large to sit on the orchestrator.

**Why specialists at all:** Work IQ SharePoint is 35 tools you can't prune; Copilot Studio caps an agent at
~70. Piling SharePoint + Word + Excel onto the orchestrator would blow the budget and blur routing. So they
live on their own agents, connected to the orchestrator.

```
User (Teams / M365 Copilot / desktop)
        │
        ▼
LCC DEAL AGENT  ── orchestrator ── LCC Intelligence connector (all existing flows + Cortex memory)
        ├──▶ Document Files Agent      · Work IQ SharePoint (35)  · find/read(≤5MB)/file deal docs
        └──▶ Document Assembly Agent    · Excel Online + Office Scripts + Work IQ Word  · BOV/pro-forma bodies (>5MB)
        (email/comms NEVER delegated to a specialist — stays on LCC DraftOutreachEmail path)
```

### 4.1 What becomes a separate agent vs. a flow

The `copilot_agent_catalog.md` roster (Daily Briefing, Intake & Triage, Prospecting, Listing Pursuit,
Marketing/Seller Reporting, Deal Execution, Relationship Memory, Pipeline Intelligence, Document Assembly)
are **logical roles**. Most are already realized as **flows inside the LCC Deal Agent** and should stay that
way — they run entirely on LCC Intelligence tools.

A logical role graduates to a **separate connected agent only when** it needs an external tool set the
orchestrator can't absorb. Today that's exactly the document/file roles:

| Catalog role | Realized as | Why |
|---|---|---|
| Daily Briefing, Prospecting, Intake & Triage, Deal Execution, Relationship Memory, Pipeline Intelligence | **Flows in the LCC Deal Agent** | Pure LCC Intelligence tools; no external tool set |
| Marketing / Seller Reporting | **Flow** (drafting via `DraftSellerUpdateEmail`) | Email stays on LCC path |
| **Document Assembly** (BOV/OM/proposal bodies) | **Connected Docs Agent** | Needs Word + Excel Online/Office Scripts (external, tool-heavy) |
| **SharePoint file ops** (find/read/file deal docs) | **Connected Files Agent** | Work IQ SharePoint = 35 tools; distinct capability |

### 4.2 Where Work IQ is — and is NOT — used

- ✅ **SharePoint document operations** — the one net-new capability. Find, read (≤5 MB), and file deal
  documents into the Team Briggs folder convention.
- ⚠️ **Word / Excel bodies** — Work IQ Word for doc bodies; Excel workbook cell edits use **Excel Online
  (Business) + Office Scripts** (Work IQ has no Excel, and its file cap is 5 MB).
- 🚫 **Email / Outlook / Teams messaging** — never Work IQ. LCC `DraftOutreachEmail` / `DraftSellerUpdateEmail`
  and existing Power Automate/Teams flows own all comms (`agent-instructions.md`).
- 🚫 **Comps / property / contacts / briefing / tasks / triage** — never Work IQ or knowledge files;
  these are LCC Intelligence tools and Cortex. Comps come ONLY from `SynthesizeComps`/`QueryComps`.

## 5. Cortex (memory) across the fleet

Cortex stays centralized in LCC. Specialist agents do **not** keep their own memory; when they act, the
orchestrator logs to Cortex via the LCC Intelligence memory action (`Log Conversational Memory`). The write
tool `log_memory` remains Claude/MCP-only (never HTTP, never a specialist). This keeps one relationship
graph and one durable signal record no matter which agent or surface did the work.

## 6. Personal side

`BRIGGS-PERSONAL-CONTEXT.md` is a first-class knowledge source (Deal Agent Knowledge + Personal Claude).
"Life Command Center" spans personal + work by design; Cortex memory and the personal context travel with
every surface so Personal Claude and the team Deal Agent share the same relationship/voice grounding.
Personal-only material is scoped by which surface/knowledge set loads it — it is not pushed onto the
team Northmarq surfaces.

## 7. Governance (what to tell Northmarq IT)

- Reasoning plane touches only LCC's own Supabase — no Northmarq-file egress.
- Execution plane uses **Work IQ MCP**: user-scoped (acts only within the signed-in person's permissions),
  every call logged + policy-checked, stays in the tenant boundary.
- **Least privilege lives in SharePoint permissions**, not connector toggles (Work IQ preview can't prune tools).
- Writes pass the LCC confirmation gate (`user_confirmed: true`) and, for tenant files, Work IQ's
  "ask before running."
- **Durable backbone (later):** an IT-owned Entra app with `Sites.Selected` on just the Team Briggs library —
  the narrow, grantable ask that replaces personal credentials.
- Key hygiene: rotate `LCC_API_KEY` (parity checklist P1); per-surface keys are the roadmap.

## 8. Build sequence

1. **Rotate `LCC_API_KEY`**; update every surface after.
2. Confirm the LCC Deal Agent orchestrator (LCC Intelligence) — all existing flows intact.
3. Stand up the **Document Files Agent** (Work IQ SharePoint): pin the Team Briggs site via Inputs; end-user
   auth; connect to the orchestrator; use the routing descriptions in `connected-agent-descriptions.md`.
4. Add the **Document Assembly Agent** (Excel Online + Office Scripts + Work IQ Word) — unblocks >5 MB pro-forma edits.
5. Keep every non-document role as a **flow** in the orchestrator (no new agents for those).
6. Test the two flows in `connected-agent-descriptions.md`; verify comps still come only from `SynthesizeComps`.

## 9. Open decisions for Scott

- **Restate the doctrine in `DEAL-AGENT-SOURCE-OF-TRUTH.md`** from "one agent, one connector" to the
  **consistency contract (§0):** *single-source every capability; any number of front doors and agents may
  bind to it; none forks it.* Concretely — one canonical **LCC Intelligence** connector (never forked);
  specialists permitted when they (a) never duplicate an LCC tool, (b) never touch email/comms, (c) reach LCC
  only through that connector. This preserves the anti-fork intent that actually protects consistency, without
  the accidental single-agent cap.
- **>5 MB documents:** Work IQ can't read/write them → Docs Agent via Office Scripts is the required path.
- **Per-surface API keys** vs. the single `LCC_API_KEY` (recommended follow-up).
```
