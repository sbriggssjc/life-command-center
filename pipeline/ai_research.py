"""
AI Research — Prompt templates and AI-powered research for GSA leads.

Uses location_code in ENTITY_RESOLUTION_PROMPT, COUNTY_LOOKUP_PROMPT,
and CONTACT_DISCOVERY_PROMPT for improved disambiguation and validation.
"""

import os
import logging
import json

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
AI_MODEL = os.environ.get("AI_MODEL", "gpt-4o")


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

ENTITY_RESOLUTION_PROMPT = """You are an expert at resolving commercial real estate entities.
Given the following property and lease information, determine the most likely true owner
and any related entities (parent companies, LLCs, trusts).

Property Context:
Address: {address}
City: {city}, State: {state}
Lease Number: {lease_number}
{location_code_line}Lessor Name: {lessor_name}
Tenant Agency: {tenant_agency}
Annual Rent: ${annual_rent}
Square Feet: {square_feet}

Recorded Owner: {recorded_owner}

Instructions:
1. Identify the true beneficial owner behind the lessor/recorded owner
2. Note any parent companies, holding companies, or related entities
3. Determine the entity type (individual, LLC, REIT, corporation, trust, etc.)
4. Provide confidence level (high/medium/low) for your determination

Respond in JSON format:
{{
  "true_owner": "...",
  "owner_type": "...",
  "parent_company": "...",
  "related_entities": ["..."],
  "state_of_incorporation": "...",
  "confidence": "high|medium|low",
  "reasoning": "..."
}}"""

COUNTY_LOOKUP_PROMPT = """You are a geographic lookup expert for US commercial real estate.
Determine the county for the following property location.

Property Location:
Address: {address}
City: {city}, State: {state}
{location_code_line}
Instructions:
1. Determine the county where this property is located
2. If the address is ambiguous, use the city and state to narrow down
3. If a GSA Location Code is provided, use its state prefix (first 2 characters)
   to validate your county/state result
4. Provide the full county name (e.g., "Dallas County", not just "Dallas")
5. Include the FIPS code if known

Respond in JSON format:
{{
  "county": "...",
  "fips_code": "...",
  "confidence": "high|medium|low",
  "reasoning": "..."
}}"""

CONTACT_DISCOVERY_PROMPT = """You are an expert at finding contact information for
commercial real estate property owners and managers.

Property Context:
Address: {address}
City: {city}, State: {state}
Lease Number: {lease_number}
{location_code_line}Lessor/Owner: {lessor_name}
Owner Type: {owner_type}
State of Incorporation: {state_of_incorporation}
Principal Names: {principal_names}

Instructions:
1. Based on the owner information, suggest likely contact details
2. Identify the best person to contact (principal, asset manager, etc.)
3. Suggest search strategies if direct contact info is unavailable
4. Note any publicly available phone numbers, emails, or mailing addresses

Respond in JSON format:
{{
  "contact_name": "...",
  "contact_title": "...",
  "contact_company": "...",
  "contact_phone": "...",
  "contact_email": "...",
  "mailing_address": "...",
  "search_strategies": ["..."],
  "confidence": "high|medium|low"
}}"""


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

def _location_code_line(location_code: str | None, include_hint: bool = False) -> str:
    """Build the location_code line for prompt injection. Returns '' if empty."""
    if not location_code:
        return ""
    line = f"GSA Location Code: {location_code}"
    if include_hint:
        line += f" (format: STATE_ABBR + 4-digit code, e.g., TX0523 = Texas)"
    return line + "\n"


def build_entity_resolution_prompt(lead: dict) -> str:
    """Format the entity resolution prompt with lead data."""
    return ENTITY_RESOLUTION_PROMPT.format(
        address=lead.get("address") or "N/A",
        city=lead.get("city") or "N/A",
        state=lead.get("state") or "N/A",
        lease_number=lead.get("lease_number") or "N/A",
        location_code_line=_location_code_line(lead.get("location_code")),
        lessor_name=lead.get("lessor_name") or "N/A",
        tenant_agency=lead.get("tenant_agency") or lead.get("agency_full_name") or "N/A",
        annual_rent=lead.get("annual_rent") or "N/A",
        square_feet=lead.get("square_feet") or "N/A",
        recorded_owner=lead.get("recorded_owner") or lead.get("lessor_name") or "N/A",
    )


def build_county_lookup_prompt(lead: dict) -> str:
    """Format the county lookup prompt with lead data."""
    return COUNTY_LOOKUP_PROMPT.format(
        address=lead.get("address") or "N/A",
        city=lead.get("city") or "N/A",
        state=lead.get("state") or "N/A",
        location_code_line=_location_code_line(lead.get("location_code"), include_hint=True),
    )


def build_contact_discovery_prompt(lead: dict) -> str:
    """Format the contact discovery prompt with lead data."""
    return CONTACT_DISCOVERY_PROMPT.format(
        address=lead.get("address") or "N/A",
        city=lead.get("city") or "N/A",
        state=lead.get("state") or "N/A",
        lease_number=lead.get("lease_number") or "N/A",
        location_code_line=_location_code_line(lead.get("location_code")),
        lessor_name=lead.get("lessor_name") or lead.get("recorded_owner") or "N/A",
        owner_type=lead.get("owner_type") or "Unknown",
        state_of_incorporation=lead.get("state_of_incorporation") or "Unknown",
        principal_names=lead.get("principal_names") or "N/A",
    )


# ---------------------------------------------------------------------------
# AI calling
# ---------------------------------------------------------------------------

def call_ai(prompt: str) -> dict | None:
    """Call OpenAI-compatible API and parse JSON response."""
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set — skipping AI call")
        return None

    try:
        import openai

        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        logger.error("AI call failed: %s", e)
        return None


def research_entity(lead: dict) -> dict | None:
    """Run entity resolution AI research on a lead."""
    prompt = build_entity_resolution_prompt(lead)
    return call_ai(prompt)


def research_county(lead: dict) -> dict | None:
    """Run county lookup AI research on a lead."""
    prompt = build_county_lookup_prompt(lead)
    return call_ai(prompt)


def research_contacts(lead: dict) -> dict | None:
    """Run contact discovery AI research on a lead."""
    prompt = build_contact_discovery_prompt(lead)
    return call_ai(prompt)


# ---------------------------------------------------------------------------
# Batch research
# ---------------------------------------------------------------------------

def run_research(*, research_type: str = "entity", limit: int = 10, dry_run: bool = False) -> dict:
    """Run AI research on leads that need it."""
    from supabase import create_client

    client = create_client(
        os.environ.get("GOV_SUPABASE_URL", ""),
        os.environ.get("GOV_SUPABASE_KEY", ""),
    )

    query = (
        client.table("prospect_leads")
        .select("*")
        .eq("research_status", "pending")
        .order("priority_score", desc=True)
        .limit(limit)
    )
    resp = query.execute()
    leads = resp.data or []

    researched = 0
    for lead in leads:
        if research_type == "entity":
            result = research_entity(lead)
        elif research_type == "county":
            result = research_county(lead)
        elif research_type == "contact":
            result = research_contacts(lead)
        else:
            logger.error("Unknown research type: %s", research_type)
            break

        if result and not dry_run:
            updates = {"research_status": "completed"}
            if research_type == "entity":
                updates.update({
                    k: v for k, v in {
                        "true_owner": result.get("true_owner"),
                        "owner_type": result.get("owner_type"),
                        "state_of_incorporation": result.get("state_of_incorporation"),
                        "principal_names": result.get("parent_company"),
                    }.items() if v
                })
            elif research_type == "county":
                if result.get("county"):
                    updates["county"] = result["county"]
            elif research_type == "contact":
                updates.update({
                    k: v for k, v in {
                        "contact_name": result.get("contact_name"),
                        "contact_title": result.get("contact_title"),
                        "contact_company": result.get("contact_company"),
                        "contact_phone": result.get("contact_phone"),
                        "contact_email": result.get("contact_email"),
                        "mailing_address": result.get("mailing_address"),
                    }.items() if v
                })

            client.table("prospect_leads").update(updates).eq(
                "lead_id", lead["lead_id"]
            ).execute()
            researched += 1

    return {"total": len(leads), "researched": researched}


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Run AI research on prospect leads")
    parser.add_argument("--type", choices=["entity", "county", "contact"], default="entity")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_research(research_type=args.type, limit=args.limit, dry_run=args.dry_run)
    print(result)
