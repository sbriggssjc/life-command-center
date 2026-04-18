"""Tests for pipeline.cap_rate_recalc."""

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pipeline.cap_rate_recalc import (  # noqa: E402
    project_rent_at_date,
    recalculate_sale_cap_rates,
)


# ---------------------------------------------------------------------------
# project_rent_at_date — pure logic
# ---------------------------------------------------------------------------

class ProjectRentAtDateTests(unittest.TestCase):
    def test_target_equals_anchor_returns_anchor_rent(self):
        out = project_rent_at_date(
            anchor_rent=100_000,
            anchor_date="2024-01-01",
            target_date="2024-01-01",
            bump_pct=0.10,
            bump_interval_months=60,
            lease_commencement="2020-01-01",
        )
        self.assertEqual(out["projected_rent"], 100_000.0)
        self.assertEqual(out["bumps_applied"], 0)

    def test_flat_schedule_when_pct_zero(self):
        out = project_rent_at_date(
            anchor_rent=100_000,
            anchor_date="2020-01-01",
            target_date="2030-01-01",
            bump_pct=0,
            bump_interval_months=60,
            lease_commencement="2020-01-01",
        )
        self.assertEqual(out["projected_rent"], 100_000.0)

    def test_forward_projection_applies_future_bumps(self):
        # Commencement 2020-01-01, 10% bumps every 60 months →
        # bumps at 2025-01-01, 2030-01-01, 2035-01-01, ...
        # Anchor 2020-01-01 (0 bumps), target 2030-06-01 (2 bumps). Delta = 2.
        out = project_rent_at_date(
            anchor_rent=100_000,
            anchor_date="2020-01-01",
            target_date="2030-06-01",
            bump_pct=0.10,
            bump_interval_months=60,
            lease_commencement="2020-01-01",
        )
        self.assertEqual(out["bumps_applied"], 2)
        self.assertAlmostEqual(out["projected_rent"], 121_000.00, places=2)

    def test_anchor_mid_lease_forward_projection(self):
        # Commencement 2020-01-01, anchor 2027-01-01 (1 bump already applied),
        # target 2032-01-01 (2 bumps applied). Delta from anchor = 1.
        out = project_rent_at_date(
            anchor_rent=110_000,
            anchor_date="2027-01-01",
            target_date="2032-06-01",
            bump_pct=0.10,
            bump_interval_months=60,
            lease_commencement="2020-01-01",
        )
        self.assertEqual(out["bumps_applied"], 1)
        self.assertAlmostEqual(out["projected_rent"], 121_000.00, places=2)

    def test_backward_projection_divides(self):
        # Anchor 2030-01-01 after 2 bumps; target 2020-06-01 → 0 bumps.
        # Rent before bumps: 121000 / 1.1^2 = 100000.
        out = project_rent_at_date(
            anchor_rent=121_000,
            anchor_date="2030-01-01",
            target_date="2020-06-01",
            bump_pct=0.10,
            bump_interval_months=60,
            lease_commencement="2020-01-01",
        )
        self.assertEqual(out["bumps_applied"], -2)
        self.assertAlmostEqual(out["projected_rent"], 100_000.00, places=2)

    def test_lease_commencement_defaults_to_anchor_date(self):
        # With no commencement, anchor becomes the base, so no bumps have
        # occurred at anchor_date. 10 years later → 2 bumps.
        out = project_rent_at_date(
            anchor_rent=100_000,
            anchor_date="2020-01-01",
            target_date="2030-06-01",
            bump_pct=0.10,
            bump_interval_months=60,
            lease_commencement=None,
        )
        self.assertEqual(out["bumps_applied"], 2)
        self.assertAlmostEqual(out["projected_rent"], 121_000.00, places=2)

    def test_invalid_bump_interval_raises(self):
        with self.assertRaises(ValueError):
            project_rent_at_date(
                anchor_rent=100_000,
                anchor_date="2020-01-01",
                target_date="2025-01-01",
                bump_pct=0.10,
                bump_interval_months=0,
            )


# ---------------------------------------------------------------------------
# recalculate_sale_cap_rates — orchestration
# ---------------------------------------------------------------------------

class FakeDbClient:
    def __init__(self, property_row, sales):
        self._property = property_row
        self._sales = sales
        self.updates: list[tuple] = []

    def get_property(self, property_id):
        return self._property

    def get_sales(self, property_id):
        return self._sales

    def update_sale(self, sale_id, patch):
        self.updates.append((sale_id, patch))


class RecalculateSaleCapRatesTests(unittest.TestCase):
    def test_no_anchor_skips_all_sales(self):
        prop = SimpleNamespace(
            anchor_rent=None,
            anchor_rent_date=None,
            anchor_rent_source=None,
            lease_commencement=None,
            lease_bump_pct=None,
            lease_bump_interval_mo=None,
        )
        sale = SimpleNamespace(id=1, sale_date="2024-01-01", sale_price=10_000_000)
        db = FakeDbClient(prop, [sale])

        result = recalculate_sale_cap_rates("prop-1", db)

        self.assertEqual(result, {"updated": 0, "skipped": 0, "reason": "no_anchor"})
        self.assertEqual(db.updates, [])

    def test_lease_confirmed_anchor_marks_high_confidence(self):
        prop = SimpleNamespace(
            anchor_rent=100_000,
            anchor_rent_date="2024-01-01",
            anchor_rent_source="lease_confirmed",
            lease_commencement="2020-01-01",
            lease_bump_pct=0.10,
            lease_bump_interval_mo=60,
        )
        # Sale on commencement date → rent was 100000 / 1.1 at that date
        # (anchor 2024-01-01 has 0 bumps; target 2020-01-01 also 0 bumps → delta 0)
        sale = SimpleNamespace(id=42, sale_date="2024-01-01", sale_price=1_250_000)
        db = FakeDbClient(prop, [sale])

        result = recalculate_sale_cap_rates("prop-1", db)

        self.assertEqual(result["updated"], 1)
        self.assertEqual(len(db.updates), 1)
        sale_id, patch = db.updates[0]
        self.assertEqual(sale_id, 42)
        self.assertEqual(patch["rent_at_sale"], 100_000.0)
        self.assertEqual(patch["calculated_cap_rate"], round(100_000 / 1_250_000, 4))
        self.assertEqual(patch["rent_source"], "projected_from_lease_confirmed")
        self.assertEqual(patch["cap_rate_confidence"], "high")

    def test_om_confirmed_anchor_marks_medium_confidence(self):
        prop = SimpleNamespace(
            anchor_rent=121_000,
            anchor_rent_date="2030-01-01",
            anchor_rent_source="om_confirmed",
            lease_commencement="2020-01-01",
            lease_bump_pct=0.10,
            lease_bump_interval_mo=60,
        )
        # Historical sale at 2020-06-01 → 2 bumps behind anchor, rent ~100000
        sale = SimpleNamespace(id=7, sale_date="2020-06-01", sale_price=1_500_000)
        db = FakeDbClient(prop, [sale])

        recalculate_sale_cap_rates("prop-1", db)

        sale_id, patch = db.updates[0]
        self.assertEqual(sale_id, 7)
        self.assertAlmostEqual(patch["rent_at_sale"], 100_000.00, places=2)
        self.assertEqual(
            patch["calculated_cap_rate"],
            round(100_000 / 1_500_000, 4),
        )
        self.assertEqual(patch["rent_source"], "projected_from_om_confirmed")
        self.assertEqual(patch["cap_rate_confidence"], "medium")

    def test_defaults_used_when_bump_fields_missing(self):
        # Property missing bump_pct / bump_interval → defaults (0.10, 60).
        prop = SimpleNamespace(
            anchor_rent=100_000,
            anchor_rent_date="2020-01-01",
            anchor_rent_source="lease_confirmed",
            lease_commencement="2020-01-01",
            lease_bump_pct=None,
            lease_bump_interval_mo=None,
        )
        sale = SimpleNamespace(id=1, sale_date="2030-06-01", sale_price=1_210_000)
        db = FakeDbClient(prop, [sale])

        recalculate_sale_cap_rates("prop-1", db)

        _, patch = db.updates[0]
        self.assertAlmostEqual(patch["rent_at_sale"], 121_000.00, places=2)
        self.assertEqual(
            patch["calculated_cap_rate"],
            round(121_000 / 1_210_000, 4),
        )

    def test_sale_without_price_is_skipped(self):
        prop = SimpleNamespace(
            anchor_rent=100_000,
            anchor_rent_date="2024-01-01",
            anchor_rent_source="lease_confirmed",
            lease_commencement="2020-01-01",
            lease_bump_pct=0.10,
            lease_bump_interval_mo=60,
        )
        sales = [
            SimpleNamespace(id=1, sale_date="2024-01-01", sale_price=None),
            SimpleNamespace(id=2, sale_date=None, sale_price=1_000_000),
            SimpleNamespace(id=3, sale_date="2024-01-01", sale_price=1_000_000),
        ]
        db = FakeDbClient(prop, sales)

        result = recalculate_sale_cap_rates("prop-1", db)

        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["skipped"], 2)
        self.assertEqual([u[0] for u in db.updates], [3])


if __name__ == "__main__":
    unittest.main()
