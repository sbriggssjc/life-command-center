-- Dossier v2 lease abstract pass: guaranty scope for dialysis lease rows.
-- Responsibility columns already exist on dia.leases; this adds the missing
-- structured scope field requested for guarantor rendering.

alter table public.leases
  add column if not exists guaranty_scope text;

comment on column public.leases.guaranty_scope is
  'Lease/guaranty scope extracted from the source lease document. Examples: limited to Initial Term; excludes option periods. Null means not stated / not on file.';
