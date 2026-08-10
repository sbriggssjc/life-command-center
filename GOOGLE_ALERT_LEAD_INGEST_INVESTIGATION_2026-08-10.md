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
