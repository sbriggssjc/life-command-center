# Claude Code prompt — operator normalization (fill blank operator from tenant; guard non-dialysis)

> Scott (2026-06-24): a number of `available_listings` / `properties` rows carry no `operator` when the
> `tenant` string clearly encodes one. Build a deterministic tenant→operator normalization, applied BOTH as
> a one-time fill-blanks backfill AND at ingest, with a hard guard that non-dialysis tenants are never
> force-assigned a dialysis operator. dia `zqzrriwuavgrquhisnoa` (extend to gov if the same gap exists).

## Receipts (grounded 2026-06-24, the 521 active OM-intake set)
63 rows have a blank `operator`. The tenant string maps cleanly for ~45 of them; ~18 are not dialysis at
all and rode in through the same inbox. Observed blank-operator tenants:
- **DaVita:** `DaVita Kidney Care` (19), `DaVita Dialysis`, `DaVita Affinity Place Dialysis`, `DaVita`,
  `DVA Renal Healthcare`/`DVA Healthcare Renal Care`, `Renal Treatment Centers-Southeast, L.P.`,
  `Total Renal Care`.
- **Fresenius:** `Fresenius Medical Care` (10), `Fresenius Medical Care (Dark)`, `Bio-Medical Applications
  of <state>` (FMC legal entity), `American Access Care`, `Renal Care Group`, `Azura Vascular Care`, `RAI`,
  `Liberty Dialysis`, `BMA …`.
- **US Renal Care:** `U.S. Renal Care`, `USRC …`, `Dialysis Newco, Inc. dba DSI Renal`, `DSI …`.
- **American Renal / IRC:** `American Renal …`, `Innovative Renal Care`, `ARA`.
- **DCI:** `Dialysis Clinic, Inc.`, `DCI`.
- **Satellite:** `Satellite Healthcare …`, `WellBound …`.
- **Independent:** `Renal Ventures Management, LLC`, `Renal Life Link, Inc`, `Dialysis Associates, LLC`,
  `Centro De Cuidado Renal`, etc.
- **NOT dialysis (must NOT get an operator):** `Henry Ford Health System` (×2), `Staples, Inc.`,
  `Planet Fitness`, `West Virginia University Medicine`, `Vital Smiles, VIPCare`, `DB Biologics, LLC`,
  `Affordable Health Care`, `In Home Clinical & Case Worker Services`, `Kentucky Childrens Hospital`,
  `seven medical tenants`, `complimentary hearing wellness center`, and other table-of-contents / MOB
  strings.

## The build
1. **Deterministic alias map** (anchored, case-insensitive) tenant-regex → canonical operator, covering the
   families above. Anchor patterns so legitimate names aren't false-positived (e.g. `^bio-medical
   applications` → Fresenius, but a random "applications" substring elsewhere does not match). Keep the map
   in one place so ingest + backfill share it.
2. **Fill-blanks backfill:** set `properties.operator` (and any `available_listings` operator surface) from
   the tenant string **only where operator is currently NULL/empty**. Never overwrite a curated operator.
   Reversible (log prior NULL → value).
3. **At-ingest normalization:** run the same map in the OM-intake promoter so new rows get an operator
   derived from the tenant when the extractor didn't supply one — fill-blanks, same map.
4. **Non-dialysis guard (critical):** a tenant that matches the existing `isJunkTenant`-style non-dialysis
   set (national retail/fitness, hospital systems, MOB ToC headers, "N medical tenants", lease-term
   fragments) must NOT be assigned a dialysis operator. Flag those rows (`operator_status='non_dialysis'`
   or equivalent) so they can be reviewed/excluded — they are MOB/retail OMs that arguably should not sit
   in the dialysis listing table as dialysis comps at all. Surface the count; don't silently force-map.
5. **Report the residual:** tenants that are plausibly dialysis but don't match the map → leave NULL +
   list them for map extension (don't guess).

## Gate
- Blank-operator dialysis rows (~45 of 63 in the sample) now carry the correct canonical operator via the
  alias map; spot-check 10 against their tenant string.
- The ~18 non-dialysis tenants are flagged, NOT assigned a dialysis operator.
- No curated operator overwritten (fill-blanks only). Ingest applies the same map going forward.
- Reversible; residual unmatched-but-plausible set reported for map extension. dia (+ gov if applicable).

## Boundaries
Fill-blanks only; deterministic anchored map; never force a dialysis operator onto a non-dialysis tenant;
reversible; surface residuals rather than guess. ≤12 api/*.js.
