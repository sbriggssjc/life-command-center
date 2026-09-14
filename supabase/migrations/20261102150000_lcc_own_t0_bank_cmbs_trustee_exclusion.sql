-- OWN-T0 / Tier 0: banks and CMBS trustees excluded from BD prospecting (Scott, 2026-09-14).
--
-- Decision: "Let's keep banks and CMBS trustees in their own unique category that we exclude
-- from prospecting for now. But that might be a decision we reevaluate in the future if we
-- decide to start prospecting lenders directly and work some coordinated capacity with the
-- Northmarq debt side in this space. For now, nothing though."
--
-- Same category as the existing public-body and university exclusions in
-- lcc_owner_name_is_not_prospected -- wired in the same way, at the same single choke point,
-- so it reaches all seven consuming views automatically (v_lcc_tier0_owner_contact_candidates,
-- v_lcc_seller_prospect_universe, v_lcc_top_seller_prospects, v_lcc_owner_contact_decidability,
-- v_lcc_loan_maturity_worklist, v_lcc_user_owner_candidates, v_lcc_entity_roles).
--
-- Sized live before shipping: 11 owner names match today (10 national banks + 1 JPMorgan CMBS
-- trust), all correctly institutional. 0 false positives against individual/family trustees
-- (e.g. "Tony Martin, Trustee", "Gloria J. Mullens - Trustee" correctly stay prospectable). 0
-- credit unions swept in -- deliberately excluded from this rule; member-owned, can be
-- legitimate owner-occupant prospects, not the same category as a bank/CMBS trustee holding
-- title incidentally. Closes N3c (tier0-owner-contact-system.md §6): Wells Fargo Bank NA
-- ($3,622,447 rent) and the JP Morgan Chase CMBS trust ($2,377,718 rent) are now correctly
-- excluded from the open Tier 0 lane -- verified live, both gone from
-- v_lcc_tier0_owner_contact_lane_open after this migration.
--
-- Revisitable: this is why it's a separate, named, commented function rather than inlined
-- regex -- gate it off later instead of deleting it if Scott decides to prospect lenders
-- directly, so the decision stays reversible without re-deriving the regex from scratch.

create or replace function public.lcc_owner_name_is_bank_or_trustee(p_name text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_name,'') ~* '\mnational association\M'
      or coalesce(p_name,'') ~* '\mbank\M.*\mas trustee\M'
      or coalesce(p_name,'') ~* '\mtrustee\M.*\mbank\M'
      or coalesce(p_name,'') ~* 'commercial mortgage.*(trust|pass[- ]?through|certificates)'
      or coalesce(p_name,'') ~* '(trust|pass[- ]?through|certificates).*commercial mortgage'
      or coalesce(p_name,'') ~* 'mortgage (pass[- ]?through|backed) (certificates|securities)'
      or coalesce(p_name,'') ~* 'savings bank';
$function$;

comment on function public.lcc_owner_name_is_bank_or_trustee(text) is
  'Scott 2026-09-14: banks and CMBS trustees holding title as loan servicers/trustees (not real '
  'economic owners) are excluded from BD prospecting, same category as public bodies and '
  'universities. Deliberately narrower than "trustee" alone -- individual/family trustees (e.g. '
  '"Tony Martin, Trustee") are real prospects and must NOT match. Deliberately excludes credit '
  'unions -- member-owned, can be legitimate owner-occupant prospects, not swept in with banks. '
  'Revisitable: Scott may want banks/lenders prospected directly in future via coordinated '
  'capacity with the Northmarq debt side -- do not delete this function if that happens, gate it '
  'off instead so the decision stays reversible.';

create or replace function public.lcc_owner_name_is_not_prospected(p_name text)
returns boolean
language sql
immutable
as $function$
  select lcc_owner_name_is_public_body(p_name)
      or lcc_owner_name_is_university(p_name)
      or lcc_owner_name_is_bank_or_trustee(p_name);
$function$;
