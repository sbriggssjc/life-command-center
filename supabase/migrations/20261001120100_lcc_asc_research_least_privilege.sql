-- Follow-up for projects whose legacy default privileges grant service_role
-- ALL on newly-created public tables. Keep captures/evidence append-only and
-- expose only the operations used by the restricted server adapter.

revoke all on public.healthcare_research_runs from service_role;
revoke all on public.healthcare_research_candidates from service_role;
revoke all on public.healthcare_research_captures from service_role;
revoke all on public.healthcare_research_evidence from service_role;
revoke all on public.healthcare_research_reviews from service_role;

grant select, insert, update on public.healthcare_research_runs to service_role;
grant select, insert, update on public.healthcare_research_candidates to service_role;
grant select, insert on public.healthcare_research_captures to service_role;
grant select, insert on public.healthcare_research_evidence to service_role;
grant select, insert, update on public.healthcare_research_reviews to service_role;
grant usage, select on sequence public.healthcare_research_evidence_evidence_id_seq to service_role;
