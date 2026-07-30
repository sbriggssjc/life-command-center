-- Feature-flags registry rows for Phase 1 (idempotent; safe to re-run).
-- Keeps the daily-briefing "Dormant Capabilities" section honest about what's off.
insert into public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
values
  ('NEXT_STEP_AI',
   'Content-aware next-step engine: derives the specific to-do (type/title/due) from an inbound message instead of a generic review_response.',
   'intake-correspondence -> lcc_advance_todos',
   'NEXT_STEP_AI',
   'off', null, 'scott',
   'Deterministic-first keyword pass + AI escalation via invokeExtractionAI. Flip on after JS merge + redeploy. Set state=on / off_since=null when enabled in Railway.'),
  ('OLLAMA_EXTRACTION',
   'Route AI extraction to a local Ollama model (GaryBuilt, RTX 3060) for background tasks; cloud edge/OpenAI stays the fallback.',
   'api/_shared/ai.js invokeExtractionAI',
   'OLLAMA_URL',
   'off', null, 'scott',
   'Seam is inert unless OLLAMA_URL is set. Config-only cutover: AI_EXTRACTION_PROVIDER=ollama + OLLAMA_URL + OLLAMA_MODEL. See docs/setup/garybuilt-local-model.md.')
on conflict (flag) do update
  set purpose = excluded.purpose,
      surface = excluded.surface,
      env_var = excluded.env_var,
      notes   = excluded.notes;
