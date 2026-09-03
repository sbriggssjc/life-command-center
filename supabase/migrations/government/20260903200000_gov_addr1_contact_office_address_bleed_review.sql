-- ADDR1 (2026-09-03), gov mirror. See dia migration
-- 20260903200000_dia_addr1_contact_office_address_bleed_review_and_repair.sql
-- for the full mechanism + writeup. gov has the identical shape live:
-- property 9893 carries J.P. Morgan Asset Management's "245 Park Ave, New
-- York, NY" office street under a Raton, NM city/state. Review-only here —
-- no gov row was named in the task's repair scope, so nothing is
-- auto-repaired; this view exists so 9893 (and any future instance) is
-- surfaced for a human, per doctrine ("anything else the detector finds
-- goes to a review view, not automatic repair").
create or replace view public.v_gov_contact_office_address_bleed_review as
select
  p.property_id,
  p.address        as property_address,
  p.city           as property_city,
  p.state          as property_state,
  c.contact_id,
  c.name           as contact_name,
  c.contact_type,
  c.address        as contact_address,
  c.city           as contact_city,
  c.state          as contact_state
from public.properties p
join public.contacts c
  on lower(trim(c.address)) = lower(trim(p.address))
where c.address is not null and length(trim(c.address)) >= 8
  and p.address is not null and length(trim(p.address)) >= 8
  and (
       (c.city  is not null and p.city  is not null and lower(trim(c.city))  <> lower(trim(p.city)))
    or (c.state is not null and p.state is not null and lower(trim(c.state)) <> lower(trim(p.state)))
  );

comment on view public.v_gov_contact_office_address_bleed_review is
  'ADDR1 (2026-09-03): properties whose street exactly matches a captured contact''s OWN office address at a DIFFERENT city/state — the CoStar Contacts-tab office-address-bleed class. Review only; never auto-repaired.';
