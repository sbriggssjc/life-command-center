# PR5c-entities — the `entities` ladder had 13 rungs and no caller

**Date:** 2026-09-02 · **Target:** LCC Opps `xengecqvemvfknjvbvrq` · **Scope:** JS only, no migration.
**Canonical topic page:** [`docs/architecture/field-provenance-ladder.md`](../architecture/field-provenance-ladder.md).
**Predecessor:** [`PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`](./PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md) §3c.

---

## 1. The population, re-measured

| fact | value | how |
|---|---:|---|
| `field_source_priority` rungs on `entities` | **13** | `email` 5 · `phone` 5 · `canonical_name` 2 · `name` 1 |
| `field_provenance` rows on `entities` | **0** | — |
| positive control (`dia.properties`) | **49,571** | the zero is real, not a broken query |
| `entities` write call sites, repo-wide | **41 across 16 files** | AST walk (see §5) |
| sites passing `p_target_table='entities'` to `lcc_merge_field` | **0** | — |

`lcc_merge_field` **always** inserts a row — write, skip AND conflict — so a zero means the RPC was
never called, never that it decided against writing. The rung's own PR5 note said it in as many
words: *"Referenced only in a comment (`owner-contact-propagate.js:37`)."*

**⚠️ The ladder's live spelling is not what the brief said.** Priority 1 is **two** sources,
`manual_edit` and `manual_resolution` — there is no rung named `manual`. All ten `email`/`phone`
rungs are `min_confidence = 0.000` and **`enforce_mode = 'record_only'`**.

---

## 2. ⚠️ THIS RECORDS PROVENANCE. IT DOES NOT SWITCH ON PROTECTION.

The brief asked for the predicted count of writes the ladder would turn into `skip`. **It is zero,
and it stays zero until somebody changes `enforce_mode`.** Three independent measurements:

1. **Structural, first call.** `lcc_merge_field` reads its "current value" from `field_provenance`,
   **not from the live column**. That table is empty for `entities`, so the first call for every
   `(entity, field)` returns `decision='write'`, `reason='no_prior_provenance'` — whatever the
   column already holds. *The ladder cannot protect a curated value it has never seen.*
2. **Structural, thereafter.** Every rung is `record_only`, and `shouldWriteField` blocks only on
   `strict` (its own behaviour matrix). A `skip` decision is recorded and the write proceeds.
3. **Empirical.** Of `owner-contact-propagate`'s 39 lifetime fills, **0** landed on a field carrying
   a competing `metadata.field_sources` stamp. `contact-writeback` has produced **1** stamped row in
   the entire 66,926-entity table.

So this change buys the **ledger**, which is the prerequisite for ever flipping `enforce_mode` — you
cannot grade a gate that has no history. Claiming it buys fill-blanks protection would be false.
The protection that is live today is each writer's own logic, and both are untouched:
`applyFill`'s immediate re-read, and `planContactFieldPromotion`'s `metadata.field_sources` rank.

**That leaves two ladders observing the same two columns, one of which enforces.** That is the
documented PR10 *"one source, two ladders"* shape. Stated, not silently merged. → **PR5c-enforce**.

---

## 3. What shipped

| writer | source | columns gated | columns passed through |
|---|---|---|---|
| `api/_handlers/owner-contact-propagate.js` → `applyFill` | `domain_owner_contact`@55 | `email`, `phone` | — (it writes nothing else) |
| `api/_handlers/contact-writeback.js` → `promoteFields` | `salesforce`@20 | `email`, `phone` | `address`, `city`, `state`, `zip`, `metadata` |

Both call `filterByFieldPriority` with `targetDb` from `provenanceTargetDatabase('lcc_opps')` (the
PR5c single owner of the closed vocabulary), `targetTable: 'entities'` and the registry's exact
source spelling. Both **fail open** on an RPC error, house style — a registry outage must never cost
a curated write; `field-priority-guard.js` counts the dropped row and opens a health alert (PR12).

Three details that are load-bearing rather than tidy:

- **The ledger is built from what was WRITTEN.** `applyFill`'s `lcc_owner_contact_propagate_log`
  rows now come from the gated patch. Built from the plan, a blocked field would read as filled.
- **A dropped field loses its `metadata.field_sources` stamp.** Otherwise the in-metadata ledger
  claims `salesforce` wrote a value it was blocked from writing — and that stamp is exactly what
  `planContactFieldPromotion` reads *next* time to decide whether a later source may correct the
  field. A lie there is self-perpetuating.
- **Scope is `email`/`phone` only, and that is a decision.** `address`/`city`/`state`/`zip`/
  `metadata` have **no `entities` rung**; routing them through `lcc_merge_field` would mint
  provenance for unregistered triples and push them onto `v_field_provenance_unranked`. Whether they
  *should* be registered is PR5a's question, not this change's.

---

## 4. Proof — a rolled-back replay on live data, 0 residue

Each writer's exact payload, replayed against a real entity inside a `DO` block that `RAISE`s:

| case | payload | decision | reason |
|---|---|---|---|
| 1 | `domain_owner_contact`@55, `email`, blank | **write** | `no_prior_provenance`, `new_priority=55` ⇒ *the rung resolved* |
| 2 | `manual_edit`@1, same field | **write** | `source manual_edit outranks domain_owner_contact (1 < 55)` |
| 3 | `domain_owner_contact`@55 again | **skip** | `lower-priority source … cannot override manual_edit (1)` — **`enforce_mode=record_only`, so `shouldWriteField` still returns `write:true`** |
| 4 | `salesforce`@20, `phone`, blank | **write** | `no_prior_provenance` |
| 5 | value carrying `"` + newline (the PR12 break class) | **write** | no `22P02` — the PR12 hash fix holds |

**5 calls ⇒ 5 `field_provenance` rows** (including the skip), then rolled back: `entities` count
back to 0. `new_priority=55` in case 1 is what proves the spelling is byte-correct; a miss returns
NULL and lands silently on the unregistered branch.

---

## 5. The full `entities` writer census

**41 write sites across 16 files.** ⚠️ My own first pass — a `grep` for `opsQuery('PATCH', 'entities…`
— found **24 across 13**. The AST walk found 40% more. *The N15c lesson in miniature: a grep for one
spelling does not find the writers.*

| file | sites | rung-governed columns it writes | follow-up |
|---|---:|---|---|
| `_handlers/owner-contact-propagate.js` | 1 | `email`, `phone` | ✅ **wired here** |
| `_handlers/contact-writeback.js` | 1 | `email`, `phone` | ✅ **wired here** |
| `_shared/bridge-handlers-salesforce.js` | 3 | `email`, `phone`, `name`, `canonical_name` — **on the CREATE (`POST`) path only**; both PATCHes are `metadata`-only | ✅ **WIRED 2026-09-02 (PR5c-entities-b).** Recording lives in `insertEntity` (:232), the single owner of the POST, so both callers (:355 Account, :415 Contact) and any future one are covered; only `email`/`phone` are routed. Measured: 336 identities/30 d, **329 of them entity CREATES**, 297 with an email + 69 with a phone ⇒ **~366 provenance rows / 30 d ≈ 12/day**. Was: 🟡 **top candidate.** Live and by far the highest-traffic contact lane (SF Contact identities: 10,086 total, **336 in 30 days, newest today**). A create has no prior value to override, so the ladder question is weaker — but it is the writer most likely to *establish* the value every later source is judged against. → **PR5c-entities-b** |
| `api/sync.js` · `api/domains.js` · `_shared/entity-link.js` · `mcp/opportunity-sync.js` | 3 · 2 · 2 · 1 | `name`, `canonical_name` | 🟡 **leave.** `canonical_name` is written by the N15c `BEFORE` trigger as its single owner and its @1 rung is already `PR5:retire`; a caller-side gate there would gate a value the trigger overwrites. `name` carries exactly one rung (`w8_u5_naming_hygiene`@40), so every other writer is unregistered by construction → PR5a/PR5b, a registration question. |
| `api/operations.js` | 5 | `email`, `name`, `canonical_name` | 🟡 **leave.** The `email` write is the `[MERGED]` tombstone path at :4664 and the two person-creates at :2587/:2816 — creates and merges, not contact enrichment. |
| `api/admin.js` | 8 | `email`, `name`, `canonical_name` | 🟡 **leave, with one exception worth naming:** :2726 `unstampMisparseMember` **clears** `email` to `null` (the TM-misparse reversal). A deliberate destructive clear is a poor fit for a fill-blanks ladder; if it is ever wired it should record, never gate. |
| `_handlers/entities-handler.js` · `_handlers/sidebar-pipeline.js` · `api/intake.js` · `_shared/salesforce-sync.js` · `_shared/sf-account-link.js` · `_shared/asset-entity.js` · `_handlers/lease-extractor.js` | 3 · 3 · 5 · 1 · 1 · 1 · 1 | **(none)** — `metadata` / `tags` / `updated_at` / opaque `<patch>` | ⚪ **out of scope.** No rung exists. |

---

## 6. Verify on

- **`select source, decision, count(*) from field_provenance where target_table='entities' group by 1,2`
  — expect 0 → N.** ⚠️ **This will NOT happen on a schedule.** Neither writer has a cron:
  `owner-contact-propagate-tick` and `contact-writeback-tick` are mounted in `server.js` and
  operator-invoked only. `owner-contact-propagate` last ran **2026-08-15** (batch `ocp_20260815`,
  39 rows, its only batch ever). `contact-writeback` is additionally gated **off**
  (`SF_CONTACT_WRITEBACK`, `feature_flags_registry.state = 'off'`). **`0 → N` requires an operator
  `POST`**; saying "within 24 h" would be a promise nothing can keep.
- `v_field_provenance_unranked` — must **not** grow (the rungs exist; scope was limited for this reason).
- `provenance_failed` / `lcc_health_alerts(alert_kind='provenance_write_failed')` — 0 new.
- Guard: `test/pr5c-entities-ladder-wiring.test.mjs` — **14 tests, 17/17 mutations RED.**

**Deploy state at time of writing:** live `/version` = `557e1462a5f2` = current `origin/main`;
`git merge-base --is-ancestor 06a3ee5d 557e146` ⇒ true, so PR5c's five caller fixes **are** live.
(The sandbox has no Railway egress — proxy 403 — so `/version` was read via `net.http_get` from the
DB, which does.)

---

## 7. Lessons

- **⚠️ A LADDER THAT READS ITS OWN LEDGER CANNOT PROTECT A COLUMN IT HAS NEVER SEEN.**
  `lcc_merge_field` compares against `field_provenance`, not the live value. Wiring a ladder onto a
  table with an empty ledger buys recording, and the first write on every field is unconditional.
  **Do not describe such a change as "switching on fill-blanks protection."**
- **⚠️ `enforce_mode` IS PART OF THE WIRING, AND `record_only` MEANS THE GATE DOES NOT GATE.** Ten
  rungs, all `record_only`. A guard call that returns `write:true` on every `skip` is a *recorder*.
  Read the enforce mode before predicting any behaviour change.
- **⚠️ A SECOND, IN-METADATA LEDGER ON THE SAME COLUMNS MUST BE KEPT HONEST BY THE FIRST.** Gating a
  field without also removing its `metadata.field_sources` stamp makes the two ledgers disagree, and
  the metadata one is the one the writer consults next run.
- **⚠️ THE GREP UNDERCOUNTED THE WRITERS BY 40%** (24/13 → 41/16), and unioning columns across a
  file's sites conflated a `metadata`-only PATCH with a create that carries `email`/`phone`.
  **Count sites with a parser, and read the payload per SITE, not per file.**
- **A guard that asserts a source *mentions* an identifier is satisfied by the import line** (OCR2).
  Both halves here are behavioural or AST-span-based; the mutation pass is what proved it.
