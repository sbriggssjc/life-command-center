# ID3a-c — Finish the agency class: DHS components, one consistent GSA rule, the registry rows, and the wiring

**Repo: `life-command-center`.** Government DB. Closes ID3a/ID3a-b. **Read the DEPLOYED definition of every object
you touch before editing it** (new invariant **I16** — ID3a-b found `canonicalize_agency()` had drifted from its
committed migration).

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P0d **ID3a**, **ID3a-b**, **ID3a-c**, ID3i · `docs/claude-code/STATUS.md`
2026-09-12 entries · `docs/architecture/data-coherence-invariants.md` **I13 and I16** ·
`supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql` (including its
`gov_using_agency_from_gsa()`) · the ID3a wiring migration and its alias/review tables.

## Why this, why now (Cowork live check, 2026-09-12)

ID3a-b's contamination fix is live and holding: NAVY 150 → 3, STATE 213 → 9, DOC 16 → 1, ICE 44 → 43, with
`Department of the Navy` still resolving correctly. Three things remain, and one is a wrong answer rather than a
missing one:

1. **DHS components are conflated.** `canonicalize_agency('Immigration & Customs Enforcement')` returns **`CBP`** —
   the `customs` branch matches first — so **16 `GSA - Immigration & Customs Enforcement` properties carry
   using-agency CBP**. ICE and CBP are different DHS components and a gov-lease report must not merge them. Bare
   `ICE` correctly returns `ICE`. Related: `Border Patrol` → NULL (that is CBP), `Dept of Homeland Security` → NULL
   even though **DHS is already a registry row**.
2. **The GSA rule is applied two different ways.** Of 623 `GSA - <AGENCY>` properties, 473 correctly keep
   `agency_canonical = 'GSA'` with the occupant in `using_agency_canonical`; **150 `GSA - Social Security Admin`
   rows put `SSA` in the lease-counterparty column instead.** Scott's rule, 2026-09-12: *"the tenant is the GSA but
   the user is whatever is second."* Make all 623 consistent, and say which column each agency report groups on.
3. **§3 and §4 of ID3a-b never landed.** `government_agencies` is still **65 rows** — none of NAVY, ARMY, DOC
   (US Commerce, distinct from the state-corrections reading), LSC, DOL, USGS, NRC, NIH, NLRB, USAF, TREAS. And no
   new FK links: `properties.agency_id` is still **7,369 of 20,509**, with **1,347 canonicalized-but-unlinked** and
   8,838 rows carrying agency text with no canonical at all. The review lane holds **1,483 open** rows.

## 1. DHS components, and the branch-order class behind them

Fix the ICE/CBP ordering, map `Border Patrol` to CBP, resolve `Dept of Homeland Security` to the existing DHS row,
and re-canonicalize the affected rows. Then **sweep the whole function for the same shape**: any branch whose
pattern is a substring of a longer, more specific agency name that a later branch owns. Report every pair you find
— this is the same class as ID3a-c's sibling row (DOJ/EPA/DOL/ED/DOT vs their same-named state agencies), so fold
that in if it is the same fix. Fixtures come from the real strings, with positive controls both ways.

## 2. One GSA rule

`agency_canonical` = the lease counterparty (GSA) for all 623; `using_agency_canonical`/`_full` = the occupant.
Fix the 150 SSA rows. Populate the 167 GSA-compound rows still missing a using-agency (`GSA - Border Patrol`,
`GSA - Dept of Homeland Security`, and the rest) once §1 lands. **Then state, per existing agency-facing report or
view, which column it groups on today and whether that changes its numbers** — measure it, don't assume.

## 3. Registry rows, then the wiring

Add the 11 missing agencies with provenance, confirm the `ACE` → `USACE` alias (case-sensitive, so `Ace Hardware`
can't collide), then backfill `properties.agency_id` and `property_agencies.agency_id`: the 1,347
canonicalized-but-unlinked first, then whatever the 8,838 uncoded rows resolve to. **Auto-apply exact and alias
matches only; everything else to review with its raw text.** Report the auto/review split before applying.

## 4. Triage the review lane

1,483 open rows. Break it down: genuinely unregistered agencies, non-government tenants (the Navy Federal class),
ambiguous state-vs-federal readings, and junk/archived rows. Say how many need a human and how many need a registry
row — a queue nobody can finish is the failure mode this program exists to avoid.

## 5. Parity and the detector

Agency counts before and after, SSA especially (its four spellings plus the GSA-compound rows should converge, and
§2 decides on which column). Then finish what ID4 deferred to this class: the **I13 identity detector for agencies**,
registered and scheduled only after one green run under real credentials.

## What NOT to do

No county/city work (ID3e). No owner or broker identity. No consumer rewrites beyond pointing existing agency
groupings at the FK, each measured before and after. Never auto-resolve what the comparator can't settle.

## Guard + ship

Tests: ICE vs CBP vs Border Patrol vs DHS, the branch-order sweep's fixtures, GSA-rule consistency across all 623,
registry/alias provenance, backfill split, guard rejection. Full suite green. Branch → PR → CI → merge → redeploy
BOTH Railway services if `api/` changed.

## Ship + record

Update `PLANNED-BACKLOG.md` §P0d (ID3a, ID3a-b, ID3a-c, the sibling contamination row), `data-coherence-invariants.md`
(I13 status for this class; **I16** if you build any part of the drift detector), `STATUS.md`, `CURRENT-STATE.md`.
Report: the branch-order pairs found, the GSA parity table, registry additions, coverage before/after on both FK
columns, and the review-lane breakdown.
