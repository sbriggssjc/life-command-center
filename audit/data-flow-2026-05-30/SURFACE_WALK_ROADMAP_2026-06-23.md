# LCC Surface Walk — Consolidated Summary + Prioritized Build Roadmap (2026-06-23)

Capstone of the surface-by-surface audit. Ties together the cockpit fixes (R60–R64), the
Consumption-Layer doctrine, the domain-pages redesign (Parts 1–3), and the Contacts/Entities +
Research-workbench findings into one sequenced plan.

## Phase status log (living — updated at each phase completion)
- **Phase 0 (land the cockpit):** R60–R64 + doctrine merged + Railway redeployed; cockpit JS live.
- **Phase 1 (routing foundation):** ✅ **SHIPPED + VERIFIED LIVE 2026-06-23** (PR #1306). Hash
  routing live: bnav writes `#/<slug>`; Back/Forward switch pages; detail mirrors to
  `?d=prop:<db>:<id>:<tab>`; tab-switch updates the segment; Back closes the detail without
  exiting; **cold deep-link + reload re-open the exact property + tab** (verified on
  `#/dia?d=prop:dia:24703:Overview` → "DaVita Deltona Dialysis", Overview tab). Empty hash →
  Today (no regression). *Learning/adjustment:* clinic-only dia opens with no `property_id` are
  NOT cold-deep-linkable yet (no stable id in the token) — they open normally in-app; revisit if
  needed (give clinics a stable token) during Phase 4 zoom wiring. Substrate is ready for the
  Phase-4 lateral back-stack + breadcrumb.
- **Phase 2 (overview parity):** ⏳ **SHIPPED, ONE BLOCKER 2026-06-23.** Code + data verified
  live: served + running `renderDiaOverview` contains the new value blocks (Portfolio at a
  Glance, Lease Expiration Risk, Operator Breakdown); the dia MV `mv_dia_overview_stats` is live
  on the dia DB and reconciles (12,280 active props, $935.7M projected rent, DaVita $622M /
  Fresenius $203M, lease-exp buckets). **BUT** the blocks render the empty skeleton because
  `mv_dia_overview_stats` is not in the `data-query` Edge Function `DIA_READ_TABLES` allowlist
  (gov's `mv_gov_overview_stats` is) → `diaQuery` returns `[]` → `{_empty}` sentinel → fallback.
  Fix = one allowlist line in `supabase/functions/data-query/index.ts` + its
  `api/_shared/allowlist.js` mirror + redeploy the dia Edge Function
  (`CLAUDECODE_PROMPT_UIP2b_allowlist_mv_dia_overview.md`). *Learning:* any new dia/gov
  frontend-read table/view/MV must be added to the `data-query` allowlist (both places) — a
  recurring gap (cf. the QA-02 / R4-D allowlist-residue fixes already in that file).
- **Phase 2 — UIP2b applied + edge redeployed 2026-06-23.** Claude Code added
  `mv_dia_overview_stats` to `DIA_READ_TABLES` in the edge source + `allowlist.js` mirror
  (branch `claude/sleepy-bell-cfgdbx`); Cowork redeployed the dia `data-query` Edge Function
  **v23** (verify_jwt preserved). Verified live: no read regression (`diaQuery('properties')`
  → 1000 rows; gov MV intact), `diaQuery('mv_dia_overview_stats')` → the row, and when
  `renderDiaOverview` runs it populates `diaOverviewStats` and renders the value dashboard —
  Portfolio at a Glance **$936M** projected rent / **12,280** active props / 45 operators, plus
  **OPERATOR & GEOGRAPHIC BREAKDOWN** (DaVita 4,292 / Fresenius 3,519 / Independent 688 / US
  Renal Care…). **Remaining:** a hands-off cold-load render check defeated the automation tab
  (synthetic nav + 60s CDN cache + synthetic `.click()` not firing the real render path) —
  needs Scott's 10-sec in-browser eyeball: open Dialysis → Overview, confirm the value blocks
  render value-first (and gov reads still fine).
- **Phase 2 — ✅ DONE / VERIFIED LIVE 2026-06-23 (Scott eyeball).** dia Overview renders
  value-first: Action Items → Portfolio at a Glance ($936M / 12,280 / 220M SF / $27.36 PSF /
  45 operators) → Lease Expiration Risk (buckets + distribution) → Market Activity (TTM /
  Northmarq / On Market) → Pipeline Snapshot (Team Outreach) → Operator & Geographic Breakdown
  (DaVita 4,292/$622M, Fresenius 3,519/$203M, top states) → Data Health & Coverage at the
  bottom. Brand-consistent, mirrors gov. **Follow-on:** Scott's eyeball surfaced a set of
  broken/mis-categorized dia Overview tiles → spun out as the "dia Overview tile audit"
  (DIA_OVERVIEW_TILE_AUDIT_2026-06-23.md), tracked separately from the Phase 3 IA work.
- **dia Overview tile audit — ✅ DONE / VERIFIED LIVE 2026-06-23** (PR #1318). 4/5 broken tiles
  fully fixed live (SJC summary cache → 62; financial loader → 8,511; Lease Coverage → 34.3% no
  false 100%; Verification → 28 overdue headline; recent sales clickable). 2 residuals
  (Lease-Coverage sub backfill 0→3,035 via count=exact; recent-sale row cursor) folded into Phase
  3 Unit 0. Spot-checks resolved (742 listings real+dialysis-scoped, 144 stale tail; SJC = SF
  brokered deals ≠ market comps). OPS: CMS ingestion stalled since 2026-03-27 (firing but hanging);
  hang-guard shipped (DialysisProject PR #7319); Scott to kick the GH Actions fallback re-run.
- **Phase 3 (tab set + naming unification) — DRAFTED 2026-06-23**
  (CLAUDECODE_PROMPT_UIP3_tab_naming_unification.md). Unit 0 = the 2 dia-tile residuals; Units 1-5
  = rename dia Prospects→Pipeline; promote dia Ownership + gov Activity + gov Properties to
  top-level tabs; unify the grouping tier/order (Reference group holds the domain specialties).
  Client-only, routing-safe (sub-tabs aren't hashed). Awaiting Claude Code build + redeploy.

## Two themes explain almost everything we found
1. **The Consumption Layer is missing.** Across Today (research), Priority Queue (cadence
   bloat), Cadence (capture noise), Decision Center (verdict lanes), Research workbench
   (pending_updates), and Contacts (faceless owners), the same shape recurs: **producers emit
   at ingest scale; consumers don't keep pace; surfaces fill with noise that buries the
   actionable few.** Fixed by: value-gate the producer · auto-retire/auto-resolve · surface
   actionable-only (ranked, capped, honest count) · drive the loop from real activity. Codified
   in CLAUDE.md.
2. **dia and gov evolved on opposite axes.** gov is value-first (portfolio $7B dashboard,
   expirations, agency); dia is data-first (CMS coverage, NPI). They don't mirror, use
   different denominators, scatter the same concepts (Ownership, Activity, lead-triage) into
   different homes/names, and run divergent Research workbenches. Plus the navigation lacks the
   **zoom** connective tissue (no back-stack, no breadcrumb, no routing/deep-link).

The north star: the app should **drive real BD work** — find the owner → get a human to call →
pursue the deal — **value-first, connected, and intuitively navigable (zoom in/out)**, identical
across both subsectors.

## What's already shipped or specced (the cockpit pass)
| Round | Surface | Fix | State |
|---|---|---|---|
| R60 | Today/Research | value-gate + bulk-close runaway research backlog (5,447→2,917) | DB live; JS on redeploy |
| R61 | Today | greeting-date staleness + dia-highlights routing | branch; JS on redeploy (+ edge fn) |
| R62 | Priority Queue | remove cadence-touch bands (queue = pursuit) | DB live; JS on redeploy |
| R63 | Cadence | gate seeder to real signal + pause noise (318→119 actionable) | DB live; JS on redeploy |
| R64 | Decision Center | actionable verdicts vs federated 999+; auto-resolve safe subset | DB live; JS on redeploy |
| — | doctrine | Consumption-Layer section added to CLAUDE.md | branch |

**Operational prerequisite:** merge the R60–R64 branches to `main` + Railway redeploy (and the
`daily-briefing` edge-fn for R61) so the cockpit JS lands. Do this before/alongside the redesign.

## Findings catalog by surface (pointers to detail docs)
- **Today** — healthy/honest; research runaway (R60), date (R61), dia-highlights asymmetry (R61);
  backlogs (inbox/decisions/email) drain fine.
- **Priority Queue** — sound; cadence bloat removed (R62); P0.4 rank-zero tail honest (shrinks as
  owners resolve).
- **Cadence** — built right, aimed wrong; now real-relationship-gated (R63); loop grows from SF
  activity (OUTREACH#1).
- **Decision Center** — auto-supersede lanes healthy; verdict lanes were buried/unworked (R64).
- **Domain pages (dia↔gov)** — individually rich, structurally divergent →
  `DOMAIN_PAGES_AUDIT_AND_REDESIGN_2026-06-23.md` (Parts 1–2).
- **Navigation / zoom** — universal opener + slide-over exist; back-stack/breadcrumb/routing/
  entity-parity missing → `DOMAIN_PAGES_REDESIGN_PART3_ZOOM_NAV.md`.
- **Pipeline** — "Pipeline" nav is a task queue (mislabel); deal pipeline (bd_opportunities)
  tiny/stagnant (6 open, none advanced).
- **Contacts/Entities** — ownership-rich, people-poor: 23,719 owner orgs, 8,141 own property,
  2,337 valued, **only 110 have a contact**; persons float (110/4,557 linked); entity detail
  rich-but-wrong-grammar.
- **Research workbench** — 4-phase frame shared, mode sets diverge; every queue under-consumed by
  humans; gov discards 3,355 pending updates via expiry instead of auto-applying high-confidence.

## Prioritized build roadmap

### Phase 0 — Land the cockpit (operational, now)
Merge R60–R64 + doctrine; Railway redeploy; redeploy `daily-briefing` edge fn (R61 Unit 2).
Verify the cockpit counts (research, cadence, decision badge) live. *No new build.*

### Phase 1 — Routing foundation  *(substrate; unlocks zoom, deep-links, reload-survival)*
Hash/URL routing: routes encode page (L0/L1) + optional detail (db, object type, id, tab) +
lateral stack. `navTo` + `openUnifiedDetail` push/replace history; `popstate` drives page +
detail; reload re-hydrates. Browser Back/Forward = zoom out/in. Retires the long-session
staleness class (R61). **Why first:** Phases 4 and the deep-link/reload wins all depend on it;
invisible but high-leverage.

### Phase 2 — Overview parity  *(highest visible BD value; independent of routing)*
Unify the domain Overview to one value-first block order (Action Items → Portfolio at a Glance →
Lease Expiration Risk → Market Activity → Pipeline → Breakdown → Data Health) and add each
page's missing blocks — **dia gains the $-value Portfolio dashboard + Lease-Expiration Risk +
Operator Breakdown** (it has the data); gov gains a Data-Health block. Same denominator
(active properties) headlined on both.

### Phase 3 — Tab set + naming unification  *(consistency / IA)*
One shared tab set + order in groups (Overview · Deals · Inventory · Research · Reference ·
Capital Markets). Promote dia **Ownership** + gov **Activity** to top-level tabs; add
**Properties** to gov; rename dia **Prospects → Pipeline**; domain-specific tabs (dia CMS
cluster, gov GSA) grouped under Reference.

### Phase 4 — Zoom-model wiring  *(depends on Phase 1)*
Back-stack so "← Back" ascends one level (only "×" exits); breadcrumb bar; **entity detail to
property-detail grammar parity** (tabs + portfolio from `lcc_entity_portfolio_facts` not name-
search + completeness rail + Next-Step); sub-record drill (L4/L5) with the same affordance;
next-action at every depth; keyboard (Enter/Esc) + iOS back-gesture.

### Phase 5 — Contacts/Entities as a BD worklist  *(the #1 BD gap)*
Make the Contacts/Entities surface a **value-ranked "owners missing a contact" worklist**
(Consumption-Layer) — 2,200+ valued owners with no human — wired to the contact-acquisition
engine (R16/R20/CONTACT-SELECTION). Link the 4,447 floating persons to their orgs so owners
gain faces. (Entity-detail parity comes via Phase 4.)

### Phase 6 — Research workbench convergence  *(largest; do later)*
One workbench frame across dia/gov: common steps named identically (Intake · Ownership · Leads ·
Monitor), domain-specific steps grouped within. Apply Consumption-Layer per step (value-rank +
cap + auto-resolve safe subset). **Auto-apply high-confidence gov `pending_updates`** instead of
discarding 3,355 via expiry.

### Ongoing — data-propagation track (parallel, separate from UI)
R59b deed party-extraction + retroactive backfill; broader R52 contact-writeback drain; the
deed/lease OCR drains; applying the Consumption-Layer per-producer as new ones ship.

## Sequencing rationale
- **Dependencies:** Phase 1 (routing) gates Phase 4 (zoom). Phases 2, 3, 5 are largely
  independent and can interleave. Phase 6 is the heaviest and benefits from the doctrine being
  settled first.
- **Value-first ordering within "independent":** Phase 2 (dia value dashboard) and Phase 5
  (faceless owners) are the biggest BD wins → do early. Phase 3 (naming/IA) is lower-risk polish.
- **Risk:** all UI phases are client-side (`app.js`/`dialysis.js`/`gov.js`/`detail.js`/
  `index.html`) — ≤12 api/*.js untouched; reversible; ship behind the standard verify (structure
  mirrors, no data regression, value-first order confirmed live on both pages).

## Cross-cutting principles (apply to every phase)
1. **Consumption-Layer doctrine** — every surfaced list/queue is value-gated, auto-retired,
   actionable-only, honestly counted.
2. **Value-first** — lead with the money + the next action, ops/data-health second.
3. **Mirror by default, specialize by exception** — dia and gov identical except a clearly-scoped
   Reference group.
4. **One object → one detail → next-action everywhere** — uniform zoom grammar with guidance at
   every depth.
5. **Drive real work** — every surface routes to the next BD action; honest data over box-checking.
6. **Northmarq brand** on all new chrome.

## Bottom line
The cockpit is fixed (R60–R64) and the pattern codified. The redesign converges dia and gov on
one value-first, consistently-navigable structure, on a routing substrate that makes the
zoom-in/zoom-out model real, and turns the owner-centric graph into an actionable
contact-acquisition worklist. Recommended start: **Phase 0 (land the cockpit) + Phase 1 (routing)**,
then **Phase 2 (Overview parity)** as the first visible BD win.
