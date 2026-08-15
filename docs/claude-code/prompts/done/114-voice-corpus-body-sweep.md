# Prompt 114 — Backward+forward full-body capture into the voice corpus (via the bridge)

**Status: DONE (2026-08-15).** Root blocker found + fixed live; the Graph sweep is documented for
Scott's PA build. (Distinct from the other "Prompt 114" thread — the owner-contact review lane, commit
c595b72; this is the voice-corpus sweep sub-thread.)

## The finding (grounded live, LCC Opps `xengecqvemvfknjvbvrq`)

- The voice corpus `email_bodies` (23,169 rows, **all empty-body** pre-fix) is written by **exactly one
  path** — the bridge handler `handleOutlookMessageExtract`, reached via
  `POST /api/bridges?_route=ingest&_source=outlook&bridge=outlook.messages` → `?_route=worker` drain.
  It reads the FULL Graph body and upserts on `(workspace_id, internet_message_id)` with merge-duplicates
  (backward re-sweep fills existing rows). **Supersedes Prompt 110's assumption that `/api/intake` feeds
  the corpus — it does not** (`intake.js` writes body to `staged_intake_items`/`activity_events`, never
  `email_bodies`).
- **THE BLOCKER:** the ingest receiver strips any field not on the bridge's per-object allowlist
  (`applyAllowlist`) before enqueue; the `outlook.messages` `Message` allowlist did **not** include
  `body`, so the full body was dropped at ingest → every row `body_text=body_html=NULL`. A sweep would
  "succeed" green while filling nothing. (Bridge key footgun: `bridge=outlook.messages`, NOT
  `outlook.message.extract` — that's the `job_type`.)

## What shipped

- **Fix (applied live):** migration `supabase/migrations/20260905120000_lcc_p114_outlook_body_allowlist.sql`
  adds `body` to the `outlook.messages` `Message` allowlist. Config is live-immediately (no deploy);
  reversible. Verified: allowlist now includes `body`.
- **Part 1 — corpus scope:** reported the tracked-contact gate as a real decision. **Option A recommended**
  (accept the gate → corpus = deal/BD-relevant mail; no writer change — the allowlist fix is the only
  enablement). Option B (relax the gate for `from ∈ SCOTT_FROM`) scoped, not built. Tracked-vs-untracked
  split is unmeasurable from LCC data (untracked mail is never stored); `is_sent` is a weak heuristic, not
  "Scott sent it."
- **Part 2 — the sweep doc:** `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` — backward+forward Graph→bridge sweep,
  copy-paste (full-`body` `$select`, `X-LCC-Source-User-Id` = Scott's `lcc_user_id`
  `1d3f7321-a4ad-4f83-9c7b-489554fc1c51`, `records[]` array body, high-water-mark backward bound, worker
  drain, verification queries).
- **Part 3 — readers confirmed:** `draft-assist.js::loadCorpus` + `voice-corpus-clean.js::pickBestBody`
  already read `body_text`/`body_html` (fallback → `body_preview`), gated on presence not length — no
  reader change. Sent-activity path (`handleOutlookSent`) left as-is (500-char snippet; corpus is covered
  by the bridge path).
- **Docs:** STATUS entry + W10 kickoff correction note.

## Acceptance

- [x] Contract verified live and the real blocker (`body` stripped at ingest) found + fixed; exact working
      payload documented. The live POST-through-endpoint + worker-drain is the operator step (needs the
      Railway host + `X-LCC-Key` + a live PA connection) — the silent-no-op trap that would have defeated it
      is removed.
- [x] Corpus-scope decision reported with live counts + recommendation (Option A).
- [x] `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` written (backward+forward, `_source_user_id` + auth +
      full-`body` `$select` + high-water-mark bound).
- [x] No corpus-writer change for Option A (only the ingest allowlist config).
- [x] STATUS + W10 kickoff note (supersedes the Prompt-110 assumption); prompt → `done/`.

## Follow-on (if Scott picks Option B)

A corpus-specific writer that stores Scott-authored bodies regardless of tracked status — separate scoped
prompt, with a privacy/volume review.
