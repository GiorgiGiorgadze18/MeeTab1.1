# MeeTab — IT Help inbox setup (admin-only)

## User experience
The IT Help overlay shows the **server-verified email recipient** for the room. An authorized admin can tap **შეცვლა**, type an IT inbox and a private administrator code, then **დამახსოვრება**. The Save button confirms success only if the backend has persisted it.

For ordinary users the edit action stays hidden; the existing confirmation and **IT request** buttons remain. No IT recipient is accepted from the public `/api/it-request` body.

## Render configuration (never put credentials in website files)

Set these on a **staging service** first:

- `ROOM_ACCESS_JSON` — signed-in user → allowed `itRooms` keys and calendar IDs (see `SECURITY-ROLLOUT.md`). Required for multi-company isolation.
- `IT_ROOM_LABELS_JSON` — room key → display name.
- `IT_ADMIN_IDENTITIES_JSON` — JSON array of **room-scoped** administrative provider identities, e.g. `["microsoft:it-admin@example.com"]`. These accounts also require room authorization in `ROOM_ACCESS_JSON`.
- `IT_GLOBAL_ADMIN_IDENTITIES_JSON` — **optional platform administrator** identities. Set a JSON array of verified Google/Microsoft account identities privately in Render, e.g. `["google:owner@example.com"]`. Platform admins can read/update IT recipient settings for **every room registered in this backend**, but still cannot access other tenants' calendars, bookings, or send IT requests outside `ROOM_ACCESS_JSON`. Changes also require `IT_ADMIN_TOKEN`. Only enroll identities explicitly approved to manage those companies. Each separate MeeTab backend needs its own configuration.
- `IT_ADMIN_TOKEN` — a unique, randomly generated, unguessable secret **at least 24 characters long**. Share privately with authorized administrators; do not hardcode it or reuse the Android kiosk PIN. The frontend does not store this value.
- `DATABASE_URL` — Render PostgreSQL **internal connection URL**, configured privately on the backend service. The IT recipient is stored in PostgreSQL, not the ephemeral `DATA_FILE` (which still holds OAuth sessions pending migration). Never expose the connection URL in GitHub or the public website.
- `IT_WEBHOOK_URL` — HTTPS endpoint of the approved Power Automate flow; `IT_WEBHOOK_TOKEN` optional only if that flow validates Bearer authorization.
- `IT_ROOM_RECIPIENTS_JSON` — optional initial per-room recipient addresses. A successfully saved per-room value takes precedence. `IT_SUPPORT_EMAIL` remains the legacy fallback.

## Power Automate integration
Create an HTTP-triggered cloud flow (licensing/permissions must support the trigger) with a validated trigger and trusted sender. Read the **server-side** `roomId`, `roomName`, `to` and `at` fields; send an email using the organization's approved Microsoft 365 Outlook connection. Restrict allowed recipient domains/addresses on the automation side as appropriate for each company and verify real mailbox delivery.

`202 Accepted` from MeeTab means the flow accepted the request; it is **not** an email delivery receipt.

## Security, storage and deployment
1. Stage the API and add the environment values without exposing their values in GitHub.
2. Configure the Render PostgreSQL internal database URL in a staging backend; confirm recipient records survive a web-service restart and re-read in a new process. No durable-mode flag is required.
3. Test signed-in non-admin cannot edit, wrong code is rejected, incorrect email is rejected and the room recipient does not leak across tenants.
4. Verify the configured recipient is actually used by an approved Power Automate flow, and that the email reached the expected IT inbox.
5. Get owner approval before PR merge and production deployment; back up the existing encrypted DATA_FILE.
6. The IT recipient configuration uses a shared PostgreSQL table across processes. OAuth sessions and booking locks still need separate durable/shared-state improvements. Tenant isolation and booking locks remain separate rollout prerequisites.

## No false success
The existing `itSupportEmail` in public `site-config.js` is presentation-only. If the secure backend is not deployed/configured, IT Help displays a connection/setup message and **does not claim a recipient was saved**.

## Free PostgreSQL trial
Render resource: `MeeTab1.1-Free-Postgres` (`dpg-db4eduad0e5s73enh400-a`), PostgreSQL 18, Oregon, Free, created 2026-10-09. Expiry: **2026-11-08 13:07 UTC**. Do not use free trial as an indefinite data retention plan. Required env var: `DATABASE_URL` pointing to Render **internal** DB connection URI, entered privately in Render (never GitHub or website JS). Pending staged connection verification before merge.

Note: accounts/sessions are *still* encrypted on the web service local `DATA_FILE` and may be lost on restart — migrating them to durable server-side storage is a separate security task.

## Owner account / Google sign-in
The project owner selected a personal Gmail account as the MeeTab platform IT configuration administrator. To avoid publishing that personally identifying address in a public repository, insert its exact lower-case value as `google:<owner-gmail-address>` in Render's private `IT_GLOBAL_ADMIN_IDENTITIES_JSON`. Sign into MeeTab using **Google**, not Microsoft, with that account. The backend requires Google UserInfo `email_verified === true`; existing sessions need a fresh login after rollout. Never use email text supplied by the browser as admin proof.
Only configured/registered room IDs can be managed. A separately operated MeeTab installation or customer backend must deliberately grant platform-admin access; one email cannot bypass another company's independent authorization.
