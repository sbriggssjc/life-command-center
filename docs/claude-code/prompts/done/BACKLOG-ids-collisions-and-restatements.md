# BACKLOG-ids — 26 backlog IDs are used more than once, and some are two different issues wearing one name

**Repo: life-command-center.** Documentation integrity, not a feature. Small code (one guard test); the value is
entirely in the **classification**, which is judgment and must be measured row by row.

**Read first:** `docs/os/PLANNED-BACKLOG.md` (the file under repair) · `docs/os/REGISTRY.md` (never-delete /
keep-canonical) · `docs/claude-code/STATUS.md` 2026-09-12 entries · `test/status-header-integrity.test.mjs` — the
guard shape to copy, written today after a convention note failed five times to stop the same mistake ·
`CLAUDE.md` Core doctrines (**P131** a gap is filed never faked; never-delete).

---

## 1. The defect, measured live 2026-09-12

`PLANNED-BACKLOG.md` is the canonical open-work list — every prompt, every STATUS entry and every handoff points
into it by ID. **26 IDs currently appear on more than one row.** They are not one problem; they are two, and they
need **opposite** fixes:

**Class A — COLLISION: one ID, two unrelated issues.** A reader told *"see SEC2"* gets a coin flip.

| ID | one row | the other row |
|---|---|---|
| **`SEC2`** | §P0s **line 263** — *`wave0-config-values.txt` is tracked in git and contains `LCC_API_KEY` in plaintext* | §P9 **line 624** — *rotate the Supabase `service_role` key + enable Secure Inputs on the drainer* |
| `SEC1`, `SEC3`, `SEC4` | §P0s ~162–165 | §P9 ~623–626 |
| `A5d`, `A5e` | ~74–75 | ~444–445 |
| `D1` | 288 | 544 |

🚨 **This has already misfired, and the evidence is in the repo.** Earlier today I folded a duplicate row into
*"the pre-existing SEC2"* **without knowing there were two SEC2s** — the reference is now pinned to §P0s by hand,
but it was ambiguous when written and anything else citing "SEC2" still is. **Assume other citations are wrong
until checked**: grep `SEC1|SEC2|SEC3|SEC4|A5d|A5e|D1` across `docs/`, `test/` and code comments and report which
of the two each citation meant. `docs/os/OPERATOR-ACTIONS.md` cites SEC2 — establish which one.

**Class B — RESTATEMENT: the same issue written more than once.** `MB3`×4, `MB4`×4, `MB2a`×3,
`B6d-cms-restart`×3, `B6d-cms-step`×2, `B6d-cms-escalation`×2, `B6e-fred`×2, `B6e-fred-verify`×2,
`B6e-fred-cm-exposure`×2, `PR1d`×2 and the rest. These accumulated the way `PR5c-enforce`'s four copies did
(consolidated 2026-09-12) — successive sessions restating a row instead of editing it.

⚠️ **Classify before you touch anything.** A collision that gets "collapsed" silently destroys one of two real
issues. A restatement that gets "renamed" mints a second ID for one problem. **The counts above are a live reading
and may be wrong — re-measure, and report any disagreement rather than inheriting my numbers.**

## 2. Fix Class A — rename, never collapse

For each collision: **keep the ID on the row that more citations already point at** (count them — do not guess),
rename the other to a free ID in its own section's series, and **update every citation to the renamed one in the
same change**. Leave a one-line pointer on the renamed row saying what it used to be called, so an old reference
resolves instead of 404-ing in a reader's head — the never-delete rule applied to an identifier.

⚠️ **`SEC2` §P0s is 🔴 open and security-relevant, and its rotation is ⏸️ deferred by Scott's explicit decision
(2026-09-12: single operator, until the build is complete and users are added).** Renaming must not disturb that
decision or its trigger condition (*re-open at a second person with repo access, or a repo-visibility change*).
Do not restate the deferral in your own words; carry the row across intact.

## 3. Fix Class B — collapse into one row, keeping every distinct fact

Merge each set into a single row that retains **every** distinct measurement, date and caveat across the copies —
the `PR5c-enforce` consolidation is the worked example. **If two copies disagree on a number, that is a finding:
report it, keep both readings with their dates, and do not silently pick one.** Never drop a caveat because a
later copy omitted it.

## 4. Ship the guard — this is what stops it recurring

A duplicate ID has to fail CI. Copy `test/status-header-integrity.test.mjs`'s shape: parse the row IDs out of
`PLANNED-BACKLOG.md`, assert each appears once, and put the repair procedure in the assertion message.

⚠️ **Two things the guard must get right, or it will be disabled by the first person it annoys:**
1. **Deliberate cross-references are not duplicates.** If the file legitimately mentions an ID in prose or in a
   summary line, the parser must not count that as a second row. Establish the actual row shape first and say what
   you keyed on.
2. **If a genuine duplicate cannot be resolved this turn**, allowlist it **by ID with a reason and a re-measure
   date** — `test/retired-identifiers-guard.test.mjs`'s convention — and assert that a **stale allowlist entry is
   itself a failure**, so the list cannot rot into a lie.

## 5. The gate

1. The duplicate count **before and after** (before: 26 by my reading — state yours).
2. **Every Class A collision listed by ID**, with which row kept the name, which was renamed to what, and the full
   list of citations updated.
3. For Class B, any **disagreement between copies** you found, with both readings.
4. The guard failing on a seeded duplicate and passing on the repaired file — **a positive control, not a
   passing run** (Class 11).
5. Confirmation that no row's **content** was lost: the row count may fall, the set of distinct facts may not.

## 6. What NOT to do

- Don't delete a row. Collapse, rename, or allowlist — never remove an issue from the record.
- Don't renumber anything that is **not** duplicated. Churn in this file costs every reader.
- Don't rewrite Scott's deferral decisions, statuses or emoji flags while editing.
- Don't fix the underlying issues any of these rows describe. This is a naming repair.

## Guard + ship

Full suite green. ⚠️ `test/status-line-budget.test.mjs` — **archive an old span to `docs/history/` BEFORE you
push**, leaving 200+ lines of headroom; STATUS.md grows on `main` while your branch is open, and this has already
cost two PRs. `test/status-header-integrity.test.mjs` keeps the STATUS H1 on line 1 — prepend below the convention
block. Branch → PR → CI → merge. **No redeploy needed** — this changes documentation and a test, no engine code.

## Ship + record

Update `PLANNED-BACKLOG.md` (the repair itself, plus close `BACKLOG-ids`), `OPERATOR-ACTIONS.md` if its SEC2
citation was ambiguous, `STATUS.md`. Report all five gate items.

**Standing rules:** never fabricate — render "Not on file" / "Derived" / "Conflict"; Supabase is reconcilable,
never automatic truth; review existing machinery before building; document at every step; commit with the repo's
`Co-Authored-By` + `Claude-Session` trailer.
