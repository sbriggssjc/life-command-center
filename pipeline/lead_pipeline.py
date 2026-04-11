"""
Lead Pipeline — Processes GSA lease events into prospect leads.

Reads from gsa_lease_events, enriches data, and upserts into prospect_leads.
Includes location_code capture for geographic identification.
"""

import os
import logging
from datetime import datetime, timezone

from supabase import create_client

try:
    from pipeline.pipeline_utils import send_pa_webhook
except ImportError:  # allow running this file as a script
    from pipeline_utils import send_pa_webhook

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("GOV_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("GOV_SUPABASE_KEY", "")


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def compute_priority_score(event: dict) -> int:
    """Score a GSA lease event for lead prioritisation (0-100)."""
    score = 50
    event_type = (event.get("event_type") or "").lower()

    if "expir" in event_type:
        score += 20
    elif "new" in event_type:
        score += 10

    rent = event.get("annual_rent")
    if rent and float(rent) > 500_000:
        score += 15
    elif rent and float(rent) > 100_000:
        score += 5

    rsf = event.get("lease_rsf")
    if rsf and float(rsf) > 50_000:
        score += 10

    if not event.get("address"):
        score -= 10  # harder to research without address

    return max(0, min(100, score))


def determine_temperature(score: int) -> str:
    if score >= 75:
        return "hot"
    if score >= 50:
        return "warm"
    return "cold"


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def process_gsa_events(*, limit: int = 500, dry_run: bool = False) -> dict:
    """
    Pull unprocessed GSA lease events and create/update prospect leads.

    Returns summary dict with counts.
    """
    client = get_client()

    # ----- Fetch events (includes location_code) -----
    events_resp = (
        client.table("gsa_lease_events")
        .select(
            "id, lease_number, location_code, event_type, event_date, "
            "address, city, state, annual_rent, lease_rsf, "
            "lessor_name, tenant_agency, agency_bureau, "
            "lease_effective, lease_expiration, changed_fields, "
            "field_office_name"
        )
        .eq("processed", False)
        .order("event_date", desc=True)
        .limit(limit)
        .execute()
    )

    events = events_resp.data or []
    logger.info("Fetched %d unprocessed GSA events", len(events))

    if not events:
        return {"fetched": 0, "created": 0, "updated": 0, "skipped": 0}

    # ----- Fetch existing leads keyed by lease_number -----
    lease_numbers = list({e["lease_number"] for e in events if e.get("lease_number")})
    existing = {}
    if lease_numbers:
        for batch_start in range(0, len(lease_numbers), 100):
            batch = lease_numbers[batch_start : batch_start + 100]
            resp = (
                client.table("prospect_leads")
                .select("lead_id, lease_number, location_code")
                .in_("lease_number", batch)
                .execute()
            )
            for row in resp.data or []:
                existing[row["lease_number"]] = row

    created = 0
    updated = 0
    skipped = 0
    event_ids_processed = []

    for event in events:
        lease_num = event.get("lease_number")
        if not lease_num:
            skipped += 1
            continue

        score = compute_priority_score(event)
        temp = determine_temperature(score)

        # ----- Build lead dict (includes location_code) -----
        lead = {
            "lease_number": lease_num,
            "location_code": event.get("location_code"),
            "address": event.get("address"),
            "city": event.get("city"),
            "state": event.get("state"),
            "annual_rent": event.get("annual_rent"),
            "square_feet": event.get("lease_rsf"),
            "lessor_name": event.get("lessor_name"),
            "tenant_agency": event.get("tenant_agency"),
            "agency_full_name": event.get("agency_bureau") or event.get("tenant_agency"),
            "lease_effective": event.get("lease_effective"),
            "lease_expiration": event.get("lease_expiration"),
            "lead_source": "gsa_lease_event",
            "priority_score": score,
            "lead_temperature": temp,
            "pipeline_status": "new",
            "research_status": "pending",
        }

        # Strip None values to avoid overwriting existing data with nulls
        lead = {k: v for k, v in lead.items() if v is not None}

        if dry_run:
            logger.info("[DRY RUN] Would upsert lead for %s", lease_num)
            event_ids_processed.append(event["id"])
            if lease_num in existing:
                updated += 1
            else:
                created += 1
            continue

        if lease_num in existing:
            # Update existing lead — merge new data
            ex = existing[lease_num]
            lead["updated_at"] = datetime.now(timezone.utc).isoformat()
            # Backfill location_code if it was missing
            if ex.get("location_code") and "location_code" in lead:
                del lead["location_code"]  # don't overwrite existing
            client.table("prospect_leads").update(lead).eq(
                "lease_number", lease_num
            ).execute()
            updated += 1
        else:
            # Insert new lead (includes location_code)
            lead["created_at"] = datetime.now(timezone.utc).isoformat()
            client.table("prospect_leads").insert(lead).execute()
            created += 1

            # Notify Power Automate of the new lead (never raises).
            send_pa_webhook(
                {
                    "lease_number": lease_num,
                    "address": lead.get("address"),
                    "city": lead.get("city"),
                    "state": lead.get("state"),
                    "agency": lead.get("agency_full_name"),
                    "award_date": lead.get("lease_effective"),
                    "annual_rent": lead.get("annual_rent"),
                    "expiration_date": lead.get("lease_expiration"),
                }
            )

        event_ids_processed.append(event["id"])

    # Mark events as processed
    if event_ids_processed and not dry_run:
        for batch_start in range(0, len(event_ids_processed), 100):
            batch = event_ids_processed[batch_start : batch_start + 100]
            client.table("gsa_lease_events").update({"processed": True}).in_(
                "id", batch
            ).execute()

    summary = {
        "fetched": len(events),
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }
    logger.info("Pipeline complete: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Process GSA events into prospect leads")
    parser.add_argument("--limit", type=int, default=500, help="Max events to process")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    result = process_gsa_events(limit=args.limit, dry_run=args.dry_run)
    print(result)
