# PA Outlook Intake — Base64 Upload Fix

## Symptom

OMs uploaded via the Outlook intake flow land in the `lcc-om-uploads` Supabase
bucket with a corrupted body. The first few bytes spell `JVBERi0x...` (the
base64 encoding of `%PDF-1.`). The bytes are roughly 33% larger than the real
file (e.g. a 12.2 MB PDF stored as 16.3 MB of ASCII text). pdf-parse rejects
these objects with `Invalid PDF structure`, the extractor returns
`document_type=unknown` with all fields null, and the matcher records
`needs_review / no_address_match`.

Confirmed on the US Renal Care – Hondo OM intake (intake_id
`eaf5d61d-8265-48ec-af40-73c2c8aecbe2`) on 2026-04-25.

## Root Cause

In the Outlook trigger payload, every attachment object exposes
`contentBytes` — already base64-encoded (Microsoft Graph contract). The
existing PA flow's `Apply_to_each` loop PUTs that string to the Supabase
signed-upload URL **as-is**, so Supabase Storage writes the base64 ASCII
text to disk rather than the decoded PDF bytes.

The Supabase signed-upload contract expects raw binary. There is no
server-side decode hook on the upload path.

## Two Fixes (Apply Both)

### 1. Fix Power Automate (root cause)

Open the LCC Flagged Email Intake flow, navigate to the
`Apply_to_each → HTTP — PUT bytes to signed URL` action.

**Body field — current (wrong):**

```
@{items('Apply_to_each')?['contentBytes']}
```

**Body field — fixed:**

```
@{base64ToBinary(items('Apply_to_each')?['contentBytes'])}
```

Power Automate's `base64ToBinary()` expression converts the base64 string into
a binary content reference. The HTTP connector then PUTs the decoded bytes
with the correct `Content-Length`, and Supabase writes the real PDF.

> **Headers note.** Leave the `Content-Type` header set to the attachment's
> `contentType` (Outlook supplies this) — `application/pdf`, `image/png`,
> `image/jpeg`, etc. Don't add an `Authorization` header on the PUT step;
> the signed URL's `?token=` query parameter is the only auth credential
> Supabase accepts on this path.

### 2. Defensive server-side recovery (already deployed in this commit)

`api/_handlers/intake-extractor.js` now contains `recoverIfBase64Wrapped()`,
which detects the pattern and decodes once before handing bytes to
`pdf-parse`. Triggers only when the bytes:

- Don't start with a real binary header (`%PDF` / `PK\x03\x04`)
- Are entirely base64 alphabet
- Decode to a recognizable PDF or DOCX header

When recovery fires, the per-artifact diagnostic includes:

```json
{
  "base64_unwrapped":   true,
  "base64_unwrap_kind": "pdf",
  "actual_bytes":       16290544,
  "decoded_bytes":      12217907
}
```

Watch the runtime logs — every `base64-wrapped storage object detected and
unwrapped` warning means an upstream uploader is still mis-encoding. Those
warnings should drop to zero after the PA fix lands.

## Verifying the PA fix

After saving the flow change:

1. Drop a fresh OM into `LCC Intake` and flag it.
2. Wait for the flow run to complete (~30 s).
3. Query LCC Opps:

   ```sql
   SELECT
     a.file_name,
     a.size_bytes,
     a.storage_path
   FROM staged_intake_artifacts a
   JOIN staged_intake_items i ON i.intake_id = a.intake_id
   WHERE i.created_at > now() - interval '5 min'
   ORDER BY a.created_at DESC;
   ```

4. Download the storage object directly and confirm:

   ```bash
   head -c 8 file.pdf | xxd
   # Expected:  25 50 44 46 2d 31 2e 37  (i.e. "%PDF-1.7")
   # Bug:       4a 56 42 45 52 69 30 78  (i.e. "JVBERi0x")
   ```

5. Confirm the extractor diagnostic does **not** include
   `base64_unwrapped: true`. If it does, the PA fix didn't take.

## Recovery for already-corrupted intakes

For OMs already sitting in storage as base64 text:

```js
// pseudo: download, decode once, re-upload with x-upsert: true
const corrupted = await fetch(storageUrl).then(r => r.arrayBuffer());
const real = Buffer.from(Buffer.from(corrupted).toString('latin1'), 'base64');
await fetch(storageUrl, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: real });
```

Then `DELETE FROM staged_intake_extractions/matches/promotions WHERE intake_id=…`,
set `staged_intake_items.status='queued'`, and POST `/api/intake-extract`.
