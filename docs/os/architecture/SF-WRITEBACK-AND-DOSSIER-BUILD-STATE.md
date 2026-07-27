# Deal Dossier + Salesforce Write-Back — Build State & Resume Guide
_Last updated: 2026-07-27 (Cowork session)._ Status: **LIVE and proven end-to-end.**

## What this is
Two connected capabilities, both LCC-brokered (Copilot/ChatGPT never touch Salesforce directly):
1. **Deal Dossier** — a living, per-deal context projection (snapshot + milestone timeline + correspondence) read by any surface.
2. **Salesforce write-back** — LCC is the single SF writer; activity is recorded in LCC as system of record and a *link-only* touchpoint is pushed to Salesforce.

## Governing design principles (confirmed with Scott)
- **LCC is the system of record.** All deal activity/dialogue lives in LCC (`activity_events`, surfaced by the dossier).
- **Salesforce = generalized BD touchpoints against individuals only.** A call *with a person* → LCC record **and** a Salesforce Task on that contact. A *deal-level* call → **LCC only**, no SF task.
- **Link-only egress.** The Salesforce Task's `Description` is just `Ref: <lcc_activity_id>` — interaction notes are NEVER synced out of LCC.
- **Reconcile-or-refuse.** Writes resolve to a unique entity or refuse (no blind writes).
- **Confirmation at the surface layer** (agent asks "shall I?"), NOT an HTTP 428 (Copilot treats non-2xx as ConnectorRequestFailure).

## End-to-end flow (BD call)
```
Copilot agent (LogSalesforceActivity)
  → LCC /api/sf/log-activity  (mcp/sf-writeback.js)
      • resolve deal OR person (entities: person|asset)
      • WRITE full call to activity_events (category=call, source_type=lcc:copilot)  ← system of record
      • ENQUEUE sf_sync_queue { kind:'log_call', payload:{entity_id, subject, lcc_activity_id, lcc_ref}, status:pending }  ← NO notes
  → PA flow "LCC → SF Queue Drainer" (recurrence, every 5 min)
      • GET pending log_call rows
      • resolve entity_id → unified_contacts.sf_contact_id / sf_account_id
      • IF sf_contact_id → POST existing "Log Activity to SF from LCC" flow → creates SF Task (Description="Ref: <lcc_activity_id>")
        ELSE → mark row done result.lcc_only=true  (deal-level, no SF)
      • PATCH sf_sync_queue status=done, result={sf:{taskId}}
```

## Components & locations
| Piece | Where |
|---|---|
| Dossier tools (`get_deal_dossier`, `list_deal_checkpoints`, `update_deal_dossier`) | `mcp/deal-dossier-tools.js` (registered in `mcp/server.js`) |
| SF write-back (`logActivity`, `createTask`, `updateOpportunity`) | `mcp/sf-writeback.js` (registered in `mcp/server.js`) |
| HTTP routes | `mcp/server.js` (`/api/deal/dossier`, `/api/deal/checkpoints`, `/api/sf/*`) proxied from root `server.js` via `api/ai-read.js` |
| Canonical connector (53 ops, dialog-safe) | `copilot/lcc-deal-intelligence.connector.v4.swagger.json` |
| Additive connector (94 ops, interim) | `copilot/lcc-deal-intelligence.connector.v3.swagger.json` |
| ChatGPT spec (3.1.0) | `docs/comps-rollout/lcc-openapi.yaml` |
| PA flow — SF Task creator (HTTP-triggered, link-only) | "Log Activity to SF from LCC" (unchanged) |
| PA flow — queue drainer (NEW, recurrence) | "LCC → SF Queue Drainer" — build spec: `docs/os/architecture/LCC-SF-Queue-Drainer-Flow-Build.md` (delivered) |

## Data model
- **`entities`** — deals are `entity_type='asset'`; people are `entity_type='person'`.
- **`activity_events`** — dossier correspondence = category in (email,call,meeting,note); milestones = category='status_change' + `metadata.milestone`. Required: workspace_id, actor_id, category, title. Service actor = `b0000000-0000-0000-0000-000000000001`; primary workspace = `a0000000-0000-0000-0000-000000000001`.
- **`sf_sync_queue`** — CHECK-constrained `kind` vocabulary (this IS the poller's contract):
  `find_account, find_contact, link_account, link_contact, create_account, create_contact, update_account, update_contact, log_call, create_task, create_opportunity, update_task_date, complete_task, advance_opportunity_stage, merge_accounts, merge_contacts`. status ∈ (pending, processing, done, failed).
- **`unified_contacts`** — maps `entity_id → sf_contact_id, sf_account_id` (the drainer's resolution source). `full_name` is a GENERATED column (never insert).

## Kind mapping (LCC action → sf_sync_queue kind)
- log a call → **`log_call`**
- create a task → **`create_task`**
- update opportunity → **`advance_opportunity_stage`** (STAGE only today; payload `{entity_id, stage}`)

## Proven (2026-07-27)
- Dossier read/checkpoints live; **Fresenius Woodland Hills** seeded (entity `a0feab2e-…`, 7 milestones + 5 correspondence).
- Deal-level call (Fresenius) → LCC only, row `lcc_only`. ✅
- BD call (**Frank Meyrath**, entity `7aebfdd4-…`, manually resolved + linked to SF contact `0038W00002PRdhPQAT` / account `0018W00002X0nZSQAZ`) → LCC record **and** SF Task `00TVs00001ND0eFMAT`, Description `Ref: bb8c8795-…`. ✅

## Extension points / open items (resume here)
1. **Drainer → other kinds.** Same 3-step pattern (resolve → call flow → mark done) for `create_task` and `advance_opportunity_stage`. The `create_task`/opportunity paths in `sf-writeback.js` already enqueue; only the drainer branch is missing. Note: the existing SF flow creates *Tasks*; stage advance / task-with-due-date may need a second SF flow or an extended one.
2. **Connector description.** Write-action target field still says "deal" — update to "deal or person" for reliability; small v4 re-import.
3. **updateOpportunity fields.** Only `stage` is wired (→ advance_opportunity_stage). close_date/amount/probability/next_step need a poller kind + SF field mapping.
4. **Idempotency.** On connector retry, `logActivity` can write a duplicate `activity_events` row before the enqueue succeeds (mitigated once enqueue works). Add an idempotency key if retries recur.
5. **Security.** Rotate the Supabase `service_role` key (it appeared in a PA run output); enable **Secure Inputs** on the drainer's Supabase HTTP steps.
6. **Contact onboarding.** Frank Meyrath was resolved manually (entity + unified_contacts). A repeatable "resolve a deal's roster into LCC + link SF" path would remove the manual step.

## Deploy notes (learned the hard way)
- The **engine** (`life-command-center`) deploys from the **`mcp/` folder** — engine-side modules must live in `mcp/` and import via `./` (NOT `../api/`).
- Copilot Studio custom connectors require **Swagger 2.0** and reject bare `{ "type":"object" }` (→ `dialogId` error). All connector objects use `additionalProperties:true` or typed properties.
- Power Automate "Parse JSON": the **"Use sample payload to generate schema"** button wants SAMPLE DATA, not a schema. Reference loop items as `items('Apply_to_each')?['payload']?[...]`, never `body('Parse_Rows')?['items']?['properties']`.
