-- ============================================================================
-- 20260522190200_lcc_user_domain_specialties.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 8 (user specialties + briefing filter)
--
-- Tracks which BD users specialize in which verticals (dialysis, government,
-- future: asc, vet, childcare, urgent_care). Drives daily briefing + priority
-- queue filtering so each broker sees their relevant slice of work.
--
-- Per audit §1.2 team focus areas (as of 2026-05-22):
--   - Scott Briggs (sabriggs@northmarq.com): gov (primary), dia (secondary)
--   - Kelly Largent: dia (primary), childcare (future) — not yet in users table
--   - Nate: adjacent net lease (future urgent_care) — not yet in users table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_domain_specialties (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN (
    'dia', 'gov', 'asc', 'vet', 'childcare', 'urgent_care'
  )),
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN (
    'primary', 'secondary', 'future'
  )),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  started_at DATE,
  ended_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_user_domain_specialties_domain
  ON public.user_domain_specialties (domain, active)
  WHERE active = TRUE;

COMMENT ON TABLE public.user_domain_specialties IS
  'DEVELOPER_BD_AUDIT_v3 §7.1 A8 Topic 8. Per-user vertical focus areas. '
  'Drives daily briefing + priority queue filtering. ''primary''/''secondary'' = '
  'currently active; ''future'' = planned expansion (e.g., Kelly''s childcare).';

-- Seed current team — Scott is the only user in users today
-- Kelly + Nate to be added when their accounts exist
INSERT INTO public.user_domain_specialties (user_id, domain, role, started_at, notes)
SELECT u.id, 'gov', 'primary', '2026-03-17', 'Per DEVELOPER_BD_AUDIT_v3 §1.2'
FROM public.users u
WHERE u.email = 'sabriggs@northmarq.com'
  AND u.display_name = 'Scott Briggs'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_domain_specialties
    WHERE user_id = u.id AND domain = 'gov'
  )
ON CONFLICT (user_id, domain) DO NOTHING;

INSERT INTO public.user_domain_specialties (user_id, domain, role, started_at, notes)
SELECT u.id, 'dia', 'secondary', '2026-03-17', 'Per DEVELOPER_BD_AUDIT_v3 §1.2'
FROM public.users u
WHERE u.email = 'sabriggs@northmarq.com'
  AND u.display_name = 'Scott Briggs'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_domain_specialties
    WHERE user_id = u.id AND domain = 'dia'
  )
ON CONFLICT (user_id, domain) DO NOTHING;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.user_domain_specialties_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_domain_specialties_updated_at ON public.user_domain_specialties;
CREATE TRIGGER trg_user_domain_specialties_updated_at
  BEFORE UPDATE ON public.user_domain_specialties
  FOR EACH ROW EXECUTE FUNCTION public.user_domain_specialties_set_updated_at();
