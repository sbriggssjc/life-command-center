# ID3a — Wire the government agency identity that already exists, and prove the identity detector on this one class

**Repo: `life-command-center`.** Scott's #1 identity class (2026-09-12). Government DB. The registry and the
normalizer already exist and work — this is a **wiring** job, not a cleanup invention.

**Read first:** `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` §9.1 · `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`
· `docs/audits/ID4_IDENTITY_INTEGRITY_BASELINE_2026-09.md` (framework decision: **per-class comparators, never one
shared normalizer**) · `docs/os/PLANNED-BACKLOG.md` §P0d ID3a, ID4, ID2a (the pattern to copy) ·
`docs/architecture/data-coherence-invariants.md` I13/I14 · `CLAUDE.md` Core doctrines · the ID2a migrations as the
reference implementation (registry + alias + resolver + hard guard + reviewed backfill + parity view).

## Why this, why now

Measured live (Cowork + ID1 §9.1, confirmed 2026-09-11):

- `government_agencies` exists: **65 rows**. `properties.agency_canonical` exists and works: **1,286 raw strings →
  45 clean codes**.
- **Nothing is wired.** `properties.agency_id`: **0 of 20,509**. `property_agencies.agency_id`: **160 of 132,243**
  (0.12%), against 498 unnormalized codes on that bridge.
- The raw strings behind it: SSA as `SSA` 723 · `Social Security Administration (SSA)` 430 · `GSA - Social Security
  Admin` 150 · `Social Security Administration` 75; VA as `US Department of Veteran Affairs` 1,216 · `…Veterans
  Affairs - 1` 289 · `VA` 212 · `VETERANS AFFAIRS` 128 · `U.S. Department of Veterans Affairs` 112.
- **Two traps, both real:** `RICHMOND FIELD OFFICE (VA)` (74 rows) is almost certainly **Virginia**, not Veterans
  Affairs — a string match would file it under the wrong agency. And `ACE` (property 30447, 614 Tully Rd) is the
  Army Corps, which the normalizer doesn't resolve — `agency_canonical` is NULL there.

Every agency-level report — the CM by-agency charts, the gov lane's rollups — groups on the raw string today.

## 1. Measure before wiring

Report, per `agency_canonical` code and for the NULL bucket: property counts, the raw strings feeding each code, and
the registry row each code maps to (or doesn't). Do the same for `property_agencies.agency_code`'s 498 values. Name
every code with no registry row and every registry row nothing maps to. **The NULL bucket is the finding** — that is
where `ACE` and the ambiguous strings live.

## 2. Wire it (the ID2a pattern)

- Alias table for agencies (raw string → `agency_id`, with provenance), seeded from the working `agency_canonical`
  map plus every registry name and its abbreviations.
- Backfill `properties.agency_id` and `property_agencies.agency_id` from it. **Auto-apply only exact and alias
  matches; everything else to the review lane with its raw text intact.** Report the auto/review split first.
- **Ambiguity goes to a human, once.** `(VA)` as a state suffix vs Veterans Affairs, `ACE`, and anything else the
  comparator can't settle. Resolve it and the answer becomes an alias — never a guess, never a regex that "usually"
  works.
- Hard write guard plus alert on both columns, matching the operator guard.
- Parity view: property counts per agency before and after. The only movement should be variants merging into one
  code, e.g. SSA's four strings.

## 3. Prove the detector here (ID4's decision)

Ship the **I13 identity detector for this one class**: the collapse and orphan counts for the agency columns, using
an agency-specific comparator (codes and abbreviations — **not** the generic alnum key, which is unsafe on other
columns), registered in the `v_id2a_identity_columns_for_i13`-style registry ID2a seeded. Schedule it only after it
runs green once under real credentials (the D1h lesson), with the alert on the I11 dedup path. Write down what
generalizing it to the next class would take — that is ID4's framework, earned rather than assumed.

## 4. What NOT to do

No county/city vocabulary work (ID3e is next, separately). No owner or broker identity (ID3b/ID3c; ID3c is on hold
for BR1–BR5). No cross-lane property linking (ID3i/P10a) beyond noting the twins you encounter. No consumer rewrites
beyond pointing existing agency groupings at `agency_id`, and measure each one's before/after.

## Guard + ship

Tests: alias resolution, the `(VA)` ambiguity routing to review rather than matching, guard rejection, backfill
auto/review split on fixtures, the detector's counts. Full suite green. Branch → PR → CI → merge → redeploy BOTH
Railway services.

## Ship + record

Report: the code census, auto/review split, FK coverage before/after on both columns, the parity table (SSA and VA
especially), what the review lane holds, and the detector's first green run. Update `PLANNED-BACKLOG.md` §P0d (ID3a,
ID4 detector status), `data-coherence-invariants.md` (I13 status for this class), `STATUS.md`, `CURRENT-STATE.md`.
