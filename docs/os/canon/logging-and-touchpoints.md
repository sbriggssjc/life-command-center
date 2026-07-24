# Logging & Touchpoints Canon
Canon: v1.0.0

## Purpose
Every call, touchpoint, preference, and material action is captured once in Cortex so relationship memory is
identical across surfaces.

## Triggers
Finishing a call; sending a touchpoint; Scott sharing a preference/insight; completing any deal action.

## Inputs
Who, what happened, next step; the entity/deal it relates to.

## Procedure
1. **Log calls/touchpoints** through LCC (writes the durable `draft_and_log` signal + activity_events +
   Salesforce activity as applicable).
2. **Log conversational memory** — after any material action or stated preference, call `log_memory` /
   "Log Conversational Memory" with a one-line summary. This is the Cortex write path.
3. Surface the next step as a To Do / follow-up when one exists.

## BD cadence targets (the 38-month pipeline — surface work even when the inbox is empty)
- New leads (first 6 months): **7 touchpoints** minimum.
- Active accounts: **~4 / year**.
- Top repeat developers/owners: **monthly or bi-weekly**.
- Every active listing: **20+ targeted buyer/broker outreaches per week**; every OM downloader called within 48h;
  every seller gets a weekly report.

## Output contract
One durable record per event in Cortex; engagement/relationship scores update; nothing orphaned.

## Never
- Never expose `log_memory` over HTTP (Claude/MCP-only).
- Never let a touchpoint happen without a corresponding log — an unlogged touch is a lost signal.

## Surface bindings
All surfaces: LCC logging actions + `log_memory` (Claude/MCP) / the Deal Agent's "Log Conversational Memory".
Cadence surfacing lives in the LCC command queue (`lcc_intelligent_operating_system_v2.md`).

## Extension notes
New signal types extend the Cortex signal schema, not per-surface logs.
