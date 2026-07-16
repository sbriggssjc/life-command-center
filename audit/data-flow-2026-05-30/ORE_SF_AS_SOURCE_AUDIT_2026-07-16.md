# Salesforce-as-a-source: how the LCC handles SF conflation/duplicates today, and where to align

**Grounded live 2026-07-16 (LCC Opps `xengecqvemvfknjvbvrq` + repo).** Scott's directive:
LCC is the primary holder of truth; Salesforce is a *useful but not highest-accuracy* source
used by hundreds of brokers; **we do NOT clean Salesforce** (churn is constant, dups are
everywhere, it's not our job); SF writes are **minimum-necessary only** (rules-of-engagement
call logging — enough to show prospecting a group, not enough to expose specific ownership;
what's required for BOV/deal tracking); and the LCC should **robustly, independently,
resiliently** either consolidate/merge the duplicate records *in the LCC* or bind the *most
accurate* SF record to the LCC record — eliminating the manual loop.

## Headline: the doctrine is already ~80% built into the design. The gap is that the
## autonomous resolution layer is **gated off**, so it currently leans on manual verdicts.

### 1. SF WRITE surface — already minimum-necessary + gated (aligned ✓)
The LCC writes to Salesforce in only four narrow, deliberate places, and never to "clean" it:
- **Call/activity Task logging** — `createSalesforceTask` (operations.js log_call/log_activity,
  admin.js) + `complete_sf_task` / `log_to_sf` / `update_sf_task` (sync.js). This is exactly
  the "log just enough to show we're prospecting" requirement. Feature-flagged
  (`SF_LOOKUP_WEBHOOK_URL`).
- **Deal/BOV closing** — `sf-deal-closing.js` writes buyer/seller account ids on a close.
- **Contact writeback (push net-new)** — `contact-writeback.js` (R52) is the ONLY
  LCC→SF contact/account push, and it is **GATED OFF by default** (`SF_CONTACT_WRITEBACK`
  env), value-ranked, and email-reconciled so it never pushes a duplicate.
- The `bridges.js salesforce.*.upsert` handlers are **INBOUND** (SF crawl → LCC entities via
  `findEntityForUpsert`+`linkSalesforce`), not SF writes.

**Conclusion:** we are not cleaning/merging Salesforce, and the one push path is gated. No
change needed here except to keep it that way. (On "can we merge SF records from LCC?" — we
technically *could* add a PA flow calling SF's merge API, but the doctrine is deliberately
**don't** — resolve in the LCC instead. Recommend we never build the SF-merge path.)

### 2. DETECTION surface — the pieces exist; most are narrow or gated
- **Email-tier reconcile in `ensureEntityLink` (R39)** — the workhorse. It already **prevents
  SF duplicates from ever creating LCC duplicates**: when an SF contact carries an email we
  already hold, it ATTACHES to the existing person instead of minting a new one. This is why
  the SF Eric Dowling merged into the existing CoStar/RCA Dowling with **no duplicate**. ✓
- **`sf_contact_account_mismatch` lane** — fires when an SF contact's email-domain contradicts
  its SF account name (Dowling's `boydwatterson.com` on "Arbor Realty Trust"). **Only 4 open** —
  a narrow slice, and **record-only** (verdicts: confirm_lcc_company / research / dismiss — no
  consolidation).
- **`sf-link-reconcile`** — owner→SF-Account link **conflicts** ("this entity already has a
  different SF Account — which is canonical?") and **collisions** ("this SF Account is on two
  entities — merge?") → Decision Center. This is the closest thing to "bind the accurate SF
  record," but it's owner→Account only and routes to manual verdicts.
- **`v_lcc_person_email_merge_candidates` (218)** / **`v_lcc_merge_candidates`** — dup persons
  by email / dup orgs. Different problem (two records same party) than person/firm conflation.
- **The weighted reconciliation engine `lcc_reconcile_owner`** (email 55 / phone 45 / name-core
  40 / address 50 / SF-account 80 …, threshold 60) — the thing purpose-built to triangulate
  same-party from every signal — **has 0 evidence rows and its drain cron is commented out
  (gated off).** It is not autonomously running.

### 3. The actual conflation scope is SMALL (the Dowling case is nearly unique)
Live counts:
- **559 person entities carry a `salesforce/Account` identity** (all 559 also carry a
  `salesforce/Contact`) — the Capra/Dowling signature. But of those, **only 1** has an
  org-shaped name and **0** share their Account id with an org entity. So the "person named
  like a firm" true conflation (Dowling → "boyd watterson global") is **essentially a one-off**,
  not a systemic mess. The other 558 are legitimate people who simply carry their SF `AccountId`
  as an identity.
- **This is a MODELING choice, not corrupt data.** `defaultResolveOrCreateSfContact` records
  the contact's `AccountId` as a `salesforce/Account` external-identity **on the person**
  (plus in metadata). Two consequences: (a) the SF account is stored as an identity on the
  person rather than as an org entity the person is *related to* (Capra has `rel_count=0` — no
  graph edge to Boyd); (b) in the rare bad case, the SF **account name** bled onto the person
  record's name ("boyd watterson global" on Eric Dowling's node) because the pre-existing
  record was an RCA capture that mixed firm+person.

### 4. RESOLUTION surface — autonomous-capable, but the SF-conflation path is manual
- `lcc_merge_entity` (person+org complete since R39/R40) — can consolidate autonomously.
- R39 person-email **auto-merge** (name-compatible slice) + R64 **auto-resolve**
  `sf_link_collision` (same normalized name) — these DO run autonomously, but only the
  high-confidence same-name slice.
- Everything else → **Decision Center manual verdicts**. The weighted reconciliation engine
  that would auto-consolidate the ambiguous middle is **gated off**.

## The alignment (what to change to meet "robust, independent, resilient, eliminate manual")

The machinery exists; the work is to **turn on and wire the autonomous layer for SF
conflation**, keeping SF writes exactly as minimum-necessary as they are now. Four moves,
each additive/reversible/gated-first:

**A. Turn on the weighted reconciliation engine (it's built + verified conservative).**
Run the gated capped drain (`GET owner-reconcile-engine-tick?min_value=… → POST …?limit=25`),
confirm the same-party merges are correct case-dups (it already holds records apart on a
high-authority conflict — e.g. two *different* SF accounts → never merge), then schedule
`lcc-owner-reconcile-engine` (the commented cron in migration `20260716141000`). This makes
the LCC autonomously consolidate SF-and-other duplicates by weighted signal agreement
(email/phone/name-core/address), with only genuine ambiguity going to a lane.

**B. A canonical-SF-record binding policy (the "reassign the most accurate SF record" ask).**
When SF gives us multiple/conflated records for one LCC party, autonomously bind the
**most-accurate** SF identity to the LCC record and demote the rest — LCC-side only, never
touching SF. Authority order: SF account whose name/domain agrees with the party > most-recent
SF activity > most-complete record. Extend the `sf-link-reconcile` policy (which already does
this for owner→Account) to contact identities, so the mismatch/collision cases resolve
autonomously instead of sitting as manual verdicts. Genuine ties still fall to the Decision
Center — but as the exception, not the default.

**C. Modeling guard so the Dowling case can't recur (and clean the 559 pattern intentionally).**
Two small rules at the choke point (`ensureEntityLink` / `defaultResolveOrCreateSfContact`):
(1) **never let an SF account NAME overwrite a person's name** (the "boyd watterson global on
Eric Dowling" bleed); (2) when a `salesforce/Account` identity is stamped on a person, if that
account already exists as an **org entity**, record a `works_at`/`associated_with` **edge** to
it instead of (or in addition to) the raw identity — so the graph relates the person to Boyd
rather than tagging the person *as* Boyd. Decide whether to keep the account-identity-on-person
at all, or migrate the 558 to edges (a one-time, reversible pass).

**D. Keep the mismatch/collision Decision-Center lanes as the *fallback* for true ambiguity**
(the small residual after A+B), not the primary path — and keep every SF write minimum-necessary
and gated (no SF cleanup, ever).

## Bottom line
The design already honors the doctrine on the write side (minimum-necessary, gated, never
cleans SF) and on the dup-prevention side (email-tier reconcile stops SF dups from becoming
LCC dups). The one real gap vs "robust, independent, resilient, no manual loop" is that the
**autonomous consolidation/binding layer is gated off**, so SF conflation currently waits for a
human verdict. Turning on the reconciliation engine (A), extending the canonical-SF-record
binding to contacts (B), and adding the two modeling guards (C) makes the LCC autonomously
absorb SF's duplicates/errors — resolving in the LCC, binding the best SF record, and touching
Salesforce only the minimum the rules of engagement require. The Dowling conflation itself is
nearly a one-off (1 of 559), so this is alignment + activation, not a large new build.
