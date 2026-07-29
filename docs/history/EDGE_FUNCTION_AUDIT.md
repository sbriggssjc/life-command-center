# Edge Function Audit & Gap Register

> Last reviewed: 2026-05-10. Branch: `claude/optimize-cloud-subscriptions-KJT9J`.
>
> Mirrored in `Dialysis/EDGE_FUNCTION_AUDIT.md` because most of the LCC edge
> functions are physically deployed on the `Dialysis_DB` Supabase project
> (see “Architectural finding” below).

## TL;DR

- 21 edge functions exist across 3 Supabase projects (`Dialysis_DB` 15,
  `LCC Opps` 4, `government` 2).
- **3 are clearly safe to delete now** — scratch/debug stubs that have
  never been touched since the day they were deployed: `sf-test`,
  `test-function`, `ai-copilot-v2` (all on `Dialysis_DB`).
- **3 ‘active’ functions are duplicated** between `Dialysis_DB` and
  `LCC Opps`. The `Dialysis_DB` copies have been updated more recently
  and appear to be the live versions. The `LCC Opps` copies look
  abandoned but should be confirmed before deletion.
- **4 functions look real but I can’t confirm they’re wired up
  end-to-end** — they’ve only been deployed once, never updated, and
  the calling surface isn’t obviously connected: `salesforce-enrichment`,
  `intake-receiver`, `template-service`, `npi-registry-sync`. These are
  the gap-register entries below — each one represents real designed
  functionality that may or may not be in use today.

## Architectural finding (worth fixing eventually, not today)

The LCC frontend’s edge function suite is **deployed on the `Dialysis_DB`
Supabase project**, not on `LCC Opps`. Specifically:

- LCC `api/copilot-chat` hardcodes
  `DEFAULT_EDGE_FN_URL = "https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot"`,
  which is the `Dialysis_DB` project URL.
- `Dialysis_DB` hosts 11 functions whose code clearly belongs to LCC
  (`context-broker`, `copilot-chat`, `daily-briefing`, `data-query`,
  `intake-receiver`, `lead-ingest`, `template-service`, `health-check`,
  `npi-lookup`, `npi-registry-sync`, plus `ai-copilot` itself).
- `LCC Opps` has older copies of `context-broker`, `daily-briefing`, and
  `data-query`, plus a unique `availability-checker`. Its copies of the
  three duplicated functions were last updated weeks before the
  `Dialysis_DB` copies.

This is why the Supabase consolidation conversation is harder than it
looked: “move LCC into one project” isn’t actually a data migration —
LCC’s code already lives in the Dialysis project. What the user
actually needs is a small, deliberate cut-over: republish all the LCC
edge functions on `LCC Opps`, repoint `EDGE_FUNCTION_URL` /
`AI_CHAT_URL`, and then retire the duplicates from `Dialysis_DB`. Filed
as a gap below; not in scope for this branch.

## Function inventory

Legend: **KEEP** = live, cleanly wired. **DELETE** = stub, no callers.
**REVIEW** = real code but I can’t confirm it’s actually invoked.
**DUPLICATE** = exists on more than one project, decide which is
canonical.

### Dialysis_DB (project `zqzrriwuavgrquhisnoa`) — 15 functions

| Function | v | Last update | Verdict | Intent / current state |
|---|---|---|---|---|
| `ai-copilot` | 61 | 2026-05-04 | KEEP | Main copilot service. LCC `copilot-chat` calls this by default; many recent versions = active development. |
| `sf-test` | 12 | 2026-02 | **DELETE** | Salesforce SOAP login diagnostic. Tests SF credentials and queries 5 open tasks. Pure smoke-test scaffold; never touched after creation. No business consumer. |
| `salesforce-enrichment` | 10 | 2026-02 (creation) | REVIEW | 16-step CRM enrichment pipeline (`bridgeSFContactsToContacts`, `linkAccountsToTrueOwners`, `populateTouchpointSchedule`, ...). Real, well-structured code, but it’s only been deployed once and never iterated. **Gap A.** |
| `test-function` | 10 | 2026-02 | **DELETE** | Returns `{status:"ok", timestamp}`. Health-check stub superseded by the dedicated `health-check` function. |
| `ai-copilot-v2` | 9 | 2026-02 (creation) | **DELETE** | Returns `{status:"ok", message:"ai-copilot-v2 test"}`. Aspirational v2 placeholder that never grew past stub. |
| `health-check` | 9 | 2026-05-04 | KEEP | Cross-DB connectivity probe for ops/gov/dia + checks `context_packets`/`signals` table existence. Recently iterated. |
| `context-broker` | 3 | 2026-05-04 | KEEP (canonical) | LCC infrastructure: assemble/cache context packets. **Duplicates LCC Opps copy.** |
| `lead-ingest` | 3 | 2026-05-04 | KEEP | Power Automate webhook ingest for RCM + LoopNet emails. Wired into `data-query` as a redirect for `marketing_leads` writes. |
| `intake-receiver` | 3 | 2026-04-11 | REVIEW | Outlook flagged-email Power Automate ingest. Real code; deploy was a single push and untouched since. **Gap B.** |
| `copilot-chat` | 3 | 2026-05-04 | KEEP | AI chat with cross-DB context enrichment + voice diff capture. Active. |
| `template-service` | 2 | 2026-04-11 (creation) | REVIEW | Email template engine: generate/batch/record_send/performance/health. Single deploy, never updated. **Gap C.** |
| `data-query` | 11 | 2026-05-04 | KEEP (canonical) | Dual-source proxy with allowlists for gov + dia. Heavily used. **Duplicates LCC Opps copy.** |
| `daily-briefing` | 4 | 2026-05-04 | KEEP (canonical) | Reads cached briefings, supports cold-alerts and dashboard-widget actions. **Duplicates LCC Opps copy.** |
| `npi-lookup` | 2 | 2026-04-27 | KEEP | NPPES live API auto-fill for missing-NPI clinics. Idempotent. |
| `npi-registry-sync` | 1 | 2026-04-27 (creation) | REVIEW | Weekly nationwide NPPES ESRD sweep. Single deploy, never updated. Designed to be cron-fired. **Gap D.** |

### LCC Opps (project `xengecqvemvfknjvbvrq`) — 4 functions

| Function | v | Last update | Verdict | Intent / current state |
|---|---|---|---|---|
| `context-broker` | 15 | 2026-04-04 | DUPLICATE (older) | Older copy of Dialysis_DB `context-broker`. `verify_jwt: true`. Likely abandoned. |
| `daily-briefing` | 7 | 2026-04-04 | DUPLICATE (older) | Older copy. Same story. |
| `data-query` | 9 | 2026-05-02 | DUPLICATE (older) | Older copy of the 11-version Dialysis_DB one. |
| `availability-checker` | 4 | 2026-05-05 | KEEP (unique) | Periodic listing-availability scraper for CREXi/CoStar/LoopNet. Sophisticated, recently updated, not duplicated. The only LCC Opps function that’s clearly canonical here. |

### government (project `scknotsqkcheojiaewwh`) — 2 functions

| Function | v | Last update | Verdict | Intent / current state |
|---|---|---|---|---|
| `bulk-import-awards` | 3 | 2026-04-19 | KEEP | Bulk upsert into `federal_lease_awards`. Narrow, idempotent, healthy. |
| `sam-entity-lookup` | 3 | 2026-04-19 | KEEP | SAM.gov UEI / name lookup, batch enrichment of `true_owners`. `verify_jwt: true`. Real, healthy. |

## Gap register — work to triage one-by-one

Each gap below represents designed functionality that exists in code
but may or may not be reaching users. The next step on each is one of
(a) confirm it’s wired up and document the path, (b) finish wiring it
up, or (c) remove it from the codebase entirely.

### Gap A — `salesforce-enrichment`

**Designed to do:** run a 16-step nightly CRM enrichment pipeline
linking SF contacts to `contacts`, SF accounts to `true_owners`, SF
activities to both, and populating `touchpoint_schedule` /
`contact_links` / `crm_enrichment_logs`. Has a `/diagnostics` endpoint
that reports linkage gaps.

**Currently working:** unknown. Function is deployed but has not been
updated since first deploy in February 2026 — that's atypical for
maintained infrastructure.

**Decision needed:** is something on a cron firing
`POST /salesforce-enrichment/run` regularly? If yes, doc the cron and
the expected linkage outcomes. If no, decide whether to wire it up or
remove it.

### Gap B — `intake-receiver`

**Designed to do:** receive Power Automate webhook calls when an Outlook
email is flagged, normalize the payload, and upsert into
`inbox_items` (with idempotent SHA-1 correlation IDs).

**Currently working:** unknown. The Power Automate flow that would
target it isn’t obvious from this repo.

**Decision needed:** is there a Power Automate cloud flow targeting
`/intake-receiver?action=outlook-message`? If yes, doc the flow URL and
the header convention (`X-LCC-Workspace`, `X-LCC-Key`). If no, this
function is dormant and either needs the flow built or should be
deleted.

### Gap C — `template-service`

**Designed to do:** render email templates, generate batch drafts for
lists of contacts, record `template_sends`, compute edit-distance
performance metrics, auto-flag templates that need revision.

**Currently working:** unknown. The Vercel `api/operations.js`
`handleDraftRoute` originally owned this; the edge function is a port
that was deployed but not obviously cut over to.

**Decision needed:** is the LCC frontend calling `template-service` on
edge, or still calling `api/operations` on Vercel? If still on Vercel,
decide whether to finish the edge cut-over (deletes Vercel code) or
back out the edge function (deletes the Supabase function).

### Gap D — `npi-registry-sync`

**Designed to do:** weekly nationwide NPPES ESRD sweep — enumerate
every active ESRD provider in the country, snapshot their NPI registry
record into `npi_registry`, and write a `clinic_npi_registry_history`
row with diff flags (new, status_changed, address_changed,
name_changed, official_changed).

**Currently working:** unknown — it requires a cron trigger and there’s
no scheduling visible from the repos. Single deploy, never updated.

**Decision needed:** is there a `pg_cron`/Power Automate/GitHub Action
firing this weekly? If yes, doc the schedule and confirm the
`npi_registry` table is being filled. If no, either turn it on or
delete it.

### Gap E — LCC Opps duplicates of `context-broker`, `daily-briefing`, `data-query`

**Designed to do:** the LCC Opps copies were the original deployment
targets; the Dialysis_DB copies were either a re-host or a fork. Today
both exist and the Dialysis_DB copies are more recent.

**Currently working:** the Dialysis_DB copies are receiving traffic
(LCC code paths point at them by hostname). The LCC Opps copies are
likely dark.

**Decision needed:** confirm via the Supabase function logs which
copies have non-zero invocations in the last 30 days, then delete the
dark copies. Until that’s confirmed, leave both in place.

### Gap F — LCC code on Dialysis_DB project (architectural)

**Designed to do:** ideally LCC’s edge functions live on the LCC Opps
project (the project named after their domain).

**Currently working:** they live on Dialysis_DB. This works, but it’s
confusing and means “pause LCC Opps” (the original cost-saving idea) is
a bad idea — LCC Opps is small, while the data Dialysis_DB needs to
stay up powers Dialysis *and* LCC.

**Decision needed:** schedule a cut-over: redeploy the 11 LCC functions
to LCC Opps, change `EDGE_FUNCTION_URL` / `AI_CHAT_URL` defaults in
`life-command-center/api/copilot-chat`, smoke-test, then delete the
Dialysis_DB copies. Out of scope for this branch — surfaces here so it
doesn’t get lost.

## Deletion checklist (manual — must run in Supabase dashboard)

The Supabase MCP exposes `deploy_edge_function` but **not** a delete
operation. To remove the three obvious stubs, do this in the dashboard:

1. Open Supabase → project `Dialysis_DB` → Edge Functions.
2. For each of `sf-test`, `test-function`, `ai-copilot-v2`:
   - Click the function row.
   - Use the kebab menu → **Delete function**.
   - Confirm.
3. The deletion is immediate; there’s no undo. The source we have on
   record is what’s included in this audit’s git history if you ever
   need to recreate one.

No code changes in any repo are required — nothing imports or fetches
those three URLs.
