"""
GSA Property Matcher — Match prospect leads to properties using tiered matching.

Tier 0: Exact location_code match (highest confidence)
Tier 1: Exact address match
Tier 2: Normalized address fuzzy match
Tier 3: City + state + lessor name match
Tier 4: Lease number cross-reference
"""

import os
import logging
import re
from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Score boost when a candidate shares the same location_code as the lead
LOCATION_CODE_BOOST = 20


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def normalize_address(address):
    """Normalize an address string for fuzzy comparison."""
    if not address:
        return ""
    addr = address.upper().strip()
    replacements = {
        r"\bSTREET\b": "ST", r"\bAVENUE\b": "AVE", r"\bBOULEVARD\b": "BLVD",
        r"\bDRIVE\b": "DR", r"\bLANE\b": "LN", r"\bROAD\b": "RD",
        r"\bCOURT\b": "CT", r"\bCIRCLE\b": "CIR", r"\bPLACE\b": "PL",
        r"\bSUITE\b": "STE", r"\bAPARTMENT\b": "APT", r"\bBUILDING\b": "BLDG",
        r"\bNORTH\b": "N", r"\bSOUTH\b": "S", r"\bEAST\b": "E", r"\bWEST\b": "W",
    }
    for pattern, repl in replacements.items():
        addr = re.sub(pattern, repl, addr)
    addr = re.sub(r"[^A-Z0-9\s]", "", addr)
    addr = re.sub(r"\s+", " ", addr).strip()
    return addr


def _get_location_code_property_ids(supabase, location_code):
    """
    Query properties linked to a location_code via gsa_leases + gsa_lease_events.
    Returns list of property IDs.
    """
    result = supabase.rpc("match_properties_by_location_code", {
        "p_location_code": location_code
    }).execute()

    if result.data:
        return [row["id"] for row in result.data]

    # Fallback: manual join via separate queries
    events = supabase.table("gsa_lease_events").select("lease_number").eq(
        "location_code", location_code
    ).execute()
    lease_numbers = list({e["lease_number"] for e in (events.data or []) if e.get("lease_number")})
    if not lease_numbers:
        return []

    property_ids = set()
    for ln in lease_numbers:
        leases = supabase.table("gsa_leases").select("property_id").eq(
            "lease_number", ln
        ).not_.is_("property_id", "null").execute()
        for lease in (leases.data or []):
            if lease.get("property_id"):
                property_ids.add(lease["property_id"])

    return list(property_ids)


def _get_candidate_location_codes(supabase, property_id):
    """Get all location_codes linked to a property via gsa_leases → gsa_lease_events."""
    leases = supabase.table("gsa_leases").select("lease_number").eq(
        "property_id", property_id
    ).execute()
    lease_numbers = [l["lease_number"] for l in (leases.data or []) if l.get("lease_number")]
    if not lease_numbers:
        return set()

    codes = set()
    for ln in lease_numbers:
        events = supabase.table("gsa_lease_events").select("location_code").eq(
            "lease_number", ln
        ).not_.is_("location_code", "null").execute()
        for e in (events.data or []):
            if e.get("location_code"):
                codes.add(e["location_code"])
    return codes


def match_lead_to_property(lead, properties=None):
    """
    Match a prospect lead to a property using tiered matching.

    Args:
        lead: dict with lead data (must include location_code, address, city,
              state, lease_number, lessor_name)
        properties: optional list of property dicts to match against.
                    If None, queries from Supabase.

    Returns:
        dict with match result:
          - property_id: matched property ID or None
          - match_tier: which tier matched (tier0_location_code, tier1, etc.)
          - confidence: float 0-1
          - candidates: list of candidate matches with scores
    """
    supabase = get_supabase()
    location_code = lead.get("location_code")
    lead_address = lead.get("address")
    lead_city = lead.get("city")
    lead_state = lead.get("state")
    lease_number = lead.get("lease_number")
    lessor_name = lead.get("lessor_name")

    # =========================================================================
    # Tier 0: Exact location_code match
    # =========================================================================
    location_code_property_ids = []
    if location_code:
        location_code_property_ids = _get_location_code_property_ids(supabase, location_code)
        logger.info(
            f"Tier 0: location_code={location_code} matched "
            f"{len(location_code_property_ids)} properties"
        )

        if len(location_code_property_ids) == 1:
            return {
                "property_id": location_code_property_ids[0],
                "match_tier": "tier0_location_code",
                "confidence": 0.95,
                "candidates": [{
                    "property_id": location_code_property_ids[0],
                    "score": 100,
                    "tier": "tier0_location_code",
                }],
            }

    # Load candidate properties if not provided
    if properties is None:
        if lead_state:
            result = supabase.table("properties").select("*").eq(
                "state", lead_state
            ).limit(500).execute()
            properties = result.data or []
        else:
            properties = []

    if not properties:
        logger.info("No candidate properties found for matching.")
        return {
            "property_id": None,
            "match_tier": None,
            "confidence": 0.0,
            "candidates": [],
        }

    # Build scored candidates through tiers 1-4
    candidates = []
    normalized_lead_address = normalize_address(lead_address)

    for prop in properties:
        score = 0
        tier = None
        prop_id = prop.get("id")

        # Tier 1: Exact address match
        if lead_address and prop.get("address"):
            if lead_address.strip().upper() == prop["address"].strip().upper():
                if (lead_city or "").upper() == (prop.get("city") or "").upper():
                    score = 90
                    tier = "tier1_exact_address"

        # Tier 2: Normalized address fuzzy match
        if score == 0 and normalized_lead_address:
            normalized_prop = normalize_address(prop.get("address"))
            if normalized_prop and normalized_lead_address == normalized_prop:
                if (lead_city or "").upper() == (prop.get("city") or "").upper():
                    score = 75
                    tier = "tier2_normalized_address"

        # Tier 3: City + state + lessor name
        if score == 0 and lead_city and lessor_name:
            if ((lead_city or "").upper() == (prop.get("city") or "").upper()
                    and (lead_state or "").upper() == (prop.get("state") or "").upper()):
                prop_owner = (prop.get("owner_name") or "").upper()
                if prop_owner and lessor_name.upper() in prop_owner:
                    score = 50
                    tier = "tier3_city_state_lessor"

        # Tier 4: Lease number cross-reference
        if score == 0 and lease_number:
            leases = supabase.table("gsa_leases").select("property_id").eq(
                "lease_number", lease_number
            ).eq("property_id", prop_id).limit(1).execute()
            if leases.data:
                score = 60
                tier = "tier4_lease_xref"

        # Location code tiebreaker boost
        if score > 0 and location_code and prop_id in location_code_property_ids:
            score += LOCATION_CODE_BOOST
            logger.debug(
                f"Location code boost +{LOCATION_CODE_BOOST} for property {prop_id}"
            )

        if score > 0:
            candidates.append({
                "property_id": prop_id,
                "score": score,
                "tier": tier,
            })

    # Sort by score descending
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Location code tiebreaker: when top candidates tie, prefer the one
    # sharing the lead's location_code
    if (len(candidates) >= 2
            and candidates[0]["score"] == candidates[1]["score"]
            and location_code):
        for i, c in enumerate(candidates):
            prop_codes = _get_candidate_location_codes(supabase, c["property_id"])
            if location_code in prop_codes:
                # Move this candidate to the top
                candidates.insert(0, candidates.pop(i))
                candidates[0]["tier"] += "+location_code_tiebreak"
                break

    if candidates:
        best = candidates[0]
        confidence = min(best["score"] / 100.0, 1.0)
        return {
            "property_id": best["property_id"],
            "match_tier": best["tier"],
            "confidence": confidence,
            "candidates": candidates[:10],
        }

    return {
        "property_id": None,
        "match_tier": None,
        "confidence": 0.0,
        "candidates": [],
    }


def run_matcher(limit=50, min_confidence=0.5):
    """Run the matcher on unmatched prospect leads."""
    supabase = get_supabase()

    result = supabase.table("prospect_leads").select("*").is_(
        "property_id", "null"
    ).eq("status", "new").limit(limit).execute()

    leads = result.data or []
    logger.info(f"Found {len(leads)} unmatched leads to process.")

    results = []
    for lead in leads:
        match = match_lead_to_property(lead)
        if match["property_id"] and match["confidence"] >= min_confidence:
            supabase.table("prospect_leads").update({
                "property_id": match["property_id"],
                "match_tier": match["match_tier"],
                "match_confidence": match["confidence"],
            }).eq("lead_id", lead["lead_id"]).execute()

            logger.info(
                f"Matched lead {lead['lead_id']} → property {match['property_id']} "
                f"({match['match_tier']}, confidence={match['confidence']:.2f})"
            )
        results.append({
            "lead_id": lead["lead_id"],
            "lease_number": lead.get("lease_number"),
            **match,
        })

    return results


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    parser = argparse.ArgumentParser(description="Match prospect leads to properties")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--min-confidence", type=float, default=0.5)
    args = parser.parse_args()

    results = run_matcher(limit=args.limit, min_confidence=args.min_confidence)
    matched = sum(1 for r in results if r["property_id"])
    print(f"Processed {len(results)} leads, matched {matched}.")
