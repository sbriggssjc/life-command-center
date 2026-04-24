#!/usr/bin/env python3
"""Consolidate every legacy Copilot Connector openapi spec into one canonical
Swagger 2.0 file that Power Platform will actually accept.

WHY SWAGGER 2.0 AND NOT OPENAPI 3.0?
  The existing "LCC Deal Intelligence" custom connector was originally
  registered in Power Platform as Swagger 2.0. Power Platform refuses to
  in-place upgrade a 2.0 connector to 3.0 via the Swagger Editor — it must
  stay 2.0 to preserve the connector id and all downstream bot references.

WHAT THIS SCRIPT DOES:
  1. Reads the merged OpenAPI 3.0.3 spec
  2. Fixes the 3 `const: <value>` properties (unsupported in Swagger 2.0)
     by converting them to single-value `enum: [<value>]`
  3. Fixes the 14 `type: array` properties missing `items` by injecting
     a permissive `items: {type: object}` default
  4. Converts the whole structure from OpenAPI 3.0 → Swagger 2.0 syntax
     (servers→host/basePath/schemes, components→definitions, requestBody→
     body parameter, response.content.schema→response.schema, $ref paths,
     nullable→x-nullable)
  5. Writes ONE canonical file:
       copilot/lcc-deal-intelligence.connector.v1.swagger.json
  6. Archives the legacy duplicates under docs/archive/openapi-legacy/

Usage:
    python3 scripts/build_canonical_connector.py
"""
from __future__ import annotations
import json, shutil, sys
from pathlib import Path
from copy import deepcopy

ROOT = Path(__file__).resolve().parent.parent
INPUT_MERGED_3X = ROOT / "docs" / "setup" / "lcc-copilot-openapi-merged.json"

CANONICAL_OUTPUT = ROOT / "copilot" / "lcc-deal-intelligence.connector.v1.swagger.json"

LEGACY_FILES = [
    ROOT / "lcc-copilot-openapi-full.json",
    ROOT / "lcc-copilot-openapi-core.json",
    ROOT / "docs" / "setup" / "lcc-copilot-openapi.json",
    ROOT / "docs" / "setup" / "lcc-copilot-openapi-core.json",
    ROOT / "docs" / "setup" / "lcc-copilot-openapi-merged.json",
    ROOT / "docs" / "setup" / "gpt-actions-openapi.json",
    ROOT / "docs" / "setup" / "copilot_studio_manifest" / "replacement-files" / "openapi.json",
    ROOT / "docs" / "setup" / "copilot_studio_manifest" / "lcc-agent" / "appPackage" / "openapi.json",
    ROOT / "docs" / "openapi.yaml",
    ROOT / "copilot" / "openapi.yaml",
]
ARCHIVE_DIR = ROOT / "docs" / "archive" / "openapi-legacy"


# ──────────────────────────────────────────────────────────────────────────
# STEP 1 — Schema-level fixes (run BEFORE conversion so fixes propagate)
# ──────────────────────────────────────────────────────────────────────────

def walk_and_fix(obj, path="", stats=None):
    """Recursively fix const → enum and type:array missing items."""
    if stats is None:
        stats = {"const_fixed": 0, "items_added": 0}

    if isinstance(obj, dict):
        # Fix const → single-value enum
        if "const" in obj:
            value = obj.pop("const")
            obj["enum"] = [value]
            stats["const_fixed"] += 1

        # Fix type:array missing items
        if obj.get("type") == "array" and "items" not in obj:
            obj["items"] = {"type": "object", "additionalProperties": True}
            stats["items_added"] += 1

        for v in obj.values():
            walk_and_fix(v, path, stats)
    elif isinstance(obj, list):
        for item in obj:
            walk_and_fix(item, path, stats)

    return stats


# ──────────────────────────────────────────────────────────────────────────
# STEP 2 — $ref rewriting (3.0 paths → 2.0 paths)
# ──────────────────────────────────────────────────────────────────────────

def rewrite_refs(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "$ref" and isinstance(v, str):
                obj[k] = v.replace("#/components/schemas/", "#/definitions/")
            else:
                rewrite_refs(v)
    elif isinstance(obj, list):
        for item in obj:
            rewrite_refs(item)


# ──────────────────────────────────────────────────────────────────────────
# STEP 3 — OpenAPI 3.0 → Swagger 2.0 structural transform
# ──────────────────────────────────────────────────────────────────────────

def convert_nullable(obj):
    """Swagger 2.0 has no `nullable`; use the `x-nullable` extension."""
    if isinstance(obj, dict):
        if "nullable" in obj:
            val = obj.pop("nullable")
            obj["x-nullable"] = val
        for v in obj.values():
            convert_nullable(v)
    elif isinstance(obj, list):
        for item in obj:
            convert_nullable(item)


def convert_path_item(path_item):
    """Transform each operation's requestBody → body parameter and
    response.content.application/json.schema → response.schema."""
    for method, op in list(path_item.items()):
        if method not in ("get", "post", "put", "patch", "delete", "head", "options"):
            continue
        if not isinstance(op, dict):
            continue

        # requestBody → body parameter
        if "requestBody" in op:
            rb = op.pop("requestBody")
            body_schema = (
                rb.get("content", {})
                  .get("application/json", {})
                  .get("schema", {})
            )
            op.setdefault("parameters", [])
            op["parameters"].append({
                "in":          "body",
                "name":        "body",
                "required":    rb.get("required", True),
                "description": rb.get("description", ""),
                "schema":      body_schema,
            })
            op.setdefault("consumes", ["application/json"])

        # Responses: strip .content.application/json wrapper
        if "responses" in op:
            new_responses = {}
            for code, resp in op["responses"].items():
                if not isinstance(resp, dict):
                    new_responses[code] = resp
                    continue
                new_resp = {"description": resp.get("description", "")}
                content = resp.get("content", {})
                aj = content.get("application/json", {}) if isinstance(content, dict) else {}
                if "schema" in aj:
                    new_resp["schema"] = aj["schema"]
                # preserve headers if present
                if "headers" in resp:
                    new_resp["headers"] = resp["headers"]
                new_responses[code] = new_resp
            op["responses"] = new_responses
            op.setdefault("produces", ["application/json"])


def convert_3_to_2(spec_3):
    """Return a Swagger 2.0 deep-copy of the input OpenAPI 3.0 spec."""
    spec = deepcopy(spec_3)

    # Strip 3.0 top-level markers
    spec.pop("openapi", None)
    spec["swagger"] = "2.0"

    # servers → host + basePath + schemes
    servers = spec.pop("servers", []) or []
    if servers:
        from urllib.parse import urlparse
        u = urlparse(servers[0]["url"])
        spec["host"]     = u.netloc or "tranquil-delight-production-633f.up.railway.app"
        spec["basePath"] = u.path.rstrip("/") or "/"
        spec["schemes"]  = [u.scheme or "https"]
    else:
        spec["host"]     = "tranquil-delight-production-633f.up.railway.app"
        spec["basePath"] = "/"
        spec["schemes"]  = ["https"]

    # components.schemas → definitions
    components = spec.pop("components", {}) or {}
    if "schemas" in components:
        spec["definitions"] = components.pop("schemas")

    # components.securitySchemes → securityDefinitions
    if "securitySchemes" in components:
        sec_defs = {}
        for name, scheme in components["securitySchemes"].items():
            t = scheme.get("type")
            if t == "http" and scheme.get("scheme") == "bearer":
                # Swagger 2.0 has no http-bearer; use apiKey on Authorization header
                sec_defs[name] = {
                    "type":        "apiKey",
                    "in":          "header",
                    "name":        "Authorization",
                    "description": scheme.get("description", "Bearer token (prefix value with 'Bearer ')."),
                }
            elif t == "apiKey":
                sec_defs[name] = {
                    "type":        "apiKey",
                    "in":          scheme.get("in", "header"),
                    "name":        scheme.get("name"),
                    "description": scheme.get("description", ""),
                }
            elif t == "oauth2":
                # flatten to single flow
                flows = scheme.get("flows", {})
                first_flow_name, first_flow = next(iter(flows.items()), (None, None))
                if first_flow:
                    sec_defs[name] = {
                        "type":             "oauth2",
                        "flow":             first_flow_name or "accessCode",
                        "authorizationUrl": first_flow.get("authorizationUrl", ""),
                        "tokenUrl":         first_flow.get("tokenUrl", ""),
                        "scopes":           first_flow.get("scopes", {}),
                    }
            else:
                # basic or unknown → skip
                pass
        spec["securityDefinitions"] = sec_defs

    # Transform every path item
    for path, item in spec.get("paths", {}).items():
        if isinstance(item, dict):
            convert_path_item(item)

    # Rewrite $refs from components → definitions
    rewrite_refs(spec)

    # nullable → x-nullable
    convert_nullable(spec)

    # Top-level consumes/produces defaults for Power Platform
    spec.setdefault("consumes", ["application/json"])
    spec.setdefault("produces", ["application/json"])

    return spec


# ──────────────────────────────────────────────────────────────────────────
# STEP 4 — Legacy file archival
# ──────────────────────────────────────────────────────────────────────────

def archive_legacy_files():
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    readme = ARCHIVE_DIR / "README.md"
    readme.write_text(
        "# Archived OpenAPI/Swagger files\n\n"
        "As of 2026-04-21, the canonical LCC Deal Intelligence connector "
        "spec lives at:\n\n"
        "    copilot/lcc-deal-intelligence.connector.v1.swagger.json\n\n"
        "This folder holds the legacy duplicates for diff/history reference. "
        "Do NOT edit or re-import these — use the canonical file.\n\n"
        "Originals archived:\n"
    )

    archived = []
    for src in LEGACY_FILES:
        if not src.exists():
            continue
        # Flatten the path into the archive name so uniqueness is preserved
        rel = src.relative_to(ROOT)
        dst_name = str(rel).replace("/", "__").replace("\\", "__")
        dst = ARCHIVE_DIR / dst_name
        shutil.move(str(src), str(dst))
        archived.append((str(rel), dst_name))

    if archived:
        with readme.open("a") as f:
            for orig, arch in sorted(archived):
                f.write(f"  - {orig}  →  {arch}\n")

    return archived


# ──────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────

def main() -> int:
    if not INPUT_MERGED_3X.exists():
        print(f"ERROR: merged spec not found at {INPUT_MERGED_3X}", file=sys.stderr)
        return 1

    spec_3x = json.loads(INPUT_MERGED_3X.read_text())

    # 1. Fix schema errors (const, missing items)
    stats = walk_and_fix(spec_3x)
    print(f"Schema fixes:  const→enum: {stats['const_fixed']}, items added: {stats['items_added']}")

    # 2. Convert OpenAPI 3.0 → Swagger 2.0
    spec_2 = convert_3_to_2(spec_3x)

    # Re-fix inside the converted tree (belt + braces — walking the 3x tree
    # might have missed things that only appeared after conversion)
    stats2 = walk_and_fix(spec_2)
    if stats2["const_fixed"] or stats2["items_added"]:
        print(f"Post-convert fixes: const→enum: {stats2['const_fixed']}, items added: {stats2['items_added']}")

    # 3. Tag the canonical file
    spec_2.setdefault("info", {})
    spec_2["info"]["title"]   = "LCC Deal Intelligence"
    spec_2["info"]["version"] = "1.1.0"
    spec_2["info"]["description"] = (
        "Canonical Swagger 2.0 spec for the LCC Deal Intelligence custom "
        "connector in Power Platform. Includes the 38 original operations "
        "(GetDailyBriefing, SearchEntities, DraftOutreachEmail, etc.) and "
        "the 4 v1.1.0 additions (intakeStageOm, intakeFinalizeOm, "
        "contextRetrieveEntity, memoryLogTurn). Source of truth — do not "
        "maintain duplicates."
    )

    # 4. Write output
    CANONICAL_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    CANONICAL_OUTPUT.write_text(json.dumps(spec_2, indent=2))
    print(f"Canonical spec: {CANONICAL_OUTPUT}")
    print(f"  swagger:      {spec_2.get('swagger')}")
    print(f"  host:         {spec_2.get('host')}")
    print(f"  basePath:     {spec_2.get('basePath')}")
    print(f"  paths:        {len(spec_2.get('paths', {}))}")
    print(f"  definitions:  {len(spec_2.get('definitions', {}))}")

    # 5. Final validation sweep
    final_consts = []
    final_missing_items = []
    def check(obj, path=""):
        if isinstance(obj, dict):
            if "const" in obj: final_consts.append(path)
            if obj.get("type") == "array" and "items" not in obj: final_missing_items.append(path)
            for k, v in obj.items(): check(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj): check(v, f"{path}[{i}]")
    check(spec_2)

    if final_consts or final_missing_items:
        print("WARN — residual issues:", file=sys.stderr)
        for p in final_consts:          print(f"  const:   {p}", file=sys.stderr)
        for p in final_missing_items:   print(f"  no-items: {p}", file=sys.stderr)
    else:
        print("Validation: clean (no const, no array-without-items)")

    # 6. Archive the legacy files
    archived = archive_legacy_files()
    print(f"\nLegacy files archived: {len(archived)}")
    for orig, arch in archived:
        print(f"  {orig}  →  docs/archive/openapi-legacy/{arch}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
