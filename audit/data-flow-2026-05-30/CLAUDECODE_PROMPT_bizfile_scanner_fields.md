# Claude Code (LCC extension) — CA bizfile SOS parser, anchored to the real detail-modal DOM

The Option-B SOS capture loop is **confirmed working end to end** (Linchao LLC wrote
`recorded_owners` + an `sos_sidebar` observation). But the CA bizfileonline auto-grab is broken
two ways, both now root-caused with the real DOM:

1. **Wrong region.** The generic `findValue` heuristic in `extension/content/public-records.js`
   reads the whole page and matched the **search RESULTS grid** (a table of "626 …" entities)
   instead of the open entity **detail modal**. Symptom: capturing "626 L Street LLC" pulled
   "626 16TH STREET, LLC" (row 1 of the results) and `Agent Address = "Click to expand,
   07/30/2020 Active Limited Liability Company - CA…"` (raw results-table cell text).
2. **Loose label matching.** "Registered Agent" matched "Standing - Agent: Good" instead of the
   real "Agent" row.

## The real detail-modal DOM (captured live from bizfile, 626 L Street LLC)

The detail card is a clean table, class **`details-list`**, one `tr.detail` per field with a
`td.label` and a `td.value`:

```html
<table class="details-list container-fluid"><tbody>
  <tr class="detail"><td class="label">Initial Filing Date</td><td class="value">04/18/2019</td></tr>
  <tr class="detail"><td class="label">Status</td><td class="value">Active</td></tr>
  <tr class="detail"><td class="label">Standing - SOS</td><td class="value">Good</td></tr>
  <tr class="detail"><td class="label">Standing - FTB</td><td class="value">Good</td></tr>
  <tr class="detail"><td class="label">Standing - Agent</td><td class="value">Good</td></tr>
  <tr class="detail"><td class="label">Standing - VCFCF</td><td class="value">Good</td></tr>
  <tr class="detail"><td class="label">Formed In</td><td class="value">CALIFORNIA</td></tr>
  <tr class="detail"><td class="label">Entity Type</td><td class="value">Limited Liability Company - CA</td></tr>
  <tr class="detail"><td class="label">Principal Address</td><td class="value">626 L STREET\nCHULA VISTA, CA 91910</td></tr>
  <tr class="detail"><td class="label">Mailing Address</td><td class="value">740 BAY BLVD\nCHULA VISTA,CA91910</td></tr>
  <tr class="detail"><td class="label">Statement of Info Due Date</td><td class="value">04/30/2027</td></tr>
  <tr class="detail"><td class="label">Agent</td><td class="value">1505 Corporation\nLEGALZOOM.COM, INC.\n</td></tr>
  <tr class="detail"><td class="label">CA Registered Corporate (1505) Agent Authorized Employee(s)</td>
      <td class="value">SANDRA MENJIVAR \n500 N BRAND BLVD, SUITE 890, GLENDALE, CA\nJesse Camarena \n500 N BRAND BLVD…\n…</td></tr>
</tbody></table>
```

## The parser (host = `bizfileonline.sos.ca.gov`)

Add a bizfile-specific extraction path in `public-records.js`. Select the detail modal
explicitly — **`document.querySelector('table.details-list')`** — NOT the results grid. Walk
`tr.detail`, read `td.label` → `td.value` into a map, then map by exact label:

| bizfile label | form field |
|---|---|
| `Initial Filing Date` | formation_date |
| `Status` | status |
| `Formed In` | jurisdiction / state_of_formation |
| `Entity Type` | entity_type |
| `Principal Address` | principal_address (split the `\n` into street / city-state-zip) |
| `Mailing Address` | mailing_address |
| `Agent` | registered_agent (here: "1505 Corporation / LEGALZOOM.COM, INC.") |
| `CA Registered Corporate (1505) Agent Authorized Employee(s)` | officers / agent_authorized_employees (name + address per person; multi-line) |
| `Standing - *` | **IGNORE** (status flags, never agent/name) |

- **Entity name + number** are NOT in `table.details-list` — they're in the modal **title**
  (the brown header, e.g. `626 L STREET LLC (201911310222)`). Target that heading element for
  `entity_name` + `filing_number`/`entity_number`. If its selector is uncertain, fall back to
  the worklist's active owner name (the panel already shows "CAPTURING FOR: <name>") for
  entity_name and leave the number blank — do NOT pull it from the results grid.
- **Registered-agent-service note:** for many LLCs the `Agent` is a commercial service
  (LegalZoom / CT Corporation / 1505 Corporation) and the "Authorized Employee(s)" are the
  service's staff, NOT the owner's people. Capture them as-is (agent = the service; officers =
  the listed employees) but do not treat them as the owner's decision-maker. (Surfacing "agent is
  a service → real manager needs the Statement of Information" is a later enrichment concern, not
  this parser.)
- Keep the **`Standing -` exclusion** as a global guard so no SOS site can populate agent/name
  fields from a standing flag.

Everything downstream is unchanged: the parsed fields pre-fill the editable form (operator can
still correct), Save posts to `/api/sos-writeback`.

## Fixture + test

Commit the captured DOM above as a fixture (`extension/` test fixtures) and add a unit test that
parses it and asserts: entity via title/fallback; formation `04/18/2019`; status `Active`;
jurisdiction `CALIFORNIA`; principal `626 L STREET, CHULA VISTA, CA 91910`; mailing `740 BAY
BLVD, CHULA VISTA, CA 91910`; agent `1505 Corporation / LEGALZOOM.COM, INC.`; officers = the 5
authorized employees; and that **no field equals "Good"** and **no field contains results-grid
text**.

## Boundaries

Extension only (`content/public-records.js` + a fixture/test) · select `table.details-list`
explicitly (never the results grid) · exact-label map + `Standing -` guard · the editable form
stays · SCAN_PAGE → loadOrgView → sos-writeback unchanged · ships on unpacked-reload.

## Verify

1. `node --check` + the fixture unit test green.
2. Re-scan 626 L Street LLC's bizfile detail → form auto-fills correctly (entity `626 L STREET
   LLC`, formation `04/18/2019`, jurisdiction `CALIFORNIA`, principal `626 L Street…`, mailing
   `740 Bay Blvd…`, agent `1505 Corporation / LegalZoom`, officers = the 5 employees), Registered
   Agent is NEVER `Good`, and NO field shows another entity's data.
3. Re-scan Linchao LLC (agent `KAI HUNG LIN`) to confirm it works for an individual-agent entity too.
4. Save → `recorded_owners` + LCC observations reflect the correct values.

## Context

Final data-quality fix on the working Option-B SOS capture. The plumbing is proven live; this
anchors the CA bizfile parse to its real DOM so the auto-grab is correct and the operator clicks
through instead of retyping. `table.details-list` + `td.label`/`td.value` is bizfile's structure;
other states differ, but the same anchor-to-the-detail-container + exact-label approach extends
to Sunbiz/etc. as they're worked.
