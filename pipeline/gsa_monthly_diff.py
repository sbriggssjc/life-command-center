"""
GSA Monthly Diff — Detects changes in GSA lease data and backfills addresses.

When a previously address-less lease gets an address in a new snapshot,
this module patches the corresponding prospect_leads with the new address
data AND location_code.
"""

import os
import logging
from datetime import datetime, timezone

from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("GOV_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("GOV_SUPABASE_KEY", "")


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Address backfill
# ---------------------------------------------------------------------------

def _backfill_newly_available_addresses(*, dry_run: bool = False) -> dict:
    """
    Find prospect_leads missing an address where the linked gsa_lease_events
    now have address data available. Patch address, city, state, and location_code.
    """
    client = get_client()

    # Find leads with no address
    leads_resp = (
        client.table("prospect_leads")
        .select("lead_id, lease_number, address, city, state, location_code")
        .is_("address", "null")
        .not_.is_("lease_number", "null")
        .limit(500)
        .execute()
    )
    leads = leads_resp.data or []
    logger.info("Found %d leads missing addresses", len(leads))

    if not leads:
        return {"checked": 0, "backfilled": 0}

    # Collect lease numbers to look up
    lease_numbers = [l["lease_number"] for l in leads if l.get("lease_number")]
    leads_by_lease = {l["lease_number"]: l for l in leads}

    backfilled = 0

    # Fetch latest events that now have addresses (includes location_code)
    for batch_start in range(0, len(lease_numbers), 50):
        batch = lease_numbers[batch_start : batch_start + 50]

        events_resp = (
            client.table("gsa_lease_events")
            .select("lease_number, location_code, address, city, state")
            .in_("lease_number", batch)
            .not_.is_("address", "null")
            .order("event_date", desc=True)
            .execute()
        )

        # Deduplicate: keep the most recent event per lease_number
        seen = set()
        for event in events_resp.data or []:
            ln = event.get("lease_number")
            if ln in seen or ln not in leads_by_lease:
                continue
            seen.add(ln)

            lead = leads_by_lease[ln]
            updates = {}

            if event.get("address") and not lead.get("address"):
                updates["address"] = event["address"]
            if event.get("city") and not lead.get("city"):
                updates["city"] = event["city"]
            if event.get("state") and not lead.get("state"):
                updates["state"] = event["state"]
            if event.get("location_code") and not lead.get("location_code"):
                updates["location_code"] = event["location_code"]

            if not updates:
                continue

            updates["updated_at"] = datetime.now(timezone.utc).isoformat()

            if dry_run:
                logger.info("[DRY RUN] Would backfill lead %s: %s", lead["lead_id"], updates)
            else:
                client.table("prospect_leads").update(updates).eq(
                    "lead_id", lead["lead_id"]
                ).execute()
                logger.info("Backfilled lead %s with: %s", lead["lead_id"], list(updates.keys()))

            backfilled += 1

    return {"checked": len(leads), "backfilled": backfilled}


# ---------------------------------------------------------------------------
# Snapshot diff detection
# ---------------------------------------------------------------------------

def detect_monthly_changes(*, current_month: str | None = None, dry_run: bool = False) -> dict:
    """
    Compare the two most recent GSA snapshots and identify:
    - New leases
    - Removed leases
    - Changed fields (rent, address, lessor, etc.)

    Creates gsa_lease_events for detected changes.
    """
    client = get_client()

    # Get distinct snapshot dates
    dates_resp = (
        client.table("gsa_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", desc=True)
        .limit(2)
        .execute()
    )
    dates = [r["snapshot_date"] for r in (dates_resp.data or [])]

    if len(dates) < 2:
        logger.warning("Need at least 2 snapshots for diff; found %d", len(dates))
        return {"new": 0, "removed": 0, "changed": 0}

    current_date, prev_date = dates[0], dates[1]
    logger.info("Comparing snapshots: %s vs %s", current_date, prev_date)

    # Fetch both snapshots (paginated)
    def fetch_snapshot(date_val):
        all_rows = []
        offset = 0
        while True:
            resp = (
                client.table("gsa_snapshots")
                .select("lease_number, address, city, state, annual_rent, lease_rsf, lessor_name, location_code")
                .eq("snapshot_date", date_val)
                .range(offset, offset + 999)
                .execute()
            )
            rows = resp.data or []
            all_rows.extend(rows)
            if len(rows) < 1000:
                break
            offset += 1000
        return {r["lease_number"]: r for r in all_rows if r.get("lease_number")}

    current = fetch_snapshot(current_date)
    previous = fetch_snapshot(prev_date)

    new_leases = set(current.keys()) - set(previous.keys())
    removed_leases = set(previous.keys()) - set(current.keys())
    common = set(current.keys()) & set(previous.keys())

    changed = 0
    compare_fields = ["address", "city", "state", "annual_rent", "lease_rsf", "lessor_name", "location_code"]

    events_to_create = []

    for ln in common:
        cur, prev = current[ln], previous[ln]
        diffs = {}
        for field in compare_fields:
            cv, pv = str(cur.get(field) or ""), str(prev.get(field) or "")
            if cv != pv:
                diffs[field] = {"old": pv, "new": cv}

        if diffs:
            changed += 1
            events_to_create.append({
                "lease_number": ln,
                "location_code": cur.get("location_code"),
                "event_type": "change",
                "event_date": current_date,
                "address": cur.get("address"),
                "city": cur.get("city"),
                "state": cur.get("state"),
                "annual_rent": cur.get("annual_rent"),
                "lease_rsf": cur.get("lease_rsf"),
                "lessor_name": cur.get("lessor_name"),
                "changed_fields": diffs,
            })

    for ln in new_leases:
        cur = current[ln]
        events_to_create.append({
            "lease_number": ln,
            "location_code": cur.get("location_code"),
            "event_type": "new_lease",
            "event_date": current_date,
            "address": cur.get("address"),
            "city": cur.get("city"),
            "state": cur.get("state"),
            "annual_rent": cur.get("annual_rent"),
            "lease_rsf": cur.get("lease_rsf"),
            "lessor_name": cur.get("lessor_name"),
        })

    for ln in removed_leases:
        prev_rec = previous[ln]
        events_to_create.append({
            "lease_number": ln,
            "location_code": prev_rec.get("location_code"),
            "event_type": "lease_removed",
            "event_date": current_date,
        })

    if events_to_create and not dry_run:
        for batch_start in range(0, len(events_to_create), 50):
            batch = events_to_create[batch_start : batch_start + 50]
            # Convert dicts with changed_fields to JSON strings
            for evt in batch:
                if "changed_fields" in evt and isinstance(evt["changed_fields"], dict):
                    import json
                    evt["changed_fields"] = json.dumps(evt["changed_fields"])
            client.table("gsa_lease_events").insert(batch).execute()

    summary = {
        "current_date": current_date,
        "previous_date": prev_date,
        "new": len(new_leases),
        "removed": len(removed_leases),
        "changed": changed,
        "events_created": len(events_to_create),
    }
    logger.info("Monthly diff: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# Full monthly run
# ---------------------------------------------------------------------------

def run_monthly_diff(*, dry_run: bool = False) -> dict:
    """Run the full monthly diff pipeline: detect changes + backfill addresses."""
    diff_result = detect_monthly_changes(dry_run=dry_run)
    backfill_result = _backfill_newly_available_addresses(dry_run=dry_run)

    return {
        "diff": diff_result,
        "backfill": backfill_result,
    }


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="GSA monthly diff and address backfill")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backfill-only", action="store_true", help="Only run address backfill")
    args = parser.parse_args()

    if args.backfill_only:
        result = _backfill_newly_available_addresses(dry_run=args.dry_run)
    else:
        result = run_monthly_diff(dry_run=args.dry_run)
    print(result)
