# Claude Code — R15 Phase 2c: CRE owner extraction quality (label-as-owner + tenant-as-owner)

## Status (grounded live 2026-06-13, after Phase 2b deployed)
Phase 2b's infra works: the constraint allows `cre`, owners mint, the cross-domain
reuse RPC is live, and owner-vs-tenant improved (HUB Group now resolves to "Agarita
Management Company", not the trucking tenant). But a live drain of the first 10
resolved owners shows the EXTRACTION is still too dirty to deliver the payoff
(`v_lcc_cre_cross_asset_owners` = 0). Two quality bugs, both minting bad owners:

### Bug 1 — the master-sheet scan returns LABEL cells as owners
Of 10 resolved owners, three were field LABELS, not owners: **"Ownership", "Seller",
"L. BROKER"**. The xlsx label scan finds the label cell but the adjacent value is
empty (Briggs underwriting master sheets often leave owner blank) OR the scan returns
the label itself. It must:
- When the matched label's adjacent value is empty / whitespace / another known
  label → return **null** (no owner), never the label.
- Never return a value that is itself a field label (`Ownership`, `Owner`, `Seller`,
  `Buyer`, `Recorded Owner`, `True Owner`, `Landlord`, `Developer`, `L. BROKER`,
  `P. BROKER`, `Broker`, `Tenant`, `Lessee`) — these are header/label cells, not
  data.
(Cleaned up live: I nulled + deleted the 3 label-garbage entities. They'll re-scan;
this fix must make the re-scan return null instead of re-minting them.)

### Bug 2 — tenant still leaks in as owner (scan path)
"Mavis Discount Tire" (the TENANT, "Mavis Tire") was minted as the owner. Phase 2b
added the tenant-vs-owner guard to the AI/pdf prompt, but the **xlsx scan path**
doesn't apply it. Thread `tenant_brand` into the master-sheet scan too: if the
scanned owner value equals (or is contained in / contains) the folder `tenant_brand`,
reject it as the tenant, return null. Same negative-signal logic as the AI path.

### The reject guard belongs at the shared mint boundary
Add a **field-label / tenant reject** to `ensureCreOwnerEntity` (or a shared
`isImplausibleOwnerName(name, {tenantBrand})` used by both the scan and AI paths) so
NO extraction path — present or future — can mint a label or the tenant as an owner.
The existing `isJunkEntityName` only catches phone/email patterns, so these passed;
this is the owner-specific complement. Anchored exact-ish on the label words (so a
real owner like "Seller Properties LLC" isn't false-rejected — reject bare
"Seller", not "Seller Properties LLC").

## Re-process the dirty rows
After the fix, the cleaned rows (Anthony Machine / Avadyne / AMF Bowling, now
owner-null) re-run on the next cron tick. Also null + re-queue "Mavis Discount Tire"
(tenant-as-owner) so it re-extracts. A property where every doc yields only a
label/tenant → `owner_scan_exhausted` (don't churn).

## Don't break / boundaries
- dia/gov untouched; cross-domain REUSE (Phase 2b) unchanged — this only tightens
  what counts as a valid owner NAME before mint/reuse.
- Conservative: reject only bare labels + the exact tenant; never reject a plausible
  firm name that merely contains a label word as a token.
- Still no scoring.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Tests: scan returns null on
empty-adjacent / label-value cells; `isImplausibleOwnerName` rejects bare
"Ownership"/"Seller"/"L. BROKER" + the folder tenant, accepts "Agarita Management
Company"/"Wallace Properties, Inc."; the AI path still rejects tenant-only docs.

## After deploy (Cowork verifies live)
- Re-drain; resolved owners are real owners only (no labels, no tenants); the
  garbage count drops to 0.
- As clean owners accumulate, `v_lcc_cre_cross_asset_owners` finally returns real
  cross-asset owners (a CRE owner that also holds dia/gov). That remains the payoff.

## Strategic note for Scott (worth a decision)
This is the 4th CRE-owner iteration (Phase 1 → 2 → 2b → 2c), and the headline payoff
(the overlap view) is still 0 — each pass uncovers another doc-extraction quality
issue, which is the nature of pulling owners from messy, inconsistent broker docs.
The registry's OTHER value is already delivered and solid: the office/retail/childcare/
urgent-care/dental book is now CAPTURED (41 properties and climbing) with docs
attached — that's the relationship/searchability win. The OWNER-overlap payoff is a
separate, open-ended extraction-quality grind. Three honest paths:
1. **Ship 2c and keep iterating** — chase clean owner extraction until the overlap
   lights up (this prompt).
2. **Let the cron grind, accept imperfect owners, revisit later** — the infra's
   there; owners fill in best-effort; spot-fix quality when it matters for a real
   deal.
3. **Call the registry "captured + connected" as the win** and treat owner
   extraction as best-effort background, not a build target.
My read: do 2c (the bugs are concrete and cheap), then shift to path 2 — stop
purpose-building owner extraction and let it accrue, because the marginal doc-format
edge cases have diminishing returns vs. the capture value already banked.
