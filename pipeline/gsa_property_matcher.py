"""
GSA Property Matcher — Matches prospect leads to properties.

Tier 0: Exact location_code match (highest confidence)
Tier 1: Exact address match
Tier 2: Fuzzy address + city match
Tier 3: Lease number match via gsa_leases
Tier 4: Agency + city match

Location code is also used as a tiebreaker in fuzzy tiers.
"""

import os
import logging
from difflib import SequenceMatcher

from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("GOV_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("GOV_SUPABASE_KEY", "")

# Score boost when location_code matches in fuzzy tiers
LOCATION_CODE_BOOST = 20


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize(text: str | None) -> str:
    """Lowercase, strip, collapse whitespace."""
    if not text:
        return ""
    return " ".join(text.lower().split())


def fuzzy_score(a: str, b: str) -> int:
    """Return 0-100 similarity score between two strings."""
    a, b = normalize(a), normalize(b)
    if not a or not b:
        return 0
    return int(SequenceMatcher(None, a, b).ratio() * 100)


# ---------------------------------------------------------------------------
# Tier 0 — Location code exact match
# ---------------------------------------------------------------------------

def match_by_location_code(client, location_code: str) -> dict | None:
    """
    Find properties linked to this location_code via gsa_leases → gsa_lease_events.
    Returns {"property_id": ..., "tier": "tier0_location_code", "confidence": ...}
    or None.
    """
    if not location_code:
        return None

    # Query: properties joined through gsa_leases and gsa_lease_events
    resp = client.rpc(
        "match_property_by_location_code",
        {"p_location_code": location_code},
    ).execute()

    # Fallback: direct query if RPC doesn't exist
    if not resp.data:
        # Use a two-step approach since supabase-py doesn't support raw SQL joins
        events_resp = (
            client.table("gsa_lease_events")
            .select("lease_number")
            .eq("location_code", location_code)
            .execute()
        )
        lease_numbers = list({e["lease_number"] for e in (events_resp.data or []) if e.get("lease_number")})

        if not lease_numbers:
            return None

        property_ids = set()
        for batch_start in range(0, len(lease_numbers), 50):
            batch = lease_numbers[batch_start : batch_start + 50]
            leases_resp = (
                client.table("gsa_leases")
                .select("property_id")
                .in_("lease_number", batch)
                .not_.is_("property_id", "null")
                .execute()
            )
            for row in leases_resp.data or []:
                if row.get("property_id"):
                    property_ids.add(row["property_id"])

        if len(property_ids) == 1:
            pid = property_ids.pop()
            logger.info("Tier 0 location_code match: %s → property %s", location_code, pid)
            return {
                "property_id": pid,
                "tier": "tier0_location_code",
                "confidence": 95,
            }
        elif len(property_ids) > 1:
            logger.info(
                "Tier 0 location_code: %s matched %d properties — will use as tiebreaker",
                location_code,
                len(property_ids),
            )
            # Return multiple matches for tiebreaker use in later tiers
            return {
                "property_ids": list(property_ids),
                "tier": "tier0_location_code_multiple",
                "confidence": 60,
            }

    elif resp.data:
        pids = list({r["property_id"] for r in resp.data if r.get("property_id")})
        if len(pids) == 1:
            return {"property_id": pids[0], "tier": "tier0_location_code", "confidence": 95}
        elif len(pids) > 1:
            return {"property_ids": pids, "tier": "tier0_location_code_multiple", "confidence": 60}

    return None


# ---------------------------------------------------------------------------
# Tier 1 — Exact address match
# ---------------------------------------------------------------------------

def match_by_exact_address(client, address: str, city: str, state: str) -> dict | None:
    addr = normalize(address)
    if not addr:
        return None

    query = client.table("properties").select("id, address, city, state")
    if addr:
        query = query.ilike("address", addr)
    if city:
        query = query.ilike("city", normalize(city))
    if state:
        query = query.eq("state", state.upper().strip())

    resp = query.limit(5).execute()
    rows = resp.data or []

    if len(rows) == 1:
        return {"property_id": rows[0]["id"], "tier": "tier1_exact_address", "confidence": 90}
    return None


# ---------------------------------------------------------------------------
# Tier 2 — Fuzzy address + city
# ---------------------------------------------------------------------------

def match_by_fuzzy_address(client, address: str, city: str, state: str,
                           location_code_pids: list | None = None) -> dict | None:
    if not address:
        return None

    query = client.table("properties").select("id, address, city, state")
    if state:
        query = query.eq("state", state.upper().strip())
    if city:
        query = query.ilike("city", f"%{normalize(city)}%")

    resp = query.limit(100).execute()
    candidates = resp.data or []

    if not candidates:
        return None

    scored = []
    for c in candidates:
        score = fuzzy_score(address, c.get("address", ""))
        city_score = fuzzy_score(city or "", c.get("city", ""))
        total = int(score * 0.7 + city_score * 0.3)

        # Location code tiebreaker boost
        if location_code_pids and c["id"] in location_code_pids:
            total += LOCATION_CODE_BOOST
            logger.debug("Location code boost applied to property %s", c["id"])

        scored.append((c["id"], total))

    scored.sort(key=lambda x: -x[1])

    if scored and scored[0][1] >= 70:
        # Check margin — only return if clearly best
        if len(scored) == 1 or scored[0][1] - scored[1][1] >= 10:
            return {
                "property_id": scored[0][0],
                "tier": "tier2_fuzzy_address",
                "confidence": scored[0][1],
            }

    return None


# ---------------------------------------------------------------------------
# Tier 3 — Lease number via gsa_leases
# ---------------------------------------------------------------------------

def match_by_lease_number(client, lease_number: str) -> dict | None:
    if not lease_number:
        return None

    resp = (
        client.table("gsa_leases")
        .select("property_id")
        .eq("lease_number", lease_number)
        .not_.is_("property_id", "null")
        .limit(5)
        .execute()
    )
    pids = list({r["property_id"] for r in (resp.data or []) if r.get("property_id")})

    if len(pids) == 1:
        return {"property_id": pids[0], "tier": "tier3_lease_number", "confidence": 85}
    return None


# ---------------------------------------------------------------------------
# Tier 4 — Agency + city
# ---------------------------------------------------------------------------

def match_by_agency_city(client, agency: str, city: str, state: str,
                         location_code_pids: list | None = None) -> dict | None:
    if not agency or not city:
        return None

    resp = (
        client.table("properties")
        .select("id, address, city, state")
        .ilike("city", normalize(city))
        .limit(100)
        .execute()
    )
    candidates = resp.data or []

    if not candidates:
        return None

    scored = []
    for c in candidates:
        score = 40  # base score for city match
        if state and c.get("state", "").upper() == state.upper():
            score += 10

        # Location code tiebreaker boost
        if location_code_pids and c["id"] in location_code_pids:
            score += LOCATION_CODE_BOOST

        scored.append((c["id"], score))

    scored.sort(key=lambda x: -x[1])

    if scored and scored[0][1] >= 60:
        return {
            "property_id": scored[0][0],
            "tier": "tier4_agency_city",
            "confidence": scored[0][1],
        }
    return None


# ---------------------------------------------------------------------------
# Main matcher
# ---------------------------------------------------------------------------

def match_lead(lead: dict) -> dict | None:
    """
    Run tiered matching for a prospect lead. Returns match result dict or None.

    Lead dict should have: lease_number, location_code, address, city, state,
    tenant_agency, agency_full_name.
    """
    client = get_client()

    location_code = lead.get("location_code")
    address = lead.get("address")
    city = lead.get("city")
    state = lead.get("state")
    lease_number = lead.get("lease_number")
    agency = lead.get("tenant_agency") or lead.get("agency_full_name")

    # Tier 0: Location code exact match
    location_result = match_by_location_code(client, location_code)
    if location_result and location_result.get("property_id"):
        return location_result

    # Extract location_code property IDs for tiebreaker use in later tiers
    location_code_pids = None
    if location_result and location_result.get("property_ids"):
        location_code_pids = location_result["property_ids"]

    # Tier 1: Exact address
    result = match_by_exact_address(client, address, city, state)
    if result:
        return result

    # Tier 2: Fuzzy address (with location_code tiebreaker)
    result = match_by_fuzzy_address(client, address, city, state, location_code_pids)
    if result:
        return result

    # Tier 3: Lease number
    result = match_by_lease_number(client, lease_number)
    if result:
        return result

    # Tier 4: Agency + city (with location_code tiebreaker)
    result = match_by_agency_city(client, agency, city, state, location_code_pids)
    if result:
        return result

    logger.info("No match found for lead %s (lease %s)", lead.get("lead_id"), lease_number)
    return None


def match_unmatched_leads(*, limit: int = 100, dry_run: bool = False) -> dict:
    """Run matcher on leads that don't yet have a matched_property_id."""
    client = get_client()

    resp = (
        client.table("prospect_leads")
        .select("lead_id, lease_number, location_code, address, city, state, tenant_agency, agency_full_name")
        .is_("matched_property_id", "null")
        .order("priority_score", desc=True)
        .limit(limit)
        .execute()
    )

    leads = resp.data or []
    logger.info("Found %d unmatched leads to process", len(leads))

    matched = 0
    for lead in leads:
        result = match_lead(lead)
        if result and result.get("property_id"):
            matched += 1
            if not dry_run:
                client.table("prospect_leads").update({
                    "matched_property_id": result["property_id"],
                    "match_tier": result["tier"],
                    "match_confidence": result["confidence"],
                }).eq("lead_id", lead["lead_id"]).execute()
            logger.info(
                "Matched lead %s → property %s (%s, confidence=%d)",
                lead["lead_id"], result["property_id"], result["tier"], result["confidence"],
            )

    return {"total": len(leads), "matched": matched}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Match prospect leads to properties")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = match_unmatched_leads(limit=args.limit, dry_run=args.dry_run)
    print(result)
