"""
GSA Monthly Diff — Process monthly GSA lease data updates.

Detects changes between monthly snapshots and backfills newly available
address and location_code data onto existing prospect leads.
"""

import os
import logging
from datetime import datetime, timezone
from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _backfill_newly_available_addresses(dry_run=False):
    """
    Backfill address and location_code onto leads when a previously
    address-less lease gets address data in a newer monthly snapshot.

    Steps:
      1. Find prospect_leads with no address but a lease_number
      2. Check gsa_lease_events for that lease_number with address data
      3. Update the lead with address, city, state, and location_code
    """
    supabase = get_supabase()

    # -------------------------------------------------------------------------
    # SELECT leads missing address data
    # -------------------------------------------------------------------------
    result = supabase.table("prospect_leads").select(
        "lead_id, lease_number, address, city, state, location_code"
    ).is_("address", "null").not_.is_("lease_number", "null").limit(200).execute()

    leads = result.data or []
    if not leads:
        logger.info("No address-less leads to backfill.")
        return {"checked": 0, "backfilled": 0}

    logger.info(f"Found {len(leads)} leads without addresses to check for backfill.")

    backfilled = 0

    for lead in leads:
        lease_number = lead["lease_number"]

        # -----------------------------------------------------------------
        # SELECT latest event with address data (includes location_code)
        # -----------------------------------------------------------------
        event_result = supabase.table("gsa_lease_events").select(
            "address, city, state, zip, location_code"
        ).eq(
            "lease_number", lease_number
        ).not_.is_(
            "address", "null"
        ).order(
            "event_date", desc=True
        ).limit(1).execute()

        events = event_result.data or []
        if not events:
            continue

        event = events[0]
        new_address = event.get("address")
        if not new_address:
            continue

        logger.info(
            f"Backfilling lead {lead['lead_id']} (lease {lease_number}): "
            f"address={new_address}, location_code={event.get('location_code')}"
        )

        # -----------------------------------------------------------------
        # UPDATE prospect_leads with address + location_code
        # -----------------------------------------------------------------
        if not dry_run:
            update_data = {
                "address": new_address,
                "city": event.get("city"),
                "state": event.get("state"),
                "zip": event.get("zip"),
                "location_code": event.get("location_code"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            supabase.table("prospect_leads").update(
                update_data
            ).eq("lead_id", lead["lead_id"]).execute()

        backfilled += 1

    summary = {"checked": len(leads), "backfilled": backfilled}
    logger.info(f"Backfill complete: {summary}")
    return summary


def process_monthly_diff(dry_run=False):
    """
    Run all monthly diff operations:
      1. Backfill newly available addresses (and location_codes)
      2. (Future: detect lease expirations, rent changes, etc.)
    """
    results = {}

    logger.info("Starting monthly diff processing...")

    # Backfill addresses + location_codes
    results["backfill"] = _backfill_newly_available_addresses(dry_run=dry_run)

    logger.info(f"Monthly diff complete: {results}")
    return results


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Process GSA monthly data diff")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = process_monthly_diff(dry_run=args.dry_run)
    print(f"Result: {result}")
