# Runbook — Repair Disabled HTTP Init LLC Flow

Last updated: 2026-05-13
Flow: `Http -> Init LccApiKey,Call prepare-upload,Parse prepare response,D...`
Flow ID (prod, disabled): `ab11601a-b7d7-4efa-8f3a-52873e873270`
Flow ID (non-prod repair clone): `85d46fdb-444e-4411-9fa6-c8c5334ac95c` — `NONPROD - HTTP Init LLC (Repair 2026-05-13)` (status: Off)

## Root Cause (confirmed 2026-05-13 from run `08584242178017804502392990635CU06`)
Browser inspection of the most recent failed run (Apr 28 2026, 10:11 AM Local) revealed the failure is NOT a structural definition error and NOT an upstream HTTP fault.

Action-by-action result chain:
- `manual`, `Init LccApiKey`, `Call prepare-upload`, `Parse prepare response`, `Decode bytes`, `PUT to Supabase`, `Call stage-om`: all green/successful.
- `Parse stage response`: succeeded structurally (JSON parsed correctly).
  - **Parsed body content**: `{ "ok": false, "skipped": "deed_or_loan_pdf", "detail": "Skipped Loan - 215-225 S Allison Ave.pdf — d..." }`
  - This is a *correct* LCC API soft-skip behaviour: `/api/stage-om` deliberately rejects attachments classified as deeds/loans because OM intake should only process marketing/offering materials.
- `Delay`: ran (5s).
- `Call extract`: failed with `BadRequest` (HTTP 400).
  - URI evaluated to `https://life-command-center-nine.vercel.app/api/intake-extract?intake_id=` — i.e. `intake_id=` with no value. `intake_id` was null/empty because the upstream stage call skipped.
  - LCC API correctly returned 400 on empty intake_id.
- `Parse extract response` and `Respond`: skipped (because Call extract failed).

So the flow has been failing for 14 days because **every triggered run involved an attachment classified as a non-OM doctype** (or some other soft-skip condition). The platform auto-disabled it on 2026-05-08 after that 14-day streak.

## Correct Fix Pattern (revises the original "fault branches everywhere" plan)
The original runbook plan ("add fault branches, scoped retries, parse guards") would not have caught this failure mode because:
1. The HTTP layer succeeded (200 OK from `/api/stage-om`).
2. Retries would just re-run the same 200 → ok=false response.
3. Fault branches trigger on `has failed` / `has timed out`, not on a successful action whose body content is a logical failure.

The real fix is a logical-state Condition step:

```
After Parse stage response:
  Condition: outputs('Parse_stage_response')?['body']?['ok'] is equal to true (boolean)
    If yes  → existing chain: Delay → Call extract → Parse extract response → Respond (success body)
    If no   → new Respond action returning the parsed stage-body verbatim with HTTP 200
              (the LCC client/PA caller can read body.skipped or body.detail to know which doctype was bypassed)
```

## Step-by-Step Repair Sequence (revised)
1. Clone flow to non-prod. ✅ DONE: `85d46fdb-444e-4411-9fa6-c8c5334ac95c` (`NONPROD - HTTP Init LLC (Repair 2026-05-13)`).
2. In the clone editor, insert a Condition action between `Parse stage response` and `Delay`.
3. Set Condition expression: `body('Parse_stage_response')?['ok']` equals `true` (boolean).
4. Move the existing Delay → Call extract → Parse extract response → Respond chain into the **If yes** branch.
5. Add to **If no** branch: a `Response` action with status 200, body = `body('Parse_stage_response')`, content-type `application/json`. This converts the silent failure into an explicit, observable 200 + skip body returned to the caller.
6. Hardening on the extract HTTP action (kept from original runbook):
   - Set retry policy: Exponential, count 2, interval `PT5S` (in case of transient extractor 5xx).
   - Add fault branch (Configure run after on a downstream Scope): if Call extract `has failed` or `has timed out`, write a dead-letter row to LCC.
7. Validation in non-prod:
   - Test A (soft-skip): trigger with a `deed_or_loan_pdf` payload → expect the If-no branch → response 200 with `ok: false`, `skipped: "deed_or_loan_pdf"`. Run must show as Succeeded.
   - Test B (success): trigger with a valid OM payload → expect If-yes branch → response 200 with extraction body.
   - Test C (forced 4xx from extractor): briefly point Call extract at a 400-returning URL → expect dead-letter branch to fire.
8. Promote: only after Test A passes (Run = Succeeded) and Tests B + C produce expected branch behaviour.
9. Re-enable production: copy the corrected definition into the original prod flow ID (or replace it), then `Turn on`.

## Production Promotion Method (chosen 2026-05-13)
Save-As cloning into the same environment means there are now two flows with overlapping prod state. After non-prod validation, the chosen promotion path is:
1. Export the NONPROD clone as a Package (.zip).
2. Open the original disabled flow, click `Edit`, hand-replicate the Condition + branch structure (or use the Import option if the original is first deleted).
3. Confirm action names match (`Call extract`, `Parse extract response`, `Respond`) so referenced expressions in any external systems still resolve.
4. Click `Turn on`. Watch the next 24h of runs.
5. Once prod is stable (>=2 consecutive Succeeded runs OR consistent expected-skip behaviour), delete the NONPROD clone.

## Validation Evidence Captured
- Failed prod run inspected: `08584242178017804502392990635CU06` (Apr 28 2026, 10:11 AM Local).
- Failed action: `Call extract`, status 400, URI evaluated with empty `intake_id`.
- Upstream cause: `Parse stage response` body `ok: false, skipped: "deed_or_loan_pdf"`.
- Security finding (folded into Task 8): X-LCC-Key visible in plaintext in run header (prefix `2e046e98d331df549b23a8f15a5a07de7ab16737c5...`).

## Current Action Chain
1. `Init_LccApiKey`
2. `Call_prepare-upload`
3. `Parse_prepare_response`
4. `Decode_bytes`
5. `PUT_to_Supabase`
6. `Call_stage-om`
7. `Parse_stage_response`
8. `Delay`
9. `Call_extract`
10. `Parse_extract_response`
11. `Respond`

## Step-by-Step Repair Sequence
1. Clone flow to non-prod with same definition.
2. Add fault branches on each HTTP action:
   - timeout
   - 4xx
   - 5xx
3. Add scoped retries:
   - `Call_prepare-upload`: max 2 retries, exponential.
   - `PUT_to_Supabase`: max 1 retry, no duplicate PUT without idempotency token.
   - `Call_stage-om` and `Call_extract`: max 2 retries.
4. Validate parse guards:
   - If `Parse_prepare_response` fails, terminate with structured error response.
   - If `Parse_stage_response` missing expected keys, terminate and notify.
   - If `Parse_extract_response` invalid, write incident record and fail closed.
5. Add correlation payload:
   - `correlation_id`
   - `source_flow_run_id`
   - `attempt_number`
6. Replace inline key variable usage with secured reference source.
7. Test cases in non-prod:
   - Success path with valid payload
   - Forced failure at `Call_prepare-upload`
   - Forced failure at `PUT_to_Supabase`
   - Forced failure at `Call_extract`
8. Re-enable production only after two consecutive successful non-prod runs and one controlled failure-path pass.

## Validation Evidence to Capture
1. Non-prod run IDs (success + failures).
2. Updated flow export artifact checksum.
3. Production re-enable timestamp and first clean run ID.

## Rollback
1. Disable modified prod flow.
2. Re-import last-known-good export.
3. Re-test single controlled payload before reopening trigger path.
