-- RECON2-d follow-up (2026-09-18):
--
-- 1. Fill a single blind row: medicare_clinics.chain_organization is NULL on the
--    LIVE (is_operating=true) CMS row for property_id=35849 (medicare_id='032520'),
--    even though the DEMOTED-DUPLICATE sibling row for the SAME property/address
--    (medicare_id='32520' — a leading-zero CCN duplicate) already carries
--    chain_organization='DaVita' / operator_id=4, and the property's own ACTIVE
--    lease (lease_id 18592, tenant='DaVita Kidney Care') independently confirms the
--    same chain. Two sourced, agreeing signals for ONE row -- fill-blanks only, no
--    bulk write, no other row touched.
--
-- 2. Land leases 23259 / 12678 / 13058 (RECON2-d rename) in the SAME pending_updates
--    review lane RECON2-b already uses, because the rename left a genuine open
--    question on each row: what IS the current lease term? (CoStar shows the lease
--    active with no date; the recorded expiration is 12-14 years stale.) This is not
--    a NEW lane -- table_name/entity/status mirror the existing
--    'leases'/'lease:<id>'/'open' shape RECON2-b's enqueuer already writes.
--
-- Idempotent / re-runnable.

begin;

-- ---------------------------------------------------------------------------
-- 1. Property 35849's blind CMS row.
-- ---------------------------------------------------------------------------
update medicare_clinics
   set chain_organization = 'DaVita',
       operator_id = 4
 where property_id = 35849
   and medicare_id = '032520'
   and chain_organization is null;

insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, note, dry_run)
select 'recon2d_35849_' || to_char(now(), 'YYYYMMDD'), 'chain_organization_fill', 'medicare_clinics', '032520',
       'fill_chain_organization',
       'RECON2-d: property 35849 chain_organization filled DaVita/operator_id=4 from the '
       || 'demoted-duplicate sibling row (medicare_id 32520) plus the active on-property '
       || 'lease (lease_id 18592, tenant DaVita Kidney Care). Single row, fill-blanks only.',
       false
where exists (
  select 1 from medicare_clinics
  where property_id = 35849 and medicare_id = '032520' and chain_organization = 'DaVita'
)
  and not exists (
    select 1 from dia_recon1_run_log
    where step = 'chain_organization_fill' and target_table = 'medicare_clinics' and target_id = '032520'
  );

-- ---------------------------------------------------------------------------
-- 2. CoStar-date chase follow-up for the 3 renamed leases (mirrors RECON2-b's
--    'leases' / 'lease:<id>' / status='open' shape; field_name='lease_expiration'
--    because expiration_state is already resolved -- the open ask is the DATE.
-- ---------------------------------------------------------------------------
insert into pending_updates (table_name, field_name, action, reason, entity, payload, file_name, status)
select v.table_name, v.field_name, v.action, v.reason, v.entity, v.payload, v.file_name, v.status
from (
  values
    ('leases', 'lease_expiration', 'research_needed',
     'Lease confirmed occupied_term_unknown (RECON2-d): CoStar shows this lease active with '
     || 'NO expiration date recorded, and the recorded 2012-05-31 expiration is 14+ years '
     || 'stale. Confirm the current lease term from the CoStar renewal record (or a fresh '
     || 'lease document) and update lease_expiration. Do not invent a date.',
     'lease:23259',
     jsonb_build_object('lease_id', 23259, 'property_id', 27677, 'tenant', 'DaVita Kidney Care',
       'recorded_lease_expiration', '2012-05-31', 'expiration_state', 'occupied_term_unknown'),
     'recon2d_costar_date_followup', 'open'),
    ('leases', 'lease_expiration', 'research_needed',
     'Lease confirmed occupied_term_unknown (RECON2-d): CoStar shows this lease active with '
     || 'NO expiration date recorded, and the recorded 2014-03-31 expiration is 12+ years '
     || 'stale. Confirm the current lease term from the CoStar renewal record (or a fresh '
     || 'lease document) and update lease_expiration. Do not invent a date.',
     'lease:12678',
     jsonb_build_object('lease_id', 12678, 'property_id', 25464, 'tenant', 'Davita',
       'recorded_lease_expiration', '2014-03-31', 'expiration_state', 'occupied_term_unknown'),
     'recon2d_costar_date_followup', 'open'),
    ('leases', 'lease_expiration', 'research_needed',
     'Lease confirmed occupied_term_unknown (RECON2-d): CoStar shows this lease active with '
     || 'NO expiration date recorded, and the recorded 2016-01-31 expiration is 10+ years '
     || 'stale. Confirm the current lease term from the CoStar renewal record (or a fresh '
     || 'lease document) and update lease_expiration. Do not invent a date.',
     'lease:13058',
     jsonb_build_object('lease_id', 13058, 'property_id', 28547, 'tenant', 'Davita Commonwealth Dialysis',
       'recorded_lease_expiration', '2016-01-31', 'expiration_state', 'occupied_term_unknown'),
     'recon2d_costar_date_followup', 'open')
) as v(table_name, field_name, action, reason, entity, payload, file_name, status)
where not exists (
  select 1 from pending_updates pu
  where pu.entity = v.entity
    and pu.field_name = v.field_name
    and pu.status in ('open', 'pending_review', 'needs_match', 'needs_clarification', 'retry', 'new')
);

commit;
