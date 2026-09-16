# SB notes — Scott's in-app observations, and how they become work

**What this folder is.** Scott uses the LCC app and drops what he notices here — a `.docx` with
screenshots and comments, a forwarded `.eml` (Power Automate failure digests, error mails), a
screenshot, a voice-memo transcript. Anything. No format is required; the intake step below does
the structuring.

**What it is not.** Not a backlog (that is `docs/os/PLANNED-BACKLOG.md`), not a prompt queue
(`docs/claude-code/prompts/`). Nothing in here is acted on until it has been triaged into one of
those.

## Intake protocol (every Cowork session that touches LCC)

1. **Look here first**, alongside `docs/claude-code/responses/`. Any file not yet in `done/` is
   new.
2. **Read the whole file** — the screenshots too (they are usually the point). One note file
   typically holds several distinct observations.
3. **Triage each observation into one row of `TRIAGE.md`** (`SBN-<n>`, numbered across all files,
   never reused). Each row records: the source file, what Scott saw (his words, short), what it is
   (one of `defect` · `design gap` · `automate-me` · `data-accuracy` · `question`), the surface
   (Home / Priority / Dialysis / Gov / Inbox / flow / other), the evidence checked (a file:line, a
   live query, a repo grep — *measured, not assumed*), and the disposition: an existing backlog row,
   a new backlog row, a new prompt in `prompts/`, answered in chat, or `not-a-bug` with the reason.
4. **Write the prompt(s).** A defect with a clear cause → a fix prompt. A design gap or a
   "should this be automated?" → an exploratory prompt that ends in a measured recommendation, not a
   build. Group observations that share a surface and a cause into one prompt; never one prompt per
   sentence.
5. **Open the backlog row(s)** with the `SBN-n` ids in the row text so the trail runs both ways.
6. **Move the file to `done/`** — `git mv` for tracked files (`.eml`, images), a plain move for `.docx`
   (gitignored repo-wide). The `TRIAGE.md` row is the durable record either way. Forwarded mails carry
   tenant/flow ids and links; that is fine, but never drop a file with a credential or token in it. Note the intake in `STATUS.md` under the session's entry and in the Open
   threads row **App feedback intake (SBN)**.
7. **Close the loop.** When the prompt's response lands, the `TRIAGE.md` row gets the outcome and a
   date; Scott can re-check the surface from the row.

## Rules

- ⛔ Never reword Scott's observation into something easier to fix. Quote it, then diagnose it.
- ⛔ Never file a disposition without evidence — a "probably" is a `question`, and the prompt asks it.
- ⛔ A screenshot number that disagrees with the database is a **finding**, not a display nit; it
  gets the `data-accuracy` type and a "one source per number" prompt.
- Automation candidates (`automate-me`) are graded against the standing doctrine: *only human-in-
  the-loop work belongs in a priority list; anything the code can decide, the code decides and logs*.
