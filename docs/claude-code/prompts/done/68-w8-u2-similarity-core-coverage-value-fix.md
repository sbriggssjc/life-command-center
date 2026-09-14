# Prompt 68 — W8 U2 fix round: distinctive-core similarity, coverage, value inversion

**Grounding:** Scott's first live `GET /api/dup-pair-tick?score=1` (2026-08-07, post-#1606).
Verbatim failures:
- **Similarity metric degenerate:** `P & A Investments LLC` ↔ `B & W REALTY INVESTMENT LTD` = 0.909;
  `Owner` ↔ `Downer & Associates` = 0.833; `T.D. Service Company` ↔ `I. C. E. SERVICES, INC` = 0.875.
  Generic CRE vocabulary (Investments/Properties/Realty/Services/LLC…) dominates char-level
  similarity while "no shared word token" passes on technicalities (Investments ≠ INVESTMENT).
  28 of the top-20 sample pairs are noise.
- **Coverage broken:** `gov:true_owners` records=0 and `dia:true_owners` records=0 (15,054 + 6,967
  rows exist — a SILENT query failure: check the domain client/allowlist/column names — the classic
  "edge allowlist 403 → client shows []" footgun class); `lcc:entities` truncated at 8,000 of 60,431.
- **Value inversion:** model labeled the junk pairs `distinct` 0.95 (= MORE easy negatives, the
  exact corpus disease W4.3 diagnosed) while dropping the two genuinely valuable pairs as unsure
  0.3: `Invester Properties LLC` ↔ `Investar Properties Llc` (real typo-dupe — the best catch on
  the sheet) and `WINBROOK MANAGEMENT` ↔ `Twinbrook Properties`.

## Do (in `api/_shared/dup-pair-planner.js` + tick)

1. **Distinctive-core similarity:** strip legal forms (LLC/LP/LLP/Inc/Ltd/Trust/Co/Corp…) AND a
   generic-CRE-noun stoplist (investment(s), propert(y|ies), realty, real estate, group,
   enterprise(s), service(s), management, capital, associates, holdings, partners, company,
   ventures…) → the distinctive core. Pair ONLY when the CORES are similar (trigram/lev ≥ ~0.8)
   and non-trivial (core length ≥ 4, not purely initials). `Invester`↔`Investar` pairs;
   `P & A`↔`B & W` never generated. Initials-only cores (`P & A`, `K & W`) are NOT pairable by
   name similarity — only via same-address method.
2. **Fix coverage:** root-cause the gov/dia zero-record scans (probe the actual query path — RLS,
   view/table name, column names, silent catch swallowing errors; surface fetch errors LOUDLY in
   the dry-run output instead of `records:0, truncated:false`). Page the lcc scan (1000/page
   stride per the PostgREST cap) with a deterministic resumable window so successive nightly runs
   cover different slices of the 60k rather than the same first 8,000 (cursor in the ledger,
   U1-style).
3. **Fix the value logic:**
   - Easy-distinct pairs mostly die at generation after (1). For what reaches the LLM, **distinct
     verdicts only persist when the pair was a genuine near-miss** (core-similarity pairs are, by
     construction) — that's a HARD negative worth labeling (Harrison↔Garrison class).
   - **High-similarity `unsure` (core sim ≥ ~0.85) routes to the review lane as
     `needs_human` instead of being dropped** — a typo-variant judgment call is precisely what the
     human lane exists for; dropping it silently loses the unit's best finds. Low-similarity unsure
     still drops (counted).
   - Rubric additions: typo/spelling-variant cores (Invester/Investar, Winbrook/Twinbrook) lean
     same_party pending human confirm; different personal surnames (Harrison vs Garrison) are
     distinct; entity-form or state-suffix differences alone don't distinguish.
4. **Regression fixtures (verbatim):** `Invester↔Investar` → proposed (same_party or needs_human,
   never silently dropped); `P & A↔B & W` → never generated; `Owner↔Downer & Associates` → never
   generated; `Harrison↔Garrison` → generated, distinct persists as hard negative.
5. **Tests:** core-extraction, stoplist, initials guard, coverage-error surfacing, unsure-routing;
   existing 43 stay green.

## Acceptance

- Re-run `?score=1`: gov/dia record counts non-zero (or a LOUD per-target error), sample pairs are
  recognizable near-misses, Invester/Investar-class proposed, no initials-vs-initials noise.
- Flag stays OFF until the re-run passes.

Commit with the repo Co-Authored-By + Claude-Session trailer.
