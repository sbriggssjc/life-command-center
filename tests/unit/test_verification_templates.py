"""Tests for template-based verification and model tier routing in ai_research."""

import json
import sys
import os
import unittest

# Ensure pipeline package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from pipeline.ai_research import (
    CHEAP_TASKS,
    OPENAI_MODEL_CHEAP,
    OPENAI_MODEL_PREMIUM,
    PREMIUM_TASKS,
    SOS_ENTITY_SEARCH_URLS,
    TEMPLATE_STEPS,
    _generate_verification_template,
    _select_model,
    _strip_entity_suffix,
    verify_deed_owner,
    verify_entity_registry,
    verify_parcel,
    verify_tax_mailing,
    extract_mortgage,
)

SAMPLE_LEAD = {
    "lead_id": "test-001",
    "address": "100 Main St",
    "city": "Dallas",
    "state": "TX",
    "lessor_name": "Acme Properties LLC",
    "recorded_owner": "Acme Properties LLC",
    "lease_number": "GS-07P-LTX0001",
    "location_code": "TX0523",
}

SAMPLE_COUNTY_URLS = {
    "assessor_url": "https://dallascad.org",
    "recorder_url": "https://countyclerk.dallascounty.org",
    "clerk_url": "https://countyclerk.dallascounty.org",
    "tax_url": "https://www.dallascounty.org/tax",
    "treasurer_url": "https://www.dallascounty.org/treasurer",
}


# ---------------------------------------------------------------------------
# Template output structure
# ---------------------------------------------------------------------------

class TestTemplateOutputStructure(unittest.TestCase):
    """All template outputs must have the same JSON schema."""

    REQUIRED_KEYS = {"search_url", "steps", "fields_to_capture", "ai_confidence", "source"}

    def _assert_valid_template(self, result):
        self.assertIsInstance(result, dict)
        self.assertEqual(set(result.keys()), self.REQUIRED_KEYS)
        self.assertIsInstance(result["steps"], list)
        self.assertTrue(len(result["steps"]) >= 1)
        self.assertIsInstance(result["fields_to_capture"], list)
        self.assertTrue(len(result["fields_to_capture"]) >= 1)
        self.assertEqual(result["ai_confidence"], 0.9)
        self.assertEqual(result["source"], "template")

    def test_parcel_verify_structure(self):
        result = verify_parcel(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        self._assert_valid_template(result)
        self.assertEqual(result["search_url"], "https://dallascad.org")

    def test_deed_owner_verify_structure(self):
        result = verify_deed_owner(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        self._assert_valid_template(result)
        self.assertEqual(result["search_url"], "https://countyclerk.dallascounty.org")

    def test_tax_mailing_verify_structure(self):
        result = verify_tax_mailing(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        self._assert_valid_template(result)
        self.assertEqual(result["search_url"], "https://www.dallascounty.org/tax")

    def test_mortgage_extract_structure(self):
        result = extract_mortgage(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        self._assert_valid_template(result)
        self.assertEqual(result["search_url"], "https://countyclerk.dallascounty.org")

    def test_entity_registry_verify_structure(self):
        result = verify_entity_registry(SAMPLE_LEAD)
        self._assert_valid_template(result)
        self.assertEqual(result["search_url"], SOS_ENTITY_SEARCH_URLS["TX"])


class TestTemplateContent(unittest.TestCase):
    """Template outputs include lead-specific data in their steps."""

    def test_parcel_steps_include_address(self):
        result = verify_parcel(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        steps_text = " ".join(result["steps"])
        self.assertIn("100 Main St", steps_text)
        self.assertIn("Dallas", steps_text)

    def test_deed_steps_include_owner(self):
        result = verify_deed_owner(SAMPLE_LEAD, SAMPLE_COUNTY_URLS)
        steps_text = " ".join(result["steps"])
        self.assertIn("Acme Properties LLC", steps_text)

    def test_entity_registry_strips_suffix(self):
        result = verify_entity_registry(SAMPLE_LEAD)
        steps_text = " ".join(result["steps"])
        self.assertIn("Acme Properties", steps_text)
        # The stripped version should NOT contain "LLC"
        search_step = [s for s in result["steps"] if "Search for entity" in s][0]
        self.assertNotIn("LLC", search_step)

    def test_template_works_without_county_urls(self):
        result = verify_parcel(SAMPLE_LEAD)
        self.assertEqual(result["search_url"], "")
        self.assertTrue(any("assessor" in s.lower() for s in result["steps"]))

    def test_unknown_step_raises(self):
        with self.assertRaises(ValueError):
            _generate_verification_template("unknown_step", SAMPLE_LEAD)


# ---------------------------------------------------------------------------
# SOS URL coverage
# ---------------------------------------------------------------------------

class TestSOSUrlCoverage(unittest.TestCase):
    """SOS lookup table covers all 50 states + DC + PR."""

    EXPECTED_STATES = {
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
        "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
        "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
        "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
        "DC", "PR",
    }

    def test_all_states_present(self):
        self.assertEqual(set(SOS_ENTITY_SEARCH_URLS.keys()), self.EXPECTED_STATES)

    def test_52_entries(self):
        self.assertEqual(len(SOS_ENTITY_SEARCH_URLS), 52)

    def test_all_urls_are_https(self):
        for state, url in SOS_ENTITY_SEARCH_URLS.items():
            self.assertTrue(url.startswith("https://"), f"{state} URL does not start with https://: {url}")


# ---------------------------------------------------------------------------
# Model tier routing
# ---------------------------------------------------------------------------

class TestModelRouting(unittest.TestCase):
    """_select_model routes tasks to the correct model tier."""

    def test_classification_routes_to_cheap(self):
        self.assertEqual(_select_model("classification"), OPENAI_MODEL_CHEAP)

    def test_research_routes_to_premium(self):
        self.assertEqual(_select_model("research"), OPENAI_MODEL_PREMIUM)

    def test_all_cheap_tasks(self):
        for task in CHEAP_TASKS:
            self.assertEqual(_select_model(task), OPENAI_MODEL_CHEAP, f"task={task}")

    def test_all_premium_tasks(self):
        for task in PREMIUM_TASKS:
            self.assertEqual(_select_model(task), OPENAI_MODEL_PREMIUM, f"task={task}")

    def test_unknown_task_defaults_to_premium(self):
        self.assertEqual(_select_model("something_new"), OPENAI_MODEL_PREMIUM)


# ---------------------------------------------------------------------------
# Entity suffix stripping
# ---------------------------------------------------------------------------

class TestStripEntitySuffix(unittest.TestCase):
    def test_strip_llc(self):
        self.assertEqual(_strip_entity_suffix("Acme Properties LLC"), "Acme Properties")

    def test_strip_inc(self):
        self.assertEqual(_strip_entity_suffix("Acme Inc."), "Acme")

    def test_strip_corp(self):
        self.assertEqual(_strip_entity_suffix("Big Corp"), "Big")

    def test_strip_lp(self):
        self.assertEqual(_strip_entity_suffix("Fund LP"), "Fund")

    def test_no_suffix(self):
        self.assertEqual(_strip_entity_suffix("John Smith"), "John Smith")

    def test_empty_string(self):
        self.assertEqual(_strip_entity_suffix(""), "")


# ---------------------------------------------------------------------------
# Template steps constant
# ---------------------------------------------------------------------------

class TestTemplateStepsConstant(unittest.TestCase):
    def test_five_template_steps(self):
        self.assertEqual(len(TEMPLATE_STEPS), 5)

    def test_expected_steps(self):
        expected = {"parcel_verify", "deed_owner_verify", "tax_mailing_verify",
                    "mortgage_extract", "entity_registry_verify"}
        self.assertEqual(TEMPLATE_STEPS, expected)


if __name__ == "__main__":
    unittest.main()
