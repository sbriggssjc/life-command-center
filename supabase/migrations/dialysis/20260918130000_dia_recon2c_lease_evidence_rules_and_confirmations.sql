-- RECON2-c — Dialysis_DB (zqzrriwuavgrquhisnoa). NOT YET APPLIED LIVE — this
-- session has no Supabase MCP / live DB access (sandboxed CC session). Every
-- statement below is written against the schema as documented in the RECON2
-- / RECON2-b migrations and code paths already committed to this repo
-- (api/_handlers/sidebar-pipeline.js for leases.source_confidence/data_source/
-- parent_lease_id; supabase/migrations/dialysis/20260911200100_dia_id2a_*
-- for dia_resolve_operator). It has NOT been run against the live database
-- and its dry-run counts below are therefore NOT live measurements — they
-- are read off Scott's own field-check table in
-- docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md, not a
-- fresh query. Apply via Supabase MCP from a session that has it, then
-- re-run the classifier and correct the counts in this header + spec R5 if
-- they differ from what is stated below.
--
-- Read first: docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md
-- (Scott's per-row field checks — the evidence this migration writes),
-- docs/claude-code/prompts/RECON2-c-classifier-evidence-rules-and-confirm-with
-- -successor-for-six-field-checked-leases.md, the RECON2/RECON2-b migrations,
-- spec R5.
--
-- Scott's rule (unchanged): "Let's only allow leases to go inactive once we
-- have confirmation that the lease expired."
--
-- WHAT THIS MIGRATION DOES
--
-- 1. Classifier rules (dia_recon2_classify_expired_leases):
--    (a) never read a medicare_clinics row with dedup_status='demoted_duplicate'
--        as evidence for ANY signal (cms_closure or the "clinic operating"
--        corroboration) — RECON2-b already excluded status='removed'; this
--        excludes a demoted-duplicate row outright, on either property or twin.
--    (b) cms_closure (and its "clinic operating" corroboration) now REQUIRES
--        the clinic's chain_organization to resolve, via dia_resolve_operator,
--        to the SAME operator as the lease's own tenant — a different
--        operator's CCN on the property says nothing about this lease's
--        tenant and must not confirm or refute it.
--    (c) evidence lookup also reads the property's "R1 twins" — other
--        properties sharing the same normalized street-number+street (see
--        dia_recon2_street_twin_key below, built on top of the existing
--        dia_normalize_address primitive — this repo has no prior
--        dia_find_property_twins/R1-twin-detection migration to reuse
--        verbatim; grepped for one and found none, so this is a new,
--        narrowly-scoped extension of the one normalization helper that
--        does exist). If a twin carries an OPERATING clinic (dedup_status
--        not demoted_duplicate) resolving to the SAME tenant, the row
--        proposes expired_unconfirmed with evidence_detail 'operating on
--        twin <property_id>' — NEVER expired_confirmed, even where a
--        termination_record or cms_closure signal would otherwise have
--        fired. Judgment call, stated here rather than hidden: a genuine
--        same-property successor_lease (a newer lease actually recorded on
--        THIS property) is NOT overridden by twin evidence — that is direct
--        same-property evidence, not a signal the twin can contradict.
--    (d) a `conflict` output column is added: true when twin evidence
--        contradicts a termination/cms signal that fired for the SAME
--        property (the Sierra Vista shape — a demoted-duplicate clinic on
--        the lease's own property vs. an operating twin clinic for the same
--        tenant), OR when the lease's own recorded expiration_evidence array
--        already contains both a positive ("active"/"operating"/"current")
--        and a negative ("closed"/"terminat*"/"vacat*"/"relocat*"/"expired"/
--        "removed") observation (dia_recon2_evidence_array_conflicts below).
--
-- 2. expiration_evidence becomes an ARRAY of
--    {source, observed, observed_date, recorded_by} objects, source IN
--    ('costar_lease','operator_locator','google_hours','cms','deed','sale_om').
--    Pre-existing scalar-object rows (written by RECON2/RECON2-b's confirm
--    function) are wrapped verbatim into a single-element array — nothing is
--    discarded or reshaped into the new vocabulary, because we do not know
--    which of the six new source buckets an old free-text evidence_type
--    maps to and guessing would misrepresent it. New appends go through
--    dia_recon2_record_evidence(), which validates the source against the
--    closed vocabulary and recomputes the conflict flag on every append.
--    dia_recon2_confirm_lease_expired() is changed from REPLACING
--    expiration_evidence wholesale to APPENDING its own confirm-evidence
--    object onto the array, so a confirmation never discards prior
--    field-check evidence recorded against the same lease.
--
-- 3. Scott's seven field-check rows (docs/audits/RECON2-b-confirmed-expired-
--    leases-review-2026-09-18.md, "Scott's read — round 34" table) are
--    recorded verbatim via dia_recon2_record_evidence, recorded_by='scott',
--    observed_date='2026-09-18', split by source where one field check names
--    more than one signal (e.g. "CoStar: ... active; DaVita locator:
--    operating" becomes one costar_lease entry + one operator_locator
--    entry) — nothing paraphrased beyond that mechanical split, and no
--    figure or date is invented that Scott did not state.
--
-- 4. Confirmations, all idempotent (guarded on current expiration_state /
--    an already-existing successor row so a migration re-run writes
--    nothing twice), all through dia_recon2_confirm_lease_expired():
--      - lease 23506 (DC)          -> expired_confirmed, no successor needed
--        (a genuine relocation, not a same-DB successor lease).
--      - lease 6912  (Cartersville)-> expired_confirmed, no successor needed
--        (site use changed — no longer a dialysis clinic).
--      - leases 23259 (Goldsboro), 12599 (Orlando), 12678 (Dixon),
--        13058 (Scranton) -> confirm-WITH-successor, one transaction each
--        (insert the successor lease first; only then confirm the old row —
--        if the insert fails, nothing about the old row changes). The
--        successor's tenant is copied from the old row (never guessed); its
--        lease_expiration is 2028-06-30 for Orlando (the CoStar date Scott
--        stated) and NULL/expiration_unknown for Goldsboro/Dixon/Scranton
--        (Scott named no CoStar date for those three — SIDEBAR-LEASE1: the
--        sidebar sends touched the TWIN rows and wrote no expiration on any
--        of the four). lease_start is left NULL — unknown, not guessed.
--        data_source='costar_field_check', source_confidence='documented',
--        parent_lease_id -> the old lease_id.
--      - lease 23273 (Sierra Vista) -> NO WRITE to is_active/expiration_state.
--        Both field-check evidence rows are recorded, the conflict flag is
--        set, and it stays expired_unconfirmed. This is a property-identity
--        defect (a real DaVita clinic minted on a twin property, 35849,
--        while the demoted-duplicate Fresenius row sits on the lease's own
--        property, 22471) plus the classifier gap this migration closes —
--        not a lease expiration, and not something this migration attempts
--        to merge/reconcile (that is a separate RECON1-class property-twin
--        fold, filed as backlog work, not run here).
--
-- Nothing in this migration is a "fleet write" — it touches exactly the
-- seven leases named above, by lease_id, guarded and idempotent. The
-- classifier and enqueue-function changes are read-only function
-- replacements; no other row's is_active/expiration_state is touched.
--
-- REVERSAL RUNBOOK:
--   -- 4a. Confirmations (23506, 6912, 23259, 12599, 12678, 13058): each
--   --     confirm-path write is ledgered in dia_recon1_run_log
--   --     (step='confirm_expiration', batch_tag like 'recon2_confirm_%'),
--   --     prior_value captured. Reverse with:
--   --       update leases set expiration_state = (r.prior_value->>'expiration_state'),
--   --         is_active = (r.prior_value->>'is_active')::boolean
--   --       from dia_recon1_run_log r
--   --       where r.step='confirm_expiration' and r.target_id = '<lease_id>'
--   --       and leases.lease_id = (r.target_id)::int;
--   --     (expiration_evidence is NOT restored to its pre-confirm value by
--   --     this — the confirm-evidence entry stays appended; to remove just
--   --     that entry, filter it out of the array by recorded_at.)
--   -- 4b. Successor leases (23259/12599/12678/13058's new rows): find via
--   --       select lease_id from leases where parent_lease_id in (23259,12599,12678,13058)
--   --         and data_source = 'costar_field_check';
--   --     then `delete from leases where lease_id = <new_id>` (a fresh insert
--   --     with no other row referencing it yet — safe to hard-delete, unlike
--   --     a merged property).
--   -- 3. Field-check evidence: each dia_recon2_record_evidence call also logs
--   --     to dia_recon1_run_log (step='record_evidence', batch_tag like
--   --     'recon2c_evidence_%'); to strip a specific entry, remove it from
--   --     leases.expiration_evidence by (source, recorded_by, observed_date)
--   --     and recompute expiration_evidence_conflict via
--   --     dia_recon2_evidence_array_conflicts.
--   -- 1-2. Classifier/schema: re-apply the pre-fix CREATE OR REPLACE FUNCTION
--   --     bodies from 20260918120000_dia_recon2b_lease_expiration_evidence_fix.sql
--   --     and 20260917220000_dia_recon2_lease_expiration_confirmation_model.sql;
--   --     drop dia_recon2_street_twin_key, dia_recon2_evidence_array_conflicts,
--   --     dia_recon2_record_evidence; drop column
--   --     leases.expiration_evidence_conflict.

-- ── 0. New evidence-array column + conflict flag. ───────────────────────────
alter table leases add column if not exists expiration_evidence_conflict boolean not null default false;

comment on column leases.expiration_evidence_conflict is
  'RECON2-c: true when the lease''s recorded expiration_evidence array (or the '
  'classifier''s own twin-vs-same-property-signal check) carries two '
  'disagreeing sources. Never auto-confirmed while this is true; see '
  'dia_recon2_evidence_array_conflicts().';

-- Wrap any pre-existing scalar-object expiration_evidence rows (written by
-- RECON2/RECON2-b's confirm function, before this migration) into a
-- single-element array. Nothing is reshaped into the new source vocabulary —
-- the old object is kept byte-identical inside the array.
update leases
   set expiration_evidence = jsonb_build_array(expiration_evidence)
 where expiration_evidence is not null
   and jsonb_typeof(expiration_evidence) is distinct from 'array';

comment on column leases.expiration_evidence is
  'RECON2/RECON2-b/RECON2-c: an ARRAY of evidence objects. Two shapes '
  'coexist in the array by design (never force-fit one into the other): '
  '(1) confirm-path entries from dia_recon2_confirm_lease_expired() — '
  '{evidence_type, source, reference, observed_date, recorded_by, '
  'recorded_at, note}; (2) field-check entries from '
  'dia_recon2_record_evidence() — {source, observed, observed_date, '
  'recorded_by, recorded_at}, source IN (costar_lease, operator_locator, '
  'google_hours, cms, deed, sale_om). Pre-RECON2-c rows were a single scalar '
  'object; wrapped into a one-element array by this migration, verbatim. '
  'Never fabricated — null/empty until real evidence is recorded.';

-- ── 1. Evidence-array primitives. ────────────────────────────────────────────
create or replace function dia_recon2_evidence_array_conflicts(p_evidence jsonb)
returns boolean
language sql
stable
as $$
  with arr as (
    select case
             when p_evidence is null then '[]'::jsonb
             when jsonb_typeof(p_evidence) = 'array' then p_evidence
             else jsonb_build_array(p_evidence)
           end as a
  )
  select
    exists (
      select 1 from arr, jsonb_array_elements(arr.a) e
      where (e->>'observed') ~* '\y(active|operating|current|open)\y'
    )
    and
    exists (
      select 1 from arr, jsonb_array_elements(arr.a) e
      where (e->>'observed') ~* '\y(closed|terminat|vacat|relocat|expired|removed)\y'
    );
$$;

comment on function dia_recon2_evidence_array_conflicts(jsonb) is
  'RECON2-c: true when an expiration_evidence array holds both a positive '
  'observation (active/operating/current/open) and a negative one '
  '(closed/terminat*/vacat*/relocat*/expired/removed) in the .observed text '
  'of two different entries. A narrow text heuristic over the NEW '
  '{source,observed,...} entries only (it reads .observed, which the OLD '
  'confirm-path object shape does not carry, so pre-RECON2-c scalar-wrapped '
  'entries never contribute a match either way — inert on them, not wrong '
  'about them).';

create or replace function dia_recon2_record_evidence(
  p_lease_id      integer,
  p_source        text,   -- costar_lease | operator_locator | google_hours | cms | deed | sale_om
  p_observed      text,
  p_observed_date date,
  p_recorded_by   text default 'recon2_manual'
)
returns jsonb
language plpgsql
as $$
declare
  v_existing jsonb;
  v_array    jsonb;
  v_entry    jsonb;
  v_conflict boolean;
begin
  if p_source not in ('costar_lease','operator_locator','google_hours','cms','deed','sale_om') then
    raise exception 'dia_recon2_record_evidence: invalid source % — must be one of costar_lease|operator_locator|google_hours|cms|deed|sale_om', p_source;
  end if;
  if p_observed is null or p_observed_date is null or p_recorded_by is null then
    raise exception 'dia_recon2_record_evidence: p_observed, p_observed_date and p_recorded_by are all required — no evidence without a stated observation';
  end if;
  if not exists (select 1 from leases where lease_id = p_lease_id) then
    raise exception 'dia_recon2_record_evidence: lease_id % not found', p_lease_id;
  end if;

  select expiration_evidence into v_existing from leases where lease_id = p_lease_id;
  v_array := case
               when v_existing is null then '[]'::jsonb
               when jsonb_typeof(v_existing) = 'array' then v_existing
               else jsonb_build_array(v_existing)
             end;

  v_entry := jsonb_build_object(
    'source', p_source,
    'observed', p_observed,
    'observed_date', p_observed_date,
    'recorded_by', p_recorded_by,
    'recorded_at', now()
  );
  v_array := v_array || jsonb_build_array(v_entry);
  v_conflict := dia_recon2_evidence_array_conflicts(v_array);

  update leases
     set expiration_evidence = v_array,
         expiration_evidence_conflict = v_conflict
   where lease_id = p_lease_id;

  insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, new_value, note, dry_run)
  values (
    'recon2c_evidence_' || to_char(now(), 'YYYYMMDD'), 'record_evidence', 'leases', p_lease_id::text,
    'append_evidence', v_entry, 'source=' || p_source || ' conflict=' || v_conflict::text, false
  );

  return v_array;
end;
$$;

comment on function dia_recon2_record_evidence(integer, text, text, date, text) is
  'RECON2-c: append ONE {source,observed,observed_date,recorded_by} entry to '
  'leases.expiration_evidence (creating/wrapping into an array as needed), '
  'recompute expiration_evidence_conflict, and ledger the write to '
  'dia_recon1_run_log (step=record_evidence). Never overwrites/discards a '
  'prior entry. source is a closed vocabulary (raises otherwise).';

-- ── 2. R1-twin lookup, built on the existing dia_normalize_address primitive.
--       No dia_find_property_twins / dedicated twin-detection migration
--       exists in this repo (grepped for one before writing this — none
--       found), so this narrowly extends the one normalization helper that
--       does: strip a trailing suite/unit/building/floor token, strip
--       standalone directional tokens (N/S/E/W/NE/NW/SE/SW and their long
--       forms), collapse whitespace. Unverified against live data (no
--       Supabase access this session) — re-check the Sierra Vista pair
--       (22471 / 35849) once this runs, and retune if the real address
--       strings do not collapse to the same key (e.g. a trailing highway
--       "Byp"/"Bypass" suffix is NOT stripped here and would defeat the
--       match; if so, add it to the same regexp rather than a second
--       normalizer). ─────────────────────────────────────────────────────
create or replace function dia_recon2_street_twin_key(addr text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            dia_normalize_address(addr),
            '\s+(ste|suite|unit|bldg|building|fl|floor|#)\.?\s*\S*\s*$', '', 'i'
          ),
          '\y(north|south|east|west|ne|nw|se|sw|n|s|e|w)\y', '', 'gi'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function dia_recon2_street_twin_key(text) is
  'RECON2-c: dia_normalize_address(addr) further stripped of a trailing '
  'suite/unit/bldg/floor token and standalone directional words, so two '
  'properties at the same street number+street but different suite/range '
  '(an "R1 twin" — same building, split into multiple property rows) share '
  'a key. NOT identity — used only for the twin-evidence lookup in '
  'dia_recon2_classify_expired_leases, never for a write.';

-- ── 3. Classifier — rules (a)-(d). Still DRY-RUN / READ-ONLY: writes nothing
--       to leases. Adds `conflict` to the output. ───────────────────────────
create or replace function dia_recon2_classify_expired_leases(p_limit int default null)
returns table (
  lease_id            integer,
  property_id         integer,
  tenant              text,
  lease_expiration    date,
  annual_rent         numeric,
  proposed_state      text,
  evidence_type        text,
  evidence_detail      text,
  conflict             boolean
)
language sql
stable
as $$
  with candidates as (
    select l.lease_id, l.property_id, l.tenant, l.lease_expiration, l.annual_rent, l.status,
           l.expiration_evidence
    from leases l
    where l.is_active = true
      and l.lease_expiration is not null
      and l.lease_expiration < current_date
  ),
  successor as (
    select c.lease_id, min(s.lease_id) as successor_lease_id
    from candidates c
    join leases s
      on s.property_id = c.property_id
     and s.lease_id <> c.lease_id
     and s.lease_start is not null
     and s.lease_start >= c.lease_expiration
    group by c.lease_id
  ),
  -- (a) demoted_duplicate clinic rows are never joined as evidence, on the
  --     lease's own property OR its twins (both clinic_rows and twin_clinics
  --     below carry the same dedup_status filter).
  -- (b) cms_closure requires the clinic's operator to resolve to the SAME
  --     operator as the lease's own tenant.
  clinic_rows as (
    select c.lease_id, mc.status as mc_status, mc.is_operating,
           mc_op.operator_id as mc_operator_id, tenant_op.operator_id as tenant_operator_id
    from candidates c
    join medicare_clinics mc
      on mc.property_id = c.property_id
     and coalesce(mc.dedup_status, '') is distinct from 'demoted_duplicate'
    cross join lateral dia_resolve_operator(mc.chain_organization) mc_op
    cross join lateral dia_resolve_operator(c.tenant) tenant_op
  ),
  cms_eval as (
    select cr.lease_id,
           bool_and(
             coalesce(cr.is_operating, false) is not true
             and cr.mc_status in ('closed', 'relocated')
             and cr.mc_operator_id is not null
             and cr.mc_operator_id = cr.tenant_operator_id
           ) as all_confirmed_closed,
           bool_or(
             coalesce(cr.is_operating, true) is true
             and cr.mc_operator_id is not null
             and cr.mc_operator_id = cr.tenant_operator_id
           ) as any_operating_matched
    from clinic_rows cr
    group by cr.lease_id
  ),
  -- did the property carry a demoted-duplicate clinic row at all? (used only
  -- for the conflict flag — a demoted-duplicate row is real signal that got
  -- correctly suppressed by rule (a), and its presence alongside twin
  -- evidence is exactly the Sierra Vista shape: a real disagreement, not a
  -- gap.)
  had_demoted_duplicate as (
    select c.lease_id, true as flag
    from candidates c
    join medicare_clinics mc
      on mc.property_id = c.property_id
     and mc.dedup_status = 'demoted_duplicate'
    group by c.lease_id
  ),
  -- (c) R1-twin evidence: another property, same normalized street-number+
  --     street, carrying an OPERATING (non-demoted-duplicate) clinic that
  --     resolves to the SAME operator as this lease's tenant.
  twins as (
    select c.lease_id, c.property_id as base_property_id, p2.property_id as twin_property_id
    from candidates c
    join properties p on p.property_id = c.property_id
    join properties p2
      on p2.state = p.state
     and p2.property_id <> p.property_id
     and dia_recon2_street_twin_key(p2.address) is not null
     and dia_recon2_street_twin_key(p2.address) = dia_recon2_street_twin_key(p.address)
  ),
  twin_operating as (
    select t.lease_id, min(t.twin_property_id) as twin_property_id
    from twins t
    join candidates c on c.lease_id = t.lease_id
    join medicare_clinics mc
      on mc.property_id = t.twin_property_id
     and coalesce(mc.dedup_status, '') is distinct from 'demoted_duplicate'
     and coalesce(mc.is_operating, false) is true
    cross join lateral dia_resolve_operator(mc.chain_organization) mc_op
    cross join lateral dia_resolve_operator(c.tenant) tenant_op
    where mc_op.operator_id is not null
      and mc_op.operator_id = tenant_op.operator_id
    group by t.lease_id
  )
  select
    c.lease_id, c.property_id, c.tenant, c.lease_expiration, c.annual_rent,
    case
      when suc.successor_lease_id is not null then 'expired_confirmed'
      when twn.twin_property_id is not null then 'expired_unconfirmed'
      when c.status ilike '%terminat%' then 'expired_confirmed'
      when cm.all_confirmed_closed then 'expired_confirmed'
      else 'expired_unconfirmed'
    end as proposed_state,
    case
      when suc.successor_lease_id is not null then 'successor_lease'
      when twn.twin_property_id is not null then 'twin_operating'
      when c.status ilike '%terminat%' then 'termination_record'
      when cm.all_confirmed_closed then 'cms_closure'
      when cm.any_operating_matched then null
      else null
    end as evidence_type,
    case
      when suc.successor_lease_id is not null then 'successor lease_id=' || suc.successor_lease_id
      when twn.twin_property_id is not null then 'operating on twin ' || twn.twin_property_id
      when c.status ilike '%terminat%' then 'status=' || c.status
      when cm.all_confirmed_closed then 'medicare_clinics all rows closed/relocated (operator-matched), none operating'
      when cm.any_operating_matched then 'clinic operating (CMS, operator-matched) — no expiration evidence; holdover or renewal undetermined'
      else null
    end as evidence_detail,
    (
      (
        twn.twin_property_id is not null
        and (
          coalesce(dd.flag, false)
          or c.status ilike '%terminat%'
          or coalesce(cm.all_confirmed_closed, false)
        )
      )
      or coalesce(dia_recon2_evidence_array_conflicts(c.expiration_evidence), false)
    ) as conflict
  from candidates c
  left join successor suc on suc.lease_id = c.lease_id
  left join cms_eval cm on cm.lease_id = c.lease_id
  left join had_demoted_duplicate dd on dd.lease_id = c.lease_id
  left join twin_operating twn on twn.lease_id = c.lease_id
  order by coalesce(c.annual_rent, 0) desc, c.lease_id
  limit p_limit;
$$;

comment on function dia_recon2_classify_expired_leases(int) is
  'RECON2-c: DRY-RUN classifier only — reads leases/medicare_clinics/properties '
  'and PROPOSES expiration_state + evidence + a conflict flag per row. Writes '
  'NOTHING. (a) never treats a demoted_duplicate medicare_clinics row as '
  'evidence, on the lease''s own property or a twin. (b) cms_closure requires '
  'the clinic''s chain_organization to resolve (dia_resolve_operator) to the '
  'SAME operator as the lease''s own tenant. (c) also checks the property''s '
  'R1 twins (dia_recon2_street_twin_key) — an operating, operator-matched '
  'clinic on a twin proposes expired_unconfirmed with evidence_detail ''operating '
  'on twin <id>'', never expired_confirmed, overriding a would-be termination/'
  'cms_closure signal on THIS property (a genuine same-property successor_lease '
  'is not overridden — that is direct same-property evidence). (d) conflict=true '
  'when twin evidence contradicts a same-property termination/cms signal (the '
  'Sierra Vista shape), or when the lease''s own recorded expiration_evidence '
  'array already holds a positive and a negative observation. Supersedes '
  'RECON2-b (20260918120000).';

-- ── 4. Confirm function: APPEND evidence to the array, never replace. ───────
create or replace function dia_recon2_confirm_lease_expired(
  p_lease_id       integer,
  p_new_state      text,      -- 'expired_confirmed' | 'holdover_confirmed' | 'renewed_confirmed'
  p_evidence_type  text,
  p_source         text,
  p_reference      text default null,
  p_note           text default null,
  p_recorded_by    text default 'recon2_manual'
)
returns table (lease_id integer, expiration_state text, is_active boolean)
language plpgsql
as $$
declare
  v_prior      jsonb;
  v_new_active boolean;
  v_existing   jsonb;
  v_array      jsonb;
  v_entry      jsonb;
begin
  if p_new_state not in ('expired_confirmed', 'holdover_confirmed', 'renewed_confirmed') then
    raise exception 'dia_recon2_confirm_lease_expired: p_new_state must be expired_confirmed, holdover_confirmed or renewed_confirmed, got %', p_new_state;
  end if;
  if p_evidence_type is null or p_source is null then
    raise exception 'dia_recon2_confirm_lease_expired: p_evidence_type and p_source are required — no confirmation without stated evidence';
  end if;

  select to_jsonb(l) into v_prior from leases l where l.lease_id = p_lease_id;
  if v_prior is null then
    raise exception 'dia_recon2_confirm_lease_expired: lease_id % not found', p_lease_id;
  end if;

  v_new_active := (p_new_state <> 'expired_confirmed');

  select expiration_evidence into v_existing from leases where lease_id = p_lease_id;
  v_array := case
               when v_existing is null then '[]'::jsonb
               when jsonb_typeof(v_existing) = 'array' then v_existing
               else jsonb_build_array(v_existing)
             end;
  v_entry := jsonb_build_object(
    'evidence_type', p_evidence_type,
    'source', p_source,
    'reference', p_reference,
    'observed_date', current_date,
    'recorded_by', p_recorded_by,
    'recorded_at', now(),
    'note', p_note
  );
  v_array := v_array || jsonb_build_array(v_entry);

  update leases l
     set expiration_state = p_new_state,
         expiration_state_at = now(),
         expiration_evidence = v_array,
         expiration_evidence_conflict = dia_recon2_evidence_array_conflicts(v_array),
         is_active = v_new_active
   where l.lease_id = p_lease_id;

  insert into dia_recon1_run_log(batch_tag, step, target_table, target_id, action, prior_value, new_value, note, dry_run)
  values (
    'recon2_confirm_' || to_char(now(), 'YYYYMMDD'), 'confirm_expiration', 'leases', p_lease_id::text,
    p_new_state, v_prior,
    jsonb_build_object('expiration_state', p_new_state, 'is_active', v_new_active,
                        'evidence_type', p_evidence_type, 'source', p_source, 'reference', p_reference),
    p_note, false
  );

  return query select l.lease_id, l.expiration_state, l.is_active from leases l where l.lease_id = p_lease_id;
end;
$$;

comment on function dia_recon2_confirm_lease_expired(integer, text, text, text, text, text, text) is
  'RECON2-c: as RECON2/RECON2-b, but APPENDS its evidence object onto '
  'leases.expiration_evidence (an array since RECON2-c) rather than '
  'replacing the column, so a confirmation never discards field-check '
  'evidence recorded via dia_recon2_record_evidence(). Still the ONLY '
  'function permitted to move a lease out of expired_unconfirmed with '
  'is_active changed; still raises without evidence_type+source.';

-- ── 5. Scott's seven field checks, verbatim from
--       docs/audits/RECON2-b-confirmed-expired-leases-review-2026-09-18.md
--       ("Scott's read — round 34", 2026-09-18), recorded_by='scott',
--       observed_date='2026-09-18'. Idempotent: guarded so a migration
--       re-run does not append duplicates. ─────────────────────────────────
do $$
begin
  -- Row 1 — 23273 Sierra Vista.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23273 and e->>'source' = 'costar_lease' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23273, 'costar_lease', 'CoStar: DaVita lease active', date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23273 and e->>'source' = 'operator_locator' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23273, 'operator_locator', 'DaVita locator: operating at the address', date '2026-09-18', 'scott');
  end if;

  -- Row 2 — 23506 Washington DC.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23506 and e->>'source' = 'operator_locator' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23506, 'operator_locator',
      'DaVita''s Eighth Street Dialysis (historically Gambro / Eighth Street) is no longer at 300 8th St NE — relocated to 920 Bladensburg Rd NE, 20002',
      date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23506 and e->>'source' = 'cms' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23506, 'cms', 'CMS: clinic closed, not operating', date '2026-09-18', 'scott');
  end if;

  -- Row 3 — 23259 Goldsboro.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23259 and e->>'source' = 'operator_locator' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23259, 'operator_locator', 'DaVita operating; possible recent expansion', date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 23259 and e->>'source' = 'costar_lease' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(23259, 'costar_lease',
      'CoStar lease sent via sidebar — no expiration date landed on the record (SIDEBAR-LEASE1: the sidebar send touched twin property 39982, not 27677)',
      date '2026-09-18', 'scott');
  end if;

  -- Row 4 — 6912 Cartersville.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 6912 and e->>'source' = 'google_hours' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(6912, 'google_hours',
      'No longer a dialysis clinic — a restaurant since 2019; old Google listing "Cartersville Dialysis Clinic"',
      date '2026-09-18', 'scott');
  end if;

  -- Row 5 — 12599 Orlando Metrowest.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 12599 and e->>'source' = 'google_hours' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(12599, 'google_hours', 'Operating, hours on Google; in a 120k SF centre', date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 12599 and e->>'source' = 'costar_lease' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(12599, 'costar_lease', 'CoStar lease expires Jun 2028; sent via sidebar', date '2026-09-18', 'scott');
  end if;

  -- Row 6 — 12678 Dixon.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 12678 and e->>'source' = 'google_hours' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(12678, 'google_hours', 'Operating, hours on Google', date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 12678 and e->>'source' = 'costar_lease' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(12678, 'costar_lease', 'CoStar lease active; sent via sidebar', date '2026-09-18', 'scott');
  end if;

  -- Row 7 — 13058 Scranton.
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 13058 and e->>'source' = 'google_hours' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(13058, 'google_hours', 'Operating, hours on Google; 83k SF centre', date '2026-09-18', 'scott');
  end if;
  if not exists (select 1 from leases, jsonb_array_elements(coalesce(expiration_evidence, '[]'::jsonb)) e
                  where lease_id = 13058 and e->>'source' = 'costar_lease' and e->>'recorded_by' = 'scott') then
    perform dia_recon2_record_evidence(13058, 'costar_lease', 'CoStar lease active; sent via sidebar', date '2026-09-18', 'scott');
  end if;
end $$;

-- ── 6. Confirmations. ─────────────────────────────────────────────────────

-- 6a. Lease 23506 (DC) — expired_confirmed, no successor (relocation).
do $$
declare v_state text;
begin
  select expiration_state into v_state from leases where lease_id = 23506;
  if v_state is not null and v_state is distinct from 'expired_confirmed' then
    perform dia_recon2_confirm_lease_expired(
      23506, 'expired_confirmed', 'cms_closure',
      'Field check (Scott, 2026-09-18): CMS shows clinic closed/not operating; DaVita relocated to 920 Bladensburg Rd NE, 20002.',
      null,
      'Relocation confirmed — not a re-let of 300 8th St NE. Research: is the Bladensburg clinic on the record as a property?',
      'scott'
    );
  end if;
end $$;

-- 6b. Lease 6912 (Cartersville) — expired_confirmed, no successor (vacated).
do $$
declare v_state text;
begin
  select expiration_state into v_state from leases where lease_id = 6912;
  if v_state is not null and v_state is distinct from 'expired_confirmed' then
    perform dia_recon2_confirm_lease_expired(
      6912, 'expired_confirmed', 'property_use_change',
      'Field check (Scott, 2026-09-18): site is now a restaurant, not a dialysis clinic (since 2019).',
      null,
      'Property use changed — flag for the property record too (separate, not done in this migration).',
      'scott'
    );
  end if;
end $$;

-- 6c. Confirm-with-successor, one transaction each. If the successor insert
--     fails, the whole DO block raises and nothing about the old row changes.

-- 23259 Goldsboro — no CoStar date supplied; successor lease_expiration left
-- NULL (expiration_unknown, never guessed).
do $$
declare
  v_old_lease_id  integer := 23259;
  v_old           record;
  v_new_lease_id  integer;
begin
  select * into v_old from leases where lease_id = v_old_lease_id;
  if v_old.expiration_state is distinct from 'expired_confirmed'
     and not exists (select 1 from leases where parent_lease_id = v_old_lease_id and data_source = 'costar_field_check') then
    insert into leases (property_id, tenant, lease_start, lease_expiration, is_active,
                         parent_lease_id, data_source, source_confidence)
    values (v_old.property_id, v_old.tenant, null, null, true,
            v_old_lease_id, 'costar_field_check', 'documented')
    returning lease_id into v_new_lease_id;

    perform dia_recon2_confirm_lease_expired(
      v_old_lease_id, 'expired_confirmed', 'successor_lease',
      'Field check (Scott, 2026-09-18): DaVita operating, possible recent expansion; CoStar lease sent via sidebar, no expiration date landed.',
      v_new_lease_id::text,
      'Successor lease ' || v_new_lease_id || ' inserted with tenant carried forward; lease_expiration left NULL '
      '(expiration_unknown) — no CoStar date supplied for this property. Update it when the CoStar date is confirmed.',
      'scott'
    );
  end if;
end $$;

-- 12599 Orlando Metrowest — CoStar date supplied: 2028-06-30.
do $$
declare
  v_old_lease_id  integer := 12599;
  v_old           record;
  v_new_lease_id  integer;
begin
  select * into v_old from leases where lease_id = v_old_lease_id;
  if v_old.expiration_state is distinct from 'expired_confirmed'
     and not exists (select 1 from leases where parent_lease_id = v_old_lease_id and data_source = 'costar_field_check') then
    insert into leases (property_id, tenant, lease_start, lease_expiration, is_active,
                         parent_lease_id, data_source, source_confidence)
    values (v_old.property_id, v_old.tenant, null, date '2028-06-30', true,
            v_old_lease_id, 'costar_field_check', 'documented')
    returning lease_id into v_new_lease_id;

    perform dia_recon2_confirm_lease_expired(
      v_old_lease_id, 'expired_confirmed', 'successor_lease',
      'Field check (Scott, 2026-09-18): operating, hours on Google, 120k SF centre; CoStar lease expires Jun 2028.',
      v_new_lease_id::text,
      'Successor lease ' || v_new_lease_id || ' inserted, tenant carried forward, lease_expiration 2028-06-30 (Scott''s CoStar read).',
      'scott'
    );
  end if;
end $$;

-- 12678 Dixon — no CoStar date supplied.
do $$
declare
  v_old_lease_id  integer := 12678;
  v_old           record;
  v_new_lease_id  integer;
begin
  select * into v_old from leases where lease_id = v_old_lease_id;
  if v_old.expiration_state is distinct from 'expired_confirmed'
     and not exists (select 1 from leases where parent_lease_id = v_old_lease_id and data_source = 'costar_field_check') then
    insert into leases (property_id, tenant, lease_start, lease_expiration, is_active,
                         parent_lease_id, data_source, source_confidence)
    values (v_old.property_id, v_old.tenant, null, null, true,
            v_old_lease_id, 'costar_field_check', 'documented')
    returning lease_id into v_new_lease_id;

    perform dia_recon2_confirm_lease_expired(
      v_old_lease_id, 'expired_confirmed', 'successor_lease',
      'Field check (Scott, 2026-09-18): operating, hours on Google; CoStar lease active, sent via sidebar, no expiration date landed.',
      v_new_lease_id::text,
      'Successor lease ' || v_new_lease_id || ' inserted with tenant carried forward; lease_expiration left NULL '
      '(expiration_unknown) — no CoStar date supplied for this property. Update it when the CoStar date is confirmed.',
      'scott'
    );
  end if;
end $$;

-- 13058 Scranton — no CoStar date supplied.
do $$
declare
  v_old_lease_id  integer := 13058;
  v_old           record;
  v_new_lease_id  integer;
begin
  select * into v_old from leases where lease_id = v_old_lease_id;
  if v_old.expiration_state is distinct from 'expired_confirmed'
     and not exists (select 1 from leases where parent_lease_id = v_old_lease_id and data_source = 'costar_field_check') then
    insert into leases (property_id, tenant, lease_start, lease_expiration, is_active,
                         parent_lease_id, data_source, source_confidence)
    values (v_old.property_id, v_old.tenant, null, null, true,
            v_old_lease_id, 'costar_field_check', 'documented')
    returning lease_id into v_new_lease_id;

    perform dia_recon2_confirm_lease_expired(
      v_old_lease_id, 'expired_confirmed', 'successor_lease',
      'Field check (Scott, 2026-09-18): operating, hours on Google, 83k SF centre; CoStar lease active, sent via sidebar, no expiration date landed.',
      v_new_lease_id::text,
      'Successor lease ' || v_new_lease_id || ' inserted with tenant carried forward; lease_expiration left NULL '
      '(expiration_unknown) — no CoStar date supplied for this property. Update it when the CoStar date is confirmed.',
      'scott'
    );
  end if;
end $$;

-- 6d. Lease 23273 (Sierra Vista) — NO WRITE to is_active/expiration_state.
--     Evidence recorded above (section 5); no confirm call here, by design.

-- ── 7. Re-run note. ───────────────────────────────────────────────────────
-- The dry-run classifier's counts and the "shorter confirmed list" this
-- migration's spec-R5 amendment reports were NOT re-queried live this
-- session (no Supabase MCP access from this sandbox). Once this migration
-- is applied, run:
--   select proposed_state, evidence_type, count(*) from dia_recon2_classify_expired_leases(null) group by 1,2 order by 1,2;
--   select * from dia_recon2_classify_expired_leases(null) where conflict;
-- and correct the counts in docs/architecture/reconcile-property-spec.md R5
-- and this header if they differ from what was predicted.
