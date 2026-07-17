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
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.responses import JSONResponse, FileResponse
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
    address:     str            = Field(..., description="Street address — used on Cover tab")
    city_state:  str            = Field("",  description="City, ST — used in filename and Cover tab")
    building_sf: Optional[float]= Field(None, description="Rentable SF per lease or survey")
    close_date:  str            = Field("",   description="YYYY-MM-DD — estimated close date")
    name:        str            = Field("",   description="Property/deal name for filename & Cover (e.g. 'Valley MOB', 'Dollar General'); defaults to tenant name (NNN) or address (MOB)")


class RentPeriodInput(BaseModel):
    label:       str            = Field("",   description="Period label, e.g. 'Year 1', 'Option 1'")
    start_date:  str            = Field("",   description="YYYY-MM-DD period start")
    end_date:    str            = Field("",   description="YYYY-MM-DD period end")
    annual_rent: Optional[float]= Field(None, description="Annual rent for this period ($)")
    status:      str            = Field("Contracted", description="Contracted | Option | Renewal | Projected")


class LeaseAbstractInput(BaseModel):
    """
    Executed-lease provisions for the Lease Abstract tab (Leg 2). All optional —
    identification and economics (tenant/guarantor, lease type, commencement,
    expiration, Year-1 rent, escalations, remaining term, leased SF, rent/SF) are
    auto-derived from the tenant's existing fields + `property`; the provisions
    below fill the rest of the short-form summary and long-form article abstract.
    """
    # ── Identification ───────────────────────────────────────────────────────
    tenant_of_record:   str = Field("", description="Legal tenant entity if different from the trade name")
    landlord_of_record: str = Field("", description="Landlord / lessor of record")
    execution_date:     str = Field("", description="Lease execution date (free text or YYYY-MM-DD)")
    # ── Premises ─────────────────────────────────────────────────────────────
    permitted_use:      str = Field("", description="Exclusive / permitted use")
    prohibited_uses:    str = Field("", description="Prohibited uses")
    leased_sf_per_survey: str = Field("", description="Leased SF per survey (if it differs from lease)")
    # ── Rent ─────────────────────────────────────────────────────────────────
    rent_commencement_date: str = Field("", description="Rent commencement date")
    rent_abatement:     str = Field("", description="Rent abatement / free rent")
    percentage_rent:    str = Field("", description="Percentage rent, if any")
    # ── Expense structure ────────────────────────────────────────────────────
    lease_structure:    str = Field("", description="NNN / NN / Gross / MG — defaults to the tenant's lease_type")
    taxes_responsibility:    str = Field("", description="Real estate taxes — responsibility")
    insurance_responsibility:str = Field("", description="Insurance — responsibility")
    cam_responsibility:      str = Field("", description="CAM / maintenance — responsibility")
    capital_responsibility:  str = Field("", description="Capital / roof / structure — responsibility")
    expense_cap:        str = Field("", description="Expense cap, if any")
    landlord_obligations: str = Field("", description="Landlord obligations / responsibilities")
    # ── Options & renewals ───────────────────────────────────────────────────
    num_renewal_options: str = Field("", description="Number of renewal options, e.g. '4'")
    option_term_length:  str = Field("", description="Option term length, e.g. '5 years'")
    renewal_rent_method: str = Field("", description="Renewal rent method, e.g. 'Fixed steps', 'FMV'")
    renewal_notice:      str = Field("", description="Renewal notice requirement")
    option_to_purchase:  str = Field("", description="Option to purchase")
    rofr:               str = Field("", description="Right of first refusal")
    rofo:               str = Field("", description="Right of first offer")
    # ── Assignment & subletting ──────────────────────────────────────────────
    assignment_rights:  str = Field("", description="Assignment rights")
    subletting_rights:  str = Field("", description="Subletting rights")
    change_of_control:  str = Field("", description="Change-of-control provisions")
    guarantor_release:  str = Field("", description="Release of guarantor on assignment")
    # ── Termination & default ────────────────────────────────────────────────
    early_termination:  str = Field("", description="Early termination right")
    termination_fee:    str = Field("", description="Termination fee / penalty")
    default_cure:       str = Field("", description="Default / cure periods")
    co_tenancy:         str = Field("", description="Co-tenancy provisions")
    go_dark:            str = Field("", description="Go-dark provision")
    # ── Other provisions ─────────────────────────────────────────────────────
    ti_allowance:       str = Field("", description="TI allowance / landlord work")
    signage_rights:     str = Field("", description="Signage rights")
    parking_allocation: str = Field("", description="Parking allocation")
    snda:               str = Field("", description="Subordination / SNDA / estoppel")
    condemnation:       str = Field("", description="Condemnation provisions")
    casualty:           str = Field("", description="Casualty / damage provisions")
    holdover:           str = Field("", description="Holdover provisions")
    notices:            str = Field("", description="Notices")
    # ── Broker narrative (short-form) ────────────────────────────────────────
    key_lease_strengths: str = Field("", description="Key lease strengths")
    key_lease_risks:     str = Field("", description="Key lease risks")
    broker_commentary:   str = Field("", description="Broker commentary")
    # ── Sourcing ─────────────────────────────────────────────────────────────
    default_source:     str = Field("", description="Label written to the DOCUMENT SOURCE column, e.g. 'Executed Lease', 'Amendment No. 1'")
    # ── Long-form page / section references ──────────────────────────────────
    clause_refs: Optional[Dict[str, Dict[str, str]]] = Field(
        None, description="Per-clause lease references for the long-form PAGE / LEASE SECTION columns, "
                          "keyed by the exact clause label, e.g. "
                          "{'Base Rent — Year 1': {'page': '4', 'section': 'Art. 3.1'}}")


class CreditInput(BaseModel):
    """Tenant/guarantor credit for the Credit tab (Leg 3). All optional; supply what
    reliable public sources support (SEC/10-K, S&P, Moody's, company filings)."""
    # ── Corporate overview ───────────────────────────────────────────────────
    tenant_operator:     str = Field("", description="Operating / trade name")
    entity_lease:        str = Field("", description="Legal entity on the lease")
    parent_company:      str = Field("", description="Parent company (ticker if public)")
    ownership_structure: str = Field("", description="Public / private / PE-owned / franchise")
    headquarters:        str = Field("", description="HQ city, state")
    founded:             str = Field("", description="Year founded")
    total_locations:     str = Field("", description="Total locations / units")
    state_locations:     str = Field("", description="Locations in the subject state")
    business_description: str = Field("", description="1–2 sentence business description")
    years_operation:     str = Field("", description="Years in operation")
    # ── Credit & ratings ─────────────────────────────────────────────────────
    public_private:      str = Field("", description="Public / Private (+ ticker)")
    credit_rating:       str = Field("", description="Combined rating, e.g. 'BBB (S&P) / Baa3 (Moody's)'")
    sp_rating:           str = Field("", description="S&P rating + outlook")
    moodys_rating:       str = Field("", description="Moody's rating + outlook")
    investment_grade:    str = Field("", description="Yes / No")
    ticker:              str = Field("", description="Stock ticker if public")
    market_cap:          str = Field("", description="Market capitalization")
    # ── Financial summary ────────────────────────────────────────────────────
    annual_revenue:      str = Field("", description="Revenue, most recent FY (+ FY end)")
    revenue_prior:       str = Field("", description="Revenue, prior FY")
    revenue_growth:      str = Field("", description="Revenue growth YoY")
    ebitda:              str = Field("", description="EBITDA, most recent FY")
    ebitda_margin:       str = Field("", description="EBITDA margin")
    net_income:          str = Field("", description="Net income, most recent FY")
    total_debt:          str = Field("", description="Total debt")
    total_assets:        str = Field("", description="Total assets")
    net_worth:           str = Field("", description="Net worth / book value")
    cash:                str = Field("", description="Cash & equivalents")
    debt_ebitda:         str = Field("", description="Debt / EBITDA")
    reporting_period:    str = Field("", description="Source / reporting period")
    # ── Unit economics ───────────────────────────────────────────────────────
    auv:                 str = Field("", description="Average unit volume")
    avg_unit_sf:         str = Field("", description="Average unit SF")
    rent_to_sales:       str = Field("", description="Rent-to-sales ratio (this location)")
    occupancy_cost:      str = Field("", description="Typical store occupancy cost")
    franchise_corporate: str = Field("", description="Franchise vs. corporate")
    local_market:        str = Field("", description="Local market performance")
    # ── Guaranty ─────────────────────────────────────────────────────────────
    guarantor:           str = Field("", description="Guarantor name")
    guarantor_type:      str = Field("", description="Corporate / Personal")
    guaranty_type:       str = Field("", description="Full / Partial / Springing / Burn-off")
    guaranty_strength:   str = Field("", description="Guaranty strength summary")
    guaranty_cap:        str = Field("", description="Guaranty cap ($)")
    guarantor_net_worth: str = Field("", description="Guarantor net worth")
    # ── Qualitative ──────────────────────────────────────────────────────────
    essential_recession: str = Field("", description="Essential / recession-resistant summary")
    industry_trends:     str = Field("", description="Industry / sector trends")
    online_exposure:     str = Field("", description="Online / omnichannel exposure")
    key_strengths:       str = Field("", description="Key credit strengths")
    key_risks:           str = Field("", description="Key credit risks")
    broker_commentary:   str = Field("", description="Broker commentary")
    default_source:      str = Field("", description="Default SOURCE label, e.g. 'S&P Global / FY2025 10-K'")


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
    lease_commencement: str        = Field("",    description="YYYY-MM-DD lease commencement (Rent Schedule)")
    lease_expiration:   str        = Field("",    description="YYYY-MM-DD lease expiration (Rent Schedule)")
    credit_rating:      str        = Field("",    description="Tenant/guarantor credit rating, e.g. 'BBB (S&P) / Baa2 (Moody's)'")
    rent_schedule: Optional[List[RentPeriodInput]] = Field(
        None, description="Exact contracted rent by period; if omitted, computed from year1_rent x escalation")
    abstract: Optional[LeaseAbstractInput] = Field(
        None, description="Executed-lease provisions auto-filled into the Lease Abstract tab")
    credit: Optional[CreditInput] = Field(
        None, description="Tenant/guarantor credit auto-filled into the Credit tab")


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


class CompInput(BaseModel):
    """A single comparable sale for the Real Estate tab's Market Comps block."""
    summary:    str            = Field("",   description="One-line comp description; if omitted, composed from the fields below")
    address:    str            = Field("",   description="Comp property address or name")
    sale_price: Optional[float]= Field(None, description="Sale price ($)")
    price_sf:   Optional[float]= Field(None, description="Price per SF ($)")
    cap_rate:   Optional[float]= Field(None, description="Cap rate (0.0675 = 6.75%)")
    sale_date:  str            = Field("",   description="Sale date (free text or YYYY-MM-DD)")
    source:     str            = Field("",   description="Comp source, e.g. CoStar, public records")


class RealEstateInput(BaseModel):
    """
    Physical / location / market diligence for the Real Estate tab (Leg 1).
    Every field is optional — whatever is supplied is auto-filled into the
    short-form summary and long-form diligence matrix; the rest stays a blank
    broker-input cell. Address and building SF are pulled from `property`.
    """
    # ── Building & improvements ──────────────────────────────────────────────
    year_built:            Optional[int]  = Field(None, description="Year the building was constructed")
    year_renovated:        Optional[int]  = Field(None, description="Year of most recent major renovation")
    construction_type:     str            = Field("",   description="e.g. Masonry / steel frame, wood frame")
    roof:                  str            = Field("",   description="Roof type / age")
    hvac:                  str            = Field("",   description="HVAC type / age")
    condition:             str            = Field("",   description="Overall physical condition")
    deferred_maintenance:  str            = Field("",   description="Known deferred maintenance")
    ada_compliance:        str            = Field("",   description="ADA compliance status")
    # ── Site characteristics ─────────────────────────────────────────────────
    site_area_acres:       Optional[float]= Field(None, description="Site / land area in acres")
    parcel_apn:            str            = Field("",   description="Parcel APN / Tax ID")
    legal_description:     str            = Field("",   description="Legal description summary")
    lot_configuration:     str            = Field("",   description="Lot configuration / shape")
    frontage_lf:           Optional[float]= Field(None, description="Street frontage in linear feet")
    topography:            str            = Field("",   description="Topography")
    flood_zone:            str            = Field("",   description="FEMA flood zone designation, e.g. 'Zone X'")
    utilities:             str            = Field("",   description="Utilities available")
    # ── Zoning & land use ────────────────────────────────────────────────────
    zoning:                str            = Field("",   description="Zoning classification code")
    zoning_description:    str            = Field("",   description="Plain-language zoning / permitted use")
    permitted_use_confirmation: str       = Field("",   description="Permitted use confirmation")
    drive_through_permitted:    str       = Field("",   description="Drive-through permitted (Yes/No/N.A.)")
    signage_rights:        str            = Field("",   description="Signage rights")
    restrictive_covenants: str            = Field("",   description="Restrictive covenants / CC&Rs")
    easements:             str            = Field("",   description="Recorded easements")
    # ── Ingress / egress / parking ───────────────────────────────────────────
    access_points:         str            = Field("",   description="Number / description of access points")
    shared_access:         str            = Field("",   description="Shared / reciprocal access")
    parking_spaces:        Optional[int]  = Field(None, description="Total parking spaces")
    parking_ratio:         Optional[float]= Field(None, description="Parking ratio per 1,000 SF; auto-computed from spaces + building SF if omitted")
    delivery_loading:      str            = Field("",   description="Delivery / loading access")
    # ── Location & market ────────────────────────────────────────────────────
    county:                str            = Field("",   description="County")
    msa_submarket:         str            = Field("",   description="MSA / submarket")
    population_1_3_5:      str            = Field("",   description="Population 1 / 3 / 5 mile rings")
    median_hh_income:      str            = Field("",   description="Median household income")
    traffic_counts:        str            = Field("",   description="Traffic counts (VPD)")
    proximity_demand_generators: str      = Field("",   description="Proximity to demand generators")
    market_rent_context:   str            = Field("",   description="Market rent context")
    # ── Environmental ────────────────────────────────────────────────────────
    environmental_status:  str            = Field("",   description="Short-form environmental status summary")
    phase_i:               str            = Field("",   description="Phase I ESA status")
    phase_ii:              str            = Field("",   description="Phase II ESA status")
    known_recs:            str            = Field("",   description="Known recognized environmental conditions (RECs)")
    underground_storage_tanks: str        = Field("",   description="Underground storage tanks")
    # ── Market comps ─────────────────────────────────────────────────────────
    comps:                 List[CompInput]= Field(default_factory=list, description="Up to 3 comparable sales")
    implied_market_cap_rate: Optional[float]= Field(None, description="Implied market cap rate from comps (0.07 = 7%)")
    implied_market_price_sf: Optional[float]= Field(None, description="Implied market price / SF from comps ($)")
    # ── Broker narrative (short-form) ────────────────────────────────────────
    notable_strengths:     str            = Field("",   description="Notable strengths")
    notable_concerns:      str            = Field("",   description="Notable concerns")
    broker_commentary:     str            = Field("",   description="Broker commentary")
    # ── Sourcing ─────────────────────────────────────────────────────────────
    default_source:        str            = Field("",   description="Default label written to the SOURCE column for auto-filled rows, e.g. 'Appraisal', 'CoStar', 'Public records'")


class BOVRequest(BaseModel):
    asset_type:   str               = Field(..., description="NNN | MOB")
    property:     PropertyInput
    tenants:      List[TenantInput] = Field(default_factory=list)
    underwriting: UnderwritingInput
    client:       ClientInput
    real_estate:  Optional[RealEstateInput] = Field(
        None, description="Optional physical / location / market diligence auto-filled into the Real Estate tab")


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
