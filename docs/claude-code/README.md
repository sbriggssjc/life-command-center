# Claude Code — prompt / response workflow

This folder is the **async work queue** between the LCC design chats (Cowork) and **Claude Code** (which has
repo + Supabase + deploy access). Cowork drafts prompts here; Scott sends them to Claude Code and pastes the
replies back; the next chat reconciles everything into the documentation.

## Structure
- `prompts/` — **open** prompts, one Markdown file each, named `NN-short-slug.md`. Cowork drafts these. Each is
  self-contained (context + a copy/paste block + how to verify).
- `responses/` — Scott pastes Claude Code's reply for a prompt here as `NN-short-slug.response.md` (same NN/slug
  as the prompt it answers).
- `done/` — completed prompts get moved here once their response is processed and the docs are updated.
- `STATUS.md` — the index: every prompt, its priority, state, and the PR/commit that resolved it.

## Standing behavior for EVERY future chat (reference this each session)
1. **At the start of the turn, check `responses/`** for any new `*.response.md` files.
2. For each new response: **read it, verify** against Supabase/code where needed, then **update the
   documentation** — `docs/architecture/DOSSIER-PROGRAM-STATE-OF-PLAY.md` (the trail) plus the relevant topic
   doc — and **mark the prompt done** in `STATUS.md` and move its file from `prompts/` to `done/`.
3. **Consolidate**: fold what was learned into the design; re-draft or retire downstream prompts that the
   response changed; draft new prompts for newly-exposed work.
4. **Keep the folder clean**: only genuinely-open prompts live in `prompts/`; `STATUS.md` always current.
5. **Never fabricate a response.** Act only on what Scott actually pastes into `responses/`.

## Naming
`NN-short-slug.md` (prompt)  <->  `NN-short-slug.response.md` (response). `NN` gives rough priority/order.

## Relationship to the topic docs
The design rationale for these prompts lives in `docs/architecture/` (e.g.
`living-deal-dossier-and-systems-connection.md`, `dossier-v2-audit-and-triage.md`,
`dossier-followup-prompts-for-claude-code.md`). This folder is the **actionable queue**; the topic docs are the
**why**. When a prompt here supersedes an inline copy in a topic doc, this folder wins.
