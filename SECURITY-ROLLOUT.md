# MeeTab — Server access controls and IT routing rollout

**Status: prepared, NOT deployed.** This document describes an opt-in secure-room configuration and its remaining limitations. Back up the Render environment before changes. Changes to private environment variables require an authorized service owner.

## New optional Render environment variables (server-only)

- `ROOM_ACCESS_JSON`: secure allowlist of provider identity → calendar IDs and IT room keys. As soon as this is set, all accounts, calendars and IT rooms not listed are **denied by default**. Without it, the previous unrestricted calendar behavior remains for backward compatibility **and multi-tenant authorization is NOT safe**.

  Example (replace with real identity and calendar IDs):

  ```json
  {
    "google:reception@example.com": {
      "calendars": ["gulisqari@group.calendar.google.com"],
      "itRooms": ["gulisqari"]
    },
    "microsoft:reception@example.org": {
      "calendars": ["room@example.org"],
      "itRooms": ["room2"]
    }
  }
  ```

  Values are matched against the signed-in provider/profile email (lowercased), never user input alone. The list route is filtered; GET/POST event access and IT requests are denied for unauthorized room IDs. Use exact provider-specific calendar IDs as selected by MeeTab. Confirm Microsoft shared-calendar rights separately; ACL permission cannot grant permissions in Microsoft 365/Google.

- `IT_ROOM_RECIPIENTS_JSON`: optional trusted roomId → helpdesk email. If configured, requests for rooms with no listed recipient return 503 (no fallback to another tenant). Example: `{"gulisqari":"it@company-one.example","room2":"help@company-two.example"}`. Existing `IT_SUPPORT_EMAIL` remains the *legacy single-company* fallback when this JSON variable is absent.
- `IT_WEBHOOK_TOKEN`: optional private bearer token sent in the backend's HTTPS POST to `IT_WEBHOOK_URL`. Enable only if your incoming automation supports bearer authentication. Keep out of the public website. **A webhook HTTP 2xx confirms acceptance, not that a person got an email.**
- `IT_ROOM_LABELS_JSON`: existing private room display-name registry. The keys must include allowed IT room IDs.

## Safe activation

1. Start with a **test Render instance**, not production. Add a small explicit `ROOM_ACCESS_JSON` for a test account and test calendar. Check `/health` and the OAuth login, calendar selection, event read and creation against non-production data.
2. Verify another account and calendar both receive 403, and disallowed IT room key also receives 403.
3. Configure a per-room IT recipient and an authenticated HTTPS webhook. Test delivery in the actual mail service and check the destination inbox and webhook history. The backend only reports **accepted**.
4. Ensure new configuration is complete for **every active room/account** before the approved production rollout, or users will be denied by design. Retain rollback env values.
5. Deploy exact reviewed commit on the backend, confirm OAuth redirect URLs, and verify browser and physical Android.

## Security status and blockers

- Request rate limits and IT cooldown are **per Node process** only; they reset on restart. Auth requests use the socket peer IP, not spoofable `X-Forwarded-For`.
- Booking locks still exist **only in memory**. Two accounts, processes, or external users can book the same room concurrently. Real cross-instance collision protection needs a shared persistent transactional mechanism and/or provider-specific robust concurrency handling; **not solved here**.
- Encrypted OAuth sessions still live in a local `DATA_FILE`. Render's ephemeral storage and multiple replicas may lose sessions; use a durable shared secret store and design key rotation before broad rollout.
- `ROOM_ACCESS_JSON` config is manual, email-keyed; replacing this with tenant-bound authorization from a central database is recommended for a real multi-customer SaaS, including identity/email changes and onboarding.
- **No actual email provider was connected** by this PR. No production credentials, webhook token or signing key are committed.
- A green Trivy scan does not test the above authorization and concurrency properties.

## CI

`node tests/backend-smoke.cjs` mocks OAuth and calendar operations and includes denied cross-room reads/writes, cross-tenant IT, webhook bearer/recipient, invalid requests, overlaps, and rate limits. CI never needs real user tokens.


## Admin-only IT inbox setting
See [IT-ADMIN-SETUP.md](IT-ADMIN-SETUP.md) for the new room-specific email editor. Server-side saving requires an authorized OAuth identity, `IT_ADMIN_TOKEN`, and `IT_CONFIG_STORAGE_DURABLE=true` with a confirmed persistent disk. No admin secret is stored in public JavaScript. Configure Power Automate separately; no email delivery is claimed without an end-to-end test.
