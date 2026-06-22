# Claude Code — R59: propagate document-extraction into the BD spine (deed/lease)

## Why (live propagation audit, 2026-06-22 — see PROPAGATION_GAP_AUDIT_2026-06-22.md)
Document AI OCR is live (UW#4c) + the thin-text lease gate (UW#5) + narrative deed parser
(R58c), so deeds/leases now yield rich structured data at scale. But the extraction LANDS
without UPDATING the rest of the system. Grounded on a real $13.3M transfer — deed doc 3964
→ dia property 24703 (grantor *Oldsmar Retail Development LLC* → grantee *Deltona Wellness,
LP*, 2020-01-21): the matching sale (14751) has `buyer_name`/`seller_name` = NULL, the
property has 0 `ownership_history` rows, no prospect for the new owner, and no research
prompt. R59 closes those gaps. Four units, all additive / fill-blanks / append-only /
reversible / gated, reusing existing machinery (R5 buyer cohort, R6 chain, R51 owner
conflict, R53 suspected sale, the research-task producers). ≤12 api/*.js; no clobber of
curated data; dia + gov both handled; no fabrication.

**House rules (unchanged from the round doctrine):** effect-first / outcome-truthful;
guards reused (`granteeIsPlausible`/`granteePassesOwnerGuards`, `isImplausiblePersonName`,
`isJunkEntityName`, `isFederalOwnerAntiPattern`, broker filter); per-domain PK/schema
handled (dia sale_id int / gov uuid; the two DBs' `ownership_history` schemas DIFFER —
ground both, see Unit 1); idempotent (never spam duplicate rows/tasks); JS ships on the
Railway redeploy; any new domain write goes through the field-priority/provenance gate where
one exists.

All four units hang off the SAME confident deed→sale/property match already resolved inside
`processDeedDocument` / `crossReferenceDeed` (`api/_handlers/deed-parser.js`). Resolve once,
then fan out.

---

## Unit 1 — deed buyer/seller → sale row, + ownership_history event  *(HIGH, do first)*
On a confident deed match (the existing `crossReferenceDeed` price-match path):

**(a) Fill the sale's parties (fill-blanks, never clobber).** PATCH the matching
`sales_transactions` row's `buyer_name` from `parsed.grantee` and `seller_name` from
`parsed.grantor`, guarded on `buyer_name=is.null` / `seller_name=is.null` respectively
(per-column PostgREST guard, like the R51 implied-price `sold_price=is.null` pattern).
Run each name through the existing guards (`granteePassesOwnerGuards` for both grantee and
grantor — it rejects brokerage/federal/junk; do NOT use `isImplausiblePersonName`, it rejects
LLCs). The deed is the authoritative party source and feeds the R5 buyer-cohort machinery,
so this is high-value comp data. dia sale_id int / gov uuid — key correctly.

**(b) Append an `ownership_history` event.** A recorded deed is the canonical ownership
change. Append one row per (property, transfer) — **GROUND THE PER-DOMAIN SCHEMA FIRST, they
differ:**
- dia `ownership_history`: `property_id`, `recorded_owner_id`(uuid)/`true_owner_id`(uuid),
  `start_date`/`ownership_start`, `sale_id`(bigint), `sold_price`, `ownership_source`,
  `acquisition_method`, `ownership_state` (**NOT NULL** — set e.g. `'active'`), `notes`.
- gov `ownership_history` (per CLAUDE.md R8/R53): carries `change_type` / `data_source` /
  `ownership_state` — verify columns live before writing.
Set the grantee as the new owner (resolve/create `recorded_owners` for the grantee name,
reuse R51's resolver), `acquisition_method`/`change_type`='deed' (use each domain's allowed
vocab — gov's is CHECK-constrained, ride `data_source='deed_extraction'` + actor context the
way R53's `gov_apply_manual_true_owner` does), `start_date`=deed recording date,
`sale_id`=the matched sale when present, `sold_price`/`notes` from the deed. **Append-only +
idempotent**: dedup on `(property_id, acquisition_method/change_type='deed',
start_date, grantee)` so a re-parse doesn't double-insert. Do NOT mutate
`properties.recorded_owner_id` (that stays R51-gated). Set/relate `ownership_state` so the
new event doesn't violate any existing one-active-owner invariant — if unsure, append as the
recorded event without flipping prior rows and surface via R51, rather than guessing a
supersede.

Verify: 24703 gets `buyer_name='Deltona Wellness, LP'` / `seller_name='Oldsmar Retail
Development LLC'` on sale 14751 (both were NULL) + one `ownership_history` row; a re-parse is
a no-op (no dup); a deed whose grantee fails the guards writes neither.

## Unit 2 — deed transfer WITHOUT a matching sale → suspected-sale lane  *(MED)*
When the deed has a price + date but `crossReferenceDeed` finds NO matching
`sales_transactions` row, the transfer is currently dropped. Do NOT auto-create a sale (a
deed can be a refi / intra-family / correction). Instead:
- **gov:** feed the R53 `suspected_sale` lane — open `lcc_open_decision('suspected_sale', …)`
  / route to `gov_confirm_suspected_sale` (operator-confirmed price, the existing
  service-role-gated path). Reuse R53 verbatim; do not fork.
- **dia:** R53 is gov-only. Open a research task (Unit 4 type `confirm_deed_transfer_sale`)
  rather than inventing a dia suspected-sale lane this round.
Idempotent on the deed/property. Surface, don't write a sale.

## Unit 3 — deed grantee → BD entity / prospect  *(MED-HIGH)*
A grantee acquiring the asset is a BD signal but today only lands as the `latest_deed_grantee`
name string. Resolve the grantee to an LCC **entity** via the existing `ensureEntityLink`
(domain `dia`/`gov`, it applies the junk/implausible/federal guards and the email/name
dedup), link it to the asset (the `owns`/`purchases` edge the R5/R6 machinery reads), and
enter the BD path: prefer the R5/R6 owner-resolution flow (so a repeat-buyer SPE rolls to its
parent and a genuine new owner becomes prospectable) over minting a raw prospect. Reuse
`lcc_resolve_buyer_parent` / the R51 owner-conflict path; do NOT create a `type='prospect'`
opportunity for a buyer SPE (the R5 gate forbids it — let the gate handle it). Best-effort,
reversible (the identity link + edge); compounds owner→entity coverage every deed.

## Unit 4 — research-task triggers from deed + lease  *(MED)*
Open a `research_task` (reuse `createResearchTask` / the existing producer pattern;
value-ranked, idempotent, gated like the other producers) on the clear triggers:
- **deed:** grantee is an unfamiliar private LLC that doesn't resolve to a known parent
  (`trace_grantee_to_parent`); a deed transfer with no sale (Unit 2 dia path —
  `confirm_deed_transfer_sale`).
- **lease:** extracted tenant ≠ the property's recorded tenant (`confirm_tenant_mismatch`);
  a guarantor name that doesn't resolve / fails guards (`resolve_lease_guarantor`).
Each task carries the doc id + property id + the specific fact; idempotent on
`(research_type, property_id)` so the */30 re-parse / re-tick doesn't spam. No task when the
fact resolves cleanly.

---

## Verify (report back)
- Unit 1: live (or test-fixture) on 24703 — buyer/seller filled fill-blanks (no clobber of a
  populated row), ownership_history appended once, re-parse no-op, guard rejects a
  broker/federal grantee. Both domains' schemas handled.
- Unit 2: a synthetic gov deed-with-price-no-sale opens exactly one `suspected_sale`
  decision (idempotent); dia path opens the research task; neither writes a sales row.
- Unit 3: a synthetic grantee resolves to an entity + asset edge; a buyer-SPE grantee is
  NOT given a prospect opp (R5 gate holds); junk grantee writes nothing.
- Unit 4: each trigger opens one idempotent research task; a clean fact opens none.
- `node --check`; `ls api/*.js | wc -l` = 12; full suite green. Reversibility: every write is
  fill-blanks/append-only/identity-link — document the revert (delete the appended rows /
  null the filled blanks by source tag `deed_extraction`).

## Bottom line
The OCR unlock now lands grantor/grantee/price/term/guarantor at scale; R59 makes that data
actually move the system — sale parties filled, ownership timeline recorded, new owners
entering the BD spine, and the operator prompted to research the ambiguous cases — all
additive, gated, and reusing the R5/R6/R51/R53 machinery already in place.
