# Where things go — the filing standard for every Cowork and Claude Code session

> **The problem this solves:** on 2026-08-27 a consolidation found **five measured, unfixed
> Capital-Markets chart defects** that had been invisible for 17 days. They were real, sized and
> written up — in a worklog at the **repo root**, which no index covered. The P141 consolidation
> had swept `docs/` and never looked outside it.
>
> **A document nobody can find is a document that does not exist.** This file is the one place
> that says where each kind of artifact belongs. Put it in the right place the first time.

---

## 1. The five files that carry state (everything else is supporting material)

| file | answers | update it when |
|---|---|---|
| **`docs/os/CURRENT-STATE.md`** | *What is LIVE, what is flag-gated OFF and why* | something ships, a flag flips, or a stale claim is overturned |
| **`docs/os/PLANNED-BACKLOG.md`** | *Everything unbuilt-but-intended*, one ranked list, every row citing its source | you find work, finish work, or measurement refutes a row |
| **`docs/claude-code/STATUS.md`** | *The running log, newest first* — what happened and what was learned | every session, at the end |
| **`CLAUDE.md`** | *Durable invariants and footguns* — the rules that outlive any round | a lesson generalises beyond the change that taught it |
| **`docs/os/GITHUB-WORKFLOW.md`** | *How work reaches `main`* | the merge procedure or branch protection changes |

**Read the first three at the start of every session.** `docs/claude-code/NEW-CHAT-KICKOFF.md`
bootstraps a fresh chat and points at them.

## 2. Where each artifact type is filed

| artifact | location | notes |
|---|---|---|
| Prompt for Claude Code | `docs/claude-code/prompts/` | → `prompts/done/` once its work merges |
| Claude Code's response (.docx) | `docs/claude-code/responses/` | → `responses/done/` once reconciled |
| **Audit / measurement writeup** | `docs/audits/<TOPIC>_<YYYY-MM-DD>.md` | the finding and its reproduction queries |
| Architecture / subsystem design | `docs/architecture/<subsystem>.md` | one canonical file per subsystem |
| Runbook / setup / operator procedure | `docs/setup/` | |
| Rules that sync to AI surfaces | `docs/os/canon/blocks/*.md` | **bump `CANON_VERSION`, then run the render script.** Never hand-edit a file whose header says GENERATED |
| Superseded per-round narrative | `docs/history/` (+ `worklogs/` for one-off worklogs) | archive with an INDEX row — **never delete** |
| Capital-markets specifics | `docs/capital-markets/` | |

## 3. ⛔ Do not create these

- **A new `.md` at the repo root.** The root is code and config. It already carries 69 `.md` files
  from before this rule; do not add the seventieth. *(That is exactly how K13–K20 got lost.)*
- **A second document about a subsystem that already has one.** Extend the canonical file and
  leave a pointer. One source per topic.
- **A `✅ done` row left sitting in the backlog.** When a row ships, move the substance to
  `CURRENT-STATE.md` §2 and delete the row — otherwise the backlog rots into a changelog.
- **A "final" summary file per session.** That is what `STATUS.md` is for.

## 4. The lifecycle of a piece of work

```
found  → PLANNED-BACKLOG.md row (with its measurement and source)
       → prompts/<id>.md            (drafted for Claude Code)
       → responses/<id>.docx        (its reply)
reconciled → STATUS.md entry + docs updated + both files moved to done/
shipped    → CURRENT-STATE.md; backlog row deleted
retired    → moved to backlog P12 "excluded" WITH THE REASON — never deleted
learned    → CLAUDE.md, if the lesson outlives the change
```

**Nothing is ever deleted for being finished or wrong.** A contemplated feature is re-ranked or
explicitly retired with a reason. A refuted row is **rewritten with the measurement** — the
correction is usually worth more than the original claim.

## 5. Two audit windows run in parallel — label your work

| | **App audit** (desktop) | **Data-process & automation audit** |
|---|---|---|
| Scope | LCC the application — defects, lanes, surfaces, code | data processes end to end; where AI/automation raises productivity |
| Prompt numbering | **numeric** — 189, 192, 194, 195… | **lettered, matching its backlog rows** — A1, A2, A3… |
| Backlog rows | N3a–N3c, AC1b–AC10, N8/N8a | L1–L10, N4–N7, A1–A7, V6 |

**A *finding* about a data process belongs to the automation window even when its *code fix*
belongs to the app window.** If it is not obvious which window you are in, ask.

## 6. Naming

- Audits: `TOPIC_IN_CAPS_YYYY-MM-DD.md` — the date is load-bearing, because every measurement in
  this repo has a shelf life.
- Prompts: `<id>-<kebab-topic>-<YYYY-MM-DD>.md`.
- Architecture/design: lower-kebab, no date — these are living documents, updated in place.

## 7. Before you archive anything

The rule that would have prevented the K13–K20 loss:

1. **Enumerate by file type across the whole repo, not by folder.** A consolidation scoped to a
   directory misses whatever sits outside it.
2. **Grep the candidates for open-work markers *before* moving them** — `TODO`, `[ ]`,
   `follow-up`, `next steps`, `remaining`, `deferred`, `not yet`.
3. **Read every file that matches.** Roughly half of matches are already-closed items mentioned in
   passing; the rest are real, and they belong in `PLANNED-BACKLOG.md` **before** the file moves.
4. **Write an INDEX.md** in the archive folder naming what was recovered and where it went.
5. **Repoint any live references** in the same change.
