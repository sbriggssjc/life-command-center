# Living Deal Dossier + Systems-Connection Architecture — 2026-08-01

The deal dossier is the LCC's **living brain for a single transaction**: it tells the story of the deal from
prospecting -> BOV -> OM/marketing -> offers -> LOI -> PSA -> close, updates in real time as emails, calls,
milestones and documents land, and lets any broker or future chat "double-click" into the full context behind
any summary line. **Property/lease/trade-area intelligence stays on the property dossier**; the deal dossier
carries transaction intelligence and only pulls a property/lease slice when it bears on an open issue.

Worked record: **Fresenius Kidney Care Woodland Hills** (property 35724, entity `d118b3a1`) — Northmarq
sell-side, closed 2026-07-24 at $15,729,896 / **6.00%**. Gold-standard render:
`deal-dossier-fresenius-woodland-hills-v2.html`.

## 1. Information model (transaction-centric)
- **Hero + commission** — stage, sale/asking price, cap, and the **Team Briggs fee** up top. Commission is
  **stage-aware**: BOV -> proposed direct + co-broker; ELA negotiation -> negotiated points; ELA executed ->
  direct/co-broker structure; LOI agreed -> the fee the transaction will pay; closed -> ELA rate x closed price.
- **Transaction story & milestones** — reverse-chronological audit trail + "what's next." Passed milestones
  **compress to one-liners**; the full correspondence/offers/docs that produced each remain available on
  double-click. Real-time updated.
- **Parties by company** — roles that **evolve with the dialogue**: seller principal vs. business
  decision-maker vs. transaction manager (often appears near LOI), buyer, both attorneys, title/escrow, lender.
  Delineated by correspondence so we know who to call/email/copy on a given topic.
- **Diligence & third-party vendors** — surveyor, property-condition, Phase I, appraiser: vendor, ordered
  date, site visit, report ETA, lender requirement — tracked against diligence/lender deadlines.
- **Correspondence summary** — living; older threads compress to summaries that stay in the record; newer
  detail is full. Double-click to the underlying email/call.
- **Connected sources** — an explicit panel: which of CoStar / Salesforce / Outlook / Sharefile / deal spine
  is feeding this record, and where the gaps are.
- **Open issues / what's coming** — surfaced topics, negotiation points, pending items.

## 2. Systems-connection architecture (the objective)
Everything reconciles onto the **asset entity** (`entity_id`, bridged from the property via
`external_identities (dia|gov, asset, property_id)`), so the deal spine assembles from every source at once:

| Source | Carries | Into |
|---|---|---|
| **Salesforce Opportunity** (006...) | stage, parties (seller/buyer/brokers), roster, ELA/commission, LOI/PSA fields | `activity_events` + party graph + commission block; stamp `sales_transactions.sf_deal_id` |
| **Outlook** | the email/call narrative, who-talks-to-whom, attorneys/title/vendor mentions, milestone signals | `activity_events` (dated, directional) -> the correspondence summary + party-role inference |
| **Sharefile / deal room** | OM, BOV, ELA, LOI, PSA, distribution roster, diligence reports | documents (with reconciled status) + party extraction (roster) + diligence tracker |
| **CoStar / comp** | price, cap, on-market history, third-party broker view | listing/sale facts (reconciled, not authoritative for parties) |
| **Deed / RCA** | grantor->grantee, loan, parcel | seller/buyer confirmation + loan section (property dossier) |

Reconciliation rules: our own systems (SF/Outlook/Sharefile) are **authoritative for parties, commission, and
narrative**; CoStar is a fallback view and must not overwrite a sourced party; conflicts surface, never silently
resolve; nothing is fabricated (absent -> "Not on file").

## 3. Audit — connection gaps this deal exposed (property 35724)
1. **Cap rate wrong (6.46% vs the correct 6.00%).** Our OM asking was **$15,729,896 @ 6.00%** (listing 14879,
   `initial_cap_rate`/`current_cap_rate` 0.0600) and it **sold at asking**. In-place NOI $943,794 / $15,729,896
   = 6.000%. The system stored `calculated_cap_rate` 0.0646 / `cap_rate_final` 0.06461 and `rent_at_sale`
   **$1,016,362.91** — the "2.5% annually" escalation applied **ahead of the actual schedule** (~3 bumps). The
   escalated-rent reconciliation went the wrong direction. **Fix: in-place rent $943,794, cap 6.00%, everywhere;
   correct the lease rent-schedule anchor against the OM + lease amendments.**
2. **Parties empty — root cause.** The only contact is **Chris Bodnar / CBRE** (`role listing_broker`,
   `data_source costar_sidebar`, `sf_contact_id` null, `crm_opportunity_count` 0). Every fact is from **CoStar +
   an SF comp**; there is **no Salesforce Opportunity** for the close and **Outlook/Sharefile are not linked**.
   So seller, buyer, attorneys, title, lender, ELA/commission, and the negotiation narrative have **no source**.
   Also: the CoStar broker (CBRE) needs reconciling against **Team Briggs being the sell-side broker** — our own
   role isn't sourced from our own systems.
3. **No living narrative.** 4 `activity_events` exist but the Outlook thread / deal-room docs aren't connected,
   so the transaction story can't assemble.

## 4. Claude Code prompts (send on your schedule; save the response next to each)

### Prompt A — cap-rate reconciliation (do first; live data is currently wrong)
```
Property 35724 (dialysis DB) closed at our OM asking: listing 14879 shows initial_price $15,729,896 with
initial_cap_rate/current_cap_rate 0.0600, status sold. In-place lease rent (live lease 25390) is $943,794, and
$943,794 / $15,729,896 = exactly 6.00%. But sales_transactions sale_id 14832 stores calculated_cap_rate 0.0646
/ cap_rate_final 0.06461 and rent_at_sale $1,016,362.91 (= $943,794 x 1.025^3), i.e. the "2.5% Annually"
escalation was applied ahead of the actual schedule. Reconcile to the truth everywhere: set rent_at_sale =
$943,794 and the cap to 6.00% on sales_transactions 14832 (and the listing 14879 cap_rate field 0.0646), then
FIX the root cause — review the lease amendments + our OM to correct the rent-schedule anchor/dates on lease
25390 so the escalation engine stops projecting current rent ahead of the actual in-place rent. Add a guard/test
that a closed deal's cap reconciles to our OM asking cap when we were the listing broker. Verify the deal dossier
and every surface now shows 6.00%.
```

### Prompt B — connect the deal spine (SF Opportunity + Outlook + Sharefile -> the entity)
```
The deal dossier for property 35724 / entity d118b3a1 can't tell the transaction story because its own sources
aren't connected: the only contact is Chris Bodnar/CBRE from costar_sidebar (sf_contact_id null,
crm_opportunity_count 0); there is no Salesforce Opportunity linked; Outlook and Sharefile are not linked to the
entity. Build the deal-spine connection so parties/correspondence/commission/documents reconcile onto the asset
entity:
1. Salesforce: resolve or create the deal's Opportunity, link it (stamp sales_transactions.sf_deal_id), and pull
   parties (seller/buyer/brokers) + roster + ELA/commission + LOI/PSA fields into the party graph + activity_events.
   Where we were the listing broker (is_northmarq sell-side), capture the Team Briggs broker as a party — do not
   let CoStar's CBRE attribution stand as our role unverified; surface a Conflict if they disagree.
2. Outlook: link the email/call thread for this deal to entity d118b3a1 -> dated, directional activity_events;
   infer evolving contact roles (decision-maker vs transaction manager) and attorney/title/vendor mentions.
3. Sharefile/deal room: link the OM/BOV/ELA/LOI/PSA/distribution-roster/diligence docs to the entity with a
   reconciled status; extract the roster into parties and diligence reports into a vendor tracker (vendor,
   ordered date, site visit, report ETA, lender requirement).
4. Reconciliation discipline: our systems (SF/Outlook/Sharefile) are authoritative for parties/commission/
   narrative; CoStar is a fallback that must not overwrite a sourced party; conflicts surface; nothing fabricated.
Verify against 35724 that the deal dossier's Parties, Commission, Correspondence, and Diligence sections fill
from live sources instead of "Not on file."
```

### Prompt C — broker/role attribution reconciliation
```
For Northmarq deals (is_northmarq true), reconcile the broker-of-record so our own role is authoritative. Today
property 35724's only broker contact is Chris Bodnar/CBRE (source costar_sidebar) even though is_northmarq is
sell-side. Add logic so a Northmarq sell-side deal captures the Team Briggs listing broker from our SF/roster as
the listing broker, records CoStar's third-party broker separately (co-broker/counterparty or "as-reported"),
and surfaces a Conflict when the third-party feed disagrees with our own role. Verify 35724.
```

## 5. LCC app / layout improvements (running list)
- **Resolve assets by property-id identity, not address alone** — the "Woodland Hills" entity was missed by the
  address resolver (property panel / get_property_context); resolve via `(dia|gov, asset, property_id)`.
- **Deal vs property split in the UI** — a Deal tab (living transaction record) distinct from the Property tab,
  cross-linked; the "Dossier" button offers both.
- **"Double-click" affordance** — every summarized milestone/correspondence line links to its underlying
  source (email, offer, doc) so detail is one click away.
- **Connected-sources indicator** — a small per-deal panel showing SF/Outlook/Sharefile/CoStar link status, so
  gaps are visible at a glance.
- **Real-time freshness** — show "updated <when> from <source>" so a living record's currency is obvious.

## 6. Local-Ollama opportunity scan (unlock the model across the workflow)
The same Ollama seam (`invokeExtractionAI`) that authors the dossier Analysis block can drive, grounded and
cheaply, many recurring summarization/extraction jobs — always from reconciled data, never fabricating:
- **Correspondence summarization + decay** — summarize email/call threads into the living record; compress older
  topics as milestones pass.
- **Milestone & issue extraction from Outlook** — detect LOI/PSA/diligence/close signals + surfaced issues.
- **Party-role inference** — infer decision-maker vs transaction manager vs attorney/title/vendor from dialogue.
- **Diligence-date extraction** — pull vendor site-visit/report ETAs from emails into the tracker.
- **BOV / OM / seller-update drafting** — grounded first drafts from the packet.
- **Commission narration** — explain the stage-aware fee calc in plain language.
- **Deal-risk / next-best-action** — summarize what's stuck and what to do next for the daily briefing.
Each is a candidate follow-up; prioritize correspondence summarization + milestone extraction (they power the
living record) once the sources are connected (Prompt B).

---
See `DOSSIER-PROGRAM-STATE-OF-PLAY.md` for the consolidated status and where this fits.
