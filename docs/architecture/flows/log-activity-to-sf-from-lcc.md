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
