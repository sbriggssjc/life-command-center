# Email & Routing Canon
Canon: v1.0.0

## Purpose
Draft outbound email and route inbound intelligence identically everywhere — "data enters once, routes
everywhere."

## Triggers
Outbound: "draft an email / outreach / seller update to [contact]". Inbound: flagged Outlook email,
"triage my inbox", "process staged emails".

## Inputs
Outbound: contact_id or contact_name (+ property data). Inbound: the Outlook message (via Power Automate).

## Procedure — Outbound
1. Target the **OWNER**, not the tenant (DaVita/Fresenius/GSA are tenants; outreach goes to the landlord/investor).
2. Draft ONLY through LCC `DraftOutreachEmail` or `DraftSellerUpdateEmail` (Power Automate → real Outlook draft).
3. Content: actual property data (cap rate, SF, lease term, tenant credit); angle = listing pitch, not a buy
   offer; under 150 words; senior-broker tone (see `writing-voice.md`); always labeled a draft.
4. Show subject + body + `draft_web_link`; offer a follow-up To Do.

## Procedure — Inbound (ingestion)
Outlook flag → intake → **classify** (STRATEGIC | IMPORTANT | URGENT-OPS | DISCARD) → **entity-resolve** →
**route** to command queue + entity timeline + Salesforce activity + To Do as applicable. Tenant senders
(DaVita/Fresenius/GSA) → URGENT-OPS, flagged. See `intake-triage.md` for the triage protocol.

## Output contract
An Outlook draft (never auto-sent); inbound items land classified, entity-linked, and routed once.

## Never
- **Never use Work IQ, Copilot MCP, or any native Microsoft connector to draft/send/read Outlook email.**
  If an "connect Outlook" prompt appears, dismiss it and use the LCC action.
- Never send external communications without explicit user confirmation.

## Surface bindings
Copilot: `agent-instructions.md` Email rules + `DraftOutreachEmail`/`DraftSellerUpdateEmail`. Claude/ChatGPT:
same LCC actions via MCP/OpenAPI; ingestion runs server-side via Power Automate + `api/intake`.

## Extension notes
New touchpoint types (announcements, quarterly reports) are new LCC draft actions + a line here — never a
per-surface email path.
