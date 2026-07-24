# Unified Architecture — reconciling the two homes into one brain

> Written after connecting `_WORKFLOW` + `_AI-Context` (2026-07-24). Purpose: there are now **two
> documentation homes** describing the same system — the SharePoint `_WORKFLOW` set (mature, team-facing) and
> the repo `docs/os/` set (newer, enforcement-focused). This doc names the ONE top router, the ownership split,
> and exactly which files collapse into which — so we have one brain, not two maps.

## 0. The one rule (both homes already agree on it)
*"One master per topic, one place to find it, loaded first at every door"* — that's `CONTEXT_ROUTER.md`'s
rule and my `docs/os/` consistency contract. They are the same principle. So there must be **one top-level
router**, not two.

**Decision: `CONTEXT_ROUTER.md` (SharePoint `_WORKFLOW`) is the single top router.** It already spans into the
repo (it has a row pointing at `life-command-center/docs/copilot/`). We add rows to it for the OS system layer;
the repo's `REGISTRY.md` becomes the **repo-side sub-index** that CONTEXT_ROUTER points to — not a competing map.

## 1. Ownership split — who owns what (no overlap)
| Home | Owns | Key files |
|---|---|---|
| **`_WORKFLOW` (SharePoint)** — team-facing doctrine, methodology, knowledge, routing | *What the work is and how to do it* | `CONTEXT_ROUTER.md` (top router), `_MASTER_INDEX.md` (session kickoff), `NORTHMARQ_PROJECT_PROMPT.md` (methodology SoT), `AI_ECOSYSTEM_GUIDE_v2.md` (5-context narrative), `Capability_Access_Matrix.md` (rollout dashboard), `MULTI_AI_DEPLOYMENT_CHECKLIST.md` (deploy process), brand/comps/BOV standards |
| **`_AI-Context/Copilot-Context` (SharePoint)** — identity/voice/knowledge | *Who Briggs is, the voice, the frameworks* | `BRIGGS-MASTER-CONTEXT`, `BRIGGS-WRITING-VOICE`, `BRIGGS-CRE-FRAMEWORKS`, `BRIGGS-BD-PLAYBOOK`, `BRIGGS-PERSONAL-CONTEXT` |
| **`docs/os/` (repo)** — system architecture + **enforcement** | *How the system stays consistent and current* | `canon/` + `tools/` (render/parity), `SURFACE-SYNC-PROTOCOL.md`, `architecture/` (connected-agents, unification, office-scripts), `BUILD-STATUS.md`, `ACCESS-TOPOLOGY.md`, `REGISTRY.md` (repo sub-index) |
| **`_core.md` / `_FileSystem/claude-md/`** — the auto-sync substrate | *Embeds the router/core into every door's CLAUDE.md* | `_core.md` (need this folder connected to fully reconcile) |
| **LCC repo engines** (`mcp/`, `api/`) + **Supabase** + **Cortex** | *The brain: data + logic + memory* | one implementation each |

## 2. The duplications, and how they collapse
My `docs/os/` reinvented several things you already had. Reconciliation:

| My repo file | Your existing master | Reconciliation |
|---|---|---|
| `docs/os/README.md` (start-here) | `_MASTER_INDEX.md` (upload-first) | README stays the *repo/engineering* start-here; it now points UP to `CONTEXT_ROUTER.md` as the top router. `_MASTER_INDEX` stays the team session-kickoff. |
| `docs/os/REGISTRY.md` (canonical map) | `CONTEXT_ROUTER.md` (top router) | REGISTRY becomes the **repo-side sub-index**; CONTEXT_ROUTER gets a row pointing to it. One top router. |
| `docs/os/SURFACE-SYNC-PROTOCOL.md` | `MULTI_AI_DEPLOYMENT_CHECKLIST.md` | The checklist stays the **canonical human process**; SURFACE-SYNC + render/parity are the **automation/enforcement** of it. Cross-reference; don't duplicate the steps. |
| `docs/os/canon/blocks/*` | `NORTHMARQ_PROJECT_PROMPT.md` + `BRIGGS-*` + standards | The canon blocks are the **enforced distillation** (machine-checkable floor) of those richer masters — derived-from, never competing. NPP stays the methodology SoT. |
| `docs/os/architecture/connected-agent-*` + `unification-*` | `AI_ECOSYSTEM_GUIDE_v2.md` | The guide stays the **high-level 5-context narrative**; `architecture/` holds the **deep system detail** (Work IQ specialists, the one-URL unification). Guide → references `architecture/`. |
| `docs/os/canon` render/parity | `_core.md` auto-sync | Both push shared rules to every door. **Need to see `_core.md`** to decide whether render/parity *drives* the claude-md sync or runs beside it. Flagged as the open reconciliation. |

## 3. The doors (reconciled) × enforcement
Your five AI contexts + API/Email, each now tied to the enforcement layer:

| Door (your name) | Canon delivery | Data/tools | Enforcement status |
|---|---|---|---|
| **PC** — Personal Claude/Cowork | skills + `_core.md`/CLAUDE.md | MCP (full) | ⏳ skills reflect canon (sync pending) |
| **ChatGPT** — Custom GPT | persona (≤8000) + **LCC-CANON Knowledge file** | LCC Actions (unified URL) | ✅ live |
| **NP** — Northmarq Claude Project | `NORTHMARQ_PROJECT_PROMPT.md` §0 router (v1.9) | compose-and-hand-off (tool-blocked) | ✅ aligned (v1.9 is the richer source) |
| **CoP** — Copilot LCC Deal Agent | `agent-instructions.md` (CANON region) + BRIGGS-* knowledge | LCC Intelligence connector + Work IQ | ✅ live |
| **Personal M365 Copilot (AI 5)** | files in personal OneDrive `_Briggs-CRE-Context/` | in-app only | ⏳ not canon-tracked; see ACCESS-TOPOLOGY |
| **API / Email** | n/a (substrate) | shared engine / intake | ✅ |

## 4. Stale/overlooked items to correct (the real gaps)
1. **`AI_ECOSYSTEM_GUIDE_v2.md` — AI 2 ChatGPT setup is stale.** It says paste the full NPP as instructions,
   use `ai-plugin.json`, base URL `lcc-production.up.railway.app`, "27 actions." Reality now: **concise persona
   + `LCC-CANON.md` Knowledge file** (8000-char cap), `lcc-openapi.yaml` (9 ops), base URL **`tranquil-delight`**.
   → update to v3.
2. **The old URL / two-server language** (`lcc-production…`, "on the MCP server") in `AI_ECOSYSTEM_GUIDE`,
   `Capability_Access_Matrix`, `MULTI_AI_DEPLOYMENT_CHECKLIST` — now **one URL** (`tranquil-delight`) after
   unification Phase 1. → correct all three.
3. **`declarative-copilot.json` / `ai-plugin.json`** referenced as live (AI 4 Wave 0) — superseded by the
   "LCC Intelligence" v2 connector (`DEAL-AGENT-SOURCE-OF-TRUTH.md`). → mark historical.
4. **CONTEXT_ROUTER has no row** for the OS enforcement layer, unification, build-status, or access-topology.
   → add rows (its own rule says an un-homed topic gets a row).
5. **`CHATGPT_GPT_INSTRUCTIONS.md`** (in `_WORKFLOW`) is the old long version → replace with the persona +
   Knowledge-file pattern.
6. **Personal side (AI 5 + D-drive island)** isn't reconciled with `ACCESS-TOPOLOGY.md`. The personal OneDrive
   `_Briggs-CRE-Context/` folder and the D-drive island are the "reachability exceptions." → cross-link.
7. **`_core.md` sync vs render/parity** — potential duplicate deploy mechanisms. → reconcile once `_FileSystem/`
   is connected.

## 5. Recommended reconciliation actions (in order)
1. Add the OS rows to `CONTEXT_ROUTER.md`; point `docs/os/README`+`REGISTRY` UP to it as the top router. *(low risk, done in this pass where possible)*
2. Update `Capability_Access_Matrix.md` for unification (one URL; ChatGPT read+comps live via the GPT).
3. Cut `AI_ECOSYSTEM_GUIDE_v2 → v3`: correct the ChatGPT setup, the URL, retire `ai-plugin.json`/`declarative-copilot.json`, add the Work IQ specialists + render/parity + Cortex naming.
4. Correct `MULTI_AI_DEPLOYMENT_CHECKLIST.md` (one URL; the render/parity automation).
5. Replace `CHATGPT_GPT_INSTRUCTIONS.md` with the persona + Knowledge-file pattern.
6. Reconcile `_core.md` sync with render/parity (needs `_FileSystem/` connected).

## 6. Folders still needed to fully consolidate
- **`C:\Users\scott\_FileSystem\claude-md\`** (or wherever `_core.md` + the synced `CLAUDE.md` cores live) —
  to reconcile the existing auto-sync with render/parity so there's ONE deploy mechanism.
- **Personal OneDrive `_Briggs-CRE-Context/`** — to fold AI 5 (personal M365 Copilot) into the canon sync.
- (Optional) the `Templates/` and a sample `Projects/[Property]/` — only if we want the OS to validate
  deliverables against the benchmark workbooks.
