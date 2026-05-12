-- Loosen gov_auto_resolve_ownership and populate matched_sale_id.
--
-- The 2026-05-07 version required lease_number + transfer_date + sale_date all
-- non-null and a ±90d window. A 2026-05-12 audit (5,989 pending ownership_history
-- rows) showed it matched 1 row. Two new buckets close the gap by matching the
-- same lease number on a wider window (or when one side has no date) and by
-- matching property_id when lease numbers differ. The empty_shell / placeholder /
-- exact_dup logic is unchanged.
--
-- All comp_on_file* branches now also write matched_sale_id so the link is
-- queryable downstream (UI badges, propagation queue, sales_transactions joins).
--
-- Bucket names returned are stable, plus two new ones:
--   comp_on_file_loose     -- same lease, wider window or null date on either side
--   comp_on_file_property  -- property_id match within ±90 days of transfer_date
-- gov.js maps these to user-visible labels.

CREATE OR REPLACE FUNCTION public.gov_auto_resolve_ownership(
  p_dry_run     boolean DEFAULT true,
  p_resolved_by text    DEFAULT 'dashboard:auto_resolve_sweep'
)
RETURNS TABLE(bucket text, matched integer, applied integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_empty_shell_ids        uuid[];
  v_placeholder_ids        uuid[];
  v_strict_pairs           jsonb;
  v_loose_pairs            jsonb;
  v_property_pairs         jsonb;
  v_exact_dup_ids          uuid[];
  v_placeholder_re text := '^(unknown|n/?a|none|previous owner|previous owner name|previous owner name unknown|tbd|todo|--|---)$';
begin
  -- Bucket 1: empty shells (only true_owner_name set, nothing else)
  select array_agg(ownership_id)
    into v_empty_shell_ids
    from public.ownership_history
   where (research_status = 'pending' OR research_status IS NULL)
     and lease_number        is null
     and address             is null
     and prior_owner         is null
     and new_owner           is null
     and transfer_date       is null
     and sale_price          is null
     and recorded_owner_name is null
     and true_owner_name     is not null;

  -- Bucket 2: boilerplate prior_owner placeholders
  select array_agg(ownership_id)
    into v_placeholder_ids
    from public.ownership_history
   where (research_status = 'pending' OR research_status IS NULL)
     and sale_price is null
     and prior_owner is not null
     and prior_owner ~* v_placeholder_re;

  -- Bucket 3 (strict): same lease_number + sale_date within ±90d of transfer_date.
  -- Score = abs date delta; pick the closest sale per ownership row.
  with strict_match as (
    select oh.ownership_id,
           st.sale_id,
           row_number() over (
             partition by oh.ownership_id
             order by abs((st.sale_date - oh.transfer_date))
           ) as rn
      from public.ownership_history oh
      join public.sales_transactions st
        on lower(trim(st.lease_number)) = lower(trim(oh.lease_number))
     where (oh.research_status = 'pending' OR oh.research_status IS NULL)
       and oh.lease_number  is not null
       and oh.transfer_date is not null
       and st.sale_date     is not null
       and st.sale_date between oh.transfer_date - interval '90 days'
                            and oh.transfer_date + interval '90 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('ownership_id', ownership_id, 'sale_id', sale_id)), '[]'::jsonb)
    into v_strict_pairs
    from strict_match
   where rn = 1;

  -- Bucket 4 (loose): same lease_number but either side has no date, OR the
  -- date window widens to ±365d. Excludes any ownership_id already in strict.
  -- When multiple candidate sales exist, prefer the one with the smallest
  -- date delta (or any sale when both dates are null).
  with strict_ids as (
    select (elem ->> 'ownership_id')::uuid as ownership_id
      from jsonb_array_elements(v_strict_pairs) elem
  ),
  loose_match as (
    select oh.ownership_id,
           st.sale_id,
           row_number() over (
             partition by oh.ownership_id
             order by
               case when oh.transfer_date is null or st.sale_date is null then 1 else 0 end,
               case
                 when oh.transfer_date is null or st.sale_date is null then null
                 else abs((st.sale_date - oh.transfer_date))
               end nulls last,
               st.sale_date desc nulls last
           ) as rn
      from public.ownership_history oh
      join public.sales_transactions st
        on lower(trim(st.lease_number)) = lower(trim(oh.lease_number))
     where (oh.research_status = 'pending' OR oh.research_status IS NULL)
       and oh.lease_number is not null
       and oh.ownership_id not in (select ownership_id from strict_ids)
       and (
             oh.transfer_date is null
          or st.sale_date    is null
          or st.sale_date between oh.transfer_date - interval '365 days'
                              and oh.transfer_date + interval '365 days'
           )
  )
  select coalesce(jsonb_agg(jsonb_build_object('ownership_id', ownership_id, 'sale_id', sale_id)), '[]'::jsonb)
    into v_loose_pairs
    from loose_match
   where rn = 1;

  -- Bucket 5 (property): property_id match + sale_date within ±90d of
  -- transfer_date. Excludes any ownership_id already in strict or loose.
  -- Catches cases where lease numbers diverge (renamed lease, missing on one
  -- side, etc.) but the property and date line up.
  with already as (
    select (elem ->> 'ownership_id')::uuid as ownership_id
      from jsonb_array_elements(v_strict_pairs || v_loose_pairs) elem
  ),
  property_match as (
    select oh.ownership_id,
           st.sale_id,
           row_number() over (
             partition by oh.ownership_id
             order by abs((st.sale_date - oh.transfer_date))
           ) as rn
      from public.ownership_history oh
      join public.sales_transactions st on st.property_id = oh.property_id
     where (oh.research_status = 'pending' OR oh.research_status IS NULL)
       and oh.property_id   is not null
       and oh.transfer_date is not null
       and st.sale_date     is not null
       and st.sale_date between oh.transfer_date - interval '90 days'
                            and oh.transfer_date + interval '90 days'
       and oh.ownership_id not in (select ownership_id from already)
  )
  select coalesce(jsonb_agg(jsonb_build_object('ownership_id', ownership_id, 'sale_id', sale_id)), '[]'::jsonb)
    into v_property_pairs
    from property_match
   where rn = 1;

  -- Bucket 6: exact-duplicate event rows (same lease + transfer_date + new_owner;
  -- keep the oldest row, mark the rest duplicate_of_event). Unchanged from prior
  -- revision.
  with grouped as (
    select ownership_id,
           row_number() over (
             partition by lease_number, transfer_date, lower(trim(new_owner))
             order by created_at asc, ownership_id asc
           ) as rn,
           count(*) over (
             partition by lease_number, transfer_date, lower(trim(new_owner))
           ) as group_n
      from public.ownership_history
     where (research_status = 'pending' OR research_status IS NULL)
       and lease_number is not null
       and transfer_date is not null
       and new_owner is not null
  )
  select array_agg(ownership_id)
    into v_exact_dup_ids
    from grouped
   where group_n > 1
     and rn > 1;

  if not p_dry_run then
    if v_empty_shell_ids is not null then
      update public.ownership_history
         set research_status = 'junk_no_data'
       where ownership_id = any(v_empty_shell_ids);
    end if;

    if v_placeholder_ids is not null then
      update public.ownership_history
         set research_status = 'junk_placeholder'
       where ownership_id = any(v_placeholder_ids)
         and not (v_empty_shell_ids is not null and ownership_id = any(v_empty_shell_ids));
    end if;

    -- comp_on_file (strict) — link matched_sale_id, mark comp_on_file
    update public.ownership_history oh
       set research_status  = 'comp_on_file',
           matched_sale_id  = (pair ->> 'sale_id')::uuid
      from jsonb_array_elements(v_strict_pairs) pair
     where oh.ownership_id = (pair ->> 'ownership_id')::uuid
       and not (v_empty_shell_ids is not null and oh.ownership_id = any(v_empty_shell_ids))
       and not (v_placeholder_ids is not null and oh.ownership_id = any(v_placeholder_ids));

    -- comp_on_file_loose
    update public.ownership_history oh
       set research_status  = 'comp_on_file',
           matched_sale_id  = (pair ->> 'sale_id')::uuid
      from jsonb_array_elements(v_loose_pairs) pair
     where oh.ownership_id = (pair ->> 'ownership_id')::uuid
       and not (v_empty_shell_ids is not null and oh.ownership_id = any(v_empty_shell_ids))
       and not (v_placeholder_ids is not null and oh.ownership_id = any(v_placeholder_ids));

    -- comp_on_file_property
    update public.ownership_history oh
       set research_status  = 'comp_on_file',
           matched_sale_id  = (pair ->> 'sale_id')::uuid
      from jsonb_array_elements(v_property_pairs) pair
     where oh.ownership_id = (pair ->> 'ownership_id')::uuid
       and not (v_empty_shell_ids is not null and oh.ownership_id = any(v_empty_shell_ids))
       and not (v_placeholder_ids is not null and oh.ownership_id = any(v_placeholder_ids));

    if v_exact_dup_ids is not null then
      update public.ownership_history
         set research_status = 'duplicate_of_event'
       where ownership_id = any(v_exact_dup_ids)
         and not (v_empty_shell_ids is not null and ownership_id = any(v_empty_shell_ids))
         and not (v_placeholder_ids is not null and ownership_id = any(v_placeholder_ids))
         and not (research_status = 'comp_on_file');
    end if;
  end if;

  return query
    select 'empty_shell'::text,
           coalesce(array_length(v_empty_shell_ids, 1), 0),
           case when p_dry_run then 0 else coalesce(array_length(v_empty_shell_ids, 1), 0) end
  union all
    select 'placeholder'::text,
           coalesce(array_length(v_placeholder_ids, 1), 0),
           case when p_dry_run then 0
                else coalesce(array_length(
                  array(
                    select id from unnest(v_placeholder_ids) as id
                     where not (v_empty_shell_ids is not null and id = any(v_empty_shell_ids))
                  ), 1), 0) end
  union all
    select 'comp_on_file'::text,
           jsonb_array_length(v_strict_pairs),
           case when p_dry_run then 0 else jsonb_array_length(v_strict_pairs) end
  union all
    select 'comp_on_file_loose'::text,
           jsonb_array_length(v_loose_pairs),
           case when p_dry_run then 0 else jsonb_array_length(v_loose_pairs) end
  union all
    select 'comp_on_file_property'::text,
           jsonb_array_length(v_property_pairs),
           case when p_dry_run then 0 else jsonb_array_length(v_property_pairs) end
  union all
    select 'exact_dup'::text,
           coalesce(array_length(v_exact_dup_ids, 1), 0),
           case when p_dry_run then 0
                else coalesce(array_length(
                  array(
                    select id from unnest(v_exact_dup_ids) as id
                     where not (v_empty_shell_ids is not null and id = any(v_empty_shell_ids))
                       and not (v_placeholder_ids is not null and id = any(v_placeholder_ids))
                  ), 1), 0) end;
end;
$function$;
