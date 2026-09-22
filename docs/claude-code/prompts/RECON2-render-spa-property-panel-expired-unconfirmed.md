# RECON2-render-spa (+ RECON2-render-dossier) — the property panel and the dossier still show an expired-unconfirmed lease as Active

Backlog: `RECON2-render-spa`, `RECON2-render-dossier` (both filed by CC during RECON2-render, 2026-09-22). RECON2-render (PR #2625) is live on `tranquil-delight` and was reconciled in Cowork round 63.

## Context

RECON2-render added one label helper, `mcp/lease-expiration-state.js` → `leaseExpirationStateLabel()`: "Expired <date> — renewal not on file (unconfirmed)". The four server readers use it, and the property packet now carries `tenancy_lease.lease_expiration_state` for that one state. Live, **2,447** active dia leases are `expiration_state='expired_unconfirmed'` (re-queried 2026-09-22). The surfaces Scott actually looks at still render them as plain Active:

- `detail.js:2370`: overview leases filtered on `status==='active' && is_active===true`.
- `detail.js:4519`: `activeLease` = first `is_active===true`.
- `dialysis.js:657–658`: active-first sort.
- `api/_shared/dossier-generator.js`: `renderTermTag` (~485) and the Tenancy & Lease `kvRow`s (~444, ~662) ignore `tenancy_lease.lease_expiration_state`.

Line numbers are from 2026-09-22. Re-grep first.

## Ask

1. Wherever the SPA shows a lease as the active/current lease (overview, rent roll, unified detail lease card, dialysis property panel), show the same label beside the expiration when `expiration_state === 'expired_unconfirmed'`. Use the same text as the helper. The front end can't import `mcp/`, so either mirror the string in one front-end helper with a test that fails on drift (LEASEJUNK1's lock-step pattern), or read `lease_expiration_state` from the packet where the surface already has it.
2. In the dossier, add one `kvRow` for `tenancy_lease.lease_expiration_state` when present.
3. Do not change which lease is chosen as "active". `is_active` stays exactly as RECON2 designed it; this is labelling only.
4. Tests: the label appears for `expired_unconfirmed`, and output is byte-for-byte unchanged for every other state and for gov leases (no such column). Include a mutation check.

## Do not touch

- `leases.is_active`, `expiration_state` producers, or the four server readers RECON2-render already fixed.

## Done means

- The backlog rows are updated.
- Cache busters are bumped as a set.
- Deploy = redeploy BOTH Railway services.
