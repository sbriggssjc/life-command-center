# Work-Product Templates — Deal Documents (Word, chat-draftable)

The four Briggs / Northmarq deal documents, all built parameter-driven on the
shared `northmarq_letter` base (Dialysis `src/northmarq_letter.py`) and drafted
from one deal-data merge schema (`merge_schema.json`, framework §3a):

| Doc | Built in (W2) | Notes |
|---|---|---|
| Buyer LOI | `src/deal_docs.py` | salient-terms letter; rebranded off Stan Johnson Company → Northmarq |
| Seller Response Form | `src/deal_docs.py` | same salient-terms template, seller's counter perspective |
| NDA | `src/deal_docs.py` | confidentiality agreement; Provider via Broker (Northmarq) |
| Valuation Analysis Memo | `src/deal_docs.py` | conclusions → methods → buyer-type → 4-phase marketing |

## Conventions

- **One merge schema → all four.** Chat fills the deal context once; every doc
  drafts from it.
- **Shared letter grammar.** Letterhead → date → addressee → `RE:` subject →
  body → Scott Briggs / Northmarq signature, brand-consistent with the Excel set.
- **0 residual Stan Johnson Company branding** — the W2 gate asserts this on
  every rendered doc (`northmarq_letter.assert_no_legacy_branding`).

The original SJC-branded LOI / Seller Response / NDA source docx are not in this
repo clone; W2 authors clean Northmarq versions from the framework's structural
spec (so there is no SJC text to begin with). Drop the originals here if a
verbatim clause-by-clause carryover is wanted later.
