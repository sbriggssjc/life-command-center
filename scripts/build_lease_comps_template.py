"""build_lease_comps_template.py

Generates the Northmarq-branded dialysis lease-comps XLSX template at
assets/cm-templates/dialysis-lease-comps-template.xlsx.

Fixes vs. prior hand-edited template (Round 76gn.f audit):
  - Header cell number formats corrected (date format was applied to text headers,
    accounting/currency formats applied to year/occupancy/date columns).
  - Freeze pane moved from B30 to B8 so the comps header stays visible while scrolling.
  - Tab color set to NMQ blue. Header band uses white bold text on NMQ blue.
  - Section title bands ("Subject Property", "Lease Comps") get a navy band.
  - Body uses Open Sans / Trebuchet MS per NMQ_BRAND in detail.js.
  - Comps rows alternate warm-white / white fill.
  - Subject table extended to B3:U4 so subject's owner/user can render too.

Run from repo root:
    python scripts/build_lease_comps_template.py
"""
from __future__ import annotations

import os
from copy import copy
from pathlib import Path

import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

NMQ = {
    "blue":      "FF003DA5",
    "navy":      "FF001159",
    "lightBlue": "FF62B5E5",
    "blueTint":  "FFE0E8F4",
    "warmWhite": "FFFAF9F5",
    "bodyText":  "FF3D4A54",
    "darkText":  "FF191919",
    "muted":     "FF6A748C",
    "border":    "FFD8DFDF",
    "white":     "FFFFFFFF",
}

HEADING_FONT = "Trebuchet MS"
BODY_FONT = "Open Sans"

OUT_PATH = Path("assets/cm-templates/dialysis-lease-comps-template.xlsx")

COMP_FIRST_DATA_ROW = 8
COMP_LAST_TEMPLATED_ROW = 40
COMP_TOTAL_ROW = 60

COLUMNS = [
    ("counter",   "A", "",                       3.5,  "0",                         False),
    ("tenant",    "B", "TENANT",                25,    "@",                         False),
    ("operator",  "C", "OPERATOR",              22,    "@",                         False),
    ("address",   "D", "ADDRESS",               24,    "@",                         False),
    ("city",      "E", "CITY",                  14,    "@",                         False),
    ("state",     "F", "STATE",                  7,    "@",                         True),
    ("land",      "G", "LAND",                  10,    '#,##0.0" ac"',              True),
    ("built",     "H", "BUILT",                  9,    "0",                         True),
    ("renovated", "I", "RENOVATED",             11,    "0",                         True),
    ("rba",       "J", "RBA",                   11,    "#,##0",                     True),
    ("sfLeased",  "K", "SF LEASED",             12,    "#,##0",                     True),
    ("occupancy", "L", "OCCUPANCY",             11,    "0%",                        True),
    ("rentPsf",   "M", "RENT/SF",               11,    '"$"#,##0.00',               True),
    ("current",   "N", "CURRENT RENT",          14,    '"$"#,##0',                  True),
    ("commence",  "O", "COMMENCE",              11,    "mmm-yy",                    True),
    ("exp",       "P", "EXP",                   11,    "mmm-yy",                    True),
    ("initTerm",  "Q", "INITIAL TERM",          13,    '0.0" Years"',               True),
    ("termRem",   "R", "TERM REM",              13,    '0.0" Years";"EXPIRED";"-"', True),
    ("expenses",  "S", "EXPENSES",              13,    "@",                         True),
    ("bumps",     "T", "BUMPS",                 14,    "@",                         True),
    ("userOwner", "U", "USER/OWNER",            22,    "@",                         False),
    ("distance",  "V", "DISTANCE TO SUBJECT",   16,    '#,##0.0" mi"',              True),
]


def build():
    wb = Workbook()
    ws = wb.active
    ws.title = "Lease Comps"
    ws.sheet_properties.tabColor = NMQ["blue"][2:]

    # Column widths + default cell number formats per column
    for _, letter, _label, width, _fmt, _center in COLUMNS:
        ws.column_dimensions[letter].width = width

    # Hide gridlines for the deliverable look
    ws.sheet_view.showGridLines = False

    # Top brand band: row 1
    ws.row_dimensions[1].height = 30
    band = ws.cell(row=1, column=2, value="NORTHMARQ  ·  LEASE COMPS")
    band.font = Font(name=HEADING_FONT, size=14, bold=True, color=NMQ["white"])
    band.fill = PatternFill(fill_type="solid", fgColor=NMQ["blue"])
    band.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.merge_cells(start_row=1, start_column=2, end_row=1, end_column=22)
    for col in range(2, 23):
        c = ws.cell(row=1, column=col)
        c.fill = PatternFill(fill_type="solid", fgColor=NMQ["blue"])

    # Subject section
    ws.row_dimensions[2].height = 24
    sec = ws.cell(row=2, column=2, value="Subject Property")
    sec.font = Font(name=HEADING_FONT, size=13, bold=True, color=NMQ["white"])
    sec.fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])
    sec.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.merge_cells(start_row=2, start_column=2, end_row=2, end_column=21)
    for col in range(2, 22):
        ws.cell(row=2, column=col).fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])

    _write_header_row(ws, 3, columns_subset=COLUMNS[1:21])
    _write_data_row_styles(ws, 4, columns_subset=COLUMNS[1:21], stripe=False)
    ws.row_dimensions[3].height = 24
    ws.row_dimensions[4].height = 22

    # Comps section
    ws.row_dimensions[5].height = 8
    ws.row_dimensions[6].height = 24
    sec2 = ws.cell(row=6, column=2, value="Lease Comps")
    sec2.font = Font(name=HEADING_FONT, size=13, bold=True, color=NMQ["white"])
    sec2.fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])
    sec2.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.merge_cells(start_row=6, start_column=2, end_row=6, end_column=22)
    for col in range(2, 23):
        ws.cell(row=6, column=col).fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])

    _write_header_row(ws, 7, columns_subset=COLUMNS[1:])
    ws.row_dimensions[7].height = 24

    a7 = ws.cell(row=7, column=1, value="#")
    a7.font = Font(name=HEADING_FONT, size=11, bold=True, color=NMQ["white"])
    a7.fill = PatternFill(fill_type="solid", fgColor=NMQ["blue"])
    a7.alignment = Alignment(horizontal="center", vertical="center")

    a3 = ws.cell(row=3, column=1, value="#")
    a3.font = Font(name=HEADING_FONT, size=11, bold=True, color=NMQ["white"])
    a3.fill = PatternFill(fill_type="solid", fgColor=NMQ["blue"])
    a3.alignment = Alignment(horizontal="center", vertical="center")

    a4 = ws.cell(row=4, column=1, value=1)
    a4.font = Font(name=BODY_FONT, size=10, bold=True, color=NMQ["bodyText"])
    a4.alignment = Alignment(horizontal="center", vertical="center")
    a4.number_format = "0"
    _bottom_border(a4)

    for r in range(COMP_FIRST_DATA_ROW, COMP_LAST_TEMPLATED_ROW + 1):
        ws.row_dimensions[r].height = 20
        cell_a = ws.cell(row=r, column=1)
        if r == COMP_FIRST_DATA_ROW:
            cell_a.value = 1
        else:
            cell_a.value = f"=A{r-1}+1"
        cell_a.font = Font(name=BODY_FONT, size=10, bold=True, color=NMQ["muted"])
        cell_a.alignment = Alignment(horizontal="center", vertical="center")
        cell_a.number_format = "0"

        stripe = (r - COMP_FIRST_DATA_ROW) % 2 == 1
        _write_data_row_styles(ws, r, columns_subset=COLUMNS[1:], stripe=stripe)

    # Totals / averages row
    tr = COMP_TOTAL_ROW
    ws.row_dimensions[tr].height = 22
    label = ws.cell(row=tr, column=2, value="AVERAGE")
    label.font = Font(name=HEADING_FONT, size=11, bold=True, color=NMQ["white"])
    label.fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])
    label.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.merge_cells(start_row=tr, start_column=2, end_row=tr, end_column=6)
    for col in range(2, 7):
        ws.cell(row=tr, column=col).fill = PatternFill(fill_type="solid", fgColor=NMQ["navy"])

    avg_formulas = {
        "G": '=IFERROR(SUBTOTAL(101,Comps[LAND]),"")',
        "H": '=IFERROR(SUBTOTAL(101,Comps[BUILT]),"")',
        "I": '=IFERROR(SUBTOTAL(101,Comps[RENOVATED]),"")',
        "J": '=IFERROR(AVERAGE(Comps[RBA]),"")',
        "K": '=IFERROR(AVERAGE(Comps[SF LEASED]),"")',
        "L": '=IFERROR(SUBTOTAL(101,Comps[OCCUPANCY]),"")',
        "M": '=IFERROR(AVERAGE(Comps[RENT/SF]),"")',
        "N": '=IFERROR(AVERAGE(Comps[CURRENT RENT]),"")',
        "Q": '=IFERROR(SUBTOTAL(101,Comps[INITIAL TERM]),"")',
        "R": '=IFERROR(SUBTOTAL(101,Comps[TERM REM]),"")',
        "V": '=IFERROR(AVERAGE(Comps[DISTANCE TO SUBJECT]),"")',
    }
    fmt_by_letter = {letter: fmt for _, letter, _l, _w, fmt, _c in COLUMNS}
    for letter, formula in avg_formulas.items():
        c = ws[f"{letter}{tr}"]
        c.value = formula
        c.font = Font(name=BODY_FONT, size=11, bold=True, color=NMQ["darkText"])
        c.fill = PatternFill(fill_type="solid", fgColor=NMQ["blueTint"])
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.number_format = fmt_by_letter[letter]
        _bottom_border(c, top=True)

    for col in range(7, 23):
        cell = ws.cell(row=tr, column=col)
        if cell.value is None:
            cell.fill = PatternFill(fill_type="solid", fgColor=NMQ["blueTint"])
            _bottom_border(cell, top=True)
        if cell.alignment is None or cell.alignment.horizontal is None:
            cell.alignment = Alignment(horizontal="center", vertical="center")

    # Excel tables
    subj_tbl = Table(displayName="Subject", ref="B3:U4")
    subj_tbl.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight1", showFirstColumn=False, showLastColumn=False,
        showRowStripes=False, showColumnStripes=False
    )
    ws.add_table(subj_tbl)

    comps_tbl = Table(displayName="Comps", ref=f"B7:V{COMP_TOTAL_ROW}")
    comps_tbl.tableStyleInfo = TableStyleInfo(
        name="TableStyleLight1", showFirstColumn=False, showLastColumn=False,
        showRowStripes=False, showColumnStripes=False
    )
    comps_tbl.totalsRowCount = 1
    # Intentionally NOT setting totalsRowFunction on individual columns:
    # Excel would override the explicit IFERROR(AVERAGE(...)) formulas in row 60
    # with its own auto-computed values on open. The explicit formulas give us
    # control over what to do when a column is entirely empty (return ""
    # instead of #DIV/0!), so we keep them.
    ws.add_table(comps_tbl)

    ws.freeze_panes = "B8"

    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = 0.4
    ws.page_margins.right = 0.4
    ws.page_margins.top = 0.5
    ws.page_margins.bottom = 0.5
    ws.print_title_rows = "1:7"

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_PATH)
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")


def _write_header_row(ws, row, *, columns_subset):
    blue = PatternFill(fill_type="solid", fgColor=NMQ["blue"])
    for _name, letter, label, _w, _fmt, _center in columns_subset:
        c = ws[f"{letter}{row}"]
        c.value = label
        c.font = Font(name=HEADING_FONT, size=11, bold=True, color=NMQ["white"])
        c.fill = blue
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.number_format = "@"


def _write_data_row_styles(ws, row, *, columns_subset, stripe):
    fill_color = NMQ["warmWhite"] if stripe else NMQ["white"]
    bottom = Border(bottom=Side(style="thin", color=NMQ["border"]))
    for _name, letter, _label, _w, fmt, center in columns_subset:
        c = ws[f"{letter}{row}"]
        c.font = Font(name=BODY_FONT, size=10, color=NMQ["bodyText"])
        c.fill = PatternFill(fill_type="solid", fgColor=fill_color)
        c.alignment = Alignment(
            horizontal="center" if center else "left",
            vertical="center",
            indent=0 if center else 1,
        )
        c.number_format = fmt
        c.border = bottom


def _bottom_border(c, *, top=False):
    sides = {"bottom": Side(style="thin", color=NMQ["border"])}
    if top:
        sides["top"] = Side(style="thin", color=NMQ["border"])
    c.border = Border(**sides)


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent.parent)
    build()
