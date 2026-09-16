-- ID3d-reconcile (2026-09-16, Cowork)
--
-- ⚠️ THIS FILE WAS APPLIED LIVE FROM A CLAUDE CODE SESSION (with Supabase MCP access) BEFORE
-- THIS FILE EXISTED, and was then committed to the WRONG repository (`sbriggssjc/Dialysis`,
-- PR #7415) — the same "running but not merged" / wrong-repo class as DEED1-reconcile-2, one
-- round earlier, on this same database. Per this repo's own CLAUDE.md → "ONE REPO OWNS EACH
-- DATABASE'S OBJECTS": Dialysis_DB's SCHEMA objects (this migration: a new alias table, two
-- new functions, a new FK constraint, a new write-guard trigger, a new view) are owned by
-- `life-command-center`, applied FROM `supabase/migrations/dialysis/` — see that directory's
-- README. The `Dialysis` repo owns Dialysis_DB's CMS/NPI *ingestion* (rows, not schema).
--
-- Ported here byte-identical to what is live, NOT re-derived: the SQL below was diffed against
-- `pg_get_functiondef`/`pg_get_triggerdef`/`pg_views.definition` read live from Dialysis_DB
-- (`zqzrriwuavgrquhisnoa`) on 2026-09-16 before the port, and matches exactly (see the pinned
-- hashes below). This file changes NOTHING in the database — it is a file-location fix only.
--
-- Behaviour pin, captured 2026-09-16 BEFORE the port (nothing should be applied — verify these
-- are unchanged after this file lands):
--   md5(pg_get_functiondef('dia_resolve_guarantor(text)'))          = 221ec276648df916363b033344d0aa54
--   md5(pg_get_functiondef('dia_normalize_guarantor_text(text)'))   = 633f19ff3e087ea58345e70ecc99f30f
--   md5(pg_get_functiondef('dia_leases_guarantor_resolve_biu()'))   = fbd9bc237eb09cde6a84d0c5b2c6ac85
-- Live state at the same time: `guarantors` 18 rows (1 DaVita parent + 1 Fresenius parent + 14
-- named subsidiaries + 1 `generic_unspecified` sentinel); `dia_guarantor_aliases` 58 rows;
-- `leases.guarantor_id` resolved 628 of 715 leases carrying free-text `guarantor` (87 unresolved,
-- 81 distinct unresolved strings — the review lane; no matching, no minting attempted here).
--
-- Everything below this line is the ORIGINAL ID3d migration content, unmodified.
-- ---------------------------------------------------------------------------------------------

-- ID3d: wire leases.guarantor (free text, 715 of 12,838 leases) -> leases.guarantor_id
-- (existing but unenforced/unpopulated FK column) via a dedicated NEW resolver
-- (dia_guarantor_aliases + dia_resolve_guarantor), never by joining against
-- dia_operator_aliases (ID2a). Measured live: dia_operator_aliases resolves DaVita-subsidiary
-- spellings (Total Renal Care Inc., DVA Healthcare Renal Care Inc., DVA Renal Healthcare Inc.,
-- Renal Treatment Centers-*) as pure aliases of operator_id=4 "DaVita" -- correct for "who
-- operationally runs this clinic", wrong for "who legally signed the guaranty". Reusing it here
-- would have silently erased the legal-entity distinction on the credit-critical guarantor
-- column. This migration builds a parallel resolver instead and keeps every subsidiary on its
-- own `guarantors` row with `parent_company_id` pointing at its corporate parent.
--
-- Reversal runbook: `alter table leases drop constraint fk_leases_guarantor_id;`
-- `drop trigger trg_dia_leases_guarantor_resolve_biu on leases;`
-- `drop function dia_leases_guarantor_resolve_biu();`
-- `update leases set guarantor_id = null where guarantor_id is not null;` (restores pre-migration
-- state except for lease_id 14338, which already carried guarantor_id=1 before this migration)
-- `drop view v_dia_guarantor_backfill_parity;`
-- `drop function dia_resolve_guarantor(text);`
-- `drop function dia_normalize_guarantor_text(text);`
-- `drop table dia_guarantor_aliases;`
-- (guarantors rows seeded here are left in place — harmless with nothing pointing at them)

-- 1. Flesh out the existing single guarantors row (id=1, "DaVita") into a proper
--    corporate-parent entity.
update guarantors
set guarantor_name = 'DaVita, Inc.',
    normalized_name = 'davita inc',
    guarantor_type = 'corporate_parent'
where guarantor_id = 1;

-- 2. Seed additional guarantor entities: one more corporate parent (Fresenius Medical
--    Care Holdings, Inc.), named subsidiaries as their OWN rows with parent_company_id
--    (never merged into the parent), and one generic-placeholder sentinel.
insert into guarantors (name, guarantor_name, normalized_name, guarantor_type, parent_company_id, notes)
values
  ('Fresenius Medical Care Holdings, Inc.', 'Fresenius Medical Care Holdings, Inc.', 'fresenius medical care holdings inc', 'corporate_parent', null, 'ID3d seed')
on conflict do nothing;

insert into guarantors (name, guarantor_name, normalized_name, guarantor_type, notes)
values
  ('Total Renal Care, Inc.', 'Total Renal Care, Inc.', 'total renal care inc', 'subsidiary', 'ID3d seed; DaVita legal subsidiary, distinct signer from parent'),
  ('DVA Healthcare Renal Care, Inc.', 'DVA Healthcare Renal Care, Inc.', 'dva healthcare renal care inc', 'subsidiary', 'ID3d seed; DaVita legal subsidiary, distinct signer from parent'),
  ('DVA Renal Healthcare, Inc.', 'DVA Renal Healthcare, Inc.', 'dva renal healthcare inc', 'subsidiary', 'ID3d seed; DaVita legal subsidiary, distinct signer from parent'),
  ('Renal Treatment Centers-Illinois, Inc.', 'Renal Treatment Centers-Illinois, Inc.', 'renal treatment centers illinois inc', 'subsidiary', 'ID3d seed; DaVita-family legacy RTC subsidiary'),
  ('Renal Treatment Centers-Mid-Atlantic, Inc.', 'Renal Treatment Centers-Mid-Atlantic, Inc.', 'renal treatment centers mid atlantic inc', 'subsidiary', 'ID3d seed; DaVita-family legacy RTC subsidiary'),
  ('Renal Treatment Centers of Florida', 'Renal Treatment Centers of Florida', 'renal treatment centers of florida', 'subsidiary', 'ID3d seed; DaVita-family legacy RTC subsidiary'),
  ('National Medical Care, Inc.', 'National Medical Care, Inc.', 'national medical care inc', 'subsidiary', 'ID3d seed; Fresenius-family legacy entity, distinct signer from parent'),
  ('RCG Mississippi Inc', 'RCG Mississippi Inc', 'rcg mississippi inc', 'subsidiary', 'ID3d seed; Fresenius-family (Renal Care Group) subsidiary'),
  ('Bio-Medical Applications of Florida, Inc.', 'Bio-Medical Applications of Florida, Inc.', 'bio medical applications of florida inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications of Louisiana, LLC', 'Bio-Medical Applications of Louisiana, LLC', 'bio medical applications of louisiana llc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications of Georgia, Inc.', 'Bio-Medical Applications of Georgia, Inc.', 'bio medical applications of georgia inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications of West Virginia, Inc.', 'Bio-Medical Applications of West Virginia, Inc.', 'bio medical applications of west virginia inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications of Missouri, Inc.', 'Bio-Medical Applications of Missouri, Inc.', 'bio medical applications of missouri inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications of South Carolina, Inc.', 'Bio-Medical Applications of South Carolina, Inc.', 'bio medical applications of south carolina inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) state operating subsidiary'),
  ('Bio-Medical Applications Management Company, Inc.', 'Bio-Medical Applications Management Company, Inc.', 'bio medical applications management company inc', 'subsidiary', 'ID3d seed; Fresenius-family (BMA) management entity')
on conflict do nothing;

-- Generic-placeholder sentinel: means "a corporate guaranty exists, entity unspecified" —
-- never a resolved company identity. Kept structurally distinct from both resolved and review.
insert into guarantors (name, guarantor_name, normalized_name, guarantor_type, notes)
values ('Unspecified Corporate Guarantor', 'Unspecified Corporate Guarantor', 'unspecified corporate guarantor', 'generic_unspecified',
        'ID3d sentinel: source text names a corporate guaranty with no specific legal entity (e.g. "Corporate", "Corporate Guarantee"). Never auto-matched to any company.')
on conflict do nothing;

-- Wire parent_company_id for the DaVita-family subsidiaries -> the DaVita parent row.
update guarantors s
set parent_company_id = p.guarantor_id
from guarantors p
where p.normalized_name = 'davita inc'
  and s.normalized_name in (
    'total renal care inc', 'dva healthcare renal care inc', 'dva renal healthcare inc',
    'renal treatment centers illinois inc', 'renal treatment centers mid atlantic inc',
    'renal treatment centers of florida'
  )
  and s.parent_company_id is distinct from p.guarantor_id;

-- Wire parent_company_id for the Fresenius-family subsidiaries -> the Fresenius parent row.
update guarantors s
set parent_company_id = p.guarantor_id
from guarantors p
where p.normalized_name = 'fresenius medical care holdings inc'
  and s.normalized_name in (
    'national medical care inc', 'rcg mississippi inc',
    'bio medical applications of florida inc', 'bio medical applications of louisiana llc',
    'bio medical applications of georgia inc', 'bio medical applications of west virginia inc',
    'bio medical applications of missouri inc', 'bio medical applications of south carolina inc',
    'bio medical applications management company inc'
  )
  and s.parent_company_id is distinct from p.guarantor_id;

-- 3. Dedicated alias table for guarantors — parallel to dia_operator_aliases, never a join
--    against it (see the header note).
create table if not exists dia_guarantor_aliases (
  alias_id bigserial primary key,
  raw_text text not null,
  normalized_text text not null,
  guarantor_id integer not null references guarantors(guarantor_id),
  source text not null default 'id3d_seed',
  created_at timestamptz not null default now(),
  unique (normalized_text)
);

comment on table dia_guarantor_aliases is
  'ID3d: raw leases.guarantor spelling -> guarantors.guarantor_id. A NEW alias table, '
  'deliberately not dia_operator_aliases (which correctly treats DaVita subsidiaries as '
  'interchangeable with the parent for operator purposes, and would be wrong for the '
  'legal-signer identity this table resolves).';

create or replace function dia_normalize_guarantor_text(p text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p, ''))), '[.,]', '', 'g'),
      '\s+', ' ', 'g'
    ),
    ''
  )
$$;

-- Fail-closed resolver: exact alias match only, never mints, never guesses.
create or replace function dia_resolve_guarantor(p_raw text)
returns integer
language sql
stable
as $$
  select a.guarantor_id
  from dia_guarantor_aliases a
  where a.normalized_text = dia_normalize_guarantor_text(p_raw)
  limit 1
$$;

comment on function dia_resolve_guarantor(text) is
  'ID3d: resolves free-text leases.guarantor to guarantors.guarantor_id via exact-normalized '
  'alias match only. Returns NULL (never mints, never guesses) when no alias exists — the row '
  'stays in the unresolved/review population.';

-- 4. Seed exact-spelling aliases for the auto-resolvable population.
with target(guarantor_norm, raw_text) as (
  values
  -- DaVita, Inc. (parent) — spelling variants only, never a subsidiary
  ('davita inc','DaVita, Inc.'),('davita inc','DaVita Inc.'),('davita inc','DaVita'),
  ('davita inc','DAVITA, INC.'),('davita inc','Davita Inc.'),('davita inc','DaVita Incorporated'),
  ('davita inc','DaVita, Inc'),('davita inc','DaVita Inc'),('davita inc','Davita, Inc.'),
  ('davita inc','Davita, Inc'),('davita inc','DAVITA INC.'),('davita inc','DAVITA INC'),
  ('davita inc','DAVITA, INC'),('davita inc','DaVita, Incorporated'),('davita inc','DaVita Dialysis'),
  ('davita inc','DaVita Kidney Care'),('davita inc','DAVITA CORPORATE'),('davita inc','DaVita Healthcare'),
  ('davita inc','DaVita Inc. (formally DaVita HealthCare Partners Inc.)'),('davita inc','Davita (NYSE DVA)'),
  ('davita inc','DaVita Healthcare Partners, Inc.'),('davita inc','DaVita Healthcare Partners Inc.'),
  ('davita inc','DaVita Healthcare Partners, Inc'),('davita inc','DaVita HealthCare Partners Inc.'),
  ('davita inc','Davita Healthcare Partners, Inc.'),('davita inc','DaVita Health Care Partners, Inc.'),
  ('davita inc','DaVita HealthCare Partners Inc'),('davita inc','DaVita HealthCare Partners, Inc.'),
  ('davita inc','DaVita HealthCare Partners INC'),('davita inc','DaVita Healthcare Partners, Incorporated'),
  -- Fresenius Medical Care Holdings, Inc. (parent) — spelling variants only
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings, Inc.'),
  ('fresenius medical care holdings inc','Fresenius Medical Care'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings, Inc'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings Inc.'),
  ('fresenius medical care holdings inc','FMCH, Inc.'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings, INC.'),
  ('fresenius medical care holdings inc','Fresenius Medical Care North America'),
  ('fresenius medical care holdings inc','Fresenius Medical Care AG & Co. KGaA'),
  ('fresenius medical care holdings inc','Fresenius'),
  ('fresenius medical care holdings inc','Fresenius Kidney Care'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings (Corporate)'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings, Inc. (Corporate)'),
  ('fresenius medical care holdings inc','Fresenius Medical Care North America Holdings Limited Partnership'),
  ('fresenius medical care holdings inc','Fresenius Medical Holdings, Inc.'),
  ('fresenius medical care holdings inc','Fresenius Medical Holdings, INC.'),
  ('fresenius medical care holdings inc','Fresenius (NASDAQ: FMS)'),
  ('fresenius medical care holdings inc','Fresenius SE & Co. KGaA'),
  ('fresenius medical care holdings inc','NASDAQ: FMS'),
  ('fresenius medical care holdings inc','Fresenius Medical Care Holdings, Inc., a New York Corporation'),
  -- Total Renal Care, Inc. (DaVita subsidiary — distinct legal signer, own row)
  ('total renal care inc','Total Renal Care, Inc.'),('total renal care inc','Total Renal Care, Inc'),
  ('total renal care inc','Total Renal Care Inc.'),('total renal care inc','Total Renal Care'),
  ('total renal care inc','Total Renal Care, INC'),('total renal care inc','Total Renal Care Limited Partnership'),
  -- DVA Healthcare Renal Care, Inc. (DaVita subsidiary)
  ('dva healthcare renal care inc','DVA Healthcare Renal Care, Inc.'),
  ('dva healthcare renal care inc','DVA Healthcare Renal Care, Inc'),
  ('dva healthcare renal care inc','DVA Healthcare Renal Care, Incorporated'),
  -- DVA Renal Healthcare, Inc. (DaVita subsidiary)
  ('dva renal healthcare inc','DVA Renal Healthcare, Inc.'),
  ('dva renal healthcare inc','DVA Renal Healthcare, Incorporated'),
  -- Renal Treatment Centers family (DaVita-family legacy subsidiaries, no spelling variants seen)
  ('renal treatment centers illinois inc','Renal Treatment Centers-Illinois, Inc.'),
  ('renal treatment centers mid atlantic inc','Renal Treatment Centers-Mid-Atlantic, Inc.'),
  ('renal treatment centers of florida','Renal Treatment Centers of Florida'),
  -- National Medical Care, Inc. (Fresenius-family subsidiary)
  ('national medical care inc','National Medical Care, Inc.'),
  -- RCG Mississippi Inc (Fresenius-family / Renal Care Group subsidiary)
  ('rcg mississippi inc','RCG Mississippi Inc'),('rcg mississippi inc','RCG Mississippi, Inc.'),
  -- Bio-Medical Applications state subsidiaries (Fresenius-family, each its own legal signer)
  ('bio medical applications of florida inc','Bio-Medical Applications of Florida, Inc.'),
  ('bio medical applications of louisiana llc','Bio-Medical Applications of Louisiana, LLC'),
  ('bio medical applications of georgia inc','Bio-Medical Applications of Georgia, Inc.'),
  ('bio medical applications of georgia inc','Bio-Medical Applications of Georgia, Inc'),
  ('bio medical applications of west virginia inc','Bio-Medical Applications of West Virginia, Inc.'),
  ('bio medical applications of west virginia inc','Bio-Medical Applications of West Virginia, Incorporated'),
  ('bio medical applications of missouri inc','Bio-Medical Applications of Missouri, Inc.'),
  ('bio medical applications of south carolina inc','Bio-Medical Applications of South Carolina, Inc.'),
  ('bio medical applications management company inc','Bio-Medical Applications Management Company, Inc.'),
  -- Generic-placeholder sentinel — "a corporate guaranty exists, entity unspecified".
  -- Never a resolved company identity; never auto-matched to any named party.
  ('unspecified corporate guarantor','Corporate'),
  ('unspecified corporate guarantor','Corporate Guarantee'),
  ('unspecified corporate guarantor','corporate'),
  ('unspecified corporate guarantor','Corporate Signature'),
  ('unspecified corporate guarantor','Corporate Guarantee, Credit Rated'),
  ('unspecified corporate guarantor','corporate guaranteed'),
  ('unspecified corporate guarantor','Parent company guarantee'),
  ('unspecified corporate guarantor','Subsidiary of a Corporation'),
  ('unspecified corporate guarantor','Credit Rated, Corporate Guarantee'),
  ('unspecified corporate guarantor','Corporate Entity (S&P:BBB)'),
  ('unspecified corporate guarantor','Corporate (S&P: BBB)')
)
insert into dia_guarantor_aliases (raw_text, normalized_text, guarantor_id, source)
select t.raw_text, dia_normalize_guarantor_text(t.raw_text), g.guarantor_id, 'id3d_seed'
from target t
join guarantors g on g.normalized_name = t.guarantor_norm
on conflict (normalized_text) do nothing;

-- 5. Backfill: fill-blanks only, resolver-driven. Never overwrites an already-set guarantor_id.
update leases
set guarantor_id = dia_resolve_guarantor(guarantor)
where guarantor_id is null
  and guarantor is not null and guarantor <> ''
  and dia_resolve_guarantor(guarantor) is not null;

-- 6. FK constraint — leases.guarantor_id existed with no referential integrity at all.
alter table leases
  add constraint fk_leases_guarantor_id foreign key (guarantor_id) references guarantors(guarantor_id);

-- 7. Hard write guard: on insert/update of guarantor(_id), auto-resolve into guarantor_id
--    when blank (fill-blanks only — never overwrites a value someone already set, manual
--    or otherwise). Never mints a new guarantors row from a lease write.
create or replace function dia_leases_guarantor_resolve_biu()
returns trigger
language plpgsql
as $$
begin
  if new.guarantor_id is null
     and new.guarantor is not null and new.guarantor <> '' then
    new.guarantor_id := dia_resolve_guarantor(new.guarantor);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dia_leases_guarantor_resolve_biu on leases;
create trigger trg_dia_leases_guarantor_resolve_biu
before insert or update of guarantor, guarantor_id on leases
for each row
execute function dia_leases_guarantor_resolve_biu();

-- 8. Parity view: lease counts per guarantor, for review/audit.
create or replace view v_dia_guarantor_backfill_parity as
select
  g.guarantor_id, g.guarantor_name, g.guarantor_type, g.parent_company_id,
  count(l.lease_id) as lease_count
from guarantors g
left join leases l on l.guarantor_id = g.guarantor_id
group by g.guarantor_id, g.guarantor_name, g.guarantor_type, g.parent_company_id
order by lease_count desc;
