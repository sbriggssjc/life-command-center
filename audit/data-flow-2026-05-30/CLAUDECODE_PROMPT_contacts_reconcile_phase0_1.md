# Claude Code (LCC) — contacts reconcile: resolve the split-brain, then connect owners to people

**Two phases, one round, four internal gates.** Scott chose to combine so a discovery in
Phase 1 can adjust Phase 0 before either lands. That is the right call, but it means
**nothing applies without a dry-run first**, and Phase 1 must not start until Phase 0's
verification passes.

---

## Why (all grounded live 2026-07-21)

### The blocking problem: two live, diverging copies of `unified_contacts`

| | gov (`scknotsqkcheojiaewwh`) | LCC Opps (`xengecqvemvfknjvbvrq`) |
|---|---|---|
| rows | **30,494** | **30,003** |
| `sf_contact_id` | 16,990 | 17,287 |
| `recorded_owner_id` | 14,479 | 13,408 |
| `entity_id` | **column does not exist** | 700 |
| last write | 2026-07-20 22:53 | 2026-07-21 13:17 |

They have diverged in **both directions** — gov has more rows and more
`recorded_owner_id`; ops has more `sf_contact_id` and is the only one with `entity_id`.

`api/_handlers/contacts-handler.js:29-34` defines `CONTACTS_HUB` (default `'gov'`), and
`govQuery()` (line 185) path-routes *only* `unified_contacts` to ops when the flag is on.
Everything else — `contact_change_log`, `contact_merge_queue`, `system_tokens` — stays on
gov. Meanwhile `bridge-handlers-salesforce.js`, `bridge-handlers-outlook.js`,
`intake-promoter.js`, `operations.js` and `actions.js` call `opsQuery` **unconditionally**,
while `briefing-data.js`, `daily-briefing/index.ts`, `copilot-chat/index.ts` and
`detail.js` (`_source=gov`) read **gov** unconditionally.

So writers and readers already point at different databases. The A9b migration ran
(2026-05-29); the application cutover never did.

### The consequence: owners and people don't connect

```
bridged owner entities in LCC ......... 15,257
  → with an SF Account .................... 969  (6.4%)
  → with a PERSON attached ................. 92  (0.6%)

unified_contacts (ops) ................ 30,003
  → linked to an entity ................... 700  (2.3%)
  → carrying sf_account_id .............. 17,287
  → sf_account_id AND unlinked .......... 16,632
```

`entity_id` is set by effectively one path — `bridge-handlers-salesforce.js:374,396`, and
**only when the SF Contact has an email**. Rows from `ingestContact`, `ingestWebexCalls`,
`ingestCalendarContacts`, `intake-promoter` or the Owner Drawer get `NULL` permanently.

### The missing matcher was specced and never built

`SPEC_unified_contacts_gov_dia_wiring_2026-05-21.md` identifies exactly this: the matcher
resolves on email / phone / name but has **no company-entity path**, and LLCs are *"the
bulk of net-lease counterparties."* It specifies company-key resolution, a batched
backfill, and an incremental tick. It ends: *"Spec only. No code or data changed."*
**Read that spec and follow it where it still applies** — do not redesign from scratch.

---

## Unit 0 — resolve the split-brain (must complete and verify before Unit 1)

### 0a. Enumerate the delta BEFORE merging anything

Produce a real diff, reported and committed as an artifact — do not merge on assumption:

- rows in gov not in ops (by `unified_id`, then by normalized email as a secondary key)
- rows in ops not in gov
- rows present in both whose field values disagree, per field
- which side is newer per differing row (`updated_at`)

**Report this first.** If the delta shows something that changes the plan — e.g. gov holds
the only copy of a field class — say so and stop for a decision rather than proceeding.

### 0b. Canonical = LCC Opps

Ops is where `entity_id` exists and where the BD spine (`entities`, `touchpoint_cadence`,
`v_priority_queue_*`) lives. Merge gov-only rows and gov-newer field values **into ops**,
using the existing `FIELD_PRIORITY` arbitration (`contacts-handler.js:48-56`) rather than
a new rule. Tag every merged row/field `field_sources.*._split_reconcile = '<batch_tag>'`
so the whole operation is reversible by tag.

### 0c. Make the routing coherent

- Flip `CONTACTS_HUB` to `ops` **only after 0a/0b verify**.
- Fix the split-transaction hazard: `contact_change_log` and `contact_merge_queue` writes
  must follow the contact row to ops, not stay on gov.
- Repoint the unconditional gov readers (`briefing-data.js`, `daily-briefing/index.ts`,
  `copilot-chat/index.ts`, `detail.js` `_source=gov` contact lookups) at the canonical hub.
- Leave the gov table **in place and read-only** (do not drop) — it is the rollback.

### 0d. Fix the two live bugs while you are in here

- `api/operations.js:4007` and `:4141` query `unified_contacts?id=eq.…` / `select=id`.
  **The PK is `unified_id`** — these 400 against PostgREST today.
- The SF auto-link blocks (`contacts-handler.js` ~973, ~1253) use raw `govQuery('PATCH')`,
  bypassing the `auditedPatchGov` layer the rest of the file uses, so `sf_contact_id`
  changes go unaudited. Route them through the audited layer.

### GATE 1 — do not start Unit 1 until all of these hold

- one canonical table, delta reconciled, row counts explained (not merely equal)
- `CONTACTS_HUB=ops`, and a write through the API lands the contact **and** its change-log
  row in the same database
- the gov copy is read-only and reversible
- `npm run check:boot` and the full suite pass

---

## Unit 1 — company/LLC resolution + entity linkage

### 1a. Backfill `entity_id` from the identity keys already present

For every unified row with `entity_id IS NULL`, resolve in this order and stop at the
first hit:

1. `sf_contact_id` → `external_identities (salesforce, Contact)` → entity
2. `sf_account_id` → `external_identities (salesforce, Account)` → the ORG entity
   *(this is the person's employer, not the person — see 1c; do not set `entity_id` to an
   org for a person row)*
3. `recorded_owner_id` / `gov_contact_id` / `dia_contact_id` → the domain bridge
4. email → an existing person entity (reuse the R39 email tier in
   `api/_shared/entity-link.js`, do **not** write a second email matcher)

Use `sf15` (`api/_shared/sf-id.js`) for all Salesforce id comparisons — 15/18-char safe,
both directions. Batch the lookups; **no N+1**.

Where no entity exists and the row is a plausible person, mint via `ensureEntityLink` —
the existing guards (`isJunkEntityName`, `isImplausiblePersonName`,
`looksLikePersonName`) apply. **Never invent a person from a company-shaped row.**

### 1b. Company/LLC resolution — the specced piece

Implement the company-key path from the spec: resolve a contact's
`company_name` / `sf_account_id` / `recorded_owner_id` to an **owner organization entity**,
normalizing through the existing helpers (`lcc_normalize_entity_name`,
`canonicalEntityDomain`, and the ORE name-core normalizers) rather than a new normalizer.

Conservative by default: an exact or normalized-core match links; an ambiguous match is
**recorded for review, not guessed**. Follow the precedent already established in
`api/_shared/owner-cross-reference.js` (distinctive-core rules, `isReusablePersonName`) —
that module solved this exact ambiguity problem for owner cross-referencing and its
policy should be reused, not re-derived.

### 1c. Write the edges — this is the actual payoff

For each resolved (person, organization) pair, create an `entity_relationships` edge via
**`linkPersonToEntity`** (`api/_shared/contact-attach.js`) — the same helper the contact
picker and acquisition worker use. Dupe-guarded, `associated_with` / `works_at`,
`metadata.via='contacts_reconcile:<batch_tag>'` for reversibility.

**This is what moves 15,257 owners off 92 attached people.**

### 1d. ⚠️ Blast-radius control — read this before applying

Creating ~15k `entity_relationships` edges is **not** a neutral write. On 2026-07-19
`v_priority_queue_live` collapsed from ~1.1s to >60s and saturated LCC Opps (the auth DB,
forcing a reset) because the entity graph grew. Its CTEs scan `entities` ×
`entity_relationships` (currently ~101k rows) × `external_identities`. PR #1422 made that
scaling linear, not immune.

Additionally, attaching a person to an owner **changes priority-queue band membership** —
owners will move out of P-CONTACT / the contactless worklist into outreach bands. That is
the intended outcome, but it must be observed, not assumed.

Therefore:

- Apply edges in **bounded batches** with a `--limit`, not one transaction.
- **Between batches**, check `lcc_refresh_log` for
  `lcc_refresh_priority_queue_resolved` duration. Baseline today is **~1.8–3.0s**. If it
  crosses **10s**, stop and report rather than continuing.
- Capture band membership (count + `md5` of the ordered entity-id set per band) before and
  after, and report the shift explicitly — which owners moved, and to where.
- The 15s `slow_refresh` alert exists as a backstop, but do not rely on it as the primary
  control.

### GATE 2 — report before the full apply

Run 1a–1c as a **dry-run** first and report: how many rows resolve by each tier, how many
edges would be created, how many owners would gain their first contact, how many stay
ambiguous, and the projected band-membership shift. **Stop there for review.**

---

## Boundaries

LCC-Opps canonical · gov table read-only, never dropped · no SF writes · no dia/gov domain
writes · every write reversible by `batch_tag` · reuse `ensureEntityLink` /
`linkPersonToEntity` / `FIELD_PRIORITY` / `sf-id.js` / `owner-cross-reference.js` — **do not
fork a second matcher, normalizer, or linker** · no new `api/*.js` · ambiguity is recorded
for review, never guessed.

## Explicitly NOT in this round

- **Phase 2** — the incremental reconcile tick, a merge-queue worker that can reach the
  whole table (today `detectDuplicates` scans only the top ~200 by `updated_at`, so the
  tail of 30k is permanently invisible), and scheduled `engagement_score` recomputation
  (it is recency-weighted but only recalculated on write, so stale-high rows sit atop "hot
  leads" indefinitely). **Note these in `CLAUDE.md` as known gaps** so they aren't
  rediscovered.
- **Phase 3** — Outlook contact ingestion (Graph `/me/contacts`), received-mail contact
  harvesting, bounceback parsing, signature-block extraction.
- Do **not** attempt to populate `webex_person_id` — the API in use
  (`telephony/calls/history`) structurally cannot return it. If you touch that area at all,
  make `getDataQuality`'s `webex_linked` metric honest rather than always-0.

## Verify

1. `npm run check:boot`, `npm run verify:deploy`, full suite.
2. One canonical contact table; a write lands contact + change-log in the same DB.
3. `entity_id` coverage climbs from **700 / 30,003** — report the real number.
4. Owners with a person attached climbs from **92 / 15,257** — report the real number, and
   how many of those are in the ≥$1M worklist.
5. Queue refresh stayed in low single-digit seconds throughout; band-membership shift
   reported and explained.
6. Reversal rehearsed: show that a `batch_tag` can be undone (edges removed, fields
   restored) without collateral.
