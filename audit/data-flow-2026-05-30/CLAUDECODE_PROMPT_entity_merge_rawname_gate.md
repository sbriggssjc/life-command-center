# Claude Code (life-command-center) — trustworthy entity auto-merge: raw-name-similarity gate

## Why (grounded live on LCC Opps 2026-06-29)

The "Duplicate entities — merge" Decision Center lane has ~2,303 same-normalized-name
groups. We just safely bulk-merged the 550 `auto_mergeable` ones
(`lcc_apply_fuzzy_merges`, 558 entities, reversible). The remaining 2,303 are
`auto_mergeable=false` for a real reason: **`v_lcc_merge_candidates` groups by
`lcc_normalize_entity_name`, which over-collapses genuinely-distinct companies to
the same key.** Live evidence from the name-only tier:
- "Realty Trust Group LLC" grouped with **"Capital Realty"** — different companies.
- "American Realty Capital" grouped with **"American Properties Realty LLC"** —
  different companies.
- (vs legit variants in the same tier: "First Potomac Realty" / "First Potomac
  Realty Trust"; "SNH MEDICAL OFFICE PROPERTIES" / "...PROPERTIES TRUST".)

So a blanket bulk-merge of the 2,303 would corrupt the entity graph. The fix is to
make the auto-merge SAFE + larger by gating on **raw-name similarity**, not just the
lossy normalized key — then re-run the existing bulk-merge on the trustworthy set.

## Unit 1 — add a raw-name-similarity guard to `auto_mergeable`

Do NOT change the global `lcc_normalize_entity_name` (it's used widely; risky). Instead,
tighten the `auto_mergeable` predicate in `v_lcc_merge_candidates` (or a sibling
view the bulk-merge reads) so a group only auto-merges when its members are genuine
formatting variants of each other:
- For every loser vs the winner, require **high raw-name similarity** — e.g. after
  light cleanup (lowercase, strip punctuation + a trailing legal suffix), one is a
  prefix/substring of the other OR a trigram/token-set similarity ≥ a threshold
  (pg_trgm `similarity()` ≥ ~0.6, tune on the examples below). This passes
  "First Potomac Realty"↔"...Trust" and "SNH MEDICAL OFFICE PROPERTIES"↔"...TRUST",
  and REJECTS "Capital Realty"↔"Realty Trust Group" and "American Properties Realty
  LLC"↔"American Realty Capital".
- Keep the existing guards (org-only, not merged, role/portfolio winner pick). The
  raw-similarity guard is ADDITIVE — it can only shrink the auto set to the safe
  members, never widen it to unsafe ones.
- Optional: also auto-qualify a group when a member is already Salesforce-linked
  AND raw-similarity holds (the SF-corroborated tier ≈ 608) — SF link + name
  similarity is very safe.

## Unit 2 — re-run the bulk merge on the now-trustworthy set

After the gate change, `lcc_apply_fuzzy_merges(dry_run, limit)` (unchanged — it reads
`auto_mergeable`) will target the corrected set. Run it **dry-run first**, report the
new auto count + a sample, confirm the false collapses (Capital Realty / American
Properties Realty) are GONE from the auto set, then apply. Reversible as before.

## Unit 3 — the genuinely-ambiguous remainder

Whatever still fails the raw-similarity guard (true distinct-name collisions + the
composite "A LLC; B LLC" rows) stays in the lane for individual human review — that's
correct, not a gap. Optionally surface `review_reason` on those cards so the operator
sees why (low name similarity / distinct domains).

## Boundaries / verify

- life-command-center; the `auto_mergeable` predicate in `v_lcc_merge_candidates`
  (+ pg_trgm if not enabled, additive); reuse `lcc_apply_fuzzy_merges` +
  `lcc_merge_entity` (the reversible R39/R40 merge); no new api/*.js.
- **Verify against the live examples:** post-change, assert "Capital Realty" is NOT
  auto-merged into "Realty Trust Group", "American Properties Realty LLC" is NOT
  merged into "American Realty Capital", while "First Potomac Realty"/"...Trust" and
  "SNH MEDICAL OFFICE PROPERTIES"/"...TRUST" ARE.
- Dry-run the bulk apply, eyeball the sample, then apply; confirm caches
  (`lcc_refresh_priority_queue_resolved`, `lcc_refresh_entity_connected_value`,
  `lcc_refresh_buyer_spe_resolved`) rebuild clean (the R40 post-merge step).

## Bottom line

The merge backlog is large because the name normalizer over-collapses distinct
companies — so the safe move is to gate auto-merge on raw-name similarity (not the
lossy key), which both protects against wrong merges and legitimately grows the
auto-mergeable set to the real formatting-variant dupes. Then the existing reversible
bulk-merge clears them, and only genuinely-ambiguous collisions remain for review.
