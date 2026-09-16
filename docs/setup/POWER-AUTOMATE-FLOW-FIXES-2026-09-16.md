# Power Automate — the seven flow fixes from FLOWS1, step by step

**For:** Scott, in the Power Automate portal. **From:** the FLOWS1 diagnosis (2026-09-16; 17 run
screenshots in `docs/claude-code/SB notes/done/Failed flows.docx`; response in
`docs/claude-code/responses/done/FLOWS1-…response.md`). **Tracked in:** `docs/claude-code/OPERATOR-CHECKLIST.md`
rows F1–F7. Tick each row there when done; forward next week's "flows have failed" digest into
`SB notes/` so the counts can be checked.

**Where:** https://make.powerautomate.com → environment **NorthMarq Capital, LLC** (top right) →
**My flows** → open the flow → **Edit** (pencil, top right). Every edit below is in the designer. Save
with the **Save** button (top right) and use **Test → Manually** where a test is suggested.

Ordering by impact: F1 (709/wk) → F2 (41) → F5 (35) → F4 (7) → F3 (6) → F6 (6) → F7 (1).

---

## F1 — Http → Get file (LCC Get Artifact) — 709 failures/week

**What fails.** `Response` (the last action) fails every time with *"The template language function
'body' cannot be used when the referenced action outputs body has large aggregated partial content …
only … actions that support chunked transfer mode."* `Get file content using path` (SharePoint) itself
succeeds in 16–24 s. It is the same large file every 30 minutes (two LCC crons re-ask; that side is
backlog `FLOWS1-crons`).

**Fix, option A (try first — 2 minutes).**
1. Open the flow → Edit. Click the **`Get file content using path`** action → **⋯ (three dots) → Settings**.
2. Find **Content transfer** → set **Allow chunking** to **On** → Done.
3. Click the **`Response`** action → **⋯ → Settings**. If it also shows **Allow chunking**, turn it **On**.
4. Save. **Test → Manually** with the same request LCC sends (the trigger's sample payload is in the
   run history: open a failed run → click **manual** → *Show raw inputs* → copy the body).
5. If the test run succeeds, done. If `Response` still fails with the same message, do option B.

**Fix, option B (the durable one — 10 minutes).** Do not send the bytes through `Response` at all;
send LCC a link and let it download from SharePoint directly.
1. After `Get file content using path`, click **+ New step** → search **SharePoint** → choose
   **Get file metadata using path**. Site Address = same as the get-content action; File Path =
   the same expression the get-content action uses (open that action, copy its *File Path* field).
2. Edit `Response`: **Status code** `200`; **Headers** `Content-Type` = `application/json`;
   **Body** =
   ```
   {
     "name": @{body('Get_file_metadata_using_path')?['Name']},
     "size": @{body('Get_file_metadata_using_path')?['Size']},
     "link": @{body('Get_file_metadata_using_path')?['{Link}']},
     "path": @{body('Get_file_metadata_using_path')?['{FullPath}']}
   }
   ```
   (Type these via **Add dynamic content** rather than pasting, so the designer resolves the
   action name — it will show as *Name*, *Size*, *Link to item*, *Full Path* under the metadata step.)
3. Delete nothing else. Save and test as in A.4.
4. Tell Cowork it is option B: LCC's caller (`lcc-document-text` / `lcc-cre-doc-text-backfill`) then
   needs a small change to fetch from the link instead of reading the body — that becomes part of
   `FLOWS1-crons`, and it also gives LCC the file **size** so it can stop asking for files the flow
   cannot serve.

**Verify.** Next digest: Get Artifact drops from ~700 to near 0. Any remaining failures will be a
different error text — screenshot one.

---

## F2 — LCC – Outlook Intake to Teams (Hardened) — 41/week

**What fails.** `HTTP GetEmailWebLink` (Office 365 Outlook → *Send an HTTP request*,
`GET https://graph.microsoft.com/v1.0/me/messages/{id}`) returns **NotFound** right after
`HTTP PostIntakeMessage` (the LCC call) succeeds in 17–24 s. Cause: LCC's intake, before it even
returns, posts a "processing complete" event to the **Processing Complete → Move Message** flow, which
moves the mail to *Processed/…*; a moved message has a new id, so the web-link fetch by the old id
fails. (LCC will also defer that emit — backlog `FLOWS1-order` — but the flow should not depend on
timing.)

**Fix — reorder (3 minutes).**
1. Open the flow → Edit. Find **`HTTP GetEmailWebLink`** (second step in the screenshots) and
   **`HTTP PostIntakeMessage`** (first).
2. Drag **`HTTP GetEmailWebLink`** *above* **`HTTP PostIntakeMessage`** (drag by the action's title
   bar; drop when the insertion line shows above PostIntakeMessage). It only needs the trigger's
   message id, so nothing it reads changes.
3. Click **`HTTP PostIntakeMessage`** → confirm its inputs still resolve (any reference to
   `body('HTTP_GetEmailWebLink')?['webLink']` will now resolve *earlier*, which is what we want).
4. Safety net: click **`HTTP GetEmailWebLink`** → **⋯ → Configure run after** — leave as is; then
   click the step *after* it (`HTTP PostIntakeMessage`) → **⋯ → Configure run after** → tick
   **is successful** *and* **has failed** → Done. That way a genuine 404 on the link never fails the
   intake itself.
5. Save. Test by flagging one message in Outlook (the trigger is *When an email is flagged*).

**Verify.** Next digest: 41 → ~0. The Teams card should still carry the *Open in Outlook* link.

---

## F3 — LCC Flagged Email Intake — 6/week

**What fails.** `Get email (V2)` right after the trigger `When an email is flagged (V3)` returns
**NotFound** — the same race as F2, one step earlier (the message was moved/unflagged before the
flow read it).

**Fix — retry then continue (3 minutes).**
1. Open the flow → Edit → click **`Get email (V2)`** → **⋯ → Settings**.
2. **Retry Policy** → **Exponential Interval**; Count `3`; Interval `PT20S` → Done.
3. Click the next action (**`Initialize variable`**) → **⋯ → Configure run after** → tick **is
   successful** and **has failed** → Done.
4. Inside the flow there is a **Condition** further down; make sure the "message missing" branch
   ends in **Terminate → Status: Cancelled** (add it if the branch is empty: **+ Add an action →
   Terminate**, Status *Cancelled*, Message `message not found after retries`). A cancelled run does
   not count as a failure in the digest.
5. Save.

**Verify.** Next digest: 6 → 0 (cancelled runs are not listed).

---

## F4 — LCC Processing Complete → Move Message — 7/week

**What fails.** Sequence is `manual` → `Send an HTTP request` (to LCC, succeeds) → `Move email (V2)`
(succeeds) → `Flag email (V2)` fails **PreconditionFailed** *"the change key … does not match"*.
Moving the item changes its change key; flagging afterwards uses the old one.

**Fix — swap the order (2 minutes).**
1. Open the flow → Edit. Drag **`Flag email (V2)`** *above* **`Move email (V2)`**.
2. Click **`Flag email (V2)`** → confirm *Message Id* still points at the trigger's message id
   (it does; nothing else references it). Flag status stays `notFlagged`.
3. Click **`Move email (V2)`** → confirm *Message Id* is the trigger's id and *Folder* is the
   target folder from the HTTP response (unchanged).
4. Save. Test with **Test → Manually** using a body from a past run (open any successful run →
   `manual` → *Show raw inputs*).

**Verify.** Next digest: 7 → 0.

---

## F5 — SF Listing Activity → LCC engagement — 35/week

**What fails.** Trigger `When a record is modified` (Salesforce, `Listing__c`) fires, then
`Get record` (`GetItem_V2`, table `Listing__c`) fails: *"parameters … may not be null or empty:
'id'"*. The `id` field on `Get record` is empty in every failed run — it is not mapped (or maps to a
field the trigger does not return). LCC is never reached.

**Fix — map the id (3 minutes).**
1. Open the flow → Edit → click **`Get record`**.
2. Click into the **Record Id** (shown as `id`) field → **Add dynamic content** → under **When a
   record is modified** pick **Record Id** (it may be labelled `Id` or `Item Id`). If you do not see
   the trigger's outputs, check the trigger: click **`When a record is modified`** and confirm
   **Salesforce Object Type** = `Listing__c` and, if present, **Include the entire record** is *Yes*.
3. If the trigger genuinely offers no id (some Salesforce triggers only return changed fields), add
   a **Compose** between trigger and `Get record` with `triggerBody()?['Id']` and use its output as
   the Record Id — the raw inputs of a failed run (`manual`/trigger → *Show raw outputs*) will show
   the exact key name to use.
4. Save. Test by editing one listing in Salesforce.

**Verify.** Next digest: 35 → 0, and LCC's `sf_activity`/engagement rows resume for listings.

---

## F6 — Http → Switch, Get Account records, Respond (account), Get Contact re… — 6/week

**What fails.** The whole run takes 31–57 s (the Switch's slow cases chain several Salesforce
actions — the *opportunities by ids* case alone chains 5), and the caller (LCC) gives up at ~30 s →
**504 Gateway Timeout** at `Respond (account)` / `Response`.

**Fix — short term (5 minutes).**
1. Open the flow → Edit → expand the **Switch**.
2. In the slow cases (*opportunities by ids*, *Case 7*, and any case with more than two Salesforce
   actions): for each Salesforce **Get records** action → **⋯ → Settings** → **Timeout** `PT45S`;
   and where several **Get record** calls fetch by id one at a time, replace them with a single
   **Get records** with **Filter Query** `Id IN ('id1','id2',…)` built from the incoming list
   (`join(...)` in a Compose). One call instead of five is usually the whole difference.
3. Save. Test with the raw inputs of a failed run.

**Fix — durable (later, with LCC).** Make the flow **asynchronous**: `Response` returns `202` with a
job id immediately; the Salesforce work continues; results are POSTed back to an LCC callback route.
That needs an LCC route first — Cowork will file it when the short-term fix's numbers are in.

**Verify.** Next digest: 6 → 0; if any remain, note the run duration on the screenshot.

---

## F7 — Outlook Calendar – Life Command Center Sync — 1/week

**What fails.** `Update file` (OneDrive for Business) → **Save Conflict**: two runs of this
recurrence overlapped and wrote the merged calendar file at the same time.

**Fix (1 minute).**
1. Open the flow → Edit → click the **`Recurrence`** trigger → **⋯ → Settings**.
2. **Concurrency Control** → **On**; **Degree of Parallelism** → `1` → Done.
3. Save.

**Verify.** It was 1/week; it should be 0. If it still conflicts, the file is also being edited by
something else — say so.

---

## After all seven

Wait one digest cycle (Microsoft sends "N of your flows have failed" weekly, Saturdays). Forward it
to `docs/claude-code/SB notes/` as before. Cowork will re-triage against this list and close
F1–F7 in `OPERATOR-CHECKLIST.md` with the new counts.
