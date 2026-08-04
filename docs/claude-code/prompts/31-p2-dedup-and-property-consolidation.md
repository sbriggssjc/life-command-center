# Prompt 31 — Data-integrity P2: property-record consolidation + multi-source sale reconciliation (NOT "delete repeat sales")

## Why the dups persist (investigated 2026-08-04, Dialysis_DB)
Of 610 duplicate-property live-sold groups (967 excess rows): **497 (81%) are >2yr apart = GENUINE REPEAT SALES**
(keep them; existing dedup on address|state|sale_date correctly leaves them). **0** same-date multi-source. The
REAL dups: **93 buildings have >1 property_id** (resolver missed them) + a subset of **214 multi-source groups**
(same sale from CoStar+SF+CMS, mis-dated). So P2 = property-record consolidation + multi-source same-event
reconciliation, NOT deleting repeat sales.

## Task (dry-run first, backup table, conservative match, review lane, NEVER hard-delete, provenance-tagged, idempotent)
1. Consolidate the 93 same-address/different-property_id buildings via the resolver + property-merge (mirror
   lcc_merge_entity: move sales/leases/listings/identities to the winner; reversible backup + batch_tag; auto-merge
   high-confidence only; ambiguous → review lane).
2. Reconcile multi-source SAME-EVENT sales (subset of 214): 2+ rows for one property, near-equal price+buyer, short
   window, different source/date → collapse to one canonical (best per field_source_priority), tag others
   `superseded` (not deleted). EXCLUDE genuine repeat sales (>~1yr apart, materially different price).
3. Comp pull already selects most-recent-per-property for appraisal (prompt 29) — verify; sale-history view exposes
   the rest on request.
4. Prevent recurrence: tighten ingest-time linkage so a new sale/listing attaches to the existing property_id.
5. Apply the same to gov.

## Verify
93 building dups → one canonical property each (reversible, backup present); repeat sales distinct; same-event
multi-source collapses to one + superseded; dry-run report with confidence+evidence before any write; no fabricated
merges.

## Ollama cleaning-agent — see prompt 32 (assist layer, not the primary dedup engine).
