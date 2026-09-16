# OWNERGAP2-harris — resolve the 50 Harris County owners from HCAD's free bulk PDATA export, not the bot-walled portal

**Filed:** 2026-09-16 (Cowork). **Owner:** LCC (`api/_shared/ownergap2-sources.js`, the Harris adapter).
**Read first:** `prompts/done/OWNERGAP2-match-owners-from-free-sources.md`, its response, and
`api/_shared/ownergap2-{address-match,sources,owner-writeback}.js`; the Philadelphia apply of
2026-09-16 (20 written, ledgered — the pattern to repeat).

## Why this exists

OWNERGAP2 shipped Harris as **payload-only**: the HCAD search portal is bot-protected, so the adapter
accepts an operator-supplied payload and does nothing on its own. That was the right call for the
portal. But HCAD also publishes its whole roll as **free bulk files** — the PDATA downloads
(`https://hcad.org/pdata/pdata-property-downloads.html`, codebook at
`https://hcad.org/assets/uploads/pdf/pdataCodebook.pdf`): `Real_acct_owner.zip` → `real_acct.txt`
(one row per account: `acct`, owner name/mailing fields, situs address fields `str_num`, `str`,
`str_sfx`, `site_addr_1/2/3`, `state_class`) plus `owners.txt` for multi-owner accounts. No login,
no CAPTCHA, updated on a published schedule. Scott does not need to hand-fetch anything.

## What to build

1. **Fetch + stage**, not scrape: download the current `Real_acct_owner.zip` (tens of MB) into a
   staging table on Dialysis_DB — `hcad_real_acct_stage(acct, owner_name, mailing…, str_num, str,
   str_sfx, site_addr_1, site_addr_2, site_addr_3, state_class, file_year, loaded_at)` — via a
   one-shot script (`scripts/hcad-pdata-load.mjs`), idempotent on `(acct, file_year)`. Record the
   file's publish date; the codebook says which columns carry the owner of record. **Filter to the
   commercial `state_class` codes** in the load (the codebook lists them) — the 50 targets are all
   commercial, and it keeps the stage small.
2. **Match** the 50 Harris dia properties (the existing population filter `state=eq.TX&county=ilike.harris`)
   against the stage with the *same* address matcher Philadelphia uses (`ownergap2-address-match.js`:
   containment + odd/even parity, range handling, the FM 1960 / Cypress Creek Pkwy alias from the
   prompt's §3). Key on the **Commercial** account where an address has both a Personal (tenant's
   equipment) and a Commercial (real property) account — the OWNERGAP2 prompt's rule; do not
   re-derive operator-vs-owner from the name.
3. **Same contract as Philadelphia**: `source = 'ownergap2_public_assessor:harris_tx:<acct>'`,
   `source_truncated` where the file truncates names, refuse on multi-account ambiguity
   (`needs_parcel_discriminator`), refuse on operator-name matches (PDR2's guard), fabrication guard
   untouched, ledger rows for every attempt, dry run by default.
4. **Run**: dry run → the by-cause table (expect around the 86% the county measurement found) → the
   20-row hand read in the response → real run under batch `ownergap2_harris_tx_<date>` → the six
   gate items from the OWNERGAP2 prompt (§5), including `recorded_owner_id` before/after and the
   `true_owner_id` fingerprint.
5. Tests: the loader is idempotent; the commercial-class filter has a positive control; the matcher
   refuses a Personal-only account; provenance requirement (a write without a source must fail).

## Prohibitions

- ⛔ Do not touch the HCAD search portal or work around its bot protection.
- ⛔ No name is generated, cleaned or "improved"; copy the file's string.
- ⛔ Redeploy both Railway services and confirm `/version` before the real run.

## Reporting

File publish date and row counts loaded (total / commercial), the dry-run by-cause table, the 20-row
read, the real-run counts, the six gate items, and the new "how many of the 4,021 have an owner"
number. If any step was skipped, say so.
