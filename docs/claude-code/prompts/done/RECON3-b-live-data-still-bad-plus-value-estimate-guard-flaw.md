# RECON3-b — RECON3 landed live (PR #2608) but property 27266's own bad data is still bad, and the value-estimate fix has a live-verified logic flaw

**Filed:** 2026-09-22 (Cowork), reconciling `RECON3`'s response (`docs/claude-code/responses/done/RECON3 desktop response.docx`)
against live Dialysis_DB. **Owner:** LCC (`api/_handlers/sidebar-pipeline.js`, `api/_shared/`,
`supabase/migrations/dialysis/`). **Read first:** `prompts/RECON3-succasunna-sf-account-id-owner-and-value-backfill.md`
(the original 7-item prompt), the merged PR (`sbriggssjc/life-command-center#2608`, commits `c386de22`,
`07473131`, `720aadcf`), backlog row `RECON3`.

## What actually shipped (verified against the merged diff + a live test run, not just the response's own summary)

All three JS-side guards are real and correct as written, and 609 existing tests across
`sidebar-pipeline`/`entity-link`/`detail.js` plus the 29 new RECON3 tests all pass:

1. `isJunkSalesParty()` + `ensureEntityLink()` now refuse to write a raw Salesforce record id
   (`001…`/`003…`/etc.) as a buyer/seller/entity name — resolve-or-drop, never fabricate. **Confirmed
   correct and forward-looking only** — see below.
2. `upsertDomainLeases()`'s single-tenant fallback branch (the exact path property 27266 took) now
   runs `isJunkTenant()`, closing the real gap: the array-path loop already had this guard, the
   fallback branch silently didn't. Root cause is more precise than the original prompt's guess
   (a missing guard call, not a missing regex).
3. Cohort tables (`_udTabOperations()`'s two tables AND `_udRenderGeoSection()`'s owner-cohort table —
   three render paths, not just the two the prompt named) gained additive Rent/SF + Census columns.
4. `_udExportOperations()` gained a SOLD-banner gate via `_udDetectClosedSale()`.

## Two things need a follow-up round before this can be called done

### 1. Property 27266's own data is still exactly as bad as SBN-19 found it — live-reconfirmed 2026-09-22 post-merge

None of RECON3's fixes are retroactive; they only stop the defect for *future* writes. Reconfirmed live
against Dialysis_DB after the merge:
- `sales_transactions.buyer_name`/`seller_name` (`sale_id 15170`): still `'0018W00002X08eTQAR'` /
  `'0018W00002XDlmDQAT'`.
- `recorded_owners.name`/`canonical_name` (`recorded_owner_id 634c88c0-…`): still the same raw id.
- `leases.tenant` (`lease_id 16621`): still `'DaVita dialysis clinic in Succasunna'`.
- `properties.current_value_estimate`: still `10257374.40` — see part 2, this is not just "backfill
  pending", the current guard logic would not fix it even if re-run today.

**This is expected and was flagged as a TODO in the response** (blast-radius migration written but not
applied — no DB egress from that sandbox), but it means Scott's original ask — *"I want to audit and
track this property… ensure all the data is connected"* — is not yet true of the one property that
prompted this whole arc. Action: apply `supabase/migrations/dialysis/20260922150000_dia_recon3_sf_id_as_name_backfill.sql`
live (dry-run first per its own header) to clear the raw-id names fleet-wide, including property 27266's
three rows — note this CLEARS the bad names, it does not recover DaVita's/the buyer's actual name (the
migration's own header says a repair here "must REMOVE an opaque id, not add anything"); doing so requires
someone to look up the actual buyer entity from Salesforce or the closing docs and enter it manually, or
via a resolver with real SF/entity-link access this sandbox didn't have. Then either re-save property
27266's lease 16621 (or a targeted one-row fix) to trigger `isJunkTenant()` on the current bad string, or
correct it directly — the guard only fires on new/re-saved data.

### 2. `current_value_estimate`'s new overwrite guard has a logic flaw — live-verified it still won't fire on this exact property

The fix (`sidebar-pipeline.js:10381` area) added `saleIsOlder = latestDate && prop.updated_at &&
new Date(latestDate) < new Date(prop.updated_at)` and only overwrites when `priceDiffers && !saleIsOlder`.
**`properties.updated_at` is a general last-modified timestamp, touched by every write path that ever
touches the row — not a timestamp specific to when `current_value_estimate` was last set.** Verified
live: property 27266's `updated_at` is `2026-09-22 14:46:09 UTC` (today, after the PR merged — likely a
routine reconciliation or enrichment touch, not a valuation write), while the sale closed `2026-09-09`.
Since `latestDate (09-09) < prop.updated_at (09-22)` is true, `saleIsOlder` evaluates `true`, so the
guard's `!saleIsOlder` is `false`, and the overwrite never fires — **exactly reproducing the original
bug on the exact property this fix was written for.** This will affect nearly every property in the
fleet, since routine background writers (`DIA-PROPAGATOR1`'s scheduler, HCRIS propagation, sidebar
sends) touch `properties.updated_at` far more often than a sale closes, so almost any past sale will
read as "older than `updated_at`" regardless of when the estimate was actually calculated.

**Action:** replace the `updated_at`-as-proxy heuristic. Either (a) always prefer a closed sale over a
modeled estimate unconditionally (the response's own docx floated this as the more likely reading of
Scott's "Est. value is clearly miscalculated" comment — drop the "current estimate" concept once
`SOLD` and show the sale price instead), or (b) add a real `current_value_estimate_source`/
`_updated_at` column that only the valuation writer touches, so a genuine "estimate is newer than the
sale" comparison becomes possible. Re-verify against property 27266 live after the fix — this is the
same cheap live-egress check that caught the flaw here.

## Still open from the original 7-item prompt, unchanged

- **Part (a)** — the exact SF write path for sale 15170 specifically was not pinpointed; RECON3 fixed
  the shared choke points instead (a broader, arguably better fix per the "no one-off reconciler"
  instruction, but the specific "how did THIS sale get written wrong" question is still unanswered).
- **Part (b)** — blast radius across the fleet (Dialysis_DB + government) still not measured; the
  migration's detector view (`v_dia_recon3_sf_id_as_name`) can answer this the moment it's applied —
  run it dry-run first and report the count before clearing anything.
- **Part (d)** — the two broken Documents-tab links and the missing ShareFile diligence files were not
  touched at all in this round.
- **Export gate determinism** — `_udDetectClosedSale()` only sees a closed sale if `_salesCache` is
  already populated (i.e., the Sales tab was opened this session before Export was clicked). Make it
  fetch `sales_transactions` directly instead of depending on tab-visit order, per the response's own
  TODO.

⛔ Same instruction as the original prompt: no one-off reconciler for this one property — RECON2's
`reconcile_property()` is still the eventual home for the backfill/repair logic here.
