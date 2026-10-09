# MeeTab — architecture, costs, decisions and next steps
_Last reviewed: 2026-10-09. Keep updated after every infrastructure or product change._

## Current architecture
- **Frontend:** GitHub Pages, `website/` static app, 1280×800 Android tablet UI, Google/Microsoft room calendars through authenticated backend.
- **API:** Render web service `MeeTab1.1`, `srv-db48vhflot8c73880as0`, region Oregon, **Free**, Node.js, `backend/`, GitHub `main` auto-deploy.
- **Database (new):** Render PostgreSQL 18, `MeeTab1.1-Free-Postgres`, `dpg-db4eduad0e5s73enh400-a`, Oregon, Free. **Created 2026-10-09; expires 2026-11-08 at 13:07 UTC.** Do not automatically upgrade. Plan to export / upgrade before expiration.
- **Room IT inboxes:** new PR #4 code to store in `meetab_it_recipients` via parameterized PostgreSQL queries; requires confidential `DATABASE_URL` on Render and approved staging/end-to-end validation. CI verifies PostgreSQL writes/reads across fresh pooled connections using an isolated PostgreSQL 18 service.
- **Notifications:** Microsoft 365 Outlook / Power Automate planned, not configured or delivery-tested.
- **Android:** Debug APK builds pass; production release signed APK and hardcoded admin PIN fix still pending.

## Cost ledger (USD, estimates — confirm Render pricing when upgrading)
| Component | Now | Future cost / decision |
|---|---|---|
| Render web service | Free | Paid instance needed for production uptime/SLA; quote at purchase time |
| PostgreSQL | Free trial (expires 2026-11-08) | Entry-level paid compute reportedly starts around $6/month plus storage about $0.30/GB/month; verify current dashboard invoice first |
| GitHub Pages | Free for this public repository | Review organization/commercial usage and domain/security policies |
| GitHub Actions | Within available plan limits | Monitor monthly minutes/artifact retention |
| Power Automate/M365 | Not connected | Check organization's HTTP-trigger licensing and Outlook send permissions |
| Android distribution | Debug build only | Signing key ownership, secure release pipeline, update rollout |

## Priorities / improvement opportunities
1. **Safely connect Postgres:** Backend only; use Render internal URL as env var, verify actual read/write/restart persistence before PR merge. Never commit credentials.
2. **Tenant isolation:** Enable and test `ROOM_ACCESS_JSON` for every active provider account/room (PR #4 is opt-in for compatibility).
3. **Move encrypted OAuth sessions/accounts** away from Render Free ephemeral disk to encrypted durable database storage, backed by rotation and recovery.
4. **Distributed booking locks + shared rate limits** for multi-instance use; minimize double bookings and abusive calls.
5. **Microsoft Power Automate:** flow accepts trusted backend request, validates intended room/recipient, sends real IT email and records delivery/flow results.
6. **Admin IT inbox editor:** provider allowlist + private admin secret + persistence; verify no tenant cross-talk.
7. **Android security:** remove hardcoded setup PIN, secure signing key and update delivery, physical 1280×800 touch/QR tests.
8. **Monitoring:** uptime/alerting, error dashboards, CI gated PRs, backups, free-trial expiry and cost reminders.
9. **Customization:** per-company room branding, colors, language, timezone, weather, logos, Wi-Fi QR without altering shared core code.
10. **Accessibility/performance:** reduced-motion, robust offline/slow-network UI, touch target sizing, WebView kiosk recovery.

## Operating rules
Work in feature branches, test locally and in CI, open a PR; **no direct main/production merge/deploy without user authorization**. Database costs require prior approval. Record new subscription charges and architectural decisions here.

## Deployment checkpoint — 2026-10-09
- Owner reports setting `DATABASE_URL` in Render MeeTab1.1 web service environment. **Secret value/presence cannot be independently read by available Render tools**; don't paste database connection URL into chat or GitHub.
- Render service `MeeTab1.1` live, latest deployment `dep-db4f6c3tqb8s73f2q800` on `main` commit `b2b859e29b290aed4fda90f52761ba05493b8eab`, finished 13:59:40 UTC. PR #4 PostgreSQL code is **not deployed**.
- Render PostgreSQL `dpg-db4eduad0e5s73enh400-a` available, free, expiry 2026-11-08 13:07 UTC, external allowlist empty (retain). Hosted connector cannot query it externally.
- GitHub PR #4 (Draft) backend CI, PostgreSQL 18 integration test, Trivy, Android debug build all passed on `027971c...`; real Render DB connection and email persistence **not yet verified**.
- One backend request after the redeploy returned “Login required”; likely expired authentication after restart. User may need to sign back in. Do not assume this was a DB error.
- **Next gate:** review configuration for admin identities/secret and tenant access, verify `DATABASE_URL` internally on staging, then obtain explicit approval before merging (Render auto-deploys `main`). Never log secrets or edit current main without approval.

## IT admin ownership decision — 2026-10-09
- User selected their personal Gmail account to administer room-specific IT recipient addresses across MeeTab customer installations.
- New **optional** server-only `IT_GLOBAL_ADMIN_IDENTITIES_JSON` allows the explicitly enrolled verified Google identity to edit IT settings for all **registered rooms of that backend**, with a second private administrator code. The email is deliberately **not published** in GitHub. Calendar/booking/IT-request authorization remains restricted to `ROOM_ACCESS_JSON`; third-party/independent deployments must opt in.
- Risk controls: Google `email_verified` check, credential not persisted in public browser storage, audit record without plaintext email, five admin edit attempts per session per 10 minutes, database persistence.
- Pending: private Render environment configuration, verified Google sign-in, customer consent for platform-level editing, end-to-end recipient test, Power Automate delivery and deployment approval.

## Google-first test track — 2026-10-09
- Owner reports both Google and Microsoft integration configurations exist, but actively tests with **Google Calendar**; Microsoft/Outlook requires a separate information-security approval. Do not label Outlook as validated or ask for production permissions before Infosec signs off.
- **Stage A (Google):** verify Google login and `email_verified` for authorized identity; confirm appropriate Google test calendar is readable and that a test booking succeeds without an unauthorized calendar becoming visible.
- **Stage B (IT configuration):** verify Render has private `DATABASE_URL`, `IT_GLOBAL_ADMIN_IDENTITIES_JSON`, `IT_ADMIN_TOKEN`, `IT_ROOM_LABELS_JSON`, and an appropriate room access policy. Query /api/it-config through the authenticated app; save one test recipient and confirm a fresh read/new session recovers the same address. Never place credentials or the owner's email in public files.
- **Stage C (messages):** email dispatch remains **unverified** until a correctly authenticated `IT_WEBHOOK_URL` and approved Microsoft 365/Power Automate workflow are set up, or an approved alternative delivery service is used. Display accepted ≠ delivered.
- **Approval boundary:** existing production Render service auto-deploys `main`; merging PR #4 would initiate a production rollout. Keep PR as Draft until explicit owner approval after safe rollout/rollback checks. No need to wait for Outlook Infosec to test Google/DB features, but Outlook-specific actions remain blocked pending approval.

## Calendar refresh latency — observation and separate fix, 2026-10-09
- Owner confirmed Google Calendar phone→tablet and tablet→phone booking/sync works, but a phone-created meeting was slow to appear until a tablet booking seemingly triggered a refresh.
- Root-cause candidate confirmed in frontend source: **60-second automatic poll**; tablet-created booking explicitly re-fetches immediately. This explains the symptom but isn't yet independently reproduced on the tablet.
- **Separate Draft PR #5** [fix/calendar-sync-latency](https://github.com/GiorgiGiorgadze18/MeeTab1.1/pull/5): proposed foreground polling every 20s, refresh on Android resume / tab focus, discard stale fetches and keep previous events on transient failure. Calendar regression CI and Trivy passed as of this note; Android build pending.
- **Bundled Android WebView:** website assets are packaged inside APK. To validate the fix on tablets using bundled mode, build/install a new APK; GitHub Pages deployment alone is insufficient. Hosted-URL installations instead need approved Pages deployment.
- Confirm with an actual phone event created while tablet stays untouched, and record appearance delay. 20s is not a guaranteed maximum because provider propagation/slow network may delay further. Watch API quota as device count scales.
- PR #5 is independent from PR #4's IT/DB/security rollout. Coordinate `website/index.html` edits before combining changes. **Do not merge/deploy without owner approval.**

## Final Android APK release objective — 2026-10-09
- Owner is currently using **Chrome** for actual device tests; the product's delivery target is **one complete Android APK** with all three MeeTab screens, branding, Google Calendar/approved Microsoft Calendar functionality, booking, IT Help, and room settings embedded.
- A working **debug APK** already exists. Example CI build: GitHub Actions run `37945987516`, artifact `MeeTab-debug-apk` (expires 2026-10-16). The 2026-10-09 PR #5 debug build bundles its frontend changes but **not** unmerged PR #4 IT/admin changes.
- The released Android APK embeds frontend assets in `android/app/src/main/assets/www` via Gradle, but OAuth calendars, notifications and PostgreSQL still require the server-side Render backend/internet; **do not embed provider secrets or DB credentials** in the APK.
- Final release blockers: combine reviewed PR #4 (IT config/admin/DB) and PR #5 (calendar sync) without losing UI edits; validate Google room bookings and IT recipient persistence on real Render; receive Microsoft/Outlook Infosec approval before enabling Outlook production workflows; configure and verify real IT email delivery; replace **hardcoded Android PIN `2580`** with secure admin control; create owner-controlled signing key and **signed release APK**; test Google OAuth return via Android external browser, QR, kiosk mode, tablet wake/reconnect, room configuration and safe app updates on a physical Android tablet.
- Keep Chrome testing until integrations pass and final APK is validated. Updating GitHub Pages does not update a tablet that runs the bundled APK; distribute new signed builds with versioned release/update instructions.
- Do not confuse a successful Android **debug CI build** with production readiness; no final signed APK has been delivered yet.
