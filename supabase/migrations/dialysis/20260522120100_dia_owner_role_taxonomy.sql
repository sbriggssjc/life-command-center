-- ============================================================================
-- 20260522120100_dia_owner_role_taxonomy.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 (dialysis mirror)
--
-- Mirrors the LCC canonical owner_role taxonomy onto dia.true_owners so
-- domain-local queries can filter/sort by owner_role without crossing the
-- canonical-entity bridge on every read.
--
-- Source of truth for owner_role lives on LCC public.entities; values here
-- are propagated by the cross-domain sync job (api/_handlers/owner-role-sync,
-- to be added under Topic 1/A1 follow-up). Local writes via
-- src/owner_role_derivation.py are permitted, but the LCC entity row should
-- be updated in the same logical operation so the two stay in sync.
--
-- Coexistence: legacy true_owners.developer_flag / is_developer / developer_tier
-- / ownership_pattern / developer_flag_source columns are PRESERVED. They will
-- be deprecated in a later migration once readers have cut over.
--
-- Rollback: ALTER TABLE ... DROP COLUMN ... in reverse order. JSONB data in
-- developer_flag_sources should be exported first if recovery is needed.
-- ============================================================================

ALTER TABLE public.true_owners
    ADD COLUMN IF NOT EXISTS owner_role TEXT
        CHECK (owner_role IN ('developer','user_owner','buyer','seller_flipper','operator','unknown'))
        DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS owner_role_source TEXT
        CHECK (owner_role_source IS NULL OR owner_role_source IN
            ('computed','manual','behavioral_override','legacy_heuristic','bts_delivered')),
    ADD COLUMN IF NOT EXISTS owner_role_confidence NUMERIC(3,2)
        CHECK (owner_role_confidence IS NULL OR
            (owner_role_confidence >= 0.00 AND owner_role_confidence <= 1.00)),
    ADD COLUMN IF NOT EXISTS owner_role_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS developer_status_active_until DATE,
    ADD COLUMN IF NOT EXISTS behavioral_override TEXT
        CHECK (behavioral_override IS NULL OR behavioral_override IN
            ('developer','user_owner','buyer','seller_flipper','operator')),
    ADD COLUMN IF NOT EXISTS behavioral_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS behavioral_override_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS developer_flag_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS clinics_operated_count INTEGER,
    ADD COLUMN IF NOT EXISTS clinics_owned_real_estate_count INTEGER,
    ADD COLUMN IF NOT EXISTS user_owner_tier TEXT
        CHECK (user_owner_tier IS NULL OR user_owner_tier IN ('A','B','C')),
    ADD COLUMN IF NOT EXISTS user_owner_tier_source TEXT
        CHECK (user_owner_tier_source IS NULL OR user_owner_tier_source IN ('computed','manual')),
    ADD COLUMN IF NOT EXISTS primary_concern TEXT
        CHECK (primary_concern IS NULL OR primary_concern IN
            ('real_estate','operational_growth','mixed')),
    -- Logical reference to LCC public.entities.id (no FK; cross-database)
    ADD COLUMN IF NOT EXISTS lcc_canonical_entity_id UUID;

COMMENT ON COLUMN public.true_owners.owner_role IS
    'Behavior-derived owner classification (mirror of LCC entities.owner_role). '
    'See DEVELOPER_BD_AUDIT_v3 §2.2.';

COMMENT ON COLUMN public.true_owners.developer_flag_sources IS
    'Append-only JSONB array of signals supporting developer classification. '
    'Mirror of LCC entities.developer_flag_sources. Entries: '
    '{source, confidence, observed_at[, details]}.';

COMMENT ON COLUMN public.true_owners.lcc_canonical_entity_id IS
    'Logical reference to public.entities.id on the LCC ops DB. No FK '
    '(cross-database). Populated by the cross-domain matcher; treat as nullable. '
    'When set, the LCC entity is the source of truth for owner_role and friends.';

CREATE INDEX IF NOT EXISTS idx_true_owners_owner_role
    ON public.true_owners (owner_role)
    WHERE owner_role <> 'unknown';

CREATE INDEX IF NOT EXISTS idx_true_owners_behavioral_override
    ON public.true_owners (behavioral_override)
    WHERE behavioral_override IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_true_owners_developer_active
    ON public.true_owners (developer_status_active_until)
    WHERE owner_role = 'developer' OR behavioral_override = 'developer';

CREATE INDEX IF NOT EXISTS idx_true_owners_lcc_canonical
    ON public.true_owners (lcc_canonical_entity_id)
    WHERE lcc_canonical_entity_id IS NOT NULL;

-- --- Helper: effective owner role on local true_owner row -------------------

CREATE OR REPLACE FUNCTION public.true_owner_effective_role(p_true_owner_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(behavioral_override, owner_role)
    FROM public.true_owners
    WHERE true_owner_id = p_true_owner_id;
$$;

-- --- View mirror of the LCC effective-role view -----------------------------

CREATE OR REPLACE VIEW public.v_true_owners_effective_role AS
SELECT
    true_owner_id,
    lcc_canonical_entity_id,
    name,
    owner_role                                          AS computed_owner_role,
    owner_role_source,
    owner_role_confidence,
    owner_role_updated_at,
    behavioral_override,
    behavioral_override_reason,
    behavioral_override_at,
    COALESCE(behavioral_override, owner_role)           AS effective_owner_role,
    CASE
        WHEN behavioral_override IS NOT NULL THEN 'manual_override'
        ELSE COALESCE(owner_role_source, 'unset')
    END                                                 AS effective_role_source,
    developer_status_active_until,
    CASE
        WHEN COALESCE(behavioral_override, owner_role) = 'developer'
             AND developer_status_active_until >= CURRENT_DATE
        THEN TRUE
        ELSE FALSE
    END                                                 AS is_current_developer,
    developer_flag_sources,
    user_owner_tier,
    user_owner_tier_source,
    primary_concern,
    clinics_operated_count,
    clinics_owned_real_estate_count,
    -- Legacy fields kept for read continuity during coexistence period
    is_developer                                        AS legacy_is_developer,
    developer_flag                                      AS legacy_developer_flag,
    developer_tier                                      AS legacy_developer_tier,
    ownership_pattern                                   AS legacy_ownership_pattern
FROM public.true_owners;

COMMENT ON VIEW public.v_true_owners_effective_role IS
    'DEVELOPER_BD_AUDIT_v3 §2 effective owner role on dia.true_owners. '
    'Mirrors LCC public.v_entities_effective_role for local read paths.';

-- ============================================================================
-- End migration
-- ============================================================================
