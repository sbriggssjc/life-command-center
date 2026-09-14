# Prompt 73 — W8 U4 tick hardening: no inline narrate, crash-proof envelope

**Grounding:** Scott's first live `GET /api/systemic-findings-tick?narrate=1` (2026-08-07) →
Railway 502 "Application failed to respond" (no response — crash/hang class, not a JSON error).
Cowork timed all 10 `v_lcc_w8_u4_*` views live: instant, tiny row counts — the aggregation SQL is
NOT the bottleneck. Suspects: the inline ollama narrate call (long prompt + validator
regenerate-retry ≈ 2 long GaryBuilt calls) or an unhandled exception in the handler path
(a crash that never writes a response yields exactly this 502).

## Do (small)

1. **Find the actual failure:** reproduce locally with a stubbed seam; walk the handler for any
   await outside try/catch, unbounded loop, or response-less path. Every error must return a JSON
   500 envelope (`{ok:false, error, section}`) — never a hung request.
2. **Remove inline narration from the GET path entirely.** `?narrate=1` is retired (or returns
   `{narrate: "deferred"}`): the dry-run GET returns computed JSON + the deterministic doc render
   only — fast, proxy-safe. Narrative generation moves exclusively to the POST/cron path with its
   own wall-clock budget (single ollama call + ONE validator retry, both timeout-bounded; on
   failure ship tables with the stock header per the existing design). The monthly cron POSTs, so
   narration cost lands where no interactive proxy is waiting.
3. **Per-section resilience:** compute each section in try/catch; a failing section contributes
   `{section, error}` to a `section_errors` array (loud, U2-style) instead of killing the tick.
   Honest partial > silent death.
4. **Tests:** crash-envelope test (a throwing section → 200 with section_errors, or JSON 500 —
   never response-less), no-inline-narrate guard, narrate-budget test on the apply path.

## Acceptance

- `GET /api/systemic-findings-tick` returns the full computed JSON fast (no narrate work).
- A deliberately-broken section shows up in `section_errors`, response still delivered.
- POST (flag on, later) produces the doc with figure-validated narrative or stock header.
- After merge+redeploy: Scott re-runs the bare GET → Cowork reviews → flip `W8_U4_FINDINGS_REPORT`.

Commit with the repo Co-Authored-By + Claude-Session trailer.
