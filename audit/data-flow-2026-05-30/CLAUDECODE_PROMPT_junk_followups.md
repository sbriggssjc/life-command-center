# Claude Code prompt — junk-lane follow-ups: exact-name auto-merge + contact parser

Paste into Claude Code, run from the **life-command-center** repo. Two small,
focused units following the B9 bulk run (executed live 2026-06-06: 3 trust
placeholders dismissed, 113 `by_brokerage` clean-renames, 282 `deal_string`
dismissals, zero failures).

## 1. Exact-name auto-merge (the rename aftermath)

The 113 clean-renames created name collisions with canonical entities —
verified live: **98 worked entities now share an exact (case-insensitive)
name with another live entity** (e.g. a renamed "NGP Capital" beside the real
NGP Capital parent). These are the cleanest possible merge candidates.

Build a small worker (admin.js sub-route, e.g. `?_route=exact-merge`):
- GET = preview: pairs where a recently-worked junk entity (metadata
  `junk_name_reviewed` set) exactly matches another live entity's name,
  same workspace; classify SAFE (same domain or one side domainless; no
  conflicting SF identities; target is not itself junk-flagged) vs REVIEW
  (domain mismatch / both have SF identities / ambiguous multi-match).
  Report counts + samples.
- POST = apply SAFE pairs via the existing **`lcc_merge_entity`** (junk →
  canonical direction: the renamed artifact merges INTO the established
  entity; never the reverse). Batch-capped, idempotent (merged rows have
  `merged_into_entity_id` and drop out of the preview), effect-first,
  decision-recorded per pair. REVIEW pairs go to the merge lane, not auto.
- Respect the known `lcc_merge_entity` gotchas (two-step DELETE-then-UPDATE
  portfolio-facts semantics — it's proven machinery, just call it).
- Verify: preview on live data (report SAFE/REVIEW split), apply ONE small
  batch live, confirm portfolio facts/identities moved and the pair left the
  preview; remaining batches are one POST each for Scott/me to run.

## 2. `parse_contact` verdict for the phone/email bucket (held 35)

The `phone_or_email` bucket was deliberately NOT dismissed — the rows are
real people with parseable data: `"Seller ContactsCraig Burrows(916)
768-5544 (p)"` → name **Craig Burrows**, phone **(916) 768-5544**, role
**seller contact**. Add a `parse_contact` verdict to the junk-bucket worker:
- Parser: strip the `Seller Contacts`/`Buyer Contacts` (and similar
  panel-header) prefix; extract name (the `looksLikePersonName` shape);
  extract phone (and email when present); map prefix → role
  (seller_contact / buyer_contact).
- Effects per row: rename the entity to the clean person name; store
  phone/email + role on the entity metadata AND through whatever contact
  record the entity-contact machinery supports (the buyer-contact picker's
  add-contact path shows the shape); clear the junk flag; record the
  decision. Rows the parser can't confidently split stay flagged (report
  them).
- These people are buy-side cadence candidates — make sure the renamed
  persons are eligible for the P-BUYER contact picker's name-match source
  (they now pass `looksLikePersonName`).
- Unit-test the parser on the real strings (the GET preview has 10 samples).
  Verify live on the bucket: report parsed/failed counts, zero hard-deletes.

Both: `node --check`; 12 functions; idempotent; effect-first/outcome-truthful;
batch-capped; ANALYZE not needed (small sets). Report counts in the PR.
