-- Optional cleanup, NOT the normal application rollback. Keep populated staging
-- data when rolling the app back. Stop staging DB traffic before running this.
-- Run as the provisioning owner with --single-transaction -v ON_ERROR_STOP=1.
-- Set meetab.staging_expected_database to the approved database first.
-- No CASCADE or DROP OWNED: unexpected dependencies abort the whole transaction.
DO $$
BEGIN
  IF current_database() IS DISTINCT FROM current_setting('meetab.staging_expected_database', true) THEN
    RAISE EXCEPTION 'Wrong database: refusing staging cleanup';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace
    WHERE nspname = 'meetab_staging'
      AND nspowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
      AND pg_catalog.obj_description(oid, 'pg_namespace') = 'MeeTab staging IT v1'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'meetab_staging'
      AND pg_catalog.shobj_description(oid, 'pg_authid') = 'MeeTab staging IT v1'
  ) THEN
    RAISE EXCEPTION 'Staging ownership/marker mismatch: refusing cleanup';
  END IF;
  IF pg_catalog.to_regclass('meetab_staging.meetab_it_recipients') IS NOT NULL THEN
    -- Block concurrent writes while checking that no recipient data is lost.
    LOCK TABLE meetab_staging.meetab_it_recipients IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM meetab_staging.meetab_it_recipients LIMIT 1) THEN
      RAISE EXCEPTION 'Staging has saved recipients: retain the schema or export data before cleanup';
    END IF;
  END IF;
END;
$$;
DROP TABLE IF EXISTS meetab_staging.meetab_it_recipients RESTRICT;
DROP SCHEMA meetab_staging RESTRICT;
DO $$
BEGIN
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM meetab_staging', current_database());
  EXECUTE format('ALTER ROLE meetab_staging IN DATABASE %I RESET ALL', current_database());
END;
$$;
DROP ROLE meetab_staging;
