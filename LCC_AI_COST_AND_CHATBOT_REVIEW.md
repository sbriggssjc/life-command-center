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

## Implementation Progress

- Added repo-local AI orchestration helpers in `api/_shared/ai.js`.
- Added `api/chat.js` as a first-party chat endpoint that authenticates requests, proxies chat to the configured provider, and logs `ai_call` telemetry into `perf_metrics`.
- Updated `app.js` copilot chat to call `/api/chat` instead of the direct external edge chat endpoint.
- Added first-pass ChatGPT / Claude export actions to:
  - property detail research quick links
  - ops research queue items
- Added embedded in-app assistant actions backed by `/api/chat` for:
  - ops research queue tasks
  - property detail ownership workflow
  - property detail intel workflow
- Added assistant-to-workflow actions:
  - copy assistant output
  - apply assistant output into ownership notes
  - apply assistant output into research notes
  - load assistant follow-up drafts into the research follow-up modal
- Extended the research follow-up flow to accept a follow-up description/notes field.
- Added a first-pass research intake workflow inside the property detail Intel tab.
- The intake workflow can read text-based files locally in-browser and accept pasted/extracted research text.
- Intake analysis now routes through the repo-local AI endpoint and can be applied directly into research notes.
- PDF and image uploads are explicitly flagged as pending OCR/manual text extraction instead of pretending to extract them.
- Extended the intake workflow to support review-first screenshot analysis with uploaded or pasted images.
- Added attachment plumbing from the UI through `/api/chat` so image research artifacts can be forwarded to the configured AI provider when supported.
- Extended intake analysis to request structured JSON facts alongside the readable summary.
- Added a review-first “apply extracted facts to fields” action that prefills Intel sale, loan, and cash-flow inputs without auto-saving.
- Extended the ownership assistant to request structured ownership JSON alongside the readable analyst response.
- Added a review-first ownership field prefill action for recorded owner, true owner, owner type, contact details, and incorporation state.
- Added `Save Reviewed Intel` to batch-save populated Intel sections after analyst review, using the existing save handlers with one refresh at the end.
- Added `Save Reviewed Ownership` so assistant-prefilled ownership fields can flow straight into the existing ownership save path.
- Added an AI usage section to the existing Performance Dashboard, backed by recent `ai_call` telemetry from `perf_metrics`.
- The dashboard now summarizes recent AI calls by feature, provider, latency, token totals when available, attachment counts, statuses, and recent call activity.
- Normalized AI telemetry at the `/api/chat` boundary so embedded assistants log their real feature names instead of collapsing into `global_copilot`.
- Added model, cache-hit, cache-read-token, and normalized token fields to AI telemetry so the dashboard can show more reliable cost and caching signals.
- Updated the global copilot in `app.js` to use the shared assistant helper, so global chat traffic is tagged consistently as `global_copilot` in the same telemetry path as embedded assistants.
- Added telemetry quality indicators to the AI dashboard so missing model, usage, or cache data is visible instead of silently skewing cost analysis.
- Added a repo-local direct OpenAI chat path behind `AI_CHAT_PROVIDER=openai`, so `/api/chat` can bypass the external edge function when you want a first-party telemetry contract.
- Added `AI_CHAT_MODEL` to `.env.example` so chat routing can move independently from the batch research model.
- Added a repo-local Ollama chat path behind `AI_CHAT_PROVIDER=ollama`, using Ollama's `/api/chat` endpoint with local image support and normalized token telemetry from prompt/eval counts.
- Added per-feature provider/model routing for `/api/chat`, so individual assistant flows can be assigned to `edge`, `openai`, or `ollama` without changing the frontend call sites.
- Added `AI_CHAT_FEATURE_PROVIDERS` and `AI_CHAT_FEATURE_MODELS` env hooks for feature-level routing control.
- Added an opt-in `AI_CHAT_POLICY=balanced` preset that applies the recommended first-cut routing mix without requiring manual JSON maps for every feature.
- Added routing-policy visibility to the AI dashboard so the active default route and feature overrides are visible next to live telemetry.
- Added route-mismatch detection to the AI dashboard so you can see when configured feature routing does not match recent observed provider/model traffic.
- Added a rollout-readiness indicator to the AI dashboard so it is obvious whether feature routing is actually active or still effectively manual/default-only.
- Added a suggested-next-step panel to the AI dashboard so rollout actions are driven by current readiness, mismatch status, and telemetry coverage.
- Added `AI_CHAT_BALANCED_PRESET.env.example` as a concrete staged-routing preset artifact for rollout.
- Added `AI_CHAT_MANUAL_EDGE_PRESET.env.example` as a clean rollback/default preset.
- Added `AI_CHAT_LOW_COST_PRESET.env.example` as a more aggressive low-cost routing preset for post-balanced rollout testing.
- Added preset catalog visibility to the AI dashboard so the available rollout artifacts are visible next to the active routing state.
- Refactored `pipeline/ai_research.py` to support configurable providers:
  - `openai`
  - `ollama`
  - `disabled`
- Changed the default batch research model from `gpt-4o` to `gpt-5-mini`.
- Extended `.env.example` with AI routing/configuration variables.

## Likely Next Implementation Tracks

- Add a repo-local chat orchestration layer so model routing, caching, logging, and fallback do not live only in the external edge function.
- Split AI work into tiers:
  - Tier 1: deterministic/local rules
  - Tier 2: cheap API or local OSS model
  - Tier 3: premium model only for ambiguous/high-value tasks
- Add embedded copilot actions inside research, ownership, message drafting, and activity logging surfaces instead of only one global chat panel.
- Add async batch enrichment for entity resolution, county lookup, contact discovery, call summaries, and document extraction.

## Rollout Playbook

### Recommended First Rollout

- Goal: move cheap/review-first assistant flows onto lower-cost/local providers while keeping higher-ambiguity workflows on stronger models.
- Recommended starting policy:
  - `detail_intake_assistant` -> `ollama`
  - `detail_intel_assistant` -> `ollama`
  - `ops_research_assistant` -> `ollama`
  - `detail_ownership_assistant` -> `openai`
  - `global_copilot` -> `edge`

### Example Env Configuration

```env
AI_CHAT_POLICY=balanced
AI_CHAT_PROVIDER=edge
AI_CHAT_MODEL=gpt-5-mini
AI_CHAT_FEATURE_PROVIDERS={"detail_ownership_assistant":"openai","global_copilot":"edge"}
AI_CHAT_FEATURE_MODELS={"detail_intake_assistant":"llama3.2-vision","detail_intel_assistant":"llama3.1","ops_research_assistant":"llama3.1","detail_ownership_assistant":"gpt-5-mini"}
```

### Rollout Verification

1. Open the Performance Dashboard and go to the AI section.
2. Confirm `Rollout Readiness` shows routing is active.
3. Confirm `Routing Policy` matches the configured default provider/model and feature overrides.
4. Confirm no unexpected entries appear under `Routing Mismatches Detected`.
5. Run each workflow at least once:
   - global copilot
   - ops research assistant
   - detail ownership assistant
   - detail intel assistant
   - detail intake assistant with text
   - detail intake assistant with image
6. Confirm the feature/provider/model rows match the intended routes.
7. Confirm telemetry quality is acceptable:
   - model coverage should be high
   - usage coverage should be high for repo-local OpenAI and Ollama paths
   - cache coverage may still be partial depending on provider path

### Rollback

- To disable staged routing and return to the previous behavior:

```env
AI_CHAT_POLICY=manual
AI_CHAT_FEATURE_PROVIDERS=
AI_CHAT_FEATURE_MODELS=
AI_CHAT_PROVIDER=edge
```

### Decision Rules After Initial Rollout

- Keep a feature on `ollama` if:
  - analyst output quality is acceptable
  - structured extraction remains reliable
  - latency is acceptable
- Move a feature from `ollama` to `openai` if:
  - ownership/entity reasoning is too weak
  - screenshot interpretation is unreliable
  - structured extraction drifts too often
- Move a feature off `edge` if:
  - telemetry quality remains too poor for cost control
  - the repo-local path provides equivalent answer quality
  - you want direct model/provider control

## Open Questions

- What logic currently lives inside the external `ai-copilot/chat` edge function, and what is its current monthly token spend by route/use case?
- Which manual-research steps are highest frequency and highest pain today: ownership tracing, contact hunting, comp gathering, note drafting, or CRM logging?
- Which current subscriptions and desktop workflows are acceptable for human-in-the-loop use versus full automation?

## Detailed Implementation Plan

### Phase 0 - Baseline And Controls

- Goal: make AI usage measurable before changing architecture.
- Add an AI inventory document that lists every AI touchpoint by:
  - route
  - model
  - prompt purpose
  - synchronous vs async
  - user-facing vs back-office
  - current estimated volume
- Capture current spend and volume by workflow:
  - global copilot chat
  - research enrichment jobs
  - outbound drafting
  - call/document summarization
- Add request logging fields to every AI invocation path:
  - `feature`
  - `model`
  - `provider`
  - `input_tokens`
  - `output_tokens`
  - `latency_ms`
  - `cache_hit`
  - `workspace_id`
  - `user_id`
- Define guardrails:
  - max context size
  - max output size
  - timeout per feature
  - model allowlist by feature
  - fallback behavior when AI is unavailable

### Phase 1 - Centralize AI Orchestration

- Goal: stop scattering model logic across frontend, Python jobs, and external edge functions.
- Create a repo-local AI service layer, likely under:
  - `api/_shared/ai.js` for server-side orchestration
  - `api/chat.js` or `api/copilot.js` for first-party chat routing
- Responsibilities of the AI service:
  - provider abstraction
  - model routing
  - prompt templates
  - structured output parsing
  - cost/usage logging
  - retry/fallback behavior
  - prompt caching strategy
- Migrate hard-coded edge URLs toward config-based routing:
  - replace direct `ai-copilot` constants in `app.js` and `detail.js`
  - route frontend chat through repo-local API first
- Keep the external `ai-copilot` edge function only where it is still required, but document its contract and reduce hidden coupling.

### Phase 2 - Tiered Model Routing

- Goal: use the cheapest acceptable model for each task.
- Define service tiers:
  - Tier A: deterministic/no-model logic
  - Tier B: local/open-source or ultra-cheap model
  - Tier C: mid-tier API model for standard extraction/summarization
  - Tier D: premium reasoning model for ambiguous, high-value decisions
- Initial routing proposal:
  - deterministic/rules:
    - simple queue explanations
    - canned message templates
    - local dashboard summaries
  - cheap/local:
    - OCR cleanup
    - screenshot text extraction
    - email/call summary first pass
    - classification, tagging, dedupe hints
  - mid-tier API:
    - structured entity extraction
    - county lookup validation
    - contact discovery synthesis
    - note-to-CRM formatting
  - premium model:
    - ownership resolution with conflicting evidence
    - nuanced user Q&A over multiple data sources
    - final deliverable drafting
    - high-stakes outbound response drafting
- Add per-feature config so models can be changed without code edits.

### Phase 3 - OpenAI Cost Optimization

- Goal: reduce OpenAI spend without losing useful capability.
- Migrate new and priority chat flows from Chat Completions to Responses API.
- Standardize prompt structure with stable prefixes for better cache reuse.
- Move all non-urgent enrichment to async queues:
  - entity resolution
  - county lookup
  - contact discovery
  - batch summaries
  - document extraction
- Use Batch/Flex-style processing for overnight or background jobs.
- Add hard limits per request:
  - truncate history aggressively
  - cap output tokens
  - require JSON schemas for extraction tasks
- Replace “send everything” prompts with record-specific context packs.

### Phase 4 - Human-In-The-Loop Subscription Workflows

- Goal: shift expensive research and drafting work from API calls to existing paid chat subscriptions where a human is already involved.
- Add “Open in ChatGPT” and “Open in Claude” payload builders from:
  - research queue
  - property detail
  - contact detail
  - messaging composer
- Each payload builder should package:
  - core property/contact metadata
  - recent notes
  - desired deliverable format
  - compliance reminder
  - answer template
- Suggested subscription-first workflows:
  - ownership trace memo
  - contact search strategy
  - first draft of OM/email/call prep
  - call summary normalization
  - market narrative generation
- Capture the result back into LCC via a paste/import action so the chat output becomes structured internal data instead of dead text.

### Phase 5 - Embedded Copilot UX

- Goal: place AI where the manual work happens instead of relying on one global chatbot.
- Add embedded assistants to the following surfaces:
  - Research Queue (`ops.js`)
  - Ownership / Research panel (`detail.js`)
  - Contact messaging and message templates (`api/contacts.js` + UI)
  - Activity/call logging flows
- Research Queue assistant should:
  - summarize the task
  - propose next 3 actions
  - draft completion note
  - draft follow-up task
  - identify missing fields
- Ownership assistant should:
  - summarize existing ownership chain
  - convert pasted notes into structured owner fields
  - produce confidence and unresolved questions
- Messaging assistant should:
  - generate channel-specific drafts
  - shorten/expand tone
  - generate follow-up variants
  - summarize message thread before reply
- Logging assistant should:
  - convert rough notes into CRM-safe activity logs
  - separate private notes from Salesforce-safe notes
  - propose next action and due date

### Phase 6 - Document, Screenshot, And Research Intake

- Goal: speed up manual research collection without unsafe scraping.
- Build a user-initiated intake tool for:
  - screenshots
  - PDFs
  - copied page text
  - emails
  - call notes
- Processing stages:
  - local OCR / extraction
  - field detection
  - confidence scoring
  - human review/edit
  - save to canonical tables or research outcome log
- Target use cases:
  - brochure/OM intake
  - lease abstract extraction
  - offering memo summary
  - screenshot-to-note conversion
  - call transcript to action items
- Compliance position:
  - no unattended scraping of CoStar/LoopNet
  - no autonomous crawling behind login walls
  - only user-mediated capture and review unless licensing explicitly allows more

### Phase 7 - Open-Source / Low-Cost Model Adoption

- Goal: reserve paid frontier models for tasks that clearly justify them.
- Evaluate a local or low-cost stack for:
  - OCR post-processing
  - NER/entity extraction
  - record classification
  - duplicate detection hints
  - basic summarization
- Architecture pattern:
  - local worker process for cheap transforms
  - API model only on escalation
- Good first candidates:
  - ingestion preprocessing
  - propagation QA
  - note cleanup
  - transcript condensation
  - standard deliverable boilerplate generation
- Add human override and confidence thresholds before writes to production records.

### Phase 8 - Data Propagation And Closed-Loop Automation

- Goal: use AI to assist propagation, not silently mutate core records.
- Add AI-assisted “proposed change” generation instead of direct writes for:
  - owner/contact merges
  - normalized field fills
  - missing metadata inference
  - research outcome summarization
- Persist all AI-generated proposals through existing audited/manual-review paths.
- Prefer `pending_updates` / `data_corrections` style reviewable records when confidence is below threshold.
- Add feedback capture:
  - accepted
  - edited
  - rejected
- Use that feedback to tune prompts, routing, and confidence thresholds.

### Phase 9 - Deliverables And User Query Assistance

- Goal: improve turnaround on standard outputs and Q&A.
- Add structured generators for:
  - property summary
  - ownership memo
  - contact brief
  - call prep sheet
  - post-call summary
  - follow-up email draft
  - market update note
- For chatbot Q&A:
  - classify the question first
  - answer from local structured data when possible
  - only call an LLM when synthesis is actually needed
  - return sources/record links inside the answer
- Add answer modes:
  - quick answer
  - analyst brief
  - action checklist

### Phase 10 - Verification, Rollout, And Governance

- Goal: ship incrementally without blowing up reliability or cost.
- Rollout order:
  1. instrumentation and inventory
  2. central AI service
  3. model routing and cheaper defaults
  4. embedded assistants on research/detail surfaces
  5. screenshot/document intake
  6. subscription workflow bridges
- Add tests for:
  - prompt builders
  - structured output parsing
  - fallback behavior
  - model routing rules
  - redaction of CRM-safe vs private notes
- Add governance checks:
  - block disallowed source ingestion paths
  - block raw automated scraping workflows for restricted sites
  - require explicit user review on low-confidence writes

## Proposed First Sprint

- Build Phase 0 telemetry and feature inventory.
- Add repo-local `api/chat.js` or equivalent orchestration entrypoint.
- Migrate `pipeline/ai_research.py` to a configurable router with cheaper defaults.
- Add one embedded assistant to the research queue and one to the property detail panel.
- Add “Open in ChatGPT/Claude” structured export for ownership research and outbound drafting.
- Define compliance rules for screenshot/document intake before implementing capture features.

## Success Metrics

- 30-50% reduction in paid API spend for batch/back-office AI tasks.
- Faster time-to-complete for research queue items.
- Higher percentage of research tasks completed with structured notes and follow-up actions.
- Reduced analyst time spent on repetitive drafting and CRM logging.
- Lower rate of low-value premium-model calls for tasks that local logic or subscription chats can handle.
