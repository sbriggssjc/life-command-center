# AI Chat Rollout Checklist

## Current Target

- Policy: `balanced`
- Effective routing:
  - `global_copilot` -> `edge / gpt-5-mini`
  - `ops_research_assistant` -> `ollama / llama3.1`
  - `detail_ownership_assistant` -> `openai / gpt-5-mini`
  - `detail_intel_assistant` -> `ollama / llama3.1`
  - `detail_intake_assistant` -> `ollama / llama3.2-vision`

## Pre-Check

1. Run `npm run ai:routing`.
2. Confirm the output matches the target routing above.
3. Confirm required providers are available:
   - OpenAI key present for ownership assistant
   - Ollama running locally for intake/intel/ops research

## Flow Checks

1. Global copilot
   - Open the global copilot panel.
   - Ask one short operational question.
   - Confirm a response is returned.

2. Ops research assistant
   - Open the ops research queue.
   - Run `Assist` on one research task.
   - Confirm the draft appears.

3. Ownership assistant
   - Open a property detail page.
   - Go to Ownership.
   - Run the assistant.
   - Confirm the ownership summary appears.
   - Use `Apply Extracted Facts to Fields`.
   - Confirm ownership fields populate for review.

4. Intel assistant
   - Stay on the same property.
   - Go to Intel.
   - Run the research assistant.
   - Confirm the summary appears.

5. Intake assistant with text
   - In Intel -> Research Intake, paste text.
   - Run `Analyze Intake`.
   - Confirm the summary appears.
   - Use `Apply Extracted Facts to Fields`.
   - Confirm Intel fields populate for review.

6. Intake assistant with image
   - In Intel -> Research Intake, upload or paste a screenshot.
   - Run `Analyze Intake`.
   - Confirm the screenshot preview and response both appear.

## Dashboard Checks

1. Open the Performance Dashboard.
2. Go to the AI section.
3. Confirm:
   - `Rollout Readiness` shows routing is active.
   - `Routing Policy` shows `balanced`.
   - Feature/provider/model rows match the target routing.
   - `Routing Mismatches Detected` is empty or understandable.
   - `Telemetry Quality` is reasonable.
   - `Suggested Next Step` is consistent with what you see.

## Pass Criteria

- All five flows return usable responses.
- Expected providers/models appear in telemetry.
- No unexpected routing mismatches.
- Ownership quality remains acceptable on `openai`.
- Intake/intel/ops research quality remains acceptable on `ollama`.

## Immediate Rollback

If quality or stability is unacceptable:

1. Apply the manual preset:
   - `node scripts/apply-ai-chat-preset.mjs AI_CHAT_MANUAL_EDGE_PRESET.env.example --target .env.local --write`
2. Re-run:
   - `npm run ai:routing`
3. Confirm the output returns to edge-first routing.
