# QA-11 — Public-REIT filter + same-entity dedupe on `llc_research_queue` (P1)

**Severity: P1.** Brandywine Realty Trust — a publicly traded REIT
(NYSE: BDN) — was sitting on the NBA rail as rank #9 and #10
(once as "Brandywine Realty Trust", once as "Brandywine Realty Trust
JV MSD Partners"). Public REITs file with the SEC, not state
Secretary-of-State portals, so the queue's primary action ("Open SoS →")
was a dead end for them. Same-entity rows with different suffix
permutations also clogged the queue with duplicates.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-11-llc-queue-public-reit-dedupe
node audit/patches/qa-11-llc-queue-public-reit-dedupe/apply.mjs --dry
node audit/patches/qa-11-llc-queue-public-reit-dedupe/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-11-llc-queue-public-reit-dedupe/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-11-llc-queue-public-reit-dedupe -m "Merge audit/qa-11-llc-queue-public-reit-dedupe"
git push origin main
```

## What the migration does (both projects)

1. **Expand status CHECK** — adds `'skipped_public_reit'` and
   `'skipped_dupe'` to the allowed values.
2. **`public.llc_normalize_name(text)`** — IMMUTABLE helper that
   lowercases, strips common entity suffixes (LLC, Inc, Corp, Trust,
   Partners, JV, Joint Venture, Holdings, Properties, Realty, REIT,
   etc.) and punctuation, then collapses whitespace. So:
   ```
   "Brandywine Realty Trust"            → "brandywine"
   "Brandywine Realty Trust JV MSD …"   → "brandywine msd"
   "Realty Income CORP"                 → "income"
   "MACARTHUR AT LAUREL HOLDINGS LLC"   → "macarthur at laurel"
   "Macarthur At Laurel Hldgs Llc"      → "macarthur at laurel hldgs"
   ```
   (Note: "hldgs" doesn't match the suffix list, so that pair still
   doesn't collapse — fixable by adding common abbreviations later.)
3. **`public.llc_is_public_reit(text)`** — IMMUTABLE helper matching a
   curated list of 37 publicly traded REITs and the two major dialysis
   operators (DaVita, Fresenius). Returns `true` if `search_name`
   contains any of them.
4. **Schema additions** on `llc_research_queue`:
   - `is_public_reit BOOLEAN DEFAULT FALSE`
   - `normalized_name TEXT GENERATED ALWAYS AS
     (public.llc_normalize_name(search_name)) STORED`
   - `llc_research_queue_normalized_idx` partial index on
     `normalized_name WHERE normalized_name IS NOT NULL`.
5. **Backfill**:
   - Rows where `llc_is_public_reit(search_name)` → `status =
     'skipped_public_reit'`, `is_public_reit = TRUE`.
   - Within remaining `'queued'` rows, `ROW_NUMBER() OVER (PARTITION
     BY normalized_name ORDER BY created_at, queue_id)`; rn > 1 → 
     `status = 'skipped_dupe'`.
6. **`llc_research_queue_auto_skip_trg`** — BEFORE INSERT/UPDATE
   trigger applies the same logic to future rows so the queue
   stays clean.

`v_next_best_action` already filters `status = 'queued'`, so the
skipped rows are naturally excluded from the NBA rail with no view
change.

## Live impact (verified)

| Domain | queued before | queued after | skipped_public_reit | skipped_dupe |
|---|---|---|---|---|
| dia (`zqzrriwuavgrquhisnoa`) | 1,267 | **1,215** | 10 | 42 |
| gov (`scknotsqkcheojiaewwh`) | 254 | **249** | 5 | 0 |
| **Total** | **1,521** | **1,464** | **15** | **42** |

57 dead-end rows removed across both queues. Brandywine Realty Trust
is no longer enqueued; the Realty Income three-way dupe collapsed to
one row; "Macarthur At Laurel Holdings LLC" / "MPVCA OAKLAND LLC" /
etc. collisions resolved.

## Files

- `supabase/migrations/dialysis/20260518150000_dia_qa11_llc_queue_public_reit_dedupe.sql`
- `supabase/migrations/government/20260518150000_gov_qa11_llc_queue_public_reit_dedupe.sql`
- `AUDIT_PROGRESS.md` (closeout)

Both SQL files applied live via Supabase MCP on 2026-05-18.

## Caveats / what we did NOT change

- **The "Open SoS →" CTA on the frontend** still routes to a state
  SoS portal. Now it just won't be offered for public REITs because
  those rows aren't `queued`. A future enhancement could swap the
  CTA to SEC EDGAR for `is_public_reit = true` rows in the rare case
  someone navigates to one of those rows from elsewhere.
- **The public-REIT list is curated, not exhaustive.** It captures
  the high-frequency offenders observed during the QA pass. Extend
  by appending to the `VALUES` list in `llc_is_public_reit`.
- **The normalizer is conservative.** Abbreviations like "Hldgs"
  (for Holdings) aren't in the suffix list, so case + abbreviation
  collisions still survive. Fixable iteratively as more pairs
  are observed.
- **`v_property_value_signal` materialized view (QA-06) does NOT
  need a refresh** — the queue change doesn't affect that signal.

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P2** Casing/UX nits documented in `outputs/lcc-qa-pass-2026-05-18.docx`
- **Optional** SEC EDGAR routing for `is_public_reit = true` rows if/when one surfaces by direct lookup.
- **Optional** extend the normalizer with common abbreviations
  (Hldgs, Mgmt, Cap Prtnrs, etc.).
