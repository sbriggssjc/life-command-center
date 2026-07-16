# Claude Code (LCC) — sf-list-import drops Lead-linked CampaignMembers + seller-classification gaps

## Unit 1 (CRITICAL) — the route drops Lead members; ingest Leads too

**Symptom (grounded live 2026-07-16).** The scoped "Get Campaign Members" flow ran
successfully and POSTed full campaigns to `/api/sf-list-import`, but the LCC ingested only a
tiny fraction of each list: **GSA Buyer 8 of 156**, KDL Seller Prospects 8 of ~100, SAB
Dialysis Prospects 16 of ~100. Identity-prefix check on everything imported:
**446 Contact (`003…`) identities, ZERO Lead (`00Q…`) identities.**

**Root cause.** A Salesforce `CampaignMember` links **either a Contact (`ContactId`) OR a Lead
(`LeadId`)**. Prospect/buyer/seller lists are overwhelmingly **Leads** (prospects not yet
converted to Contacts). The route keys the person's `external_identities` on `ContactId` and
**skips members that have only a `LeadId`** — so ~90–95% of every list is dropped. The whole
value of these lists (the prospect contacts) is in the Leads.

**Fix — process a member regardless of Contact vs Lead:**
1. **Read the CampaignMember's OWN denormalized fields** for name/company/geo/email:
   `FirstName, LastName, Email, Phone, City, State, CompanyOrAccount`. These are populated for
   BOTH Lead- and Contact-linked members, so ingestion must NOT depend on `ContactId` being
   present.
2. **Key the salesforce identity** on whichever id exists: `ContactId` →
   `external_identities(source_system='salesforce', source_type='Contact', external_id=ContactId)`;
   else `LeadId` → `(source_system='salesforce', source_type='Lead', external_id=LeadId)`.
   (If the CHECK constraint on `external_identities.source_type` rejects `'Lead'`, either add
   `'Lead'` to the allow-list or fall back to `source_type='Contact'` keyed on the LeadId — the
   goal is: never drop a member that has an email + name.)
3. **Reconcile by email (R39 tier) exactly as today** — a Lead whose email matches an existing
   CoStar/RCA/SF person ATTACHES (no duplicate); everything downstream (person→org edge, list
   membership row, buyer/seller classification, value-gated cadence) is unchanged.
4. **Guardrails unchanged:** the Unit-C name/edge guards, junk rejection, and (from the SF
   conflation work) name-from-contact-not-account all still apply.
5. **Idempotent:** re-running the flow re-POSTs all members; the route now creates/attaches the
   Lead-linked ones on top of the 446 Contacts already ingested (upsert by id/email → no dups).

## Unit 2 (minor) — seller-classification misses broker-prefixed "Prospects" + "Owners"

Grounded from the same run: `SAB Seller Prospects`→`side=seller,broker=SAB` and `KDL Seller
Prospects`→`seller,KDL` classify correctly, but **336 of 445 rows tagged `side=unknown`**
because the classifier only flips to seller on the exact `"* Seller Prospects"` token. These
should be **seller**:
- **Broker-prefixed `"* Prospects"`** — `SAB GSA Prospects`, `SAB Dialysis Prospects`, `SAB
  Medical Developer`, `NKB Prospects`, etc. (broker prefixes: **SAB, KDL, NKB, JTS, DMR**).
- **Any `"* Owners"` list** — `VCA Animal Hospital Owners`, `Christian Brothers Owners`, `DMR
  Urgent Care Owners` (owner lists = sell-side targets).

Extend the classifier: `side='seller'` when the name matches `"* Seller Prospects"` OR a
broker-prefix (`^(SAB|KDL|NKB|JTS|DMR)\b`) + `"Prospects"` OR ends in `"Owners"`; set `broker`
from the leading `SAB|KDL|NKB|JTS|DMR` where present. `product_type` extraction is already
working (GSA/Dialysis/Medical Office/Industrial) — keep it. `"Buyer Lists"` + `"* Buyers"` +
`"GSA Buyer"` stay **buyer**.

## Verify (post-deploy, Cowork)
After Scott re-runs the flow: **GSA Buyer = 156** (not 8); KDL/SAB/NKB lists match their Vision
GM "Showing 1 to N of N" totals; `external_identities` now shows Lead (`00Q`) rows; the broker
"* Prospects" / "* Owners" lists tag `side=seller` (unknown share collapses); zero duplicate
persons (email reconcile holds); and seller companies matching `v_institution_registry_gaps`
surface as registry candidates.

## Boundaries
LCC-Opps only; SF read-only; additive/reversible; ≤12 api/*.js (the route + classifier exist —
this is a logic fix, no new file); email-tier dedup so no duplicate persons; never fabricate.
