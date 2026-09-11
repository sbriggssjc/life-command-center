# C13g-costar-stoplist — the CoStar residue the capture-path fix didn't touch

**Read first:** `docs/architecture/owner-role-classification.md` §9h (the C13g capture-path fix — this
is its named, unfixed residue) · `docs/os/PLANNED-BACKLOG.md` row `C13g-costar-stoplist` ·
`api/_handlers/sidebar-pipeline.js` (`contactEntityType`, `unpackContacts`) ·
`extension/content/_forsale-contacts-parse.js` (`looksLikePerson`) ·
`api/_shared/entity-link.js` (`hasFirmSuffix`, `ENTITY_FIRM_SUFFIX_RE`).

## Where the last fix landed, and what it didn't reach

`C13g`'s capture-path fix (2026-09-10) closed the RCA majority (115 of 142 sampled mistyped entities)
by routing `contactEntityType()`'s no-explicit-type fallback through `hasFirmSuffix()`. The CoStar
residue (32 of 142) was named but not fixed — it has a different shape: the "For-Sale/For-Lease
Contacts" panel parser (`extension/content/_forsale-contacts-parse.js`) computes its own
`type: looksLikePerson(name) ? 'person' : 'organization'` using a BROADER stoplist than
`hasFirmSuffix()` — it includes `ventures`, `management`, `newmark`, `cbre`, `jll`, `colliers` (brand
names of the brokerages themselves showing up inside a contact's captured name), none of which
`hasFirmSuffix()`'s org-suffix list covers.

**What's actually unverified — this is the first thing to settle, not assume:** `contactEntityType()`
DOES honor an explicit `contact.type === 'organization' | 'entity' | 'person'` when present (read the
function — it checks `contact.type` before ever falling back to `hasFirmSuffix`). So if the extension's
`type` field is genuinely reaching the backend unmodified, the 32-row residue should already be getting
the EXTENSION's (broader, more accurate) verdict, not the backend's — which would mean the residue's
cause is something else entirely: the field getting dropped or renamed somewhere in the capture →
staging → `unpackContacts()` path, or the extension's own classification being wrong on these specific
32 rows despite its broader list. **Do not assume the "never read back" framing from the prior response
is correct — verify it against the actual 32-row population before writing any fix.**

## 1. Trace the 32 rows precisely

Pull the actual 32 `costar/contact` rows C13c measured (or the closest live equivalent — the mistyped
population moves, so re-measure rather than assume the same 32 still exist). For each: what does the
staged payload (`metadata.contacts[].type`, wherever it's captured before `unpackContacts()` reads it)
actually contain at the point `contactEntityType()` is called? Three possible findings, and they need
three different fixes — name which one is true:
- (a) `contact.type` DOES arrive correctly as `'person'`, and it's simply WRONG — the extension's
  broader stoplist still missed an org marker present in these 32 names. Fix: widen (or better, share)
  the stoplist so both sides use one list, not two independently-maintained ones.
- (b) `contact.type` arrives but under a different key or shape than `contactEntityType()` reads, so it
  silently falls through to the weaker backend fallback. Fix: the field-mapping bug, not the stoplist.
- (c) `contact.type` never leaves the extension for this parser's rows at all (the panel doesn't set it
  on the payload it sends, despite computing it for its own display). Fix: send it.

## 2. Fix the root, not the two-list symptom

Whatever (a)/(b)/(c) turns out to be, prefer a fix that ends the TWO-STOPLIST problem permanently
rather than widening one list again — the P189/A2/N15c lesson this same arc already applied once
(§9h) is that a second copy of a graded list drifts. If the extension's list is genuinely more complete
for its population (brokerage brand names it sees that the backend wouldn't), consider whether the
backend should read the extension's verdict when present (case (b)/(c)) rather than re-deriving it, or
whether `hasFirmSuffix()` itself should absorb the extra terms so there is only ever one list
(case (a)) — measure which is true before choosing.

## 3. Guard + ship

Positive control on real names from the 32-row sample (or its live re-measurement). A regression guard
in the style of `test/c13g-contact-entity-type.test.mjs` — name the specific rows/patterns it pins.
Forward-mint only, same discipline as the prior fix: do not bulk-retype existing entities from here;
any newly-detectable mistyped rows are `entity_type_review` lane population.

## 4. Ship + record

Branch `build/c13g-costar-stoplist`. STATUS.md entry naming which of (a)/(b)/(c) was true — that's the
main finding worth recording, the current docs only have the symptom. Backlog row
`C13g-costar-stoplist` — mark ✅ only if the fix is deployed and guarded; if this turn only completes
the trace in §1, say so plainly and leave it at its current state with the finding recorded.
