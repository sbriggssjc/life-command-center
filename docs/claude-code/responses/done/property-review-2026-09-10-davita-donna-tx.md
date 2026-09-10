# Scott's property-reconciliation walkthrough — DaVita Kidney Care, Donna, TX (2026-09-10)

Source: Scott's uploaded `.docx` ("LCC property reconciliation and data driving"), 9 embedded
screenshots + narrative. Transcribed narrative below; screenshot contents summarized inline (the
originals were images, not extractable text). Triaged into `docs/os/PLANNED-BACKLOG.md` §P17
(PDR1–PDR11) the same day — see `STATUS.md` 2026-09-10 for the live-DB investigation and root-cause
finding.

## Scott's narrative (as written)

One of the other things I have noticed in operating in the LCC app is that the properties in each
swimlane appear to be disconnected and disjointed from the database depending on their initial
source. Propagation and reconciliation and driving toward the most accurate truth on the history and
current status of each property appears to be lacking. I walked through a handful of screenshots on
one example here.

**Screenshot 1 (Overview/listing card).** A DaVita clinic in Donna, Texas, clicked from the first
page of the dialysis listings. This one stood out because Scott sold it in 2017-18 shortly after it
was built — the app should have robust data including all due-diligence files in the shared Team
Briggs Properties folder and the deal/listing history in Salesforce. Currently listed by a broker in
the Northmarq Chicago office who was the procuring broker on the original sale. Should have a robust
listing/price history plus ownership, sales history, and an accurate rent roll.

**Screenshot 2 (data-resolution status panel).** The page prompts the user to pull most of this data
manually. "This should be automatically resolving on its own, proactively."

**Screenshot 3 (Rent Roll tab).** Rent increases and history look inaccurate — flat, no escalation.
Dates seem accurate but should be confirmed against the Team Briggs shared folder.

**Screenshot 4 (Operations tab, top).** The clinic was not linked to a Medicare/CMS clinic even
though there was only one CMS facility at the same address — Scott had to manually link them. All
data sources should reconcile and drive back to the property level, creating a new property or
connecting to an existing one and updating data per the established source-quality hierarchy.

**Screenshot 5 (Operations tab, competitive landscape).** Two competitive-landscape categories shown.
Requested: also show rents for those competitor clinics for a quick rent/SF comparison and a property
financials comparison — even just a couple of graphics and an average would help. High-level on the
tab, more detail in the exported version.

**Screenshot 6 (Deal History tab).** Does not show price adjustments; missing prior sales, listings,
and ownership history for the property.

**Screenshot 7 (Ownership tab).** No owners shown despite the data existing internally across many
sources. The middle section shows the operator as the owner, which is inaccurate.

**Screenshot 8 (Documents tab).** Nothing linked, despite the team having many documents including
the most recent OM.

**Screenshot 9 (Activity Log tab).** Only the one current listing-for-sale event shown.

**Scott's closing framing:** we need to be reconciling all the data against everything we have and
know, linking and comparing sources, so we have a robust and accurate view of the history and current
status of each property in each swimlane. Either there are multiple DaVita records in Donna, Texas
for this one property that need to be automatically merged/consolidated/reconciled, or the app isn't
fully connecting and ingesting data from the sources it was designed to use. Investigate and triage,
catalog all errors, and systematically work through each with documentation, plans, next steps,
architectural improvements, connections, and designs.

## What the live-DB investigation found (2026-09-10)

Both of Scott's hypotheses are true, and share one root cause. See `PLANNED-BACKLOG.md` §P17 for the
full, ranked catalog (PDR1–PDR11) and `STATUS.md` 2026-09-10 for the investigation summary.
