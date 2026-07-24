# Access & Device Topology — how the OS is reachable from everywhere

How the brain, memory, canon, tools, and files are reached across Scott's devices — and where the gaps are.
The design goal: **the parts that must be identical everywhere live in the cloud; the parts that live on one
disk are the exceptions to plan around.**

## The core principle
- **Brain (LCC engines/data) + Cortex (memory) are cloud/server-side** → **device-agnostic**. Every surface
  on every device reaches the same brain and the same memory. This is *why* "same output everywhere" holds
  regardless of which device you're on — it doesn't depend on any local file.
- **Canon lives in git** (`life-command-center` repo). Push to the GitHub remote and any device can pull it →
  the canon is reachable/editable from all four devices. (Edit on the home Desktop, **push**, so a chat on the
  Surface or work laptop reads the current canon, not a stale local copy.)
- **Files are the exception** — reachability depends on *where the file is stored*, not just the device.

## Your devices → what each reaches
| Device | Surfaces available | Local files it can bridge (Claude Cowork) | Reaches brain + Cortex | Reaches Team Briggs SharePoint |
|---|---|---|---|---|
| **iPhone** | Claude (cloud Cowork), ChatGPT, Copilot/Teams | none (no local bridge) | ✅ (cloud) | ✅ via Copilot in-tenant |
| **Surface laptop** | Claude desktop (+ device bridge), browsers, Copilot | whatever is synced to the Surface | ✅ | ✅ (Copilot); ✅ files if OneDrive-synced locally |
| **Work laptop (Northmarq)** | Copilot/Teams (native tenant), Claude, ChatGPT | work-synced folders | ✅ | ✅ natively (in-tenant) |
| **Home Desktop (this one)** | Claude desktop (+ device bridge to C: and D:), browsers | **C:** `life-command-center` (canon+engine source), **D:** local-only files | ✅ | ✅ if Team Briggs OneDrive is synced here |

## Your storage → who can reach it
| Storage | Reachable by | Cross-device? | Recommendation |
|---|---|---|---|
| **Team Briggs – Documents** (work SharePoint, Northmarq tenant) | Copilot Work IQ (in-tenant, any device); Claude Cowork bridge if synced locally | ✅ (cloud) | Canonical home for **work** files/deliverables |
| **Personal OneDrive** (your personal MS account) | Personal Claude Cowork bridge (if synced to a device); a personal Copilot | ✅ (cloud) | Canonical home for **personal** files you want on every device |
| **C: drive** (home Desktop) — `life-command-center` | Cowork on the Desktop; **git remote from any device** | ✅ *if pushed* | Canon/engine **source** — always `git push` so other devices see it |
| **D: drive** (home Desktop) — not in any OneDrive | **Only** Cowork on the home Desktop (device bridge) | 🚫 island | If a file needs cross-device or Copilot access, **move it to a synced home** (SharePoint for work, personal OneDrive for personal, or a git repo for code/projects). Otherwise treat D: as local scratch. |

**The one real gap:** D-drive-only files are an island — unreachable from your iPhone, Surface, work laptop,
or any cloud surface (Copilot/ChatGPT). Nothing the OS does can reach them except a Cowork session on this
Desktop. Decide per file: promote to a synced home, or accept it's Desktop-only.

## Cortex (memory) across devices
Cortex is server-side (LCC/Supabase) — `log_memory`/`recall_memory`, `draft_and_log` signals,
relationship/email discovery. So a call logged on your iPhone is visible to Claude on your Desktop and Copilot
on your work laptop, instantly. **Memory follows you, not the device.** Write path stays Claude/MCP-only
(`log_memory` never over HTTP); reads are available on every surface that carries the LCC connector.

## Personal projects — how they fold in
Personal work binds to the same OS via `canon/personal.md` (same brain, memory, voice; scoped to personal
surfaces, never the Northmarq team surfaces). The only extra decision is **where the project's files live**:
- Want it on every device → **personal OneDrive** (reached by personal Claude) or a **git repo** (reached by
  any Cowork/Code session, like `life-command-center`).
- Code / structured projects → a git repo is best (versioned, cross-device, canon-governable).
- D-drive-only → Desktop-only; fine for scratch, not for anything you'll touch from the Surface or phone.

To add a personal project to the OS: give it a reachable home (above), add a `canon/<project>.md` if it needs
its own rules, register it in `REGISTRY.md`, and it inherits the brain + Cortex + voice automatically.

## Tools → where they run (so you know which device can invoke them)
| Tool | Runs | Reachable from |
|---|---|---|
| LCC Intelligence connector / `/mcp` / `/api/*` | cloud (Railway) | any surface, any device |
| Work IQ SharePoint (+ future Document Files/Assembly agents) | Copilot Studio, in-tenant | any device with Copilot/Teams |
| Office Scripts + Excel Online | Power Automate (cloud) / Excel any device | any device (flow-triggered) |
| Claude Cowork device bridge (`remote-devices`) | the specific connected device | only that device's Claude desktop |

## Action items surfaced by this map
1. **`git push` the canon** so every device reads the current OS (not a stale local clone).
2. **Triage D: drive files** — promote anything cross-device to SharePoint / personal OneDrive / a repo.
3. **Pick a home for personal projects** (personal OneDrive or a git repo) so they're reachable everywhere.
