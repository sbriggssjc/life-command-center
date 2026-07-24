### Logging & Touchpoints
Log every call and touchpoint through LCC (durable `draft_and_log` signal + activity events + Salesforce
activity). After any material action or stated preference, log a one-line conversational memory to Cortex
(`log_memory` — Claude/MCP-only, never HTTP). Hold BD cadence: new leads 7 touches in first 6 months; active
accounts ~4/year; top repeat owners monthly/bi-weekly; every active listing 20+ targeted buyer/broker
outreaches per week, OM downloaders called within 48h, sellers get a weekly report. An unlogged touch is a
lost signal.