'use strict';
// Destructive setup/cleanup tests ONLY in the disposable localhost CI cluster.
const assert=require('node:assert/strict');
const {Client,escapeLiteral}=require('../backend/node_modules/pg');
const {configuration,provision,removeEmpty}=require('../backend/staging-db-admin');
const createITStore=require('../backend/it-store');
const input=process.env.PG_TEST_DATABASE_URL;
if(!input)throw Error('PG_TEST_DATABASE_URL required; no Render fallback');
const base=new URL(input);
if(!['localhost','127.0.0.1'].includes(base.hostname)||base.pathname!=='/meetab_ci')
  throw Error('Refusing staging write tests outside the disposable localhost CI cluster');
const target='meetab_staging_ci',ownerName='meetab_setup_owner';
const ownerPassword="CI-only-owner-strong-password-'\\";
const stagingPassword="CI-only-staging-different-password-'\\";
const ownerUrl=new URL(base);ownerUrl.pathname='/'+target;
ownerUrl.username=ownerName;ownerUrl.password=ownerPassword;
const runtimeUrl=new URL(ownerUrl);runtimeUrl.username='meetab_staging';runtimeUrl.password=stagingPassword;
const admin=new Client({connectionString:base.href});
let owner,runtime,first,second,createdDatabase=false,createdOwner=false;
const configEnv={STAGING_DB_SETUP_ACTION:'provision',STAGING_PREVIEW_MODE:'1',
  API_ORIGIN:'https://meetab-staging-20261010.onrender.com',
  STAGING_DB_EXPECTED_HOST:'dpg-disposable-ci',STAGING_DB_EXPECTED_DATABASE:target,
  STAGING_DB_OWNER_URL:'postgresql://ci_owner:owner-private-password@dpg-disposable-ci/'+target,
  DATABASE_URL:'postgresql://meetab_staging:new-private-staging-password-24plus@dpg-disposable-ci/'+target};
async function sentinel(){
  assert.deepEqual((await owner.query('SELECT value FROM public.meetab_production_sentinel')).rows,[{value:'production data unchanged'}]);
}
async function noStaging(){
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='meetab_staging'")).rows[0].n,0);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='meetab_staging'")).rows[0].n,0);
  await sentinel();
}
(async()=>{
  assert.equal(configuration(configEnv).password,'new-private-staging-password-24plus');
  for(const patch of [{STAGING_PREVIEW_MODE:'0'},{API_ORIGIN:'https://production.example.test'},
    {STAGING_DB_SETUP_ACTION:'rollback'},
    {DATABASE_URL:configEnv.STAGING_DB_OWNER_URL},
    {DATABASE_URL:configEnv.DATABASE_URL+'?options=-csearch_path=public'},
    {DATABASE_URL:configEnv.DATABASE_URL.replace('dpg-disposable-ci','other-db')}])
    assert.throws(()=>configuration({...configEnv,...patch}));
  await admin.connect();
  await admin.query('CREATE ROLE '+ownerName+' LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '+escapeLiteral(ownerPassword));createdOwner=true;
  await admin.query('CREATE DATABASE '+target+' OWNER '+ownerName);createdDatabase=true;
  owner=new Client({connectionString:ownerUrl.href});await owner.connect();
  await owner.query('CREATE TABLE public.meetab_production_sentinel(value TEXT NOT NULL)');
  await owner.query("INSERT INTO public.meetab_production_sentinel VALUES ('production data unchanged')");
  await provision(owner,stagingPassword,target);
  runtime=new Client({connectionString:runtimeUrl.href});await runtime.connect();
  assert.deepEqual((await runtime.query('SELECT current_user AS role, current_schema() AS schema')).rows,
    [{role:'meetab_staging',schema:'meetab_staging'}]);
  for(const sql of ['SELECT * FROM public.meetab_production_sentinel',
    "UPDATE public.meetab_production_sentinel SET value='changed'",'CREATE TABLE public.forbidden(id INT)',
    'CREATE SCHEMA forbidden'])
    await assert.rejects(runtime.query(sql),error=>error.code==='42501');
  await runtime.end();runtime=null;
  first=createITStore(runtimeUrl.href);
  await first.set('ci-staging-room','staging-it@example.test');await first.close();first=null;
  second=createITStore(runtimeUrl.href);
  assert.equal(await second.get('ci-staging-room'),'staging-it@example.test','New pool must recover the stored recipient');
  await second.close();second=null;
  await assert.rejects(provision(owner,stagingPassword,target),/already exists/);
  await assert.rejects(removeEmpty(owner,target),/saved recipients/);
  assert.equal((await owner.query('SELECT recipient FROM meetab_staging.meetab_it_recipients')).rows[0].recipient,'staging-it@example.test');
  await sentinel();
  // Delete only our disposable test fixture, then exercise the empty cleanup.
  await owner.query("DELETE FROM meetab_staging.meetab_it_recipients WHERE room_id='ci-staging-room'");
  await owner.query('CREATE VIEW public.cleanup_dependency AS SELECT * FROM meetab_staging.meetab_it_recipients');
  await assert.rejects(removeEmpty(owner,target),error=>error.code==='2BP01');
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.cleanup_dependency')).rows[0].n,0);
  await owner.query('DROP VIEW public.cleanup_dependency');
  await removeEmpty(owner,target);await noStaging();
  // A permissive existing PUBLIC grant causes an atomic refusal, without changing it.
  await owner.query('GRANT SELECT ON public.meetab_production_sentinel TO PUBLIC');
  await assert.rejects(provision(owner,stagingPassword,target),/access to existing tables/);
  await noStaging();
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_class c, LATERAL aclexplode(c.relacl) a WHERE c.oid='public.meetab_production_sentinel'::regclass AND a.grantee=0 AND a.privilege_type='SELECT'")).rows[0].n,1);
  await owner.query('REVOKE SELECT ON public.meetab_production_sentinel FROM PUBLIC');
  console.log('PASS staging PostgreSQL: non-superuser provisioning, restricted login, private password escaping, persistence, collision refusal, data-preserving rollback, dependency refusal, atomic cleanup and unchanged existing table');
})().catch(error=>{console.error('FAIL staging PostgreSQL:',error.message);process.exitCode=1;})
  .finally(async()=>{
    await Promise.allSettled([first?.close(),second?.close(),runtime?.end(),owner?.end()]);
    if(createdDatabase)await admin.query('DROP DATABASE '+target);
    // Test cleanup only: do not use these broad operations against any Render DB.
    if(createdDatabase)await admin.query('DROP ROLE IF EXISTS meetab_staging');
    if(createdOwner)await admin.query('DROP ROLE '+ownerName);
    await admin.end();
  });
