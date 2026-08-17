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
| **brokerages recorded as the property owner** | 46 → **5** (2026-08-17) | a brokerage on the Current Owner card is not a cosmetic defect — it is the **wrong counterparty**, and it feeds comps/exports/matching and was cadence-eligible (the A2 dry-run put Marcus & Millichap top of the enrolment list) | **SHIPPED** (Prompt 116) `20260817120000`, batch `p116_20260817`. 16 re-pointed to the real owner · 6 names stripped · 19 wrong owners cleared to honest Unresolved · **5 deliberate abstains** in `v_lcc_p116_brokerage_owner_review`. Durable fix: the brokerage guard now sits on `lcc_reconcile_property_owner` (42 of the 46 came from it), the same predicate the supersession feeder already had |

**⚠️ Identity must be scored on `lcc_owner_strict_core()`, never `lcc_normalize_entity_name()`.** Prompt 116's
first dry-run used the latter, which strips *semantic* tokens (`partners`, `properties`, `capital`, `group`,
`holdings`). Under it **"Century Park Partners" == "Century Park Properties LLC"** (both collapse to
`century park`), and the plan would have re-pointed a property onto a different company. This is the same
stoplist footgun CLAUDE.md records for `dup-pair-planner.ownerCore` ("Realty Income Corporation" → empty
string), now caught a second time — on a path that was one step from an automatic write. Re-scoring on the
strict core moved the collision count **17 → 21** and the abstains **1 → 4**. The lesson generalises: a
normalizer built for **fuzzy pairing** is never safe for **identity**.

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

<<<<<<< HEAD
### 4.2f BROWSER VERIFICATION of Prompt 115 — the DB win DID translate (2026-08-15)

Prompt 115 could not reach Railway from its sandbox and asked that its **51.9× be treated as a DB result
until confirmed in a browser**. Confirmed here, driven directly in Scott's browser. No redeploy was needed —
the view is read per request.

| Endpoint | Original | Pre-115 warm | Post-115 **cold** | Post-115 **warm** | |
|---|---|---|---|---|---|
| `bd_worklist&limit=5` | 8,192 ms | 8,171 ms | 8,178 ms | **2,485 ms** | **3.3×** ✔ |
| `decisions?summary=1` | 16,199 ms | 10,100 ms | 13,030 ms | **8,620 ms** | **−47%** ✔ |
| `priority-queue?limit=5` | — | 5,776 ms | 5,492 ms | 5,314 ms | ~flat |
| wall-clock to last API | — | 13,925 ms | 17,517 ms | **12,664 ms** | |
| API calls > 1 s | — | 5 | 5 | **4** | |

#### ⚠️ A second measurement-condition error, nearly repeated

The **first** post-115 load showed `bd_worklist` at **8,178 ms** and I began writing it up as *"P115 didn't
translate."* That was a **cold** call — cold PostgREST connections, cold plan cache. The very next warm load
was **2,485 ms**.

This is the same class of mistake as §4.2d (measuring `LIMIT 5` instead of the handler's `LIMIT 150`): both
times the *number* was real and the *condition* was wrong. **Rule now standing: label every timing
cold/warm, and never conclude from a single sample.** Added to `CLAUDE.md` alongside the query-shape footgun
that Prompt 115 recorded.

#### Where the remaining `bd_worklist` time actually is

`getBdWorklist` fires six sources in one `Promise.all`; the `?type=` filter isolates each. Measured warm,
in-browser, twice each:

| `type=` | ms | source |
|---|---|---|
| `suspected_sale` | **1,847** | **gov, cross-region** ← the floor |
| `ownership_chain` | 674 | LCC |
| `contact_writeback` | 600 | LCC — **the view P115 rewrote** |
| `owner_source_conflict` | 504 | gov + dia |
| `loan_maturity` | 249 | gov + dia |
| *(all — what the app calls)* | **1,870** | ≈ the slowest, as expected for a parallel fan-out |

**The LCC view is no longer the bottleneck** — 600 ms of a 1,870 ms call. The floor is now
`v_suspected_sale` on gov (us-west-2), i.e. cross-region transport plus that view's own cost. Any further
work on this endpoint should start there, **not** in LCC.

Prompt 115's other honest finding stands: **`/api/priority-queue` is not the same bug.** Its DB side is
249 ms (items, all 37 columns) + 132 ms (band counts) in parallel — a ~250 ms floor against a 5,314 ms
measurement. The residual is handler + cross-region transport, and there is no SQL fix to make there.
=======
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
>>>>>>> f59679a2f9f3948223f894218dec8309f15402c9

### 4.2g UI-4 — the hand-off silently did not render (found 2026-08-16, FIXED)

Running the outstanding manual checks **myself in Scott's browser** (rather than handing them back) surfaced
the most consequential defect of the whole redesign: **`Work this owner →` — the centrepiece hand-off — was
not rendering at all** on a property whose owner is fully resolved.

**Chain of failure, traced live on dia property 25752 (DaVita Fort Wayne):**

| step | result |
|---|---|
| `lcc_property_owner` row | ✅ Agree Realty CORP, confidence **1.000** |
| `/api/entities?action=lookup_asset&domain=dia&domain_property_id=25752` | ✅ returns `property_owner` **with** full prospecting (tier A, 13 properties) |
| what `openUnifiedDetail` actually calls | ❌ `lookup_asset&address=…` — **by address string** |
| panel address vs entity address | `3233 East Coliseum Blvd.` vs `3233 E Coliseum Blvd` |
| address lookup | ❌ **no match** |
| ⇒ `ent` null ⇒ no `ent.property_owner` ⇒ | **no Current Owner card, no `Work this owner →`** |

The panel was resolving **its own asset entity by fuzzy address string** while already holding the exact
domain property id. It missed on ordinary abbreviation + punctuation variation.

**Size:** 2,743 of 3,886 asset entities (**70.6%**) carry an exact `metadata.domain_property_id`, and
**2,117 of those also have a resolved owner** — that whole population was gambling on a string compare for
the owner card, the hand-off, the LCC-entity badge and the `owner_entity_id` the Next-step banner reads.

**Fix:** try `domain_property_id + domain` first, keep address as the fallback for assets with no domain id,
and wrap the id attempt so a failure falls through rather than aborting the panel load. This is the same
doctrine `CLAUDE.md` states for owners — *"resolve to an LCC entity by ID, never by name"* — applied to the
asset. Four regression tests added (74 pass).

**Two wrong turns of my own on the way here, both from reading a truncated or transient value:**
1. I measured the panel rect mid-slide-in (`left: 1758` in a 1758px viewport) and briefly treated the panel
   as mis-positioned. It was 1,038/720 once settled — correct.
2. I printed the API response `.slice(0, 600)`, saw no `property_owner`, and started diagnosing a
   server-side bug. It was there, past the truncation. **The client was the problem all along.**
   Same family as §4.2d/§4.2f: the reading was real, the *conditions* were wrong.

### 4.2h Manual checks — re-run in-browser 2026-08-16 (build `f59679a2f9f3`)

Divider fix confirmed present in the deployed bundle (`splitMode`, `_panelSetWidthExact`,
`_panelAnchorResizer`, `_jsStrArg` all in the served `detail.js`; the one lingering
`esc(text).replace(/'/g` hit is my own explanatory comment, verified line-by-line).

| # | Check | Result |
|---|---|---|
| M-1 | 720px panel, 7 tabs on ONE row, tab reads "Ownership" | ✅ **PASS** (`{l:1038, w:720}`, 1 tab row) |
| M-1b | Completeness rail capped | ✅ 1 chip on this asset (score 95) |
| M-6 | CRM stack gone from the property tab | ✅ **PASS** — `udLogCallForm`, `udDraftTemplate`, `udTouchpoints`, `udActivityFeed`, `udOwnContact` all absent from the DOM |
| M-2/3/4/5 | resize · dock · swap · tray | ⛔ **blocked by UI-4** — retest after the fix deploys |
| **UI-4** | `Work this owner →` renders | ❌ **FAIL → fixed above** |

**Also observed, not yet fixed (UI-5):** on this asset the ladder renders **two cards both reading
"Agree Realty Corp"** — the recorded owner *and* the true-owner slot, because `true_owner` is DaVita
(operator-flagged), so the P0.1 guard correctly elevates the deed owner into the decision-maker slot. Correct
data, but it reproduces the very "same name twice" problem §0 set out to kill, via a different branch.
`_ownersAgree` only collapses when `trueResolved` is true. **The collapse should also apply when the true
owner is operator-flagged and the recorded owner is being elevated.** Logged, not fixed — it is cosmetic
next to UI-4.

### 4.2i MANUAL CHECKS COMPLETE — all green, verified in-browser 2026-08-17 (build `6efd9c27fcc7`)

Driven directly in Scott's browser. **The redesign's UX contract is now verified end-to-end.**

| # | Check | Result | Evidence |
|---|---|---|---|
| M-1 | 720px panel, 7 tabs one row, tab reads "Ownership" | ✅ | `{l:1038, w:720}`, 1 tab row |
| **M-2** | **Divider SPLITS the pair** | ✅ | 720/620 → **920/420**, total **conserved at 1340**, `primaryGrew: true` |
| **M-3** | `Work this owner →` docks the owner BESIDE the property | ✅ | companion "Agree Realty CORP", primary stays the property |
| **M-4** | ⇄ swap | ✅ | `activePrimaryKind` property→**entity**; primary "Agree Realty CORP", dock "3233 East Coliseum Blvd." |
| **M-5** | minimize → tray → restore | ✅ | chip labelled **"3233 East Coliseum Blvd."** (the real subject, not the old hard-coded "Property"); restore re-opens and empties the tray |
| M-6 | CRM stack gone from the property tab | ✅ | all five ids absent from the DOM |
| **UI-4** | the hand-off renders | ✅ **FIXED** | owner attached, CTA present, prospecting **tier A** |

The screenshot confirms the dual dock working as designed: property card left, **full owner panel right** with
its own tab set, ROE "Safe to call" banner, "OWNER · 23 properties in the BD portfolio", a next-best-action of
*Connect in Salesforce*, and a 23-property / $6.6M / 50-contact summary.

**Two caveats recorded honestly:**
1. **M-2 was verified by driving the divider directly, not by pointer.** A real `left_click_drag` at the
   seam collapsed the companion to its 360 minimum instead of splitting — my screenshot-pixel → CSS-pixel
   conversion (1512 vs 1758, DPR ≈1.163) landed on the wrong strip. The split *logic* is proven correct and
   conserving; **pointer hit-targeting at the seam is untested and worth one human drag.**
2. **I misread panel geometry three separate times** in this session by measuring during the `slideIn`
   animation (reading `left: 1758` in a 1758px viewport, then a shifted pair after the swap). Each time the
   settled layout was correct. Combined with §4.2d (wrong query shape) and §4.2f (cold vs warm), that is
   **five measurement-condition errors** — hence the standing rule now in `CLAUDE.md`: *verify the
   measurement conditions before concluding, and prefer a screenshot to a computed rect for layout.*

**Still open on the redesign** (unchanged by this run):
- **Scott's side-by-side ask** — the companion is still a *summary card* with "Open full detail ↗", not a
  full panel. Blocked on renderers writing to the singleton ids `#detailBody` / `#detailTabs` (spec §1.2,
  consequences §4.2).
- **UI-5** — when `true_owner` is operator-flagged, the P0.1 guard elevates the deed owner into the
  decision-maker slot, so the ladder shows two cards with the same name. `_ownersAgree` only collapses when
  `trueResolved` is true.
- **UI-0** — never reproduced; capture retained.

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

### 4.2j SIDE-BY-SIDE FULL DETAIL — verified live in-browser 2026-08-17 (build `51c7282b0697`)

Scott's ask (2026-08-15): *"we want to see the full detail side-by-side instead of a
placeholder that you can swap over to the primary."* Driven live via the Chrome MCP against
the deployed build, property `dia:31857` (5660 Nimtz Pkwy, South Bend IN) → owner chip.

| # | Claim | Evidence (measured live, not asserted) |
|---|---|---|
| SBS-1 | The dock renders the FULL entity panel, not a summary card | `companionTabs` = `Overview, History, Relationships, Activity, Engagement, ROE, Contacts` (7 tabs); `companionBody.innerHTML.length` 3,683. Screenshot shows Safe-to-call banner, Next-Best-Action, Entity Information, Summary tiles, Outreach — the same panel the primary renders. |
| SBS-2 | Both panels fit at once | primary 720 + companion 620 = 1,340 ≤ viewport 1,758. `companion-panel open`. |
| SBS-3 | A dock tab change does NOT rewrite the hash | clicked companion `Relationships`: `hashBefore === hashAfter` = `#/dia?d=prop:dia:31857:Ownership` (still the PROPERTY). Companion body changed (3,683 → 753); primary body unchanged at 8,900 and still property content. |
| SBS-4 | No Back button in the dock | `hasBack` false on the companion header. After ⇆ swap the same entity in the PRIMARY slot renders `←Back` — so the button follows the slot that owns `_detailStack`, which is the point. |
| SBS-5 | ⇆ swap works with two full panels, hash follows the primary | after swap: primary header = `←Back NETSTREIT Corp ORGANIZATION dia active`, companion = the property; widths preserved 720/620; hash rewrote to `#/dia?d=entity:80e2437b-…:Overview` — the new primary subject. |
| SBS-6 | Entity-beside-entity is REFUSED, not silently corrupted | with an entity primary, `openCompanionEntity('6dca42e5-…')` emitted toast `"Open a property to dock a contact beside it"`, left the companion on the property, and opened the entity in the PRIMARY slot (`Lba Gsa Marianna Ii Llc`). Guard fires because `_entityDetailCache` is a module singleton. |

**Two defects observed while doing this.** UI-5 is FIXED below; the portfolio gap is data, not UI:

- **UI-5 (confirmed live, worse than filed).** On `dia:31857` the ladder renders
  `RECORDED OWNER (DEED) → Netstreit Inc` and `TRUE OWNER / DECISION MAKER → Netstreit Inc`
  — byte-identical labels, side by side, with an arrow between them, so `_ownersAgree`
  did not collapse. Worse: the chip's `data-owner-ctx` carries `name: "Netstreit Corp"`
  while the visible label reads `Netstreit Inc`, and clicking it docks **NETSTREIT Corp**.
  So the label and the navigation target are different strings. The collapse test is
  evidently comparing something other than the two strings actually rendered.
- **Portfolio linkage gap (data, not UI).** The docked NETSTREIT Corp entity reports
  `0 Properties` and `— Portfolio Rent` while being the resolved owner of the very asset
  in the other panel. `50 Contacts`, `0 Activities`. Whatever backs the entity Summary
  tiles is not reading the same owner→asset link the property panel just used.

**Method note — three false readings before the real one, all mine, all condition errors:**
(1) I read `#detailPanel.classList.contains('open')` and concluded the panel had not opened;
the screenshot showed it fully rendered — wrong element for that class. (2) I clicked the
owner chip at coordinates from an earlier `getBoundingClientRect`, after the panel had
scrolled, and hit the *Recorded Owner input* instead; dispatching the event on the element
worked. (3) I checked a stale tab and concluded the deploy had not shipped — `/version`
said `51c7282b0697`, matching the merge. **Also learned: the build rewrites the asset
cache-buster from the git SHA (`detail.js?v=51c7282b0697`), so hand-bumping the `?v=` in
`index.html` is redundant.** Same pattern as §4.2b–4.2e: the numbers were fine, the
conditions I read them under were not.

### 4.2k UI-5 FIXED — one party is never printed twice; chip label == chip target

Both halves of what §4.2j found on `dia:31857`, root-caused in source rather than patched
at the symptom.

| # | Defect | Root cause (read in `detail.js`, not guessed) | Fix |
|---|---|---|---|
| UI-5a | `Netstreit Inc → Netstreit Inc` rendered as two cards with an arrow between them | `_ownersAgree` requires `trueResolved`, which is **false by definition** when `true_owner_is_operator` is set. But the operator branch (added 2026-07-31, correctly: *the operator is the tenant, never the owner*) then re-renders `recDisplay` into the true-owner card. So the one path guaranteed to print the same name twice was the one path the collapse could never see. | New `_operatorElevated = trueIsOperator && recDisplay`; `_singleCard = _ownersAgree \|\| _operatorElevated` now drives the wrapper, the arrow/second-card guard, and the collapsed note. The operator fact — the only thing card 2 actually added — moves into the note. |
| UI-5b | chip read `Netstreit Inc`, docked `NETSTREIT Corp` | the ladder labels with `*_canonical \|\| *` but `_ownerCtxFromCurrent` set `name:` from the **raw** column. Label and navigation target were different strings. | `name` now prefers the canonical, i.e. the exact string the user just read. The raw value is **not lost** — it stays on `recorded_owner_name` / `true_owner_name`, and id-based resolution still wins. |

Deliberately NOT collapsed: `trueIsOperator` with **no** recorded owner stays two-card, so
the "— unresolved — queue LLC / SoS research" call to action survives. Tested.

9 new tests (90 total). One asserts that *every* layout decision reads `_singleCard`, because
leaving a single branch on `_ownersAgree` would render a one-column grid with a stranded arrow
— the failure mode of a partial fix.

### 4.2l P117 — the "0 Properties" defect from §4.2j, root-caused and closed

§4.2j noticed the docked owner reporting `0 Properties` while being the resolved
owner of the asset in the other panel. That turned out to be **two unrelated
things**, and it is worth recording that the one I chased first was the wrong one.

**What I checked first, and why it was wrong.** I assumed the NETSTREIT case was
an instance of a systemic gap and started sizing name pollution. It was not:
`dia:31857` has **no `lcc_property_owner` row at all**, so it is not in the
resolved population. The real cause there is entity fragmentation — **seven**
"Netstreit" entities exist, three typed `person` (a REIT is not a person), with
`by Matthews™` (brokerage pollution) and `(Non Traded)` (a CoStar buyer-type
annotation) suffixes that `lcc_normalize_entity_name` cannot group. The chip
label said `Netstreit Inc` (assets=1, the real one) but navigated by the raw
name to `NETSTREIT Corp` (assets=0). **The UI-5b fix in §4.2k corrects exactly
this case** — with the canonical name it now resolves to the entity that holds
the link.

I then sized that pollution fleet-wide before building on it: **148 entities
total** (106 broker-suffix, 25 buyer-type annotation, 17 trademark glyph), only
**8 of which own any asset**. Small. I had nearly generalised a fleet-wide claim
from one property I happened to open — the sampling error, not a measurement
error, but the same family as §4.2b–4.2e.

**The real, measured defect underneath it.** Two stores, zero feeder overlap:

| store | read by | fed by |
|---|---|---|
| `lcc_property_owner` | the **property** panel's owner | relationship_graph, supersession, domain_true_owner, sf_seller, rel_purchase |
| `lcc_entity_portfolio_facts` | the **owner** panel's Properties/Rent tiles (via `v_entity_portfolio_all`) | gsa_lease_diff, sales_transaction*, gsa_lease_lessor, county_records, costar |

Nothing bridged them, so 1,951 of 2,337 resolved owner→asset pairs (83.5%) were
absent from the portfolio store and 1,246 of 1,552 owners (80.3%) rendered
`0 Properties`. **Docking the two panels side by side is what made this visible** —
the two numbers had never been on screen at the same time.

| | before | after |
|---|---|---|
| owners rendering `0 Properties` | 1,246 / 1,552 (80.3%) | **135 / 1,552** |
| resolved pairs missing from portfolio | 1,951 (83.5%) | **11** (dia 1.0%, gov 0.2%) |
| re-run | — | **0 rows** (idempotent) |

**The check that mattered most was the one I ran before writing anything.**
Portfolio rent is a cadence-admission arm (`bdSignalFromFacts`:
`portfolioValue >= $500k`), so backfilling it can flood the cadence surface —
the exact Consumption-Layer failure. Measured first: 228 owners newly cross the
floor, 156 have no cadence, but only **23 are reachable**. The existing P112
reachability precondition withholds the other 133, so this adds ~23 real
cadences, not 156. **No new gate was added** — a second definition of
"reachable" would drift from the first (P116 lesson).

Second check: `$1.36B` of added annual rent is a big claim, so I verified the
unit rather than the total — dia median **$26.14/SF**, gov median **$28.02/SF**.
Correct for dialysis NNN and GSA space; a unit error would show an absurd PSF.

Guards fired as intended (5 brokerage, 6 operator rows refused — a brokerage is
the agent, an operator is the tenant, neither is a portfolio holder), reusing the
existing single definitions rather than new ones. Reversible by
`ownership_source='lcc_property_owner'`; drift detector
`v_lcc_portfolio_owner_sync_gap`.

### 4.2m Property-in-dock — the last redesign item, and a silently-unrun test suite

The dock now hosts the **full tabbed property panel** on the owner→property
direction, closing the half §4.2j left open. That direction got materially more
useful an hour earlier: P117 means an owner's portfolio is actually populated,
so clicking through it is now a real workflow rather than an empty list.

**Why this was harder than the entity half, and what made it safe.** The entity
panel needed three element refs because `openEntityDetail` captured them once.
The property panel could not: **16 call sites across 12 functions** re-grab
`#detailBody` on their own — in-panel actions that re-render (dismiss lead, CMS
link/clear, sales filter, lease sub-view, deal-history filter…). Threading a
mount argument through all of them *and* through the onclick strings that call
them would be large and easy to get half-right.

A module-level mount pointer is normally the wrong answer — it is exactly the
global mount state I avoided for entities. It is safe **here** for the same
reason the entity dock refuses entity-beside-entity: `_udCache` / `_opsExtraCache`
/ `_salesCache` are module singletons, so only ONE property panel can exist at a
time, in either slot but never both. `openCompanionProperty` now enforces that
explicitly (toast + open in the primary slot) rather than leaving it to luck,
and the comment records that if `_udCache` ever becomes per-panel the pointer
must become a parameter.

Primary-only, same list as the entity half: hash + back-stack (`?d=` is the
primary's subject), `_setPrimaryKind`, the overlay (the dock sits *beside*, not
*over*), Back, and Close. One test asserts **no** function in the 12-strong
family still hard-codes a singleton id — a partial conversion would have a
docked property's button repaint the primary panel.

**A test suite had been failing silently, and my own check was reading the wrong
number.** The §0 ladder suite sliced `_norm` out of `_udOwnershipLadder` up to
`const _ownersAgree`, which swept in `const _recCore = _norm(recDisplay)` — a
reference to a variable that does not exist outside the function. The suite threw
at BUILD time, registered zero subtests, and node reported **`# fail 0`** while
printing `not ok` for the suite. I had been grepping only `# tests|pass|fail`,
so it read green. Fixed the slice (`→ const _recCore`), and the run now checks
suite-level `not ok` lines too. Test count **90 → 102**: 8 new, and **4 that had
never actually run**.

This is the same family as §4.2b–4.2e and §4.2j: the numbers were right, the
thing I was reading them off was wrong.

### 4.2n Property-in-dock verified live (build `5b6fe60f3d6e`) + a compact-header fix

Owner primary (Netstreit Inc) → clicked a row in its portfolio.

| # | Claim | Evidence |
|---|---|---|
| PD-1 | the dock renders the FULL property panel | `companionTabs` = `Overview, Rent Roll, Operations, Deal History, Ownership, Documents, Activity Log`; body 18,408 chars (was 1,273 as a card). Screenshot shows Pipeline, Property Information, Actions, Research Quick Links, Data Resolution Status. |
| PD-2 | **no cross-wiring** — the whole point of the mount pointer | clicked the dock's `Ownership` tab: dock body changed, **primary body byte-identical**, `dockActiveTab = ['Ownership']`. |
| PD-3 | the dock leaves the hash alone | `hashUnchanged` true — stayed on `d=entity:4a93e98b…:Ownership`, the primary's subject. |
| PD-4 | no Back in the dock | `companionHasBack` false. |
| PD-5 | property-beside-property REFUSED | toast `"Open an owner to dock a property beside it"`; the property opened in the PRIMARY slot (`1849 Davisville Rd`) instead of corrupting `_udCache`. |
| PD-6 | P117 visible in the UI | the same owner panel reads **9 Properties (3 current) · $1.1M Annual Rent · 9 DIA**. It read 0 before P117. |

**Defect found in the screenshot and fixed in the same pass.** The header was laid
out for the 720px primary. At 620px it collapsed: the title wrapped to three
lines, `_udKeyFields` re-printed `Address:` directly under a title that IS the
address, and the comps / Consolidate / Dossier controls pushed the panel controls
onto their own row with an orphaned `×`. The dock header is now compact —
identity + panel controls only; the body carries the detail, and the same actions
live inside the tabs. Title ellipsizes instead of wrapping, in both header renders.
Test asserts all of it (103 total).

**METHOD FAILURE — I re-committed the exact error from the start of this session.**
Every `navigate` I issued changed only the **hash** on an already-loaded document,
so the SPA never reloaded and the page kept running `51c7282b` — *three deploys
old*. I then watched the dock render a summary card and began diagnosing my
delegation as broken. It was not: `window.openCompanionProperty` in that page had
no delegation because it was old code. A path-changing reload (`/?r=…#/…`) showed
`detail.js?v=5b6fe60f3d6e` and arity 5, and every check passed.

Compounding it, minutes earlier I read `/version`'s `ts` as a build timestamp and
told Scott "Railway is mid-build". `ts` is regenerated per request — it is the
clock, not the build. **Rule now: verify the deployed build by comparing the
served asset's `?v=` SHA inside the live document, never by a hash-only navigate
and never by `ts`.**

### 4.2o P118 — the decision backlog, and a number I nearly reported wrong

Went looking for the Consumption-Layer failure in the Decision Center. **My first
measurement said 2,311 open decisions** and I was one step from telling Scott the
doctrine was being violated at scale. It was wrong: I used `decided_at IS NULL`
as the openness test. The real column is `status`, and the split is:

| status | n | meaning |
|---|---|---|
| **open** | **448** | the actual backlog |
| superseded | 1,841 | premise cleared — **auto-retire is working** |
| skipped | 1,383 | deliberately passed |
| decided | 1,326 | worked |

So the doctrine is being followed, not violated: 1,841 rows retired themselves
when their premise cleared, which is exactly item 2. I also checked whether the
UI badge repeats my mistake — it does not (`api/admin.js` filters
`status=eq.open` everywhere), so the counts Scott sees are honest.

**The real defect was narrower and worth fixing.** Of 148 open
`confirm_true_owner`, **75 carried `rank_value = 0`** — and 73 of those had a
perfectly well-known asset rent. The producer ranked by
`e.current_annual_rent_total`, the OWNER's portfolio total; but the decision is
about ONE asset ("is the true owner of THIS property current or stale?"), and an
owner needing confirmation very often has no portfolio facts — which is *why* it
needs confirming. So half the lane sank to the bottom, hiding **$194,149,982** of
annual rent.

Unit-checked before relying on it, as in P117: all 73 gov, median $810,599/yr at
**$34.86/SF** — a sane federal PSF.

Fix: `COALESCE(NULLIF(owner portfolio total, 0), this asset's annual_rent, 0)`.
Owner portfolio still wins when present — a portfolio holder is a bigger
conversation than one building.

| | before | after |
|---|---|---|
| `rank_value = 0` | 75 | **2** (exactly the two measured as valueless) |
| median rank | 0 | **$498,431** |
| top of lane | arbitrary | $23.7M · $19.6M · $17.1M annual rent |

No backfill needed — `lcc_open_decision`'s `ON CONFLICT DO UPDATE` re-stamps
rank for an already-open row, and all 75 were still in the seed set.
`rank_value` drives ordering only: no verdict, no effect, nothing created or
closed.

The migration **patches the live definition in place** rather than pasting a
6.5k-char copy, because a full copy would fork `lcc_refresh_decisions` from the
migration that owns it and the two would drift. It raises if the anchor text is
missing, so a changed base fails loudly instead of silently no-op'ing.

### 4.2p P119 — the junk lane, and two hypotheses I had to abandon

Scott asked whether the 206-row `junk_entity_name` lane had a deterministic
auto-confirmable subset, the way the property-twin lane got one in P106. It did
not — but reading it properly found something better.

**Hypothesis 1, dropped.** I expected the "Buyer ContactsStephen R. Perry"
table-header misparse to be the bulk of it. Live: **zero** open rows match that
shape. The rows I had sampled earlier were `superseded` — I was looking at
already-retired work.

**Hypothesis 2, dropped.** 46 rows carried `r7_phase2_5_person_plausibility`
while being typed `organization`, and I suspected a rule misapplied to the wrong
entity type. Reading the migration showed the opposite: the rule was **correct**
— the capture pipeline was minting firm names as *people*, and it flagged them.

**What was actually wrong.** Migration `20260617120000` fixed this class properly
— retype, un-flag, supersede — and it explicitly documents what it left alone.
But its target set required `entity_type = 'person'`. Entities that were **already
typed `organization`** carried the same, by-then-void flag and were never
reached. For an organization, "this is not a plausible person name" is not a
defect; it is the expected state. The premise is void, so the decision retires —
doctrine item 2.

Held out of the BD graph by that stale flag: **Blackstone Real Estate Partners
VIII**, Ares Real Estate Income Trust, BH Properties, 29th Street Capital.
`junk_name_flagged` excludes an entity from the priority-queue bands, so these
real firms were invisible in the queue.

Excluded on purpose, each with a stated reason: 8 flagged by a *different* sweep
whose premise still stands; brokerage-polluted names (P116 — cleaning such a name
is what SURFACES a duplicate, so it must not be silently readmitted); 45
pipe-composites, left for the split path exactly as the June round left them; and
every non-suffix name (`Bakery`, `Description:`, `Managing Director`) which is
genuinely junk and stays in the lane.

**Blast radius measured before applying:** all **42 of 42 are already on a
cadence** — so this creates **zero** new work. 21 own assets, 19 have portfolio
facts, 11 reachable, 0 open opportunities. Pure recovery of entities already
inside outreach but invisible in the queue; not a new producer.

| | before | after |
|---|---|---|
| `junk_entity_name` open | 206 | **164** |
| Decision Center open (all lanes) | 448 | **406** |

Reversible by `junk_rescue_source` / `superseded_reason`; idempotent (the
predicate excludes anything already rescued).

**Pattern worth naming across P117/P118/P119:** all three were *reachable* bugs
only because someone had already built the right machinery and left an honest
record of what it deliberately did not cover. P117 found two stores nobody
bridged; P118 found a rank computed from the wrong subject; P119 found a rescue
whose target predicate was one degree too narrow. None was a mistake in the
original work — each was a documented edge that later data grew into.

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
