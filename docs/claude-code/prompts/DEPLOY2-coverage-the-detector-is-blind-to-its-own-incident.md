# DEPLOY2-coverage — the detector cannot see OWNERGAP1, and its window is not a clock

## Why this exists

`migration_unapplied` shipped 2026-09-16 and it is good work: the version-anchored
design was correctly ruled out, UNVERIFIABLE is a first-class verdict, the positive
control fires, and STALE was measured and correctly NOT shipped. None of that is in
question here and none of it should be re-litigated.

Two things about its **window** are wrong, both measured live by Cowork on
2026-09-16. Together they mean the rule is blind to one of the three incidents it
was built to catch.

### (a) `dialysis/` is not retired, and excluding it removes OWNERGAP1

`listRecentMigrationFiles()` is root-only, and its header justifies that as:

> `dialysis/` and `government/` are historical copies of a database owned by another
> repo per this repo's own "ONE REPO OWNS EACH DATABASE'S OBJECTS" doctrine

**That is correct for `government/` and false for `dialysis/`.** Measured:

| directory | README | files carrying `HISTORICAL — DO NOT RE-APPLY` | guard test |
|---|---|---|---|
| `supabase/migrations/government/` | yes | (the guard enforces it) | `test/gov-migrations-directory-retired.test.mjs` |
| `supabase/migrations/dialysis/` | **none** | **0 of 282** | **none** |

The `government/` retirement was generalized to `dialysis/` without checking. The
consequence is exact and it is not hypothetical:

`supabase/migrations/dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`
is **OWNERGAP1** — one of the three incidents in DEPLOY2's own motivating table —
and its header states it is *"the containment that IS in scope from this repo."*
This repo authored it and applied it. The detector cannot see it.

### (b) The window sorts by filename, and filenames are synthetic

`listRecentMigrationFiles()` takes `.sort()` then `.slice(-MIGRATION_WINDOW_SIZE)`
with `MIGRATION_WINDOW_SIZE = 60`. Migration filenames in this repo are **sequence
numbers wearing a timestamp's clothes** (`...120000`, dated months ahead — the
DEPLOY2-unapplied row's own pre-measurement), so files arrive out of order.

Measured 2026-09-16: the window floor is `20260930121500`; **107 migrations were
added to the repo in the last 14 days, 64 of them fall outside the window, and 24 of
those 64 are root-level.** So the rule is blind to 24 root migrations that are newer
than files it does scan.

⚠️ **This is the same defect the DEPLOY2 prompt already killed once.** It rejected
`file_version NOT IN schema_migrations` because a synthetic timestamp is not a clock.
Sorting the window by that same synthetic timestamp is the same mistake in a second
place. And it is now actively getting worse: on 2026-09-16 a **99th filename
collision** was created live — `20261102180000` is held by BOTH
`_lcc_xb2counter_producer_stall_scheduled_only.sql` (PR #2475) and
`_lcc_own_t0g_transfer_supersession.sql` (PR #2477), authored the same day by two
branches that never saw each other. Filename sort orders those two arbitrarily.

## What to build

### 1. Window by git add-date, not filename

Replace the filename sort with the date the file was **added to git**. CI already
supports this: `.github/workflows/build-brief-collector.yml` sets `fetch-depth: 0`,
so full history is present.

* Do **not** shell out once per file — 885 files × one `git log` each is a different
  kind of defect. One pass builds the map:
  `git log --diff-filter=A --name-only --format=%H%x09%aI -- supabase/migrations`.
* ⚠️ **A file with no add-date is NEWEST, never dropped.** An untracked or
  brand-new file returns nothing from `git log`; treating that as "no date, skip it"
  would silently exclude the freshest migration in the repo — P180 (unknown is not
  zero) on the exact population this rule exists to watch. Sort it to the top of the
  window and say so in a comment.
* ⚠️ **If git history is unavailable** (shallow clone, no `.git`), do NOT silently
  fall back to filename sort and carry on. Emit the skip (B6a): fall back, and
  attach to the snapshot that the window is degraded and why. A degraded window that
  looks identical to a healthy one is how this defect survived its own review.
* Keep `MIGRATION_WINDOW_SIZE` a named constant. If you change its value, justify the
  new number against the measured add-rate (~107 per 14 days) rather than picking one.

### 2. Scan `dialysis/` — which means a second database

`dialysis/` migrations target **Dialysis_DB `zqzrriwuavgrquhisnoa`**, not LCC Opps.
Probing them against LCC Opps would report every object absent: a rule that is wrong
on its whole output, which this arc has now rejected twice. So:

* Deploy `lcc_probe_schema_objects(jsonb)` to Dialysis_DB as its own migration in
  `supabase/migrations/dialysis/`. Same narrow contract, same `SECURITY INVOKER` over
  `pg_catalog`, same REVOKE-from-PUBLIC/anon/authenticated + assert with
  `has_function_privilege()`.
* Route each migration file to the right project by directory: root → LCC Opps,
  `dialysis/` → Dialysis_DB.
* **Credentials — do NOT read `process.env` directly, and do NOT ask for a new secret.**
  Verified against the live Production environment 2026-09-16: **`DIA_SUPABASE_URL` and
  `DIA_SUPABASE_KEY` already exist**; `DIA_SUPABASE_SERVICE_KEY` does **not**. Nothing needs
  adding for this to run.
  ⚠️ **There is existing machinery for exactly this, and it exists because of a trap.**
  `api/_shared/supabase-keys.js` documents GitHub issue #720: `DIA_SUPABASE_KEY` has
  *"historically held the **anon** JWT ... despite the names suggesting otherwise"*, and there is a
  **Phase 4 mass-revoke of anon grants** planned. So hardcoding either name is wrong — the anon
  one is scheduled for demolition, the service one does not exist yet. Use the resolver
  **`diaSupabaseKey()`** from that module, which prefers `DIA_SUPABASE_SERVICE_KEY` and falls back
  to `DIA_SUPABASE_KEY`. The rule then works today and upgrades itself the day Scott sets the
  service key, with no second change. Wire `DIA_SUPABASE_URL` and the resolved key through the
  workflow the same way the LCC pair is wired.
* **Grants on the dia probe RPC, and why they differ from the LCC one.** The LCC probe is
  service_role-only because `LCC_SERVICE_ROLE_KEY` is a service key. The dia key in CI is, today,
  anon — so a service_role-only grant would fail on every run. Grant **both `service_role` and
  `anon`**, assert both with `has_function_privilege()`, and add a comment naming issue #720 Phase 4
  as the moment the `anon` grant should be **removed**. Keep `SECURITY INVOKER`: the function reads
  only `pg_catalog`, which every role can already read, so there is no privilege to escalate and no
  reason to reach for `SECURITY DEFINER`.
  🔍 State in your response that this grants object-name enumeration on Dialysis_DB to anon-key
  holders, and that it is bounded by the #720 revoke. That is a real consequence, not a footnote.
* ⚠️ **Do not assume the resolved key's privilege level.** The names lie (that is the whole point of
  #720). If the probe RPC returns a 401/403 or any error, emit `skipped` with the HTTP status in the
  reason — never treat an authorization failure as "no objects missing."
* ⚠️ **Absent dia credentials, the dia half must emit a `skipped` finding with a
  reason** — never quietly scan root only and report a clean brief. The whole class
  of defect here is a check that looks like it ran. Mirror the existing
  `{skipped:true, reason}` contract; do not crash the collector.

### 3. Do NOT add `government/`

`government/` really is retired, owned by the `government-lease` repo, and guarded.
Leave it out, and leave its guard alone.

🔍 **Report, do not decide:** that leaves the `government` project
(`scknotsqkcheojiaewwh`) with no unapplied-migration detector at all. State that in
your response as an open question for Scott. Do not build coverage for it here.

### 4. Fix the doctrine that caused this

The false claim lives in a code comment, which is why it was believable. Make the
ownership legible so the next reader does not repeat it:

* Correct the `listRecentMigrationFiles()` header — `dialysis/` is **live and owned by
  this repo**; `government/` is retired.
* Add `supabase/migrations/dialysis/README.md` stating that this directory IS applied
  from this repo, with OWNERGAP1 as the worked example. Deliberately the mirror of
  `government/README.md`, so the two directories stop looking alike at a glance.
* ⚠️ Do **not** add a retirement guard for `dialysis/` — it is the opposite situation.
  If you think a guard is warranted (e.g. asserting `dialysis/` files never carry the
  historical marker), propose it in your response rather than shipping it unasked.

## Acceptance

1. **Regression control on the real incident.** Assert that the OWNERGAP1 file
   (`dialysis/20260914150000_dia_ownergap1_fabricated_owner_quarantine.sql`) is now
   **in scope**. That file is a trigger-and-function containment migration — state
   which verdict it lands on and why. If it comes out UNVERIFIABLE, that is a fine
   result and must be reported as such, not massaged into APPLIED.
2. **Window control.** Assert that a file with a LOW synthetic timestamp but a RECENT
   git add-date is in the window, and that the old filename sort would have excluded
   it. Use a real file from the measured 24, named in the test.
3. **No-date control.** Assert a file with no git add-date sorts newest rather than
   being dropped.
4. **Re-run the live measurement** and report the new numbers next to the old ones:
   migrations checked, UNAPPLIED, UNVERIFIABLE, split by project. The previous run was
   **60 checked / 100 objects / 0 UNAPPLIED / 5 UNVERIFIABLE**, LCC Opps only.
   ⚠️ **Report what you measure.** If adding `dialysis/` surfaces real UNAPPLIED
   migrations, that is the rule working — do not treat a rising count as a bug to
   tune away.
5. Extend `test/xb1-xb2-build-brief-collector.test.mjs` rather than starting a second
   harness. Keep the existing 16 tests passing.

## Out of scope

* No STALE work — that is **DEPLOY2-stale** and still needs an AST extractor.
* No reverse check (applied-but-unmerged) — that is **DEPLOY3-unmerged**, and it
  should not be built until this window is fixed, since it would inherit the same blind spot.
* Do not renumber or rename any migration file. The 99 collisions are real and worth
  fixing, but not in this prompt and not by a script.
* **Do not apply any migration you find unapplied. Report it.**

## Deliverables

* `scripts/build-brief-collector.mjs` — git-add-date window, per-project routing,
  corrected header comment.
* `supabase/migrations/dialysis/` — the probe RPC migration + `README.md`.
* `.github/workflows/build-brief-collector.yml` — wire `DIA_SUPABASE_URL` plus BOTH
  `DIA_SUPABASE_SERVICE_KEY` and `DIA_SUPABASE_KEY` (the resolver picks; passing both is what makes
  the #720 upgrade automatic), and do NOT make the job hard-fail when they are absent — the LCC
  half must still run.
* `test/xb1-xb2-build-brief-collector.test.mjs` — the three controls above.
* `docs/os/PLANNED-BACKLOG.md` — close **DEPLOY2-coverage** with the measured
  before/after. Surgical row edit; two branches that both add to a shared doc merge
  cleanly and silently duplicate it.
* `docs/claude-code/STATUS.md` — entry **below** the `---` that follows the
  `## Open threads` table; H1 stays on line 1.

## Reporting

State plainly: the new live counts split by project; which verdict OWNERGAP1 landed
on; whether the dia half ran or was skipped and on which reason; and which key the
resolver actually picked up in CI (service or anon), since that determines whether the
`anon` grant is load-bearing today. If any step was skipped, emit that it was skipped —
a silent skip is the defect this whole arc is about.
