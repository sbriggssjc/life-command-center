# LEASEJUNK1 — OM table headers landing in `leases.tenant`

## Context

Property 29671 (Tacoma) carries lease rows sourced from `email_intake` whose
`tenant` field is not a tenant at all — it's an OM rent-roll table's own column
header, parsed as if it were data: `"Type"`, `"Shopping Center"`, `"Strip Center"`,
`"Avail. Spaces"`. All four share `lease_expiration = 2029-02-28` (clearly a
template/placeholder date carried over from the OM, not a real lease term) and
`is_active = false`, except one (`lease_id 18398`) which is `is_active = true` —
that one is live and rendering as a real, active tenant today.

This is a parser defect in whatever ingests OM rent-roll tables via `email_intake`
(find it — likely an OM-table extraction step feeding the same lease-writer used
elsewhere in the ingestion pipeline), not a one-off bad row.

## Ask

1. **Size the fleet-wide blast radius before writing anything.** Query
   `leases.tenant` for values that are either (a) in a small header-word list
   (`Type`, `Tenant`, `Shopping Center`, `Strip Center`, `Avail. Spaces`, `Sq Ft`,
   `Rent`, `Term`, `Notes`, and similar OM-table-header shapes — read a few real OM
   rent-roll exports to build this list from actual header text rather than
   guessing), or (b) ≤ 2 tokens long with no operator-name match against however
   this repo identifies known tenant/operator names elsewhere (the same kind of
   check `isJunkTenant()` or similar already does, if one exists — read
   `api/_handlers/sidebar-pipeline.js` and any misparse-disposition helpers before
   writing a new classifier). Report the count and a sample before doing anything
   live.
2. **Quarantine, never delete** — same pattern `OWNERGAP1` used elsewhere in this
   repo (read that pattern before reinventing it): mark the junk rows (a
   `data_quality_flag` column, or whatever this repo's existing quarantine
   convention is) rather than removing them, and make sure `is_active=true` junk
   rows in particular stop rendering as real leases anywhere they're read
   (rent-roll, comps, property-context) once flagged.
3. **Fix the writer.** Find the OM-table-to-lease parser that fed these rows via
   `email_intake` and add a guard so a table-header string can never land in
   `tenant` again — reject the row (or flag it for review) rather than silently
   writing garbage. Test against the exact Tacoma OM export if it's still
   available, or a synthetic fixture built from these four header strings if not.
4. Regression test: assert the four known header strings above are rejected/flagged
   by the new guard, plus a couple of real tenant names to confirm the guard isn't
   over-broad.

## Do not touch

- Any lease row whose `tenant` is a real, if unusual, tenant name — this is about
  literal table-header text landing as data, not about judgment calls on
  tenant-name quality.
