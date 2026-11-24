import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import importlib.util

spec = importlib.util.spec_from_file_location(
    "build_cnpj_prospects", Path(__file__).resolve().parents[1] / "scripts" / "build-cnpj-prospects.py"
)
prospects = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = prospects
spec.loader.exec_module(prospects)


class FakeResponse(io.BytesIO):
    def __init__(self, body, status, headers):
        super().__init__(body)
        self.status = status
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


class DownloadResumeTests(unittest.TestCase):
    def test_interrupted_download_resumes_from_existing_bytes(self):
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("content.csv", "codigo;descricao\n1;teste\n")
        content = archive_buffer.getvalue()
        split = 100
        calls = []

        def open_response(request, timeout):
            self.assertEqual(timeout, 120)
            byte_range = request.get_header("Range")
            calls.append(byte_range)
            if byte_range is None:
                return FakeResponse(content[:split], 200, {})
            self.assertEqual(byte_range, f"bytes={split}-")
            end = len(content) - 1
            return FakeResponse(content[split:], 206, {"Content-Range": f"bytes {split}-{end}/{len(content)}"})

        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(prospects.urllib.request, "urlopen", side_effect=open_response), \
                patch.object(prospects.time, "sleep"):
            result = prospects.download_one("2026-10", "fixture.zip", len(content), Path(temporary))

            self.assertEqual(result.read_bytes(), content)
            self.assertEqual(calls, [None, f"bytes={split}-"])
            self.assertFalse(result.with_suffix(".zip.part").exists())

    def test_complete_cached_archive_skips_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "fixture.zip"
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
                output.writestr("content.csv", "ok\n")
            with patch.object(prospects.urllib.request, "urlopen") as open_response:
                result = prospects.download_one("2026-10", archive.name, archive.stat().st_size, Path(temporary))
            self.assertEqual(result, archive)
            open_response.assert_not_called()

    def test_corrupt_cached_archive_is_replaced_even_when_size_matches(self):
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as output:
            output.writestr("content.csv", "ok\n")
        content = archive_buffer.getvalue()
        corrupt = b"x" * len(content)

        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / "fixture.zip"
            archive_path.write_bytes(corrupt)
            with patch.object(
                prospects.urllib.request, "urlopen",
                return_value=FakeResponse(content, 200, {}),
            ):
                result = prospects.download_one("2026-10", archive_path.name, len(content), Path(temporary))

            self.assertEqual(result.read_bytes(), content)
            prospects.validate_zip_header(result)


class CnaeMatchingTests(unittest.TestCase):
    def test_matched_category_preserves_tier_for_candidate_classification(self):
        categories = [
            {"id": "mining", "label": "Mineração", "tier": "Aderência direta a validar", "cnae_prefixes": ["071"]},
            {"id": "warehouse", "label": "Armazenagem", "tier": "Aderência adjacente a revisar", "cnae_prefixes": ["521"]},
        ]
        matches = prospects.matched_category_details(["0710301", "5211701", "0000000"], {
            "0710301": "Extração de minério de ferro",
            "5211701": "Armazenamento",
        }, categories)

        self.assertEqual([item["tier"] for item in matches], [
            "Aderência direta a validar", "Aderência adjacente a revisar",
        ])
        self.assertEqual([item["code"] for item in matches[0]["codes"]], ["0710301"])

    def test_candidate_report_and_import_share_categories_without_mutating_source(self):
        candidate = {
            "cnpj": "AB123456789012",
            "cnpj_base": "AB123456",
            "company_name": "Empresa de teste",
            "unit_name": "Unidade de teste",
            "branch_type": "Matriz",
            "municipality": "Belo Horizonte",
            "address": "Rua de teste, 1",
            "phone": "3133334444",
            "email": "contato@example.com",
            "cnae_primary": "0710301",
            "cnae_primary_description": "Extração de minério de ferro",
            "categories": [{
                "id": "mining", "label": "Mineração", "tier": "Aderência direta a validar",
                "codes": [{"code": "0710301", "description": "Extração de minério de ferro"}],
            }],
        }
        prepared = prospects.csv_row(candidate, {"rfb_size_code": "01"}, "2026-10", "2026-10-13")
        report_row = prospects.serialize_candidate_csv_row(prepared)
        import_rows = prospects.crm_import_rows([prepared], "2026-10", "2026-10-13")

        self.assertEqual(prepared["scope_tier"], "Aderência direta a validar")
        self.assertEqual(report_row["categories"], "Mineração")
        self.assertIsInstance(prepared["categories"], list)
        self.assertEqual(import_rows[0]["materiais"], "Mineração")

    def test_import_sanitizes_registration_contact_fields(self):
        channels = prospects.import_contact_channels({
            "email": "WWW.EXAMPLE.COM.BR",
            "phone": "00000000000",
        })
        self.assertEqual(channels, {"email": "", "website": "https://WWW.EXAMPLE.COM.BR", "phone": ""})
        self.assertEqual(prospects.import_contact_channels({
            "email": "sales@example.com",
            "phone": "3133334444",
        }), {"email": "sales@example.com", "website": "", "phone": "3133334444"})


if __name__ == "__main__":
    unittest.main()
