"""
main.py — BOV Generator API (FastAPI)

POST /generate-bov
  Generates a BOV workbook, recalculates all formulas via LibreOffice, and
  returns the completed file as a base64-encoded payload in JSON.  Claude
  decodes the bytes and delivers the file directly to the user — no external
  storage or Microsoft app registration required.

GET /health
  Liveness check.

Authentication: X-API-Key header must match the BOV_API_KEY env var.
"""

import base64
import os
import sys
import tempfile
import logging
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ── Ensure local modules are importable ───────────────────────────────────────
_HERE = Path(__file__).parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from build_bov_nnn import build_nnn
from build_bov_mob import build_mob
from populate      import fill_assumptions
from recalc_runner import recalc_and_validate, RecalcError

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bov-generator")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BOV Generator API",
    description="Generates Briggs CRE BOV workbooks and returns the completed file as a base64-encoded payload.",
    version="1.0.0",
)

BOV_API_KEY = os.environ.get("BOV_API_KEY", "")


# ── Auth ──────────────────────────────────────────────────────────────────────
def verify_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if not BOV_API_KEY:
        raise HTTPException(status_code=500, detail="BOV_API_KEY not configured on server")
    if x_api_key != BOV_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ── Request / Response models ─────────────────────────────────────────────────
class PropertyInput(BaseModel):
    address:     str            = Field(..., description="Street address — used in filename and Cover tab")
    city_state:  str            = Field("",  description="City, ST — used on Cover tab")
    building_sf: Optional[float]= Field(None, description="Rentable SF per lease or survey")
    close_date:  str            = Field("",   description="YYYY-MM-DD — estimated close date")


class TenantInput(BaseModel):
    name:           str            = Field("",    description="Tenant trade name")
    guarantor:      str            = Field("",    description="Corporate or personal guarantor")
    suite:          str            = Field("",    description="Suite number or description (MOB)")
    sf:             Optional[float]= Field(None,  description="Leased SF for this tenant (MOB)")
    lease_type:     str            = Field("NNN", description="NNN | NN | MG | Gross")
    year1_rent:     Optional[float]= Field(None,  description="Year 1 annual base rent ($)")
    escalation_pct: Optional[float]= Field(None,  description="Annual rent escalation (0.02 = 2%)")
    reimbursements: Optional[float]= Field(0.0,   description="Annual tenant reimbursements (NNN = 0)")
    mgmt_fee_pct:   Optional[float]= Field(0.0,   description="Management fee % of EGR (NNN only)")


class UnderwritingInput(BaseModel):
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
    last_name:  str = Field(..., description="Client last name — used in filename")
    file_month: str = Field(..., description="YYYYMM — used in filename (e.g. 202607)")


class BOVRequest(BaseModel):
    asset_type:   str               = Field(..., description="NNN | MOB")
    property:     PropertyInput
    tenants:      List[TenantInput] = Field(default_factory=list)
    underwriting: UnderwritingInput
    client:       ClientInput


class BOVResponse(BaseModel):
    status:        str
    filename:      str
    file_base64:   str  = Field(..., description="Base64-encoded .xlsx — decode and save as the filename above")
    file_size_kb:  float
    recalc_result: dict


# ── Filename helper ───────────────────────────────────────────────────────────
def _make_filename(req: BOVRequest) -> str:
    """
    Produce: [Address]_BOV_[ClientLastName]_[YYYYMM].xlsx
    Address: first part of the property address, spaces → underscores, non-alphanumeric stripped.
    """
    import re
    raw = req.property.address.split(",")[0].strip()
    safe = re.sub(r"[^\w\s-]", "", raw).strip()
    safe = re.sub(r"[\s-]+", "_", safe)
    return f"{safe}_BOV_{req.client.last_name}_{req.client.file_month}.xlsx"


# ── Generate endpoint ─────────────────────────────────────────────────────────
@app.post("/generate-bov", response_model=BOVResponse, dependencies=[Depends(verify_api_key)])
async def generate_bov(req: BOVRequest):
    asset_type = req.asset_type.upper()
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

        # 4 — Read file and base64-encode for return
        try:
            raw_bytes = Path(output_path).read_bytes()
            file_b64  = base64.b64encode(raw_bytes).decode("ascii")
            size_kb   = round(len(raw_bytes) / 1024, 1)
            log.info("Returning %s KB base64-encoded (%s)", size_kb, filename)
        except Exception as e:
            log.exception("File read failed")
            raise HTTPException(status_code=500, detail=f"File read failed: {e}")

    return BOVResponse(
        status        = "success",
        filename      = filename,
        file_base64   = file_b64,
        file_size_kb  = size_kb,
        recalc_result = recalc_result,
    )


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "bov-generator", "version": "1.0.0"}


# ── OpenAPI override (adds X-API-Key to schema for Claude Project registration) ──
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
