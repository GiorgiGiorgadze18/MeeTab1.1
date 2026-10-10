# MeeTab staging APK

This build candidate separates tablet testing from the existing installation. It is not an owner-signed release.

| Variant | Package | OAuth return | Backend |
| --- | --- | --- | --- |
| production | `ge.evex.meetab` | `meetab://auth` | Existing website configuration |
| staging | `ge.evex.meetab.staging` | `meetab-staging://auth` | Public staging service |

## Build and evidence
Build with Gradle 8.10.2, Java 17 and Android SDK 35:

```sh
cd android
gradle :app:assembleStagingDebug :app:assembleProductionDebug :app:assembleProductionRelease --no-daemon
cd ..
python3 tests/verify-android-apks.py
```

CI packages the exact PR head. The built-APK check compares bundled configs/scripts with source, verifies each package/label/return scheme and debug signature, and emits SHA-256 checksums. Target SDK is 35, matching compile SDK; minimum SDK remains 23. This resolves the release lint failure for the previous target SDK 32 without disabling lint. The production release build is unsigned and cannot substitute for owner-controlled release signing. Generated web assets live only in `build/`; source website configuration is not overwritten.

## Activation and physical test
1. Obtain owner approval for the dependent PR into the integrated preview branch, then deploy that exact approved revision to staging. The backend must enable preview mode before it accepts staging app OAuth. Keep production untouched.
2. Install **MeeTab Staging** on a private Android test tablet. Its separate package/storage preserve the existing MeeTab installation. Perform supervised device-passphrase enrollment before public placement.
3. Sign in through the external browser; confirm the return opens MeeTab Staging, even with the older app installed. Select the approved room calendar and check phone-to-tablet refresh, 15/30-minute bookings and resume/offline recovery. On Android 15+, verify fullscreen/insets, system bars and touch placement after the target SDK update.
4. Read the already-saved IT recipient without changing it. Real mail delivery remains pending until an approved sender is connected.
5. Roll back tablet testing by removing only MeeTab Staging. Its local settings are separate; server-side saved recipient data is retained. A new CI debug build may have a different debug signing certificate, so it may require uninstall/re-enrollment. Official upgrades need one owner-controlled signing key.

No physical-device result or authenticated staging-app result is claimed by the build checks. Deployment, installed-artifact verification, signed release and device QA are separate evidence levels.

## Sign-in compatibility for 1.1.2

Use the updated web frontend or APK with the matching backend. Each sign-in creates a private random proof in the initiating tab/WebView; its SHA-256 challenge is sent at OAuth start and the private proof is required when exchanging the one-time return ticket. The existing provider PKCE, callback URLs, Android return schemes and room/calendar selection are retained. No additional environment variable or OAuth scope is required.

Older APKs/pages without this proof cannot start a fresh sign-in against the updated backend. Refresh hosted pages or install the updated staging APK before testing browser return. Keep the previous backend/APK pair for rollback. Validate successful return, a cancelled/restarted login, logout and resume on the physical tablet; automated mock-provider tests cover matching proof, copied/injected tickets, replay, wrong mode/origin and invalid input.
