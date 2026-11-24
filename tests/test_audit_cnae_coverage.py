import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-cnae-coverage.py"
SPEC = importlib.util.spec_from_file_location("audit_cnae_coverage", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUDIT
SPEC.loader.exec_module(AUDIT)


def row(*, status="02", municipality="3106200", primary="1061100", secondary="4621100"):
    values = [""] * 28
    values[5] = status
    values[11] = primary
    values[12] = secondary
    values[19] = "MG"
    values[20] = municipality
    return values


class CnaeCoverageTests(unittest.TestCase):
    def test_counts_secondary_classes_without_double_counting_within_one_class(self):
        report = AUDIT.count_cnae_classes(
            [row(secondary="1061100,4621100"), row(primary="1061100", secondary=""), row(primary="4744099", secondary=""), row(status="01"), row(municipality="3100000")],
            {"3106200"},
            [{"id": "grain-wholesale", "cnae_prefixes": ["4621"]}],
            {"1061100": "Beneficiamento de arroz", "4621100": "Comércio atacadista de cereais", "4744099": "Materiais de construção"},
        )
        self.assertEqual(report["metrics"], {
            "establishments_seen": 5,
            "in_intersecting_municipalities": 4,
            "active_in_intersecting_municipalities": 3,
            "active_in_current_scope": 1,
        })
        groups = {item["cnae_class_prefix"]: item for item in report["classes"]}
        self.assertEqual(groups["1061"]["active_establishments_any_code"], 2)
        self.assertEqual(groups["1061"]["active_establishments_primary_code"], 2)
        self.assertEqual(groups["1061"]["active_establishments_outside_current_scope"], 1)
        self.assertEqual(groups["4621"]["active_establishments_any_code"], 1)
        self.assertEqual(groups["4621"]["active_establishments_primary_code"], 0)
        self.assertEqual(groups["4621"]["active_establishments_outside_current_scope"], 0)
        self.assertEqual(groups["4744"]["active_establishments_outside_current_scope"], 1)
        self.assertFalse(groups["1061"]["already_in_scope"])
        self.assertTrue(groups["4621"]["already_in_scope"])
        subclasses = {item["cnae_code"]: item for item in report["unselected_subclasses"]}
        self.assertNotIn("4621100", subclasses)
        self.assertEqual(subclasses["1061100"]["active_establishments_any_code"], 2)
        self.assertEqual(subclasses["1061100"]["active_establishments_primary_code"], 2)
        self.assertEqual(subclasses["1061100"]["active_establishments_outside_current_scope"], 1)
        self.assertEqual(subclasses["4744099"]["active_establishments_outside_current_scope"], 1)


if __name__ == "__main__":
    unittest.main()
