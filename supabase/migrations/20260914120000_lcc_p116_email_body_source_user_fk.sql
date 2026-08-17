-- ============================================================================
-- Prompt 116 — the `email_bodies` "upsert 409" was a FOREIGN KEY violation,
-- not a merge-duplicates conflict. Re-drive the bodies we already hold.
-- LCC Opps (xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- ROOT CAUSE (read the Postgres log, not the HTTP status)
--
-- Prompt 115 recorded `enrichment_jobs.result.body_persist_error='upsert_409'`
-- on 10,470 of the backward Sent-Items sweep's writes. On a POST carrying
-- `on_conflict=workspace_id,internet_message_id` + `Prefer:
-- resolution=merge-duplicates`, a 409 reads as "merge-duplicates didn't take,
-- the existing row 23505'd". That diagnosis is WRONG. PostgREST maps BOTH
-- 23505 (unique_violation) AND **23503 (foreign_key_violation)** to HTTP 409.
--
-- The live Postgres log says:
--   insert or update on table "email_bodies"
--     violates foreign key constraint "email_bodies_source_user_id_fkey"
--   insert or update on table "activity_events"
--     violates foreign key constraint "activity_events_actor_id_fkey"
--
-- `email_bodies.source_user_id`, `meetings.source_user_id` and
-- `activity_events.actor_id` all FK `public.users(id)`. LCC has TWO user tables
-- with disjoint id spaces, bridged only by EMAIL. The backward sweep's PA flow
-- was configured with the **lcc_users** id 1d3f7321-a4ad-4f83-9c7b-489554fc1c51
-- while the working forward sweep used the **public.users** id
-- b0000000-0000-0000-0000-000000000001 — the SAME person
-- (sabriggs@northmarq.com). So every body-bearing write the sweep attempted was
-- rejected wholesale by the FK, and the body was dropped.
--
-- The merge-duplicates upsert was CORRECT ALL ALONG — proven by a
-- self-rolling-back gate: the identical `ON CONFLICT (workspace_id,
-- internet_message_id) DO UPDATE` statement with a VALID user id updates the
-- existing row in place. The PA sweep was correct all along too: the full
-- bodies are already sitting in `enrichment_jobs.payload`.
--
-- The writer fix is JS (`api/_shared/source-user-id.js`, wired into
-- `bridge-handlers-outlook.js`) and ships on the next Railway redeploy. THIS
-- migration recovers the bodies already captured, so nothing has to be
-- re-swept.
--
-- Discipline: additive · FILL-BLANKS ONLY (never overwrites a stored body) ·
-- never fabricates (no content ⇒ no write; an unresolvable user ⇒ NULL stamp,
-- never a minted user) · idempotent (a re-run writes 0) · reversible
-- (pre-state snapshot + inserted-id ledger + REVERSAL RUNBOOK at the foot).
-- ============================================================================

begin;

-- ---- 0. reversibility -------------------------------------------------------

create table if not exists lcc_p116_email_body_backfill_backup (
  id                  uuid primary key,
  internet_message_id text,
  body_format         text,
  body_text           text,
  body_html           text,
  source_user_id      uuid,
  op                  text not null default 'update',   -- 'update' | 'insert'
  batch_tag           text not null default 'p116_email_body_fk_backfill_20260913',
  backed_up_at        timestamptz not null default now()
);

-- ---- 1. helpers (mirror the JS extractors; dropped at the foot) -------------
--
-- `extractEmail` / `extractRecipients` in bridge-handlers-outlook.js accept the
-- Graph object, a bare {address}, a plain string, and (for recipients) a
-- ';'/','-delimited string. Mirrored exactly so a row this migration inserts is
-- byte-identical to one the fixed handler would have written.

create or replace function lcc_p116_graph_email(v jsonb) returns text
language sql immutable as $$
  select lower(nullif(btrim(coalesce(
    v->'emailAddress'->>'address',
    v->>'address',
    case when jsonb_typeof(v) = 'string' then v #>> '{}' end
  )), ''))
$$;

create or replace function lcc_p116_graph_emails(v jsonb) returns text[]
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'array' then (
      select array_agg(e) from (
        select lcc_p116_graph_email(x) as e
        from jsonb_array_elements(v) x
      ) s where e is not null
    )
    when jsonb_typeof(v) = 'string' then (
      select array_agg(lower(btrim(t)))
      from regexp_split_to_table(v #>> '{}', '[;,]') t
      where btrim(t) <> ''
    )
  end
$$;

-- ---- 2. normalize every stored payload body --------------------------------
--
-- Mirrors the JS `normalizeGraphBody`: three shapes, case-insensitive
-- contentType, HTML sniff when contentType is absent. Keyed by
-- (workspace_id, internet_message_id) — the actual unique index — because the
-- Prompt-115 pass keyed on the message id alone.

create temporary table _p116_src on commit drop as
with raw as (
  select
    j.workspace_id                                  as ws,
    j.payload->>'internetMessageId'                 as imid,
    j.created_at,
    j.payload                                       as p,
    case
      when jsonb_typeof(j.payload->'body') = 'object' then j.payload->'body'
      when jsonb_typeof(j.payload->'body') = 'string'
       and (j.payload->>'body') ~ '^\s*\{'
        then nullif(j.payload->>'body', '')::jsonb
      when jsonb_typeof(j.payload->'body') = 'string'
        then jsonb_build_object('content', j.payload->>'body')
    end                                             as body
  from enrichment_jobs j
  where j.job_type = 'outlook.message.extract'
    and j.payload ? 'body'
    and j.payload->>'internetMessageId' is not null
    and j.workspace_id is not null
),
typed as (
  select ws, imid, created_at, p,
         body->>'content'                              as content,
         lower(btrim(coalesce(body->>'contentType',''))) as ctype
  from raw
  where jsonb_typeof(body) = 'object'
),
fmt as (
  select ws, imid, created_at, p, content,
    case
      when ctype in ('html','text/html')  then 'html'
      when ctype in ('text','text/plain') then 'text'
      when content ~* '<\s*(html|body|div|p|table|span|a|br|meta)\M'
        or ltrim(content) like '<%'       then 'html'
      else 'text'
    end as body_format
  from typed
  where content is not null and btrim(content) <> ''
)
-- newest body-bearing payload wins per (workspace, message)
select distinct on (ws, imid)
  ws, imid, body_format, content, p,
  -- the id-space bridge: direct public.users hit, else lcc_users → email → users
  coalesce(
    (select u.id from users u
      where (p->>'_source_user_id') ~* '^[0-9a-f-]{36}$'
        and u.id = (p->>'_source_user_id')::uuid),
    (select u.id from lcc_users l join users u on lower(u.email) = lower(l.email)
      where (p->>'_source_user_id') ~* '^[0-9a-f-]{36}$'
        and l.lcc_user_id = (p->>'_source_user_id')::uuid)
  ) as source_user_id
from fmt
order by ws, imid, created_at desc;

create index on _p116_src (ws, imid);

-- ---- 3. fill blanks on rows that already exist ------------------------------

insert into lcc_p116_email_body_backfill_backup
      (id, internet_message_id, body_format, body_text, body_html, source_user_id, op)
select eb.id, eb.internet_message_id, eb.body_format, eb.body_text, eb.body_html,
       eb.source_user_id, 'update'
from email_bodies eb
join _p116_src s on s.ws = eb.workspace_id and s.imid = eb.internet_message_id
where eb.body_html is null and eb.body_text is null
on conflict (id) do nothing;

update email_bodies eb
set body_format = s.body_format,
    body_html   = case when s.body_format = 'html' then s.content else eb.body_html end,
    body_text   = case when s.body_format = 'text' then s.content else eb.body_text end
from _p116_src s
where s.ws = eb.workspace_id
  and s.imid = eb.internet_message_id
  and eb.body_html is null
  and eb.body_text is null;   -- FILL-BLANKS: a stored body is never overwritten

-- ---- 4. insert the rows the FK rejected outright ---------------------------
--
-- These messages ALREADY passed the handler's privacy gate (the upsert is only
-- attempted after `findTrackedContacts` returns a tracked party), so the row
-- was always intended — the FK killed it before it could land. Metadata is
-- derived from the same payload fields the handler reads; anything the payload
-- does not state stays NULL (never fabricated).

with ins as (
  insert into email_bodies (
    workspace_id, internet_message_id, conversation_id, subject, body_preview,
    body_format, body_html, body_text,
    from_email, from_name, to_emails, cc_emails,
    has_attachments, is_sent, received_at, sent_at, source_user_id
  )
  select
    s.ws,
    s.imid,
    nullif(s.p->>'conversationId', ''),
    nullif(s.p->>'subject', ''),
    nullif(s.p->>'bodyPreview', ''),
    s.body_format,
    case when s.body_format = 'html' then s.content end,
    case when s.body_format = 'text' then s.content end,
    lcc_p116_graph_email(s.p->'from'),
    nullif(s.p->'from'->'emailAddress'->>'name', ''),
    lcc_p116_graph_emails(s.p->'toRecipients'),
    lcc_p116_graph_emails(s.p->'ccRecipients'),
    coalesce((s.p->>'hasAttachments')::boolean, false),
    -- mirrors the handler: "sent by us" unless the FROM address is itself a
    -- tracked contact (findTrackedContacts is not workspace-scoped).
    not exists (
      select 1 from unified_contacts uc
      where lower(uc.email) = lcc_p116_graph_email(s.p->'from')
    ),
    nullif(s.p->>'receivedDateTime', '')::timestamptz,
    nullif(s.p->>'sentDateTime', '')::timestamptz,
    s.source_user_id
  from _p116_src s
  where not exists (
    select 1 from email_bodies eb
    where eb.workspace_id = s.ws and eb.internet_message_id = s.imid
  )
    -- drafts never became rows in the handler either
    and coalesce((s.p->>'isDraft')::boolean, false) = false
  on conflict (workspace_id, internet_message_id) do nothing
  returning id, internet_message_id, source_user_id
)
insert into lcc_p116_email_body_backfill_backup
      (id, internet_message_id, body_format, body_text, body_html, source_user_id, op)
select id, internet_message_id, null, null, null, source_user_id, 'insert'
from ins
on conflict (id) do nothing;

-- ---- 5. mark the recovered jobs so the error count stays honest -------------
--
-- Leaves `body_persist_error` in place (it is the true record of what the
-- handler saw) and adds the recovery marker beside it, so
-- "still-broken" can be told apart from "already recovered".

update enrichment_jobs j
set result = coalesce(j.result, '{}'::jsonb)
             || jsonb_build_object('body_persist_recovered_by',
                                   'p116_email_body_fk_backfill_20260913')
where j.job_type = 'outlook.message.extract'
  and j.result->>'body_persist_error' is not null
  and j.result->>'body_persist_recovered_by' is null
  and exists (
    select 1 from email_bodies eb
    where eb.workspace_id = j.workspace_id
      and eb.internet_message_id = j.payload->>'internetMessageId'
      and (coalesce(length(eb.body_html),0) > 255 or coalesce(length(eb.body_text),0) > 255)
  );

-- ---- 6. drop the single-use helpers ----------------------------------------

drop function if exists lcc_p116_graph_emails(jsonb);
drop function if exists lcc_p116_graph_email(jsonb);

commit;

-- ============================================================================
-- VERIFY
--   select count(*) from email_bodies
--    where coalesce(length(body_html),0) > 255 or coalesce(length(body_text),0) > 255;
--   -- and confirm no row was left with a bad provenance stamp:
--   select count(*) from email_bodies eb
--     left join users u on u.id = eb.source_user_id
--    where eb.source_user_id is not null and u.id is null;   -- must be 0
--
-- REVERSAL RUNBOOK  (batch_tag = 'p116_email_body_fk_backfill_20260913')
--   -- 4a. undo the fills
--   update email_bodies eb
--      set body_format = b.body_format, body_text = b.body_text, body_html = b.body_html
--     from lcc_p116_email_body_backfill_backup b
--    where b.id = eb.id and b.op = 'update'
--      and b.batch_tag = 'p116_email_body_fk_backfill_20260913';
--   -- 4b. undo the inserts
--   delete from email_bodies eb using lcc_p116_email_body_backfill_backup b
--    where b.id = eb.id and b.op = 'insert'
--      and b.batch_tag = 'p116_email_body_fk_backfill_20260913';
--   -- 4c. drop the recovery markers
--   update enrichment_jobs set result = result - 'body_persist_recovered_by'
--    where result->>'body_persist_recovered_by' = 'p116_email_body_fk_backfill_20260913';
--   -- then, if desired: drop table lcc_p116_email_body_backfill_backup;
-- ============================================================================
