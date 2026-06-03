# Future To-Do: Next-State SOS Adapters (DEFERRED)

**Status:** Deferred by Scott (2026-05-31) in favor of prioritizing the LCC
organization/layout + data-flow audit. Capture here; do not build yet.

## What

Extend the Florida SOS enrich → compare → link engine to the next-biggest
queue states, using the **identical** mirror + adapter + enrich pattern that's
now live and proven for FL.

## Priority order (by queued-owner volume)

From the live queue distribution (2026-05-31):
- **CA** — dia 111 + gov 36 = ~147 queued
- **TX** — dia 94 + gov 43 = ~137 queued
- **GA** — dia 72 + gov 13 = ~85
- Then IL, NC, AZ, VA as volume warrants.

## The proven FL pattern to replicate (per state)

1. **Mirror table** — `sos_<st>_entities` on LCC Opps (schema like
   `sos_fl_entities`, adapted to that state's data-file columns).
2. **Ingest script** — `scripts/ingest-sunbiz-<st>.mjs` equivalent, parsing
   that state's bulk corporate-data file. **Key gotcha learned on FL:** verify
   the date format against real data, not just the spec page (FL's "File Date"
   was MMDDYYYY, not the CCYYMMDD the layout page implied).
3. **Adapter** — `lookupVia<State>` in `api/_shared/llc-research.js`, registered
   in `SOS_DIRECT_ADAPTERS`. Returns the uniform shape; `adapter_pending` until
   the mirror is loaded so it falls through safely.
4. **Enrich engine** — generalize `fl-sos-enrich-link.js` to be state-parametric
   (it's currently FL-hardcoded as `DOM='government'` + `sos_fl_entities`). The
   cleanest refactor: a `STATE_MIRRORS` registry keyed by state code so one
   engine serves all states; gate eligibility on `recorded_owners.state=<st>`
   OR `filing_state=<st>`.
5. **Cron** — extend `lcc-fl-sos-enrich-link` to loop states, or add per-state
   ticks.

## Compliance note

Use each state's **bulk-download** corporate file (the State's own published
data), NOT live SOS search-page scraping (anti-bot / CAPTCHA). Not every state
publishes a free bulk file — confirm availability before committing to a state.
States without a free bulk file may need the deferred OpenCorporates key path or
a per-state open API.

## Effort

~M per state (mirror migration + ingest script + adapter registry entry +
engine generalization the first time, then trivial per additional state).

## Cross-references

- FL implementation: `api/_shared/fl-sos-enrich-link.js`,
  `scripts/ingest-sunbiz-fl.mjs`,
  `supabase/migrations/20260691_sos_fl_entities_mirror.sql`,
  `supabase/migrations/government/20260692_gov_fl_sos_enrich_link.sql`,
  `supabase/migrations/20260693_lcc_fl_sos_enrich_link_cron.sql`
- Authority model + match-precision rules: see the FL engine header comment.
