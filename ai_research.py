"""
AI Research — Prompt templates for AI-assisted property research.

Provides three prompt templates that include location_code context:
  - ENTITY_RESOLUTION_PROMPT: disambiguate entities across data sources
  - COUNTY_LOOKUP_PROMPT: determine county for a property address
  - CONTACT_DISCOVERY_PROMPT: find owner/contact info for a property
"""

import os
import logging
from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def _location_code_line(location_code, extra=""):
    """Return the location_code prompt line, or empty string if not available."""
    if not location_code:
        return ""
    suffix = f" {extra}" if extra else ""
    return f"GSA Location Code: {location_code}{suffix}\n"


# =============================================================================
# ENTITY_RESOLUTION_PROMPT
# =============================================================================

ENTITY_RESOLUTION_PROMPT = """You are an expert at resolving entity references across government and commercial real estate data sources.

Given the following property/lease context, determine if these records refer to the same real-world entity (property, owner, or organization). Consider name variations, address differences, and data quality issues.

## Property/Lease Context
Lease Number: {lease_number}
{location_code_line}Address: {address}
City: {city}
State: {state}
Lessor/Owner: {lessor_name}
Square Footage: {sq_ft}
Annual Rent: {annual_rent}

## Candidate Entities
{candidates}

## Instructions
1. Compare each candidate against the property context above.
2. Account for common variations (LLC vs Inc, abbreviations, suite numbers).
3. Return a JSON object with your assessment:
   - "match": true/false
   - "confidence": 0.0-1.0
   - "reasoning": brief explanation
   - "best_match_id": ID of the best matching candidate, or null
"""


def build_entity_resolution_prompt(lead, candidates):
    """Build the entity resolution prompt with location_code context."""
    location_code = lead.get("location_code")
    return ENTITY_RESOLUTION_PROMPT.format(
        lease_number=lead.get("lease_number", "N/A"),
        location_code_line=_location_code_line(location_code),
        address=lead.get("address", "N/A"),
        city=lead.get("city", "N/A"),
        state=lead.get("state", "N/A"),
        lessor_name=lead.get("lessor_name", "N/A"),
        sq_ft=lead.get("sq_ft", "N/A"),
        annual_rent=lead.get("annual_rent", "N/A"),
        candidates=candidates,
    )


# =============================================================================
# COUNTY_LOOKUP_PROMPT
# =============================================================================

COUNTY_LOOKUP_PROMPT = """You are an expert at determining the county for a given US property address.

## Property Information
Address: {address}
City: {city}
State: {state}
ZIP: {zip}
{location_code_line}
## Instructions
1. Determine the county for this property address.
2. If the address is incomplete, use the city, state, and ZIP to narrow down the county.
3. If a GSA Location Code is provided, use the state prefix (first 2 characters) to validate your county/state result.
4. Return a JSON object:
   - "county": the county name (without "County" suffix)
   - "state": the two-letter state abbreviation
   - "confidence": 0.0-1.0
   - "reasoning": brief explanation of how you determined the county
   - "fips_code": 5-digit FIPS code if known, or null
"""


def build_county_lookup_prompt(lead):
    """Build the county lookup prompt with location_code context."""
    location_code = lead.get("location_code")
    extra = ""
    if location_code:
        extra = (
            f"(format: STATE_ABBR + 4-digit code, e.g., TX0523 = Texas)\n"
            f"Use the state prefix from the location code to validate your county/state result."
        )
    return COUNTY_LOOKUP_PROMPT.format(
        address=lead.get("address", "N/A"),
        city=lead.get("city", "N/A"),
        state=lead.get("state", "N/A"),
        zip=lead.get("zip", "N/A"),
        location_code_line=_location_code_line(location_code, extra),
    )


# =============================================================================
# CONTACT_DISCOVERY_PROMPT
# =============================================================================

CONTACT_DISCOVERY_PROMPT = """You are an expert at finding property owner and contact information from public records and commercial real estate databases.

## Property Context
Lease Number: {lease_number}
{location_code_line}Address: {address}
City: {city}
State: {state}
County: {county}
Lessor/Owner: {lessor_name}

## Instructions
1. Based on the property context above, identify the most likely property owner.
2. Search for contact information: name, title, phone, email, mailing address.
3. If the lessor is an LLC or corporation, identify the registered agent or principal.
4. Return a JSON object:
   - "owner_name": full name or entity name
   - "owner_type": "individual" or "entity"
   - "contacts": list of contact objects with name, title, phone, email
   - "confidence": 0.0-1.0
   - "sources": list of sources used
"""


def build_contact_discovery_prompt(lead):
    """Build the contact discovery prompt with location_code context."""
    location_code = lead.get("location_code")
    return CONTACT_DISCOVERY_PROMPT.format(
        lease_number=lead.get("lease_number", "N/A"),
        location_code_line=_location_code_line(location_code),
        address=lead.get("address", "N/A"),
        city=lead.get("city", "N/A"),
        state=lead.get("state", "N/A"),
        county=lead.get("county", "N/A"),
        lessor_name=lead.get("lessor_name", "N/A"),
    )


# =============================================================================
# Research runner
# =============================================================================

def run_research(lead_id, research_type="county_lookup"):
    """
    Run AI research on a lead.

    Args:
        lead_id: the prospect lead ID
        research_type: one of "entity_resolution", "county_lookup", "contact_discovery"

    Returns:
        The built prompt string (caller is responsible for sending to AI).
    """
    supabase = get_supabase()

    result = supabase.table("prospect_leads").select("*").eq(
        "lead_id", lead_id
    ).limit(1).execute()

    if not result.data:
        raise ValueError(f"Lead {lead_id} not found")

    lead = result.data[0]

    if research_type == "entity_resolution":
        # Fetch candidate entities for comparison
        candidates_result = supabase.table("properties").select(
            "id, address, city, state, owner_name"
        ).eq("state", lead.get("state", "")).limit(20).execute()
        candidates_text = "\n".join(
            f"- ID: {c['id']}, Address: {c.get('address')}, "
            f"City: {c.get('city')}, Owner: {c.get('owner_name')}"
            for c in (candidates_result.data or [])
        )
        return build_entity_resolution_prompt(lead, candidates_text)

    elif research_type == "county_lookup":
        return build_county_lookup_prompt(lead)

    elif research_type == "contact_discovery":
        return build_contact_discovery_prompt(lead)

    else:
        raise ValueError(f"Unknown research_type: {research_type}")


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Build AI research prompts for leads")
    parser.add_argument("lead_id", help="Prospect lead ID")
    parser.add_argument(
        "--type",
        choices=["entity_resolution", "county_lookup", "contact_discovery"],
        default="county_lookup",
    )
    args = parser.parse_args()

    prompt = run_research(args.lead_id, args.type)
    print(prompt)
