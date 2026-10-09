# MeeTab — architecture, costs, decisions and next steps
_Last reviewed: 2026-10-09. Keep updated after every infrastructure or product change._

## Current architecture
- **Frontend:** GitHub Pages, `website/` static app, 1280×800 Android tablet UI, Google/Microsoft room calendars through authenticated backend.
- **API:** Render web service `MeeTab1.1`, `srv-db48vhflot8c73880as0`, region Oregon, **Free**, Node.js, `backend/`, GitHub `main` auto-deploy.
- **Database (new):** Render PostgreSQL 18, `MeeTab1.1-Free-Postgres`, `dpg-db4eduad0e5s73enh400-a`, Oregon, Free. **Created 2026-10-09; expires 2026-11-08 at 13:07 UTC.** Do not automatically upgrade. Plan to export / upgrade before expiration.
- **Room IT inboxes:** new PR #4 code to store in `meetab_it_recipients` via parameterized PostgreSQL queries; requires confidential `DATABASE_URL` on Render and approved staging/end-to-end validation.
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
