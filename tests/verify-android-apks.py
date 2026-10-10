"""Inspect built packages, not Gradle source, before publishing a staging APK."""
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
tools = sorted((Path(os.environ['ANDROID_HOME']) / 'build-tools').glob('*/aapt'))
assert tools, 'Android aapt is required'
aapt = str(tools[-1])
apksigner = str(tools[-1].with_name('apksigner'))
source_config = (root / 'website/app-config.js').read_bytes()
staging_config = (root / 'android/app/src/staging/assets/www/app-config.js').read_bytes()
evidence = []
for flavor, package, label, scheme, config in [
    ('production', 'ge.evex.meetab', 'MeeTab', 'meetab', source_config),
    ('staging', 'ge.evex.meetab.staging', 'MeeTab Staging', 'meetab-staging', staging_config),
]:
    apk = root / f'android/app/build/outputs/apk/{flavor}/debug/app-{flavor}-debug.apk'
    badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
    manifest = subprocess.check_output([aapt, 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
    assert f"package: name='{package}'" in badging
    assert f"application-label:'{label}'" in badging
    assert 'android:scheme' in manifest and f'="{scheme}"' in manifest
    for attribute in ['allowBackup', 'usesCleartextTraffic']:
        assert re.search(r'android:' + attribute + r'[^\n]*=\(type 0x12\)0x0\b', manifest), attribute + ' must be false'
    subprocess.run([apksigner, 'verify', str(apk)], check=True, stdout=subprocess.DEVNULL)
    with zipfile.ZipFile(apk) as archive:
        assert archive.read('assets/www/app-config.js') == config, f'{flavor} backend configuration mismatch'
        for item in ['index.html', 'auth.js', 'auth-return.html']:
            assert archive.read('assets/www/' + item) == (root / 'website' / item).read_bytes()
        assert not any(name.endswith(('.enc', '.keystore', '.jks', '.env')) for name in archive.namelist())
    evidence.append({'flavor': flavor, 'package': package, 'label': label, 'auth_scheme': scheme,
                     'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'signature': 'verified debug signature'})
assert b'meetab-staging' not in source_config, 'Production source config must stay unchanged'
release = root / 'android/app/build/outputs/apk/production/release/app-production-release-unsigned.apk'
assert release.is_file(), 'Release compilation must pass; owner signing remains pending'
summary = {'source_revision': os.environ.get('MEETAB_SOURCE_REVISION'), 'packages': evidence,
           'release_status': 'unsigned build only; not an installable owner-signed release'}
(root / 'android/app/build/apk-evidence.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
