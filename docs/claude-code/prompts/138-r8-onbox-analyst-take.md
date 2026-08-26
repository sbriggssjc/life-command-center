# Prompt 138 — R8 Stage 1: generate the daily brief's "Analyst's Take" ON-BOX (Ollama)

## Finding (Cowork, 2026-08-26)
The morning briefing already ships a **"Analyst's Take — AI-generated narrative"** section
(`briefing-email-handler.js::renderAnalystTake`, reads `intelSnapshot.analyst_take`). But the field is
**EMPTY** — `briefing_intel_snapshot.analyst_take` has `length 0` for 2026-08-24/25/26 — so the section
renders nothing. The generator is the edge function `supabase/functions/briefing-intel-snapshot/index.ts`,
which calls **cloud Claude** (`https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`) and is
gated on `ANTHROPIC_API_KEY`; when unset it pushes the warning *"ANTHROPIC_API_KEY not set — skipped AI
generation"* and leaves `analyst_take: null`. That's the current state.

**Two reasons to move this on-box (this is the R8 net-new local-model build):**
1. The section is dead today → pure upside to light it up.
2. The Analyst's Take synthesizes **private LCC data** — pipeline rollup, scored priorities, deal-propagation
   deltas, work counts, hot contacts. Per the standing doctrine (private corpora never egress to a cloud
   model), that synthesis belongs **on-box** (GaryBuilt/Ollama), not at Anthropic's API. The public
   market/news sections (`capital_markets`, sector watch, reading list) can stay cloud — they're public data;
   this prompt touches ONLY `analyst_take`.

## Build — a small Node tick that fills `analyst_take` on-box, fail-soft
Add `POST/GET /api/briefing-analyst-take-tick` (or fold into an existing briefing handler in `api/`), flag-gated
`BRIEFING_ANALYST_TAKE_ONPREM` (register in `feature_flags_registry`). It:

1. **Assembles the private signal set** from the existing `briefing-data.js` fetchers — reuse, don't
   re-derive: `fetchWorkCounts`, `buildStrategicPriorities` (or the priorities it feeds),
   `fetchPipelineRollup`, `fetchDealPropagationDelta`/"what changed on your deals", `fetchMyWork`,
   `fetchHotContacts`, plus the day's macro line already in the snapshot (rates). Cap the payload; label
   every number with its source so the model can't misread raw JSON (the v5.3 lesson the edge fn already notes).
2. **Generates the take ON-BOX** via `api/_shared/ai.js::invokeOnPremGeneration` (fail-closed; the proven
   OLLAMA_URL + CF-Access path). Prompt for a tight **2–4 paragraph** executive read in Scott's voice:
   what matters today, what changed on the book, where to spend attention. **Use the saved voice profile**
   if one is available on-box (the `my-writing-style` / voice-distill profile) so it sounds like Scott, not
   a generic analyst.
3. **NEVER fabricates** — grounds ONLY on the assembled signals; if the data is thin (quiet day), writes a
   short factual take, not an invented one. No made-up deals, names, or numbers.
4. **Upserts `analyst_take` into today's `briefing_intel_snapshot` row** (`on_conflict=as_of_date,
   workspace_id`, fill the column — don't clobber the edge fn's `capital_markets`/news fields). Idempotent;
   re-running overwrites the same day's take only.
5. **Fail-soft:** any error / model-unavailable / flag-off → leave `analyst_take` null (the section already
   renders empty gracefully). Never block the brief. Record a health event so a silent empty is visible
   (this is the exact class we keep hitting — an empty take that looks like "no news").

## Timing
Snapshot row is created ~10:00 UTC (5:00 CT); the brief email sends ~12:30 UTC (7:30 CT). Schedule the tick
**after the snapshot exists and before the send** (e.g. ~10:20 UTC) via `lcc_cron_post`, so it fills the row
the edge fn just wrote. Confirm the edge fn no longer needs to own `analyst_take` (leave its null, or gate
its Claude path off) so the two don't fight over the column.

## Verify
- After deploy + flag on: the tick writes a non-empty `analyst_take` (`length > 0`) to today's row; the next
  brief renders the "Analyst's Take" section with real prose.
- Grade a sample take against the data it summarized — every claim traceable to an assembled signal, voice
  reads like Scott, no fabrication. **Assert on `analyst_take` length + a spot-read, not "the tick ran."**
- Private-data check: confirm the payload goes to OLLAMA_URL (on-box), never to `api.anthropic.com`.

## Deploy
JS-only (Railway redeploy) + a pg_cron entry (DB, live immediately). Register the flag. Commit with the repo
trailer. Doctrine: this is the first net-new on-box GENERATION build (vs the annotation assists) — same
guardrails: fail-soft, grounded, private data stays on-box, human reads the output (a brief, not an
auto-action).

## Follow-ups (not this prompt)
- R8 Stage 2 = the same on-box generation pattern for **CM quarterly book copy** (higher-stakes, client-facing).
- Optional: the xref-rank interleave for the clean-assist provenance lane (P137 payoff surfacing).
