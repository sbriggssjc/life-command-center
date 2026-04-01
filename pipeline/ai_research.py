"""
AI Research — Prompt templates and AI-powered research for GSA leads.

Uses location_code in ENTITY_RESOLUTION_PROMPT, COUNTY_LOOKUP_PROMPT,
and CONTACT_DISCOVERY_PROMPT for improved disambiguation and validation.

Cost-optimised pipeline:
  - 5 verification steps use deterministic templates (zero AI cost)
  - 3 AI steps route to the cheap model tier (gpt-4o-mini) via task-based routing
"""

import os
import logging
import json
import re
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
AI_PROVIDER = os.environ.get("AI_PROVIDER", "openai").lower()
AI_API_BASE_URL = os.environ.get("AI_API_BASE_URL", "").rstrip("/")
AI_TIMEOUT_S = int(os.environ.get("AI_TIMEOUT_S", "60"))

# ---------------------------------------------------------------------------
# Model tier routing
# ---------------------------------------------------------------------------

OPENAI_MODEL_CHEAP = os.environ.get("OPENAI_MODEL_CHEAP", "gpt-4o-mini")
OPENAI_MODEL_PREMIUM = os.environ.get("OPENAI_MODEL_PREMIUM", "gpt-4o")

CHEAP_TASKS = frozenset({"classification", "draft", "extraction", "routing", "summary"})
PREMIUM_TASKS = frozenset({"analysis", "research", "sql"})


def _select_model(task: str = "research") -> str:
    """Pick model tier based on task type."""
    if task in CHEAP_TASKS:
        return OPENAI_MODEL_CHEAP
    return OPENAI_MODEL_PREMIUM


# For backward compat — default model used when no task is specified
AI_MODEL = OPENAI_MODEL_PREMIUM


# ---------------------------------------------------------------------------
# SOS Entity Search URLs — Secretary of State business search for all 50 states + DC + PR
# ---------------------------------------------------------------------------

SOS_ENTITY_SEARCH_URLS: dict[str, str] = {
    "AL": "https://arc-sos.state.al.us/cgi/corpname.mbr/output",
    "AK": "https://www.commerce.alaska.gov/cbp/Main/Search/Entities",
    "AZ": "https://ecorp.azcc.gov/EntitySearch/Index",
    "AR": "https://www.sos.arkansas.gov/corps/search_all.php",
    "CA": "https://bizfileonline.sos.ca.gov/",
    "CO": "https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do",
    "CT": "https://service.ct.gov/business/s/onlinebusinesssearch",
    "DE": "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
    "FL": "https://dos.myflorida.com/sunbiz/search/all/",
    "GA": "https://ecorp.sos.ga.gov/BusinessSearch",
    "HI": "https://hbe.ehawaii.gov/documents/search.html",
    "ID": "https://sosbiz.idaho.gov/search/business",
    "IL": "https://www.ilsos.gov/corporatellc/CorporateLlcController",
    "IN": "https://bsd.sos.in.gov/publicbusinesssearch",
    "IA": "https://sos.iowa.gov/search/business/(S(0))/search.aspx",
    "KS": "https://www.kansas.gov/bess/flow/main?execution=e1s1",
    "KY": "https://web.sos.ky.gov/bussearchnprofile/search",
    "LA": "https://coraweb.sos.la.gov/commercialsearch/CommercialSearchAnon.aspx",
    "ME": "https://icrs.informe.org/nei-sos-icrs/ICRS",
    "MD": "https://egov.maryland.gov/BusinessExpress/EntitySearch",
    "MA": "https://corp.sec.state.ma.us/corpweb/CorpSearch/CorpSearch.aspx",
    "MI": "https://cofs.lara.state.mi.us/corpweb/CorpSearch/CorpSearch.aspx",
    "MN": "https://mblsportal.sos.state.mn.us/Business/Search",
    "MS": "https://corp.sos.ms.gov/corp/portal/c/page/corpBusinessIdSearch/portal.aspx",
    "MO": "https://bsd.sos.mo.gov/BusinessEntity/BESearch.aspx",
    "MT": "https://sosmt.gov/business/",
    "NE": "https://www.nebraska.gov/sos/corp/corpsearch.cgi",
    "NV": "https://esos.nv.gov/EntitySearch/OnlineEntitySearch",
    "NH": "https://quickstart.sos.nh.gov/online/BusinessInquire",
    "NJ": "https://www.njportal.com/DOR/BusinessNameSearch/",
    "NM": "https://portal.sos.state.nm.us/BFS/online/CorporationBusinessSearch",
    "NY": "https://apps.dos.ny.gov/publicInquiry/",
    "NC": "https://www.sosnc.gov/online_services/search/by_title/_Business_Registration",
    "ND": "https://firststop.sos.nd.gov/search/business",
    "OH": "https://businesssearch.ohiosos.gov/",
    "OK": "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
    "OR": "https://sos.oregon.gov/business/Pages/find.aspx",
    "PA": "https://www.corporations.pa.gov/search/corpsearch",
    "RI": "https://business.sos.ri.gov/CorpWeb/CorpSearch/CorpSearch.aspx",
    "SC": "https://businessfilings.sc.gov/BusinessFiling/Entity/Search",
    "SD": "https://sosenterprise.sd.gov/BusinessServices/Business/FilingSearch.aspx",
    "TN": "https://tnbear.tn.gov/ECommerce/FilingSearch.aspx",
    "TX": "https://mycpa.cpa.state.tx.us/coa/",
    "UT": "https://secure.utah.gov/bes/",
    "VT": "https://bizfilings.vermont.gov/online/BusinessInquire",
    "VA": "https://cis.scc.virginia.gov/EntitySearch/Index",
    "WA": "https://ccfs.sos.wa.gov/#/",
    "WV": "https://apps.wv.gov/SOS/BusinessEntity/",
    "WI": "https://www.wdfi.org/apps/CorpSearch/Search.aspx",
    "WY": "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
    "DC": "https://corponline.dcra.dc.gov/BizEntity.aspx/",
    "PR": "https://prcorpfiling.f1hst.com/CorporationSearch.aspx",
}

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

def _call_openai(prompt: str, *, model: str | None = None) -> dict | None:
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set — skipping OpenAI call")
        return None

    import openai

    model = model or AI_MODEL
    client_kwargs = {"api_key": OPENAI_API_KEY}
    if AI_API_BASE_URL:
        client_kwargs["base_url"] = AI_API_BASE_URL
    client = openai.OpenAI(**client_kwargs)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    usage = getattr(resp, "usage", None)
    if usage:
        logger.info("AI usage provider=openai model=%s prompt_tokens=%s completion_tokens=%s", model, getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None))
    content = resp.choices[0].message.content
    return json.loads(content)


def _call_ollama(prompt: str, *, model: str | None = None) -> dict | None:
    model = model or AI_MODEL
    base_url = AI_API_BASE_URL or "http://localhost:11434"
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.2,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=AI_TIMEOUT_S) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    logger.info("AI usage provider=ollama model=%s eval_count=%s", model, body.get("eval_count"))
    return json.loads(body.get("response", "{}"))


def call_ai(prompt: str, *, task: str = "research") -> dict | None:
    """Call the configured AI provider and parse JSON response.

    Args:
        prompt: The prompt to send.
        task: Task type for model routing — 'classification' routes to the
              cheap tier, 'research' to the premium tier.
    """
    if AI_PROVIDER in {"none", "disabled"}:
        logger.warning("AI provider disabled — skipping AI call")
        return None

    model = _select_model(task)
    logger.info("AI routing task=%s model=%s", task, model)

    try:
        if AI_PROVIDER == "ollama":
            return _call_ollama(prompt, model=model)
        return _call_openai(prompt, model=model)
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        logger.error("AI network call failed: %s", e)
        return None
    except Exception as e:
        logger.error("AI call failed: %s", e)
        return None


def research_entity(lead: dict) -> dict | None:
    """Run entity resolution AI research on a lead (cheap tier)."""
    prompt = build_entity_resolution_prompt(lead)
    return call_ai(prompt, task="classification")


def research_county(lead: dict) -> dict | None:
    """Run county lookup AI research on a lead (cheap tier)."""
    prompt = build_county_lookup_prompt(lead)
    return call_ai(prompt, task="classification")


def research_contacts(lead: dict) -> dict | None:
    """Run contact discovery AI research on a lead (cheap tier)."""
    prompt = build_contact_discovery_prompt(lead)
    return call_ai(prompt, task="classification")


# ---------------------------------------------------------------------------
# Template-based verification (zero AI cost)
# ---------------------------------------------------------------------------

_ENTITY_SUFFIX_RE = re.compile(
    r",?\s*\b(LLC|L\.L\.C\.|LP|L\.P\.|Inc\.?|Corp\.?|Corporation|Ltd\.?|LLP|LLLP|REIT|Trust)\s*$",
    re.IGNORECASE,
)


def _strip_entity_suffix(name: str) -> str:
    """Remove LLC/LP/Inc/Corp suffixes for cleaner SOS searches."""
    if not name:
        return name
    return _ENTITY_SUFFIX_RE.sub("", name).strip()


def _generate_verification_template(
    step: str,
    lead: dict,
    county_urls: dict | None = None,
) -> dict:
    """Build deterministic verification instructions from cached data.

    Replaces the former AI-powered _generate_verification_instructions() for
    5 steps that only need to assemble a URL + instructions from data we
    already have cached.

    Args:
        step: One of parcel_verify, deed_owner_verify, tax_mailing_verify,
              mortgage_extract, entity_registry_verify.
        lead: The prospect lead dict.
        county_urls: Cached county authority URLs dict with keys like
                     assessor_url, recorder_url, clerk_url, tax_url,
                     treasurer_url, gis_url.  If None, an empty dict is used.

    Returns:
        A dict matching the same JSON schema the AI used to produce:
        {search_url, steps, fields_to_capture, ai_confidence, source}.
    """
    county_urls = county_urls or {}
    address = lead.get("address") or ""
    city = lead.get("city") or ""
    state = lead.get("state") or ""
    owner = lead.get("lessor_name") or lead.get("recorded_owner") or ""

    if step == "parcel_verify":
        url = county_urls.get("assessor_url") or ""
        return {
            "search_url": url,
            "steps": [
                f"Go to {url}" if url else "Look up the county assessor website",
                f"Search for property at: {address}, {city}, {state}",
                "Locate the parcel number / APN",
                "Confirm the situs address matches the lead address",
            ],
            "fields_to_capture": ["parcel_number", "situs_address", "legal_description", "assessed_value"],
            "ai_confidence": 0.9,
            "source": "template",
        }

    if step == "deed_owner_verify":
        url = county_urls.get("recorder_url") or county_urls.get("clerk_url") or ""
        return {
            "search_url": url,
            "steps": [
                f"Go to {url}" if url else "Look up the county recorder / clerk website",
                f"Search grantor/grantee index for: {owner}",
                f"Filter to property address: {address}, {city}, {state}",
                "Identify the most recent deed of record",
                "Note the grantor, grantee, and recording date",
            ],
            "fields_to_capture": ["grantor", "grantee", "recording_date", "document_number", "deed_type"],
            "ai_confidence": 0.9,
            "source": "template",
        }

    if step == "tax_mailing_verify":
        url = county_urls.get("tax_url") or county_urls.get("treasurer_url") or ""
        return {
            "search_url": url,
            "steps": [
                f"Go to {url}" if url else "Look up the county tax / treasurer website",
                f"Search for property at: {address}, {city}, {state}",
                "Locate the tax mailing address for the owner",
                "Note any differences between situs and mailing address",
            ],
            "fields_to_capture": ["mailing_name", "mailing_address", "tax_status", "annual_tax_amount"],
            "ai_confidence": 0.9,
            "source": "template",
        }

    if step == "mortgage_extract":
        url = county_urls.get("recorder_url") or ""
        return {
            "search_url": url,
            "steps": [
                f"Go to {url}" if url else "Look up the county recorder website",
                f"Search for mortgages / deeds of trust on: {address}, {city}, {state}",
                f"Filter to borrower: {owner}",
                "Identify the most recent mortgage or deed of trust",
                "Note the lender, loan amount, and recording date",
            ],
            "fields_to_capture": ["lender", "loan_amount", "recording_date", "document_number", "maturity_date"],
            "ai_confidence": 0.9,
            "source": "template",
        }

    if step == "entity_registry_verify":
        entity_name = _strip_entity_suffix(owner)
        sos_url = SOS_ENTITY_SEARCH_URLS.get(state.upper(), "") if state else ""
        return {
            "search_url": sos_url,
            "steps": [
                f"Go to {sos_url}" if sos_url else f"Look up the Secretary of State business search for {state}",
                f"Search for entity: {entity_name}",
                "Confirm the entity is active / in good standing",
                "Note the registered agent, formation date, and state of formation",
            ],
            "fields_to_capture": ["entity_name", "entity_status", "registered_agent", "formation_date", "state_of_formation"],
            "ai_confidence": 0.9,
            "source": "template",
        }

    raise ValueError(f"Unknown verification step: {step}")


# Convenience aliases for the 5 template-based steps

TEMPLATE_STEPS = frozenset({
    "parcel_verify",
    "deed_owner_verify",
    "tax_mailing_verify",
    "mortgage_extract",
    "entity_registry_verify",
})


def verify_parcel(lead: dict, county_urls: dict | None = None) -> dict:
    """Generate parcel verification instructions (no AI)."""
    return _generate_verification_template("parcel_verify", lead, county_urls)


def verify_deed_owner(lead: dict, county_urls: dict | None = None) -> dict:
    """Generate deed/owner verification instructions (no AI)."""
    return _generate_verification_template("deed_owner_verify", lead, county_urls)


def verify_tax_mailing(lead: dict, county_urls: dict | None = None) -> dict:
    """Generate tax mailing verification instructions (no AI)."""
    return _generate_verification_template("tax_mailing_verify", lead, county_urls)


def extract_mortgage(lead: dict, county_urls: dict | None = None) -> dict:
    """Generate mortgage extraction instructions (no AI)."""
    return _generate_verification_template("mortgage_extract", lead, county_urls)


def verify_entity_registry(lead: dict, county_urls: dict | None = None) -> dict:
    """Generate entity registry verification instructions (no AI)."""
    return _generate_verification_template("entity_registry_verify", lead, county_urls)


# ---------------------------------------------------------------------------
# Batch research
# ---------------------------------------------------------------------------

def run_research(*, research_type: str = "entity", limit: int = 10, dry_run: bool = False) -> dict:
    """Run AI research on leads that need it.

    Supports both AI-powered research types (entity, county, contact) and
    template-based verification steps (parcel_verify, deed_owner_verify,
    tax_mailing_verify, mortgage_extract, entity_registry_verify).
    """
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

    # Map template steps to their processor functions
    template_processors = {
        "parcel_verify": verify_parcel,
        "deed_owner_verify": verify_deed_owner,
        "tax_mailing_verify": verify_tax_mailing,
        "mortgage_extract": extract_mortgage,
        "entity_registry_verify": verify_entity_registry,
    }

    researched = 0
    for lead in leads:
        result = None

        # Template-based steps (zero AI cost)
        if research_type in template_processors:
            result = template_processors[research_type](lead)
        # AI-powered steps (cheap tier)
        elif research_type == "entity":
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

            # Template steps store their output in research_notes
            if research_type in template_processors:
                updates["research_notes"] = json.dumps(result)
            elif research_type == "entity":
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
    parser.add_argument(
        "--type",
        choices=[
            "entity", "county", "contact",
            "parcel_verify", "deed_owner_verify", "tax_mailing_verify",
            "mortgage_extract", "entity_registry_verify",
        ],
        default="entity",
    )
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_research(research_type=args.type, limit=args.limit, dry_run=args.dry_run)
    print(result)
