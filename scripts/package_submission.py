"""Package the reviewed prototype and competition material without secrets/build caches."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deliverables' / 'ascension-smartwalk-submission.zip'
files = [ROOT / name for name in ['README.md', 'LICENSE', 'package.json', 'package-lock.json', '.env.example', '.gitattributes']]
for folder in ['public', 'src', 'data', 'tests', 'scripts', 'drizzle']:
    files += [p for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
for name in ['ascension-smartwalk-presentation.pptx', 'ascension-smartwalk-presentation.pdf',
             'ascension-smartwalk-tests-and-limitations.pdf', 'START-HERE.txt']:
    files.append(ROOT / 'deliverables' / name)
for name in ['concept.md', 'ethics.md', 'integrations.md', 'watch.md', 'test-protocol.md', 'test-protocol.json', 'runtime-verification.json', 'verified-evidence.json']:
    p = ROOT / 'docs' / name
    if p.exists(): files.append(p)
for name in ['video-qa.json', 'captions-ru.srt', 'narration-ru.txt']:
    p = ROOT / 'video' / name
    if p.exists(): files.append(p)

with zipfile.ZipFile(OUT, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for p in sorted(set(files)):
        archive.write(p, p.relative_to(ROOT))
with zipfile.ZipFile(OUT) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert 'README.md' in names and 'data/pois.json' in names
    assert all(not any(x in Path(n).parts for x in ['.git', 'node_modules', 'tmp', '.build']) for n in names)
manifest = {'file': OUT.name, 'bytes': OUT.stat().st_size,
            'sha256': hashlib.sha256(OUT.read_bytes()).hexdigest(), 'files': names}
(ROOT / 'deliverables' / 'submission-package-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in manifest.items() if k != 'files'}))
