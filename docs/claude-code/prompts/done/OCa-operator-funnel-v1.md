# OC-a — Operator funnel v1: apply EB1 live, then one intake endpoint → triage → the one to-do list

**Repo: `life-command-center`.** First live build step of P18. New code ships **flag-gated**; flags flip only
after the live verification in §6.

**Read first:** `docs/architecture/EXEC-BRIEFS-SPEC.md` (§6 operator funnel, §9 measured state) ·
`docs/architecture/operator_note_contract.md` (payload, triage output, dispositions — **build to it**) ·
`docs/os/PLANNED-BACKLOG.md` §P18 rows EB1, EB1a, OC1–OC4 · migration
`supabase/migrations/20260911165100_lcc_eb1_exec_briefs_foundation.sql` · `CLAUDE.md` "Core doctrines" +
"Known footguns" · `.github/AI_INSTRUCTIONS.md` · `api/_handlers/intake-tagged-comm.js` · `mcp/server.js`
(`log_memory`) · `api/_handlers/briefing-analyst-take-tick.js` (the on-box Ollama tick pattern).

## Why this, why now

Scott: *"limit human involvement as much as possible… the more iterations and improvement loops the better…
a large funnel that sorts to the same one to-do list, filtered and delegated by topic to the appropriate agent
and thread."* The funnel goes first because every later P18 step (and every other arc) then improves faster.
Live measurement 2026-09-11 (Cowork): EB1 tables are **not yet applied**; the tagged-Outlook path is flag-on but
**dormant** (0 rows in 30 days); on-box Ollama is healthy daily; the Anthropic API has **no credit** — so
triage must be on-box only (it is private corpus anyway).

## 0. Apply EB1 live (EB1a)

Apply the EB1 migration to LCC Opps (`xengecqvemvfknjvbvrq`), then run
`scripts/eb1-seed-dialysis-exemplar.mjs --apply`. Verify: 5 tables + 2 views exist; 16 dialysis facts live;
`v_market_brief_staleness` returns rows; re-running the seed writes 0. Record counts.

## 1. Intake endpoint (OC1)

One route (mount alongside intake, e.g. `POST /api/operator-notes`) that accepts the contract payload for every
`channel`, inserts one `operator_notes` row, returns `{id, disposition:'open'}`. Auth: signed-in operator,
`X-LCC-Key`, or `X-PA-Webhook-Secret` (Teams/PA). Idempotent on a channel-native id where one exists. No
triage inline — intake must never fail because a model is down.

Channels in this prompt:
- **In-app Note button** on every page (header/global): one text box; auto-captures `route`, open entity
  id/type, the last N console + API errors (add a small client ring buffer if none exists), optional
  screenshot. Must work in one click + typing, nothing else required.
- **MCP `log_operator_note`** in `mcp/server.js`, modelled on `log_memory`; document it in `mcp/README.md`.
  (Canon mention later — do not edit canon here.)
- **Outlook:** extend `intake-tagged-comm.js` so the category `LCC-Note` (and replies to briefing emails,
  if the flow can match them) route to `operator_notes` instead of deal resolution. **First diagnose the
  dormancy** (6 rows ever, last 2026-08-07): is the PA category flow off, erroring, or just unused? Report;
  the PA fix itself is an operator step for `OPERATOR-ACTIONS.md`.
- **Teams:** endpoint-ready only; write the PA flow spec as an operator step. Do not build a bot.

## 2. Triage tick (OC2)

A scheduled tick on the existing pg_cron + run-log pattern (log to `producer_runs` with
`producer='operator_triage'`), flag `OPERATOR_NOTE_TRIAGE` (off until §6). For each `open` note:
deterministic rules first (error signatures, route → area), then on-box **Ollama** for `type`, `domain`/lane,
`severity`, a one-line title. **Dedupe** against open PLANNED-BACKLOG rows (ship a parsed index of row ids +
titles the tick can read — e.g. regenerated at build time into a JSON under `docs/os/`) and prior notes
(`dedupe_of`). **Route** via a routing table `docs/os/operator-note-routing.json` (topic → owner thread, e.g.
`app/briefing`, `automation`, `data-coherence`, `surfaces/canon`, `comps`, `buyer-engagement`,
`exec-briefs`). Attach evidence where cheap (matching recent error log lines). Anything needing a human decision
→ a Decision Center lane, not the inbox. Never guess: an unclassifiable note stays `open` with a reason.

## 3. The one to-do list (OC3)

`scripts/render-operator-inbox.mjs --write` renders **`docs/os/OPERATOR-INBOX.md`** (GENERATED header) from
`operator_notes`: grouped by owner thread, newest first, each with id, type, severity, title, dedupe/backlog
link, disposition. No bot commits to `main` (branch protection) — instead: run it from
`.claude/hooks/session-start.sh` so every Claude Code session starts with a fresh inbox, add it to
`docs/claude-code/NEW-CHAT-KICKOFF.md` / README as a per-turn check alongside `responses/`, and expose an MCP
read tool `get_operator_inbox(thread?)` so Cowork and other surfaces read the same list.

## 4. What NOT to do

No market-brief producers, rendering, or email changes; no cloud-model calls (triage is on-box only; the
Anthropic key has no credit and this is private corpus); no canon edits; don't auto-edit PLANNED-BACKLOG —
promotion from inbox to backlog row stays a session-loop step this round; don't touch the snapshot fn.

## 5. Guard + ship

Tests: intake payload validation per channel, idempotency, triage rules (deterministic path) with a stubbed
Ollama, dedupe matching, routing, inbox render snapshot. Full suite green. Branch `feat/oca-operator-funnel-v1`
→ PR → CI green → merge. `api/` changes → redeploy BOTH Railway services (tranquil-delight + standalone MCP).

## 6. Verify live, then flip

After deploy: post one note through each built channel (in-app, MCP, and Outlook if the flow is alive); run the
triage tick once manually with the flag on for that run; confirm each note is classified, routed, and appears in
a fresh `OPERATOR-INBOX.md` and via `get_operator_inbox`. Then set `OPERATOR_NOTE_TRIAGE` on in
`feature_flags_registry` and note the cadence.

## Ship + record

Update `PLANNED-BACKLOG.md` §P18 (EB1a, OC1–OC3 states + measurements; add any new rows), `STATUS.md` (newest
first), `CURRENT-STATE.md` §2 for what is now live, and `OPERATOR-ACTIONS.md` for the PA/Teams steps. Reply with:
EB1a counts, channels live (y/n each), the Outlook dormancy diagnosis, one triaged example per channel, and
anything that contradicts the spec or contract.
