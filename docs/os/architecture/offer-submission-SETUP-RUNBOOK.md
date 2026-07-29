# Offer-Submission — Manual / Human Setup Runbook

_2026-07-29. Everything a human must wire so the `offer-submission` skill runs self-serve from any chat surface —
what, where, when, who. 🤖 = Claude/DB-drivable (mostly done); 🧑 = you (deploy/PA/SF/SharePoint/decision).
Legend for **When**: **Once** (one-time infra), **Per-listing** (at listing-signing), **Per-offer** (each LOI)._

## Status at a glance
- ✅ **Done (live):** `lcc_offer_context(deal)` assembler; Snellville deal record seeded (economics + seller);
  Frank Meyrath contact enriched; the skill drafted; design + catalog updated.
- 🧑 **Needs you:** the deploy + PA/SharePoint/SF wiring below. Nothing auto-sends or auto-files until these land.

---

## 1. Engine deploys (🧑 Scott — Railway; code I specced, can't deploy from here)
| # | Piece | Where | When | Notes |
|---|---|---|---|---|
| 1.1 | **Expose `lcc_offer_context` as an MCP tool** + root proxy route | `mcp/server.js` (tool def) + `server.js` (`app.all('/api/pipeline/offer-context', … aiReadHandler)`) | Once, before any surface calls the skill | The one call the skill makes. Reads params from `req.query` **and** `req.body` (proxy drops the query string). |
| 1.2 | **Attribution intake change** (optional, related) | `api/intake.js` thread `mailbox_owner` → promoter `actor_id = lcc_actor_for_mailbox(...)` | When you want per-broker attribution | Spec in `actor-attribution-phase1.md`. Not required for offer-submission. |

## 2. Power Automate flows (🧑 Scott — your tenant)
| # | Piece | Where | When | Notes |
|---|---|---|---|---|
| 2.1 | **Save-to-Drafts delivery** | `LCC Create Outlook Draft` (Outlook connector) | Once | Must create a **draft in the Drafts folder** with the branded HTML body, resolved recipient (To/BCC), High importance, and the **buyer's LOI PDF attached**. Never send. The skill calls this. |
| 2.2 | **Index the deal-document folder** | Folder-feed crawl → `sharepoint_documents` (SharePoint connector) | Once (+ ongoing) | Point the crawl at **Team Briggs – Documents** so each listing's OM/lease/PSA is indexed and linked to the deal entity (`property_entity_id`). Closes the `documents_missing` gap so the skill links the OM automatically. |
| 2.3 | **File the submission back to the deal folder** | PA/Graph write → SharePoint / ShareFile | Once | On draft/send, save the submission + LOI to the property's deal folder (same place the OM lives). |
| 2.4 | **Offer → Salesforce log** | `LCC → SF Queue Drainer` | Once | Write the SF offer record "Offer Received — Pending Seller Response" (property, buyer, broker, price/cap, terms, date). |

## 3. Salesforce (🧑 Scott — no admin; use existing fields / PA sync)
| # | Piece | Where | When | Notes |
|---|---|---|---|---|
| 3.1 | **Capture listing economics** (ask, in-place NOI, ask cap, lease) on the SF listing | SF listing record / PA sync → `bd_opportunities.metadata.listing` | Per-listing (at signing) | So the deal record self-populates instead of a hand-seed. Until wired, 🤖 can seed from the OM (as done for Snellville). |
| 3.2 | **Capture seller-of-record + seller contact** | SF listing / owner record → `bd_opportunities.metadata.seller` | Per-listing | Makes seller resolution deterministic. Snellville seeded from the correspondence graph; going forward capture at signing. |

## 4. Data / ingestion hygiene (🤖 + 🧑 confirm)
| # | Piece | Where | When | Notes |
|---|---|---|---|---|
| 4.1 | **Seed each active listing's deal record** (economics + seller) | 🤖 OM extraction + `bd_opportunities.metadata` | Per-listing | One-time backfill for current live listings; then automatic via 3.1/3.2. |
| 4.2 | **Entity dedup: RCG Ventures** (4 duplicate entities) + link **Frank Meyrath → RCG** | 🤖 `reconcile_entity` + owner-contact edge; 🧑 confirm canonical | Once (cleanup) | Low-risk merge of 0-activity duplicate orgs; deal record already carries the authoritative seller, so not blocking. |
| 4.3 | **Confirm the title-holding LLC** for each listing (the specific "RCG-___ Owner LLC") | 🧑 from title/PSA | Before the **Seller Response** counter | The submission uses "RCG Ventures, LLC" (how Frank signs); the counter's legal seller-of-record needs the exact LLC. |
| 4.4 | **Correspondence → deal linkage** | 🤖 the assembler bridges by city today; reconcile can attach threads to the deal | Ongoing | Not blocking — the assembler already surfaces the seller across fragmented (person) timelines. |

## 5. Decisions / confirmations (🧑 Scott)
| # | Decision | When | Current default |
|---|---|---|---|
| 5.1 | **CC rule** — is `CC James Gibson` DaVita/Genesis-only, or broader? | Before broad rollout | DaVita/Genesis-owned only; RCG-owned Snellville had no CC. |
| 5.2 | **Signature/office** standard | Done | Tulsa block (918.794.9787). |
| 5.3 | **Escrow** default | Standing | First American Title, Denver (Annie Arnwine); buyer-designated alt = flagged conflict. |

## 6. Skill install & surface parity (🧑 Scott)
| # | Piece | Where | When | Notes |
|---|---|---|---|---|
| 6.1 | **Install the skill** | Claude skill/plugin set (`offer-submission-SKILL.md`) | Once | Makes it invocable in Cowork/Claude. |
| 6.2 | **Register on other surfaces** | `docs/os/surfaces/*.canon.md` (ChatGPT, Copilot) | Once | Same command + output contract so any chat delivers identical output (draft + file + log). |

---

## The self-serve end state (what "done" looks like)
An LOI lands → any chat runs `offer-submission` → `lcc_offer_context` returns the deal, seller (RCG/Meyrath),
economics, and the linked OM → the skill builds the branded submission → **draft in Drafts** (LOI attached) →
**filed to the deal folder** → **logged in the LCC + SF** with the expiration as a critical date. The only human
acts left are the ones that should stay human: **reviewing and sending the draft**, and the **verbal response
strategy** with the seller. Today Snellville is at: context ✅ deterministic, economics ✅ on the deal, seller ✅
resolved, documents ⏳ (wire 2.2), delivery/file/log ⏳ (wire 1.1 + 2.1–2.4).
