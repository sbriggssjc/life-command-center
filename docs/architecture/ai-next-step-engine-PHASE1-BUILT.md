# AI next-step engine — Phase 1 BUILT (delta on ai-next-step-engine-scope.md)

Status: **shipped to DB; JS ready to merge.** Append this section to
`docs/architecture/ai-next-step-engine-scope.md` (the scope doc) so future chats
see Phase 1 as done rather than proposed.

## What Phase 1 delivers

A live inbound message on a deal now generates a **specific** to-do — the right type,
title, and due date derived from what the correspondent actually said — instead of the
generic "Review seller response & set next step." It runs on the **existing cloud AI
path** (`invokeExtractionAI`), costs effectively nothing (deterministic-first), and is
fully backward-compatible: when it can't read a clear intent it hands back to the old
generic behavior.

### Moving pieces

1. **DB — `lcc_advance_todos` (+3 params), APPLIED LIVE to LCC Opps.**
   New optional params `p_next_action text, p_next_type text, p_next_due_offset int`
   (after `p_owner_user_id`). Inbound branch builds the to-do as
   `title = coalesce(p_next_action,'Review seller response & set next step') || ' — ' || deal`,
   `action_type = coalesce(p_next_type,'review_response')`,
   `due_date = current_date + coalesce(p_next_due_offset,0)`,
   and stamps `metadata.ai_derived / ai_next_action / ai_next_type / ai_due_offset`.
   Existing named-param callers are unaffected (old function dropped, extended one
   created; 11-arg signature verified). The inbound existence-guard now keys on the
   coalesced `action_type`, so an AI-typed row (e.g. `send_info`) still de-dupes.

2. **JS — `api/_shared/next-step-ai.js` (`deriveNextStep`).**
   `deriveNextStep(subject, body, dealName, { invokeExtractionAI })` →
   `{intent, next_action, action_type, due_offset, confidence, source}` or **null**.
   - **Deterministic-first:** a keyword classifier resolves the common intents
     (needs-time / will-get-back, counter, doc-request, info-request, call-request,
     accepted, declined) for **zero AI spend**.
   - **AI escalation** only for the ambiguous tail — a closed-set single-intent prompt,
     strict-JSON parse, confidence gate (≥0.6), `unclear` → null.
   - **Never blocks:** feature-off, empty text, parse fail, low confidence, or provider
     error all return null → caller keeps the generic `review_response`. The function is
     wrapped so it can never throw into the correspondence path.
   - **Feature-gated:** OFF unless `NEXT_STEP_AI` truthy.
   - 20 unit tests (`test/next-step-ai.test.mjs`) — deterministic hits, AI escalation,
     confidence gate, throw-safety, feature gate — all green.

3. **Wiring — `logInboundCorrespondenceDualAnchor`** derives the step then passes the
   three new params to the RPC (null-safe). See INTEGRATION.md §2.

### intent → action_type map (canonical)

| intent | action_type | default due |
|---|---|---|
| needs_time / will_get_back | seller_follow_up | +1 |
| requests_info | send_info | +0 |
| requests_docs | send_info | +0 |
| wants_call | schedule_call | +0 |
| counter_offer | review_counter | +0 |
| accepted / verbal_yes | advance_to_contract | +0 |
| declined | log_pass | +0 |
| unclear | *(null → generic review_response)* | — |

## Provider seam (Phase 1.5 — enables the local model with no code change)

`api/_shared/ai.js` gains `invokeOllamaExtraction` + a `case 'ollama'` branch in
`invokeExtractionAI` (snippet: `ai.ollama-seam.snippet.js`). Gated on `OLLAMA_URL`;
inert when unset. A failure `break`s into the existing `AI_EXTRACTION_FALLBACK_CHAIN`,
so **local-primary + cloud-fallback** is the runtime behavior. Cutover to GaryBuilt is
config-only (`AI_EXTRACTION_PROVIDER=ollama` + `OLLAMA_URL` + `OLLAMA_MODEL`).
Stand-up playbook: `docs/setup/garybuilt-local-model.md`.

## Registry

`feature_flags_registry` rows `NEXT_STEP_AI` and `OLLAMA_EXTRACTION` seeded (both `off`)
so the daily-briefing Dormant-Capabilities section is honest until each is enabled.

## Open items (unchanged from scope; not blockers)

- `owner_user_id` still unpopulated from SF OwnerId — the to-do defaults owner to the
  system actor; capture is a separate follow-up.
- Broaden intents beyond the seller/counterparty premise (buyer/broker) as the pattern
  proves out.
- LoRA fine-tune on the sent-mail corpus is deferred behind RAG/few-shot for drafting
  (Phase 3), per the hosting scope.
