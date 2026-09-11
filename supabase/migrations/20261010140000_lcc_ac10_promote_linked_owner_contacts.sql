-- AC10 — an exclusion needs a counterpart that promotes.
--
-- `v_owner_contact_worklist` (Phase 5, 20260721130000) correctly excludes any
-- valued owner (`v_entity_portfolio_all.current_annual_rent_total > 0`) that
-- already carries a LINKED PERSON via `entity_relationships`
-- (`relationship_type IN ('associated_with','contact_at','works_at')`) —
-- correct, that owner needs no *acquisition*. Nothing ever wrote that person
-- into `owner_contact_pivot.active_contact_entity_id`, so the owner is
-- suppressed from the acquisition worklist AND invisible to every consumer
-- that reads the pivot (the contact-selection engine, the call sheet, the
-- owner panel hero, Tier 0). Documented 2026-08-26 in
-- `docs/architecture/account-based-contact-intelligence.md` §5a as 11 owners /
-- $240.5M.
--
-- ⚠️ RE-MEASURED 2026-09-10 (xengecqvemvfknjvbvrq) BEFORE BUILDING, PER THE
-- PROMPT'S OWN INSTRUCTION — `owner_contact_pivot.active_contact_entity_id`
-- population has grown ~50x since (1,440 populated rows live today vs ~27 in
-- late August, the P188/P194 Tier 0 lanes having run for two weeks). The
-- August count does not hold:
--
--   owners with a linked person, no pivot row at all:                    14
--   owners with a pivot row but active_contact_entity_id IS NULL:       237
--   -------------------------------------------------------------------------
--   TOTAL suppressed-and-invisible today:                    251 owners
--                                                            $329,379,804.64
--
-- (query reproduced below in the VERIFY block). `lcc_ensure_worklist_owner_pivots`
-- (Phase 2, 20260713120000) does NOT touch this population — it seeds a
-- fallback pivot for `v_owner_contact_worklist` ROWS, and this population is,
-- by construction, EXCLUDED from that view. Confirmed live: 0 overlap.
--
-- THE PROMOTION RULE. For each owner with ≥1 linked person and no active
-- pivot contact, rank the candidate persons the same way
-- `api/_shared/owner-reachable-via.js::pickReachableVia` already ranks a
-- panel's "reach via" candidate (ONE ranking rule reused, not re-invented):
--   1. role authority (ROLE_RANK ladder, mirrored below as a CASE — the two
--      lists MUST be kept in step, exactly per the comment in
--      `v_lcc_owner_reachability`'s `via_person_selectable` CTE);
--   2. most recently created edge wins ties;
--   3. person_id ascending — a STABLE tiebreak, never "whatever the query
--      returned first" (the gov `ensureTrueOwner` substring-defect class).
-- Brokers/agents/tenants/operators are excluded OUTRIGHT
-- (`NON_REACHABLE_ROLES`, never merely ranked last) and a junk/misparse name
-- is never promoted (`lcc_is_rejected_contact_name`).
--
-- FILL-BLANKS ONLY: a pivot row that already carries
-- `active_contact_entity_id` is never touched (it is outside the candidate
-- population by construction — re-asserted in the function as a guard, not
-- only relied on via the population query). `active_authority_level = 5`
-- ("captured") and `confidence = 'medium'` — the SAME values Tier 0's
-- `applyTier0Attach` writes for an automated attach (P194): a linked edge
-- proves ASSOCIATION, not the person's authority inside the firm, so this
-- promotion claims no more than that.
--
-- PROVENANCE + REVERSIBILITY: every write is ledgered in
-- `lcc_ac10_promote_log` BEFORE the pivot write, carrying the prior pivot
-- state (mirrors `applyTier0Attach`'s ledger-before-write ordering — the
-- ledger is what makes a batch reversible, not audit-only).
-- `lcc_ac10_unpromote(p_batch_tag)` reverses one batch: a row logged
-- `created_pivot` is DELETEd (only if its `active_contact_entity_id` still
-- matches what THIS batch wrote — never clobber a later legitimate write);
-- a row logged `filled_active_contact` is restored to its prior
-- active_contact_* state.
--
-- FORWARD-RUNNING, NOT A ONE-SHOT (P176 doctrine: a one-shot repair of a
-- recurring gap is a chore repeated silently forever). New linked-person
-- edges land constantly (Tier 0 attaches, manual attaches, CoStar sidebar
-- contact links), so this needs a daily cron, not a backfill. Cron slot
-- `12 6 * * *` (06:12 UTC) is FREE in the crowded 06:xx block (checked
-- against the live `cron.job` table 2026-09-10 — no existing daily job holds
-- minute 12 at hour 6); placed after the 05:20 `lcc-owner-contact-pivot-refresh`
-- and well before the 06:55 Tier-0 auto-attach sweep so newly-attached Tier 0
-- contacts from the PRIOR day are already visible to it (Tier 0 itself writes
-- `owner_contact_pivot` directly, so this cron is complementary, not
-- redundant with it — Tier 0 covers a different match rule, email-domain
-- identity, while this covers ANY already-linked person regardless of how
-- the edge was created).
--
-- Discipline: dry-run-default · fill-blanks-only · conservative/unambiguous
-- (one ranked winner per owner, never a guess) · provenance-tagged
-- (`active_source='ac10_promote'`) · reversible · idempotent (re-run finds 0
-- once the population clears) · never fabricates a person.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_ac10_promote_log (
  log_id                          bigserial PRIMARY KEY,
  batch_tag                       text NOT NULL,
  owner_entity_id                 uuid NOT NULL REFERENCES public.entities(id),
  owner_name                      text,
  person_entity_id                uuid NOT NULL REFERENCES public.entities(id),
  person_name                     text,
  role                            text,
  relationship_id                 uuid,
  action                          text NOT NULL CHECK (action IN ('created_pivot', 'filled_active_contact')),
  prior_active_contact_entity_id  uuid,
  prior_active_contact_name       text,
  prior_active_contact_role       text,
  prior_active_authority_level    integer,
  prior_active_source             text,
  prior_confidence                text,
  applied_at                      timestamptz NOT NULL DEFAULT now(),
  reverted_at                     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lcc_ac10_promote_log_batch ON public.lcc_ac10_promote_log(batch_tag);
CREATE INDEX IF NOT EXISTS idx_lcc_ac10_promote_log_owner ON public.lcc_ac10_promote_log(owner_entity_id);
REVOKE ALL ON TABLE public.lcc_ac10_promote_log FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.lcc_ac10_promote_log IS
  'AC10 (2026-09-10): ledger for lcc_promote_linked_owner_contacts. One row '
  'per owner promoted. Written BEFORE the pivot write so a failed write still '
  'leaves an accurate "prior state" record. Reverse a batch with '
  'lcc_ac10_unpromote(batch_tag).';

-- ---------------------------------------------------------------------------
-- The candidate view: mirrors v_owner_contact_worklist''s value gate and its
-- OWN linked_person definition (relationship_type IN ('associated_with',
-- 'contact_at','works_at') to a live person entity), then ranks candidates
-- per owner and keeps only rows lacking an active pivot contact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_ac10_promote_candidates AS
WITH valued AS (
  SELECT pa.entity_id, e.name AS owner_name, e.workspace_id,
         pa.current_annual_rent_total AS rollup
  FROM public.v_entity_portfolio_all pa
  JOIN public.entities e ON e.id = pa.entity_id
  WHERE pa.current_annual_rent_total > 0
    AND e.merged_into_entity_id IS NULL
    AND NOT public.lcc_is_operator_owner_name(e.name)
    AND COALESCE((e.metadata->>'junk_name_flagged')::boolean, false) = false
),
edges AS (
  SELECT
    v.entity_id                 AS owner_entity_id,
    v.owner_name,
    v.workspace_id,
    v.rollup,
    er.id                       AS relationship_id,
    er.created_at               AS relationship_created_at,
    pe.id                       AS person_entity_id,
    pe.name                     AS person_name,
    lower(btrim(COALESCE(er.metadata->>'role', ''))) AS role
  FROM valued v
  JOIN public.entity_relationships er
    ON (er.from_entity_id = v.entity_id OR er.to_entity_id = v.entity_id)
   AND er.relationship_type IN ('associated_with', 'contact_at', 'works_at')
  JOIN public.entities pe
    ON pe.id = CASE WHEN er.from_entity_id = v.entity_id THEN er.to_entity_id ELSE er.from_entity_id END
   AND pe.entity_type = 'person'
   AND pe.merged_into_entity_id IS NULL
  -- Mirrors NON_REACHABLE_ROLES in api/_shared/owner-reachable-via.js — a
  -- broker/agent/tenant/operator edge is NEVER the owner's own contact. Keep
  -- the two lists in step (the same comment already made on
  -- v_lcc_owner_reachability's via_person_selectable CTE).
  WHERE lower(btrim(COALESCE(er.metadata->>'role', ''))) NOT IN
        ('broker', 'broker_of_record', 'listing_broker', 'purchasing_broker',
         'l_broker', 'p_broker', 'agent', 'tenant', 'operator')
    AND NOT public.lcc_is_rejected_contact_name(pe.name)
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.owner_entity_id
      ORDER BY
        -- 1. role authority (lower rank = stronger claim). Mirrors
        --    owner-reachable-via.js ROLE_RANK; unlisted roles fall to the
        --    UNKNOWN_ROLE_RANK bucket (90), still selectable.
        CASE e.role
          WHEN 'decision_maker'      THEN 10
          WHEN 'principal'           THEN 15
          WHEN 'managing_member'     THEN 20
          WHEN 'manager'             THEN 25
          WHEN 'member'              THEN 30
          WHEN 'owner'               THEN 35
          WHEN 'trustee'             THEN 40
          WHEN 'officer'             THEN 45
          WHEN 'signatory'           THEN 50
          WHEN 'deed_signatory'      THEN 55
          WHEN 'prospecting_contact' THEN 60
          WHEN 'seller_contact'      THEN 65
          WHEN 'true_seller_contact' THEN 65
          WHEN 'true_buyer_contact'  THEN 70
          WHEN 'contact'             THEN 75
          WHEN 'works_at'            THEN 80
          WHEN 'associated_with'     THEN 85
          ELSE 90
        END ASC,
        -- 2. most recently created edge wins ties.
        e.relationship_created_at DESC NULLS LAST,
        -- 3. stable tiebreak — never "whatever the query returned first".
        e.person_entity_id ASC
    ) AS rn
  FROM edges e
)
SELECT
  r.owner_entity_id, r.owner_name, r.workspace_id, r.rollup,
  r.person_entity_id, r.person_name, r.role, r.relationship_id
FROM ranked r
LEFT JOIN public.owner_contact_pivot pv ON pv.entity_id = r.owner_entity_id
WHERE r.rn = 1
  AND (pv.entity_id IS NULL OR pv.active_contact_entity_id IS NULL);

COMMENT ON VIEW public.v_lcc_ac10_promote_candidates IS
  'AC10: one row per owner missing an active pivot contact despite an '
  'already-linked, non-brokerage, non-junk person entity — the winning '
  'candidate per owner, ranked exactly like owner-reachable-via.js '
  'pickReachableVia (role authority > most recent > stable id tiebreak).';

-- ---------------------------------------------------------------------------
-- The writer. Dry-run default; POST=false to write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_promote_linked_owner_contacts(
  p_dry_run   boolean DEFAULT true,
  p_limit     int     DEFAULT 500,
  p_batch_tag text    DEFAULT NULL
)
RETURNS TABLE(
  owner_entity_id   uuid,
  owner_name        text,
  person_entity_id  uuid,
  person_name       text,
  role              text,
  action            text
) AS $fn$
DECLARE
  v_batch text := COALESCE(p_batch_tag, 'ac10_' || to_char(now(), 'YYYYMMDD_HH24MISS'));
  v_row   record;
  v_pivot record;
  v_role  text;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_lcc_ac10_promote_candidates
    ORDER BY rollup DESC NULLS LAST
    LIMIT GREATEST(p_limit, 0)
  LOOP
    v_role := COALESCE(NULLIF(v_row.role, ''), 'prospecting_contact');

    -- Re-read the pivot row HERE (not trusted from the candidate view), the
    -- same fill-blanks re-check applyTier0Attach performs at write time — a
    -- concurrent write between the candidate scan and this loop iteration
    -- must never be clobbered.
    SELECT * INTO v_pivot FROM public.owner_contact_pivot WHERE entity_id = v_row.owner_entity_id;

    IF v_pivot.entity_id IS NOT NULL AND v_pivot.active_contact_entity_id IS NOT NULL THEN
      -- Already filled since the scan (e.g. by Tier 0 or a human) — skip.
      CONTINUE;
    END IF;

    owner_entity_id  := v_row.owner_entity_id;
    owner_name       := v_row.owner_name;
    person_entity_id := v_row.person_entity_id;
    person_name      := v_row.person_name;
    role             := v_role;
    action           := CASE WHEN v_pivot.entity_id IS NULL THEN 'created_pivot' ELSE 'filled_active_contact' END;

    IF NOT p_dry_run THEN
      INSERT INTO public.lcc_ac10_promote_log(
        batch_tag, owner_entity_id, owner_name, person_entity_id, person_name,
        role, relationship_id, action,
        prior_active_contact_entity_id, prior_active_contact_name,
        prior_active_contact_role, prior_active_authority_level,
        prior_active_source, prior_confidence
      ) VALUES (
        v_batch, v_row.owner_entity_id, v_row.owner_name, v_row.person_entity_id, v_row.person_name,
        v_role, v_row.relationship_id, action,
        v_pivot.active_contact_entity_id, v_pivot.active_contact_name,
        v_pivot.active_contact_role, v_pivot.active_authority_level,
        v_pivot.active_source, v_pivot.confidence
      );

      IF v_pivot.entity_id IS NULL THEN
        INSERT INTO public.owner_contact_pivot(
          entity_id, owner_name, workspace_id,
          active_contact_entity_id, active_contact_name, active_contact_role,
          active_authority_level, active_source, confidence, updated_at
        ) VALUES (
          v_row.owner_entity_id, v_row.owner_name, v_row.workspace_id,
          v_row.person_entity_id, v_row.person_name, v_role,
          5, 'ac10_promote', 'medium', now()
        )
        ON CONFLICT (entity_id) DO NOTHING;
      ELSE
        -- Fill-blanks only: the WHERE clause re-asserts active_contact_entity_id
        -- IS NULL so a race between the SELECT above and this UPDATE can never
        -- overwrite a write that landed in between.
        UPDATE public.owner_contact_pivot
           SET active_contact_entity_id = v_row.person_entity_id,
               active_contact_name      = v_row.person_name,
               active_contact_role      = v_role,
               active_authority_level   = 5,
               active_source            = 'ac10_promote',
               confidence               = 'medium',
               updated_at               = now()
         WHERE entity_id = v_row.owner_entity_id
           AND active_contact_entity_id IS NULL;
      END IF;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_promote_linked_owner_contacts(boolean, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_promote_linked_owner_contacts(boolean, int, text) FROM anon, authenticated;

DO $chk$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_promote_linked_owner_contacts(boolean, int, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AC10 privilege gate: anon can still EXECUTE lcc_promote_linked_owner_contacts';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_promote_linked_owner_contacts(boolean, int, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AC10 privilege gate: authenticated can still EXECUTE lcc_promote_linked_owner_contacts';
  END IF;
END $chk$;

COMMENT ON FUNCTION public.lcc_promote_linked_owner_contacts(boolean, int, text) IS
  'AC10 (2026-09-10): promotes the ranked winning linked-person candidate '
  '(v_lcc_ac10_promote_candidates) into owner_contact_pivot.active_contact_* '
  'for any valued owner missing one. Dry-run default; fill-blanks only; '
  'reversible via lcc_ac10_unpromote(batch_tag). Forward-running, scheduled '
  'daily at 06:12 UTC (cron lcc-ac10-promote-linked-contacts).';

-- ---------------------------------------------------------------------------
-- Reversal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_ac10_unpromote(p_batch_tag text)
RETURNS TABLE(reverted int, skipped_already_changed int) AS $fn$
DECLARE
  v_reverted int := 0;
  v_skipped  int := 0;
  v_log      record;
  v_pivot    record;
BEGIN
  FOR v_log IN
    SELECT * FROM public.lcc_ac10_promote_log
    WHERE batch_tag = p_batch_tag AND reverted_at IS NULL
    ORDER BY log_id
  LOOP
    SELECT * INTO v_pivot FROM public.owner_contact_pivot WHERE entity_id = v_log.owner_entity_id;

    -- Only revert if the pivot still reads exactly what THIS batch wrote —
    -- never clobber a later legitimate write (e.g. a human confirm since).
    IF v_pivot.entity_id IS NULL
       OR v_pivot.active_contact_entity_id IS DISTINCT FROM v_log.person_entity_id
       OR v_pivot.active_source IS DISTINCT FROM 'ac10_promote' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_log.action = 'created_pivot' THEN
      DELETE FROM public.owner_contact_pivot WHERE entity_id = v_log.owner_entity_id;
    ELSE
      UPDATE public.owner_contact_pivot
         SET active_contact_entity_id = v_log.prior_active_contact_entity_id,
             active_contact_name      = v_log.prior_active_contact_name,
             active_contact_role      = v_log.prior_active_contact_role,
             active_authority_level   = v_log.prior_active_authority_level,
             active_source            = v_log.prior_active_source,
             confidence               = v_log.prior_confidence,
             updated_at               = now()
       WHERE entity_id = v_log.owner_entity_id;
    END IF;

    UPDATE public.lcc_ac10_promote_log SET reverted_at = now() WHERE log_id = v_log.log_id;
    v_reverted := v_reverted + 1;
  END LOOP;

  reverted := v_reverted; skipped_already_changed := v_skipped; RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_ac10_unpromote(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_ac10_unpromote(text) FROM anon, authenticated;

DO $chk2$
BEGIN
  IF has_function_privilege('anon', 'public.lcc_ac10_unpromote(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AC10 privilege gate: anon can still EXECUTE lcc_ac10_unpromote';
  END IF;
  IF has_function_privilege('authenticated', 'public.lcc_ac10_unpromote(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AC10 privilege gate: authenticated can still EXECUTE lcc_ac10_unpromote';
  END IF;
END $chk2$;

COMMENT ON FUNCTION public.lcc_ac10_unpromote(text) IS
  'AC10 reversal: undo one batch written by lcc_promote_linked_owner_contacts. '
  'Skips (never overwrites) any owner whose pivot no longer reads what this '
  'batch wrote.';

-- ---------------------------------------------------------------------------
-- Forward-running cron. 06:12 UTC daily — confirmed free against the live
-- cron.job table 2026-09-10 (no existing daily job holds minute 12 at hour 6;
-- see the migration header for the surrounding schedule). Direct SQL call,
-- matching the house pattern for same-project sweeps
-- (jobid 226 lcc-p112-retire-unworkable, jobid 158 lcc-owner-contact-pivot-refresh)
-- rather than an HTTP round trip via lcc_cron_post.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('lcc-ac10-promote-linked-contacts')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-ac10-promote-linked-contacts');
    PERFORM cron.schedule(
      'lcc-ac10-promote-linked-contacts',
      '12 6 * * *',
      $job$SELECT public.lcc_promote_linked_owner_contacts(false, 500, NULL);$job$
    );
  END IF;
END $cron$;

-- ============================== VERIFY ==================================================
--   -- current suppressed population (re-measure, this changes daily):
--   WITH valued AS (
--     SELECT pa.entity_id, pa.current_annual_rent_total AS rollup
--     FROM v_entity_portfolio_all pa JOIN entities e ON e.id = pa.entity_id
--     WHERE pa.current_annual_rent_total > 0 AND e.merged_into_entity_id IS NULL
--       AND NOT lcc_is_operator_owner_name(e.name)
--       AND COALESCE((e.metadata->>'junk_name_flagged')::boolean,false)=false
--   ), linked_person AS (
--     SELECT DISTINCT o.entity_id FROM valued o
--     JOIN entity_relationships er ON (er.from_entity_id=o.entity_id OR er.to_entity_id=o.entity_id)
--      AND er.relationship_type IN ('associated_with','contact_at','works_at')
--     JOIN entities pe ON pe.id = CASE WHEN er.from_entity_id=o.entity_id THEN er.to_entity_id ELSE er.from_entity_id END
--      AND pe.entity_type='person' AND pe.merged_into_entity_id IS NULL
--   )
--   SELECT count(*), sum(v.rollup) FROM linked_person lp JOIN valued v ON v.entity_id=lp.entity_id
--   LEFT JOIN owner_contact_pivot pv ON pv.entity_id = lp.entity_id
--   WHERE pv.entity_id IS NULL OR pv.active_contact_entity_id IS NULL;
--   -- EXPECT (2026-09-10, before the real run): 251 owners, $329,379,804.64
--
--   select count(*) from v_lcc_ac10_promote_candidates;               -- matches the above
--   select * from lcc_promote_linked_owner_contacts(true, 500, null); -- dry run, 0 writes
--   select * from lcc_promote_linked_owner_contacts(false, 500, null);-- real run
--   select count(*) from v_lcc_ac10_promote_candidates;               -- EXPECT 0 (or near 0)
--
-- ============================== REVERSAL RUNBOOK ========================================
--   select * from lcc_ac10_unpromote('<batch_tag from the real-run output or lcc_ac10_promote_log>');
--   -- Full teardown: DROP FUNCTION public.lcc_ac10_unpromote(text);
--   --                DROP FUNCTION public.lcc_promote_linked_owner_contacts(boolean,int,text);
--   --                DROP VIEW public.v_lcc_ac10_promote_candidates;
--   --                DROP TABLE public.lcc_ac10_promote_log;
--   --                SELECT cron.unschedule('lcc-ac10-promote-linked-contacts');
