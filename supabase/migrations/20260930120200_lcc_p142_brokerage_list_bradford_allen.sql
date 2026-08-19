-- ============================================================================
-- P142 — add ONE named brokerage to lcc_owner_name_is_brokerage.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- Caught by reading the supersede dry-run SAMPLE before applying 463 writes:
-- "Bradford Allen Realty Services" was in the would-resolve set. Bradford Allen
-- is a Chicago CRE brokerage. Its one asset (1501 50th St., West Des Moines, IA)
-- has prior_owner "R&R Realty Group" -- both sides brokerage-shaped, which reads
-- like a listing artifact captured as a transfer rather than a real sale.
--
-- ⚠️ WHY A NAME AND NOT A PATTERN -- the important part of this migration.
-- My first instinct was a regex for
--   "realty services|real estate partners|asset management|property management"
-- Ten eligible candidates match it and NINE ARE REAL OWNERS:
--
--   Boyd Watterson Asset Management, LLC   x5   <- a major gov net-lease OWNER
--   FRANKLIN WAY REAL ESTATE PARTNERS, LLC
--   GOL PROPERTY MANAGEMENT LLC
--   Lowfield Realty Group Hudson LLC
--   Reynolds Asset Management LLC
--
-- Blocking Boyd Watterson alone would have removed one of the most important
-- owners in Team Briggs' gov book. Nine false positives to catch one true one is
-- the P138b lesson pointing the other way: there, a rejection guard would have
-- discarded 197 real owners wearing a "by <brokerage>" capture artifact.
--
-- lcc_owner_name_is_brokerage is a LIST OF NAMED FIRMS by design (northmarq,
-- cbre, jll, marcus & millichap...). It stays that way. "Asset Management",
-- "Realty Services" and "Real Estate Partners" are ordinary words in owners'
-- legal names; only the firm name identifies an agent.
--
-- GATE (8/8 live): bradford allen / marcus & millichap / northmarq blocked;
-- Boyd Watterson, Franklin Way, GOL, Lowfield and Reynolds all still pass.
--
-- Inherited caveat unchanged: the bare \mmarcus\M arm would still trip a genuine
-- "Marcus Family Trust", which is why callers surface the flag rather than
-- dropping rows on it silently.
--
-- REVERSAL: re-create the function without the trailing `|bradford allen` arm.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_brokerage(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  select coalesce(p_name,'') ~* '(\mnorthmarq\M|\mcbre\M|\mjll\M|\mcolliers\M|\mnewmark\M|cushman|marcus\s*&?\s*millichap|\mmatthews\M|berkadia|\mhanley\M|capital pacific|\mnai\M|stream realty|kw commercial|avison|stan johnson|\msjc\M|coldwell banker|\mkeller williams\M|\mmarcus\M|peerrealty|\bsperry\b|\mlee\s*&\s*associates\M|\mcresa\M|\msvn\M|\mtranswestern\M|bradford allen)';
$$;

COMMENT ON FUNCTION public.lcc_owner_name_is_brokerage(text) IS
  'A brokerage is the AGENT, never the principal. A LIST OF NAMED FIRMS, not a '
  'pattern -- "Asset Management" / "Realty Services" / "Real Estate Partners" are '
  'ordinary words in owners'' legal names (Boyd Watterson Asset Management is a '
  'major gov net-lease OWNER), so only a firm name identifies an agent. P142 '
  'added bradford allen. Caveat: the bare \mmarcus\M arm would trip a genuine '
  '"Marcus Family Trust", so surface the flag rather than dropping silently.';
