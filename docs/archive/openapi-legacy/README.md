# Archived OpenAPI/Swagger files

As of 2026-04-21, the canonical LCC Deal Intelligence connector spec lives at:

    copilot/lcc-deal-intelligence.connector.v1.swagger.json

This folder holds the legacy duplicates for diff/history reference. Do NOT edit or re-import these — use the canonical file.

Originals archived:
  - copilot/openapi.yaml  →  copilot__openapi.yaml
  - docs/openapi.yaml  →  docs__openapi.yaml
  - docs/setup/copilot_studio_manifest/lcc-agent/appPackage/openapi.json  →  docs__setup__copilot_studio_manifest__lcc-agent__appPackage__openapi.json
  - docs/setup/copilot_studio_manifest/replacement-files/openapi.json  →  docs__setup__copilot_studio_manifest__replacement-files__openapi.json
  - docs/setup/gpt-actions-openapi.json  →  docs__setup__gpt-actions-openapi.json
  - docs/setup/lcc-copilot-openapi-core.json  →  docs__setup__lcc-copilot-openapi-core.json
  - docs/setup/lcc-copilot-openapi-merged.json  →  docs__setup__lcc-copilot-openapi-merged.json
  - docs/setup/lcc-copilot-openapi.json  →  docs__setup__lcc-copilot-openapi.json
  - lcc-copilot-openapi-core.json  →  lcc-copilot-openapi-core.json
  - lcc-copilot-openapi-full.json  →  lcc-copilot-openapi-full.json
  - docs/setup/lcc-copilot-studio-connector.json  →  docs__setup__lcc-copilot-studio-connector.json
  - docs/setup/lcc-copilot-studio-connector-v2.json  →  docs__setup__lcc-copilot-studio-connector-v2.json

To rebuild the canonical spec from these archives:

    python3 scripts/build_canonical_connector.py

The build script: reads docs/archive/openapi-legacy/docs__setup__lcc-copilot-openapi-merged.json,
auto-fixes the known schema errors (const → enum, array without items → array with generic object items),
converts OpenAPI 3.0 → Swagger 2.0 (servers → host/basePath/schemes, components → definitions,
requestBody → body parameter, nullable → x-nullable), and writes the single canonical output.
