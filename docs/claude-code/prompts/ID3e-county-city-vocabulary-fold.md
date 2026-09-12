# ID3e — Collapse the county/city vocabulary that only differs by case, without ever merging across state

**Repo: `life-command-center`.** Scott's #2 identity class (2026-09-12, ranking confirmed in `PLANNED-BACKLOG.md`
ID4 row: ID3a → **ID3e** → ID3b → ID3d → ID3c-last). Government DB + Dialysis_DB. This is a controlled-vocabulary
job (I14), not an identity/FK-wiring job like ID3a — there is no registry table and no `_id` column to fill in;
the fix is normalizing the stored strings themselves (or adding a generated/normalized column), so the write guard
and backfill shape from ID2a/ID3a doesn't directly apply here. Design the mechanism to fit this problem, don't copy
the FK-wiring pattern by default.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P0d ID3e, ID4 · `docs/architecture/data-coherence-invariants.md` I14
· `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md` · `docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md`
(framework decision: **per-class comparators, never one shared normalizer** — this class's comparator is
`lower(trim(county)), lower(trim(state))` as a **pair**, never county alone) · the ID3a audit
(`docs/audits/ID3a_GOV_AGENCY_IDENTITY_WIRING_2026-09-12.md`) for the shape of "measure the traps before touching
anything."

## Why this, why now

Measured live against gov Supabase (Cowork, 2026-09-12):

- `properties.county`/`state`: **2,449 raw (county, state) pairs → 1,615 after `lower(trim())` on both columns —
  834 collapse.** Pure case/whitespace noise on the majority: `El paso`/`El Paso`/`EL PASO` (CO, 150 props),
  `Maricopa`/`MARICOPA` (AZ, 671 props), `Los Angeles`/`LOS ANGELES` (CA, 344 props), etc. — case-only, no semantic
  ambiguity in the top groups.
- `properties.city`/`state`: **3,459 raw pairs → 3,230 after fold — 229 collapse.** Same shape, smaller population.
- Dialysis_DB `medicare_clinics.city`/`state`: **4,367 raw pairs → 3,635 after fold — 732 collapse.**

**Two real traps, found by looking past the simple case-fold (do this measurement again before building — these
counts will have drifted):**

1. **Cross-state name collisions are real counties, not duplicates — never fold on name alone.** `St. Louis`
   exists as a real, separate county in **both MN and MO**. `Le Flore` (OK) and `Leflore` (MS) are two different
   counties that happen to sound alike. `LaSalle` is a real county in both **IL and TX**. `DeSoto` is a real county
   in both **FL and MS**. Any comparator that strips state before comparing would wrongly merge these. The
   `(county, state)` pair, never `county` alone, is the identity — this is this class's version of ID3a's
   `(VA)`-suffix trap.
2. **Virginia's independent cities are punctuation variants of each other, never of the county sharing their
   name.** `RICHMOND (CITY)` / `Richmond city` / `Richmond City` are the same jurisdiction and should fold together
   (17 such VA city groups measured: Richmond, Alexandria, Norfolk, Newport News, Roanoke, Hampton, Fredericksburg,
   Suffolk, Chesapeake, Virginia Beach, Charlottesville, Fairfax, Harrisonburg, Winchester, Bristol, Staunton,
   Petersburg — 190 properties total). But Virginia independent cities are **not part of any county** — `Richmond
   city` and a hypothetical `Richmond County, VA` (a real, separate rural county in the Northern Neck) are
   different jurisdictions and must never be folded into each other just because "richmond" matches. Keep the
   `(city)`/`city` suffix as a meaningful token in the comparator, don't strip it as noise.
3. **Two rows have corrupted `state` values outright** (`property_id 16465`: `state='|'`, `county='Franklin'`,
   address `7940 Preston Rd`; `property_id 6638`: `state='M'`, `county='Hanover'`, `city='Rockville'` — `city`
   strongly suggests MD, but that conflicts with `county='Hanover'`, which doesn't fit Rockville). Both need a
   human look, not a guessed fix — route to review, don't infer.

**Scoped out, deliberately — this is a different problem shape:** `dialysis.properties.property_type` (96 raw
values) is **not** primarily a case-vocabulary problem — only 9 of 96 values collapse under `lower(trim())`
(96 → 87). The rest (`single-tenant medical` vs `Healthcare` vs `Dialysis Clinic` vs `ST`/`MT` abbreviations vs
`Office - Sub/medical`) is a semantic-rollup/taxonomy decision, closer in shape to ID3a's agency canonicalization
than to a case-fold. It was in this row's original scope note but measuring it live shows it needs its own
comparator design and its own human decision on category boundaries — **do not bundle it into this build.** File
it as its own follow-up (`ID3e-property-type-taxonomy`) instead.

## 1. Measure before folding (repeat live, counts above are a point-in-time snapshot)

Re-run the three counts above. For each `(county, state)` normalized group with >1 raw variant, list the raw
strings and property counts (as done for the top 20 above) and confirm every group is a true case/whitespace/
punctuation variant of the same real jurisdiction — never assume, check the ones with unusual shapes (anything
that isn't pure case, e.g. `Miami-Dade` vs `Miami/Dade`, `ST LOUIS` vs `St. Louis`) individually. Flag anything
that looks like it might actually be two different places sharing a near-identical name (the multi-state
same-name counties above are confirmed real and must NOT fold — recheck for others like them).

## 2. Fold it

- Add a normalized form (generated column or a paired lookup — pick whichever the actual consumers can adopt
  without a rewrite; measure what reads `county`/`city`/`state` today before choosing) keyed on
  `(lower(trim(county)), lower(trim(state)))` and `(lower(trim(city)), lower(trim(state)))` respectively. Never key
  on the name alone.
- Punctuation/whitespace variants (`Miami-Dade`/`Miami/Dade`, `ST LOUIS`/`St. Louis`, `LA SALLE`/`LaSalle`) fold
  together **only within the same `(name, state)` group** — confirm each one is genuinely the same place first.
- The two corrupted-`state` rows (16465, 6638) go to a short human-review list with their addresses — do not guess
  the state.
- Parity view: property counts per normalized (county, state) and (city, state) before/after. The only movement
  should be variants merging into one form — no property should move between groups with different real states.

## 3. What NOT to do

No agency/owner/broker identity work (that's ID3a — shipped — and ID3b/ID3d/ID3c, later in the ranking). No
`property_type` taxonomy work (see scoped-out note above — file `ID3e-property-type-taxonomy` instead and stop).
No detector generalization here — ID4's decision is to generalize the I13/I14 shared shape only after it's proven
on **two** populations; this ships the second data point, the generalization is ID4's own follow-up, not this
build's.

## Guard + ship

Tests: the fold function/view on fixtures including the cross-state same-name cases (must NOT merge) and the VA
city-vs-county case (must NOT merge), the two corrupted-state rows routing to review, parity counts. Full suite
green. Branch → PR → CI → merge (no Railway redeploy needed unless a consumer view/API changes — note which ones
do).

## Ship + record

Report: raw/normalized pair counts before/after for all three surfaces, the parity table, the corrupted-state
review list, and confirmation no cross-state merge occurred. Update `PLANNED-BACKLOG.md` §P0d (ID3e, and file
`ID3e-property-type-taxonomy` as a new 🔴 row), `docs/architecture/data-coherence-invariants.md` (I14 status for
this class), `STATUS.md`, `CURRENT-STATE.md`.
