# PR5 — triage the 39 registered ladder sources that have never written a field (build / rename / retire), plus the one live unregistered writer

**Repo: `life-command-center`.** Reads against **LCC Opps `xengecqvemvfknjvbvrq`** (`field_source_priority`,
`field_provenance`, `v_field_provenance_effective_source`, `v_field_provenance_unranked`) and both domain
DBs for the writer grep. **Diagnosis-heavy, small write.** Unblocked by PR8 (the registry is now the
allowlist, so a registration here is load-bearing — which is exactly why an unexercisable one is a
false claim about authority).

**Read first:** `docs/architecture/public-records-source-lane.md` §2 (PR5 block, the 2026-09-02
re-key: **68 registered · 39 never written · 21 write-but-unregistered**) and §2a (PR8 — why a
registered source now ARMS). Then backlog rows **PR5, PR7, PR9, PR10** in `docs/os/PLANNED-BACKLOG.md`
and `CLAUDE.md` § "Field-level data provenance". Playbook **Class 31**.

## What is already known — do not re-derive, verify in one query each

- The 39 split into two causes that read identically and need OPPOSITE fixes: **registered ahead
  of a build** (`gliner_extract`, `w9_2_internal_harvest`, `sos_registry` — bot-walled, documented;
  `county_records` — refused by decision, PR1) vs **vocabulary drift** (the writer ships under a
  different spelling). **Distinguish by grepping the WRITERS for the concept, not the string** —
  `api/`, `supabase/functions/`, `scripts/`, and the two domain repos' `src/` if mounted.
- **`manual`@1 with 0 rows is NOT a hole** — `manual_edit` (207 rungs @1, 841 rows) and
  `manual_resolution` (203 @1) carry the protection. Clutter inside a populated family; do not
  file it as one.
- **The reverse arm (write-but-unregistered) is 21 benign `cleanup_run_*` batch tags PLUS ONE real
  member: `costar_sidebar` → `gov.properties.government_type` (52 writes / 30d, no rung).** PR8
  registered `agency_classifier` on that field @90. Decide the sidebar's rung relative to it and
  register it — measure first which wins today on the rows where both have written.
- **PR7:** `gov.properties.recorded_owner_name` is registered @10 for `county_records` and **the
  column does not exist**; `gov.properties.year_built` exists with no county rung. Add an
  `information_schema` column-existence check to the triage and report every rung on a
  nonexistent column, both domains.
- **PR9:** `manual_verify`@20 (673 rows) ranks below `manual_edit`@1. Do not re-rank; **state the
  question** with the 673 rows' field distribution so Scott can decide.
- **PR10:** one source, two ladders — read the backlog row and fold the finding into the same
  table.

## Build

1. **One triage table**, one row per never-written source: rungs, best rung, tables, the writer
   grep result (path:line or "no writer anywhere"), the verdict — `build_pending` (a real planned
   producer, name the backlog row) / `rename` (writer exists under another spelling — name it and
   the row count it wrote) / `retire` (no writer, no plan) / `refused_by_decision`
   (`county_records`). Land it as `docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` and the
   summary block in `public-records-source-lane.md` §2.
2. **Write only the unambiguous half:** register the `costar_sidebar` `government_type` rung; for
   each `rename` verdict, do **NOT** rewrite `field_provenance` (append-only) — register the
   spelling the writer actually uses if it is unregistered, and mark the phantom rung
   `notes = 'PR5: superseded by <real source>'`. For `retire` verdicts, **soft-retire** — a
   `notes` marker and a view `v_field_source_priority_retired` — never DELETE a rung; a rung
   deletion changes merge outcomes and PR8 measured that the registry is now live authority.
   ⚠️ **Predict the merge-outcome delta before any rung change** (the PR8 replay pattern: which
   combos change source, which decisions change) and assert actual == predicted.
3. **Fix PR7's nonexistent-column rungs the same way** (notes marker + retired view), and add the
   column-existence check as a standing guard: a test that reads `field_source_priority` fixture
   rows from the migrations and asserts every `(target_table, field_name)` exists in the committed
   schema — or, if the schema is not derivable from the repo, a SQL view `v_field_source_priority_orphan_columns`
   that must return 0 rows, positive-controlled.

## Verify on

- `v_field_provenance_effective_source`: never-written count **39 → N**, with every row of the
  delta named and its verdict stated. `write-but-unregistered` **21 → 20** (the `government_type`
  member leaves; the batch tags stay and are stated as benign).
- `v_field_provenance_unranked` (30-day window): quote before/after in one session.
- Merge-outcome replay: predicted vs actual combos changed, 0 unexplained.
- The orphan-column view: 0 rows, positive control fires on an injected fake rung (rolled back).

## What NOT to do

- Do not arm `county_records` (PR1d owns that), do not touch `manual_verify`'s rank (PR9 is
  Scott's), do not delete rungs, do not rewrite `field_provenance`.
- Do not conclude "retire" from a zero alone — **a zero from a text detector is a bug signal until
  a positive control fires** (P182). Every `retire` verdict names the grep that found nothing AND
  the grep that found a known writer.

## Report back

The triage table (39 rows, verdict counts) · the `government_type` rung decision with the
measured wins-today split · PR7 orphan rungs (count, both domains) · the PR9 question stated with
its field distribution · predicted vs actual merge-outcome delta · before/after on the three
verify-on counts · anything that outranks this.
