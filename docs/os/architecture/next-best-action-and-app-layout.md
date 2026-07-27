# Next-Best-Action Layer + App Layout — the unifying synthesis
_Design, 2026-07-27._ The layer ABOVE the six domains: it consolidates every signal into one prioritized action
stream per user, and it is the backbone of the app's "push-forward." **Extends existing substrate; not a bolt-on.**

## The unification (what already exists → what we generalize)
- **`action_items`** = the universal atomic-action store (`domain, entity_id, priority, due_date, assigned_to,
  status, action_type, source, metadata`). Designed for exactly this; barely populated (2 rows) → **route ALL
  domains into it.**
- **`inbox_items`** = raw signals awaiting triage → become `action_items`.
- **`v_priority_queue_enriched`** = the value-ranker with **doctrinal `priority_band`s** (`reason`, `next_touch_due`,
  `days_overdue`, `rank_value`, buyer rollups). Today it's ownership/BD-centric → **generalize it to score every
  action type.**
- **`v_next_best_touchpoint`** (`priority_band`, `next_action`) → generalize to **`next_best_action`** per
  user/context.
- **`v_team_queue`** + `assigned_to`/`owner_id` = the user/team lenses.

## The invariant (anti-overlap, applied to WORK)
**Every domain emits its "what needs doing" as `action_items`. No domain keeps a private to-do list.** The ranker
consolidates, dedupes (one entity's reconcile + cadence + intent collapse to its single highest next action, or a
grouped card), and bands them. → **ONE ranked stream per user; one next-best-action per context.**

## Each domain feeds the one stream
| Domain | Emits `action_items` like… |
|---|---|
| A Research/Reconcile | "reconcile ownership record X" (owner-reconcile queue already feeds this) |
| B Comps | "deliver comps for deal X" / "comps request due" |
| C BOV | "BOV due for deal X" |
| D Lease/Files | "abstract lease / file doc for X" |
| E Deal Intelligence | "cadence touch due on deal X" · "contractual milestone due/overdue" |
| **F Marketing/Audience** | "outreach due to buyer Y" · **"warm buyer intent on listing Z — reach out"** · "likely-buyer match for listing Z" |

## Domain F designed into the stream (not a side list)
1. **Ownership-of-similar → likely-buyer actions.** `v_priority_queue_enriched` ALREADY ranks buyers by portfolio
   (`buyer_rollup_property_count/annual_rent`, `trigger_top_fact`). The delta: orient it to a **specific listing**
   ("who are the likeliest acquirers for THIS asset?") → emit ranked outreach `action_items` for that listing.
2. **Buyer-intent → intent-boosted actions.** A webhit / OM-download / saved-search on a similar deal lands as an
   `inbox_item` (source `intent`) on the buyer entity → becomes a **high-priority** `action_item` ("warm intent —
   reach out on listing Z"). Warm intent outranks cold prospecting automatically via the score. *(Buyer-intent
   ingestion = the one genuinely new build; see `LCC-SYSTEM-MAP.md` Domain F.)*

## Hierarchical prioritization — the score
`priority = f(value, urgency, stage, intent, effort)` → doctrinal band. Signals (all present in the substrate):
- **value** — deal/account/portfolio value (`rank_value`, rollups, `amount`).
- **urgency** — `days_overdue` / `next_touch_due` / contractual date.
- **stage** — contractual > active marketing > post-BOV > BD (from `bd_opportunities.stage`).
- **intent** — warm buyer-intent boost (Domain F).
- **effort/impact** — quick wins vs deep work (from `action_type`).
Bands render as the day's tiers (e.g., Urgent · Important · Strategic). This is the "hierarchically prioritize our
days / next best action" made mechanical, across all domains at once.

## App layout — the intuitive push-forward (all users, all layers)
**Home = "Today" (the driver).** Every user opens to their **ranked next-best-action stream** (bands from
`v_priority_queue` filtered by `assigned_to`). Not a passive list — each card carries the *one* next action + a
one-tap execution (call/draft/log/reconcile) via the tools/agents.

**Drill contexts — each always surfaces its own next-best-action, never dead-ends:**
- **Deal →** the Dossier (snapshot · timeline · correspondence · next actions).
- **Account/Contact →** relationship context + cadence state + next touch.
- **Pipeline →** stage board (`bd_opportunities` by stage) with per-deal flags.
- **Listing →** marketing/audience: likely buyers, live intent signals, outreach progress.
- **Domain worklists →** reconcile / research / BD queues (for focused work sessions).

**User layers:** **Team** (`v_team_queue`) → **per-user** (`assigned_to`/`owner_id`) → **role-scoped** (broker vs
admin vs future users). Same push-forward everywhere; a manager sees the team's next best actions, a broker sees
theirs, and the app's job on every screen is "here's the single highest-value thing to do next, and here's the
button to do it."

**Cross-surface:** the app is primary, but Copilot / ChatGPT / Claude read the **same** `action_items` +
priority queue — so "what's my next best action?" and "what should I focus on for the Fresenius deal?" answer
identically on every surface. One brain, one prioritization, many doors.

## Build plan (fits the spine; no new store)
- **NBA-1.** Make **all domains emit `action_items`** (adapters: reconcile/comps/BOV/lease/cadence/marketing → action rows). Start with E (cadence/contractual, from `cadence-scan`) since it's designed.
- **NBA-2.** **Generalize the ranker** — extend `v_priority_queue` scoring to all `action_types`, not just ownership; expose `next_best_action(user, context)`.
- **NBA-3.** **App "Today" home** on the ranked stream + one-tap execution; drill contexts wired to dossier/pipeline/listing/worklists.
- **NBA-4.** **Domain F feeds:** listing-scoped likely-buyer actions (F1) + buyer-intent boost (F2) into the stream.
- **NBA-5.** Cross-surface parity — the read ops already exist (`get_queue_summary`, `GetMyExecutionQueue`, `v_next_best_touchpoint`); point every surface at the generalized queue.

## Why this is unified, not tacked on
There is exactly **one** action store (`action_items`), **one** ranker (priority bands), **one** next-best-action
per context, and **one** app home rendering it. Domain F — and every other domain — plugs in by *emitting actions*
and *contributing score signals*, never by standing up its own list or screen. The prioritization layer IS the
reconciliation-and-drive-forward mechanism you described.
