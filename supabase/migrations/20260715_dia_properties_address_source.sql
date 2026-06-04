-- Round 66x.2 follow-up — address provenance column for the master-address backfill.
-- The backfill (scripts/backfill-master-addresses.mjs --commit) rewrites legacy-
-- corrupted property addresses from the master comp workbook, gated on a <=5bp cap
-- fingerprint. Each rewrite is stamped address_source='master_curated' so the write
-- is auditable and selectively revertible by source tag (the property-level `source`
-- column is left untouched — it tracks record origin, not the address field).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS address_source text;

COMMENT ON COLUMN public.properties.address_source IS
  'Provenance of the address/city/state fields. master_curated = rewritten from the '
  'master comp workbook by the Round 66x.2 cap-fingerprint-gated backfill. NULL = '
  'legacy/import origin (see properties.source for record origin).';
