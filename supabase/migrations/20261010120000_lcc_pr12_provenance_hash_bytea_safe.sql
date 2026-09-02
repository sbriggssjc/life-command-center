-- ============================================================================
-- PR12 — field_provenance could not store a value containing a double quote,
--        a newline, a tab or any control character, and it failed SILENTLY.
--        LCC Opps (xengecqvemvfknjvbvrq). 2026-09-02.
--
-- THE DEFECT
-- ----------
-- value_text_hash was
--     GENERATED ALWAYS AS (encode(sha224(coalesce(value::text,'')::bytea),'hex')) STORED
-- `value` is jsonb. Rendering jsonb to text emits BACKSLASH escapes (\" \n \t
-- \r \b \f \uXXXX \\). Casting that text to bytea uses bytea's *escape* input
-- format, which accepts only \\ and \ooo -- so every other escape raises
-- 22P02 and aborts the whole lcc_merge_field() call.
--
-- Rolled-back control on the live function, pre-fix:
--     quoted value ('"C" - Commercial')  -> 22P02 invalid input syntax for type bytea
--     plain  value ('C Commercial')      -> NO_ERROR
--
-- ⚠️ THE SCOPE IS BROADER THAN THE DOUBLE QUOTE THE BACKLOG ROW NAMED. A value
--    breaks on ", newline, tab, CR, backspace, formfeed or any control char --
--    and it breaks anywhere in the value, INCLUDING inside a jsonb object's or
--    array's string members. It does NOT break on a plain quote that is jsonb's
--    own delimiter ({"a": "b"} has no backslash), nor on non-ASCII.
--    Exact rule, validated 14/14 against the live cast: after collapsing '\\'
--    pairs, ANY remaining backslash errors.
--
-- ⚠️ AND THE LIVE WRITER FAILED OPEN. api/_shared/field-priority-guard.js
--    catches the non-ok RPC and returns {write:true}, so the curated write
--    landed and the provenance row was lost with no signal. That half is fixed
--    in the JS, not here: the DB must never be the thing that decides a curated
--    value is lost.
--
-- WHY THIS IS NOT A TABLE REWRITE (measured, not assumed)
-- ------------------------------------------------------
-- The obvious fix -- DROP COLUMN + ADD COLUMN ... GENERATED ... STORED, or
-- PG17's ALTER COLUMN ... SET EXPRESSION -- REWRITES THE WHOLE TABLE:
-- 1,270,785 rows, 497 MB heap + 528 MB indexes = 1,025 MB, on a 5,804 MB
-- database whose documented worst failure is disk-full -> GoTrue cannot INSERT
-- a session row -> TOTAL SIGN-IN LOCKOUT. Free disk is not measurable from SQL
-- or from the Supabase MCP surface, so that transient could not be sized here.
--
-- It is not needed. Two measurements make the cheap path provably safe:
--
--   (a) `ALTER COLUMN ... DROP EXPRESSION` is METADATA-ONLY. Probed on a
--       scratch table in this database: pg_relation_filenode 2831316 before and
--       2831316 after, every stored value byte-identical. It converts the
--       generated column into a plain column and RETAINS the data.
--
--   (b) ZERO of 1,270,785 stored `value`s contain a backslash at all
--       (strpos(value::text, chr(92)) -- NOT `LIKE '%\%'`, where backslash is
--       LIKE's own escape character and the predicate silently means "ends with
--       a literal %"). So the new expression reproduces every existing hash
--       byte-for-byte. This is the whole population, not a 10k sample.
--
-- Net: sub-second ACCESS EXCLUSIVE, no rewrite, no backfill, no transient disk,
-- and all 1,270,785 hashes preserved exactly as they stand.
--
-- Precedent for the trigger form: N15c made entities.canonical_name a single
-- BEFORE-trigger-owned derived column for the same reason -- a trigger does not
-- care how many writers a column has.
--
-- ⚠️ A BEFORE trigger is weaker than GENERATED ALWAYS in exactly one way: a
--    caller CAN supply value_text_hash. This trigger overwrites it
--    unconditionally on INSERT and on any UPDATE OF value, so the column stays
--    a pure function of `value` and a supplied hash is ignored, never trusted.
--
-- DEPLOY ORDER: this migration is SAFE IN EITHER ORDER relative to the Railway
-- deploy, and that is worth stating rather than leaving the reader to derive
-- it. It is not a CHECK constraint enforcing new writer output (the "constraint
-- after writer deploy" rule does NOT apply); it strictly WIDENS what
-- lcc_merge_field accepts. The deployed JS keeps working unchanged; the JS
-- change only adds a failure signal that will then read zero.
--
-- REVERSAL
--   drop trigger if exists trg_field_provenance_value_text_hash on public.field_provenance;
--   drop function if exists public.lcc_field_provenance_value_text_hash();
--   -- restoring GENERATED ALWAYS *would* rewrite the table; it also restores
--   -- the defect. Reverse only to a plain column, and only with a reason.
-- ============================================================================

-- 1. Generated -> plain column. Metadata-only; retains all existing values.
ALTER TABLE public.field_provenance
  ALTER COLUMN value_text_hash DROP EXPRESSION IF EXISTS;

-- 2. The single owner of value_text_hash.
--    convert_to(text,'UTF8') produces bytea from the text's actual UTF-8 bytes
--    and never parses escape sequences -- which is the entire fix.
CREATE OR REPLACE FUNCTION public.lcc_field_provenance_value_text_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.value_text_hash := encode(
    sha224(convert_to(COALESCE(NEW.value::text, ''), 'UTF8')),
    'hex'
  );
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.lcc_field_provenance_value_text_hash() IS
  'PR12: value_text_hash from convert_to(...,''UTF8''), never value::text::bytea. '
  'The bytea escape parser rejects jsonb''s \" \n \t \r \b \f \uXXXX escapes with '
  '22P02, which aborted the whole lcc_merge_field() call and lost the provenance row.';

DROP TRIGGER IF EXISTS trg_field_provenance_value_text_hash ON public.field_provenance;
CREATE TRIGGER trg_field_provenance_value_text_hash
  BEFORE INSERT OR UPDATE OF value ON public.field_provenance
  FOR EACH ROW
  EXECUTE FUNCTION public.lcc_field_provenance_value_text_hash();

COMMENT ON COLUMN public.field_provenance.value_text_hash IS
  'sha224 hex of value::text. Maintained by trg_field_provenance_value_text_hash '
  '(PR12, 2026-09-02); was GENERATED ALWAYS over value::text::bytea, which raised '
  '22P02 on any value containing " newline tab CR or a control character.';
