# CONTACT1b-manual-source — the human verdict is writing to a rung that does not exist

> **Three sites CONTACT1b instrumented pass `source: 'manual'`. That rung is not registered for
> `entities.email`/`phone`.** The registered rung-1 names are **`manual_edit`** and
> **`manual_resolution`**. Because *the registry is the allowlist* (PR8), an unregistered source is
> relabelled `domain_trigger` and takes `lcc_merge_field`'s unregistered branch — **so the
> highest-authority write on the ladder lands at the weakest tier, silently.**

**Repo:** `life-command-center` · **Project:** LCC Opps (`xengecqvemvfknjvbvrq`)
**Canonical page:** `docs/architecture/field-provenance-ladder.md` (CONTACT1b section — correct it
in place). **Small unit. Do not expand it.**

---

## 1. The three sites

| file:line | function | currently passes |
|---|---|---|
| `api/admin.js:9440` | `handleJunkBucket` (verdict `parse_contact`) | `source: 'manual'` |
| `api/admin.js:10313` | `handleDecisionVerdict` — owner org branch | `source: 'manual'` |
| `api/admin.js:10356` | `handleDecisionVerdict` — person branch | `source: 'manual'` |

## 2. Why `manual` is the wrong string, measured

`field_source_priority`, fleet-wide, 2026-09-06:

| source | rungs | tables | priority |
|---|---:|---:|---:|
| `manual_edit` | **207** | 28 | 1 |
| `manual_resolution` | **203** | 28 | 1 |
| `manual_verify` | 2 | 2 | 20 |
| **`manual`** | **1** | **1** | 1 |

For `entities.email` and `entities.phone` specifically the registered rungs are exactly:
`manual_edit`@1, `manual_resolution`@1, `salesforce`@20, `domain_owner_contact`@55,
`costar_sidebar`@60 — **all `record_only`**.

**So the fix is to change the three call sites, NOT to register `manual`.** Registering it would add
a 209th spelling of a concept that already has two, and PR5's rule stands: *never delete a rung, and
do not mint a near-duplicate one either.*

## 3. Which of the two, and say why

`manual_edit` and `manual_resolution` are both rung 1, so the ladder outcome is identical — but the
ledger is read by humans and the names mean different things. **Pick per site and justify it in one
line:**

- `handleJunkBucket` parses a contact **out of a junk entity name** on a human verdict — closer to a
  *resolution* of a bad row than a hand-typed edit.
- `owner_contact_attach_review` is a human **confirming an attachment** — also a resolution.

⚠️ **Whichever you choose, use ONE of them consistently across the three, or state why they differ.**
Two spellings for one act is how this defect started.

## 4. ⚠️ The guard pins the wrong literal — fix both in the same change

`test/contact1b-write-site-coverage.test.mjs` (11/11 pass) asserts the literal **`'manual'` twice**,
so **correcting the code turns the guard red.** That is the defect defending itself.

**Re-anchor the assertion on the PROPERTY, not the value:** the source passed by these sites must be
a **registered rung-1 source for `entities.email`/`phone`** — assert membership in a small named set
(`manual_edit`, `manual_resolution`), not equality with one string. *A guard that pins a value rather
than a property defends a defect as readily as a fix* — this repo has now met that shape in
UX-T0 (×2), C13c, OCR2 (×2), B6c-dup and here.

**Report the mutation pass as N/N with survivors named.** ⚠️ CONTACT1b reported "mutation-verified
(demonstrated red on a real removal)" — **that is one mutation**, and it is the fourth time this arc
a guard's strength has been reported above what was run. GOVDUP1-a's 12/12 with 0 survivors is the
bar.

## 5. Verify on

- **`field_provenance` rows for `entities.email`/`phone` with `source IN ('manual_edit',
  'manual_resolution')` appearing after the next human verdict** — and **0 rows with `source =
  'manual'` or `'domain_trigger'`** from these paths.
- ✅ **Baseline: there are currently ZERO `manual` rows** — these are human-triggered paths and none
  has run since the deploy, so **nothing needs backfilling and nothing has been mislabelled yet.**
  Confirm that is still true before shipping; if rows have appeared, they need relabelling and that
  changes the unit.
- ⚠️ **Do not assert on "the guard is green"** — it is green today over the wrong literal.

## 6. Out of scope

- **No `enforce_mode` changes** — that is `PR5c-enforce`.
- **No new rung** in `field_source_priority`.
- **No re-litigating CONTACT1b's leave-alone decisions** (`PATCH /api/entities`,
  `tm_misparse_unstamp`, `lease-extractor.js`) — each carries a stated reason and they stand.
