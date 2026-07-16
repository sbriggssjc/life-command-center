# Claude Code (LCC) — autonomous SF-conflation resolution: canonical-record binding + modeling guards

## Doctrine (Scott, 2026-07-16 — see `ORE_SF_AS_SOURCE_AUDIT_2026-07-16.md`)

**LCC is the source of truth; Salesforce is a useful but not highest-accuracy source** used by
hundreds of brokers with duplicates everywhere. **We do NOT clean or merge Salesforce** (not
our job; churn is constant). SF writes stay **minimum-necessary** (rules-of-engagement call
logging; deal/BOV tracking) — all already gated in the codebase, keep it that way. When SF
gives us duplicate/conflated/misfiled records for one party, the LCC must **robustly,
independently, resiliently** resolve it **on the LCC side** — consolidate the LCC duplicates,
and bind the **most-accurate** SF record to the LCC record, demoting the rest — with only
genuine ambiguity going to a Decision-Center lane. Eliminate the manual loop.

Grounded live: the email-tier reconcile (R39) already prevents SF dups from becoming LCC dups
(the SF Eric Dowling merged into the existing CoStar/RCA Dowling, no duplicate). The gap is
the **autonomous binding + modeling**, not dedup. Additive · reversible · guarded ·
never-fabricate · ≤12 api/*.js. dia/gov pipelines + all SF write paths unchanged.

## Unit C (do FIRST — cheap, prevents recurrence) — two modeling guards at the choke point
The Dowling conflation ("boyd watterson global" — a FIRM name — landed as the `canonical_name`
of the person Eric Dowling, and 559 person entities carry a raw `salesforce/Account` identity
instead of a relationship to the Boyd org). Fix at `defaultResolveOrCreateSfContact` /
`ensureEntityLink` (the mint choke point):

1. **Never let an SF account NAME overwrite a person's name.** When minting/reconciling an SF
   Contact, the person's `canonical_name` must come from the CONTACT name
   (`first`/`last`/`name`), never the `account_name`. On an email-reconcile ATTACH, do not
   overwrite an existing person name with the account name. (The bad "boyd watterson global on
   Eric Dowling" bleed came from an old capture; guard so no SF path can do it again.)
2. **Relate the person to the account as an ORG EDGE, not an Account-identity-on-the-person.**
   When an SF Contact carries an `AccountId`: resolve/create the Salesforce **Account as an
   `organization` entity** (it likely already exists — `external_identities salesforce/Account`
   on an org), and write a `works_at`/`associated_with` **relationship** person→org — instead
   of stamping `salesforce/Account` onto the person. Keep the account id in the person's
   `metadata.sf_account` for provenance. Result: Capra is a person *related to* Boyd, not a
   person *tagged as* Boyd (today `rel_count=0`).
3. **One-time reversible cleanup pass** for the existing 559: for each person carrying a
   `salesforce/Account` identity, if that account id resolves to an org entity, add the
   person→org edge and remove the `salesforce/Account` identity FROM THE PERSON (keep it on
   the org). Batch-tagged + reversible. Re-point/split the 1 org-named person (Dowling
   `74e0b0a3` → rename to "Eric Dowling", relate to a Boyd org) — or route it to the lane in
   Unit B if ambiguous. Never hard-delete.

## Unit B — extend the canonical-SF-record binding from owners to CONTACTS
`sf-link-reconcile.js` already does this for owner→**Account** (conflict = "entity has a
different SF Account, which is canonical?"; collision = "SF Account on two entities, merge?").
Generalize the same authority-ranked binding to SF **Contact** identities so the
`sf_contact_account_mismatch` / duplicate-contact cases resolve **autonomously** instead of
sitting as record-only verdicts:

1. **Canonical-record selection (authority order):** when one LCC person carries (or matches)
   multiple SF Contact/Account records, autonomously pick the most accurate and bind it;
   demote/detach the rest (LCC-side only — never touch SF). Authority: (a) SF account whose
   name/email-domain AGREES with the party's email domain > (b) most-recent SF activity > (c)
   most-complete record. Reuse the `lcc_signal_authority` weights + `sfIdsMatch`/`sf-id.js`.
   Example: Dowling's `@boydwatterson.com` on account "Arbor Realty Trust" → the account
   DISAGREES with the email domain → do NOT bind Arbor as his company; bind/relate him to the
   **Boyd** org (email-domain-authoritative), and record the Arbor link as demoted.
2. **Autonomous vs lane:** a CLEAR winner (one record agrees on domain/name, others don't →
   like Dowling) resolves autonomously and records the decision. A genuine TIE (equal-
   authority, no domain/name signal to break it) → the existing `sf_contact_account_mismatch`
   Decision-Center lane as the **fallback for true ambiguity only** (not the default path).
   Keep the lane; shrink its population to real ties.
3. **Feed the reconciliation engine:** an SF-sourced conflation that the engine (Unit A route,
   separate prompt) can resolve by weighted agreement should route there; this unit is the
   SF-specific binding policy that sits alongside it.

## SF writes — unchanged (explicit)
Do NOT add any SF write in this work. Call/activity logging, deal/BOV closing, and the gated
`contact-writeback` push stay exactly as-is. No SF merge/cleanup path — resolve in LCC.

## Verify (post-deploy, Cowork)
- **Unit C:** a fresh SF Contact mint creates a person named from the contact (never the
  account), and a person→org edge to the SF account (not an Account-identity-on-person). The
  559-cleanup pass converts identities→edges reversibly; the Dowling node is renamed/related,
  not left as "boyd watterson global".
- **Unit B:** re-running the Boyd case, Eric Dowling autonomously binds to the Boyd org
  (email-domain-authoritative) with the Arbor link demoted — no manual verdict needed; a
  genuine tie still lands in the lane.
- dia/gov + SF write paths untouched; ≤12 api/*.js; all changes reversible.

## Bottom line
Prevent the conflation at the mint (Unit C: contact-name-not-account-name; person→org edge),
then make the LCC autonomously bind the most-accurate SF record and demote the rest (Unit B:
extend the owner→Account binding to contacts, email-domain-authoritative), with the mismatch
lane as the true-ambiguity fallback. All LCC-side, SF stays read-mostly + minimum-necessary,
nothing fabricated, everything reversible — the LCC absorbs Salesforce's duplicates instead of
inheriting them.
