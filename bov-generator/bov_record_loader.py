"""
bov_record_loader.py — R58 "Unit 4", Step 2C

Loads a reviewed Unit-4 BOV record from LCC Opps (lcc_cre_bov_extraction) and
returns the dict the generator's builders consume (fill_assumptions(req)). This is
what makes "BOV this property" identical across access points: the lease data is
ONE extracted, human-reviewed record — not re-read per request.

Selection order for a property:
    1. newest status='reviewed'   (a human vetted it in the live-ingest UI)
    2. newest status='extracted'  (auto-extracted, not yet reviewed) — allowed only
       when BOV_ALLOW_UNREVIEWED=true (default: reviewed-only, so an unvetted
       extraction never silently drives a client deliverable)

Config (Railway env):
    LCC_OPS_URL          — https://xengecqvemvfknjvbvrq.supabase.co
    LCC_OPS_SERVICE_KEY  — service-role key (RLS is service-key-only on the table)
    BOV_ALLOW_UNREVIEWED — '1'/'true' to permit an 'extracted' (unreviewed) record

No new dependency: uses urllib from the stdlib (the image already has it), so the
generator container needs nothing added.
"""

import json
import os
import urllib.parse
import urllib.request
from typing import Optional, Tuple


class BovRecordError(Exception):
    """Raised when a cre_property_id record can't be loaded (missing config,
    no reviewed record, or a transport error). The API maps this to a clear 4xx/5xx."""

    def __init__(self, message: str, status: int = 502, envelope: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.envelope = envelope


def _config() -> Tuple[str, str]:
    url = (os.environ.get("LCC_OPS_URL") or os.environ.get("OPS_SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("LCC_OPS_SERVICE_KEY")
        or os.environ.get("OPS_SUPABASE_KEY")
        or os.environ.get("OPS_SUPABASE_SERVICE_KEY")
        or ""
    )
    if not url or not key:
        raise BovRecordError(
            "cre_property_id input requires LCC_OPS_URL + LCC_OPS_SERVICE_KEY to be configured",
            status=503,
        )
    return url, key


def _allow_unreviewed() -> bool:
    return str(os.environ.get("BOV_ALLOW_UNREVIEWED", "")).lower() in ("1", "true", "yes")


def _get(url: str, key: str, path: str) -> list:
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001 — surface any transport error uniformly
        raise BovRecordError(f"LCC Opps query failed: {e}", status=502)
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise BovRecordError(f"LCC Opps returned non-JSON: {e}", status=502)
    return data if isinstance(data, list) else []


def _post(url: str, key: str, path: str, payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return
    except Exception:
        return


def _candidate_from_cre_row(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "property_id": row.get("id"),
        "type": "asset",
        "name": row.get("address") or row.get("tenant_brand"),
        "address": row.get("address"),
        "city": row.get("city"),
        "state": row.get("state"),
        "domain": "cre",
        "confidence": 0.95,
        "resolved_via": "bov_cre_address",
    }


def _candidate_from_cre_id(cre_property_id: int, resolved_via: str = "bov_cre_property_id") -> dict:
    return {
        "id": int(cre_property_id),
        "property_id": int(cre_property_id),
        "type": "asset",
        "domain": "cre",
        "confidence": 1.0 if resolved_via == "bov_cre_property_id" else 0.9,
        "resolved_via": resolved_via,
    }


def _envelope(status: str, lookup, entity=None, candidates=None, confidence=0, resolved_via=None, error=None) -> dict:
    return {
        "status": status,
        "entity": entity,
        "type": "asset",
        "confidence": confidence,
        "resolved_via": resolved_via,
        "candidates": candidates or [],
        "raw_ref": lookup,
        **({"error": error} if error else {}),
    }


def _log_resolution(url: str, key: str, lookup, envelope: dict, tool: str = "generate_bov") -> None:
    row = {
        "raw_ref": lookup,
        "status": envelope.get("status"),
        "chosen_entity": (envelope.get("entity") or {}).get("id"),
        "candidates_n": len(envelope.get("candidates") or []),
        "tool": tool,
    }
    print(f"[subject-resolver] {json.dumps(row, default=str)}")
    payload = {
        "surface": "bov",
        "tool": tool,
        "raw_request": str(lookup),
        "raw_args": {"property_lookup": lookup},
        "resolved_subject": {
            "chosen_entity": row["chosen_entity"],
            "candidates_n": row["candidates_n"],
        },
        "resolution_status": row["status"],
        "confidence": envelope.get("confidence"),
        "alternatives": envelope.get("candidates") or [],
    }
    _post(url, key, "interpretation_logs", payload)


def resolve_property_lookup_envelope(lookup) -> dict:
    """
    Resolve `property_lookup` using the shared Subject Resolver envelope:
    resolved / ambiguous / not_on_file. Ambiguity is still enforced by
    resolve_property_id(), which maps this envelope back to the existing 409.
    """
    s = str(lookup or "").strip()
    if not s:
        return _envelope("not_on_file", lookup, error="property_lookup is empty")
    if s.isdigit():
        cid = int(s)
        return _envelope(
            "resolved",
            lookup,
            entity={"id": cid, "property_id": cid, "domain": "cre"},
            candidates=[_candidate_from_cre_id(cid)],
            confidence=1.0,
            resolved_via="bov_cre_property_id",
        )

    url, key = _config()
    parts = [p.strip() for p in s.split(",") if p.strip()]
    street = parts[0] if parts else s
    state = None
    if len(parts) >= 2:
        tail = parts[-1].upper()
        if len(tail) == 2 and tail.isalpha():
            state = tail
    q = f"lcc_cre_properties?select=id,address,city,state,tenant_brand&address=ilike.*{urllib.parse.quote(street)}*"
    if state:
        q += f"&state=eq.{urllib.parse.quote(state)}"
    q += "&limit=25"
    rows = _get(url, key, q)

    if not rows:
        rq = (
            "lcc_cre_bov_extraction?select=cre_property_id"
            f"&record->property->>address=ilike.*{urllib.parse.quote(street)}*&limit=25"
        )
        rec_rows = _get(url, key, rq)
        ids = sorted({r["cre_property_id"] for r in rec_rows if r.get("cre_property_id") is not None})
        if len(ids) == 1:
            cid = int(ids[0])
            return _envelope(
                "resolved",
                lookup,
                entity={"id": cid, "property_id": cid, "domain": "cre"},
                candidates=[_candidate_from_cre_id(cid, "bov_reviewed_record_address")],
                confidence=0.9,
                resolved_via="bov_reviewed_record_address",
            )
        if len(ids) > 1:
            cands = [_candidate_from_cre_id(int(cid), "bov_reviewed_record_address") for cid in ids[:10]]
            return _envelope("ambiguous", lookup, candidates=cands, resolved_via="bov_reviewed_record_address")

    if not rows:
        return _envelope("not_on_file", lookup, error=f"No LCC property matches address '{s}'. Check the address or pass cre_property_id.")
    if len(rows) > 1:
        return _envelope(
            "ambiguous",
            lookup,
            candidates=[_candidate_from_cre_row(r) for r in rows[:10]],
            resolved_via="bov_cre_address",
        )
    cid = int(rows[0]["id"])
    return _envelope(
        "resolved",
        lookup,
        entity={"id": cid, "property_id": cid, "domain": "cre"},
        candidates=[_candidate_from_cre_row(rows[0])],
        confidence=0.95,
        resolved_via="bov_cre_address",
    )


def resolve_property_id(lookup) -> int:
    """
    Resolve a `property_lookup` to a cre_property_id (lcc_cre_properties.id).

    - A numeric value (int or all-digit string) is treated as the id directly.
    - Otherwise it's an ADDRESS: match the street portion (before the first comma)
      against lcc_cre_properties.address, optionally narrowed by a ", ST" state
      suffix if present. Exactly one match → its id. Zero → 404. More than one →
      409 with the candidate list, so the caller disambiguates (never guesses).

    This lives in the generator so EVERY caller (MCP tool, Northmarq Project
    OpenAPI action, Copilot plugin, curl) gets address-or-id resolution for free.
    """
    env = resolve_property_lookup_envelope(lookup)
    try:
        url, key = _config()
        _log_resolution(url, key, lookup, env)
    except BovRecordError:
        print(f"[subject-resolver] {json.dumps({'raw_ref': lookup, 'status': env.get('status'), 'chosen_entity': (env.get('entity') or {}).get('id'), 'candidates_n': len(env.get('candidates') or []), 'tool': 'generate_bov'}, default=str)}")
    if env["status"] == "resolved":
        return int(env["entity"]["property_id"])
    if env["status"] == "ambiguous":
        cands = "; ".join(
            f"id={c.get('property_id')}: {c.get('address') or c.get('name') or '?'}, {c.get('city') or ''} {c.get('state') or ''}".strip()
            for c in (env.get("candidates") or [])[:10]
        )
        raise BovRecordError(
            f"'{str(lookup or '').strip()}' matches {len(env.get('candidates') or [])} properties — pass cre_property_id to disambiguate. Candidates: {cands}",
            status=409,
            envelope=env,
        )
    status = 422 if str(lookup or "").strip() == "" else 404
    raise BovRecordError(env.get("error") or "Property not found", status=status, envelope=env)


def load_bov_record(cre_property_id: int, extractor_version: Optional[str] = None) -> dict:
    """
    Return the BOV request dict for a property, or raise BovRecordError.

    The returned dict is the SAME shape a hand-authored /generate-bov body uses:
        { asset_type, property, tenants[], underwriting, real_estate, ... }
    Note the stored record uses `underwriting_hints`; we surface it as
    `underwriting` (the key fill_assumptions reads) while leaving hints intact.
    """
    url, key = _config()

    filters = [f"cre_property_id=eq.{int(cre_property_id)}"]
    if extractor_version:
        filters.append(f"extractor_version=eq.{urllib.parse.quote(extractor_version)}")
    base = "lcc_cre_bov_extraction?" + "&".join(filters)

    # 1) newest reviewed
    rows = _get(url, key, base + "&status=eq.reviewed&order=reviewed_at.desc,extracted_at.desc&limit=1")
    # 2) fall back to newest extracted only if explicitly allowed
    if not rows and _allow_unreviewed():
        rows = _get(url, key, base + "&status=eq.extracted&order=extracted_at.desc&limit=1")

    if not rows:
        raise BovRecordError(
            f"No reviewed BOV extraction record for cre_property_id={cre_property_id}. "
            f"Run Unit-4 extraction and review it first"
            + ("" if _allow_unreviewed() else " (or set BOV_ALLOW_UNREVIEWED=true to use an unreviewed record)."),
            status=404,
        )

    rec = rows[0].get("record") or {}
    if not isinstance(rec, dict) or not rec:
        raise BovRecordError(f"BOV extraction record for {cre_property_id} is empty/malformed", status=502)

    req = dict(rec)  # shallow copy — don't mutate the stored object shape
    # The stored record names underwriting inputs `underwriting_hints`; the builder
    # reads `underwriting`. Map without clobbering an explicit `underwriting`.
    if "underwriting" not in req and "underwriting_hints" in req:
        req["underwriting"] = req.get("underwriting_hints") or {}
    req.setdefault("_source", {"kind": "unit4_record", "cre_property_id": int(cre_property_id),
                               "status": rows[0].get("status"), "record_id": rows[0].get("id")})
    return req
