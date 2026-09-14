# Prompt 79 — W8 U5: naming-hygiene campaign (rename/normalize proposals)

**Grounding:** the U1 scans count a **~6.5k naming-hygiene backlog** (lcc 5,091: 1,113
known_abbreviation + 3,978 address_as_name; gov 973; dia 395) — deliberately excluded from U1
(prompt 65) as "its own future unit." This is that unit. Reuse the U1 machinery wholesale
(`classifyName`'s naming_hygiene classes already exist in `junk-prescreen.js`; tick/lane/ledger/
flag patterns proven through U1–U4). All W8 doctrine applies (propose-only, human lane, verbatim
evidence, reversible, flag OFF in-migration, bounded+resumable, staggered cron ~4:25 UTC).

## Do

1. **Two proposal types, deterministic-first:**
   - `known_abbreviation` → **rename proposal**: deterministic expansion where the dictionary is
     unambiguous (Prtnrs→Partners, Mgmt→Management…) — these need NO LLM, just the mapping +
     evidence (the abbreviated token). Ollama only for ambiguous cases (Cos→Companies? Cos as
     surname?), with the judge-don't-parrot rubric.
   - `address_as_name` → **link-don't-rename**: propose attaching the entity to the property at
     that address (resolve via the domain property tables / subject-resolver) rather than renaming
     — address-named entities are property anchors; the fix is the missing property link + a
     display-name fill where derivable (owner name from the property record, fill-blanks only).
2. **Fill-blanks discipline on apply:** rename writes update `name`/`canonical_name` via the house
   normalizer with provenance + reversible ledger (original name preserved); property-link applies
   go through `external_identities`/`ensureEntityLink` semantics. Register the fsp source rows
   in-migration; unranked view stays clean.
3. **Volume control:** value-gate (entities with relationships/portfolio first — renaming a
   connected entity improves every surface it appears on), batch ~50/night for deterministic
   renames (cheap), ~15/night for LLM-assisted. Dedupe/resume markers per U1.
4. **Lane:** its own DC federated lane (three-touch wiring per the 75 structural guard — it will
   FAIL tests if half-wired, by design), bulk-confirm for the unambiguous-dictionary renames
   (they're mechanical; one click per page, not per card).
5. **Flag `W8_U5_NAMING_HYGIENE` OFF; tests; ROLLOUT_STATUS U5 row; prompt to done/.**

Acceptance: dry-run shows per-class/per-domain counts + a sampleable sheet (deterministic renames
listed separately from LLM proposals); Scott reviews → Cowork flips. Commit with the repo trailer.
