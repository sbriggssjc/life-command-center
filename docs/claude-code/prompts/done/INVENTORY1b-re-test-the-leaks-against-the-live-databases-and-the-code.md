# INVENTORY1b — re-test INVENTORY1's leak lists against the live databases and the code; read the ten root reports it could not open

**Filed:** 2026-09-16 (Cowork). **Owner:** LCC. Read-only against the databases; writes under
`docs/audits/` and the INVENTORY1 branch. **Precondition:** merge `claude/inventory1-audit` (PR opened
2026-09-16) so pass 1 + 2 are on `main`: `docs/audits/INVENTORY1_intent_2026-09.csv` (1,779 rows),
`INVENTORY1_GAP_MAP_2026-09.md`, `INVENTORY1_GAP_MAP_PASS2_2026-09.md`.

## Where INVENTORY1 stopped, in its own words

Two passes, honest about scope: heading-level scraping of `docs/architecture`, `docs/audits`,
`docs/history` (94 of 188 files had no marker heading and were not opened) and `prompts/done`; ~20
files deep-read; **no live DB, no code read**, so every "actual state" is inferred from migration
files and every "no trace" is docs-corpus-only; the ten root `.docx` reports unreadable (no pandoc in
the sandbox). It asked whether to keep scraping or start re-testing. Re-testing is where the signal is.

Two things changed since: **`docs/history/root-reports/*.md`** now holds a Markdown conversion of all
ten root reports (Cowork, 2026-09-16), and this round has Supabase access to all three projects.

## What to do — measure, in this order

1. **The nine feature flags OFF with no recorded reason.** For each: the flag name, the registry
   row, what code path it gates (file:line), whether that path has run in the last 30 days anyway
   (logs, ledgers, row counts), and a one-line verdict: *inert-by-design* (write the reason into the
   registry), *inert-by-accident* (a candidate to turn on — do not turn it on), or *dead* (the gated
   code no longer exists). Land the table.
2. **The `data_quality_self_learning_loop.md` Phase 2.3–2.6 cluster** (CMS chain-org sync, county
   records sync, manual edits, SF two-way sync) — "NOT STARTED, zero backlog tracking". For each:
   does anything in code or the DB do this today under another name? (`grep`, `pg_proc`, cron.) If
   not, is it still wanted given what shipped since (ID3a, OWNERGAP2, C2k)? Recommend: backlog row,
   or abandon with the reason.
3. **The `OWNERSHIP_AND_SALES_REMEDIATION_PLAN_2026-05-23.md` ⬜ TODO rows** (C2, C4, C5, C7, C8, C9,
   B3, B6, B8, A6a, A7, A8). Re-test each against the live schema and code — e.g. does C5's EXCLUDE
   constraint exist? — and mark `shipped-under-another-name` / `still-open` / `obsolete`, with the
   evidence. A#/B#/C# tags were reused in August/September rounds; match on content, never on tag.
4. **The CONTACTS_HUB contradiction** (migration seed says `partial`/dormant; `CLAUDE.md` prose says
   live at `ops`). Measure which is true (`unified_contacts` row counts and writes per project in the
   last 7 days) and fix the false one in the same change.
5. **The ~124 untraced prompts.** Do not re-grep. Take the 30 highest-numbered plain-slug ones
   (`ACI-phase`, `ADDR1`, `BACKLOG-ids`, `BROKER1`, …), open each prompt, name the artefact it should
   have produced (a migration, a route, a view, a doc section), and check whether that artefact
   exists in `main` or the live DB. Three columns: prompt · expected artefact · found where / not
   found. That converts "no trace" into "shipped-undocumented" vs "never shipped".
6. **The ten root reports** (`docs/history/root-reports/`): extract their intent statements into the
   CSV with `source=root-report`, same columns, and mark state the same way (`LCC_Holistic_Audit`
   and `LCC_Architecture_Gap_Analysis` are the two that will carry the most).
7. **Update the gap map**: one consolidated `INVENTORY1_GAP_MAP_2026-09.md` (fold pass 2 in),
   with the five-state distribution now *measured* for every row this round touched and `UNMEASURED`
   left honestly on the rest; the leak / ghost / inert lists; and the process recommendation per
   leak class the brief asked for — INVENTORY1 did not reach that section.

## Prohibitions

- ⛔ No build, no flag flip, no backlog edits (propose rows in the gap map; Cowork applies).
- ⛔ No "no trace" without naming the artefact that was looked for.
- ⛔ Nothing lands in a scratchpad; everything under `docs/audits/` on the branch.

## Reporting

The four tables (flags, Phase 2.3–2.6, TODO rows, 30 prompts), the CONTACTS_HUB verdict and fix, the
root-report row counts, the consolidated gap map, and the process recommendations. If any step was
skipped, say so.
