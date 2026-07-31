-- ============================================================================
-- W4.4 (2026-07-31): register the ORE resolver name-gate feature flag.
--
-- owner-reconcile-engine.js now gates every would-be auto-merge on the Railway
-- resolver /match (owner_owner) — confirm keeps the merge, veto or a fail-closed
-- fallback (service down/timeout/unset URL) downgrades it to needs_review. Gated
-- by ORE_USE_RESOLVER so it reverts without a redeploy; needs RESOLVER_URL set on
-- the LCC Railway app.
--
-- Additive / idempotent / reversible. Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- REVERSAL: DELETE FROM feature_flags_registry WHERE flag='ORE_USE_RESOLVER';
-- ============================================================================

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'ORE_USE_RESOLVER',
  'ORE reconcile engine gates auto-merges on the Railway resolver /match name signal (fail-closed to needs_review).',
  'api:owner-reconcile-engine-tick',
  'ORE_USE_RESOLVER',
  'off', NULL, 'scott',
  'Off = the SQL lcc_reconcile_name_match heuristic governs (unchanged). On (ORE_USE_RESOLVER=1) = the resolver confirms every merge; also needs RESOLVER_URL on the LCC Railway app. Fail-closed: resolver down → needs_review, never a merge.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();
