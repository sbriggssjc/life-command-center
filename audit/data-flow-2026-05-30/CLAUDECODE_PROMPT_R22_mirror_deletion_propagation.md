# Claude Code — R22: cross-DB mirror deletion propagation (orphan reconcile)

## Why (grounded live 2026-06-15)
Audited the cross-DB sync backbone (dia/gov domain → LCC mirrors). Verdict: the
INFLOW side is healthy — `lcc_property_owner_facts` matches the domain exactly (dia
12,278 = dia.properties 12,278), and `lcc_entity_portfolio_facts` mirrors all
*resolvable* current ownership edges (dia 1,763 vs the source view's 2,168 current;
the gap is owners that don't resolve to an LCC entity, by design — not truncation,
no round cap). New/changed domain rows flow in correctly.

The ONE gap is **deletion propagation**: the syncs are insert/update-only and never
delete mirror rows for domain records that were merged/removed. `lcc_property_attributes`
shows it:
- **dia: 13,060 mirror rows (all distinct) vs 12,278 dia.properties → ~782 orphans**
  (properties merged/deleted in dia's dedup work that the mirror kept).
- gov: 19,130 vs 19,108 → ~22 orphans (gov has far less merge churn).
The newer `owner_facts` sync matches exactly, so this is specific to the older
`property_attributes` sync path.

**Why it matters (moderate, not urgent):** orphan attribute rows are stale references
to properties that no longer exist. They can feed phantom value into the R17
connected-value / representative-property rank and inflate counts. Low blast radius
today (owner_facts/portfolio_facts are clean, so most orphans are likely dangling and
unreferenced), but it's drift that compounds as the domains keep deduping.

## Fix
1. **One-time orphan reconcile (all mirrors).** For each LCC mirror keyed by a domain
   property/record id (`lcc_property_attributes`, and verify `lcc_entity_portfolio_facts`,
   `lcc_property_owner_facts`, `lcc_property_owner_facts` mirror, `lcc_listing_events`),
   delete (or soft-retire) rows whose `(source_domain, source_property_id)` no longer
   exists in the domain source. Do this via the existing cross-DB read path (the
   pg_net sync reads the domain anon views) — fetch the live domain id set and
   reconcile. Since LCC Opps is disk-sensitive, prefer a bounded DELETE of confirmed
   orphans (these are genuinely gone, not soft state) — ~800 rows is small and frees
   the dangling refs cleanly; VACUUM not needed at this size.
2. **Make the sync deletion-aware going forward.** Add a reconcile pass to each
   `lcc_sync_*_finalize` (or a periodic `lcc-mirror-reconcile` cron): after the
   upsert, delete mirror rows whose key isn't in the freshly-pulled domain set for
   that domain. Page the domain id-set pull (the 1000-row PostgREST cap lesson — the
   same bug that hit dia owner-facts and the research dedup). A full id-set pull +
   anti-join is the robust form; a "not seen in last N syncs" tombstone also works.
3. **Verify the orphans aren't load-bearing first.** Before deleting, confirm no
   live `lcc_entity_portfolio_facts` / queue row references the orphan property ids
   (they shouldn't — owner_facts/portfolio_facts are already clean). Log the count
   reconciled.

## Boundaries / house rules
- dia/gov domain pipelines untouched — this only prunes LCC-side mirror orphans +
  adds deletion-awareness to the LCC sync.
- Page every domain id-set pull (no 1000-row cap).
- Additive migration for the cron/finalize change; the one-time reconcile is a
  bounded DELETE of confirmed-gone rows. ≤12 `api/*.js`; `node --check`; suite green.
- Acceptance: `lcc_property_attributes` dia distinct property count == dia.properties
  count (orphans = 0); a re-run of the sync after a domain delete prunes the mirror
  row; the reconcile is wired so orphans can't re-accumulate.

## Verdict (record)
The cross-DB sync backbone is fundamentally sound — domain data flows into the LCC
spine completely and currently on the inflow side. The only defect is that mirrors
don't shrink when the domain shrinks (insert/update-only), leaving ~800 dia orphans.
R22 reconciles them and makes the sync deletion-aware so the mirrors stay a true
reflection of the domains. Moderate priority — drift, not breakage.
