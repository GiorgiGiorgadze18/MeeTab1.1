# MeeTab 1.1 — UI restoration and IT-support integration (local review package)

> **No production deployment, no remote PR and no signed APK have been created.**
> Base snapshot: user-provided `MeeTab1.1-main.zip` with GitHub archive marker `94038a47da784b8fcd4e8f7efa9f9c6cdd59979a`. Current live remote HEAD / PRs could not be independently queried in this environment.

## 1. What changed

- Calendar and Booking pages now keep the original 407-pixel coral weather panel **visible**; the calendar grid has two columns and the booking form fits beside the panel. Home remains schedule-mode; original page transitions, modal animation and night mode code remain.
- Weather panel still calls Open-Meteo and shows current icon, day/date, current time, temperature, precipitation, wind, hourly view and 7-day forecast control. The forecast remains a public third-party request; city coordinates are configurable.
- Event organizer: prefer provider `displayName` (Google) or `emailAddress.name` (Microsoft); for events organized by the authenticated user, fall back to the actual OAuth profile full name. Unknown names display `სახელი მიუწვდომელია`, **not a guessed name or exposed email**. To display other corporate users' real names reliably, domain directory permissions and an approved lookup service are still required.
- IT Help posts room ID to `/api/it-request`. Backend validates session, room allowlist, throttles one request per user-session/room/minute, and forwards to a **server-configured HTTPS webhook**. A 202 response confirms webhook acceptance, not email delivery. On unavailable/unconfigured webhook, the UI reports failure rather than claiming that a message was sent.
- Branding, names, colors and support email are collected in `website/site-config.js`.
- Added manual-only GitHub Actions `build-android.yml` and `trivy-scan.yml`. No production deploy is triggered by these workflows.

## 2. Where to customize the site

Edit **`website/site-config.js`**:

- `rooms.gulisqari.name`, `.color`, `.email`, `.equipment` and additional rooms.
- `text.roomType`, `text.defaultEquipment`, `text.wifiName`.
- `colors` for ink/teal/red/paper, plus each room's coral.
- `weather.lat`, `weather.lon`, `timezone`.
- `itSupportEmail` for display/documentation. **It does not control actual delivery**, which is configured on the server.

The room can be chosen with `?room=room2`. Do not put API secrets, OAuth client secrets or mail-service API keys in this file (GitHub Pages is public).

The Backend origin stays in `website/app-config.js` and is currently set to the user's existing Render URL. **The new IT endpoint will not exist on Render until an owner-approved backend deployment.**

## 3. Real IT email delivery (requires manual setup)

The backend needs an HTTPS webhook that receives JSON and sends the notification email using an authorized email connector, e.g. a company-approved Power Automate flow. Configure the **Render service's private Environment** variables:

| Key | Example / description |
| --- | --- |
| `IT_WEBHOOK_URL` | HTTPS URL of your configured automation (keep secret) |
| `IT_SUPPORT_EMAIL` | Recipient address of your company's IT helpdesk |
| `IT_ROOM_LABELS_JSON` | `{"gulisqari":"გულისკარი","room2":"ოთახი 2"}` |

The webhook receives `{type,roomId,roomName,to,at}`. Configure the mail service to send to the trusted IT address with a clear subject such as `MeeTab IT assistance — <roomName>`. Confirm its authentication, delivery history, retry behavior and handling of failures before live use. The server does not send email directly or guarantee that a webhook's 2xx response means final email delivery.

**Tenant safety:** This is an initial single-customer implementation. Before multi-company sales, enforce backend tenant/room binding and authorization for every room and isolate tenant notifications. Session/room cooldown is per-process; distributed rate limiting requires a shared store.

## 4. Run and validate

- `node --check backend/server.js`
- `node --check website/auth.js`
- `node --check website/site-config.js`
- `node tests/backend-smoke.cjs` (isolated mock OAuth/API/webhook; never touches live calendars)
- Verify the UI in a normal browser (1280 × 800), both day/night modes, including forecast toggle, Google/Microsoft login and room booking against test calendars. The sandbox local browser UI test can verify layout, but **not** real authentication.

## 5. Obtain an Android APK

1. Review/merge this work on GitHub **only after owner approval** through the configured base branch and a PR. The provided local package does not push to your repository.
2. In GitHub → **Actions → Build MeeTab Android debug APK → Run workflow**, run it against the reviewed branch/commit.
3. Download the `MeeTab-debug-apk` artifact; unzip it to get `app-debug.apk`.
4. Copy to USB storage, open on the tablet and install with Android's approved sideloading process. The debug APK is for **manual testing**, not a production-signed release. A different signing key may require uninstalling a previous APK first (which may erase application data).
5. Test the browser-based OAuth round-trip on the **physical tablet**. Do not assume a green GitHub build proves the login or kiosk settings work.

The APK bundle contains the complete `website/` files via `android/app/build.gradle` `copyMeeTabWeb`. A working Android SDK/Gradle distribution is required to build it. **The APK was not built in this local environment.**

## 6. Run Trivy (not yet executed)

After owner-approved PR/merge, run **Actions → MeeTab Trivy security audit → Run workflow**. Download `meetab-trivy-summary` and review the findings. It intentionally omits potential secret matches from exported reports; raw scan results are not uploaded. **No Trivy finding/severity should be claimed until a real run completes.**

## 7. Production blockers / follow-up phases

- **Multi-tenancy:** no strict server-side tenant-to-room ownership or role binding. Don't sell as isolated multi-tenant SaaS until fixed and authenticated tests pass.
- **Booking race conditions:** existing lock is in-memory only and not atomic across Render instances or simultaneous provider updates. Introduce distributed lock/idempotency and recheck with provider before claiming robust collision prevention.
- **Rate limiting:** only the new IT route has local cooldown. Global login/API rate limiting, bot abuse protection and distributed limits remain pending.
- **Credentials/storage:** user OAuth token persistence uses an encrypted local file, not a durable shared database. Render ephemeral filesystem/redeploy risks must be addressed, with backup, retention and rotation policy.
- **Android PIN:** `android/.../MainActivity.java` contains a hardcoded administrative PIN from the base project. Change this design before public/company rollout. A debug build also lacks production signing and device-level kiosk authorization.
- **IT notifications:** webhook and a real mail service are not yet configured or delivery-tested.
- **Real auth:** Google sign-in reportedly works in user's current deployment, but **this new source revision has not been deployed or authenticated/physically tested**. Microsoft tenant admin consent may still be required.

## 8. Deployment policy

No automatic deployment is authorized by this package. On approval, deploy the exact reviewed SHA and verify health/rollback conditions and origin/tenant settings; never treat a successful build alone as proof of production correctness.
