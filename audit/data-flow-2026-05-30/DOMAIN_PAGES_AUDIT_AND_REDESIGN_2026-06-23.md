# Domain Pages (Dialysis ↔ Government) — Full Audit + Redesign Plan (2026-06-23)

Goal (Scott): an intuitive, intelligent, CONSISTENT design across the two subsectors — home
mirrors home, each section mirrors its counterpart — aligned with the app's BD value-chain
objective (ingest → enrich → connect → surface value → drive the deal) and pushing the ball
forward everywhere. This doc is Part 1 (catalog) + Part 2 (plan).

---

# PART 1 — STRUCTURAL CATALOG (as-built)

## 1A. Tab inventory (sub-tab set + order)

**Dialysis (14 tabs):** Overview · Search · Properties · CMS Data · Inventory Changes ·
NPI Intel · Sales · Leases · Loans · Players · Research · Prospects · Activity ·
Capital Markets

**Government (10–11 tabs):** Overview · Search · Ownership · Pipeline · Sales · Leases ·
Loans · Players · Research · Capital Markets  (`Prospects` exists in markup but is
unimplemented — folded into Pipeline)

Both pages sit under a grouping tier: **Overview · Pipeline · Research · Reference ·
Capital Markets** (the sub-tabs are organized into these groups).

## 1B. Tab-by-tab correspondence

| Concept | Dialysis | Government | Divergence |
|---|---|---|---|
| Overview | ✓ (13 blocks) | ✓ (15 blocks) | Different block SETS + ORDER (see 1C) |
| Search | ✓ clinic/NPI/queue | ✓ property/owner/lead/listing | Same idea, domain content |
| Inventory list | **Properties** tab (paginated) | — (props only in Search/Overview) | **gov lacks a Properties tab** |
| Ownership | — (buried in Research → Ownership mode) | **Ownership** top-level tab | **dia buries ownership; gov promotes it** |
| Lead/prospect triage | **Prospects** tab | **Pipeline** tab | **Different name for the same thing** |
| Sales | ✓ comps/available | ✓ comps/available | Consistent |
| Leases | ✓ | ✓ | Consistent (gov richer expiration buckets) |
| Loans | ✓ | ✓ (placeholder until data) | Consistent |
| Players | ✓ operators/owners | ✓ buyers/sellers/brokers | Same shell, domain content |
| Research workbench | ✓ 10-mode workbench | ✓ 8-step pipeline | **Different structures, same purpose** |
| Activity / outreach | **Activity** tab | — (Overview "Government Outreach" block) | **dia=tab; gov=Overview block** |
| CMS cluster | **CMS Data · Inventory Changes · NPI Intel** | — | dia-specific (legit) |
| GSA/FRPP intel | — | **GSA Lease Intelligence** (Overview block) | gov-specific (legit) |
| Capital Markets | ✓ | ✓ | (handled in a separate workstream) |

## 1C. Overview block order (the biggest divergence)

**Dialysis Overview (order):** 1) Action Items · 2) Database Health · 3) Clinical Metrics
(patients, movers) · 4) Clinic Financial Estimates · 5) Team Outreach · 6) Ownership Coverage
· 7) TTM Sales Activity · 8) Northmarq Performance · 9) SJC Deal Book · 10) On Market ·
11) Listings Needing Confirmation · 12) LLC Research Queue · 13) Research Pipeline.
→ **Leads with data-quality/ops** (Database Health, Clinical), market value blocks are mid/low.

**Government Overview (order):** 1) Action Items · 2) **Portfolio at a Glance** (props, SF,
$7B rent, $5.3B NOI, avg NOI, rent/SF, agencies, contacts) · 3) Lease Expiration Risk ·
4) Agency Breakdown · 5) Geographic Distribution · 6) Ownership Intelligence · 7) Prospect
Pipeline · 8) Government Outreach · 9) TTM Sales Activity · 10) Northmarq Performance ·
11) On Market · 12) Listings Needing Confirmation · 13) LLC Research Queue · 14) GSA Lease
Intel · 15) Ownership Coverage.
→ **Leads with portfolio value**, ops/coverage blocks at the bottom.

**Net:** Both overviews are rich, but they order by OPPOSITE priorities — dia surfaces "how
clean is my data," gov surfaces "what's my portfolio worth + what's expiring." A dia user must
scroll past ops to reach value; a gov user must scroll past value to reach ops. They also use
different headline denominators (gov 19,232 all-status properties; dia 8,535 CMS clinics — not
its 12,280 properties), so the two pages aren't comparable at a glance.

## 1D. Orientation summary
- **dia** evolved CMS-data-first (NPI/clinic/coverage is its native spine) → ops-heavy.
- **gov** evolved portfolio-first (GSA leases, agency, value) → market-heavy.
- Each has what the other lacks: dia lacks a top-of-page portfolio dashboard + a top-level
  Ownership tab + an Activity-parity placement; gov lacks a Properties tab + a data-health
  block + the CMS-style operational cockpit.

---

# PART 2 — REDESIGN PLAN

## 2A. Design principles (aligned to the app's objective)
1. **Value-first, ops-second.** Every domain Overview leads with the money (portfolio value,
   expirations, market activity), then prospecting, then data-health/coverage, then
   domain-specific intel. The operator sees "what's it worth + what to pursue" before "what's
   dirty."
2. **Mirror by default, specialize by exception.** Both pages share ONE tab set, order, and
   Overview block order. Domain-specific tabs (dia CMS cluster, gov GSA) live in a shared
   "Reference/Data" group, clearly the exception.
3. **One concept, one name, one home.** Ownership is a top-level tab in BOTH. Lead triage is
   named the same in both. Activity is placed the same in both. The Research workbench shares
   one structure.
4. **Honest, comparable headlines.** Both pages headline the same denominator (active
   properties), with secondary domain framings (clinics / agencies) beneath.
5. **Push the ball forward everywhere** — each tab routes to the next action (the property
   detail's Next-Step + completeness rail is the model; carry that consistency into the lists).

## 2B. Unified tab set + order (both dia + gov)
Grouped tier → sub-tabs:

- **OVERVIEW group:** `Overview`
- **DEALS group:** `Pipeline` (lead/prospect triage — rename dia "Prospects" → "Pipeline") ·
  `Sales` · `Leases` · `Loans` · `Ownership` (promote dia's out of Research) · `Players`
- **INVENTORY group:** `Properties` (add to gov) · `Search`
- **RESEARCH group:** `Research` (one workbench structure) · `Activity` (promote gov's out of
  the Overview block to a tab, matching dia)
- **REFERENCE/DATA group (domain-specific):** dia → `CMS Data` · `Inventory Changes` ·
  `NPI Intel`; gov → `GSA / FRPP Intel`
- **CAPITAL MARKETS group:** `Capital Markets` (separate workstream)

Result: identical primary structure; the only difference is the Reference group's
domain-native tabs.

## 2C. Unified Overview block order (both)
1. **Action Items** (BD + data-quality, value-ranked, capped — Consumption-Layer doctrine).
2. **Portfolio at a Glance** — props (active), SF, gross rent, NOI, avg NOI/prop, rent/SF,
   operators-or-agencies tracked, contacts. *(dia: build this from its 12,280 properties /
   6,592 leases / projected rent + operators — it has the data, just doesn't surface it.)*
3. **Lease Expiration Risk** — same expiration buckets + distribution, both domains.
4. **Market Activity** — TTM Sales · Northmarq Performance · On Market (merge dia's SJC Deal
   Book in here).
5. **Pipeline Snapshot** — leads by temperature/grade + pipeline value.
6. **Breakdown** — Operator (dia) / Agency (gov) + Geographic distribution.
7. **Data Health & Coverage** — dia: CMS coverage, clinical metrics, LLC/research queues;
   gov: ownership coverage, research status, GSA intel. (Ops lives here, at the bottom.)

Same skeleton, domain-appropriate content. A dia user and a gov user now read the same page in
the same order.

## 2D. One Research workbench
Both Research tabs are staged data-quality pipelines (dia 10-mode, gov 8-step) — converge on a
single structure: a phase progress bar (Data Quality → Enrichment → Prospecting → Monitoring)
+ a numbered tab strip with queue-count badges + the per-mode card/queue UI, applying the
Consumption-Layer invariants (value-gated, actionable-only, capped). dia's CMS-specific modes
(Quarantine/Unmatched/Clinic Leads) and gov's (Intel/Financial Overrides) remain as
domain-specific steps within the shared frame.

## 2E. What to KEEP from each (best-of-both)
- **From gov:** the Portfolio-at-a-Glance value dashboard, Lease Expiration Risk buckets +
  distribution chart, Agency/Geographic breakdowns, top-level Ownership tab, the staged
  Research pipeline with phase progress bar + badges. → port the value dashboard + Ownership
  tab to dia.
- **From dia:** the Database Health / coverage block, the Activity tab (vs gov's buried
  Overview block), the Properties paginated inventory tab, the CMS operational cockpit
  pattern, the Research "workbench" mode-strip ergonomics. → port the Activity tab + Properties
  tab + a data-health block to gov.

## 2F. Sequencing (incremental, low-risk — one section at a time, mirrored)
1. **Overview parity** (highest value): unify the block order + add the missing blocks to each
   (dia gets Portfolio-at-a-Glance + Lease Expiration Risk + Operator Breakdown; gov gets a
   Data-Health block). One prompt per domain or one shared prompt.
2. **Tab set + naming**: rename dia Prospects→Pipeline; add Properties to gov; promote dia
   Ownership + gov Activity to top-level tabs; group tabs identically.
3. **Research workbench convergence** (largest; do last): one shared frame.
4. Each step ships behind the same verification: structure mirrors, no data regression,
   ≤12 api/*.js (these are client `dialysis.js`/`gov.js`/`index.html` changes), value-first
   order confirmed live on both pages.

## Bottom line
Both domain pages are individually rich but evolved on opposite axes — dia data-first, gov
value-first — so they don't mirror, use different denominators, and scatter the same concepts
(ownership, activity, lead triage) into different homes. The plan converges them on ONE
value-first structure (shared tab set, order, Overview block order, Research frame), keeps each
domain's genuine specialization in a clearly-scoped Reference group, and ports the best of each
to the other — so the two subsectors read identically, lead with value, and route the operator
to the next action everywhere.
