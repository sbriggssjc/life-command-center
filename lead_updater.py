"""
Lead Updater — CLI tool for viewing and updating prospect leads.

Usage:
  python lead_updater.py show <lead_id>
  python lead_updater.py update <lead_id> --location-code TX0523 --state TX
  python lead_updater.py list --state TX --limit 10
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timezone
from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def show_lead(lead_id):
    """Display detailed information for a single lead."""
    supabase = get_supabase()

    result = supabase.table("prospect_leads").select("*").eq(
        "lead_id", lead_id
    ).limit(1).execute()

    if not result.data:
        print(f"Lead {lead_id} not found.")
        return None

    lead = result.data[0]

    print("=" * 60)
    print(f"Lead ID:         {lead.get('lead_id')}")
    print(f"Status:          {lead.get('status', 'N/A')}")
    print(f"Lease Number:    {lead.get('lease_number', 'N/A')}")
    print(f"Location Code:   {lead.get('location_code', 'N/A')}")
    print(f"Address:         {_format_address(lead)}")
    print(f"Lessor:          {lead.get('lessor_name', 'N/A')}")
    print(f"Event Type:      {lead.get('event_type', 'N/A')}")
    print(f"Event Date:      {lead.get('event_date', 'N/A')}")
    print(f"Sq Ft:           {lead.get('sq_ft', 'N/A')}")
    print(f"Monthly Rent:    {lead.get('monthly_rent', 'N/A')}")
    print(f"Annual Rent:     {lead.get('annual_rent', 'N/A')}")
    print(f"Expiration:      {lead.get('expiration_date', 'N/A')}")
    print(f"Property ID:     {lead.get('property_id', 'N/A')}")
    print(f"Match Tier:      {lead.get('match_tier', 'N/A')}")
    print(f"Match Confidence:{lead.get('match_confidence', 'N/A')}")
    print(f"Created:         {lead.get('created_at', 'N/A')}")
    print(f"Updated:         {lead.get('updated_at', 'N/A')}")
    print("=" * 60)

    return lead


def _format_address(lead):
    """Format address fields into a single line."""
    parts = []
    if lead.get("address"):
        parts.append(lead["address"])
    city_state = []
    if lead.get("city"):
        city_state.append(lead["city"])
    if lead.get("state"):
        city_state.append(lead["state"])
    if city_state:
        parts.append(", ".join(city_state))
    if lead.get("zip"):
        parts[-1] = parts[-1] + " " + lead["zip"] if parts else lead["zip"]
    return ", ".join(parts) if parts else "N/A"


def update_lead(lead_id, updates):
    """Update a lead with the given field values."""
    if not updates:
        print("No updates provided.")
        return None

    supabase = get_supabase()

    # Verify lead exists
    existing = supabase.table("prospect_leads").select("lead_id").eq(
        "lead_id", lead_id
    ).limit(1).execute()

    if not existing.data:
        print(f"Lead {lead_id} not found.")
        return None

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("prospect_leads").update(updates).eq(
        "lead_id", lead_id
    ).execute()

    if result.data:
        print(f"Updated lead {lead_id}:")
        for key, value in updates.items():
            if key != "updated_at":
                print(f"  {key} = {value}")
        return result.data[0]
    else:
        print(f"Failed to update lead {lead_id}.")
        return None


def list_leads(state=None, status=None, limit=20):
    """List leads with optional filters."""
    supabase = get_supabase()

    query = supabase.table("prospect_leads").select(
        "lead_id, lease_number, location_code, address, city, state, "
        "status, lessor_name, created_at"
    )

    if state:
        query = query.eq("state", state.upper())
    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()
    leads = result.data or []

    if not leads:
        print("No leads found.")
        return []

    # Print table header
    print(f"{'Lead ID':<38} {'Lease':<16} {'Loc Code':<10} {'City':<20} {'ST':<4} {'Status':<10}")
    print("-" * 100)

    for lead in leads:
        print(
            f"{lead.get('lead_id', ''):<38} "
            f"{(lead.get('lease_number') or ''):<16} "
            f"{(lead.get('location_code') or ''):<10} "
            f"{(lead.get('city') or ''):<20} "
            f"{(lead.get('state') or ''):<4} "
            f"{(lead.get('status') or ''):<10}"
        )

    print(f"\n{len(leads)} lead(s) shown.")
    return leads


def main():
    parser = argparse.ArgumentParser(description="View and update prospect leads")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Show command
    show_parser = subparsers.add_parser("show", help="Show lead details")
    show_parser.add_argument("lead_id", help="Lead ID to display")

    # Update command
    update_parser = subparsers.add_parser("update", help="Update a lead")
    update_parser.add_argument("lead_id", help="Lead ID to update")
    update_parser.add_argument("--location-code", help="GSA location code")
    update_parser.add_argument("--address", help="Street address")
    update_parser.add_argument("--city", help="City")
    update_parser.add_argument("--state", help="State abbreviation")
    update_parser.add_argument("--zip", help="ZIP code")
    update_parser.add_argument("--status", help="Lead status")
    update_parser.add_argument("--lessor-name", help="Lessor name")

    # List command
    list_parser = subparsers.add_parser("list", help="List leads")
    list_parser.add_argument("--state", help="Filter by state")
    list_parser.add_argument("--status", help="Filter by status")
    list_parser.add_argument("--limit", type=int, default=20, help="Max results")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "show":
        show_lead(args.lead_id)

    elif args.command == "update":
        updates = {}
        if args.location_code is not None:
            updates["location_code"] = args.location_code
        if args.address is not None:
            updates["address"] = args.address
        if args.city is not None:
            updates["city"] = args.city
        if args.state is not None:
            updates["state"] = args.state.upper()
        if args.zip is not None:
            updates["zip"] = args.zip
        if args.status is not None:
            updates["status"] = args.status
        if args.lessor_name is not None:
            updates["lessor_name"] = args.lessor_name
        update_lead(args.lead_id, updates)

    elif args.command == "list":
        list_leads(state=args.state, status=args.status, limit=args.limit)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    main()
