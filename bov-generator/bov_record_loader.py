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

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


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
