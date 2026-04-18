"""
Lead Pipeline — Process GSA lease events into prospect leads.
Reads from gsa_lease_events and creates/updates prospect_leads in Supabase.
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


def process_gsa_events(batch_size=100, dry_run=False):
    """
    Fetch unprocessed GSA lease events and create prospect leads.

    Steps:
      1. SELECT new events from gsa_lease_events (including location_code)
      2. Build lead dicts
      3. INSERT into prospect_leads (including location_code)
      4. Mark events as processed
    """
    supabase = get_supabase()

    # -------------------------------------------------------------------------
    # Step 1: SELECT unprocessed events (includes location_code)
    # -------------------------------------------------------------------------
    result = supabase.table("gsa_lease_events").select(
        "id, lease_number, location_code, address, city, state, zip, "
        "event_type, event_date, lessor_name, sq_ft, monthly_rent, "
        "annual_rent, expiration_date, processed_at"
    ).is_("processed_at", "null").limit(batch_size).execute()

    events = result.data or []
    if not events:
        logger.info("No unprocessed GSA lease events found.")
        return {"processed": 0, "created": 0, "skipped": 0}

    logger.info(f"Found {len(events)} unprocessed GSA lease events.")

    created = 0
    skipped = 0

    for event in events:
        lease_number = event.get("lease_number")
        if not lease_number:
            logger.warning(f"Skipping event {event.get('id')} — no lease_number.")
            skipped += 1
            continue

        # Check if lead already exists for this lease
        existing = supabase.table("prospect_leads").select("lead_id").eq(
            "lease_number", lease_number
        ).limit(1).execute()

        if existing.data:
            logger.debug(f"Lead already exists for lease {lease_number}, skipping.")
            skipped += 1
            # Still mark as processed
            if not dry_run:
                supabase.table("gsa_lease_events").update({
                    "processed_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", event["id"]).execute()
            continue

        # -----------------------------------------------------------------
        # Step 2: Build lead dict (includes location_code)
        # -----------------------------------------------------------------
        lead = {
            "lease_number": lease_number,
            "location_code": event.get("location_code"),
            "address": event.get("address"),
            "city": event.get("city"),
            "state": event.get("state"),
            "zip": event.get("zip"),
            "event_type": event.get("event_type"),
            "event_date": event.get("event_date"),
            "lessor_name": event.get("lessor_name"),
            "sq_ft": event.get("sq_ft"),
            "monthly_rent": event.get("monthly_rent"),
            "annual_rent": event.get("annual_rent"),
            "expiration_date": event.get("expiration_date"),
            "source": "gsa_lease_events",
            "status": "new",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        # -----------------------------------------------------------------
        # Step 3: INSERT into prospect_leads (includes location_code)
        # -----------------------------------------------------------------
        if not dry_run:
            try:
                supabase.table("prospect_leads").insert(lead).execute()
                created += 1
                logger.info(
                    f"Created lead for lease {lease_number} "
                    f"(location_code={event.get('location_code')})"
                )
            except Exception as e:
                logger.error(f"Failed to insert lead for lease {lease_number}: {e}")
                skipped += 1
                continue

            # Mark event as processed
            supabase.table("gsa_lease_events").update({
                "processed_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", event["id"]).execute()
        else:
            created += 1
            logger.info(f"[DRY RUN] Would create lead for lease {lease_number}")

    summary = {
        "processed": len(events),
        "created": created,
        "skipped": skipped,
    }
    logger.info(f"Pipeline complete: {summary}")
    return summary


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Process GSA lease events into leads")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = process_gsa_events(batch_size=args.batch_size, dry_run=args.dry_run)
    print(f"Result: {result}")
