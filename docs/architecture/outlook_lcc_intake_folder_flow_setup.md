# LCC Intake Folder Flow — Setup Notes

Companion to `flow-outlook-lcc-intake-folder-to-teams.json`. Replaces the flag-based intake flow that was hitting `Action 'Flag_email_(V2)' failed: The specified object was not found in the store`.

## What changed vs. the prior flow

| Prior design                                | New design                                              |
| ------------------------------------------- | ------------------------------------------------------- |
| Trigger: `When an email is flagged (V3)` on `Inbox` | Trigger: `When a new email arrives in a folder (V3)` on `Inbox/LCC Intake` |
| Required user (or helper flow) to flag mail | Drop email into `LCC Intake` folder — done              |
| Used `Flag_email_(V2)` as state signal      | Uses **Move email (V2)** to `Inbox/LCC Processed`       |
| Calls `POST /api/sync?action=ingest_emails` (batch) | Calls `POST /api/intake-outlook-message` (single event) |
| Failure: silent / retried                   | Failure: moves source to `Inbox/LCC Failed` and posts Teams alert |

The Move action does not require the message id to be re-resolvable in a different folder context the way Flag does, so it sidesteps the "object not found in store" class of error entirely.

## Folder prerequisites in Outlook

Create these three folders under your Inbox before importing the flow:

- `Inbox/LCC Intake` — drop OMs and intake-worthy emails here
- `Inbox/LCC Processed` — successful ingests are auto-moved here
- `Inbox/LCC Failed` — failed ingests are auto-moved here for re-drive

If the folder names don't match exactly (case-sensitive in some tenants), update the `INTAKE_FOLDER_PATH`, `PROCESSED_FOLDER_PATH`, and `FAILED_FOLDER_PATH` parameters at import time.

## Import steps

1. In Power Automate, **My flows → Import → Import package (legacy)** (or **Import → Solution** if the flow lives in a Dataverse solution).
2. Upload `flow-outlook-lcc-intake-folder-to-teams.json`.
3. Resolve the two connection references:
   - `shared-office365` — pick or create the Office 365 Outlook connection bound to the mailbox that owns the `LCC Intake` folder.
   - `shared-teams` — Teams connection for the notification channel.
4. Set parameters:
   - `LCC_HOST` — usually the Vercel host already in the file.
   - `LCC_API_KEY` — value from Vercel env vars (the same key the front-end auth interceptor injects).
   - `LCC_WORKSPACE` — the workspace UUID for this tenancy.
   - `INTAKE_FOLDER_PATH` / `PROCESSED_FOLDER_PATH` / `FAILED_FOLDER_PATH` — defaults shown above; change if your Outlook structure differs.
   - `TEAMS_TEAM_ID` / `TEAMS_CHANNEL_ID` — target Teams channel.
5. Save and turn the flow ON.
6. Turn OFF the prior flag-based flow (`flow-outlook-intake-to-teams` and `flow-outlook-intake-to-teams-hardened`) so the same email isn't ingested twice.

## Test plan with US Renal Care – Hondo OM

1. With the new flow ON and the old ones OFF, drop the `US Renal Care - Hondo, TX - On-Market.eml` into Outlook (forward it to yourself or save into Inbox), then move it into `Inbox/LCC Intake`.
2. Within ~30 seconds the trigger should fire. In Power Automate run history, confirm:
   - `When a new email arrives in a folder (V3)` — succeeded, returned a `body/id`.
   - `HTTP_IntakeOutlookMessage` — 200 with a `correlation_id` in the response body.
   - `HTTP_GetIntakeSummary` — 200 with one item.
   - `Move_email_(V2)_ToProcessed` — succeeded.
   - `Post_AdaptiveCard_To_Teams` — succeeded.
3. In Outlook the email should now be sitting in `Inbox/LCC Processed`.
4. In LCC, open `?page=pageInbox` — the US Renal Care – Hondo item should be the latest row, with the OM attachment listed in its staged intake artifacts.

## If `HTTP_IntakeOutlookMessage` returns non-2xx

The `Scope_OnFailure` branch will:
1. Move the source email into `Inbox/LCC Failed`.
2. Post a Teams alert with the status code and error body.

Re-drive: drag the email from `LCC Failed` back to `LCC Intake` and the trigger will fire again. `correlation_id` is deterministic on `workspace + message_id + received_time` so the LCC inbox dedupes the second attempt.

## Why this avoids the original error

`Flag email (V2)` requires Exchange to look up the message in the store at exactly the encoding it was given. New-email-in-folder triggers emit a folder-bound id; flag actions default to mailbox-root lookup; the two encodings can disagree, especially on shared/delegate mailboxes — that produces the `object was not found in the store` error you saw.

`Move email (V2)` accepts the trigger's id directly via the URL path (`/v2/Mail/{messageId}/move`), so the lookup happens in the same context the trigger emitted from. There is no second resolution step that can fail.
