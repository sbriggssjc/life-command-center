# Field-level provenance & the source-priority ladder — canonical topic page

> **START HERE for anything touching `field_provenance`, `field_source_priority`, `lcc_merge_field`,
> `lcc_flush_provenance_events`, or the question "which source wins on this column".** Created
> 2026-09-02 by consolidating the PR1→PR12 arc out of `CLAUDE.md` (which keeps a ten-bullet
> invariant list and points here). §4 carries that arc's text **verbatim**, so nothing was lost in
> the move. Sibling topic: `public-records-source-lane.md` (the `county_records` / sidebar /
> Regrid question — a SOURCE lane; this page is the LEDGER).
>
> Schema origin: `supabase/migrations/20260425210000_lcc_field_provenance_and_priority.sql`.
> Design intent: `data_quality_self_learning_loop.md`. UI scope: `provenance_resolution_ui_scope.md`.

## 1. The model, in one screen

| object | role |
|---|---|
| `field_provenance` (LCC Opps, **append-only**, 1.27M rows / 1,025 MB) | one row per attempted cross-table write: `(target_database, target_table, record_pk_value, field_name)` + `source`, `confidence`, `source_run_id`, `decision ∈ write/skip/conflict/superseded`, `value` (jsonb), `value_text_hash` |
| `field_source_priority` (2,141 rungs / 68 sources) | per-`(target_table, field_name, source)` rank. **Lower priority = higher trust.** `enforce_mode ∈ record_only/warn/strict`. `notes` carries PR5/PR5c/PR7 verdicts. |
| `lcc_merge_field()` | the single SQL decision function. **Always inserts a `field_provenance` row** — write, skip AND conflict. |
| `lcc_flush_provenance_events(p_domain, p_events)` | the async drain domain triggers post through. **The registry is its allowlist** (PR8): registered ⇒ own name, else `domain_trigger`. |
| `api/_shared/field-priority-guard.js` | JS side: `shouldWriteField` / `recordFieldWrites` (fail open, but counted + alerted since PR12) and `provenanceTargetDatabase()` (the closed vocabulary, PR5c). |

**Semantics that are NOT obvious and have each cost a wrong conclusion:**

- **Unregistered is a BRANCH, not a rank.** An unregistered source fills a blank
  (`unregistered_source_filling_blank`), never overrides (`unregistered_source_with_existing_value`),
  and is overridable by anyone (`replacing_unregistered_source`). Registering or de-registering a rung
  therefore moves outcomes in BOTH directions — never delete one; soft-retire in `notes`.
- **⚠️ The ladder compares against `field_provenance`, NOT the live column, and `enforce_mode`
  decides whether it gates at all.** `lcc_merge_field` reads the current value from its own ledger, so
  the first call on a field whose table has an empty ledger is `no_prior_provenance` ⇒ **write**,
  whatever the column holds. And `shouldWriteField` blocks only on `strict`: under `record_only` a
  `skip` is recorded and the write proceeds. Wiring a ladder onto a fresh table therefore buys the
  LEDGER, not protection — the prerequisite for grading a gate, not the gate. (PR5c-entities.)
- **The rung lookup keys on `(target_table, field_name, source)` only.** `target_database` is a
  separate CHECK (`lcc_opps`/`dia_db`/`gov_db`) evaluated at the INSERT, after every ladder question.
- **`lcc.`, `dia.`, `gov.` in `target_table` are logical prefixes, not schemas** (`to_regclass` is NULL
  for them). Five `target_table` values have no physical table at all (`comp_provenance`,
  `comparable_sales`, `deal_provenance`, `listing_provenance`, bare `properties` — 526k rows, Salesforce-side).
- **⚠️ A rung with no writes has an EIGHTH cause: the capture exists and the page is never
  visited (PR5d).** `costar_cmbs_loan` is 121 rungs — the ladder's largest source — and the
  scanner, the writer and the extension's host match are all live and correct. Ruling out the
  rename class needed a column **only that arm writes** (`loans.costar_loan_id`, `loans.source_url`:
  0 of 2,219 rows on both domains); the sibling tables it alone feeds are 0 rows on both domains
  too. **A zero is evidence only while exactly one writer could have made it non-zero** — that
  single-writer property is now guarded, because a second writer would destroy the detector without
  breaking anything. And **the blocker can be layered**: 27 of the 121 sit behind a dia opt-in flag
  that is false on 11,803 of 11,803 properties, so capturing the page would still write nothing
  there. Two blockers, two verdicts.

- **Two ladders exist.** The property-OWNER authority ladder (`manual` > `domain_true_owner` >
  `rel_purchase` > `sf_seller` > `rel_owns`) is scored by `lcc_reconcile_property_owner` into
  `lcc_property_owner_evidence` and writes NO `field_provenance`. Seven "never-written" sources are
  live there. (Backlog **PR10**: one source, two ladders.)

## 2. Standing instruments (what to read, never what to quote from memory)

| instrument | answers | trap |
|---|---|---|
| `v_field_provenance_unranked` | writers with no rung, **30-day rolling window** — should be 0 | it MOVES (35 → 22 → 30 → 29 on different days); re-measure, never quote |
| `v_field_provenance_effective_source` | the writer's real name behind a `domain_trigger` relabel | requires the full `^.+:evt[0-9]+$` shape — bare `split_part` invents 9,950 names |
| `v_field_source_priority_triage` | every rung's `pr5_verdict` / `pr5c_verdict` / **`pr5d_verdict`** / `is_orphan_column` / `is_retired` | verify on this, never on the never-written COUNT (it only moves when a producer runs) |
| `v_never_first_class` | sources refused as effective source by decision (`county_records`) | — |
| `scripts/check-field-source-priority-columns.mjs` | rungs on nonexistent columns (PR7) | **operator-run**, not a merge gate — no DB can see both rungs and both schemas |
| `provenance_failed` counter + `lcc_health_alerts(alert_kind='provenance_write_failed')` | JS-side RPC failures, with SQLSTATE | blind to callers that hit the RPC directly (PR5c-signal) |
| `v_field_provenance_actionable` / `_current` / `_conflicts` | the Decision Center provenance lanes | — |
| Guards: `test/provenance-relabel-registration.test.mjs`, `pr5-ladder-source-triage`, `pr12-provenance-hash-and-failure-signal`, `pr5c-provenance-target-database`, `provenance-conflict-ladder-wiring`, `provenance-lane-interleave` | | regression detectors that CI now runs (`npm test` required since 2026-08-27) |

## 3. Live state — dated, re-measure before quoting

**2026-09-02 (post-#2060):** 2,141 rungs / 68 sources · 426 rungs PR5-verdicted · 49 `PR7:orphan_column`
(19 pairs, ONE live: `gov.properties.recorded_owner_name`) · 33 LCC-internal rungs PR5c-verdicted
(`no_merge_path_caller` 13 · `reached_and_broken` 10 · `ledger_is_elsewhere` 6 · `producer_never_wired` 2 ·
`unreached_and_broken` 2) · never-written sources **39 by design** · write-but-unregistered 21 (benign
`cleanup_run_*`) · unranked **29** · `value_text_hash` plain + trigger, 0 null hashes, 8 break-class rows
hashing correctly since PR12 · `field_provenance` on LCC-internal tables **0** — a
**no-population zero**, measured 20:59 UTC 2026-09-02, 21 min after the deploy, with **0 CRE
registrations in the window**. The CRE folder feed is **human-driven and bursty: 7 active days in
30, last 2026-08-27**, so week-long gaps are normal, the detector cannot fail yet, and polling it is
waste. **State the elapsed window AND the population that passed through it** — "no registration
yet" and "the fix did not work" are the same 0 and opposite facts. `entity_relationships` stays 0
regardless (`unreached_and_broken`) · `agency_classifier` own-name rows **0** (no-population zero — no gov
write has fired since PR8).

**⚠️ `field_provenance` on `entities` is STILL 0 on a fully-deployed build, and that is not a deploy
signal (PR5c-entities-b, 2026-09-02).** Both PR5c-entities writers are wired and live, and neither
has written: `lcc_owner_contact_propagate_log`'s newest row is **2026-08-15**, 18 days back. The
table itself is busy — **8,775 `field_provenance` rows in the last 24 h, newest 21:30 UTC** — so the
zero is scoped to `entities` and means *those two workers have not run*, not *the wiring is absent*.
**Assert on the population that passed through the window, never on the count alone.** The lane that
~~does run daily is the Salesforce bridge, wired by PR5c-entities-b.~~ 🚨 **FALSE — corrected
2026-09-03 (CONTACT1). The Salesforce bridge does NOT run at all:** `insertEntity` is reached only
from `handleSalesforceContactUpsert` and `enrichment_jobs` holds **0** rows of type
`salesforce.contact.upsert`, ever. The daily traffic is `salesforce-sync.js::writeEntitySalesforceLink`
(195/30d, cron 165) and `sf-list-import.js` → `ensureEntityLink` (142/14d) — **neither calls either
ladder** (→ CONTACT1a). ⚠️ **`provenance_write_failed = 0` was recorded here as reassurance and is
the tell: a path that never runs cannot fail.** Prove execution from a RUN LEDGER before
instrumenting a writer, and trace real traffic by a per-writer stamp
(`external_identities.metadata->>'synced_via'`), never by the file that looks like the writer. **Measured 22:08 UTC, minutes after its deploy:** `source='salesforce'` on `entities` = 0 with 3 SF
contacts minted in the prior 24 h — read it again tomorrow (~12 rows/day predicted), never today.

**Deploy state:** migrations for PR8/PR5/PR12/PR5c all applied live. ✅ **Railway CONFIRMED
2026-09-02 22:08 UTC — live `/version` = `886cdf8622f4`** (= `main` HEAD incl. #2072), so every JS
half of this arc — PR2, PR12's failure signal, PR5c's five callers, PR5c-entities, PR5c-entities-b —
**is running**. (Earlier read 21:41 UTC: `f5bc8cc0f868`.) The host is
`https://tranquil-delight-production-633f.up.railway.app` — the `-633f` suffix matters; the bare
`tranquil-delight-production` host answers 404 `Application not found`, which reads like a dead deploy.
⚠️ The sandbox has no Railway egress (proxy 403, `connect_rejected`); `/version` was read with
`net.http_get` **from the DB**, which does — cheaper than any handler behavioural probe and immune
to the auth-401 misread that made an empty grep look like a stale deploy (B5). ⚠️ An unanswered
probe is not a negative result: pg_net may take minutes to persist the row, so re-read
`net._http_response` rather than concluding "not deployed". `availability-checker` edge function
**fixed in source, undeployed** (PR5c-deploy). → `docs/os/OPERATOR-ACTIONS.md`.

## 4. The arc — one line each, audit for the rest

| id | date | what it settled | audit |
|---|---|---|---|
| PR1 | 09-01 | `county_records`@5 has never written; its producer is gpt-4o recall — **refused**, not wired | `public-records-source-lane.md` §2a |
| PR1a | 09-02 | 8,700 `$0` assessed values are sentinels written as facts | lane page §2 |
| PR2 | 09-02 | the sidebar writer dropped the stats it was handed; the lot parser read acres as sq ft (43,560×) | lane page §2 |
| PR8 | 09-02 | the flush relabelled every unblessed source `domain_trigger`; registry is the allowlist now | lane page §2a; `20261007120000` |
| PR5 / PR7 | 09-02 | 39 never-written sources triaged (25 not defects; 7 live elsewhere); 19 orphan-column pairs | `PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md` |
| PR12 | 09-02 | `::bytea` hash aborted `lcc_merge_field` on quotes/newlines; JS failed open; fixed in place | `PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md` |
| PR5c | 09-02 | 33 zero-row internal rungs = five callers sending an invalid `target_database` (23514, 100%) | `PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md` |
| PR5c-entities | 09-02 | the 13 `entities` rungs had no caller; the two contact writers now consult the ladder — **recording only, because every rung is `record_only`** | `PR5c_entities_LADDER_WIRED_2026-09-02.md` |
| PR5d | 09-03 | `costar_cmbs_loan`'s 121 rungs: the scanner, the writer and the host match all exist — **the CoStar loan sub-page has never been captured**, and 27 dia rungs are additionally behind an opt-in flag that is false on 11,803 of 11,803 | `PR5d_COSTAR_CMBS_LOAN_ARM_2026-09-03.md` |
| PR5c-entities-b | 09-02 | the Salesforce bridge CREATE path — instrumented, but wired onto a `job_type` (`salesforce.contact.upsert`/`salesforce.account.upsert`) that has **zero producers anywhere in this repo** — ⚠️ **misattributed as "the lane that actually runs"; CONTACT1 (09-03) found it has run ZERO TIMES, ever.** Left in place as harmless dead code, superseded as the live writer by CONTACT1a below. | this page §3 + `PR5c_entities_LADDER_WIRED_2026-09-02.md` §5 |
| CONTACT1 | 09-03 | diagnosis: both `entities.email`/`phone` ladders (field_provenance AND `metadata.field_sources`) had governed almost nothing — `field_provenance` on `entities` held 4 rows total (`phone`/`domain_owner_contact`, one manual tick), `email` **zero, ever**. Root cause: PR5c-entities-b's writer (`bridge-handlers-salesforce.js::insertEntity`) is dead code (see the corrected PR5c-entities-b row) — the real writer had never been found. | `docs/claude-code/prompts/CONTACT1-both-entities-ladders-govern-nothing.md` |
| CONTACT1a | 09-04 | census of `ensureEntityLink()`'s 30+ live call sites found ONE choke point: the CREATE payload (`ensureEntityLink` never PATCHes `email`/`phone` onto an EXISTING entity — a "fill" only ever happens at mint time). Wired `recordFieldWrites` there, audit-only (no `shouldWriteField` gate — a create has no prior value to protect, same reasoning as the dead PR5c-entities-b block). Covers every current and future caller — CoStar sidebar contact/owner mints, `sf-list-import.js`, and the ~8 other callers that ever pass email/phone — with no per-caller change. | this page §3 + the CONTACT1a section below |

**Open (backlog ids):** PR1d (`REGRID_API_KEY`, Scott) · PR5a (29 field-grain gaps — should a ladder
govern bookkeeping columns at all?) · PR5b (`om_extraction` unregistered where it competes) ·
~~PR5c-entities~~ ✅ (wired 09-02) · PR5c-enforce (all 10 `entities` contact rungs are
`record_only`, so nothing is protected yet — **still blocked**: CONTACT1a gives the ledger its
first real, ongoing feed, but it needs to run and accrue history before there is anything to grade)
· ~~PR5c-entities-b~~ ⚠️ corrected 09-03 — wired to a dead job_type, never ran; superseded as the
live writer by CONTACT1a · ~~PR5c-entities-b-dupes~~ ✅ (09-02, `d5b0ac8` — `entities.domain` was
scoping the identity key; see `entity-identity-and-dedup.md`, which owns duplicate-mint from here) ·
PR5c-signal · PR5c-avail-field ·
PR5c-deploy (Scott) · ~~PR5d~~ ✅ (09-03, verdicted `page_never_captured` 94 / `page_never_captured_flag_off` 27; follow-ups **PR5d-a** gov capture, **PR5d-b** the dia `track_cmbs_snapshots` opt-in) · PR5e (`gov_ownership_chain`
dead constant) · PR7a (the live orphan column) · PR7b (prune 15 inert rungs — NOT neutral) · PR9
(`manual_verify`@20 — Scott) · ~~PR10~~ answered by CONTACT1/CONTACT1a: `field_provenance` is the
fleet-wide ledger and is now the one that actually gets written by the live writer; `metadata.field_sources`
remains `planContactFieldPromotion`'s private read-back cache and is untouched by this change · PR11
(model-leg quarantine) · PR12a (the 67 residual) · PR12b (flush watermark skips an errored event).

### CONTACT1a — the writer census, in full (2026-09-04)

An AST walk (acorn, not grep — the PR5c-entities lesson: grep found 24 of 41 `entities` writer
sites, an AST walk found 41) of every `ensureEntityLink(...)` call site in `api/` found **48 call
sites across 34 files**. Of those, **9 ever pass a non-null `email`/`phone`** (checked per-site,
including resolving `seedFields` passed as a bare identifier back to its assignment — a purely
static "does the object literal have the key" check would have missed all of them):

| file : line | how email/phone reaches the call |
|---|---|
| `api/_handlers/sidebar-pipeline.js:2140` (`unpackContacts`) | `contactSeedFields()` — CoStar sidebar contact/owner capture, the largest live producer |
| `api/_shared/sf-list-import.js:298` | `seedFields.email`/`.phone` set from the campaign-member row |
| `api/_shared/institution-registry.js:86` | `row.contact_email`/`row.contact_phone` from `v_institution_contact_attachable` |
| `api/_handlers/contact-acquisition.js:322`, `:434` | `contact.Email` from a Salesforce Account's contact list |
| `api/sync.js:3151`, `:3181` | `match.gov.email`/`.phone`, `match.dia.email`/`.phone` — the cross-domain contact matcher |
| `api/intake.js:1637`, `:1706` | OM/lease-extraction party contacts |
| `api/operations.js:1133` (`bridgeUpdateEntity`) | caller-supplied `req.body.fields` — an open API surface, could carry either at runtime |
| `api/operations.js:544` → `api/_shared/research-loop.js:125` (`bridgeCompleteResearch`) | caller-supplied `req.body.entity_fields` — same shape |

The other 39 call sites never pass email/phone (buyer/seller/tenant/lender/guarantor/developer
mints, asset anchors, Salesforce Account links, naming-hygiene fills — all name-only or
address-only seeds). **All 48 now flow through the one wired choke point** — nothing needed
per-caller wiring. Guard: `test/contact1a-entity-link-provenance.test.mjs` (behavioural, invokes
`ensureEntityLink` with a stubbed `fetch`; mutation-verified RED when the `recordFieldWrites` call
is disabled).

**Not done here, deliberately:** no `enforce_mode` flip (PR5c-enforce stays blocked — CONTACT1a
gives the ladder its first real, ongoing feed but the history has to accrue before there's
anything to grade); `SF_CONTACT_WRITEBACK` untouched; `metadata.field_sources`/
`planContactFieldPromotion` untouched; no backfill of past writes.

## 5. Lessons carried verbatim from `CLAUDE.md` (moved 2026-09-02, unedited)

> These four blocks were the `CLAUDE.md` § "Field-level data provenance" sub-sections from PR8, PR5,
> PR12 and PR5c. They are preserved here word-for-word; `CLAUDE.md` now carries the ten-bullet
> distillation. Where a number below is dated, §3 above is the one to re-measure against.

### ⚠️ THE FLUSH USED TO RELABEL ANY UNBLESSED SOURCE, AND THE REGISTRY IS THE ALLOWLIST NOW (PR8, 2026-09-02)

`lcc_flush_provenance_events()` (the async `provenance_event_log` → `field_provenance` drain) carried a
**four-name literal** and merged every other event under the placeholder name `domain_trigger`. Live before the
fix: **17,371 rows wore that name and 17,371 of 17,371 carried a `:evt` run id** — *every one was a relabel;
nothing has ever actually been `domain_trigger`.* Decomposed: **`agency_classifier` 17,277** (gov
`government_type` on four tables, still writing) + **`qa22_davita_brand_canonicalize` 94**. Fixed by
`supabase/migrations/20261007120000_lcc_pr8_provenance_relabel_registration.sql` (applied live): **a
`field_source_priority` row for THIS (table, field, source) IS the allowlist**; anything unregistered still
merges as `domain_trigger`. Full writeup + measurements: `docs/architecture/public-records-source-lane.md` §2a.

- **⚠️ A RELABELLING DRAIN DEFEATS EVERY DETECTOR KEYED ON `source`, IN BOTH DIRECTIONS AT ONCE.**
  `agency_classifier` was a **live, unregistered** writer of 17,277 rows that the *write-but-unregistered* arm
  could not see (it wore `domain_trigger`'s name), while `qa22_…` — registered — sat in the *registered-but-
  never-written* arm with 94 rows on the ground. **One relabel, both arms wrong, no error anywhere.** Before
  trusting any producer census, ask whether the write path preserves the writer's name.
- **⚠️ REMOVING A RELABEL *ARMS* EVERY REGISTERED SOURCE — that is the consequence, not a side effect.**
  `county_records` holds 93 rungs at a best rung of **5**, above `salesforce`@20 and every sidebar, and PR1
  measured its producer to be gpt-4o recall. Under the relabel it merged as `domain_trigger`, which has no rung
  for those fields, so it could at most **fill a blank**; under "the registry is the allowlist" it would merge
  at @5 and **override real evidence**. The relabel was the only structural thing stopping it. The refusal is
  now explicit (`v_never_first_class`), positive-controlled live. **When you delete a suppression mechanism,
  enumerate what it was suppressing** — the four-item literal was doing a job nobody had written down.
- **⚠️ `split_part(source_run_id, ':evt', 1)` IS NOT A RECOVERY — IT IS A PLAUSIBLE NUMBER GENERATOR.**
  `split_part` returns the **whole string** when the delimiter is absent, and it is absent on **943,916 of the
  1,263,825 rows**. Unguarded it **invents 9,950 source names that do not exist** and answers the
  write-but-unregistered arm with **9,951 instead of 21**. Require the full shape
  `~ '^.+:evt[0-9]+$'` first. Same family as the P157 `reloptions` and P182 deparse traps.
- **⚠️ AND THE GUARD FOR IT CANNOT BE A FILE-WIDE PRESENCE CHECK.** The shape predicate legitimately appears
  **twice** in the view (`effective_source` and `was_relabelled`), so a grep — *and a ±300-char proximity
  window, which reads the neighbour's guard* — both stay green while one site loses its guard. Found by the
  mutation pass, not by reading it. The B6c-dup lesson, one layer in: **anchor per column and count the sites.**
- **`domain_trigger` is now a registered source that nothing has ever been** — it swaps INTO PR5's
  never-written set as `qa22_…` swaps out, which is why **"the 39 is 38" is wrong and it is still 39**.
  Post-registration, keyed on the effective source: **68 registered · 39 never written · 21 write-but-
  unregistered**. ⚠️ Keyed on the RAW `source` it reads **40** until the next flush writes an
  `agency_classifier` row under its own name — **that new row, not today's count, is what proves the producer
  is fixed** (Class 8).
### ⚠️ A RUNG WITH NO WRITES IS SEVEN DIFFERENT FACTS, AND "UNREGISTERED" IS NOT A LOW RUNG (PR5, 2026-09-02)

**39 of 68 registered ladder sources have never written a `field_provenance` row — and only 14 of
them are rungs nothing will ever exercise.** Verdict + evidence for all 39 are stamped into
`field_source_priority.notes` and surfaced on **`v_field_source_priority_triage`**
(`pr5_verdict`, `is_orphan_column`, `is_retired`). Writeup:
`docs/audits/PR5_LADDER_SOURCE_TRIAGE_2026-09-02.md`.

- 🚨 **SEVEN OF THE 39 ARE LIVE — ON A SECOND LADDER THAT DOES NOT WRITE `field_provenance`.**
  `manual`, `rel_purchase`, `rel_owns`, `sf_seller`, `domain_true_owner` and
  `gov_ownership_transition` are the property-owner authority ladder on `lcc.lcc_property_owner`
  and carry **15,052 rows in `lcc_property_owner_evidence`** — `domain_true_owner` wrote the day of
  the audit. They are scored by `lcc_reconcile_property_owner`, which emits no provenance. The
  seventh, `property_sale_events`, is B6c-dup's gov trigger writing gov's own
  `field_value_provenance`. **Before recording that a source has never written, enumerate the
  LEDGERS, not the rows** — this is PR10 ("one source, two ladders") at seven times the size and
  the same shape as P197.
- 🚨 **AND `field_provenance` HAS NEVER RUN ON ANY LCC-INTERNAL TABLE.** `entities` (13 rungs),
  `entity_relationships` (2), `lcc.lcc_property_owner` (6), `lcc.lcc_entity_portfolio_facts` (2),
  `public.lcc_cre_properties` (7), `public.lcc_cre_property_documents` (3) — **33 rungs, 0 rows**,
  with live `lcc_merge_field` call sites on four of the six (backlog **PR5c**).
- 🚨 **"UNREGISTERED" IS NOT A LOW RUNG — IT IS A DIFFERENT BRANCH OF `lcc_merge_field`**, so you
  cannot register OR de-register a source without changing behaviour. Unregistered: fills a blank
  (`unregistered_source_filling_blank`), can **never** override a value
  (`unregistered_source_with_existing_value`), and is itself overridable by anyone
  (`replacing_unregistered_source`). A 72-combination rolled-back replay measured **four** decision
  classes changing from ONE registration — including a real **loss** of blank-filling, because once
  both priorities are known the function never consults the null again. **So never "tidy up" the
  ladder by deleting a dead-looking rung; soft-retire it in `notes` instead.**
- **⚠️ A DETECTOR'S GRAIN DECIDES WHAT IT CAN SEE.** The write-but-unregistered arm keyed on SOURCE
  reads 21 (all benign `cleanup_run_*` tags) and **cannot see `costar_sidebar` →
  `gov.properties.government_type`**, because that source is registered on 73 other rungs. At
  (table, field, source) grain — what `v_field_provenance_unranked` keys on — that gap is 1 of
  **30**. Both numbers are correct and neither is the other.
- **⚠️ A LOGICAL PREFIX IS NOT A SCHEMA.** `to_regclass('lcc.lcc_property_owner')` is NULL because
  `lcc.` is a logical database prefix exactly like `dia.`/`gov.`. The `target_table` values with no
  physical table are `comp_provenance`, `comparable_sales`, `deal_provenance`, `listing_provenance`
  and bare `properties` — **526,192 provenance rows** between them, Salesforce-side logical
  namespaces. Reading the prefix as a schema flags six healthy tables and misses five real ones.
- **⚠️ A RUNG WITH NO PRODUCER IS NOT AUTOMATICALLY A DEFECT.** `gliner_extract`'s 9 rungs were kept
  ON PURPOSE after W5.1b measured that lane ~80% entity-wrong and demoted it to log-only — and the
  reason lived only in a code comment where no ladder audit would ever find it. **When a rung is
  deliberately unexercised, put the reason in `notes`.**
- **⚠️ PR7 IS 19 ORPHAN (table, column) PAIRS / 49 RUNGS, NOT 1 — AND SPLITTING BY *WHEN THE WRITES
  STOPPED* IS WHAT MAKES IT READABLE.** Only `gov.properties.recorded_owner_name` is LIVE (28 writes
  in 30 days). `gov.sales_transactions.buyer_name` (7,916 rows) and `.seller_name` (6,039) look like
  catastrophic live drift and stop dead at **2026-07-29**, because the gov branch of the sidebar was
  corrected to write `buyer`/`seller` — which run to 2026-09-02. **13,955 rows of apparent drift are
  historical residue and only the dates say so.** Standing check:
  `scripts/check-field-source-priority-columns.mjs` — ⚠️ an **operator-run** script, NOT a merge
  gate (neither domain schema is derivable from this repo, and no database can see both the rungs
  and the columns); it probes via PostgREST 42703 and **aborts rather than reporting a table clean**
  on any other error.
- **⚠️ ANCHOR A PARSE ON A TOKEN, NEVER AN OFFSET.** The triage view's first cut read
  `split_part(notes,'PR5:',2)` and silently returned NULL for the 26 rungs the PR7 marker stamps in
  front — **400 rungs verdicted before the regex, 426 after**, with `county_records` reading 92 of
  its own 93.
- **Verify on `v_field_source_priority_triage`, never on the never-written count** — that count only
  moves when a producer runs, so it correctly stays 39 after a triage that deleted nothing.

### ⚠️ A DERIVED COLUMN CAN REFUSE A VALUE THE TABLE IS SUPPOSED TO HOLD — AND THE WRITER FAILS OPEN (PR12, 2026-09-02)

`field_provenance.value_text_hash` was `GENERATED ALWAYS AS
encode(sha224(coalesce(value::text,'')::bytea),'hex')`. `value` is **jsonb**, jsonb renders
**backslash** escapes (`\"` `\n` `\t` `\r` `\b` `\f` `\uXXXX`), and bytea's **escape** input
format accepts only `\\` and `\ooo` — so the cast raised **22P02 and aborted the entire
`lcc_merge_field()` call**. The curated write still landed, because `shouldWriteField` catches a
non-ok RPC and fails open. **A hash nobody reads was deciding which provenance rows exist.**
Full measurement: `docs/audits/PR12_PROVENANCE_QUOTE_LOSS_2026-09-02.md`.

- **⚠️ NEVER CAST TEXT TO `bytea` TO FEED A DIGEST — USE `convert_to(t,'UTF8')`.** `t::bytea`
  *parses* backslash escapes; `convert_to` takes the bytes. Two consequences, and the second is
  quieter: an invalid escape **errors**, and a valid one (`\\`) silently **collapses**, so the hash
  no longer describes the text. Swept across all three projects over generated columns, defaults,
  function bodies, CHECK constraints, expression indexes and views: **this was the only first-party
  instance** (the rest is Supabase `vault`/`pgsodium`, which already do it correctly). Guarded
  class-wide by `test/pr12-provenance-hash-and-failure-signal.test.mjs`.
- **⚠️ THE BREAK SET IS NOT "QUOTES" — and the members nobody expects are the ones that bite.**
  `"`, newline, tab, CR, backspace, formfeed and any control char, **including inside a jsonb object's
  or array's string members**. It does NOT break on a jsonb object's own delimiter quotes
  (`{"a": "b"}` carries no backslash) or on non-ASCII. Rule, validated 14/14 against the live cast:
  **after collapsing `\\` pairs, any remaining backslash errors.** A backlog row that names one
  character is describing a symptom, not the population — derive the population from the mechanism.
- **⚠️ `LIKE '%\%'` DOES NOT MEAN "CONTAINS A BACKSLASH" — backslash is LIKE's own escape
  character**, so that pattern means *"ends with a literal `%`"*. It returned a clean, confirming
  **0** on the first census arm. Use `strpos()`, which has no escape semantics, and **positive-control
  the query shape** — the control fired on all 1,270,785 rows while the real arms read 0. Same family
  as the P157 `reloptions` and P182 deparse traps, committed while auditing for exactly that class.
- **⚠️ `ALTER COLUMN ... DROP EXPRESSION` IS METADATA-ONLY — the rewrite was avoidable.**
  `DROP COLUMN` + `ADD COLUMN ... GENERATED ... STORED`, and PG17's `SET EXPRESSION`, both rewrite the
  whole table (here 1,270,785 rows / 1,025 MB on a 5,804 MB database whose worst failure is disk-full
  → sign-in lockout, with **free disk not measurable from SQL or the MCP surface**). `DROP EXPRESSION`
  converts the generated column to a plain column **in place and retains the data** — probed live:
  `pg_relation_filenode` unchanged, values byte-identical. Pair it with a BEFORE trigger. ⚠️ The
  trigger must assign **unconditionally**: that is the one guarantee `GENERATED ALWAYS` gave for free
  (a caller cannot supply the column) and the one a trigger has to earn.
- **⚠️ PROVE THE BACKFILL IS A NO-OP RATHER THAN RUNNING ONE.** 0 of 1,270,785 stored values contain
  a backslash, so the new expression reproduces every hash byte-for-byte — the **whole population**,
  not a 10k sample — verified after apply at 0 mismatches with the mutated-expression control at
  1,270,785. A backfill of 1.27M rows would have cost ~500 MB of bloat to change nothing.
- **✅ VERIFY ON THE PRODUCER, NOT THE BACKFILL (Class 8) — and here it was available immediately.**
  Within two hours of the migration live producers wrote **1,254 provenance rows, 8 of them
  break-class, all hashing correctly**. That is what says the *writer* is fixed rather than the table
  being momentarily tidy — and it is a stronger check than the wall clock, because the break-class
  rows are the ones that could not have existed the day before.
- **⚠️ AND DO NOT BACKFILL THE LOST PROVENANCE.** The source, confidence and run id of a historical
  write cannot be reconstructed; a fabricated provenance row is worse than a missing one. Record the
  loss as a number and a date.
- **🚨 A CENSUS SCOPED TO "LADDER-GOVERNED COLUMNS" MISSES MOST OF IT — `lcc_merge_field` IS CALLED
  FOR UNREGISTERED (table, field) PAIRS TOO.** The registered-rung census said 67; the *post-fix*
  check found **8 break-class rows written within two hours of the migration**, live `costar_sidebar`
  writes of `dia.sales_transactions.notes` / `sale_notes_raw` — multi-line OM narrative, on columns
  that are **not rungs**, so the census structurally could not see them. Re-measured: dia `notes`
  **927 of 2,969 (31%)**, dia `sale_notes_raw` 60/447, gov `sale_notes_raw` 47/269 ⇒ **~1,101
  exposed, a 16× correction to my own headline.** **The dominant population is the NEWLINE in
  ordinary narrative text, not the quoted owner name the defect was filed under.** When a detector's
  scope comes from a registry, ask what the code path does for things the registry does not list.
- **⚠️ CHECK A COLUMN'S TYPE BEFORE BELIEVING A BREAK-RATE — the same over-count bit three times.**
  `to_jsonb(col::text)` is faithful for a **text** column and wrong for one the caller passes as
  jsonb: `sale_notes_extracted` first read **250/250 and 184/184 — 100%**, the implausibly-clean
  number that should stop you (Class 11), and its real count is **0/0** because it is jsonb. The same
  error made 12 of the 79 registered "losses" into proven non-losses (their writer passes a jsonb
  ARRAY, which renders with no backslash). **The predicate has to match what the caller actually
  hands the function, not what the column happens to hold.**
- **⚠️ THE HISTORICAL LOSS IS STRUCTURALLY UNMEASURABLE, AND THE THREE NUMBERS MEAN DIFFERENT
  THINGS.** Exposure **79** ladder-governed values · **12 proven SAFE** (their writer passes a jsonb
  **ARRAY**, which renders with no backslash — the census assumed `to_jsonb(col::text)` and therefore
  over-counts wherever a caller passes structured jsonb) · **67 residual** · **1 demonstrated loss**
  (a writer is known to have tried). A break-class value later overwritten with a clean one **leaves
  nothing behind**, so 67 is a snapshot of current exposure, never a running total. **Say which of
  the three a number is.**
- **A GATE THAT FAILS OPEN MUST STILL LEAVE A TRACE.** `shouldWriteField` keeps failing open — losing
  a curated value is worse than losing its provenance — but now records the **DB's own SQLSTATE and
  message** (never `http_<status>`; a status code cannot name a cause — the "a 409 is not necessarily
  a conflict" rule), counts it, and opens a deduped
  `lcc_health_alerts(alert_kind='provenance_write_failed')`. **Read `provenance_failed`, never
  `recorded`.**
- **⚠️ A SOURCE DETECTOR MUST BLANK STRING LITERALS AS WELL AS COMMENTS, AND COMMENTS COME FIRST.**
  The fix's own `COMMENT ON COLUMN … IS '…value::text::bytea…'` names the banned shape inside a
  **quoted string**, so a comments-only stripper reported the defect it had just removed. Blanking
  literals first is worse than not blanking — a bare apostrophe in prose opens a string that swallows
  the code behind it. And the historical migration that legitimately still states the old expression
  is exempted **by path**, with a companion test asserting the exemption still matches something so
  the allowlist cannot rot into a lie.

### ⚠️ `target_database` IS A CLOSED VOCABULARY, AND FIVE CALLERS DID NOT KNOW (PR5c, 2026-09-02)

```
field_provenance_target_database_check
  CHECK (target_database = ANY (ARRAY['lcc_opps','dia_db','gov_db']))
```

**`lcc_merge_field()` ALWAYS inserts a `field_provenance` row — `write`, `skip` AND `conflict` all
land, there is no early return. So a (table, field, source) at zero rows means the RPC never
COMPLETED, never that it decided against writing.** That one observation turns "did the lane run?"
into "does the call succeed at all?", and it is answerable in one rolled-back transaction. Five call
sites passed a value outside the vocabulary — `'lcc'` (`api/admin.js` w8_u3), `'lcc_db'`
(`cre-registry.js`), `'dia'`/`'gov'` (`admin.js` reachability harvest ×2, and the
`availability-checker` edge function) — and therefore raised **23514 on 100% of calls** into a bare
`catch (_e) { /* best-effort */ }`. Replayed live: **6 of 6 PR5 §2 `writer_live_zero_rows` sources
fail, 5 with 23514**; the sixth (`lcc_generated`) succeeds and its lane has simply not run.
Single owner now: **`provenanceTargetDatabase()`** in `api/_shared/field-priority-guard.js`. Guard
`test/pr5c-provenance-target-database.test.mjs` (12/12 mutations RED). Writeup:
`docs/audits/PR5c_INTERNAL_RUNG_VERDICTS_2026-09-02.md`.

- **⚠️ THE RUNG LOOKUP KEYS ON `(target_table, field_name, source)` ONLY — `target_database` is not
  part of it.** So a wrong value here is structurally invisible to every detector that reasons about
  ladders (PR5's triage, `v_field_provenance_unranked`, the effective-source census). It fails at
  the INSERT, *after* every ladder question has been answered correctly. **Before concluding that a
  registered source has no producer, check whether its producer's call can physically land a row.**
- **⚠️ THE FIX WAS ALREADY WRITTEN DOWN — BESIDE ONE CALL SITE — AND THE CLASS WAS NEVER SWEPT.**
  `api/admin.js`'s `comms_owner_bridge` stamp carries a comment stating BOTH halves correctly
  (*"do NOT JSON.stringify it, which would double-encode"* and *"`p_target_database='lcc_opps'`
  matches the ops-local convention"*), and that lane is **the only LCC-internal lane that has ever
  written provenance** (22 rows). It even cites `availability-checker` as a precedent — and
  `availability-checker` sends the bare `"dia"`. **A comment naming a sibling as correct is not
  evidence that it is.** Same shape as the FRED `| tee` lesson: grep for the SHAPE over the whole
  population, never one spelling, and put the rule in a function rather than a comment.
- **🚨 PR12 §4 MEASURED THE RIGHT THING ABOUT THE WRONG POPULATION, AND SAID SO ITSELF ONE SECTION
  LATER.** It sized the quote-loss mechanism over the **stored curated column values**
  (`entities.name` 23 of 69,462 = 0.03%, zero elsewhere) and concluded a dropped stamp could not be
  the cause because the rate would need to be ~100%. **It is ~100%**: `p_value` is a **jsonb
  parameter** — PostgREST hands it the parsed JSON value — so the three sites that wrapped it in
  `JSON.stringify()` sent jsonb `"\"x\""`, whose `::text` carries a backslash at position 2 and
  22P02'd the pre-fix hash on **every string**. PR12's own rule: *the predicate has to match what the
  caller actually hands the function, not what the column happens to hold.* **The verdict survived
  (23514 fires anyway) and the reasoning did not — which would have stopped the next reader one
  layer early.**
- **⚠️ A `status` COLUMN ON A TABLE SERVING TWO SUB-LANES IS NOT A READING OF EITHER.**
  `w8_u3_link_review` reads **26 `applied`** — and every one is `proposal_type='person_email_merge'`,
  a sub-lane that creates no edge (`applied_log_id` NULL on all 26; **zero** `entity_relationships`
  rows carry a `review_id`). Split by `proposal_type`, `prior_owner_link` — the arm that reaches the
  provenance stamp — has **2 rows ever, both terminal non-applies.** Same family as B6d-pri's
  *"split by `source` before quoting a failure count"*.
- **⚠️ `entity_relationships.developed`/`.owns` ARE NOT PR7 ORPHAN COLUMNS** — they are relationship
  **TYPES**, and the caller passes `relType` as `p_field_name` deliberately; the rungs were
  registered to that convention. Retiring them would have been wrong. **Read the caller before
  reading a rung as an orphan.**
- **⚠️ PR12's FAILURE SIGNAL CANNOT SEE ANY OF THESE FIVE.** `provenance_failed` and the
  `provenance_write_failed` alert live in `shouldWriteField`/`recordFieldWrites`; all five broken
  sites call the RPC directly. Measured: **0 open alerts over a population failing 100% of the
  time.** *An instrument's population is part of the instrument* (B6a). Backlog **PR5c-signal**.
- **The 33 rungs are verdicted on `v_field_source_priority_triage.pr5c_verdict`, none deleted**:
  `reached_and_broken` 10 (folder-feed CRE — the lane IS live, 13 docs in 30 days, a real
  recoverable loss) · `unreached_and_broken` 2 · `no_merge_path_caller` **13** (`entities`: no
  `lcc_merge_field` site anywhere passes that table, while a dozen paths PATCH it) ·
  `ledger_is_elsewhere` 6 · `producer_never_wired` 2. **Nothing is retired** — PR5 measured that
  "unregistered" is a different BRANCH of `lcc_merge_field`, so a registry edit moves outcomes both
  ways. Zero-delta proven structurally *and* by an unchanged rung fingerprint.
- **⚠️ Verify on the PRODUCER (Class 8), and mind the THIRD deploy surface.** The live count stays 0
  until the Railway redeploy; the edge function ships with neither the migration nor Railway
  (DOC18) and is **fixed in source but NOT deployed**.

