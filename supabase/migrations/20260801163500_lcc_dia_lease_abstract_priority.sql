-- Register dossier v2 Dia lease-abstract fields for the provenance ladder.
-- Source matches api/_handlers/lease-extractor.js::buildRealLeaseDeps
-- mergeField source='folder_feed_lease'.

insert into public.field_source_priority (target_table, field_name, source, priority, enforce_mode, notes)
select v.target_table, v.field_name, 'folder_feed_lease', 45, 'record_only',
       'Dossier v2 lease abstract pass — guaranty scope and dialysis responsibility split from source lease document.'
from (values
  ('dia.leases','guaranty_scope'),
  ('dia.leases','roof_responsibility'),
  ('dia.leases','structure_responsibility'),
  ('dia.leases','parking_responsibility'),
  ('dia.leases','hvac_responsibility')
) as v(target_table, field_name)
on conflict (target_table, field_name, source) do update
  set priority = excluded.priority,
      enforce_mode = excluded.enforce_mode,
      notes = excluded.notes,
      updated_at = now();
