-- Prompt 136 (2026-08-26): the reachability-harvest TARGET marker — make the
-- target window ADVANCE.
--
-- THE STALL (grounded live 2026-08-26, bounded diagnostic POST limit=5):
--   reachability_harvest_review = 16 rows EVER, 0 in the last 11 days (last write
--   2026-08-15), while the unreachable pool is ~15k (dia 4,258 + gov 10,670) and
--   cron `reachability-harvest-tick` (jobid 212, 40 4 * * *) is ACTIVE — it fires
--   nightly and produces nothing.
--     pool_counts.targets       = { dia:60, gov:60, total:120 }   <- FIXED window
--     pool_counts.deterministic = { candidates:240, donors_found:0, no_donor:240 }
--     pool_counts.llm           = { candidates:240, with_evidence:0, fresh:0 }
--     evidence_sources          = { intake:5000, comms_names:4305 }
--     comms_scan                = { harvestable:7926, signature_phones:2042 }
--   Evidence EXISTS in volume; the run targets a FIXED top-120 slice of the pool
--   and, for those exact 120, finds none. Those 120 were never recorded as
--   "checked, no evidence", so the same 120 were re-selected every night. This is
--   a STALL, not source exhaustion — the same class as the P135 property-twin
--   fixed window and the Dead-End "producer that re-checks its own residue".
--
-- WHAT THIS MIGRATION ADDS (additive, idempotent, LCC Opps xengecqvemvfknjvbvrq):
--   * reachability_harvest_target_marker — one row per (domain, target_contact_id)
--     the tick has CHECKED and found to yield no fresh work. The tick excludes
--     ACTIVE markers from target selection, so run N+1 sees a different window.
--     The marker EXPIRES (recheck_after, default +30d) so a target becomes
--     eligible again once new intake/correspondence evidence has had a chance to
--     land — the auto-retire doctrine applied to the EXCLUSION itself (P182: an
--     exclusion keyed on a state needs something that clears that state).
--   * v_lcc_reachability_harvest_target_marker_summary — honest counts by reason /
--     active-vs-expired, so "the window is advancing" is queryable.
--
-- `reason` carries TWO different facts and never one label:
--   no_evidence    — the target's name is in NO evidence index and it carries no
--                    SF identity: nothing could have been proposed.
--   no_fresh_work  — evidence existed but produced nothing NEW (already proposed,
--                    or the evidence carried no usable value for the blank field).
--
-- The marker store is deliberately a TABLE, not another jsonb blob: the previous
-- resumable cursor lives in reachability_harvest_batch.details.scored_markers,
-- capped at 8,000 entries — which cannot hold a 15k pool and silently truncates.
--
-- REVERSAL RUNBOOK
--   -- Re-open every marked target (the next tick re-checks them all):
--   --   DELETE FROM public.reachability_harvest_target_marker;
--   -- Re-open one domain / one target:
--   --   DELETE FROM public.reachability_harvest_target_marker
--   --    WHERE domain = 'gov' AND target_contact_id = '<uuid>';
--   -- Force an immediate global re-check without losing the audit trail:
--   --   UPDATE public.reachability_harvest_target_marker SET recheck_after = now();
--   -- Drop the unit entirely:
--   --   DROP VIEW IF EXISTS public.v_lcc_reachability_harvest_target_marker_summary;
--   --   DROP TABLE IF EXISTS public.reachability_harvest_target_marker;
--   -- (The tick fails OPEN on a marker read error — an unreadable marker table
--   --  means "nothing is excluded", never "nothing is eligible".)

BEGIN;

CREATE TABLE IF NOT EXISTS public.reachability_harvest_target_marker (
  marker_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain            text NOT NULL CHECK (domain IN ('dia', 'gov')),
  target_contact_id text NOT NULL,
  reason            text NOT NULL DEFAULT 'no_evidence'
                      CHECK (reason IN ('no_evidence', 'no_fresh_work')),
  evidence_signal   jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_run_id     text,
  checked_at        timestamptz NOT NULL DEFAULT now(),
  recheck_after     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT uq_reachability_harvest_target_marker
    UNIQUE (domain, target_contact_id)
);

-- The tick's read is "markers still ACTIVE" — recheck_after leads the index.
CREATE INDEX IF NOT EXISTS idx_reachability_harvest_target_marker_active
  ON public.reachability_harvest_target_marker (recheck_after DESC, domain);

CREATE INDEX IF NOT EXISTS idx_reachability_harvest_target_marker_run
  ON public.reachability_harvest_target_marker (source_run_id, checked_at DESC);

COMMENT ON TABLE public.reachability_harvest_target_marker IS
  'Prompt 136: targets the reachability-harvest tick has CHECKED and found to yield no fresh work. Excluded from target selection while recheck_after is in the future, so the target window ADVANCES instead of re-checking the same 120 rows nightly. reason distinguishes no_evidence (nothing could be proposed) from no_fresh_work (evidence existed, produced nothing new).';
COMMENT ON COLUMN public.reachability_harvest_target_marker.recheck_after IS
  'The marker expires here so a target re-enters the window once new intake/comms evidence has had time to land. An exclusion with no expiry is a permanent removal (P182).';

GRANT SELECT, INSERT, UPDATE ON public.reachability_harvest_target_marker
  TO anon, authenticated, service_role;

-- Honest counts: is the window actually advancing, and how much of the marked
-- population is due for a re-check?
CREATE OR REPLACE VIEW public.v_lcc_reachability_harvest_target_marker_summary AS
SELECT
  domain,
  reason,
  count(*)                                                  AS markers,
  count(*) FILTER (WHERE recheck_after > now())             AS active,
  count(*) FILTER (WHERE recheck_after <= now())            AS due_for_recheck,
  min(checked_at)                                           AS first_checked_at,
  max(checked_at)                                           AS last_checked_at
FROM public.reachability_harvest_target_marker
GROUP BY domain, reason;

GRANT SELECT ON public.v_lcc_reachability_harvest_target_marker_summary
  TO anon, authenticated, service_role;

COMMIT;
