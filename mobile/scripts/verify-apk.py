import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

def require(condition, message):
    # Release verification must also run with PYTHONOPTIMIZE or python -O.
    if not condition:
        raise SystemExit(f'APK verification failed: {message}')


parser = argparse.ArgumentParser(description='Verify APK version, signing, permissions and embedded code.')
parser.add_argument('--apk', type=Path, help='APK file; defaults to output/android for the package version')
parser.add_argument('--sdk', type=Path, help='Android SDK root or a build-tools directory; defaults to ANDROID_HOME/ANDROID_SDK_ROOT')
parser.add_argument('--allow-first-release', action='store_true', help='Allow verification without a prior signing record for an initial release')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
version = json.loads((root / 'mobile/package.json').read_text())['version']
version_code = int(re.search(r'versionCode:\s*(\d+)', (root / 'mobile/app.config.ts').read_text())[1])
apk = (args.apk or root / f'output/android/tech-growth-hub-v{version}-arm64.apk').resolve()
require(apk.is_file(), f'APK does not exist: {apk}')
sdk = args.sdk or Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or Path.home() / '.cache/tgh-android-sdk')
if not (sdk / 'aapt').is_file():
    build_tools = sdk / 'build-tools'
    candidates = [candidate for candidate in build_tools.glob('*')
                  if re.fullmatch(r'\d+(\.\d+)*', candidate.name)
                  and (candidate / 'aapt').is_file() and (candidate / 'apksigner').is_file()]
    require(candidates, f'No complete Android build-tools installation under {sdk}')
    sdk = max(candidates, key=lambda candidate: tuple(int(part) for part in candidate.name.split('.')))
require((sdk / 'aapt').is_file() and (sdk / 'apksigner').is_file(), f'Missing aapt or apksigner under {sdk}')
badging = subprocess.check_output([str(sdk / 'aapt'), 'dump', 'badging', str(apk)], text=True)
xml = subprocess.check_output([str(sdk / 'aapt'), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
env = dict(os.environ, JAVA_TOOL_OPTIONS='-Xmx128m -XX:ActiveProcessorCount=1 -XX:+UseSerialGC')
signature = subprocess.check_output([str(sdk / 'apksigner'), 'verify', '--print-certs', str(apk)], text=True, env=env)
certificate = re.search(r'certificate SHA-256 digest: (\w+)', signature)[1]
previous_releases = [json.loads(path.read_text()) for path in apk.parent.glob('apk-v*-verification.json')]
previous_releases = [record for record in previous_releases if record.get('versionCode', 0) < version_code and record.get('certificateSHA256')]
require(previous_releases or args.allow_first_release, 'Keep a previous release verification record to verify upgrade signing; use --allow-first-release only for an initial release')
previous = max(previous_releases, key=lambda record: record['versionCode']) if previous_releases else None
patterns = {
    'sqlite': b'expo/modules/sqlite/SQLiteModule',
    'filesystem': b'expo/modules/filesystem/FileSystemModule',
    'sharing': b'expo/modules/sharing/SharingModule',
    'keyboard': b'com/reactnativekeyboardcontroller',
    'gestures': b'com/swmansion/gesturehandler',
    'expoUI': b'expo/modules/ui/',
}
modules = {name: False for name in patterns}
with zipfile.ZipFile(apk) as archive:
    names = archive.namelist()
    architectures = sorted({name.split('/')[1] for name in names if name.startswith('lib/') and name.endswith('.so')})
    for name in names:
        if re.fullmatch(r'classes\d*\.dex', name):
            dex = archive.read(name)
            for module, pattern in patterns.items():
                modules[module] = modules[module] or pattern in dex
    bundle = archive.read('assets/index.android.bundle')
manifest = {
    'version': re.search(r"versionName='([^']+)'", badging)[1],
    'versionCode': int(re.search(r"versionCode='(\d+)'", badging)[1]),
    'minSdk': int(re.search(r"sdkVersion:'(\d+)'", badging)[1]),
    'targetSdk': int(re.search(r"targetSdkVersion:'(\d+)'", badging)[1]),
    'cleartextHTTP': bool(re.search(r'usesCleartextTraffic.*0xffffffff', xml)),
    'debuggable': 'application-debuggable' in badging,
    'sharingFileProvider': 'SharingFileProvider' in xml,
    'filesystemFileProvider': 'FileSystemFileProvider' in xml,
    'storagePermissions': bool(re.search(r"uses-permission: name='android.permission.(READ|WRITE)_EXTERNAL_STORAGE'", badging)),
}
require(manifest['version'] == version and manifest['versionCode'] == version_code, 'Manifest version/versionCode must match package.json and app.config.ts')
require(manifest['cleartextHTTP'] and not manifest['debuggable'], 'HTTP support must be enabled and the release must not be debuggable')
require(manifest['sharingFileProvider'] and manifest['filesystemFileProvider'], 'Missing file sharing providers')
require(not manifest['storagePermissions'], 'Unexpected external storage permissions')
require(architectures == ['arm64-v8a'], f'Unexpected native architectures: {architectures}')
require(all(value for key, value in modules.items() if key != 'expoUI') and not modules['expoUI'], f'Unexpected native modules: {modules}')
if previous:
    require(certificate == previous['certificateSHA256'], 'Signature must preserve upgrades from the previous release')
require(bundle[:8].hex() == 'c61fbc03c103191f', 'Release APK must contain compiled Hermes bytecode')
require(bundle == (root / 'mobile/android/app/build/generated/assets/react/release/index.android.bundle').read_bytes(), 'APK must contain the freshly generated bundle')
sourcemap = json.loads((root / 'mobile/android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map').read_text())
contents = {source: content or '' for source, content in zip(sourcemap['sources'], sourcemap['sourcesContent'])}
def source_content(suffix):
    matches = [content for source, content in contents.items() if source.endswith(suffix)]
    require(matches, f'Missing embedded source: {suffix}')
    return matches[0]
source_checks = {
    'readerSelectionDisabled': 'selectable={false}' in source_content('src/screens/Reader.tsx'),
    'compactMetadataAndBookmark': 'headerRight:' in source_content('src/screens/Reader.tsx') and 'question-header' in source_content('src/screens/Reader.tsx'),
    'offlineUpdateMode': 'updateMode' in source_content('src/study-repository.ts') and 'automatic: true' in source_content('src/study.tsx'),
    'dedicatedAIShortcut': 'suggestion.action,' in source_content('src/screens/AI.tsx') and 'canChat ? "chat" : suggestion.action' not in source_content('src/screens/AI.tsx'),
    'emptyAnswerDiagnostics': 'AIEmptyAnswerError' in source_content('src/api.ts') and '分享诊断信息' in source_content('src/screens/AI.tsx'),
    'profileUsesRNSettingRow': 'SettingRow' in source_content('src/screens/Profile.tsx') and '@expo/ui' not in source_content('src/screens/Profile.tsx'),
    'stableReaderButtons': 'stableDisabled' in source_content('src/screens/Reader.tsx'),
    'keyboardHeaderOffset': 'keyboardVerticalOffset' in source_content('src/screens/AI.tsx') and 'headerHeight' in source_content('src/screens/AI.tsx'),
    'singleAndBatchExport': 'exportOne' in source_content('src/screens/AI.tsx') and 'AIExport' in source_content('src/screens/AI.tsx'),
    'persistentArchive': 'saveAIReply' in source_content('src/study-repository.ts'),
    'serializedArchiveWrites': 'aiWrites' in source_content('src/study-repository.ts'),
    'focusOutline': 'outlineWidth' in source_content('src/screens/AI.tsx'),
    'contextModelMenu': 'ModelSheet' in source_content('src/screens/StudySettings.tsx') and 'ModelSheet' in source_content('src/screens/ModelEditor.tsx'),
    'rejectEmptyAnswer': 'answerText' in source_content('src/api.ts') and '没有返回回答正文' in source_content('src/api.ts'),
    'modelInConversation': '切换答疑模型' in source_content('src/screens/AI.tsx'),
    'literalCommandQuotes': 'typographer: false' in source_content('src/study-markdown-parser.ts'),
    'formattedQuestionTitle': 'variant="title"' in source_content('src/screens/Reader.tsx'),
    'indentedCodeScroll': 'code_block:' in source_content('src/components/Markdown.tsx'),
    'nativeModelEditor': 'ModelEditorScreen' in source_content('src/screens/ModelEditor.tsx') and 'saveAIConfig' in source_content('src/screens/ModelEditor.tsx'),
    'failedModelReadProtected': '!loaded' in source_content('src/screens/ModelEditor.tsx') and 'setRefresh' in source_content('src/screens/ModelEditor.tsx'),
    'longParagraphWidth': 'maxWidth: "100%"' in source_content('src/components/Markdown.tsx') and 'flexShrink: 1' in source_content('src/components/Markdown.tsx'),
    'blankKeyPreservation': 'apiKey' in source_content('src/model-config.ts'),
    'answerListLayout': 'markdown-list-item' in source_content('src/components/Markdown.tsx') and 'formatStudyMarkdown' in source_content('src/components/Markdown.tsx'),
    'continuationUI': '继续补全回答' in source_content('src/screens/AI.tsx') and 'retryRequest' in source_content('src/screens/AI.tsx'),
    'customTabBar': 'AppTabBar' in source_content('src/components/TabBar.tsx'),
}
source_checks.update({
    'questionEditorAndDeletion': 'repository.updateQuestion' in source_content('src/components/QuestionActions.tsx') and 'repository.deleteQuestion' in source_content('src/components/QuestionActions.tsx'),
    'batchBookmarks': 'repository.removeBookmarks' in source_content('src/screens/Bookmarks.tsx'),
    'deleteAIRecords': 'onDelete(items.map' in source_content('src/components/AIExport.tsx') and 'deleteAIReplies' in source_content('src/study-repository.ts'),
    'archiveAndConversationDeletion': 'setMessages((current) => current.filter' in source_content('src/screens/AI.tsx'),
})
source_checks['fieldAISupplement'] = 'AI补充${label}' in source_content('src/components/QuestionActions.tsx') and 'api.supplementQuestion' in source_content('src/components/QuestionActions.tsx') and '采用补充结果' in source_content('src/components/QuestionActions.tsx')
require(all(source_checks.values()), f'Embedded source checks failed: {[name for name, passed in source_checks.items() if not passed]}')
with apk.open('rb') as stream:
    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
try:
    checksum_path = apk.relative_to(root)
except ValueError:
    checksum_path = apk
(apk.parent / f'apk-v{version}-signature.txt').write_text(signature)
(apk.parent / f'SHA256SUMS-v{version}.txt').write_text(f'{sha}  {checksum_path}\n')
record = {**manifest, 'bytes': apk.stat().st_size, 'sha256': sha, 'architectures': architectures,
          'modules': modules, 'bundleBytes': len(bundle), 'embeddedSourceChecks': source_checks,
          'certificateSHA256': certificate, 'signatureMatchesPreviousRelease': bool(previous),
          'deviceVerified': False, 'cpuLimitCores': 1, 'gradleAndMetroWorkers': 1, 'ninjaJobs': 1,
          'buildLogs': [name for name in [f'build-v{version}-bundle.log', f'build-v{version}-package.log'] if (apk.parent / name).exists()]}
(apk.parent / f'apk-v{version}-verification.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False, indent=2))
