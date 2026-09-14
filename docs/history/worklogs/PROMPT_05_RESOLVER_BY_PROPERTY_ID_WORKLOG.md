# Prompt 05 - Resolver by Property ID

Status: implemented 2026-08-01

Objective:
- Fix `get_property_context` / property panel resolution so domain asset identity
  `(dia|gov, asset, property_id)` resolves before address/name matching.
- Verify property 35724 / 20931 Burbank Blvd resolves to entity `d118b3a1...`
  instead of falling back to `dia` with `entity=null`.
- Normalize asset stub names to include street plus operator/tenant when the
  domain facts are present.

Changes:
- `api/_handlers/property-handler.js`
  - Added property-id identity resolver through `external_identities`.
  - Added address-to-domain-property lookup before legacy entity address/name
    fuzzy matching.
  - Added `property_id` and `domain` query support, including `q=dia:35724`
    and numeric `q=35724`.
- `mcp/server.js`
  - Mirrored identity-first resolution for MCP `get_property_context`.
  - Added `property_id` and `domain` to the MCP tool schema.
- `api/_shared/asset-entity.js`
  - Stub entity names now normalize to `street - operator/tenant` when a domain
    operator/tenant is available.
- Tests:
  - Added coverage that direct `dia` property_id `35724` resolves to the linked
    entity before address search.
  - Added coverage that address resolution goes through domain property_id
    identity before fuzzy LCC address/name matching.
  - Updated asset-entity test for street plus operator display name.

Verification:
- `node --test test\property-context-packet.test.mjs test\asset-entity.test.mjs`
- `node --check api\_handlers\property-handler.js`
- `node --check api\_shared\asset-entity.js`
- `node --check mcp\server.js`

Notes:
- The requested response path `../responses/05-resolver-by-property-id.response.md`
  points to `C:\Users\scott\responses`, which is outside the writable project
  root in this session. This project-local worklog records the same response
  details.
