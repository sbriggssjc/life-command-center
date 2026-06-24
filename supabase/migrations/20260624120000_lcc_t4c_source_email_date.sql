-- T4c (2026-06-24): capture the OM email's TRUE Date at ingest (LCC Opps).
--
-- The on-market-date ladder's step 1 is "earliest email received date". Today
-- it requires a Gmail round-trip via internet_message_id — but that column is
-- empty on every staged_intake_items row and raw_payload carries no email Date,
-- so the date is unrecoverable for the historical mass-forwarded set. Going
-- forward, the flagged-email PA flow's receivedDateTime/sentDateTime is
-- persisted here at ingest, so the ladder becomes a LOCAL read and a future
-- mass re-forward of the mailbox can never move a market date (the signal is
-- the immutable email Date, not the clustered created_at ingest clock).
--
-- Additive + reversible (DROP COLUMN). The writer
-- (intake-om-pipeline.js stageOmIntake) populates it on the email channel only,
-- from the RAW received date (NULL when the email genuinely carries none —
-- never the now()-coalesced fallback). intake.js also begins persisting
-- internet_message_id (previously hard-coded NULL), so future emails are
-- Gmail-traceable too.
ALTER TABLE public.staged_intake_items
  ADD COLUMN IF NOT EXISTS source_email_date timestamptz;

COMMENT ON COLUMN public.staged_intake_items.source_email_date IS
  'T4c: the email''s true Date header (receivedDateTime/sentDateTime) captured at ingest, email channel only, RAW (never now()-coalesced). Feeds the on-market-date email_received tier; NULL when the email carried no date.';
