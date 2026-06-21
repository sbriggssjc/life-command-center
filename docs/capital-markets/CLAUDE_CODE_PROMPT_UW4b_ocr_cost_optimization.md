# Claude Code prompt — UW#4b: OCR engine cost optimization (follow-up to UW#4)

> Follow-up to UW#4 (lease OCR), which is already in flight on `claude/happy-albattani-sf3len` /
> PR #1271. UW#4 built the tiered OCR foundation with a free local tier → **gpt-4o-vision** as the
> cloud escalation. A cost exploration (grounded 2026-06-20, sources below) found gpt-4o-vision is
> the **most expensive** OCR path by 6–14× and that purpose-built OCR is near-free at our volume.
> This prompt re-points the engine economics. Additive to UW#4's plumbing — same extractor, same
> guards, same confidence tagging; only the OCR ENGINE choices change.

## Grounded cost picture (corpus ≈ 860 scanned leases ≈ 15k–35k pages one-time)
| Tier | Engine | Corpus cost | Notes |
|---|---|---|---|
| Free (workstation) | Tesseract/ocrmypdf | $0 | what UW#4 wired; weak on lease rent-tables/exhibits |
| Free (workstation, **upgrade**) | **PaddleOCR / Surya** | $0 | beats Tesseract on tables/mixed layouts; Surya powers Marker PDF→md |
| Cheap cloud escalation | **Google Document AI** / Azure DI Read | **~$23–53** (or **$0** under Google's $300 new-account credit) | $1.50/1k pages |
| Current escalation | gpt-4o-vision | **~$150–500** | token-based; 6–14× the dedicated OCR APIs |

**Licenses we already pay for do NOT help (verified — don't re-litigate):** M365 Copilot has no
batch-OCR API (the Copilot/Graph/Work-IQ APIs are chat/retrieval/agents; Microsoft's OCR product is
Azure Document Intelligence, separately metered, not covered by the Copilot seat). Claude/ChatGPT
**subscriptions are billed separately from the API** — you cannot programmatically batch through a
chat seat. So automated OCR = either free OSS or a metered OCR API; there is no free ride via the
existing seats.

## Changes (scoped to the LEASE OCR path only)
1. **Free tier = the workhorse, upgraded.** Make the workstation free engine **PaddleOCR or Surya**
   (not Tesseract) for the lease drainer — markedly better on the rent schedules / exhibit tables in
   NNN leases, still $0. Keep Tesseract as a fallback if the better engine isn't installed.
2. **Cheap cloud as the escalation, not gpt-4o-vision.** Wire **Google Document AI (Enterprise OCR)
   or Azure DI Read** ($1.50/1k pp) into the cloud-escalation seam UW#4 already left, and make it the
   PREFERRED paid tier. **Do NOT make gpt-4o-vision the lease-OCR escalation default** — at this
   volume it's 6–14× pricier for no OCR-quality gain. Keep it only as an optional last-resort behind
   the same flag.
   - **Scope guard:** this changes ONLY the lease-OCR escalation. R58 uses gpt-4o-vision for other
     OCR (deeds, etc.) — leave those paths untouched; do not regress R58.
   - The cloud tier stays **feature-flagged** (deliberate, sized spend; `OCR_CLOUD_ESCALATION`),
     default zero-spend free-only until blessed. Document the Google $300-credit path (likely $0 for
     the whole backfill).
3. **Measure to size the spend.** The capped gate batch must report the **free-tier hit rate** so the
   escalation volume is known before any broad drain — if the free OSS engine clears most leases, the
   paid tail is trivial; if not, Document AI at ~$30 covers the rest.

## Boundaries / gate
- Engine swap only — the extractor, the four guards (location/draft/operator/multitenant),
  fill-blanks, provenance `source='folder_feed_lease'`, confidence tagging, and the workstation-drainer
  pattern are all unchanged from UW#4. No fabrication. Reversible. ≤12 api/*.js. No new always-on
  server dependency (OSS engine runs in the workstation drainer, same as UW#4).
- My gate: capped batch shows the OSS engine recovering text + filling escalation/guarantor/renewal,
  the free-tier hit rate measured, the cheap-cloud escalation wired + flagged (gpt-4o-vision no longer
  the lease default), R58's other OCR paths untouched, suite green. Then the broad drain is ~$0–$50.

## Sources
Azure DI pricing https://azure.microsoft.com/en-us/pricing/details/document-intelligence/ ·
Google Document AI pricing https://cloud.google.com/document-ai/pricing ·
OpenAI API pricing https://openai.com/api/pricing/ ·
M365 Copilot APIs https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/copilot-apis-overview ·
OSS OCR comparison https://modal.com/blog/8-top-open-source-ocr-models-compared
