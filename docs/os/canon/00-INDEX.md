# Canon Index & Invariants

**CANON_VERSION: 1.0.0** — 2026-07-24. Bump this on any rule change; record it in the changelog below and
run `../SURFACE-SYNC-PROTOCOL.md`.

## Global invariants (apply to every topic, every surface)
1. **Single-source; bind, don't fork.** Rules live here; surfaces render them, never re-author them.
2. **Same engine everywhere.** Comps/BOV/context come from the LCC engines (`mcp/`+`api/`); MCP and HTTP
   return identical JSON. Never substitute a surface-local answer.
3. **Email/comms route through LCC only** — `DraftOutreachEmail`/`DraftSellerUpdateEmail` (Power Automate →
   Outlook draft). Never Work IQ or any native M365 connector for email.
4. **Confirmation tiers.** Tier 0 read · Tier 1 lightweight · Tier 2/3 explicit `user_confirmed: true`
   (`WRITE_SURFACE_POLICY.md`).
5. **Memory is Cortex, write-gated.** After any material action or stated preference, log a one-line
   conversational memory. `log_memory` is Claude/MCP-only (never HTTP).
6. **Target the OWNER, not the tenant**, in all BD/outreach.
7. **System-of-record.** Gov/Dia read via LCC proxy only; canonical writes through audited paths.

## Handler modules (the topic canon)
| Module | Covers |
|---|---|
| `comps.md` | Pulling/synthesizing/exporting sales & lease comps |
| `filing.md` | Saving/reading/updating documents in Team Briggs SharePoint |
| `email-and-routing.md` | Outreach/seller-update drafting + inbound ingestion→classify→route |
| `logging-and-touchpoints.md` | Logging calls/touchpoints + BD cadence targets |
| `writing-voice.md` | How written deliverables sound and are formatted |
| `bov.md` | BOV / valuation-memo / pro-forma generation and the lease-terms-first rule |
| `intake-triage.md` | Staged intake triage + classification taxonomy |
| `personal.md` | Personal-life domains and how they bind to the same OS |

## Handler template (copy this to add a new module)
```md
# <Topic> Canon
Canon: v<X.Y.Z>
## Purpose
## Triggers            (what user asks that invokes this)
## Inputs              (what's needed; where it comes from)
## Procedure           (the exact steps / tools, in order)
## Output contract     (what's returned; format; invariants)
## Never               (hard prohibitions)
## Surface bindings    (which surface artifact renders this — see SURFACE-SYNC-PROTOCOL.md)
## Extension notes     (how to grow this without forking)
```

## Changelog
- **1.0.0** (2026-07-24) — Initial canon: comps, filing, email-and-routing, logging-and-touchpoints,
  writing-voice, bov, intake-triage, personal. Distilled from `docs/copilot/agent-instructions.md`,
  `SURFACE_CAPABILITY_PARITY.md`, the Cowork skills, and `lcc_intelligent_operating_system_v2.md`.
