import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "geocode-candidates-cnefe.py"
SPEC = importlib.util.spec_from_file_location("geocode_candidates_cnefe", SCRIPT)
GEOCODER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GEOCODER)


class CnefeAddressMatchingTests(unittest.TestCase):
    def test_normalizes_accents_punctuation_and_case(self):
        self.assertEqual(GEOCODER.normalize("Avenida São João, 42"), "AVENIDA SAO JOAO 42")

    def test_splits_street_and_number_while_ignoring_neighborhood(self):
        company_address = GEOCODER.split_address("RUA PADRE CAFÉ, 487 VERA CRUZ")
        ibge_address = GEOCODER.parse_cnefe_address("Rua Padre Café, 487")
        self.assertEqual(company_address, ("RUA PADRE CAFE", "487"))
        self.assertEqual(company_address, ibge_address)

    def test_does_not_infer_number_when_address_has_none(self):
        self.assertEqual(GEOCODER.split_address("ESTRADA RURAL S/N"), ("ESTRADA RURAL", ""))

    def test_key_uses_receita_address_components_and_canonical_street_type(self):
        row = {"municipality_code_ibge":"3106200", "postal_code":"30.285-340", "address_type":"R", "street_name":"Padre Café", "street_number":"487"}
        self.assertEqual(GEOCODER.candidate_key(row), ("3106200", "30285340", "RUA PADRE CAFE", "487"))

    def test_key_removes_repeated_terminal_property_number_from_street_name(self):
        row = {"municipality_code_ibge":"3106200", "postal_code":"30.285-340", "address_type":"AVENIDA", "street_name":"Barão do Indaiá  919", "street_number":"919"}
        self.assertEqual(GEOCODER.candidate_key(row), ("3106200", "30285340", "AVENIDA BARAO DO INDAIA", "919"))

    def test_key_preserves_kilometer_number_in_rural_road_name(self):
        row = {"municipality_code_ibge":"3106200", "postal_code":"35.177-000", "address_type":"RUA", "street_name":"BR 381 KM 274", "street_number":"274"}
        self.assertEqual(GEOCODER.candidate_key(row), ("3106200", "35177000", "RUA BR 381 KM 274", "274"))

    def test_canonicalizes_common_street_type_abbreviations(self):
        self.assertEqual(GEOCODER.normalize_street("AV. Rio Branco"), "AVENIDA RIO BRANCO")

    def test_number_is_taken_from_cnefe_comma_delimited_address(self):
        self.assertEqual(GEOCODER.parse_cnefe_address("RUA 5, 200"), ("RUA 5", "200"))

    def test_preserves_letter_suffix_to_avoid_matching_a_different_building(self):
        self.assertEqual(GEOCODER.split_address("Rua Alfa, 10A"), ("RUA ALFA", "10A"))
        self.assertNotEqual(GEOCODER.normalize_number("10"), GEOCODER.normalize_number("10A"))


if __name__ == "__main__":
    unittest.main()
