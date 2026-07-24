# Claude Code (LCC extension) — fix the CA bizfile field extraction so the SOS capture auto-populates correctly

The Option-B SOS capture loop is **confirmed working end to end** (a real Linchao LLC capture
wrote `recorded_owners` + an `sos_sidebar` address observation). But the auto-grab from CA
bizfileonline (`bizfileonline.sos.ca.gov`) mis-maps the fields — the generic `findValue`
heuristic in `extension/content/public-records.js` grabs the wrong rows. Operator wants the form
auto-populated correctly (editing every field defeats the "rapid click-through" goal).

## The observed mis-maps (real Linchao LLC capture, 2026-07-24)

| Form field | Scanner grabbed | Correct value | Why it's wrong |
|---|---|---|---|
| Entity Name | `entity number` | `LINCHAO LLC` | grabbed a label, not the modal title |
| Filing Number | (blank) | `201022910090` | in the modal title `LINCHAO LLC (201022910090)` |
| Registered Agent | `Good` | `KAI HUNG LIN` | matched **"Standing - Agent: Good"** (label contains "Agent") instead of the real **"Agent"** row |
| Agent Address | (blank) | `1369 BENTLEY CT, WEST COVINA, CA 91791` | the Agent row's address wasn't parsed |
| Jurisdiction / State of Formation | (blank) | `CALIFORNIA` | it's the **"Formed In"** row |
| Officers / Managers / Members | `1369 BENTLEY CT…` (address) | the manager/officer name | grabbed the address block |
| Status | `Active` | `Active` | ✅ correct |
| Formation Date | `08/16/2010` | `08/16/2010` | ✅ correct |
| Principal / Mailing Address | `1369 BENTLEY CT…` | `1369 BENTLEY CT, WEST COVINA, CA 91791` | ✅ correct |

## The bizfile detail-modal label structure (ground truth from the live record)

bizfile renders the entity detail as a modal with a title + a clean label→value list:

```
  Title:  LINCHAO LLC (201022910090)          ← entity name + filing/entity number
  Initial Filing Date   08/16/2010
  Status                Active
  Standing - SOS        Good
  Standing - FTB        Good
  Standing - Agent      Good                    ← NOT the registered agent — a standing flag
  Standing - VCFCF      Good
  Formed In             CALIFORNIA              ← jurisdiction / state of formation
  Entity Type           Limited Liability Company - CA
  Principal Address     1369 BENTLEY CT, WEST COVINA, CA 91791
  Mailing Address       1369 BENTLEY CT, WEST COVINA, CA 91791
  Statement of Info Due Date  08/31/2026
  Agent                 Individual                ← the REAL registered agent block
                        KAI HUNG LIN
                        1369 BENTLEY CT, WEST COVINA, CA 91791
```

## The fix — a targeted bizfile parser (don't rely on the generic heuristic)

In `public-records.js`, when the page host is `bizfileonline.sos.ca.gov` (CA SOS), use a
bizfile-specific extraction path instead of the generic label matcher:

- **Entity name + number:** from the modal title `NAME (NUMBER)` → `entity_name` = NAME,
  `filing_number`/`entity_number` = NUMBER.
- **Registered agent:** read the standalone **"Agent"** row (exact label `Agent`, NOT any label
  starting with `Standing`). Its value is an `Individual`/`Corporation` line, then the agent NAME
  line, then the agent ADDRESS lines → `registered_agent` = the name (KAI HUNG LIN),
  `agent_address` = the address block. **Explicitly exclude any label beginning with `Standing`**
  from agent/name matching — that's the false match that produced "Good".
- **Jurisdiction / state of formation:** the **"Formed In"** row → `CALIFORNIA`.
- **Principal / Mailing address:** the "Principal Address" / "Mailing Address" rows (already
  working — keep).
- **Status:** "Status" row (already working — keep).
- **Formation date:** "Initial Filing Date" (already working — keep).
- **Officers / Managers / Members:** bizfile's basic detail modal does NOT list members
  separately (only the agent) — so leave officers blank rather than mis-filling it with the
  address. (The manager may require the "Statement of Information" PDF, out of scope; blank-but-
  editable is correct here.)

Guard the generic heuristic so a `Standing - *` label can never populate the agent/officer/name
fields on ANY SOS site (defense-in-depth for the next state too).

## Precise selectors

The label text above is reliable, but the exact DOM (how bizfile marks up each label/value pair
+ the Agent sub-block) determines the selectors. If the label-text approach doesn't cleanly parse
the multi-line Agent block, **ask Scott to capture the detail modal's `outerHTML`** (right-click
the modal → Inspect → right-click the modal's root element → Copy → Copy outerHTML) and commit it
as a fixture under `extension/` test fixtures, then parse against that real DOM. Don't guess the
sub-block structure — anchor it to a captured fixture.

## Boundaries

Extension only (`content/public-records.js`) · a bizfile-host-specific parser path + a global
`Standing -` exclusion guard · the editable form stays (auto-grab pre-fills, operator can still
correct) · the SCAN_PAGE → loadOrgView → sos-writeback flow is unchanged · ships on
unpacked-reload.

## Verify

1. `node --check extension/content/public-records.js`.
2. Re-scan the Linchao LLC bizfile record → the form auto-fills: Entity Name `LINCHAO LLC`,
   Filing Number `201022910090`, Registered Agent `KAI HUNG LIN`, Agent Address `1369 Bentley
   Ct…`, Jurisdiction `CALIFORNIA`, Status `Active`, Formation `08/16/2010`, Principal Address
   `1369 Bentley Ct…` — Registered Agent is NEVER `Good`.
3. Save → `recorded_owners` gets `registered_agent_name = KAI HUNG LIN` (not "Good"),
   `manager_name` not an address; the LCC observations capture principal + agent addresses as
   distinct rows.
4. Spot-check on a second CA entity to confirm it's not Linchao-specific.

## Context

Final data-quality polish on the now-working Option-B SOS capture. The plumbing is proven live;
this makes the auto-grab actually correct on CA bizfile so the operator clicks through instead of
retyping. Each state's SOS has a different layout — CA bizfile is the first; the same
label-anchored approach (+ the `Standing -` guard) extends to Sunbiz/others as they're worked.
Also note: the Linchao test capture created a second `recorded_owners` row (a pre-existing
`sos_registry` Linchao row with manager "Amanda Lin" already existed) — the owner-reconcile
engine handles the dup by name; not part of this fix.
