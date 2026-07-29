# Codex / Cowork Instructions — Life Command Center

> **🧭 START HERE for architecture: [`LCC-OS.md`](LCC-OS.md) → `docs/os/README.md`.**
> One brain (LCC + Cortex), one instruction/policy canon (`docs/os/canon/`), many surfaces (Copilot, Claude
> Personal/Cowork, Northmarq Claude, ChatGPT). Edit rules in the canon, bump the version, run
> `docs/os/SURFACE-SYNC-PROTOCOL.md` to update every surface. **Never start from scratch, never fork a source,
> never overwrite canon without bumping its version.** Consolidation map: `docs/os/REGISTRY.md`.

> **CRITICAL: Read `.github/AI_INSTRUCTIONS.md` before modifying any files in `/api/`.**

> **The durable engineering reference is [`CLAUDE.md`](CLAUDE.md)** — architecture invariants, DB topology,
> naming conventions, write-surface rules, doctrines, and known footguns. This surface and the Claude surface
> share the same codebase and the same rules; **read `CLAUDE.md` first**, then apply the Codex-specific notes
> below. The full round-by-round worklog was archived to
> [`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md) (and this file's prior worklog to
> [`docs/history/AGENTS_full_2026-07.md`](docs/history/AGENTS_full_2026-07.md)).

---

## What changed since this file's old worklog (do not trust stale copies)

The prior AGENTS.md asserted invariants that are now **FALSE**. Current truth (from `CLAUDE.md`):

- **Production runs on Railway, not Vercel.** Vercel was retired 2026-07-20; `vercel.json` is **deleted**.
  There is **no 12-serverless-function cap** — the old "HARD LIMIT: 12 functions / NEVER create new `api/*.js`
  / update `vercel.json`" rules are obsolete. `server.js` is the single source of truth for `/api/*` routing
  (add sub-routes via `?_route=`). `lcc_cron_post()` POSTs to **Railway** (`/api/*`) or Edge endpoints, not
  Vercel.
- Ship JS via a **Railway redeploy of merged `main`**, then run the deploy gate `npm run verify:deploy`.
- The `≤12 api/*.js` count is now a **structure convention**, not a platform limit — prefer sub-routes of an
  existing handler; put utility/handler code in `/api/_shared/` or `/api/_handlers/`.

## Codex-surface rules

1. Prefer **sub-routes** (`?action=` / `?_route=`) of an existing handler over a new top-level `api/*.js`.
2. New utility/handler code → `/api/_shared/` or `/api/_handlers/`.
3. **Mount every new route in `server.js`** (`test/operations-subroutes.test.mjs` guards this).
4. Descriptive, Round-numbered commit messages — never generic "GPT/Codex changes".
5. `.github/AI_INSTRUCTIONS.md` is the full architecture + routing reference.

## Everything else lives in CLAUDE.md

For the durable content — Architecture Quick Reference, database topology (LCC Opps / Dialysis_DB / gov),
client routing + zoom model, OM intake pipeline, multi-model AI fallback, OCR foundation, field-level
provenance, BD spine, the Producer/Consumer + data-write + deploy-ordering + single-advance doctrines, and the
**known footguns** (disk-full auth lockout, PostgREST 1000-row cap, `data-query` edge allowlist 403,
`CREATE OR REPLACE VIEW` append-only, canonical `dia`/`gov` naming, `external_identities` scheme, GENERATED
columns, `ON CONFLICT` index-inference, synchronous Overview tiles, paused web-search proxy, SOS fetcher CI
block) — **see [`CLAUDE.md`](CLAUDE.md)**. Do not duplicate that content here; keep the two surfaces in sync via
`docs/os/SURFACE-SYNC-PROTOCOL.md`.

Round-by-round implementation history: [`docs/history/CLAUDE_full_2026-07.md`](docs/history/CLAUDE_full_2026-07.md).
