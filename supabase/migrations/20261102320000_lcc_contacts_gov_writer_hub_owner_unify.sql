-- ============================================================================
-- CONTACTS-GOV-WRITER — port gov `unify_owners_tick` onto the LCC Opps
-- contacts hub, and follow gov owner merges on the hub.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-09-24.
--
-- THE WRITER (measured 2026-09-24): the retired gov `unified_contacts` copy
-- was written by gov cron 17 `unify-owners-incremental` (:23/:53) →
-- `unify_owners_tick(200)`, which gives every new gov recorded owner a
-- business contact (create `new_from_gov_owner`, or link an existing SF row
-- `|linked_gov_owner_t0`). Since the A9b cutover (2026-08-17) that is 215
-- created + 98 linked rows, none on the hub. The other 2026-09-12 batch (708
-- rows, one statement) is gov `apply_owner_merge` (ID3b) repointing
-- `recorded_owner_id` loser→survivor — on the gov copy only, so the hub still
-- points at merged-away owners. Supabase edge_logs show NO PostgREST write to
-- gov unified_contacts / contact_merge_queue in 24h (50 GETs, UA `node`) —
-- both writers are in-database.
--
-- The tick had NO hub counterpart (the hub's gov-owner rows are the one-shot
-- A9a copy, newest 2026-05-29), so it is PORTED, not stopped:
--
--   gov v_gov_recorded_owner_identity  (anon, government-lease
--        sql/20260924_gov_contacts_gov_writer_a_owner_identity_view.sql)
--     → lcc_sync_gov_recorded_owner_mirror()   pg_net pages, :05/:35
--     → lcc_finalize_gov_recorded_owner_mirror() :08/:38
--     → lcc_gov_recorded_owner_mirror
--     → lcc_unify_gov_owners_tick()             :23/:53
--          1. lcc_hub_gov_owner_merge_follow()  repoint tombstone → survivor
--          2. link / create / route-to-review, same rules as gov
--
-- Differences from the gov tick, each deliberate:
--   * merged-away owners are never selected (gov's tick selected them and
--     could mint a contact for a tombstone);
--   * generic owners (gov is_generic_gov_owner, computed ON gov and carried
--     in the mirror — one copy of the rule) are filtered in SELECTION, not
--     skipped in the loop, so they cannot hold the LIMIT window forever
--     (P136 cursor trap);
--   * newest owners first, so a backlog never starves today's owners;
--   * every write is ledgered with its prior value (reversible by batch).
--
-- Merge-follow (Scott, 2026-09-24): a hub row pointing at a gov tombstone is
-- repointed to the survivor, EXCEPT when another hub row already points at
-- the survivor, or two tombstone rows would land on one survivor — those are
-- recorded as `merge_follow_conflict` and left as they are. Never guessed.
--
-- Discipline: dry-run default on every mutating function; idempotent;
-- ledgered in lcc_gov_owner_contact_link_log with prior values.
-- REVERSAL (by batch):
--   delete from unified_contacts u using lcc_gov_owner_contact_link_log l
--    where l.batch=:b and l.action='created' and u.unified_id=l.unified_id;
--   update unified_contacts u set recorded_owner_id=null, match_method=l.prior_match_method
--     from lcc_gov_owner_contact_link_log l
--    where l.batch=:b and l.action='linked' and u.unified_id=l.unified_id;
--   update unified_contacts u set recorded_owner_id=l.prior_recorded_owner_id
--     from lcc_gov_owner_contact_link_log l
--    where l.batch=:b and l.action='merge_follow_repoint' and u.unified_id=l.unified_id;
-- ============================================================================

-- ---------------------------------------------------------------- tables ----
create table if not exists public.lcc_gov_recorded_owner_mirror (
  recorded_owner_id             uuid primary key,
  name                          text,
  state                         text,
  merged_into_recorded_owner_id uuid,
  survivor_id                   uuid not null,
  is_generic                    boolean not null default false,
  source_created_at             timestamptz,
  source_updated_at             timestamptz,
  synced_at                     timestamptz not null default now()
);
create index if not exists lcc_gov_owner_mirror_live_idx
  on public.lcc_gov_recorded_owner_mirror (source_created_at desc)
  where survivor_id = recorded_owner_id and not is_generic;

create table if not exists public.lcc_gov_owner_mirror_inflight (
  request_id  bigint primary key,
  kind        text   not null check (kind in ('owners','retired_writes')),
  page_offset int    not null default 0,
  issued_at   timestamptz not null default now()
);

create table if not exists public.lcc_gov_owner_unification_review (
  review_id            bigserial primary key,
  recorded_owner_id    uuid not null,
  owner_name           text,
  candidate_unified_id uuid,
  match_tier           int,
  match_score          numeric,
  reason               text not null,
  status               text not null default 'open' check (status in ('open','resolved','dismissed')),
  batch                text,
  created_at           timestamptz not null default now()
);
create unique index if not exists lcc_gov_owner_review_open_uq
  on public.lcc_gov_owner_unification_review (recorded_owner_id) where status = 'open';

create table if not exists public.lcc_gov_owner_contact_link_log (
  log_id                   bigserial primary key,
  batch                    text not null,
  action                   text not null check (action in
                             ('created','linked','merge_follow_repoint','merge_follow_conflict')),
  unified_id               uuid,
  recorded_owner_id        uuid,
  prior_recorded_owner_id  uuid,
  prior_match_method       text,
  detail                   jsonb,
  created_at               timestamptz not null default now()
);
create index if not exists lcc_gov_owner_contact_link_log_batch_idx
  on public.lcc_gov_owner_contact_link_log (batch, action);
create unique index if not exists lcc_gov_owner_contact_link_log_conflict_uq
  on public.lcc_gov_owner_contact_link_log (unified_id, recorded_owner_id)
  where action = 'merge_follow_conflict';

alter table public.lcc_gov_recorded_owner_mirror     enable row level security;
alter table public.lcc_gov_owner_mirror_inflight     enable row level security;
alter table public.lcc_gov_owner_unification_review  enable row level security;
alter table public.lcc_gov_owner_contact_link_log    enable row level security;
revoke all on public.lcc_gov_recorded_owner_mirror,
              public.lcc_gov_owner_mirror_inflight,
              public.lcc_gov_owner_unification_review,
              public.lcc_gov_owner_contact_link_log
  from public, anon, authenticated;

-- ------------------------------------------------------------ resolver -----
-- Byte-for-byte port of gov public.company_canonical_key (IMMUTABLE). A test
-- (test/contacts-gov-writer.test.mjs) pins the body so the two cannot drift.
create or replace function public.lcc_company_canonical_key(p_name text)
returns text language sql immutable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9]', '', 'g'),
           '(llc|inc|incorporated|corporation|corp|ltd|lllp|llp|lp)+$', '')
$$;

create index if not exists idx_uc_company_canon
  on public.unified_contacts (public.lcc_company_canonical_key(company_name));
create index if not exists idx_uc_company_trgm
  on public.unified_contacts using gin (lower(company_name) gin_trgm_ops);
create index if not exists idx_uc_recorded_owner
  on public.unified_contacts (recorded_owner_id) where recorded_owner_id is not null;

-- Port of gov public.resolve_company, reading the HUB. Tier 0 = exact
-- canonical key (ambiguous when >1 hub row shares it); tier 1 = trigram
-- similarity > 0.88, same state or unknown. Generic owners are filtered by
-- the caller from the mirror flag (gov's rule, computed on gov).
create or replace function public.lcc_resolve_hub_company(p_name text, p_state text default null)
returns table(unified_id uuid, match_tier integer, match_score numeric, ambiguous boolean)
language plpgsql stable
set search_path to 'public', 'extensions', 'pg_temp'
as $$
DECLARE v_key text := public.lcc_company_canonical_key(p_name); v_n int;
BEGIN
  IF p_name IS NULL OR length(v_key) < 3 THEN RETURN; END IF;
  RETURN QUERY
  WITH hits AS (
    SELECT uc.unified_id AS uid, (p_state IS NOT NULL AND lower(uc.state)=lower(p_state)) AS same_state
    FROM public.unified_contacts uc
    WHERE public.lcc_company_canonical_key(uc.company_name) = v_key
  )
  SELECT h.uid, 0, 1.0::numeric, (SELECT count(DISTINCT h2.uid) FROM hits h2) > 1
  FROM hits h ORDER BY h.same_state DESC NULLS LAST, h.uid LIMIT 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT uc.unified_id, 1, similarity(lower(uc.company_name), lower(p_name))::numeric, false
  FROM public.unified_contacts uc
  WHERE uc.company_name IS NOT NULL
    AND lower(uc.company_name) % lower(p_name)
    AND similarity(lower(uc.company_name), lower(p_name)) > 0.88
    AND (p_state IS NULL OR uc.state IS NULL OR lower(uc.state)=lower(p_state))
  ORDER BY 3 DESC LIMIT 1;
END $$;

-- ------------------------------------------------------------- transport ---
-- Fires 25 pages of 1,000 (PostgREST caps a response at 1,000 — never stride
-- wider). gov holds 17,593 owners today; a FULL last page is reported as
-- truncation by the finalizer, never silently accepted. Also fires one GET of
-- gov v_gov_retired_contacts_writes (the retired-copy write guard).
create or replace function public.lcc_sync_gov_recorded_owner_mirror(p_pages int default 25)
returns jsonb language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
DECLARE v_url text; v_key text; v_req bigint; v_page int; v_n int := 0;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'gov_supabase_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'gov_supabase_anon_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('status','missing_vault_secret');
  END IF;
  FOR v_page IN 0..(p_pages - 1) LOOP
    SELECT net.http_get(
      url := v_url || '/rest/v1/v_gov_recorded_owner_identity'
        || '?select=recorded_owner_id,name,state,merged_into_recorded_owner_id,survivor_id,is_generic,created_at,updated_at'
        || '&order=recorded_owner_id.asc&limit=1000&offset=' || (v_page * 1000),
      headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key)
    ) INTO v_req;
    INSERT INTO public.lcc_gov_owner_mirror_inflight (request_id, kind, page_offset)
    VALUES (v_req, 'owners', v_page * 1000);
    v_n := v_n + 1;
  END LOOP;
  SELECT net.http_get(
    url := v_url || '/rest/v1/v_gov_retired_contacts_writes?select=*',
    headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key)
  ) INTO v_req;
  INSERT INTO public.lcc_gov_owner_mirror_inflight (request_id, kind) VALUES (v_req, 'retired_writes');
  RETURN jsonb_build_object('status','fired','owner_pages',v_n);
END $$;

-- Consumes answered requests. A non-200 is COUNTED and alerted, never dropped
-- as "nothing to do" (the lcc_finalize_feed_freshness defect, B6a-follow-up).
create or replace function public.lcc_finalize_gov_recorded_owner_mirror()
returns jsonb language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
DECLARE
  v_ok int := 0; v_bad int := 0; v_rows int := 0; v_full_last boolean := false;
  v_max_offset int; v_expired int := 0;
  v_rw jsonb; v_rw_seen boolean := false; v_writes_24h bigint;
BEGIN
  DROP TABLE IF EXISTS _lcc_gom_resp;
  CREATE TEMP TABLE _lcc_gom_resp ON COMMIT DROP AS
    SELECT i.request_id, i.kind, i.page_offset, r.status_code, r.content
      FROM public.lcc_gov_owner_mirror_inflight i
      JOIN net._http_response r ON r.id = i.request_id;

  SELECT count(*) FILTER (WHERE status_code = 200), count(*) FILTER (WHERE status_code IS DISTINCT FROM 200)
    INTO v_ok, v_bad FROM _lcc_gom_resp WHERE kind = 'owners';

  WITH rows AS (
    SELECT jsonb_array_elements(content::jsonb) AS r
      FROM _lcc_gom_resp WHERE kind = 'owners' AND status_code = 200
  ), up AS (
    INSERT INTO public.lcc_gov_recorded_owner_mirror AS m
      (recorded_owner_id, name, state, merged_into_recorded_owner_id, survivor_id, is_generic,
       source_created_at, source_updated_at, synced_at)
    SELECT DISTINCT ON ((r->>'recorded_owner_id')::uuid)
           (r->>'recorded_owner_id')::uuid, r->>'name', r->>'state',
           (r->>'merged_into_recorded_owner_id')::uuid, (r->>'survivor_id')::uuid,
           coalesce((r->>'is_generic')::boolean, false),
           (r->>'created_at')::timestamptz, (r->>'updated_at')::timestamptz, now()
      FROM rows
     WHERE r->>'recorded_owner_id' IS NOT NULL AND r->>'survivor_id' IS NOT NULL
    ON CONFLICT (recorded_owner_id) DO UPDATE SET
      name = EXCLUDED.name, state = EXCLUDED.state,
      merged_into_recorded_owner_id = EXCLUDED.merged_into_recorded_owner_id,
      survivor_id = EXCLUDED.survivor_id, is_generic = EXCLUDED.is_generic,
      source_created_at = EXCLUDED.source_created_at, source_updated_at = EXCLUDED.source_updated_at,
      synced_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM up;

  -- Truncation: the highest-offset page that answered 200 must not be full.
  SELECT max(page_offset) INTO v_max_offset FROM _lcc_gom_resp WHERE kind='owners' AND status_code=200;
  IF v_max_offset IS NOT NULL THEN
    SELECT jsonb_array_length(content::jsonb) = 1000 INTO v_full_last
      FROM _lcc_gom_resp WHERE kind='owners' AND status_code=200 AND page_offset = v_max_offset LIMIT 1;
  END IF;

  SELECT content::jsonb -> 0, true INTO v_rw, v_rw_seen
    FROM _lcc_gom_resp WHERE kind='retired_writes' AND status_code=200
   ORDER BY request_id DESC LIMIT 1;

  DELETE FROM public.lcc_gov_owner_mirror_inflight WHERE request_id IN (SELECT request_id FROM _lcc_gom_resp);
  WITH x AS (DELETE FROM public.lcc_gov_owner_mirror_inflight
              WHERE issued_at < now() - interval '6 hours' RETURNING 1)
  SELECT count(*) INTO v_expired FROM x;

  -- Transport health.
  IF v_bad > 0 OR v_expired > 0 OR v_full_last THEN
    IF NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts
                    WHERE alert_kind='gov_owner_mirror_sync_failed' AND resolved_at IS NULL) THEN
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      VALUES ('gov_owner_mirror_sync_failed', 'lcc_finalize_gov_recorded_owner_mirror', 'warn',
              'gov recorded-owner mirror pull failed or truncated',
              jsonb_build_object('pages_ok',v_ok,'pages_non200',v_bad,'expired',v_expired,'last_page_full',v_full_last));
    END IF;
  ELSIF v_ok > 0 THEN
    UPDATE public.lcc_health_alerts SET resolved_at = now(), resolved_note = 'clean mirror pull'
     WHERE alert_kind='gov_owner_mirror_sync_failed' AND resolved_at IS NULL;
  END IF;

  -- Retired gov contacts copy written (the CONTACTS-GOV-WRITER guard).
  IF v_rw_seen THEN
    v_writes_24h := coalesce((v_rw->>'writes_24h')::bigint, 0);
    IF v_writes_24h > 0 THEN
      IF NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts
                      WHERE alert_kind='retired_contacts_copy_written' AND resolved_at IS NULL) THEN
        INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
        VALUES ('retired_contacts_copy_written', 'gov.gov_retired_contacts_write_log', 'error',
                'Something wrote the retired gov unified_contacts / contact_merge_queue copy (CONTACTS_HUB=ops)',
                v_rw);
      END IF;
    ELSE
      UPDATE public.lcc_health_alerts SET resolved_at = now(), resolved_note = 'no retired-copy writes in 24h'
       WHERE alert_kind='retired_contacts_copy_written' AND resolved_at IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object('pages_ok',v_ok,'pages_non200',v_bad,'expired',v_expired,
                            'rows_upserted',v_rows,'last_page_full',v_full_last,
                            'retired_writes', v_rw);
END $$;

-- ---------------------------------------------------------- merge-follow ---
create or replace function public.lcc_hub_gov_owner_merge_follow(
  p_dry_run boolean default true, p_batch text default null)
returns jsonb language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
DECLARE v_batch text := coalesce(p_batch, 'contacts_gov_writer_mf_' || to_char(now(),'YYYYMMDDHH24MI'));
        v_repoint int := 0; v_conflict int := 0; v_new_conflict int := 0;
BEGIN
  DROP TABLE IF EXISTS _lcc_mf;
  CREATE TEMP TABLE _lcc_mf ON COMMIT DROP AS
  WITH tomb AS (
    SELECT u.unified_id, u.recorded_owner_id AS tomb_id, m.survivor_id
      FROM public.unified_contacts u
      JOIN public.lcc_gov_recorded_owner_mirror m ON m.recorded_owner_id = u.recorded_owner_id
     WHERE m.survivor_id <> m.recorded_owner_id
  )
  SELECT t.*,
         (EXISTS (SELECT 1 FROM public.unified_contacts v
                   WHERE v.recorded_owner_id = t.survivor_id AND v.unified_id <> t.unified_id)
          OR count(*) OVER (PARTITION BY t.survivor_id) > 1) AS is_conflict
    FROM tomb t;

  SELECT count(*) FILTER (WHERE NOT is_conflict), count(*) FILTER (WHERE is_conflict)
    INTO v_repoint, v_conflict FROM _lcc_mf;

  IF NOT p_dry_run THEN
    INSERT INTO public.lcc_gov_owner_contact_link_log
      (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id, detail)
    SELECT v_batch, 'merge_follow_repoint', unified_id, survivor_id, tomb_id, null
      FROM _lcc_mf WHERE NOT is_conflict;
    UPDATE public.unified_contacts u SET recorded_owner_id = f.survivor_id
      FROM _lcc_mf f WHERE u.unified_id = f.unified_id AND NOT f.is_conflict;

    WITH ins AS (
      INSERT INTO public.lcc_gov_owner_contact_link_log
        (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id, detail)
      SELECT v_batch, 'merge_follow_conflict', unified_id, survivor_id, tomb_id,
             jsonb_build_object('reason','survivor already linked on the hub, or two tombstones share one survivor')
        FROM _lcc_mf WHERE is_conflict
      ON CONFLICT (unified_id, recorded_owner_id) WHERE action = 'merge_follow_conflict' DO NOTHING
      RETURNING 1)
    SELECT count(*) INTO v_new_conflict FROM ins;
  END IF;

  DROP TABLE IF EXISTS _lcc_mf;
  RETURN jsonb_build_object('dry_run',p_dry_run,'batch',v_batch,'repoint',v_repoint,
                            'conflict',v_conflict,'conflict_newly_logged',v_new_conflict);
END $$;

-- ------------------------------------------------------------------ tick ---
create or replace function public.lcc_unify_gov_owners_tick(
  p_limit int default 200, p_dry_run boolean default true, p_batch text default null)
returns jsonb language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $$
DECLARE r record; m record;
  v_batch text := coalesce(p_batch, 'contacts_gov_writer_' || to_char(now(),'YYYYMMDDHH24MI'));
  v_linked int := 0; v_created int := 0; v_review int := 0; v_nomatch int := 0;
  v_mf jsonb; v_mirror_age interval; v_new uuid; v_prior text;
BEGIN
  SELECT now() - max(synced_at) INTO v_mirror_age FROM public.lcc_gov_recorded_owner_mirror;
  IF v_mirror_age IS NULL THEN
    RETURN jsonb_build_object('status','mirror_empty');
  END IF;

  v_mf := public.lcc_hub_gov_owner_merge_follow(p_dry_run, v_batch);

  FOR r IN
    SELECT o.recorded_owner_id AS oid, o.name, o.state
      FROM public.lcc_gov_recorded_owner_mirror o
     WHERE o.survivor_id = o.recorded_owner_id
       AND NOT o.is_generic
       AND o.name IS NOT NULL AND length(o.name) > 2
       AND NOT EXISTS (SELECT 1 FROM public.unified_contacts u WHERE u.recorded_owner_id = o.recorded_owner_id)
       AND NOT EXISTS (SELECT 1 FROM public.lcc_gov_owner_unification_review q
                        WHERE q.recorded_owner_id = o.recorded_owner_id AND q.status = 'open')
     ORDER BY o.source_created_at DESC NULLS LAST, o.recorded_owner_id
     LIMIT p_limit
  LOOP
    SELECT * INTO m FROM public.lcc_resolve_hub_company(r.name, r.state) LIMIT 1;
    IF NOT FOUND THEN
      v_nomatch := v_nomatch + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.unified_contacts (contact_class, company_name, state, recorded_owner_id,
               match_method, match_confidence, field_sources, created_at, updated_at)
        VALUES ('business', r.name, r.state, r.oid, 'new_from_gov_owner', 0.5,
                jsonb_build_object('recorded_owner_id','gov.recorded_owners','_contacts_gov_writer',v_batch),
                now(), now())
        RETURNING unified_id INTO v_new;
        INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id)
        VALUES (v_batch, 'created', v_new, r.oid);
        v_created := v_created + 1;
      END IF;
    ELSIF m.match_tier = 0 AND NOT m.ambiguous
          AND EXISTS (SELECT 1 FROM public.unified_contacts u
                       WHERE u.unified_id = m.unified_id AND u.recorded_owner_id IS NULL) THEN
      v_linked := v_linked + 1;
      IF NOT p_dry_run THEN
        SELECT match_method INTO v_prior FROM public.unified_contacts WHERE unified_id = m.unified_id;
        UPDATE public.unified_contacts SET recorded_owner_id = r.oid,
               match_method = coalesce(match_method,'') || '|linked_gov_owner_t0',
               match_confidence = greatest(coalesce(match_confidence,0), m.match_score),
               field_sources = coalesce(field_sources,'{}'::jsonb)
                               || jsonb_build_object('recorded_owner_id','gov.recorded_owners','_contacts_gov_writer',v_batch)
         WHERE unified_id = m.unified_id AND recorded_owner_id IS NULL;
        INSERT INTO public.lcc_gov_owner_contact_link_log
          (batch, action, unified_id, recorded_owner_id, prior_match_method)
        VALUES (v_batch, 'linked', m.unified_id, r.oid, v_prior);
      END IF;
    ELSE
      v_review := v_review + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.lcc_gov_owner_unification_review
          (recorded_owner_id, owner_name, candidate_unified_id, match_tier, match_score, reason, batch)
        VALUES (r.oid, r.name, m.unified_id, m.match_tier, m.match_score,
                CASE WHEN m.match_tier = 0 AND m.ambiguous THEN 'tier0_ambiguous'
                     WHEN m.match_tier = 0 THEN 'unified_row_already_linked'
                     ELSE 'tier1_fuzzy' END, v_batch)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('dry_run',p_dry_run,'batch',v_batch,
    'mirror_age_min', round(extract(epoch FROM v_mirror_age)/60),
    'linked',v_linked,'new',v_nomatch,'created',v_created,'review',v_review,
    'merge_follow',v_mf,'ran_at',now());
END $$;

-- ------------------------------------------------------------ privileges ---
do $$
declare f text;
begin
  foreach f in array array[
    'public.lcc_sync_gov_recorded_owner_mirror(int)',
    'public.lcc_finalize_gov_recorded_owner_mirror()',
    'public.lcc_hub_gov_owner_merge_follow(boolean,text)',
    'public.lcc_unify_gov_owners_tick(int,boolean,text)',
    'public.lcc_resolve_hub_company(text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'CONTACTS-GOV-WRITER: % still executable by anon/authenticated', f;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- crons ---
-- Scheduled only after the live dry-run + first apply (2026-09-24).
select cron.schedule('lcc-gov-owner-mirror-sync',     '5,35 * * * *',
                     $c$select public.lcc_sync_gov_recorded_owner_mirror()$c$);
select cron.schedule('lcc-gov-owner-mirror-finalize', '8,38 * * * *',
                     $c$select public.lcc_finalize_gov_recorded_owner_mirror()$c$);
select cron.schedule('lcc-gov-owner-unify-tick',      '23,53 * * * *',
                     $c$select public.lcc_unify_gov_owners_tick(200, false)$c$);
