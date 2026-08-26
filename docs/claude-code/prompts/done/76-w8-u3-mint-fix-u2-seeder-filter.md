# Prompt 76 — W8: U3 entity-mint fix + U2 seeder filter in owner_reconcile

**Grounding (live failures, 2026-08-07, post-#1623):**

1. **U3 confirm → `entity_mint_failed`.** The mint INSERT (admin.js ~5371) sends
   `workspace_id, name, entity_type:'organization', domain, metadata` — but `entities.canonical_name`
   is **NOT NULL with no default** (verified live) → 23502 on every mint. (`'organization'` IS a
   valid enum value — the missing canonical_name is the sole cause.) Scott hit this confirming the
   USAA Real Estate prior-owner proposal (review_id 1, $14.2M rank — the campaign's first
   deed-grounded link) and the row then got marked `rejected` (post-error click), mislabeling his
   intent.
2. **U2 pairs buried.** The owner_reconcile lane shows ~5,300 rows across its 5 folded seeders;
   the 38 `w8_u2_ollama_pair` cards are undiscoverable inside it.

## Do

1. **Mint fix (admin.js U3 confirm branch):** include `canonical_name` using the HOUSE normalizer
   (find the convention — `lcc_normalize_entity_name` SQL fn or the JS equivalent other minters
   use; do NOT invent a new normalization). ALSO fix the resolve step to match on
   `canonical_name=eq.<normalized>` (not raw `name=eq.`) so "Trammell Crow"/"TRAMMELL CROW"
   variants resolve instead of minting duplicates — mirror however `ensureEntityLink`/other
   entity-creation paths do resolve-before-mint. Keep the 2-row ambiguity guard (≥2 canonical
   matches → conflict card, never guess — never-guess doctrine).
2. **Repair the mislabeled row (idempotent, in-migration or SQL note):** reset
   `w8_u3_link_review` review_id 1 (USAA Real Estate) from `rejected` → `proposed` (clear
   decided_by/decided_at) and supersede its verdict decision row, so Scott can confirm it properly
   post-fix. Do NOT touch review_id 2 (Trammell Crow, still proposed).
3. **U2 discoverability (ops.js owner_reconcile lane):** add seeder filter chips at the top of the
   lane (e.g. `All (5.3k) | Ollama pairs (38) | <other seeders>`) with the Ollama-pair chip
   one-click; AND/OR sort `w8_u2_ollama_pair` rows first. Badge stays the honest total but the
   lane's `parts` should expose the U2 sub-count (review-counts already carries parts — surface
   it).
4. **Tests:** mint-payload structural guard (INSERT includes canonical_name; resolve uses
   canonical_name), repair idempotency, seeder-chip presence guard.

## Acceptance

- Confirming the Trammell Crow proposal (review_id 2) completes end-to-end: entity resolved-or-
  minted WITH canonical_name, `entity_relationships` edge written, provenance stamped, apply-log
  row, decision 'decided'. Then the restored USAA row confirms the same way.
- Owner-reconcile lane opens with a visible "Ollama pairs" chip → 38 cards immediately reachable.

Commit with the repo Co-Authored-By + Claude-Session trailer.
