# ID3a-d — Name the owning repo for every database, retire the duplicates, and ship the deployed-vs-committed drift check

**Repo: `life-command-center`** (with read-only inspection of `government-lease` and the Dialysis repo). Mostly
documentation and one detector. **No DB object is edited here** — the point is to make sure the next person can't
edit the wrong copy.

**Read first:** `CLAUDE.md` → Core doctrines → **"ONE REPO OWNS EACH DATABASE'S OBJECTS"** (new, Scott 2026-09-12)
and "TRUTH IS FIXED AT ITS SOURCE OF RECORD" · `docs/architecture/data-coherence-invariants.md` **I16** ·
`docs/os/PLANNED-BACKLOG.md` §P0d **ID3a-d**, ID3a-c · `docs/claude-code/STATUS.md` 2026-09-12 entries ·
`docs/architecture/ACCESS-TOPOLOGY.md` and `REGISTRY.md` if they already describe repo/DB ownership.

## Why this, why now

ID3a-c's agency fixes shipped in **`government-lease`** (PR #398) and are live and verified. But
`life-command-center` still carries **213** `supabase/migrations/government/*` files, including
`20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`, whose committed `canonicalize_agency()` has
**no state-qualifier guard** and the **old ICE/CBP branch order**. The deployed function (4,723 chars) came from the
other repo. **Re-applying LCC's file — the obvious thing to do if a later session finds the gov DB "missing" that
migration — would silently restore `TEXAS DEPARTMENT OF AGRICULTURE → USDA` and `Immigration & Customs Enforcement
→ CBP`.** Nothing in either repo says which one owns the database.

## 1. Name the owner of every database (measure, then declare)

For **government**, **Dialysis_DB** and **LCC Opps**, report: which repos contain migrations targeting it, how many,
the newest in each, and where the same object is defined in more than one repo. Then write the ownership table into
`CLAUDE.md` (next to the new doctrine) and the architecture docs that describe topology. Government is settled:
**`government-lease` owns it**. For the other two, propose an owner from the evidence and mark it 👤 for Scott if
it isn't obvious.

## 2. Retire this repo's government migrations without losing them

They are the record of what was applied — **retire, never delete** (the backlog's own rule). Options: a `README`
in `supabase/migrations/government/` marking the directory historical with the pointer and the date, plus a header
line in each file, or a move to `docs/history/`. Choose one, justify it, and make sure any tooling that globs
migrations can't pick them up. **Include the specific warning about the canonicalizer file**, naming both defects
re-applying it would restore.

## 3. The drift check (I16's detector)

ID3a-c built drift-detector views but left them unscheduled. Finish the job for the government DB first (the class
where it has already bitten twice): hash each routine/view/trigger definition in the live DB against what the
**owning repo's** migrations produce, list every difference, and run it once green under real credentials before
scheduling it on the I11 alert path. Report the drift list from that first run — the interesting number is how many
other objects have been hand-patched and never committed.

## 4. Close ID3a-c's deferred items, or file them properly

- USFS / BLM / NSF canonicalizer regex gaps.
- The 10 FK-vs-canonicalizer granularity judgment calls — list them with a recommendation each, so Scott can answer
  in one pass rather than ten.
- Say plainly which belong to `government-lease` now (most will) and open them there.

## 5. What NOT to do

Don't edit any gov DB object from this repo. Don't delete migrations. Don't touch dia or LCC Opps objects while
naming their owner. No county/city work (ID3e).

## Guard + ship

A test (or CI check) that fails if a new migration file appears under this repo's `supabase/migrations/government/`.
Full suite green. Branch → PR → CI → merge.

## Ship + record

Update `CLAUDE.md` (the ownership table), `data-coherence-invariants.md` (**I16** detector status),
`PLANNED-BACKLOG.md` §P0d (ID3a-d, plus rows for anything handed to `government-lease`), `STATUS.md`,
`CURRENT-STATE.md`. Report: the per-database repo census, the retirement method, the drift run's findings, and the
ID3a-c deferrals with owners.
