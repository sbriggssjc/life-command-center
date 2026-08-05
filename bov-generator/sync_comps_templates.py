"""
sync_comps_templates.py — refresh the DERIVED comps template copies from the
single source of truth (`bov-generator/templates/`).

`bov-generator/templates/` is the single source of truth for every blank Briggs
comps template (see templates/README.md). Copies uploaded to the Northmarq/Copilot
project knowledge or dropped in a shared-drive `Templates/` folder are DERIVED and
must be refreshed FROM here — never hand-edited. This script makes that refresh one
command, one-directional (source → dest), so a distributed copy can never flow back
and become the source.

Usage:
  python bov-generator/sync_comps_templates.py --dest "/path/to/project-knowledge"
  python bov-generator/sync_comps_templates.py --dest "/path/..." --dry-run
  COMPS_TEMPLATE_DEST=/path/... python bov-generator/sync_comps_templates.py
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

SOURCE_DIR = Path(__file__).parent / "templates"

# The blank templates that are distributed (Cover/Index-bearing comps workbooks +
# the lease template). README.md and this script itself are NOT distributed.
TEMPLATES = [
    "Comps Blank Template - Briggs.xlsx",
    "Comps Blank Template - Briggs - Dialysis.xlsx",
    "Comps Blank Template - Briggs - Government.xlsx",
    "Lease Comps Template - Briggs.xlsx",
]


def sync(dest: Path, dry_run: bool = False) -> list:
    """Copy each canonical template into `dest`. Returns the list of (name, action)."""
    actions = []
    dest.mkdir(parents=True, exist_ok=True) if not dry_run else None
    for name in TEMPLATES:
        src = SOURCE_DIR / name
        if not src.exists():
            raise FileNotFoundError(f"source template missing: {src}")
        tgt = dest / name
        same = tgt.exists() and tgt.stat().st_size == src.stat().st_size and \
            tgt.read_bytes() == src.read_bytes()
        action = "unchanged" if same else ("would copy" if dry_run else "copied")
        if not same and not dry_run:
            shutil.copy2(src, tgt)
        actions.append((name, action))
    return actions


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", default=os.environ.get("COMPS_TEMPLATE_DEST"),
                    help="destination folder for the derived copies (or COMPS_TEMPLATE_DEST env)")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; copy nothing")
    args = ap.parse_args(argv)

    if not args.dest:
        ap.error("--dest (or COMPS_TEMPLATE_DEST) is required")
    dest = Path(args.dest).expanduser()
    if dest.resolve() == SOURCE_DIR.resolve():
        ap.error("--dest must not be the source directory (sync is source → dest only)")

    print(f"source: {SOURCE_DIR}")
    print(f"dest:   {dest}{'  (dry-run)' if args.dry_run else ''}")
    for name, action in sync(dest, dry_run=args.dry_run):
        print(f"  {action:12} {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
