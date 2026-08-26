-- P190 — Scott's two Tier 0 decisions, 2026-08-26, applied live.
--
-- ============================================================================
-- DECISION 1 — "Drop all universities."
-- ============================================================================
-- Scott's explicit call, made with the cost stated: this removes **George Washington University
-- ($23.8M) and Georgetown University ($8.0M)** from prospecting along with the public ones
-- (University of Memphis, UNC Health Care System). I had flagged dropping all universities as the
-- destructive option; he chose it deliberately, and it is coherent with the doctrine — a
-- university is an institutional owner-occupier, not a net-lease investor we would show deals to.
--
-- ⚠️ ONLY PROSPECTING IS AFFECTED. Ownership reconciliation is untouched: these owners keep their
-- properties, portfolio facts, relationships and every ownership surface.
--
-- ⚠️ WHY A NEW FUNCTION AND NOT AN ADDITION TO `lcc_owner_name_is_public_body`:
--   Georgetown is not a public body. Overloading that predicate would make it lie, and it is
--   consumed by two other surfaces. Instead `lcc_owner_name_is_not_prospected()` composes the two,
--   and IS the single source of truth for "we do not prospect this owner type". Point every
--   prospecting surface at it, never at its parts, or the definitions drift.
--
-- The university test is measured, not assumed. Fleet-wide it catches 87 organisations, all read
-- and confirmed genuine (Boise State, Drexel, Johns Hopkins, Purdue, Rice, Defense Acquisition
-- University...). **The trailing-"University" arm carries a negative guard** because one row fails
-- without it: `Nahmco Llc-s Series 2015 University` is a private LLC whose name merely ends in the
-- word. A real university is not an LLC / LP / numbered series. 15/15 named-row gate, expectations
-- stated before the run, including the place-name traps ("Boyd College Station TX LLC",
-- "University Park Plaza LLC", "City of College Park") which must NOT match.
--
-- Measured impact on the other two prospecting consumers, before changing anything:
--   v_lcc_top_seller_prospects        4,118 rows -> would drop 17
--   v_lcc_owner_contact_decidability    311 rows -> would drop  2
-- ⚠️ THOSE TWO ARE NOT REPOINTED HERE — they still call `lcc_owner_name_is_public_body` directly,
--   so universities remain in THEIR scope. That is a KNOWN, DELIBERATE INCONSISTENCY held for one
--   round rather than a blind rewrite of a 4,118-row seller surface at the end of a session. It is
--   the drift this file warns about, and it must be closed next (prompt 190a).
--
-- ============================================================================
-- DECISION 2 — the curated sponsor-acronym map (4 of 6 entries confirmed)
-- ============================================================================
-- P187 built, measured and REJECTED a rule-based acronym arm: "a 3-4 char ALL-CAPS token is an
-- acronym" scored ~30-40% precision, because **27.6% of owner names (212 of 769) are ENTIRELY
-- uppercase** — that is the government SPE naming convention, not an acronym signal. It produced
-- `BOYD DEL RIO GSA LLC` -> **dell.com** and `1445 ROSS AVE LLC` -> **avera.org**.
--
-- A CURATED map of a few human-confirmed entries is strictly more precise than any such rule.
-- Scott confirmed FOUR on 2026-08-26 and explicitly deferred two:
--   ✅ ngp  -> ngpv.com    UIRC/HPI/JBG below; NGP is by far the largest
--   ✅ uirc -> uirc.com
--   ✅ hpi  -> hpitx.com
--   ✅ jbg  -> jbg.com
--   ⏸️ fcp  -> fcpdc.com   HELD — Scott: "I'm unsure on that fourth one and would need to google
--   ⏸️ tmg  -> tmgdc.com   and check SF and our records to confirm." NOT seeded. Do not add them
--                          without a recorded confirmation; TMG in particular also matched an
--                          unrelated tmgre.com during measurement.
--
-- `lcc_owner_sponsor_domain` rows are HUMAN DECISIONS, never inferred. `confirmed_by` is required.
--
-- ============================================================================
-- MEASURED RESULT (live, 2026-08-26) — expectations stated before the run
-- ============================================================================
--   candidate pairs        558 -> 650      owners       208 -> 226
--   open lane cards        237 -> 260      sponsor arm   93 pairs / 25 owners / $123.4M
--   George Washington University -> 0 ✓    Georgetown -> 0 ✓   (universities dropped)
--   Boyd Watterson -> 2 ✓                  RMR Group  -> 20 ✓  (nothing regressed)
--
-- NGP alone contributes 17 owners and $105.5M across its SPE variants — the single largest
-- coverage gain of the whole Tier 0 arc, and it was unreachable by any rule.
--
-- ⚠️ The view body below is P188's, byte-identical except for the two changes above. The column
--    list is UNCHANGED at 15 (P188 appended match_arm/match_key; an earlier attempt here dropped
--    them and Postgres correctly refused with 42P16 "cannot drop columns from view"). Arm 3 rides
--    the existing arms/keys plumbing as `sponsor_map`.
--
-- REVERSAL: delete the four `lcc_owner_sponsor_domain` rows and/or re-point the `owners` CTE at
-- `lcc_owner_name_is_public_body`. No data is written by any of this.

create or replace function public.lcc_owner_name_is_university(p_name text)
 returns boolean language sql immutable as $function$
  select coalesce(p_name,'') ~* '(\muniversity of\M|\mcollege of\M|^the university\M|\mregents\M|\mtrustees of\M|\mcommunity college\M|\muniversity\M\s+(health|system|hospital|medical)\M)'
      or (
        coalesce(p_name,'') ~* '\muniversit(y|ies)\M\s*$'
        and coalesce(p_name,'') !~* '\m(llc|l\.l\.c|lp|l\.p|inc|corp|corporation|series|trust|dst|holdings|partners)\M'
      );
$function$;

create or replace function public.lcc_owner_name_is_not_prospected(p_name text)
 returns boolean language sql immutable as $function$
  select lcc_owner_name_is_public_body(p_name) or lcc_owner_name_is_university(p_name);
$function$;

comment on function public.lcc_owner_name_is_not_prospected(text) is
  'Owner types Scott has ruled OUT of prospecting (2026-08-26): municipalities/public bodies, and '
  'ALL universities -- public and private alike, his explicit call, which costs George Washington '
  '($23.8M) and Georgetown ($8.0M). Ownership reconciliation is UNAFFECTED. Single source of truth '
  'for the prospecting exclusion; point every prospecting surface at THIS, not at its parts.';

create table if not exists public.lcc_owner_sponsor_domain (
  sponsor_token text primary key,
  email_domain  text not null,
  confirmed_by  text not null,
  confirmed_at  timestamptz not null default now(),
  notes         text
);

comment on table public.lcc_owner_sponsor_domain is
  'CURATED sponsor-acronym -> email-domain map for Tier 0 owner-contact matching. Exists because '
  'the RULE-based acronym arm was measured at ~30-40% precision and rejected. Every row is a HUMAN '
  'decision, never inferred. Add a row only with an explicit confirmation in confirmed_by.';

insert into public.lcc_owner_sponsor_domain (sponsor_token, email_domain, confirmed_by, notes) values
 ('ngp','ngpv.com','scott 2026-08-26','NGP Capital + 10 SPE variants (17 owners, $105.5M). David Kent, Fran Cowan, Kim Phillips independently confirmed as NGP principals in account-based-contact-intelligence.md 3b.'),
 ('uirc','uirc.com','scott 2026-08-26','UIRC-GSA * LLC sponsor (5 owners, ~$4.9M); domain matches the acronym exactly, 7 people on file.'),
 ('hpi','hpitx.com','scott 2026-08-26','HPI Capital / HPI Group (2 owners, ~$10.1M), Austin TX. Kent Lance, Richard Hill.'),
 ('jbg','jbg.com','scott 2026-08-26','JBG (DC developer) for JBG/PICKETT OFFICE LLC. Brian Coulter, George Xanders, Michael Perlman.')
on conflict (sponsor_token) do nothing;

-- The view body applied live is P188's with (a) the `owners` CTE calling
-- lcc_owner_name_is_not_prospected, and (b) ARM 3 appended to matched_raw:
--
--   union
--   select distinct o.owner_id, p.person_id, 'sponsor_map'::text, sd.sponsor_token
--   from owners o
--   join lcc_owner_sponsor_domain sd on o.owner_name ~* ('\m'||sd.sponsor_token||'\M')
--   join people p on p.domain = sd.email_domain
--
-- The full definition is in 20260827020000_lcc_p188_tier0_confirm_lane_views.sql; read the LIVE
-- definition (pg_get_viewdef) as the authority. It is not duplicated here to avoid two copies
-- drifting apart.
