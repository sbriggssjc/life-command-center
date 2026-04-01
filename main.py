"""
FastAPI application — Lead management API with location_code support.

Endpoints:
  GET    /leads                — List leads (filterable)
  GET    /leads/{lead_id}      — Get single lead
  POST   /leads                — Create a lead
  PATCH  /leads/{lead_id}      — Update a lead
  GET    /leads/search         — Search leads by query
  GET    /location-codes       — Search location_code_reference table
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from supabase import create_client

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

app = FastAPI(title="Life Command Center — Leads API", version="1.0.0")


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# =============================================================================
# Pydantic Models
# =============================================================================

class LeadBase(BaseModel):
    lease_number: Optional[str] = None
    location_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    event_type: Optional[str] = None
    event_date: Optional[str] = None
    lessor_name: Optional[str] = None
    sq_ft: Optional[float] = None
    monthly_rent: Optional[float] = None
    annual_rent: Optional[float] = None
    expiration_date: Optional[str] = None
    status: Optional[str] = None


class LeadCreate(LeadBase):
    lease_number: str


class LeadUpdate(BaseModel):
    location_code: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    event_type: Optional[str] = None
    event_date: Optional[str] = None
    lessor_name: Optional[str] = None
    sq_ft: Optional[float] = None
    monthly_rent: Optional[float] = None
    annual_rent: Optional[float] = None
    expiration_date: Optional[str] = None
    status: Optional[str] = None
    property_id: Optional[str] = None


class LeadResponse(LeadBase):
    lead_id: str
    property_id: Optional[str] = None
    match_tier: Optional[str] = None
    match_confidence: Optional[float] = None
    source: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# =============================================================================
# Lead Endpoints
# =============================================================================

@app.get("/leads")
async def list_leads(
    state: Optional[str] = None,
    status: Optional[str] = None,
    location_code: Optional[str] = None,
    lease_number: Optional[str] = None,
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0, ge=0),
):
    """List leads with optional filters. Includes location_code in response."""
    supabase = get_supabase()

    query = supabase.table("prospect_leads").select(
        "lead_id, lease_number, location_code, address, city, state, zip, "
        "event_type, event_date, lessor_name, sq_ft, monthly_rent, annual_rent, "
        "expiration_date, status, property_id, match_tier, match_confidence, "
        "source, created_at, updated_at"
    )

    if state:
        query = query.eq("state", state.upper())
    if status:
        query = query.eq("status", status)
    if location_code:
        query = query.eq("location_code", location_code)
    if lease_number:
        query = query.eq("lease_number", lease_number)

    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()

    return {"leads": result.data or [], "count": len(result.data or [])}


@app.get("/leads/search")
async def search_leads(
    q: str = Query(..., min_length=2, description="Search term"),
    limit: int = Query(default=50, le=200),
):
    """Search leads by address, lessor name, lease number, or location_code."""
    supabase = get_supabase()

    # Search across multiple fields using or filter
    result = supabase.table("prospect_leads").select(
        "lead_id, lease_number, location_code, address, city, state, "
        "lessor_name, status, created_at"
    ).or_(
        f"address.ilike.%{q}%,"
        f"lessor_name.ilike.%{q}%,"
        f"lease_number.ilike.%{q}%,"
        f"location_code.ilike.%{q}%"
    ).limit(limit).execute()

    return {"leads": result.data or [], "count": len(result.data or [])}


@app.get("/leads/{lead_id}")
async def get_lead(lead_id: str):
    """Get a single lead by ID. Includes location_code."""
    supabase = get_supabase()

    result = supabase.table("prospect_leads").select("*").eq(
        "lead_id", lead_id
    ).limit(1).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    return {"lead": result.data[0]}


@app.post("/leads", status_code=201)
async def create_lead(lead: LeadCreate):
    """Create a new prospect lead. Accepts location_code in body."""
    supabase = get_supabase()

    lead_data = lead.model_dump(exclude_none=True)
    lead_data["source"] = lead_data.get("source", "api")
    lead_data["status"] = lead_data.get("status", "new")
    lead_data["created_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("prospect_leads").insert(lead_data).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create lead")

    return {"lead": result.data[0]}


@app.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, updates: LeadUpdate):
    """Update a lead. Accepts location_code in body."""
    supabase = get_supabase()

    # Verify lead exists
    existing = supabase.table("prospect_leads").select("lead_id").eq(
        "lead_id", lead_id
    ).limit(1).execute()

    if not existing.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    update_data = updates.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No updates provided")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table("prospect_leads").update(update_data).eq(
        "lead_id", lead_id
    ).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update lead")

    return {"lead": result.data[0]}


# =============================================================================
# Location Code Reference Endpoint
# =============================================================================

@app.get("/location-codes")
async def list_location_codes(
    state: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(default=50, le=200),
):
    """Search location_code_reference table for validation/autocomplete."""
    supabase = get_supabase()

    query = supabase.table("location_code_reference").select("*")

    if state:
        query = query.eq("state", state.upper())
    if q:
        query = query.ilike("location_code", f"%{q}%")

    result = query.limit(limit).execute()

    return {"location_codes": result.data or [], "count": len(result.data or [])}


# =============================================================================
# Health check
# =============================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
