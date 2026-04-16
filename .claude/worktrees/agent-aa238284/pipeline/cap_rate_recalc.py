"""
Cap rate recalculation — dialysis DB.

When a confirmed rent anchor (from an OM or a signed lease) arrives on a
property, every historical sale on that property needs its cap rate
recomputed against the rent that would have been in place at the sale date.

This module implements:

* ``project_rent_at_date``  — pure helper: anchor rent + escalation rule →
  projected rent at an arbitrary target date.
* ``recalculate_sale_cap_rates`` — walks all sales on a property and
  updates ``calculated_cap_rate``/``rent_at_sale``/``rent_source``/
  ``cap_rate_confidence`` using the property's confirmed anchor.
* ``DialysisDbClient`` — thin Supabase adapter that exposes the
  attribute-style interface the recalc function expects.

The CoStar-ingest path sets ``stated_cap_rate`` + ``cap_rate_confidence='low'``
and leaves the calculated fields null (see
``api/_handlers/sidebar-pipeline.js``). This module is the counterpart that
fills them in once a confirmed anchor is known.

See ``supabase/migrations/20260414192825_cap_rate_rent_anchor.sql`` for the
underlying schema.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime
from types import SimpleNamespace
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Rent projection
# ---------------------------------------------------------------------------

def _coerce_date(value: Any) -> date | None:
    """Best-effort conversion of a date/datetime/ISO string to a ``date``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        # Accept either 'YYYY-MM-DD' or a full ISO timestamp.
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    raise TypeError(f"Cannot coerce {value!r} to date")


def _months_between(earlier: date, later: date) -> int:
    """Whole months from ``earlier`` to ``later`` (negative if reversed)."""
    months = (later.year - earlier.year) * 12 + (later.month - earlier.month)
    if later.day < earlier.day:
        months -= 1
    return months


def project_rent_at_date(
    *,
    anchor_rent: float,
    anchor_date: Any,
    target_date: Any,
    bump_pct: float,
    bump_interval_months: int,
    lease_commencement: Any = None,
) -> dict:
    """
    Project ``anchor_rent`` forward (or backward) to ``target_date`` using a
    straight-line escalation schedule.

    The escalation schedule is anchored on ``lease_commencement`` when
    available (so bumps fall on their true lease anniversaries); otherwise
    the anchor date is used. Bumps are *step* bumps — rent changes on the
    bump date and stays flat until the next one.

    Returns ``{"projected_rent": float, "bumps_applied": int}``.
    """
    if anchor_rent is None:
        raise ValueError("anchor_rent is required")
    if bump_interval_months is None or bump_interval_months <= 0:
        raise ValueError("bump_interval_months must be positive")

    anchor_d = _coerce_date(anchor_date)
    target_d = _coerce_date(target_date)
    if anchor_d is None or target_d is None:
        raise ValueError("anchor_date and target_date are required")

    base_d = _coerce_date(lease_commencement) or anchor_d
    pct = float(bump_pct or 0.0)

    # How many bumps have occurred by a given date relative to base_d.
    # Bumps happen at base_d + N*interval for N = 1, 2, 3, ...
    def bumps_since_base(d: date) -> int:
        months = _months_between(base_d, d)
        if months <= 0:
            return 0
        return months // bump_interval_months

    bumps_at_anchor = bumps_since_base(anchor_d)
    bumps_at_target = bumps_since_base(target_d)
    delta = bumps_at_target - bumps_at_anchor

    # Forward: multiply; backward: divide. Flat schedule when pct == 0.
    if pct == 0 or delta == 0:
        projected = float(anchor_rent)
    elif delta > 0:
        projected = float(anchor_rent) * ((1.0 + pct) ** delta)
    else:
        projected = float(anchor_rent) / ((1.0 + pct) ** (-delta))

    return {
        "projected_rent": round(projected, 2),
        "bumps_applied": delta,
    }


# ---------------------------------------------------------------------------
# Recalc entry point
# ---------------------------------------------------------------------------

def recalculate_sale_cap_rates(property_id: str, db_client) -> dict:
    """
    Recompute calculated cap rates for every sale on ``property_id``.

    Pure business logic — ``db_client`` is an abstract adapter so this
    function is trivially testable. See ``DialysisDbClient`` for the live
    implementation.

    Returns a small summary ``{"updated": int, "skipped": int, "reason":
    Optional[str]}`` for logging.
    """
    prop = db_client.get_property(property_id)

    # Only run if we have a confirmed anchor. Without it, every sale stays
    # on stated_cap_rate with cap_rate_confidence='low', which is what the
    # CoStar ingest path already writes — so there is nothing to do.
    if prop is None or not prop.anchor_rent or not prop.anchor_rent_date:
        return {"updated": 0, "skipped": 0, "reason": "no_anchor"}

    confidence = "high" if prop.anchor_rent_source == "lease_confirmed" else "medium"
    rent_source = f"projected_from_{prop.anchor_rent_source}"

    sales = db_client.get_sales(property_id) or []
    updated = 0
    skipped = 0

    for sale in sales:
        if not sale.sale_price or not sale.sale_date:
            skipped += 1
            continue

        projected = project_rent_at_date(
            anchor_rent=prop.anchor_rent,
            anchor_date=prop.anchor_rent_date,
            target_date=sale.sale_date,
            bump_pct=prop.lease_bump_pct or 0.10,
            bump_interval_months=prop.lease_bump_interval_mo or 60,
            lease_commencement=prop.lease_commencement,
        )

        calculated_cap = projected["projected_rent"] / float(sale.sale_price)

        db_client.update_sale(sale.id, {
            "rent_at_sale": projected["projected_rent"],
            "calculated_cap_rate": round(calculated_cap, 4),
            "rent_source": rent_source,
            "cap_rate_confidence": confidence,
        })
        updated += 1

    return {"updated": updated, "skipped": skipped, "reason": None}


# ---------------------------------------------------------------------------
# Supabase adapter (dialysis DB)
# ---------------------------------------------------------------------------

@dataclass
class _PropertyRow:
    anchor_rent: float | None
    anchor_rent_date: Any
    anchor_rent_source: str | None
    lease_commencement: Any
    lease_bump_pct: float | None
    lease_bump_interval_mo: int | None


class DialysisDbClient:
    """
    Thin Supabase adapter around the dialysis DB.

    Exposes ``get_property``, ``get_sales``, ``update_sale`` with the
    attribute-style interface ``recalculate_sale_cap_rates`` expects. Column
    names are renamed where the spec's naming differs from the schema
    (``sold_price`` → ``sale_price``, ``sale_id`` → ``id``).
    """

    def __init__(self, client=None):
        if client is None:
            from supabase import create_client  # local import; optional dep

            url = os.environ.get("DIA_SUPABASE_URL", "")
            key = os.environ.get("DIA_SUPABASE_KEY", "")
            if not url or not key:
                raise RuntimeError(
                    "DIA_SUPABASE_URL / DIA_SUPABASE_KEY must be set to use "
                    "DialysisDbClient"
                )
            client = create_client(url, key)
        self._client = client

    # -- reads ------------------------------------------------------------

    def get_property(self, property_id: str) -> _PropertyRow | None:
        resp = (
            self._client.table("properties")
            .select(
                "anchor_rent, anchor_rent_date, anchor_rent_source, "
                "lease_commencement, lease_bump_pct, lease_bump_interval_mo"
            )
            .eq("property_id", property_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        r = rows[0]
        return _PropertyRow(
            anchor_rent=r.get("anchor_rent"),
            anchor_rent_date=r.get("anchor_rent_date"),
            anchor_rent_source=r.get("anchor_rent_source"),
            lease_commencement=r.get("lease_commencement"),
            lease_bump_pct=r.get("lease_bump_pct"),
            lease_bump_interval_mo=r.get("lease_bump_interval_mo"),
        )

    def get_sales(self, property_id: str) -> Iterable[SimpleNamespace]:
        resp = (
            self._client.table("sales_transactions")
            .select("sale_id, sale_date, sold_price")
            .eq("property_id", property_id)
            .execute()
        )
        return [
            SimpleNamespace(
                id=row["sale_id"],
                sale_date=row.get("sale_date"),
                sale_price=row.get("sold_price"),
            )
            for row in (resp.data or [])
        ]

    # -- writes -----------------------------------------------------------

    def update_sale(self, sale_id: Any, patch: dict) -> None:
        self._client.table("sales_transactions").update(patch).eq(
            "sale_id", sale_id
        ).execute()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Recalculate sale cap rates")
    parser.add_argument(
        "property_id",
        help="Dialysis DB property_id to recalculate sales for",
    )
    args = parser.parse_args(argv)

    client = DialysisDbClient()
    result = recalculate_sale_cap_rates(args.property_id, client)
    logger.info(
        "property=%s updated=%s skipped=%s reason=%s",
        args.property_id,
        result["updated"],
        result["skipped"],
        result["reason"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
