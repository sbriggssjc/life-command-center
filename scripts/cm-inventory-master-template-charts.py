"""Inventory every chart object in the dia master template."""
import zipfile, re
import warnings
warnings.filterwarnings('ignore')

TEMPLATE = r"C:\Users\scott\life-command-center\assets\cm-templates\dialysis-master-template.xlsx"


def parse_chart(xml, chart_id):
    out = []
    chart_types = re.findall(r'<(\w+Chart)>', xml)
    chart_type = chart_types[0] if chart_types else 'Unknown'
    series_blocks = re.findall(r'<ser>(.*?)</ser>', xml, re.DOTALL)
    for sb in series_blocks:
        title_match = re.search(r'<tx>.*?<strRef>.*?<f>([^<]+)</f>', sb, re.DOTALL)
        title_ref = title_match.group(1) if title_match else None
        # Scatter charts use xVal/yVal, others use val
        val_match = (re.search(r'<yVal>.*?<f>([^<]+)</f>', sb, re.DOTALL)
                  or re.search(r'<val>.*?<f>([^<]+)</f>', sb, re.DOTALL))
        val_ref = val_match.group(1) if val_match else None
        cat_match = (re.search(r'<xVal>.*?<f>([^<]+)</f>', sb, re.DOTALL)
                  or re.search(r'<cat>.*?<f>([^<]+)</f>', sb, re.DOTALL))
        cat_ref = cat_match.group(1) if cat_match else None
        if not title_ref:
            inline_name = re.search(r'<tx>\s*<v>([^<]+)</v>', sb, re.DOTALL)
            inline_value = inline_name.group(1) if inline_name else None
        else:
            inline_value = None
        out.append({
            'chart_id': chart_id,
            'chart_type': chart_type,
            'title_ref': title_ref,
            'inline_title': inline_value,
            'val_ref': val_ref,
            'cat_ref': cat_ref,
        })
    return out


def parse_ref(ref):
    if not ref:
        return None
    m = re.match(r"^'?([^!']+)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$", ref)
    if not m:
        return None
    sheet, c1, r1, c2, r2 = m.groups()
    return {'sheet': sheet, 'col_start': c1, 'col_end': c2 or c1,
            'row_start': int(r1), 'row_end': int(r2) if r2 else int(r1)}


_SHEET_CACHE = {}

def get_cell_value(z, sheet_name, cell_ref):
    if sheet_name not in _SHEET_CACHE:
        with z.open('xl/workbook.xml') as f:
            wb = f.read().decode('utf-8', errors='ignore')
        sheets = re.findall(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"', wb)
        name_to_rid = dict(sheets)
        with z.open('xl/_rels/workbook.xml.rels') as f:
            rels = f.read().decode('utf-8', errors='ignore')
        targets = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels))
        rid = name_to_rid.get(sheet_name)
        target = targets.get(rid) if rid else None
        if not target:
            _SHEET_CACHE[sheet_name] = None
        else:
            sheet_path = 'xl/' + target.lstrip('/').replace('xl/', '')
            if sheet_path not in z.namelist():
                _SHEET_CACHE[sheet_name] = None
            else:
                with z.open(sheet_path) as f:
                    _SHEET_CACHE[sheet_name] = f.read().decode('utf-8', errors='ignore')
    sheet_xml = _SHEET_CACHE[sheet_name]
    if sheet_xml is None:
        return None
    cell_match = re.search(rf'<c r="{cell_ref}"[^>]*>(.*?)</c>', sheet_xml, re.DOTALL)
    if not cell_match:
        return None
    inner = cell_match.group(1)
    inline = re.search(r'<is><t[^>]*>([^<]*)</t></is>', inner)
    if inline:
        return inline.group(1)
    v = re.search(r'<v>([^<]*)</v>', inner)
    if v:
        return v.group(1)
    return None


with zipfile.ZipFile(TEMPLATE) as z:
    chart_files = sorted([n for n in z.namelist() if re.match(r'xl/charts/chart\d+\.xml$', n)],
                         key=lambda n: int(re.search(r'\d+', n).group()))
    print(f"# {len(chart_files)} chart objects in dia master template")
    print()
    all_series = []
    for cf in chart_files:
        chart_id = re.search(r'\d+', cf).group()
        with z.open(cf) as f:
            xml = f.read().decode('utf-8', errors='ignore')
        all_series.extend(parse_chart(xml, chart_id))

    print(f"{'chart':<7} {'type':<14} {'series_title':<46} {'sheet':<18} {'col':<5} {'rows':<14}")
    print('-' * 116)
    for s in all_series:
        tref = parse_ref(s['title_ref']) if s['title_ref'] and s['title_ref'] != '(inline)' else None
        vref = parse_ref(s['val_ref'])
        if tref:
            title_val = get_cell_value(z, tref['sheet'], f"{tref['col_start']}{tref['row_start']}") or ''
        elif s['inline_title']:
            title_val = s['inline_title']
        else:
            title_val = '(no title)'
        sheet = vref['sheet'] if vref else '-'
        col = vref['col_start'] if vref else '-'
        rows = f"{vref['row_start']}-{vref['row_end']}" if vref else '-'
        print(f"{s['chart_id']:<7} {s['chart_type']:<14} {title_val[:44]:<46} {sheet[:16]:<18} {col:<5} {rows:<14}")
