# Claude Instructions — Source of Truth & Maintenance

Authoritative, uploadable instructions for the two **claude.ai** surfaces the team uses. Same
pattern as `docs/copilot/DEAL-AGENT-SOURCE-OF-TRUTH.md`: edit ONLY the canonical files below, then
upload/paste the latest into each surface so we never fork versions.
Last reconciled: July 2026.

## Canonical files — edit ONLY these, then upload
| Surface | Canonical file (repo) | How the change reaches Claude |
|---|---|---|
| **Personal Claude** (Scott's account) | `docs/claude/personal-claude-instructions.md` | Claude.ai → Settings → **Profile / Personal preferences** (or a Personal Project's Instructions) → paste the whole file → Save. |
| **Northmarq Claude Project** (team) | `docs/claude/northmarq-claude-instructions.md` | Claude.ai → the **Northmarq** Project → **Instructions** (Edit) → paste the whole file → Save. |

Both surfaces must also have the **LCC connector** enabled (Settings → Connectors → LCC), which is
what exposes `synthesize_comps` / `query_comps` and the other LCC tools.

## Why these exist
Personal Claude has *direct* Supabase access, so without instruction it hand-writes SQL for comps
(bypassing dedup, multi-source blending, and the Briggs export). These files force every Claude
surface onto the shared comps engine — identical to how the Copilot Deal Agent behaves.

## Update protocol
1. Change a rule → edit the canonical file → re-paste into that surface → done.
2. Keep the **Comps** section in sync with `docs/copilot/agent-instructions.md` (the Copilot Deal
   Agent) so all three surfaces behave identically.
3. One file per surface — never keep a second copy elsewhere.
