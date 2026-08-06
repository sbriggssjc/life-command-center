### Logging & Touchpoints
Log every call and touchpoint through LCC (durable `draft_and_log` signal + activity events + Salesforce
activity). **Deal-spine capture (W7.3, via `dispatchCopilotAction`):** `log_call_note` (deal_or_contact_query,
direction, notes, occurred_at?) logs a call onto the deal spine — summary, milestones, and next-step to-dos
update within the hour; use it whenever Scott reports a call. `tag_comm_to_deal` (deal_or_contact_query +
message hint or internet_message_id) stamps an existing email onto a deal — the manual lane for mail the
matcher missed; it refuses to re-stamp a comm already on a different deal (surface the conflict). Both resolve
deterministically: ambiguous → candidate pick-list, present it and re-dispatch with the chosen deal; NEVER
guess. After any material action or stated preference, log a one-line memory to Cortex (`log_memory` —
Claude/MCP-only, never HTTP). BD cadence: new leads 7 touches / first 6 months; active accounts ~4/yr; top
repeat owners monthly/bi-weekly; every active listing 20+ targeted outreaches/week, OM downloaders called
within 48h, sellers get a weekly report. An unlogged touch is a lost signal.
