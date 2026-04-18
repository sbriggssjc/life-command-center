"""
Import SF Activity History CSV into sf_activity_history_import staging table.

Usage:
  python scripts/import_activity_history.py <csv_file_path>

Requires:
  pip install supabase python-dotenv

The script reads the CSV, maps columns to the staging table, and bulk-inserts
in batches of 500. After loading, run the transform SQL:
  sql/20260319_activity_history_import.sql
"""

import csv
import sys
import os
from datetime import datetime

# Try supabase client; fall back to psycopg2 if available
try:
    from supabase import create_client
    USE_SUPABASE = True
except ImportError:
    USE_SUPABASE = False

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# CSV column headers → staging table column mapping (by position)
COLUMN_MAP = [
    'subject',            # 0  Subject
    'first_name',         # 1  First Name
    'last_name',          # 2  Last Name
    'assigned',           # 3  Assigned
    'nm_type',            # 4  NM Type
    'related_deal',       # 5  Related Deal
    'company_name',       # 6  Company Name
    'full_name',          # 7  Full Name
    'mailing_address',    # 8  Mailing Address Line 1
    'mailing_city',       # 9  Mailing City
    'mailing_state',      # 10 Mailing State/Province
    'mailing_zip',        # 11 Mailing Zip/Postal Code
    'email',              # 12 Email
    'phone',              # 13 Contact: Phone
    'email_2',            # 14 Email (duplicate)
    'date_completed',     # 15 Date Completed
    'datetime_created',   # 16 Date/Time Created
    'date_due',           # 17 Date Due
    'time_field',         # 18 Time
    'assigned_to',        # 19 Assigned To
    'sf_contact_id',      # 20 Contact ID
    'company_name_2',     # 21 Company Name (duplicate)
    'company_activity_id',# 22 Company Activity ID
    'sf_activity_id',     # 23 Activity ID
    'sf_company_id',      # 24 Company ID
]

BATCH_SIZE = 500
IMPORT_BATCH = f'activity_history_{datetime.now().strftime("%Y%m%d")}'


def clean_value(val):
    """Clean a CSV value, treating Excel artifacts as null."""
    if val is None:
        return None
    val = val.strip()
    if val in ('', '########', '#REF!', '#N/A', 'NULL'):
        return None
    return val


def parse_csv(filepath):
    """Parse CSV file and return list of row dicts."""
    rows = []
    with open(filepath, 'r', encoding='cp1252', errors='replace') as f:
        reader = csv.reader(f)
        header = next(reader)  # skip header row
        print(f"CSV headers ({len(header)} cols): {header[:5]}...")

        for line_num, raw_row in enumerate(reader, start=2):
            if len(raw_row) < 20:
                print(f"  Skipping short row {line_num} ({len(raw_row)} cols)")
                continue

            row = {}
            for i, col_name in enumerate(COLUMN_MAP):
                if i < len(raw_row):
                    row[col_name] = clean_value(raw_row[i])
                else:
                    row[col_name] = None

            row['import_batch'] = IMPORT_BATCH
            row['processed'] = False
            rows.append(row)

    return rows


def insert_supabase(rows):
    """Insert rows using Supabase client."""
    # Hardcoded to gov/NM Supabase project — override with GOV_SUPABASE_URL if needed
    url = os.environ.get('GOV_SUPABASE_URL', 'https://scknotsqkcheojiaewwh.supabase.co')
    key = (os.environ.get('GOV_SUPABASE_KEY')
           or os.environ.get('SUPABASE_SERVICE_KEY')
           or os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')).strip()

    if not key or not key.startswith('eyJ'):
        print("ERROR: Need the service_role API key (starts with 'eyJ...')")
        print("  Find it: Supabase Dashboard → Settings → API → service_role")
        print("  PowerShell:  $env:GOV_SUPABASE_KEY='eyJ...'")
        sys.exit(1)

    print(f"  Connecting to: {url}")

    client = create_client(url, key)
    total = len(rows)
    inserted = 0

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        result = client.table('sf_activity_history_import').insert(batch).execute()
        inserted += len(batch)
        print(f"  Inserted {inserted}/{total} rows...")

    return inserted


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/import_activity_history.py <csv_file>")
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f"ERROR: File not found: {filepath}")
        sys.exit(1)

    print(f"Parsing CSV: {filepath}")
    rows = parse_csv(filepath)
    print(f"Parsed {len(rows)} activity rows")

    if not rows:
        print("No rows to import.")
        return

    # Show sample
    sample = rows[0]
    print(f"\nSample row:")
    for k, v in sample.items():
        if v is not None:
            print(f"  {k}: {v}")

    print(f"\nInserting into sf_activity_history_import...")
    count = insert_supabase(rows)
    print(f"\nDone! {count} rows loaded into staging table.")
    print(f"Now run the transform SQL: sql/20260319_activity_history_import.sql")


if __name__ == '__main__':
    main()
