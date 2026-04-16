# Touchpoint Cadence Specification
## Life Command Center — Scott Briggs / Team Briggs, Northmarq

**Document Version:** 1.0  
**Last Updated:** April 2026  
**Domain:** Government-Leased and Dialysis/Medical Net Lease  
**Author:** Scott Briggs, Northmarq

---

## Overview

This document defines the systematic touchpoint sequence for relationship development with commercial real estate property owners in government-leased and dialysis/medical net lease sectors. The cadence is designed to establish credibility, deliver consistent value, and move qualified prospects through a structured engagement arc over the first 6 months, followed by ongoing quarterly maintenance.

**Core Philosophy:**
- Deliver "just enough information to relay our expertise and provide some value but not enough that they could do anything without contacting us"
- Alternate personal touchpoints with marketing collateral
- Reference specific properties, recent comps, and market intelligence
- Always anchor outreach to their specific asset ownership
- Protect time by spacing touchpoints to avoid fatigue

---

## Phase 1: Initial Prospecting (Weeks 1–24, Months 1–6)

### 7-Touch First-6-Months Sequence

#### Touch 1: First Touch Email (Week 1)
- **Template:** T-001 v3 (First Touch)
- **Channel:** Email
- **Timing:** Within 7 days of qualifying the prospect
- **Content Anchors:**
  - Greeting: "Good morning, [contact]"
  - Hook: Reference their specific property by tenant and location
  - Value delivery: Capital markets report (PDF attachment)
  - Credentials: Team track record summary (dynamic: transaction count, cumulative value)
  - Offer: Complimentary and confidential BOV
  - Comp highlights: Up to 3 recent comparable sales (if available)
- **Success Metric:** Open rate 35%+, click rate 12%+
- **Context Variables:** `contact.full_name`, `property.tenant`, `property.city_state`, `property.domain_label`, `team.credentials_summary`, `comp_highlights`, `team.signature`

**Script Note:** This is the heavy lift — establishes expertise, builds trust, and seeds the idea of engagement. The report should be visually professional and data-dense enough to demonstrate specialization.

---

#### Touch 2: Phone/Voicemail Follow-Up (Week 2–3)
- **Channel:** Phone call or voicemail
- **Timing:** 7–10 days after Touch 1
- **Objectives:**
  - Confirm email receipt
  - Reference the attached report
  - Request a 15-minute call to discuss their portfolio
  - Gauge interest level
- **Voicemail Script Outline:**
  ```
  "Hi [first name], this is Scott Briggs from Northmarq. I sent you an email 
  last week with our latest capital markets update for [domain] properties — 
  wanted to make sure you received it. I'm specifically interested in your 
  [tenant]-leased asset in [city, state] and would love to share some recent 
  comps and market insights. Could we grab 15 minutes on the phone this week? 
  Let me know what works best — I'm flexible."
  ```
- **Success Metric:** Voicemail answered / call completed, or callback initiated
- **Logging:** Record outcome (answered, voicemail left, declined, committed to call)

**Phone Cadence Rules:**
- Call between 9am–11am or 2pm–4pm local time
- Leave a message only once per window; don't call multiple times same day
- Keep message under 30 seconds
- Provide your direct phone number; encourage a callback
- Note the outcome in the contact record for historical reference

---

#### Touch 3: Capital Markets Update Email (Week 4–5)
- **Template:** T-003 v3 (Capital Markets Update - Quarterly)
- **Channel:** Email
- **Timing:** 14–17 days after Touch 2
- **Content Anchors:**
  - Greeting: "Good morning, [contact]"
  - Context: "Given your ownership of the [tenant]-leased property in [city_state]..."
  - Report delivery: Quarterly capital markets report (PDF)
  - Credentials: Firm track record with specific metrics
  - Comp highlights: 2–4 recent comparable transactions
  - BOV offer: Reiterate complimentary valuation offer
- **Success Metric:** Open rate 40%+, response rate 8%+
- **Context Variables:** Same as Touch 1, plus `quarter_year`

**Strategic Note:** This touch reinforces expertise and provides fresh data. Position as ongoing value delivery rather than another pitch. If the property shows upcoming lease expiration or lease award news, flag it here.

---

#### Touch 4: Phone/Voicemail Follow-Up (Week 6)
- **Channel:** Phone call or voicemail
- **Timing:** 7–10 days after Touch 3
- **Objectives:**
  - Reference the quarterly report
  - Ask if they've had a chance to review
  - Explore any specific assets they'd like to discuss
  - Soft close: "Would a 20-minute call work sometime this month?"
- **Voicemail Script Outline:**
  ```
  "Hi [first name], Scott again from Northmarq. I wanted to follow up on 
  the quarterly capital markets report I sent last week — it includes some 
  interesting comp data for [domain] properties like yours. When you get 
  a chance, would love to share those details. Do you have 20 minutes on 
  the calendar this month? I'm happy to work around your schedule."
  ```
- **Success Metric:** Call completed, callback requested, or meeting scheduled
- **Logging:** Record outcome and any verbalized interest

**Phone Cadence Rules:** Same as Touch 2.

---

#### Touch 5: Listing Announcement or Comp Share Email (Week 8–9)
- **Channel:** Email
- **Timing:** 10–14 days after Touch 4
- **Template Options:**
  - **T-004** (Listing Announcement) if you have an active listing in their domain/geography
  - **T-011** (Comp Share) if you've recently closed a comparable asset
- **Content Anchors (Listing Variant):**
  - Subject: "New Exclusive: [Tenant] | [City, State] | [Cap Rate]%"
  - Hook: Tie listing characteristics to their portfolio
  - Listing metrics: Price, cap rate, lease term, tenant creditworthiness
  - Soft transition: "Given your ownership of similar assets, thought this would be relevant"
- **Content Anchors (Comp Variant):**
  - Subject: "Recent Close: [Tenant] Sale in [City, State]"
  - Summary: Sale price, cap rate, lease structure, buyer type
  - Relevance: Why this comp matters for their portfolio
  - BOV offer: "Would love to discuss how this impacts your portfolio"
- **Success Metric:** Open rate 45%+, click rate 10%+
- **Context Variables:** `listing.tenant`, `listing.city_state`, `listing.list_price`, `listing.cap_rate`, `comp_highlights`

**Strategic Note:** This touch accomplishes dual goals:
1. Demonstrates active market presence and deal flow
2. Shifts narrative from "I want to work with you" to "Here's what's happening in your space"

If no listing or recent close available, substitute with a market intelligence email referencing industry news relevant to their tenant type.

---

#### Touch 6: Phone/Voicemail Follow-Up (Week 10–11)
- **Channel:** Phone call or voicemail
- **Timing:** 7–10 days after Touch 5
- **Objectives:**
  - Reference the listing or recent comp
  - "Thought of you when I saw this" positioning
  - Gauge interest in a call
  - Begin to establish next steps if interested
- **Voicemail Script Outline:**
  ```
  "Hi [first name], Scott from Northmarq. Just wanted to follow up on that 
  [listing/recent close] I sent you last week — it's a great comp for your 
  [city, state] portfolio. The cap rates in this market are shifting, and 
  I think a conversation about your portfolio positioning might be timely. 
  Can we grab 20 minutes? Let me know your availability."
  ```
- **Success Metric:** Conversation initiated, meeting scheduled, or warm objection
- **Logging:** Record sentiment (interested, non-committal, not interested)

**Phone Cadence Rules:** Same as Touch 2 and 4.

---

#### Touch 7: Direct Ask Email (Week 12–13)
- **Template:** T-002 v3 (Cadence Follow-Up — Touch 7 variant)
- **Channel:** Email
- **Timing:** 7–10 days after Touch 6
- **Content Anchors:**
  - Subject: "Quick Check-In: [Property/Market Reference]"
  - Recap: "Over the past three months, I've shared..."
  - Explicit ask: "I'd like to schedule 30 minutes to walk you through..."
  - Confidence: "...I'm confident there's mutual value in a conversation"
  - CTA: "Let me know what dates and times work for you and we will make that time a priority"
  - Signature: Full contact info with direct phone + email
- **Tone:** Professional, warm, but more direct than prior touches
- **Success Metric:** Meeting scheduled (primary), response rate 15%+
- **Context Variables:** `contact.full_name`, `property.tenant`, `property.city_state`, `property.domain`, reference points from Touches 1–6

**Strategic Note:** This is the "ask for the dance." You've delivered value 6 times; now request explicit engagement. If no response by Touch 7, contact moves to maintenance cadence (see Phase 2).

**Email Body Pattern:**
```
Hi [first name],

Over the past few months, I've shared our quarterly capital markets reports, 
recent comparable transactions, and market insights specific to your 
[domain]-leased portfolio.

I'm confident there's genuine value in a conversation about your assets in 
[property.city_state] and how we might assist with a disposition, refinance, 
or portfolio review.

Would you have 30 minutes in the next two weeks? I can work around your schedule.

Let me know what dates and times work for you and we will make that time a priority.

Best regards,
Scott Briggs
```

---

## Phase 2: Quarterly Maintenance Cadence

### 1-Touch Per Quarter (Ongoing)

After Touch 7, if no active engagement, move contact to quarterly cadence:

**Quarterly Touch (Q1, Q2, Q3, Q4):**
- **Template:** T-003 v3 (Capital Markets Update — Quarterly)
- **Channel:** Email
- **Frequency:** Once per calendar quarter (Q1: Jan–Mar, Q2: Apr–Jun, etc.)
- **Timing:** Send within the first 2 weeks of the quarter
- **Content:** Attach latest quarterly report, reference their specific asset, offer BOV
- **Success Metric:** Open rate 25%+
- **Logging:** Track opens; if 3 consecutive quarters with no opens, mark contact as "dormant but owned"

**Seasonal Variation:**
- **Q4 (Nov–Dec):** May shift to year-end portfolio review messaging instead of standard quarterly report
- **Q1 (Jan–Mar):** Include new-year disposition/refinance planning angles
- **Post-Lease-Award:** If contact receives a new lease award, send T-013 (congratulations email) immediately, then reset to quarterly cadence

---

## Touchpoint Priority Tiers

Contacts are classified into three priority tiers; cadence accelerates or decelerates based on tier:

### Tier A: High-Priority / Hot Prospects
- **Criteria:** Recent lease award, upcoming expiration (within 12 months), expressed interest, or high portfolio value
- **Cadence:** Accelerated — add 1–2 phone calls per month (instead of one every 2–3 weeks)
- **Template Adaptations:** Reference lease expiration or recent award explicitly
- **Example:** Property with GSA lease expiring Q3 2026 → send T-013 (award congratulations) immediately if new lease just awarded, then increase to biweekly touchpoints
- **Success Target:** Move to meeting within 8 weeks

### Tier B: Standard Prospects
- **Criteria:** Qualified owner, no immediate trigger, but good portfolio fit
- **Cadence:** Standard 7-touch sequence + quarterly
- **Escalation Trigger:** If Tier A event occurs (lease award, expiration approaching), move to Tier A cadence
- **Success Target:** Meeting within 6 months

### Tier C: Lower-Priority / Research Phase
- **Criteria:** Early-stage research, need to validate ownership, or low immediate relevance
- **Cadence:** Quarterly only (skip Touches 2–6, start at T-003)
- **Escalation Trigger:** Once ownership and relevance validated, promote to Tier B
- **Success Target:** Engagement within 12 months

---

## Marketing Flyer Touchpoints

Marketing flyers (listing announcements, closing announcements, market reports) count as touchpoints. The cadence accounts for them:

### Listing Announcement Flyer
- **Channel:** Email or physical mail
- **Frequency:** As inventory allows (typically 1–3 per month per contact)
- **Positioning:** Separate from personal email sequence; counts as its own touchpoint
- **Cooling Rule:** Do not send a personal email within 3 days of a marketing flyer; stagger personal touchpoints around flyers

**Example Timeline:**
```
Week 1 (Mon): Touch 1 email (personal)
Week 2 (Wed): Marketing flyer (listing announcement)
Week 3 (Fri): Touch 2 phone call (no email same week as flyer)
Week 4 (Tue): Touch 3 email (personal)
```

### Closing Announcement Flyer
- **Channel:** Email (post-close) or mail (if physical distribution list exists)
- **Frequency:** 4–12 per year depending on transaction volume
- **Positioning:** Social proof + market activity signal
- **Cooling Rule:** Same as listing flyer — 3-day buffer before next personal email

### Capital Markets Report (Mass Distribution)
- **Frequency:** Quarterly
- **Positioning:** Delivered as Touch 3 in sequence, then as quarterly maintenance
- **List:** All active contacts in domain
- **Customization:** Subject line may personalize by domain; body customizes by ownership if possible

---

## Phone/Voicemail Touchpoints

### Script Guidance

**General Principles:**
- Keep to under 30 seconds
- Reference the prior email by date and topic
- Use their first name; be warm but professional
- Provide a specific call-to-action (e.g., "Can we grab 15 minutes?")
- Leave your direct number; encourage callback
- Do not use high-pressure language; focus on value delivery

**Touch 2 Script (Post-First-Touch):**
```
Hi [first name], this is Scott Briggs from Northmarq. I sent you an email 
last week with our latest capital markets update for [government/dialysis] 
properties and wanted to make sure you received it. Specifically interested 
in your [tenant]-leased asset in [city, state]. 

Would you have 15 minutes this week to discuss some recent market comps? 
You can reach me at [phone] or reply to that email. Thanks!
```

**Touch 4 Script (Post-Quarterly Update):**
```
Hi [first name], Scott Briggs again from Northmarq. Following up on that 
quarterly report I sent about a week and a half ago. Includes some really 
relevant comp data for [domain] properties like yours.

If you've had a chance to look at it, I'd love to walk through a few of 
the highlights. Do you have 20 minutes on your calendar this month? Call 
me back at [phone] or let me know via email. Thanks!
```

**Touch 6 Script (Post-Listing/Comp Share):**
```
Hi [first name], Scott from Northmarq. Just wanted to follow up on that 
[recent close/listing] I sent you last week — it's a solid comp for your 
portfolio in [city, state]. 

Cap rates have shifted in that market, and I think a conversation about 
your positioning might be timely. Can we grab 20 minutes? I'm flexible 
with scheduling. Reach me at [phone]. Thanks!
```

### Logging & Outcomes

Record every phone touchpoint in the contact record with:
- **Outcome:** (Answered, Voicemail, Declined, Callback Scheduled)
- **Sentiment:** (Interested, Non-committal, Not Interested, Engaged)
- **Notes:** Verbatim key phrases from the conversation if answered
- **Next Action:** (Follow-up email, Call back, Meeting scheduled, etc.)

---

## Escalation Triggers

Accelerate cadence (move Tier B → Tier A, or add supplementary touchpoints) when:

### Lease Expiration Approaching (12 Months or Less)
- **Action:** Immediately send T-002 (Cadence Follow-Up) with explicit messaging about upcoming expiration
- **Cadence Shift:** Move to biweekly phone calls + monthly email
- **Template Customization:** Reference lease expiration date explicitly
- **Example Subject:** "[Tenant] Lease Expiring [Month Year] — Let's Plan Ahead"

### New Lease Award Announced
- **Action:** Immediately send T-013 (GSA Lease Award Congratulations) or custom congratulations email
- **Cadence Shift:** Move to monthly touchpoints for 6 months post-award
- **Follow-up Sequence:** Allow 2 weeks between congratulations and next personal email; send market report
- **Sentiment Capture:** Lease awards indicate financial stability and asset quality; prioritize for future deals

### Market Shift (Major Cap Rate Movement, Sector News)
- **Action:** Trigger T-002 with market commentary specific to their asset type/geography
- **Cadence Shift:** Add one supplementary email within 48 hours
- **Template Customization:** "Recent [asset type] sales have reset cap rate expectations" + comp highlights
- **Example Trigger:** If government-leased properties in their region see >50bps rate shift, send unsolicited market update

### Recent Competitive Loss (Heard They Listed with Broker X)
- **Action:** Send warm reconnect email within 48 hours of intelligence
- **Cadence Shift:** Restart 7-touch sequence with Tier B contact, or accelerate Tier A
- **Tone:** Professional, "Heard you're in the market — wanted to check in"
- **Goal:** Position for next transaction or future partnership

### Referral / Warm Introduction
- **Action:** Adjust Touch 1 to reference the introduction source
- **Cadence Shift:** May compress first 3 touches into 2 weeks if mutual connection exists
- **Template Customization:** "When I spoke with [referrer], they thought you and I should connect"

---

## Cool-Down Rules

Prevent touchpoint fatigue:

### After Marketing Flyer
- **Buffer:** No personal email within 3 days of marketing flyer
- **Rationale:** Recipient has fresh information; personal touch becomes more impactful after brief pause
- **Exception:** If flyer is 4+ weeks old, resume standard cadence

### After Meeting / Pitch
- **Buffer:** No follow-up email for 48 hours; then send value-delivery email (comps, reports)
- **Rationale:** Allow time for internal discussion before reconnecting
- **Exception:** If specific action item discussed in meeting (e.g., "Send me a BOV estimate"), honor that request within 24 hours

### After Phone Decline ("Not interested at this time")
- **Buffer:** No phone calls for 30 days
- **Escalation:** Continue monthly email (quarterly cadence)
- **Retry Window:** After 6 months of email-only, attempt one phone call to gauge interest shift

### After 2+ Consecutive Unopened Emails
- **Action:** Skip next email; instead send phone call with fresh messaging
- **Rationale:** Email fatigue; switch to voice channel
- **Recovery:** Resume email cadence after phone contact is made

---

## Performance Metrics & Monitoring

### Contact-Level Metrics
- **Open Rate:** Percentage of emails opened (target: 35%+ Touch 1, 40%+ Touch 3)
- **Click Rate:** Percentage of emails with links clicked (target: 12%+)
- **Response Rate:** Percentage receiving a reply (target: 5%+ initial, 8%+ ongoing)
- **Meeting Conversion:** Percentage moving to a scheduled call (target: 8% within 12 weeks)
- **Disposition Conversion:** Percentage listing a property (target: 2–5% over 24 months)

### Cohort Metrics
- **Cadence Adherence:** Percentage of contacts receiving all 7 touches within 6-month window (target: 90%+)
- **Template Performance:** Which templates generate highest open/response rates (by domain and contact tier)
- **Channel Effectiveness:** Phone vs. email engagement rates (measure voicemail completion rates)
- **Seasonal Trends:** Q4 response rates vs. Q1–Q3 (expect lower Q4 engagement)

### Escalation Indicators
- If open rate < 20% on two consecutive quarterly emails, move to Tier C
- If phone call success rate (answered, not voicemail) < 15% over 3 months, reduce phone cadence by 50%
- If no response after 12 months, mark "dormant but owned" and move to annual check-in only

---

## Domain-Specific Customizations

### Government-Leased Domain

**Tenant Focus:**
- GSA (General Services Administration) — federal buildings, courthouses
- State/municipal agencies
- Military installations

**Escalation Trigger:** New GSA lease award → immediate T-013 (Congratulations)  
**Template Customization:** Emphasize lease security, long-term stability, credit quality in Touches 1, 3, 5  
**Comp Emphasis:** Highlight triple-net structure and government tenant creditworthiness  
**Reporting Cadence:** Quarterly government capital markets report (larger audience, broader distribution)

### Dialysis/Medical Net Lease Domain

**Tenant Focus:**
- DaVita (dialysis)
- Fresenius (dialysis)
- Other medical service providers (urgent care, ambulatory surgery)

**Escalation Trigger:** New dialysis/medical lease award → immediate congratulations email  
**Template Customization:** Emphasize medical sector growth, regulatory tailwinds, tenant quality in Touches 1, 3, 5  
**Comp Emphasis:** Highlight healthcare sector resilience and tenant NPI creditworthiness  
**Reporting Cadence:** Quarterly dialysis/medical capital markets report (separate from government)

---

## Template Mapping Summary

| Touch # | Type | Template | Domain | Timing |
|---------|------|----------|--------|--------|
| 1 | Email | T-001 v3 | Both | Week 1 |
| 2 | Phone/VM | (Custom Script) | Both | Week 2–3 |
| 3 | Email | T-003 v3 | Both | Week 4–5 |
| 4 | Phone/VM | (Custom Script) | Both | Week 6 |
| 5 | Email | T-004/T-011 | Both | Week 8–9 |
| 6 | Phone/VM | (Custom Script) | Both | Week 10–11 |
| 7 | Email | T-002 v3 | Both | Week 12–13 |
| Quarterly | Email | T-003 v3 | Both | Once/quarter |
| Award | Email | T-013 v2 | Govt | On trigger |

---

## Implementation Notes for Engineering

### Data Schema Requirements
- `contacts.priority_tier` (A, B, C)
- `contacts.last_touchpoint_date` (for cadence scheduling)
- `contacts.last_touchpoint_type` (email, phone)
- `contacts.unsubscribe_status` (active, paused, opt-out)
- `touchpoint_history` table: logs each email/phone touch with timestamp, template_id, outcome
- `escalation_signals` table: flags lease expirations, awards, market changes

### Automation
- Scheduler to batch-generate email sends at start of each week
- Phone reminder queue (weekly report of "calls due")
- Outcome logging workflow (phone results recorded → next action auto-calculated)
- Quarterly report attachment: pulled from latest domain report PDF in asset system
- Comp highlights: auto-generated from `recent_comps` view (domain-specific)

### Compliance
- All emails include unsubscribe link (compliance with CAN-SPAM)
- Phone calls comply with TCPA (only call during business hours, respect do-not-call requests)
- Archiving: all email sends and phone logs retained for 7 years (CRE transaction records)

---

## Change Log

| Version | Date | Author | Notes |
|---------|------|--------|-------|
| 1.0 | Apr 2026 | Scott Briggs | Initial specification based on Outlook OFT analysis and Northmarq voice |

