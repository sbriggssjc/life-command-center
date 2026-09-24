# GOV-CLASSIFY1 — sidebar saves of government properties already in the gov DB fail "no_domain"

Backlog: `GOV-CLASSIFY1`. Source: Scott, 2026-09-23, 2 screenshots ("Promote failed — no_domain. Rescan the page and retry."). Measured by Cowork.

## Measured

**Case 1: 601 5th St, Jellico TN 37762** (CoStar 11589499). LCC entity `d0210db5-506e-4b6f-bc30-763056d93ee6`.
- Two runs, both `failed`, `no_domain`. Classifier diag: `matchedPattern: "none"`, `hasPdfTexts: false`, and the search text is only "imported from costar 601 5th st office john c davenport geoff ficke …". No tenant was captured (saved from the Contacts tab).
- The side panel's own document list names **"OM_State of TN DHS - Jellico, TN"** three times, and one of those OMs is already `Staged (review_required)`.
- **Gov already has this property:** `properties` **16334** `601 5th St, Jellico TN`, agency **Tennessee Department of Human Services**, `government_type=State`.

**Case 2: 49870 State Highway 139, Tulelake CA 96134** (CoStar 18667760). LCC entity `e2a7ab46-6a80-46c4-a4e8-0149f269f186`.
- `no_domain`. The tenant **"Us Ranger Station"** was captured, and the industry field reads "Agriculture, Forestry, Fishing and Hunting". The legal description (visible in the panel) reads "DOUBLEHEAD DISTRICT OFFICE", a Forest Service ranger district.
- **Gov already has it:** **16268** `49870 Ca-139, Tulelake CA`, agency "US Government", Federal. The panel even says "Found in LCC database".
- `Ca-139` vs `State Highway 139` didn't reconcile.

## Ask

1. **Existing-record first.** Before any text pattern, the classifier asks whether this address, or its CoStar id / parcel, already resolves to a dia or gov domain property. If yes, that is the domain. Use the existing address matcher, including the SIDEBAR3-c directional folding and the GOV-AVAIL1 civic-number guard. Don't write a new matcher.
2. **Route equivalences in address matching:** `CA-139` / `Ca 139` / `State Highway 139` / `State Hwy 139` / `SR-139` / `Hwy 139`, generalised to state-route forms for all states, plus `US-2` / `US Highway 2` (the Malta MT twins). Test them.
3. **Pattern gaps:**
   - Federal land-management occupants (ranger station, ranger district, Forest Service, BLM, NPS, USFWS);
   - state agencies ("State of <X>", "<State> Department of …", "DHS" when the state context is present).
   Read the existing gov pattern list first, and extend that list rather than adding a parallel one.
4. **Document titles as evidence.** Captured document titles (`document_links[].title`, e.g. "OM_State of TN DHS - Jellico, TN") join the classifier's search text.
5. **Re-run both entities** after the fix, and confirm they link to gov 16334 / 16268 without minting new properties. Grep the last 30 days of `no_domain` failures, report how many the fix would now classify, and re-run those.
6. Tests: each case above, plus "existing gov record wins over a dia pattern hit" and the reverse. Each needs a mutation that turns it red.

## Done means

- Backlog updated.
- Deploy = redeploy BOTH Railway services.
- Scott re-saves one of the two pages. (SIDEBAR5 made the extension 1.0.58, which needs a reload.)
