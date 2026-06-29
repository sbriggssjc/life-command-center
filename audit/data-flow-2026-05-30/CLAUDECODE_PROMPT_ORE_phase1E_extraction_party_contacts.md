# Claude Code — ORE Phase 1 Unit E: extract party contacts from OMs/leases + fix the ownership_history.address bug

## Why (audited 2026-06-27)

Our document extractors capture party NAMES but not their contact details, even
when the document carries them:
- **OM extraction** (`api/_handlers/intake-extractor.js`, the AI extraction schema
  ~lines 375-410) captures only `listing_broker` name + `listing_broker_email` and
  `seller_name`. Seller/buyer **phone, email, and mailing address are not in the
  schema** — so they're never extracted from OMs that include a contact block.
- **Lease extraction** (`api/_handlers/lease-extractor.js`, prompt ~lines 243-265)
  captures `tenant` + `guarantor` NAMES only — no guarantor/tenant **notice
  address, phone, or email**, which leases routinely carry in the notice/boilerplate
  block.
- **Data bug:** gov `ingest_ownership.py` (~line 239) sets
  `ownership_history.address` to the **city** value (wrong field) — so the address
  column holds a city, not a street address.

These are free captures (the data is in documents we already process) and they feed
the owner/contact graph + the address dimension owner cross-match needs.

## Unit E1 — OM extraction: request party contacts

Extend the OM AI extraction schema/prompt (`intake-extractor.js`) to request, where
present in the document: `seller_name`, `seller_email`, `seller_phone`,
`seller_address`; `buyer_name`, `buyer_email`, `buyer_phone`; and an owner/principal
contact block if distinct. Then write them through the existing promoter
(`intake-promoter.js`) to `contacts` / the sale parties (those tables already have
`phone`/`email`/`address` columns), fill-blanks, provenance `source='om_extraction'`.
Only extract what the doc states — never fabricate; the AI returns null when absent.

## Unit E2 — lease extraction: request guarantor/tenant notice address + contact

Extend the lease extraction prompt (`lease-extractor.js`) to request the guarantor
and tenant **notice address** (the boilerplate "notices to … at …" block) + phone/
email where present. Write the guarantor's address/contact onto the guarantor entity
(now that Unit B lets org entities carry contacts) and/or the lease record; provenance
`source='folder_feed_lease'`. Reuse the existing four lease guards + fill-blanks; the
location-agreement guard still applies. Null when the lease doesn't state it.

## Unit E3 — fix the ownership_history.address=city bug (gov)

In gov `ingest_ownership.py` (~line 239), `ownership_history.address` is being set
from `acq.get("city")`. Fix it to write the actual street address field (and keep
`city` in the `city` column). Verify the source `acq` dict's correct address key.
This is a small correctness fix; backfilling the already-wrong rows is optional
(note it, don't necessarily do it).

## Boundaries / verify

- life-center (`intake-extractor.js`, `lease-extractor.js`) + GovernmentProject
  (`ingest_ownership.py`); no new api/*.js; reuse promoter + guards + provenance;
  fill-blanks, reversible. Confirm the target columns exist (contacts has
  phone/email/address; add lease/guarantor contact storage only if needed, additive).
- `node --check` (JS) / `python -c "import src.ingest_ownership"` (gov); suites green.
- Extend tests: OM extraction surfaces seller/buyer contact fields when present (and
  null when absent, no fabrication); lease extraction surfaces guarantor notice
  address; the ownership_history.address fix writes a street, not a city.
- **Live proof (Cowork):** re-extract an OM with a seller contact block → seller
  phone/email land on the contact; re-extract a lease with a guarantor notice block
  → guarantor address lands; a fresh gov ownership_history row has a street address.

## Documentation

Update CLAUDE.md (intake-extractor / lease-extractor / gov ingest): OM extraction now
requests seller/buyer name+phone+email+address; lease extraction requests guarantor/
tenant notice address+contact; both write via the promoter with provenance,
fill-blanks, no fabrication; `ownership_history.address` city-bug fixed. ORE Phase 1
(capture everything).

## Bottom line

OMs and leases hand us seller/buyer/guarantor contacts and addresses we never ask
the extractor for. Expand the two prompts to capture them (no fabrication, guarded,
provenance-gated) and fix the gov address-field bug — more owner/contact + address
data from documents already in hand, feeding the ownership graph + cross-match.
