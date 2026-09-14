# PR5c — 33 ladder rungs on LCC-internal tables have never produced a `field_provenance` row: are the call sites ever REACHED?

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. Diagnosis first; the
write, if any, is small and named. PR12 is closed and **does not explain this** (0.03% break-class on
`entities.name`, 0 elsewhere), so the remaining candidates are: the call site is never reached; it
is reached and the stamp is dropped inside `catch (_e) { /* best-effort */ }` for a reason other
than 22P02; or the writer sends a `(table, field)` spelling the ladder does not hold.

**Read first:** backlog row **PR5c** (`docs/os/PLANNED-BACKLOG.md`), `docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md`
§1–§2 (`writer_live_zero_rows`), `docs/audits/PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md` §4 and §8
(the `provenance_failed` counter + `provenance_write_failed` alert that now exist in
`api/_shared/field-priority-guard.js` — **that signal is your instrument once the Railway redeploy
carries `68ede28c`; check `/version` first and say which side of it you are on**). Then `CLAUDE.md`
§ "Field-level data provenance" and the PR5 block ("unregistered is a different branch").

## The population (verify, do not re-derive)

| table | rungs | live `lcc_merge_field` call site |
|---|---:|---|
| `entities` | 13 | `api/admin.js:10609` |
| `entity_relationships` | 2 | — (⚠️ `developed`/`owns` are relationship TYPES, not columns — PR7-class, confirm) |
| `lcc.lcc_property_owner` | 6 | — (the property-owner ladder scores via `lcc_reconcile_property_owner`, which writes `lcc_property_owner_evidence`, not `field_provenance`; PR5 §1) |
| `lcc.lcc_entity_portfolio_facts` | 2 | — |
| `public.lcc_cre_properties` | 7 | `cre-registry.js:398`, `admin.js:9727/9798` |
| `public.lcc_cre_property_documents` | 3 | `property-doc-writeback.js` |

`field_provenance` rows on all 33: **0**. Positive control: `dia.properties` rungs, thousands.

## Answer these, one query or one grep each

1. **Reachability.** For each of the four live call sites: what is the enclosing handler / route /
   cron, and has it RUN in the last 30 days? Evidence = the run log, `lcc_cron_post_log`, the
   handler's own ledger table, or the target table's `updated_at` distribution — not the code
   existing. A site behind a flag that is `off` in `feature_flags_registry` is "never reached";
   say which flag.
2. **Spelling.** What `target_table` / `field_name` string does each call site actually pass?
   Compare byte-for-byte against the rung (`lcc.lcc_property_owner` vs `lcc_property_owner` vs
   `public.lcc_property_owner` — PR5 §"a logical prefix is not a schema"). A mismatch means the
   writes exist in `field_provenance` under a DIFFERENT table string — count them.
3. **The catch.** For each `catch (_e) { /* best-effort */ }`, what does the RPC return when the
   call is replayed in a rolled-back transaction with the exact payload shape the caller builds?
   If it errors, name the SQLSTATE. (`42703`/`42P01` = the rung names a column/table that does not
   exist = PR7 class; `22P02` = PR12 class, should now be impossible; `23502` = the NOT NULL-before-
   ON CONFLICT trap.)
4. **The two ledger-less tables** (`lcc_property_owner`, portfolio facts): are their rungs a
   design mistake (the ladder that governs them lives in `lcc_property_owner_evidence` and never
   will write `field_provenance`) → soft-retire in `notes` as PR5 did, with the reason; or is a
   provenance write genuinely intended and missing → say what would write it and stop.

## Build (only what the answers justify)

- A spelling mismatch → fix the CALLER's string (never rename the rung — PR5: rung changes move
  merge outcomes), and count the provenance rows that now land under the right table.
- A dead catch that hides a real SQLSTATE → route it through the PR12 failure signal so it is
  counted and alerted, never widen the catch.
- A never-reached call site → do not build a producer; record `reason` in the rung's `notes`
  (`PR5c: call site unreached since <date>, behind <flag>`), and a backlog row if a consumer wants
  it.
- Rungs on relationship TYPES or ledger-less tables → soft-retire with `notes`, predict the
  merge-outcome delta first (PR8/PR5 replay pattern; expected **0**, prove it).

## Verify on

- `v_field_source_priority_triage`: the 33 rungs each carry a `PR5c:` verdict (reached / unreached /
  mis-spelled / retired-ledgerless), none unverdicted.
- If any caller string is fixed: `field_provenance` rows on that table **0 → N** within the run
  you trigger, with the rolled-back control showing the same call succeeding.
- `provenance_failed` (post-redeploy) or the rolled-back replay (pre-redeploy): every catch's
  outcome named.
- `v_field_provenance_unranked` before/after in one session.

## What NOT to do

- Do not delete rungs. Do not add a `field_provenance` writer to `lcc_reconcile_property_owner`
  (one source, two ladders — PR10 — is a decision, not plumbing). Do not widen any catch.

## Report back

The 33-rung verdict table (reached / unreached / mis-spelled / ledgerless) · per-site evidence of
the last run · SQLSTATEs from the replays · rows recovered if any caller string was fixed ·
which side of the `68ede28c` redeploy the run was on · anything that outranks this.
