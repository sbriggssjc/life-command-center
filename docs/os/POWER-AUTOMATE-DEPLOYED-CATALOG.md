# Power Automate Deployed Catalog

**Baseline date:** 2026-08-11
**Scope:** 16 requested production flows plus the supplemental Salesforce lookup flow
**Evidence:** retained package exports, parsed `definition.json`, package manifests, connector maps, and SHA-256 fingerprints
**Machine-readable authority:** `docs/os/FLOW-REGISTRY.yaml`

**Owner:** Scott Briggs (operator-confirmed for all 17 baseline flows on 2026-08-11)

## Baseline result

All 17 uploaded packages are valid Power Automate exports and have been retained under
`private/power-automate/exports/production/2026-08-11/`. The 16 requested flows are present. The additional
package is the existing HTTP-Switch Salesforce lookup flow.

The exported definition's `name` property is the deployed immutable flow GUID. It is authoritative over the
package resource-folder GUID, which can differ. This distinction corrected nine previously blank GUIDs and two
display-name assumptions in the registry.

## Salesforce backbone

| Logical ID | Deployed name | Flow GUID | Trigger | Primary contract |
|---|---|---|---|---|
| `sf-object-sync` | SF -> LCC: Object Sync | `503d5519-221e-4014-bde8-c483b6a8ef10` | Hourly | Salesforce objects -> `intake-salesforce` |
| `sf-property-promotion` | SF -> LCC: Property Promotion | `c06b207e-b077-43a8-a483-39f2fb8c4243` | Daily | promotion worker |
| `sf-opportunity-sync` | SF Deal → LCC Opportunity Sync | `7657a3bc-8761-4d2e-b385-ed112411bc42` | 30 minutes | pipeline opportunity ingest |
| `sf-deal-team-roster` | SF Deal Team → LCC Roster | `9879c0fd-2dc0-4304-a82b-d68de3fcc991` | Daily | deal-party ingest |
| `sf-deal-contact-roster` | SF Deal Contacts → LCC Roster | `a50d3f56-3891-4d8f-8636-b9b09e58c2ee` | Request | deal-contact ingest |
| `sf-activity-sync` | Sync SF Activities to Supabase | `2b145cca-031e-43ba-bf42-db976cf380ed` | 4 hours | activity sync |
| `sf-queue-drainer` | LCC → SF Queue Drainer | `2d5a0bb0-3948-4d14-9282-056ea923781e` | 5 minutes | `sf_sync_queue` -> Salesforce |
| `sf-retry-dead-letter` | SF -> LCC: Retry & Dead-letter | `f7e7bc07-6cbe-4638-b4c6-09a5f3206930` | Weekly | replay object/file failures |
| `sf-http-switch-lookup` | Http -> Switch,Get Account records,Respond (account),Get Contact re... | `c3744e93-5e95-4b6f-a839-d4308389d21f` | Request | Salesforce account/contact lookup |

## Salesforce file backbone

| Logical ID | Deployed name | Flow GUID | Trigger | Primary contract |
|---|---|---|---|---|
| `sf-file-discovery-move` | LCC — SF File Discovery | `c7b21a66-0222-4b92-a2ae-d7410e500e05` | Weekly | discover/fetch/stage Salesforce files |
| `sf-daily-file-backfill` | SF -> LCC: Daily Bulk File Backfill | `3d8be768-cfe7-41c9-81f4-e6b6f024ee5e` | Daily | bounded scheduled file backfill |
| `sf-on-demand-file` | SF -> LCC: On-demand File Backfill | `aaa452c0-7eb5-4c98-bfe2-f6d872d80639` | Request | operator-requested file backfill |
| `sf-on-demand-backfill` | SF -> LCC: On-demand Backfill | `4ffa81bd-c8af-4883-bd8b-c292e6b9346d` | Request | operator-requested object backfill |

The production display name `LCC — SF File Discovery` differs from the prior registry name
`SF -> LCC: File Discovery & Move`. The production name is now recorded separately; existing runbook links are
preserved.

## Outlook and task loop

| Logical ID | Deployed name | Flow GUID | Trigger | Primary contract |
|---|---|---|---|---|
| `outlook-intake-hardened` | LCC - Outlook Intake to Teams (Hardened) | `45faffcc-a96c-4ca3-a62d-c2fa150386ed` | Flagged email V3 | intake, summary, Teams card, completion callback |
| `outlook-processing-complete` | LCC Processing Complete → Move Message | `4e51f33d-dc56-47d0-8065-66e9a6e82961` | Request | flag/read/move Outlook message |
| `outlook-todo-completion-poll` | LCC To Do Completion Poll | `a77e7a00-9ae0-4b7e-a8c1-b6a1685e2f98` | 30 minutes | To Do completion -> Outlook cleanup |
| `outlook-flagged-email-intake` | LCC Flagged Email Intake | `44227dbb-3c8b-46b2-9a6a-6c46130a6beb` | Flagged email V3 | prepare upload, intake, flag/read/move |

## Verified connector and endpoint topology

- Salesforce connector: 12 flows.
- Office 365 Outlook connector: 4 flows.
- Teams connector: 1 flow.
- Microsoft To Do connector: 1 flow.
- LCC Opps REST/RPC endpoints: queue, contact, and failure-ledger operations.
- Dialysis project edge endpoints: Salesforce object/file intake, activity sync, and promotion.
- Railway endpoints: pipeline roster/opportunity ingest and Outlook/task intake callbacks.

Two Railway hostnames occur in deployed definitions: the canonical `tranquil-delight-production-633f` host and
`life-command-center-production`. The latter appears only in the deal-team and deal-contact roster flows. This is
an observed deployed-state difference; verify health and intentionally consolidate or document the alias before
changing either flow.

## Security findings requiring remediation

The raw packages remain Git-excluded because several definitions contain credential material.

1. Ten of 17 packages contain literal JWT-like values and/or credential-bearing headers.
2. The queue drainer contains a signed direct-trigger URL and embedded bearer-style values.
3. Four flows use HTTP Request triggers. Their exported authentication setting is either `All` or unspecified;
   package evidence alone does not establish an application-layer request-auth check.
4. Connection references are bound to user-scoped connections rather than solution environment variables.

Treat the exported tokens and signed URLs as exposed evidence: inventory their scopes, rotate them, move secrets
to secure environment variables or connection references, and export each remediated flow once to prove the raw
definition no longer carries reusable credentials. Do not delete this baseline; mark it superseded after the
clean export is retained.

## Inventory screenshot reconciliation

Two operator-supplied screenshots of **My flows** in the NorthMarq production environment were reconciled on
2026-08-11. They visibly confirm 16 of the 17 baseline logical flows by name, including the supplemental
HTTP-Switch lookup flow. `SF Deal → LCC Opportunity Sync` was not located unambiguously in the captured viewport.
The screenshots also record each visible row's Power Automate trigger category and relative modified age; these
values are preserved in `FLOW-REGISTRY.yaml` as screenshot evidence, not converted into invented exact dates.

The screenshots expose possible duplicate or legacy definitions that require GUID-level review in Power Automate:

- `SF -> LCC: Daily Bulk File Backfill` appears with both **1 wk ago** and **2 mo ago** modified ages.
- The newer `LCC — SF File Discovery` appears alongside an older `SF -> LCC: File Discovery & Move` row.
- A separate `SF -> LCC: Activity Sync` row reports **Activity suspended**, while the exported baseline flow is
  `Sync SF Activities to Supabase`.

Do not delete or disable any of these based on display name alone. Open each candidate and compare the GUID in its
URL with the immutable IDs in the registry, then classify it as current, duplicate, predecessor, or unrelated.

## Ownership verification

Scott Briggs directly confirmed that he owns each of the 17 baseline flows. This is recorded as operator-verified
metadata in `FLOW-REGISTRY.yaml`; it is not inferred from package contents or screenshots. No additional owner
screenshots or exports are required unless ownership changes.

## What the packages and screenshots do not prove

Power Automate package exports do not carry reliable values for enabled/disabled state, production last modified
time, last successful run, or solution membership. The supplied **My flows** screenshots add relative modified
age and trigger category, but do not expose the other fields or an exact timestamp. Capture those once
from an admin inventory export or flow detail pages; do not re-export these 17 flows merely to obtain metadata.

## Future-session rule

Before asking for any Power Automate export, compare the target flow's production modified timestamp with the
registry. Re-export only a changed, recreated, missing, corrupt, or security-remediated flow. The 2026-08-11
packages are the immutable baseline for definition comparison.
