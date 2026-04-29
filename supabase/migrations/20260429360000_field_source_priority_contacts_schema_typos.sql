-- contacts rule cleanup (2026-04-29).
--
-- Same class of bug as PR #498 (gov listing schema): dia.contacts and
-- gov.contacts use different column names for the same semantic
-- concepts:
--   - email:  dia.contacts.contact_email   gov.contacts.email
--   - name:   dia.contacts.contact_name    gov.contacts.name
--   - phone:  dia.contacts.contact_phone   gov.contacts.phone
--
-- The registry had each table cross-pollinated with the *other* DB's
-- column names — scaffolding for columns that don't exist on the
-- target table. None of these triplets ever observed a real write
-- because no writer can patch a non-existent column.
--
-- Drops:
--   dia.contacts.email   (column lives at contact_email on dia)
--   dia.contacts.phone   (column lives at contact_phone on dia)
--   gov.contacts.contact_email  (column lives at email on gov)
--   gov.contacts.contact_name   (column lives at name on gov)
--
-- That's 4 (table, field) tuples × 5 sources each = 20 invalid rule
-- rows removed.
--
-- The intake-promoter.js companion change (this PR) splits the contact
-- provenance call by domain so the field names sent to lcc_merge_field
-- match the columns actually being patched.

delete from public.field_source_priority
 where (target_table = 'dia.contacts' and field_name in ('email','phone'))
    or (target_table = 'gov.contacts' and field_name in ('contact_email','contact_name'));
