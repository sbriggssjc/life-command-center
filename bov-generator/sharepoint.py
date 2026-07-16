"""
sharepoint.py — RETIRED (preserved for reference only)

Microsoft Graph API / SharePoint delivery was the original design for this
service but cannot be used: Northmarq security policy prohibits Microsoft
Entra app registrations, which are required for the client-credentials OAuth
flow that Graph API demands.

Delivery is now handled inline in main.py:
  - The generated .xlsx is base64-encoded after LibreOffice recalc.
  - The base64 payload is returned in the POST /generate-bov JSON response.
  - Claude decodes the bytes, writes the file, and delivers it to the user
    via SendUserFile — no external storage or Microsoft auth required.

If policy changes and app registrations become available, the
client-credentials flow can be reintroduced:

    POST https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token
    PUT  https://graph.microsoft.com/v1.0/drives/{DRIVE_ID}/root:/{folder}/{filename}:/content

Env vars that were removed from .env.example as a result:
    AZURE_TENANT_ID
    AZURE_CLIENT_ID
    AZURE_CLIENT_SECRET
    SHAREPOINT_DRIVE_ID
    BOV_OUTPUT_FOLDER
"""
