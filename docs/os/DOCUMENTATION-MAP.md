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
| Prompt for Claude Code | `docs/claude-code/prompts/` | → `prompts/done/` once its work merges. ⚠️ **`prompts/` is NOT the record of what is outstanding — the AUDIT is.** A5 sat un-filed after completing and was recommended for re-sending on 2026-08-27. **Before proposing that a prompt be sent, grep `docs/audits/` for that round's output.** With two Cowork threads plus Claude Code sharing this repo, an un-filed prompt is a cross-thread duplicate-work hazard |
| Claude Code's response (.docx) | `docs/claude-code/responses/` | → `responses/done/` once reconciled |
| **Audit / measurement writeup** | `docs/audits/<TOPIC>_<YYYY-MM-DD>.md` | the finding and its reproduction queries |
| Architecture / subsystem design | `docs/architecture/<subsystem>.md` | one canonical file per subsystem |
| **⚠️ A file whose NAME misleads** | leave the file, add a **NAMING TRAP banner** at the top | Live examples: `owner-reconciliation-engine.md` and `sf-owner-capture.md` resolve the **point person** (which broker works the deal), **not the property owner**. That confusion is documented as *"the finding that reframed P0.2."* **A misleading title is a defect even when the contents are correct** — and it is cheaper to fix with a banner than a rename, which breaks every inbound link |
| **A topic spanning ~20 files** | one **living document** with a **§0 topic index** | Live example: `connectivity-and-open-threads.md` §0 indexes the whole ownership→contact chain — the three canonical pages and what each owns, the naming traps, the supporting designs, and the dated evidence trail. **Nothing is deleted**: an audit is evidence for a date. **If a canonical page disagrees with an audit, the page wins and the audit gets a supersession banner in the same change** |
| **A subsystem spanning many audits** | one canonical page + a **banner in each audit pointing at it** | Live examples: `docs/architecture/tier0-owner-contact-system.md` covers twelve rounds (P186–P197 + A1–A4); `docs/architecture/bd-ranking-and-priority-queue.md` covers C4–C6 (the ranked call list). The canonical page carries live state, decisions-already-made and traps-paid-for; the audits stay as the EVIDENCE. **A trap list is only a guard if it is on the path someone walks** — so the pointer goes in the audit, not only in the index |
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

## 6x. 👤 Operator actions — the one place to see what is blocked on Scott

📍 **[`OPERATOR-ACTIONS.md`](OPERATOR-ACTIONS.md)** collects every `👤` row from
`PLANNED-BACKLOG.md` into one ranked page — security first, then blocked builds, then decisions.
**It is a LENS over the backlog, never a second source of truth**; the backlog row stays
authoritative and wins any disagreement. It exists because 68 operator markers scattered across a
dozen sections is the same *"no single accurate representation"* problem this map addresses for
documents.

## 6y. 🔁 The build-turn protocol — this map's parent rule

📍 **[`BUILD-TURN-PROTOCOL.md`](BUILD-TURN-PROTOCOL.md) is the definition of done for every change**
(Scott, 2026-08-28). This map answers *where does a document go*; that page answers *what must be
true before a turn is finished* — and step ⑤ (**update the canonical docs in the same change**) plus
step ⑦ (**extract open intent before archiving**) are what keep this map from becoming fiction.
**§6z below is step ⑦'s full procedure.**

## 6z. 🗄️ Topic-based cleanup — the standing procedure (proven 2026-08-28)

**Cleanup is BY TOPIC CLUSTER, repo-wide — never by folder.** A folder pass leaves the same topic
contradicting itself from three other directories, which is the confusion this map exists to end.

**The procedure, and it is gated:**

1. **Enumerate the cluster repo-wide** — `docs/`, the repo root, `audit/`, `consolidation/`,
   everywhere. One `grep -rl` on the topic's vocabulary.
2. **READ every file before moving any of it.** Non-negotiable.
3. **Extract UNFILED OPEN INTENT** — anything unbuilt, deferred, "next step", or a design proposed
   and never confirmed shipped. **Grep `PLANNED-BACKLOG.md` for each** and file what is missing
   **before** the move. ⚠️ **On 2026-08-28 this recovered 25 items across two folders — including an
   entire unexecuted Supabase consolidation plan.** A move without this step destroys planned work
   silently, because nothing errors.
4. **Identify STALE CLAIMS** — assertions now false. **Banner them; do not silently delete.**
   The test: *would a future session reading this file first reach a wrong conclusion within one
   paragraph?* If yes, it needs a 🚨 banner, not a footnote.
5. **Check inbound references** — `grep` the filename across `.md`, `.sql`, `.mjs`, `.js`. **A
   path-anchored reference breaks; a bare-name mention does not.** Fix the former in the same change.
6. **Distinguish ARCHIVE from RELOCATE.** Archive = historical/superseded → `docs/history/`.
   Relocate = **still-live reference material in the wrong place** → `docs/architecture/` or
   `docs/audits/`. ⚠️ **Archiving live reference material is the more expensive mistake** — three
   files in the 2026-08-28 pass described machinery that shipping code still calls.
7. **Leave a README banner in the archive** and an `INDEX.md` entry, both naming where the open
   items went.

⚠️ **Watch for LETTER COLLISIONS across campaigns.** The May-2026 remediation's Track A/B/C and the
Aug-2026 lettered prompts both use A/B/C: *"B4"* is a May sales worker **and** the dia-vs-gov
chain-depth question. **Always disambiguate by date.**

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
6. **⚠️ Check the source location AGAIN after other branches merge.** A file MOVE is **not
   conflict-safe across parallel branches.** The 2026-08-27 archive recorded 31 worklogs as
   *delete-at-root + create-in-history* rather than as renames, so a branch based on an older
   commit — still carrying the root copies — **re-added all 31 on merge, silently and with no
   conflict.** Git resolved *"you deleted it / they still have it"* by keeping the file, which is
   the safe default for content and the wrong one for a move. For a day, every archived worklog
   existed twice. **Verify byte-identity before removing the resurrected copies** (all 31 were),
   and prefer landing a move when no long-lived parallel branch predates it.
