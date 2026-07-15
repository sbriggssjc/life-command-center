# Claude Code (government-lease + dia + LCC) — ORE Phase A1: capture the assessor mailing address (the no-credential unlock)

## Why (grounded live 2026-07-14)

Full audit: `audit/data-flow-2026-05-30/OWNERSHIP_RESOLUTION_ENGINE_authoritative_source_audit_2026-07-14.md`.
Short version: the owner **entities + names** are well-covered from authoritative
sources, but the **notice addresses are absent** — the county assessor scraper fetches
parcels (gov `parcel_records` = 9,541 with `owner_name`) but **captured `mailing_address`
on only 7 rows**. It's already hitting the assessor sites; it just never grabbed the
mailing-address column. This is the cheapest authoritative owner notice-address source
and needs **no new credentials** — do it first.

## The build

**1. Capture `mailing_address` in the parcel scraper (gov repo `county_scraper` /
parcel ingest, + dia if it has the equivalent).** The assessor detail pages expose the
owner MAILING address (distinct from the situs/property address). Add it to the
per-parcel parse and write it to `parcel_records.mailing_address` (the column already
exists on gov). Keep the existing owner_name capture. Idempotent on the existing dedup
(`data_hash`/apn). Re-run the scraper over the ~9,541 already-fetched parcels (they
have `source_url`) to backfill the column.

**2. Promote `parcel_records.mailing_address` → the property's `recorded_owner`
(fill-blanks, authoritative).** There is **no property↔parcel FK today** — match parcel
→ property on normalized **situs address + state** (and APN where available), the same
matcher used elsewhere. For a confident match, fill the property's `recorded_owner`
mailing address (gov `recorded_owners.mailing_address`; dia
`recorded_owners.address/city/state`) **fill-blanks only**, provenance
`source='county_records'` at its existing `field_source_priority` rank (county=10,
above aggregators). Never overwrite a curated/manual address. Reversible.

**3. Guardrails (reuse existing).** Run the owner NAME through the existing junk /
federal-anti-pattern / implausible guards before creating or writing an owner (an
assessor "owner_name" can be a government body or a garbled string). A guard-failed row
writes nothing. No new owner entity is minted here — this fills the address on the
**existing** recorded_owner; only resolve/create if the parcel owner_name confidently
matches and the property has none (rare — 0 GSA-lessor props lack an owner, but some
non-GSA props do).

## Boundaries / verify

- gov repo (`county_scraper` + parcel ingest + a promote step) + dia parallel + the
  LCC/domain provenance write. Additive + fill-blanks + reversible; no paid API (public
  assessor pages). ≤12 api/*.js on the LCC side (this is domain-repo scraper work +
  a promote migration/worker).
- **Verify:** after the scraper re-run, `parcel_records.mailing_address` populated for
  the bulk of the 9,541 (not 7); after promote, gov `recorded_owners.mailing_address`
  climbs from 0 toward the matched set; each filled address carries a `county_records`
  provenance row traceable to the parcel `source_url`. Spot-check 5 owners' mailing
  addresses against their assessor page.

## Then (per the audit doc — separate slices)

- **A2** deed OCR/re-parse backfill (needs Google Document AI creds on the deployed
  `docai-ocr`) → `deed_records.grantee_address` + owner mailing (ORE Unit C is built).
- **A3** SOS-direct fetch egress (FL/AZ built → expand) → managing member/agent + SOS
  notice address.
- **Phase B** the reconcile engine: assemble the authoritative county+SOS+GSA
  name/address set per owner, compare vs SF/CoStar/RCA/email, resolve the control
  contact (the CONTACT-SELECTION signatory→agent ladder), cross-match to the party's
  other assets, consolidate, ADD owners not in SF, trace to source.
- **Phase C** the bounceback/bad-contact feedback handler.

## Bottom line

The assessor already visits the pages — it just isn't grabbing the mailing address.
Capture it, re-run, and promote it to the owner (fill-blanks, `county_records`
provenance, situs-matched) — the first authoritative notice-address layer, for free,
no credentials. This is the input the reconcile engine and cross-reference resolver
have been starved of.
