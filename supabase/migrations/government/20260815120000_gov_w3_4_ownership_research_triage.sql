-- ============================================================================
-- W3.4 — gov ownership_research_queue TRIAGE  (audit 3.4, item 6)
-- Government DB (scknotsqkcheojiaewwh). Additive / reversible / idempotent.
-- ----------------------------------------------------------------------------
-- `ownership_research_queue` grew to 57,130 write-only rows: 9 unguarded producer
-- INSERT sites (government-lease repo) re-add 6–9 rows per unresolved lead every
-- pipeline pass, while the consumer (`ai_research.process_research_queue`) drains
-- only ~10 leads/pass — monotonic growth. The producers are being GATED OFF by
-- default in the pipeline repo (ENABLE_OWNERSHIP_RESEARCH_QUEUE, registered in
-- LCC feature_flags_registry). This migration triages the accumulated backlog.
--
-- ⚠️ GROUNDING (live, 2026-07-30): `ai_response` is a search PLAN (search_url /
--    search_terms / fields_to_capture), NOT a resolved owner, and `ai_confidence`
--    is confidence in the PLAN, not in a verified fact. So "auto-verify" here is
--    an AUTO-RESOLVE of the high-confidence subset whose PREMISE is already
--    satisfied by current authoritative data — the property already has a
--    resolved recorded/true owner — NOT an assertion that the AI's specific
--    search answer was checked. (Same "AI echo" caveat as ORE Phase A1.)
--
-- TRIAGE (live counts 2026-07-30, total 57,130):
--   • AUTO-VERIFY (kept in place, human_verified=true): task_status='complete'
--     AND ai_confidence>=0.85 AND the lead's property already has a current
--     recorded/true owner  → 17,665 rows. Premise corroborated → auto-resolved.
--   • ARCHIVE the rest (39,465): every non-auto-verified row (queued 8,633,
--     complete-uncorroborated 15,005, skipped 15,685, failed 142) →
--     archive.ownership_research_queue_w34, then DELETE from public. The gated
--     producer will not refill it; if ownership research is revived (flag on) the
--     producers regenerate queued rows fresh.
--   • A 500-row STRATIFIED SAMPLE (by task_type × bucket) of the archived rows is
--     kept in public.ownership_research_triage_sample so a human can audit the
--     archive WITHOUT being shown 40k rows.
--   Result: public.ownership_research_queue 57,130 → 17,665 (verified only).
--
-- REVERSAL: the full pre-triage snapshot is archive.ownership_research_queue_w34_backup.
--   To restore: TRUNCATE public.ownership_research_queue; INSERT ... SELECT the
--   original columns from the backup. To reverse only the archive:
--   INSERT INTO public.ownership_research_queue SELECT <orig cols> FROM
--   archive.ownership_research_queue_w34;  To reverse only the auto-verify:
--   UPDATE public.ownership_research_queue SET human_verified=null, verified_by=null,
--   verified_at=null WHERE verified_by='w34_auto_triage'.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Full pre-triage snapshot (reversal master). Captured once.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archive.ownership_research_queue_w34_backup AS
  SELECT * FROM public.ownership_research_queue;

INSERT INTO archive.manifest (table_name, drop_after, reason)
SELECT 'ownership_research_queue_w34_backup', (now() + interval '180 days')::date,
       'W3.4 pre-triage full snapshot of public.ownership_research_queue (reversal source)'
WHERE NOT EXISTS (SELECT 1 FROM archive.manifest WHERE table_name='ownership_research_queue_w34_backup');

-- ----------------------------------------------------------------------------
-- 1. AUTO-VERIFY the high-confidence, premise-corroborated subset (in place).
--    Corroboration = the queue row's lead has a resolved owner in CURRENT data,
--    either lead-level (prospect_leads.recorded_owner/true_owner) or via the
--    matched property's live recorded_owners/true_owners.
-- ----------------------------------------------------------------------------
WITH corr AS (
  SELECT orq.research_id
    FROM public.ownership_research_queue orq
    JOIN public.prospect_leads pl ON pl.lead_id = orq.lead_id
   WHERE orq.task_status = 'complete'
     AND orq.ai_confidence >= 0.85
     AND orq.human_verified IS NOT TRUE
     AND (
       COALESCE(NULLIF(TRIM(pl.recorded_owner),''), NULLIF(TRIM(pl.true_owner),'')) IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.properties p
           LEFT JOIN public.true_owners t     ON t.true_owner_id     = p.true_owner_id
           LEFT JOIN public.recorded_owners r ON r.recorded_owner_id = p.recorded_owner_id
          WHERE p.property_id = pl.matched_property_id
            AND (LENGTH(TRIM(COALESCE(t.name,''))) > 0 OR LENGTH(TRIM(COALESCE(r.name,''))) > 0)
       )
     )
)
UPDATE public.ownership_research_queue orq
   SET human_verified = TRUE,
       verified_by    = 'w34_auto_triage',
       verified_at    = now(),
       human_notes    = COALESCE(orq.human_notes || ' | ', '')
         || 'W3.4 auto-verify (auto-resolve): ai_confidence>=0.85 AND ownership premise corroborated by current recorded/true owner data.'
  FROM corr
 WHERE corr.research_id = orq.research_id;

-- ----------------------------------------------------------------------------
-- 2. ARCHIVE the rest (every non-auto-verified row) with its triage bucket.
--    CREATE TABLE AS captures rows + bucket; the DELETE is keyed off the archive
--    so re-running the migration is a no-op (nothing new to move/delete).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archive.ownership_research_queue_w34 AS
  SELECT orq.*,
         CASE WHEN orq.task_status = 'queued'  THEN 'queued'
              WHEN orq.task_status = 'skipped' THEN 'skipped'
              WHEN orq.task_status = 'failed'  THEN 'failed'
              WHEN orq.task_status = 'complete' THEN 'complete_uncorroborated'
              ELSE COALESCE(orq.task_status,'unknown') END AS w34_bucket,
         now() AS w34_archived_at
    FROM public.ownership_research_queue orq
   WHERE orq.human_verified IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_orq_w34_bucket
  ON archive.ownership_research_queue_w34 (w34_bucket, task_type);

INSERT INTO archive.manifest (table_name, drop_after, reason)
SELECT 'ownership_research_queue_w34', (now() + interval '180 days')::date,
       'W3.4 archived non-auto-verified ownership_research_queue rows (queued/complete-uncorroborated/skipped/failed); producer gated, revival regenerates fresh'
WHERE NOT EXISTS (SELECT 1 FROM archive.manifest WHERE table_name='ownership_research_queue_w34');

DELETE FROM public.ownership_research_queue p
 USING archive.ownership_research_queue_w34 a
 WHERE a.research_id = p.research_id;

-- ----------------------------------------------------------------------------
-- 3. 500-row STRATIFIED sample (proportional by task_type × bucket) — the
--    human-facing audit slice of the archive. Static snapshot of the triage.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.ownership_research_triage_sample;
CREATE TABLE public.ownership_research_triage_sample AS
WITH strata AS (
  SELECT a.research_id, a.lead_id, a.task_type, a.task_status, a.w34_bucket,
         a.priority_score, a.ai_confidence,
         LEFT(a.ai_response, 300) AS ai_response_preview,
         a.human_notes, a.created_at, a.w34_archived_at,
         row_number() OVER (PARTITION BY a.task_type, a.w34_bucket
                            ORDER BY a.priority_score DESC NULLS LAST, a.created_at DESC) AS rn,
         count(*)     OVER (PARTITION BY a.task_type, a.w34_bucket) AS strat_n,
         count(*)     OVER () AS tot_n
    FROM archive.ownership_research_queue_w34 a
)
SELECT research_id, lead_id, task_type, task_status, w34_bucket, priority_score,
       ai_confidence, ai_response_preview, human_notes, created_at, w34_archived_at,
       strat_n AS stratum_total
  FROM strata
 WHERE rn <= GREATEST(1, CEIL(500.0 * strat_n / NULLIF(tot_n,0)))
 ORDER BY task_type, w34_bucket, rn;

COMMENT ON TABLE public.ownership_research_triage_sample IS
  'W3.4: 500-row stratified (task_type × bucket) audit sample of the ownership_research_queue rows archived to archive.ownership_research_queue_w34. Human review slice — the full 39,465-row archive is NOT surfaced.';

GRANT SELECT ON public.ownership_research_triage_sample TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Verification (read in the migration output).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_live      int;
  v_verified  int;
  v_archived  int;
  v_sample    int;
  v_backup    int;
BEGIN
  SELECT count(*) INTO v_live     FROM public.ownership_research_queue;
  SELECT count(*) INTO v_verified FROM public.ownership_research_queue WHERE verified_by='w34_auto_triage';
  SELECT count(*) INTO v_archived FROM archive.ownership_research_queue_w34;
  SELECT count(*) INTO v_sample   FROM public.ownership_research_triage_sample;
  SELECT count(*) INTO v_backup   FROM archive.ownership_research_queue_w34_backup;
  RAISE NOTICE 'W3.4 triage: live=% (verified=%), archived=%, sample=%, backup=% (live+archived should = backup)',
    v_live, v_verified, v_archived, v_sample, v_backup;
END $$;
