# DEPLOY2-unapplied — a migration that merged but never ran must become a finding, not a surprise

## Why this exists

Four times in three weeks a migration was merged to `main` and then *assumed*
applied, and three of those four were wrong:

| arc | what merged | what was live |
|---|---|---|
| HP1-P1a-fix | RPC redefinition | code called an RPC that did not exist |
| OWNERGAP1 | quarantine triggers | absent until applied by hand |
| XB2-precision | audit rule refinement | JS half live, SQL half never ran |
| N15 SF-campaign hub mint | mint fn + log table | **actually applied** (verified 2026-09-15: 1,475 rows, batch `n15_sf_campaign_2026-09-15`) |

The fourth row is the important one. It is a counterexample, and it is why this
prompt exists in this shape: **a check that asks only "does the object exist?"
passes N15 correctly AND passes XB2-precision incorrectly.** Existence is not the
discriminator. The repo already learned this on the code side — `scripts/verify-deploy.mjs`
exists because four "the route regressed" bugs were four unshipped deploys, and
it works by comparing the *deployed commit* to the repo, not by asking whether a
route exists. There is no DB-side equivalent. Build it.

## READ FIRST — the measurement that kills the obvious design

Do not build a version-string comparison. Cowork measured this live on
2026-09-15 before writing the prompt:

* `supabase/migrations/*.sql` — **885 files**, but only **742 unique version
  prefixes**: 98 timestamps collide across two or more files.
* `supabase_migrations.schema_migrations` (LCC Opps `xengecqvemvfknjvbvrq`) —
  **770 rows**, newest `20260915142114`.
* **No file is named `20260915142114_*`.** The tracking table records the real
  clock time at apply; MCP `apply_migration` stamps its own.
* **87 file versions are dated after today**, running to `20261102170000` —
  i.e. 2026-11-02, seven weeks out. The repo uses synthetic sequence timestamps
  (`...120000`), not real ones.

So `file_version NOT IN (select version from schema_migrations)` would report
essentially every recent migration as unapplied. That is a detector that is
wrong on its entire visible output — the XB2-counter failure, which this repo has
now paid for on a *different* rule in the same brief. **Do not ship it.**

## What to build

A repo-side rule in **`scripts/build-brief-collector.mjs`** — not in
`supabase/migrations/20260915120000_lcc_xb1xb2_build_brief_db_audit.sql`. That
migration's own header states the split correctly: DB-answerable rules go in the
RPC, "git/filesystem state is not queryable from Postgres" goes in the Node
collector. This rule needs BOTH the filesystem (migration files) and the DB
(live objects), so it is the collector's.

New finding kind: **`migration_unapplied`**, written into the same
`build_brief_snapshots.audit_flags` array as the existing rules.

### The rule

Scope it to the **recent window** — the migrations that can still be in flight.
Value is in catching the newest ones; auditing all 885 is a different, larger job
and is not what has been costing us rounds. Propose the window in your response
and justify it (git mtime, file order, or last-N — your call, but say which and
why, and make it a named constant, not a magic number).

For each migration in the window:

1. Parse the objects it **creates** — `CREATE [OR REPLACE] FUNCTION|VIEW|TABLE|
   TRIGGER|INDEX|TYPE|POLICY`. Record name and kind.
2. Probe each against the live DB: `to_regprocedure` / `to_regclass` / the
   `pg_trigger`/`pg_policy` catalogs as appropriate.
3. Classify:
   * **APPLIED** — every declared object is present.
   * **UNAPPLIED** — one or more declared objects are absent. → finding.
   * **UNVERIFIABLE** — the migration declares **no** creatable object (a pure
     `UPDATE`/`INSERT` backfill, an `ALTER`, a `DROP`). → **also a finding**, at
     lower severity.

### The requirement that matters most

**UNVERIFIABLE must never be silently folded into APPLIED.** A data-only backfill
migration is precisely the shape that merges and never runs and leaves no trace —
if the rule reports it as clean, the detector passes the exact class it exists to
catch. This is P131 (a gap is filed, never faked) and P180 (NULL is not zero)
applied to a deploy check. The finding text must say *"declares no probeable
object — application state unknown"*, never "ok".

### Known weakness you must state, not hide

`CREATE OR REPLACE` of an object that **already existed** probes as present even
if this migration never ran. So APPLIED is a weaker verdict than UNAPPLIED.
Say so in the finding's own detail text and in the collector's header comment.
If you can strengthen it cheaply — e.g. a migration that introduces at least one
genuinely NEW object name is more reliably verifiable than one that only
replaces — surface that as a confidence field rather than pretending the verdict
is binary. **Do not add a hash-ledger or sentinel-insert scheme in this prompt**:
it cannot be backfilled across 885 files and it is a separate decision. If you
think it is the right long-term answer, file it as a backlog row and say why.

### The staleness test the backlog row already proposed — evaluate it, do not skip it

The `DEPLOY2-unapplied` backlog row proposes something stronger than existence:
hash or compare the file's `CREATE` block against `pg_get_functiondef` in the
live DB. That idea is **correct in principle and is exactly what would have
caught XB2-precision**, where `lcc_build_brief_db_audit()` existed but carried
the old body (no `GROUP BY`). Existence alone passes that. So evaluate it, and
report what you find:

* For every `CREATE OR REPLACE FUNCTION` in the window, fetch `pg_get_functiondef`
  and compare against the file's block **normalized** (lowercase, whitespace
  collapsed) — Postgres reformats and re-qualifies, so a raw hash will not match
  and must not be used.
* If it matches → verdict **APPLIED** with high confidence.
* If it differs → candidate verdict **STALE**.

⚠️ **Measure the false-positive rate before shipping STALE.** Run the comparison
across the whole window and hand-check a sample of the differences. If pg's own
reformatting produces differences on functions you can confirm are current, then
a naive normalized compare is a noisy rule, and a noisy rule in this brief is the
XB2-counter defect again. In that case: **do not ship STALE as a finding.**
Report the measured FP rate, ship only UNAPPLIED + UNVERIFIABLE, and file STALE
as a backlog row with the number attached. Shipping a quiet, correct rule beats
shipping a loud one we stop believing — that judgement is yours to make and to
show your work on.

## Acceptance

1. **Positive control, mandatory.** Class 11: a detector that has never fired is
   not a detector. Point the rule at a fabricated object name (or a
   deliberately-broken fixture migration) and assert it produces a
   `migration_unapplied` finding. Then assert it does NOT fire on
   `20261102170000_lcc_n15_sf_campaign_hub_mint.sql`, which is live and verified:
   `lcc_n15_mint_sf_campaign_hub_rows(boolean,text)`,
   `lcc_n15_unmint_sf_campaign_hub_rows(text)` and
   `lcc_n15_sf_campaign_hub_mint_log` are all present.
2. **Retrospective check.** Run the rule against the state that existed when
   XB2-precision was merged-but-unapplied, if you can reconstruct it (the
   migration is in git history). If you cannot reconstruct it honestly, say so
   and do not claim the rule would have caught it — an untested claim about a
   past incident is exactly the fabrication this repo forbids.
3. Guard test in `test/`, alongside `test/xb1-xb2-build-brief-collector.test.mjs`.
   Follow that file's existing shape rather than inventing a second harness.
4. Report the live finding count this produces on today's window, split
   UNAPPLIED / UNVERIFIABLE. **Report the number you measure**, not a target —
   Cowork has not pre-measured it, and a prompt that names an expected count
   would be inviting you to reach it.

## Out of scope (do not do these here)

* No dashboard surface (that is XB3), no narrative (XB4).
* No change to `scripts/verify-deploy.mjs` — the code half already works.
* Do not "fix" the synthetic migration timestamps. 885 renames is a separate,
  risky change and the collision count (98) means it is not mechanical. If you
  believe it should happen, file a backlog row.
* Do not apply any migration you discover to be unapplied. **Report it.** Deciding
  to run a migration is Scott's call, and some of the 87 future-dated files may be
  staged deliberately.

## Deliverables

* `scripts/build-brief-collector.mjs` — the `migration_unapplied` rule.
* `test/` — guard with the positive control.
* `docs/os/PLANNED-BACKLOG.md` — close/annotate the **DEPLOY2-unapplied** row with
  what shipped and the live finding count. Surgical row edit only; two branches
  that both add to a shared doc merge cleanly and silently duplicate it.
* `docs/claude-code/STATUS.md` — entry **below** the `---` that follows the
  `## Open threads` table, H1 stays on line 1.
* Migration application is undocumented in canon — there is no block covering it.
  If you touch doctrine, edit `docs/os/canon/blocks/*.md`, bump `CANON_VERSION` in
  `canon/00-INDEX.md`, and run `node docs/os/tools/render-surfaces.mjs --root=docs/os --write-live`.
  Never hand-edit a GENERATED file.

## Reporting

State plainly, in your response: which window you chose and why; the live
UNAPPLIED / UNVERIFIABLE counts; whether the positive control fired; and whether
the XB2-precision retrospective was actually reconstructible or not. If any step
was skipped, emit that it was skipped (B6a) — a silent skip is the defect.
