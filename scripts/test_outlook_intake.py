#!/usr/bin/env python3
"""
Test the LCC Outlook intake pipeline end-to-end using a saved .eml file.

Simulates exactly what the Power Automate "flagged email" flow will send
once deployed, so we can verify the backend works before wiring the flow:

    .eml  →  parse attachment  →  /api/intake/prepare-upload
                              →  PUT bytes to Supabase Storage
                              →  /api/intake?_route=outlook-message
                                 (with storage_path reference)

Usage:
    python scripts/test_outlook_intake.py <path-to-eml>
    LCC_API_KEY=... python scripts/test_outlook_intake.py "email.eml"

    python scripts/test_outlook_intake.py "Linked in.eml" "OM Ingestion Test - Gov.eml"

Requires Python 3.9+. No third-party packages.
"""
import sys
import os
import json
import argparse
import urllib.request
import urllib.error
import email
from email import policy


def http_json(method, url, headers=None, json_body=None):
    data = None
    hdrs = dict(headers or {})
    if json_body is not None:
        data = json.dumps(json_body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_put_bytes(url, headers, body):
    req = urllib.request.Request(url, data=body, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def pick_attachment(msg):
    """Return (bytes, filename, content-type) for the best test candidate."""
    atts = [p for p in msg.walk() if p.get_filename() and not p.is_multipart()]
    if not atts:
        return None, None, None
    # Prefer PDF, then image, then first file
    pdfs = [a for a in atts if a.get_content_type() == "application/pdf"]
    imgs = [a for a in atts if a.get_content_type().startswith("image/")]
    primary = pdfs[0] if pdfs else (imgs[0] if imgs else atts[0])
    filename = (primary.get_filename() or "attachment.pdf").replace("\n", " ").strip()
    return primary.get_payload(decode=True), filename, primary.get_content_type()


def run_one(eml_path, api_key, host):
    print(f"\n{'=' * 72}")
    print(f"EML: {eml_path}")
    print(f"{'=' * 72}")

    with open(eml_path, "rb") as f:
        msg = email.message_from_bytes(f.read(), policy=policy.default)

    att_bytes, att_name, att_ctype = pick_attachment(msg)
    if att_bytes is None:
        print("No attachments found — skipping.")
        return

    print(f"Attachment: {att_name!r}")
    print(f"Content-Type: {att_ctype}")
    print(f"Size: {len(att_bytes):,} bytes")

    hdrs = {"X-LCC-Key": api_key}

    # ---- 1. prepare-upload ------------------------------------------------
    status, body = http_json(
        "POST",
        f"{host}/api/intake/prepare-upload",
        headers=hdrs,
        json_body={
            "file_name": att_name,
            "mime_type": att_ctype,
            "intake_channel": "email",
        },
    )
    if status != 200:
        print(f"prepare-upload FAILED: HTTP {status}")
        print(body[:500].decode(errors="replace"))
        return
    prep = json.loads(body)
    print(f"  → storage_path: {prep['storage_path']}")

    # ---- 2. PUT bytes to Supabase Storage ---------------------------------
    put_hdrs = dict(prep.get("upload_headers") or {})
    put_hdrs["Content-Type"] = att_ctype
    put_status, put_body = http_put_bytes(prep["upload_url"], put_hdrs, att_bytes)
    if put_status >= 300:
        print(f"  → PUT FAILED: HTTP {put_status}")
        print(put_body[:300].decode(errors="replace"))
        return
    print(f"  → PUT OK ({put_status}), stored at bucket/{prep['object_path']}")

    # ---- 3. POST outlook-message simulating Power Automate ----------------
    sender = msg.get("From", "")
    payload = {
        "message_id":          msg.get("Message-ID", ""),
        "internet_message_id": msg.get("Message-ID", ""),
        "subject":             msg.get("Subject", ""),
        "body_preview":        "(Simulated Power Automate payload)",
        "received_date_time":  msg.get("Date", ""),
        "from":                sender,
        "has_attachments":     True,
        "attachments": [
            {
                "file_name":    att_name,
                "file_type":    att_ctype,
                "storage_path": prep["storage_path"],
            }
        ],
    }
    status, body = http_json(
        "POST",
        f"{host}/api/intake?_route=outlook-message",
        headers=hdrs,
        json_body=payload,
    )
    print(f"\noutlook-message HTTP {status}")
    try:
        print(json.dumps(json.loads(body), indent=2)[:4000])
    except Exception:
        print(body[:1500].decode(errors="replace"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("eml_paths", nargs="+")
    ap.add_argument("--api-key", default=os.environ.get("LCC_API_KEY", ""))
    ap.add_argument(
        "--host",
        default=os.environ.get(
            "LCC_VERCEL_URL", os.environ.get("LCC_BASE_URL", "https://tranquil-delight-production-633f.up.railway.app")
        ).rstrip("/"),
    )
    args = ap.parse_args()
    if not args.api_key:
        print("ERROR: set --api-key or LCC_API_KEY env var")
        sys.exit(1)
    for p in args.eml_paths:
        try:
            run_one(p, args.api_key, args.host)
        except Exception as e:
            print(f"FAILED for {p}: {e}")


if __name__ == "__main__":
    main()
