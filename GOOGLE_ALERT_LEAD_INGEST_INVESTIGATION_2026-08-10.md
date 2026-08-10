# Google Alert Lead Ingest Investigation - 2026-08-10

## Objective

Investigate why two saved Google Alert emails are not being read and sorted into LCC, and clarify what happens after successful sorting: whether source emails become read and where resulting leads are surfaced for follow-up.

Sample messages:
- `C:\Users\scott\Downloads\Google Alert - _department of administrative services_.eml`
- `C:\Users\scott\Downloads\Google Alert - square foot clinic.eml`

## Current Architecture Notes

- Current production channel is Power Automate -> `POST /api/lead-ingest?action=news_alert`.
- Railway `server.js` mounts `/api/lead-ingest`, then `api/sync.js` proxies to the Supabase edge function `lead-ingest`.
- `news_alert` records leads in LCC Opps `public.news_alert_leads`, not DIA `marketing_leads`.
- App follow-up surfaces are the database views `v_news_alert_review_queue` and `v_news_alert_developer_queue`.
- Email filing/read behavior is not inline in the Google Alert flow. The handler emits `processing_log` decisions; a separate processing-complete Power Automate pull-queue moves filed messages to `Processed/Leads` or duplicates to `Processed/Duplicates`.

## Investigation Log

- Read `CLAUDE.md`, `.github/AI_INSTRUCTIONS.md`, and `docs/architecture/flows/google-news-alert-power-automate.md`.
- Identified key flow footgun in docs: PA `raw_body` must be the email body / Html-to-text output, not `sensitivityLabelInfo`.
- Parsed the two `.eml` samples with `.tmp_verify_google_alert_eml.mjs`.
  - Both messages have visible `From: Google Alerts <googlealerts-noreply@google.com>`.
  - Both messages have `Return-Path: sbriggssjc+caf_=sabriggs=northmarq.com@gmail.com`, and outer Microsoft auth reports `smtp.mailfrom=gmail.com`; a PA trigger filtering the wrong sender field can miss them before LCC.
  - Both messages have usable `text/plain` and `text/html` bodies.
  - Production classifier routes both samples to low-confidence review:
    - `"department of administrative services"`: no tracked-tenant match, confidence `0.23`, route `review`, status `needs_review`.
    - `square foot clinic`: no tracked-tenant match for this specific article, confidence `0.23`, route `review`, status `needs_review`.
- Live OPS probe:
  - Existing `Google Alert - square foot clinic` rows are present in `news_alert_leads`, proving the general ingest path is active.
  - Exact saved sample message IDs are not present in `news_alert_leads` and not present in `processing_log`, so these two specific emails did not reach LCC.
  - Queue probes for both `v_news_alert_review_queue` and `v_news_alert_developer_queue` succeed, but code search found no frontend/API reader outside docs/migrations; follow-up is in OPS tables/views, not clearly surfaced in the app UI.
  - `processing_log` live columns include `final_target_folder` but not `clear_flag`; this is compatible with the Google Alert edge emitter, which does not insert `clear_flag`.

## Findings

1. These two saved messages were not read/sorted because they never reached LCC. The likely failure point is Power Automate trigger/routing, not the LCC parser or DB.
2. If posted correctly, both samples classify as low-confidence `needs_review`, not auto-filed leads.
3. Successful Google Alert leads land in OPS `news_alert_leads`; follow-up queues are `v_news_alert_review_queue` for low-confidence items and `v_news_alert_developer_queue` for auto-created `developer_unknown` items.
4. Current repo docs said those queues are surfaced by the app, but grep found no app reader. This is a product gap to fix if Scott expects an in-app follow-up lane.
5. Email read state is owned by Power Automate/Outlook, not LCC. Updated the Google Alert flow runbook to mark the message read after a successful ingest POST.

## Power Automate Export Review

Export reviewed: `C:\Users\scott\Downloads\GoogleNewsAlert→LCCLeadIngest_20260810125008.zip`.

Actual flow findings:

- Trigger watches a specific folder id labeled `SBRIG GMAIL`. Scott confirmed this is the correct Google Alert landing folder: `Inbox/RESEARCH/SBRIGS GMAIL`.
- Trigger filters `from = googlealerts-noreply@google.com`; forwarded samples still show this visible `From`, but the envelope/return path is Gmail, so verify run history to confirm the connector's `from` filter uses visible From for these forwarded messages.
- The flow POSTs to the correct Railway endpoint: `/api/lead-ingest?action=news_alert`.
- Payload uses `source_ref = internetMessageId` but does not send a separate `internet_message_id`. The edge handler falls back to `source_ref`, so this is workable, but it loses the clean separation between stable message key and mutable Graph id that the runbook expects.
- `raw_body` is `body('Html_to_text')`; the runbook expects the explicit text output. Confirm from run history whether this is a string. If it is an object, LCC receives junk and the classifier degrades.
- Parse JSON schema expects `lead_id`, but the edge response returns `news_lead_id`. This does not break the archive condition, but it is stale.
- The flow still moves auto-classified alerts inline to an `Archive` folder when `archive = true`; current architecture expects moves to be deferred through `processing_log` / processing-complete into `Processed/Leads` or `Processed/Duplicates`.
- Mark-as-read only runs after the inline move and only in the `archive=true` branch. Review alerts (`archive=false`) are never marked read.
- The export contains the webhook secret inline in the HTTP action. Treat that as exposed configuration: rotate the secret and move it to a secure/environment reference.

Operational fixes needed in PA:

1. Keep the trigger folder pointed at `Inbox/RESEARCH/SBRIGS GMAIL`.
2. Keep the POST, but send `{ source_ref: trigger id, internet_message_id: internetMessageId, subject, raw_body: Html_to_text text }`.
3. Add Mark as read immediately after successful POST for both auto and review outcomes.
4. Prefer removing the inline Move action and let LCC processing-complete handle `Processed/Leads` and `Processed/Duplicates`; if keeping the existing Archive move short-term, move only after successful POST and read-mark, and understand this bypasses the centralized `Processed/*` cleanup/briefing design.
5. Rotate the exposed webhook secret.

## BD Pipeline Capability

Existing capabilities:

- `POST /api/operations?action=create_lead` can create domain lead rows and a LCC `bd_opportunities` prospect opportunity when a domain property id is known:
  - gov -> `prospect_leads`
  - dia -> `marketing_leads`
  - LCC -> `bd_opportunities` + cadence
- `POST /api/operations?action=open_opportunity` can open/reuse a prospect opportunity for an existing LCC entity.
- Listing BD machinery exists for active listings and owner/contact outreach (`listing_bd_trigger` inbox items and draft consumer).

Missing for news alerts:

- No current UI/API reader was found for `v_news_alert_review_queue` or `v_news_alert_developer_queue`.
- No current "review verdict -> create property/lead/opportunity" bridge was found for `news_alert_leads`.
- News-alert rows carry only article/tenant/location hints, not a domain property id. Promotion needs a human/AI review step to resolve or create the underlying property/entity before it can safely call the existing `create_lead` / `open_opportunity` paths.

## 2026-08-10 Follow-up: Centralized Mover Status

Scott updated the live Google Alert PA flow and confirmed a successful test. He kept the move step and pointed it to `Processed/Leads`.

Code review result:

- `lead-ingest?action=news_alert` correctly emits `processing_log` rows:
  - auto/filed -> `target_folder = Processed/Leads`, `move_status = pending`
  - duplicate -> `target_folder = Processed/Duplicates`, `move_status = pending`
  - review -> `target_folder = null`, `move_status = skipped`
- The documented batch GET pull-queue is not currently implemented in live `api/sync.js`.
- `/api/webhooks/processing-complete` currently accepts only `POST`; `GET` returns 405.
- The briefing code explicitly notes that pending moves are not cleared by a queue-drain consumer anymore.

Operational conclusion:

- Do **not** remove the PA move step yet.
- The live Google Alert PA flow should keep doing the move itself after successful ingest.
- Best short-term structure: POST -> Parse JSON -> Mark read -> if `target_folder` is not empty, Move to `target_folder` (currently `Processed/Leads` for auto leads).
- Longer-term centralized design requires building/reinstating a real pending-move drain or having the edge/LCC path call the existing POST relay immediately.

## 2026-08-10 Follow-up: News Alert Review Lane Slice 1

Objective: expose the existing OPS `news_alert_leads` queue in the LCC app before building the property/pursuit promotion bridge.

Changes made:

- Added `GET /api/news-alerts` through `api/admin.js` and Railway `server.js`.
  - `status=open` returns both `needs_review` and `developer_unknown`.
  - Also supports `needs_review`, `developer_unknown`, `dismissed`, `converted`, and `all`.
  - Response includes `counts` for the lane badge/filter chips.
- Added `POST /api/news-alerts` for operator dispositions:
  - `dismiss` -> `status='dismissed'`
  - `send_to_developer` / `mark_developer` -> `status='developer_unknown'`
  - `reopen` -> `status='needs_review'`
  - `mark_converted` -> `status='converted'` (reserved for the future promotion bridge)
  - Each disposition writes a `metadata.news_alert_review` audit object with previous status, action, note, reviewer, and timestamp.
- Added a `News alerts — review & promote` sub-lane in the Decision Center.
- Added `renderNewsAlertLane()` in `ops.js` with filter chips, article cards, open-article links, and actions to keep for developer research, dismiss, or reopen.

Still intentionally missing:

- No automatic property, lead, or `bd_opportunities` creation yet.
- The promotion bridge should be the next slice: review article -> resolve/create property/entity -> call the existing lead/opportunity machinery with provenance back to `news_alert_leads.news_lead_id`.

## 2026-08-10 Follow-up: News Alert Assist + Tracking Slice

Objective: use the local Ollama extraction seam as a proposal-only assistant inside the News Alert Review lane, and add a safe follow-up parking action before canonical property/BD creation.

Changes made:

- Added `api/_shared/news-alert-assist.js`.
  - Builds a grounded prompt from the existing `news_alert_leads` fields.
  - Extracts candidate project, parties, permits, timeline, debt/deed signals, and follow-up triggers.
  - Normalizes model output into a bounded JSON annotation.
  - Enforces the doctrine: Ollama annotates only; the human decides what becomes canonical.
- Added `POST /api/news-alerts` action `extract_details`.
  - Calls `invokeExtractionAI({ surface: 'news_alert_assist' })`.
  - Stores the normalized proposal in `metadata.news_alert_extraction`.
  - Does not change lead status or write any property/lead/opportunity data.
- Added `POST /api/news-alerts` action `create_tracking_task`.
  - Opens/idempotently reuses a `research_tasks` row with `research_type='news_alert_development_followup'`.
  - Uses `source_table='news_alert_leads'` and `source_record_id=<news_lead_id>` so repeated clicks do not spam the queue.
  - Stores the task linkage in `metadata.news_alert_tracking_task`.
  - Marks the alert `converted` so worked items leave the open News Alert Review lane and live under the Converted chip/audit trail.
- Updated the Decision Center card UI:
  - New `Extract details` button.
  - New `Create tracking task` button.
  - Converted alerts with a task show an `Open Research` button.
  - Inline assist summary showing recommended next step, parties, signals, and timeline when available.

Design note:

- This is not local-model "training" in the fine-tuning sense. It is a grounded extraction/evaluation loop. Each human review creates structured metadata that can later become an evaluation corpus for prompt/model tuning.
- Current extraction is limited to the fields already stored from the Google Alert email: headline, snippet/summary, URL, subject, tenant/domain/location hints. Full article-page extraction can be added later by fetching/snapshotting the article text into the same prompt input.

## 2026-08-10 Follow-up: Guided News Alert Pursuit UX

Scott tested the first live slice and found the generic More -> Research -> Active page did not expose a clear `news_alert_development_followup` filter; unrelated research widgets buried the created task. He also clarified the desired path:

1. Click `Create tracking task`.
2. Immediately enter a guided page for the alert.
3. Work through property/project, parties, owner/applicant/developer, permit/deed/debt/timeline signals.
4. Later bridge into property/contact resolution, BD pursuit creation, Outlook draft, Salesforce/LCC task/follow-up, and activity logging.
5. When resolved, return to the relevant queue.

Changes made:

- Added `opsResearchTypeFilter` and a `News Alert Follow-up` filter chip on the Research page.
- Research API calls now pass `research_type=news_alert_development_followup` when that filter is active.
- The unrelated LLC/agency/metadata widgets are hidden while a research-type filter is active so the matching tasks are visible immediately.
- `Create tracking task` now opens a guided `News Alert Pursuit` view inside the Decision Center instead of simply re-rendering the open alert list.
- Converted alert cards with a task now route to the filtered News Alert Research Queue.

Still next:

- Replace the static guided screen with real property/entity/contact resolution controls.
- Add the BD promotion bridge: resolved property/contact -> `bd_opportunities`/domain lead -> Outlook draft/template -> Salesforce/LCC task/follow-up logging.
