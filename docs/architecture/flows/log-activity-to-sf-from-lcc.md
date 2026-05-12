# Flow Detail: LogActivitytoSFfromLCC

Last updated: 2026-05-12
Flow export: `LogActivitytoSFfromLCC_20260512135623.zip`

## Intent
Accept manual request payload from LCC integration path and create a Salesforce `Task` activity record.

## Trigger
- Type: `Request` (`manual`)
- Connector: `shared_salesforce`

## High-Level Action Topology
1. Receive request payload.
2. `Create_record` (`PostItem_V2`) on Salesforce `Task` with fields:
   - `WhoId`
   - `WhatId`
   - `Subject`
   - `ActivityDate`
   - `Status`
   - `Description`
3. Return `Response` status 200.

## Key Risks
1. Manual mutation endpoint requires strict auth/correlation guardrails.
2. No explicit schema version check in flow layer.

## Evidence Snapshot
- Definition SHA256:
  - `f4d557944514ce22d9c320f82480dd8f412ee34ed98047b7e0295ba147386efc`

