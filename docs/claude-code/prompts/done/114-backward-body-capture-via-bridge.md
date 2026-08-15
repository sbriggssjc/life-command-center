# Prompt 114 — Backward+forward full-body capture into the voice corpus (via the bridge)

Grounding (read first): `api/_shared/bridge-handlers-outlook.js` (`handleOutlookMessageExtract` ~lines 70–143 —
the SOLE writer of `email_bodies`), `api/bridges.js` (the `_route=ingest` enqueue + `_route=worker` drain +
`HANDLERS['outlook.message.extract']`), `docs/setup/OUTLOOK_SENT_SWEEP_FLOW.md` (the Graph-sweep pattern +
`backfill:true`), `docs/setup/OUTLOOK_CATEGORY_TAGGING_FLOW.md`, `api/draft-assist.js` `loadCorpus` +
`api/_shared/voice-corpus-clean.js` (the corpus READERS, Prompt 110), `api/intake.js` `handleOutlookSent`
(the sent activity path — snippet-only). This closes the loop Scott asked for: **use a backward-pulling Graph
sweep to fill the voice corpus from real Sent/Inbox history + forward, no synthetic test.**

## The grounded reality (verified live, 2026-08-15)

- **`email_bodies` (the voice corpus source) is written by EXACTLY ONE path:** the bridge
  `handleOutlookMessageExtract` (`bridge-handlers-outlook.js:121`, upsert on `(workspace_id,
  internet_message_id)` with `Prefer: resolution=merge-duplicates`). The two flows Scott edited feed neither:
  `handleOutlookMessage` (flagged) → `staged_intake_items.metadata`; `handleOutlookSent` → `activity_events`
  with a **500-char snippet** (intake.js:408). So neither edit fills the corpus.
- **The bridge reads the FULL Graph body** — `p.body.contentType` + `p.body.content` (not `bodyPreview`) — and
  stores `body_text`/`body_html`. merge-duplicates ⇒ **a backward re-pull UPDATES existing rows' bodies** (the
  ~23K empty-body rows fill with NO code change to the writer).
- **Ingestion is QUEUE-based:** `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.message.extract`
  enqueues an `enrichment_jobs` row; the worker (`/api/bridges?_route=worker`) drains it into
  `handleOutlookMessageExtract`. Job payload requires `internetMessageId` (or `id`), **`_source_user_id`**
  (handler errors `missing_source_user_id` without it), `from`/`toRecipients`/`ccRecipients` (Graph shapes),
  and **`body:{contentType,content}`** for the full body. `isDraft:true` is dropped.
- **⚠ THE KEY GATE (decide this first):** the bridge stores a message ONLY if a party is a **tracked contact**
  (`findTrackedContacts` → else `skipped:'no_tracked_party'`). So a sweep through the bridge fills the corpus
  for **deal-relevant mail only**, NOT Scott's entire mailbox. For a BD voice corpus that's arguably the RIGHT
  subset — but it's a real scoping decision, not an accident. **Surface it explicitly and let Scott choose.**

## Do

### Part 1 — decide the corpus scope (the gate)
Report the tradeoff crisply and recommend:
- **Option A (recommended, no code change): accept the tracked-contact gate.** The corpus = Scott's mail with
  tracked contacts (deal/BD-relevant) — the highest-value voice signal, and it flows through the proven bridge
  writer untouched. Quantify live: how many of Scott's sent emails involve a tracked contact vs not.
- **Option B (bigger): a corpus-specific writer** that stores Scott-authored bodies to `email_bodies` regardless
  of tracked status (a leaner path or relaxing the gate for `is_sent` + from=Scott). More coverage, more code +
  a privacy/volume review. Scope it; don't build unless Scott picks it.

### Part 2 — the backward+forward Graph sweep (document like OUTLOOK_SENT_SWEEP_FLOW.md; Scott builds in PA)
A single **"Send an HTTP request" (Graph) sweep** — Recurrence (forward) + a one-time backward pass — over
**Sent Items AND Inbox**, `$select` INCLUDING the full **`body`** (contentType+content), `internetMessageId`,
`from`, `toRecipients`, `ccRecipients`, `conversationId`, `sentDateTime`/`receivedDateTime`, `isDraft`. For each
message, `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.message.extract` with the job payload
(inject `_source_user_id` = Scott's lcc_user id; operator auth `X-LCC-Key` + `X-LCC-Workspace`). Then the worker
drains it → `email_bodies` fills body_text/body_html (historical via merge-duplicates + forward). Backward pass:
bound it (keyset by `sentDateTime`/`receivedDateTime`, `$top`/`$orderby`, high-water mark) so it terminates and
is resumable — mirror the sweep doc's high-water-mark mechanics; run the backward window first, then leave the
5-min recurrence.
- **fx pitfalls (from the sweep doc):** don't wrap the whole Graph URI in one `@{...}`; iterate
  `body('Parse_JSON')?['value']`; Graph recipients are object arrays (don't Select over a string).
- **Verify contract live first** (the house rule): before writing the doc, POST ONE real historical message
  through `/api/bridges?_route=ingest…` + run the worker, and confirm an `email_bodies` row gains
  `length(body_text|body_html) > 255`. Report the exact working payload.

### Part 3 — confirm the readers + sent path
- Confirm `draft-assist` `loadCorpus` / `voice-corpus-clean` now surface the fuller bodies once present (Prompt
  110 wired `pickBestBody` — verify it reads `email_bodies.body_text/body_html`).
- **Sent activity (separate concern):** `handleOutlookSent` keeps a 500-char snippet — fine for deal-to-do
  logging. Note whether to also persist its full body (only if the deal timeline needs it; the CORPUS is covered
  by the bridge/email_bodies path, so likely leave sent-activity as-is). Recommend, don't over-build.

## Acceptance
- A live-verified working payload for `/api/bridges?_route=ingest…outlook.message.extract` that lands a >255-char
  body into `email_bodies` (one real historical message), + the worker-drain confirmation.
- The corpus-scope decision (Part 1) reported with live counts + a recommendation.
- `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` — the backward+forward Graph→bridge sweep, copy-paste (like the sent
  sweep doc), including the `_source_user_id` + auth + full-`body` $select + high-water-mark backward bound.
- No corpus-writer change for Option A; if Scott picks B, a separate scoped follow-on.
- Docs: STATUS entry + a note in the W10 kickoff (this is how the corpus actually fills — supersedes the
  Prompt-110 assumption that the intake flows feed `email_bodies`; they don't — the bridge does). Prompt → `done/`.

Commit with the repo Co-Authored-By + Claude-Session trailer. One PR (docs + any Option-A verification helper);
the Graph sweep is Scott's PA build.
