-- Additive, retry-safe staging setup, invoked by auth-store in one transaction.
-- Never change the existing IT provisioning SQL or its stored recipient table.
CREATE TABLE IF NOT EXISTS meetab_staging.meetab_oauth_meta (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  key_check TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetab_staging.meetab_oauth_accounts (
  account_key CHAR(64) PRIMARY KEY CHECK (account_key ~ '^[a-f0-9]{64}$'),
  ciphertext TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetab_staging.meetab_oauth_sessions (
  session_hash CHAR(64) PRIMARY KEY CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  account_key CHAR(64) NOT NULL REFERENCES meetab_staging.meetab_oauth_accounts(account_key),
  expires_at BIGINT NOT NULL,
  ciphertext TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meetab_oauth_session_expiry
  ON meetab_staging.meetab_oauth_sessions(expires_at);
REVOKE ALL ON meetab_staging.meetab_oauth_meta,
  meetab_staging.meetab_oauth_accounts,meetab_staging.meetab_oauth_sessions FROM PUBLIC;
