<!-- Converted 2026-09-16 by Cowork from the root file `RCM_Power_Automate_Flow_Spec.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**Power Automate Flow Specification**

RCM Website Lead Integration

Life Command Center (LCC) — Marketing Pipeline

Version 1.0 — March 14, 2026

Prepared for: Scott Briggs, SVP — Northmarq Investment Sales

**1. Overview**

This document specifies the Power Automate flow that ingests website inquiry leads from the RCM (Real Capital Markets) third-party marketing platform into the LCC Marketing pipeline. RCM sends email notifications to a dedicated Outlook folder when prospects interact with property marketing materials on the RCM platform.

The flow watches the Outlook folder, parses lead information from each email, posts the data to the Supabase marketing\_leads table via the Vercel serverless proxy, and triggers automated Salesforce contact matching. Matched leads surface in the LCC Marketing tab alongside existing Salesforce deal tasks, enabling unified follow-up workflows.

**1.1 Architecture Summary**

|                   |                                                                     |
| ----------------- | ------------------------------------------------------------------- |
| **Component**     | **Detail**                                                          |
| **Trigger**       | New email in Outlook: Property marketing/RCM                        |
| **Source**        | RCM website inquiry notification emails                             |
| **Destination**   | Supabase marketing\_leads table (Dia DB: zqzrriwuavgrquhisnoa)      |
| **API Endpoint**  | POST /api/dia-query (Vercel serverless proxy)                       |
| **SF Matching**   | match\_marketing\_lead\_to\_sf() Postgres function (auto-triggered) |
| **Deduplication** | Unique index on source + source\_ref (prevents duplicate inserts)   |
| **LCC Surface**   | Marketing tab \> RCM source filter in v\_marketing\_pipeline view   |

**2. Flow Trigger Configuration**

The flow uses the Office 365 Outlook connector with the following trigger:

**2.1 Trigger Settings**

|                          |                                                |
| ------------------------ | ---------------------------------------------- |
| **Setting**              | **Value**                                      |
| **Trigger Type**         | When a new email arrives (V3)                  |
| **Folder**               | Inbox/Property marketing/RCM                   |
| **Include Attachments**  | No                                             |
| **Only with Attachment** | No                                             |
| **Importance**           | Any                                            |
| **Frequency**            | Every 5 minutes (or as fast as license allows) |

**2.2 Expected Email Format**

RCM sends HTML-formatted notification emails. A typical email includes:

  - Subject line containing the property name or listing ID

  - Body with prospect contact details: name, email, phone, company

  - Property/listing reference that maps to a Salesforce deal

  - Inquiry type (e.g., request for information, CA request, offer)

*The flow must handle variations in email formatting. The parsing logic should be resilient to missing fields and extract whatever data is available.*

**3. Email Parsing Logic**

After the trigger fires, the flow parses the email body to extract structured lead data. This uses a combination of Power Automate expressions and an optional HTML-to-text conversion step.

**3.1 Parsing Steps**

1.  **Convert HTML body to plain text** — Use the built-in Html to text action on the email Body to strip HTML tags and normalize whitespace.

2.  **Extract contact name** — Look for patterns like "Name: John Smith" or "Contact: John Smith" in the plain text body. Use a Compose action with an expression to capture the value after the label.

3.  **Extract email address** — Look for patterns like "Email: user@domain.com" or extract from the Reply-To header if the prospect email is embedded there.

4.  **Extract phone number** — Look for patterns like "Phone: (555) 123-4567" or "Tel:" fields.

5.  **Extract company name** — Look for "Company:", "Organization:", or "Firm:" labels in the body.

6.  **Extract property/deal reference** — Parse the email subject line for the property name. This value maps to the deal\_name field and is used later for Salesforce deal matching.

7.  **Generate source\_ref** — Create a unique reference from the email Message ID or a combination of sender email + received timestamp. This prevents duplicate inserts via the unique index.

**3.2 Recommended Expression Patterns**

These Power Automate expressions handle common RCM email formats:

> // Extract value after a label (e.g., "Name: John Smith")
> 
> // Use in a Compose action:
> 
> trim(first(split(last(split(body('Html\_to\_text'),'Name:')),
> 
> '\\n')))
> 
> // Extract email with regex-like approach:
> 
> trim(first(split(last(split(body('Html\_to\_text'),'Email:')),
> 
> '\\n')))
> 
> // Property name from subject:
> 
> triggerOutputs()?\['body/subject'\]
> 
> // Source reference (Message ID):
> 
> triggerOutputs()?\['body/internetMessageId'\]

*If fields are missing, set them to null rather than empty strings. The Supabase insert will accept null values for optional fields.*

**4. Supabase Insert via API**

After parsing, the flow sends a POST request to the Vercel serverless proxy, which forwards the insert to the Supabase marketing\_leads table.

**4.1 HTTP Request Configuration**

|                  |                                                      |
| ---------------- | ---------------------------------------------------- |
| **Parameter**    | **Value**                                            |
| **Method**       | POST                                                 |
| **URI**          | https://life-command-center.vercel.app/api/dia-query |
| **Content-Type** | application/json                                     |

**4.2 Request Body Schema**

The request body must include the table name and the lead data object:

> {
> 
> "table": "marketing\_leads",
> 
> "method": "POST",
> 
> "body": {
> 
> "source": "rcm",
> 
> "source\_ref": "\<internetMessageId\>",
> 
> "contact\_name": "\<parsed name\>",
> 
> "contact\_email": "\<parsed email\>",
> 
> "contact\_phone": "\<parsed phone\>",
> 
> "contact\_company": "\<parsed company\>",
> 
> "deal\_name": "\<property name from subject\>",
> 
> "inquiry\_type": "\<request type if available\>",
> 
> "raw\_content": "\<full plain text email body\>",
> 
> "status": "new",
> 
> "received\_at": "\<email receivedDateTime\>"
> 
> }
> 
> }

**4.3 marketing\_leads Table Schema**

|                       |             |              |                                                    |
| --------------------- | ----------- | ------------ | -------------------------------------------------- |
| **Column**            | **Type**    | **Required** | **Description**                                    |
| lead\_id              | UUID        | Auto         | Primary key, auto-generated                        |
| source                | TEXT        | **Yes**      | Always "rcm" for this flow                         |
| source\_ref           | TEXT        | **Yes**      | Email Message ID (dedup key)                       |
| contact\_name         | TEXT        | No           | Prospect full name                                 |
| contact\_email        | TEXT        | No           | Prospect email address                             |
| contact\_phone        | TEXT        | No           | Prospect phone number                              |
| contact\_company      | TEXT        | No           | Prospect company/firm                              |
| deal\_name            | TEXT        | No           | Property/listing name from subject                 |
| inquiry\_type         | TEXT        | No           | Type of inquiry (info request, CA, offer)          |
| raw\_content          | TEXT        | No           | Full email body for reference                      |
| status                | TEXT        | **Yes**      | Workflow status: new, contacted, qualified, closed |
| received\_at          | TIMESTAMPTZ | No           | When the email was received                        |
| sf\_contact\_id       | TEXT        | No           | Populated by match function                        |
| sf\_account\_id       | TEXT        | No           | Populated by match function                        |
| sf\_match\_strategy   | TEXT        | No           | How SF match was found                             |
| sf\_match\_confidence | TEXT        | No           | Match confidence: high, medium, low                |

**5. Salesforce Contact Matching**

After the lead is inserted, the LCC Marketing tab provides a "Match" button that triggers the match\_marketing\_lead\_to\_sf() Postgres function. This function runs a 4-strategy cascade to find the best Salesforce contact match.

**5.1 Matching Strategies (Priority Order)**

|        |                     |                        |                        |                |
| ------ | ------------------- | ---------------------- | ---------------------- | -------------- |
| **\#** | **Strategy**        | **Source Table**       | **Match Field**        | **Confidence** |
| 1      | Email exact         | salesforce\_contacts   | email                  | **high**       |
| 2      | Email in activities | salesforce\_activities | description LIKE email | **medium**     |
| 3      | Name exact          | salesforce\_contacts   | name ILIKE             | **medium**     |
| 4      | Company match       | salesforce\_accounts   | name ILIKE company     | **low**        |

**5.2 Match Function Behavior**

  - The function is called manually from the LCC UI via the "Match" button on unmatched leads

  - On success, it updates the lead record with sf\_contact\_id, sf\_account\_id, sf\_match\_strategy, and sf\_match\_confidence

  - If no match is found, the lead remains unmatched and the broker can manually research and create a Salesforce contact

  - The function can be re-run if new Salesforce data becomes available

**5.3 Post-Match Workflow**

Once a lead is matched to a Salesforce contact, the LCC Marketing tab enables:

  - Direct email via mailto: link with pre-populated template

  - Call logging that creates an activity in the LCC activity\_log

  - Status progression: new → contacted → qualified → closed

  - Full touchpoint history visible in the unified detail page

**6. Error Handling and Monitoring**

**6.1 Flow Error Actions**

|                         |                                   |                                   |
| ----------------------- | --------------------------------- | --------------------------------- |
| **Error Scenario**      | **Handling**                      | **Action**                        |
| Email parse failure     | Insert with raw\_content only     | Set status = "parse\_error"       |
| API endpoint down       | Retry 3x with exponential backoff | Send failure notification email   |
| Duplicate source\_ref   | 409 Conflict from Supabase        | Skip silently (already ingested)  |
| Missing required fields | Insert with available data        | Flag for manual review in LCC     |
| Auth token expired      | Refresh connection                | Re-authenticate Outlook connector |

**6.2 Monitoring**

  - Power Automate run history provides per-email success/failure logs

  - Failed runs should trigger a notification email to Scott

  - The LCC Marketing tab shows unmatched/errored leads in the "Unmatched" filter for manual review

  - Weekly check: compare Outlook folder email count vs marketing\_leads row count for the period to detect missed emails

**7. Deduplication Strategy**

The marketing\_leads table has a unique index on (source, source\_ref). For RCM leads, the source is always "rcm" and the source\_ref is the email Message ID. This ensures each email is processed exactly once, even if the flow re-triggers or retries.

**7.1 Dedup Behavior**

  - First insert: succeeds normally, lead appears in LCC Marketing tab

  - Duplicate insert: Supabase returns 409 Conflict, flow logs the skip and continues

  - Re-processing: If a lead needs to be re-ingested (e.g., after a parsing fix), delete the existing row first or update the source\_ref

**8. Complete Flow Step-by-Step**

Below is the ordered list of Power Automate actions for the complete flow:

1.  **Trigger:** When a new email arrives in Inbox/Property marketing/RCM

2.  **Html to text:** Convert email body HTML to plain text

3.  **Compose — Parse Contact Name:** Extract name from body text

4.  **Compose — Parse Email:** Extract email address from body text

5.  **Compose — Parse Phone:** Extract phone number from body text

6.  **Compose — Parse Company:** Extract company name from body text

7.  **Compose — Parse Deal Name:** Extract property name from email subject

8.  **Compose — Build JSON Body:** Assemble the request payload with all parsed fields

9.  **HTTP — POST to Supabase:** Send the JSON payload to /api/dia-query

10. **Condition — Check Response:** If status 201 (created) or 409 (duplicate), continue. Otherwise, run error handling.

11. **Error branch:** Send notification email with error details to Scott

**9. Future Marketing Lead Sources**

The marketing\_leads table and v\_marketing\_pipeline view are designed to support multiple lead sources. Each source uses the same table structure with a different source value:

|                  |                  |                         |                           |
| ---------------- | ---------------- | ----------------------- | ------------------------- |
| **Source**       | **source Value** | **Trigger**             | **Status**                |
| RCM              | rcm              | Outlook folder email    | **This document**         |
| CREXi            | crexi            | CREXi inquiry email/API | Planned                   |
| LoopNet          | loopnet          | LoopNet lead email      | Planned                   |
| Website (direct) | website          | Already in SF tasks     | **Active (SF Deals tab)** |

Each new source will follow the same pattern: a dedicated Power Automate flow watching a specific Outlook folder or API endpoint, parsing lead data, and inserting into marketing\_leads with the appropriate source tag. The LCC Marketing tab source filters will automatically surface leads from all sources.

**10. Setup Checklist**

Follow these steps to deploy the RCM integration flow:

  - **1. Verify Outlook folder:** Confirm "Property marketing/RCM" folder exists under Inbox and is receiving emails

  - **2. Create Power Automate flow:** Use the Office 365 Outlook connector with the trigger and actions described in Section 8

  - **3. Test with sample email:** Forward an existing RCM email to the folder and verify the flow triggers, parses correctly, and inserts into marketing\_leads

  - **4. Verify in LCC:** Open the Marketing tab, filter by "RCM" source, and confirm the test lead appears

  - **5. Test deduplication:** Re-forward the same email and verify no duplicate row is created

  - **6. Test SF matching:** Click the "Match" button on the test lead and verify it finds the correct Salesforce contact

  - **7. Enable flow:** Turn on the flow for production and monitor the first 24 hours of run history

  - **8. Deploy LCC updates:** Ensure index.html and sw.js (v29) are deployed with the Marketing tab changes
