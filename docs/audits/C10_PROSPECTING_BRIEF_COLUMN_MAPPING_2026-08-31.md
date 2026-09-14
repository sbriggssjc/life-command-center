# C10 — the prospecting brief read six columns the view does not have

**Measured live 2026-08-31 on LCC Opps (`xengecqvemvfknjvbvrq`). One JS change in
`api/operations.js::handleProspectingBrief`. No migration.**

> ## The one-line finding
>
> The call sheet mapped `v_bd_cadence_dashboard` onto its display fields using **six column names
> the view has never had**. PostgREST returned its 37 real columns, JS read `undefined` off the
> rest, and **every row rendered `Unknown — unknown [mixed] … rent unknown … Signal: none`.**
> **Four of the six meaningful fields were dead on all 126 eligible rows.** Nothing errored,
> nothing logged, and the row COUNT was correct throughout.
>
> ⚠️ **It is the reason C8's benefit was invisible.** C8 had just put Easterly
> (**$114,864,150 / 85 properties**), NGP Capital, USAA Real Estate and 44 other resolved owners
> onto this sheet — **and every one of them rendered as "Unknown".**

## 1. The defect

| handler read | view supplies | rendered on every row |
|---|---|---|
| `c.name` / `c.contact_name` | **`entity_name`** | **`Unknown`** |
| `c.company_name` / `c.org_name` | *(no company column)* | `''` |
| `c.annual_rent` | **`rank_value`** | **`rent unknown`** |
| `c.priority_signal` | *(no such column)* | `none` |
| `c.contact_email` · `c.domain` · `c.days_overdue` · `c.phase` · `c.owner_role` · `c.contact_id` | ✅ real | worked |

Note `rank_value` was **already mapped correctly** on the object — the renderer simply read
`annual_rent` instead. The number was one identifier away the whole time.

## 2. Before / after — the live top 10, rendered

Both columns produced by running the **real** map + template extracted from `git HEAD` and from the
working tree over the live rows, so the harness cannot drift from what ships.

```
BEFORE                                          AFTER
1. Unknown — buyer [mixed]                      1. Boyd Watterson Asset Management, LLC — buyer [domain not on file]
   Portfolio value: rent unknown | 1194 od         Portfolio value: $179,800,482 across 198 properties | 1194 od
   Signal: none | Phase: steady_state              Next touch: email | ⚠ cadence stale >90d, review | steady_state

2. Unknown — unknown [mixed]                    2. Easterly Gov Properties (REIT) — unknown [domain not on file]
   Portfolio value: rent unknown | 62 od           Portfolio value: $114,864,150 across 85 properties | 62 od

3. Unknown — unknown [mixed]                    3. NGP Capital — $68,324,766 across 31 properties
4. Unknown — unknown [mixed]                    4. USAA Real Estate — $62,034,450 across 8 properties
5. Unknown — unknown [mixed]                    5. US Fed Properties Trust — $53,661,661 across 35 properties
6. Unknown — unknown [mixed]                    6. Elman Investors — $28,989,914 across 30 properties
7. Unknown — buyer [mixed]                      7. Gba Associates Limited Partnership — $27,163,370 across 1 property
8. Unknown — buyer [mixed]                      8. TIAA CREF — $26,380,239 across 2 properties
9. Unknown — unknown [mixed]                    9. Trammell Crow Co — $24,146,509 across 1 property
10. Unknown — unknown [mixed]                  10. Beacon Capital Partners — $23,832,093 across 2 properties
```

## 3. Result — asserted against the brief's predictions

| | predicted | measured |
|---|---|---|
| rows rendering `'Unknown'` | all 126 → **0** | ✅ all 126 → **0** (`entity_name` is non-null on 126/126) |
| rows printing `'rent unknown'` | all 126 → **0** | ⚠️ **prediction corrected — see §4** |
| rows served | 126 unchanged | ✅ **126 unchanged** — the diff touches no query, gate, order or limit |

## 4. ⚠️ Two of the brief's own predictions were wrong

1. **"every row has a `rank_value`" is false — 4 of 126 are NULL.** They sort last under
   `.nullslast` so they are unreachable at `limit ≤ 25`, but the renderer must still handle them.
   It prints **`not on file`**, and the check is `Number.isFinite`, **not truthiness**, so a genuine
   **$0** stays `$0` — *cannot be sized* and *sized at zero* are different facts (P180).
2. **`[mixed]` was NOT a mapping defect — and it was still wrong.** `c.domain` mapped correctly;
   `domain` is genuinely **NULL on 93 of 126 (74%)**. But rendering a null as `[mixed]` **asserts
   the owner spans verticals**, which is the same P180 failure the brief flags for `Signal: none`,
   one field over. Now `[domain not on file]`. ⚠️ The view carries a real
   **`is_cross_vertical`** column — the honest source for "mixed" exists and is not read (**C10a**).

## 5. What was dropped vs re-sourced

| field | disposition |
|---|---|
| `name` | **re-sourced** → `entity_name` |
| `annual_rent` | **dropped**; the renderer reads the already-correct `rank_value` |
| `company` | **DROPPED.** The view has no company column and none was invented. |
| `priority_signal` | **DROPPED**, replaced by `next_touch_type` + `review_flag` — both real columns |
| `rank_property_count` | **ADDED** (judgement call, §7) |

**`/yr` was removed.** `rank_value` is `COALESCE(NULLIF(current_annual_rent_total,0),
connected_property_value)` — relationship-derived for a large minority of rows (**C9a**). Labelling
it *"Portfolio value"* is honest; the `/yr` suffix was still claiming an annual basis a
connected-property value does not have. The **prompt** now states the same rule to the model, so it
cannot re-introduce the mislabel in prose, and is told not to assume a sector where the domain reads
`not on file`.

## 6. ⚠️ THE FOLLOW-UP BUTTON WAS PASSING THE LITERAL STRING `Unknown` INTO THE EMAIL DRAFTER

The only downstream consumer of `contacts[]` is `getFollowUpSuggestions` (`app.js:8674`), which
reads `top.name` — so the chip rendered **"Draft email to Unknown"** and fired
`draft_outreach_email` with `contact_name: 'Unknown'`. A display defect had reached a **write**
surface. Nothing read `annual_rent`, `company` or `priority_signal`, so the reshape is safe.

## 7. The one judgement call

`rank_property_count` was added to the render. It is not in the brief. It is the view's own partner
to `rank_value` (both come from the same `CASE`), and portfolio value without the asset count is
half the fact on an investment-sales call sheet — *"$114,864,150 across 85 properties"* versus a
bare figure. Flagged rather than slipped in.

## 8. 🔴 Found while shipping — filed, NOT fixed

- **C10b — the cadence contact is mostly not demonstrably at the owner.** Of the 113 rows carrying
  an email, only **16** have a domain that corroborates the owner name (P197
  `lcc_tier0_company_confirms_domain`) and **14 are consumer mailboxes**. Boyd Watterson's contact
  is *Spencer Hale @mcwhinney.com*; Easterly's is *William Hendrix @centurytel.net*.
  ⚠️ **16/113 is a LOWER BOUND, not a claim that 97 are wrong** — a real employee can use a personal
  address (the P188 asymmetry). But **121 of 126 do carry a relationship edge**, and the edge role is
  on file: `prospecting_contact` 58 · `institution_decision_maker` 35 · `manager` 15 · `works_at` 12
  · `decision_maker` 1. ⚠️ `works_at` is the weak Salesforce org edge **P161 disqualified**. The
  sheet prints none of this. **Now that the sheet is legible it will confidently name a person at
  the wrong firm** — this is the next thing to fix on this surface, and it needs the role on the
  view.
- **C10a — `is_cross_vertical` is unread** (§4).
- **C8a — the fallback branch is untouched**, per the brief. Its mapping is **real for its own
  source** (`unified_contacts`: `full_name`, `company_name`, `title`, `email`, `engagement_score`
  all exist) — but the branch is **structurally dead**, `engagement_score` being 0 on all 30,714 gov
  rows. It is inert, not mismapped.
- **C4a — `owner_role` reads the literal `'unknown'` on 47 of 126.** The mapping is correct and the
  value is real; the sheet honestly prints `unknown`. Whether an owner should stay `unknown` is C4a.

## 9. Guard

`test/prospecting-brief-column-mapping.test.mjs` — 3 tests, **all 5 mutations verified RED**
(revert `name`, reintroduce `annual_rent`, renderer reads an unset field, re-add `/yr`, revert
`company`), control green. Two structural invariants: every `c.<field>` the **map** reads must be a
real view column; every `c.<field>` the **renderer** reads must be a key the map produces — the
second is how `priority_signal` survived, one layer down.

⚠️ **It strips comments before matching, and that is load-bearing:** this fix's own comments name
`annual_rent`, `priority_signal`, `contact_name` and `company_name` **5 times** while explaining
what went wrong, so a detector reading raw source would find every banned token present and pass
over a real regression — the A5c / N18 lesson, where a migration header discussing a hazard
satisfied the grep for it. The guard being green *with* those comments in the file is the positive
control for the stripper.

Per the block-slice footgun it anchors on stable identity tokens
(`contacts = queueResult.data.map(c => ({`), never a line number or a moving literal.

## 10. Verify

```sql
-- must stay 126; this change touches no selection logic
select count(*) from public.v_bd_cadence_dashboard
where workspace_id='a0000000-0000-0000-0000-000000000001'
  and phase not in ('paused','unsubscribed') and contact_id is not null
  and (owner_role in ('developer','user_owner','buyer','seller_flipper','operator')
       or is_resolved_owner is true)
  and is_brokerage is false;
```

Then **read the sheet** — the point is legibility, not a count. ⚠️ **If the row count moves,
something is wrong**; find the mechanism before adjusting anything.

⚠️ **This is a JS change, so it is live only on the next Railway redeploy of merged `main`** —
"merged is not running". Confirm with `/version` + `git merge-base --is-ancestor <sha> <deployed>`,
never by probing the handler (`/api/*` is auth-enforced; a `401` body greps as "the field is
absent").
