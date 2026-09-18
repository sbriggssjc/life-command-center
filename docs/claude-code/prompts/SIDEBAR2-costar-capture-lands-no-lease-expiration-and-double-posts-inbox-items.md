# SIDEBAR2 — the CoStar sidebar capture (a) wrote no lease with its expiration on four sends, (b) resolves to range-address twin rows, and (c) posts every inbox item twice

**Filed:** 2026-09-18 (Cowork round 40; rows `SIDEBAR-LEASE1` + the inbox duplicate). **Owner:** LCC
(`api/_handlers/sidebar-pipeline.js` — 13,110 lines; lease block ~11,530–11,700; inbox posts ~2,190 / ~2,378;
`api/_shared/intake-om-pipeline.js` ~364–402), `test/`. **Read first:** backlog `SIDEBAR-LEASE1`, `RECON2-b`/`-c`
(the four sends), `RECON1` (R1 twins), PR5/PRI rows for the sidebar arc, `docs/architecture/property-identity-and-address-resolution.md`.

## Measured (Cowork, 2026-09-18)
**(a) Lease expiration not landed.** Scott sent CoStar property pages for Goldsboro `2609 Hospital Rd`, Orlando
`4578 S Kirkman Rd`, Dixon `1131 N Galena Ave`, Scranton `920 S Washington Ave` between 15:43 and 16:05 UTC.
After: `properties.updated_at` moved on 25464, 22887, 27677 and on twins 37640 / 51243 / 39982; lease 23259 got
`data_source = costar_sidebar` (its 2012 row); **no lease row anywhere carries a CoStar expiration** (Orlando's
Jun-2028 came from Scott's reading, not the capture; 37640's DaVita lease has `lease_expiration` NULL). The pipeline
*has* a lease block (`lease_expiration` parsed at ~4388/5013, new-term detection at ~11,530) — so either the payload
had no lease fields (CoStar's tenant/lease data is on a different tab than the property summary Scott captured), or
the tenant-key match failed (`DaVita Kidney Care` vs `Davita Metrowest Dialysis`), or the write went to the twin.
Find which, from the four staged payloads / sidebar logs — do not guess. Note too: three of the four have **no
expiration in CoStar at all** (Scott, 17:50 UTC) — the capture must then write `expiration_unknown`, not nothing.
**(b) Twin rows.** The captures updated `4550-4666 S Kirkman Rd` (37640), `920-1000 S Washington Ave` (51243, 0
leases), `2604 N Hospital Rd` (39982) — range/variant addresses of the properties the leases live on. The sidebar's
property resolver must run R1 (range membership, suffix/directional) before creating or updating; a miss goes to
`property_identity_review`, not to a new or twin row.
**(c) Double posts.** `inbox_items` today: every sidebar item appears **twice within ~1 s** — `OM: USRC Gaffney…`
17:35:03.98 / 17:35:04.91; `New contact: Lance Sasser` 16:36:43.67 / .87; `Steve L. Rainwater` 13:11:27 / :28;
`Andrew Medley` ×2 on 09-16. The Home INBOX lane shows the OM twice. Either the extension fires the POST twice or the
server inserts from two paths (`sidebar-pipeline.js` ~2190/2378 and `intake-om-pipeline.js` ~402). Measure request
ids/user-agents in the edge log for one pair, then fix at the source and add an idempotency key
(`source + external_id + minute`) with a unique index so a retry cannot double-post again. Count and mark today's
duplicates `dismissed` with a reason, ledgered.

## Build
1. (c) first — it is visible on Scott's Home every day. 2. (a) with the payload evidence; write `expiration_unknown`
when CoStar has no date; tenant match through the operator resolver, not string equality. 3. (b) through the R1 matcher
the spec names — or refuse and queue. 4. Tests for each with fixtures from the four real payloads (redact nothing that
is not a secret). 5. Report: per capture, what the payload held, where it wrote, what it should have written.

⛔ No fabricated expiration dates. ⛔ No dedupe in the UI to hide (c). ⛔ STATUS entry labelled **(CC)**, written.
**Parked:** one line each.
