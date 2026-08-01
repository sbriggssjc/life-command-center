# Prompt 05 — Resolve assets by property-id identity, not address alone
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/living-deal-dossier-and-systems-connection.md` §5; entity d118b3a1 / property 35724
- Response file: `../responses/05-resolver-by-property-id.response.md`

## Prompt (copy/paste to Claude Code)
```
The property panel / get_property_context resolves an asset by ADDRESS and missed entity d118b3a1 ("Woodland
Hills") for property 35724 because the entity is named "Woodland Hills", not the street address -- it fell back
to the dia domain with entity=null even though external_identities (dia, asset, 35724) -> d118b3a1 exists. Fix
the resolver to resolve an asset by the (dia|gov, asset, property_id) external_identities identity first, then
fall back to address; and normalize asset entity names to include the street + operator so the display is
consistent. Verify get_property_context for 20931 Burbank Blvd / property 35724 returns entity d118b3a1 with its
context packet, not the dia fallback.
```

## Verify
get_property_context for property 35724 (and by address) returns entity d118b3a1 with a full packet; other
by-address lookups that have a property-id identity resolve to the right entity.
