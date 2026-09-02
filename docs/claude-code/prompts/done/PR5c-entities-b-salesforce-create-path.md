# PR5c-entities-b — the highest-traffic `entities` contact writer (Salesforce bridge, CREATE path) records no provenance

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. Small JS change on one
writer + a rolled-back proof + a dated count. This is the writer that ESTABLISHES the `email`/`phone`
value every later source is judged against, and it runs daily — which is why it outranks
`PR5c-enforce`.

**Read first:** `docs/architecture/field-provenance-ladder.md` §1–§3 → backlog **PR5c-entities-b** →
`docs/audits/PR5c_entities_LADDER_WIRED_2026-09-02.md` §5 (why this writer was not bundled: it is
CREATE-only, both its PATCHes are `metadata`-only) → the wired precedent in
`api/_handlers/owner-contact-propagate.js` / `contact-writeback.js` (#2066) → `field-priority-guard.js`
(`shouldWriteField`, `recordFieldWrites`, `provenanceTargetDatabase`).

**Deploy-state check first:** `/version` vs `e9c74357`. If the redeploy has not landed, every
`0 → N` below is post-deploy and you say so.

## The population (verify)

- `external_identities` `salesforce/Contact`: 10,086, **336 in 30 days**, newest the day of the audit.
- `bridge-handlers-salesforce.js`: exactly which code path POSTs `entities` with `email`/`phone`?
  Confirm with the AST-walk approach from PR5c-entities (a grep found 24 of 41 sites): the CREATE
  path carries them; the two PATCHes are `metadata`-only. State the line numbers.
- What `source` name does the ladder hold for this writer? The rungs are `salesforce`@20 on both
  `email` and `phone` (`record_only`). Match it byte-for-byte.
- **Does a CREATE ever collide with an existing entity?** If the bridge's dedup misses (N15c
  canonical-key drift, N21's `sync.js`/`domains.js` class), a "create" is really an override of a
  row that already exists under another key. Measure: of the 336, how many landed on a
  `canonical_name` that already had a live entity (the N15c-D gate query)? That number decides
  whether this is fill-blank-by-construction or not.

## Build

1. On the CREATE path, after the entity id is known, call `recordFieldWrites` (or the same
   `shouldWriteField` shape the two wired writers use) for `email` and `phone` with
   `source='salesforce'`, `target_database = provenanceTargetDatabase('lcc')`, `p_value` as jsonb
   (**never `JSON.stringify`**), `decision` as the RPC returns it. On a genuine create the ledger
   is empty for that row, so expect `write`/`no_prior_provenance`; **do not gate the INSERT on the
   decision** — a create has nothing to protect, this is recording so that the NEXT writer has
   something to be judged against.
2. **Rolled-back proof** with the writer's real payload: one row in `field_provenance` per field,
   `source='salesforce'`, `target_database='lcc_opps'`, SQLSTATE none. Then the positive control
   PR5c taught: the same call with `'lcc'` as `target_database` must fail 23514 — proving the
   vocabulary owner is on the path.
3. **Predict the daily delta**: ~336/30d ⇒ ~11 entities/day ⇒ ~22 provenance rows/day. Quote it
   so the post-deploy count can be read.
4. Guard: extend `test/pr5c-entities-ladder-wiring.test.mjs` (or a sibling) so the bridge's CREATE
   path is asserted to call the guard with `source='salesforce'` — mutation-verify by deleting the
   call and by changing the source string.

## Verify on

- `field_provenance where target_table='entities' and source='salesforce'`: **0 → N** within 24 h
  post-deploy, N ≈ 2 × the bridge's entity creates in that window (read the creates from
  `external_identities.created_at`, not from the writer's log).
- `v_field_provenance_unranked`: unchanged (the rungs exist).
- `provenance_failed` / `provenance_write_failed` alerts: 0 new.
- The N15c drift view: still 0 (the bridge's `canonical_name` is trigger-owned; this change must
  not touch it).

## What NOT to do

- Do not touch the two `metadata`-only PATCHes. Do not change `enforce_mode` (PR5c-enforce is a
  separate, later decision once the ledger has history). Do not wire `sync.js`/`domains.js` here
  (N21). Do not add a rung.

## Report back

The CREATE-path site (file:line) · the collision measurement (creates that landed on an existing
key) · rolled-back proof + the 23514 positive control · predicted vs observed daily rows · deploy
state at run · anything that outranks this.
