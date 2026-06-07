-- ============================================================================
-- R9 follow-up — route pipe-delimited composite owner entities to review (LCC Opps)
-- ============================================================================
-- CoStar captures glue a contact and their firm with a pipe ("Chad Middendorf |
-- Green Rock USA", "Vincent Curran | Palestra Real Estate Partners, Inc"), and
-- broker branding the same way ("CBRE | Raleigh", "SVN | Miller Commercial Real
-- Estate"). Minted whole, these became single entities whose person + firm
-- components often ALSO exist separately, with both drifting into P0.4. The
-- writer is now guarded (ensureEntityLink splitCompositeOwnerName resolves to the
-- FIRM + attaches the person — R9 JS). This SOFT-FLAGS the EXISTING composite
-- rows into the junk_entity_name Decision Center lane for disposition (merge /
-- rename / retype) — never a hard delete — preserving the original string in
-- metadata.composite_source_name so the reviewer (and the merge verdict) can see
-- the split. Auto-merges of the SAFE exact-firm-match subset are left to the lane
-- operator (the exact-merge worker's SAFE rule); see the session report for the
-- identified auto-mergeable candidates.
--
-- Scope: NON-asset only (asset names with pipes are listing-status-prefixed
-- addresses — "For Sale | 1164 Route 130" — and are NOT owner composites), and
-- only rows NOT already merged away (merged_into_entity_id IS NULL) and not
-- already flagged. Idempotent; preserves existing metadata.
-- DB-safety: additive metadata write, entity-scale, no auth-schema contact.
-- ============================================================================

UPDATE public.entities
   SET metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('junk_name_flagged', true,
                                        'junk_name_source', 'r9_composite_name',
                                        'composite_source_name', name),
       updated_at = now()
 WHERE entity_type <> 'asset'
   AND merged_into_entity_id IS NULL
   AND name LIKE '%|%'
   AND COALESCE((metadata->>'junk_name_flagged')::boolean, false) = false;

-- Pull the freshly-flagged rows into the junk_entity_name lane immediately.
SELECT * FROM public.lcc_refresh_decisions();
