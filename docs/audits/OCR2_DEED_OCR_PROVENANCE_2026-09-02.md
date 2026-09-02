# OCR2 — the deed lane's OCR provenance: persist what the handler already computes

**2026-09-02 · shipped.** Additive on both domain DBs, one shared JS module, two call sites
repointed, one cost-control opt-out closed. **No re-OCR, no backfill, no new cron, no new vendor.**

---

## 0. The defect, and the claim it retires

`api/_handlers/document-text.js` builds `{ method, ocr_tier, ocr_engine, ocr_pages,
ocr_confidence }` for every document it extracts and returns them on the tick response — then the
PATCH persisted only `{ raw_text, ingestion_status }`. Measured 2026-09-02, before this change:

| domain | deeds with text | with OCR provenance |
|---|---:|---:|
| gov (`scknotsqkcheojiaewwh`) | 325 | **0** |
| dia (`zqzrriwuavgrquhisnoa`) | 182 | **0** |

The CRE lane's sidecar (`lcc_cre_property_document_text`) records all four — live it reads
`cloud_cheap/google_docai` 95, `cloud/gpt-4o-2024-08-06` 19, `cloud_cheap_window/google_docai` 5,
digital 272. **That asymmetry is the whole finding:** every number on the CRE side is auditable and
every number on the deed side has been a guess, which is exactly how an unverifiable claim reached
three documents.

⚠️ **RETIRED — do not restate it.** *"The deed lane never tiers; all 325 deeds went to gpt-4o"* is
wrong on both halves, and the correction was already recorded in
`docs/architecture/ai-and-ocr-cost-strategy.md` §0 before this build. Re-verified here:

- `document-text.js:217` passes `ocrTiered: deps.ocrTiered !== false` — tiered by default — and a
  repo-wide caller census finds **no production caller passing `false`**.
- The "325" was a **date artifact**. gov deed extractions by `extracted_data->>'extracted_at'`:
  **154 ran 2026-06-27 → 07-25**, before DocAI went live **2026-08-12**, when gpt-4o was the only
  OCR that existed; **31** ran on/after and went through the tiered chain; **140 of 325 carry no
  date at all.**

---

## 1. ⚠️ The hazard the prompt did not anticipate: `extracted_data` had TWO writers, and one REPLACED it

`deed-parser.js` wrote `extracted_data: { deed_extraction, extracted_at }` — a **wholesale replace**,
not a merge. So:

- provenance written **before** the deed parse is destroyed by it, on every deed; and
- a later **re-parse** (`processOneReparse`, which runs over stored `raw_text`) destroys provenance
  written on an earlier tick.

**This is measured, not read off the code.** On gov, all 185 rows carrying `extracted_data` carry
**exactly two keys** — `deed_extraction` and `extracted_at` — and nothing else. On dia, **10 rows
carry a third key** (`r59_backfilled_at`), written by the one call site that already merged. *A
sibling key CAN survive; on the parser's path it did not.*

The prompt anticipated my write clobbering the parser's. It did not anticipate the parser clobbering
mine — and shipping provenance without this fix would have been a feature that silently no-ops.

**Fix: one merge owner.** `<dom>_merge_document_extracted_data(document_id, patch, ingestion_status,
fill_blanks)` is the single sanctioned way to write that column, and **both** JS call sites go
through it. A third writer added later inherits the guarantee for free.

- **It must be an RPC**, not application logic: PostgREST cannot merge jsonb in a PATCH, and a
  read-then-write from the handler would RACE the deed parser inside the same tick. The RPC takes
  `FOR UPDATE` on the row.
- **Per-KEY fill-blanks**, not whole-object: a patch carrying one new key and one existing key must
  write the new one.
- The parser passes `fillBlanks: false` **deliberately** — a re-parse is *expected* to rewrite its
  own extraction; it simply may no longer take anyone else's keys with it.
- **Fallback preserved:** on any RPC failure the parser falls back to the legacy replace-PATCH. That
  is today's exact behaviour, so the worst case of a half-applied deploy is what already ships —
  never a lost deed extraction, which would strand the doc in the re-parse queue forever.

**Ordering is also fixed** (belt and braces): `processOneDoc` writes provenance **after** the deed
parse on both exits, so a provenance row can only ever describe a pass that completed.

---

## 2. ⚠️ `revoke ... from public` DID NOT remove the anon/authenticated grants — the complementary half of a documented trap

This repo documents one half: *`REVOKE ... FROM anon, authenticated` does not remove the default
PUBLIC grant on a new function* (B6d). **The mirror image bit this migration live**, and only
`has_function_privilege` caught it.

Supabase ships `ALTER DEFAULT PRIVILEGES` granting EXECUTE on new functions to `anon` and
`authenticated`, so at CREATE time those roles hold **explicit** grants. Measured immediately after
the first apply:

```
proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
has_function_privilege('anon', oid, 'EXECUTE') = TRUE
```

— i.e. the "fix" was a **no-op for the two roles that matter**, and the PUBLIC entry it did remove
was never the one carrying them here. Corrected to `revoke all ... from public, anon, authenticated`,
re-asserted: **anon false / authenticated false / service_role true** on both domains. The view is
revoked from both roles too.

**The durable rule is the one already in this repo, restated with its other half:** assert a
privilege with `has_function_privilege()` / `has_table_privilege()`, **never by reading the REVOKE
you just wrote** — in either direction.

---

## 3. ⚠️ No backfill, deliberately

507 deeds already carry text and **their tier is unknowable now** — 154 of gov's dated extractions
predate DocAI entirely, and 140 gov rows carry no date at all. Writing a tier onto those would be a
fabrication (unknown is not a value, P180). They stay `unrecorded` on the audit view, and
**`unrecorded` holding at its pre-change count IS the verification**: a number that FELL there would
mean somebody guessed.

---

## 4. ⚠️ The gpt-4o-direct route is closed, and the hazard was the DEFAULT

`extractDocumentText`'s signature read `ocrTiered = false`. Both production callers happened to pass
`true`, so nothing was reaching gpt-4o directly today — **the hazard was that a NEW caller inherits
the 6–14× tier by writing nothing at all.** Closed two ways:

- the default is now `true`; and
- the branch is **removed** — the tiered chain is the only PDF OCR route out of that function, and
  an explicit `ocrTiered:false` is **refused by name** (`ocr_tiering_cannot_be_disabled`) rather
  than quietly served the expensive engine. *A silent bypass of a cost control is indistinguishable
  from the control not existing.*

**Caller census for `ocrPdfToText(` after the change: exactly ONE call site**, inside
`ocrPdfToTextTiered` as tier 3, gated on `mode === 'gpt4o'` or `OCR_CLOUD_GPT4O_LASTRESORT` — the
legitimate last resort. Production is unaffected (both callers already passed `true`); two tests in
`test/document-text.test.mjs` that injected `ocrPdfToText` and relied on the old default now inject
`ocrPdfToTextTiered`. **Their assertions are unchanged** — they test that a scanned/thin-layer PDF
routes to OCR, not that it routes to gpt-4o specifically.

---

## 5. ⚠️ Two guards passed their own mutation, both by the same mechanism

The first cut asserted that the handler source **mentions** `writeTextProvenance` /
`provenance_written`, and that the parser source **mentions** `mergeExtractedData`. Both **survived**
the mutation that deleted the actual call, because the **import line still carried the identifier**.
Found by the mutation pass, not by reading the guards — the documented *"a guard that matches a shape
is defeated by a local variable"*, here defeated by an import.

Both were replaced with **behavioural** tests that invoke `processOneDoc` and `processDeedDocument`
with stubs. The ordering property is asserted directly (`['deed', 'provenance']`), and a dedicated
mutation that moves the provenance write **before** the deed parse goes RED.

`test/ocr2-deed-provenance.test.mjs` — **18 tests, 16/16 mutations RED.** Comments are stripped
before every source match (the fixes' own comments quote `ocrPdfToText`, `ocrTiered = false` and the
wholesale `extracted_data: {` at length); string literals are deliberately **not** blanked, because
every pattern is an identifier or property name and blanking risks the OCR1c apostrophe hazard.

---

## 6. What to read, and what NOT to read

**Read** `v_gov_deed_ocr_provenance` / `v_dia_deed_ocr_provenance`. One row per
`(provenance_state, method, ocr_tier, ocr_engine)` over the **whole** deed population, so recorded
and unrecorded are visible together and sum to the total — reporting only recorded rows would let a
lane that records nothing look empty rather than blind.

**Read `provenance_written` on the tick, never the `ocr_tier` / `ocr_engine` fields beside it** —
those say what the tick COMPUTED; `provenance_written` says what was PERSISTED. **That gap was the
entire defect.** `provenance_reason` names a failure; `rpc_non_ok:404` means the migration is not
applied on that domain, which is a **deploy** fact, not a data fact.

---

## 7. Verification

⚠️ **The two halves of this change have DIFFERENT verification clocks, and conflating them would
have overstated the wait.** An earlier draft of this section said simply "no tick can run until a new
deed arrives" — true of the provenance write, false of the merge fix.

- **Provenance rows: genuinely pending a new deed.** The EXTRACTION backlog is **0 on both domains**
  (`raw_text is null and storage_path is not null`), and `processOneReparse` deliberately writes no
  provenance (§8, OCR2a), so nothing can create a `document_text` row until a new deed is captured.
- **The merge fix runs on the NEXT tick, with no new deed.** The RE-PARSE queue holds **gov 166 +
  dia 119 = 285 rows**, and every one of them calls `processDeedDocument` → the merge RPC. Under the
  old code each of those was a wholesale replace. So the merge half is observable immediately after
  the Railway redeploy — read `v_gov_deed_ocr_provenance` for the provenance half and the key census
  for the merge half.
- ⚠️ **None of the 285 queued re-parse rows carries a sibling key today** (`r59_backfilled_at` on the
  dia re-parse slice: **0**), so the fix protects future keys rather than rescuing present ones —
  provenance will be the first sibling key it protects. **Say that rather than implying rows were
  saved.**

Until a new deed lands, every row is correctly `unrecorded`:

```sql
select provenance_state, method, ocr_tier, ocr_engine, docs, avg_ocr_pages
from v_gov_deed_ocr_provenance order by docs desc;   -- and v_dia_...
```

- gov **325 unrecorded**, dia **182 unrecorded** — must NOT fall (§3).
- Positive control, run live and rolled back on a real gov row (doc 12965) and a real dia row
  (doc 3964, the one carrying three keys): merge adds `document_text` with `deed_extraction`,
  `extracted_at` and `r59_backfilled_at` **all intact**; a second fill-blanks call **skips** the key
  rather than overwriting; `no_document_id` / `patch_not_object` / `document_not_found` each return
  a named reason. **0 residue.**

**Three deploy surfaces do not apply here** — this touches `api/` (Railway) and
`supabase/migrations/` (applied). It does **not** touch `supabase/functions/`, so there is no third
deploy. Additive schema before writer: the migrations are live; the JS ships on the next redeploy,
and until then the RPC is simply unreferenced.

---

## 8. Filed, not fixed

- **OCR2a** — `processOneReparse` and `processOnePropagateBackfill` do not write provenance.
  Deliberate: a re-parse over stored `raw_text` performs **no extraction**, so it has no tier to
  record, and stamping one would assert an OCR that did not happen on that pass.
- **OCR2b** — the `needs_ocr` exit (`document-text.js:226`) records no provenance either. A refusal
  carries a `reason` (`over_docai_page_cap`, `window_failed`, `thin_text_layer_no_ocr`) that the CRE
  sidecar persists and the deed lane still discards. Worth having; a different population from this
  build's (rows with no text at all), so it is named rather than bundled.
