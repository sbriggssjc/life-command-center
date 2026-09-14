-- Supabase advisor: cover the capture_id FK used for cascade checks and
-- capture-scoped evidence reads.
create index if not exists idx_healthcare_research_evidence_capture
  on public.healthcare_research_evidence (capture_id);
