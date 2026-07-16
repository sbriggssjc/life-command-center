# Claude Code (LCC) — ingest Salesforce "Lists" (Campaigns/CampaignMembers) as buyer/seller prospect contacts

## What these are (grounded live 2026-07-16, via the IS_Vision_GM app)

Scott's Salesforce "Lists" (formerly "Groups") are **standard Salesforce Campaigns** in a
hierarchy, and the "List Members" are **CampaignMembers**. Confirmed live in the Vision GM app
(`/lightning/n/IS_Vision_GM`): a tree `Team Briggs → Buyer Lists → GSA Buyer` (+ seller lists
named per broker, e.g. `JTS Seller Prospects`, `KDL Seller Prospects`). The member table
exposes, per contact: **First, Last, Company, Email, Phone, City, State, CM Relationship
(Open/Assigned), Team, Org Type, Last Activity**. GSA Buyer alone = **156 members** — real
repeat gov buyers (Nuveen, Ares, FD Stonewater, Easterly/"Government Investment Partners",
Nationwide Postal, Elmtree, Postal Realty Trust, HC Government Realty Trust, Xenia, Grayacre…).
Scott uses these for quarterly Capital Markets sends, email touchpoints, and call lists. **He
cannot export them from the UI** — but the data is fully in the DOM (proven: a shadow-DOM
scrape extracted all 156) AND in the Salesforce API (CampaignMember).

These lists are the single highest-value contact source for BD: buyer lists resolve the
repeat-buyer contacts (P-BUYER buy-side), seller-prospect lists (by broker + product type) are
the owners we've prospected → they seed the institution registry + owner contact resolution.

## The durable pull — a PA "Get Campaign Members" flow → an LCC ingest route
**Reuse the proven pattern** (the SF-activity / by-id flows): a Power Automate flow queries
Salesforce and POSTs JSON to a new LCC sub-route. Scott builds the flow; you build the route.

- **PA flow (spec for Scott):** two "Get records" (Salesforce connector, DIRECT fields only —
  the connector can't traverse relationship fields, but CampaignMember exposes these directly):
  1. **Campaigns:** `Campaign` → `Id, Name, ParentId, IsActive`. (Gives the list catalog +
     hierarchy — parent "Buyer Lists" vs "* Seller Prospects" is how we tag buyer vs seller.)
  2. **CampaignMembers:** `CampaignMember` → `CampaignId, ContactId, LeadId, FirstName,
     LastName, Email, Phone, City, State, CompanyOrAccount, Type, Status`. Filter by
     `CampaignId` (loop the campaigns) or pull all. POST batches to
     `POST /api/sf-list-import` with `{campaign_id, campaign_name, parent_name, members:[…]}`.
  Feature-flag the URL (`SF_LIST_IMPORT_URL`) like the other flows. **If the connector can't
  read CampaignMember** (managed-package restriction — verify first), fall back to the
  **proven DOM extraction** as a one-time bulk (a shadow-DOM `querySelectorAll` over the
  member `<table>`), but CampaignMember is standard and should be queryable.

- **LCC route `?_route=sf-list-import`** (sub-route of operations.js — no new api/*.js, ≤12).
  GET = dry-run (parse + classify, no writes) / POST = ingest, bounded. Per member:
  1. **Reconcile the person** via `ensureEntityLink` (email tier — R39) so an existing
     CoStar/RCA/SF contact is ATTACHED, never duplicated; name from the CONTACT fields (the
     Unit-C guard); guards reject junk. New `external_identities` source `salesforce`/`Contact`
     (or a distinct `sf_list`/`Contact`) keyed on `ContactId`.
  2. **Relate to the company** as a person→org edge (`associated_with`/`works_at`) — resolve/
     create the `CompanyOrAccount` org (the Unit-C modeling: edge, not identity-on-person).
  3. **Record list membership** (a small `lcc_sf_list_membership` table or entity metadata):
     `campaign_name`, `product_type` (from the list name — "GSA", "Dialysis", "Drug Store",
     "Industrial"…), `side` (**buyer** if under "Buyer Lists"/"* Buyers"/"* Principals";
     **seller** if "* Seller Prospects"), `broker` (from a "* Seller Prospects" prefix / the
     Team column), `status`, `last_activity`. This is the reusable segmentation for call lists
     + CM sends.
  4. **Route to the consumer (Consumption-Layer doctrine):**
     - **buyer** member → the **P-BUYER buy-side contact pool** (these are the repeat-buyer
       decision-makers — Boyd/Capra-class). Where the company matches a registered buyer parent
       (`lcc_buyer_parents`), attach as a buy-side contact.
     - **seller** member → **owner-prospect** contact for that product type; and where the
       company matches an **institution sponsor** with contactless valued SPEs
       (`v_institution_registry_gaps`), **offer/seed `lcc_institution_contacts`** with this
       real contact → the Tier A fan-out then attaches it across the sponsor's SPE portfolio.
       (This is the non-fabricated registry seed we've been waiting for.)
  5. Value-gate cadence seeding as today (`maybeSeedValuableCadence`).
  - Additive, reversible, provenance-tagged (`source='sf_list_import'`), never fabricates.
    **No SF writes** — read-only ingest. dia/gov untouched.

## Boundaries / verify
LCC-Opps only; SF read-only; ≤12 api/*.js (sub-route); additive/reversible; email-tier dedup so
no duplicate persons; the Unit-C name/edge guards apply. **Verify:** a dry-run over GSA Buyer
classifies 156 buyer members with product_type=GSA, resolves the ~existing ones by email (no
dups), relates each to its company org; a POST attaches them + tags membership; seller-list
members whose company is an institution-gap sponsor seed the registry (then Tier A fans out).

## Bottom line
Scott's prospecting/buyer/seller Lists are standard Campaigns/CampaignMembers — the richest
contact source we have (name+email+phone+company+geo, segmented by product type + buyer/seller +
broker). Build one LCC ingest route + a PA CampaignMember flow, reconcile by email (no dups),
tag the segmentation, and route buyers → P-BUYER buy-side, sellers → owner-prospect + the
institution registry. This turns Salesforce's own curated lists into the LCC's outreach engine —
and finally seeds the institution registry with real, non-fabricated sponsor contacts.

## ⚠️ PAGINATION IS MANDATORY (added 2026-07-16)
Several lists exceed 100/500/2,000 members (the 100-cap I hit was only the Vision GM UI table;
the API has no such cap). The PA "Get records" (Salesforce) step caps at **2,000 rows/call
unless pagination is enabled** — turn ON the connector's Pagination setting (threshold ≥ the
largest list) OR loop each campaign with a Do-Until on the CampaignMember count, so EVERY member
of EVERY list is retrieved (never truncate at the first page). The `/api/sf-list-import` route
must be **idempotent** (upsert by ContactId/email) so re-pulls and overlapping batches never
duplicate. Verify by comparing the ingested member count for a large list against its Vision GM
"Showing 1 to N of N entries" total.
