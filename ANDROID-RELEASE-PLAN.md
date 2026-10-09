# MeeTab — integrated Android APK validation and release checklist

_2026-10-10 · Preview PR #6. **No production release or signed APK yet.**_

## Packaging architecture

A single Android APK contains MeeTab's web UI, icons, 1280 × 800 tablet design, meeting-room navigation, booking overlay and IT Help interface. **Google/Microsoft calendars, OAuth, IT notification delivery and PostgreSQL stay server-side on HTTPS Render**, never as secrets compiled into the APK. An internet connection is required for live data. The default mode uses bundled website assets rather than Chrome; updating the GitHub Pages site alone does not update a deployed bundled Android app.

## Physical tablet owner setup (preview debug APK only)

1. Back up any testing notes. Install the **debug APK only on a private test tablet**; avoid room deployment until release signing, secrets review and device controls are approved.
2. On first launch, create a **unique device admin passphrase (10–128 characters)** and confirm it. This replaces the old hardcoded `2580` PIN. Setup must be supervised before public placement. The app stores a per-install salted PBKDF2 derived value, not the passphrase.
3. To enter local device settings, **long-press the top-left corner** and enter that device passphrase. Five failed attempts lock access for five minutes. After unlocking, you can change the device passphrase. Keep the new code secure; if it is lost, app-data reset/reinstall may be necessary, which can remove locally stored sign-in state.
4. In the Android native settings, keep the page URL pointed at the bundled app (unless intentionally testing the GitHub Pages hosted URL). Sign into Google using the Android external browser; verify return to MeeTab.
5. In a Google test calendar, create an event from a phone. Without touching the tablet, record when it first appears. Expected frontend *polling interval* is 20 seconds while visible, not a guaranteed maximum due to latency or provider propagation.
6. Book 15/30 minutes from MeeTab and verify Google Calendar shows the event. Background and reopen the app; check immediate refresh. Disconnect internet temporarily; verify prior meetings remain and a warning is shown; do not rely on stale room-available state for booking.
7. On an authorized test account, verify IT recipient read/edit against real Render PostgreSQL after staging configuration and test service restart. IT request email delivery remains **unverified** until approved provider webhook is configured and a real inbox receives a message.

## Release blockers

- Approve and securely configure `DATABASE_URL`, `IT_GLOBAL_ADMIN_IDENTITIES_JSON`, `IT_ADMIN_TOKEN`, room ACL and IT webhook on a test/staging service; verify live database and real recipient settings.
- Protect OAuth sessions from Render Free web-service ephemeral storage and close cross-process booking race before multi-room/production rollout.
- Microsoft 365/Outlook requires company Infosec consent; do not call it production-ready.
- **Generate and retain an owner-controlled Android app signing key** in secure offline/organization key storage. Never check a keystore or passphrase into GitHub and never use the debug key for the official release. Arrange a reviewed signing pipeline and backup/recovery ownership.
- Increment Android `versionCode`/version name for release; review min/target SDK, release permissions, app label, icons, crash logs, kiosk mode, deep-link ownership and hardening of the app's editable URL.
- Validate a **signed release APK** physically on the target tablet and document future update/signature compatibility, rollback plan and distribution instructions.
- PR #4, PR #5 and this combined PR #6 are not to be independently merged without reconciling overlapping frontend changes. Explicit owner approval required before any production deploy or paid service change.

## Current cost

Render PostgreSQL `MeeTab1.1-Free-Postgres` remains on Free until **2026-11-08 13:07 UTC**. Upgrade discussion reminder is scheduled for 2026-11-03; no paid database changes were made.
