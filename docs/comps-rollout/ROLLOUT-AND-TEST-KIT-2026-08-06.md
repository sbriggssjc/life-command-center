# LCC Connected-Tools Rollout & Test Kit
**Prepared 2026-08-06 · baseline from the personal-Claude connector (standalone MCP)**

The goal: every surface (Copilot, ChatGPT, Northmarq, Personal-Claude skills) reaches the SAME engine build,
authenticates, and returns the SAME known-good results. This kit gives you the order of operations, the per-surface
steps, and a copy-paste smoke test with expected outputs so each surface takes ~2 minutes to verify.

---

## 0. Foundation (do these first — they gate everything)

1. **Deploy parity — redeploy BOTH services from current `main`.** Engine changes (prompts 36–57) were verified
   against the *standalone MCP service* (the personal-Claude/Cowork connector). ChatGPT (`/api/*`) and Copilot +
   Northmarq (`/mcp`) reach the engine through the SEPARATE `tranquil-delight` service. If only one was redeployed,
   those surfaces will still return old/broken comps. **Redeploy `tranquil-delight` AND the standalone MCP; confirm
   both are on the same `main` commit.**
2. **Rotate `LCC_API_KEY` once, now.** It was exposed in chat. Set the new value on `tranquil-delight`, the
   standalone MCP, and the `pacific-love` BOV service, then hand the SAME new value to each surface as you wire it
   (Step per surface below). Rotating first means you distribute the new key once instead of re-keying every surface
   later. (Keep `BOV_API_KEY` distinct.)
3. **Land prompt 58** (queued) — `get_property_context` and `search_entities` are currently broken on the connector
   (see baseline). Don't roll those two out until 58 is merged + redeployed; the rest can proceed.

---

## 1. Smoke-test baseline (known-good, 2026-08-06)

Run these on any surface after wiring it. Pass = matches the "Expected" column.

| Tool | Test input | Expected (known-good) |
|---|---|---|
| `generate_comps` | "Appraisal comps for The Villages DaVita, 1050 Old Camp Rd, The Villages, FL" | 17 sold + 12 on-market; subject 6,453 SF / 12 chairs / 6.75%; caps ≤7.10%, sold avg ~6.12% (below subject); OPTIONS all `(N) M-yr`/`(N)`/`None`; STATUS "Available"; no <3yr or no-price rows; `excluded_for_review.total = 10` |
| `synthesize_comps` | same request | subject `_hydrated:true`, property_id 31964, `excluded_subject:1`, national ranked set |
| `get_daily_briefing` | "daily briefing" | market key numbers (10Y, S&P, DVA…), sector news, priority tasks, reading list |
| `get_pipeline_health` | "health check" | gov + dialysis pipelines with statuses; lcc_health_alerts |
| `get_queue_summary` | "queue summary" | ~1,148 items, priority bands, research gaps |
| `get_property_context` | "1050 Old Camp Rd, The Villages, FL" | **⚠ BROKEN → fix via prompt 58.** Should resolve property_id 31964; today returns `not_on_file` |
| `search_entities` | "DaVita" | **⚠ BROKEN → fix via prompt 58.** Should return matches; today throws `.replace` crash |

**Baseline verdict:** comps, briefing, pipeline health, queue summary = solid. property-context + entity-search =
broken (prompt 58). Fix before those two ride out to any surface.

---

## 2. Per-surface rollout

Each surface = (a) sync instructions to canon **v1.4.1**, (b) connect/authenticate, (c) run the smoke test.

### A. Personal Claude / Cowork (this connector) — standalone MCP
- **Instructions:** the account **skills** (`comps-engine`, `briggs-comps`, `bov-underwriting`, …) — manual. These
  don't auto-render; the v1.4.1 comps rules (cap band, reliability, lease-term/price discipline, OPTIONS/BUMPS
  normalization, subject hydration) should be reflected in the `comps-engine` skill text.
- **Connect:** already live (verified).
- **Test:** the comps + briefing rows above already pass here. Re-test property-context after prompt 58.

### B. Copilot Studio — LCC Deal Agent — `tranquil-delight /mcp`
- **Instructions:** `docs/copilot/agent-instructions.md` — **auto-rendered** (the managed `CANON:BEGIN…END` region
  is current at v1.4.1, 0 drift). Paste the file's content (below the `---`) into the Copilot agent instructions.
- **Connect:** add the MCP connection at `{tranquil-delight}/mcp` with `Bearer LCC_API_KEY` (the NEW rotated key).
  OAuth discovery has been mounted since prompt 33, so registration should succeed. Publish.
- **Test:** run the comps + briefing smoke tests; confirm the comps output matches the baseline row (17/12, clean
  OPTIONS). This is the real check that `tranquil-delight` is on the current build.

### C. ChatGPT custom GPT — `tranquil-delight /api/*`
- **Instructions:** upload `docs/os/surfaces/chatgpt.canon.md` as the **"LCC-CANON" Knowledge file** (v1.4.1). The
  persona (`docs/setup/gpt-actions-system-prompt.txt`, 3,600 chars, under the 8k cap) stays a short pointer to the
  knowledge file.
- **Connect:** confirm the Action's OpenAPI (`lcc-openapi.yaml`) still matches the tool shapes; re-import if any
  tool I/O changed. Set the Action auth to the NEW `LCC_API_KEY`.
- **Test:** "Appraisal comps for The Villages DaVita, 1050 Old Camp Rd" → expect the baseline comps result, NOT
  "Unknown API route" (that error = `tranquil-delight` not carrying the `/api` comps route → redeploy).

### D. Northmarq Claude Project — `tranquil-delight /mcp`
- **Instructions:** `_WORKFLOW/NORTHMARQ_PROJECT_PROMPT.md` — **manual sync** (rich hand-authored doc; last touched
  2026-08-04, so it predates the 41–57 comps canon). Sync the canon-governed sections (comps §3C, resolution) to
  v1.4.1 by hand. I can produce a paste-ready diff for those sections on request.
- **Connect:** a Project **admin** must add the connector at `{tranquil-delight}/mcp` (managed Claude) with the new
  key. Until then, the by-design fallback is compose-and-hand-off (it emits a `/comps` payload).
- **Test:** same comps smoke test; confirm it pulls natively (not the fallback) once the connector is added.

---

## 3. What I can produce on request (say the word per surface)
- The exact paste/upload file for B and C (deliver `agent-instructions.md` / `chatgpt.canon.md` to your computer).
- A paste-ready v1.4.1 diff for the Northmarq prompt's comps + resolution sections (D).
- A one-page "what changed since you last synced" note per surface, so the paste is reviewable.

## 4. Open, non-blocking
- Prompt 58 (broken tools) — queued.
- Review-lane backlog (prompt-50 57 rows, 269 E Caroline 2, prompt-57 exclusions 10) — data cleanup.
- Ops-health alerts seen in the smoke test: owner-reconcile queue depth 2,014 > 1,500 threshold; a couple of Power
  Automate flows AMBER (HTTP-Switch, RCM). Separate from comps rollout — flag if you want them triaged.
- "Always-include-our-deals" comps option; Census key (prompt 19 parked).
