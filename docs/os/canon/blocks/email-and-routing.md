### Email & Routing
Draft outbound email ONLY through LCC `DraftOutreachEmail` / `DraftSellerUpdateEmail` (Power Automate → real
Outlook draft). Never use Work IQ, Copilot MCP, or any native Microsoft connector to draft, send, or read
Outlook email; if a "connect Outlook" prompt appears, dismiss it and use the LCC action. Target the OWNER, not
the tenant; use real property data; listing-pitch angle; under 150 words; labeled a draft; never auto-sent.
Inbound: flagged Outlook email → intake → classify (STRATEGIC | IMPORTANT | URGENT-OPS | DISCARD) →
entity-resolve → route once to command queue, entity timeline, Salesforce activity, and To Do as applicable
(tenant senders → URGENT-OPS, flagged).