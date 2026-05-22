-- ============================================================================
-- 20260522120000_lcc_owner_role_taxonomy.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 1 (canonical layer)
--
-- Adds the behavior-derived owner_role taxonomy to LCC canonical entities,
-- replacing the conflated heuristic developer_flag approach. Per audit §2
-- (categorization model) and §7.1 A1 (rollout plan).
--
-- Coexistence period: legacy is_developer/developer_flag on dia/gov
-- true_owners is NOT dropped here. A future migration will deprecate after
-- read paths cut over to owner_role.
--
-- Rollback notes:
--   This migration is purely additive (ADD COLUMN IF NOT EXISTS + indexes).
--   To roll back: DROP the indexes, then DROP COLUMN each added column
--   (preserve developer_flag_sources data in a backup table first if needed).
-- ============================================================================

-- --- New columns on entities -------------------------------------------------

ALTER TABLE public.entities
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
    ADD COLUMN IF NOT EXISTS behavioral_override_by UUID REFERENCES public.users(id),
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
            ('real_estate','operational_growth','mixed'));

-- developer_flag_sources is a JSONB array of:
--   { "source": "bts_delivered" | "legacy_heuristic" | "lcc_auto_detection" | ...,
--     "confidence": 0.95,
--     "observed_at": "2026-05-22T00:00:00Z",
--     "details": {...}                              -- optional, source-specific
--   }
COMMENT ON COLUMN public.entities.developer_flag_sources IS
    'Append-only JSONB array of signals supporting owner_role=''developer'' '
    'classification. Each entry: {source, confidence, observed_at[, details]}. '
    'Multiple sources allowed (e.g., BTS delivery + repeat tenant + year-built '
    'coincidence). See DEVELOPER_BD_AUDIT_v3 §2.5 for source taxonomy.';

COMMENT ON COLUMN public.entities.owner_role IS
    'Behavior-derived owner classification. See DEVELOPER_BD_AUDIT_v3 §2.2 '
    'for the five categories. ''unknown'' = not yet classified. Behavioral '
    'override takes precedence: when behavioral_override IS NOT NULL, that '
    'value should be the effective role (UI and queries should COALESCE).';

COMMENT ON COLUMN public.entities.behavioral_override IS
    'Manual override of owner_role when observed behavior differs from '
    'structural classification (e.g., DaVita''s Genesis KC subsidiary acts as '
    'a Developer despite being an Operator subsidiary). When set, all read '
    'paths should treat this as the effective owner_role.';

COMMENT ON COLUMN public.entities.developer_status_active_until IS
    'Date through which entity is considered a CURRENT developer (vs Former). '
    'Per audit §2.3, current = active development project in past 3-5 years. '
    'Set on BTS delivery or first-gen lease commencement; rolled forward by '
    'subsequent qualifying events.';

COMMENT ON COLUMN public.entities.user_owner_tier IS
    'A/B/C cadence tier for User/Owner entities. Per audit §3.1: '
    'A = 12 touches/yr (≥10 clinics operated AND owns RE on ≥1); '
    'B = 4 touches/yr (default); C = 1-2 touches/yr (small/inactive).';

COMMENT ON COLUMN public.entities.primary_concern IS
    'Per audit §2.1 maximum-resonating-message rule: when User/Owner client''s '
    'primary concern flips from real_estate to operational_growth, the BD '
    'messaging flips accordingly. Drives memo template selection.';

-- --- Indexes ----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_entities_owner_role
    ON public.entities (owner_role)
    WHERE owner_role <> 'unknown';

CREATE INDEX IF NOT EXISTS idx_entities_behavioral_override
    ON public.entities (behavioral_override)
    WHERE behavioral_override IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_developer_active
    ON public.entities (developer_status_active_until)
    WHERE owner_role = 'developer' OR behavioral_override = 'developer';

CREATE INDEX IF NOT EXISTS idx_entities_user_owner_tier
    ON public.entities (user_owner_tier)
    WHERE user_owner_tier IS NOT NULL;

-- --- Helper: effective owner role (override-aware) --------------------------

CREATE OR REPLACE FUNCTION public.entity_effective_owner_role(p_entity_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(behavioral_override, owner_role)
    FROM public.entities
    WHERE id = p_entity_id;
$$;

COMMENT ON FUNCTION public.entity_effective_owner_role IS
    'Returns the effective owner_role for an entity, honoring behavioral_override. '
    'Use everywhere a query needs the classification to act on (priority queue, '
    'cadence rules, memo template selection, UI badges).';

-- --- View: effective role for any read path that needs it -------------------

CREATE OR REPLACE VIEW public.v_entities_effective_role AS
SELECT
    id                                                  AS entity_id,
    workspace_id,
    entity_type,
    name,
    canonical_name,
    domain,
    owner_role                                          AS computed_owner_role,
    owner_role_source,
    owner_role_confidence,
    owner_role_updated_at,
    behavioral_override,
    behavioral_override_reason,
    behavioral_override_by,
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
    clinics_owned_real_estate_count
FROM public.entities;

COMMENT ON VIEW public.v_entities_effective_role IS
    'DEVELOPER_BD_AUDIT_v3 §2 effective owner role exposure for read paths. '
    'COALESCEs behavioral_override over computed owner_role. Use this view '
    'in the priority queue, cadence enforcers, and UI badges.';

-- ============================================================================
-- End migration
-- ============================================================================
