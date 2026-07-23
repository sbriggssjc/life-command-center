"""
main.py — BOV Generator API (FastAPI)

POST /generate-bov
  Generates a BOV workbook, recalculates all formulas via LibreOffice, and
  returns BOTH:
    - a short-lived download_url (served by GET /download/{token}), suitable
      for MCP/Claude Project delivery where a clickable link is needed; and
    - file_base64 (backward compatible with the Cowork decode-and-deliver flow).

GET /download/{token}
  Serves a previously generated workbook by its unguessable token. No API key
  required (so a browser click works), but tokens are high-entropy (uuid4) and
  files expire after DOWNLOAD_TTL_SECONDS.

GET /health
  Liveness check.

Authentication: X-API-Key header must match the BOV_API_KEY env var (generate only).
"""

import base64
import os
import sys
import time
import uuid
import shutil
import tempfile
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field, ConfigDict

# ── Ensure local modules are importable ───────────────────────────────────────
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from build_bov_nnn import build_nnn
from build_bov_mob import build_mob
from populate      import fill_assumptions
from recalc_runner import recalc_and_validate, RecalcError

# R58 Unit 4 (2C) — optional {cre_property_id} input path. Loading the loader is
# guarded so the generator still boots even if the module/env isn't present (the
# hand-authored payload path is unaffected).
try:
    from bov_record_loader import load_bov_record, resolve_property_id, BovRecordError
    _UNIT4_LOADER = True
except Exception:  # noqa: BLE001
    _UNIT4_LOADER = False
    class BovRecordError(Exception):
        def __init__(self, message: str, status: int = 502):
            super().__init__(message); self.status = status

# Comps population engine — the shared comps tool (mirrors the BOV generator).
try:
    from comps_generator import populate_comps, CompsError
    _COMPS_ENGINE = True
except Exception:  # noqa: BLE001
    _COMPS_ENGINE = False
    class CompsError(Exception):
        def __init__(self, message, status=422):
            super().__init__(message); self.status = status

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bov-generator")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BOV Generator API",
    description="Generates Briggs CRE BOV workbooks; returns a short-lived download link and a base64 payload.",
    version="1.1.0",
)

BOV_API_KEY = os.environ.get("BOV_API_KEY", "")

# Public base URL used to build absolute download links.  Set PUBLIC_BASE_URL in
# Railway (e.g. https://pacific-love-production-f6b9.up.railway.app).  Falls back
# to the incoming request's base URL if unset.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")

# Where generated workbooks are held for download.  On disk (not in-memory) so
# it is shared across uvicorn workers within the same container.
DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "bov_downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOAD_TTL_SECONDS = int(os.environ.get("DOWNLOAD_TTL_SECONDS", "3600"))  # 60 min default


# ── Auth ──────────────────────────────────────────────────────────────────────
def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if not BOV_API_KEY:
        raise HTTPException(status_code=500, detail="BOV_API_KEY not configured on server")
    if x_api_key != BOV_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ── Download store helpers ────────────────────────────────────────────────────
def _sweep_expired_downloads() -> None:
    """Delete download folders older than the TTL.  Best-effort; never raises."""
    now = time.time()
    try:
        for token_dir in DOWNLOAD_DIR.iterdir():
            if not token_dir.is_dir():
                continue
            try:
                age = now - token_dir.stat().st_mtime
                if age > DOWNLOAD_TTL_SECONDS:
                    shutil.rmtree(token_dir, ignore_errors=True)
            except FileNotFoundError:
                continue
    except Exception:
        log.warning("Download sweep skipped", exc_info=True)


def _store_for_download(raw_bytes: bytes, filename: str) -> str:
    """Persist the workbook under a fresh token and return the token."""
    token = uuid.uuid4().hex
    dest_dir = DOWNLOAD_DIR / token
    dest_dir.mkdir(parents=True, exist_ok=True)
    (dest_dir / filename).write_bytes(raw_bytes)
    return token


def _base_url(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


# ── Request / Response models ─────────────────────────────────────────────────
class PropertyInput(BaseModel):
    # extra='allow' so rich intake fields ride through model_dump() into the
    # dict fill_assumptions consumes (Unit-4 records carry more than the columns).
    model_config = ConfigDict(extra="allow")
    address:     str            = Field(..., description="Street address — used on Cover tab")
    city_state:  str            = Field("",  description="City, ST — used in filename and Cover tab")
    building_sf: Optional[float]= Field(None, description="Rentable SF per lease or survey")
    close_date:  str            = Field("",   description="YYYY-MM-DD — estimated close date")
    name:        str            = Field("",   description="Property/deal name for filename & Cover (e.g. 'Valley MOB', 'Dollar General'); defaults to tenant name (NNN) or address (MOB)")


class RentPeriodInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    label:       str            = Field("",   description="Period label, e.g. 'Year 1', 'Option 1'")
    start_date:  str            = Field("",   description="YYYY-MM-DD period start")
    end_date:    str            = Field("",   description="YYYY-MM-DD period end")
    annual_rent: Optional[float]= Field(None, description="Annual rent for this period ($)")
    status:      str            = Field("Contracted", description="Contracted | Option | Renewal | Projected")


class TenantInput(BaseModel):
    # extra='allow' carries abstract / credit / clause_refs (Unit-4 lease record)
    # through to the Lease Abstract + Credit tabs.
    model_config = ConfigDict(extra="allow")
    name:           str            = Field("",    description="Tenant trade name")
    guarantor:      str            = Field("",    description="Corporate or personal guarantor")
    suite:          str            = Field("",    description="Suite number or description (MOB)")
    sf:             Optional[float]= Field(None,  description="Leased SF for this tenant (MOB)")
    lease_type:     str            = Field("NNN", description="NNN | NN | MG | Gross")
    year1_rent:     Optional[float]= Field(None,  description="Year 1 annual base rent ($)")
    escalation_pct: Optional[float]= Field(None,  description="Annual rent escalation (0.02 = 2%)")
    reimbursements: Optional[float]= Field(0.0,   description="Annual tenant reimbursements (NNN = 0)")
    mgmt_fee_pct:   Optional[float]= Field(0.0,   description="Management fee % of EGR (NNN only)")
    lease_commencement: str        = Field("",    description="YYYY-MM-DD lease commencement (Rent Schedule)")
    lease_expiration:   str        = Field("",    description="YYYY-MM-DD lease expiration (Rent Schedule)")
    rent_schedule: Optional[List[RentPeriodInput]] = Field(
        None, description="Exact contracted rent by period; if omitted, computed from year1_rent x escalation")


class UnderwritingInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    vacancy_pct:        Optional[float]= Field(0.05,  description="Vacancy/credit loss % (MOB)")
    capital_reserves:   Optional[float]= Field(0.0,   description="Annual capital reserves ($)")
    purchase_price:     Optional[float]= Field(None,  description="Purchase price ($)")
    going_in_cap:       Optional[float]= Field(None,  description="Going-in / asking cap rate (0.065 = 6.5%)")
    exit_cap:           Optional[float]= Field(None,  description="Exit / disposition cap rate")
    hold_years:         int            = Field(10,    description="Hold period (years)")
    ltv:                Optional[float]= Field(0.65,  description="Loan-to-value ratio")
    interest_rate:      Optional[float]= Field(0.065, description="Mortgage interest rate")
    amortization_years: int            = Field(25,    description="Amortization period (years)")
    # MOB-specific expense inputs
    real_estate_taxes:  Optional[float]= Field(0.0,   description="Annual RE taxes — LL-responsible (MOB)")
    insurance:          Optional[float]= Field(0.0,   description="Annual insurance — LL-responsible (MOB)")
    cam:                Optional[float]= Field(0.0,   description="Annual CAM/maintenance — LL-responsible (MOB)")
    mgmt_fee_pct:       Optional[float]= Field(0.04,  description="Mgmt fee % of EGI (MOB, default 4%)")


class ClientInput(BaseModel):
    model_config = ConfigDict(extra="allow")
    last_name:  str = Field(..., description="Client last name — used in filename")
    file_month: str = Field(..., description="YYYYMM — used in filename (e.g. 202607)")


class BOVRequest(BaseModel):
    # extra='allow' so top-level intake keys (real_estate, credit, source hints)
    # survive model_dump() into the fill_assumptions dict.
    model_config = ConfigDict(extra="allow")
    # asset_type / property / underwriting / client are OPTIONAL only so a
    # {cre_property_id: N} body validates; they are REQUIRED-in-effect and checked
    # after the Unit-4 record (if any) is merged in — a request missing them still
    # 422s, just with a clearer message.
    asset_type:   Optional[str]           = Field(None, description="NNN | MOB")
    property:     Optional[PropertyInput] = None
    tenants:      List[TenantInput]       = Field(default_factory=list)
    underwriting: Optional[UnderwritingInput] = None
    client:       Optional[ClientInput]   = None
    # R58 Unit 4 (2C): load lease/dd/om data from the reviewed extraction record
    # instead of hand-authoring the body. Mutually sufficient with a full payload;
    # posted fields override the loaded record (e.g. a client/close_date override).
    cre_property_id: Optional[int]        = Field(None, description="LCC Opps lcc_cre_properties.id — load the reviewed Unit-4 BOV record")
    # Capability-parity: any entry point can pass a property_lookup (an address, or
    # the numeric id as a string) and the server resolves it to cre_property_id →
    # loads the reviewed record. So "BOV 207 Fob James Dr" produces the identical
    # workbook from every surface with no client-side lookup.
    property_lookup: Optional[str]        = Field(None, description="Address (or numeric id) to resolve to the LCC property record — e.g. '207 Fob James Dr, Valley, AL'")


class BOVResponse(BaseModel):
    status:             str
    filename:           str
    download_url:       str   = Field(..., description="Short-lived link to download the .xlsx — click to save")
    expires_in_seconds: int   = Field(..., description="Seconds until the download link expires")
    file_base64:        str   = Field(..., description="Base64-encoded .xlsx — decode and save as the filename above")
    file_size_kb:       float
    recalc_result:      dict


# ── Filename helper ───────────────────────────────────────────────────────────
def _make_filename(req: BOVRequest) -> str:
    """
    Produce: [Property/Tenant]_[City]_[State]_BOV_[ClientLastName]_[YYYYMM].xlsx
      e.g. CompassusHospice_Roanoke_AL_BOV_Kitchens_202603.xlsx
    Name = property.name, else tenant name (NNN), else first part of the address (MOB).
    Each component has spaces removed and non-alphanumerics stripped.
    """
    import re

    def _clean(s: str) -> str:
        s = re.sub(r"[^\w\s-]", "", str(s or "")).strip()
        return re.sub(r"\s+", "", s)  # remove internal spaces (CompassusHospice)

    prop = req.property
    name = (prop.name or "").strip()
    if not name:
        if req.asset_type.upper() != "MOB" and req.tenants and req.tenants[0].name:
            name = req.tenants[0].name
        else:
            name = prop.address.split(",")[0]

    parts = [_clean(name)]
    cs = (prop.city_state or "").split(",")
    if len(cs) >= 1 and cs[0].strip():
        parts.append(_clean(cs[0]))
    if len(cs) >= 2 and cs[1].strip():
        parts.append(_clean(cs[1]))

    prefix = "_".join(p for p in parts if p)
    client_last = _clean(req.client.last_name)
    return f"{prefix}_BOV_{client_last}_{req.client.file_month}.xlsx"


# ── Generate endpoint ─────────────────────────────────────────────────────────
@app.post("/generate-bov", response_model=BOVResponse, dependencies=[Depends(verify_api_key)])
async def generate_bov(req: BOVRequest, request: Request):
    # Capability-parity — resolve a property_lookup (address or numeric id) to a
    # cre_property_id first, so "BOV 207 Fob James Dr" works from any entry point.
    if req.cre_property_id is None and req.property_lookup:
        if not _UNIT4_LOADER:
            raise HTTPException(status_code=503, detail="property_lookup not available: bov_record_loader/env not configured")
        try:
            req.cre_property_id = resolve_property_id(req.property_lookup)
        except BovRecordError as e:
            raise HTTPException(status_code=getattr(e, "status", 502), detail=str(e))

    # R58 Unit 4 (2C) — {cre_property_id} input: load the reviewed extraction
    # record and merge any explicitly-posted overrides on top. Hand-authored
    # payloads (no cre_property_id) fall straight through unchanged.
    if req.cre_property_id is not None:
        if not _UNIT4_LOADER:
            raise HTTPException(status_code=503, detail="cre_property_id input not available: bov_record_loader/env not configured")
        try:
            base = load_bov_record(req.cre_property_id)
        except BovRecordError as e:
            raise HTTPException(status_code=getattr(e, "status", 502), detail=str(e))
        # exclude_unset → ONLY fields the caller explicitly posted override the
        # loaded record (a non-None default like tenants=[] must NOT wipe the
        # record's tenants).
        overrides = req.model_dump(exclude_unset=True)
        overrides.pop("cre_property_id", None)
        overrides.pop("property_lookup", None)
        merged = {**base, **overrides}
        merged.pop("cre_property_id", None)
        merged.pop("property_lookup", None)
        merged.pop("_source", None)
        try:
            req = BOVRequest(**merged)
        except Exception as e:  # noqa: BLE001 — surface a clear 422 on a bad record shape
            raise HTTPException(status_code=422, detail=f"Loaded Unit-4 record did not form a valid BOV request: {e}")

    # Essentials must be present (whether hand-authored or loaded).
    missing = [f for f in ("asset_type", "property", "underwriting", "client") if getattr(req, f, None) in (None, "")]
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required field(s): {', '.join(missing)} (supply them, or a cre_property_id whose reviewed record contains them)")

    asset_type = (req.asset_type or "").upper()
    if asset_type not in ("NNN", "MOB"):
        raise HTTPException(status_code=422, detail=f"asset_type must be NNN or MOB, got: {req.asset_type}")

    filename = _make_filename(req)
    log.info("Generating %s BOV: %s", asset_type, filename)

    with tempfile.TemporaryDirectory(prefix="bov-gen-") as tmp:
        output_path = os.path.join(tmp, filename)

        # 1 — Build workbook structure
        try:
            if asset_type == "NNN":
                build_nnn(output_path)
            else:
                build_mob(output_path)
            log.info("Workbook built: %s bytes", Path(output_path).stat().st_size)
        except Exception as e:
            log.exception("Build failed")
            raise HTTPException(status_code=500, detail=f"Workbook build failed: {e}")

        # 2 — Populate Assumptions & Flags from request inputs
        try:
            from openpyxl import load_workbook as _lw
            wb = _lw(output_path)
            fill_assumptions(wb, req.model_dump())
            wb.save(output_path)
            wb.close()
            log.info("Assumptions populated")
        except Exception as e:
            log.exception("Populate failed")
            raise HTTPException(status_code=500, detail=f"Assumptions populate failed: {e}")

        # 3 — Recalculate formulas via LibreOffice
        try:
            recalc_result = recalc_and_validate(output_path, timeout=120)
            log.info("Recalc: %s formulas, 0 errors", recalc_result["total_formulas"])
        except RecalcError as e:
            log.error("Recalc failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Recalc failed: {e}")

        # 4 — Read file, base64-encode, and stage for download
        try:
            raw_bytes = Path(output_path).read_bytes()
            file_b64  = base64.b64encode(raw_bytes).decode("ascii")
            size_kb   = round(len(raw_bytes) / 1024, 1)
        except Exception as e:
            log.exception("File read failed")
            raise HTTPException(status_code=500, detail=f"File read failed: {e}")

    # Stage the finished file for link-based download (outside the temp dir).
    _sweep_expired_downloads()
    token        = _store_for_download(raw_bytes, filename)
    download_url = f"{_base_url(request)}/download/{token}"
    log.info("Staged %s KB for download (%s) → token %s", size_kb, filename, token)

    return BOVResponse(
        status             = "success",
        filename           = filename,
        download_url       = download_url,
        expires_in_seconds = DOWNLOAD_TTL_SECONDS,
        file_base64        = file_b64,
        file_size_kb       = size_kb,
        recalc_result      = recalc_result,
    )


# ── Comps endpoint ────────────────────────────────────────────────────────────
# The shared comps engine: the LLM at any access point maps a raw CoStar/Salesforce
# export → structured rows (per Comps_Column_Mapping.md), POSTs them here, and gets
# back the identical populated Briggs comps template — formula columns preserved.
@app.post("/generate-comps", dependencies=[Depends(verify_api_key)])
async def generate_comps(payload: dict, request: Request):
    if not _COMPS_ENGINE:
        raise HTTPException(status_code=503, detail="comps engine not available (comps_generator/templates not deployed)")
    comp_type = str(payload.get("comp_type", "")).lower()
    if comp_type not in ("sales", "lease"):
        raise HTTPException(status_code=422, detail="comp_type must be 'sales' or 'lease'")

    # Filename: [label]_[Sales|Lease]Comps_[YYYYMM].xlsx. label from payload.name or client.
    import re as _re
    label = str(payload.get("name") or payload.get("label")
                or (payload.get("client") or {}).get("last_name") or "Briggs").strip()
    label = _re.sub(r"[^\w\s-]", "", label); label = _re.sub(r"\s+", "", label) or "Briggs"
    month = str((payload.get("client") or {}).get("file_month") or datetime.now().strftime("%Y%m"))
    kind = "SalesComps" if comp_type == "sales" else "LeaseComps"
    filename = f"{label}_{kind}_{month}.xlsx"
    log.info("Generating %s: %s", kind, filename)

    with tempfile.TemporaryDirectory(prefix="comps-gen-") as tmp:
        output_path = os.path.join(tmp, filename)
        try:
            summary = populate_comps(payload, output_path)
        except CompsError as e:
            raise HTTPException(status_code=getattr(e, "status", 422), detail=str(e))
        except Exception as e:  # noqa: BLE001
            log.exception("Comps populate failed")
            raise HTTPException(status_code=500, detail=f"Comps populate failed: {e}")

        try:
            recalc_result = recalc_and_validate(output_path, timeout=120)
        except RecalcError as e:
            log.error("Comps recalc failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Recalc failed: {e}")

        try:
            raw_bytes = Path(output_path).read_bytes()
            file_b64 = base64.b64encode(raw_bytes).decode("ascii")
            size_kb = round(len(raw_bytes) / 1024, 1)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"File read failed: {e}")

    _sweep_expired_downloads()
    token = _store_for_download(raw_bytes, filename)
    download_url = f"{_base_url(request)}/download/{token}"
    log.info("Staged comps %s KB (%s) → %s", size_kb, filename, token)

    return {
        "status": "success",
        "filename": filename,
        "download_url": download_url,
        "expires_in_seconds": DOWNLOAD_TTL_SECONDS,
        "file_base64": file_b64,
        "file_size_kb": size_kb,
        "comp_type": comp_type,
        "rows_by_sheet": summary["sheets"],
        "skipped_formula_keys": summary["skipped_formula_keys"],
        "unknown_keys": summary["unknown_keys"],
        "recalc_result": recalc_result,
    }


# ── Download endpoint ─────────────────────────────────────────────────────────
@app.get("/download/{token}")
async def download_file(token: str):
    # Guard against path traversal — tokens are always plain hex.
    if not token.isalnum():
        raise HTTPException(status_code=404, detail="Not found")

    _sweep_expired_downloads()
    token_dir = DOWNLOAD_DIR / token
    if not token_dir.is_dir():
        raise HTTPException(status_code=404, detail="Link expired or not found")

    files = [p for p in token_dir.iterdir() if p.is_file()]
    if not files:
        raise HTTPException(status_code=404, detail="Link expired or not found")

    target = files[0]
    return FileResponse(
        path       = str(target),
        filename   = target.name,
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "bov-generator", "version": "1.1.0"}


# ── OpenAPI override (adds X-API-Key to schema) ───────────────────────────────
@app.get("/openapi.json", include_in_schema=False)
async def openapi():
    from fastapi.openapi.utils import get_openapi
    schema = get_openapi(
        title       = app.title,
        version     = app.version,
        description = app.description,
        routes      = app.routes,
    )
    schema["components"] = schema.get("components", {})
    schema["components"]["securitySchemes"] = {
        "ApiKeyAuth": {"type": "apiKey", "in": "header", "name": "X-API-Key"}
    }
    schema["security"] = [{"ApiKeyAuth": []}]
    return JSONResponse(schema)
