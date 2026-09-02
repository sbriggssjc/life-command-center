# PR5c — the 33 LCC-internal rungs: five callers were sending a value the table refuses

**2026-09-02 · LCC Opps `xengecqvemvfknjvbvrq` · diagnosis + a five-line caller fix.**
Migration `supabase/migrations/20261011120000_lcc_pr5c_internal_rung_verdicts.sql` (applied live).
Guard `test/pr5c-provenance-target-database.test.mjs` (9 tests, **12/12 mutations RED**).
Deploy state at time of measurement: production `/version` = **`a7f16694`** = `main` HEAD;
`git merge-base --is-ancestor 68ede28c a7f16694` → **true**, so PR12's JS half is live.

---

## 0. The answer, in one constraint

```
field_provenance_target_database_check
  CHECK (target_database = ANY (ARRAY['lcc_opps','dia_db','gov_db']))
```

`lcc_merge_field()` **always inserts a `field_provenance` row** — `write`, `skip` and `conflict`
all land, there is no early return. So **a (table, field, source) sitting at zero rows means the
RPC never COMPLETED**, never that it decided against writing. That single observation converts the
question from "did the lane run?" into "does the call succeed at all?", and it is answerable in one
rolled-back transaction.

Five call sites passed a value outside that vocabulary and therefore raised **23514 on 100% of
calls**, into a bare `catch (_e) { /* best-effort */ }`:

| source | call site | sent | valid? |
|---|---|---|---|
| `w8_u3_link_propagation` | `api/admin.js` (w8_u3 verdict) | `'lcc'` | ❌ |
| `folder_feed_cre` | `api/_shared/cre-registry.js` | `'lcc_db'` | ❌ |
| `comms_observed` | `api/admin.js` (reachability harvest) | `'dia'`/`'gov'` | ❌ |
| `w9_2_internal_harvest` | `api/admin.js` (reachability harvest) | `'dia'`/`'gov'` | ❌ |
| `availability_scraper` | `supabase/functions/availability-checker` | `'dia'`/`'gov'` | ❌ |
| `lcc_generated` | `api/_handlers/property-doc-writeback.js` | `dia_db`/`gov_db` | ✅ |

Replayed live 2026-09-02, each site's exact payload, in a rolled-back transaction: **6 of the 6
PR5 §2 `writer_live_zero_rows` sources fail, 5 with 23514.** The sixth — `lcc_generated` — returns
`decision=write, rung=1`: its call is correct and its lane has simply not run.

**⚠️ The rung lookup keys on `(target_table, field_name, source)` ONLY.** `target_database` is not
part of it. So a wrong value here is structurally invisible to everything that reasons about
ladders — PR5's triage, `v_field_provenance_unranked`, the effective-source census. It fails at the
INSERT, after every ladder question has already been answered correctly.

---

## 1. 🚨 The lesson was already written down — beside ONE call site

`api/admin.js`, the `comms_owner_bridge` stamp:

> *"pass the raw owner-entity id (the RPC casts it to jsonb) — do NOT JSON.stringify it, which
> would double-encode into `'"\"<id>\""'`. `p_target_database='lcc_opps'` matches the ops-local
> convention (sf-promotion-worker, availability-checker)."*

Both halves of the fix, stated correctly, in 2026-08. And that lane is **the only LCC-internal lane
that has ever written provenance** — 22 rows on `public.activity_events`, 2026-08-14.

Four siblings kept the bug. So did **`availability-checker`, which that comment cites as a
precedent** and which sends the bare `"dia"`. **A fix recorded next to one call site is not a fix
for the class**, and a comment naming a sibling as correct is not evidence that it is. This is the
FRED `| tee` lesson (*grep for the masking SHAPE, never one spelling*) applied to a vocabulary
instead of a shell idiom.

`api/_shared/field-priority-guard.js` is now the single owner —
`PROVENANCE_TARGET_DATABASES` + `provenanceTargetDatabase()` — and the guard enforces it repo-wide.
⚠️ The guard's own docstring taught the bug (`targetDb: 'dia'` in its usage example); corrected.

---

## 2. ⚠️ PR12 §4 measured the right thing about the wrong population

PR12 §4 concluded *"PR5c is NOT explained by PR12"* from a census of **break-class values in the
stored curated columns** — `entities.name` 23 / 69,462 (0.03%), zero everywhere else — reasoning
that a dropped stamp would need a ~100% rate.

The rate **is** ~100%, because the payload is not the column. Three of the five sites wrapped
`p_value` in `JSON.stringify()`, and `p_value` is a **jsonb parameter** — PostgREST hands it the
parsed JSON value. So `JSON.stringify('Boyd Watterson')` arrives as jsonb `"\"Boyd Watterson\""`,
whose `::text` rendering carries a backslash at position 2. Measured against PR12's pre-fix
expression:

```sql
encode(sha224(coalesce(to_jsonb('"Boyd Watterson"'::text)::text,'')::bytea),'hex')
--> ERROR 22P02: invalid input syntax for type bytea
```

**Every string those three sites sent was break-class, unconditionally** — not 0.03%. PR12's own
CLAUDE.md note states the rule it then missed here: *"the predicate has to match what the caller
actually hands the function, not what the column happens to hold."* The census asked what the
column holds.

It does not change PR12's verdict (23514 fires anyway, and PR12's DB fix is live so the hash no
longer objects) — but *"PR12 does not explain this"* was true for the wrong reason, and a reader
would have stopped looking one layer too early. The double-encoding is removed in the same change:
shipping the `target_database` fix alone would have armed a malformed payload that no other source
could ever compare equal to.

---

## 3. The 33 rungs, verdicted

`v_field_source_priority_triage.pr5c_verdict` — **33 of 33 verdicted, 0 unverdicted.**

| verdict | table | rungs | what it means |
|---|---|---:|---|
| `reached_and_broken` | `public.lcc_cre_properties` | 7 | live lane, every stamp 23514s |
| `reached_and_broken` | `public.lcc_cre_property_documents` | 3 | same |
| `unreached_and_broken` | `entity_relationships` | 2 | branch never completed **and** the string is invalid |
| `no_merge_path_caller` | `entities` | 13 | writers exist, none routes through `lcc_merge_field` |
| `ledger_is_elsewhere` | `lcc.lcc_property_owner` | 6 | scored on a second ledger, by design |
| `producer_never_wired` | `lcc.lcc_entity_portfolio_facts` | 2 | PR5e's dead constant |

### 3a. `reached_and_broken` (10) — a real, recoverable loss

`performCreRegister()` calls `recordProvenance()` on **every** registration.
`lcc_cre_properties` holds 311 rows (3 touched in 30 days); `lcc_cre_property_documents` 1,066
(13 in 30 days, newest 2026-08-27). The lane is live; the stamp has never once landed.

### 3b. `unreached_and_broken` (2) — two independent facts, and both matter

- `w8_u3_link_apply_log` holds **one row**, `status='conflict'` (`ambiguous_entity_match`,
  2026-08-07), which returns **before** the edge insert and therefore before the stamp.
- **⚠️ 26 reviews read `status='applied'` and none of them is this lane.** All 26 are
  `proposal_type='person_email_merge'`, a sub-lane that creates no edge (`applied_log_id` NULL on
  all 26; **zero** `entity_relationships` rows carry a `review_id`). Split by `proposal_type`,
  `prior_owner_link` — the sub-lane that reaches the stamp — has **2 rows ever**, both terminal
  non-applies. *A status column on a table serving two sub-lanes is not a reading of either.*
- And the string is invalid anyway, so the first successful apply would have lost its provenance
  silently. Fixing the caller now is what stops that trap firing on the day the lane finally works.

**⚠️ NOT a PR7 orphan column, contrary to the brief's premise.** `developed` / `owns` are
relationship **types**, and the caller passes `relType` as `p_field_name` deliberately; the rungs
were registered to that convention and are correct. Retiring them would have been wrong.

### 3c. `no_merge_path_caller` (13) — the biggest population, and it is a build gap

**No `lcc_merge_field` call site anywhere passes `p_target_table='entities'`** — verified by a
census of all 21 `p_target_database` sites and every dynamic `targetTable` expression, each of
which resolves to a domain-schema table. Meanwhile `entities` is PATCHed from a dozen places
(`admin.js`, `contact-writeback.js`, `owner-contact-propagate.js`, `lease-extractor.js`,
`operations.js`, `sync.js`). The ladder — including the `entities.email`/`phone` rungs added by
`20260903120000` — was registered aspirationally and nothing was ever routed through it.
Nothing built here; backlog **PR5c-entities**.

### 3d + 3e. `ledger_is_elsewhere` (6) and `producer_never_wired` (2) — recorded, NOT retired

`lcc.lcc_property_owner`'s six rungs are the property-owner authority ladder scored by
`lcc_reconcile_property_owner` over `lcc_property_owner_evidence` (15,052 rows;
`domain_true_owner` wrote the day of the audit). That resolver emits no `field_provenance`, and
wiring it is PR10 — *a decision, not plumbing*. The two portfolio-fact rungs are PR5e's dead
`A2_PROVENANCE_SOURCE` constant.

Both are **soft-recorded in `notes`, never deleted**: PR5 measured that "unregistered" is a
different BRANCH of `lcc_merge_field`, not a lower rung, so a registry edit moves merge outcomes in
both directions.

---

## 4. ⚠️ PR5 §1a's headline is corrected: it HAS run on an LCC-internal table

*"`field_provenance` has never run on any LCC-internal table"* is false. `public.activity_events`
carries 22 rows (`comms_owner_bridge`, 2026-08-14) and `audit_run_log` one smoke row. The true,
narrower claim is: **it has never run on any of the six tables carrying the 33 rungs.** The
exception matters because it is the working control — the one lane that sends `lcc_opps` and does
not double-encode.

---

## 5. ⚠️ PR12's failure signal cannot see any of these five

`provenance_failed` / the `provenance_write_failed` alert live in `shouldWriteField` /
`recordFieldWrites`. **None of the five broken sites goes through either** — they call
`opsQuery('POST','rpc/lcc_merge_field')` directly and swallow the result in a bare `catch`.
Measured live: `lcc_health_alerts(alert_kind='provenance_write_failed')` open = **0**, over a
population that was failing 100% of the time.

So the instrument built to make a dropped stamp loud is scoped to the guard path, and the paths it
cannot see are exactly the ones that were broken. **An instrument's population is part of the
instrument** (B6a). Routing the direct callers through the guard's failure signal is backlog
**PR5c-signal** — deliberately not bundled, because it would change the failure semantics of five
verdict paths in the same change that fixes their strings.

---

## 6. Verification

| | before | after |
|---|---:|---:|
| `field_source_priority` rungs | 2,141 | **2,141** |
| rung fingerprint (`md5` of table\|field\|source\|priority\|enforce_mode\|min_conf) | `161df9f1…` | **`161df9f1…`** |
| `pr5_verdict` populated | 426 | **426** |
| `pr5c_verdict` populated | 0 | **33** |
| `v_field_provenance_unranked` (30d) | 29 | **29** |
| `field_provenance` rows on the six tables | 0 | 0 *(lands on the next Railway deploy)* |

**The merge-outcome delta is zero and it is structural, not measured-and-hoped**:
`lcc_merge_field` reads `priority`, `min_confidence` and `enforce_mode` — it never reads `notes`.
The identical fingerprint confirms nothing else moved.

**Fixed-payload replay**, rolled back, deliberately carrying a PR12 break-class value
(`Boyd Watterson "Fund II"`): all six sources return `decision=write` at their registered rung
(85 / 50 / 50 / 40 / 60 / unregistered), and the LCC-internal row count moves **0 → 3** inside the
transaction. Residue after rollback: **0**.

**⚠️ Verify on the PRODUCER, not on this replay (Class 8).** The number that says the callers are
fixed is a `field_provenance` row appearing on `public.lcc_cre_property_documents` after the next
CRE folder-feed registration, post-deploy. Until the Railway redeploy carries this change the live
count correctly stays 0 — *merged is not running*.

---

## 7. Found, not fixed

- **PR5c-entities** — 13 rungs on `entities` with no merge-path caller. The cheapest real fix is
  routing `owner-contact-propagate.js` / `contact-writeback.js` (the `email`/`phone` writers) through
  `shouldWriteField`, which already speaks the vocabulary correctly.
- **PR5c-signal** — the five direct callers bypass PR12's `provenance_failed` counter and alert.
- **PR5c-avail-field** — `availability_scraper`'s dia rung is registered on
  `dia.available_listings.status` while the writer writes **`is_active`** (and its recovery path
  writes `listing_date`, unregistered). Confirmed by the fixed replay: that arm returns
  `rung=unregistered` while the other five resolve. gov (`url_status`) matches. PR7 class — a rung
  edit moves merge branches, so it is named rather than patched.
- **The edge function is a THIRD deploy surface.** `supabase/functions/availability-checker` ships
  with neither the migration nor the Railway build (DOC18). Its source is fixed here and it has
  **not** been deployed; check `list_edge_functions` `updated_at` against the merge time before
  claiming `availability_scraper` is writing.
