# FLOWS1-artifact — the Get Artifact flow now returns metadata + link; LCC still expects `content_base64`, and two crons keep asking every 30 minutes

**Filed:** 2026-09-16 (Cowork), from Scott's exported flow definitions in `docs/claude-code/SB notes/`
(`Http-Getfile(LCCGetArtifact)_20260916150744.zip`). **Owner:** LCC (`api/_shared/storage-adapter.js`,
`api/_handlers/intake-extractor.js`, the two pg_cron/Railway ticks) + one small flow addendum for Scott.
**Backlog:** `FLOWS1-crons` (this supersedes it), `FLOWS1`.

## What is true right now (read from the export, not assumed)

Scott applied F1 **option B**. The flow's `Response` action now runs after a new
`Get file metadata using path` and returns
```
{ "name": …, "size": …, "link": …, "path": … }
```
LCC's caller `fetchSharepointBytes()` (`storage-adapter.js:346`) still expects
`{ ok: true, content_base64, content_type }` and returns `pa_fetch_failed` on anything else. So **as
of the export, every Get Artifact call from LCC fails softly** — the 709/week `InvalidTemplate` failures
have become 100% `pa_fetch_failed` on our side (the digest will go quiet; the ingestion did not get
better). The ~100/day cadence comes from `lcc-document-text` and `lcc-cre-doc-text-backfill`
(30-minute ticks, overlapping) re-asking for the same large file that could never be served.

LCC cannot download a SharePoint sharing link on its own — that is why the PA proxy exists — so
"follow the link" is not a fix for the bytes.

## What to build

1. **Restore the bytes for files that can be served, keep the metadata for those that cannot.**
   Flow side (addendum F1c for Scott, in `OPERATOR-CHECKLIST.md`): after `Get file metadata using
   path`, a **Condition** `Size < 20000000` (20 MB — measure the real chunking threshold from the
   failing file's size in the metadata and set it under that): *true* → `Response` with the old
   contract `{ ok:true, content_base64: base64(body('Get_file_content_using_path')), content_type }`
   (this file was never the problem for small files); *false* → the new metadata `Response` with
   `ok:false, reason:"too_large"` added. LCC side: `fetchSharepointBytes` accepts **both shapes**:
   bytes → as today; `reason:"too_large"` (or a `size` above the cap) → returns
   `{ ok:false, reason:'too_large', size, name }` — a distinct, terminal reason, never `pa_fetch_failed`.
2. **Stop the retry storm.** In the document-text tick and the backfill tick: a per-artifact
   attempt counter (`artifact_fetch_attempts`, or a column on the existing artifact row — say
   which); after **3** failures with a terminal reason (`too_large`, 404, `path_invalid`) the artifact
   is marked `fetch_dead_letter` with the reason and **skipped** by both ticks; a non-terminal failure
   (5xx, timeout) keeps retrying with backoff (30 min → 2 h → 8 h). A `v_artifact_fetch_dead_letter`
   view lists them for the operator. Measure and report: how many distinct artifacts produced the
   709, their sizes, and how many land in the dead letter on first run.
3. **Size-aware requests.** Where the artifact row already carries a size (SharePoint metadata
   captured at discovery — `sf-file-discovery` flow, `docs/flows/FLOW_sf_file_discovery.md`), do not
   ask the flow for files above the cap at all; mark them `too_large` at discovery.
4. Tests: both response shapes; the dead-letter transition on the third terminal failure; a
   non-terminal failure does not dead-letter; a too-large artifact is never requested.

## Prohibitions

- ⛔ Do not edit `flow-*.json` exports; the flow addendum goes to Scott via the checklist.
- ⛔ No silent skip — every dead-lettered artifact is visible in the view with its reason.
- ⛔ Redeploy both Railway services and confirm `/version` before calling it live.

## Reporting

The artifact histogram behind the 709 (count · size · name), the dead-letter count after the first
tick, the before/after `pa_fetch_failed` rate in the tick logs, and the F1c flow addendum text for the
checklist. If any step was skipped, say so.
