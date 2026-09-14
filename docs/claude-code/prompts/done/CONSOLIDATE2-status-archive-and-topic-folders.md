# CONSOLIDATE2 — Make the repo readable at a glance again: archive STATUS, fold the backlog's closed arcs, index by topic

**Repo: `life-command-center`.** Documentation only — no code, no DB, no flags. **Retire, never delete** (this repo's
own rule). The test of success: *a brand-new session can read three files and know exactly where everything stands.*

**Read first:** `docs/claude-code/STATUS.md` header (its archive convention and the CONSOLIDATE1 precedent) ·
`docs/os/PLANNED-BACKLOG.md` "How to keep this file honest" + "Closed arcs" · `docs/os/CURRENT-STATE.md` ·
`docs/audits/README.md` (its DOCMAP2 rule, plus the topic index appended 2026-09-12) · **`docs/os/DOCUMENTATION-MAP.md` — the existing index layer; extend it, never replace it** · `CLAUDE.md` Core doctrines · `LCC-OS.md`, `docs/os/README.md`.

## Why this, why now

Scott: *"clean and consolidate the repository files and folders by topic as we go so that we are leaving a clean and
accurate picture that any future chat can pick up seamlessly without misdirection."* Measured 2026-09-12:

- `docs/claude-code/STATUS.md` — **10,582 lines, 281 entries** (~750 KB). Too large for GitHub's conflict editor (it
  greyed out during a real merge on 2026-09-12) and too large for a session to read whole. Entries from several
  concurrent threads interleave by date, so a reader can't follow one arc.
- `docs/os/PLANNED-BACKLOG.md` — **1,227 lines**, with ✅ rows still inline that its own rule says should move to
  `CURRENT-STATE.md` §2 once shipped.
- `docs/audits/` — 118 files, now indexed by topic; keep it that way.
- `docs/claude-code/prompts/` + `responses/` — active vs `done/` is working; verify nothing is stranded at the top level
  whose response is already filed.

## 1. Archive STATUS by date, exactly as CONSOLIDATE1 did

Move entries older than a cutoff (propose one — e.g. everything before 2026-09-08, or keep the most recent ~30 entries)
**verbatim** into `docs/history/STATUS_claude-code_<range>.md`, with the same header note CONSOLIDATE1 used. Leave in
place: the file header, the archive pointers, and the recent window. **Nothing may be reworded or summarized on the way
out** — an archived entry is evidence.

Then add, at the top of the trimmed STATUS, a short **"open threads" table**: thread name → its backlog rows → the most
recent entry date → current state in one line. That table is what a new session reads first. Threads live today:
identity (ID), market briefs (MB/EB), operator funnel (OC), ownership (OWN/RO), CoStar sidebar (PR5/PRI), app/UX (HP1/UX),
buyer engagement (BUY0), broker identity (BR), gov agency (ID3a*).

## 2. Fold the backlog's shipped rows

For every ✅ row in `PLANNED-BACKLOG.md`: move it to `CURRENT-STATE.md` §2 (what IS) and delete the row here, per the
file's own "How to keep this file honest". Retired rows go to P12 with their reason. Keep every 🔴/🟡/🟢/👤 row exactly
where it is. Report the before/after line count and the rows moved.

## 3. Topic coherence pass

- Confirm each program's documents are findable from one place: identity (ID0–ID4 audits + the spec references),
  market briefs (`EXEC-BRIEFS-SPEC.md` + exemplars + payload contracts), operator funnel (`operator_note_contract.md`),
  data coherence (`data-coherence-invariants.md` I1–I16).
- Where a program has no single entry point, add a short README in its folder that links the pieces in reading order.
  **Don't create a new index layer** — extend `docs/os/DOCUMENTATION-MAP.md`, `docs/os/README.md`, `LCC-OS.md` and
  `docs/audits/README.md`. (Cowork nearly overwrote `docs/audits/README.md`'s DOCMAP2 rule on 2026-09-12 by generating a
  fresh index over it — read a doc before regenerating it, and append.)
- Flag (don't fix) any document whose header claims a status the live system contradicts — list them for a follow-up.

## 4. Guard the drift

Add a lightweight check (test or CI step) that fails when `STATUS.md` exceeds a line budget (say 2,500 lines), pointing
at this archive procedure. That is what stops the file growing back to 10,000 lines before anyone notices.

## What NOT to do

Don't delete any entry, row or audit. Don't reword archived content. Don't touch code, migrations, flags or the DB.
Don't move `done/` prompts or responses out of their folders. Don't invent a new top-level docs tree.

## Ship + record

Branch → PR → CI → merge. Report: STATUS before/after line counts and the archive file created, backlog rows folded into
CURRENT-STATE, any README added, the contradictions flagged in §3, and the line-budget guard. Update `STATUS.md` (a short
entry, in the trimmed file) and `PLANNED-BACKLOG.md` if a row changes state.
