-- ============================================================================
-- Google / News Alert leads — the UNIFIED cross-vertical intake home (LCC Opps)
--
-- Google Alerts on new construction / new locations for tracked tenants flow
-- through the lead-ingest edge function (POST ?action=news_alert, fed by Power
-- Automate from googlealerts-noreply@google.com). A hit can be dialysis,
-- government, OR net-lease — so, unlike CREXi/LoopNet (which land in DIA
-- marketing_leads), news alerts land in ONE canonical LCC-Opps table tagged by
-- `domain`, and the LCC app surfaces them cross-vertical.
--
--   status = 'developer_unknown'  (confidence >= threshold, auto-created)
--          | 'needs_review'        (confidence <  threshold, flagged)
--          | 'dismissed' | 'converted'
--
-- Additive + reversible (DROP TABLE news_alert_leads CASCADE -> zero trace).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.news_alert_leads (
    news_lead_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source / classification
    source         TEXT NOT NULL DEFAULT 'google_alert',
    domain         TEXT,                         -- dialysis | government | netlease | NULL
    tenant         TEXT,
    match_kind     TEXT,                         -- exact | alias | keyword | none
    confidence     NUMERIC(4,3),

    -- Article
    city           TEXT,
    state          TEXT,
    article_url    TEXT,
    article_title  TEXT,
    summary        TEXT,

    -- Routing / lifecycle: developer research is still owed once created.
    status         TEXT NOT NULL DEFAULT 'developer_unknown',

    -- Dedup + provenance
    dedup_key      TEXT,                         -- normalized tenant key (90-day repost guard)
    source_ref     TEXT,                         -- PA message id, when provided
    raw_subject    TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_alert_leads_domain     ON public.news_alert_leads(domain);
CREATE INDEX IF NOT EXISTS idx_news_alert_leads_status     ON public.news_alert_leads(status);
CREATE INDEX IF NOT EXISTS idx_news_alert_leads_dedup      ON public.news_alert_leads(dedup_key, created_at DESC);
-- Idempotency: one lead per (source, source_ref) when Power Automate sends a ref.
CREATE UNIQUE INDEX IF NOT EXISTS uq_news_alert_leads_source_ref
    ON public.news_alert_leads(source, source_ref)
    WHERE source_ref IS NOT NULL;

-- Reviewer queue: the low-confidence hits whose source email was left flagged.
CREATE OR REPLACE VIEW public.v_news_alert_review_queue AS
SELECT news_lead_id, domain, tenant, city, state, article_url, article_title,
       confidence, match_kind, status, created_at,
       (CURRENT_DATE - created_at::date) AS days_since_created
FROM   public.news_alert_leads
WHERE  status = 'needs_review'
ORDER  BY created_at DESC;

-- Developer-research queue: the auto-created hits that still owe a developer.
CREATE OR REPLACE VIEW public.v_news_alert_developer_queue AS
SELECT news_lead_id, domain, tenant, city, state, article_url, article_title,
       confidence, match_kind, status, created_at,
       (CURRENT_DATE - created_at::date) AS days_since_created
FROM   public.news_alert_leads
WHERE  status = 'developer_unknown'
ORDER  BY created_at DESC;

GRANT SELECT, INSERT, UPDATE ON public.news_alert_leads TO service_role;
GRANT SELECT ON public.news_alert_leads               TO authenticated, anon;
GRANT SELECT ON public.v_news_alert_review_queue       TO authenticated, anon, service_role;
GRANT SELECT ON public.v_news_alert_developer_queue    TO authenticated, anon, service_role;
