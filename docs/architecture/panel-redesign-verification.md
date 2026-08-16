# Panel Redesign — claim → evidence matrix (living)

**Companion to** [`property-owner-panel-redesign-2026-08.md`](property-owner-panel-redesign-2026-08.md)
(the *target state*). This file is the **proof**: every design claim mapped to a re-runnable check and its
current result, so the flow can be shown to work end-to-end and re-shown after each change.

**Standing rule (Scott, 2026-08-15):** no design item is "done" until it has a row here with a check that
someone else could run. A claim with no evidence column is a claim, not a feature.

- **Behavioural + structural checks:** `node --test test/panel-redesign.test.mjs` — **47/47 pass** (2026-08-15).
- **Data checks:** the SQL in §3 against LCC Opps `xengecqvemvfknjvbvrq` (read-only).
- **Manual checks:** §4, the handful that genuinely need eyes on a browser.

Honesty rule from `CLAUDE.md` applies here hardest: **a green UI check over an empty data leg is not an
end-to-end pass.** §3 is where that gets said out loud.

---

## 1. What the checks caught (why this file exists)

Writing the tests was not ceremony — the first run was **43/47**, and two of the four failures were live
defects that had already passed a full code review:

| # | Defect the test caught | Why review missed it |
|---|---|---|
| V-1 | **The viewport width clamp did not work.** Each panel was clamped against the *other panel's minimum*, so on a 1400px screen primary→920 and companion→860 were each "valid" while totalling 1780. | The clamp reads correctly in isolation; only the pair is wrong. Fixed to budget against the other panel's *actual* width. |
| V-2 | **The apostrophe fix was still broken.** `encodeURIComponent` does **not** escape `'` (it is in the unreserved set), so `O'Brien Holdings LLC` still emitted a raw quote and the `onclick` was still a SyntaxError. | The first fix replaced a wrong escaping scheme with a *different* wrong one that looks obviously safe. Now `_jsStrArg()` percent-escapes `'` and `"` explicitly, and the test *parses the emitted handler and invokes it*. |

The other two failures were the test's fault (the structural regexes were matching the code comment that
*documents* each removed surface) — fixed by stripping comments before asserting. Worth recording: a
"has X been removed" assertion must not be satisfiable by a comment saying X was removed.

Two more, from the rounds that followed:

| # | Caught by | Finding |
|---|---|---|
| V-3 | **Prompt 111**, re-verifying the baseline | **This document's own headline number was wrong.** "104 of 690 reachable" counted any graph route, but `buildContact360` never walks `entity_relationships`, so 60 of those owners still saw *"Find a contact"*. Hero-true was **56 (8.1%)**. Lesson: **measure the number the operator experiences, not the one the schema permits** — a metric defined by a join is not a metric defined by the UI. Now both are columns on `v_lcc_owner_reachability`. |
| V-4 | **Prompt 111**, live dry-run before applying | Reusing `dup-pair-planner.ownerCore` (a *fuzzy-pairing* helper) for *identity*: `Realty Income Corporation` reduced to `""` and failed to match itself, and `Agree Realty Corp` / `Agree Holdings LLC` both reduced to `agree` and scored **1.0** — an automatic write onto the **wrong owner**. Only a dry-run over real data exposed it. Now in `CLAUDE.md` as a footgun. |

The pattern across V-1…V-4: **every one survived reading the code and died to executing it against reality.**
That is the argument for the dry-run and the evidence matrix, and it is why §4 is not optional.

---

## 2. UI / logic claims — automated

All in `test/panel-redesign.test.mjs`. **47/47 pass.**

| Claim (spec §) | Check | Result |
|---|---|---|
| Panel widths respect min/max (§1.1) | clamp at 420–1100 / 360–900 | ✅ |
| A width saved on a big monitor can't break a small one (§1.1) | `clamp(1400px)` pair must fit the viewport | ✅ *(was failing — V-1)* |
| Parked panels are identified by subject, not descriptor shape (§1.2) | `_panelParkSig` equal for `{ids:{property_id:24703}}` and `{propertyId:24703}`; distinct across ids and domains | ✅ |
| The panel never asserts the operator owns the building (§0, P0.1) | `_udResolvedOwnerRef` returns `null` for an operator-flagged `true_owner` | ✅ |
| "Work this owner →" is never a dead button (§2.5.1) | returns `''` with no resolved owner | ✅ |
| …and its handler is valid JS for real-world names (§2.5.1) | emitted `onclick` is **parsed and executed**; must round-trip `O'Brien Holdings LLC` and `Smith & Sons "Holdings"` | ✅ *(was failing — V-2)* |
| The ladder collapses only on a genuine match (§0 corollary) | casing/suffix variants collapse; `MDS DV Victorville LLC` vs `DaVita Inc.` does not; `LLC` vs `Inc` does not | ✅ |
| The CRM stack actually left the property tab (§2.5) | 12 assertions: Log Call form, activity-type select, Draft Email, touchpoint host, SF feed host, three contact write-inputs, Ownership Assistant, CRM-coverage bar, Begin-Prospecting, async CRM loaders | ✅ |
| …and the asset-scoped duties stayed | Current Owner card, ladder, chain, Resolve form, hand-off all still rendered | ✅ |
| Tab renamed but legacy deep-links still route (§2) | registry says `Ownership`; `'ownership & crm'` maps; legacy render alias dispatches | ✅ |
| Log Touchpoint gone from Overview (§2.2) | no `log_touchpoint` in `_udActionButtons` | ✅ |
| Completeness rail capped at 4 (§2.1) | `missing.slice(0, 4)` | ✅ |
| **Removing the contact inputs cannot null curated data** | `contact_1_name` is gated on `_contactFormPresent`, never set unconditionally | ✅ |
| Widths are var-driven, no hard-coded 520/480 survives (§1.1) | scan of panel selectors in `styles.css` | ✅ |
| Companion + both resizers offset off the primary var | selector regex | ✅ |
| Tray/resizer/companion nodes exist | `index.html` id scan | ✅ |
| **Cache busters move together** | `app.js` / `detail.js` / `ops.js` / `styles.css` must share one `?v=` | ✅ |
| Owner-panel rail chips target tabs that exist (§3.1 O-1) | every `switchEntityTab(...)` target in the rail appears in `_entityTabsForRole` | ✅ |
| Deal tab stopped repeating the Property snapshot (§3.1 O-5) | `_dealPropertyRef` no longer references tenant/guarantor/term/SF | ✅ |

**Re-run:** `node --test test/panel-redesign.test.mjs`

---

## 3. Data claims — the flow measured against live data

### 3.0 END-OF-DAY STATE after prompts 111 → 114 (re-measured live, 2026-08-15)

All four shipped and merged (PRs #1750 / #1751 / #1753 / #1754). **This table supersedes the numbers
below it**; the detail underneath is kept as the audit trail of how each leg moved.

| Leg | Start of day | Now | Note |
|---|---|---|---|
| assets with a resolved owner | 1,396 (35.9%) | **1,910 (49.2%)** | P113 — promotion of owners we already held, not new capture |
| distinct owner entities | 690 | **1,118** | |
| `reachable_hero_effective` | 56 (8.1%) | **228 (20.4%)** | P111 (+36) then P114 (fold-in) |
| reachable-in-data but invisible-in-UI | 47 | **0** ✅ | P114 closed it — was a pure UI defect |
| cadence rows (total, nothing deleted) | 1,905 | **1,905** | |
| cadence **active surface** | 1,214 | **278** | P112 — 1,627 reversibly paused |
| cadence rows with a rep | 7 | **37** | P112 Unit D |
| `last_touch_at` in the future | 3 | **0** ✅ | P112 Unit C, fixed in 3 layers |
| **reachable owners with NO active cadence** | 65 | **89** | ⚠️ **112 Unit A2 was NOT built** — grew with the owner population |

**Read this honestly.** Owner resolution moved a lot; **reachability barely moved as a share** (20.1% →
20.4%) because every asset P113 resolved added owners to the denominator, ~87% of them unreachable. That is
the denominator effect prompt 113 was told to pre-state, and it did. The constraint is unchanged:
**~478 owners (82%) remain solvable only via the paused SOS-direct path.**

### 3.0.1 Where my own numbers were wrong (three times)

Recording these because the pattern matters more than the individual errors:

| Metric I published | Reality | Why |
|---|---|---|
| "104 of 690 reachable" | **56** hero-true | counted a graph join `buildContact360` never walks (V-3) |
| "94 owners on a cadence are unreachable" | **does not reproduce** — 17 of 1,113 prospecting rows under `reachable_hero_effective`; **0** scoped exactly as I wrote it; closest reproducible is 109 on the pre-114 definition | I scoped an ad-hoc query differently from the canonical predicate |
| "the cadence rep backfill is a dead end" | **partly wrong** — `lcc_entity_owner_override` has 131 point-person rows; 30 cadences resolved → reps 7 → 37 | I inherited the July finding without re-testing it |

**Rule adopted:** quote `v_lcc_owner_reachability.reachable_hero_effective` and the canonical predicates —
never hand-roll a reachability or reachability-adjacent query. A number that isn't the one a surface reads
is a different number.

> ⚠️ `v_lcc_owner_reachability.hero_gap` is **not** a defect count. It is the Prompt-114 before/after delta
> and therefore *grows* as owners are added (54 → 128). The real "reachable but invisible" metric is
> `reachable_graph − reachable_hero_effective` = **0**. (Flagged by prompt 113.)

---

*Historical audit trail — queried LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-15 morning. Read-only.*

The redesign's whole thesis is a chain: **asset → resolved owner → reachable contact → cadence → touch.**
The UI now expresses that chain cleanly. Here is how much of it the data can actually carry.

| Leg | What the UI does with it | Live count | Coverage |
|---|---|---|---|
| 1 · asset entities (dia+gov) | the property panel | **3,886** | — |
| 1 · assets with a resolved owner | Current Owner card + `Work this owner →` | **1,396** | **35.9%** |
| 2 · distinct owner entities reachable from an asset | the owner panel's population | **690** | — |
| 3 · owners reachable **via the org record** (email or phone) | owner hero skips "Find a contact" | **50** → **86** | 7.2% → **12.5%** |
| 3 · owners reachable **via a linked person** | *nothing — see the correction below* | **60** | 8.7% |
| 3 · **owners the hero can actually reach** | hero skips "Find a contact" | **56** → **92** | 8.1% → **13.3%** |
| 3 · owners reachable by any graph route | (wider than the hero) | **110** → **139** | 15.9% → 20.1% |

> **Correction (Prompt 111, 2026-08-15).** The original "104 reachable by any route" **overstated what
> the operator sees.** `buildContact360` builds `subject.email` from `entities.email` or a
> `unified_contacts` row whose `entity_id` IS the owner — it never walks `entity_relationships` to a
> linked person — and `_nextActionForContact` gates on that. So the 60 "via a linked person" owners
> still get **"Find a contact"**. The hero-true figure was **56 (8.1%)**. Both numbers are now columns
> on `v_lcc_owner_reachability` (`reachable_hero` / `reachable_graph`); quote `reachable_hero` for
> operator experience. The ~54-owner gap is a live defect: reachable in the graph, unreachable in the UI.
>
> The arrows above are the BREAK-1 unlock (batch `ocp_20260815`): 36 owners filled from owner-bound,
> name-matched dia/gov contacts we already held. Findings + the honest ceiling:
> [`connectivity-and-open-threads.md`](connectivity-and-open-threads.md) §4b BREAK-1 findings.
| 4 · owners on a touchpoint cadence | the read-only prospecting strip | **134** | 19.4% |
| 4 · owners whose next touch is **overdue** | hero → "log the overdue touch" | **134** | **100% of those on cadence** |

### 3.1 The three things this proves that a screenshot could not

**(a) The hand-off is real but lands on a wall for ~85% of owners.** The property panel now correctly stops
at "here is the owner" and hands off. But only **104 of 690** owner entities have any contact method, so the
owner panel's hero resolves to **"Find a contact"** for the other ~586 — and that enrichment chain
(`owner-contact-websearch` / SOS-direct) is **PAUSED / CI-blocked** per `CLAUDE.md`. *The UI change is
correct and the funnel is honest; the constraint moved downstream, where it belongs and is now visible.*
Previously the property tab's Log Call form hid this by letting you log activity against an owner you had no
way to contact.

**(b) The cadence layer is a producer with almost no consumer.** Of **1,905** cadence rows:

| | count | note |
|---|---|---|
| never touched (`last_touch_at IS NULL`) | **1,728** | **91%** |
| overdue < 90 days | 1,803 | a bulk stamp that then went stale |
| overdue > 1 year | 68 | oldest due date **2021-09-06** |
| due in the future | **23** | the entire live pipeline |
| carrying a rep (`owner_user_id`) | **7** | confirms the documented producer gap |
| suppressed / unsubscribed | 0 | |

This is the **Consumption-Layer doctrine failure** (`CLAUDE.md`) showing up in data: work is emitted at
ingestion scale and not worked. The redesign's read-only prospecting strip will therefore say "overdue" on
essentially every owner it can say anything about — which is accurate, and is exactly the signal the doctrine
says must not be allowed to become background noise. **Flagged, not fixed here.**

**(c) A small data-quality defect surfaced on the way.** 3 cadence rows carry `last_touch_at` **in the
future** (max `2026-10-15`, two months ahead of today). A "last touch" cannot be in the future; some writer
is stamping a scheduled date into the completed-touch column. Low volume, but it will render as a nonsense
"last touch" on the owner card.

### 3.2 Re-runnable SQL

**Legs 1–3 are now a view** (Prompt 111) — the loose SQL below was retyped on every re-measure and the
"reachable" definition drifted from what the UI reads. One statement, both definitions:

```sql
SELECT * FROM public.v_lcc_owner_reachability;
-- assets | assets_with_owner | owner_entities | via_org | via_unified_contact
-- via_linked_person | reachable_hero | reachable_graph
-- via_linked_person_selectable | reachable_hero_effective | hero_gap   <- Prompt 114
--
-- reachable_hero            = the PRE-Prompt-114 hero definition. Kept unchanged
--                             on purpose: it is the before/after yardstick, and
--                             redefining it would erase the comparison.
-- reachable_hero_effective  = what the hero reads AFTER the Prompt 114 fold-in
--                             (org routes PLUS a linked person that survives the
--                             reachable-via guards). QUOTE THIS ONE from now on.
-- hero_gap                  = the difference: owners the data could reach and the
--                             UI could not. This was the pure UI defect.
-- reachable_graph           = any linked person INCLUDING brokers, so it
--                             OVERSTATES what the panel can show. Do not quote it.

-- the actionable owner-contact review lane (already-reachable owners excluded)
SELECT count(*) FROM public.v_lcc_owner_contact_attach_review_open;

-- the value-ranked population any owner-contact feeder is measured against
SELECT count(*) FROM public.v_lcc_owner_unreachable_worklist;

-- Prompt 113: the owner-FEEDER dry-run surface (leg 1). Re-runnable, read-only.
-- Note `operator_blocked` is not a failure -- it is the count of assets whose
-- domain "owner" is the TENANT, which the feeder must refuse to promote.
SELECT status, count(DISTINCT entity_id) FROM public.v_lcc_domain_owner_candidates
 GROUP BY 1 ORDER BY 2 DESC;
```

> **⚠️ `hero_gap` is not a defect count.** The column computes
> `reachable_hero_effective − reachable_hero`, i.e. the Prompt-114 before/after delta, so it *grows* as
> owners are added (54 → 128 after Prompt 113 resolved 514 more assets). The metric this table called
> "reachable but invisible" is `reachable_graph − reachable_hero_effective`, which is still **0**.

The original inline SQL is kept below for reference / to re-derive the view:

```sql
-- Leg 1–2: asset → resolved owner
with assets as (select id from public.entities where domain in ('dia','gov') and entity_type='asset'),
     resolved as (select distinct po.entity_id, po.owner_entity_id
                    from public.lcc_property_owner po join assets a on a.id = po.entity_id
                   where po.owner_entity_id is not null)
select (select count(*) from assets)   as assets,
       (select count(*) from resolved) as assets_with_owner,
       (select count(distinct owner_entity_id) from resolved) as owner_entities;

-- Leg 3: owner reachability, counting BOTH the org record and linked people
-- (contact360 resolves either), which is what the owner hero actually reads.
with assets as (select id from public.entities where domain in ('dia','gov') and entity_type='asset'),
     owners as (select distinct po.owner_entity_id id from public.lcc_property_owner po
                  join assets a on a.id=po.entity_id where po.owner_entity_id is not null),
     via_org as (select o.id from owners o join public.entities e on e.id=o.id
                  where coalesce(nullif(e.email,''),nullif(e.phone,'')) is not null),
     via_person as (select distinct o.id from owners o
                      join public.entity_relationships r on (r.to_entity_id=o.id or r.from_entity_id=o.id)
                      join public.entities p on p.id = case when r.to_entity_id=o.id then r.from_entity_id else r.to_entity_id end
                     where p.entity_type='person' and coalesce(nullif(p.email,''),nullif(p.phone,'')) is not null)
select (select count(*) from owners) owners,
       (select count(*) from (select id from via_org union select id from via_person) u) reachable_any;

-- Leg 4: is the cadence layer alive?
select count(*) total,
       count(*) filter (where last_touch_at is null)   never_touched,
       count(*) filter (where next_touch_due >= now()) future_due,
       count(*) filter (where owner_user_id is not null) with_rep,
       count(*) filter (where last_touch_at > now())   last_touch_in_the_future,
       min(next_touch_due) filter (where next_touch_due < now()) oldest_overdue
  from public.touchpoint_cadence;
```

### 3.3 Targets — what "working as designed" would look like

Recorded so the next run can be compared, not just admired.

| Metric | 2026-08-15 | Why it matters | Owner of the fix |
|---|---|---|---|
| assets with a resolved owner | 35.9% → 49.2% → **59.0%** (2026-08-15) | gates the whole hand-off | **P0.3 SHIPPED** (Prompt 113) 1,396 → 1,910, then the **SUPERSESSION TIER SHIPPED** (+418) → **2,294** of 3,886; owner entities 690 → **1,420**. P0.2 measured at ≤40 assets and **skipped** |
| resolver: chain scored as competing claims | **741 stuck → 418 resolved, 323 to review** | the share-based gate, not evidence volume, was the blocker — **all 741 were multi-candidate and NONE passed 0.55** (avg share 0.407); 295 already had a curated `domain_true_owner` and still lost | **SHIPPED** — `lcc_supersede_property_owner`, batch `supersede_20260815`, idempotent + reversible. Guards added mid-build after the live dry-run tried to write **brokerages** (Matthews/Colliers/Coldwell Banker) as owners |
| owners the hero can reach (`reachable_hero_effective`) | 56 → 92 → 139 → **262** owners (2026-08-15) | **the binding constraint** on the redesigned flow | BREAK-1 `owner-contact-propagate-tick` (+36) → Prompt 114 c360 fold-in → supersession (+34). **The SHARE stays ~20% because each resolved asset adds owners to the denominator** — quote the absolute count; ~478 owners remain SOS-blocked |
| hero-vs-graph gap (reachable but invisible) | 54 → **0** | a defect, not a data gap — `buildContact360` never walked `entity_relationships`, so every correct person+edge write was invisible | **CLOSED** (Prompt 114 Unit 2: `subject.reachable_via`) |
| owner-contact review lane — actionable | **84** (of 101 proposed; 17 auto-retired) | Prompt 111 produced these and shipped no consumer | **CLOSED** (Prompt 114 Unit 3: Decision Center lane `owner_contact_attach_review`) |
| cadence rows ever touched | **9%** | a strip that always says "overdue" trains you to ignore it | consumption layer — auto-retire + reality-driven advance |
| cadence rows with a rep | 0.4% → **2%** (7 → 37) | ROE line on the owner card is blank | Prompt 112 Unit D — the backfill was **not** a dead end after all; `lcc_entity_owner_override` had 131 point-person rows |
| **assets with a NULL `domain`** | **34** | they are `entity_type='asset'` but excluded from every `domain in ('dia','gov')` rollup, so they silently under-report every coverage metric | NEW 2026-08-15 — found reconciling +384 assets against 418 writes; hygiene pass needed |

---

## 4. Manual checks — RUN 2026-08-15 (Scott)

Evidence: `docs/claude-code/responses/manual checks.docx` (13 screenshots + notes).
**Verdict: the IA changes all landed; the panel-shell interactions did not.**

| # | Step | Result | Evidence |
|---|---|---|---|
| M-1 | Panel width + one-row tabs | ✅ **PASS** | Panel renders at 720px in a ~1440px window; all 7 tabs on one row; rail shows **4 chips + "+3 more"**; Next-step card above the fold |
| M-2 | Drag the left-edge strip to resize | ❌ **FAIL** | *"The panel does not drag."* → **UI-1** |
| M-3 | Owner chip → companion dock beside the property | ⚠️ **INTERMITTENT** | *"Ownership panel does not open from this view but I clicked around a few more screens and was able to open it elsewhere."* → **UI-2** |
| M-4 | ⇄ swap | ❌ **FAIL** | *"The panels do not move around."* Swap button renders in the header but pressing it does not exchange the panels → **UI-3** |
| M-5 | Minimize → tray → restore | ⛔ **NOT REACHED** | blocked by M-3/M-4 |
| M-6 | No CRM stack on the Ownership tab | ✅ **PASS** | No Log Call form, Draft Email, touchpoints, SF feed, or Ownership Assistant anywhere on the tab |
| M-7 | Owner name not repeated | ✅ **PASS** | Rem Management: ladder collapsed to a single **"OWNER — DEED & DECISION MAKER"** card with *"Recorded deed owner and decision maker are the same party."* Was 4 cards, now 1 |
| M-8 | Shell-in-front-of-parent still shows two cards | ⛔ **NOT TESTED** | needs an owner where recorded ≠ true |
| M-9 | Research Notes on Overview → save | ⛔ **NOT TESTED** | |
| M-10 | Never-clobber on Save Ownership | ⛔ **NOT TESTED** | **highest-value remaining check** |
| M-11 | Legacy deep-link still routes | ⛔ **NOT TESTED** | |
| M-12 | Window < 1180px | ⛔ **NOT TESTED** | |

Also confirmed working in the screenshots (not on the original list): **"Work this owner →"** renders with its
explanatory line; **Resolve Data Gaps** dropped 4 → **1** (the contact gaps left, as designed); Overview
Actions reads *Mark as Lead · Add to Pipeline · Create Task · **Owner & contacts →*** with **Log Touchpoint
gone**; the ⇄ / – / × control cluster renders in the header.

### 4.1 Defects raised by the run

| # | Defect | Severity | Note |
|---|---|---|---|
| **UI-0** | **Uncaught JS error on the Ownership tab** — a red *"Something went wrong — try refreshing"* toast. That string is `index.html`'s **global `window.onerror` / `unhandledrejection` handler**, so a real exception or rejected promise is firing. A static pass over `_udTabOwnership` found **no missing references** (23 called identifiers, all defined), so it is a **runtime/async** failure, not a broken render path — and it may predate this change. | **HIGH — diagnose first** | Needs the console line: DevTools → Console → reproduce → copy the `[LCC error] …` / `[LCC promise] …` entry. Do not guess-fix. |
| **UI-1** | Resizer does not drag | HIGH | Two candidate causes, distinguishable in one console command (below): (a) the strip is not receiving `.open` from `_panelSyncResizers`, or (b) it is present but **undiscoverable** — an 8px transparent strip with no visual grip, so Scott may have been dragging the header. Either way the affordance needs to be *visible*. |
| **UI-2** | Owner chip doesn't always open the companion | MEDIUM | `_openEntitySmart` docks only when `_dualCapable() && _activePrimaryKind === 'property'`. `_activePrimaryKind` is set but **never cleared**, and some chips route through `_ownerLink` rather than `_openEntitySmart` — so behaviour varies by which surface the chip came from. Audit every owner-chip entry point onto one router. |
| **UI-3** | Swap does nothing | MEDIUM | `_panelSwap` returns early with an *"Open two panels to swap"* toast when there is no companion — likely what happened, since M-3 was already failing. Cannot be judged until UI-2 is fixed. |

### 4.2 Design change requested (supersedes part of spec §1.2)

> **Scott, 2026-08-15:** *"I think we want to see the full detail side-by-side instead of a placeholder that
> you can swap over to the primary."*

The companion dock currently renders a **summary card** (next-best-action, standing, portfolio one-liner,
contact, and an "Open full detail ↗" button). Scott wants the **full tabbed panel in both slots**.

Consequences to work through before building:
- **Swap loses most of its purpose.** ⇄ exists because the companion is a placeholder; if both slots are
  full panels, swap becomes a convenience, not the way to reach detail. Keep it, demote it.
- **Two full panels need the width.** 720 + 620 = 1340 plus chrome; the dual-dock floor (currently 1180)
  must rise, or both panels shrink, or the primary yields while a companion is open.
- **The tab bar has to survive ~620px.** Seven property tabs fit at 720 but will wrap at 620 — the
  `flex-wrap` fallback is still there, so this degrades rather than breaks, but it should be designed.
- **Two panels = two independent tab/scroll/route states.** Hash routing (`?d=`) currently encodes ONE
  detail subject; a genuine side-by-side needs a second token or an explicit decision that only the primary
  is deep-linkable.
- `_renderCompanionEntity` / `openCompanionProperty` become thin wrappers that mount the same renderers as
  `openEntityDetail` / `openUnifiedDetail` into the companion node — the renderers must stop assuming the
  singleton ids `#detailBody` / `#detailTabs`. **That element-id assumption is the real work.**

### 4.2b UI-0 — DOES NOT REPRODUCE on the current build (2026-08-15, live capture)

Armed console capture (`docs/architecture/ui-0-console-diagnostic.js`), reproduced the full flow on the
deployed build `?v=5dedbb9f2026`:

```
UI0_errors: []   UI0_rejections: []   UI0_consoleErrors: []
build.hasOpenOwnerChip: true          (the UI-1/2/3 fixes ARE live)
```

**Leading hypothesis, and it is consistent:** the red toast was the **entityLink apostrophe bug**. A broken
inline `onclick` is a *parse* error raised at click time through `window.onerror` — which is exactly the
handler that renders "Something went wrong — try refreshing", and exactly why the toast carried no useful
detail. That defect shipped fixed in `claude/panel-ui-defects-manual-run` (all four `entityLink` branches
now use `_jsStrArg`). Not claimed as proven — a non-reproduction is weaker evidence than a caught stack —
so the capture stays in the repo and UI-0 stays **open-but-unreproducible** until a clean pass on a property
Ownership tab with an apostrophe-bearing owner name.

### 4.2c ⚠️ Bigger finding from the same capture — page-load performance

The console timings are a more serious operator problem than any of UI-1/2/3:

```
api:/api/review-counts                    1,507ms
api:action=cadence_dashboard&limit=200    1,526ms
api:action=bd_worklist&limit=5            8,192ms
api:summary=1                            16,199ms   ← 16 seconds
[Marketing] Opportunities pages 1..12    11,831 rows pulled client-side
```

**16s for `summary=1` and a 12-page/11,831-row client-side pull of `marketing_leads` on every load.** The
1000-row page size is the PostgREST cap, so this is 12 sequential round-trips. `bd_worklist&limit=5` taking
**8.2s to return five rows** points at an unindexed or view-heavy query path, not payload size. Logged as a
new workstream — see `connectivity-and-open-threads.md`.

Also visible in the same load: `[sales-comp xref] 44 price disagreement(s)` (already tracked as
`sales_price_xref_conflict` in dia `v_data_quality_issues`), and auth running in **dev-fallback** mode
(expected pre-enforcement; see `docs/AUTH_ENFORCEMENT_ROLLOUT.md`).

### 4.2d BROWSER RE-MEASURE, 2026-08-15 — and a claim of mine that did NOT hold

Driven directly in Scott's browser (Claude-in-Chrome) against the merged build `41e03651a6b9`, using the
Resource Timing API. Two consecutive loads, so cold-start is separated from steady state.

| Endpoint | Scott's original | Warm re-measure | Verdict |
|---|---|---|---|
| `/api/decisions?summary=1` | 16,199 ms | **10,100 ms** | **−38%** ✔ real improvement |
| `/api/operations?action=bd_worklist&limit=5` | 8,192 ms | **8,171 ms** | ❌ **NO CHANGE** |
| `/api/priority-queue?limit=5` | *(not captured)* | **5,776 ms** | ⚠ new find |
| `/api/review-counts` | 1,507 ms | 1,690 ms | ~flat |
| `action=cadence_dashboard&limit=200` | 1,526 ms | 1,488 ms | ~flat |
| wall-clock to last API | — | **13.9 s** | |

#### ⚠️ Retraction: the "4.2× faster bd_worklist" claim does not apply

I reported `v_lcc_bd_worklist` going 1,334 ms → 321 ms after the index + ANALYZE. That measurement was
real but **measured the wrong query shape**. I ran `LIMIT 5` with no `ORDER BY`, which short-circuits after
five rows. The handler runs `order=rank_value.desc.nullslast&limit=150`, and an ORDER BY forces the **entire
view to materialise** before the limit applies.

Measured properly, against the shape the handler actually uses:

| Query shape | Execution |
|---|---|
| `LIMIT 5`, no ORDER BY *(what I measured)* | **321 ms** |
| `ORDER BY rank_value LIMIT 25` | **18,561 ms** |
| `ORDER BY rank_value LIMIT 150` *(the handler)* | **19,320 ms** |

**The limit is irrelevant** — 25 and 150 cost the same. So the fix I was about to ship (shrink the handler's
`CAP` from 150 to ~3× the caller's limit) would have achieved **nothing**, and would have been my third
wrong claim on this endpoint. Measuring first is the only reason it didn't ship.

**The real cost is `SubPlan 2` — a correlated aggregate that runs 1,648 times**, once per candidate person,
each time re-running a `GroupAggregate` over ~3,681 organizations plus a full re-filter of the 15,981-row
`owner_link` CTE (`Rows Removed by Filter: 15981`, per loop). The index and ANALYZE did help — they fixed
the CTE's seq scan and the planner's row estimates — but they cannot fix a per-row correlated subquery.
That needs a **view rewrite**: hoist the owner→portfolio rollup out of the correlation and join it once.

Specified in `docs/claude-code/prompts/115-bd-worklist-view-correlated-subplan.md`. Not attempted here —
it changes a shared BD surface that My Day, the worklist and the home rail all read, and it deserves its own
dry-run rather than being tacked onto a perf pass I have already been wrong about twice.

**The honest scoreboard for the perf work:** `decisions?summary=1` genuinely improved (−6.1 s). The index +
ANALYZE are correct and durable but did not move the endpoint they were aimed at. `bd_worklist` and
`priority-queue` are still open, and now precisely diagnosed.

> **Superseded by §4.2e (2026-08-16).** `bd_worklist` is fixed at the DB layer (30,610 ms → 590 ms, three
> correlated subplans removed, 0-row equivalence diff); `priority-queue` was profiled and is **not** a SQL
> problem at all. The endpoint-level browser re-measure is still outstanding — see §4.2e.

### 4.2e PROMPT 115 — the bd_worklist view rewrite, and what priority-queue actually is (2026-08-16)

Migration `20260911120000_lcc_p115_bd_worklist_decorrelate.sql`, applied live to LCC Opps. **DB-only — the
CM/worklist surfaces read the view per request, so this needed no Railway redeploy.**

#### The diagnosis was right in shape, and understated in size

Re-verified first, with `ORDER BY rank_value DESC NULLS LAST LIMIT 150` (the handler's real shape — confirmed
by reading `getBdWorklist`: with no `&type=` filter `lccFilter` is empty and `CAP` is 150 even for `limit=5`).
It is **not one** correlated subplan but **three**, all in `v_lcc_contact_writeback_candidates`, each
re-executed once per candidate person (`loops=1648`):

| SubPlan | column | per-loop | × 1,648 | what it re-did every row |
|---|---|---|---|---|
| 2 | `sf_account_id` | 1.179 ms | ~1.9 s | full linear re-filter of the 15,981-row `owner_link` CTE |
| 3 | `rank_value` | 12.458 ms | **~20.5 s** | re-aggregated `v_entity_portfolio_all` (3,681 orgs) **and** the CTE re-filter — 8.99 M buffer hits |
| 4 | `rank_property_count` | 4.581 ms | ~7.5 s | HashAggregate over 42,245 orgs + the CTE re-filter |

A CTE scan cannot use an index, so each correlation is O(rows × CTE). The whole `cw` branch was 30,327 ms of a
30,598 ms Append.

#### The fix

Hoist both rollups out of the correlation: `portfolio` (a CTE over `v_entity_portfolio_all`, referenced twice
so Postgres materialises it once), `owner_roll` (one `GROUP BY ol.person_id` replacing the two correlated
aggregates), `owner_sf` (likewise). All three `LEFT JOIN` onto the candidate rows.

#### Measured — same session, same warm cache, same query shape

| | before | after |
|---|---|---|
| Execution time, `ORDER BY … LIMIT 150` | **30,610.6 ms** | **589.9 ms** (−98.1%, **51.9×**) |
| Buffers | shared hit=10,726,588 | shared hit=232,071 (**46× fewer**) |
| `cw` branch | 30,327 ms | 371 ms |
| `ch` branch | 269 ms | 212 ms (untouched) |
| any node with `loops=1648` | 3 | **0** |

Note the DB number is **session-variable** — the same shape measured 19,320 ms on 2026-08-15 and 30,610 ms on
2026-08-16 before any change. That is why before/after were taken back-to-back in one session. The durable,
non-variable facts are the structural ones: three `loops=1648` nodes gone, 46× fewer buffers.

#### Equivalence — 0 rows, both directions, multiset-strict

Snapshotted the pre-change output (5,054 rows) into `_bd_worklist_snap_p115`, then after applying:

```
old EXCEPT new = 0     new EXCEPT old = 0     old_rows = new_rows = 5054
rows_with_differing_multiplicity = 0      -- md5(row) group-by, since EXCEPT is set-wise
```

One semantic call worth recording: `sf_account_id` was `(SELECT … LIMIT 1)` with **no ORDER BY** — arbitrary
when a person reaches several SF Accounts. It is now `min()`. Checked before changing anything: of the 1,648
candidates, 54 reach an SF Account and **0** reach more than one, so this is byte-identical today and
deterministic from now on. (397 persons DB-wide do have multiple, but none are writeback candidates — they
already carry a salesforce Contact identity, which the `cand` NOT EXISTS filter removes.)

#### The `ch` branch was measured and deliberately left alone

`v_ownership_chain_worklist` is 269 ms of the 30.6 s (<1%). It does carry the `Seq Scan on entities` (60,678
rows) inside a HashAggregate the prompt flagged, but that scan is ~20 ms. Rewriting it would put risk on a
shared consumer for no measurable gain.

#### ⚠️ `/api/priority-queue` does NOT share this shape — the DB is not its problem

Profiled all three queries the handler issues. Full column list, real ORDER BY:

| Query | Planning | Execution |
|---|---|---|
| `v_priority_queue_enriched` items (all 37 cols, `limit=5`) | 47.6 ms | **248.7 ms** |
| `v_priority_queue_band_counts` (the chip row) | 45.1 ms | **131.5 ms** |
| `attachPqOppState` | one `bd_opportunities` read for 5 ids | trivial |

Items and band-counts run in `Promise.all`, so the DB floor for the endpoint is roughly **~250 ms** — against
a browser-measured **5,776 ms**. The view's laterals do run per queue row (`loops=1150`) but they are
index-driven and bounded by queue size, not by re-aggregating a large view, which is precisely what made
`bd_worklist` quadratic. **There is no correlated-subplan fix to make here.** The residual ~5.5 s is handler +
transport (authenticate, then cross-region PostgREST round trips), which §"Out of scope" of prompt 115 calls
architectural. Anyone picking this up next should start there, not in SQL — the R7 Phase 0 cache already took
the view itself from 5,785 ms to ~1,140 ms and it is now a fifth of that again.

#### ⚠️ NOT re-measured in the browser — this needs Scott

The one deliverable I could not complete. This sandbox's network policy denies the Railway host at the proxy
(`403 to CONNECT tranquil-delight-production-633f.up.railway.app:443`), so neither curl nor the bundled
Chromium can reach the live endpoint. **The DB number has already proved misleading on this endpoint once, so
treat the 51.9× as a DB result, not an endpoint result, until the browser confirms it.** Same method as §4.2d
(Claude-in-Chrome + Resource Timing, two consecutive loads to separate cold start):

```js
copy(JSON.stringify(performance.getEntriesByType('resource')
  .filter(e => /bd_worklist|priority-queue|decisions\?summary/.test(e.name))
  .map(e => ({ url: e.name.split('/api/')[1], ms: Math.round(e.duration) })), null, 2))
```

No deploy is required first — the migration is already live, so a hard reload measures the fixed view.

### 4.3 One command that resolves UI-0 and UI-1

Run in the browser console with a property panel open, and paste the output:

```js
copy(JSON.stringify({
  innerWidth: innerWidth,
  dualCapable: innerWidth >= 1180,
  primaryVar: getComputedStyle(document.documentElement).getPropertyValue('--panel-primary-w').trim(),
  panelRealWidth: document.getElementById('detailPanel')?.getBoundingClientRect().width,
  panelDisplay: document.getElementById('detailPanel')?.style.display,
  resizerExists: !!document.getElementById('panelResizerPrimary'),
  resizerOpen: document.getElementById('panelResizerPrimary')?.classList.contains('open'),
  resizerRect: document.getElementById('panelResizerPrimary')?.getBoundingClientRect(),
  trayExists: !!document.getElementById('panelTray'),
  bound: !!document.getElementById('panelResizerPrimary')?._pwBound,
  activePrimaryKind: window._activePrimaryKind,
}, null, 2))
```

`resizerExists:false` ⇒ stale `index.html` (cache-bust / redeploy). `resizerOpen:false` ⇒ the
`_panelSyncResizers` gate. `resizerRect` far from the panel's left edge ⇒ the var/actual-width mismatch.

---

## 5. Environment constraint discovered while shipping this (read before any git work)

**The Cowork sandbox mount denies `unlink` on the repo (rename is allowed).** Verified 2026-08-15:

```
$ touch .git/_deltest && rm -f .git/_deltest
rm: cannot remove '.git/_deltest': Operation not permitted
$ mv .git/_deltest .git/_to_delete/…      # succeeds
```

Consequences, all of which had been quietly accumulating:

- Git cannot delete `index.lock` / `HEAD.lock` after an operation that **rolls the lock back** (e.g. `git
  status` refreshing the index). The stale lock then blocks the *next* command → the "git lock" error.
  `.git/_to_delete/` holds **31** swept locks going back to 2026-07-31; `.git/objects` holds **812** orphan
  `tmp_obj_*` files. Both are debris from this, not corruption.
- Operations that **commit** the index are fine — git finishes with `rename(index.lock, index)`, and rename
  works. So `git add` / `git commit` succeed (with noisy `unable to unlink` warnings); read-only commands are
  what leave the litter.
- `core.hooksPath` was pinned to a **dead session mount**
  (`/sessions/charming-blissful-clarke/...`), so every command printed an ignored-hook warning. **Unset**
  2026-08-15 → falls back to `.git/hooks`.
- There are **no git credentials** in the sandbox, so `git push` cannot run from here.

**Standing rule:** run git **writes and pushes from Windows** (PowerShell / VS Code), where unlink works and
credentials exist. From a Cowork session, sweep stale locks first:

```bash
for f in $(find .git -maxdepth 3 -name '*.lock' -not -path '*/_to_delete/*'); do
  mv "$f" ".git/_to_delete/$(basename $f).$(date +%s%N)"
done
```

Periodic cleanup, from Windows:

```powershell
Remove-Item -Recurse -Force .git\_to_delete, .git\_lock_backup_*
Get-ChildItem .git\objects -Recurse -Filter 'tmp_obj_*' | Remove-Item -Force
git gc --prune=now
```

---

## 6. How to keep this file honest

1. **A design change adds a row here in the same commit** — target state in the redesign doc, evidence here.
2. **Prefer an executable check.** A manual step is a temporary admission that we haven't automated it.
3. **Re-run §3 whenever a feeder ships** (owner reconciliation, contact acquisition, cadence advance) and
   update the counts in place with the date. The point of §3.3 is that the numbers move.
4. **Record the failures.** §1 exists because two defects survived a careful review and died to a test; that
   is the argument for writing the test, and deleting the record would delete the argument.
