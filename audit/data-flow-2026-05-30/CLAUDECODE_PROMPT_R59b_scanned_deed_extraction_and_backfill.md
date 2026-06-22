# Claude Code — R59b: clean scanned-deed party extraction + retroactive R59 propagation backfill

## Why (live R59 verification, 2026-06-22)
R59 is live and **correct**: a fresh deed drain (`document-text-tick`, 6 dia deeds OCR'd via
Document AI, 23 pages) ran Step 6 `propagateDeedToBd`, and its guards correctly rejected
garbage — **zero junk written** (no bad buyer/seller, `ownership_history` deed rows = 0). But
two things stop R59 from actually propagating value:

### Finding 1 (PRIORITY) — the deed parser extracts garbage grantee/grantor on OCR'd SCANNED deeds
R58c's narrative parser was tuned on clean *text-layer* deeds (e.g., doc 3964 →
`grantor: Oldsmar Retail Development LLC`, `grantee: Deltona Wellness, LP` — perfect). On
**OCR'd scanned** deeds the text layout differs and the parser grabs the wrong span. Live
examples from the drain:
- doc 1896 grantee = `"name, mailing address, and, if appropriate, character of entity, e.g."`
  (a form-field LABEL).
- doc 1935 grantee = a ~600-char legal-description blob ("…POINT OF BEGINNING… metes and
  bounds…").
- doc 1948 grantee = `"LA MIRADA INVESTMENT LLC, A CALIFORNIA LIMITED LIABILITY COMPANY Area"`
  (real name + trailing OCR junk "Area").
- doc 1859 grantee = null.
R59's guards reject all of these (good — no garbage propagates), but the result is that the
**142-deed `url_captured` backlog (mostly scanned) will propagate almost nothing** until the
extraction is clean. This is the gate on the whole deed→BD value.

### Finding 2 — clean deeds parsed BEFORE R59 won't propagate retroactively
R59's Step 6 runs only at parse time. Deeds parsed before R59 shipped (e.g., doc 3964, the
$13.3M Deltona deal with clean parties) have their `latest_deed_grantee` already set + the
R58c never-re-hammer marker, so re-parse skips them and Step 6 never runs. Their matching
sale stays NULL-party and `ownership_history` stays empty. Sized live: of 11 currently-parsed
dia deeds, **5 have a clean grantee and 4 have a NULL-party sale R59 would fill** — this set
grows as the backlog drains.

## Unit 1 (PRIORITY) — harden grantee/grantor extraction for OCR'd scanned deeds
In `api/_handlers/deed-parser.js` (the narrative `extractNarrativeParty` + whatever the OCR
path feeds it):
- **Reject form-label / legal-description spans as a party name** (extend the existing
  plausibility guard, don't fork): a grantee/grantor is invalid if it matches form-boilerplate
  (`mailing address`, `character of entity`, `e\.g\.`, `space above (this|reserved)`), legal-
  description markers (`point of beginning`, `metes and bounds`, `more particularly described`,
  `deed book`, `page \d`, bearings like `North \d+°`), or is > ~80 chars / contains sentence
  punctuation runs. On reject, fall through (null party) rather than emit junk.
- **Trim trailing OCR junk** off an otherwise-good name (e.g., `"… LIMITED LIABILITY COMPANY
  Area"` → strip a dangling single capitalized token after a firm suffix; `"LA MIRADA
  INVESTMENT LLC"`). Reuse/extend the `leadingEntityName` qualifier-stripping from R58c.
- **OCR layout:** scanned warranty deeds usually present parties after the recital connective
  the same way text deeds do (`between … (the "Grantor") … and … (the "Grantee")`), but OCR
  inserts line breaks / loses parens. Loosen the connective/marker match to tolerate
  whitespace-for-newline and a missing/again `"Grantor"`/`"Grantee"` quote, AND add the
  common scanned fallback: the **"GRANTOR:" / "GRANTEE:" labeled block** and the
  "THIS DEED … from <X> to <Y>" form. Keep the labeled-cover-page path (R58b) first.
- Validate every candidate with the existing `granteeIsPlausible` / `granteePassesOwnerGuards`
  so a cleaned name still has to pass.
- Unit-test on the four live garbage shapes above (each → null, not junk) PLUS a clean
  scanned-style sample (labeled GRANTOR/GRANTEE block → correct names), and confirm the 3964
  text-layer case still extracts Oldsmar/Deltona (no regression).

## Unit 2 — one-time retroactive R59 propagation backfill
A worker/script that runs `propagateDeedToBd` over already-parsed deeds whose propagation
never ran: `ingestion_status='deed_parsed'` AND `extracted_data.deed_extraction.grantee`
passes the (hardened) plausibility guard AND the property's matching sale has NULL
buyer/seller OR the property has no deed-sourced `ownership_history` row. Reuse the exact R59
Step 6 entrypoint (same fill-blanks/append-only/guards/idempotency) — do NOT re-run the AI
parse (read the stored `extracted_data`). Gate behind a `?mode=propagate-backfill` flag (or a
small `?_route=deed-propagate-backfill`), capped + idempotent, dry-run first. Expected on the
live set: doc 3964 → sale 14751 gets buyer *Deltona Wellness, LP* / seller *Oldsmar Retail
Development LLC* + an `ownership_history` deed row; the other ~3 clean-grantee/null-party
deeds fill too. Reversible (fill-blanks/append-only, revert by `data_source='deed_extraction'`).

## Boundaries / verify
Fill-blanks / append-only / guard-gated / reversible; reuse R59's Step 6 (no new write path);
≤12 api/*.js; both domains. Report: Unit 1 — the garbage shapes now yield null, clean scanned
sample extracts correctly, 3964 no-regression, full suite green. Unit 2 — dry-run lists the
backfill set, real run fills 3964's sale parties + ownership_history (verify on
property 24703), idempotent re-run is a no-op.

## Bottom line
R59 is wired and safe; it just needs (1) clean party extraction from scanned deeds so it has
real data to propagate (the gate on the 142-deed backlog), and (2) a one-time backfill so the
deeds already parsed with clean parties (3964's $13.3M deal included) finally move the system.
