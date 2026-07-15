# Claude Code (LCC) — broaden SF contact ingestion + email-based reconciliation + surface SF account/email disagreements

## Why (grounded live 2026-07-15 — see `ORE_REALIGNMENT_first_principles_2026-07-15.md` §10)

Verified in the northmarqcapital Salesforce org: two Boyd Watterson decision-makers we have
extensive email/call history with are **in Salesforce but never reached LCC** — not a
duplicate bug, a **contact-sync SCOPE gap**:
- **Joseph Capra** — SF Contact on account **"Boyd Watterson Asset Management LLC"** (a
  Boyd account NOT mapped in LCC), `jcapra@boydwatterson.com`, recent activity — **absent
  from LCC**.
- **Eric Dowling** — SF Contact **misfiled under account "Arbor Realty Trust"** (his email
  is `edowling@boydwatterson.com`), `(312) 777-3704` — LCC has him only from **CoStar/RCA**,
  with no salesforce identity. The @boydwatterson.com email on an Arbor account is a
  **Salesforce-side data-quality error**.

The 9 Boyd contacts that DID sync sit on the *mapped* Boyd accounts. So the sync pulls
contacts on **LCC-mapped accounts only** — a decision-maker on an unmapped or misfiled
account never flows, even with recent activity. This round widens the net + reconciles by
email + surfaces the SF disagreements — **all on the LCC side; no Salesforce writes.**

### Doctrine constraints (Scott, 2026-07-15 — §10/§10b)
- **LCC is the source of truth; Salesforce is minimum-necessary.** Do NOT try to clean or
  dedupe the shared SF org. LCC **absorbs** the SF duplicates/errors and reconciles around
  them. No outbound SF contact/account writes here.
- **Never fabricate a contact.** Only ingest what SF/Outlook/CoStar actually hold.
- Reuse the built machinery: `sf-activity-ingest.js`, `contact-attach.js`,
  `ensureEntityLink` (email-key tier — R39), the weighted reconciliation engine
  (`lcc_reconcile_owner` / `lcc_signal_authority`, email weight 55), `external_identities`.
  Additive · reversible · guarded · ≤12 api/*.js.

## Unit 1 — broaden the SF contact ingest scope (beyond exact account-mapping)
Today LCC gets SF contacts via account-mapped `find_contacts_by_account` + activity WhoId.
Widen the pull so a decision-maker isn't missed for being on an unmapped/misfiled account:
- **(a) Activity-referenced contacts (WhoId):** ensure the SF-activity ingest
  (`sf-activity-ingest.js`) **creates/links the contact entity + a `salesforce/Contact`
  external identity for the WhoId on every synced task/event** (Capra/Dowling have recent
  activity — this alone should catch them). Grounding refined: confirm whether the current
  path only *counts* activity vs actually minting the contact entity; if it doesn't mint,
  that's the primary fix.
- **(b) Email-domain / owner-company scope:** pull SF contacts whose email domain or
  account reconciles to a **tracked owner/company** in LCC (not just the exactly account-
  mapped set) — via the PA "find contacts" flow widened to accept a company-name / email-
  domain scope, or a periodic pull of contacts on accounts that fuzzy-match a tracked entity.
- The PA-flow side (the SF query scope) is the egress dependency — spec it like
  `find_contacts_by_account` (feature-flagged; no-op cleanly until the flow is wired). No SF
  writes — read-only pull.

## Unit 2 — reconcile the ingested SF contact by EMAIL (merge, don't duplicate)
Every ingested SF contact routes through `ensureEntityLink`'s **email-resolution tier
(R39)** so it attaches to the EXISTING person by email instead of minting a new one:
- The SF **Eric Dowling** (`edowling@boydwatterson.com`) must resolve to the **CoStar/RCA
  Eric Dowling** (same email) → ONE entity carrying `costar/contact` + `rca/contact` +
  `salesforce/Contact`. Verify the email tier fires for an SF-sourced contact (it already
  does for org email-key; confirm person path).
- Where email is absent, fall to the weighted reconciler (name-core + phone + company).
  Phone is a signal too (Dowling's (312) 777-3704 appears in both CoStar and SF).
- **Never create a second person for an email we already hold.** This is the anti-dup
  guarantee on the LCC side (SF-side dups are tolerated per doctrine).

## Unit 3 — surface SF account/email disagreements as a Decision Center signal
The reconciliation payoff: an `@boydwatterson.com` email on an **"Arbor Realty Trust"**
account is a signal-disagreement LCC should FLAG (not inherit):
- Add a lightweight detector: an SF contact whose **email domain contradicts its SF account
  name** (email-domain org-token vs account-name org-token disagree, both non-generic) →
  emit a Decision-Center row (`sf_contact_account_mismatch`, list-federated, value-ranked)
  with the contact, the SF account, the email domain, and the LCC-reconciled company.
- Verdicts (record-only / no SF write): `confirm_lcc_company` (trust the email-domain
  company in LCC, leave SF as-is), `research`, `dismiss`. LCC records the truth internally;
  SF cleanup (if any) is the operator's separate manual step. This makes LCC the layer that
  *detects* SF data-quality errors without depending on SF being clean.

## Unit 4 — Outlook as a first-class contact/enrichment source (§10)
Extend the same ingest+reconcile path to **Outlook** (Microsoft Graph, via a PA/Graph flow —
the SHAREPOINT_FETCH_URL webhook pattern; feature-flagged, no-op until wired):
- Pull Outlook **contacts** + the **email/call correspondence signal** (who we email/call,
  how often, latest touch) and route through `ensureEntityLink` (email tier) → reconcile to
  the same person entity. Our extensive email history with Capra/Dowling becomes the
  enrichment + a real-activity signal (ties into the R24 activity → cadence path).
- Bidirectional search/enrich: an LCC contact missing an email/phone gets it from the
  matched Outlook contact; an Outlook-only contact known from correspondence is captured +
  reconciled by email/name — closing the "learn from every source" loop (§10).
- Outlook contact identity = a new `external_identities` source (`outlook`/`Contact`);
  reconcile, never duplicate. Read-only; no writes back to Outlook.

## Boundaries / verify
- LCC-Opps orchestration + the SF/Outlook PA-flow egress specs (read-only; feature-flagged).
  No Salesforce/Outlook writes. Additive · reversible · provenance-tagged · guarded · never
  fabricate · ≤12 api/*.js. dia/gov pipelines untouched.
- **Verify (post-wire):** (a) after the widened SF pull, **Joseph Capra** appears in LCC
  linked to Boyd with `salesforce/Contact`; **Eric Dowling**'s SF identity **merges by email
  into the existing CoStar/RCA Dowling** (one entity, three source identities) — no dup; (b)
  the `sf_contact_account_mismatch` lane surfaces the Dowling-on-Arbor disagreement; (c) an
  Outlook contact with prior email history reconciles by email into the same person and
  enriches a missing phone/email. Spot-check Capra + Dowling end-to-end.

## Bottom line
The two contacts we couldn't find were in Salesforce all along — on an unmapped and a
misfiled account. Widen the SF contact ingest beyond exact account-mapping, reconcile every
ingested contact by email so the SF and CoStar Dowling become one (never a duplicate),
surface the SF account/email disagreement as a Decision-Center signal (LCC detects SF's
errors instead of inheriting them), and bring Outlook in as a first-class source — all on
the LCC side, no SF writes, LCC as the source of truth.
