# Context Packet Schema

> **Owner:** Team Briggs / NorthMarq
> **Date:** 2026-04-06
> **Status:** Draft — foundational intelligence specification
> **Prerequisite:** Read `lcc_intelligent_operating_system_v2.md` and `copilot_operating_system_blueprint.md`

---

## 1. What a Context Packet Is

A context packet is a **structured, pre-assembled intelligence payload** delivered to any AI-consuming surface at the moment of action. It contains everything the model needs to act intelligently on a specific entity, relationship, or situation — assembled from Supabase (Gov, Dia, LCC), Salesforce, and Microsoft 365 sources — within a defined token budget.

Context packets are **not raw database dumps.** They are curated summaries: the right information, in the right shape, at the right moment. The quality of every AI output in the system — every drafted email, every call prep summary, every BOV cover, every daily briefing — is a direct function of the quality of its packet.

**Core principle:** Assemble once, consume everywhere. Every AI surface (Copilot chat, email draft, pre-call brief, daily briefing, listing marketing action) draws from the same packet schema rather than constructing its own ad hoc queries.

---

## 2. Packet Assembly Service

### 2.1 Overview

The Packet Assembly Service (PAS) is an LCC-owned microservice responsible for:

1. Receiving an assembly request: entity type + entity ID + context type + optional surface hint
2. Querying all relevant sources (Gov DB, Dia DB, LCC DB, Salesforce, Graph API cache)
3. Assembling and compressing the payload to fit within the token budget for the requested packet type
4. Caching the result with a TTL appropriate to the packet type
5. Invalidating and rebuilding when a relevant event fires
6. Logging every assembly request for performance monitoring

### 2.2 Assembly Request Schema

```json
{
  "packet_type": "contact | property | pursuit | deal | daily_briefing | listing_marketing | comp_analysis",
  "entity_id": "uuid",
  "entity_type": "contact | property | pursuit | deal | listing",
  "surface_hint": "copilot_chat | email_draft | pre_call | daily_briefing | report | bod_dossier",
  "requesting_user": "user_id",
  "force_refresh": false
}
```

### 2.3 Cache TTL by Packet Type

| Packet Type | TTL | Invalidation Triggers |
|---|---|---|
| Contact | 24 hours | New email, touchpoint logged, deal stage change |
| Property | 48 hours | Ownership change, lease update, new comp |
| Pursuit | 12 hours | New touchpoint, owner response, comp update |
| Deal | 4 hours | Email received, stage change, critical date update |
| Daily Briefing | Generated at 6:00 AM, rebuilt on demand | Any strategic item change |
| Listing Marketing | 6 hours | New OM download, buyer activity, seller comm sent |
| Comp Analysis | 72 hours | New recorded sale in target market |

### 2.4 Token Budgets by Packet Type

| Packet Type | Target Tokens | Hard Cap |
|---|---|---|
| Contact | 600 | 900 |
| Property | 800 | 1,200 |
| Pursuit | 1,000 | 1,500 |
| Deal | 1,200 | 1,800 |
| Daily Briefing | 1,500 | 2,500 |
| Listing Marketing | 800 | 1,200 |
| Comp Analysis | 700 | 1,000 |

Token compression priority when budget is exceeded: drop oldest/lowest-scored items first, preserve critical date data and active deal context last.

---

## 3. Packet Type Specifications

---

### 3.1 Contact Packet

**Purpose:** Pre-call preparation, email drafting, outreach personalization, relationship health assessment.

**Assembled when:** User clicks "Call," "Draft Email," or "View Contact" in LCC; Copilot receives a query about a contact; an email from this contact arrives in Outlook.

**Schema:**

```json
{
  "packet_type": "contact",
  "generated_at": "ISO timestamp",
  "ttl_expires": "ISO timestamp",
  "contact": {
    "id": "uuid",
    "full_name": "string",
    "title": "string",
    "firm": "string",
    "firm_type": "owner | buyer | broker | lender | tenant_rep | other",
    "domain": "government | dialysis | both | other",
    "phone": "string",
    "email": "string",
    "geography": ["string"],
    "preferred_contact_method": "phone | email | unknown"
  },
  "relationship": {
    "engagement_score": 0-100,
    "tier": "top_repeat | active | new_lead | dormant",
    "total_touchpoints": "integer",
    "last_touchpoint": {
      "date": "ISO date",
      "type": "call | email | meeting | mass_email",
      "outcome": "string",
      "days_since": "integer"
    },
    "cadence_target": "7_in_6mo | 4_per_year | monthly | biweekly",
    "cadence_status": "on_track | due | overdue",
    "days_until_next_touch_due": "integer (negative = overdue)",
    "response_rate": "percentage",
    "best_response_time": "morning | afternoon | evening | unknown"
  },
  "deal_history": {
    "deals_transacted": "integer",
    "total_volume": "dollar amount",
    "last_deal": {
      "property_name": "string",
      "close_date": "ISO date",
      "role": "buyer | seller | broker_rep | lender"
    },
    "asset_preferences": {
      "property_types": ["government | dialysis | other"],
      "geographies": ["string"],
      "cap_rate_range": "string",
      "deal_size_range": "string",
      "typical_hold_period": "string"
    }
  },
  "active_context": {
    "open_deals": [
      {
        "deal_name": "string",
        "stage": "string",
        "role": "string",
        "last_action": "string",
        "next_action": "string"
      }
    ],
    "listings_viewed": [
      {
        "listing_name": "string",
        "viewed_date": "ISO date",
        "om_downloaded": "boolean",
        "follow_up_status": "called | emailed | not_contacted"
      }
    ],
    "open_threads": ["string"]
  },
  "inventory_matches": [
    {
      "listing_name": "string",
      "match_reason": "string",
      "match_score": 0-100
    }
  ],
  "suggested_outreach": {
    "recommended_action": "call | email | send_report | send_listing",
    "suggested_angle": "string (1-2 sentences: why reach out now, what to say)",
    "draft_hook": "string (opening line for email or call opener)",
    "relevant_asset": "string (property name if applicable)"
  }
}
```

---

### 3.2 Property Packet

**Purpose:** Ownership research, pursuit initiation, BOV preparation, listing pricing, comp delivery.

**Assembled when:** User opens a property record; Copilot queries a property; a pursuit is created; BOV request is received.

**Schema:**

```json
{
  "packet_type": "property",
  "generated_at": "ISO timestamp",
  "property": {
    "id": "uuid",
    "name": "string",
    "address": "string",
    "city_state": "string",
    "domain": "government | dialysis",
    "property_type": "string",
    "year_built": "integer",
    "building_sf": "integer",
    "lot_sf": "integer",
    "tenant": "string",
    "lease_type": "NNN | NN | Gross | other",
    "lease_expiration": "ISO date",
    "remaining_lease_term_years": "float",
    "annual_rent": "dollar amount",
    "rent_escalations": "string",
    "occupancy_status": "occupied | vacant | partial"
  },
  "domain_specifics": {
    "government": {
      "agency": "string",
      "lease_type_gov": "GSA | USPS | USDA | DoD | Other Federal | State | Municipal",
      "mission_critical": "boolean",
      "lease_expiration_risk": "low | medium | high",
      "renewal_probability": "low | medium | high | unknown",
      "security_clearance_required": "boolean"
    },
    "dialysis": {
      "operator": "DaVita | Fresenius | American Renal | other",
      "clinic_id": "uuid (link to Dia DB clinic record)",
      "patient_count_current": "integer",
      "patient_count_trend": "growing | stable | declining",
      "patient_count_change_pct_12mo": "float",
      "payer_mix_medicare_pct": "float",
      "quality_score": "CMS rating",
      "cost_report_year": "integer"
    }
  },
  "ownership": {
    "recorded_owner": "string",
    "recorded_owner_entity_type": "LLC | LP | Corp | Trust | Individual | REIT | other",
    "true_owner": "string",
    "true_owner_confidence": "confirmed | likely | researching",
    "owner_contact_id": "uuid (link to contact record, if known)",
    "acquisition_date": "ISO date",
    "acquisition_price": "dollar amount",
    "years_held": "float",
    "prior_owners": ["string"]
  },
  "valuation": {
    "estimated_value_range": "string",
    "implied_cap_rate_range": "string",
    "comp_basis": "string (brief methodology note)",
    "last_bov_date": "ISO date",
    "last_bov_value": "dollar amount"
  },
  "comparable_sales": [
    {
      "address": "string",
      "close_date": "ISO date",
      "sale_price": "dollar amount",
      "cap_rate": "float",
      "lease_term_remaining_at_sale": "float",
      "tenant": "string",
      "similarity_score": 0-100,
      "key_delta": "string (what differs from subject)"
    }
  ],
  "market_context": {
    "submarket": "string",
    "cap_rate_trend": "compressing | stable | expanding",
    "avg_market_cap_rate": "float",
    "recent_transaction_count_12mo": "integer",
    "buyer_demand": "strong | moderate | light"
  },
  "pursuit_history": {
    "pursuit_status": "not_started | researching | outreach | engaged | proposal | listed | closed | dead",
    "first_touchpoint_date": "ISO date",
    "touchpoint_count": "integer",
    "last_outreach_outcome": "string",
    "competing_brokers": ["string"]
  }
}
```

---

### 3.3 Pursuit Packet

**Purpose:** Pre-meeting preparation, BOV drafting, listing proposal assembly, competitive positioning.

**Assembled when:** User clicks "View Dossier" on a pursuit item; a BOV request is received; a meeting with a target owner is scheduled.

**Schema:**

```json
{
  "packet_type": "pursuit",
  "generated_at": "ISO timestamp",
  "pursuit": {
    "id": "uuid",
    "name": "string",
    "domain": "government | dialysis",
    "stage": "researching | outreach | engaged | proposal | stalled | dead",
    "days_in_current_stage": "integer",
    "days_since_first_touch": "integer",
    "priority_score": 0-100,
    "trigger": "string (what surfaced this opportunity — lease expiry, ownership change, patient growth, referral, etc.)"
  },
  "property_summary": "embedded Property Packet (compressed to 300 tokens)",
  "owner_summary": "embedded Contact Packet (compressed to 300 tokens)",
  "why_now": {
    "trigger_type": "lease_expiration | ownership_change | patient_growth | market_timing | financial_event | referral | inbound",
    "trigger_detail": "string",
    "urgency": "immediate | near_term | long_cycle",
    "window": "string (estimated decision timeline)"
  },
  "competitive_context": {
    "broker_competition": "none_known | possible | confirmed",
    "competing_brokers": ["string"],
    "our_relationship_advantage": "string",
    "market_authority_signals": ["string (recent closes in same market/asset type)"]
  },
  "talking_points": [
    "string (each a specific, data-backed point relevant to this pursuit)"
  ],
  "comp_highlights": [
    {
      "address": "string",
      "cap_rate": "float",
      "sale_price": "dollar amount",
      "relevance": "string"
    }
  ],
  "proposed_pricing": {
    "suggested_list_price": "dollar amount",
    "suggested_cap_rate": "float",
    "pricing_rationale": "string"
  },
  "next_actions": [
    {
      "action": "string",
      "owner": "user_id",
      "due": "ISO date"
    }
  ],
  "touchpoint_history": [
    {
      "date": "ISO date",
      "type": "string",
      "outcome": "string",
      "next_step_set": "boolean"
    }
  ]
}
```

---

### 3.4 Deal Packet

**Purpose:** Active deal management, seller reporting, buyer follow-up drafting, critical date tracking, client update preparation.

**Assembled when:** User opens a deal record; a deal-related email arrives; a critical date is within 7 days; Copilot queries deal status.

**Schema:**

```json
{
  "packet_type": "deal",
  "generated_at": "ISO timestamp",
  "deal": {
    "id": "uuid",
    "name": "string",
    "domain": "government | dialysis",
    "stage": "listed | marketing | under_contract | due_diligence | closing | closed",
    "list_date": "ISO date",
    "days_on_market": "integer",
    "list_price": "dollar amount",
    "list_cap_rate": "float",
    "contract_price": "dollar amount (if under contract)",
    "contract_cap_rate": "float (if under contract)",
    "projected_close": "ISO date",
    "commission_rate": "float",
    "estimated_fee": "dollar amount"
  },
  "parties": {
    "seller": "embedded Contact Packet (compressed)",
    "buyer": "embedded Contact Packet (compressed, if identified)",
    "buyer_broker": "string",
    "lender": "string",
    "title_company": "string",
    "escrow_officer": "string"
  },
  "marketing_status": {
    "buyer_list_size": "integer",
    "buyers_contacted": "integer",
    "om_downloads": "integer",
    "showings": "integer",
    "offers_received": "integer",
    "om_downloaders_not_called": "integer",
    "last_marketing_action": "string",
    "last_marketing_date": "ISO date",
    "buyer_outreach_pace": "on_track | behind | ahead"
  },
  "critical_dates": [
    {
      "event": "string",
      "date": "ISO date",
      "days_until": "integer",
      "status": "upcoming | due | overdue | completed",
      "action_required": "string"
    }
  ],
  "open_items": [
    {
      "item": "string",
      "owner": "string",
      "due": "ISO date",
      "status": "open | in_progress | blocked | resolved"
    }
  ],
  "communication_history": {
    "last_seller_update": "ISO date",
    "days_since_seller_update": "integer",
    "seller_sentiment": "positive | neutral | concerned | unknown",
    "last_buyer_communication": "ISO date",
    "open_buyer_questions": ["string"]
  },
  "suggested_actions": [
    {
      "priority": "high | medium | low",
      "action": "string",
      "rationale": "string"
    }
  ]
}
```

---

### 3.5 Daily Briefing Packet

**Purpose:** Morning command queue generation, strategic priority ranking, production score calculation.

**Assembled when:** 6:00 AM daily (scheduled job); on-demand refresh from LCC homepage.

**Schema:**

```json
{
  "packet_type": "daily_briefing",
  "generated_at": "ISO timestamp",
  "date": "YYYY-MM-DD",
  "user_id": "string",
  "strategic_items": [
    {
      "priority_rank": "integer",
      "category": "deal_action | bov_request | listing_launch | offer_response | critical_date",
      "title": "string",
      "entity_name": "string",
      "entity_id": "uuid",
      "context": "string (1-2 sentences of relevant context)",
      "suggested_actions": ["string"],
      "packet_reference": "deal | pursuit | contact (packet type to load on click)"
    }
  ],
  "important_items": [
    {
      "priority_rank": "integer",
      "category": "touchpoint_due | new_lead | om_follow_up | research_ready | buyer_outreach | growth_signal",
      "title": "string",
      "entity_name": "string",
      "context": "string",
      "suggested_actions": ["string"]
    }
  ],
  "urgent_items": [
    {
      "priority_rank": "integer",
      "category": "inbox_triage | sf_task | seller_report_due | overdue_item",
      "title": "string",
      "context": "string",
      "suggested_actions": ["string"]
    }
  ],
  "production_score": {
    "bd_touchpoints": { "planned": "integer", "completed_yesterday": "integer", "weekly_target": "integer", "weekly_completed": "integer" },
    "new_leads_researched": { "daily_target": "integer", "weekly_completed": "integer" },
    "calls_logged": { "weekly_completed": "integer", "weekly_target": "integer" },
    "om_follow_ups_completed": { "open": "integer", "overdue_48h": "integer" },
    "seller_reports_sent": { "due_this_week": "integer", "sent": "integer" }
  },
  "overnight_signals": [
    {
      "signal_type": "om_download | ownership_change | patient_growth | lease_expiry_alert | new_listing_match",
      "description": "string",
      "entity_name": "string",
      "recommended_action": "string"
    }
  ],
  "carry_forward_from_yesterday": [
    {
      "item": "string",
      "days_carried": "integer"
    }
  ]
}
```

---

### 3.6 Listing Marketing Packet

**Purpose:** Buyer outreach planning, seller report generation, marketing pace assessment, follow-up batch drafting.

**Assembled when:** User opens a listing's marketing view; seller report is due; OM download threshold is crossed; outreach pace falls behind.

**Schema:**

```json
{
  "packet_type": "listing_marketing",
  "generated_at": "ISO timestamp",
  "listing": {
    "id": "uuid",
    "name": "string",
    "domain": "government | dialysis",
    "list_date": "ISO date",
    "days_on_market": "integer",
    "list_price": "dollar amount",
    "cap_rate": "float",
    "property_summary": "string (3-4 sentence description for email use)"
  },
  "seller": "embedded Contact Packet (compressed)",
  "buyer_funnel": {
    "total_target_list": "integer",
    "contacted": "integer",
    "om_distributed": "integer",
    "om_downloaded": "integer",
    "showings_completed": "integer",
    "offers_received": "integer",
    "best_offer": "dollar amount",
    "outreach_pace": "on_track | behind | ahead",
    "weekly_target_contacts": "integer"
  },
  "follow_up_queue": [
    {
      "contact_name": "string",
      "firm": "string",
      "contact_id": "uuid",
      "action_type": "first_call | om_download_follow_up | showing_follow_up | offer_follow_up",
      "days_since_last_contact": "integer",
      "priority_score": 0-100,
      "suggested_approach": "string"
    }
  ],
  "next_outreach_batch": [
    {
      "contact_name": "string",
      "firm": "string",
      "contact_id": "uuid",
      "reason_for_targeting": "string",
      "match_score": 0-100
    }
  ],
  "seller_report_data": {
    "report_period": "string",
    "marketing_actions_this_week": ["string"],
    "buyer_activity_summary": "string",
    "showing_notes": ["string"],
    "offer_status": "string",
    "recommended_next_steps": ["string"],
    "market_context_note": "string"
  }
}
```

---

### 3.7 Comp Analysis Packet

**Purpose:** BOV support, pricing discussions, proposal preparation, comp delivery emails.

**Assembled when:** BOV is initiated; a pricing question is asked in Copilot; a proposal is being drafted.

**Schema:**

```json
{
  "packet_type": "comp_analysis",
  "generated_at": "ISO timestamp",
  "subject_property_id": "uuid",
  "subject_summary": "string",
  "domain": "government | dialysis",
  "analysis": {
    "methodology": "string",
    "comp_count": "integer",
    "date_range": "string",
    "geography": "string",
    "avg_cap_rate": "float",
    "cap_rate_range": "string",
    "avg_price_per_sf": "dollar amount",
    "implied_value_range": "string",
    "trend_note": "string (cap rate direction in this market)"
  },
  "comps": [
    {
      "rank": "integer",
      "address": "string",
      "city_state": "string",
      "tenant": "string",
      "lease_type": "string",
      "remaining_term_at_sale": "float",
      "sale_date": "ISO date",
      "sale_price": "dollar amount",
      "cap_rate": "float",
      "price_per_sf": "dollar amount",
      "sf": "integer",
      "similarity_score": 0-100,
      "adjustment_note": "string (how this comp should be adjusted relative to subject)"
    }
  ],
  "pricing_recommendation": {
    "suggested_list_price": "dollar amount",
    "suggested_cap_rate": "float",
    "rationale": "string (2-3 sentences)",
    "risk_factors": ["string"],
    "upside_factors": ["string"]
  }
}
```

---

## 4. Context Injection Rules by Surface

Each AI-consuming surface receives a specific subset of packet data. Over-loading context wastes tokens and degrades output quality.

| Surface | Packets Injected | Max Tokens |
|---|---|---|
| Copilot chat (general) | Daily Briefing Packet | 1,500 |
| Copilot chat (entity view) | Daily Briefing + active entity packet | 2,500 |
| Email draft — prospecting outreach | Contact Packet + Pursuit Packet | 1,500 |
| Email draft — deal correspondence | Contact Packet + Deal Packet | 2,000 |
| Email draft — seller report | Listing Marketing Packet | 1,200 |
| Pre-call brief | Contact Packet | 600 |
| BOV / proposal draft | Pursuit Packet + Comp Analysis Packet | 2,500 |
| Daily briefing card (Teams/Outlook) | Daily Briefing Packet | 1,500 |
| Buyer follow-up batch | Listing Marketing Packet | 1,200 |
| Quarterly report draft | Domain summary (not a full packet — aggregate view) | 1,000 |

---

## 5. Packet Storage Schema (Supabase — LCC DB)

```sql
create table context_packets (
  id              uuid primary key default gen_random_uuid(),
  packet_type     text not null,
  entity_id       uuid,
  entity_type     text,
  requesting_user uuid references users(id),
  surface_hint    text,
  payload         jsonb not null,
  token_count     integer,
  assembled_at    timestamptz default now(),
  expires_at      timestamptz not null,
  invalidated     boolean default false,
  invalidation_reason text,
  assembly_duration_ms integer,
  model_version   text
);

create index idx_packets_entity on context_packets(entity_id, packet_type);
create index idx_packets_expiry on context_packets(expires_at) where not invalidated;
```

---

## 6. Invalidation Events

The following system events should trigger cache invalidation for the relevant packet:

| Event | Invalidates |
|---|---|
| Email received from contact X | Contact Packet for X, Deal Packet if deal-linked |
| Touchpoint logged for contact X | Contact Packet for X, Pursuit Packet if active |
| Deal stage changed | Deal Packet, Daily Briefing Packet |
| OM downloaded by contact X | Listing Marketing Packet, Contact Packet for X |
| New comp recorded | Property Packet, Comp Analysis Packet for that market |
| Ownership record updated | Property Packet |
| Critical date within 3 days | Deal Packet (force refresh, not just invalidate) |
| BOV request received | Pursuit Packet, Daily Briefing Packet |
| Research item completed | Pursuit Packet, Daily Briefing Packet |
| Patient count updated (CMS batch) | Property Packet for linked clinics, Daily Briefing if threshold crossed |

---

## 7. Governing Questions

Before adding a field to any packet schema, ask:

1. **Does an AI model need this to produce a meaningfully better output?** If the answer is no, the field adds tokens without value.
2. **Is this available in real time or only in batch?** If batch, note the staleness risk.
3. **Does this field belong here or in a different packet type?** Property financials belong in the Property Packet, not duplicated in every Pursuit Packet.
4. **Is this field derivable from other fields already present?** If yes, compute it at assembly time rather than storing it separately.
