# Runbook — Repair Disabled HTTP Init LLC Flow

Last updated: 2026-05-12
Flow: `Http -> Init LccApiKey,Call prepare-upload,Parse prepare response,D...`
Flow ID: `ab11601a-b7d7-4efa-8f3a-52873e873270`

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
