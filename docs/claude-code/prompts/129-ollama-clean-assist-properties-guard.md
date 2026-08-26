# Prompt 129 — `ollama-clean-assist` guard is RED: real P106 breach, or a drifted source-grep? Determine, then fix

**Status:** DRAFT 2026-08-24 (Cowork; one of the 3 real failures P128 surfaced when it corrected the suite count to 4,363/3)

Grounding: `test/ollama-clean-assist.test.mjs`, the `ollama-clean-assist-tick` handler in `api/admin.js`,
migration `supabase/migrations/20260804140000_lcc_prompt32_ollama_clean_assist.sql`, the annotation store
`lcc_clean_assist_proposals`, and the **P106/P32 doctrine: the assist layer ANNOTATES (writes only
`lcc_clean_assist_proposals`) and NEVER reads or writes canonical domain data (`properties`).** Also the
recurring footgun this arc hit three times (P126 `</table>`, P128 U3): **a test that slices/greps a source
block breaks when the source moves.**

## The failure

`test/ollama-clean-assist.test.mjs` extracts the clean-assist source block from `api/admin.js` (by a start
marker + `block end` match) and asserts, among other things, that the block **does NOT contain the literal
`'properties?'`** (line ~36–38: "clean-assist worker must not call `${forbidden}`"). It is currently RED — so
the extracted block now contains `properties?`. Two very different causes, and the fix depends entirely on which:

- **(A) Real P106 breach** — the actual `ollama-clean-assist-tick` handler now issues a `properties?` query
  (reads or writes canonical property data). That is a live doctrine violation and a data-integrity concern.
- **(B) Drifted block-grep (P128 class)** — `api/admin.js` has grown/reordered since the test's start/end
  markers were written, so the extracted "block" now spills into an ADJACENT handler that legitimately calls
  `properties?`, and the clean-assist code itself is still annotation-only.

## The ask

1. **Determine which it is — with evidence, not assumption.** Print the exact byte range the test extracts
   today and show whether the `properties?` hit lies inside the real `case 'ollama-clean-assist-tick':` handler
   body or in neighbouring code the block boundary over-ran. State (A) or (B) plainly.
2. **If (A) — fix the worker.** The clean-assist tick must write ONLY `lcc_clean_assist_proposals`
   (`on_conflict=` upsert, `CLEAN_ASSIST_SOURCE='ollama_clean_assist'`) and must not read or write `properties`.
   Remove the canonical call; if it needs property context, it must come from the already-permitted read path,
   not a direct `properties?` write. Verify the tick still annotates and touches no canonical row (state delta:
   `lcc_clean_assist_proposals` grows, `properties` unchanged).
3. **If (B) — fix the test, not the code.** Re-anchor the block extraction on stable structural boundaries (the
   `case 'ollama-clean-assist-tick':` … `break;`/`}` of that one handler), or assert the behavioural contract,
   so it can never again catch an adjacent handler's `properties?`. Same remedy shape as P128.
4. **Verify by the pass/fail LIST, never `node --test`'s exit code** (it returned 0 over real failures three
   times this arc). Report the targeted test green and the full-suite count (expect 4,363/3 → **4,364/2**),
   confirming the other two failures (`auto-scrape-listings`, `folder-feed-enrich-mode`) are untouched and
   separate.

## Close-out
- If (A): runtime + possibly migration change → ships on the Railway redeploy of merged `main`. If (B):
  test-only. Update STATUS with which it was and the corrected suite count. The other two failures are their own
  follow-ups (not this prompt).
