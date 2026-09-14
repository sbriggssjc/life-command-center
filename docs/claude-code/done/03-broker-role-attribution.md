# Prompt 03 — Broker / role attribution (our role authoritative)
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/living-deal-dossier-and-systems-connection.md` §3; property 35724
- Response file: `../responses/03-broker-role-attribution.response.md`

## Prompt (copy/paste to Claude Code)
```
For Northmarq deals (is_northmarq true), reconcile the broker-of-record so our own role is authoritative. Today
property 35724's only broker contact is Chris Bodnar/CBRE (source costar_sidebar) even though is_northmarq is
sell-side. Add logic so a Northmarq sell-side deal captures the Team Briggs listing broker from our SF/roster as
the listing broker, records CoStar's third-party broker separately (co-broker/counterparty or "as-reported"),
and surfaces a Conflict (party_extract_disagreements) when the third-party feed disagrees with our own role.
Verify 35724 shows Team Briggs as the sell-side broker with CBRE recorded as the as-reported/third-party view.
```

## Verify
35724's listing broker resolves to the Team Briggs broker; the CBRE/CoStar attribution is retained separately as
as-reported; a disagreement is logged rather than silently overwritten.
