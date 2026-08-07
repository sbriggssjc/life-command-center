# Prompt 64 — W8 U1 precision fix: SPE/acronym guards + real-judgment rubric

**Grounding:** Scott ran the first live `GET /api/junk-prescreen-tick?score=1` (2026-08-07) and the
proposal sheet failed review — real entities proposed `dismiss`. Verbatim failures from the sample:
- `ARC3 GSCRGCO001, LLC`, `ARHC MCNWDNY01, LLC`, `ARC GSDVRDE001, LLC`, `Arg Ddblvtn001 Llc` →
  dismiss 0.85–0.95. These are **net-lease SPE naming conventions** (ARC/ARHC + property code + LLC)
  — core real entities in this business, likely FK-connected to properties.
- `SMBC` (Sumitomo Mitsui), `FCMC` (Fresenius-family), `LFLP`, `PVLLC` → dismiss 0.9. Acronym
  entities are often real lenders/owners.
- `Brookfield Prop Prtnrs DBUBS 2011-LC1 ($130.2m approx)` → dismiss ("malformed abbreviation") —
  it's Brookfield with a CMBS loan tag; at worst a rename.
- `3710 Fm 1889`, `654 SR 75` → dismiss — address-as-name rows; the right proposal is
  rename/parse-to-property-link, not dismiss.
- Pattern: **every LLM reason restates the triggering heuristic** (consonant_run/no_vowel/too_short)
  — the model is anchoring on the hint, not judging. 18/20 dismiss = the lane would be noise
  (honest-counts violation). Only the `--` / `Test Test` class was correctly dismissed.

## Do (in `api/_shared/junk-prescreen.js` + the tick)

1. **Deterministic guards BEFORE the LLM (cheap, high-precision keeps):**
   - **SPE-pattern guard:** name matches `\b(LLC|LP|LLP|Trust|REIT)\b` AND contains a
     letters+digits code token (`[A-Z]{3,}\d{2,}` or `[A-Z]+\d+[A-Z]*\d*`) → NOT a candidate
     (or candidate with `keep` pre-verdict). Consonant-run inside a code token never fires.
   - **Known-abbreviation dictionary:** Prtnrs/Ptnrshp/Assoc/Mgmt/Hldgs/Dev/Grp/Svcs etc. →
     heuristic downgrades to `rename` proposal (never dismiss), evidence = the abbreviation.
   - **Relationship/portfolio gate:** before proposing dismiss, count FK references (the U1 FK-guard
     machinery already probes children) + `lcc_entity_portfolio_facts` / `external_identities` /
     `entity_relationships`. Any hit → cap verdict at `keep`/`review`, never dismiss. A connected
     entity is by definition not junk, whatever its name looks like.
   - **Address-as-name:** street-address regex (`^\d+ .*(St|Rd|Ave|Blvd|Hwy|SR|FM|Ln|Dr)\b`-class)
     → proposed verdict `parse_contact`-style rename/link, never dismiss.
   - **Acronym rule:** 2–5 all-caps letters alone is NOT sufficient for any proposal; require a
     second junk signal (zero relationships AND no identities AND no source provenance) to even
     reach the LLM.
2. **Rubric rewrite (the LLM must judge, not parrot):** the prompt now states the heuristic is a
   WEAK HINT with known false-positive classes (SPE codes, bank/operator acronyms, abbreviated firm
   names, CMBS/loan tags); instructs "propose dismiss ONLY if no plausible reading as a real
   company/person exists"; requires the reason to cite evidence BEYOND the heuristic (e.g. "no
   relationships, single source, matches test-data pattern"); includes few-shot negatives drawn from
   the failures above (ARC SPE → keep; SMBC → keep; Prtnrs → rename; `--` → dismiss; `Test Test` →
   dismiss). Feed each candidate's relationship/identity counts into the prompt as context.
3. **Verdict distribution guard on the tick:** if a scored batch proposes >50% dismiss, flag the
   batch `suspect_distribution` in the dry-run output (and refuse POST apply for that batch) — a
   junk pre-screen on curated tables should be finding a small minority.
4. **Tests:** unit tests for each guard class using the verbatim names above (they're now the
   regression fixtures); rubric-content test; distribution-guard test.
5. Re-run guidance: Scott re-runs `?score=1` and expects: `--`/`Test Test`-class → dismiss; ARC/ARHC
   SPEs, SMBC, Brookfield → keep (or absent from candidates); Prtnrs/Ptnrshp → rename; addresses →
   rename/link; dismiss share well under 50%.

Note (env, not code): scoring ran `gpt-4o-mini` because `OLLAMA_SURFACES` currently excludes
`clean_assist` — Scott is unsetting/expanding it. Code change must work identically on either
provider.

Commit with the repo Co-Authored-By + Claude-Session trailer.
