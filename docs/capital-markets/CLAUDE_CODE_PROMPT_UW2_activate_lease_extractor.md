# Claude Code prompt — UW#2: activate the lease-document extractor (the doc-only fields)

> From the underwriting data-quality audit. The lease ECONOMICS that aren't in a public feed —
> escalation %, guarantor, renewal terms, expiration, expense structure — are absent precisely
> because they live in the lease PDFs we already hold in SharePoint. The Stage B lease extractor is
> BUILT and PAUSED (per CLAUDE.md "Widen — still PAUSED ... until Scott blesses the widen"). Scott
> has now blessed it. Activate it the disciplined way: capped → gate → drain. Receipts-first;
> fill-blanks only; provenance-gated; every Stage B guard in force.

## Grounding (live, 2026-06-20)
- dia active leases (n=6,591; only ~54% of properties even have one): escalation_% **2%**,
  guarantor **5%**, renewal_options 15%, lease_expiration 61%, annual_rent 59%, expense_structure 61%.
- gov leases (n=11,377, GSA feed strong on rent/term): renewal_options **5%**, expense_structure 39%.
- These are document-only fields. The extractor + Stage B Unit-1 fix (lease-less-property create +
  no-orphan-guarantor gate) are merged; the location-agreement guard + draft-document policy
  (Stage B 2026-06-16) are in force.

## Activate
1. **Auto-route `detected_type='lease'`** folder-feed docs through the lease extractor (the paused
   widen): the crawler stages a recognized lease PDF → the extractor fills the lease-economics
   fields on the matched property's active lease (creating the lease row if none, per the Unit-1
   fix). Plus the `property_financials` leg if that was part of the paused widen.
2. **Capped first** — run a CAPPED drain (e.g. 25 docs) as a DRY-RUN, then a capped REAL drain, on
   ONE property folder / a small batch. Report to the gate: fields filled, leases created vs
   patched, guarantor edges formed, provenance rows, and zero wrong-property / draft / HQ writes
   (the location + draft guards must hold). Only after the gate → broad drain.
3. **Guards that MUST hold** (do not bypass): location-agreement (folder-anchor city/state vs
   property — block a wrong-location match to disambiguation, never a wrong-property write);
   draft-document policy (a `/Drafts/` or blackline/redline/vN file is `draft_not_executed`, never
   an authoritative lease); operator-family gate; one-active-lease-per-property dedupe; fill-blanks
   only; provenance `source='folder_feed_lease'` gated (conflicts → Decision Center, no clobber).

## Boundaries / gate
- Fill-blanks only; provenance-gated; reversible; ≤12 api/*.js. Don't fabricate — a field the doc
  doesn't state stays blank. Capped → gate → broad drain (the corpus-backfill discipline).
- My gate: capped dry-run + real drain on one batch shows escalation/guarantor/renewal/expiration/
  expense filled from real lease PDFs, leases created where absent without orphaning a guarantor,
  every guard held (0 wrong-property / draft / HQ writes), provenance written, idempotent. Then the
  broad drain lifts dia escalation/guarantor/renewal off the floor.
