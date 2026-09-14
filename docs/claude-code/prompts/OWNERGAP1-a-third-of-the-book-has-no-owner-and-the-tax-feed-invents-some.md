# OWNERGAP1 — a third of the dia book has no owner, the tax feed returns none, and 228 of the owners it *did* return are fabricated

**Repo: life-command-center** (writes Dialysis_DB `zqzrriwuavgrquhisnoa`). **Investigation-first.** Unit 1 is a
containment fix; Units 2–3 are measurement whose *output is a decision for Scott*, not a build.

**Read first:** `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md` · `docs/os/PLANNED-BACKLOG.md` rows **PDR2**
(✅), **PDR2-noowner**, **PDR2-denorm**, `PR-scanner-4/5` · `docs/architecture/costar-sidebar-capture-pipeline.md` ·
**`api/_handlers/sidebar-pipeline.js` ~5409 and ~5780–5835** (the `tax_records` / `parcel_records` writer) ·
`CLAUDE.md` **B4/B5** (*"we must acquire the data" is the most expensive conclusion available — enumerate every
table first*), **P180**, **never fabricate**.

---

## 0. Why this exists

**PDR2** stopped the app naming the tenant as the owner. The honest consequence: **4,021 dia properties — 34% of
the 11,815-property book — now render "owner unknown."** For a net-lease broker whose job is calling the owner,
that is the real number behind the fix. I went looking for how much of it is recoverable from data already in
hand. **It is not recoverable, and the search found something worse on the way.** All figures below are live
reads from 2026-09-14 — **re-measure them; do not inherit them.**

## 1. 🚨 FIRST, AND DO NOT DEFER IT — the tax feed has written 228 fabricated owner names

`tax_records.raw_payload->>'mailing_owner'` contains, in the **production** table:

| value | rows | distinct counties |
|---|---|---|
| `XYZ Dialysis Centers Inc.` / `LLC` / `Center LLC` / `Holdings LLC` | 132 | 41+ |
| `XYZ Healthcare Trust` / `LLC` / `Properties LLC` | 54 | 44+ |
| `ABC Dialysis Centers Inc.` / `LLC` / `Center LLC`, `ABC Healthcare Trust`, `ABC Properties LLC` | 42 | — |
| **total** | **228 rows · 12 distinct names · 119 counties** | first seen **2026-05-20**, last **2026-08-24** |

**Of the 824 non-placeholder `mailing_owner` values in that table, 228 — 28% — are invented.** "ABC/XYZ Dialysis
Centers" across 119 counties is not an owner; it is sample or templated data. **None are currently linked to a
property** (`property_public_records` → 0), so nothing is displaying them today — **but they sit in the table
ownership answers are drawn from, and the producer is still writing them.**

**Do:** find where they enter (`sidebar-pipeline.js` ~5780–5835 is the writer — establish whether the values come
from the CoStar payload, a fixture, or a fallback in our own code, and **say which**); stop them being written;
quarantine the 228 **reversibly** — flag them, do not hard-delete, and record what was flagged.
⚠️ **Do not "clean" them by guessing a real owner.** ⚠️ **`Unknown` (142 rows) is a placeholder written as if it
were a fact** — P180; handle it in the same pass, as NULL, not as a name.

## 2. Establish honestly whether the owner is recoverable — I believe it is NOT

The tempting conclusion is *"the data is in the payload, we just never parsed it."* **I tested that and it is
false**, and the prompt exists partly so nobody spends a week building that parser:

- **25,331** tax rows carry a `mailing_owner` key in `raw_payload`. **24,365 of them are null or empty.** The
  source returned nothing — this is not an extraction gap.
- Of the **4,021** owner-unknown properties: **3,048** join to tax records, and **exactly 1** has a
  `mailing_owner` — whose value is the literal string `"Unknown"`.
- `deed_records` holds **203 rows total** with **zero** overlap with the 4,021.
- Only **56** of the 4,021 even carry a `parcel_number`, and **0** of those join a `parcel_records` row with an
  `owner_name`.

**Re-run every one of those four and report your numbers.** If you find a source I missed, **that is the most
valuable outcome of this prompt** — say so loudly. If you confirm them, the honest conclusion is: **the owner of
these 4,021 properties is not in any table we hold**, and the question becomes an acquisition decision
(§3), not an engineering one.

## 3. Give Scott the decision, not a build

Do **not** start acquiring data. Produce a short, costed comparison for 👤 **Scott's decision**, covering at
minimum: the county-recorder path that `PR-scanner-5`'s `handleRecorderPortal` already reaches; a paid
bulk-assessor/deed provider; and doing nothing (accepting "owner unknown" and ranking those properties last).
For each: **what fraction of the 4,021 it would plausibly resolve** (justify the fraction), the rough cost and
effort, and what breaks if it is wrong. **Concentration matters** — report how the 4,021 distribute by state and
county, because if a handful of counties hold most of them the cheapest path may be narrow rather than national.

## 4. What NOT to do

- Don't backfill `properties.recorded_owner_id` or `true_owner_id` from anything in this investigation.
- Don't undo PDR2 or reintroduce an operator as an owner-of-last-resort. **"Owner unknown" is the correct answer
  when the owner is unknown.**
- Don't build the acquisition pipeline. §3 ends in a recommendation, not a build.
- Don't touch `PDR2-denorm` (the `properties.true_owner_name` writer) — related, separately filed, and its write
  path needs its own audit.

## 5. The gate

1. The 228 fabricated rows: where they come from (**named**), the producer change that stops them, and the
   reversible quarantine, with before/after counts.
2. Your own re-measurement of §2's four numbers, beside mine, with any disagreement called out.
3. The 4,021 by state and county, top 15.
4. §3's costed comparison, ending in a recommendation addressed to Scott.
5. Confirmation that **no property's owner fields were written** by any of this.

## Guard + ship

Tests: the fabricated-name detector (a positive control — seed one, it must flag; a real owner must not), and the
`Unknown`-as-NULL handling. Full suite green.

⚠️ **Four doc guards, two have cost PRs.** `status-line-budget` (≤2,500) — **archive to `docs/history/` BEFORE you
push**, 200+ lines of headroom. `status-header-integrity` (H1 on line 1; prepend below the convention block).
`backlog-id-uniqueness` + `backlog-table-shape` — **re-run after merging `main`**, because a concurrent PR adding
rows merges cleanly and silently duplicates yours (CLAUDE.md). Branch → PR → CI → merge. Redeploy **both** Railway
services only if the producer change ships, then confirm `/version` matches `main`.

## Ship + record

Update `PLANNED-BACKLOG.md` (`OWNERGAP1`, `PDR2-noowner`), `CURRENT-STATE.md`, `STATUS.md`. Report all five gate
items — and if §2 confirms the owner genuinely is not in any table we hold, **write that down as a finding in its
own right**, because it is the answer to a question this repo will otherwise keep re-asking.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
