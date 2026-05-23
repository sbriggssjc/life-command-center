# LCC ↔ Microsoft (Copilot + Outlook) — Audit & Bridge Plan

Date: 2026-05-22 (revised same day — see §0)
Owner: LCC Control Plane / integration-audit track
Scope: The daily-use loop between Life Command Center, its Supabase databases, Microsoft Copilot (Studio agent + M365 Copilot), and Outlook — for prompting Copilot, drafting emails, and responding to client/broker requests.
Companion docs: `lcc-microsoft-salesforce-pipeline-gap-analysis.md` (Power Automate flow gaps), `LCC_Copilot_Bidirectional_Plan_2026-04-21.md` (the original plan), `om_intake_pipeline.md`, `power-automate-observability-standards.md`.

---

## 0. Revision note (2026-05-22, second pass)

Two findings from Scott reshaped this plan after the first pass:

1. **The direct Microsoft Graph path is almost certainly not authorized in the company tenant.** The first draft made a server-side Graph OAuth grant the foundation for outbound email. That is now demoted to a documented future option (gated on IT approval) and the plan is rebuilt around an **org-sanctioned path: LCC → a Power Automate HTTP flow → Power Automate's Office 365 Outlook connector → an Outlook draft.** That connector runs under Scott's existing, already-consented M365 connection — no app registration, no tenant-admin Graph grant.
2. **The LCC Deal Agent in Copilot isn't working** — it chats but its actions don't fire, and it intermittently returns "something went wrong." This pass adds a triage (§4A) that found the root cause: **the imported custom connector still points at the dead Vercel host** (`copilot/lcc-deal-intelligence.connector.v1.swagger.json:2706` → `host: life-command-center-nine.vercel.app`). The app now lives on Railway. Every action call is hitting a host that no longer serves the app. This is the single highest-priority fix and it is owner-side in Power Platform.

---

## 1. Executive summary

The headline finding is encouraging: **most of the machinery you want already exists in code.** The April plan (`LCC_Copilot_Bidirectional_Plan`) has largely been executed across the R2–R5 rounds (mid-May). The Copilot action layer is live, the email-intake pipeline is production-grade, entity-scoped memory and a context broker are deployed, and there is even a real path that writes an Outlook draft through the Graph API.

The problem is not missing features — it is **the last mile, one broken connection, and the connective tissue.** Four things keep this from being the seamless daily loop you described:

1. **The Copilot agent is currently down because its connector points at the old host.** The imported "LCC Deal Intelligence" connector still carries `host: life-command-center-nine.vercel.app`; the app now runs on Railway. Every action call hits a dead host, so the agent silently falls back to generic chat and intermittently throws SystemError. One owner-side edit fixes it (§4A).
2. **Outbound email needs an org-sanctioned path.** The existing real-draft code (`create_outlook_draft`) calls Microsoft Graph directly with a hand-pasted token — and direct Graph is likely not permitted in the tenant. The replacement is a Power Automate Outlook-connector flow that drafts under your existing M365 connection. Separately, the conversational draft actions Copilot actually calls (`draft_outreach_email`, `draft_seller_update_email`) only return *text* today, so even the existing path isn't wired to them.
3. **Auth posture is fail-open and not yet hardened for production.** Until `LCC_API_KEY` + `LCC_ENV=production` are set on Railway, the API admits unauthenticated callers; M365 declarative-agent requests pass through on `_copilot_path` with no key; and the standing P0 (plaintext Supabase keys inlined in Power Automate flow exports) is still open. Note: setting `LCC_API_KEY` will turn a *key mismatch* into a hard 401, so the connector's stored key must be reconciled at the same time (§4A, cause #2).
4. **The "respond to a client/broker email" loop isn't closed.** Inbound email is captured and entity context is retrievable, but nothing joins *this incoming email* → *its entity's context* → *a contextual reply drafted back into Outlook.* Each piece exists; the workflow that chains them does not.

Net: this is a **fix-one-thing, then finish-and-harden** job, not a build-from-scratch job. The plan below puts the connector-host fix first, rebuilds outbound around the org-sanctioned connector, then sequences the reply loop and the security hardening so the daily loop becomes real and reliable.

---

## 2. How the system actually connects today

**Hosting.** LCC runs on **Railway** (`tranquil-delight-production-633f.up.railway.app`), served by `server.js` (an Express shim that mounts the consolidated `api/` handlers and the `vercel.json` rewrite aliases as routes). `vercel.json` is now only the local-dev surface; a move to Render Starter is documented but not executed. This matters because every Microsoft surface points its HTTP calls at the Railway URL.

**Inbound: Outlook → LCC (mature, production).** Flagged work email drives the intake pipeline. A Power Automate flow (`LCC Flagged Email Intake`) loops attachments → `POST /api/intake/prepare-upload` (signed Supabase Storage URL) → `PUT` bytes → `POST /api/intake?_route=outlook-message`. `handleOutlookMessage` (`api/intake.js:248`) authenticates on `X-LCC-Key`, builds a deterministic `correlation_id`, dedups (PA fires the same flag 2–6×), and calls `stageOmIntake` (`api/_shared/intake-om-pipeline.js`), which stages the document and runs extractor → matcher → promoter into the domain databases. The historical fragility here (the `base64ToBinary` corruption bug, the dedup race) is **fixed** and documented.

**Copilot Q&A + actions (substantially built — more than the docs imply).** Two gateways are live:

- `/api/chat` `copilot_action` dispatch (`api/operations.js`, `ACTION_REGISTRY` ~`:641`) routes roughly 30 actions — read-only ones proxy to existing endpoints, AI/handler ones have real handlers (`handleProspectingBrief`, `handleDraftOutreachEmail`, `handleDraftSellerUpdate`, `createTodoTask`, `handleRelationshipContext`, `handlePipelineIntelligence`, `handleDocumentAssembly`, etc.). Tier-≥1 actions are confirmation-gated.
- `/api/intake?_route=copilot-action` (`api/intake.js:1671`) is the typed gateway for `intake.stage.om.v1`, `intake.finalize.om.v1`, `context.retrieve.entity.v1`, `memory.log.turn.v1`, `intake.prepare_upload.v1`, `intake.artifact_download.v1` — all with dedicated handlers in `api/_handlers/`.

Q&A retrieval genuinely works: `context.retrieve.entity.v1` resolves a contact/property/org (by id or fuzzy name) and returns the canonical record plus recent interactions, open action items, recent inbox items, last touchpoint, and active listings. The `context-broker` Supabase edge function is deployed and assembles contact/property/pursuit/deal/daily-briefing packets with TTL caching. So the agent can already answer "what do we know about X" against the live databases.

**Outbound: LCC → Outlook (real but fragile, and not the path Copilot uses).** Two distinct layers:

- *Text-only AI drafts:* `draft_outreach_email` / `draft_seller_update_email` return `{response, requires_review:true}` text with a "review and edit before sending from Outlook" note. No Outlook write. This is what the Copilot agent and the Outlook add-in's "Draft Reply" button call today — i.e. copy-paste.
- *Real Outlook draft:* `create_outlook_draft` (`api/operations.js:2301`) renders a template, fetches the capital-markets PDF, and `POST`s to Graph `/me/messages` to create an actual draft (inline attachment ≤3MB, upload-session above), returning a `webLink`. **It is gated on `process.env.MS_GRAPH_TOKEN`** — a single static delegated token. Absent or expired, it 503/502s to a `mailto` fallback. There is no `sendMail` anywhere; LCC creates drafts, never auto-sends. There is no OAuth/MSAL refresh — the token is hand-provisioned and will expire.

**Outlook add-in (`office-addins/`).** A working, sideloadable task-pane add-in shows LCC relationship context for the open email and offers Log Call / Draft Reply / Open in LCC. "Draft Reply" is copy-paste (calls the text-only action). Not store-published; API key lives in WebView storage (single-user device).

**Templates & cadence.** The template library (`api/_shared/templates.js`, `_route=draft`) and the touchpoint cadence engine are built. The cadence engine can *recommend* "schedule a meeting" touchpoints but **cannot write Outlook calendar events** — that flow is status PROPOSED, not built. Calendar today is read-only (Outlook → Supabase).

**Auth & secrets.** Copilot's custom connector and Power Automate authenticate to LCC with the `X-LCC-Key` header (constant-time compared in `api/_shared/auth.js`). The OpenAPI spec is generated by `generateOpenApiSpec()` and served at `/api/copilot-spec`. Power Automate → Supabase calls inline the Supabase `apikey` directly in flow definitions (the P0). M365 Copilot declarative-agent requests are admitted via a `_copilot_path` passthrough with no LCC key.

---

## 3. State matrix

| Surface | Capability | State | Evidence |
|---|---|---|---|
| **Copilot connector host** | Connector points at the live app | **BROKEN — points at dead Vercel host** | `lcc-deal-intelligence.connector.v1.swagger.json:2706` |
| Inbound email | Flagged-email → intake → DB promotion | **Built / production** | `api/intake.js:248`, `intake-om-pipeline.js`; base64/dedup bugs fixed |
| Copilot Q&A | Entity context retrieval against DBs | **Built (blocked by connector host)** | `context.retrieve.entity.v1`, `context-broker` edge fn |
| Copilot actions | ~30 actions via `/api/chat` + 6 typed via `/api/intake` | **Built (blocked by connector host)** | `ACTION_REGISTRY` `operations.js:641`; `intake.js:1671` |
| Outbound email (text) | AI-drafted outreach / seller-update text | **Built (copy-paste only)** | `handleDraftOutreachEmail`, `handleDraftSellerUpdate` |
| Outbound email (real draft) | Create Outlook draft | **Built via Graph, but Graph likely unauthorized** | `create_outlook_draft` `operations.js:2301`; static `MS_GRAPH_TOKEN` |
| Outbound email (org-sanctioned) | Draft via PA Office 365 Outlook connector | **Not built (this is the new primary path)** | new flow + LCC caller |
| Copilot → real draft | Agent draft lands in Outlook, not chat | **Missing wiring** | text actions don't call any draft-creation path |
| Client/broker reply loop | Incoming email → context → drafted reply | **Missing wiring** | pieces exist, chain does not |
| Outlook add-in | In-mail context + actions | **Built (sideload), copy-paste reply** | `office-addins/outlook/` |
| Calendar write-back | LCC → Outlook calendar event | **Proposed, not built** | `flows/lcc-outlook-calendar-write.md` |
| Direct Graph auth | OAuth/refresh for Graph calls | **Likely unauthorized in tenant — deprioritized** | `MS_GRAPH_TOKEN`, no MSAL |
| API auth hardening | `LCC_API_KEY` + `LCC_ENV=production` | **Not enforced (fail-open)** | `auth.js:312` |
| Secret hygiene (P0) | Rotate keys, remove inlined secrets | **Open** | gap-analysis Gap #7 |

---

## 4A. LCC Deal Agent triage — why the actions aren't firing

Symptoms reported: the agent chats but its actions don't fire (generic answers, no LCC data, no drafts), and it intermittently returns "something went wrong." A code-verified triage produced a ranked cause list.

**Cause #1 (root cause — confirmed). The imported connector points at the dead Vercel host.** The committed connector definition `copilot/lcc-deal-intelligence.connector.v1.swagger.json` is Swagger 2.0 with `"host": "life-command-center-nine.vercel.app"` (line 2706), `basePath: "/"`, `schemes: ["https"]`. Power Platform builds every operation URL as `schemes://host/basePath + path`, so the connector calls `https://life-command-center-nine.vercel.app/api/chat`, etc. The app now runs on **Railway** (`tranquil-delight-production-633f.up.railway.app`). The live spec served at `/api/copilot-spec` was updated to the Railway URL, but **re-pointing the served spec does not retro-update a connector that was already imported from the old file.** This one fact explains both symptoms: action calls hit a host that no longer serves the app (no data → generic fallback chat), and Vercel returns 404/410 HTML rather than the JSON Copilot expects (→ SystemError).
*Fix (owner-side, Power Platform):* in the custom-connector editor, change Host to `tranquil-delight-production-633f.up.railway.app`, save, and re-publish the Copilot Studio agent. *Code-side (secondary):* update `host` in the committed swagger so the source artifact matches the live import.

**Cause #2 (latent — will surface the moment auth is hardened). API-key mismatch.** The connector's `securityDefinitions` correctly declares the `X-LCC-Key` header. Today auth is fail-open (`LCC_API_KEY` unset), so a wrong/absent key still passes. But the planned hardening (set `LCC_API_KEY` + `LCC_ENV=production` on Railway) will turn any mismatch between the connector's stored key and the Railway env value into a hard 401 → SystemError on the primary `/api/chat` gateway (that gateway requires real auth; it does not ride the `_copilot_path` passthrough). *Fix:* reconcile the connector's stored key with the Railway `LCC_API_KEY` value at the same time you flip production on — never one without the other.

**Cause #3 — routing parity on Railway: verified OK, low risk.** A diff of `vercel.json` rewrites against `server.js` route mounts confirms every advertised path resolves on Railway (`/api/chat`, `/api/copilot-spec`, `/api/copilot/{portfolio,ops,outreach,workflow,domain}/:action`, `/api/intake/stage-om`, `/api/copilot/action`). Not a current cause, but only exercised once Cause #1 sends traffic to Railway at all.

**Cause #4 — spec↔handler drift: low risk.** The connector's action enum is generated from the live registry; unknown actions return a clean `{ok:false}` JSON, not a 500. No advertised action lacks a handler.

**Cause #5 — error envelope: shapes the symptom, not the cause.** The gateways return structured JSON error envelopes (`intake.js:1738` R5-P-1; `/api/chat` dispatch). A handler exception would produce a soft 500-with-body, not a bare SystemError — which reinforces that the SystemError is transport-level (wrong host), i.e. Cause #1.

**Triage bottom line:** fix the connector host (Cause #1) and the agent's actions should start firing immediately. Reconcile the API key (Cause #2) before enabling production auth. Everything else is verified healthy.

---

## 4. Gap analysis — what blocks the daily loop you described

Three goals were stated: prompt Copilot for questions/requests; draft emails; help respond to client/broker requests. Mapped to gaps:

**Gap A — there is no org-sanctioned outbound-email path (blocks all real Outlook drafting).** The only real-draft code today (`create_outlook_draft`) calls Microsoft Graph directly with a static `MS_GRAPH_TOKEN`. That approach is doubly blocked: the token expires with no refresh, *and* direct Graph access is almost certainly not authorized in the company tenant (an app registration with `Mail.ReadWrite` would need admin consent). The right answer avoids server-side Graph entirely: **LCC posts the rendered draft (subject, body, to/cc, optional attachment URL) to a Power Automate HTTP-trigger flow, and that flow uses the Office 365 Outlook connector's "Create draft" / "Create event" actions to write the draft into Outlook under Scott's existing, already-consented M365 connection.** No app registration, no Graph token, no tenant-admin grant — it reuses the same connector auth model that already powers the inbound intake flows. Direct Graph stays in the codebase as a documented, flag-gated future option if IT ever grants it.

**Gap B — Copilot-drafted emails don't become Outlook drafts.** The actions Copilot invokes return text; only the capital-markets template path calls `create_outlook_draft`. So when you ask Copilot to "draft a reply to this broker," you get text to copy. Closing this means routing the AI draft actions through the same Graph draft-creation code so the output is a real Outlook draft with a `webLink`.

**Gap C — the client/broker reply loop is not chained.** Inbound email is captured and entity context is retrievable, but there is no action that takes *an incoming email* (or an inbox item), pulls *its entity's context packet*, and produces *a contextual draft reply back into Outlook.* This is the workflow that turns three working components into the feature you actually want. It needs (1) an inbox-item → entity link surfaced to the agent, (2) a `draft.reply.from_inbox.v1`-style action that composes with context, and (3) the Graph draft write from Gap B.

**Gap D — auth is fail-open; production hardening not switched on.** Until `LCC_API_KEY` + `LCC_ENV=production` are set on Railway, the API serves unauthenticated callers, and the `_copilot_path` passthrough admits M365 agent requests with no key. Before this loop carries client data daily, this must be closed.

**Gap E — the standing P0: secret hygiene.** Plaintext Supabase `apikey` is inlined in Power Automate flow exports; `X-LCC-Key` is visible in flow run histories. Rotation + move to Power Platform secure references is owner-action and overdue. (Tracked in the Salesforce/MS gap analysis as Gap #7.)

**Gap F — calendar is read-only.** If "respond to a client request" includes "and put the meeting on my calendar," the LCC → Outlook calendar-write flow is designed but unbuilt. Lower priority unless calendar authoring is in near-term scope.

---

## 5. Phased bridge plan

The sequencing now leads with the connector-host fix (it's a one-edit revival of a built system), then secures the foundation, then builds outbound on the org-sanctioned connector, then closes the reply loop.

**Phase 0 — Revive the agent + secure the foundation (do first; owner-action).**
*Step 0a (5 minutes, highest leverage):* in Power Platform, edit the "LCC Deal Intelligence" connector Host to `tranquil-delight-production-633f.up.railway.app` and re-publish the agent. This alone should make actions fire again. *Step 0b:* set `LCC_API_KEY` + `LCC_ENV=production` on Railway **and** set the connector's stored `X-LCC-Key` to the same value in the same change (Cause #2 — a mismatch becomes a hard 401). *Step 0c (P0):* rotate the exposed Supabase key and `X-LCC-Key`, move every Power Automate secret to environment variables / secure references, re-export to confirm redaction. Decide the `_copilot_path` passthrough policy. Acceptance: ask the agent "what's in my review queue" and it returns live data.

**Phase 1 — Org-sanctioned outbound flow (foundation for all email drafting).**
Build a Power Automate flow `LCC Create Outlook Draft` (HTTP trigger, `X-LCC-Key`/webhook-secret auth like the intake flows) that accepts `{to, cc, subject, body_html, in_reply_to?, attachment_url?}` and calls the Office 365 Outlook connector to create a draft (and, for replies, threads it to the original message). Add an `api/_shared/outlook-draft.js` helper that POSTs to this flow, plus a `create_outlook_draft_via_pa` action so the existing draft callers have an org-sanctioned target. Keep `MS_GRAPH_TOKEN`/`create_outlook_draft` in place but flag-gated and documented as the future direct path. Acceptance: an LCC action call results in a draft sitting in your Outlook, with no Graph token involved.

**Phase 2 — Make Copilot drafts land in Outlook (close Gap B).**
Point `draft_outreach_email` / `draft_seller_update_email` (and the add-in's Draft Reply) at the Phase-1 helper when the user wants a real draft, returning the draft link/id so Copilot and the add-in can say "it's in your Outlook." Keep text-only mode as a fallback for when the flow is unreachable. Acceptance: "Copilot, draft an outreach to Greg at DaVita" produces an editable Outlook draft, not chat text. (The add-in can alternatively create the draft client-side via Office.js with no server round-trip — note as an option.)

**Phase 3 — Close the client/broker reply loop (close Gap C).**
Add a `draft.reply.from_inbox.v1` action: input an `inbox_item_id` (or message correlation id), resolve the linked entity, pull its context packet via the context broker, compose a contextual reply with the template engine, and create the Outlook draft via the Phase-1 flow as a reply to the original. Surface from the Outlook add-in's Draft Reply button and as a Copilot action. Log the interaction to `activity_events` (the memory layer already exists). Acceptance: open a broker email → one click / one prompt → contextual reply draft waiting in Outlook.

**Phase 4 — Reliability & observability retro-fit.**
Wire the new `LCC Create Outlook Draft` flow into the dead-letter / `lcc_health_alerts` plane that already covers 33 flows (so a failed draft surfaces, not silently drops). Add a connector-reachability check so a future host change can't silently break the agent again. Add the calendar-write flow (Gap F) only if calendar authoring is confirmed in scope — and build it on the same PA Outlook connector. Add lightweight contract tests for the intake and draft payloads so hand-edits can't silently break the shape.

**Phase 5 — Optional reach.**
Publish the Outlook add-in beyond sideload; add `bov.generate.from_intake.v1` (OM → BOV workbook) and `entity.resolve.ambiguous.v1` from the original Stage-E backlog; Salesforce event-driven inbound (separate gap-analysis track).

---

## 6. Quick wins (safe, high-value, ready now)

- **Fix the connector host (≈5 min, owner action).** Edit the "LCC Deal Intelligence" connector Host to the Railway URL and re-publish. This revives the entire agent — it is by far the highest-value action in this document.
- **Update the committed connector swagger.** Change `host` in `copilot/lcc-deal-intelligence.connector.v1.swagger.json:2706` to the Railway host so the source artifact matches the live import. (Claude can do this now on approval — pure config edit.)
- **Reconcile + set `LCC_API_KEY` + `LCC_ENV=production` on Railway.** Closes the fail-open hole — but set the connector's stored key to the same value in the same change so it doesn't 401. (Owner action.)
- **Scaffold the `api/_shared/outlook-draft.js` helper + the PA flow definition.** The helper and a ready-to-import flow JSON are mechanical and unblock Phase 2. (Claude can draft both on approval; you import/publish the flow.)

---

## 7. What only Scott can do

- **Fix the connector Host to the Railway URL and re-publish the agent** (Phase 0a — the one that revives everything).
- Set `LCC_API_KEY` + `LCC_ENV=production` on Railway and set the connector's stored `X-LCC-Key` to the same value (Phase 0b).
- Rotate the exposed Supabase key and `X-LCC-Key`; move Power Automate secrets to secure references (Phase 0c / P0).
- Import and publish the `LCC Create Outlook Draft` Power Automate flow (Phase 1); confirm the Office 365 Outlook connection is authorized under your account.
- Re-publish the Copilot Studio agent and refresh the custom connector after any action-schema change.
- Sideload (or publish) the updated Outlook add-in.
- *(Only if IT ever approves direct Graph)* register/consent the Azure AD app — otherwise this stays unused.

---

## 8. Key file reference

- Inbound intake: `api/intake.js:248` (`handleOutlookMessage`), `api/_shared/intake-om-pipeline.js`, `api/intake.js:1671` (typed copilot-action gateway)
- Copilot actions: `api/operations.js` `ACTION_REGISTRY` ~`:641`, dispatch ~`:728`; handlers in `api/_handlers/`
- Q&A retrieval: `api/_handlers/retrieve-entity-context.js`, `supabase/functions/context-broker/index.ts`
- Outbound draft (real): `api/operations.js:2301` (`create_outlook_draft`), Graph POST `:2399`; token `MS_GRAPH_TOKEN` `:2364`
- Outbound draft (text): `handleDraftOutreachEmail` / `handleDraftSellerUpdate` (`api/operations.js`)
- Auth: `api/_shared/auth.js` (X-LCC-Key compare `:98`, fail-open `:312`, copilot passthrough `:281`)
- Add-in: `office-addins/outlook/taskpane.html` + `manifest.xml`
- Templates / cadence: `api/_shared/templates.js`, `cadence-engine.js`; `_route=draft`
- Calendar write (proposed): `docs/architecture/flows/lcc-outlook-calendar-write.md`

---

## 9. Change log

- 2026-05-22 — Document created. Audited the Copilot + Outlook surfaces against live code, confirmed the April bidirectional plan is largely executed, identified the last-mile/auth gaps, and set a phased bridge plan.
- 2026-05-22 (second pass) — Reworked after two owner findings (§0): (1) direct Microsoft Graph is likely unauthorized in the tenant — outbound email rebuilt around the Power Automate Office 365 Outlook connector, with direct Graph demoted to a flag-gated future option; (2) the LCC Deal Agent's actions weren't firing — triage (§4A) found the imported connector still points at the dead Vercel host (`lcc-deal-intelligence.connector.v1.swagger.json:2706`), now the #1 fix. Phases re-sequenced to lead with the connector-host revival.
