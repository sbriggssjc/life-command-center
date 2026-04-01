"""
Pipeline API — FastAPI server exposing lead data with location_code support.

Endpoints:
  GET    /leads                — List leads (with filters)
  GET    /leads/{lead_id}      — Get lead detail
  POST   /leads                — Create a lead
  PATCH  /leads/{lead_id}      — Update a lead
  GET    /location-codes       — Search location_code_reference table
  POST   /pipeline/run         — Trigger lead pipeline
  POST   /matcher/run          — Trigger property matcher
  POST   /research/run         — Trigger AI research
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("GOV_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("GOV_SUPABASE_KEY", "")


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class LeadBase(BaseModel):
    lease_number: Optional[str] = None
    location_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    annual_rent: Optional[float] = None
    square_feet: Optional[float] = None
    lessor_name: Optional[str] = None
    tenant_agency: Optional[str] = None
    agency_full_name: Optional[str] = None
    lease_effective: Optional[str] = None
    lease_expiration: Optional[str] = None
    lead_source: Optional[str] = None
    priority_score: Optional[int] = None
    lead_temperature: Optional[str] = None
    pipeline_status: Optional[str] = None
    research_status: Optional[str] = None
    recorded_owner: Optional[str] = None
    true_owner: Optional[str] = None
    owner_type: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    contact_company: Optional[str] = None
    contact_title: Optional[str] = None
    mailing_address: Optional[str] = None
    research_notes: Optional[str] = None
    state_of_incorporation: Optional[str] = None
    principal_names: Optional[str] = None


class LeadCreate(LeadBase):
    lease_number: str  # required for creation


class LeadUpdate(LeadBase):
    pass


class LeadResponse(LeadBase):
    lead_id: int
    matched_property_id: Optional[int] = None
    matched_contact_id: Optional[int] = None
    match_tier: Optional[str] = None
    match_confidence: Optional[int] = None
    sf_lead_id: Optional[str] = None
    sf_contact_id: Optional[str] = None
    sf_opportunity_id: Optional[str] = None
    sf_sync_status: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LocationCodeEntry(BaseModel):
    location_code: str
    pbs_region: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="Life Command Center — Pipeline API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Lead endpoints
# ---------------------------------------------------------------------------

@app.get("/leads", response_model=list[LeadResponse])
async def list_leads(
    limit: int = Query(default=50, le=1000),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None, description="Filter by pipeline_status"),
    state: Optional[str] = Query(default=None, description="Filter by state"),
    location_code: Optional[str] = Query(default=None, description="Filter by location_code"),
    temperature: Optional[str] = Query(default=None, description="Filter by lead_temperature"),
    search: Optional[str] = Query(default=None, description="Search across address, city, lessor_name"),
):
    """List prospect leads with optional filters. Returns location_code in response."""
    client = get_client()

    query = (
        client.table("prospect_leads")
        .select("*")
        .order("priority_score", desc=True)
        .range(offset, offset + limit - 1)
    )

    if status:
        query = query.eq("pipeline_status", status)
    if state:
        query = query.eq("state", state.upper())
    if location_code:
        query = query.eq("location_code", location_code)
    if temperature:
        query = query.eq("lead_temperature", temperature)
    if search:
        like = f"%{search}%"
        query = query.or_(
            f"address.ilike.{like},"
            f"city.ilike.{like},"
            f"lessor_name.ilike.{like},"
            f"tenant_agency.ilike.{like},"
            f"location_code.ilike.{like}"
        )

    resp = query.execute()
    return resp.data or []


@app.get("/leads/{lead_id}", response_model=LeadResponse)
async def get_lead(lead_id: int):
    """Get a single lead by ID. Returns location_code in response."""
    client = get_client()

    resp = (
        client.table("prospect_leads")
        .select("*")
        .eq("lead_id", lead_id)
        .limit(1)
        .execute()
    )

    if not resp.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    return resp.data[0]


@app.post("/leads", response_model=LeadResponse, status_code=201)
async def create_lead(lead: LeadCreate):
    """Create a new prospect lead. Accepts location_code in body."""
    client = get_client()

    data = lead.model_dump(exclude_none=True)
    data["created_at"] = datetime.now(timezone.utc).isoformat()

    resp = client.table("prospect_leads").insert(data).execute()

    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create lead")

    return resp.data[0]


@app.patch("/leads/{lead_id}", response_model=LeadResponse)
async def update_lead(lead_id: int, lead: LeadUpdate):
    """Update an existing lead. Accepts location_code in body."""
    client = get_client()

    # Verify exists
    existing = (
        client.table("prospect_leads")
        .select("lead_id")
        .eq("lead_id", lead_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    data = lead.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    resp = (
        client.table("prospect_leads")
        .update(data)
        .eq("lead_id", lead_id)
        .execute()
    )

    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to update lead")

    return resp.data[0]


# ---------------------------------------------------------------------------
# Location code reference endpoint
# ---------------------------------------------------------------------------

@app.get("/location-codes", response_model=list[LocationCodeEntry])
async def list_location_codes(
    state: Optional[str] = Query(default=None, description="Filter by state abbreviation"),
    q: Optional[str] = Query(default=None, description="Search location codes"),
    limit: int = Query(default=50, le=200),
):
    """Search location_code_reference table for validation/autocomplete."""
    client = get_client()

    query = client.table("location_code_reference").select("*")

    if state:
        query = query.eq("state", state.upper())
    if q:
        query = query.ilike("location_code", f"%{q}%")

    query = query.order("location_code").limit(limit)
    resp = query.execute()

    return resp.data or []


# ---------------------------------------------------------------------------
# Pipeline trigger endpoints
# ---------------------------------------------------------------------------

@app.post("/pipeline/run")
async def run_pipeline(limit: int = Query(default=500), dry_run: bool = Query(default=False)):
    """Trigger the lead pipeline to process new GSA events."""
    from pipeline.lead_pipeline import process_gsa_events

    result = process_gsa_events(limit=limit, dry_run=dry_run)
    return result


@app.post("/matcher/run")
async def run_matcher(limit: int = Query(default=100), dry_run: bool = Query(default=False)):
    """Trigger the property matcher on unmatched leads."""
    from pipeline.gsa_property_matcher import match_unmatched_leads

    result = match_unmatched_leads(limit=limit, dry_run=dry_run)
    return result


@app.post("/research/run")
async def run_research(
    research_type: str = Query(default="entity"),
    limit: int = Query(default=10),
    dry_run: bool = Query(default=False),
):
    """Trigger AI research on pending leads."""
    from pipeline.ai_research import run_research as _run_research

    result = _run_research(research_type=research_type, limit=limit, dry_run=dry_run)
    return result


@app.post("/diff/run")
async def run_diff(dry_run: bool = Query(default=False)):
    """Trigger monthly diff and address backfill."""
    from pipeline.gsa_monthly_diff import run_monthly_diff

    result = run_monthly_diff(dry_run=dry_run)
    return result


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
