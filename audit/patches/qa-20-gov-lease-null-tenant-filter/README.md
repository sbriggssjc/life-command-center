# QA-20 — Gov lease filter dropping null-tenant rows (P0)

**Severity: P0.** Every gov property's **Rent Roll tab** showed
"No lease data available for Rent Roll" — even when the property had
a real, fully-populated GSA lease with annual rent, start date, and
expiration date. The Operations tab also showed `AGENCY (SHORT) —`
because it sources from the same lease cache.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-20-gov-lease-null-tenant-filter
node audit/patches/qa-20-gov-lease-null-tenant-filter/apply.mjs --dry
node audit/patches/qa-20-gov-lease-null-tenant-filter/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-20-gov-lease-null-tenant-filter/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-20-gov-lease-null-tenant-filter -m "Merge audit/qa-20-gov-lease-null-tenant-filter"
git push origin main
```

## Symptom (live)

`_udCache.leases = []` on property 3198 (1200 New Jersey Ave SE,
GSA-tenanted, lease LDC01477) — but direct queries against
`v_lease_detail` for the same property returned 1 row with
`annual_rent = $48.3M`, `lease_start = 2006-10-20`, `guarantor = 'GSA'`,
`guarantor_type = 'Federal'`. The frontend fetch succeeded (network
tab showed HTTP 200, `dataLen: 1`) — but the row was dropped before
hitting the cache.

## Root cause

`_udFilterAndDedupeLeases` in `detail.js` calls
`_udIsPlaceholderTenant(l?.tenant)` to filter buyer-estimated /
placeholder leases. The original function:

```js
function _udIsPlaceholderTenant(t) {
  if (t == null) return true;          // ← dropped null tenants
  …
}
```

This was designed for dia leases where buyer-estimated rows have
placeholder strings like "TBD" / "Unknown" in `tenant`. But **gov
leases store the agency in `guarantor` / `tenant_agency`, NOT in
`tenant`** — `tenant` is consistently `null` for GSA-tenanted
properties. The filter saw `null` and silently dropped the row.

Result: every gov detail panel reported "No lease data available"
on the Rent Roll tab, and "AGENCY (SHORT) —" on the Operations tab
(also derived from the lease cache).

## Fix

Split `_udIsPlaceholderTenant` into two predicates:

```js
function _udIsPlaceholderTenant(t) {
  if (t == null) return true;             // still back-of-the-line for sorting
  return _udIsKnownPlaceholderTenant(t);
}
function _udIsKnownPlaceholderTenant(t) {
  if (t == null) return false;            // null OK — not a known placeholder
  const s = String(t).trim();
  if (!s) return true;                    // empty string still a placeholder
  const lo = s.toLowerCase();
  if (_UD_PLACEHOLDER_TENANTS.has(lo)) return true;
  if (lo.startsWith('buyer est')) return true;
  if (lo.startsWith('buyerest')) return true;
  return false;
}
```

`_udIsPlaceholderTenant` (which puts null at the back of the sort
queue) keeps its old behavior so a real-tenant row still wins when
both exist. The FILTER at line ~3112 now uses
`_udIsKnownPlaceholderTenant` instead — which only filters explicit
placeholder strings, letting null/missing tenants through.

## Verified live (post-fix)

| Surface | Before | After |
|---|---|---|
| `_udCache.leases.length` on prop 3198 | `0` | `1` |
| Rent Roll tab | "No lease data available for Rent Roll" | renders the GSA lease |
| Operations tab "AGENCY (SHORT)" | `—` | `GSA` |

This affects every government property detail panel — not just the
one tested. Properties with real-string tenants (dia clinics with
DaVita / Fresenius tenant names) are unaffected; the filter still
catches "TBD" / "Unknown" / "BuyerEst" placeholders correctly.

## Why this slipped past QA pass #1/2/3

QA passes #1-3 verified the detail panel **header**, **completeness
rail**, and **next-action bar** rendered correctly — but never
clicked into the Rent Roll or Operations tabs. The bug was confined
to those two surfaces.

Lesson: page-level QA needs to exercise tab clicks too, not just
the default-open tab.

## Files changed

- `detail.js` — split `_udIsPlaceholderTenant`; filter uses new
  `_udIsKnownPlaceholderTenant`
- `AUDIT_PROGRESS.md` (closeout)
