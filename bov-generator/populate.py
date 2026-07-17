"""
populate.py — Write JSON inputs into the Assumptions & Flags cells
of a freshly built BOV workbook (before recalc).

NNN cell map (Assumptions & Flags sheet):
  Left side (col C):
    C6  = Property Address
    C7  = Tenant / Operator
    C8  = Guarantor
    C9  = Building SF
    C13 = Estimated Close Date
    C16 = Recommended Asking Cap Rate
    C24 = Year 1 Base Rent
    C25 = Annual Rent Escalation %
    C26 = Tenant Reimbursements
    C30 = Mgmt Fee %
    C31 = Capital / Replacement Reserves
    C36 = Purchase Price
  Right side (col I):
    I6  = Purchase Price
    I7  = LTV %
    I10 = Interest Rate
    I11 = Amortization (years)
    I13 = Hold Period (years)
    I20 = Exit Cap Rate

MOB cell map (Assumptions & Flags sheet):
  Left side (col C):
    C6  = Property Address / Name
    C9  = Total Building SF (GLA)
    C14 = Estimated Close Date
    Per tenant (T1–T5, 9-row stride starting at row 17):
      T1: C18=name, C19=suite, C20=SF, C21=rent, C22=esc%, C23=type, C24=reimb
      T2: C27=name, C28=suite, C29=SF, C30=rent, C31=esc%, C32=type, C33=reimb
      T3: C36..C42  |  T4: C45..C51  |  T5: C54..C60
    C63 = Vacancy / Credit Loss %
    C64 = Portfolio Avg Escalation %
    C69 = Real Estate Taxes ($/yr)
    C70 = Insurance ($/yr)
    C71 = CAM / Janitorial ($/yr)
    C72 = Management Fee %
    C76 = Capital / Replacement Reserves ($/yr)
    C94 = Purchase Price (left-side input)
  Right side (col I):
    I6=purchase_price, I7=LTV, I10=rate, I11=amort, I13=hold, I20=exit_cap

Rent Schedule tab: identification block + per-lease-period grid.
  NNN: ident E6-E12; grid rows 16-45 (C start, D end, E label, F annual, I esc, J status).
  MOB: per-tenant grid begins at row 17 + t*26 (15 rows each).
"""

from datetime import datetime, timedelta
from openpyxl import load_workbook

SHEET = "Assumptions & Flags"


def _date(val: str):
    """Parse YYYY-MM-DD string to Python date; return None if blank/invalid."""
    if not val:
        return None
    try:
        return datetime.strptime(val, "%Y-%m-%d").date()
    except ValueError:
        return None


def _pct(val):
    """Pass through float directly — openpyxl stores percentages as fractions (0.065 = 6.5%)."""
    return val if val is not None else ""


def _num(val):
    return val if val is not None else ""


def fill_nnn_assumptions(wb, req: dict) -> None:
    """Write NNN deal inputs into Assumptions & Flags cells."""
    ws = wb[SHEET]
    prop   = req.get("property", {})
    uw     = req.get("underwriting", {})
    tenant = (req.get("tenants") or [{}])[0]

    # Property identifiers
    ws["C6"] = prop.get("address", "")
    ws["C7"] = tenant.get("name", "")
    ws["C8"] = tenant.get("guarantor", "")
    ws["C9"] = _num(prop.get("building_sf"))

    # Close date
    d = _date(prop.get("close_date", ""))
    if d:
        ws["C13"] = d

    # Pricing
    ws["C16"] = _pct(uw.get("going_in_cap"))

    # Revenue
    ws["C24"] = _num(tenant.get("year1_rent"))
    ws["C25"] = _pct(tenant.get("escalation_pct"))
    ws["C26"] = _num(tenant.get("reimbursements", 0))

    # Expenses
    ws["C30"] = _pct(tenant.get("mgmt_fee_pct", 0))
    ws["C31"] = _num(uw.get("capital_reserves", 0))

    # Acquisition
    ws["C36"] = _num(uw.get("purchase_price"))

    # Right side — debt / leverage
    ws["I6"]  = _num(uw.get("purchase_price"))
    ws["I7"]  = _pct(uw.get("ltv", 0.65))
    ws["I10"] = _pct(uw.get("interest_rate", 0.065))
    ws["I11"] = _num(uw.get("amortization_years", 25))
    ws["I13"] = _num(uw.get("hold_years", 10))
    ws["I20"] = _pct(uw.get("exit_cap"))


# Tenant row offsets within each 9-row MOB tenant block
# Block start rows (header row): 17, 26, 35, 44, 53
_MOB_TENANT_STARTS = [17, 26, 35, 44, 53]
_ROW_NAME  = 1   # name row = start + 1
_ROW_SUITE = 2
_ROW_SF    = 3
_ROW_RENT  = 4
_ROW_ESC   = 5
_ROW_TYPE  = 6
_ROW_REIMB = 7


def fill_mob_assumptions(wb, req: dict) -> None:
    """Write MOB deal inputs into Assumptions & Flags cells."""
    ws = wb[SHEET]
    prop    = req.get("property", {})
    uw      = req.get("underwriting", {})
    tenants = req.get("tenants", [])

    # Property
    ws["C6"] = prop.get("address", "")
    ws["C9"] = _num(prop.get("building_sf"))

    d = _date(prop.get("close_date", ""))
    if d:
        ws["C14"] = d

    # Per-tenant data (up to 5 tenants)
    for i, t_start in enumerate(_MOB_TENANT_STARTS):
        if i >= len(tenants):
            break
        t = tenants[i]
        ws.cell(row=t_start + _ROW_NAME,  column=3).value = t.get("name", "")
        ws.cell(row=t_start + _ROW_SUITE, column=3).value = t.get("suite", "")
        ws.cell(row=t_start + _ROW_SF,    column=3).value = _num(t.get("sf"))
        ws.cell(row=t_start + _ROW_RENT,  column=3).value = _num(t.get("year1_rent"))
        ws.cell(row=t_start + _ROW_ESC,   column=3).value = _pct(t.get("escalation_pct"))
        ws.cell(row=t_start + _ROW_TYPE,  column=3).value = t.get("lease_type", "NNN")
        ws.cell(row=t_start + _ROW_REIMB, column=3).value = _num(t.get("reimbursements", 0))

    # Vacancy / escalation portfolio averages
    ws["C63"] = _pct(uw.get("vacancy_pct", 0.05))
    if tenants:
        avg_esc = sum(t.get("escalation_pct", 0) for t in tenants) / len(tenants)
        ws["C64"] = _pct(avg_esc)

    # Operating expenses (MOB LL-responsible)
    ws["C69"] = _num(uw.get("real_estate_taxes", 0))
    ws["C70"] = _num(uw.get("insurance", 0))
    ws["C71"] = _num(uw.get("cam", 0))
    ws["C72"] = _pct(uw.get("mgmt_fee_pct", 0.04))
    ws["C76"] = _num(uw.get("capital_reserves", 0))

    # Acquisition pricing
    ws["C94"] = _num(uw.get("purchase_price"))
    ws["C88"] = _pct(uw.get("going_in_cap"))

    # Right side — debt / leverage (same as NNN)
    ws["I6"]  = _num(uw.get("purchase_price"))
    ws["I7"]  = _pct(uw.get("ltv", 0.65))
    ws["I10"] = _pct(uw.get("interest_rate", 0.065))
    ws["I11"] = _num(uw.get("amortization_years", 25))
    ws["I13"] = _num(uw.get("hold_years", 10))
    ws["I20"] = _pct(uw.get("exit_cap"))


RENT_SCHEDULE_SHEET = "Rent Schedule"


def _add_years(d, n):
    """Shift date d by n years, clamping Feb 29 to Feb 28."""
    try:
        return d.replace(year=d.year + n)
    except ValueError:
        return d.replace(year=d.year + n, day=28)


def _rent_periods_from(tenant: dict):
    """
    Build the rent-schedule rows for one tenant.
    Preferred: tenant['rent_schedule'] = [{label,start_date,end_date,annual_rent,status}, ...]
      — the exact contracted schedule (handles stepped rents and option bumps).
    Fallback: compute from year1_rent x (1+escalation)^(n-1) across the lease term.
    Returns dicts: {label, start(date|None), end(date|None), annual, esc, status}.
    """
    rows = []
    rs = tenant.get("rent_schedule")
    if rs:
        prev = None
        for i, p in enumerate(rs):
            annual = _num(p.get("annual_rent"))
            esc = None
            if i > 0 and isinstance(annual, (int, float)) and isinstance(prev, (int, float)) and prev:
                esc = round(annual / prev - 1, 4)
            rows.append({
                "label":  p.get("label") or f"Year {i + 1}",
                "start":  _date(p.get("start_date", "")),
                "end":    _date(p.get("end_date", "")),
                "annual": annual,
                "esc":    esc,
                "status": p.get("status") or "Contracted",
            })
            if isinstance(annual, (int, float)):
                prev = annual
        return rows

    # Fallback — compute from Year-1 rent and a single escalation rate
    y1 = tenant.get("year1_rent")
    if y1 is None:
        return rows
    esc = tenant.get("escalation_pct") or 0.0
    comm = _date(tenant.get("lease_commencement", ""))
    exp = _date(tenant.get("lease_expiration", ""))
    nyears = 10
    if comm and exp:
        nyears = max(1, round((exp - comm).days / 365.25))
    for n in range(nyears):
        start = _add_years(comm, n) if comm else None
        end = (_add_years(comm, n + 1) - timedelta(days=1)) if comm else None
        rows.append({
            "label":  f"Year {n + 1}",
            "start":  start,
            "end":    end,
            "annual": round(y1 * ((1 + esc) ** n)),
            "esc":    (esc if n > 0 else None),
            "status": "Contracted (computed)",
        })
    return rows


def _write_rent_grid(ws, data_start: int, periods: list, max_rows: int) -> None:
    """Write periods into grid rows: C=start D=end E=label F=annual I=esc J=status."""
    for i, p in enumerate(periods[:max_rows]):
        rr = data_start + i
        if p.get("start") is not None:
            ws.cell(row=rr, column=3).value = p["start"]
        if p.get("end") is not None:
            ws.cell(row=rr, column=4).value = p["end"]
        if p.get("label"):
            ws.cell(row=rr, column=5).value = p["label"]
        if isinstance(p.get("annual"), (int, float)):
            ws.cell(row=rr, column=6).value = p["annual"]
        if isinstance(p.get("esc"), (int, float)):
            ws.cell(row=rr, column=9).value = p["esc"]
        if p.get("status"):
            ws.cell(row=rr, column=10).value = p["status"]


def fill_nnn_rent_schedule(wb, req: dict) -> None:
    """Populate the single-tenant Rent Schedule tab (identification + grid)."""
    if RENT_SCHEDULE_SHEET not in wb.sheetnames:
        return
    ws = wb[RENT_SCHEDULE_SHEET]
    prop = req.get("property", {})
    tenant = (req.get("tenants") or [{}])[0]

    ws["E6"] = prop.get("address", "")
    ws["E7"] = tenant.get("name", "")
    ws["E8"] = tenant.get("guarantor", "")
    comm = _date(tenant.get("lease_commencement", ""))
    if comm:
        ws["E9"] = comm
    exp = _date(tenant.get("lease_expiration", ""))
    if exp:
        ws["E10"] = exp
        ws["E11"] = '=IFERROR(ROUND((E10-TODAY())/365.25,1),"")'
    ws["E12"] = _num(prop.get("building_sf"))

    _write_rent_grid(ws, 16, _rent_periods_from(tenant), 30)


# MOB rent-schedule grid: tenant t grid begins at row 17 + t*26 (15 rows each)
_MOB_RS_GRID_START = 17
_MOB_RS_STRIDE = 26
_MOB_RS_MAX_ROWS = 15


def fill_mob_rent_schedule(wb, req: dict) -> None:
    """Populate each per-tenant grid on the multi-tenant Rent Schedule tab."""
    if RENT_SCHEDULE_SHEET not in wb.sheetnames:
        return
    ws = wb[RENT_SCHEDULE_SHEET]
    for t, tenant in enumerate((req.get("tenants") or [])[:5]):
        data_start = _MOB_RS_GRID_START + t * _MOB_RS_STRIDE
        _write_rent_grid(ws, data_start, _rent_periods_from(tenant), _MOB_RS_MAX_ROWS)


COVER_SHEET = "Cover"
EXECSUM_SHEET = "Executive Summary"


def _analysis_date() -> str:
    return datetime.now().strftime("%B %d, %Y")


def _property_display(req: dict) -> str:
    """'{Property/Tenant Name}  —  {City, State}' for the Cover and Exec Summary subtitle."""
    prop = req.get("property", {})
    name = (prop.get("name") or "").strip()
    if not name:
        tenants = req.get("tenants") or []
        if req.get("asset_type", "").upper() != "MOB" and tenants and tenants[0].get("name"):
            name = tenants[0]["name"]
        else:
            name = prop.get("address", "")
    cs = (prop.get("city_state") or "").strip()
    return f"{name}  —  {cs}" if cs else name


def fill_cover(wb, req: dict) -> None:
    """Fill the Cover tab identity cells (B10=Property/Tenant, B12=Address, B14=Client, B18=Analysis Date)."""
    if COVER_SHEET not in wb.sheetnames:
        return
    ws = wb[COVER_SHEET]
    prop = req.get("property", {})
    client = req.get("client", {})
    ws["B10"] = _property_display(req)
    ws["B12"] = prop.get("address", "")
    ws["B14"] = client.get("last_name", "")
    ws["B18"] = _analysis_date()


def fill_exec_subtitle(wb, req: dict) -> None:
    """Fill the Executive Summary subtitle (B2), replacing the placeholder."""
    if EXECSUM_SHEET not in wb.sheetnames:
        return
    ws = wb[EXECSUM_SHEET]
    kind = "Multi-Tenant MOB" if req.get("asset_type", "").upper() == "MOB" else "Single-Tenant NNN"
    ws["B2"] = f"{_property_display(req)}  ·  {kind}  ·  Investment Snapshot  ·  {_analysis_date()}"


def fill_assumptions(wb, req: dict) -> None:
    """Dispatch to the correct fill functions based on asset_type."""
    asset_type = req.get("asset_type", "NNN").upper()
    if asset_type == "MOB":
        fill_mob_assumptions(wb, req)
        fill_mob_rent_schedule(wb, req)
    else:
        fill_nnn_assumptions(wb, req)
        fill_nnn_rent_schedule(wb, req)
    fill_cover(wb, req)
    fill_exec_subtitle(wb, req)

