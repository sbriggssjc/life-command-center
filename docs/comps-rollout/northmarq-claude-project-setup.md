# Northmarq Claude — Project Stand-Up (mechanical steps)

**The instructions themselves are NOT here.** The single source of truth is the canonical Project prompt:
`Team Briggs - Documents/_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` (v1.9+). This file is only the mechanical
"how to stand up the shared Project" checklist — always edit the doctrine in the canonical prompt, never here.

Why a Project (not a connector): managed Northmarq Claude can't add the live MCP connector without an admin.
The canonical prompt is already written for that reality — it composes payloads and hands off to the LCC
`/bov` and `/comps` pages (no connector needed). So this gets the full methodology onto the team's Claude with
zero IT approval; live database pulls come from the Copilot Deal Agent (see `copilot-deal-agent-team-sharing-runbook.md`).

## Steps
1. **Create the Project.** Northmarq Claude → Projects → New → e.g. "Team Briggs — Deal Desk". Share it with the team.
2. **Paste the instructions.** Copy the full text of `NORTHMARQ_PROJECT_PROMPT.md` (v1.9+) into the Project's
   custom-instructions field. (Per that file's maintenance header: edit the master `.md` first, bump the version,
   then re-paste — never edit the Project directly.)
3. **Upload the Project knowledge** the Context Router (`CONTEXT_ROUTER.md`) lists, from these two folders:
   - From `_WORKFLOW/`: `CONTEXT_ROUTER.md`, `Briggs_Brand_Standards_v3.md`, `BOV_Underwriting_Standards.md`,
     `Comps_Column_Mapping.md`, `Briggs_Comps_Workflow.md`, `AI_ECOSYSTEM_GUIDE_v2.md`, `Capability_Access_Matrix.md`,
     `Team_Rollout_Architecture.md`, `Team_Member_Access_and_Flows_Setup.md`.
   - From `_AI-Context/Copilot-Context/` (identity/voice/frameworks/BD/personal): `BRIGGS-MASTER-CONTEXT.md`,
     `BRIGGS-WRITING-VOICE.md`, `BRIGGS-CRE-FRAMEWORKS.md`, `BRIGGS-BD-PLAYBOOK.md`, `BRIGGS-PERSONAL-CONTEXT.md`
     (and `BRIGGS-SYSTEM-PROMPT.md` if you want the full core).
   - From `Templates/`: the Briggs BOV + comps templates (NNN, MOB, comps standard/dialysis/**government**, lease).
   Upload whatever the Context Router's table lists as authoritative sources — that table is the master.
4. **Test.** Paste a small CoStar/SF comp export: "Build the Briggs sold-comps rows from this per Section 3C, apply
   reliable-or-exclude and MOB/MT naming, flag any outliers." Confirm it excludes unreliable-NOI comps, names
   multi-tenant MOB/MT, flags cap/rent mismatches, and hands off the payload to the /comps page (no claim of live DB access).

## Boundary (what this gives)
- ✅ Full Team Briggs methodology on the team's Claude, shared, zero approval — via compose-and-hand-off.
- ❌ Native live DB tools — those need the connector (admin) or come through the Copilot Deal Agent.
- Clean upgrade later: an admin adds the connector at `{MCP_BASE_URL}/mcp` (Bearer `LCC_API_KEY`) and this same
  Project gains native live tools on top of the knowledge.
