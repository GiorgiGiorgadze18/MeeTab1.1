# MeeTab — IT Help inbox setup (admin-only)

## User experience
The IT Help overlay shows the **server-verified email recipient** for the room. An authorized admin can tap **შეცვლა**, type an IT inbox and a private administrator code, then **დამახსოვრება**. The Save button confirms success only if the backend has persisted it.

For ordinary users the edit action stays hidden; the existing confirmation and **IT request** buttons remain. No IT recipient is accepted from the public `/api/it-request` body.

## Render configuration (never put credentials in website files)

Set these on a **staging service** first:

- `ROOM_ACCESS_JSON` — signed-in user → allowed `itRooms` keys and calendar IDs (see `SECURITY-ROLLOUT.md`). Required for multi-company isolation.
- `IT_ROOM_LABELS_JSON` — room key → display name.
- `IT_ADMIN_IDENTITIES_JSON` — JSON array of authorized provider identities, e.g. `["microsoft:it-admin@example.com"]`. Only these accounts see the edit option.
- `IT_ADMIN_TOKEN` — a unique, randomly generated, unguessable secret **at least 24 characters long**. Share privately with authorized administrators; do not hardcode it or reuse the Android kiosk PIN. The frontend does not store this value.
- `DATABASE_URL` — enable **only after confirming `DATA_FILE` lives on a Render persistent disk** (not ephemeral filesystem). This opt-in prevents pretending a saved email will survive a restart when no durable disk exists.
- `IT_WEBHOOK_URL` — HTTPS endpoint of the approved Power Automate flow; `IT_WEBHOOK_TOKEN` optional only if that flow validates Bearer authorization.
- `IT_ROOM_RECIPIENTS_JSON` — optional initial per-room recipient addresses. A successfully saved per-room value takes precedence. `IT_SUPPORT_EMAIL` remains the legacy fallback.

## Power Automate integration
Create an HTTP-triggered cloud flow (licensing/permissions must support the trigger) with a validated trigger and trusted sender. Read the **server-side** `roomId`, `roomName`, `to` and `at` fields; send an email using the organization's approved Microsoft 365 Outlook connection. Restrict allowed recipient domains/addresses on the automation side as appropriate for each company and verify real mailbox delivery.

`202 Accepted` from MeeTab means the flow accepted the request; it is **not** an email delivery receipt.

## Security, storage and deployment
1. Stage the API and add the environment values without exposing their values in GitHub.
2. Configure a Render PostgreSQL database **and confirm that saved records survive a web-service restart** before enabling durable mode.
3. Test signed-in non-admin cannot edit, wrong code is rejected, incorrect email is rejected and the room recipient does not leak across tenants.
4. Verify the configured recipient is actually used by an approved Power Automate flow, and that the email reached the expected IT inbox.
5. Get owner approval before PR merge and production deployment; back up the existing encrypted DATA_FILE.
6. A shared production deployment with multiple app instances requires a shared transactional database for configuration instead of a local file. Tenant isolation and booking locks remain separate rollout prerequisites.

## No false success
The existing `itSupportEmail` in public `site-config.js` is presentation-only. If the secure backend is not deployed/configured, IT Help displays a connection/setup message and **does not claim a recipient was saved**.

## Free PostgreSQL trial
Render resource: `MeeTab1.1-Free-Postgres` (`dpg-db4eduad0e5s73enh400-a`), PostgreSQL 18, Oregon, Free, created 2026-10-09. Expiry: **2026-11-08 13:07 UTC**. Do not use free trial as an indefinite data retention plan. Required env var: `DATABASE_URL` pointing to Render **internal** DB connection URI, entered privately in Render (never GitHub or website JS). Pending staged connection verification before merge.

Note: accounts/sessions are *still* encrypted on the web service local `DATA_FILE` and may be lost on restart — migrating them to durable server-side storage is a separate security task.
