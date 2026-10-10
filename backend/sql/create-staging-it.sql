-- Approved staging scope. Run as the existing owner in a single transaction:
-- psql --single-transaction -v ON_ERROR_STOP=1 -f create-staging-it.sql
-- Set meetab.staging_expected_database to the approved database before this file.
-- This does not modify existing tables, records, credentials or global grants.
-- Set the new role's password privately afterwards with: \password meetab_staging
-- Never put the password or connection string into this file or GitHub.
DO $$
BEGIN
  IF current_database() IS DISTINCT FROM current_setting('meetab.staging_expected_database', true) THEN
    RAISE EXCEPTION 'Wrong database: refusing staging provisioning';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'meetab_staging')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'meetab_staging') THEN
    RAISE EXCEPTION 'Staging role or schema already exists: inspect before proceeding';
  END IF;
END;
$$;

CREATE ROLE meetab_staging LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 3;

CREATE SCHEMA meetab_staging;
COMMENT ON SCHEMA meetab_staging IS 'MeeTab staging IT v1';
COMMENT ON ROLE meetab_staging IS 'MeeTab staging IT v1';
REVOKE ALL ON SCHEMA meetab_staging FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA meetab_staging TO meetab_staging;
-- The provisioning owner retains ownership so it can inspect/lock the new
-- table during guarded cleanup without changing its existing memberships.
CREATE TABLE meetab_staging.meetab_it_recipients (
  room_id VARCHAR(128) PRIMARY KEY,
  recipient VARCHAR(254) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE ON meetab_staging.meetab_it_recipients TO meetab_staging;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO meetab_staging', current_database());
  -- Existing unqualified IT-store SQL resolves only inside this schema.
  EXECUTE format('ALTER ROLE meetab_staging IN DATABASE %I SET search_path = meetab_staging', current_database());
END;
$$;

-- PUBLIC privileges can be inherited even with NOINHERIT. Refuse a shared DB
-- with permissive grants rather than altering any existing owner's privileges.
DO $$
BEGIN
  IF pg_catalog.has_database_privilege('meetab_staging', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Staging role inherits database CREATE: refusing provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('meetab_staging', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%'
      AND pg_catalog.has_schema_privilege('meetab_staging', n.oid, 'CREATE')
  ) THEN
    RAISE EXCEPTION 'Staging role can create outside its schema: refusing provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('meetab_staging', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%'
      AND CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN
        pg_catalog.has_table_privilege('meetab_staging', c.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') ELSE false END
  ) THEN
    RAISE EXCEPTION 'Staging role inherits access to existing tables: refusing provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('meetab_staging', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%'
      -- CASE matters: planner evaluation order is not the order of AND clauses.
      AND CASE WHEN c.relkind = 'S' THEN
        pg_catalog.has_sequence_privilege('meetab_staging', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END
  ) THEN
    RAISE EXCEPTION 'Staging role inherits access to existing sequences: refusing provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('meetab_staging', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%' AND p.prosecdef
      AND pg_catalog.has_function_privilege('meetab_staging', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Staging role can execute an existing privileged function: refusing provisioning';
  END IF;
END;
$$;

-- Owner-only next steps after verification:
-- 1. Set the restricted role's password privately with \password meetab_staging.
-- 2. Use its INTERNAL Render connection URL in staging DATABASE_URL only.
-- 3. With that connection, verify current_user = current_schema() = meetab_staging.
-- 4. Test IT recipient write/read, redeploy staging, re-read the saved address.
-- This is shared infrastructure, not a separate database or resource boundary.
