# OM/BOV master-sheet assembly-readiness audit (2026-06-21)

> Audit #34. The Master Sheet feeds both the OM and the BOV. Question: for a property you'd take to
> market, can we assemble a complete master sheet from CURRENT data? Measured per-property section
> completeness (identity / lease economics / financials / owner / escalation / demand) across both
> DBs, live. Receipts, not the opaque `completeness_score`.

## Section coverage (active properties)
| Section (what the master sheet needs) | gov (n=12,562) | dia (n=12,279) |
|---|---|---|
| **Identity** (address, city, RBA/SF) | 91% | 72% |
| **Lease economics** (rent + expiration + term) | 78% | **32%** |
| **Financials** (NOI / revenue model) | 87% | 55% |
| **Owner** (true/recorded owner) | 71% | 84% |
| **Escalation %** | **35%** | **1%** |
| **Demand** (agency / patient count) | 77% | 58% |
| **CORE-ready** (identity+lease+financials+owner) | **60%** | **19%** |
| **FULL** (core + escalation + demand) | 21% | 17% |

## What this says
- **gov: a solid core master sheet assembles for ~60% of properties** (the GSA lease feed makes
  lease/financials strong). The *complete* deliverable is only ~21% — the binding constraint is
  **escalations (35%)**, then owner completeness (71%) and the demand narrative. Escalations come
  from the lease document, so this is the UW#2/UW#6 lease-doc + OCR lever.
- **dia: only ~19% are core-ready, and the killer is lease economics — 32%.** Only a third of dia
  clinics have an active lease carrying both rent and expiration; escalations are ~1%. For most dia
  properties the master sheet **cannot be assembled from current data** because the lease terms
  aren't in the DB. Financials (55%, the revenue model) and identity (72%, missing building_size)
  are secondary drags.

## The structural reality (consistent with the Part 2 meta-finding)
The bulk numbers understate **per-deal** readiness. The lease-doc feed only covers Briggs's active
deal book (a few hundred properties), not the 12k+ universe — so the global lease-economics gap
(dia 32%) is **not bulk-fixable**; for a specific deal you're working, the lease terms come from
CoStar / the lease doc captured at deal time (which the lease/deed capture pipeline + the
work-product framework support). So:
- **gov master sheets are largely assemblable today** (~60% core, higher on the worked deal book).
- **dia master sheets are a per-deal assembly** — pull the lease from CoStar/the doc when the deal
  is worked; the bulk DB won't carry it.

## Implications for wiring the work products
1. **The master-sheet generator should assemble the available sections and explicitly FLAG the
   missing ones** (escalation, owner, developer, demand) so the analyst knows exactly what to fill
   from CoStar per-deal — rather than silently shipping an incomplete sheet. The conflict/provenance
   discipline already in place supports showing "present vs needs-research" per field.
2. **Highest-leverage gap-closers** (already in flight): escalations → UW#2 lease-doc + UW#4/#6 OCR;
   owner/developer → UW#7 + the connectivity work; dia financials → the revenue-model coverage.
3. **Sequence the build to the deal book, not the bulk.** Wire OM/BOV generation for the worked-deal
   subset (listed / actively-prospected properties), where per-deal enrichment makes the sheet
   complete, rather than waiting for bulk coverage that the data can't reach.

## Bottom line
Yes for gov (core ~60%, deliverable today with gap-flags); per-deal for dia (lease economics must be
captured at deal time — bulk readiness is ~19% and structurally capped). The master-sheet generator
should be built to assemble-what-exists + flag-what's-missing, scoped to the active deal book first.
