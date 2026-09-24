# `docs/flows/` — Power Automate flows: where they are and what each one does

**The flow DEFINITIONS live at the repo root as `flow-*.json`, not here, and they are staying there.** They are
referenced by name from `CLAUDE.md`, `.env.example`, code comments (`api/_shared/outlook-draft.js`,
`api/_shared/email-signature.js`, `api/draft-assist.js`) and ~10 docs; moving them would turn a dozen accurate
references into stale ones, which is worse than a slightly untidy root. This file is the topic index instead —
**read this to find a flow, then open the JSON at the root.**

| Flow file (repo root) | What it does | Notes |
|---|---|---|
| `flow-definition.json` | ⚠️ **Corrected 2026-09-23 (SF-BRIDGE1): this file is a Microsoft To-Do list sync** (hourly; reads `/me/todo/lists/*/tasks`). It is **not** the Salesforce → LCC opportunity sync, as this row previously said. That flow (`SF Deal → LCC Opportunity Sync`: 30-min recurrence, full refresh, posts to `/api/pipeline/ingest-opportunities`) has **no committed definition**. Export it from the tenant before editing (`SF-BRIDGE1-flow`). | |
| `flow-sf-file-discovery.json` | Salesforce file discovery | Import package + write-up: [`FLOW_sf_file_discovery.md`](FLOW_sf_file_discovery.md), [`LCC_SF_File_Discovery_import.zip`](LCC_SF_File_Discovery_import.zip) |
| `flow-outlook-intake-to-teams.json` · `…-hardened.json` · `…-button-to-teams.json` | Outlook intake → Teams | The `-hardened` variant supersedes the plain one; the `-button-` variant is the manual-trigger path. |
| `flow-outlook-calendar-sync.json` · `flow-personal-calendar-sync.json` | Calendar sync (work / personal) | See `docs/architecture/calendar-system-status.md` and `calendar-tz-fix-runbook.md`. |
| `flow-email-flag-to-todo.json` · `flow-personal-email-flag-to-todo.json` · `flow-todo-complete-unflag.json` | Flagged email ⇄ To-Do round trip | See `docs/architecture/INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`. |
| `flow-lcc-create-outlook-draft.json` | Draft-and-log action engine | See `docs/architecture/DRAFT_AND_LOG_ACTION_ENGINE.md`. |
| `flow-lcc-probe-outlook-contact-write.json` | Outlook contact write-back probe | Diagnostic; see `docs/architecture/contact-reconciliation-outbound.md`. |
| `flow-lcc-teams-chat.json` · `flow-daily-briefing-to-teams.json` | Teams delivery (chat / daily briefing) | |
| `flow-google-news-alert.json` | Google News alert intake | |

## 🔐 Standing caution

Several of these embed an `Authorization: Bearer <LCC_API_KEY>` header. That key is also committed in
`wave0-config-values.txt` (**SEC2**, 🔴 open, rotation ⏸️ deferred by Scott 2026-09-12 until the build is complete
and users are added). **When the key is rotated, every flow header carrying it must be updated in the same
change** — a flow left on the old key fails silently with an HTTP 200 summary, which is exactly how the
opportunity feed hid a six-week outage (HP1-P1a).
