# Prompt 98 — W9.1 Stage 1: contact-acquisition engine (internal stages of the sanctioned chain)

**Grounding:** `docs/audits/W9_CONNECTEDNESS_KICKOFF.md` (W9.1 — the last Wave 9 unit; the lever
on the 68-73% no-contact gap), `OWNERSHIP_RESEARCH_FREE_FIRST_PLAN.md` + the sanctioned chain
doctrine (cross-reference resolver → SOS-direct → address reverse-lookup → deed; web-search proxy
STAYS PAUSED), `v_owner_contact_worklist` / `owner_contact_pivot`, the fsp source ladder (SOS/deed
sources already ranked), and the full W8/W9 house pattern. **STAGED: this prompt is Stage 1 —
internal sources only, no external fetches.** Stage 2 (SOS-direct via non-datacenter egress) is a
separate prompt pending Scott's infrastructure decision.

## The engine

**Pool:** true owners with NO contact row (dia 4,825 / gov 11,922), value-ranked (worklist
rank_value — the $14M owner before the $200k one). Per owner, run the acquisition stages in cost
order, stopping at first success; every stage emits PROPOSALS (never direct writes), all landing
in the EXISTING owner-contact confirm surfaces.

**Stage 1a — cross-reference resolver (deterministic, cheap):** the same human/org may already
have a contact row under a DIFFERENT owner entity (the resolver's merge maps, canonical-name
matches across dia↔gov↔ops, `cross_domain_contacts`, institution contacts for the REIT/fund
class). Propose ATTACH-existing-contact-to-owner (an association, not a mint) with the
cross-reference evidence. Institution-class owners (REITs, banks — match against
`lcc_institution_contacts`) are the fast wins.

**Stage 1b — deed mining (deterministic + LLM-verbatim):** deed records carry signatory names,
notary blocks, and mailing addresses for the grantee — the owner's own filings name their people.
Deterministic: grantee mailing address → owner address fill (fill-blanks). LLM arm (U3's verbatim
pattern): signatory/officer names from deed text ("...by John Smith, Managing Member") → propose
CREATE-contact (name + role + verbatim quote + deed pointer), lane-only mint. Reuse the W5.1
party-extraction machinery where it fits (GLiNER channel A exists).

**Stage 1c — intake/OM broker-of-record (deterministic):** the listing broker on the OM that SOLD
the owner their building knows them — propose the broker as an ASSOCIATED research contact
(explicitly typed `broker_of_record`, never conflated with the owner's own people; fills the
"who can I ask" gap when no direct contact exists).

## Mechanics (house pattern, no exceptions)

Tick `/api/contact-acquisition-tick` (GET dry-run `?score=1&n=`, POST flag-gated), flag
`W9_1_CONTACT_ACQUISITION` OFF in-migration, nightly cron staggered after the chain (~4:55 UTC),
windowed+cursored pool walk (the 92-class shared guard applies), per-stage counts + loud errors,
budget floors, batched lookups. Proposals → the owner-contact worklist/lane surfaces (extend
before forking; 75 guard if a new lane is unavoidable). fsp rows for any new source spellings
in-migration (deed/SOS classes exist — verify, don't duplicate). Reversible ledgers. Metric:
% of top-100-value no-contact owners with a proposal generated / accepted (feeds U4 + the W9.5
coverage view). Stage-2 seam: the stage runner takes a pluggable stage list so SOS-direct slots in
later without rework.

## Tests

Stage-order/stop-at-success, attach-vs-mint routing, verbatim validator on deed quotes,
broker_of_record typing guard (never a direct owner contact), cursor walk, read-only-until-verdict
structural guard.

## Acceptance

- Dry-run: per-stage yield counts on the top-value pool + a sampled sheet (attach proposals with
  cross-reference evidence; deed mints with verbatim quotes; brokers typed correctly). Honest
  zeros where sources are thin.
- Scott reviews → Cowork flips. ROLLOUT_STATUS W9.1 row (Stage 1); kickoff status; prompt to done/.

Commit with the repo Co-Authored-By + Claude-Session trailer.
