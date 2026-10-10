'use strict';
// Private startup operation for this one staging service. No HTTP/admin endpoint.
// Normal operation uses only DATABASE_URL for the restricted role. The owner URL
// is temporary and must be cleared from Render after successful provisioning.
const fs=require('node:fs/promises'),path=require('node:path');
const {Client,escapeLiteral}=require('pg');
const ORIGIN='https://meetab-staging-20261010.onrender.com';
function configuration(env){
  if(env.STAGING_DB_SETUP_ACTION!=='provision'||env.STAGING_PREVIEW_MODE!=='1'||env.API_ORIGIN!==ORIGIN)
    throw Error('Staging provisioning gate rejected');
  const owner=new URL(env.STAGING_DB_OWNER_URL||''),runtime=new URL(env.DATABASE_URL||'');
  const database=env.STAGING_DB_EXPECTED_DATABASE,host=env.STAGING_DB_EXPECTED_HOST;
  if(!database||!host||!/^dpg-[a-z0-9-]+$/.test(host))throw Error('Approved internal database target required');
  for(const url of [owner,runtime]){
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==host||
       url.pathname!=='/'+database||!['','5432'].includes(url.port)||url.hash||
       [...url.searchParams].some(([key,value])=>key!=='sslmode'||!['require','prefer','disable'].includes(value)))
      throw Error('Expected the approved internal staging database connection');
  }
  const password=decodeURIComponent(runtime.password);
  if(!owner.username||decodeURIComponent(owner.username)==='meetab_staging'||
     decodeURIComponent(runtime.username)!=='meetab_staging'||password.length<24||
     !owner.password||password===decodeURIComponent(owner.password))
    throw Error('Expected a separate staging login and a new 24+ character password');
  return {ownerUrl:owner.href,runtimeUrl:runtime.href,password,database};
}
async function transaction(client,operation){
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const result=await operation(client);
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function provision(client,password,database){
  if(!database)throw Error('Expected database required');
  const sql=await fs.readFile(path.join(__dirname,'sql/create-staging-it.sql'),'utf8');
  await transaction(client,async connection=>{
    await connection.query("SELECT set_config('meetab.staging_expected_database', $1, true)",[database]);
    await connection.query(sql);
    // PostgreSQL utility statements cannot parameterize the password literal.
    // Driver escaping handles quotes/backslashes; never log this statement.
    await connection.query('ALTER ROLE meetab_staging PASSWORD '+escapeLiteral(password));
  });
}
async function removeEmpty(client,database){
  if(!database)throw Error('Expected database required');
  const sql=await fs.readFile(path.join(__dirname,'sql/remove-empty-staging-it.sql'),'utf8');
  return transaction(client,async connection=>{
    await connection.query("SELECT set_config('meetab.staging_expected_database', $1, true)",[database]);
    return connection.query(sql);
  });
}
async function prepare(env){
  const config=configuration(env);
  const owner=new Client({connectionString:config.ownerUrl,connectionTimeoutMillis:5000});
  try{
    await owner.connect();await provision(owner,config.password,config.database);
  }finally{await owner.end();}
  const runtime=new Client({connectionString:config.runtimeUrl,connectionTimeoutMillis:5000});
  try{
    await runtime.connect();
    const {rows}=await runtime.query('SELECT current_user AS role, current_schema() AS schema');
    if(rows[0].role!=='meetab_staging'||rows[0].schema!=='meetab_staging')
      throw Error('Restricted staging login verification failed');
  }finally{await runtime.end();}
  // The HTTP backend starts only after verification and never sees the owner URL.
  delete env.STAGING_DB_OWNER_URL;delete env.STAGING_DB_SETUP_ACTION;
  console.info('STAGING_DB_PROVISIONED: restricted role and schema verified; clear temporary setup variables in Render');
}
module.exports={configuration,transaction,provision,removeEmpty,prepare};
