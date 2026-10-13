import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'verify-apk.py'
MOBILE = SCRIPT.parent.parent
VERSION = json.loads((MOBILE / 'package.json').read_text())['version']
CERTIFICATE = 'a' * 64


class ApkVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sdk = self.root / 'sdk'
        self.tools = self.sdk / 'build-tools' / '100.0.0'
        self.tools.mkdir(parents=True)
        self.apk = self.root / 'app.apk'
        with zipfile.ZipFile(self.apk, 'w') as archive:
            archive.writestr('assets/index.android.bundle', bytes.fromhex('c61fbc03c103191f'))
            archive.writestr('lib/arm64-v8a/libapp.so', b'fixture')
            archive.writestr('classes.dex', b' '.join([
                b'expo/modules/sqlite/SQLiteModule', b'expo/modules/filesystem/FileSystemModule',
                b'expo/modules/sharing/SharingModule', b'com/reactnativekeyboardcontroller',
                b'com/swmansion/gesturehandler',
            ]))
        self.badging = "package: name='com.techgrowthhub.mobile' versionCode='1' versionName='incorrect'\nsdkVersion:'26'\ntargetSdkVersion:'36'"
        self.xml = 'usesCleartextTraffic 0xffffffff SharingFileProvider FileSystemFileProvider'
        self.write_tools()

    def write_tools(self):
        tools = {
            'aapt': f"print({self.badging!r} if sys.argv[2] == 'badging' else {self.xml!r})",
            'apksigner': f"print('Signer certificate SHA-256 digest: {CERTIFICATE}')",
        }
        for name, body in tools.items():
            target = self.tools / name
            target.write_text(f'#!{sys.executable}\nimport sys\n{body}\n')
            target.chmod(0o755)

    def previous_release(self, certificate=CERTIFICATE):
        (self.root / 'apk-v0-verification.json').write_text(json.dumps({
            'versionCode': 0, 'certificateSHA256': certificate,
        }))

    def run_verifier(self, *options):
        return subprocess.run([sys.executable, '-O', str(SCRIPT), '--apk', str(self.apk),
            '--sdk', str(self.sdk), *options], capture_output=True, text=True)

    def check_no_success_artifacts(self):
        self.assertFalse((self.root / f'apk-v{VERSION}-verification.json').exists())
        self.assertFalse((self.root / f'SHA256SUMS-v{VERSION}.txt').exists())
        self.assertFalse((self.root / f'apk-v{VERSION}-signature.txt').exists())

    def test_optimized_python_rejects_incorrect_manifest_version(self):
        self.previous_release()
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Manifest version/versionCode', result.stderr)
        self.check_no_success_artifacts()

    def test_optimized_python_requires_previous_signing_record(self):
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('previous release verification record', result.stderr)
        self.check_no_success_artifacts()

    def test_first_release_option_still_enforces_manifest_checks(self):
        result = self.run_verifier('--allow-first-release')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Manifest version/versionCode', result.stderr)
        self.check_no_success_artifacts()

    def test_optimized_python_and_first_release_option_cannot_skip_upgrade_signature(self):
        import re
        code = re.search(r'versionCode:\s*(\d+)', (MOBILE / 'app.config.ts').read_text())[1]
        self.badging = f"package: versionCode='{code}' versionName='{VERSION}'\nsdkVersion:'26'\ntargetSdkVersion:'36'"
        self.write_tools()
        self.previous_release('b' * 64)
        result = self.run_verifier('--allow-first-release')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Signature must preserve upgrades', result.stderr)
        self.check_no_success_artifacts()


if __name__ == '__main__':
    unittest.main()
