import openpyxl
import sys

GOV_PATH = r"C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\Gv't Leased Research\Copy Government Master Document.xlsx"
DIA_PATH = r"C:\Users\scott\OneDrive - NorthMarq Capital, LLC\Team Briggs - Documents\Dialysis Research\Comps\Dialysis Comp Work MASTER.xlsx"


def chart_detail(ws, ch, idx):
    print(f"\n-- Chart {idx}  type={type(ch).__name__}")
    # Title
    try:
        if ch.title:
            paras = ch.title.tx.rich.paragraphs if ch.title.tx and ch.title.tx.rich else []
            for p in paras:
                for r in p.text:
                    if hasattr(r, 'value'):
                        print(f"   title: {r.value!r}")
                        break
    except Exception as e:
        pass
    # Y axis
    try:
        ya = ch.y_axis
        print(f"   y_axis: scaling={ya.scaling.min}..{ya.scaling.max}, fmt={ya.number_format}")
    except Exception as e:
        pass
    # Series detail
    for j, s in enumerate(ch.series):
        nm = None
        try:
            if s.tx and s.tx.strRef and s.tx.strRef.f:
                ref = s.tx.strRef.f
                # If ref is "'All Charts'!$D$2", resolve
                if "!" in ref:
                    sheet_part, cell_part = ref.split("!", 1)
                    sheet_clean = sheet_part.strip("'")
                    cell_clean = cell_part.replace("$", "")
                    target_ws = ws.parent[sheet_clean]
                    nm = target_ws[cell_clean].value
                else:
                    nm = ref
        except Exception as e:
            pass
        # Get the data range too
        data_ref = None
        try:
            data_ref = s.val.numRef.f if s.val and s.val.numRef else None
        except Exception:
            pass
        print(f"   series[{j}]: label={nm!r}, data={data_ref}")


def dump(path, label, sheet_charts):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    print(f"=== {label} ===")
    for sheet, chart_indices in sheet_charts.items():
        ws = wb[sheet]
        print(f"\n## Sheet: {sheet}")
        for i in chart_indices:
            if i < len(ws._charts):
                chart_detail(ws, ws._charts[i], i)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "dia":
        dump(DIA_PATH, "DIA", {"Charts": list(range(20)), "Market Size": list(range(10)), "Core Cap Chart": list(range(10))})
    else:
        dump(GOV_PATH, "GOV", {"All Charts": list(range(18)), "SSA Charts": list(range(10))})
