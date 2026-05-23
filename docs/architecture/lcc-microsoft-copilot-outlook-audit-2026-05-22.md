# LCC ↔ Microsoft (Copilot + Outlook) — Audit & Bridge Plan

Date: 2026-05-22
Owner: LCC Control Plane / integration-audit track
Scope: The daily-use loop between Life Command Center, its Supabase databases, Microsoft Copilot (Studio agent + M365 Copilot), and Outlook — for prompting Copilot, drafting emails, and responding to client/broker requests.
Companion docs: `lcc-microsoft-salesforce-pipeline-gap-analysis.md` (Power Automate flow gaps), `LCC_Copilot_Bidirectional_Plan_2026-04-21.md` (the original plan), `om_intake_pipeline.md`, `power-automate-observability-standards.md`.

---

## 1. Executive summary

The headline finding is encouraging: **most of the machinery you want already exists in code.** The April plan (`LCC_Copilot_Bidirectional_Plan`) has largely been executed across the R2–R5 rounds (mid-May). The Copilot action layer is live, the email-intake pipeline is production-grade, entity-scoped memory and a context broker are deployed, and there is even a real path that writes an Outlook draft through the Graph API.

The problem is not missing features — it is **the last mile and the connective tissue.** Three things keep this from being the seamless daily loop you described:

1. **Outbound email is fragile and half-wired.** A real "create Outlook draft" path exists but depends on a single hand-pasted Graph token (`MS_GRAPH_TOKEN`) that expires with no refresh. Meanwhile the conversational draft actions Copilot actually calls (`draft_outreach_email`, `draft_seller_update_email`) only return *text* — they don't route through the draft-creation path, so today they're copy-paste.
2. **Auth posture is fail-open and not yet hardened for production.** Until `LCC_API_KEY` + `LCC_ENV=production` are set on the host, the API admits unauthenticated callers; M365 declarative-agent requests pass through on `_copilot_path` with no key; and the standing P0 (plaintext Supabase keys inlined in Power Automate flow exports) is still open.
3. **The "respond to a client/broker email" loop isn't closed.** Inbound email is captured and entity context is retrievable, but nothing joins *this incoming email* → *its entity's context* → *a contextual reply drafted back into Outlook.* Each piece exists; the workflow that chains them does not.

Net: this is a **finish-and-harden** job, not a build-from-scratch job. The plan below sequences the last-mile wiring and the security hardening so the daily loop becomes real and reliable.

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
| Inbound email | Flagged-email → intake → DB promotion | **Built / production** | `api/intake.js:248`, `intake-om-pipeline.js`; base64/dedup bugs fixed |
| Copilot Q&A | Entity context retrieval against DBs | **Built** | `context.retrieve.entity.v1`, `context-broker` edge fn |
| Copilot actions | ~30 actions via `/api/chat` + 6 typed via `/api/intake` | **Built** | `ACTION_REGISTRY` `operations.js:641`; `intake.js:1671` |
| Outbound email (text) | AI-drafted outreach / seller-update text | **Built (copy-paste only)** | `handleDraftOutreachEmail`, `handleDraftSellerUpdate` |
| Outbound email (real draft) | Create Outlook draft via Graph | **Built but fragile** | `create_outlook_draft` `operations.js:2301`; static `MS_GRAPH_TOKEN` |
| Copilot → real draft | Agent draft lands in Outlook, not chat | **Missing wiring** | text actions don't call `create_outlook_draft` |
| Client/broker reply loop | Incoming email → context → drafted reply | **Missing wiring** | pieces exist, chain does not |
| Outlook add-in | In-mail context + actions | **Built (sideload), copy-paste reply** | `office-addins/outlook/` |
| Calendar write-back | LCC → Outlook calendar event | **Proposed, not built** | `flows/lcc-outlook-calendar-write.md` |
| Graph auth | OAuth/refresh for Graph calls | **Missing (static token)** | `MS_GRAPH_TOKEN`, no MSAL |
| API auth hardening | `LCC_API_KEY` + `LCC_ENV=production` | **Not enforced (fail-open)** | `auth.js:312` |
| Secret hygiene (P0) | Rotate keys, remove inlined secrets | **Open** | gap-analysis Gap #7 |

---

## 4. Gap analysis — what blocks the daily loop you described

Three goals were stated: prompt Copilot for questions/requests; draft emails; help respond to client/broker requests. Mapped to gaps:

**Gap A — Graph auth is a time-bomb (blocks all real outbound email).** Every real Outlook write depends on `MS_GRAPH_TOKEN`, a static delegated token with no refresh. When it expires, draft creation silently falls back to `mailto` and the "seamless" experience breaks with no alert. This is the single highest-leverage fix for email drafting. The right answer is a proper OAuth grant (delegated auth-code + refresh token, or app-only client-credentials with `Mail.ReadWrite` if a service mailbox is acceptable) with token caching/refresh in `api/_shared/`.

**Gap B — Copilot-drafted emails don't become Outlook drafts.** The actions Copilot invokes return text; only the capital-markets template path calls `create_outlook_draft`. So when you ask Copilot to "draft a reply to this broker," you get text to copy. Closing this means routing the AI draft actions through the same Graph draft-creation code so the output is a real Outlook draft with a `webLink`.

**Gap C — the client/broker reply loop is not chained.** Inbound email is captured and entity context is retrievable, but there is no action that takes *an incoming email* (or an inbox item), pulls *its entity's context packet*, and produces *a contextual draft reply back into Outlook.* This is the workflow that turns three working components into the feature you actually want. It needs (1) an inbox-item → entity link surfaced to the agent, (2) a `draft.reply.from_inbox.v1`-style action that composes with context, and (3) the Graph draft write from Gap B.

**Gap D — auth is fail-open; production hardening not switched on.** Until `LCC_API_KEY` + `LCC_ENV=production` are set on Railway, the API serves unauthenticated callers, and the `_copilot_path` passthrough admits M365 agent requests with no key. Before this loop carries client data daily, this must be closed.

**Gap E — the standing P0: secret hygiene.** Plaintext Supabase `apikey` is inlined in Power Automate flow exports; `X-LCC-Key` is visible in flow run histories. Rotation + move to Power Platform secure references is owner-action and overdue. (Tracked in the Salesforce/MS gap analysis as Gap #7.)

**Gap F — calendar is read-only.** If "respond to a client request" includes "and put the meeting on my calendar," the LCC → Outlook calendar-write flow is designed but unbuilt. Lower priority unless calendar authoring is in near-term scope.

---

## 5. Phased bridge plan

The sequencing puts security and the shared Graph foundation first, because everything outbound depends on them, then closes the two wiring gaps that make the daily loop real, then optional reach.

**Phase 0 — Secure the foundation (do first; mostly owner-action).**
Set `LCC_API_KEY` and `LCC_ENV=production` on Railway to close the fail-open auth. Rotate the exposed Supabase key and the `X-LCC-Key`, move every secret in Power Automate to environment variables / secure references, and re-export to confirm redaction. Decide on the `_copilot_path` passthrough: either require a shared secret on it or document it as acceptable given M365-layer auth. This phase unblocks nothing technically but is the precondition for trusting the loop with client data.

**Phase 1 — Durable Graph authentication (foundation for all outbound).**
Replace the static `MS_GRAPH_TOKEN` with a real OAuth flow and a token cache in `api/_shared/` (a `graph-auth.js` that returns a valid bearer, refreshing as needed). Recommended: delegated auth-code grant with an offline-access refresh token for *your* mailbox (preserves "from Scott" + your signature); app-only client-credentials is the fallback if a shared/service mailbox is acceptable. Add a health check that surfaces token expiry into the existing `lcc_health_alerts` plane so it never silently degrades again. Acceptance: `create_outlook_draft` succeeds without anyone pasting a token.

**Phase 2 — Make Copilot drafts land in Outlook (close Gap B).**
Refactor the Graph draft-creation block out of `create_outlook_draft` into a reusable helper, then have `draft_outreach_email` / `draft_seller_update_email` (and the add-in's Draft Reply) call it when the user wants a real draft. Return the `webLink` so Copilot/the add-in can say "draft is in your Outlook — open it here." Keep the text-only mode as a fallback. Acceptance: "Copilot, draft an outreach to Greg at DaVita" produces an editable Outlook draft, not chat text.

**Phase 3 — Close the client/broker reply loop (close Gap C).**
Add a `draft.reply.from_inbox.v1` action: input an `inbox_item_id` (or message correlation id), resolve the linked entity, pull its context packet via the context broker, compose a contextual reply with the template engine, and create the Outlook draft (Phase 1/2 helper) as a reply to the original. Surface this from the Outlook add-in's Draft Reply button and as a Copilot action. Log the interaction to `activity_events` (the memory layer already exists). Acceptance: open a broker email → one click / one prompt → contextual reply draft waiting in Outlook.

**Phase 4 — Reliability & observability retro-fit.**
Fold the Graph token health and the outbound-draft path into the dead-letter / `lcc_health_alerts` plane that already covers 33 flows. Add the calendar-write flow (Gap F) only if calendar authoring is confirmed in scope. Add lightweight contract tests for the intake and draft payloads so hand-edits can't silently break the shape.

**Phase 5 — Optional reach.**
Publish the Outlook add-in beyond sideload; add `bov.generate.from_intake.v1` (OM → BOV workbook) and `entity.resolve.ambiguous.v1` from the original Stage-E backlog; Salesforce event-driven inbound (separate gap-analysis track).

---

## 6. Quick wins (safe, high-value, ready now)

These are small and low-risk; I can implement Phase-2/3 code wiring on your review, but a few are owner-side toggles worth doing immediately:

- **Set `LCC_API_KEY` + `LCC_ENV=production` on Railway.** One config change closes the fail-open hole. (Owner action.)
- **Extract the Graph draft helper.** Refactoring the `create_outlook_draft` Graph block (`operations.js:2363–2429`) into `api/_shared/graph-draft.js` is mechanical and unblocks Phase 2 — no behavior change. (Claude can do this on approval.)
- **Add a Graph-token expiry health check** into `lcc_health_alerts` so the current static token's expiry stops being silent until Phase 1 lands. (Claude can do this.)
- **Wire the add-in "Draft Reply" to return the real `webLink`** once the helper exists, removing copy-paste for the most common case.

---

## 7. What only Scott can do

- Rotate the exposed Supabase key and `X-LCC-Key`; move Power Automate secrets to secure references (Phase 0 / P0).
- Set `LCC_API_KEY` + `LCC_ENV=production` on Railway.
- Register / consent the Azure AD app for the new Graph OAuth grant (Phase 1) and complete the one-time auth-code consent for your mailbox.
- Re-publish the Copilot Studio agent and refresh the custom connector's OpenAPI after any action-schema change.
- Sideload (or publish) the updated Outlook add-in.

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

- 2026-05-22 — Document created. Audited the Copilot + Outlook surfaces against live code, confirmed the April bidirectional plan is largely executed, identified the last-mile/auth gaps (Graph token, Copilot-draft wiring, reply-loop chain, fail-open auth, P0 secrets), and set a six-phase bridge plan.
