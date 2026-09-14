# CONSOLIDATE1 — the backlog is 680 rows and ~128 of them are finished

> **Scott's standing ask, stated most sharply on 2026-09-08:** *"clean and organize and consolidate
> the repository by topic so that only the most accurate and actionable picture of our LCC app build
> and design remains **without losing any planned features**."* This unit is that pass for
> `PLANNED-BACKLOG.md`. **The operative constraint is the last clause: nothing is deleted, only
> moved.**

**Repo:** `life-command-center` · **Files:** `docs/os/PLANNED-BACKLOG.md`,
`docs/claude-code/STATUS.md`, a new `docs/history/` archive
**No code, no DB, no migrations.** This is a documentation restructure and nothing else.

---

## 1. Measured shape (2026-09-08 — re-measure before acting)

| | count |
|---|---:|
| `PLANNED-BACKLOG.md` lines | 1,047 |
| table rows | **680** |
| rows marked `✅` | 67 |
| rows whose **ID is struck through** (`\| ~~ID~~ \|`) | 61 |
| rows open + red (`🚨` / `🔴`) | 17 |
| `STATUS.md` lines | 8,912 |

**Roughly 128 of 680 rows are finished work**, and they are interleaved with the open ones, which is
what makes the actionable set hard to see.

---

## 2. 🚨 The trap that nearly cost 44 rows — read this before writing any filter

`| ~~X~~ |` matches **two completely different populations**, and only one is redundant:

1. **A closed item whose ID is struck to mark completion** — e.g.
   `| ~~V1~~ | ✅ **RESOLVED 2026-08-27 — property-twin is writing again.** …`
   **These carry the entire record of what was done. There are ~44 of them and they are NOT
   duplicates.**
2. **A superseded "original filing" duplicate** — the pattern Cowork created when marking a row
   shipped: a new `✅` row summarising the outcome, immediately followed by the original text kept
   for the record. **Exactly 17 rows say `Original filing below` / `original filing`.**

⚠️ **A filter keyed on `~~` alone would have archived 44 live records of completed work as
"duplicates."** Cowork caught this by spot-checking six rows before acting, not by reasoning about
the pattern. **Key on the CONTENT (`Original filing`), never on the strike-through marker** — and
**print the matched set for review before moving anything.**

---

## 3. Units

### Unit 1 — retire the 17 self-created duplicates

For each `✅` row that ends "Original filing below" followed by a `~~…(original filing)~~` row:
**fold the original's still-useful detail into the `✅` row if it is not already there, then remove
the duplicate row and the "Original filing below" pointer.** If the original carries detail the `✅`
row lacks, **keep the detail, not the row.**

⚠️ **Verify before removing, per row**: does the `✅` row actually contain the finding, the numbers
and the reason? Several were written as summaries. **If it does not, the fold is the work and the
deletion is the easy part.**

### Unit 2 — archive the finished rows, do not delete them

Move rows that are **unambiguously closed** — `✅`-marked, or struck-ID with a `RESOLVED`/`CLOSED`/
`SHIPPED` verdict — to **`docs/history/PLANNED-BACKLOG_closed_2026-09.md`**, preserving each row
**verbatim** and grouped by the arc it belongs to (provenance ladder, CoStar capture, entity
identity, gov property duplicates, merge safety, SEC1/definer privileges, edge-function drift, CI
enforcement, …).

**`PLANNED-BACKLOG.md` keeps:**
- every open row (🚨 / 🔴 / 🟡 / 🟢 / ⏳ / 👤)
- a short **"Closed arcs"** index at the bottom: one line per arc pointing at the archive, so
  nothing becomes unfindable.

⚠️ **A closed row that carries a STANDING INVARIANT stays** — several `✅` rows are the only place a
rule is written down (e.g. the deliberate-anon exemptions, the `p_dry_run` caveat). **If removing a
row would delete the only statement of a rule, move the rule to `CLAUDE.md` or the arc's canonical
page FIRST, then archive the row.** *Losing a planned feature is the stated risk; losing a learned
rule is the unstated one.*

### Unit 3 — the verification, which is the whole safety story

Report all three:

1. **Row conservation:** `rows_before == rows_kept + rows_archived + rows_folded`, with the arithmetic
   shown. **Any row unaccounted for is a failure, not a rounding difference.**
2. **Every archived row is present verbatim in the archive file** — assert by ID, not by count.
3. **The open set is unchanged**: the list of open row IDs before and after must be **identical**.
   ⚠️ *This is the "without losing any planned features" guarantee, and it is the only one that
   matters — assert it explicitly rather than implying it from the totals.*

---

## 4. Out of scope

- **`STATUS.md`.** It is 8,912 lines and already has an archive convention; that is its own unit and
  mixing them makes both unverifiable.
- **No re-wording of open rows.** Consolidation is moving and folding, not editing live content.
- **No re-prioritising.** A row's colour/priority is not this unit's judgement to change.
- **No deletion of anything**, including the 17 duplicates — their detail is folded, and the row is
  removed only once its content demonstrably survives.

## 5. Deliverables

1. The archive file, grouped by arc.
2. `PLANNED-BACKLOG.md` with only open rows plus the closed-arcs index.
3. The three verifications from Unit 3, with numbers.
4. A list of any **rules rescued from closed rows** into `CLAUDE.md` or a canonical page (Unit 2's
   caveat) — if that list is empty, say so and say how it was checked.

## 6. Verify on

- **The identical open-ID set before and after.** Not the row-count drop — a smaller file with a
  missing planned feature is a worse document, not a better one.
- The archive containing every removed row by ID.
- ⚠️ **Not on "the file is shorter."**
