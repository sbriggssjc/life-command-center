# Flow Detail — Log Activity to SF from LCC

## Metadata
- Export artifact: `LogActivitytoSFfromLCC_20260512135623.zip`
- Display name: `Log Activity to SF from LCC`
- Trigger: HTTP (`manual`)
- Connector: `shared_salesforce`

## Purpose
Accept LCC-origin activity payloads and write activity records into Salesforce.

## Risks
1. Direct CRM mutation over HTTP trigger requires strict auth and operation allowlist.
2. Missing contract versioning can produce silent data-quality drift.

## Improvements
1. Enforce payload schema with `schema_version`.
2. Require correlation ID and audit writeback to Supabase.
3. Add dead-letter record for failed Salesforce writes.
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

