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

*Queried LCC Opps `xengecqvemvfknjvbvrq`, 2026-08-15. Read-only.*

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
--
-- reachable_hero  = what the owner panel hero actually reads. QUOTE THIS ONE.
-- reachable_graph = additionally counts a linked person carrying contact detail.

-- the value-ranked population any owner-contact feeder is measured against
SELECT count(*) FROM public.v_lcc_owner_unreachable_worklist;
```

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
| assets with a resolved owner | 35.9% | gates the whole hand-off | owner feeders (P0.2 own-deal buyer, P0.3 county deed) |
| owners the hero can reach (`reachable_hero`) | 8.1% → **13.3%** (2026-08-15) | **the binding constraint** on the redesigned flow | BREAK-1: `owner-contact-propagate-tick` shipped (+36); the rest needs the review lane drained + the c360 fold-in |
| hero-vs-graph gap (reachable but invisible) | **54 owners** | a defect, not a data gap — `buildContact360` never folds a linked person's contact detail into `subject` | open |
| cadence rows ever touched | **9%** | a strip that always says "overdue" trains you to ignore it | consumption layer — auto-retire + reality-driven advance |
| cadence rows with a rep | 0.4% | ROE line on the owner card is blank | upstream producer stamp (documented; backfill is a dead end) |

---

## 4. Manual checks (need a browser)

Not automatable in this repo today; run once after the redeploy and initial the date.

| # | Step | Expected | Done |
|---|---|---|---|
| M-1 | Open a dia comp → property panel | Panel is ~720px; the 7 tabs sit on **one** row | ☐ |
| M-2 | Drag the strip on the panel's left edge | Width follows the cursor; reload keeps it; double-click resets to 720 | ☐ |
| M-3 | Ownership tab → click the owner chip | Owner opens in the **companion dock beside** the property, not over it | ☐ |
| M-4 | Press **⇄** in either header | Owner becomes the wide panel, property drops to the dock, both keep their subject | ☐ |
| M-5 | Press **–** on the companion, then open a different owner | First owner is a chip in the bottom-right tray; clicking it restores | ☐ |
| M-6 | Ownership tab, full scroll | **No** Log Call form, Draft Email, touchpoints, SF feed, Ownership Assistant | ☐ |
| M-7 | An owner where deed == decision maker (e.g. Rem Management) | Owner name appears **twice at most** (header + one card), not four times | ☐ |
| M-8 | An owner with a shell in front of a parent | Two-card ladder with the arrow still renders | ☐ |
| M-9 | Overview → AI Research | Research Notes present and **Save Notes** persists | ☐ |
| M-10 | Ownership → change only "True Owner" → Save | Existing owner contact name **survives** the save (the V-1-class never-clobber check, live) | ☐ |
| M-11 | Deep-link `#/dia?d=prop:dia:<id>:Ownership%20%26%20CRM` | Still lands on the renamed Ownership tab | ☐ |
| M-12 | Window < 1180px | Single full-width panel; no orphan dock, no resizer strips | ☐ |

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
