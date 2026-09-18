# RECON2-b — the 7 leases the classifier calls *confirmed expired* (for Scott's read, 2026-09-18)

Pulled live from Dialysis_DB by Cowork (round 33) with
`select * from dia_recon2_classify_expired_leases(null) where proposed_state = 'expired_confirmed'`, joined to
`properties`, `medicare_clinics` and `available_listings`. **Nothing has been written.** Every one of the 2,454
expired-but-active leases is still `is_active = true`; these 7 are the only ones with deterministic evidence
under Scott's rule ("a lease goes inactive only on confirmed expiration"). The other 2,447 are
`expired_unconfirmed` and sit in the research worklist (437 open tasks).

Mark each row **confirm** / **hold** / **wrong evidence**. Confirmation is then one ledgered call per lease:
`dia_recon2_confirm_lease_expired(lease_id, 'expired_confirmed', evidence_type, source, reference, …)` — a CC
round runs it from the repo, never by hand.

| # | lease | property | address | tenant | expired | annual rent | evidence | clinic on the property (status / operating / last seen) | active listing | Cowork read |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 23273 | 22471 | 629 North Hwy 90, Sierra Vista AZ | DaVita Kidney Care | 2021-01-31 | $124,239 | CMS: clinic `closed`, not operating | closed / false / 2025-07-11 | 0 | strongest of the seven — clinic closed and seen closed in 2025 |
| 2 | 23506 | 24597 | 300 8th St NE, Washington DC | DaVita Kidney Care | 2018-02-28 | $648,000 | CMS: clinic `closed`, not operating | closed / false / — | 0 | closed, but `last_seen_date` empty — confirm the CMS row is current before trusting it |
| 3 | 23259 | 27677 | 2609 Hospital Rd, Goldsboro NC | DaVita Kidney Care | 2012-05-31 | $190,807 | successor lease 9519 on the same property | removed / **true** / — | 0 | a newer lease supersedes it; the clinic still operates — this is *lease* expiration, not closure ✓ |
| 4 | 6912 | 25069 | 203 S Tennessee St, Cartersville GA | (tenant blank) | 2017-07-15 | $31,379 | `status = Terminated` on the lease | no clinic row | 0 | termination recorded on the lease itself; low value; tenant unknown — confirm |
| 5 | 12599 | 22887 | 4578 S Kirkman Rd, Orlando FL | Davita Metrowest Dialysis | 2014-06-30 | $341,130 | `status = Terminated` | removed / **true** / 2025-07-11 | **1** | terminated 2014 yet the clinic operates and the property has an **active listing** — hold: which lease is the listing marketed on? |
| 6 | 12678 | 25464 | 1131 N Galena Ave, Dixon IL | Davita | 2014-03-31 | $92,520 | `status = Terminated` | removed / **true** / — | 0 | terminated lease, operating clinic — a newer lease should exist; hold until research finds it |
| 7 | 13058 | 28547 | 920 South Washington Ave, Scranton PA | Davita Commonwealth Dialysis | 2016-01-31 | $105,873 | `status = Terminated` | removed / **true** / — | 0 | same as 6 |

**Read across the seven.** Rows 1–2 are CMS closures (the evidence class RECON2-b tightened; only 2 survive of
the 1,489 the first cut proposed). Row 3 is the clean case — a successor lease. Rows 4–7 rest on the lease's own
`status = Terminated` text; three of those four sit on clinics CMS says are operating, so "the lease ended" is
probably true and "the tenant left" is probably false — a renewal or a new lease is missing from the record.
Confirming them inactive is honest about *this* lease row; the gap it exposes (no current lease on an operating
clinic) is exactly what the research worklist is for.

**What confirmation does and does not do.** `is_active → false` on the confirmed row only; `expiration_state →
expired_confirmed` with the evidence stored in `expiration_evidence`; a ledger row with the prior value. It does
not touch rent, term, tenant, the property, or any other lease.

## Scott's read — round 34 (2026-09-18)

| # | lease | Scott's field check | Cowork's re-measure | verdict |
|---|---|---|---|---|
| 1 | 23273 Sierra Vista | CoStar: DaVita lease **active**; DaVita locator: **operating** at the address | The clinic row on property 22471 is CCN 32654 *Fresenius Kidney Care Canyon Vista*, `closed`, `dedup_status = demoted_duplicate`. The DaVita clinic (CCN 032520, operating, seen 2026-01-22) is on **property 35849, "629 N Highway 90 Byp, Ste 6"** — an R1 twin of 22471. The "closure" was a different operator's demoted duplicate on a twin row. | **Conflict — hold.** Not a lease expiration; a property-identity defect (RECON1 class) plus a classifier gap (`RECON2-c`). |
| 2 | 23506 Washington DC | DaVita's Eighth Street Dialysis (historically Gambro / Eighth Street) is no longer at 300 8th St NE — relocated to **920 Bladensburg Rd NE, 20002** | CMS row `closed`, none operating — corroborated by the relocation | **Confirm** (relocated). Research: is the Bladensburg clinic on the record as a property? |
| 3 | 23259 Goldsboro | DaVita operating; possible recent expansion; CoStar sent via sidebar | Successor lease 9519 (exp 2022) is itself inactive; sidebar stamped `data_source = costar_sidebar` on the 2012 row; twin property 39982 (`2604 N Hospital Rd`) carries a Fresenius lease to 2030 | **Confirm the 2012 row as superseded — with a successor.** The current DaVita lease is not on the record; it must be inserted in the same step. |
| 4 | 6912 Cartersville | No longer a dialysis clinic — a restaurant since 2019; old Google listing "Cartersville Dialysis Clinic" | No clinic row on the property | **Confirm** (vacated). Property use changed — flag for the property record too. |
| 5 | 12599 Orlando Metrowest | Operating, hours on Google; in a 120k SF centre; **CoStar lease expires Jun 2028**; sent via sidebar | Twin property 37640 (`4550-4666 S Kirkman Rd`, 51 leases) updated 15:54 UTC; its DaVita lease has **NULL expiration**; no Jun-2028 row anywhere | **Confirm-with-successor only**: insert the 2028 lease (parent → 12599), then confirm 12599. Alone, confirming leaves an operating clinic with an active listing and no lease. |
| 6 | 12678 Dixon | Operating, hours on Google; CoStar lease active; sent via sidebar | Property 25464 updated 16:05 UTC; lease 7307 (exp 2024) inactive; no current row | **Confirm-with-successor only** (as #5). |
| 7 | 13058 Scranton | Operating, hours on Google; 83k SF centre; CoStar lease active; sent via sidebar | Twin property 51243 (`920-1000 S Washington Ave`) created/updated 16:01 UTC with **0 leases**; 28547 unchanged | **Confirm-with-successor only** (as #5). Also an R1 twin to fold. |

**What the sidebar sends did and did not do (measured 16:05 UTC):** they touched property rows — three of them the
range-address *twins* of the lease's property — and re-stamped one old lease's source; **none wrote a lease row with
the CoStar expiration.** That is `SIDEBAR-LEASE1`. Until it is fixed, "confirm-with-successor" for #3/#5/#6/#7 means a
CC round inserts the successor from the CoStar values Scott read (tenant, expiration, source `costar`,
`parent_lease_id`) in the same transaction as the confirmation — never confirm first and hope.

**Confirmation bar from here:** two agreeing sources beyond the database — the CoStar lease record and the
operator's own locator (DaVita / Fresenius) for the address — before any `expired_confirmed` is written. A CMS
row alone, even `closed`, is one source, and this case shows it can be the wrong clinic.

## Outcome — RECON2-c applied live (2026-09-18, verified round 39)

| # | lease | state now | detail |
|---|---|---|---|
| 1 | 23273 Sierra Vista | `expired_unconfirmed`, active | untouched; 2 evidence rows (CoStar active, DaVita operating); Conflict held; twin 22471 ↔ 35849 on the R1 list |
| 2 | 23506 DC | **`expired_confirmed`**, inactive | relocated to 920 Bladensburg Rd NE; 3 evidence rows |
| 3 | 23259 Goldsboro | `holdover_confirmed`, active | **label to correct** → `renewed_confirmed` + successor once the CoStar date is read (RECON2-d / Q35) |
| 4 | 6912 Cartersville | **`expired_confirmed`**, inactive | restaurant since 2019; 2 evidence rows |
| 5 | 12599 Orlando | **`expired_confirmed`**, inactive | **successor 25432**, exp 2028-06-30, `parent_lease_id → 12599`, source `costar_field_check` |
| 6 | 12678 Dixon | `holdover_confirmed`, active | as #3 |
| 7 | 13058 Scranton | `holdover_confirmed`, active | as #3 |

Fleet after: `expired_confirmed` 3 · `holdover_confirmed` 3 · `expired_unconfirmed` 2,447 active (48 of them on a
property whose twin carries an operating clinic — `twin_operating`) · `expiration_unknown` 2,334 active.
