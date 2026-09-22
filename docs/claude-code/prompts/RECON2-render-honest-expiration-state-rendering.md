# RECON2-render — surface `expiration_state` wherever a lease is shown to a human

## Context

`RECON2` (round 30) added `leases.expiration_state`, and by design a lease that has
passed its own `lease_expiration` with no confirming evidence to say it actually
renewed sits at `expiration_state = 'expired_unconfirmed'` while `is_active` stays
`true`, unchanged. That's the right data-layer behavior (never silently flip
`is_active` on inference alone) — but no reader surfaces `expiration_state` to a
human yet, so a lease in exactly this state still renders everywhere as a flat,
ordinary "Active" lease with no hint that its term is unconfirmed. This was
explicitly filed as out of scope for `RECON2` unit 1's time budget at the time.

Four reader call sites were found by grep and confirmed to read `lease_expiration`
without ever reading or surfacing `expiration_state`:

- `mcp/comps-tools.js::hydrateSubjectFromRecord` — computes `remaining_term` from
  `lease_expiration` with no `expiration_state` read (~line 690-698).
- `api/_handlers/entities-handler.js::buildPropertyPacket` — the
  `leases?…&order=is_active.desc.nullslast,lease_start.desc&limit=1` query
  (~line 653) does `select *`, so `expiration_state` is already in the row it gets
  back, but nothing labels it for the client — it's silently dropped or ignored
  downstream.
- `api/_shared/asset-entity.js` — lease_expiration field builder (~line 110).
- `api/_shared/provenance-row-context.js` — renders a provenance sentence off
  `lease_expiration` (~line 54-56).

(Line numbers are from when this was filed — re-grep before editing in case the
file has moved since.)

## Ask

Add one honest, short label wherever a lease is surfaced to a human, keyed on
`expiration_state` — not a broader refactor of any of these readers. Something in
the shape of: `"Expired <date> — renewal not on file (unconfirmed)"` when
`expiration_state = 'expired_unconfirmed'`. Leave the normal case (a lease that's
either genuinely active-and-current, or confirmed-expired with real evidence)
rendering exactly as it does today — this is additive labeling for the one
ambiguous state, not a rewrite of the rendering logic.

Touch each of the four call sites above:
1. `hydrateSubjectFromRecord` (`mcp/comps-tools.js`) — surface the label alongside
   `remaining_term` wherever that's rendered to the user (comps output).
2. `buildPropertyPacket` (`api/_handlers/entities-handler.js`) — make sure
   `expiration_state` is explicitly named/labeled in the packet the client
   receives, not just passively present because of `select *`.
3. The lease_expiration field builder in `api/_shared/asset-entity.js`.
4. The provenance sentence in `api/_shared/provenance-row-context.js`.

Add a regression test per call site (or one shared test exercising all four against
a fixture lease with `expiration_state='expired_unconfirmed'`) confirming the label
appears, and confirm the normal-case output is byte-for-byte unchanged for a lease
with any other `expiration_state` value.

## Do not touch

- `leases.is_active` — stays exactly as `RECON2` designed it (never inferred to
  `false` from `expiration_state` alone).
- Any reader not in the four call sites above — if grep turns up a fifth site,
  flag it in the response rather than silently expanding scope.
