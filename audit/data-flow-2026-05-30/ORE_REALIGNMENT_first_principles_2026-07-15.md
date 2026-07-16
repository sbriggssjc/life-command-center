# Ownership Resolution Engine — first-principles realignment (2026-07-15)

Grounded live this session across LCC Opps (`xengecqvemvfknjvbvrq`), gov
(`scknotsqkcheojiaewwh`), dia (`zqzrriwuavgrquhisnoa`). This supersedes the
"deeds + SOS are the unblock" framing in
`OWNERSHIP_RESOLUTION_ENGINE_authoritative_source_audit_2026-07-14.md`.

---

## 1. What we ran today, and what it proved

### 1a. SOS-direct workflow — dispatched, audited step by step (dry-run #1)
Triggered `sos-ingest.yml` (FL,AZ,CA / limit 40 / apply=false) on GitHub Actions.
Result: **the code is not the blocker — the egress is.**
- ✅ Production secrets present (`SUPABASE_URL` + `SERVICE_ROLE_KEY`), deps installed,
  Python 3.11, DB connected, fetcher executed, discipline enforced (circuit-breaker
  backed off; never touched a CAPTCHA).
- ❌ **AZ (ecorp.azcc.gov) blocked the GitHub-runner IP.** All 24 scanned AZ rows
  logged `SOS host backed off … exceeded the per-run failure threshold`. Classic
  datacenter-IP block that public SOS sites apply to cloud runners. 0 written.
- ⚠️ **FL: 0 rows, CA: 0 rows selected.** Only **24** empty-manager owners have a
  formation_state in the supported set {FL,AZ,CA} — all 24 AZ. The gov owner universe
  is formed mostly in *other* states (DE/MD/VA/NY…) the fetcher doesn't cover.
- **Net: 0 managers, 0 addresses.** Two real blockers: (a) IP-block on the runner,
  (b) tiny state coverage. SOS-direct is both **blocked** and **narrow** — it is not
  the lever.

### 1b. Deed feed — fixed + draining, but it barely reaches the value
The deed OCR worker fix shipped and is draining (158 → 154 storage-ready gov deeds,
`recorded_owners.mailing_address` 5 → 6, real DocAI OCR). **But** grounding the
high-value set refuted "deeds are the primary engine":
- The 345 ≥$1M contactless owners map to **521 gov properties** (+56 dia).
- Of those 521: **5 have a deed document at all; 1 is OCR-ready.** The deed feed
  touches ~1% of the high-value set.
- Yet **348/521 (67%) already have `latest_deed_grantee`** and **493/521 (95%)
  already have a recorded owner.** The owner *name* is already known.

### 1c. The high-value owners are bare shells (the decisive finding)
The 345 ≥$1M contactless owner entities:
- **0** carry a CoStar-captured phone/email on the entity.
- **0** have a relationship to a *person* entity.
- **33** have *any* relationship at all (mostly owns-edges to their asset).
- **13** have even a pivot-resolved manager name waiting to attach.
- **all** are `organization` shells (SPE/LLC), 0 persons.

**Conclusion:** for the high-value tier there is genuinely **no decision-maker data
in the system yet**, from *any* automated source — not deeds (5/521), not SOS
(blocked+narrow), not CoStar contact capture (0), not cross-reference (no person
links to reuse; the 1,015 reusable contacts belong to other/lower-value owners),
not Salesforce (their SF accounts returned `no_contacts` — USPS, Wells Fargo, 810
Seventh Ave SPE, Monterey DC Assets…).

---

## 2. First principles — the objective vs the current structure

**Objective:** every asset resolves to a **true owner + a reachable principal
contact**, grounded and traceable to source, as automatically as possible; manual
search is directed only at the residual gaps.

**Why the current structure is misaligned:** the ORE was built as *one* pipeline —
"fetch authoritative public records (deed/SOS/assessor) → managing member/notice
address → attach." That is the correct tool for a **local operating LLC** (a
dentist who owns his building through "Main St Holdings LLC" registered in his home
state). It is the **wrong tool for an institutional SPE** ("810 Seventh Avenue SPE
LLC"), where:
- the deed/SOS "manager" is a **law firm or registered-agent service**, not the
  sponsor's acquisitions officer;
- the real decision-maker sits at the **parent sponsor** (Blackstone, Hines,
  Brookfield, Northwestern Mutual, MetLife, Related, Boston Properties…), a *known
  institution* with public IR/acquisitions contacts;
- so the value doesn't come from *capturing more records* — it comes from
  **resolving the SPE to its parent and attaching the parent's known contact.**

The single-pipeline design is why the high-value tier sits at ~0% resolved despite
the owner names being 95% present. **The data to identify these owners is there;
the structure to route them to the *right* resolution path is not.**

---

## 3. The realigned design — two owner tiers, two resolution paths

Segment every contactless valued owner by **owner archetype**, then route.

### Tier A — Institutional SPE / sponsor-owned (the high-value concentration)
Signal: the owner is an SPE-shaped name (SPE/LLC/LP/"… Owner LLC"/JV) whose asset is
large, and whose name or address maps to a known sponsor. Path:
1. **Resolve SPE → parent sponsor.** Extend the R5/R6 buyer-parent registry (built,
   but scoped to *buyers*) into an **owner-parent registry**: naming-core + shared
   notice address + the sponsor pattern table. This is a *reconciliation/consolidation*
   problem on data we already hold, not a fetch.
2. **Attach the parent's contact from a curated institution registry.** ~50–150
   institutions own the bulk of institutional CRE; their acquisitions/asset-mgmt
   contacts are stable and publicly known. A small, high-trust
   `institution_contacts` table (sponsor → primary contact, source-tagged) resolves
   hundreds of SPEs at once. This is the highest-leverage, most-accurate move for the
   value — one Blackstone contact resolves every Blackstone SPE.
3. **Fallback: the parent's SF account / a sibling entity's captured contact.** Where
   the sponsor already exists in SF or a sibling SPE carries a CoStar contact, reuse
   it (the cross-reference resolver — once parent links exist for it to traverse).

### Tier B — Local / operating-company owner (the long tail)
Signal: owner name is not SPE-shaped, is locally formed, single-property. Path: the
existing **public-records fetchers** (deed notice-address, county SOS, assessor
mailing) — the *right* tool here, and where the deed feed actually has coverage.
Keep the deed drain running for this tier; add per-county assessor + more SOS states
over time. Egress that isn't IP-blocked (see §5).

### The router
A new classification step (pure, from data we already hold: name shape, asset value,
sponsor-pattern match, formation state) tags each contactless owner `institutional`
vs `local` and routes it to Tier A or Tier B. The B1 reconcile worker already
classifies reconcile *state*; add the *archetype* dimension so `needs_enrichment`
splits into `resolve_parent_then_registry` (A) vs `fetch_public_records` (B).

---

## 4. Applying Scott's six verbs to the realignment

- **Organize better** — one `owner_archetype` (institutional/local) on every valued
  owner; the SPE→parent edge as a first-class relationship; a curated
  `institution_contacts` registry. Structure the graph so the *parent* is the contact
  anchor, not the SPE.
- **Capture better** — we already capture owner names well (95%). The capture gap is
  **CoStar owner phone/email is landing but not being attached to the entity** (0 of
  345 high-value owners carry it — verify the ORE Phase-1 B/D writer is actually
  persisting it). And capture the **sponsor** field the OM/deal docs already state.
- **Sort better** — value-rank *and* archetype-rank: work institutional-high-value
  through the registry (cheap, accurate, bulk), local through public records.
- **Propagate better** — one attached parent contact must **fan out to all sibling
  SPEs** of that parent automatically (the cross-reference resolver, once parent
  links exist). Resolve Blackstone once → propagate to every Blackstone SPE.
- **Reconcile better** — the B1 engine compares authoritative vs SF/CoStar; extend it
  to reconcile **SPE→parent** and **owner→institution-registry**, and to *consolidate*
  the sibling SPEs under one parent (merge/relationship, reversible).
- **Direct manual action better** — after the registry + parent-resolution run, the
  *residual* is a small, honest list: (i) institutions not yet in the registry (add
  one contact, resolve many), (ii) genuine local LLCs with no deed/SOS hit. Surface
  each as a directed research task with the exact next step — never a 3,491-row
  undifferentiated backlog.

---

## 5. Concrete next steps (in leverage order)

1. **Build the `institution_contacts` registry + owner-parent resolver (Tier A).**
   Highest leverage for the value: a curated sponsor→contact table + an SPE→parent
   classifier resolves the high-value concentration with high accuracy, no fetching,
   no IP-blocks. Seed from the top-value contactless owners (their names already
   cluster: NGP, Boyd Watterson, Easterly, Blackstone, USGBF, RMR…). *Draft a Claude
   Code prompt.*
2. **Verify + fix the CoStar owner phone/email attach (Tier A/B capture gap).** 0 of
   345 high-value owners carry the CoStar contact the ORE Phase-1 B/D writer was
   supposed to persist — confirm the writer runs and the field lands on the entity.
3. **Keep the deed drain running (Tier B), gentle.** It's the right tool for local
   owners; let it compound. Don't over-invest — it's ~1% of the high-value set.
4. **Park SOS-direct as infrastructure work, not a quick unblock.** To be useful it
   needs (a) an egress path AZ/CA don't block (a residential/proxy egress or a
   ToS-compliant data source), and (b) high-coverage states (DE/MD/VA before more
   local ones). Not the current path.
5. **Add the archetype router to B1** so the daily reconcile splits institutional vs
   local and routes each to the right engine.
6. **B2 SF-push stays gated** — once Tier A resolves parents + contacts, the net-new
   parents (not the SPEs) are what get pushed to Salesforce.

---

## 6. Bottom line

Scott is right: the data is there. The owner *identity* layer is 95% present. The
resolution failure is **structural** — the ORE routes institutional SPEs down the
public-records path built for local LLCs, where the "manager" is a law firm and the
real decision-maker lives at an unresolved parent sponsor. The fix is not more
fetching; it's **archetype-aware routing + an SPE→parent→institution-registry
resolution path** that reuses data we already hold and fans one resolved contact out
across a sponsor's whole SPE portfolio. Deeds stay the tool for the local tail; SOS
becomes a later infra investment. That realignment is what makes ownership resolution
both automatic *and* accurate for the value that matters.

---

## 7. The core doctrine (Scott, 2026-07-15): multi-signal, authority-weighted reconciliation

The deepest reframe. Manual reconciliation never relies on one source — it uses
**every available clue** and hierarchically weights the more authoritative ones to
converge on the true owner + contact: a phone number, a name + city/state, a mailing
address, an email, a naming convention — each is *evidence* that links records. The
system must do the same, intelligently and automatically. This is the true meaning of
"reconcile better," and it subsumes the earlier single-source rules.

**The current structure is single-signal + rule-based** (deed grantee overrides
recorded owner; R6 name-matches to a parent; provenance ranks one field at a time).
That misses the human move: **triangulating identity from the *agreement* of multiple
weak signals.** Two owner records that share a phone, or a name-core + city/state, or a
mailing address, are the *same party* even when no single field is authoritative.

### The reconciliation engine (design)
For every owner/property, gather the full **evidence set** and resolve identity by
authority-weighted agreement:

- **Signals (each a linkage key):** owner name + normalized name-core; mailing/notice
  address; phone; email; city/state; naming convention/pattern; deed grantee;
  `true_owner`; SF account; CoStar owner-panel parent; sales buyer; GSA lessor.
- **Authority weights (the hierarchy):** manual/curated > recorded deed/county >
  SOS registration > CoStar/RCA aggregator + `true_owner` field > naming-only
  inference. A high-authority signal *confirms*; agreement of several low-authority
  signals *also* confirms (the human move).
- **Resolve → canonical party:** cluster records whose weighted evidence agrees into
  one canonical owner; attach the best contact from any record in the cluster (a phone
  on one SPE resolves the whole cluster). Cross-reference across the portfolio so one
  resolved contact fans out. Surface genuine ambiguity (conflicting high-authority
  signals) to review — never guess.
- **Traceable + reversible:** every merge/attach records which signals agreed at what
  weight, back to source. This is the "grounded, traceable" requirement made literal.

### Two grounded facts this doctrine must exploit (2026-07-15)
1. **`true_owner` already holds the sponsor for a large share of the high-value set.**
   Of the 521 ≥$1M gov properties, **297 (57%) have a `true_owner` distinct from the
   recorded SPE**, and a sample shows many ARE the sponsor (Orion, Hyundai Securities,
   Blackstone, Hana Asset Mgmt, Lincoln Property, C-III, The Shooshan Company, even a
   named principal "Nicholas Schorsch"). **The sponsor is in the data; the worklist
   just surfaces the SPE, not the sponsor.** So Tier A's *first* resolution step is
   **prefer the in-data `true_owner` sponsor** before any external registry — cheapest,
   already-captured, traceable.
2. **The recorded↔true reconciliation is imperfect** — one sampled row is *inverted*
   (`IGIS Asset Management` recorded ↔ `810 Seventh Avenue SPE LLC` true_owner —
   backwards), others are case-variant duplicates (`CP-MIDWAY…` vs `Cp-Midway…`). A
   weighted reconciler catches both: the case-dups merge on name-core; the inversion is
   a conflicting-authority flag for review. Fixing recorded↔true reconciliation *is*
   part of resolving the sponsor.

### How this changes the Tier A build
Insert a reconciliation-first step ahead of the registry:
`resolve owner → prefer in-data true_owner sponsor (weighted) → else owner-parent
resolver → else institution registry → else directed research`. The institution
registry (Unit 1) is then only needed for owners whose sponsor is *not* already in
`true_owner`/the graph — a smaller set. And the weighted reconciler runs across ALL
owners (both tiers), continuously improving as deeds/SOS/CoStar/OM signals accumulate:
each new clue re-triangulates identity and can promote an `unresolvable` owner to
resolved without any new fetch.

---

## 9. Contact selection & prospecting doctrine (Scott, 2026-07-15)

Contact **discovery, selection, and prioritization** must be authoritative-weighted and
org-structure-aware — the same discipline as ownership reconciliation (§7) — with a
parallel experience/direction lane, and it must never stall. The objective is always:
**reach the individual with control to bind, or direct action on behalf of, the
organization.** Who that is depends on the org's size and structure, so the *contact*
resolution must match the *owner* resolution.

### 9a. Two lanes, one objective (start authoritative, never stall)
- **Lane 1 — Authoritative (runs continuously, no waiting).** Resolve the control
  contact from authoritative sources by weighted authority, exactly like ownership. This
  lane **never pauses for a manual "who to call" decision** — it always produces a
  best-authoritative target and keeps working until we learn more. Manual feedback is
  required only when genuinely stuck; the process must not stall on an arbitrary pick.
- **Lane 2 — Experience / direction (additive, adjusts strategy — not control).** Personal
  experience + what groups tell us during prospecting ("call our wealth manager / our
  accountant / talk to Jane in acquisitions") **directs future action but does NOT change
  who holds control.** A handoff is not binary: keep prospecting the decision-maker, just
  **lighter** after the handoff, and focus effort on the directed person. Both lanes work
  to the same outcome; direction re-weights intensity, it doesn't overwrite the control
  contact.

### 9b. Authority hierarchy for CONTROL (who can bind)
Rank contact sources by authority, mirroring the ownership ledger — **the person who
signed is better evidence of control than an aggregator listing:**
- **Highest:** deed **signatory** + loan-document **executor** (they signed = they bind);
  LLC **managing member** (SOS); **notice address** individual (county/SOS — for a small
  LLC this is often a primary residence = the individual).
- **Lower:** CoStar "ownership contact" — good, but **not always perfect / not proof of
  control**.
- Direction from the org (Lane 2) is a *strategy* signal, ranked separately — it elevates
  the directed contact's *priority* without claiming control authority.

### 9c. Org-archetype-aware role model (the target matches the structure)
The right contact — and how many — depends on the organization:
- **Small LLC (one / a few individuals):** the managing member(s) / deed signer / notice
  individual **are** the target(s). Prospect those individuals directly (they're usually
  the same person across SOS + deed + notice address).
- **Large REIT / institution (functionally separated roles):** roles split by function.
  **Acquisition** (analysts → associates → directors) report to an **investment
  committee** and drive buy/offer decisions. **Disposition** decisions + **broker
  selection** are made by different people (asset management / capital markets) who rely
  on the acquisition team's feedback. Prospect the **disposition/broker-selection** path
  for seller work, informed by the acquisition relationship.
- **Not one, not all.** Do NOT arbitrarily pick a single contact per company, and don't
  blast everyone — resolve a considered **set** (the bench), sized + role-typed to the
  org's structure. Businesses and true owners are dynamic.
- **Partnership dynamics ≠ ownership percentage** — control doesn't always follow the
  equity split; weight the signer/managing-member/decision-maker, not the cap table.

### 9d. Buyer vs Seller prospecting mode (drives the whole motion + the touch content)
Classify each true company by behavior and prospect accordingly:
- **Programmatic Buyer (REIT / repeat acquirer — R5 buyer-parents already identify these):**
  prospect as a **Buyer** — this happens **naturally via ongoing marketing of our
  listings** (buy-side). Give them access to product *before* the market.
- **Everyone else → prospect as a Seller.** Seller touches maximize name-recognition with
  what resonates: **"you own this, I sell this"** — location-based or "blue-suit" style
  (*you own a DaVita-leased building in Tulsa; I sell DaVita-leased buildings nationwide —
  here's a comparable I just closed/listed*).
- **Always lead with value / non-public information** that shows subspecialty expertise:
  - Buyers → early access to this product type before it's for sale.
  - Sellers → information that could move the owner's value / decision / timeline /
    financing / valuation, or tenant trends (renewals, expansions, business shifts and
    their real-estate impact).

### 9e. Dynamic response (the app directs the effort, and learns)
As we learn contact info + who to call, the app **responds dynamically**: the
authoritative control contact stays resolved (Lane 1), the directed contact is added +
prioritized (Lane 2), the touch mode (buyer/seller) + content (location/blue-suit +
value offer) is selected per company, and every prospecting outcome (referral, handoff,
no-response, bounce, two-way) re-weights the bench — continuously, without stalling.

### 9f. Mapping to the code (where it lands)
`owner_contact_pivot` already carries the bench (`bench`/`consumed`/`demoted`), authority
(`active_authority_level`/`active_contact_role`/`active_source`), feedback
(`pivot_history`/`recurrence_locked`), and the CONTACT-SELECTION ladder
(signatory→controlling→economic→agent) exists — so the doctrine largely *extends* built
structure. The gaps to close: (1) org-archetype-aware role prioritization (small-LLC
individual vs REIT role-separated); (2) a **control-contact vs directed-contact**
distinction so Lane-2 direction adjusts intensity without overwriting control; (3)
**buyer/seller prospecting mode** on the company driving cadence type + touch content;
(4) rank deed-signer / loan-executor / SOS-managing-member **above** CoStar in the contact
authority weights (reuse `lcc_signal_authority`); (5) guarantee the authoritative lane
never stalls waiting on a manual pick. Prompt:
`CLAUDECODE_PROMPT_ORE_contact_selection_doctrine.md`.

### 9g. Worked example / acceptance test — Boyd Watterson (Scott, 2026-07-15)

The canonical case for the contact-selection build. **Boyd Watterson is a BUYER** (strong
authoritative + personal-experience evidence) → prospect buy-side (via ongoing listing
marketing), NOT a seller cadence. Two-fund structure reporting to one investment committee:
- **GSA Fund** — head of acquisitions: **Eric Dowling**.
- **State Fund** (government contractors + GSA deals < $10M purchase price) — head of
  acquisitions: **Joe Capra**.
- Each fund has acquisition team members (also prospect); **both funds report to the same
  investment committee / higher-up decision-makers** that direct the funds.
- Source: learned through conversation + direction by the Buyer (overt + subtextual /
  deal-flow) — a Lane-2 (experience/direction) signal, now authoritative for Boyd.

**Live-graph reality (why both engines matter):** Boyd is fragmented into ~26 LCC entities —
real orgs (`Boyd Watterson` [SF 001Vs…PT1A6], `Boyd Watterson Global` [buyer-parent, SF
0018W…X08rl], `Boyd Watterson Asset Management`, **`Boyd Watterson GSA Fund`** already
exists, + `…SGF … c/o Boyd Watterson Asset Management` State-Fund SPEs) buried under junk
person-rows (`Boyd Watterson by CBRE/Colliers/Newmark…`, CMBS codes, JVs) — across **three
different Salesforce accounts**. The reconciliation engine correctly **held Boyd Watterson
vs Boyd Watterson Global `distinct`** (score 70 but conflicting SF accounts = high-authority
conflict → no auto-merge) and flagged `GSA Fund` as `review` (a child, not a dup). So:
- **The two SF Boyd accounts are themselves a duplicate → reconcile in Salesforce first**;
  that's the "contacts in SF help direct reconciliation across LCC/SF/Outlook" mechanism.
- **The parent→fund→head-of-acq→team→shared-IC hierarchy is the NEW model** the
  contact-selection build adds (funds are children, not merges). Boyd = the acceptance test:
  the bench for a Boyd asset should carry Eric Dowling (GSA Fund acq) / Joe Capra (State
  Fund acq) role-typed, buyer-mode, both under the parent + IC.
- **The junk person-rows** (`Boyd Watterson by <broker>`) are reconciliation cleanup
  (junk-name guards / merge).

**Action for the two contacts:** add **Joe Capra** (State Fund) + **Eric Dowling** (GSA Fund),
title *Head of Acquisitions*, as Salesforce **Contacts on the canonical Boyd account**
(recommend the buyer-parent `Boyd Watterson Global` 0018W…X08rl; dedupe the 3 Boyd accounts).
Once in SF, the SF sync pulls them into LCC and the reconciliation engine anchors on the SF
Contact identity (weight 80) — the highest-authority link — directing consolidation. (Claude
cannot write to Salesforce; this is Scott's / a gated-worker step. Details captured here so
they are not lost.)

## 10. LCC as the universal reconciliation layer (Scott, 2026-07-15)

The capstone doctrine. **LCC is the reconciliation engine that drives every source to the
single most accurate truth — everywhere, all at once — and keeps learning as we grow.**
Ownership, contact identity/selection/direction, contact info (email/phone) enrichment,
the ownership chain back to the developer — all are resolved from the *agreement* of ALL
available sources, weighted by authority (§7/§9), not from any one system. Sources include:
- **Email (Microsoft/Outlook)** — call notes + email traffic reveal who to call, contact
  info, handoffs/direction, and ownership facts.
- **Salesforce activity + contacts** — the CRM record + logged tasks/events/notes.
- **Copilot chats** — captured conversation intelligence.
- **Web search** (public-records path; the paid search proxy stays paused).
- **Property-folder correspondence + title commitments + lease documents** — which
  establish the ownership chain back to the developer, guarantor, signatory.
- **County/SOS/assessor/deed + CoStar/RCA + OM/flyer intake** (already wired).

Every one of these is *evidence*. LCC ingests them, extracts the entities/contacts/facts,
and feeds them into the weighted reconciliation engine (§7) + the contact-selection engine
(§9) so that: a call note that says "we now deal with Jane in acquisitions" updates the
directed contact; an email signature enriches a phone/email; a title commitment extends
the ownership chain; a Salesforce contact anchors identity at the highest authority. The
system **resolves continuously and re-triangulates as new evidence lands** — the truth
converges over time instead of going stale, and no single source is trusted blindly.

### 10a. Triage — the Salesforce contact-sync disconnect (Boyd, 2026-07-15)
Grounded live: the SF→LCC contact sync **works** — **9 of the 10** Boyd-linked contacts
carry a `salesforce/Contact` identity (Perrault, Moulder, Pfohl, Felfeli, McGrade, Penrod,
Owens, Butler, Peters) and most reconciled with their CoStar captures. The **two
exceptions are exactly the two Scott named:**
- **Joe Capra** — **absent from LCC entirely** (no entity).
- **Eric Dowling** — present in LCC but **only from CoStar + RCA** (`costar/contact`,
  `rca/contact`), with a real email/phone (`edowling@boydwatterson.com` / (312) 777-3704)
  — **no `salesforce/Contact` identity.**

So this is **not a sync flaw creating duplicates** — the sync is pulling the SF contacts
that exist on the synced Boyd account and reconciling them. The two in question simply
**haven't come through Salesforce**, which means one of: (a) they are **not actually in SF
as Contacts on the synced Boyd account** (possibly known only from conversation, or on a
*fund* sub-account not mapped to the Boyd parent), or (b) added to SF without an
activity/account link the sync reaches. **Verify in Salesforce before creating them** —
that's the "don't needlessly create duplicates" check.

**VERIFIED live in Salesforce (2026-07-15, northmarqcapital org) — both exist; DO NOT
create them:**
- **Joseph Capra** — SF Contact on account **"Boyd Watterson Asset Management LLC"**,
  `jcapra@boydwatterson.com`, recent activity 7/14/2026. Correct company. **Absent from
  LCC.**
- **Eric Dowling** — SF Contact, `edowling@boydwatterson.com`, (312) 777-3704, activity
  7/14/2026 — **but mis-filed under the account "Arbor Realty Trust"** (title "Analyst").
  His email domain contradicts the account → a **Salesforce-side data-quality error**.
  LCC has him only from CoStar/RCA.

**Root cause of the disconnect = SF→LCC contact-sync SCOPE, not a dup bug.** The 9 Boyd
contacts that synced sit on the *mapped* Boyd accounts (Boyd Watterson / Boyd Watterson
Global); Capra sits on a THIRD, **unmapped** account ("Boyd Watterson Asset Management
LLC") and Dowling on a **misfiled** account ("Arbor Realty Trust"). The sync pulls
contacts on LCC-mapped accounts only, so a decision-maker on an unmapped/misfiled account
never flows — even with recent activity. **Fix = broaden the SF contact-sync scope** (pull
by owner/company reconciliation or email-domain, not just exact account-mapping) + let LCC
reconcile Dowling by email (the CoStar `edowling@…` and the SF Dowling are one person).
**Bonus (the doctrine's payoff): LCC-as-reconciliation-layer would SURFACE the
Dowling-on-Arbor SF error** — an @boydwatterson.com email on an "Arbor Realty Trust"
account is a signal-disagreement the engine flags. Neither contact should be created in
SF (they exist); the work is on the LCC sync + reconciliation side. The reconciliation safety net: LCC
already holds Eric Dowling with his email, so if/when an SF Dowling appears, the engine
should merge them **by email** (weight 55) into one — *provided the SF sync brings the
Contact in*. The gap this exposes, and what §10 fixes: **a contact known from
conversation/email/notes (like Capra) should be captured + reconciled even without a formal
SF activity** — email/notes/Copilot as first-class contact sources, keyed on email/name so
they never fork from the CoStar/SF record.

### 10b. Salesforce posture + Outlook as a reconciliation source + duplicate handling (Scott, 2026-07-15)
- **LCC is the source of truth; Salesforce is minimal-necessary.** Do NOT try to fully
  reconcile/clean Salesforce (many users, shared org) — LCC complies with the *minimum
  necessary/required by the organization* for SF, and keeps **most data + intelligence in
  the LCC databases / contacts / entity graph.** SF is one authoritative source (high
  weight for identity) + a compliance surface, not the master.
- **Outlook (+ other LCC contacts) as a first-class, bidirectional reconciliation layer.**
  We have extensive email + call history with contacts (e.g., Capra + Dowling) — LCC should
  **sync with Outlook contacts and reconcile them as the source of truth**, and use that
  layer to **search + enrich to/from** (email/phone/name → identity; email traffic → who to
  call + direction + ownership facts). A contact known from email/calls must be captured +
  reconciled by email/name even if it never became a formal SF Contact (the Capra/Dowling
  gap) — closing §10's "learn from every source" loop on the contact side.
- **Duplicate accounts/contacts are a permanent reality → LCC must absorb them, not
  require SF to be clean.** Duplicate SF Accounts (the 3 Boyd accounts) + duplicate SF
  Contacts will always exist. LCC's reconciliation engine (§7) already holds
  conflicting-SF-account entities `distinct` (safe) — the scope-out: **LCC consolidates the
  duplicates on ITS side** (merge the LCC entities that map to multiple SF accounts/contacts
  of the same party, keyed on the weighted-signal agreement), presenting one canonical
  party internally while tolerating the SF-side duplication. LCC never depends on SF being
  deduped; it reconciles around it. (Scope note: a same-party cluster carrying two different
  SF account ids is a `review`/merge candidate on the LCC side, not a blocker — extend the
  engine to *merge the LCC entities* even across an SF-account conflict when the other
  signals strongly agree AND the two SF accounts are themselves same-party, recording both
  SF ids on the survivor.)

### 10c. Next build — SF contact-scope + email reconcile + Outlook (prompt written 2026-07-15)
`CLAUDECODE_PROMPT_ORE_sf_contact_scope_email_reconcile.md`: (1) widen SF contact ingest
beyond exact account-mapping (activity-WhoId minting + email-domain/owner-company scope) so
Capra (unmapped account) + Dowling (misfiled account) flow in; (2) reconcile every ingested
SF contact by EMAIL so the SF Dowling merges into the existing CoStar/RCA Dowling — one
entity, never a dup; (3) surface SF account/email disagreements (Dowling-on-Arbor) as a
`sf_contact_account_mismatch` Decision-Center signal (LCC detects SF errors, doesn't inherit
them); (4) Outlook as a first-class contact/enrichment source (email/call history →
identity + real-activity signal). LCC = source of truth; SF/Outlook read-only,
minimum-necessary; no fabrication; ≤12 api/*.js. Contact-authority-hierarchy round (PR
#1402) merged + redeployed live.

### 10d. SF contact-scope build shipped (PR #1404, 2026-07-15) — units 1-3
Root cause confirmed: `sf-activity-ingest.js` was **resolve-only** (looked up the WhoId
contact, skipped when absent — never minted). Shipped LCC-side, no migration, ≤12 api/*.js:
- **Unit 1 — mint the WhoId contact** on every synced activity via
  `ensureEntityLink(salesforce/Contact)` (kill-switch `SF_INGEST_MINT_CONTACTS`; byte-
  identical no-op when the flow omits name/email; guards reject garbage). Capra becomes a
  linked entity + `salesforce/Contact` identity.
- **Unit 2 — reconcile by email** through the R39 email tier → the SF Dowling attaches to
  the existing CoStar/RCA Dowling (one entity, three identities, no dup).
- **Unit 3 — `sfContactAccountMismatch`** → seeds a `sf_contact_account_mismatch`
  Decision-Center lane (Dowling-on-Arbor flags; Capra-on-Boyd agrees). Record-only, no SF
  write. Live synthetic gate passed (0 residue).
- **Scott's dependency (the mint is inert until done):** update the **SF Activity Sync PA
  flow** to POST `Who.Name`/`Who.Email` (+ First/Last/Phone/Title) and `What.Name` (account)
  on each Task/Event to `/api/sf-activity`. Then merge PR #1404 + redeploy.
- **Deferred:** Unit 4 (Outlook — same resolve-only gap in `handleOutlookMessageExtract`,
  spec'd, symmetric fix, next round); Unit 1b (broadened SF contact-pull query scope — a PA
  flow edit).

### 10e. SF WhoId-resolver pivot (2026-07-15) — the flow can't enrich, LCC resolves
The PA Salesforce connector **cannot return relationship fields** (`Who.Name` rejected in
`$select`), and **per-record lookups in the recurring flow are too slow** (a test ran hours
over ~2,000 Tasks). So the SF Activity Sync flow was **reverted to its fast/simple working
state** (WhoId/WhatId only), and enrichment moves to LCC: a tiny **"SF Get Contact By Id"**
HTTP flow (one Get-record action + optional Account lookup) resolves only the **handful of
WhoIds LCC wants to mint** (new contacts, not every Task). Prompt:
`CLAUDECODE_PROMPT_ORE_sf_whoid_resolver.md` — (1) queue unresolved WhoIds at ingest
(`sf_contact_resolve_queue`), (2) `?_route=sf-contact-resolve-tick` drains via the by-id flow
→ mint through the R39 email tier (Dowling merges into the CoStar/RCA Dowling, no dup) → run
the PR-#1404 mismatch detector (Dowling-on-Arbor flags). Feature-flagged on
`SF_CONTACT_BYID_URL`; reliable get-by-id primitive; ≤12 api/*.js. Completes PR #1404 (Units
1-3 were inert because the reverted flow carries no `Who.Name`).

### 10f. SF WhoId-resolver BUILT (PR #1406, 2026-07-15) — flow + env live, awaiting merge
Scott built the one-action **"SF Get Contact By Id"** PA flow (Contact + Company[=Account]
get-by-id, verified our org relabels Account→Company but `Contact.AccountId` stands) and set
`SF_CONTACT_BYID_URL`. Claude Code shipped the LCC resolver: `sf_contact_resolve_queue`
(migration `20260731120000`) enqueues unresolved WhoIds at ingest; worker
`?_route=sf-contact-resolve-tick` (GET dry-run / POST drain 25) → `getSalesforceContactById`
→ mint via ensureEntityLink R39 email tier (Dowling merges into CoStar/RCA Dowling, no dup) →
`sfContactAccountMismatch` (Dowling-on-Arbor flags); gentle cron `lcc-sf-contact-resolve`
(`*/30`, `20260731120500`). Feature-flagged; ≤12 api/*.js; 1835 tests pass. **Awaiting Scott
merge PR #1406 + redeploy** (endpoint 404s until operations.js ships). Verify: GET dry-run →
capped POST drain → Capra mints onto Boyd, SF Dowling merges by email, mismatch lane surfaces.

### 10g. WhoId-resolver live-tested — flow perfect, ONE adapter bug (2026-07-15)
Migrations applied live to LCC Opps (queue + cron); route live (`byid_configured:true`).
Seeded Capra (`0038W00002PRo0iQAD`) + Dowling (`0038W00002PRqkNQAT`) WhoIds + drained →
both `guard_rejected`. **Root-caused via the PA run history: the flow is flawless** —
returns `{name:"Eric Dowling", email:"edowling@boydwatterson.com", phone, title,
account_id, account_name:"Arbor Realty Trust"}`, 200, lowercase-keyed. The bug is LCC-side:
`getSalesforceContactById` isn't reading the flow's lowercase keys, so the name arrives
null and the guard rejects it. Fix prompt: `CLAUDECODE_PROMPT_ORE_sf_byid_adapter_fieldmap_fix.md`
(align the adapter field map + stop mislabeling a null name as `guard_rejected`). The two
WhoIds sit in the queue (`no_data`) — Cowork resets to `seen` + re-drains after the fix.

## 8. Progress log (living — update as we work this topic)

- **2026-07-15** — Deed OCR worker fix shipped + verified (158→154 storage-ready
  draining; mailing_address 5→6; real DocAI OCR). B1 reconcile seeded (top-100 ≥$1M:
  85 unresolvable / 7 contact_ready_no_sf / 4 sf_no_contact / 4 resolvable_contact)
  and scheduled daily (`lcc-owner-reconcile`, 05:35).
- **2026-07-15** — SOS-direct workflow dispatched + audited live: code works, but AZ
  IP-blocked the runner + FL/CA have 0 rows in-scope (24 owners total, all AZ). SOS
  parked as future infra.
- **2026-07-15** — Deed-coverage grounding: the 345 ≥$1M owners → 521 gov props, only
  5 have a deed doc (1 OCR-ready); owner name 95% present; the 345 owners carry 0
  contacts / 0 person links. Deeds don't reach the value → **two-tier realignment**.
- **2026-07-15** — CoStar owner phone/email capture verified **not a bug** (290 orgs
  carry it; institutional SPEs simply don't list one; gov `recorded_owners.contact_info`
  = 0 phone/0 email).
- **2026-07-15** — Sponsor concentration + `true_owner` finding: high-value SPEs are
  asset-named (no sponsor signal in the name), BUT 57% of props already carry the
  sponsor in `true_owner`. Adopted the **multi-signal weighted reconciliation doctrine**
  (§7); Tier A build reframed to prefer the in-data sponsor first.
- **2026-07-15** — **ORE Tier A BUILT + pushed (PR #1397)**, LCC-Opps migration
  `20260716130000` applied live. `lcc_institution_contacts` registry (ships empty —
  never fabricated), `lcc_resolve_institution_contact` (tier-0 `true_owner` / tier-1
  own-name, operators excluded), `v_institution_registry_gaps` (seed list, value-ranked),
  `v_institution_contact_attachable` (fan-out driver), `v_owner_archetype`;
  `institution-registry.js` + `?_route=institution-contact-tick` (attach + fan one
  contact across the sponsor's whole SPE portfolio + seed cadence); B1 archetype router.
  Reuses R47's `lcc_resolve_owner_parent`. Synthetic fan-out gate passed (one contact →
  8 Global Net Lease SPEs via tier-0). 1713 tests pass. JS ships on Railway redeploy.
- **2026-07-15 — live seed list (`v_institution_registry_gaps`, fan-out ≥3 SPEs):**
  Gardner Tannenbaum 30/$12.2M · Penzance Management 3/**$48.1M** · Blackstone 8/$14.1M ·
  Global Net Lease 8/$9.4M · GIP 6/$3.0M · C-III 5/$5.6M · Lincoln Property 4/$5.6M ·
  Rainier 5 · Rooker 5 · TIAA 3. **Scott fills a real contact per sponsor → the worker
  fans it out.**
- **2026-07-15 — `true_owner` quality-noise finding (motivates the weighted reconciler):**
  the sponsor-cluster ranking surfaced junk in the `true_owner` field feeding it —
  placeholder values (`John Doe`, `Independent`), an OPERATOR mis-typed as a sponsor
  (`U.S. Renal Care`, 15 dia SPEs — the R8 artifact; the operator-exclusion list needs
  it), and AI-verbose strings (`TIAA (Teachers Insurance and Annuity Association…)`,
  `… or related stakeholders`). These are precisely the cases the multi-signal weighted
  reconciler (§7) resolves: junk/placeholder names filtered, operators excluded, verbose
  strings canonicalized, identity confirmed by signal-agreement not a single noisy field.
- **2026-07-15 — multi-signal weighted reconciliation engine BUILT + pushed (PR #1399)**,
  LCC-Opps migrations `20260716140000` (engine) + `20260716141000` (pure-DB crons) applied
  live. `lcc_signal_authority` (8 weights: SF-account 80 → email 55 → address 50 → phone
  45 → name-core 40 → sponsor 30 → name+city 25) + `match_threshold` 60 (the one knob);
  `lcc_reconcile_owner(entity)` → `same_party`/`review`/`distinct` (a conflicting SF
  account holds two shells apart, never merges); R7-style `lcc_owner_evidence_cache`
  (**24,389 orgs**, live); append-only evidence trace; `v_lcc_true_owner_noise` (**8,418
  rows** catalogued — the junk/operator/verbose cleanup surface); worker
  `?_route=owner-reconcile-engine-tick` (GET dry-run / POST gated drain); cache-refresh +
  queue-seed crons live. Verified live 0-residue: top-400 → 3 confident merges (City of
  Phoenix / Penzance case-dups), 124 review pairs, 5 held distinct on SF-account conflict;
  Blackstone name-only → review, never guessed. 1726 tests pass.
  **Auto-merge drain cron is GATED off** (consequential — merges entities) pending Scott's
  dry-run → capped-drain gate.
- **STATE (2026-07-15): both engines built + live at the DB layer; movement now needs
  Scott's gated activations:**
  1. **Tier A** — merge PR #1397 + redeploy; seed top sponsors (Gardner Tannenbaum 30,
     Penzance $48M, Blackstone 8, Global Net Lease 8, GIP 6, C-III 5, Lincoln 4) in
     `lcc_institution_contacts` with real contacts; run `institution-contact-tick` to fan
     out. → Claude verifies the fan-out live.
  2. **Reconciliation engine** — merge PR #1399 + redeploy; `GET
     owner-reconcile-engine-tick?min_value=1000000` (dry-run) → capped `POST …?limit=25` →
     confirm case-dup merges correct → schedule `lcc-owner-reconcile-engine` (template in
     migration `20260716141000`). → Claude runs/verifies the gated drain.
  3. **Deed drain** — running gentle (Tier B local owners), compounding.
  Both auto-merge/attach paths stay human-gated until the first drain is confirmed correct
  (the owner-deed-autofix / UW#2 posture).
- **2026-07-15 — both PRs merged + redeployed (live).** Reconciliation dry-run on the
  top-60 ≥$1M owners: **2 confident `same_party` merges, 22 review, rest singletons** —
  appropriately conservative. Example evidence trace (the doctrine working):
  `"Penzance Management LLC" ↔ "Penzance"` → same_party, weighted score **70** (thr 60)
  from shared_name_core(40) + shared_true_owner_sponsor(30), no high-authority conflict —
  a real case-dup that also consolidates the $48M Penzance sponsor. Tier A registry still
  **0 seeded** (awaiting Scott's real sponsor contacts — never fabricated). **Gated
  activations pending: (1) seed a sponsor contact + run the fan-out; (2) bless the capped
  reconciliation drain, then schedule its cron.**

## §10h — SF WhoId resolver: by-id field-map fix WORKS, but the route regressed in the last redeploy (2026-07-16)

- **The field-map fix (PR #1407) is proven correct in production.** Grounded live in
  `net._http_response`: the `lcc-sf-contact-resolve` cron tick **id 98205 @ 2026-07-15
  22:00:23 UTC** returned `{"mode":"apply","byid_configured":true,"queue_depth":3,
  "scanned":3,"resolved":3,"minted":3,...}` — three WhoIds minted cleanly onto entities
  (`sf_contact_resolve_queue` rows `003Vs00000bZj50IAC` / `0031I00000GxqICQAZ` /
  `0031I00000GxqBBQAZ` → `status='resolved'`, `detail='minted'`). The by-id adapter now
  reads the flow's lowercase keys and mints; the guard-rejected mislabel is gone. **The
  resolver works.**
- **A redeploy between 00:00 and 00:30 UTC (2026-07-16) DROPPED the
  `/api/sf-contact-resolve-tick` route registration.** Last healthy worker 200 =
  **00:00:02 UTC** (id 98441, `byid_configured:true`); first **HTTP 400 "Invalid POST
  action"** = **00:30:10 UTC** (id 98547). Every tick since — cron and manual — 400s at
  operations.js's bare **bridge-action router** (`log_activity, … / create_lead, …`),
  meaning the POST reached operations.js but `sf-contact-resolve-tick` was no longer
  recognized as a sub-route. Handler present, dispatch gone → the classic stale-branch
  merge revert (PR #1407 likely branched pre-#1406 and reverted the operations.js /
  server.js / vercel.json route wiring #1406 had added, while keeping the handler file).
- **Impact:** Capra (`0038W00002PRo0iQAD`) + Dowling (`0038W00002PRqkNQAT`) are reset to
  `status='seen'` in `sf_contact_resolve_queue` and CANNOT drain until the route is
  restored — the by-id resolver is the only path (the reverted activity flow carries no
  name, so ingest can't mint them). No data loss; the queue holds them.
- **Fix = restore the sub-route registration, no handler change.** Written up:
  `CLAUDECODE_PROMPT_ORE_restore_sf_contact_resolve_route.md` (restore operations.js
  dispatch + server.js mount + vercel.json rewrite, mirroring the sibling resolver routes;
  redeploy; then the queued Capra/Dowling drain and the Boyd loop closes — Capra mints onto
  Boyd, SF Dowling merges by email into the CoStar/RCA Dowling, the
  `sf_contact_account_mismatch` lane surfaces Dowling-on-Arbor). This is a route-dispatch
  regression, not fixable via SQL.

## §10i — Boyd loop CLOSED live (2026-07-16) + two follow-ups surfaced

**Route restored (PR #1408, merged + live) → the by-id resolver drained Capra + Dowling.**
After restoring the operations.js dispatch, the first tick still `retry`'d both with
`create_failed: 23502` — a **NOT NULL violation on `entities.workspace_id`**: the by-id
field-map is perfect (both payloads complete — Joseph Capra / Acquisitions /
jcapra@boydwatterson.com / 3127773707; Eric Dowling / Analyst / edowling@boydwatterson.com
/ 3127773704), but `sf-activity-ingest` enqueued both WhoIds with a **null `workspace_id`**,
which the resolver passed straight into the `entities` INSERT. Patched the two queue rows to
the canonical workspace `a0000000-0000-0000-0000-000000000001` + re-drained →
`scanned:2, resolved:2, minted:1, mismatches_flagged:1`. Queue now 5/5 resolved, 0
null-workspace remaining.

**Outcome (verified live):**
- ✅ **Joseph Capra** minted fresh (entity `c15d1420…`, 2026-07-16, person) carrying
  `salesforce/Contact` + `salesforce/Account`(Boyd) identities.
- ✅ **Eric Dowling** reconciled by EMAIL — **NO duplicate created** (the R39 anti-dup
  guarantee held); his `salesforce/Contact` identity attached to the pre-existing
  `edowling@boydwatterson.com` record (entity `74e0b0a3…`).
- ✅ **Mismatch lane fired** — `sf_contact_account_mismatch` open decision
  `sfmismatch:74e0b0a3…`: email_domain `boydwatterson.com` on SF account **"Arbor Realty
  Trust"**. LCC detected SF's misfile instead of inheriting it. Exactly the design.

**Follow-up 1 (systemic, → Claude Code) — the workspace-null mint bug.** The resolver mint
23502s whenever the queue row's `workspace_id` is null (which is how `sf-activity-ingest`
enqueues them). Patched 2 rows by hand; the durable fix is a **fallback workspace** in the
resolver (mirror `createResearchTask`'s "primary/oldest workspace" fallback) and/or set
`workspace_id` at enqueue in `sf-activity-ingest`. Written up:
`CLAUDECODE_PROMPT_ORE_sf_resolve_workspace_fallback.md`. Until it ships, any new WhoId with
a null workspace 23502s → `retry` forever.

**Follow-up 2 (data-quality, surface — do NOT silently mutate).** The pre-existing Dowling
record `74e0b0a3` is **conflated**: `entity_type=person` but `canonical_name="boyd watterson
global"` (a FIRM name), carrying `edowling@boydwatterson.com` + `rca/contact` +
`salesforce/Account` + now `salesforce/Contact`. So Eric Dowling (person) and the Boyd
Watterson firm/account are merged into one mislabeled node (an RCA capture put the firm name
+ a Boyd Account identity on a record keyed by Dowling's email). The email-reconcile
correctly avoided a duplicate, but it attached to a bad target. Also both Capra + Dowling
carry a `salesforce/Account` identity ON the person (the contact's AccountId recorded as an
Account-type identity rather than a relationship edge to a Boyd org entity; Capra has
`rel_count=0` — no graph edge to Boyd). Recommend (Scott's call, reversible): rename/split
`74e0b0a3` to the person "Eric Dowling" and relate it to a distinct Boyd org entity, and
decide whether SF `AccountId` should be a person-identity or a `works_at` edge. This is the
kind of conflation the reconciliation engine (§7) + the mismatch lane are meant to surface —
now surfaced.

## §10k — SF-as-source alignment: audit + plan execution (2026-07-16)

Full audit: `ORE_SF_AS_SOURCE_AUDIT_2026-07-16.md`. Verdict: the doctrine is ~80% built —
SF writes are already minimum-necessary + gated (call/activity logging, deal/BOV closing,
gated-off contact-writeback; the `bridges.js salesforce.*.upsert` are INBOUND), and the R39
email-tier reconcile already stops SF dups from becoming LCC dups. The gap is that the
**autonomous consolidation/binding layer is gated off / never wired**, so SF conflation waits
for a manual verdict. The Dowling "person named like a firm" conflation is nearly a one-off
(1 of 559 account-carrying persons); the 559 pattern is a MODELING choice (SF AccountId stamped
as an identity on the person rather than a person→org edge).

**Move A (turn on the reconciliation engine) — dry-run DONE, route blocker found.**
Refreshed the evidence cache (24,460 rows) and ran `lcc_reconcile_owner` over the top-400
value owners: **4 `same_party` (all real case-dups: Penzance ↔ Penzance Management LLC; City
Of Phoenix case-dup; Morgantown GSA ↔ Morgantown GSA USDA — two Boyd SPEs), 133 `review`
(name-core only, < threshold 60), 10 `distinct` (ALL correctly held on a high-authority
conflict — the "two different SF accounts → never merge" guard).** Engine verified safe +
conservative. **But `/api/owner-reconcile-engine-tick` is NOT registered** — POST returns the
bare bridge-router 400 (never a 200; same class as the sf-contact-resolve route revert). Its
cron was left commented because the route was never wired. → prompt
`CLAUDECODE_PROMPT_ORE_register_reconcile_engine_route_and_schedule.md` (register the route
like PR #1408, keep the gated-drain posture; then Cowork runs the capped drain → schedules the
cron).

**Moves B + C (SF-conflation autonomy) → prompt `CLAUDECODE_PROMPT_ORE_sf_conflation_autonomy.md`:**
- **C (modeling guards, do first):** never let an SF account NAME overwrite a person's name;
  relate a contact to its SF Account as a person→org EDGE, not an `salesforce/Account`
  identity-on-person; one-time reversible pass to convert the existing 559 identities→edges +
  rename/relate the Dowling node.
- **B (canonical-record binding):** extend the `sf-link-reconcile` owner→Account binding to
  CONTACT identities — autonomously bind the most-accurate SF record (email-domain-authoritative:
  Dowling → Boyd, Arbor demoted) and demote the rest, LCC-side only; genuine ties fall to the
  `sf_contact_account_mismatch` lane as the true-ambiguity fallback.
- SF writes UNCHANGED (minimum-necessary, gated; no SF merge/cleanup path — resolve in LCC).

State: dry-run proves the engine; two prompts queued (route registration unblocks the
autonomous cron; C+B make SF-conflation resolution autonomous). No merges hand-executed — they
run through the worker's `pickMergeWinner` + snapshot + cache-refresh once the route is live.

## §10l — Move A LIVE + autonomous; SF-conflation guards deployed (2026-07-16)

**PR #1410 (route registration) + #1411 (SF-conflation) merged + redeployed.** PR #1410 also
revived two silently-400ing siblings — `owner-reconcile-tick` (B1 reconcile) and
`institution-contact-tick` (Tier A fan-out) — now runnable.

**Move A — reconciliation engine LIVE + scheduled autonomous.**
- Route confirmed live (200, not 400). Capped drains executed correctly:
  `limit=10` → merged 1 (Penzance ← Penzance), 3 review, 0 distinct, 0 failed;
  `limit=100` → merged the 3rd Penzance variant into the survivor, 30 review, 0 distinct,
  0 failed. The Penzance cluster is fully consolidated as a **reversible tombstone**
  ("penzance management llc" survivor; the two "penzance" nodes → merged_into it). Evidence
  recorded (31 rows); load-bearing caches healthy post-merge (priority_queue 1,119,
  connected_value 3,049, buyer_spe 738). No wrong merges; every `distinct` conflict held.
- **Cron scheduled + active:** `lcc-owner-reconcile-engine` `50 6 * * *`
  (`?source=candidates&limit=100`) — a complete daily candidate sweep that self-converges as
  dups tombstone. Supporting crons active: `lcc-owner-evidence-cache-refresh` (:34 hourly),
  `lcc-owner-reconcile-seed` (06:20). The autonomous consolidation loop is closed.

**Moves B + C (SF-conflation autonomy) — DEPLOYED.**
- **C3 cleanup verified live:** persons carrying a `salesforce/Account` identity **559 → 0**
  (all detached, reversible backup + provenance kept); all **1,485** `salesforce/Contact`
  identities on persons preserved (they stay "connected"; priority queue unaffected). The
  systemic "Account-tagged-on-person" pattern is eliminated.
- **C1/C2 + B (JS, live):** new SF contact mints now name from the CONTACT (never the account),
  relate the person to the SF Account as a person→org EDGE (not an identity-on-person), and
  bind email-domain-authoritatively (agree → bind org [Capra→Boyd]; disagree → demote the
  wrong account [Dowling@boydwatterson.com on "Arbor Realty Trust" → Arbor demoted], else the
  `sf_contact_account_mismatch` lane as the true-ambiguity fallback). Forward behavior verifies
  on the next SF activity sync (no queued WhoIds to mint right now). SF write paths unchanged —
  minimum-necessary + gated; no SF cleanup/merge path.

**Now available (PR #1410 side-effect), previously deferred:** the B1 reconcile
(`owner-reconcile-tick`) and Tier A institution fan-out (`institution-contact-tick`) routes
are live and runnable — candidates for the next activation, plus seeding
`lcc_institution_contacts` with real sponsor contacts (Gardner Tannenbaum 30 SPEs, Blackstone,
Global Net Lease…) to fan a contact across each sponsor's contactless SPE portfolio.

## §10m — Tier A + B1 routes LIVE; both gate on seeding real sponsor contacts (2026-07-16)

**All three PR#1410 routes verified live (200):** `owner-reconcile-engine-tick` (Move A, now
cron'd), `institution-contact-tick` (Tier A fan-out), `owner-reconcile-tick` (B1 reconcile).
- **Tier A** `institution-contact-tick?limit=5` → `processed:0, attached:0` — clean no-op
  because `lcc_institution_contacts` is EMPTY (0 seeded). 2,682 sponsor gaps; 0 attachable.
- **B1** `owner-reconcile-tick?limit=5` → `processed:5, recorded:5, failed:0`, all 5
  `routed_to: resolve_parent_then_registry` — i.e. institutional owners waiting on the SAME
  gate: a curated sponsor contact in the registry.

**The gate is human input, not code.** The registry ships empty by design and contacts must be
REAL (never fabricated). Value-ranked seeding worklist (top sponsors — one contact fans across
all their contactless SPEs):
- **Fan-out champions:** Gardner Tannenbaum (**30 SPEs**, $12.2M), Blackstone (**8 SPEs**,
  $14.1M), Hana Asset Management (2 SPEs, $34.2M), Prologis (2).
- **Top single-SPE value:** Brandywine Realty Trust ($34.4M), Korea Investment ($34.3M),
  Hyundai Securities ($25.3M), Trammell Crow ($23.8M), World Bank ($23.4M), Foulger Pratt
  ($16.5M), The Shooshan Company ($15.6M), Blake Real Estate ($14.2M), Easterly Government
  Properties ($10.8M), STAG Industrial ($10.5M).
Seed mechanism: `INSERT INTO lcc_institution_contacts (institution_norm, contact_name, title,
email, phone, source, confidence)` (or a future Decision-Center lane). Once a sponsor has a
contact, `institution-contact-tick` fans it across every contactless SPE + seeds their cadences
automatically; B1's `resolve_parent_then_registry` owners resolve too. **Refinement noted:** a
few gap rows are SPE-names-as-sponsor ("Crystal Gateway 3 Owner LLC", "MEPT/FCP Patriots Plaza
LLC", "Sunflower Capital Partners or related individuals/entities") — the tier-0 resolver
occasionally carries an SPE/verbose string as the sponsor; filter SPE-shaped `sponsor_norm` from
the gaps as a cleanup (the top clean sponsors above are real).

**SF-conflation verification:** guards deployed; **0 new persons minted with a salesforce/Account
identity since deploy** (guard holding). Full behavioral proof (name-from-contact + person→org
edge + email-domain binding) exercises on the next SF activity sync — no WhoIds queued to mint
right now. The Boyd case already demonstrated the reconcile/no-dup + mismatch-lane behavior live.

## §10n — Salesforce "Lists" cracked = Campaigns/CampaignMembers; GSA Buyer exported + durable pipeline designed (2026-07-16)

Scott's SF prospecting/buyer/seller "Lists" (formerly "Groups", IS_Vision_GM app) are **standard
Salesforce Campaigns** in a hierarchy (`Team Briggs → Buyer Lists → GSA Buyer`; seller lists per
broker e.g. `JTS/KDL Seller Prospects`); members are **CampaignMembers** exposing First, Last,
Company, Email, Phone, City, State, CM Relationship, Team, Org Type. He can't export from the UI,
but the data is in the DOM (proven — a shadow-DOM scrape pulled all rows) AND the CampaignMember
API.
- **Immediate:** extracted **GSA Buyer = 156 members** via a shadow-DOM scrape (Lightning nests
  the table in shadow roots — a recursive `walk(shadowRoot)` reaches it) and generated
  `GSA_Buyer_list_156.csv` (downloaded to Scott's machine). Real repeat gov buyers (Nuveen, Ares,
  FD Stonewater, Easterly/"Government Investment Partners", Nationwide Postal, Elmtree, Postal
  Realty Trust, HC Government Realty Trust…) with emails + phones.
- **Durable pipeline → prompt `CLAUDECODE_PROMPT_ORE_sf_campaign_list_ingest.md`:** a PA "Get
  CampaignMembers" flow (direct fields — no relationship traversal needed) → new LCC route
  `?_route=sf-list-import` that reconciles each person by email (R39 dedup, no duplicates), names
  from the contact + relates to the company org (Unit-C guards), records list membership
  (product_type + buyer/seller + broker + status), and routes: **buyer** members → the P-BUYER
  buy-side contact pool; **seller** members → owner-prospect + (where the company is an
  institution-gap sponsor) **seed `lcc_institution_contacts`** — the real, non-fabricated
  registry seed the Tier A fan-out has been waiting for. Read-only, additive, reversible, ≤12
  api/*.js.

This turns Salesforce's own curated lists (the source for the quarterly CM sends + call lists)
into the LCC's outreach/resolution engine, and finally supplies the institution registry with
real sponsor contacts (the gate on Tier A / B1).
