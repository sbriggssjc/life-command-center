# Flow Detail: SyncFlaggedEmailstoSupabase (Two Variants)

Last updated: 2026-05-12
Flow exports:
- `SyncFlaggedEmailstoSupabase_20260512135251.zip` (Graph Pull Variant)
- `SyncFlaggedEmailstoSupabase_20260512135136.zip` (Supabase Push Variant)

## Intent
Support flagged-email synchronization pipeline, currently represented by two distinct flow implementations.

## Variant A: Graph Pull (20260512135251)
- Trigger: `Recurrence` daily.
- Primary action: `Get_emails_(V3)` (`GetEmailsV3`) from `Inbox`.
- Parameters observed:
  - `folderPath=Inbox`
  - `importance=Any`
  - includes unread/attachment-related filters.
- Connectors: `shared_office365`.
- Credential scan: no plaintext bearer/apikey signals detected.
- Definition SHA256:
  - `f4d2b5e379797fe3431df0aacb7cc48bb8ce244895fabcbba81f3b813a03e9b2`

## Variant B: Supabase Push (20260512135136)
- Trigger: `Recurrence` daily.
- HTTP POST endpoint:
  - `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/flagged-emails`
- Includes `apikey` and `Authorization` headers inline in definition.
- Additional Office action:
  - `Send_an_HTTP_request` (`HttpRequest`).
- Connectors: `shared_office365`.
- Credential scan: plaintext credential signals detected.
- Definition SHA256:
  - `736d1f8ae409770557af0f6c5d9d29244d8680c4458cdd00a67420ac199b33e3`

## Key Risks
1. Duplicate-purpose variant flows can drift semantically and operationally.
2. P0 credential exposure in Push Variant export definition.
3. No single canonical contract/version marker between variants.

## Required Immediate Remediation (P0)
1. Rotate exposed Supabase keys used by Push Variant.
2. Replace inline auth headers with secure references.
3. Re-export and verify no credential material in definitions.
4. Decide canonical variant or explicit split-responsibility model.

## Recommended Architecture Decision
1. Select one canonical flagged-email sync design and retire/disable the other.
2. If both must remain, add:
   - explicit ownership boundaries,
   - non-overlapping schedules,
   - documented idempotency keys,
   - shared schema version.

## Change Tracking Hooks
- Variant A snapshot hash (pre-change): recorded above.
- Variant B snapshot hash (pre-change): recorded above.
- Last validated run ids: `TBD`
- Credential rotation completed (Variant B): `TBD`

