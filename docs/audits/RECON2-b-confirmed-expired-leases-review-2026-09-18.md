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
