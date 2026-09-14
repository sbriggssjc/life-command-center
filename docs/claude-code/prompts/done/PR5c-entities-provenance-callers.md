# PR5c-entities — `entities` has a 13-rung ladder and NO writer that consults it; route the `email`/`phone` writers through the guard

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. This is the one PR5c
population with no fix yet. A JS change on the two highest-traffic `entities` contact writers, a
rolled-back proof, and a dated count — **not** a repo-wide rewrite of every PATCH.

**Read first:** `docs/architecture/field-provenance-ladder.md` (§1 model, §2 instruments — new
canonical page) → backlog **PR5c-entities** → `docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`
§3c. Then the `entities.email` / `entities.phone` ladder in migration `20260903120000`
(`manual`@1 → `salesforce`@20 → `domain_owner_contact`@55 → `costar_sidebar`@60) and
`api/_shared/field-priority-guard.js` (`shouldWriteField` / `recordFieldWrites` /
`provenanceTargetDatabase`).

**Deploy-state check first:** `/version` vs `06a3ee5d` (`git merge-base --is-ancestor`). PR5c's
five caller fixes ship on that redeploy; if it has not landed, say so and keep every "0 → N"
expectation post-deploy.

## The population (verify, one query / one grep each)

- 13 `entities` rungs in `field_source_priority`; `field_provenance` rows with `target_table='entities'`:
  **0** (positive control: `dia.properties`, thousands).
- Repo-wide, no `lcc_merge_field` / `shouldWriteField` call passes `entities` as the table, while
  the table is PATCHed from at least: `admin.js`, `contact-writeback.js`,
  `owner-contact-propagate.js`, `lease-extractor.js`, `operations.js`, `sync.js`. **Enumerate the
  full writer set with a grep for the SHAPE** (`from('entities')`… `.patch` / `PATCH` / `upsert`)
  — N15c proved a grep for one spelling finds a third of the writers.
- For each writer: which columns does it write, and does the ladder hold a rung for them? The 13
  rungs cover which fields exactly? A writer of a column with no rung is out of scope here
  (that is a registration decision, PR5a's class) — list it, do not fix it.

## Build — the two contact writers only

1. **`owner-contact-propagate.js` and `contact-writeback.js`** (the `email`/`phone` writers, which
   are what the `20260903120000` ladder was registered FOR): before each PATCH of `email`/`phone`,
   call `shouldWriteField` with the writer's real source name (`domain_owner_contact` /
   `salesforce` / whatever the rung says — **match the rung's spelling byte-for-byte**, and
   `target_database` via `provenanceTargetDatabase()`). Honour the decision: `write` proceeds,
   `skip`/`conflict` does not overwrite (fill-blanks doctrine — this is the point of the ladder).
   Pass `p_value` as the jsonb value, **never `JSON.stringify`'d** (PR5c §2 — three sites double-
   encoded and paid for it).
2. **Prove it before deploy in a rolled-back replay** with each writer's exact payload: the RPC
   returns `decision=write` on a blank, `skip` when `manual`@1 already holds a value, and inserts
   a `field_provenance` row in all three cases. Capture the SQLSTATE on any failure.
3. **Do not change the other writers** in this change. For each, record in the audit: columns
   written, whether a rung exists, and the recommended follow-up (route through the guard /
   register a rung / leave — with a one-line reason).
4. **Predict the behaviour change** on the two writers: over the last 30 days, how many of their
   writes would the ladder have turned into `skip` (a curated `manual`/`salesforce` value already
   present)? That number is the fill-blanks protection being switched on, and it must be quoted
   before the deploy, not discovered after.

## Verify on

- `field_provenance where target_table='entities'`: **0 → N** post-deploy, split by `source` and
  `decision`, within 24 h of the first cron/verdict that exercises either writer. Name which
  producer fired.
- The rolled-back replay: three decisions, three rows, SQLSTATE none.
- `v_field_provenance_unranked` before/after in one session (should not grow — the rungs exist).
- `provenance_failed` / `provenance_write_failed`: 0 new after deploy (the guard path is visible to
  the PR12 signal, unlike the direct callers).

## What NOT to do

- No repo-wide sweep of every `entities` PATCH; no new rungs; no rung deletions; no
  `JSON.stringify` on a jsonb parameter; no second copy of the vocabulary — `provenanceTargetDatabase()`
  is the owner.

## Report back

The full writer census (writer · columns · rung yes/no · follow-up) · the two-writer change with the
replay result · the predicted skip count · post-deploy `0 → N` by source/decision, or the honest
"not yet exercised, producer X fires at Y" · deploy state at time of run · anything that outranks this.
