# Encrypted staging authentication in PostgreSQL

This candidate adds an opt-in PostgreSQL authentication store. It is not deployed
or enabled by creating this PR. The default remains the existing encrypted file.
IT recipients, calendar provider permissions, room ACLs and the eight-hour login
session lifetime keep their existing contracts. No APK update is required.

This storage PR is stacked on the unmerged calendar-access candidate
`fix/calendar-account-switch-20261010` at `a54967a` (PR #11). The configured PR
base is that branch so this PR contains only the storage change. The two changes
overlap in backend authentication/profile handling; that overlap is integrated
and tested here. Backend CI and Trivy also accept this explicit dependent base.
Merge the dependency only through separately owner-approved PR preparation;
never push directly to the integrated preview or production branch.

## Scope and contracts

- Set `AUTH_STORAGE=postgres` only after the exact candidate is approved and
  deployed to isolated staging. An unknown value refuses startup.
- PostgreSQL mode requires `STAGING_PREVIEW_MODE=1`, the configured staging API
  origin, and the existing restricted `meetab_staging` database role/schema.
  Production and owner-role connections refuse this mode.
- Reuse the private staging `DATABASE_URL` and `DATA_ENCRYPTION_KEY`. Keep the
  existing encryption key unchanged. Never put their values in GitHub or chat.
- Auth and IT use one connection pool, capped at the staging role's three
  connections. Every account/session lookup uses indexed, parameterized SQL.
- New, additive, retry-safe setup is `backend/sql/create-staging-oauth.sql`,
  executed transactionally under a setup lock. Existing applied IT provisioning
  scripts and tables are not edited or rerun. No migration tracking is invented.
- OAuth account profiles, access/refresh tokens and session payloads use
  AES-256-GCM. Authenticated encryption binds each payload to its table and row.
  Only hashed account/session keys and expiry metadata remain visible in SQL.
- A persistent encrypted key-check prevents silently starting with a replacement
  key. Store failures return a generic 503; no file fallback or credential logs.
- Successful login commits the account and session together before returning the
  one-time ticket. Refresh updates and logout are awaited before success.
- Credential refresh compares the account revision before writing; a stale
  refresh cannot overwrite a newer login or another completed refresh.
- Expired sessions are removed using their expiry index. Account retention stays
  as before; separate account removal/key rotation policies remain future work.
- OAuth state and return tickets still expire in memory. Restarting during an
  unfinished sign-in requires restarting that sign-in. A completed session stays
  valid until its original expiry; restart does not extend the eight-hour TTL.
- Refresh coordination, booking locks and rate limits remain per process. This
  change does not establish multi-replica or multi-company readiness.

## Activation and recovery

1. Verify the reviewed commit's tests and sanitized Trivy findings. Record the
   current staging commit, health, DB role/schema, recipient read and storage.
2. Before enabling, retain an owner-controlled staging DB export and securely
   retained encryption key. A database backup alone cannot decrypt credentials.
   Follow the established owner-approved Render deployment workflow.
3. Deploy the approved commit with `AUTH_STORAGE` unset: file mode remains active.
   This isolates code rollout from the storage switch.
4. Set `AUTH_STORAGE=postgres` in staging only, preserving all existing secrets.
   Render environment changes can deploy immediately, even with auto-deploy off.
   Verify the resulting deployment's exact commit before testing.
5. Verify `AUTH_STORAGE_READY` without printing sensitive logs. Sign in once:
   this candidate intentionally does not import or delete the existing auth file.
6. Read the calendar and saved IT recipient; verify unauthorized room/user access
   remains blocked. Restart staging, then confirm the same completed session and
   recipient are recovered. Validate logout remains effective after restart.
7. If activation fails, return to `AUTH_STORAGE=file` or remove the new setting
   and deploy the recorded previous staging commit. Sign in again if the old
   ephemeral file is unavailable. Keep all PostgreSQL auth/IT tables and secrets;
   no DROP, role removal or migration-history edits are part of app rollback.

CODE/TEST checks use disposable local PostgreSQL and fake provider HTTP. They do
not prove real Google credentials, authenticated Render behavior or physical
tablet readiness. Those remain pending until owner-approved activation.
