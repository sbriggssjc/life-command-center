# Prompt 65 — W8 U1 scope tighten: true-junk only, keeps are non-events

**Grounding:** Scott's second live `?score=1` run (2026-08-07, post-64). The 64 guards WORK
(SPEs excluded, distribution 0% dismiss, connection gate firing) but exposed two remaining flaws:

1. **Candidate pool exploded 649 → 6,946** (lcc 278 → 5,298). The new `known_abbreviation` and
   `address_as_name` heuristic classes flag thousands of REAL entities. Address-named entities with
   6–88 relationships are LCC's deliberate property-anchor pattern; "Cohen Cos" / "City-Core Dev
   Inc" are just names. These are a NAMING-HYGIENE backlog, not junk — wrong campaign.
2. **All 20 scored rows were connection-gated keeps** — the LLM never ran, and each keep became a
   proposal row. A keep is a non-event; persisting it floods the lane with nothing-to-do cards
   (honest-counts violation from the opposite direction as the 18/20-dismiss failure).

## Do (in `api/_shared/junk-prescreen.js` + the tick)

1. **Restrict U1 candidacy to TRUE-JUNK classes only:** `all_non_alpha`, `token_junk`
   (test/asdf/placeholder), gibberish, `too_short` — and `too_short`/acronym ONLY when the entity
   has zero connections (fold the connection check into candidacy, below). **Drop
   `known_abbreviation` and `address_as_name` from candidate generation entirely.** Report their
   counts in the dry-run as a separate `naming_hygiene_backlog` metric (per-domain counts only, no
   rows enqueued) — that backlog becomes its own future unit (rename/normalize campaign, distinct
   consumer + gate), not U1's.
2. **Move the connection check to scan time (batch, cheap):** candidates that are FK-referenced /
   have identities/relationships are EXCLUDED from the pool before scoring (counted as
   `excluded_connected`), not scored into keep. This kills the wasted per-row probes and the
   keep-flood at once. (Keep the per-row FK probe as the apply-path safety net — belt and braces.)
3. **Keeps are never persisted:** in both dry-run and POST apply, only
   `dismiss`/`rename`/`parse_contact` proposals become `junk_entity_review` rows. LLM/guard keeps
   are counted (`kept_not_enqueued`) and dropped.
4. **Expected live outcome (acceptance):** candidate pool back to the few-hundred true-junk range;
   `?score=1` sample dominated by `--` / `Test Test` / gibberish-class rows with dismiss verdicts
   that SURVIVE review; naming_hygiene_backlog reported ~6k without enqueueing; distribution guard
   still active.
5. **Tests:** candidacy exclusion tests (abbrev/address absent; connected too_short absent),
   keep-not-persisted test (dry-run + apply), backlog-metric test. Reuse the verbatim fixtures.

Commit with the repo Co-Authored-By + Claude-Session trailer.
