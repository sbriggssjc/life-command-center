# Template Library Specification

> **Owner:** Team Briggs / NorthMarq
> **Date:** 2026-04-06
> **Status:** Draft
> **Dependency:** `context_packet_schema.md` — all templates are packet-bound

---

## 1. Purpose

The Template Library is the **outbound communication engine** of the LCC system. It defines every repeatable outreach and communication structure used by the team, parameterized by context variables drawn from assembled context packets.

Templates eliminate the "blank page" problem. Every outreach action in LCC — a prospecting email, a listing announcement, a seller report cover, a BOV delivery — should begin with a populated draft, not an empty compose window.

**Design philosophy:**
- Templates declare their variable slots explicitly. The system can only draft a template if the required packet provides all mandatory variables.
- Templates are versioned. Every send is recorded against a specific template version so performance can be attributed accurately.
- Templates improve over time. Response rate, deal advancement rate, and user edit distance are tracked per template variant.
- Templates are not scripts. They produce a starting draft — the broker reviews, edits, and sends. The system measures edit distance to understand how often drafts are used as-is vs. heavily modified.

---

## 2. Template Registry

### 2.1 Template Categories

| Category | Templates | Primary Packet Binding |
|---|---|---|
| Seller BD | First touch, cadence follow-up, capital markets update, BOV delivery cover, listing win confirmation | Contact + Pursuit |
| Buyer BD | Listing announcement, OM distribution, early look preview, OM download follow-up, offer follow-up | Contact + Listing Marketing |
| Listing Marketing | Launch announcement (seller list), broker blast, closing announcement, post-close thank you | Listing Marketing + Contact |
| Seller Communication | Weekly activity report, showing feedback summary, offer summary, critical date reminder | Deal + Listing Marketing |
| Deal Execution | PSA cover, due diligence request, extension request, closing checklist reminder, lender follow-up | Deal + Contact |
| Mass Marketing | Quarterly capital markets update (government), quarterly capital markets update (dialysis), new listing blast, closing blast | Domain aggregate + Contact segment |
| Research Outreach | Cold ownership inquiry, warm ownership follow-up, entity research response request | Contact + Property |

---

## 3. Template Specifications

Each template is defined by: purpose, packet binding, variable slots, performance metrics, and the base structure.

---

### T-001 — First Touch (Seller BD)

**Purpose:** Initial outreach to a net new owner/developer identified through research. No prior relationship.

**Packet binding:** Contact Packet + Property Packet

**Mandatory variables:**
- `{{contact.full_name}}`
- `{{contact.firm}}`
- `{{property.name}}` or `{{property.city_state}}`
- `{{property.domain}}` (government or dialysis — drives which market context to include)
- `{{suggested_outreach.suggested_angle}}`
- `{{team.recent_close_in_market}}` (a relevant recent close to establish credibility)

**Optional variables:**
- `{{property.tenant}}`
- `{{property.lease_expiration}}` (if known, can reference lease context)
- `{{contact.asset_preferences.geographies}}`

**Base structure:**
```
Subject: [City, State] [Asset Type] Market — [Firm Name]

[contact.full_name],

[suggested_outreach.suggested_angle — 1 sentence establishing why you're reaching out, specific to their asset or market position.]

We specialize exclusively in [domain] net lease investment sales and have recently [team.recent_close_in_market — specific recent transaction]. Our market activity gives us direct insight into the buyer demand and pricing dynamics currently driving this sector.

[Optional: If lease context is available — "Given the lease profile on [property.name], we'd welcome the opportunity to share a current market perspective."]

I'd appreciate a few minutes at your convenience.

[Signature]
```

**Performance targets:** Open rate >35%, response rate >5%, reply-to-BOV conversion tracked.

**Version history:** Track by `template_version` field. Do not overwrite base — create new version on material change.

---

### T-002 — Cadence Follow-Up (Seller BD, Touches 2-7)

**Purpose:** Maintain presence with a known but not-yet-engaged owner. Low friction, high value delivery.

**Packet binding:** Contact Packet + Property Packet (optional) + domain market summary

**Mandatory variables:**
- `{{contact.full_name}}`
- `{{relationship.last_touchpoint.outcome}}` (brief reference to prior contact, if any)
- `{{touch_number}}` (which touch this is — drives tone variation)
- `{{value_delivery}}` (what is being delivered — market data, listing announcement, closing, quarterly report)

**Optional variables:**
- `{{inventory_matches[0].listing_name}}` (relevant current listing)
- `{{comp_highlights[0]}}` (recent relevant close)

**Tone calibration by touch number:**
- Touch 1-2: introductory, establishing expertise, no ask
- Touch 3-4: light check-in, deliver market intelligence, soft mention of activity
- Touch 5-6: direct reference to market timing or their specific asset
- Touch 7+: explicit ask for a conversation, reference relationship history

**Base structure (Touch 3-4 example):**
```
Subject: [Market] [Asset Type] Update — [Quarter/Year]

[contact.full_name],

[value_delivery — 1-2 sentences of actual market intelligence specific to their asset type and geography. Not generic.]

[Optional: "We recently closed [comp_highlights[0]] in [market], which may be relevant context for your portfolio."]

Happy to share a more detailed picture at your convenience.

[Signature]
```

---

### T-003 — Capital Markets Update (Mass / Segment)

**Purpose:** Quarterly segment-wide outreach delivering market intelligence. Sent to full government or dialysis contact segment.

**Packet binding:** Domain aggregate summary (not a standard packet — generated from domain DB quarterly rollup)

**Mandatory variables:**
- `{{domain}}` (government | dialysis)
- `{{quarter_year}}`
- `{{market_summary.transaction_count}}`
- `{{market_summary.avg_cap_rate}}`
- `{{market_summary.cap_rate_trend}}`
- `{{market_summary.notable_transactions}}` (2-3 key deals from the period)
- `{{market_summary.outlook}}`

**Personalization layer:** If contact has a known asset in the domain, insert a one-sentence reference. If contact is a buyer, reference buy-side observations.

**Performance targets:** Open rate >25%, click rate >8% (if PDF attached), reply rate >2%.

---

### T-004 — New Listing Announcement (Buyer Segment)

**Purpose:** Distribute new listing to targeted buyer segment. Designed to prompt inbound inquiry and OM requests.

**Packet binding:** Listing Marketing Packet + Contact Packet (for personalization layer)

**Mandatory variables:**
- `{{listing.name}}`
- `{{listing.domain}}`
- `{{listing.list_price}}`
- `{{listing.cap_rate}}`
- `{{listing.property_summary}}` (3-4 sentence property description from packet)
- `{{listing.tenant}}`
- `{{listing.remaining_lease_term}}`

**Personalization layer:**
- `{{contact.asset_preferences.geographies}}` — confirm geography match
- `{{deal_history.last_deal}}` — reference if they've bought similar

**Base structure:**
```
Subject: New Exclusive: [Tenant] | [City, State] | [Cap Rate]% Cap Rate

[contact.full_name],

[Personalization line if applicable: "Given your activity in [geography/asset type]..." — or omit if no match data.]

We are pleased to offer on an exclusive basis:

[listing.property_summary]

Asking Price: [listing.list_price]
Cap Rate: [listing.cap_rate]%
Lease Term Remaining: [listing.remaining_lease_term]

OM and financial details available upon request.

[Signature]
```

---

### T-005 — Early Look Preview (Top Buyer — Pre-Market)

**Purpose:** Give highest-priority buyers a pre-market first look before full launch. Creates urgency, deepens buyer relationship.

**Packet binding:** Listing Marketing Packet + Contact Packet

**Mandatory variables:** Same as T-004, plus:
- `{{early_look_deadline}}` (date when asset goes to full market)
- `{{contact.full_name}}`
- `{{relationship.deal_history.last_deal}}` (reference prior transaction)

**Key differentiator from T-004:** Explicit exclusivity framing. "You're receiving this before we launch to the broader market."

---

### T-006 — OM Download Follow-Up

**Purpose:** Follow up with a contact who downloaded the OM but has not been called or responded. Time-sensitive — should be sent within 48 hours of download.

**Packet binding:** Listing Marketing Packet + Contact Packet

**Mandatory variables:**
- `{{contact.full_name}}`
- `{{listing.name}}`
- `{{om_download_date}}`
- `{{listing.cap_rate}}`
- `{{listing.list_price}}`

**Base structure:**
```
Subject: RE: [Listing Name] — Questions?

[contact.full_name],

I wanted to follow up — I saw you had a chance to review the materials on [listing.name]. Happy to walk you through the deal, share any additional detail, or discuss the market if helpful.

[Signature]
```

**Performance target:** >40% response rate (high-intent contact). Flag if response rate drops below 25% — adjust timing or subject line.

---

### T-007 — Seller Weekly Activity Report (Cover Email)

**Purpose:** Weekly communication to listing seller summarizing marketing activity and buyer engagement. Maintains seller confidence and relationship.

**Packet binding:** Deal Packet + Listing Marketing Packet

**Mandatory variables:**
- `{{contact.full_name}}` (seller)
- `{{listing.name}}`
- `{{seller_report_data.report_period}}`
- `{{seller_report_data.marketing_actions_this_week}}`
- `{{seller_report_data.buyer_activity_summary}}`
- `{{buyer_funnel.om_downloads}}`
- `{{buyer_funnel.showings_completed}}`
- `{{seller_report_data.recommended_next_steps}}`

**Base structure:**
```
Subject: [Listing Name] — Weekly Marketing Update [Date]

[contact.full_name],

Below is this week's activity summary for [listing.name].

Marketing Activity:
[seller_report_data.marketing_actions_this_week — bulleted list]

Buyer Engagement:
[seller_report_data.buyer_activity_summary]
- OM Downloads to Date: [buyer_funnel.om_downloads]
- Showings: [buyer_funnel.showings_completed]

[seller_report_data.showing_notes — if applicable]

Next Steps:
[seller_report_data.recommended_next_steps]

Please don't hesitate to reach out with any questions.

[Signature]
```

---

### T-008 — BOV / Valuation Delivery Cover

**Purpose:** Cover email when delivering a BOV or valuation analysis to a target owner. Sets tone for the ask.

**Packet binding:** Pursuit Packet + Comp Analysis Packet

**Mandatory variables:**
- `{{contact.full_name}}`
- `{{property.name}}`
- `{{pricing_recommendation.suggested_list_price}}`
- `{{pricing_recommendation.suggested_cap_rate}}`
- `{{pricing_recommendation.rationale}}` (compressed to 1-2 sentences)
- `{{comp_highlights}}` (2-3 key comps referenced)

---

### T-009 — Closing Announcement (Broadcast)

**Purpose:** Announce a completed transaction to full contact list. Establishes market authority and prompts inbound responses.

**Packet binding:** Deal Packet + domain aggregate

**Mandatory variables:**
- `{{deal.name}}`
- `{{deal.domain}}`
- `{{deal.contract_price}}`
- `{{deal.contract_cap_rate}}`
- `{{property.city_state}}`
- `{{property.tenant}}`
- `{{deal.close_date}}`

**Distribution:** Full government segment OR full dialysis segment, depending on domain. Both segments receive if cross-domain relevant.

---

### T-010 — Cold Ownership Inquiry

**Purpose:** Reach out to a recorded LLC or entity owner when the true owner identity is unknown. Research-driven.

**Packet binding:** Property Packet + Contact Packet (partial — entity only)

**Mandatory variables:**
- `{{property.recorded_owner}}`
- `{{property.address}}`
- `{{property.city_state}}`

**Note:** These are high-uncertainty outreach — tone must be respectful and low-pressure. System should flag for personal review before send.

---

## 4. Template Performance Tracking Schema

All template performance is tracked in the `template_performance` table in LCC DB. This feeds the learning loop in `signal_table_schema.sql`.

```sql
create table template_sends (
  id                  uuid primary key default gen_random_uuid(),
  template_id         text not null,
  template_version    integer not null default 1,
  sent_at             timestamptz default now(),
  sent_by             uuid references users(id),
  contact_id          uuid,
  entity_id           uuid,
  entity_type         text,
  packet_snapshot_id  uuid references context_packets(id),
  subject_line_used   text,
  edit_distance_pct   float,      -- 0 = sent as-is, 1 = completely rewritten
  opened              boolean,
  opened_at           timestamptz,
  replied             boolean,
  replied_at          timestamptz,
  deal_advanced       boolean,
  deal_advanced_at    timestamptz,
  outcome_note        text
);
```

**Metrics tracked per template version:**
- Open rate
- Reply rate
- Average edit distance (how much brokers modify drafts before sending)
- Deal advancement rate (did this outreach move a pursuit or deal forward)
- Time-to-response (for follow-up sequences)

**Improvement triggers:**
- Open rate below category benchmark for 30+ sends → flag for subject line review
- Edit distance >60% consistently → template language not matching broker voice, needs revision
- Reply rate declining over 90-day window → market conditions may have shifted, refresh content

---

## 5. Template Versioning Rules

1. Templates are never deleted — they are deprecated and superseded by a new version.
2. Version increments on any change to body copy, subject line, or mandatory variable set.
3. Minor edits (grammar, formatting) = patch version (v1.1). Material content change = major version (v2).
4. Performance data is attributed at the version level, not the template level, so A/B comparison is valid.
5. When a new version is created, the prior version remains available for 90 days to allow performance comparison.

---

## 6. Governing Rules

- A template cannot be surfaced for drafting unless all mandatory variables are present in the bound packet. Missing variables block draft generation — system prompts user to complete the relevant entity record first.
- Templates are starting points, not final drafts. Every system-generated draft must display a visible "AI Draft" indicator in LCC and in the Outlook draft window.
- No template is auto-sent without explicit user action. All sends require a human click.
- Template library is reviewed quarterly. Templates with consistently poor performance (open rate below 20% after 50+ sends) are flagged for revision.
