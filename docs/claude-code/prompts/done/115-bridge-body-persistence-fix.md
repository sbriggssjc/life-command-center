# Prompt 115 — Fix: the bridge handler drops the email body (voice corpus stays empty)

Grounding (read first): `api/_shared/bridge-handlers-outlook.js` (`handleOutlookMessageExtract`, the body split
~lines 111–131 + the `email_bodies` upsert), `api/bridges.js` / `api/_shared/bridges.js` (`applyAllowlist` +
the worker drain), `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` (the sweep this unblocks), the Prompt-114 allowlist
migration (`20260905120000`, already live — `body` IS allowlisted). This is the LAST blocker on the voice
corpus: the sweep + ingest + allowlist all work now; the handler just isn't persisting the body.

## The bug (traced live, 2026-08-15, LCC Opps `xengecqvemvfknjvbvrq`)

A real Sent-Items sweep enqueued 25 of Scott's messages through the bridge. Verified end to end:
- **The enqueued `enrichment_jobs.payload` is correct:** `payload->'body'->>'contentType' = 'html'`,
  `length(payload->'body'->>'content')` = 5,791 / 101,327 / 83,653 — the FULL body, proper Graph shape
  (`from`/`toRecipients` are objects/arrays too). The Prompt-114 allowlist passes `body` through intact.
- **The handler runs and UPDATES the existing `email_bodies` row** — `source_user_id` is set on all 24 rows
  (so the merge-duplicates upsert IS doing DO UPDATE; the unique index `email_bodies_ws_msg_uidx` exists).
- **Yet `body_format`, `body_text`, `body_html` all persist as NULL** — `has_html: 0`, `has_body_format: 0`
  across all 24. The content is in the payload and the row updates, but the body columns come out empty.

So at handler runtime `bodyFmt`/`bodyHtml` evaluate to null even though `payload.body.contentType='html'` and
`payload.body.content` is a large string. The current split is brittle:
```js
const bodyFmt = p.body?.contentType || null;
const bodyContent = p.body?.content || null;
const bodyText = bodyFmt === 'text' ? bodyContent : null;
const bodyHtml = bodyFmt === 'html' ? bodyContent : null;
```
Any of: `contentType` arriving with different casing/whitespace, `p.body` being a JSON string at runtime rather
than an object, or the exact-equality `=== 'html'` missing, silently yields NULL for BOTH columns while the
content is discarded. (Two live runs confirmed the fragility: the original flow sent `contentType:'html'` and
stored nothing; a `setProperty` variant that dropped `contentType` also stored nothing.)

## Do — make body persistence ROBUST (never drop content that exists)

1. **Diagnose the exact runtime value first** (the house "verify live" rule): add a one-line debug log of
   `typeof p.body`, `p.body?.contentType`, `p.body?.content?.length` in the handler, drain ONE real job through
   `/api/bridges?_route=worker&batch=1`, and read what the handler actually sees. Report it. (This settles
   whether `p.body` is an object or a stringified JSON at runtime.)
2. **Fix the split so content is never dropped:**
   - If `p.body` is a **string** (stringified JSON), `JSON.parse` it first (guarded).
   - Normalize `contentType` case-insensitively (`String(contentType).toLowerCase().trim()`).
   - **When `content` is present but `contentType` is missing/unrecognized, SNIFF it:** HTML if it matches
     `/<\s*(html|body|div|p|table|span|a|br|meta)\b/i` (or starts with `<`), else text. Never leave a non-empty
     `content` unstored.
   - Store: `body_html = content` when html, `body_text = content` when text; set `body_format` accordingly.
     A non-empty `content` must ALWAYS land in one of the two columns.
3. **Don't regress the empty case:** a genuinely bodyless message (`content` null/empty) still writes NULLs — no
   fabrication.
4. **Backfill the already-swept rows:** the 24 (and any others) have correct payloads in `enrichment_jobs` but
   empty body columns — re-drive them through the fixed handler (re-enqueue, or a one-shot that reprocesses the
   recent `outlook.message.extract` jobs), so the fix is provable on existing data without asking Scott to
   re-sweep. The upsert updates in place (proven by `source_user_id`).

## Acceptance
- Live: after the fix + re-drive, `select count(*) from email_bodies where coalesce(length(body_html),0)>255 or
  coalesce(length(body_text),0)>255` climbs from 0 to ≥ the swept-and-tracked count; spot-check one row shows the
  full HTML in `body_html` + `body_format='html'`. Report the number.
- The debug finding from step 1 (what `p.body` actually was at runtime) recorded in the fix + the sweep doc.
- Structural test in the bridge test suite: a job payload with `body:{contentType:'html',content:'<html>…'}`
  persists `body_html`; one with `contentType` missing but HTML content still persists `body_html` (sniff); a
  `text` one persists `body_text`; an empty body persists NULLs (no fabrication).
- Draft-assist/voice readers already prefer the full body (Prompt 110 `pickBestBody`) — no reader change; note
  the corpus now fills.
- Docs: update `docs/setup/OUTLOOK_BODY_SWEEP_FLOW.md` with this root cause (payload was fine; the handler split
  dropped it) + a STATUS entry. Prompt → `done/`.

Small, targeted, additive. Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the
post-fix live body count.
