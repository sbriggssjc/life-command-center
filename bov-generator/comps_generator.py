"""
comps_generator.py — Briggs CRE Comps population engine (the shared comps tool).

The comps analog of the BOV generator: ONE deterministic engine that fills the
Briggs comps template's INPUT columns from structured comp rows and leaves the
formula-protected columns (RENT/SF, all $/SF, all CAP, TERM, BPS, PRICE ADJ, DOM,
EFF. RENT/SF, #) untouched — so the output is identical no matter which access
point prepared the rows (per Comps_Column_Mapping.md's critical rule).

Design (mirrors the BOV pattern):
  • The LLM at each door maps the raw CoStar/Salesforce export → structured rows
    using the shared column mapping + normalization (Comps_Column_Mapping.md).
  • THIS engine writes those rows into the template's input cells, header-driven
    and formula-safe, then LibreOffice recalcs so the analytics compute.

Header-driven: columns are located by their row-5 header text (normalized), not
by hardcoded letters — robust to template column shifts. A column is treated as
FORMULA (never written) when the template's first data row already holds a
formula there. Rows start at DATA_START_ROW.

Input contract (all keys optional; omit what you don't have — never guess):
  Sales:  { "comp_type":"sales",
            "on_market":[ {property_name,address,city,st,rba_sf,tenant,lease_type,
                           lease_exp,annual_noi,init_price,cur_price,list_date,
                           bumps,options,yr_built,submarket,notes}, ... ],
            "sold":[ {…on_market fields…, last_price, sale_price, sale_date,
                      list_date, buyer, seller, financing}, ... ] }
  Lease:  { "comp_type":"lease",
            "comps":[ {property_name,property_type,source,address,city,st,
                       suite_space,sf_leased,annual_rent,lease_type,lease_comm,
                       lease_exp,execution_date,ti_sf,free_rent_mos,rent_bumps,
                       yr_built,renovated,submarket,notes}, ... ] }

Dates accept 'YYYY-MM-DD' or 'MM/DD/YYYY' (written as true Excel dates). Numbers
accept plain values or strings with $ , %. Text is written verbatim (already
normalized upstream).
"""

import os
import re
from datetime import datetime, date
from pathlib import Path
from openpyxl import load_workbook

DATA_START_ROW = 6
TEMPLATE_DIR = Path(os.environ.get("COMPS_TEMPLATE_DIR", Path(__file__).parent / "templates"))

SALES_TEMPLATE = "Comps Blank Template - Briggs.xlsx"
LEASE_TEMPLATE = "Lease Comps Template - Briggs.xlsx"
# Dialysis-specific sales template: identical to SALES_TEMPLATE but with CHAIRS and
# PATIENTS input columns inserted immediately after RBA (SF) on both On Market and Sold
# sheets (formula-protected columns shift accordingly). Selected when the caller flags the
# request dialysis (payload vertical == 'dialysis' or dialysis == true). Chairs/patients are
# the most-recent counts, per the dialysis comp standard. Header-driven, so no other change.
DIALYSIS_SALES_TEMPLATE = "Comps Blank Template - Briggs - Dialysis.xlsx"


class CompsError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def _norm(h) -> str:
    """Normalize a header or key to a canonical token: lowercase, alnum→_, trimmed.
    'RBA (SF)'→'rba_sf', 'SUITE / SPACE'→'suite_space', 'TI ($/SF)'→'ti_sf',
    'LEASE COMM.'→'lease_comm', 'CITY'→'city'."""
    s = re.sub(r"[^a-z0-9]+", "_", str(h or "").lower()).strip("_")
    return _ALIASES.get(s, s)


# Row-key aliases → canonical Briggs header token. Lets a caller pass the comps-engine /
# query_comps field names straight through to the master-order template columns
# (TENANT, LAND, BUILT, RBA, CHAIRS, PATIENTS, RENT, EXP, EXPENSES, RENEWAL OPTIONS,
#  SOLD PRICE, DATE, INITIAL/LAST PRICE, ON MARKET, DOM ...).
_ALIASES = {
    "chair_count": "chairs", "chair_ct": "chairs",
    "patient_count": "patients", "patient_ct": "patients",
    "year_built": "built",
    "building_sf": "rba", "rba_sf": "rba", "building_size": "rba",
    "sale_price": "sold_price",
    "sale_date": "date",
    "lease_expiration": "exp", "lease_exp": "exp",
    "lease_type": "expenses", "expense_structure": "expenses",
    "options": "renewal_options", "renewal_option": "renewal_options", "renewal_option_text": "renewal_options",
    "annual_rent": "rent", "annual_noi": "rent",
    "land_acres": "land", "land_area": "land",
    "list_date": "on_market", "on_market_date": "on_market", "listing_date": "on_market",
    "cur_price": "last_price",   # on-market current ask = LAST PRICE column
    "sold_sf": "sold_sf", "price_per_sf": "sold_sf",
}


def _to_number(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace("$", "").replace(",", "").replace("%", "")
    try:
        return float(s)
    except ValueError:
        return None


def _to_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, (datetime, date)):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None  # unparseable → leave blank (never write junk into a date cell)


# Which normalized headers are DATE columns (write as true Excel dates) and which
# are NUMERIC (write as floats). Everything else is text. Formula columns are
# detected from the template and never written regardless of this map.
# NOTE: aliases are applied by _norm() BEFORE these sets are consulted, so list the
# canonical (post-alias) tokens here — e.g. 'exp', 'date', 'on_market', 'rent', 'built'.
_DATE_KEYS = {"exp", "date", "on_market", "lease_exp", "list_date", "sale_date", "lease_comm", "execution_date"}
_NUM_KEYS = {
    "land", "built", "rba", "chairs", "patients", "rent",
    "sold_price", "initial_price", "last_price",
    "annual_noi", "init_price", "cur_price", "sale_price", "rba_sf",
    "sf_leased", "annual_rent", "ti_sf", "free_rent_mos", "yr_built", "renovated",
}


def _is_dialysis(payload: dict) -> bool:
    """True when the caller flags a dialysis comp request → use the dialysis sales
    template (CHAIRS/PATIENTS columns after RBA). Accepts vertical=='dialysis',
    dialysis==true, or asset_type/property_type containing 'dialysis'."""
    if not isinstance(payload, dict):
        return False
    if payload.get("dialysis") is True:
        return True
    for k in ("vertical", "asset_type", "property_type"):
        if "dialysis" in str(payload.get(k, "")).lower():
            return True
    return False


def _header_map(ws, header_row=5):
    """Return {normalized_header: (col_idx, is_formula)}. is_formula is True when
    the first data row already holds a formula in that column (→ never overwrite)."""
    out = {}
    for c in range(1, ws.max_column + 1):
        h = ws.cell(header_row, c).value
        if h in (None, ""):
            continue
        cell = ws.cell(DATA_START_ROW, c)
        is_formula = (cell.data_type == "f") or (isinstance(cell.value, str) and cell.value.startswith("="))
        out[_norm(h)] = (c, is_formula)
    return out


def _write_rows(ws, rows):
    """Write structured rows into the sheet's INPUT columns (header-matched,
    formula-safe). Returns (written_count, skipped_formula_keys, unknown_keys)."""
    hmap = _header_map(ws)
    skipped_formula, unknown = set(), set()
    for i, row in enumerate(rows or []):
        r = DATA_START_ROW + i
        for key, val in (row or {}).items():
            k = _norm(key)
            if k not in hmap:
                unknown.add(k)
                continue
            col, is_formula = hmap[k]
            if is_formula:
                skipped_formula.add(k)   # protect calculated columns — never write
                continue
            if val is None or val == "":
                continue
            if k in _DATE_KEYS:
                val = _to_date(val)
            elif k in _NUM_KEYS:
                val = _to_number(val)
            if val is None:
                continue
            ws.cell(r, col).value = val
    return len(rows or []), sorted(skipped_formula), sorted(unknown)


def _row_get(row, canon):
    """Value from a row dict whose key normalizes (post-alias) to `canon`."""
    for k, v in (row or {}).items():
        if _norm(k) == canon:
            return v
    return None


def _sort_rows(rows, sheet):
    """Workflow sort: Sold by DATE desc; On Market / Available by cap asc; Lease by
    execution date desc. Missing keys sort last so blanks never lead the table."""
    rows = list(rows or [])
    if sheet == "Sold":
        rows.sort(key=lambda r: (_to_date(_row_get(r, "date")) is None,
                                 _to_date(_row_get(r, "date")) or datetime.min), reverse=True)
    elif sheet in ("On Market", "Available"):
        def cap(r):
            rent = _to_number(_row_get(r, "rent")); price = _to_number(_row_get(r, "last_price"))
            return rent / price if (rent and price) else None
        rows.sort(key=lambda r: (cap(r) is None, cap(r) or 0))
    elif sheet == "Lease Comps":
        rows.sort(key=lambda r: (_to_date(_row_get(r, "execution_date")) is None,
                                 _to_date(_row_get(r, "execution_date")) or datetime.min), reverse=True)
    return rows


def _trim_to_totals(ws, n):
    """Delete the unused blank rows between the last written comp and the template's
    AVG/TOTALS bar so the bar sits directly beneath the data, and rewrite the bar's
    AVERAGE/COUNT ranges to the trimmed row count (Workflow step 5)."""
    tot = None
    for r in range(DATA_START_ROW, ws.max_row + 1):
        if str(ws.cell(r, 1).value).strip().upper() == "AVG":
            tot = r
            break
    if tot is None:
        return
    old_last = tot - 1                       # last pre-filled data row (e.g. 105)
    capacity = old_last - DATA_START_ROW + 1
    if n <= 0 or n >= capacity:
        return
    del_start = DATA_START_ROW + n
    ws.delete_rows(del_start, old_last - del_start + 1)
    tot = DATA_START_ROW + n
    new_last = DATA_START_ROW + n - 1        # = 5 + n
    for c in range(1, ws.max_column + 1):
        v = ws.cell(tot, c).value
        if isinstance(v, str) and v.startswith("="):
            ws.cell(tot, c).value = v.replace(str(old_last), str(new_last))


def populate_comps(payload: dict, out_path: str, template_dir: Path = None) -> dict:
    """Fill the Briggs comps template from a structured payload. Returns a summary
    { comp_type, sheets:{name:count}, skipped_formula_keys, unknown_keys, out_path }.
    Does NOT recalc — the caller runs LibreOffice recalc (same as the BOV flow)."""
    tdir = Path(template_dir or TEMPLATE_DIR)
    comp_type = str(payload.get("comp_type", "")).lower()
    if comp_type == "sales":
        tpl = tdir / (DIALYSIS_SALES_TEMPLATE if _is_dialysis(payload) else SALES_TEMPLATE)
    elif comp_type == "lease":
        tpl = tdir / LEASE_TEMPLATE
    else:
        raise CompsError("comp_type must be 'sales' or 'lease'")
    if not tpl.exists():
        raise CompsError(f"template not found: {tpl}", status=500)

    wb = load_workbook(tpl)
    summary = {"comp_type": comp_type, "sheets": {}, "skipped_formula_keys": [], "unknown_keys": []}
    skipped_all, unknown_all = set(), set()

    if comp_type == "sales":
        for sheet, key in (("On Market", "on_market"), ("Sold", "sold")):
            if sheet in wb.sheetnames and payload.get(key):
                rows = _sort_rows(payload[key], sheet)
                n, sk, un = _write_rows(wb[sheet], rows)
                _trim_to_totals(wb[sheet], n)
                summary["sheets"][sheet] = n
                skipped_all.update(sk); unknown_all.update(un)
    else:  # lease
        rows = _sort_rows(payload.get("comps") or payload.get("lease_comps") or [], "Lease Comps")
        if "Lease Comps" in wb.sheetnames and rows:
            n, sk, un = _write_rows(wb["Lease Comps"], rows)
            _trim_to_totals(wb["Lease Comps"], n)
            summary["sheets"]["Lease Comps"] = n
            skipped_all.update(sk); unknown_all.update(un)

    if not summary["sheets"]:
        raise CompsError("no comp rows supplied (sales: on_market/sold; lease: comps)")

    wb.save(out_path)
    wb.close()
    summary["skipped_formula_keys"] = sorted(skipped_all)
    summary["unknown_keys"] = sorted(unknown_all)
    summary["out_path"] = out_path
    return summary
