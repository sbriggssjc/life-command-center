# Claude Code — R23: archived gov properties are feeding stale value into the BD rank

## Why (grounded live 2026-06-15, R22 follow-up)
R22 pruned the 834 HARD-gone orphans and deliberately KEPT soft-archived rows. But
the soft-archived set is large and materially distorts ranking:
- gov.properties: **12,433 active / 6,662 archived (35%)** / 38 cmbs_discovery / 2
  inactive.
- `lcc_property_attributes` gov ≈ 19,130 (all statuses) → **~6,662 archived gov
  properties (35% of the gov mirror) carry full attributes (rent) in the LCC
  mirror** and feed the R17 connected-value tier, the representative-property rent
  fallback, and the queue/Decision-Center value ranking.
- The sync can't self-heal these: the gov anon view the sync reads
  (`v_property_attributes_portfolio`) ALREADY excludes archived, so once a synced
  property is archived in gov it's never refreshed AND never returned for removal —
  it's permanently stale in the mirror.

Net: a gov owner who SOLD / had merged / archived properties still ranks by those
dead assets — overstating current portfolio value and mis-prioritizing where the
operator spends time. 35% stale is well past noise.

## Doctrine (confirm, but near-certain)
Archived = NOT a current BD asset (sold, merged-dupe, or removed). It should NOT
count toward an owner's current portfolio value or surface as a property trigger.
The owner RELATIONSHIP persists via their ACTIVE properties; archived assets just
shouldn't inflate the value math. So: **exclude archived from the LCC value-ranking
mirror.** (dia hard-deletes on merge, so dia has no equivalent soft-archived class —
R22 already handles dia; this is gov-specific.)

## Fix — make the mirror reflect ACTIVE gov properties only
Two clean implementations (the R22 doc floated both); recommend the reconcile, since
it keeps the mirror == the sync's intent (the source view is already active-only):
1. **Reconcile the mirror to active-only (recommended).** Extend R22's
   `v_property_id_census` (gov) to carry `status` (still id-only + status, PII-free),
   and have the R22 reconcile prune `lcc_property_attributes` / `lcc_property_owner_facts`
   / `lcc_entity_portfolio_facts` gov rows whose census status = 'archived'
   (treat archived like gone for the LCC mirror). Reversible (snapshot to the
   existing `lcc_mirror_reconcile_deletions` backup), bounded (~6,662), guarded by
   the same completeness/sanity/anomaly caps R22 added. Going forward, the reconcile
   removes a property from the mirror the moment it's archived in gov.
   - Keep `cmbs_discovery` (38) and `inactive` (2) — decide per status: cmbs_discovery
     is likely pre-active pipeline (keep or exclude per whether it's BD-relevant);
     inactive (2) is negligible. Only `archived` is the clear exclude.
2. **OR filter at the rank (lighter, less clean).** Add `status` to the mirror and
   have the R17 rank views / portfolio rollups exclude `status='archived'`. Keeps
   the rows but every rank consumer must remember the filter — more places to get
   wrong. Prefer #1.

## Don't break / guards
- Reversible (snapshot before delete, like R22). dia untouched (no soft-archive there).
- The owner ENTITY and its ACTIVE-property edges must survive — only the
  archived-property rows leave. An owner with ALL properties archived correctly
  drops to no-portfolio-value (NULLS-LAST), which is right (no current assets).
- Page the census pull at 1000/row (the recurring PostgREST-cap lesson).
- After: re-run `lcc_refresh_entity_connected_value()` + `lcc_refresh_priority_queue_resolved()`
  so the rank reflects active-only value immediately.
- Additive/idempotent migrations; ≤12 api/*.js; suite green.

## Acceptance / verify live (Cowork)
- gov rows in `lcc_property_attributes` ≈ 12,433 active (down ~6,662), 0 archived
  remaining; dia unchanged.
- Spot-check: a gov owner whose archived properties previously inflated its rank now
  ranks on active-only value; an owner with only archived properties drops out of
  the value-ranked bands (NULLS-LAST).
- Connected-value + priority-queue caches rebuild cleanly; no orphaned portfolio
  edges pointing at pruned rows.

## Verdict
This is the materially-bigger sibling of R22: R22 cleared 834 genuinely-gone rows;
R23 clears the 6,662 soft-archived that were quietly inflating 35% of the gov value
signal. Together they make the LCC mirror a true reflection of the CURRENT,
BD-relevant domain — which is the whole point of value-ranking where the operator
spends time.
