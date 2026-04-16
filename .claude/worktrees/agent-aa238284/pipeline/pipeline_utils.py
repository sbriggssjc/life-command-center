"""
Pipeline utilities — shared helpers for the GovLease pipeline.
"""

import json
import logging
import os
from urllib import error as urllib_error
from urllib import request as urllib_request

logger = logging.getLogger(__name__)

_PA_WEBHOOK_TIMEOUT_SECONDS = 10


def send_pa_webhook(lead_data: dict) -> None:
    """
    POST ``lead_data`` to the Power Automate "new lead" webhook.

    Reads the target URL from ``PA_NEW_LEAD_WEBHOOK_URL``. All exceptions
    are caught and logged so a webhook failure never breaks the pipeline.
    """
    url = os.environ.get("PA_NEW_LEAD_WEBHOOK_URL")
    if not url:
        logger.info("[PA webhook] skipped — PA_NEW_LEAD_WEBHOOK_URL not set")
        return

    try:
        payload = json.dumps(lead_data, default=str).encode("utf-8")
        req = urllib_request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=_PA_WEBHOOK_TIMEOUT_SECONDS) as resp:
            status = getattr(resp, "status", resp.getcode())
            logger.info(
                "[PA webhook] success status=%s lease=%s",
                status,
                lead_data.get("lease_number"),
            )
    except urllib_error.HTTPError as exc:
        logger.warning(
            "[PA webhook] failure status=%s reason=%s lease=%s",
            exc.code,
            exc.reason,
            lead_data.get("lease_number"),
        )
    except Exception as exc:  # noqa: BLE001 — must never raise
        logger.warning(
            "[PA webhook] failure error=%s lease=%s",
            exc,
            lead_data.get("lease_number"),
        )
