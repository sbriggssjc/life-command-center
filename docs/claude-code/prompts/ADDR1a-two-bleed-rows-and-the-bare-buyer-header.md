# ADDR1a — disposition the two open address-bleed rows, and check whether a bare `Buyer` header is a still-open path

**Repo: `life-command-center`.** Target **Dialysis_DB `zqzrriwuavgrquhisnoa`**; check the mirror on
**gov `scknotsqkcheojiaewwh`**. **Small: one merge, one quarantine, and one regex question that
decides whether the class is actually closed.** Both rows are already identified — this is
disposition plus one measurement, not a re-investigation.

**Read first:** `docs/claude-code/STATUS.md` 2026-09-03 ADDR1 entry and 2026-09-04 ADDR1a section →
backlog **ADDR1a** → the ADDR1 migration
`supabase/migrations/dialysis/20260903200000_dia_addr1_contact_office_address_bleed_review_and_repair.sql`
(both dispositions are precedents there: 37491 merged, 50990 quarantined) →
`extension/content/costar.js` `FOREIGN_PARTY_HEADER_RE` / `isInsideForeignAddressSection` /
`findAddressInLines`.

## The two rows, already identified — verify, then act

`v_dia_contact_office_address_bleed_review` holds exactly 2 rows. **They need DIFFERENT actions**,
and getting that wrong is the whole risk (50990 was nearly merged as a duplicate and is a real
property).

| id | bled street | contact | disposition |
|---|---|---|---|
| **37503** | `3121 Michelson Dr, Suite 500` / Kokomo IN 46902 | IRA Capital, LLC (Irvine CA), role `buyer` | **MERGE into 38953** |
| **37783** | `4700 Wilshire Blvd` / Oakland CA 94607 | CIM Group, LP (Los Angeles), role `buyer` | **QUARANTINE** |

- **37503 is a phantom duplicate of 38953** `2312-2330 S Dixon Rd, Kokomo, IN` — identical
  `building_size` 10,603.00, identical operator (Fresenius) and tenant (Fresenius Medical Care),
  identical `updated_at`. **The real street already exists in the table.** Confirm those four
  identities yourself before merging, then use the EXISTING reversible
  `dia_merge_property_reversible(38953, 37503, '<batch tag>')` — it walks every FK and snapshots the
  dropped row, exactly as ADDR1 did for 37491 → 35722. ⚠️ **Check what is attached first** (37503 has
  1 sale + 1 listing): as with 37491, that attached history is probably 38953's own and must come
  home, not be deleted with the shell. Report what moved.
- **37783 has NO stat twin in Oakland** (`building_size` NULL, no matching property). Treat it as the
  **50990 case**: a real Satellite Healthcare property that lost its own street. **Null the address
  with the original preserved in `notes` and `address_source='addr1_quarantined_contact_bleed'`;
  leave city/state/zip alone.** Do not guess a street, do not merge. ⚠️ **If you find evidence it IS
  a duplicate, say so and merge instead — but the absence of a twin is not proof of a real property
  either.** State which reading the evidence supports.

## The measurement that decides whether ADDR1 is actually closed

**Both bleeds came from a `buyer`-role contact, and `FOREIGN_PARTY_HEADER_RE` matches
`recorded\s+buyer` and `true\s+buyer` — not a bare `Buyer`.** ADDR1 widened the regex with
`Sales Company` / `Sales Contacts` / `Listing Contacts` / `Property Manager`, which covers the
Contacts tab's Sales Company block — but if CoStar renders a buyer block under a plain `Buyer`,
`Purchaser`, `Bought By` or similar heading, **the class is not closed and a re-capture can
re-open it.**

1. **What literal header text precedes a buyer/party address block on a CoStar property page?**
   Answer from evidence, not assumption: the two rows' own capture payloads
   (`staged_intake_extractions` / the entity metadata for those properties), any stored HTML, or the
   sale/party section of a current capture. **If you cannot establish it from stored data, say so
   and ask Scott for one screenshot of the Sale/Owner tab** rather than widening the regex on a guess.
2. **If a bare header is confirmed:** widen `FOREIGN_PARTY_HEADER_RE` with the exact tokens found —
   anchored the way the existing alternations are — and extend
   `test/addr1-costar-foreign-party-header.test.mjs` with a fixture built from the real page shape.
   ⚠️ **Do not widen it speculatively.** A header regex that matches too much starts rejecting the
   subject property's own address block, which fails silently in the opposite direction (no address
   captured at all).
3. **Both rows predate the fix (last written 2026-09-01, fix landed 09-03)** — so their existence is
   not itself evidence the path is still open. Say which conclusion the header evidence supports.

## Also

- **gov's mirror view is applied but has no repair half and its instance count is unmeasured.**
  Run `select count(*) from v_gov_contact_office_address_bleed_review` and report. If it is non-zero,
  size and classify it — do not repair in this prompt.
- The server-side belt (`api/_shared/contact-address-bleed-guard.js` in `upsertDomainProperty`)
  catches this independently of the client regex. **Check whether it would have caught these two** —
  if yes, the belt is the real closure and the regex question is secondary; if no, say why.

## Verify on

- 37503: merged, backup row present, what moved to 38953 (sale/listing counts before and after),
  reversal statement quoted.
- 37783: address NULL, original in `notes`, city/state/zip unchanged, `address_source` set.
- `v_dia_contact_office_address_bleed_review` → 0 (or the residue named).
- The header question answered with evidence, and the regex widened only if the evidence says so.
- gov's count, reported.

## What NOT to do

- Do not merge 37783 without evidence. Do not guess a street for it. Do not widen the regex on
  assumption. Do not bulk-repair anything the view finds later — it is a review lane by design.

## Report back

Both dispositions with their evidence · what moved in the merge · the header verdict and whether the
regex changed · the belt's coverage of these two · gov's count · anything that outranks this.
