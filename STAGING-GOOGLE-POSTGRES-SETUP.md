# MeeTab — staging Google OAuth and PostgreSQL activation

Status: staging **web preview and unauthenticated API checks pass**. Real Google OAuth, end-to-end bookings, and PostgreSQL persistence **are not connected or verified**. Production MeeTab remains untouched.

## URLs (staging only)

- Web preview: https://meetab-staging-20261010.onrender.com/preview/
- Backend: https://meetab-staging-20261010.onrender.com
- Render staging service: https://dashboard.render.com/web/srv-db4l80favr4c73fm9atg
- GitHub candidate: https://github.com/GiorgiGiorgadze18/MeeTab1.1/pull/6

The staging web preview is served by the staging backend under the gated `STAGING_PREVIEW_MODE=1` setting, and loads `app-config.js` pointing **only** to staging. This feature is OFF in the existing production service.

## Google Cloud (owner actions)

1. Open https://console.cloud.google.com/auth/clients and select the existing MeeTab Google Cloud project. Create a **separate OAuth Client** named `MeeTab Staging`, application type **Web application**. Do not replace the existing production client.
2. Authorized redirect URI: `https://meetab-staging-20261010.onrender.com/auth/google/callback`. Authorized JavaScript origin can be `https://meetab-staging-20261010.onrender.com`. The Google OAuth code exchange happens on the backend.
3. Ensure the Google Calendar API is enabled and the consent-screen project permits the selected staging test user. If the OAuth consent screen is External and in Testing, explicitly add the test Google account. Avoid changing the published production consent screen unnecessarily.
4. Copy **Client ID** and **Client Secret** privately into the **staging Render Environment only**, as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Do not send secrets in ChatGPT, screenshots, GitHub, or browser HTML. Render will deploy when environment variables change.
5. Create a **dedicated Google test calendar**, not a production room/personal calendar, and obtain its calendar ID. Set `ROOM_ACCESS_JSON` on staging to grant that exact calendar ID to the signed-in testing identity. Until then, the deployed policy intentionally authorizes no calendars.
6. Open the preview, sign in with Google, choose the *test* calendar, create a 15-minute test booking, verify Google Calendar and phone-to-tablet refresh. Use an isolated test account where possible because Google scopes may allow access to other account calendars even though MeeTab's backend ACL restricts which one the application accepts.
7. Never activate Outlook/Power Automate credentials before Infosec permission.

## PostgreSQL: Render free-tier limit

Render refused to create a second Free Postgres database in this workspace: `cannot have more than one active free tier database`. The existing `MeeTab1.1-Free-Postgres` is **NOT** connected to staging and its data is untouched. **Do not connect staging to the planned production database without explicit owner approval.**

Preferred independent option: the owner provisions a separate no-cost PostgreSQL database with an external provider if available, and places its **staging-only** connection string in staging Render as `DATABASE_URL`, never in chat or GitHub. Validate pricing and database lifetime before creating.

Alternative (requires owner approval and stronger database permissions): isolated schema/table and least-privilege database user within the existing Render database; code must be explicitly scoped to staging and integration-tested before use. Sharing credentials/one table between staging and production is unsafe.

Only after isolated database provisioning: configure `IT_ADMIN_TOKEN` privately, test server-side recipient write/read/restart, verify wrong user and other-room access denial, confirm webhook/email delivery separately. A successful HTTP acceptance does not prove delivery.

## Security / rollout status

- Public staging UI, protected source path routing, CORS rules, unauthenticated private API rejection and CI checks are passing as of 2026-10-10.
- This **does not** establish a final security verdict. Pending authorized-user and cross-tenant pen-test, real PostgreSQL connection, Google OAuth, encrypted session durability, live bookings, device QA, release signing and Outlook Infosec.
- Render Staging is on Free; no new paid resource. Existing production service and `main` were not modified.
