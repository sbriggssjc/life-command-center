# Claude Code — R58c: harden the narrative deed parser (name is separated from the "(the "Grantor")" marker)

## Why (live R58b re-parse, 2026-06-21)
R58b's deed parser now handles the **labeled cover-page** format — verified live: dia deed 3807
parsed `First Grantor: TRIVIUM GROVE CITY LLC` → `First Grantee: CHF II GROVE CITY MOB LLC` and **fed
R51** (`r51_fed:true`). But the **narrative parenthetical** format still yields `no_parties` on a real
deed (dia doc 3964), so it records `ingestion_status='deed_no_parties'` and does NOT feed R51.

Root cause — `extractNarrativeParty` assumes the entity name sits **immediately before** the
`(the "Grantor")` / `(the "Grantee")` marker. On real warranty deeds a long qualifier + address sits
in between, so the token immediately preceding the marker is the address, not the name. Actual 3964
text (clean `pdf_text`, not OCR):

```
… by and between Oldsmar Retail Development LLC, a Florida limited liability company, a/k/a
Oldsmar Retail Development, LLC, whose address is 3662 Avalon Park East Boulevard, Suite 201,
Orlando, Florida 32828 (the "Grantor"), and Deltona Wellness, LP, a Florida limited partnership,
whose address is 17 Copperbeech Lane, Lawrence, New York 11559 (the "Grantee") …
```
Correct extraction: grantor `Oldsmar Retail Development LLC`, grantee `Deltona Wellness, LP`. There is
also an explicit price upstream in this doc: `Transfer Amt $13,333,400.00` (+ `Doc Stamps $93,333.80`
= FL 0.7%), which R58b's price logic should capture (verify it does on this doc).

## Fix (`api/_handlers/deed-parser.js`, surgical — keep R58b's labeled path intact)
The narrative grantor/grantee should be the entity name that **follows the connective** (`between` for
grantor, `, and ` for grantee), NOT the token before the marker. Rework `extractNarrativeParty` to:
1. Anchor on the **connective**: grantor = the text after `between` up to the first `(the
   ["“]?Grantor["”]?)`; grantee = the text after `, and ` (the connective joining the two parties) up
   to the first `(the ["“]?Grantee["”]?)`. Curly/straight quotes both; tolerate `the "Grantor"` with
   or without surrounding parens.
2. From that captured span, take the **leading entity name** = everything up to the FIRST qualifier
   delimiter, where a qualifier starts at the first occurrence of any of: `, a ` / `, an ` (entity-type
   clause "a Florida limited liability company"), `a/k/a`, `f/k/a`, `, whose address`, `whose address`,
   `, an individual`, `, a married`, `, trustee`, `, as trustee`. Trim trailing commas/whitespace.
   Result keeps `Oldsmar Retail Development LLC` and drops `, a Florida limited liability company,
   a/k/a …, whose address is … 32828`.
3. Keep the existing firm-suffix / `granteeIsPlausible` guards so the cleaned name still validates; if
   after trimming the name is empty or implausible, fall through (don't emit a bad party).
4. Order of precedence unchanged: labeled cover-page (R58b) wins when present; this narrative path is
   the fallback; deed-of-trust (trustor/trustee/beneficiary) still yields null.

## Re-parse is free — no re-OCR
The fix applies to already-text-banked deeds via the existing `?mode=reparse` path (reads stored
`raw_text`, no OCR). The `deed_no_parties` rows are eligible for re-parse (extend the reparse selector
to include `ingestion_status='deed_no_parties'` AND no parsed grantee, so they get re-tried after this
ships).

## Verify (report back)
- Unit test on the exact 3964 span → grantor `Oldsmar Retail Development LLC`, grantee
  `Deltona Wellness, LP`; the `, a Florida LLC, a/k/a …, whose address …` qualifier stripped; the
  3807 labeled case still parses (no regression); a deed-of-trust still yields null.
- Price: 3964 → `Transfer Amt` → `$13,333,400` captured (`price_source='transfer_amount'`), doc-stamp
  cross-check agrees.
- `?mode=reparse&domain=dia` over the `deed_no_parties` set re-parses 3964 → grantor/grantee + R51 fed,
  no re-OCR (ocr_pages_total 0).
- `node --check`; ≤12 api/*.js; deed-parser test green.

## Bottom line
R58b fixed the labeled cover-page format (live-verified, R51 fed). R58c fixes the narrative format by
anchoring on the connective and stripping the intervening qualifier/address, so warranty-deed
grantor/grantee (and the explicit transfer price) flow into R51 too — and every already-OCR'd
`deed_no_parties` row re-parses for free.
