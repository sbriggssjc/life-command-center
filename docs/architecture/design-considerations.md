# Design Considerations & Open Layers — pre-build review
_2026-07-27._ Honest gaps, watch-items, and redesign candidates surfaced before the build-out continues.

## Missing layers to design (highest-value first)
### 1. Identity, Users, Roles & Permissions (RBAC) — the biggest gap
Everything assigns work (`action_items.assigned_to/owner_id`), shares artifacts (`visibility_scope`
private/assigned/shared), and acts on behalf of people (SF write-back). But there is **no coherent multi-user /
role / visibility design.** As brokers + admin + future users join: who sees which deals/actions/queues, who can
trigger writes, per-user vs team scoping, whose Salesforce/Outlook identity a write uses. Substrate exists
(`lcc_users`, `workspace_memberships`, `visibility_scope`); the **policy layer does not.** The app "Today" home is
inherently per-user/role — so **this should be designed before that home is built.**

### 2. Feedback / Learning loop (make it closed-loop)
Cadence, tiering, and NBA scoring are **static rules today.** Design a loop where outcomes — deal won/lost, response
rates, which next-best-actions get done vs skipped, **template performance (`EvaluateTemplateHealth` /
`GetTemplatePerformance` already exist)** — feed back to tune cadence, scoring, and tiering. Turns a tracker into a
system that gets smarter. Corollary: **build the NBA ranker as configurable weights from day one** so it *can* learn.

### 3. Autonomy & Trust ladder (unify what's currently ad hoc)
Human-in-loop has been applied case by case (SF confirm gate; monitor notify-first). Design **one autonomy policy**:
per action-type, what is autonomous vs proposed-for-approval vs requires-confirmation, and how trust escalates as the
system proves itself. Without it, autonomy grows inconsistently as the system does more (drafts, auto-file, intent
outreach) — the main risk vector.

### 4. Lifecycle off-ramps
The pipeline designs the **happy path** (BOV→close). Design the **exits**: deal LOST (didn't win the ELA / died),
DORMANT (stalled), REVIVED (re-engage), account ATTRITION (bottom 20%). Without these the monitor nags dead deals and
attrition never actually happens.

### 5. Pipeline resilience & explainability
Many async hops (email pipeline, SF sync, drainer, monitor, intent). Design as cross-cutting: **idempotency**
everywhere (we hit dup-on-retry this session), **dead-letter** handling (the SF flow has it — generalize),
partial-failure **reconciliation**, pipeline **self-monitoring** (`GetSyncRunHealth` exists), and user-facing
**"why"** (the priority-queue `reason` field is a start) — why is this action #1, why was this email attributed here.

## Redesign candidates (fix before building more on them)
1. **Dossier `.md` ↔ LCC dossier = ONE writer.** The SharePoint `.md` is independently appended by folder-watch
   *and* the `activity_events` projection exists → **drift risk.** Redesign: the `.md` becomes a pure **render** of
   the LCC dossier (system of record), one writer — mirroring the canon render/parity pattern.
2. **Collapse the two-server topology (unification Phase 2).** The root-proxy + mcp-engine split caused this
   session's deploy failure (`../api` import outside the engine's deploy context). Consolidating kills a whole class
   of bugs + the proxy indirection. On the roadmap; worth prioritizing.
3. **Commit to the v4 connector repave now.** Carrying v3 (94, additive, live) + v4 (53, clean, target) + a
   ~65-action agent = drift that undermines the "one connector" contract. End it.
4. **NBA ranker = configurable weights, not hardcoded** (ties to Feedback loop #2).

## Watch (lower priority)
- Personal↔work boundary (canon handles it; watch as it grows).
- Cost / rate-limits (Salesforce + Graph API caps, LLM distillation/draft costs) as volume scales.
- Entity-resolution robustness — the whole system leans on it; `cortex_janitor_*` + Domain A cover much, but it's the
  quiet single point of many failures (mis-merged people, mis-attributed email).

## Net
The domain architecture is sound and non-overlapping. The gaps are **cross-cutting layers** (identity/RBAC, learning,
autonomy, resilience) and a few **debt items** (dossier one-writer, two-server collapse, connector repave). Of these,
**RBAC is the one I'd design before building the app home**, and **one-writer dossier + configurable NBA weights** are
the two I'd bake in now because retrofitting them later is expensive.
