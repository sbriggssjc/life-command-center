# Claude Code prompt — Contact-selection build: rank the right decision-maker per owner + pivot loop

> Implements `CONTACT_SELECTION_STANDARD.md` (rev. 2) — the doctrine for WHICH human to prospect
> per owner-company. Scott's rules: target the **decision-maker first** (deed/loan signatory →
> controlling role → economic owner → agent → fallback); the active contact is a **hypothesis
> that pivots** as research + outbound feedback arrive; **one active contact per company** unless
> a genuine partnership; **roles never conflated** (agent≠member≠manager≠trustee≠beneficiary).
> Read the standard first. Receipts-first; gated slices; capped; reversible; reuse the existing
> guards/machinery — do NOT fork.

## Grounding (measured live 2026-06-20)
- Owners live in LCC `entities` (bridged); the contact signals live in the DOMAIN DBs:
  - **Signatory/principal:** gov/dia `loans.sponsor` / `cmbs_sponsor` (have); `deed_records`
    = grantor/grantee **entity** names (human signer needs doc-parse enrichment).
  - **Controlling role:** `recorded_owners.manager_name` / `manager_role` /
    `registered_agent_name` / `registered_agent_address` — populated on only ~132 gov owners
    (LLC research deferred → SOS enrichment is the volume).
  - **Economic owner:** dia `true_owners.contact_1_name`/`contact_2_name`; residential
    registered/notice address → reverse-lookup (enrichment).
  - **Engaged/feedback:** `activity_events` (the now-live SF Task/Event ingest — referrals,
    replies, bounces, no-response).
  - **Captured/SF:** `external_identities(salesforce, Contact)`, person entities related to the
    owner (`entity_relationships`).
- The NBT engine already routes ~656 valued owners to **`next_action='acquire_contact'`**
  (`v_next_best_touchpoint`). This build resolves WHICH contact + the enrichment to get there.
- Reuse: `ensureEntityLink` (junk/operator/implausible-person guards), the R16/R20
  contact-acquisition worker, the OUTREACH#1 SF-activity ingest (feedback signals).

## Slice 1 — the ranked candidate bench + one active selection (read-only, GATE FIRST)
Build over EXISTING data only (no enrichment yet):
- **`v_owner_contact_candidates`** — per owner entity, one row per candidate human with:
  `authority_level` (1 signatory/sponsor → 2 controlling-role → 3 economic → 4 registered_agent →
  5 captured), `contact_role` (signatory/managing_member/manager/general_partner/officer/trustee/
  sponsor/member/limited_partner/beneficiary/registered_agent/sf_contact/engaged_responder),
  `contact_name`, `source` (loan_sponsor / recorded_owner_manager / true_owner_contact /
  sf_contact / activity_engaged / …), `is_named_individual`. **Reject-guard every candidate**
  (reuse `ensureEntityLink`'s junk/operator/implausible-person + the deal-string/broker filters)
  — never surface a deal-string, broker-attribution, or operator as an owner contact.
- **`v_owner_active_contact`** — the ONE active contact per owner = top by (authority_level,
  then the standard's tie-breakers: named-individual > cross-property recurrence > recency >
  title). Include `enrichment_action` = the action to reach a higher-authority contact when the
  top tier is empty (`parse_deed_signatory` / `sos_manager_lookup` / `address_reverse_lookup`),
  and a `partnership` flag (owner name has `&`/`and`/multiple surnames, JV, or multiple distinct
  managers → allow multiple active).
- **Gate (Slice 1):** spot-sample 15–20 valued owners — the active pick is the
  highest-authority real human available (sponsor/manager over agent over fallback), roles are
  not conflated, 0 junk/operator/broker selected, contactless owners carry the right
  `enrichment_action`, partnership owners flagged. Read-only.

## Slice 2 — pivot state + feedback re-ranking (after Slice 1 gates)
- **`owner_contact_pivot`** — per owner: `active_contact_id`, the bench, `confidence`,
  `pivot_history` (jsonb: reason + source + timestamp). Seeded from `v_owner_active_contact`.
- **Re-rank inputs:**
  - **Research (passive):** a cron that detects cross-property signer/manager recurrence (same
    individual across ≥2 of the owner's assets → promote/lock) and newer SOS/deed naming a
    different manager → pivot.
  - **Outbound feedback (active):** consume the SF-activity ingest — a **referral** ("talk to
    X") → pivot to X; **no-response** after N touches → pivot down the bench; **bounce/
    wrong-person** → demote+pivot; **positive/two-way** → lock (engaged_responder).
- Every pivot appends to `pivot_history` with its reason (provenance) — auditable + learnable.
- **Gate:** a synthetic referral / no-response / bounce each move the active contact correctly
  and log the reason; a cross-property repeat signer locks; reversible.

## Slice 3 — enrichment hooks (separate; the volume for the ~656 contactless)
Wire the `enrichment_action`s into workers (gated, capped, free-source-preferred per Scott):
`parse_deed_signatory` (signature block of the folder-feed-ingested deed/PSA), `sos_manager_lookup`
(free SOS-direct scraper over paid OpenCorporates), `address_reverse_lookup` (residential
registered address → principal). Each resolves a person → `ensureEntityLink` (guards) → attach to
the owner with its `contact_role` → updates the bench/active pick. Capped + gated + reversible.

## Wire into acquisition + provenance
- The NBT `acquire_contact` next-action resolves `v_owner_active_contact` (or runs its
  `enrichment_action`), attaches the person via `ensureEntityLink` with `contact_role`, links
  person→owner, sets active → the owner leaves `acquire_contact` and becomes reachable.
- Stamp every selected/attached contact: `contact_role`, `authority_level`, `contact_source`,
  `pivot_reason`. Default ONE active per owner; partnership flag allows multiple.

## My gate (per slice)
- S1: candidate bench + active pick correct (decision-maker authority order, roles distinct, 0
  junk/operator/broker, enrichment_action right, partnership flagged), read-only.
- S2: pivots fire on referral/no-response/bounce/recurrence with logged reasons; reversible.
- S3: enrichment attaches the right-role person, guarded, capped, reversible.

## Guardrails
- Receipts-first; gated slices (S1 read-only first); capped → gate → drain; reversible
  (provenance + pivot_history, never hard-delete a contact); reuse `ensureEntityLink` guards, the
  R16/R20 acquisition worker, the SF-activity ingest — do NOT fork. ≤12 api/*.js. Free
  SOS-direct enrichment over paid. Bump `?v=` if any contact-picker render changes.
- Net: every valued owner gets the **right decision-maker** as its prospect target, selected by a
  consistent standard and **pivoting intelligently** as research and outbound results come in —
  turning the ~656 contactless owners into reachable, correctly-targeted touchpoints.
