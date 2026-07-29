# Offer-submission — delivery + logging legs (code changes + PA/SF instructions)

_2026-07-29. Wires the last legs of the skill: **log** (done, DB), **draft to Drafts** (code + PA), **file-back**
(PA), **SF offer log** (PA/SF), **per-listing economics capture** (code + SF). 🤖 = built/deliverable; 🧑 = you._

## Already built & live (DB)
- ✅ **`lcc_offer_context(deal)`** — the context assembler (returns seller, economics, docs, gaps).
- ✅ **`lcc_log_offer(deal, offer jsonb)`** — the logging leg: writes the activity_event, the review To-Do (due on
  expiration), and enqueues the SF `create_task`. Verified on Snellville (To-Do due 2026-07-31). Idempotent.

---

## Code changes for you to merge (🧑 Railway deploy)

### A. Expose `lcc_log_offer` as a tool/route (mirror the offer-context pattern from DEPLOY-1.1)
```js
// mcp/offer-context.js — add a second route next to the offer-context `get`:
export function makeOfferLogRoute({ opsQuery }) {
  async function post(req, res) {
    const b = req.body || {};
    const deal = b.deal || req.query.deal;
    const offer = b.offer || {};                      // the extracted LOI terms (jsonb)
    if (!deal) return res.status(400).json({ ok:false, error:'deal_required' });
    const r = await opsQuery('POST', 'rpc/lcc_log_offer', { p_deal:String(deal), p_offer:offer });
    if (!r.ok) return res.status(502).json({ ok:false, error:`rpc_failed_${r.status}`, detail:r.data });
    return res.status(200).json(Array.isArray(r.data) ? r.data[0] : r.data);
  }
  return { post };
}
```
```js
// mcp/server.js — import, instantiate, mount (next to __offerCtx):
import { makeOfferContextRoute, makeOfferLogRoute } from "./offer-context.js";
const __offerLog = makeOfferLogRoute({ opsQuery });
app.post("/api/pipeline/offer-log", authenticate, __offerLog.post);

// MCP tool (optional; the skill can also call it via the proxy):
//   name 'log_offer', inputSchema { deal:string, offer:object } → opsQuery('POST','rpc/lcc_log_offer',{p_deal,p_offer})
```
```js
// server.js (root proxy) — one line with the other /api/pipeline/* proxies:
app.all('/api/pipeline/offer-log', (req,res)=>{ req.query._mcpTarget='/api/pipeline/offer-log'; aiReadHandler(req,res); });
```

### B. `api/_shared/outlook-draft.js` — add **Bcc** (Sarah Martin) support
```js
// in createOutlookDraftViaPA(draft): accept draft.bcc, normalize, and include it in the POST body.
const bcc = Array.isArray(draft.bcc) ? draft.bcc : (draft.bcc ? [draft.bcc] : []);
// ...in the payload object sent to PA_OUTLOOK_DRAFT_URL, add:
    bcc: bcc.join(';'),
```
The skill then calls: `createOutlookDraftViaPA({ to, bcc:'smartin@northmarq.com', subject, body_html,
attachment_url, attachment_name })` (CC James Gibson only on DaVita/Genesis deals).

**Attachment (the LOI):** the flow attaches from `attachment_url`. The skill stages the received LOI PDF to
Supabase Storage via the existing `intake-salesforce-files?action=upload-url` → signed URL, and passes that as
`attachment_url` + `attachment_name:'Signed LOI <deal>.pdf'`. (No public exposure — a short-lived signed URL the
flow fetches server-side.)

### C. `mcp/opportunity-sync.js` — capture listing economics + seller at `listing_signed`
When a synced deal is a signed listing, persist the OM/listing economics + seller onto the deal record so
`lcc_offer_context` fills without a manual OM:
```js
// in normalizeDeal / the row builder, when stage indicates a signed listing, merge into metadata:
metadata: {
  ...existing,
  listing: { ask_price: d.Asking_Price__c, noi: d.In_Place_NOI__c, ask_cap: d.Cap_Rate__c,
             rsf: d.Building_SF__c, tenant: d.Tenant__c, guarantor: d.Guarantor__c,
             lease: d.Lease_Summary__c, source:'SF listing', captured_at: <syncDate> },
  seller:  { of_record: d.Seller_of_Record__c, contact_name: d.Seller_Contact__c,
             contact_email: d.Seller_Contact_Email__c, source:'SF listing', captured_at: <syncDate> }
}
```
Field API names above are placeholders — map to your actual SF listing fields (see SF step below). Until wired, 🤖
seeds the deal record from the OM (as done for Snellville).

---

## Power Automate / Salesforce changes (🧑 your tenant)

### PA-1 — `LCC Create Outlook Draft` flow: add Bcc + attach the LOI
The flow uses **`CreateDraftMessageV3`** (creates a **draft** in the Drafts folder — correct, no send). Today it
has To/Cc/Subject/Body/Importance and ignores the attachment. Changes:
1. **Trigger schema:** add a `bcc` property (string) alongside `cc`.
2. **Attachment fetch:** add a **Condition** `attachment_url is not empty`; in **If yes**, an **HTTP GET**
   `@{triggerBody()?['attachment_url']}` (returns the PDF bytes).
3. **`CreateDraftMessageV3`:** add **`emailMessage/Bcc`** = `@{triggerBody()?['bcc']}`; and add
   **`emailMessage/Attachments`** = a single item:
   `Name = @{triggerBody()?['attachment_name']}`,
   `ContentBytes = @{body('HTTP_Get_Attachment')?['$content']}` (or `base64(body('HTTP_Get_Attachment'))`).
   Leave Importance = High. (It stays a **draft** — nothing sends.)
4. Keep the `Check_Shared_Secret` gate.

### PA-2 — Deal-folder file-back flow (new, or reuse the `Http → Create file` plumbing)
Purpose: save the submission + the LOI into the property's **Team Briggs – Documents** deal folder.
- **Trigger:** HTTP Request, schema `{ folder_path, filename, content_url | content_base64 }`.
- **Actions:** (fetch bytes if `content_url`) → **SharePoint "Create file"** into
  `@{triggerBody()?['folder_path']}` with `@{triggerBody()?['filename']}` and the bytes. (ShareFile variant if you
  prefer.) Return the item web URL.
- Set the flow's trigger URL as engine env **`PA_DEALFOLDER_FILE_URL`**; the skill posts the submission HTML +
  the LOI to it after the draft is created.

### PA-3 — SF offer log: handle the `create_task` from `sf_sync_queue`
`lcc_log_offer` enqueues `kind:'create_task'` with `{deal_entity_id, subject, body, status_note, offer}`. In the
**LCC → SF Queue Drainer**, ensure the `create_task` branch:
- resolves `deal_entity_id` → the SF Opportunity Id (existing entity→SF resolution), sets the Task **WhatId** to it;
- creates an SF **Task**: Subject = payload `subject`, Description = payload `body`, Status "Completed" or "Open"
  per your convention. (If you'd rather move the Opportunity to an "Offer Received" stage, switch the enqueue to
  `advance_opportunity_stage` — tell me and I'll change the function.)

### SF-1 — Listing economics/seller fields (so capture is automatic, not hand-seeded)
Add the listing economics + seller to the **SF → LCC Opportunity Sync** Select Query so they ride into the deal
record (§C): asking price, in-place NOI, cap rate, building SF, tenant, guarantor, lease summary, seller-of-record,
seller contact + email. Tell me the exact SF field API names on your listing object and I'll finalize the
`opportunity-sync.js` mapping (you have no SF admin, so we use existing fields — no schema change).

### ENV (engine, Railway)
- `PA_OUTLOOK_DRAFT_URL` — the Create Outlook Draft flow trigger URL (likely already set; confirm).
- `PA_DEALFOLDER_FILE_URL` — the new file-back flow trigger URL (PA-2).
- `FOLDER_FEED_ENRICH_ROOTS` — the Team Briggs PROPERTIES bucket (from DEPLOY 2.2).

---

## End-to-end after these land
LOI arrives → skill calls `get_offer_context` → builds the branded email → stages the LOI (signed URL) →
`createOutlookDraftViaPA({to, bcc, …, attachment_url})` drops a **draft in Drafts with the LOI attached** →
posts the submission + LOI to `PA_DEALFOLDER_FILE_URL` (**filed** to the deal folder) → `lcc_log_offer` (**logged**:
activity + To-Do + SF task). You review and send; strategy stays on the call. Snellville is already logged and its
context is complete except the folder-indexed OM (DEPLOY 2.2).
