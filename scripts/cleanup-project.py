"""Remove generated project files, retaining current/previous APKs and data backups."""
import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def apk_version(value):
    if not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise argparse.ArgumentTypeError('APK versions must use major.minor.patch')
    return value

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apply', action='store_true', help='Delete listed generated files; default is dry run')
parser.add_argument('--keep-apk', type=apk_version, help='APK version to retain; defaults to the newest older installed APK')
args = parser.parse_args()
version = apk_version(json.loads((ROOT / 'mobile/package.json').read_text())['version'])
installed_versions = [match[1] for path in (ROOT / 'output/android').glob('tech-growth-hub-v*-arm64.apk')
                      if (match := re.fullmatch(r'tech-growth-hub-v(\d+\.\d+\.\d+)-arm64\.apk', path.name))]
version_order = lambda value: tuple(map(int, value.split('.')))
previous_versions = [value for value in installed_versions if version_order(value) < version_order(version)]
previous = args.keep_apk or (max(previous_versions, key=version_order) if previous_versions else None)
keep_versions = {version, *([previous] if previous else [])}
candidates = []


def safe_path(path):
    check(path.is_relative_to(ROOT), 'Cleanup paths must stay within this project')
    # A generated directory may have been replaced with a link to source/data.
    return not any(part.is_symlink() for part in [path, *path.parents] if part.is_relative_to(ROOT))


def add(path):
    path = Path(path)
    if path.exists() and safe_path(path):
        check(path.resolve().is_relative_to(ROOT), 'Cleanup paths must stay within this project')
        candidates.append(path)


def retained_artifact(name):
    return any(re.search(r'v' + re.escape(value) + r'(?!\d|\.\d)', name)
               or re.search(r'v' + value.replace('.', '') + r'(?!\d)', name)
               for value in keep_versions)

for relative in ['.playwright-cli', 'web/playwright-report', 'web/test-results',
                 'mobile/android/app/build', 'mobile/android/app/.cxx', 'mobile/android/build',
                 'mobile/android/.gradle', 'mobile/.expo', 'mobile/dist']:
    add(ROOT / relative)
add(ROOT / 'output/playwright/.playwright-cli')
# Dependencies are retained; only native compilation output is removed.
for package in (ROOT / 'mobile/node_modules').glob('*'):
    packages = package.iterdir() if package.name.startswith('@') and package.is_dir() else [package]
    for target in packages:
        for generated in ['android/build', 'android/.cxx']:
            add(target / generated)

for apk in (ROOT / 'output/android').glob('*.apk'):
    match = re.fullmatch(r'tech-growth-hub-v([\d.]+)-arm64\.apk', apk.name)
    if match and match[1] not in keep_versions:
        add(apk)
    elif apk.name == 'tech-growth-hub-preview-arm64.apk':
        add(apk)  # Replaced by a symlink below to avoid a duplicate binary.

for directory in [ROOT / 'output/android', ROOT / 'output/playwright']:
    if not directory.exists():
        continue
    for file in directory.iterdir():
        if not file.is_file():
            continue
        if retained_artifact(file.name):
            continue
        # Keep backup/audit data, verification JSON and signing/checksum records.
        if re.search(r'backup|audit|signature|verification|SHA256SUMS', file.name, re.I):
            continue
        generated_suffixes = {'.log', '.sh', '.py', '.js', '.mjs', '.patch', '.png', '.ndjson', '.md', '.html'}
        old_version = re.search(r'v\d+\.\d+\.\d+(?!\d|\.\d)|v\d{3,}(?!\d)', file.name)
        if file.suffix in generated_suffixes and (old_version or directory.name == 'playwright'):
            add(file)
for directory in ROOT.rglob('__pycache__'):
    if 'node_modules' not in directory.parts:
        add(directory)
for relative in ['output/server-v261011-1', 'output/server-v261011-2',
                 'output/server-v261011-1.tar.gz', 'output/server-v261011-2.tar.gz',
                 'output/android/resource-limits-v1.2.2.gradle']:
    add(ROOT / relative)

# Ensure parent directories account for descendants only once.
paths = []
for path in sorted(set(candidates), key=lambda p: (len(p.parts), str(p))):
    if not any(path.is_relative_to(parent) for parent in paths):
        paths.append(path)

def size(path):
    if path.is_file():
        return path.stat().st_size
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file() and not p.is_symlink())

record = {'applied': args.apply, 'keepAPKVersions': sorted(keep_versions),
          'items': [{'path': str(p.relative_to(ROOT)), 'bytes': size(p)} for p in paths]}
record['bytesRemoved' if args.apply else 'bytesToRemove'] = sum(item['bytes'] for item in record['items'])
if args.apply:
    latest = ROOT / f'output/android/tech-growth-hub-v{version}-arm64.apk'
    check(latest.is_file() and safe_path(latest), 'Build and verify the current APK before cleaning')
    verification_path = latest.parent / f'apk-v{version}-verification.json'
    check(safe_path(verification_path), 'APK verification must not use a symlink')
    verification = json.loads(verification_path.read_text())
    check(verification['version'] == version, 'Verify current APK before cleaning')
    with latest.open('rb') as stream:
        check(hashlib.file_digest(stream, 'sha256').hexdigest() == verification['sha256'], 'APK checksum must match verification')
    alias = latest.parent / 'tech-growth-hub-preview-arm64.apk'
    check(not alias.is_dir(), 'Preview APK alias must not be a directory')
    free_before = shutil.disk_usage(ROOT).free
    for path in paths:
        check(safe_path(path), 'Cleanup path changed to a symlink; rerun the dry run')
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    if alias.is_symlink():
        alias.unlink()
    alias.symlink_to(latest.name)
    record['filesystemFreeBytesBefore'] = free_before
    record['filesystemFreeBytesAfter'] = shutil.disk_usage(ROOT).free
    record['filesystemBytesFreed'] = record['filesystemFreeBytesAfter'] - free_before
    date = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    (ROOT / f'output/cleanup-{date}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False, indent=2))
