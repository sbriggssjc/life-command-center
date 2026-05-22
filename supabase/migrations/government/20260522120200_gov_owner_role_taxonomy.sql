-- ============================================================================
-- 20260522120200_gov_owner_role_taxonomy.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 (government mirror)
--
-- Mirrors the LCC canonical owner_role taxonomy onto gov.true_owners. The
-- government DB has historically had NO developer-specific fields on
-- true_owners — only properties.developer (TEXT) and
-- properties.original_developer_contact_id. This migration brings parity:
-- gov.true_owners gets the full role taxonomy plus the developer-portfolio
-- fields that dialysis already had (properties_built/sold, hold duration,
-- disposition strategy). See audit §5.2.
--
-- Source of truth for owner_role lives on LCC public.entities; values here
-- are propagated by the cross-domain sync. Local writes via
-- src/owner_role_derivation.py are permitted, but the LCC entity row should
-- be updated in the same logical operation so the two stay in sync.
--
-- Rollback: ALTER TABLE ... DROP COLUMN ... in reverse order.
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
    -- Portfolio/scorecard fields parity with dialysis (audit §6.1 — gov was missing these):
    ADD COLUMN IF NOT EXISTS developer_flag BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS developer_tier TEXT
        CHECK (developer_tier IS NULL OR developer_tier IN ('platinum','gold','silver','watchlist')),
    ADD COLUMN IF NOT EXISTS total_properties_owned INTEGER,
    ADD COLUMN IF NOT EXISTS properties_built INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS properties_sold INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS avg_hold_duration_months NUMERIC,
    ADD COLUMN IF NOT EXISTS disposition_strategy TEXT
        CHECK (disposition_strategy IS NULL OR disposition_strategy IN
            ('sell_immediately','hold_short_term','long_term_hold')),
    -- User/Owner tier signals (audit §3.1):
    ADD COLUMN IF NOT EXISTS facilities_operated_count INTEGER,
    ADD COLUMN IF NOT EXISTS facilities_owned_real_estate_count INTEGER,
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
    '(cross-database). Populated by the cross-domain matcher; treat as nullable.';

-- "facilities_*" naming on gov vs "clinics_*" on dia is intentional — gov
-- entities are federal-leased facilities, not clinics. The semantics are
-- otherwise identical (count of operated assets and count of operated assets
-- where the owner holds title to the RE).
COMMENT ON COLUMN public.true_owners.facilities_operated_count IS
    'Gov equivalent of dia.true_owners.clinics_operated_count. Drives User/Owner '
    'tier per audit §3.1 (≥10 facilities operated AND owns RE on ≥1 → Tier A).';

COMMENT ON COLUMN public.true_owners.user_owner_tier IS
    'A/B/C cadence tier for User/Owner entities. Per audit §3.1: '
    'A = 12 touches/yr (≥10 facilities operated AND owns RE on ≥1); '
    'B = 4 touches/yr (default); C = 1-2 touches/yr (small/inactive).';

-- --- Indexes ----------------------------------------------------------------

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

CREATE INDEX IF NOT EXISTS idx_true_owners_developer_flag
    ON public.true_owners (developer_flag)
    WHERE developer_flag = TRUE;

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
    developer_flag,
    developer_tier,
    developer_flag_sources,
    user_owner_tier,
    user_owner_tier_source,
    primary_concern,
    facilities_operated_count,
    facilities_owned_real_estate_count,
    total_properties_owned,
    properties_built,
    properties_sold,
    avg_hold_duration_months,
    disposition_strategy
FROM public.true_owners;

COMMENT ON VIEW public.v_true_owners_effective_role IS
    'DEVELOPER_BD_AUDIT_v3 §2 effective owner role on gov.true_owners. '
    'Mirrors LCC public.v_entities_effective_role for local read paths.';

-- ============================================================================
-- End migration
-- ============================================================================
