# LCC AI Cost And Chatbot Review

## Session

- Date: 2026-03-24
- Objective: Analyze current OpenAI and chatbot usage, identify lower-cost architecture options, and find places where chatbot/agent UX can reduce manual research effort.

## Repo Findings

- Frontend copilot UI exists in `app.js` and `index.html`.
- Copilot sends requests to the external Supabase edge function `ai-copilot/chat`, not to a repo-local Vercel API route.
- The repo does not contain an `api/chat` handler; AI chat logic lives outside this repository.
- Python research enrichment uses OpenAI directly in `pipeline/ai_research.py` with `chat.completions.create(...)` and default model `gpt-4o`.
- Existing sync/connectors already depend on the external `ai-copilot` edge function for Salesforce, Outlook, calendar, and copilot behavior.
- Manual research surfaces already exist and are strong candidates for embedded AI assist:
  - Ops research queue
  - Property detail ownership research
  - Research quick links
  - Free-form research notes
  - Messaging templates and outbound drafting

## Code References

- `app.js:4996` copilot state starts.
- `app.js:5013` copilot sends messages.
- `app.js:5085` copilot context builder.
- `app.js:5110` local copilot fallback logic.
- `pipeline/ai_research.py:15` default model is `gpt-4o`.
- `pipeline/ai_research.py:167` AI call wrapper.
- `pipeline/ai_research.py:177` uses Chat Completions directly.
- `detail.js:1603` direct hard-coded edge function base URL.
- `api/sync.js:20-21` shared `EDGE_FUNCTION_URL` points to external `ai-copilot`.
- `ops.js:737` research queue rendering.
- `ops.js:798` research completion action.
- `detail.js:1341` research quick links helper.
- `detail.js:1187` free-form research notes field.
- `api/contacts.js:1489` static message templates.

## External Findings

- OpenAI currently recommends the Responses API for new projects instead of Chat Completions.
- OpenAI docs state Responses can improve cache utilization and lower cost versus Chat Completions in agentic flows.
- OpenAI Batch API offers 50% lower cost for async jobs.
- OpenAI Flex processing uses Batch-rate pricing for slower async-tolerant workloads.
- OpenAI prompt caching is automatic and can reduce input cost significantly when prompts share a stable prefix.
- Current OpenAI docs show:
  - `gpt-5.1` is the flagship coding/agentic API model.
  - `gpt-5-mini` is the lower-cost high-volume option.
  - `gpt-oss-20b` is an open-weight local/specialized option.
- ChatGPT Plus/Pro subscriptions are for ChatGPT product usage; API usage remains separately billed.
- CoStar and LoopNet terms appear to prohibit scraping, automated extraction, or building databases from their product content without permission.
- CoStar terms also appear to restrict exposing Company Information to open AI tools.

## Recommendations In Progress

- Prefer AI only where it directly shortens analyst time or improves data quality.
- Move background enrichment and propagation off expensive synchronous calls.
- Route simple drafting, summarization, and first-pass reasoning to subscription chats or lower-cost local/open models.
- Keep any CoStar/LoopNet assistance user-mediated and permissions-aware; avoid automated scraping/export pipelines unless contractually authorized.

## Likely Next Implementation Tracks

- Add a repo-local chat orchestration layer so model routing, caching, logging, and fallback do not live only in the external edge function.
- Split AI work into tiers:
  - Tier 1: deterministic/local rules
  - Tier 2: cheap API or local OSS model
  - Tier 3: premium model only for ambiguous/high-value tasks
- Add embedded copilot actions inside research, ownership, message drafting, and activity logging surfaces instead of only one global chat panel.
- Add async batch enrichment for entity resolution, county lookup, contact discovery, call summaries, and document extraction.

## Open Questions

- What logic currently lives inside the external `ai-copilot/chat` edge function, and what is its current monthly token spend by route/use case?
- Which manual-research steps are highest frequency and highest pain today: ownership tracing, contact hunting, comp gathering, note drafting, or CRM logging?
- Which current subscriptions and desktop workflows are acceptable for human-in-the-loop use versus full automation?
