# DOCMAP1 — 1,171 docs, two "architecture" directories, and a map covering 4% of one of them

> **Scott, 2026-09-08:** *"clean and consolidate the repository so all that remains is the accurate
> view of our LCC app and designs and architecture including plans but **no misdirecting older files
> that are inaccurate or in various locations that might confuse a future chat**."*
>
> CONSOLIDATE1 and CONSOLIDATE2 fixed the **logs**. This is the **surface** — and the dangerous class
> is not "old", it is **"asserts something false and reads authoritative."**

**Repo:** `life-command-center` · **No code, no DB, no migrations.**

---

## 1. Measured (2026-09-08 — re-measure)

| | |
|---|---:|
| `.md` under `docs/` | **1,171** (+10 at repo root) |
| `docs/architecture/` | **152** |
| `docs/os/architecture/` | **29** ← a second directory of the same name |
| `docs/audits/` | 108 |
| `docs/claude-code/prompts/done/` / `docs/claude-code/done/` | 200 / 84 ← two "done" folders |
| **`DOCUMENTATION-MAP.md` mentions of `docs/architecture/*.md`** | **6 of 152** |
| `docs/architecture/*.md` untouched since 2026-08-01 | **66 of 152** |

🚨 **`CLAUDE.md` calls `DOCUMENTATION-MAP.md` "where every doc, plan, audit and design is filed."
It maps 6 of 152.**

⚠️ **"Untouched since 2026-08-01" is a TRIAGE POOL, not a verdict.** A finished, correct document is
supposed to stop changing. **Do not treat age as staleness** — that inference would retire correct
work and is the opposite of the goal.

---

## 2. The class that actually misdirects — proven twice in this arc

Not hypothetical:

- **`field-provenance-ladder.md`** justified a write *"per the ladder's own `manual`@1 rung"* — a
  rung that **does not exist** (`manual_edit`@1 and `manual_resolution`@1 do). The page carried the
  defect's own rationale.
- **`supabase/functions/intake-salesforce/index.ts`**'s header said it *"never writes a domain
  table"* **while it had minted 808 gov properties.** That sentence is what made GOVDUP1's
  *"producer NOT FOUND"* read as conclusive.

**Both were the document a reader trusts *instead of* re-measuring.** That is the failure DOCMAP1
exists to find — and neither would be caught by a date filter, because both were recently edited.

---

## 3. Units

### Unit 1 — classify, do not delete

Every `.md` under `docs/architecture/`, `docs/os/architecture/` and `docs/os/` gets exactly one
verdict:

| verdict | meaning | action |
|---|---|---|
| **CANONICAL** | the current door for its topic | add to the map; ensure it says so at the top |
| **HISTORICAL** | accurate for its date, superseded since | move to `docs/history/` **or** add a dated superseded-by banner — pick one convention and apply it uniformly |
| **STALE** | **asserts something now FALSE** | 🚨 fix in place with the measurement, or banner it — **never silently delete** |
| **DUPLICATE** | same topic as a canonical page | fold what is unique, then point at the canonical one |

⚠️ **Verify STALE claims before labelling.** A page saying something surprising may be right and the
reader wrong — this repo has a documented history of "re-measure the dated blocker" going both ways.
**Cite the measurement that makes it false**, per document.

⚠️ **Budget honestly.** 181 architecture files cannot all be read carefully in one unit. **Do
`docs/architecture/` + `docs/os/architecture/` first and say plainly what was not reached** — a
partial pass with a stated boundary beats a complete-looking pass that skimmed.

### Unit 2 — resolve the two-directory and two-"done" confusion

**`docs/architecture/` (152) and `docs/os/architecture/` (29) is the "various locations" Scott
named.** Decide ONE of: merge into one directory; or keep both with a **stated rule** at the top of
each saying what belongs where. **Either is fine; the ambiguity is not.** Same for
`docs/claude-code/prompts/done/` vs `docs/claude-code/done/`.

⚠️ **Moving files breaks inbound links.** Grep for references to any path you move (`CLAUDE.md`,
`docs/os/*.md`, the canonical pages, `.github/AI_INSTRUCTIONS.md`) and fix them **in the same
change** — a map that points at a moved file is a new instance of the very problem.

### Unit 3 — make the map real, or replace it

`DOCUMENTATION-MAP.md` covering 4% is worse than no map, because `CLAUDE.md` vouches for it. Either
**complete it** (every CANONICAL page, grouped by topic, one line each) or **replace it with a
generated index** and say which. **If it stays hand-maintained, add the rule that a new canonical
page must be added to it in the same change** — the rule this arc just learned about canonical pages
going stale on their own topic.

---

## 4. Out of scope

- **`docs/history/`** (95 + worklogs) — already archive; leave it.
- **`docs/capital-markets/`** (156) — a separate product surface; not this pass.
- **No deletion of any document.** Move, banner, or fold.
- **No rewriting of a document's substance** beyond correcting a demonstrably false statement, with
  the measurement cited.

## 5. Deliverables

1. The classification table — every file reached, with its verdict and, for STALE, **the false claim
   and the measurement that refutes it**.
2. The directory decision (merge or stated rule), with inbound links fixed.
3. A map that matches reality, or its replacement.
4. **An explicit list of what was NOT reached**, so the next pass starts from a boundary rather than
   guessing.

## 6. Verify on

- **The STALE list with citations** — that is the deliverable that serves Scott's ask. A pass that
  finds zero stale documents across 181 files should be treated as a **measurement failure**, not a
  clean bill: two are already known (§2), so **zero means the method missed them** — use those two
  as the positive control.
- Every moved file's inbound references resolving.
- ⚠️ **Not on the file count.** Fewer files is not the goal; a reader landing on the right one is.
