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
