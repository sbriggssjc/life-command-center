# Build Spec — Next-Best-Action Research-Task Generator (the keystone)

**Date:** 2026-05-21
**Builds on:** `OWNERSHIP_ORCHESTRATION_BLUEPRINT_2026-05-21.md` §5
**Status:** spec for an LCC route + cron (app code). The domain-side feed it consumes is **already built and live**.

## What's already built (live, this session)
- gov + dia: `v_ownership_gaps`, `v_ownership_coverage`, and **`v_next_best_research`** — a ranked, deduplicated, instruction-bearing NBA feed (gap_type → research_type + human instructions + value-weighted priority + domain). Query it directly today, e.g. top gov actions are high-investment-score properties missing a recorded owner.

## Why this piece is an LCC route, not a SQL function
`research_tasks` (the task layer with status/assignment/completion) lives on **LCC Opps**; the gap feed lives on **gov/dia**; LCC reads domains over HTTP via the `data-query` edge function, not SQL. So the generator is a Vercel route the LCC cron calls.

## Route: `POST /api/admin?_route=generate-research-tasks`
Per domain (`gov`, `dia`):
1. Call `data-query` to `SELECT research_type, entity_kind, entity_id, label, priority, instructions, domain FROM v_next_best_research ORDER BY priority DESC LIMIT :batch` (e.g. 500). **Add `v_next_best_research` to the data-query allowlist and deploy to the Dialysis_DB project** (per CLAUDE.md the allowlist lives there).
2. **Upsert** into LCC `research_tasks` keyed on `(domain, research_type, source_record_id=entity_id)`:
   - new gap → INSERT `status='open'`, `research_type`, `title`= short form, `instructions`, `entity_id`, `domain`, `priority`, `source_table='v_next_best_research'`.
   - existing open task → refresh `priority` only (don't reset status/assignment).
3. **Auto-close** tasks whose gap no longer appears in the feed (the gap was filled): mark `status='completed'`, `outcome='gap_resolved'`. This is the closure loop — research done → owner/SOS/SF data written → gap view drops it → next run resolves the task.
4. Respect `ignored_recommendation_contacts` / a skip set so dismissed items don't regenerate.

## Scheduling (per the scheduling review — no every-minute jobs)
```
SELECT cron.schedule('generate-research-tasks','35 6 * * *',           -- nightly full
  $$SELECT public.lcc_cron_post('/api/admin?_route=generate-research-tasks&domain=both&limit=2000','{}'::jsonb,'vercel')$$);
SELECT cron.schedule('generate-research-tasks-inc','25,55 * * * *',     -- incremental, capped
  $$SELECT public.lcc_cron_post('/api/admin?_route=generate-research-tasks&domain=both&limit=300','{}'::jsonb,'vercel')$$);
```
Staggered off shared minute marks; capped per tick; through the pooler.

## Surfacing as Next Best Action
`research_tasks` already feeds the LCC work surface. Order the broker's NBA list by `priority`, grouped by `research_type`, and weight by deal value / active listing / warm SF relationship (the priority already encodes investment score + active-listing boost). Completing a task in the sidebar (CoStar/county/SOS pull, SF link) writes the underlying data → resolver/triggers fire → gap closes → task auto-resolves.

## Closure loop (end-to-end)
```
v_next_best_research (gov/dia)  ──data-query──►  generate-research-tasks  ──►  research_tasks (LCC, status=open)
        ▲                                                                              │
        │ gap disappears                                                     broker / sidebar action
        └──────────────── resolver+triggers write owner/SOS/SF data  ◄───────────────┘
```

## No-slip-through
- Every gap_type in the feed maps to a research_type → no gap is unactionable.
- Coverage rollup (`v_ownership_coverage`, also built) trend-alerts via the existing Teams push when coverage regresses or a feed grows.
- A task is never silently dropped: filled → `completed`; source returned nothing → mark `no_match` (visible), not abandoned.

## Acceptance
- After first run, `research_tasks` count ≈ open gaps (capped); top tasks match the top of `v_next_best_research`.
- After a test sidebar owner-pull on one flagged property, the next generator run flips that task to `completed` and `v_ownership_coverage.pct_property_has_recorded_owner` ticks up.

*Domain feed: built + live. This route + cron: branch implementation + test.*
