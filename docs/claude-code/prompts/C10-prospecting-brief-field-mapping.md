# C10 — the prospecting brief renders "Unknown … rent unknown" on every row

**Read first:** `docs/audits/C8_PROSPECTING_BRIEF_EXCLUDES_THE_BOOK_2026-08-29.md` (the ✅ SHIPPED
banner, which found this) · `docs/architecture/bd-ranking-and-priority-queue.md` §3 ·
Dead-End playbook **Class 24**.

**One JS change in `api/operations.js::handleProspectingBrief`.** No migration. **Filed by CC as
C8c while shipping C8; pre-existing and unrelated to C8's gate.**

---

## 1. The defect — verified by reading both sides

`handleProspectingBrief` maps `v_bd_cadence_dashboard` rows onto display fields using **column names
the view does not have**:

| handler reads | view actually supplies | rendered result |
|---|---|---|
| `c.name` / `c.contact_name` | **`entity_name`** | **`'Unknown'` on every row** |
| `c.company_name` / `c.org_name` | *(neither exists)* | `''` on every row |
| `c.annual_rent` | **`rank_value`** | **`'rent unknown'` on every row** |
| `c.priority_signal` | *(does not exist)* | `'none'` on every row |
| `c.contact_email` | ✅ `contact_email` | works |
| `c.domain` · `c.days_overdue` · `c.phase` · `c.owner_role` · `c.contact_id` | ✅ all real | work |

The view's full column list is: `cadence_id, entity_id, entity_name, owner_role, workspace_id,
domain, phase, priority_tier, current_touch, next_touch_due, next_touch_type, next_touch_template,
days_until_next, days_overdue, last_touch_at, last_touch_type, last_touch_template, emails_sent,
emails_opened, emails_replied, calls_made, calls_connected, meetings_scheduled, consecutive_unopened,
unsubscribe_status, bd_opportunity_id, owner_user_id, total_property_count, current_property_count,
is_cross_vertical, contact_id, contact_email, rank_value, rank_property_count, review_flag`
(+ `is_resolved_owner`, `is_brokerage` from C8's migration `20260831120000`).

**So every line of the call sheet reads:**

```
1. Unknown — unknown [mixed]
   Email: eric.dowling@boydwatterson.com
   Portfolio value: rent unknown | Days overdue: 43
   Signal: none | Phase: prospecting
```

**Four of the six meaningful fields are dead. Only the email, phase, domain and days-overdue
survive.**

## 2. ⚠️ Why this matters more than it looks

**C8 just put Easterly ($114.9M), NGP Capital, USAA Real Estate and 44 other resolved owners onto
this sheet — and every one of them renders as "Unknown".** C8's benefit is real but currently
invisible: the operator sees 126 identical anonymous rows ranked by a value the page refuses to
print.

⚠️ **And it plausibly explains why the role gate survived unexamined for so long.** A sheet where
every row says *"Unknown — unknown [mixed] … rent unknown … Signal: none"* is not a sheet anyone
works, so nobody was positioned to notice that the top of the book was missing from it. **Two
defects, each of which made the other harder to see.** Do not treat this as cosmetic.

## 3. What to build

Map to the columns the view supplies:

- `name` ← **`c.entity_name`** (keep a `|| 'Unknown'` guard, but it should now be unreachable)
- `annual_rent` ← **`c.rank_value`** ⚠️ **and rename the display label.** `rank_value` is
  `COALESCE(NULLIF(current_annual_rent_total,0), connected_property_value)` — for **146 rows it is
  relationship-derived, not owned rent** (backlog **C9a**). Printing it as *"Portfolio value"* is
  honest; printing it as annual rent is not.
- `company` — **the view has no company column. Do not invent one.** Either drop the field from the
  renderer or source it deliberately; **do not silently map it to `entity_name`**, which would print
  the owner's name twice.
- `priority_signal` — **the view has no such column.** Either drop it or derive it from something
  real the view does carry (`next_touch_type`, `review_flag`, `days_overdue`). **Do not print
  `'none'` as though it were a measured absence** — that is the P180 NULL-is-not-zero failure in
  prose.

⚠️ **Check the SECOND mapping too.** The fallback branch (`~line 4905`) maps `c.company_name`,
`c.title`, `c.email`, `c.engagement_score` against `unified_contacts` — a **different source with
different columns**. C8 established that branch is **structurally dead** (`engagement_score` is 0 on
all 30,714 gov rows, backlog **C8a**), so **do not spend effort repairing it** — but confirm which
of its fields are real and say so, rather than assuming they match.

## 4. Predicted result — assert against this

| | before | after |
|---|---|---|
| rows whose `name` renders `'Unknown'` | **all 126** | **0** |
| rows printing `'rent unknown'` | **all 126** | **0** (every row has a `rank_value`) |
| rows served | 126 | **126 — unchanged** |
| the gate, the ordering, the limit | — | **unchanged** |

⚠️ **This is a rendering fix ONLY. If the row count moves, something is wrong** — stop and find the
mechanism before adjusting anything.

## 5. Report back

- The top 10 rows of the live brief, rendered, **before and after** — the point is legibility, so
  show it rather than counting it.
- Which fields you dropped versus re-sourced, and why.
- What you did with `priority_signal` and `company`.
- Whether the fallback branch's mapping is real (**do not fix it** — C8a).
- ⚠️ **`rank_value`'s label.** State what you called it and confirm it is not presented as owned
  annual rent.
