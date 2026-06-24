# Claude Code — UI Phase 3: tab set + naming unification (dia ↔ gov) + dia-tile cleanups

## Why (roadmap Phase 3 — SURFACE_WALK_ROADMAP §Phase 3 + DOMAIN_PAGES_AUDIT_AND_REDESIGN §2B/§2E)
Phases 1 (routing) + 2 (Overview parity) are live. The two domain pages still **scatter the same
concepts into different homes/names**: dia calls lead-triage "Prospects" while gov calls it
"Pipeline"; gov promotes "Ownership" to a top-level tab while dia buries it in Research; dia has
an "Activity" tab while gov hides outreach in an Overview block; dia has a "Properties" inventory
tab, gov has none. Phase 3 converges both on ONE tab set + order + naming so the subsectors
mirror (specialize only in a clearly-scoped Reference group). Plus two small residuals from the
dia-tile audit (Unit 0).

All client-side (`dialysis.js`, `gov.js`, `index.html`, maybe `app.js`/`ops.js`); **no api/*.js**
(`ls api/*.js | wc -l` = 12); no migration. Routing is page-level (the hash encodes page +
detail, NOT sub-tab), so sub-tab renames/additions don't break Phase-1 routing — but **keep the
existing `data-dia-tab`/`data-gov-tab` ids stable where code dispatches on them; relabel the
DISPLAY text, and add new tabs additively.** Verify `node --check`, suite green, and that every
existing tab still renders + the grouping pills (`syncDomainTabGroup`) still work.

## Unit 0 — dia-tile audit residuals (fold in; DIA_OVERVIEW_TILE_AUDIT_2026-06-23 verification)
0a. **Lease Coverage "need backfill" count is wrong + inconsistent.** Headline is now correct
   (34.3% from `mv_dia_overview_stats`), but the sub reads **"0 clinics need lease backfill"**;
   the Action Item shows **1,000** (capped fetch); true `v_clinic_lease_backfill_candidates` =
   **3,035**. Wire ALL three "need backfill" surfaces — the Lease Coverage card sub
   (`dialysis.js:1946`), the Research-Pipeline "Lease Backfill" tile (`:2036`), and ideally the
   Action Item — to the SAME **`count=exact`** on `v_clinic_lease_backfill_candidates` (3,035),
   never the capped `.length`/0. (diaQuery supports a count probe; mirror the SJC/financial
   server-aggregate pattern.)
0b. **Recent-sale rows lack a click affordance.** They're clickable (onclick wired) but
   `cursor` is `auto` — add `cursor:pointer` (+ a hover style if cheap) to the
   `#sjcRecentDeals` rows (`dialysis.js:1669-1675`) so the click is discoverable.

## The unified tab set + order (BOTH domains) — DOMAIN_PAGES_AUDIT_AND_REDESIGN §2B
Grouping tier → sub-tabs (the `syncDomainTabGroup` groups):
- **OVERVIEW:** `Overview`
- **DEALS:** `Pipeline` · `Sales` · `Leases` · `Loans` · `Ownership` · `Players`
  (+ gov-only `Leads` — see Unit 1; dia omits it, no equivalent dataset)
- **INVENTORY:** `Properties` · `Search`
- **RESEARCH:** `Research` · `Activity`
- **REFERENCE (domain-specific):** dia → `CMS Data` · `Inventory Changes` · `NPI Intel`;
  gov → `GSA / FRPP Intel` · `Lease Events` (see Unit 6 — gov Reference is built, not just
  regrouped; counts may differ from dia by design — Reference is the domain-specialty group)
- **CAPITAL MARKETS:** `Capital Markets`
Identical primary structure; only the Reference group differs by domain.

## Unit 1 — unify the lead surfaces (DECIDED: shared triage = "Pipeline" both; gov scored-leads = gov-only "Leads")
Grounded correction: gov has TWO lead surfaces, dia has one — they are NOT the same thing:
- **SHARED** = cross-domain Opportunity/prospect triage (`renderDomainProspects` over
  `_mktOpportunities[domain]` + `_mktProspectContacts[domain]`) — present in BOTH dia
  (`data-dia-tab="prospects"`, `dialysis.js:1119`) and gov (`data-gov-tab="prospects"`), SAME render.
- **gov-only** = scored-Leads pipeline (`renderGovPipeline` = gov `prospect_leads` table/charts,
  `data-gov-tab="pipeline"`; note `app.js:2010` has a stub that `gov.js` overrides — the gov.js
  version is the real one). dia has no equivalent leads dataset.

BD funnel = **Leads → Pipeline (opportunities) → Deals.** Mapping (display-label changes only;
**keep all `data-*-tab` ids + dispatch stable** — label≠id is fine, internal):
- Relabel the SHARED triage tab → **"Pipeline"** in BOTH domains (dia `prospects` → "Pipeline";
  gov `prospects` → "Pipeline"). DEALS group. Render path unchanged (`renderDomainProspects`).
- Relabel gov's scored-leads tab (`data-gov-tab="pipeline"` → `renderGovPipeline`) →
  **"Leads"**, kept as a **gov-ONLY** tab in DEALS (dia omits it — honest specialization, no dia
  build). Render path unchanged.
- Result: both domains have an identical **"Pipeline"** tab (the triage render); gov additionally
  has **"Leads"** (top-of-funnel). Verify both gov tabs still render their respective content under
  the new labels and dia "Pipeline" renders the dialysis prospects.

## Unit 2 — promote dia "Ownership" to a top-level tab
dia ownership currently lives inside the Research workbench (an ownership mode), while gov has a
top-level Ownership tab. Add a top-level **Ownership** tab to dia (DEALS group) that surfaces the
existing dia ownership view (reuse the existing ownership render path / research-ownership mode
content — don't rebuild it; just give it a first-class tab + `data-dia-tab="ownership"` dispatch).
Keep the Research-mode entry working too (or redirect it to the new tab).

## Unit 3 — add a "Properties" tab to gov
dia has a paginated Properties inventory tab; gov surfaces properties only via Search/Overview.
Add a top-level **Properties** tab to gov (INVENTORY group) — a paginated property list mirroring
dia's Properties tab (reuse dia's Properties render pattern against gov data: `properties` /
`v_property_detail`). Value-first ordering (rank by rent/value) per the consumption-layer doctrine.

## Unit 4 — promote gov "Activity" to a top-level tab
gov outreach lives in an Overview "Government Outreach" block; dia has a top-level Activity tab.
Add a top-level **Activity** tab to gov (RESEARCH group) that surfaces the gov outreach/activity
feed (reuse the existing gov outreach data + dia's Activity tab pattern for consistency). Leave a
compact summary in Overview if useful, but the full feed moves to the tab (matches dia).

## Unit 5 — unify the grouping tier order + membership
Make both domains' grouping pills + sub-tab order match the unified set above (via
`syncDomainTabGroup` group definitions + the `index.html` tab markup). dia's CMS cluster
(`CMS Data`/`Inventory Changes`/`NPI Intel`) and gov's `GSA / FRPP Intel` sit under **Reference**
as the only domain-specific exception. Don't reorder within a tab's content — just the tab
strip + groups.

## Unit 6 — build gov's REFERENCE group (it's promotion, not regrouping)
gov has NO standalone domain-specialty tabs today — its GSA/FRPP intel lives only as a section
inside `renderGovOverview`. Create the gov REFERENCE group with TWO tabs (both surface
already-loaded data — light lift, no new pipeline):
- **`GSA / FRPP Intel`** — promote the existing GSA Lease Intelligence + FRPP section out of
  `renderGovOverview` into a standalone tab (`data-gov-tab="gsa-intel"` → a `renderGovGsaIntel`
  that reuses the existing section render). Leave at most a compact teaser in Overview (or drop it
  from Overview now that it has a home), consistent with how Unit 4 moves Activity out.
- **`Lease Events`** — a tab over `gsa_lease_events` (new lease / expiration / renewal /
  relocation / footprint-reduction lifecycle events) — the gov MIRROR of dia's "Inventory
  Changes," high BD value (expirations = deal triggers). The data is already loaded for Overview;
  render it as a card/table feed like dia's Inventory Changes tab. If `gsa_lease_events` is NOT
  readily renderable in this round, ship `GSA / FRPP Intel` alone and leave a `// TODO Lease
  Events` — don't block Phase 3 on it.
- **Do NOT** build a raw "GSA Data" browser tab to mirror dia "CMS Data" — deferred (net-new,
  low payoff). gov Reference = 2 tabs vs dia's 3 is intentional.

## Boundaries / verify
- Client only; ≤12 api/*.js; no migration. Keep `data-*-tab` dispatch ids stable; relabel display
  text; add new tabs additively (don't remove the Research-ownership / Overview-outreach sources
  until the new tabs are confirmed rendering).
- Phase-1 routing intact: page-level hash unaffected; detail tokens unaffected. If any new tab
  should be deep-linkable later, leave the id parseable (Phase 4 concern, not now).
- `node --check dialysis.js gov.js`; full suite green. Live after redeploy: both domains show the
  SAME tab strip + groups + order; dia "Pipeline" (was Prospects) renders prospects; dia
  "Ownership" tab renders ownership; gov "Properties" tab lists properties value-first; gov
  "Activity" tab shows the outreach feed; every pre-existing tab still works; Unit 0 lease count
  shows 3,035 consistently + recent-sale rows show a pointer cursor.

## Documentation (same round)
Update `life-command-center/CLAUDE.md` (Client routing / domain-pages note) with the unified tab
set + order so future tab work stays mirrored, and note Phase 3 complete.

## Bottom line
One tab set, one order, one name per concept across dia + gov — Pipeline (not Prospects),
top-level Ownership + Activity + Properties on both — with domain specialties quarantined to a
Reference group. Plus the two dia-tile residuals (consistent 3,035 backfill count + pointer
cursor). The two subsectors finally navigate identically.
