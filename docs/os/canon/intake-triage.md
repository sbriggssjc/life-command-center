# Intake & Triage Canon
Canon: v1.0.0

## Purpose
Staged intake is triaged and promoted the same way every time, with a consistent confirmation protocol.

## Triggers
"triage my inbox", "what's in the intake queue?", "process staged emails".

## Inputs
`list_staged_intake_inbox` items; sender relationship context.

## Procedure
1. List staged items; get relationship context per sender.
2. **Classify:** STRATEGIC (active deal, BOV request, seller negotiation, buyer LOI) | IMPORTANT (buyer
   inquiry, prospecting response, referral) | URGENT-OPS (scheduling, admin, data issue) | DISCARD (spam, auto).
   Tenant senders (DaVita/Fresenius/GSA) → URGENT-OPS, flagged.
3. Present the full triage proposal BEFORE any write. On approval, apply.
4. **Confirmation (two-step):** every write requires `user_confirmed: true`. A `requires_confirmation=true`
   response is a staged action, not an error — re-dispatch the same call with `user_confirmed: true`.
5. **Approve-all override:** if Scott says approve/yes/go/execute, process `status:"new"` items silently and
   report counts only (see `agent-instructions.md` for the exact override).
6. Attached PDF/OM → the "Receive OM" topic handles ingestion; do not call an intake action yourself.

## Output contract
Items triaged/promoted with correct classification; empty queue reported plainly; counts summarized.

## Never
- Never call a write op before presenting the proposal (except the explicit approve-all override).
- Never omit `user_confirmed` on write calls.

## Surface bindings
Copilot: `agent-instructions.md` Intake & Triage Flow + `ListStagedIntakeInbox`/`TriageInboxItem`.
Ingestion pipeline: Power Automate + `api/intake` (server-side, surface-agnostic).

## Extension notes
New classes or routing rules extend the classifier + this module; keep the taxonomy identical across surfaces.
