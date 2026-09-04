"""Package prepared local Genie components reproducibly; never downloads or sets trust pins."""
import hashlib
import argparse
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.release' / 'genie-components'
OUTPUT = ROOT / '.release' / 'genie-archives'
TIERS = ('genie-tts', 'genie-data', 'voice-genie-mika')
VERSIONS = {'genie-tts': '1.0.1', 'genie-data': '1.0.0', 'voice-genie-mika': '1.0.0'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tier', choices=TIERS, action='append')
    selected = parser.parse_args().tier or TIERS
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = {}
    for tier in selected:
        source = SOURCE / tier
        files = sorted(p for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
        if not files or not (source / 'LICENSE.txt').is_file():
            raise RuntimeError('Missing component or license')
        version = VERSIONS[tier]
        archive = OUTPUT / f'{tier}-{version}.zip'
        total = 0
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
            for file in files:
                if file.is_symlink() or not file.resolve().is_relative_to(source.resolve()):
                    raise RuntimeError('Unexpected link')
                size = file.stat().st_size
                total += size
                # The installer selects the target; ZIP paths are relative to that component.
                info = zipfile.ZipInfo(file.relative_to(source).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                with file.open('rb') as src, out.open(info, 'w') as dst:
                    while chunk := src.read(1024 * 1024):
                        dst.write(chunk)
        with archive.open('rb') as src:
            digest = hashlib.file_digest(src, 'sha256').hexdigest()
        records[tier] = {'version': version, 'target': tier, 'sha256': digest, 'compressedBytes': archive.stat().st_size, 'extractedBytes': total, 'maxEntries': len(files)}
        print(tier, records[tier], flush=True)
    report = 'measurements.json' if len(selected) == len(TIERS) else 'measurements-selected.json'
    (OUTPUT / report).write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
