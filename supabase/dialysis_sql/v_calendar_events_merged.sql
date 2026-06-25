-- Cortex F4 — unified calendar de-duplication view (Dialysis_DB project zqzrriwuavgrquhisnoa).
-- Source of truth for the calendar write-back (calendar-caldav-push reads this).
-- Folds the SAME game appearing from multiple sources (TeamSnap official vs a manual
-- entry on a shared calendar): classify kid+sport (from title OR registry), then suppress
-- a lower-authority event when a better same kid+sport+date event exists within 90 minutes.
-- Authority: official feed (tsc-/mca-) > iCloud/CalDAV > Outlook. Also keeps the prior
-- exact location+time clustering for everything else (business meetings, etc.).
create or replace view v_calendar_events_merged as
with base as (
  select v.*,
    coalesce(
      case when v.subject ~* '\yjack\y' then 'Jack'
           when v.subject ~* '\yclaire\y' then 'Claire'
           when v.subject ~* '\ygraham\y' then 'Graham' end,
      v.calendar_kid) as d_kid,
    coalesce(
      case when v.subject ~* '\y(soccer|5v5|pda)\y' then 'soccer'
           when v.subject ~* '\y(basketball|bball)\y' then 'basketball'
           when v.subject ~* '\y(football)\y' then 'football'
           when v.subject ~* '\y(baseball)\y' then 'baseball'
           when v.subject ~* '\y(tennis)\y' then 'tennis' end,
      v.calendar_sport) as d_sport,
    case when v.calendar_name like 'tsc-%' or v.calendar_name like 'mca-%' then 1
         when v.calendar_name like 'icloud:%' or v.calendar_name like 'caldav-%' then 2
         else 3 end as src_rank
  from v_calendar_events_cortex v
),
ks_dup as (
  select distinct a.id
  from base a
  join base b
    on a.d_kid is not null and a.d_sport is not null
   and a.cortex_domain = b.cortex_domain
   and a.d_kid = b.d_kid and a.d_sport = b.d_sport
   and a.start_time::date = b.start_time::date
   and a.id <> b.id
   and abs(extract(epoch from (a.start_time - b.start_time))) <= 5400   -- 90 min window
   and (b.src_rank < a.src_rank or (b.src_rank = a.src_rank and b.id < a.id))
),
surv as ( select * from base where id not in (select id from ks_dup) ),
ranked as (
  select s.*,
    case when coalesce(btrim(s.location),'') <> ''
         then s.cortex_domain||'|'||to_char(s.start_time,'YYYYMMDDHH24MI')||'|'||lower(btrim(s.location))
         else 'solo|'||s.id end as cluster_id
  from surv s
),
final as (
  select r.*,
    count(*) over (partition by r.cluster_id) as merged_count,
    row_number() over (partition by r.cluster_id order by r.src_rank, r.id) as rn,
    array_agg(r.calendar_name) over (partition by r.cluster_id) as merged_sources
  from ranked r
)
select id, subject, start_time, end_time, location, cortex_domain, calendar_role,
       calendar_sport, calendar_kid, is_highlight, emoji, color, title_template,
       calendar_name as canonical_source, merged_count, merged_sources, is_all_day
from final
where rn = 1;
