-- ============================================================================
-- Prompt 115 — backfill `email_bodies` bodies from the payloads we already hold
-- LCC Opps (xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- The Prompt-114 allowlist put the full Graph body into `enrichment_jobs.payload`
-- and the sweep enqueued it correctly, but `handleOutlookMessageExtract` split
-- the body with an exact-equality test on `payload.body.contentType` — so the
-- serialized-JSON-string shape produced NULL for both columns and the content
-- was discarded. The payloads are still on disk, so the already-swept messages
-- can be re-driven WITHOUT asking anyone to re-sweep the mailbox.
--
-- This mirrors, in SQL, the JS normalizer `normalizeGraphBody`
-- (`api/_shared/bridge-handlers-outlook.js`) — same three shapes, same
-- case-insensitive contentType, same HTML sniff when contentType is absent.
--
-- Discipline: additive · FILL-BLANKS ONLY (never overwrites a stored body) ·
-- never fabricates (no content ⇒ no write) · idempotent (a re-run writes 0) ·
-- reversible (pre-state snapshot + REVERSAL RUNBOOK at the foot).
-- ============================================================================

begin;

-- ---- 1. reversibility snapshot --------------------------------------------

create table if not exists lcc_p115_email_body_backfill_backup (
  id                  uuid primary key,
  internet_message_id text,
  body_format         text,
  body_text           text,
  body_html           text,
  batch_tag           text not null default 'p115_email_body_backfill_20260907',
  backed_up_at        timestamptz not null default now()
);

-- ---- 2. normalize every stored payload body -------------------------------

create temporary table _p115_src on commit drop as
with raw as (
  select
    j.payload->>'internetMessageId'                       as imid,
    j.created_at,
    case
      -- shape 1: the Graph object
      when jsonb_typeof(j.payload->'body') = 'object'
        then j.payload->'body'
      -- shape 2: a serialized JSON string
      when jsonb_typeof(j.payload->'body') = 'string'
       and ltrim(j.payload->>'body') like '{%'
        then (
          case when (j.payload->>'body') ~ '^\s*\{'
            then nullif(j.payload->>'body','')::jsonb
          end)
      -- shape 2b: a bare body string
      when jsonb_typeof(j.payload->'body') = 'string'
        then jsonb_build_object('content', j.payload->>'body')
    end                                                   as body
  from enrichment_jobs j
  where j.job_type = 'outlook.message.extract'
    and j.payload ? 'body'
    and j.payload->>'internetMessageId' is not null
),
typed as (
  select
    imid, created_at,
    body->>'content'                                      as content,
    lower(btrim(coalesce(body->>'contentType', '')))      as ctype
  from raw
  where jsonb_typeof(body) = 'object'
),
fmt as (
  select
    imid, created_at, content,
    case
      when ctype in ('html','text/html')  then 'html'
      when ctype in ('text','text/plain') then 'text'
      -- contentType missing / unrecognized → sniff, never discard
      when content ~* '<\s*(html|body|div|p|table|span|a|br|meta)\M'
        or ltrim(content) like '<%'       then 'html'
      else 'text'
    end as body_format
  from typed
  where content is not null and btrim(content) <> ''
)
-- newest body-bearing payload wins per message
select distinct on (imid) imid, body_format, content
from fmt
order by imid, created_at desc;

-- ---- 3. snapshot then fill (blanks only) ----------------------------------

insert into lcc_p115_email_body_backfill_backup
      (id, internet_message_id, body_format, body_text, body_html)
select eb.id, eb.internet_message_id, eb.body_format, eb.body_text, eb.body_html
from email_bodies eb
join _p115_src s on s.imid = eb.internet_message_id
where eb.body_html is null and eb.body_text is null
on conflict (id) do nothing;

update email_bodies eb
set body_format = s.body_format,
    body_html   = case when s.body_format = 'html' then s.content else eb.body_html end,
    body_text   = case when s.body_format = 'text' then s.content else eb.body_text end
from _p115_src s
where s.imid = eb.internet_message_id
  and eb.body_html is null
  and eb.body_text is null;   -- FILL-BLANKS: a stored body is never overwritten

commit;

-- ============================================================================
-- VERIFY
--   select count(*) from email_bodies
--    where coalesce(length(body_html),0) > 255 or coalesce(length(body_text),0) > 255;
--
-- REVERSAL RUNBOOK
--   update email_bodies eb
--      set body_format = b.body_format, body_text = b.body_text, body_html = b.body_html
--     from lcc_p115_email_body_backfill_backup b
--    where b.id = eb.id and b.batch_tag = 'p115_email_body_backfill_20260907';
--   -- then, if desired: drop table lcc_p115_email_body_backfill_backup;
-- ============================================================================
