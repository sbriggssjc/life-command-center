# HOME1 — Home page audit (2026-09-16)

Scott's filing critiques three parts of Home: (§A) the "Top data gaps to close" widget, (§B) "My
priorities" duplicating the Priority Queue, (§C) the Dialysis/Government Highlights sections
showing deal-tracking actions and a miscategorized DaVita deal. This is a measurement + targeted
fix pass, not a redesign. **No live DB access was available in this sandbox** — all counts below
are read from view/migration SQL, not queried live; that is stated explicitly wherever it matters.

---

## §A — "Top data gaps to close" widget

**Producer:** `app.js` renders `#nextBestActionWidget` from `GET /api/admin?_route=next-best-action`
(`api/admin.js::handleNextBestAction`), which fans out to `dia.v_next_best_action` +
`gov.v_next_best_action`, merges, magnitude-filters, dedupes and globally re-ranks by
`gap_priority_score`.

**Gap classes emitted (read from the view SQL, not queried live):**

| domain | gap_type | shape |
|---|---|---|
| gov | `missing_recorded_owner` | human research task — "Research recorded owner for <address>" |
| gov | `llc_research_pending` | human research task — "Research LLC manager/agent for <name>" |
| gov | `agency_drift:lease_agency_but_property_agency_null` | **string reconciliation** — backfill `properties.agency` from the lease |
| gov | `agency_drift:agency_disagreement` | **string reconciliation** — "property says X, lease says Y" (Scott's example) |
| gov | `orphan_sale_owner` | human/automatable backlink task |
| gov | `stale_active_listing` | human research task |
| dia | `missing_recorded_owner`, `llc_research_pending`, `orphan_sale_owner`, `stale_active_listing` | same shapes |
| dia | `cms_chain_drift:*` | **string reconciliation**, same class as gov `agency_drift` |
| dia | `lease_tenant_drift` | **string reconciliation**, same class |

Scott's quoted example (`"Resolve agency drift: property says 'GSA – Nat'l Science Fdn', lease
says 'METROPOLITAN S…'"`) is the literal `suggested_action` text for
`agency_drift:agency_disagreement` in
`supabase/migrations/government/20260517200000_gov_next_best_action_views_phase_b1.sql`. It compares
raw `properties.agency` vs `leases.tenant_agency` string text — no live count was pulled (no DB
access), but by construction every property with a disagreeing lease-tenant-agency string emits
one of these rows, every run, forever, until the two strings are reconciled by code.

**ID3a fold assessment (read-only — could not dry-run, no DB access):** ID3a wired
`properties.agency_id` / `property_agencies.agency_id` (an FK registry) and, separately, ID3a-b
fixed the **`agency_canonical()`** function (a *display* column). **Neither is the column
`v_gap_agency_drift` compares.** That view reads `properties.agency` and
`leases.tenant_agency`/`tenant_agency_full` verbatim — raw capture text, not `agency_canonical` and
not `agency_id`. So **running the ID3a fold as it stands today would NOT eliminate `agency_drift`
rows** — the producer's predicate and the fix's target column are different columns, the same class
of defect CLAUDE.md documents repeatedly (C1's "lane predicate vs writer column" pattern, one level
up). Structurally, closing this gap needs `v_gap_agency_drift` (or its `agency_drift` arm in
`v_next_best_action`) repointed to resolve BOTH sides through `gov_resolve_agency`/`agency_id`
before comparing — that is an `ID3a-consumer-switch`-shaped follow-up (already an open item per
`docs/os/CURRENT-STATE.md`), not something today's registry state auto-fixes. **I could not verify
this with a live dry-run; it is a structural reading of the two SQL bodies.**

**Next-source / capturable URL coverage:** only `missing_recorded_owner` (gov) gets a resolved
target — `api/admin.js`'s R26 Unit 2 block calls `resolvePortalsForProperties('gov', …)` and
attaches `portal_url`/`portal_label`/`portal_county` (e.g. "Look up owner → San Francisco Recorder"),
and only when a county-recorder portal is resolvable; it never guesses. No other gap_type (dia or
gov) currently carries a resolved next-source/URL in the handler — `llc_research_pending`,
`orphan_sale_owner`, `stale_active_listing` are genuine human tasks but ship with no target link
today (a gap, not this round's scope). I could not get an exact row count split (no DB); by SQL
structure it's exactly the one class × domain combination above.

**Admission predicate — IMPLEMENTED (not a migration; see below for why):**
> Exclude every `gap_type` that is, or is prefixed `<name>:`, one of `agency_drift`,
> `cms_chain_drift`, `lease_tenant_drift` — these are string-reconciliation classes an existing or
> planned resolver should close without a human, never a research task with a source to check.

Implemented in `api/admin.js::handleNextBestAction` (JS filter, before ranking/dedup), not a SQL
migration: CLAUDE.md's "ONE REPO OWNS EACH DATABASE'S OBJECTS" rule means this repo does not own
the gov DB view (`government-lease` does, and this repo's `supabase/migrations/government/` is
retired/historical — writing a new gov view migration here would be exactly the mistake that rule
exists to prevent), and the dia view is slated for the same treatment. The JS predicate is
reversible, additive, and needs no DB write. The response now reports `suppressed_data_cleaning`
alongside the existing `suppressed_implausible` count so the exclusion is auditable.

**Not built:** wiring `next_source`/URL onto `llc_research_pending`/`orphan_sale_owner`/
`stale_active_listing`, and the ID3a-consumer-switch repoint of `v_gap_agency_drift`. Both are
spec-only recommendations here, not implemented.

---

## §B — "My priorities" / Home lanes

**Producer:** `renderDailyBriefingPanel()` (`app.js` ~7199) renders `usp.today_top_5` from the
daily-briefing snapshot. In `supabase/functions/daily-briefing/index.ts`:
- Default role path: `today_top_5 = mapPriorityItems(myWork, 5)`, where `myWork` comes from
  `fetchMyWork()` → the `v_my_work` / `v_my_work_scoped` view over `action_items` — **this is NOT**
  the Priority Queue (`v_priority_queue`); it is the My-Work/Team-Queue action-item lane.
- `manager`/`analyst_ops` roles: `buildStrategicPriorities()` — also does not read
  `v_priority_queue` directly (no reference found in that function).
- **BUT:** `app.js::_dbFillMyPrioritiesFromQueue()` fires whenever the snapshot's `today_top_5` is
  empty (a documented historical failure mode — a comment in `app.js` notes *"the briefing's
  today_top_5 was empty even when the priority queue held >1,000 rows"*), and that fallback calls
  **`GET /api/priority-queue?limit=5`** directly — the exact same top band the Priority Queue tab
  renders.

**Verdict: PARTIALLY CONFIRMED.** The primary path is a distinct source (My Work), but the
documented empty-snapshot condition routes to a fallback that is literally the Priority Queue's own
top-5, so in practice (whenever the snapshot briefing has no My-Work items — which the app's own
comments say happens) Scott sees the Priority tab duplicated on Home. No live measurement of how
often the fallback fires (no DB access) — flagged as unverified.

**3-lane spec** (existing views only; nothing new needed):

| lane | source | rank key | cap | "done" removes a row when |
|---|---|---|---|---|
| **Research** | `v_next_best_action` (dia+gov fan-out, same producer as §A), filtered to the §A human-actionable predicate | `gap_priority_score DESC` | 5 | the underlying gap resolves (owner/agency/lease field fills) — same close condition as the widget itself |
| **BD** | `v_priority_queue_enriched` (or `v_lcc_bd_worklist` for the loan-maturity/owner-attributed cadence lane) | `priority_band` then `rank_value DESC` | 5 | a touchpoint is logged (`touchpoint_cadence` advances) or the band/verdict changes via a Decision Center card |
| **Inbox** | `inboxSummary` (already fetched in `daily-briefing/index.ts`) / `inbox_items` | `created_at DESC`, new/overdue first | 5 | the inbox item is triaged/dismissed/archived (existing `inbox_items.status` transition) |

Mock ordering: Research (data gaps with a next-source), then BD (next touchpoints — reads
`v_priority_queue`'s bands, same source as the Priority tab, but explicitly labeled and capped so
it doesn't pretend to be a different queue), then Inbox (new/overdue). This directly replaces the
current single "My Priorities" block with three explicitly-named, source-labeled lanes so the BD
lane's overlap with the Priority tab is honest (labeled "same queue, top 5") instead of accidental
(an unlabeled action-item list that sometimes silently becomes the Priority Queue via a fallback).

**Not implemented** — spec only, written to this file, per instructions (§B is spec-only, no build).

---

## §C — Highlights section / miscategorized deal — FIXED

**Producer:** `app.js::renderDailyBriefingPanel` (~line 7229-7239) reads
`domain.government.highlights` / `domain.dialysis.highlights` from
`snap.domain_specific_alerts_highlights`, built by
`supabase/functions/daily-briefing/index.ts::buildDomainSignals()`.

**Bug — `supabase/functions/daily-briefing/index.ts:1004` (pre-fix) / `inferDomain()`:**
```js
if (item.domain === "government" || item.domain === "dialysis") return item.domain;
```
`action_items.domain` (the source column for `myWork`/`unassignedWork` items, per
`v_my_work_scoped`'s `a.domain`) is stored in the **canonical short form** (`"dia"`/`"gov"`), per
this repo's own documented convention ("vertical / source_domain are canonical short-form
dia/gov ... this class of dia/gov alias bug has recurred many times — always canonicalize" —
CLAUDE.md). The exact-match check only recognized the long forms, so `item.domain === "dia"` never
matched, and EVERY short-form-tagged item silently fell through to a keyword regex over the title
text — a brittle, order-dependent (`GOV_DOMAIN_RE` tested before `DIA_DOMAIN_RE`) fallback that a
correctly-tagged row should never have had to survive at all.

**Fix — `supabase/functions/_shared/domain-routing.ts` (new file) + `daily-briefing/index.ts`:**
extracted `canonicalizeDomainTag()`/`inferDomain()` into a dependency-free shared module (so it's
importable from Node tests without pulling in the edge function's Deno-remote imports), taught
`canonicalizeDomainTag` to map both short and long forms, and made `inferDomain` consult it before
any text-guessing fallback. Also reordered the fallback regex to check the far-less-ambiguous
dialysis-operator tokens (DaVita, Fresenius, …) before the generic gov keyword list (which contains
words — "lease", "tenant", "agency" — that also appear routinely in dialysis-domain text).

**Test:** `test/daily-briefing-domain-routing.test.mjs` (6 tests, all passing) — pins
`canonicalizeDomainTag`'s short/long-form mapping, a short-form-tagged item winning over
gov-flavored text, the DaVita/Villages/FL fixture (both tagged and untagged) routing to
`"dialysis"` never `"government"`, and a genuine GSA-lease item still routing `"government"`.

**Broader question — is "Highlights" deal-tracking or market intelligence?**
Reading `buildDomainSignals()`: its four inputs are `myWork`/`inboxSummary` (action items — mostly
"schedule a call", "follow up" deal-tracking tasks), `hotContacts` (engagement-scored people, not
market events), and `diaPipeline.deals`/`.leads` (pipeline records, not transactions). **None of the
four inputs is a market-event feed** (no sale, listing, lease-event or CMS/agency-change data
enters this function at all) — so today's "Highlights" section is, in substance, a filtered
deal-action list wearing a market-intelligence label; Scott's instinct is correct. Two options,
prose only:
1. **Rename** the section to something like "Government Deal Actions" / "Dialysis Deal Actions" —
   cheapest, ships today, and is honest about what it already contains.
2. **Re-source** from the "MB" market-brief producers (`docs/os/CURRENT-STATE.md` "live since
   2026-09-12" / `MB1`/`MB2` series, `market_brief`-family views) to genuinely surface a sale,
   listing, lease event or agency change per domain, and move the current deal-action content into
   the BD lane from §B instead.
Recommendation: do (1) immediately (a one-line label change, zero risk) and treat (2) as a
follow-up once the 3-lane Home redesign from §B is actually built — building a second "highlights"
concept before the lanes exist would fragment Home further.

---

## Git

- Branch: `claude/home1-audit` (pushed, not merged, no PR opened)
- Files changed:
  - `supabase/functions/_shared/domain-routing.ts` (new — extracted, testable domain-routing logic)
  - `supabase/functions/daily-briefing/index.ts` (uses the shared module; old inline `GOV_DOMAIN_RE`/
    `DIA_DOMAIN_RE`/`canonicalizeDomainTag`/`inferDomain` removed)
  - `test/daily-briefing-domain-routing.test.mjs` (new — 6 tests, all passing)
  - `api/admin.js` (`handleNextBestAction`: excludes drift-class gap_types from the widget;
    reports `suppressed_data_cleaning`)
  - `docs/audits/HOME1_HOME_PAGE_AUDIT_2026-09-16.md` (this file)

## Explicitly flagged blockers / unverified claims

- **No live Supabase/DB access from this sandbox.** Every gap-class count, the ID3a fold's actual
  effect on `agency_drift` row counts, and how often the §B fallback fires are read from SQL/JS
  structure, not queried. Stated as such above rather than fabricated.
- The ID3a-consumer-switch repoint of `v_gap_agency_drift` to use `agency_id`/`gov_resolve_agency`
  is recommended but not built — it is a gov-DB view change and this repo does not own gov DB
  objects (per CLAUDE.md's ownership table); it belongs in `government-lease`.
- §A's "no next-source for llc_research_pending/orphan_sale_owner/stale_active_listing" gap is
  named but not closed — out of this round's scope (not requested).
