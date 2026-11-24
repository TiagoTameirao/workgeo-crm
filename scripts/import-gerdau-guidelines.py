"""Extract a versioned, page-addressable catalogue from the user-supplied manual."""
import hashlib
import json
import re
import sys
from pathlib import Path
import fitz

source = Path(sys.argv[1])
document = fitz.open(source)
toc = document.get_toc()
pages = []
for i, page in enumerate(document):
    raw = page.get_text()
    raw = re.sub(r"(?s)^.*?Versão: 06/ Ano: 2025", "", raw, count=1)
    pages.append({"page": i + 1, "text": re.sub(r"[ \t]+", " ", raw).strip()})
entries = []
for pos, (level, title, start) in enumerate(toc):
    match = re.match(r"^(2\.5\.\d+|[567]\.\d+\.\d+)\.?\s+(.+)", title)
    if not match or len(match[2].strip()) < 5:
        continue
    end = next((p for depth, _, p in toc[pos + 1:] if depth <= level and p > start), len(document))
    end = min(end, len(document))
    portal = "Ariba" if match[1].startswith("2.") else "Banco Doc"
    entries.append({"id": match[1] + "-p" + str(start), "section": match[1], "title": match[2].strip(), "portal": portal, "module": match[1].split('.')[0], "pages": pages[start - 1:end]})
payload = {"id": "gerdau-06-2025", "version": "06/2025", "source_filename": source.name, "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source_url": "https://www2.gerdau.com.br/wp-content/uploads/2025/05/manual_de_qualificacao_e_acesso_de_prestadores_de_servicos-_unificado_v-_6-0425-1.pdf", "imported_at": "2026-11-13", "current_version_confirmed": False, "general": {"Ariba": pages[36], "Banco Doc": pages[109]}, "entries": entries}
target = Path(__file__).resolve().parent.parent / "data" / "gerdau-guidelines.json"
target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"entries": len(entries), "pages": len(document), "sha256": payload["source_sha256"]}))
