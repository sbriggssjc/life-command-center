-- OWNERGAP2-harris — staging table for HCAD's FREE bulk PDATA export.
-- Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- CONTEXT. `api/_shared/ownergap2-sources.js`'s Harris adapter is PAYLOAD-ONLY:
-- the HCAD search portal (`search.hcad.org`) is Cloudflare-bot-walled (measured
-- live 2026-09-16, 403 managed challenge from the sandbox's pg_net egress), so
-- the adapter accepts an operator-supplied payload and fetches nothing itself.
-- That call was correct for the PORTAL. HCAD separately publishes its whole
-- roll as a FREE, NO-LOGIN, NO-CAPTCHA bulk download —
--   https://hcad.org/pdata/pdata-property-downloads.html  ("Real_acct_owner.zip")
--   https://hcad.org/assets/uploads/pdf/pdataCodebook.pdf  (the column codebook)
-- — which is a DIFFERENT surface from the portal and is not covered by the
-- task's "do not automate a bot-protected page" prohibition: it is a plain file
-- download, fetched by hand or by a scheduled job hitting a static URL, never a
-- scripted interaction with a challenge page.
--
-- ⚠️ THIS MIGRATION WAS WRITTEN WITHOUT NETWORK ACCESS TO hcad.org (confirmed
--    live 2026-09-16: the sandbox's outbound proxy returns `CONNECT tunnel
--    failed, response 403` for hcad.org — a policy denial, not a bot wall this
--    time; see the loader script's header for the exact probe). The codebook
--    PDF could not be fetched either, so the exact `state_class` code list and
--    the exact column NAMES in `real_acct.txt` are NOT verified against a real
--    file. What is shipped instead:
--      · a STAGING TABLE shaped by the codebook's DOCUMENTED field names
--        (acct / owner / mailing / str_num+str+str_sfx / site_addr_1-3 /
--        state_class), which is the schema the ticket itself specifies;
--      · a `raw_row` jsonb column carrying every column the loader actually
--        saw, so a wrong assumption about a NAMED column is recoverable from
--        the same row without a re-download;
--      · a commercial-class filter using the Texas Comptroller's PUBLISHED
--        state-class taxonomy (F1 = Real, Commercial; F2 = Real, Industrial;
--        L1 = Personal, Commercial; L2 = Personal, Industrial — the same
--        taxonomy every Texas CAD, including HCAD, files under), NOT
--        HCAD-specific verification. ⚠️ **THIS NEEDS OPERATOR VERIFICATION
--        AGAINST THE ACTUAL pdataCodebook.pdf BEFORE A REAL LOAD.** The load
--        does not drop non-matching rows — it stages everything and FLAGS
--        `is_commercial_class`, so a wrong guess here costs a re-flag, not a
--        re-download.
--
-- SCOPE, deliberately small (mirrors OWNERGAP2's own discipline): one staging
-- table for one county's one bulk file. No scheduler, no multi-jurisdiction
-- PDATA framework — if another county publishes an equivalent bulk file later,
-- that is a new, separate table, not a generalisation of this one guessed from
-- no live sample.
--
-- REVERSAL RUNBOOK:
--   -- the stage holds no owner writes and no property link; it is purely
--   -- read by the matcher. Removing a bad load:
--   delete from hcad_real_acct_stage where source_file = '<the loaded file name>';
--   -- to remove the lane entirely:
--   --   drop table hcad_real_acct_stage;

create table if not exists hcad_real_acct_stage (
  id                bigserial primary key,
  acct              text        not null,
  file_year         integer     not null,
  owner_name        text,
  owner_name_2      text,
  mail_addr_1       text,
  mail_addr_2       text,
  mail_city         text,
  mail_state        text,
  mail_zip          text,
  str_num           text,
  str               text,
  str_sfx           text,
  site_addr_1       text,
  site_addr_2       text,
  site_addr_3       text,
  state_class       text,
  -- ⚠️ COMPUTED AT LOAD TIME BY THE SCRIPT, NOT BY A DB TRIGGER — the mapping
  -- from `state_class` to "is this the commercial real-property account" is
  -- the UNVERIFIED assumption named above, and keeping it in application code
  -- (harrisStateClassToAccountType, api/_shared/ownergap2-sources.js) means a
  -- correction after the codebook is read is a code change + a re-load, never
  -- a silent migration that redefines what past rows meant.
  is_commercial_class boolean   not null default false,
  raw_row           jsonb,
  source_file       text        not null,
  loaded_at         timestamptz not null default now(),

  constraint chk_hcad_stage_acct_not_blank check (coalesce(trim(acct), '') <> '')
);

comment on table hcad_real_acct_stage is
  'OWNERGAP2-harris: HCAD free bulk PDATA export (Real_acct_owner.zip ->
   real_acct.txt + owners.txt), staged by scripts/hcad-pdata-load.mjs from an
   OPERATOR-SUPPLIED local file path (this environment has no egress to
   hcad.org). Not a live feed -- one row per (acct, file_year), reloaded when a
   newer export lands. is_commercial_class is a best-effort mapping pending
   operator verification against pdataCodebook.pdf; raw_row keeps everything the
   loader saw so a wrong mapping is correctable without a re-download.';

comment on column hcad_real_acct_stage.is_commercial_class is
  'True for HCAD state_class codes documented (Texas Comptroller taxonomy,
   NOT independently verified against the HCAD codebook PDF -- no network
   access to fetch it) as real or personal COMMERCIAL/INDUSTRIAL property:
   F1 (Real, Commercial), F2 (Real, Industrial), L1 (Personal, Commercial),
   L2 (Personal, Industrial). Verify against pdataCodebook.pdf before a real
   load is treated as authoritative.';

-- Idempotency: one row per account per file year. A re-load of the same
-- export upserts in place instead of stacking duplicate history.
create unique index if not exists uq_hcad_stage_acct_year
  on hcad_real_acct_stage (acct, file_year);

create index if not exists idx_hcad_stage_commercial
  on hcad_real_acct_stage (is_commercial_class) where is_commercial_class;
create index if not exists idx_hcad_stage_str
  on hcad_real_acct_stage (str);

-- Grants: service_role only, same as the OWNERGAP2 ledger. This table is a
-- staging area for a batch load and a matcher, never anon-readable.
grant select, insert, update on hcad_real_acct_stage to service_role;
grant usage, select on sequence hcad_real_acct_stage_id_seq to service_role;

-- PostgREST caches the schema; a newly created table 400s PGRST204 on write
-- until it reloads (CLAUDE.md footgun, cost the prompt-78 fix a day).
notify pgrst, 'reload schema';
