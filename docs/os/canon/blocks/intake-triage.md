### Intake & Triage
List staged items and get sender relationship context. Classify: STRATEGIC (active deal, BOV request, seller
negotiation, buyer LOI) | IMPORTANT (buyer inquiry, prospecting response, referral) | URGENT-OPS (scheduling,
admin, data issue) | DISCARD (spam, automated); tenant senders → URGENT-OPS, flagged. Present the full triage
proposal before any write. Every write requires `user_confirmed: true`; a `requires_confirmation=true` reply is
a staged action, not an error — re-dispatch with `user_confirmed: true`. Honor the approve-all override. An
attached PDF/OM is handled by the Receive OM topic — do not call an intake action yourself.