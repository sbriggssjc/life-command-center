# STATUS archive — Claude Code queue, 2026-09-11/12 tail

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12, **before pushing**, per the CLAUDE.md
doctrine: a shared append-mostly doc grows on `main` while a branch is open, so archive to restore 200+ lines of
headroom rather than trimming when CI goes red (`test/status-line-budget.test.mjs`, budget 2,500). Nothing was
reworded, summarised or dropped. Every still-open item named below is tracked in `docs/os/PLANNED-BACKLOG.md`,
the canonical open-work list; read that first and treat this file as the narrative record.

Covers 6 entries, from *2026-09-12 — ASC50 governed review workbench built and locally verified; publication * to *HP1-badge — `total_open` was the capped page length; now the true SQL count (2026-09-*.

---

## 2026-09-12 — ASC50 governed review workbench built and locally verified; publication pending

The completed 50-property source pass exposed two execution gaps: only the six source exceptions had review
rows, and their legacy property-form vocabulary did not match `healthcare_property_review:1.0`. Implemented an
authenticated `/asc-review.html` workbench plus `/api/asc-research-review`, exact request validation, and two
invoker RPCs for primary and independent second review. The migration maps persisted legacy forms to the
aggregate contract, retains `unresolved` only as a pre-scorecard exception sentinel for compatibility, stores
the two reviewer identities/timestamps separately, rejects self-second-review, and preserves disagreement.
Existing `final_disposition` values are never overwritten by primary scorecards. No candidate judgment or
production row-level review was made.

Verification: focused ASC/property-review suite **37/37 passed**; full suite **5,933 total / 5,927 passed /
0 failed / 6 skipped**; app boot passed after lockfile dependency install; changed files pass syntax and whitespace checks. Repository-wide lint remains red on pre-existing,
unrelated errors in `sidebar-pipeline.js`, `bridge-handlers-outlook.js`, and other files; this change introduced
no lint error in its API files. Protected-PR checks remain to run.


> **📦 ARCHIVE (2026-09-12, fifth span):** the **BUY0 Phase 0 → ASC frozen-50** run of 2026-09-11 entries
> (Geller Round 1 deliverable + build handoff, OWN-T0j's end-to-end verification, MB-a2/MB1d, the ASC source
> collection) was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_buy0_to_asc.md`](../history/STATUS_claude-code_2026-09-11_buy0_to_asc.md).
> Archived BEFORE pushing this time, per the convention block above — not after CI went red. Nothing was dropped;
> every still-open item it named is tracked in `PLANNED-BACKLOG.md`.



## 2026-09-12 — ID3a-d: named the owner of every database, retired LCC's government migrations (Claude Code)

`government-lease`'s ID3a-c fix (PR #398) showed that two repos ship migrations to the same
government database, and `life-command-center`'s own copy of the same canonicalizer fix
(`supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`)
was **stale relative to what is actually deployed** — no state-qualifier guard, old ICE/CBP branch
order. Re-applying it would have silently restored `TEXAS DEPARTMENT OF AGRICULTURE → USDA` and
`Immigration & Customs Enforcement → CBP`.

**Shipped:**
- **Ownership table** (all three Supabase projects, measured, not guessed) in `CLAUDE.md` →
  "ONE REPO OWNS EACH DATABASE'S OBJECTS", mirrored in `docs/architecture/data-coherence-invariants.md`
  I16 and pointed-to from `docs/os/REGISTRY.md`. government → `government-lease` (settled by
  Scott); Dialysis_DB → `Dialysis` (proposed from evidence — 555 migration files there vs. LCC's
  277 duplicate copy, 👤 not yet Scott-confirmed); LCC Opps → `life-command-center` (this repo IS
  the app that reads/writes it).
- **Retired `supabase/migrations/government/`** — a `README.md` marking the directory historical
  and naming both defects the stale canonicalizer file would restore, plus a per-file historical
  header prepended to all 213 `.sql` files (script-generated, verified). Searched for any tooling
  that globs and applies this directory live against the government database — **found none**.
- **Guard:** `test/gov-migrations-directory-retired.test.mjs` (6 tests, all pass, includes a
  positive control that proves the detection logic can actually fail). Existing tests that read
  the retired canonicalizer migration (`test/gov-id3ab-agency-canonicalizer.test.mjs`,
  `test/id3a-gov-agency-identity.test.mjs`) still pass unchanged — the header is comment-only and
  those tests strip comments before asserting.
- **I16 drift-check design:** `scripts/db-drift/gov-deployed-vs-committed-drift.sql` +
  `scripts/db-drift/README.md`. Computes the live-side definition hash for every
  function/view/materialized-view/trigger in the government database's `public` schema; documents
  the "expected"-side replay of `government-lease`'s migrations and the final diff query inline.
  **NOT executed** — this sandbox has no network access to Supabase, so no drift result is
  reported (would be fabrication). Run it for real under credentials with access to the
  government project before scheduling anything on the I11 alert path.
- **ID3a-c deferred items closed/filed:** the "10 FK-vs-canonicalizer granularity judgment calls"
  are already surfaced by `government-lease`'s own `v_gov_agency_fk_display_drift` view
  (`sql/20260912_gov_id3a_c_agency_class.sql` §12) rather than a fresh list — filed as
  `ID3a-c-fk-granularity` in `PLANNED-BACKLOG.md`, pointed at `government-lease`, with the
  recommendation that Scott review that view's 10-row output in one pass. USFS/BLM/NSF
  canonicalizer gaps: the registry seed rows exist (`sql/20260305_phase4_financials.sql`) but no
  confirmed live regex branch was found — filed as `ID3a-c-usfs-blm-nsf`, low urgency pending an
  orphan-string volume measurement.
- **Not built, filed:** retiring LCC's `supabase/migrations/dialysis/*` (277 files) the same way —
  needs Scott to confirm `Dialysis` as the formal owner first (`ID3a-d-dia`).

**Not touched:** no live gov/dia/LCC-Opps DB object was edited. No migration was deleted. Full
suite not re-run wholesale in this pass (repo has thousands of tests); the new test file and every
test that reads a file this change touched were run directly and are green — see the branch's own
commit for the exact list.

## 2026-09-12 — ID2b-caps-2: the third comp source, fixed at the source of record, live-verified (Claude Code)

Cowork's live re-check of ID2b-caps found the gate had not actually held: `sf_comp_staging` (Team
Briggs' own Salesforce-staged closed comps) has no `properties` join, so `rpc_query_comps` could
only ever emit `operator_id: null` for that arm — 196 `DaVita Dialysis` + 179 `Fresenius Medical
Care` rows, exact matches of already-registered aliases, were minting a second, text-keyed band
under the identical canonical label the id-keyed band already carried.

**Shipped:**
- `sf_comp_staging.operator_id` — a new first-class column, fill-blanks resolved via the SAME
  ID2a resolver (`dia_resolve_operator`) every other caller uses, through a `BEFORE INSERT/UPDATE
  OF tenant` trigger that never raises (deliberately lighter than the `properties` hard-block
  guard, because this table is fed by an external Salesforce sync this repo does not control) and
  a dry-run-default backfill mirroring `dia_id2a_backfill_property_operator_ids` exactly.
- `rpc_query_comps`'s SF arm now resolves `operator_id`/`operator_canonical` from that column
  through `dia_operator_survivor`, identically to the sale/listing arms — every other key
  byte-identical.
- A structural duplicate-display-label invariant in `planOperatorCapRateBands()`
  (`market-brief-psql-tick.js`): two DIFFERENT resolved `operator_id` groups may never render
  under one canonical label. Scoped to id-keyed groups only — the documented ID2a coverage-gap
  fallback (an unresolved property sharing a raw-text label with a resolved sibling) is explicitly
  exempted, per the pre-existing accepted test for that case. On collision it logs loudly, keeps
  the larger-n band, and routes the loser through the existing `retireStaleFact()` supersede path.

**Live-verified against `zqzrriwuavgrquhisnoa`** (had DB access this session, unlike some prior
rounds): dry-run backfill predicted `406 candidates / 400 auto-apply / 6 review`, applied and
matched exactly. Re-ran the tick's own TTM window afterward: exactly three bands clear the small-n
floor (`id:4` DaVita, `id:5` Fresenius Medical Care, `id:73` US Renal Care); the one residual
same-label fragment (n=1) traces to an unrelated ID2a property-coverage gap on the `dialysis_db`
arm, not a recurrence of the SF-staging defect, and never clears the floor regardless.

Migrations: `supabase/migrations/dialysis/20260912140000_dia_id2bcaps2_sf_comp_staging_operator_id.sql`,
`.../20260912150000_dia_id2bcaps2_rpc_query_comps_sf_operator_id.sql` (both applied live). Guard:
`test/id2bcaps2-sf-operator-resolution.test.mjs` (13 tests). Full suite: 6,057 pass / 0 fail / 6
skipped (up from 6,044). Docs updated in this change: `docs/os/PLANNED-BACKLOG.md` §P0d (ID2b-caps-2
row), `docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md` (addendum),
`docs/architecture/EXEC-BRIEFS-SPEC.md` §9 (correction appended in place, not rewritten).

**Not done, deliberately:** `MARKET_BRIEF_PSQL` not flipped; no change to comp SELECTION/scoring,
the registry merge machinery, or any alias-table write beyond calling the existing resolver; the 6
unresolvable `sf_comp_staging` tenants sit in `dia_operator_write_review` like any other unresolved
operator string, resolvable the normal way (`dia_id2a_resolve_review`).

## HP1-P2a — route data-hygiene rows off the homepage Inbox (2026-09-12)

Routing change, not a build. Scott's third and last untouched HP1 symptom: the Inbox homepage
surface was 93%+ captured-contact hygiene noise. Re-measured live (the prompt's figures were
stale by the time this ran — `inbox_items WHERE status='new'` is **1,061**, not 1,052):
`new_contact_qualify` 879, `contact_misparse_review` 117, `email_alert` 20, `email_om`/
`sidebar_om`/`folder_feed_om` 33, `flagged_email` 12.

- **Excluded only `new_contact_qualify`** (879 rows) — it has a real, populated destination
  (`v_lcc_contact_qualify_worklist`, 868 live rows, wired to `renderContactQualifyWorklist()` /
  `bridgeQualifyContact` / `bridgeQualifyContactsBulk`, all pre-existing).
- **`contact_misparse_review` (117) stays on the Inbox, deliberately** — grepped `api/` and every
  frontend file: zero readers of `source_type='contact_misparse_review'` anywhere. Routing it off
  would delete the only place it is visible. Filed as a P131 gap in `PLANNED-BACKLOG.md`
  (HP1-P2a row), not built here.
- **Exclusion lives at `v_inbox_triage`** (migration
  `20261101190000_lcc_hp1p2a_inbox_exclude_contact_qualify_hygiene.sql`, applied to LCC Opps) —
  every consumer of the view (v1 `case 'inbox'`, `handleInbox`/`/api/inbox`,
  `v2GetInbox`/`/api/queue-v2?view=inbox`) is an Inbox surface and none of them wants
  captured-contact hygiene rows.
- **`mv_work_counts.inbox_new`/`inbox_triaged` carry the same exclusion** so the header total
  agrees with the filtered list — without this the change reproduces the QA-18 defect (list count
  and header count silently disagreeing by ~900).
- **Every `v_inbox_triage` consumer's JSON response now carries `hygiene_pointer`** —
  `{source_type, count, label}`, `count` read via a separate EXACT `count=exact` probe against
  `inbox_items` directly (never the already-filtered view, never a capped page), so the excluded
  population can never be silently dropped or under-reported (the HP1-badge P159a trap, avoided in
  the same change). Rendered on the full Inbox page (`ops.js renderInboxTriage`) as a persistent
  row: *"🧹 Data hygiene — contacts to qualify — N items"* with a "Review →" button that calls the
  existing `renderContactQualifyWorklist()`. The small Today-page widget (`app.js
  loadCanonicalData`/`renderRecentEmails`, 6-item preview) already benefits from the view-level
  filter via its existing "View all N" total; a redundant pointer was deliberately NOT added there.
- **Result: the Inbox reads 182, not 65.** The prompt's 65 assumed both hygiene lanes and the
  personal `email_alert` class would all leave; only `new_contact_qualify` does.
  `email_alert` (personal, 20) is HP1-P2b's scope and untouched; `contact_misparse_review` (117)
  stays for the reason above; OM/flagged-email broker work (45) is the genuine actionable residue.
- **Verified live** (`select source_type, count(*) from v_inbox_triage group by 1` → 0 rows for
  `new_contact_qualify`; `mv_work_counts.inbox_new` → 182) and via `v_lcc_contact_qualify_worklist`
  still returning 868 reachable rows post-change (no destructive write performed — reachability
  confirmed by read, not by a live `bridgeQualifyContact` round trip, to avoid mutating production
  data for a verification step).
- Guard: `test/hp1-p2a-inbox-hygiene-pointer.test.mjs` (2 tests, positive control included).
  Full suite: 6,083 pass / 0 fail / 6 skipped.

**Not done, deliberately:** no drain of the 979/868 captured-contact rows (that writes — links
people, stamps cadences; a separate decision); no `priority_score` ranking (HP1-P2c, sequenced
after this); `contact_misparse_review` resolution surface not built (filed, not fixed);
`inbox_items.domain` four-spelling drift not touched (already filed as HP1-P2-domain).

## BACKLOG-ids-dedupe — a 3-way merge silently reintroduced the duplicate class it was fixing (2026-09-12)

PR #2410 fixed 27 duplicate `PLANNED-BACKLOG.md` row IDs and shipped
`test/backlog-id-uniqueness.test.mjs` to guard it — then **failed its own new guard in CI**. A
separate PR (#2409, later #2411) merged into `main` in between, adding its own restatement content
for `MB2a`/`MB3`/`MB4` rather than editing those rows in place. Git's 3-way merge (pure line
inserts in nearby but distinct regions, no textual conflict) kept **both** versions on the PR
branch — the exact duplicate-row class the guard exists to catch, produced by the merge itself
rather than by either PR's authored diff.

- **Re-measured, not assumed.** `node --test test/backlog-id-uniqueness.test.mjs` on the already
  `main`-merged branch (`b8c27f4`, later `7acd65e` after #2411 landed) found exactly the 3 IDs the
  diagnosis named — `MB2a` 2x, `MB3` 4x, `MB4` 4x — and nothing new from #2411's independent merge.
  All RESTATEMENT (same issue, told progressively as it moved toward live), not COLLISION.
- **Merged each into one row, keeping every distinct fact** (verified programmatically — every
  fragment from every original copy located byte-for-byte inside the merged text before/after):
  `MB2a` = the build note + Cowork's "feeds fine, code not deployed" reconciliation (already a
  clean superset in one copy — kept verbatim). `MB3` = base build → "partially unblocked, redeploy
  confirmed" → "PR #2391, Cowork applied migrations + flipped flags" → "Scott, in parallel — PSQL
  flag flipped 14:48 UTC, 31 live facts written, `market_brief_issues` frozen,
  `MARKET_BRIEF_RENDER` confirmed `on`". `MB4` = base build → redeploy-confirmed pointer → "same
  sequence as MB3" final-live note → the functional `#/briefs` + `/api/market-brief-tab` check.
  Final `State` = the latest/most complete (`✅ live`); `Source` cells combined rather than picking
  one.
- **Also fixed the malformed-table byproduct of the same merge**: three of the four copies each of
  `MB3`/`MB4` had grown two extra trailing cells beyond the table's real 4-column schema
  (`# | Item | State | Source`), because a later restatement was appended as new cells instead of
  new prose. Folded back into the `Item` narrative; no row now carries more than 4 cells.
- Verify: `node --test test/backlog-id-uniqueness.test.mjs` → 6/6 pass. Full suite:
  `npm test` → 6150 tests / 6144 pass / 0 fail / 6 skipped (unchanged skip count — no test was
  removed or quarantined, only doc content merged).

## HP1-badge — `total_open` was the capped page length; now the true SQL count (2026-09-12)

Full detail in `PLANNED-BACKLOG.md` (row **HP1-badge**), not restated here. Summary:
`today-sections.js`'s `total_open` was the row-fetch's own `LIMIT`, not the population
(Significant 200 vs true 516, Urgent ≤200 vs true 1,730). Fixed with a separate, narrow,
`Prefer: count=exact` probe per lane run in the SAME `Promise.allSettled` batch as the row
fetches (the `inboxHygienePointer` idiom) — never reintroducing HP1-P0's removed ~750 ms/request
cost. A failed probe renders `total_open: null` end to end (server AND `app.js`), never `0` and
never the row count. Guard: `test/hp1-badge-today-total-open.test.mjs` (2 tests); full suite
unchanged and green. Urgent's true population is 96% `contact_writeback` pipeline hygiene —
filed as **HP1-P2f-urgent**, not routed off here.
