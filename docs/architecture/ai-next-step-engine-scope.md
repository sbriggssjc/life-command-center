# Content-aware next-step engine — scope + AI hosting options

**Date:** 2026-07-30 · **Status:** scope (no build yet) · **Author:** LCC/Claude session
**Companion:** `contact-reconciliation.md` (§"Self-updating to-do engine") — this doc plans the AI half.

## 1. The goal (Scott's ask)

Today `lcc_advance_todos` already closes the loop mechanically: seller replies → the follow-up resolves and a
generic **"Review seller response & set next step"** to-do appears. The next step is to make that to-do
**content-aware** — read the reply and name the actual move: *"Seller countered at $4.0M → review counter &
respond,"* *"Seller accepted → open escrow & order title,"* *"Seller needs a week → reschedule follow-up to +7d."*
And, where useful, **draft the follow-up / template email** in Scott's voice for one-click send.

Constraint (explicit): **do not add or increase cost** where avoidable. Ideal end-state: a **local, on-prem model
trained only on our data** for drafting/templates, so nothing leaves Northmarq and marginal cost is ~$0.

## 2. Where it plugs in (design)

The engine is a thin AI step between "an inbound reply landed on a deal" and "write the next to-do." It does NOT
replace the deterministic engine — it **enriches** it.

```
inbound reply on a deal (logInboundCorrespondenceDualAnchor)
   → deriveNextStep(emailBody, dealContext)        ← NEW: one AI call, structured output
        → { intent, next_action_title, action_type, due_offset_days, confidence, draft_reply? }
   → lcc_advance_todos(..., p_next_title, p_next_type, p_due)   ← extend to accept a specific title/type
        → resolves the awaiting follow-up + creates the SPECIFIC next-step to-do
```

**Design rules (mirror the doctrines):**
- **Deterministic-first, AI-assist.** The AI returns a *classification* (intent) + a short factual summary. The
  to-do title is **templated from the intent**, not free-form model prose — so a hallucination can't invent a
  fake instruction. Low confidence → fall back to today's generic "review response" to-do (never worse than now).
- **Drafts are drafts.** Any drafted reply is saved to Outlook Drafts (the existing offer-submission path),
  labeled a draft, **never auto-sent** — same rule as every other writer.
- **Reversible + provenance.** The derived intent + model + confidence ride in `action_items.metadata`
  (`ai_intent`, `ai_confidence`, `ai_model`), so every auto-created to-do is auditable and undoable.
- **Voice from the canon.** Drafting uses the existing **`BRIGGS-WRITING-VOICE.md`** profile as few-shot context
  — we already have Scott's voice captured; we do NOT need to "train a model" to sound like him for a first cut.

### Extraction schema (structured output)
```json
{ "intent": "accepted | countered | needs_more_time | declined | question | scheduling | info_request | other",
  "summary": "one factual sentence (no invention)",
  "counter_price": 4000000,                 // when intent=countered, else null
  "next_action_title": "Review counter ($4.0M) & respond — <deal>",
  "action_type": "review_response | draft_counter_reply | schedule_call | send_docs | reschedule_follow_up",
  "due_offset_days": 0,
  "confidence": 0.0-1.0,
  "draft_reply": "optional, voice-matched, labeled DRAFT" }
```
Intent → title/type is a fixed map (templated); the model fills the slots (price, deal). This is the safe pattern.

## 3. The key finding: the AI layer already exists

`api/_shared/ai.js` already provides **`invokeExtractionAI({prompt})`** — a self-contained-prompt extractor with a
multi-model fallback chain, used **daily** for OM extraction:

- **Primary = the "edge" provider** — a Supabase edge function (`ai-copilot` on the Dialysis_DB project) that
  relays to **Claude**.
- **Fallback = OpenAI** (`OPENAI_API_KEY`, gpt-4o-mini) on 429/5xx.
- The provider switch **explicitly anticipates `ollama` (local) and `anthropic-direct`** as future providers
  (`ai.js` line ~555, comment: *"Future: support anthropic-direct, ollama, etc."*).

**Implication:** a working content-aware engine is a **new prompt + schema on an existing, already-paid-for
path** — not new infrastructure. And the on-prem model Scott wants is a **documented plug-in point**, not a
rebuild: point a new `ollama` provider at a local endpoint and add it to the chain.

## 4. AI hosting options — cost / privacy / effort (the heart of the ask)

| Option | Marginal cost | Data privacy | Effort | Quality | Notes |
|---|---|---|---|---|---|
| **A. Reuse existing LCC path** (edge→Claude + OpenAI fallback) | ~**$0 net-new** (pennies of tokens on infra already running) | Data goes to the model API already used for OM extraction | **Lowest** (prompt + schema only) | High (frontier) | **Ship phase 1 here.** No new accounts, no new cost line. |
| **B. Azure OpenAI on Northmarq's tenant** | Pay-per-token, but on Northmarq's **existing Azure agreement** (often pre-committed spend) | **Strong** — enterprise: customer data **not used to train models**, stays in tenant/region, ZDR options | Medium (Azure resource + key; point the provider at it) | High | Best **Microsoft-aligned** programmatic option; uses the M365/Azure relationship you already pay for. Confirm with Northmarq IT whether Azure OpenAI is enabled + has committed spend. |
| **C. M365 Copilot / Copilot Studio** | **Adds cost** — Copilot Studio bills **per message/credit**; M365 Copilot is a per-user license. UI/agent-oriented, not a clean pipeline API | In-tenant | Medium-High | High | Good for **Scott-interactive** help inside Outlook, weak fit for the **automated** pipeline. Consumption credits are a new cost line — counter to the constraint. |
| **D. Northmarq Claude subscription** | Depends what it is | Per Anthropic's commercial terms | Low-Med | High (frontier) | **If it's Claude for Work (chat UI):** great for Scott interactively, **not programmatic** — can't back the pipeline. **If it includes API/Claude Platform access:** it could back the edge function directly (reuse). **Action: confirm which with Northmarq IT.** |
| **E. Local / on-prem open-source** (Ollama/vLLM + Llama 3.x / Phi-4 / Mistral) | **~$0 marginal** (hardware + electricity only) | **Maximum** — data **never leaves Northmarq**; can fine-tune on our email corpus | **Highest** (hardware + setup + ops; optional fine-tune project) | Good for classification; good-with-tuning for drafting; below frontier on nuance | **Scott's ideal.** Wire as the `ollama` provider (already anticipated). Needs a box: a GPU workstation or a Mac with enough RAM runs an 8–14B model comfortably. |

Sources for the current facts (2026): Azure OpenAI enterprise privacy / no-train guarantee
([Microsoft Learn](https://learn.microsoft.com/en-us/answers/questions/5938825/azure-openai-data-privacy-and-enterprise-features),
[MS Security FAQ](https://techcommunity.microsoft.com/blog/microsoft-security-blog/faq-protecting-the-data-of-our-commercial-and-public-sector-customers-in-the-ai-/4097231));
Copilot Studio message-credit pricing
([Microsoft](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio),
[SamExpert](https://samexpert.com/copilot-studio-licensing-guide/)); local/on-prem model landscape
([Hugging Face](https://huggingface.co/blog/daya-shankar/open-source-llm-models-to-run-locally),
[VRAM-tier guide](https://www.promptquorum.com/local-llms)).

## 5. "Train a model on our data" — the honest nuance

Two different things get conflated as "train on our data":
- **RAG / few-shot (no training).** Feed the model the relevant context at call time — the deal's correspondence
  (we already capture it on the dual-anchor spine) + `BRIGGS-WRITING-VOICE.md` (already in the canon). This gets
  **most** of the value — voice-matched drafts, deal-aware next-steps — at **near-zero cost and no training
  project**, and it improves automatically as the spine grows. **Recommended default.**
- **Fine-tuning (LoRA on our email corpus).** A bounded project that bakes Scott's voice/patterns into a local
  model's weights, so even a small on-prem model drafts in-voice without long prompts. Real value for the
  **on-prem, our-data-only** ideal, but it's an ongoing effort (curate the corpus, train, evaluate, re-train as
  style drifts). We've **already been ingesting Scott's 10+ yr sent-email corpus** — that IS the training set if
  we go here. Do this in **phase 3**, only if phase-1/2 quality or privacy demands it.

## 6. Recommendation — phased, cost-first

- **Phase 1 — ship the content-aware engine on the existing path (≈ $0 net-new).** Add `deriveNextStep` calling
  `invokeExtractionAI` with the schema above; extend `lcc_advance_todos` to take a specific title/type/due; wire
  into the inbound path. Deterministic-first, low-confidence → today's generic to-do. **This is the next build.**
- **Phase 2 — privacy/enterprise alignment, still no new product cost.** If any correspondence content shouldn't
  transit a public API, point the provider at **Azure OpenAI on Northmarq's tenant** (enterprise no-train
  privacy, on the Microsoft relationship you already pay for). Also fold in **drafting** (follow-ups, templates)
  using the voice profile — labeled drafts, human-sent. Confirm with Northmarq IT: (a) Azure OpenAI enabled +
  committed spend; (b) whether the "Northmarq Claude subscription" includes API access (if so, it can back the
  edge function directly).
- **Phase 3 — the on-prem ideal (optional, max privacy, ~$0 marginal).** Stand up **Ollama + a local model**
  (Llama 3.x 8B or Phi-4 class) on a Northmarq workstation/small server; wire it as the `ollama` provider (code
  already anticipates it); optionally **LoRA-fine-tune on Scott's sent-email corpus** for voice. Fully our-data,
  nothing leaves the building, no per-call cost. Cost = one machine + setup time.

**Net:** we can deliver the whole content-aware experience **now at ~$0 net-new** (Phase 1), keep it Microsoft-
and privacy-aligned without a new product SKU (Phase 2 = Azure OpenAI on the existing tenant), and reach the
**local, our-data-only, zero-marginal-cost** end-state (Phase 3) as a bounded, optional hardware+tuning project —
all through the **one swappable provider seam that already exists** in `ai.js`.

## 7. Open items to confirm (Northmarq IT)
1. Is **Azure OpenAI** enabled on Northmarq's Azure tenant, and is there committed/pre-paid spend it would draw on?
2. What exactly is the **"Northmarq Claude subscription"** — Claude for Work (chat only) or does it include
   **API / Claude Platform** access (which could back the pipeline directly)?
3. Is there a spare **GPU workstation / Mac (≥ 32–64 GB)** available for a Phase-3 local model, or would that be a
   new purchase?
4. Any policy on **CRE deal correspondence** transiting a cloud AI API (drives how soon we need Phase 2/3).
