"""
Lead Updater — CLI tool to show and update prospect lead details.

Supports showing lead details (including location_code) and updating
fields via command-line arguments.
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timezone

from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("GOV_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("GOV_SUPABASE_KEY", "")


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Show command
# ---------------------------------------------------------------------------

def show_lead(lead_id: str) -> None:
    """Display detailed information for a single lead."""
    client = get_client()

    resp = (
        client.table("prospect_leads")
        .select("*")
        .eq("lead_id", lead_id)
        .limit(1)
        .execute()
    )

    if not resp.data:
        print(f"Lead not found: {lead_id}")
        sys.exit(1)

    lead = resp.data[0]

    # Format output
    sections = [
        ("LEAD DETAILS", [
            ("Lead ID", lead.get("lead_id")),
            ("Pipeline Status", lead.get("pipeline_status")),
            ("Research Status", lead.get("research_status")),
            ("Priority Score", lead.get("priority_score")),
            ("Temperature", lead.get("lead_temperature")),
            ("Lead Source", lead.get("lead_source")),
        ]),
        ("GSA LEASE INFO", [
            ("Lease Number", lead.get("lease_number")),
            ("Location Code", lead.get("location_code")),
            ("Address", _format_address(lead)),
            ("Tenant Agency", lead.get("tenant_agency") or lead.get("agency_full_name")),
            ("Annual Rent", _format_currency(lead.get("annual_rent"))),
            ("Square Feet", _format_number(lead.get("square_feet"))),
            ("Lease Effective", lead.get("lease_effective")),
            ("Lease Expiration", lead.get("lease_expiration")),
        ]),
        ("OWNERSHIP", [
            ("Lessor Name", lead.get("lessor_name")),
            ("Recorded Owner", lead.get("recorded_owner")),
            ("True Owner", lead.get("true_owner")),
            ("Owner Type", lead.get("owner_type")),
            ("State of Inc.", lead.get("state_of_incorporation")),
            ("Principal Names", lead.get("principal_names")),
        ]),
        ("CONTACTS", [
            ("Contact Name", lead.get("contact_name")),
            ("Contact Title", lead.get("contact_title")),
            ("Contact Company", lead.get("contact_company")),
            ("Contact Phone", lead.get("contact_phone")),
            ("Phone 2", lead.get("phone_2")),
            ("Contact Email", lead.get("contact_email")),
            ("Mailing Address", lead.get("mailing_address")),
        ]),
        ("MATCHING", [
            ("Matched Property", lead.get("matched_property_id")),
            ("Match Tier", lead.get("match_tier")),
            ("Match Confidence", lead.get("match_confidence")),
            ("Matched Contact", lead.get("matched_contact_id")),
        ]),
        ("SALESFORCE", [
            ("SF Lead ID", lead.get("sf_lead_id")),
            ("SF Contact ID", lead.get("sf_contact_id")),
            ("SF Opportunity ID", lead.get("sf_opportunity_id")),
            ("SF Sync Status", lead.get("sf_sync_status")),
        ]),
    ]

    for section_name, fields in sections:
        print(f"\n{'=' * 50}")
        print(f"  {section_name}")
        print(f"{'=' * 50}")
        for label, value in fields:
            display_val = value if value is not None else "—"
            print(f"  {label + ':':<20} {display_val}")

    if lead.get("research_notes"):
        print(f"\n{'=' * 50}")
        print("  RESEARCH NOTES")
        print(f"{'=' * 50}")
        print(f"  {lead['research_notes']}")

    print()


def _format_address(lead: dict) -> str:
    parts = []
    if lead.get("address"):
        parts.append(lead["address"])
    if lead.get("city"):
        parts.append(lead["city"])
    if lead.get("state"):
        parts.append(lead["state"])
    return ", ".join(parts) if parts else None


def _format_currency(val) -> str | None:
    if val is None:
        return None
    try:
        return f"${float(val):,.0f}"
    except (ValueError, TypeError):
        return str(val)


def _format_number(val) -> str | None:
    if val is None:
        return None
    try:
        return f"{float(val):,.0f}"
    except (ValueError, TypeError):
        return str(val)


# ---------------------------------------------------------------------------
# Update command
# ---------------------------------------------------------------------------

UPDATABLE_FIELDS = {
    "location_code": str,
    "address": str,
    "city": str,
    "state": str,
    "lessor_name": str,
    "recorded_owner": str,
    "true_owner": str,
    "owner_type": str,
    "contact_name": str,
    "contact_phone": str,
    "contact_email": str,
    "contact_company": str,
    "contact_title": str,
    "mailing_address": str,
    "pipeline_status": str,
    "research_status": str,
    "lead_temperature": str,
    "research_notes": str,
    "priority_score": int,
}


def update_lead(lead_id: str, updates: dict) -> None:
    """Update specified fields on a lead."""
    client = get_client()

    # Verify lead exists
    resp = (
        client.table("prospect_leads")
        .select("lead_id")
        .eq("lead_id", lead_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        print(f"Lead not found: {lead_id}")
        sys.exit(1)

    if not updates:
        print("No updates specified.")
        sys.exit(1)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    client.table("prospect_leads").update(updates).eq("lead_id", lead_id).execute()

    print(f"Updated lead {lead_id}:")
    for key, val in updates.items():
        if key != "updated_at":
            print(f"  {key}: {val}")


# ---------------------------------------------------------------------------
# List command
# ---------------------------------------------------------------------------

def list_leads(*, status: str | None = None, state: str | None = None,
               location_code: str | None = None, limit: int = 20) -> None:
    """List leads with optional filters."""
    client = get_client()

    query = (
        client.table("prospect_leads")
        .select("lead_id, lease_number, location_code, address, city, state, "
                "lessor_name, priority_score, pipeline_status")
        .order("priority_score", desc=True)
        .limit(limit)
    )

    if status:
        query = query.eq("pipeline_status", status)
    if state:
        query = query.eq("state", state.upper())
    if location_code:
        query = query.eq("location_code", location_code)

    resp = query.execute()
    leads = resp.data or []

    if not leads:
        print("No leads found.")
        return

    # Table header
    print(f"{'ID':<10} {'Lease':<18} {'Loc Code':<10} {'Address':<30} {'City':<15} {'ST':<4} {'Score':<6} {'Status'}")
    print("-" * 120)

    for l in leads:
        print(
            f"{str(l.get('lead_id', ''))[:9]:<10} "
            f"{(l.get('lease_number') or '—'):<18} "
            f"{(l.get('location_code') or '—'):<10} "
            f"{(l.get('address') or '—')[:29]:<30} "
            f"{(l.get('city') or '—')[:14]:<15} "
            f"{(l.get('state') or '—'):<4} "
            f"{str(l.get('priority_score', '')):<6} "
            f"{l.get('pipeline_status') or '—'}"
        )

    print(f"\nShowing {len(leads)} leads")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Prospect Lead Manager")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Show subcommand
    show_parser = subparsers.add_parser("show", help="Show lead details")
    show_parser.add_argument("lead_id", help="Lead ID to display")

    # Update subcommand
    update_parser = subparsers.add_parser("update", help="Update lead fields")
    update_parser.add_argument("lead_id", help="Lead ID to update")
    update_parser.add_argument("--location-code", help="GSA location code")
    update_parser.add_argument("--address", help="Street address")
    update_parser.add_argument("--city", help="City")
    update_parser.add_argument("--state", help="State abbreviation")
    update_parser.add_argument("--lessor-name", help="Lessor name")
    update_parser.add_argument("--recorded-owner", help="Recorded owner")
    update_parser.add_argument("--true-owner", help="True owner")
    update_parser.add_argument("--owner-type", help="Owner type")
    update_parser.add_argument("--contact-name", help="Contact name")
    update_parser.add_argument("--contact-phone", help="Contact phone")
    update_parser.add_argument("--contact-email", help="Contact email")
    update_parser.add_argument("--contact-company", help="Contact company")
    update_parser.add_argument("--contact-title", help="Contact title")
    update_parser.add_argument("--mailing-address", help="Mailing address")
    update_parser.add_argument("--pipeline-status", help="Pipeline status")
    update_parser.add_argument("--research-status", help="Research status")
    update_parser.add_argument("--lead-temperature", help="Lead temperature")
    update_parser.add_argument("--research-notes", help="Research notes")
    update_parser.add_argument("--priority-score", type=int, help="Priority score (0-100)")

    # List subcommand
    list_parser = subparsers.add_parser("list", help="List leads")
    list_parser.add_argument("--status", help="Filter by pipeline status")
    list_parser.add_argument("--state", help="Filter by state")
    list_parser.add_argument("--location-code", help="Filter by location code")
    list_parser.add_argument("--limit", type=int, default=20, help="Max results")

    args = parser.parse_args()

    if args.command == "show":
        show_lead(args.lead_id)

    elif args.command == "update":
        updates = {}
        # Map CLI args (with hyphens) to DB fields (with underscores)
        field_map = {
            "location_code": args.location_code,
            "address": args.address,
            "city": args.city,
            "state": args.state,
            "lessor_name": args.lessor_name,
            "recorded_owner": args.recorded_owner,
            "true_owner": args.true_owner,
            "owner_type": args.owner_type,
            "contact_name": args.contact_name,
            "contact_phone": args.contact_phone,
            "contact_email": args.contact_email,
            "contact_company": args.contact_company,
            "contact_title": args.contact_title,
            "mailing_address": args.mailing_address,
            "pipeline_status": args.pipeline_status,
            "research_status": args.research_status,
            "lead_temperature": args.lead_temperature,
            "research_notes": args.research_notes,
            "priority_score": args.priority_score,
        }
        for field, value in field_map.items():
            if value is not None:
                updates[field] = value

        update_lead(args.lead_id, updates)

    elif args.command == "list":
        list_leads(
            status=args.status,
            state=args.state,
            location_code=args.location_code,
            limit=args.limit,
        )

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
