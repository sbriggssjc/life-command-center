#!/usr/bin/env python3
"""Merge the 5 new Copilot action operations into the existing
lcc-copilot-openapi-full.json so the refreshed spec can be pasted into
Power Platform without losing the existing 38 operations.

Usage:
    python3 scripts/merge_copilot_openapi.py

Outputs:
    docs/setup/lcc-copilot-openapi-merged.json  (paste THIS into Power Platform)
"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXISTING = ROOT / "lcc-copilot-openapi-full.json"
OUTPUT   = ROOT / "docs" / "setup" / "lcc-copilot-openapi-merged.json"

# ---- NEW OPERATIONS ----
# Copilot v1.1.0 additions: intake (inline base64), context retrieval, memory.

NEW_PATHS = {
    "/api/intake/stage-om": {
        "post": {
            "operationId": "intakeStageOm",
            "summary": "Stage an Offering Memorandum for intake",
            "description": (
                "Stages a property OM PDF inline (base64) into inbox_items + "
                "staged_intake_items, kicks off AI extraction + property matching, "
                "and logs an interaction for entity-scoped memory."
            ),
            "tags": ["intake"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/IntakeStageOmInputs"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Intake staged + extraction kicked off",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/IntakeStageOmResponse"}
                        }
                    },
                },
                "400": {"description": "Invalid input"},
                "413": {"description": "Payload too large (>25MB)"},
                "500": {"description": "Server error"},
            },
        }
    },
    "/api/intake/finalize-om": {
        "post": {
            "operationId": "intakeFinalizeOm",
            "summary": "Finalize staged OM intake",
            "description": "Idempotent status probe. Flips the staged inbox_item from 'new' to 'triaged'.",
            "tags": ["intake"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/IntakeFinalizeOmInputs"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Finalized",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/IntakeFinalizeOmResponse"}
                        }
                    },
                }
            },
        }
    },
    "/api/context/retrieve-entity": {
        "post": {
            "operationId": "contextRetrieveEntity",
            "summary": "Retrieve full entity context (timeline + open work + recent inbox)",
            "description": (
                "THE memory-retrieval action. Call at the start of any conversation "
                "that mentions a specific contact, property, or organization."
            ),
            "tags": ["context"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/RetrieveEntityContextInputs"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Context retrieved",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/RetrieveEntityContextResponse"}
                        }
                    },
                }
            },
        }
    },
    "/api/memory/log-turn": {
        "post": {
            "operationId": "memoryLogTurn",
            "summary": "Log an agent-worthy insight, preference, or commitment",
            "description": "Explicit memory write. Use to capture context the agent decides should persist across conversations.",
            "tags": ["context"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/MemoryLogTurnInputs"}
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Turn logged",
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/MemoryLogTurnResponse"}
                        }
                    },
                }
            },
        }
    },
}

NEW_SCHEMAS = {
    "IntakeStageOmInputs": {
        "type": "object",
        "required": ["intake_source", "intake_channel", "artifacts"],
        "properties": {
            "intake_source":  {"type": "string", "enum": ["copilot"]},
            "intake_channel": {"type": "string", "enum": ["copilot_chat", "outlook", "teams"]},
            "intent":         {"type": "string", "description": "Free-text description of the upload context."},
            "artifacts": {
                "type": "object",
                "required": ["primary_document"],
                "properties": {
                    "primary_document": {
                        "type": "object",
                        "required": ["bytes_base64", "file_name"],
                        "properties": {
                            "bytes_base64": {
                                "type": "string",
                                "description": "Base64-encoded PDF bytes. Maximum ~25 MB decoded size. Strip the data:<mime>;base64, prefix before sending.",
                            },
                            "file_name": {"type": "string"},
                            "mime_type": {"type": "string"},
                            "sha256":    {"type": "string"},
                        },
                    }
                },
            },
            "seed_data": {
                "type": "object",
                "description": "Optional pre-extracted property hints.",
                "properties": {
                    "entity_id": {"type": "string", "format": "uuid"},
                    "property": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "address": {
                                "type": "object",
                                "properties": {
                                    "line1":       {"type": "string"},
                                    "city":        {"type": "string"},
                                    "state":       {"type": "string"},
                                    "postal_code": {"type": "string"},
                                },
                            },
                        },
                    },
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            },
            "copilot_metadata": {
                "type": "object",
                "properties": {
                    "conversation_id": {"type": "string"},
                    "message_id":      {"type": "string"},
                    "model":           {"type": "string"},
                    "run_id":          {"type": "string"},
                },
            },
        },
    },
    "IntakeStageOmResponse": {
        "type": "object",
        "properties": {
            "ok":     {"type": "boolean"},
            "status": {"type": "string", "enum": ["received", "partial"]},
            "intake_id":             {"type": "string", "format": "uuid"},
            "staged_intake_item_id": {"type": "string", "format": "uuid"},
            "inbox_item_id":         {"type": "string", "format": "uuid"},
            "extraction_status":     {"type": "string", "enum": ["processing", "review_required", "failed"]},
            "classified_domain": {
                "type": "string",
                "nullable": True,
                "enum": ["dialysis", "government", "netlease"],
                "description": "Domain inferred from OM content. May be null while extraction is still running.",
            },
            "matched_entity_id":   {"type": "string", "nullable": True},
            "entity_match_status": {"type": "string", "enum": ["matched", "unmatched", "pending"]},
            "size_bytes":          {"type": "integer"},
            "message":             {"type": "string"},
        },
    },
    "IntakeFinalizeOmInputs": {
        "type": "object",
        "required": ["staged_intake_item_id", "confirm_upload_complete"],
        "properties": {
            "staged_intake_item_id":    {"type": "string", "format": "uuid"},
            "confirm_upload_complete":  {"type": "boolean"},
            "intake_channel":           {"type": "string", "enum": ["copilot_chat", "outlook", "teams"]},
            "notes":                    {"type": "string"},
        },
    },
    "IntakeFinalizeOmResponse": {
        "type": "object",
        "properties": {
            "ok":                    {"type": "boolean"},
            "status":                {"type": "string", "enum": ["queued", "processing"]},
            "staged_intake_item_id": {"type": "string", "format": "uuid"},
            "intake_id":             {"type": "string", "format": "uuid"},
            "extraction_status":     {"type": "string"},
            "classified_domain":     {"type": "string", "nullable": True},
            "matched_entity_id":     {"type": "string", "nullable": True},
            "message":               {"type": "string"},
        },
    },
    "RetrieveEntityContextInputs": {
        "type": "object",
        "properties": {
            "entity_id":   {"type": "string", "format": "uuid"},
            "entity_name": {"type": "string"},
            "entity_type": {"type": "string", "enum": ["contact", "property", "organization"]},
            "window_days": {"type": "integer", "default": 90, "minimum": 1, "maximum": 730},
            "interaction_limit": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100},
        },
    },
    "RetrieveEntityContextResponse": {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "entity": {
                "type": "object",
                "properties": {
                    "id":           {"type": "string"},
                    "entity_type":  {"type": "string"},
                    "display_name": {"type": "string"},
                    "domain":       {"type": "string", "nullable": True},
                    "metadata":     {"type": "object"},
                },
            },
            "resolve_notes":       {"type": "object",  "nullable": True},
            "last_touchpoint_at":  {"type": "string",  "format": "date-time", "nullable": True},
            "recent_interactions": {"type": "array",   "items": {"type": "object"}},
            "open_action_items":   {"type": "array",   "items": {"type": "object"}},
            "recent_inbox_items":  {"type": "array",   "items": {"type": "object"}},
            "property_enrichment": {"type": "object",  "nullable": True},
            "window_days":         {"type": "integer"},
            "message":             {"type": "string"},
        },
    },
    "MemoryLogTurnInputs": {
        "type": "object",
        "required": ["summary", "channel"],
        "properties": {
            "summary":     {"type": "string"},
            "turn_text":   {"type": "string"},
            "entity_id":   {"type": "string", "format": "uuid"},
            "entity_name": {"type": "string"},
            "channel":     {"type": "string", "enum": ["copilot_chat", "outlook", "teams", "sidebar"]},
            "kind":        {"type": "string", "enum": ["preference", "insight", "commitment", "objection", "note"], "default": "note"},
            "metadata":    {"type": "object"},
        },
    },
    "MemoryLogTurnResponse": {
        "type": "object",
        "properties": {
            "ok":                {"type": "boolean"},
            "activity_event_id": {"type": "string", "format": "uuid", "nullable": True},
            "entity_id":         {"type": "string", "format": "uuid", "nullable": True},
            "fallback_category": {"type": "boolean"},
            "message":           {"type": "string"},
        },
    },
}


def main() -> int:
    spec = json.loads(EXISTING.read_text())

    # Safety check: don't overwrite existing operations with the same opId.
    existing_op_ids = {
        op.get("operationId")
        for p in spec.get("paths", {}).values()
        for op in p.values()
        if isinstance(op, dict) and "operationId" in op
    }
    new_op_ids = {
        op["post"]["operationId"] for op in NEW_PATHS.values()
    }
    collisions = existing_op_ids & new_op_ids
    if collisions:
        print(f"ERROR: operationId collision with existing spec: {collisions}", file=sys.stderr)
        return 1

    # Same for schemas
    existing_schemas = set(spec.get("components", {}).get("schemas", {}).keys())
    new_schema_names = set(NEW_SCHEMAS.keys())
    schema_collisions = existing_schemas & new_schema_names
    if schema_collisions:
        print(f"WARN: schema name collision (will replace): {schema_collisions}", file=sys.stderr)

    # Bump version
    spec["info"]["version"] = "1.1.0"
    spec["info"]["description"] = spec["info"].get("description", "").strip() + (
        " — v1.1.0 adds inline-base64 OM intake, entity-scoped memory retrieval, "
        "and explicit conversational memory logging (2026-04-21)."
    )

    # Merge paths
    spec.setdefault("paths", {})
    for path, path_item in NEW_PATHS.items():
        if path in spec["paths"]:
            print(f"WARN: path {path} already exists, merging operations", file=sys.stderr)
            spec["paths"][path].update(path_item)
        else:
            spec["paths"][path] = path_item

    # Merge schemas
    spec.setdefault("components", {}).setdefault("schemas", {})
    spec["components"]["schemas"].update(NEW_SCHEMAS)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(spec, indent=2))

    print(f"Merged spec written to: {OUTPUT}")
    print(f"Total paths:        {len(spec['paths'])}")
    print(f"Total operationIds: {len(existing_op_ids) + len(new_op_ids)}")
    print(f"Total schemas:      {len(spec['components']['schemas'])}")
    print(f"New operations added: {sorted(new_op_ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
