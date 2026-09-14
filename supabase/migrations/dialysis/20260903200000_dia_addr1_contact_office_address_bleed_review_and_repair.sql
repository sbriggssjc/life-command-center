-- ADDR1 (2026-09-03): the CoStar Contacts tab's broker/company office address
-- was being captured as the PROPERTY address (extension/content/costar.js
-- findAddressInLines lacked "Sales Company"/"Sales Contacts"/"Listing
-- Contacts"/"Property Manager" in FOREIGN_PARTY_HEADER_RE — fixed
-- client-side in the same round, plus a server-side belt in
-- upsertDomainProperty via api/_shared/contact-address-bleed-guard.js).
--
-- This migration:
--   1) ships a standing REVIEW view (never auto-repairs) so future/other
--      instances the detector finds are surfaced, not silently fixed;
--   2) repairs the two NAMED rows only, per the doctrine of this repo
--      (fill-blanks / conservative / reversible / never bulk address rewrite):
--        - 37491 is a phantom DUPLICATE of the real property 35722 (byte-
--          identical building_size/year_built/land_area/tenant/operator,
--          and its attached sale ($4.38M, 2017-09-26, buyer OSAGE TOWERS LTD,
--          seller LAKE DELTON RE LLC — Lake Delton is the town immediately
--          adjacent to Wisconsin Dells, WI) is genuinely 35722's own sale
--          history, wearing SRS Capital Markets' Newport Beach, CA office
--          street). Merged via the EXISTING reversible property-twin merge
--          machinery (dia_merge_property_reversible), which walks every FK
--          to properties and repoints it automatically (sales_transactions,
--          available_listings, etc.) and snapshots the dropped row so it can
--          be restored with dia_unmerge_property(backup_id).
--        - 50990 is a REAL, DISTINCT Gary, IN property (different building
--          stats, different broker/listing) that lost its own street to the
--          same bleed. We do not know the true street, so per the "write no
--          address rather than a wrong one" doctrine the corrupted value is
--          QUARANTINED (nulled, with the original preserved in `notes` for
--          reversal) rather than guessed at. city/state/zip were already
--          correct and are left untouched.
--
-- REVERSAL RUNBOOK:
--   - 37491: `select dia_unmerge_property(backup_id) from
--     dia_property_merge_backup where batch_tag =
--     'addr1_costar_contacts_bleed_20260903' and unmerged_at is null;`
--   - 50990: `update properties set address = '680 Newport Center Dr',
--     address_source = null,
--     notes = regexp_replace(notes, E'\\n?\\[ADDR1.*$', '')
--     where property_id = 50990;` (only if a future capture proves that WAS
--     in fact correct — it is not, per the live evidence above; this is
--     provided only because every repair in this repo must be reversible).

-- 1) Standing review view (read-only; SECURITY INVOKER; never repairs).
--    Detector: a captured CONTACT states, as ITS OWN office address, the
--    EXACT street text we hold for a property, while that contact's own
--    city and/or state DISAGREES with the property's. Narrow on purpose —
--    a naive cross-city/state address match (dominated by placeholders and
--    common street numbers, per the task brief) is NOT what this reads; it
--    requires a captured CONTACT record naming that exact street as its own.
--    A contact at the SAME address with the SAME city/state (an owner
--    genuinely headquartered at the property — the common, legitimate case,
--    12 of 13 raw matches on this table) is excluded by construction.
create or replace view public.v_dia_contact_office_address_bleed_review as
select
  p.property_id,
  p.address        as property_address,
  p.city           as property_city,
  p.state          as property_state,
  p.zip_code       as property_zip,
  c.contact_id,
  c.contact_name,
  c.role           as contact_role,
  c.address        as contact_address,
  c.city           as contact_city,
  c.state          as contact_state
from public.properties p
join public.contacts c
  on lower(trim(c.address)) = lower(trim(p.address))
where c.address is not null and length(trim(c.address)) >= 8
  and p.address is not null and length(trim(p.address)) >= 8
  and p.merged_into_property_id is null
  and (
       (c.city  is not null and p.city  is not null and lower(trim(c.city))  <> lower(trim(p.city)))
    or (c.state is not null and p.state is not null and lower(trim(c.state)) <> lower(trim(p.state)))
  );

comment on view public.v_dia_contact_office_address_bleed_review is
  'ADDR1 (2026-09-03): properties whose street exactly matches a captured contact''s OWN office address at a DIFFERENT city/state — the CoStar Contacts-tab office-address-bleed class. Review only; never auto-repaired. See migration addr1_contact_office_address_bleed_review_and_repair.';

-- 2a) Repair 37491 → merge into 35722 (reversible, snapshotted).
select public.dia_merge_property_reversible(35722, 37491, 'addr1_costar_contacts_bleed_20260903');

-- 2b) Repair 50990 → quarantine the corrupted street (fill-blanks-safe:
--     never overwrite with a guess; city/state/zip untouched).
update public.properties
set address = null,
    address_source = 'addr1_quarantined_contact_bleed',
    notes = coalesce(notes || E'\n', '')
      || '[ADDR1 2026-09-03] address cleared — was "680 Newport Center Dr", '
      || 'which is SRS/broker-office bleed (matches a captured contact''s own '
      || 'Newport Beach, CA office street); this property''s real Gary, IN '
      || 'street is unknown and was never re-captured. city/state/zip are '
      || 'unaffected. See v_dia_contact_office_address_bleed_review / ADDR1.'
where property_id = 50990
  and address = '680 Newport Center Dr';
