# Topic F — One-Click "Draft & Log" Action Engine (handoff)

**Status:** BUILT + headless-verified. Ships on the Railway redeploy of merged
`main`. **Inert until Scott wires the PA/SF flows + env** (the codebase's
ship-dark rollout pattern — the response always returns the rendered draft for
copy/mailto, so nothing breaks while the external writes are unconfigured).

SPEC: `Team Briggs - Documents/_WORKFLOW/SPEC_TopicF_OneClick_Draft_and_Log.md`.

---

## What it does

On a cadence/prospect card, **one button — "Draft & Log →"** — (1) renders a
template, (2) drafts the email to **Outlook Drafts** (never auto-sent), (3) logs
a **COMPLETED Salesforce activity** with mode-specific linking + privacy, and
(4) advances the cadence. One HTTP call: `POST /api/operations?action=draft_and_log`.

- **Mode A — BD prospecting** (default on cadence cards): a completed SF Task,
  **minimal detail** so other SF users can't read our BD intent — subject
  `LCC-BD · <account> · Touchpoint <N>`, **no WhatId** (pre-deal), `nmType` blank
  (never an "Opportunity"). The `create_opportunity` PA contract has **no
  body/description field**, so the SPEC's "near-empty body" is inherent (a Task
  carries only the subject). The cadence **advances** (the single advance owner).
- **Mode B — Marketing a listing (= a Deal):** a completed activity **linked to
  the SF Deal** (`WhatId` = the listing's `sf_deal_id`), normal detail. **No BD
  sequence advance** — marketing logs against the Deal.

The button caller passes `mode:'bd'`; a marketing surface passes
`mode:'marketing'` + `sf_deal_id`. Mode is also inferred: any Deal/listing signal
(`sf_deal_id`/`deal_id`/`listing_id`/`what_id`) → marketing, else BD.

---

## Architecture — a router + recorder, not a new pipeline

Everything composes EXISTING, verified pieces (reuse, not fork):

| Step | Reused component | File |
|---|---|---|
| Render | `generateDraft` (template_definitions engine, T-00x) | `api/_shared/templates.js` |
| Draft → Outlook | `createOutlookDraftViaPA` (`PA_OUTLOOK_DRAFT_URL`) | `api/_shared/outlook-draft.js` |
| SF completed activity (mode-aware) | **`logSalesforceActivity`** → `createSalesforceTask` (`SF_LOOKUP_WEBHOOK_URL`) | `api/_shared/salesforce.js` (NEW) |
| Learning log | `recordTemplateSend` → `template_sends` | `api/_shared/templates.js` |
| Cadence advance (BD) | `advanceCadence` — the single advance owner | `api/_shared/cadence-engine.js` |
| Memory | `writeSignal({signal_type:'draft_and_log'})` | `api/_shared/signals.js` |

**Orchestrator:** `bridgeDraftAndLog` (`api/operations.js`), routed as the main
POST action `draft_and_log`. Every external step is **best-effort +
outcome-truthful**: the SF/Outlook writes are feature-flagged and no-op honestly
(`sf_not_configured` / draft `reason:'no_recipient'`…), so the response always
carries the rendered `draft.subject`/`draft.body` for the copy/mailto fallback.
Effect-first ordering: render → draft → SF log → record_send → cadence advance →
memory → queue refresh.

**Frontend:** `cadDraftAndLog` (`ops.js`) renders the returned draft inline (Copy
/ Open in mail / Open Outlook draft) + an **honest status line** ("✓ Draft in
Outlook · ✓ logged to Salesforce · cadence advanced", or "Draft ready —
copy/paste below · SF logging not configured yet"). Added as the primary
**"Draft & Log →"** button (with **"Draft only"** = the prior review-first flow)
on the outreach **focus session** (`_focusRenderCard`, ops.js) and the **Pipeline
› Prospects** cadence cards (`_pipelineCadenceCardsHTML`, app.js). Existing
Draft/Mark-sent/Log-touch flows are untouched.

---

## ⚠️ Reconciliation — the SPEC's premises vs. the live system (grounded 2026-07-20)

Grounding refuted several SPEC premises; the build follows the live system, not
the SPEC's naming:

1. **"Migrate the 4 templates into `template_definitions`; retire `bd_email_templates`."**
   `template_definitions` (LCC Opps) is ALREADY the mature, versioned,
   Handlebars-rendered, performance-tracked engine (T-001…T-014). The 4 named
   templates ("Area Ownership Introduction", "Offering Memorandum Follow-up",
   "Website Hit Follow-up", "Post-Call Summary") live in **`bd_email_templates`
   on the Dialysis_DB project** (a flat table), read ONLY by the `detail.js` CRM
   workbench + the `ai-copilot` edge function — a DIFFERENT surface. The
   cadence-driven Draft & Log flow already uses `template_definitions` (the
   cadence `next_touch_template` is a `T-00x` id). **Decision: the engine uses
   `template_definitions`; the 4 `bd_email_templates` are NOT migrated** (they
   feed the CRM workbench; migrating them risks those consumers and isn't needed
   here). A future round can fold them into `template_definitions` as
   marketing/BD variants if the workbench is unified — a deliberate non-goal.

2. **`touchpoint_schedule`** does not exist — the cadence table is
   **`touchpoint_cadence`** (it already carries `phase`, `priority_tier`,
   `next_touch_due`, `next_touch_type/template`, per-channel counters). The BD
   cadence model (7-touch prospecting sequence → tiered maintenance) is ALREADY
   built (`PROSPECTING_SEQUENCE` + `TIER_MULTIPLIERS` in `cadence-engine.js`), so
   the engine reuses it via `advanceCadence`.

3. **`outbound_activities` / `sync_outbound_enabled` "dormant since March 2026".**
   `outbound_activities` is a private Supabase AUDIT table (dia), not the SF path.
   The `sync_outbound_enabled` **workspace config flag** gates the `log_to_sf`
   outbound command bus (`api/sync.js`), a heavier/differently-coupled path used
   by `detail.js`. The engine deliberately uses the lighter, already-flagged
   `createSalesforceTask` path (`SF_LOOKUP_WEBHOOK_URL`) instead — the same var
   contact-acquisition / the buyer picker already use. No "dormant" marker was
   found in the repo; that phrasing was the SPEC's framing.

---

## Activation — Scott's operational steps (the engine is inert until these land)

1. **Outlook draft** — set **`PA_OUTLOOK_DRAFT_URL`** (+ optional
   `PA_OUTLOOK_DRAFT_SECRET`) to the "LCC Create Outlook Draft" PA flow
   (`flow-lcc-create-outlook-draft.json`). Until set, `draft.created=false` and
   the operator copies/opens-in-mail (the status line says so).

2. **Salesforce completed-activity log** — the engine posts to the existing
   `SF_LOOKUP_WEBHOOK_URL` flow with `operation:'create_opportunity'`,
   **`status:'Completed'`**, and (marketing only) **`what_id`**. The PA
   `create_opportunity` **Switch case must honor `status`** (default it may
   hardcode `Open`) **and `what_id`** (Task WhatId). Until it does,
   `sf.logged=false, reason:'sf_not_configured'|'sf_failed'` and the touchpoint is
   still recorded in `template_sends` + the cadence still advances (the SF log is
   the only piece that no-ops).
   - Marketing `WhatId` is the listing's SF Deal, resolved via
     `v_sjc_deal_book` (`sf_listing_id → sf_deal_id`, on the dia project). The
     button/caller supplies `sf_deal_id`; the deal-book row already carries it.

3. **Verify live** (after the Railway redeploy + the PA flows):
   - Open the outreach **focus session** (Today → "Work Your Outreach" → Start
     working), click **"Draft & Log →"** on an email-next prospect: a draft
     appears (Copy / Open in mail / Open Outlook draft), the SF activity logs
     Completed on the contact, and the card settles "✓ … cadence advanced".
   - Spot-check the SF Task: subject `LCC-BD · <account> · Touchpoint <N>`,
     Status Completed, **no WhatId**, no BD detail in the body.
   - A marketing surface (`mode:'marketing'` + `sf_deal_id`) logs
     `LCC-Mktg · <deal> · Marketing <N>` linked to the Deal.

---

## Boundaries / reversibility

- LCC-side only (LCC Opps `template_sends`/`touchpoint_cadence`/`signals` +
  the flagged external PA/SF writes). No dia/gov domain writes; auth schema
  untouched. No migration.
- Feature-flagged + best-effort: with the PA/SF env unset the engine renders a
  draft and records the template send + cadence advance; the Outlook + SF writes
  no-op honestly. Reversible — revert the code; the `draft_and_log` signals +
  `template_sends` rows are ordinary telemetry.
- No new `api/*.js` (orchestrator is a main POST action in `operations.js`; the
  SF logger is in `_shared/salesforce.js`), so no `server.js` route + no
  `operations-subroutes` guard impact.

## Follow-ups (surfaced, NOT built)

- Wire "Draft & Log" onto the **Listing Workspace / deal-book rows** as
  `mode:'marketing'` (extend the dia `v_sjc_deal_book` select to carry
  `sf_listing_id`, resolve → `sf_deal_id` for the WhatId). The mechanism is ready;
  only the surface + the deal-id resolution are the add.
- **Marketing `deal_advanced`** on `template_sends` — `recordTemplateSend`
  currently writes `deal_advanced=false`; a marketing send should set it true. A
  small signature add, deferred.
- **Cortex `log_memory` one-liner** — the durable record today is a
  `draft_and_log` signal; a Cortex memory one-liner is the eventual "one truth,
  three renderings" enhancement.
- Fold the 4 `bd_email_templates` into `template_definitions` if/when the CRM
  workbench + copilot are unified onto the mature engine.

---

## ✅ GO-LIVE VERIFIED — 2026-07-20 (PA flow live-tested end to end)

Both wirings are set and the `create_opportunity` PA case was live-fired with real
payloads against a real SF Contact (Scott Briggs) + Deal. Final verified contract:

**Flow:** `Http -> Switch...` (flow id `c3744e93-5e95-4b6f-a839-d4308389d21f`),
`create_opportunity` case → `Create record` (SF Task, `PostItem_V2`). Field map:

| Task field | Maps from | Notes |
|---|---|---|
| `item/WhoId` | `triggerBody()?['who_id']` | the contact |
| `item/WhatId` | `triggerBody()?['what_id']` | **marketing only** → lands in **"Related To"** = the Deal (Opportunity). There is **no** custom "Related Deal" field on Task, so Related To IS the deal link. BD sends no `what_id` → stays blank. |
| `item/Subject` | `triggerBody()?['subject']` | `LCC-BD · <acct> · Touchpoint N` / `LCC-Mktg · <deal> · Marketing Outreach N` |
| `item/Status` | `if(empty(triggerBody()?['status']),'Completed',triggerBody()?['status'])` | was hardcoded `Open`; **fixed** → Completed (drops to Activity History) |
| `item/Description` | `triggerBody()?['comments']` | Comments field. **Both modes** carry a light LCC reference + touchpoint label (e.g. `LCC-BD outreach · Touchpoint N · LCC record ref: <id>`). Doctrine updated: BD is no longer blank — it carries a minimal reference, no strategy. |
| `item/SJC_Type_sjc__c` (NM Type) | `triggerBody()?['nm_type']` (direct; the old `NMT_Type` Compose was writing junk) | always sent blank → NM Type blank (never "Opportunity"-typed) |

**Engine (`api/_shared/salesforce.js`) follow-up still to apply:** `buildSalesforceActivityPayload`
now must send **`comments` in BOTH modes** (BD: `LCC-BD · Touchpoint N · <LCC ref>`;
marketing: `LCC-Mktg · Marketing Outreach N · <LCC ref>`), keep `nm_type` blank, and
send `what_id` only for marketing. (The flow already honors all of these.)

Observation: SF also mirrors Comments into a custom **NM Notes** field automatically
(Ascendix) — harmless, no mapping needed.
