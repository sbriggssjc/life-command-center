# Claude Code prompt — CONNECTIVITY #3: reconcile the two Salesforce link stores

> Remediation #3 from `CONNECTIVITY_GAP_AUDIT_2026-06-17.md`, now that the owner bridge (#1)
> and both owner-resolution passes (#2 dia, #4 gov) are live and the bridged owner universe is
> large. Goal: make the domain SF link (`true_owners`) and the LCC entity-graph SF link
> (`external_identities(salesforce, Account)`) agree — one canonical, BD-actionable SF link per
> owner. The independent gate has GROUNDED this live; the grounding changes the matching logic
> and the scope, so read it first. Receipts-first; gated; capped; reversible; surface ambiguity,
> never blind-write.

## Grounding (measured live 2026-06-18)
- **Two stores, different entity populations.** LCC `external_identities(salesforce, Account)`
  = 2,019 links (near 1:1, internally clean) but they sit MOSTLY on non-owner entities — of the
  bridged owner entities, only **92 dia + 66 gov (158 total) carry an SF Account link**. The
  domain DBs hold far more owner SF links that were never mirrored onto the bridged entity.
- **Domain stores (per-domain column names differ):**
  - dia `true_owners.salesforce_id` = 686 active — **but mixed object types: 326 Account
    (`001…`) + 360 Contact (`003…`)**. Only the Account ids belong in an Account reconciliation.
  - gov `true_owners.sf_account_id` = 442 active — **all Account (`001…`), clean.**
- **Id-length mismatch (critical):** domain ids are **15-char** (case-sensitive); LCC
  `external_id` is **18-char**. Match on `left(lcc_18,15) = domain_15` (case-sensitive) or
  convert 15→18 with the standard SF checksum — NOT raw equality (which would read every real
  match as a conflict).
- **Dup signal:** dia 686 with_sfid vs 685 distinct, gov 442 vs 413 distinct → a handful of SF
  ids appear on >1 true_owner (those owners are likely duplicates — a merge signal, not a link).

## Unit 0 — matching helper + classification (no writes)
- Add a small helper to normalize/compare a 15-char domain id to an 18-char LCC id
  (`left(id18,15)=id15`, case-sensitive) — one place, reused everywhere below.
- Classify every domain SF id by object prefix (`001`=Account, `003`=Contact, `00Q`=Lead, …).
  Only `001` Account ids flow into the Account reconciliation (Units 1-2). Report the class
  counts.

## Unit 1 — Account backfill: mirror domain Account links onto the bridged owner entity (the win)
For each domain true_owner that (a) carries an **Account** (`001…`) SF id, (b) is bridged
(has an `external_identities(<domain>, true_owner)` → LCC entity), and (c) whose entity has **no**
`external_identities(salesforce, Account)` link:
- **Collision check FIRST.** If that Account id (15→18 normalized) is ALREADY attached to a
  **different** entity in LCC → do NOT add a second link and do NOT blind-merge. Surface the
  pair (owner entity ↔ the SF-linked entity) as a **merge candidate** (reuse the canonical-twin
  / `v_lcc_merge_candidates` Decision Center lane) — same owner, two entities.
- **Else attach** the SF Account identity to the owner entity via the EXISTING
  `ensureEntityLink` SF-identity path (do NOT hand-roll an insert) — `source_system='salesforce',
  source_type='Account'`, with provenance noting the domain origin. Reversible batch tag.
- **Capped (25) → gate → drain.** This is the actionable slice — ~768 Account ids (gov 442 +
  dia 326) minus those already linked (158) / colliding; expect a few hundred owners become
  SF-actionable.

## Unit 2 — conflicts → Decision Center (no auto-overwrite)
Where a bridged owner entity ALREADY has an SF Account link that **disagrees** with the domain
Account id (after 15↔18 normalization): surface to the Decision Center as an
`sf_link_conflict` (≤158 to check, likely far fewer). The human picks the canonical; never
auto-overwrite either store. `keep_current` / `accept_domain` / `research` verdicts ride the
existing verdict machinery.

## Unit 3 — surface (don't auto-fix) the remaining classes
- **dia Contact ids (360):** these are SF **Contact** references mis-carried in `salesforce_id`,
  NOT Account links. Do NOT force them into the Account store. Either (a) reconcile to
  `external_identities(salesforce, Contact)` if that store is used for person links, or (b) flag
  as a data-quality class (the dia field conflates Account+Contact) for a separate pass. Pick
  the lighter, document the choice — this is a distinct sub-job, fine to defer.
- **Dup SF id → owner merge signal:** the SF ids that appear on >1 true_owner → surface those
  owners as merge candidates (same SF account = same owner). Surface, don't auto-merge.

## My gate (read-only, per pass)
- **Unit 0/1 capped 25:** matches use 15↔18 normalization (no false conflicts); only Account
  (`001`) ids attached; collisions correctly routed to the merge lane (not double-linked, not
  blind-merged); attaches went through `ensureEntityLink` (canonical writer), reversible tag +
  provenance; nothing overwritten.
- **Drain:** the bridged-owner SF-link count rises materially (toward gov 442 + dia 326 minus
  collisions/conflicts); spot-sample the attached SF accounts genuinely belong to that owner;
  0 Contact ids leaked into the Account store.
- **Units 2-3:** conflicts + collisions + dup-sfid + dia-Contact classes are SURFACED to the
  Decision Center (counts reconcile to the grounding), none auto-resolved.

## Guardrails
- Receipts-first; capped → gate → drain; reversible (batch tag); fill-blanks only — never
  overwrite an existing SF link, never blind-merge, never force a Contact id into the Account
  store. Reuse `ensureEntityLink` (SF-identity writer), the Decision Center merge/verdict lanes,
  the 15↔18 helper (one place). ≤12 api/*.js. Bump `?v=` if any Decision Center render changes.
- **Out of scope (documented):** populating SF links for owners with NO domain SF id (that's
  the connector-gated SF-link backfill / live SF lookup — a separate, connector-dependent job);
  `lcc_canonical_entity_id` (#5); orphan/cms cleanup (#6).
- Net: the ~768 owner SF links the domain already knows but the BD graph couldn't see become
  one canonical, actionable link per owner — turning bridged owners into routable BD targets,
  with every ambiguous case surfaced for human judgment rather than guessed.
