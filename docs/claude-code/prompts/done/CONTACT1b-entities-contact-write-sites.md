# CONTACT1b — the entities contact ladder governs 1 of 14 write sites

> **CONTACT1a wired `ensureEntityLink`'s CREATE path and it works** — `field_provenance` now holds
> **5 `email` + 5 `phone` rows, source `costar_sidebar`, newest 2026-09-05**, where it held zero.
> **And 587 contact-bearing entities were touched in the last 30 days.** The ladder saw ~1.7% of them.

**Repo:** `life-command-center` · **Project:** LCC Opps (`xengecqvemvfknjvbvrq`)
**Canonical page:** `docs/architecture/field-provenance-ladder.md` — extend it; the mechanism is
stated there, do not restate it.

---

## 0. ⚠️ The filing premise for this prompt was WRONG — read this before anything

The handoff said CONTACT1b should *"measure whether `writeEntitySalesforceLink`'s ~195 links/30d are
creates or updates."* **`writeEntitySalesforceLink` does not touch `email` or `phone` at all.**
(`api/_shared/salesforce-sync.js:59-116` — it upserts `external_identities` and merges
`entities.metadata.salesforce`; no scalar column.) **The Salesforce link path is not the question.**
The question is the **fourteen sites that do write those columns**, ten of which are ungoverned.

*A named mechanism in a brief is a hypothesis; this one was refuted by reading the function.*

---

## 1. The census (2026-09-05, re-measure)

**14 sites write `entities.email` / `entities.phone`. 4 consult the ladder; 10 do not.**

| site | kind | ladder |
|---|---|---|
| `api/_shared/entity-link.js:1282` `ensureEntityLink` | CREATE | ✅ `recordFieldWrites` (CONTACT1a) |
| `api/_shared/bridge-handlers-salesforce.js:233` `insertEntity` | CREATE | ✅ — **but dead code** (CONTACT1: nothing enqueues those job types) |
| `api/_handlers/contact-writeback.js:500` | UPDATE | ✅ `filterByFieldPriority` |
| `api/_handlers/owner-contact-propagate.js:400` | UPDATE | ✅ `filterByFieldPriority` |
| **`api/_handlers/sidebar-pipeline.js:2278`** `unpackContacts` | **UPDATE** | ❌ |
| **`api/_handlers/entities-handler.js:2878`** `POST /api/entities` | **CREATE** | ❌ |
| **`api/_handlers/entities-handler.js:2927`** `PATCH /api/entities` | **UPDATE** | ❌ |
| `api/intake.js:1620` | UPDATE | ❌ |
| `api/operations.js:1164` `bridgeUpdateEntity` | UPDATE | ❌ |
| `api/operations.js:803` `bridgeSetContactEmail` | UPDATE | ❌ |
| `api/admin.js:10295` / `:10338` `handleDecisionVerdict` | UPDATE | ❌ |
| `api/admin.js:9434` `handleJunkBucket` | UPDATE | ❌ |
| `api/admin.js:2812` `unstampMisparseMember` | UPDATE (clears) | ❌ |
| `api/_handlers/lease-extractor.js:1417` | UPDATE | ❌ **by design** — its comment says `entities` is the BD graph, not a curated domain table |

**Churn, 30 days** (live entities carrying email or phone): **587 touched · 417 created · 170
updated-but-not-created.** So **~29% of the movement is UPDATES to pre-existing rows** — the case
where a prior value exists and the ladder's opinion actually matters.

🎯 **The sharpest asymmetry: the CoStar sidebar's CREATE is instrumented and its own UPDATE for the
very same contact is not.** `unpackContacts` mints through `ensureEntityLink` (recorded) and then,
on a *second* capture of an entity that already exists, fills `email`/`phone` at
`sidebar-pipeline.js:2278` with **no provenance row**. One producer, one contact, two paths, one
ledger entry. That is why the ladder shows `costar_sidebar` and almost nothing else.

---

## 2. ⚠️ The design question this unit must SETTLE, not assume

There are **two different ladder idioms already in the codebase** and they do different things:

| idiom | when | what it does |
|---|---|---|
| `recordFieldWrites` | **after** the write | records provenance. **Audit only — never blocks.** |
| `filterByFieldPriority` / `shouldWriteField` | **before** the write | consults the rung and can drop a field |

⚠️ **And under `record_only`, the gate does not gate.** PR5c-entities established that **all ten
`entities` email/phone rungs are `enforce_mode = 'record_only'`**, and `shouldWriteField` only blocks
on `strict` — so wiring `filterByFieldPriority` today buys **recording**, not protection. **Do not
describe it as turning on fill-blanks protection** (that exact mis-description is recorded in
`CLAUDE.md`'s PR5c-entities note). **Re-read the enforce modes live before predicting any behaviour
change.**

⚠️ **`lcc_merge_field` compares against `field_provenance`, NOT the live column** — so the first call
on a field returns `no_prior_provenance` ⇒ **write**, whatever the column already holds. **A ladder
cannot protect a curated value it has never seen.** With 11,594 emails and 9,833 phones already
stored and ~10 provenance rows, that is nearly the whole population. **Say what wiring the gate does
and does not buy, in numbers, before writing code.**

---

## 3. Units

### Unit 1 — close the sidebar asymmetry (highest value, one producer)

Instrument `sidebar-pipeline.js:2278` so the **second** capture of a contact records provenance like
the first. It is already fill-blanks (`if (contact.email && !link.entity.email)`), so behaviour need
not change — **the deliverable is that the ledger stops being half-blind to one producer.**

⚠️ **Use the SAME source string resolution as the CREATE path** (`contact1aProvenanceSource()`,
`entity-link.js:51-56`) — a second normalizer here is the drift this repo warns about a dozen times,
and it would split one producer across two source names in the ledger.

**Verify on:** `field_provenance` rows for `entities.email`/`phone` with source `costar_sidebar`
**rising above the CREATE-only baseline of 5+5**, and on the ratio of recorded writes to the
producer's own contact-touch count — not on the code shipping.

### Unit 2 — the generic endpoint, `POST`/`PATCH /api/entities`

`entities-handler.js:2878` (CREATE) and `:2927` (UPDATE) accept `email`/`phone` in `allowedFields`
and consult nothing. `entities-handler.js` **does not import `field-priority-guard.js` at all.**

⚠️ **Measure who actually calls the PATCH before instrumenting it.** The Explore pass found the
extension's update button sends only `PROPERTY_FIELDS`/`ASSESSOR_FIELDS`, **neither of which contains
email or phone** — so the endpoint *accepts* them and the known caller does not *send* them. **A path
that never carries the field is a different problem from one that carries it ungoverned**
(CONTACT1's lesson: *a path that never runs cannot fail*). Establish which this is from a run ledger
or live traffic, and if nothing sends contact fields, **say so and do not instrument it** — record
the finding instead.

### Unit 3 — decide the rest, do not sweep it

For each remaining ungoverned site, record a decision with a reason:

- `intake.js:1620`, `operations.js:1164`, `operations.js:803` — machine writers; likely instrument.
- `admin.js:10295/:10338/:9434/:2812` — **human-verdict paths.** A human confirming a contact is a
  higher-authority write than any automated source. **Decide whether provenance should record it as
  `manual`** (rung 1) rather than gate it, and say which.
- `lease-extractor.js:1417` — **leave alone**; its comment already states the reasoning. Confirm the
  reasoning still holds and cite it rather than re-deciding.

**A decision to leave a site ungoverned is a RESULT** — record the reason, the way SEC1-unit2 did
for `gov_check_queue_slas`.

---

## 4. Out of scope

- **No `enforce_mode` changes.** Moving a rung off `record_only` is `PR5c-enforce`, a separate
  decision with a separate blast radius. This unit makes the ledger complete enough for that
  decision to be made on evidence.
- **No backfill of provenance for the 11,594 existing emails** — we do not know where they came
  from, and inventing a source is worse than an honest gap (the PR12 rule).
- **No second source-name normalizer.** One owner: `contact1aProvenanceSource()`.
- **No new writer.** Instrument what exists.

## 5. Deliverables

1. Unit 1 shipped, with the ledger delta measured against the 5+5 baseline.
2. Unit 2's **measurement first** — who sends contact fields to `/api/entities`? — then instrument
   or record why not.
3. Unit 3's per-site decisions, each with a reason, including the leave-alones.
4. **A numeric statement of what this buys**: how many of the 587 monthly touches now record
   provenance, and — separately — how many would be *gated* if the rungs moved to `strict`. Those
   are different numbers and `PR5c-enforce` needs both.
5. Guard, **mutation-verified N/N with survivors named.** GOVDUP1-a set the bar at 12/12 RED.

## 6. Verify on

- **`field_provenance` rows for `entities.email`/`phone` over the next 7 days vs the 587-touch
  churn** — the coverage ratio, never the raw row count.
- **The CREATE/UPDATE split in the ledger** — if UPDATEs are still absent after Unit 1, the wiring
  did not take.
- ⚠️ **Prove the producer RAN** (GOVDUP1-a-confirm's lesson): a flat provenance count means nothing
  unless contact writes actually happened in the window. Quote the touch count beside it.
