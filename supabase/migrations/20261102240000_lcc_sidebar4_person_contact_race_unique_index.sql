-- SIDEBAR4 (2026-09-22) — DB backstop against twin PERSON entities minted by
-- two concurrent writers for the same contact.
--
-- Incident: CoStar sidebar capture of 506 N Patterson St (entity 68874e8d),
-- 2026-09-18. ONE capture payload (every row carries extracted_at
-- 19:51:47.140Z) was processed by TWO overlapping sidebar-pipeline runs; the
-- second started a few seconds after the first and caught up with it. Most of
-- its writes resolved onto rows the first run had already created, but every
-- name both runs reached in the same instant was minted twice:
--   person       "John Messer"                  19:52:11.009 / .035  (26 ms)
--   organization "W Wayne Fann"                 19:52:12.760 / .764  ( 4 ms)
--   organization "Pineview Real Estate Grp Llc" 19:51:57.232 / .311  (79 ms)
-- ensureEntityLink's canonical_name lookup is a check-then-insert; nothing
-- serialises two callers that both check before either inserts.
--
-- Class size, measured live on LCC Opps 2026-09-22 over LIVE person entities
-- grouped on (workspace_id, canonical_name, coalesce(email, phone)):
--   78 groups / 156 rows collide; 42 of the 78 were created < 2 s apart (the
--   race signature), newest 2026-09-18; 33 are >= 1 day apart (a different
--   defect: a lookup that missed, not a race).
-- Those 78 are NOT merged here (backlog SIDEBAR4-b) — so a plain unique index
-- cannot be built. This index is PARTIAL on created_at >= the ship time: it
-- governs exactly the population the race produces (two rows created
-- concurrently, both after the cutoff) and nothing that already exists.
-- A new row duplicating an OLD row is still ensureEntityLink's job (its
-- canonical_name / email lookup resolves it); only the concurrent case needs
-- a constraint, because only there does the lookup structurally miss.
--
-- The key, and why:
--   * canonical_name — written by the N15c BEFORE trigger (single owner).
--   * coalesce(email, phone) — same name + same mailbox/phone is one person.
--     Same name alone is NOT identity (two real "Frank Johnson"s exist), so a
--     row with neither email nor phone is left out of the index entirely.
--     Email is lower/trimmed; phone is reduced to digits so "(229) 561-7608"
--     and "229-561-7608" are one key.
--   * persons only, live only (merged_into_entity_id IS NULL) — a merge
--     tombstone must not block its survivor.
-- Organizations are deliberately NOT covered: a same-name org has no
-- corroborating key, and (workspace_id, canonical_name) uniqueness is N15e's
-- open decision (6,608 violating groups). The org half of the race is closed
-- by the in-process single-flight in processSidebarExtraction instead.
--
-- Writer contract: ensureEntityLink catches the resulting 23505 (PostgREST
-- HTTP 409) on its person INSERT and re-resolves to the row that won, so the
-- losing caller attaches instead of failing. See api/_shared/entity-link.js
-- (SIDEBAR4).
--
-- Reversible: DROP INDEX public.uq_entities_person_contact_key_sidebar4;

create unique index if not exists uq_entities_person_contact_key_sidebar4
  on public.entities (
    workspace_id,
    canonical_name,
    (coalesce(
       nullif(lower(btrim(email)), ''),
       nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
     ))
  )
  where entity_type = 'person'
    and merged_into_entity_id is null
    and canonical_name is not null
    and created_at >= timestamptz '2026-09-22 21:00:00+00'
    and coalesce(
          nullif(lower(btrim(email)), ''),
          nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
        ) is not null;

comment on index public.uq_entities_person_contact_key_sidebar4 is
  'SIDEBAR4: one live person per (workspace, canonical_name, email-or-phone) among rows created after 2026-09-22 21:00 UTC. Backstop for concurrent mints; ensureEntityLink re-resolves on 23505.';
