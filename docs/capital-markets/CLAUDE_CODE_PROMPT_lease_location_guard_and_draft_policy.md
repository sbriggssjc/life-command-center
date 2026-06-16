# Claude Code prompt — location-agreement guard (premises vs corporate-notice address) + draft-document policy

> The corpus lease backfill is COMPLETE and the independent end-gate passed the structural
> invariants (no dup leases/edges, no clobber, cleaned records intact, operator gate held
> on cross-operator). But the end-gate surfaced a **same-operator, wrong-LOCATION mis-match
> class** the operator gate by design cannot catch, and a **draft-document** issue. Two
> wrong-property leases were already reverted under the gate (see below). This prompt
> closes the matcher hole, sets the draft policy, and re-processes the held docs. The
> backfill drain stays DONE — do NOT re-drain the corpus until this guard deploys.

## What the end-gate found (live receipts)
1. **Corporate-notice-address collision (the mis-match class).** Ground leases / memoranda
   carry the tenant's corporate NOTICE address in their boilerplate, and the matcher
   latched onto THAT instead of the leased premises:
   - `The Villages, FL — Commencement Date Memorandum (Ground Lease)` (doc 7004) created a
     lease on property **30705 = `2000 16th St, Denver CO`, 239,632 SF — DaVita's corporate
     HEADQUARTERS**, not a clinic. (A `Gardena, CA — Second Amendment`, doc 6374, also
     resolved to 30705; the dateless guard rejected it.) Same operator (DaVita), wildly
     wrong location → operator gate can't see it. **Lease 25325 reverted.**
2. **Draft documents minted an authoritative lease.** Property **3353605 =
   `3201 S 323rd St, Federal Way WA`, 160,493 SF leased, $4,012,325/yr** was enriched
   entirely from **`/D/DaVita/Federal Way, WA/PSA/Drafts/`** redline/blackline files (docs
   19517/19522/19524/19526/19530/19541) — six UNEXECUTED drafts. 160k SF / $4M is not a
   single clinic. **Lease 25330 reverted.**
3. **Landlord-as-tenant (minor, NOT reverted).** Lease 25323 on property 22640 (real DaVita
   York PA clinic) extracted tenant `"WellSpan Properties, Inc."` (the LANDLORD). The lease
   is on the right property; only the tenant field is wrong. → Decision Center field-fix.

## Already done under the gate (do NOT redo)
- Deleted leases **25325** (dia 30705) + **25330** (dia 3353605); deleted edge
  `2ab40882…` (Davita→3353605); superseded 19 `folder_feed_lease` provenance rows for
  25325/25330 (audit trail).
- Flagged the 8 source docs (6374, 7004, 19517, 19522, 19524, 19526, 19530, 19541) with
  `subject_hint.lease_backfill_reverted=true` and **kept `lease_backfilled_at` set** so they
  stay OUT of the eligible queue until this guard deploys.

## Unit 1 — location-agreement guard (the primary fix)
Mirror the operator-gate philosophy at the match boundary, for domain lease enrich. The
simplest robust signal is **city/state agreement**:
- After a `matched` resolve, before any write, require the matched property's `city/state`
  to AGREE with the doc's location anchor — `subject_hint.city/state` (the folder anchor,
  e.g. "The Villages, FL") and/or the premises address the extractor pulled.
- On a clear disagreement (FL doc → CO property), do NOT enrich/create → route to the
  existing `match_disambiguation` lane (a distinct reason, e.g. `location_mismatch`).
  Conservative, same as the operator gate: agreement OR unknown-on-either-side passes;
  only a clear contradiction blocks; never blocks a normal correctly-located lease.
- Deeper root cause (do this too if tractable): when extracting the address to MATCH on,
  prefer the **demised/leased-premises** address over the **notice/"address for notices"/
  corporate** address block, and reject a match to a property that is the tenant's known
  corporate HQ. The city/state guard is the safety net; premises-address preference is the
  cure.

## Unit 2 — draft-document policy
A doc whose path contains a `/Drafts/` segment or whose filename matches
`blackline|redline|\bdraft\b|changed pages|v ?\d+` is UNEXECUTED and must NOT mint an
authoritative lease:
- Classify it terminal (e.g. `draft_not_executed`, queryable on the marker), no
  create/enrich — OR at most a low-confidence/needs-review note, never an authoritative
  `data_source='folder_feed_lease'` row. (Match the existing deterministic-terminal
  pattern; reuse `isMultiTenantDealFolderPath`-style segment matching.)
- Whole-segment / anchored matching so a legitimately-named executed file isn't caught.

## Unit 3 — re-process the held docs (after Units 1-2 deploy)
The 8 flagged docs are held (`lease_backfill_reverted=true`, still marked). After the guard
is deployed and I've gate-verified it on a synthetic FL-doc→CO-property case:
- Reset their markers (clear `lease_backfilled_at` + `lease_backfill*`) and re-drain.
- Expected: the FL/Gardena memoranda → `location_mismatch` → `match_disambiguation` (NO
  write to 30705); the Federal Way drafts → `draft_not_executed` (no write to 3353605).
  None should re-create a lease on the wrong/HQ/non-clinic property.

## Unit 4 — Decision Center data-quality rows (surface, don't bury)
Open rows for: 30680 phantom address (`1221 S Capitol` vs CMS `1450 Kooser Rd`); stray
`medicare_clinics 552652 → property 30680` `property_id` mis-link; **30705 = DaVita HQ
mis-ingested into the dia clinic book**; **3353605 = 160k SF non-clinic** (verify it's a
real DaVita facility vs a mis-ingestion); 25323 landlord-as-tenant (`WellSpan` → should be
DaVita) on property 22640.

## Guardrails
- Receipts-first; ≤12 api/*.js; reuse the matcher + `match_disambiguation` + the deterministic-
  terminal pattern; don't fork. Tests: FL-doc→CO-property → `location_mismatch`; draft file →
  `draft_not_executed`; a correctly-located executed lease still enriches (no false positive).
- Don't touch the cleaned/ reverted records (dia 25312/19530/14365; the superseded provenance
  incl. 25325/25330; canonical `guaranteed_by` edges). The corpus drain stays DONE until the
  guard is verified live.
