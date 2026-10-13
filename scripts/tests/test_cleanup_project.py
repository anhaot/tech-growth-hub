"""Exercise cleanup only in temporary projects, including optimized Python."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'cleanup-project.py'


class CleanupProjectTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.write('mobile/package.json', json.dumps({'version': '1.2.8'}))
        self.write('scripts/cleanup-project.py', SCRIPT.read_text())

    def write(self, relative, content='generated'):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def run_cleanup(self, *args, optimized=False):
        return subprocess.run([sys.executable, *(['-O'] if optimized else []),
                               str(self.root / 'scripts/cleanup-project.py'), *args],
                              text=True, capture_output=True, check=False)

    def verified_apk(self):
        apk = self.write('output/android/tech-growth-hub-v1.2.8-arm64.apk')
        return self.write('output/android/apk-v1.2.8-verification.json', json.dumps({
            'version': '1.2.8', 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        }))

    def test_custom_retained_version_and_current_artifacts(self):
        for version in ['1.2.5', '1.2.7', '1.2.8']:
            self.write(f'output/android/tech-growth-hub-v{version}-arm64.apk')
            self.write(f'output/android/build-v{version}.log')
            self.write(f'output/playwright/app-v{version.replace(".", "")}.png')
        result = self.run_cleanup('--keep-apk', '1.2.5')
        self.assertEqual(result.returncode, 0, result.stderr)
        paths = {item['path'] for item in json.loads(result.stdout)['items']}
        self.assertEqual(paths, {
            'output/android/tech-growth-hub-v1.2.7-arm64.apk',
            'output/android/build-v1.2.7.log', 'output/playwright/app-v127.png',
        })
        self.assertTrue((self.root / 'output/android/build-v1.2.7.log').exists())

    def test_backup_and_verification_files_are_preserved(self):
        for name in ['backup-v125.json', 'backup-v125.md', 'question-audit-v125.md',
                     'apk-v125-verification.json', 'signature-v125.txt']:
            self.write(f'output/playwright/{name}')
        self.write('output/playwright/temporary.png')
        result = self.run_cleanup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([item['path'] for item in json.loads(result.stdout)['items']],
                         ['output/playwright/temporary.png'])

    def test_optimized_python_cannot_bypass_missing_apk(self):
        generated = self.write('mobile/dist/bundle.js')
        result = self.run_cleanup('--apply', optimized=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Build and verify the current APK', result.stderr)
        self.assertTrue(generated.exists())

    def test_default_retains_newest_older_installed_apk(self):
        for version in ['1.2.6', '1.2.7', '1.2.8', '1.2.10']:
            self.write(f'output/android/tech-growth-hub-v{version}-arm64.apk')
        result = self.run_cleanup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['keepAPKVersions'], ['1.2.7', '1.2.8'])

    def test_optimized_python_cannot_bypass_checksum(self):
        verification = self.verified_apk()
        verification.write_text(json.dumps({'version': '1.2.8', 'sha256': 'wrong'}))
        generated = self.write('mobile/dist/bundle.js')
        result = self.run_cleanup('--apply', optimized=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('APK checksum must match', result.stderr)
        self.assertTrue(generated.exists())

    def test_generated_symlink_ancestor_does_not_delete_data(self):
        self.verified_apk()
        data = self.write('data/app/build/source.txt', 'keep this')
        (self.root / 'mobile/android').symlink_to(self.root / 'data', target_is_directory=True)
        result = self.run_cleanup('--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(data.read_text(), 'keep this')

    def test_verified_apply_removes_only_planned_generated_files(self):
        self.verified_apk()
        previous = self.write('output/android/tech-growth-hub-v1.2.5-arm64.apk')
        obsolete = self.write('output/android/tech-growth-hub-v1.2.7-arm64.apk')
        generated = self.write('mobile/dist/bundle.js')
        backup = self.write('output/playwright/database-backup.json')
        result = self.run_cleanup('--apply', '--keep-apk', '1.2.5')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(previous.exists())
        self.assertFalse(obsolete.exists())
        self.assertFalse(generated.exists())
        self.assertTrue(backup.exists())
        alias = self.root / 'output/android/tech-growth-hub-preview-arm64.apk'
        self.assertEqual(alias.resolve().name, 'tech-growth-hub-v1.2.8-arm64.apk')

    def test_invalid_retained_version_is_rejected(self):
        result = self.run_cleanup('--keep-apk', '../data')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('major.minor.patch', result.stderr)


if __name__ == '__main__':
    unittest.main()
