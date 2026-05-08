-- Round 76ek.e — dia mirror of gov.property_financials column extensions.
-- See gov migration for full rationale.

BEGIN;

ALTER TABLE public.property_financials
  ADD COLUMN IF NOT EXISTS months_covered integer,
  ADD COLUMN IF NOT EXISTS line_items     jsonb;

CREATE INDEX IF NOT EXISTS property_financials_line_items_gin
  ON public.property_financials USING gin (line_items);

COMMENT ON COLUMN public.property_financials.months_covered IS
  'Round 76ek.e: number of months the statement covers. <12 = YTD partial.';

COMMENT ON COLUMN public.property_financials.line_items IS
  'Round 76ek.e: verbatim table rows from the source page, keyed by label.';

COMMIT;
