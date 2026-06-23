# Claude Code — UI Phase 2: Overview parity (dia ↔ gov, value-first)

## Why (roadmap Phase 2 — see SURFACE_WALK_ROADMAP_2026-06-23.md + DOMAIN_PAGES_AUDIT_AND_REDESIGN §2C)
The two domain Overview pages evolved on opposite axes:
- **gov** is value-first: Action Items → **Portfolio at a Glance** ($7B rent, $5.3B NOI, SF,
  agencies, contacts) → **Lease Expiration Risk** (buckets + distribution) → **Agency / Geographic
  Breakdown** → … → ownership/research coverage at the bottom.
- **dia** is data-first: Action Items → **Database Health** (CMS coverage) → Clinical Metrics →
  … market blocks (TTM Sales, Northmarq, On Market) buried mid/low → research queues. It has
  **no Portfolio-at-a-Glance, no Lease-Expiration-Risk, no Operator breakdown** — even though
  the data exists (12,280 properties, 6,592 active leases, projected rent, operators).

Goal: both Overviews read the SAME way, **value-first**, with identical section grammar. dia
gains the portfolio dashboard it's missing; gov gains a symmetric data-health section; the
ops/data-quality blocks move to the bottom on both. (Consumption-Layer: every block
value-ranked/honest; headline the same denominator so the two pages are comparable.)

## Unified Overview block order (BOTH domains)
1. **Action Items** (BD + data-quality, value-ranked, capped) — keep.
2. **Portfolio at a Glance** — property count (ACTIVE), SF, gross rent, NOI, avg NOI/property,
   rent/SF, operators-or-agencies tracked, contacts.
3. **Lease Expiration Risk** — expiring <6mo / <1yr / expired-holdover / 2–5yr / 5+yr + a
   distribution bar over dated leases.
4. **Market Activity** — TTM Sales Activity · Northmarq Performance · On Market (dia: fold its
   SJC Deal Book in here).
5. **Pipeline Snapshot** — leads by temperature/grade + pipeline value.
6. **Breakdown** — **Operator** (dia) / **Agency** (gov) by count + rent, and Geographic distribution.
7. **Data Health & Coverage** (ops, at the BOTTOM) — dia: Database Health, Clinical Metrics,
   Listings-confirm, LLC queue, Research pipeline; gov: Ownership Coverage, research status,
   GSA/FRPP intel.

## Unit 1 — dia: add the missing value blocks + reorder to value-first  *(the headline)*
In `dialysis.js` `renderDiaOverview()`:
- **Build Portfolio at a Glance** for dia — count(active properties), Σ projected rent (use the
  dia rent doctrine: `dia_project_rent_at_date` / `v_sales_comps` projection — NOT raw Y1),
  NOI (dia is NNN: rent ≈ NOI, label honestly), avg rent/SF, distinct operators, contacts.
- **Build Lease Expiration Risk** — the same expiration buckets + distribution over dia
  `leases` (active, dated), mirroring gov.
- **Build Operator Breakdown** — top operators (DaVita/Fresenius/US Renal/American Renal/…) by
  property count + projected rent + avg firm-term (the dia mirror of gov's Agency Breakdown),
  plus Geographic (top states by count + rent).
- **Reorder** the Overview to the unified order above; the existing data-quality blocks
  (Database Health, Clinical Metrics, LLC queue, Research pipeline, Listings-confirm) move DOWN
  into the **Data Health & Coverage** section. Keep the existing market blocks (TTM Sales,
  Northmarq, On Market, SJC Deal Book) grouped under **Market Activity**.
- **Data source:** prefer a small dia aggregate the same way gov uses `mv_gov_overview_stats`
  — either query via the existing `dia-query` proxy, or add a `mv_dia_overview_stats` (dia DB
  migration, mirror gov's; refresh cron parity). Whichever is cleaner; keep it one source of
  truth for the headline numbers.

## Unit 2 — gov: add a symmetric Data Health & Coverage section
In `gov.js` `renderGovOverview()`: keep the value-first order (already correct) but group the
existing Ownership Coverage + research-status blocks into a labeled **Data Health & Coverage**
section at the bottom, matching dia's, so both pages end the same way.

## Unit 3 — shared grammar + honest denominators
- **One section/card grammar.** dia and gov currently use different render helpers
  (gov: `govSectionHeader`/`govCard`/`govInfoCard`/`inlineBar`; dia: its own). Converge the
  Overview blocks onto ONE shared set (lift the gov helpers to a shared module or have dia adopt
  them) so the mirrored blocks look identical. Section headers + card layout + bar charts match
  across domains.
- **Honest, comparable headline.** Both Overviews headline **ACTIVE properties** (gov: switch
  the headline from 19,232 all-status to the ~12,575 active count; keep all-status available as
  a secondary "incl. archived" if useful). dia headlines its ~12,280 active properties (not the
  8,535 CMS-clinic count — keep clinics as a secondary CMS metric). So the two top numbers are
  the same kind of thing.
- **Northmarq brand** on all new/moved blocks (cards, headers, bar colors) per CLAUDE.md brand.

## Boundaries / verify
- Client render (`dialysis.js`, `gov.js`, shared helper module, `index.html`/`styles.css` as
  needed) + optionally one dia MV migration mirroring `mv_gov_overview_stats`. **No new
  api/*.js** (`ls api/*.js | wc -l` = 12). Reversible. Brand-compliant.
- Verify: dia Overview now LEADS with Portfolio at a Glance → Lease Expiration Risk → Market
  Activity → Pipeline → Operator Breakdown → Data Health (data-quality moved to bottom); the dia
  value numbers reconcile to dia DB truth (projected rent, active-property count, operators);
  gov Overview gains the Data-Health section and keeps value-first order; **both pages share the
  same section order + card grammar + headline denominator**; `node --check`; suite green.
- Live (post-redeploy) check both Overviews read identically top-to-bottom.

## Documentation (same round)
Update `life-command-center/CLAUDE.md` with the unified Overview block order (so future Overview
edits stay value-first + mirrored), and note any new `mv_dia_overview_stats` + its refresh cron.

## Bottom line
Make both domain Overviews lead with the money in the same order with the same grammar — dia
finally gets the portfolio dashboard, expiration risk, and operator breakdown it has the data
for; ops/data-quality moves to the bottom on both; the headline denominators match. The two
subsectors become mirror images, value-first.
