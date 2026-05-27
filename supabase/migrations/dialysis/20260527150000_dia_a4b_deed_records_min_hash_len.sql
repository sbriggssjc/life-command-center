-- A4b (2026-05-27): forward-only guard preventing the synthetic-hash pattern
-- from recurring on dia.deed_records.
--
-- An A4b investigation found 592 synthetic deed rows with 16-hex-char
-- data_hash values (e.g. "c810e0685768fb13"), produced by a non-production
-- scaffolding writer in two batches (March 31 + May 20-23, 2026). All real
-- writers — sidebar's upsertDialysisDeedRecords (base64 of
-- "document_number|state|date") and deed-parser's deed_parser — produce
-- hashes of length >= 24. The CHECK blocks any future row from landing
-- with a hash shorter than that.

ALTER TABLE public.deed_records
  ADD CONSTRAINT chk_deed_records_data_hash_min_len
  CHECK (length(data_hash) >= 24);

COMMENT ON CONSTRAINT chk_deed_records_data_hash_min_len ON public.deed_records IS
  'A4b (2026-05-27): blocks synthetic-hash deed_records rows (hashlen < 24). All real writers produce hashes >= 24 chars; only test scaffolding produces shorter ones.';
