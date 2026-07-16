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
"""

from datetime import datetime
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

    # Right side — debt / leverage (same as NNN)
    ws["I6"]  = _num(uw.get("purchase_price"))
    ws["I7"]  = _pct(uw.get("ltv", 0.65))
    ws["I10"] = _pct(uw.get("interest_rate", 0.065))
    ws["I11"] = _num(uw.get("amortization_years", 25))
    ws["I13"] = _num(uw.get("hold_years", 10))
    ws["I20"] = _pct(uw.get("exit_cap"))


def fill_assumptions(wb, req: dict) -> None:
    """Dispatch to the correct fill function based on asset_type."""
    asset_type = req.get("asset_type", "NNN").upper()
    if asset_type == "MOB":
        fill_mob_assumptions(wb, req)
    else:
        fill_nnn_assumptions(wb, req)
