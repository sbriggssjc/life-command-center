# Claude Code Prompt — W7.3: Call notes + Microsoft-side capture (Copilot actions · Outlook tagging)

**Repo: life-command-center.** Wave 7 unit 3 (`WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md`
§W7.3), EXPANDED per Scott (2026-08-06): "the ability to send from Copilot or create
some process that we can trigger or tag certain elements or call logs from our
Microsoft product as we send." Calls and operator-tagged comms become first-class
inputs to the LIVE W7.2 propagation tick — capture is the only missing piece.

## Ground on (read first)
- `docs/architecture/copilot_action_registry.md` + `.json` (the action metadata
  standard: risk_tier, confirmation_required, idempotency) and the EXISTING Copilot
  Studio custom connector dispatch (15 operations via operations.js — find the
  dispatch table; `docs/setup/COPILOT_STUDIO_SETUP.md`).
- `api/_shared/intake-correspondence.js` dual-anchor loggers (the phone/webex path at
  ~line 251 shows a call-shaped ingest already exists) + W7.1's ingest-time deal
  stamping (`lcc_resolve_contact` primary_deal + conversation continuity).
- The W7.2 tick consumes deal-stamped activity_events — anything logged deal-stamped
  propagates automatically (summary/milestones/to-dos/dossier). DO NOT touch the tick.

## Build — three capture paths, one spine shape

Everything lands as `activity_events` with category='call' or 'email',
deal-stamped where known, through the EXISTING dual-anchor loggers — so W7.2
propagates it with zero new propagation code.

### A. Quick-log call (in-app)
A "Log call" action on the deal surface + My Work (find the existing action-button
pattern): fields = deal/contact (prefilled from context), direction (made/received),
when (default now), free-text notes. Writes a `call_note` activity (dual-anchor:
person + deal), then optionally invokes Phase-1 `deriveNextStep` on the notes text
(same guarded to-do path — a call saying "send them the OM" should produce that to-do).
Ollama use (gated, proposal-only): structure the free text into
{participants, topics, commitments[]} stored in metadata for the tick's summarizer —
on AI failure store the raw text only, never block the log.

### B. Copilot actions (the "from Microsoft as we send/work" ask)
Extend the Copilot Studio connector with TWO new actions, registered per the registry
metadata standard (update BOTH the .md and .json registries):
1. `log_call_note` — inputs: deal_or_contact_query (free text), direction, notes,
   occurred_at?. Resolution: search entities/deals; if ambiguous return the top
   candidates for the user to pick (confirmation_required: lightweight) — never guess
   the deal. Writes the same call_note activity as path A. risk_tier 1.
2. `tag_comm_to_deal` — inputs: deal_or_contact_query + message hint (subject/sender/
   approximate time) OR internet_message_id when Copilot can supply it. Finds the
   matching email_bodies/activity row, stamps deal_entity_id (idempotent; refuses if
   already stamped to a DIFFERENT deal — surface the conflict instead). This is the
   manual override lane for the 21 zero-match deals and any matcher miss. risk_tier 1.
Both return a short structured confirmation (deal name + what will now happen:
"logged — the deal summary and next steps update within the hour").

### C. Outlook category tagging (zero-UI, works at send time)
PA flow spec + LCC receiver: Scott (or team) assigns an Outlook CATEGORY to any
message — convention `LCC` (auto-resolve deal via the W7.1 paths) or `LCC:<deal hint>`
(explicit). A Power Automate flow on category-assignment (works on sent AND received
mail) posts `{internet_message_id, subject, from, to, sent/received_at, categories,
body_preview}` to a new `POST /api/intake-tagged-comm` (X-PA-Webhook-Secret auth, the
SF-flow contract style). Receiver: resolve the deal (hint match against open-deal
names/tenant+city cores → else the W7.1 resolver paths → else park in a small
`tag_unresolved` My Work lane rather than guessing), then log deal-stamped through the
dual-anchor logger, idempotent on internet_message_id. Document the PA flow in
docs/setup/ mirroring the deal-thread-search spec (operator builds it in PA).

## Doctrine / Do NOT
- Deal resolution NEVER guesses: ambiguous → pick-list (Copilot) or unresolved lane
  (category flow). No LLM in the deal-resolution gate.
- Reuse the dual-anchor loggers + Phase-1 to-do path — no new spine writers.
- Registry discipline: both new actions carry full metadata (risk tier, confirmation,
  idempotency notes); flag-gate the category receiver like other intake routes.
- Don't modify the W7.2 tick — these are producers feeding its existing seam.

## Tests
Quick-log writes dual-anchor + optional structured metadata (AI-fail → raw text
logged); Copilot ambiguous-deal returns candidates and writes NOTHING; tag_comm
refuses cross-deal restamp; category receiver idempotent on message id + parks
unresolved; all three shapes propagate (fixture: tick picks them up as new comms).

## Verify (live)
Scott: (1) logs a call via quick-log on an active deal → next tick updates that deal's
summary + any commitment to-do; (2) from Copilot (Outlook/Teams), runs log_call_note +
tag_comm_to_deal on a real email; (3) categorizes a sent email `LCC:<deal>` → receiver
logs it deal-stamped. All three visible in the deal's next summary regeneration.
Record in ROLLOUT_STATUS (W7.3 row + session log) + WAVE7 plan §0 + registry docs.
