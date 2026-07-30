"""Entity-resolution microservice (LCC audit W4.2).

A stateless scoring service: it NEVER writes to any database. It normalizes
names/addresses, blocks candidate pairs, and returns calibrated Fellegi-Sunter
match probabilities with comparison-vector explanations. Writers stay in the
existing tick/lane paths (sf-link attach, owner_reconcile, entity_match_labels).
"""

__version__ = "0.1.0"
