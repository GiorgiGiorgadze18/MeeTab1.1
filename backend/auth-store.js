'use strict';
// Provider credentials are encrypted; bearer sessions are indexed only by SHA-256.
// PostgreSQL is opt-in and restricted to the existing isolated staging role/schema.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const ORIGIN='https://meetab-staging-20261010.onrender.com';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const unavailable=()=>Object.assign(Error('Authentication storage unavailable'),{code:'AUTH_STORE_UNAVAILABLE'});
module.exports=async function createAuthStore({mode='file',filename,key,pool,env=process.env}){
  if(!['file','postgres'].includes(mode)||!Buffer.isBuffer(key)||key.length!==32)
    throw Object.assign(Error('Invalid authentication storage configuration'),{code:'AUTH_STORE_CONFIG'});
  const revisions=new WeakMap();
  const encrypt=(plain,aad='')=>{
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    if(aad)cipher.setAAD(Buffer.from(aad));
    const bytes=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
  };
  const decrypt=(encoded,aad='')=>{
    const bytes=Buffer.from(encoded,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    if(aad)cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(bytes.subarray(12,28));
    return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');
  };
  if(mode==='file'){
    let db={accounts:{},sessions:{}};
    try{db=JSON.parse(decrypt(fs.readFileSync(filename,'utf8')));}
    catch(error){if(fs.existsSync(filename))throw error;}
    const save=()=>{
      fs.writeFileSync(filename+'.tmp',encrypt(JSON.stringify(db)),{mode:0o600});
      fs.renameSync(filename+'.tmp',filename);
    };
    const getAccount=id=>{
      if(!db.accounts[id])return null;
      const account={...db.accounts[id],id};revisions.set(account,db.accounts[id]);return account;
    };
    return {
      async getAccount(id){return getAccount(id);},
      async login(id,account,sessionHash,expires){
        db.accounts[id]={...account,id};db.sessions[sessionHash]={accountId:id,expires};save();
      },
      async authenticate(sessionHash,now){
        const session=db.sessions[sessionHash];
        if(!session||session.expires<=now||!db.accounts[session.accountId])return null;
        return {session,account:getAccount(session.accountId)};
      },
      async updateAccount(id,account){
        if(!revisions.has(account))throw unavailable();
        if(db.accounts[id]!==revisions.get(account))return getAccount(id);
        db.accounts[id]={...account,id};save();return getAccount(id);
      },
      async logout(sessionHash){delete db.sessions[sessionHash];save();},
      async prune(){},async close(){}
    };
  }
  if(!pool||!env.DATABASE_URL||env.STAGING_PREVIEW_MODE!=='1'||env.API_ORIGIN!==ORIGIN)
    throw Object.assign(Error('PostgreSQL authentication requires isolated staging'),{code:'AUTH_STORE_CONFIG'});
  const accountAAD=id=>'meetab_staging.meetab_oauth_accounts/v1/'+id;
  const sessionAAD=id=>'meetab_staging.meetab_oauth_sessions/v1/'+id;
  const keyAAD='meetab_staging.meetab_oauth_meta/v1';
  const check='MeeTab encrypted staging authentication v1';
  const schemaSQL=fs.readFileSync(path.join(__dirname,'sql/create-staging-oauth.sql'),'utf8');
  async function transaction(operation){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result=await operation(client);await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
  await transaction(async client=>{
    const {rows}=await client.query('SELECT current_user AS role, current_schema() AS schema');
    if(rows[0]?.role!=='meetab_staging'||rows[0]?.schema!=='meetab_staging')
      throw Object.assign(Error('Restricted authentication database required'),{code:'AUTH_STORE_CONFIG'});
    await client.query('SELECT pg_advisory_xact_lock(1937006964, 1)');
    await client.query(schemaSQL);
    await client.query(`INSERT INTO meetab_staging.meetab_oauth_meta(singleton,key_check)
      VALUES (true,$1) ON CONFLICT (singleton) DO NOTHING`,[encrypt(check,keyAAD)]);
    const row=(await client.query('SELECT key_check FROM meetab_staging.meetab_oauth_meta WHERE singleton=true')).rows[0];
    try{if(decrypt(row.key_check,keyAAD)!==check)throw Error('Key mismatch');}
    catch{throw Object.assign(Error('Authentication encryption key mismatch'),{code:'AUTH_STORE_KEY_MISMATCH'});}
  });
  async function protect(operation){try{return await operation();}catch{throw unavailable();}}
  function readAccount(encoded,accountKey){
    const account=JSON.parse(decrypt(encoded,accountAAD(accountKey)));
    if(typeof account.id!=='string'||hash(account.id)!==accountKey||
       !['google','microsoft'].includes(account.provider)||!account.id.startsWith(account.provider+':')||
       !['name','email','access','refresh'].every(field=>typeof account[field]==='string')||
       typeof account.emailVerified!=='boolean'||!Number.isFinite(account.expires))throw unavailable();
    revisions.set(account,encoded);return account;
  }
  const getAccount=id=>protect(async()=>{
      const accountKey=hash(id),{rows}=await pool.query(
        'SELECT ciphertext FROM meetab_staging.meetab_oauth_accounts WHERE account_key=$1',[accountKey]);
      return rows[0]?readAccount(rows[0].ciphertext,accountKey):null;
  });
  return {
    getAccount,
    login(id,account,sessionHash,expires){return protect(()=>transaction(async client=>{
      const accountKey=hash(id),value={...account,id};
      const ciphertext=encrypt(JSON.stringify(value),accountAAD(accountKey));
      readAccount(ciphertext,accountKey);
      const session=encrypt(JSON.stringify({accountId:id,expires}),sessionAAD(sessionHash));
      await client.query(`INSERT INTO meetab_staging.meetab_oauth_accounts(account_key,ciphertext)
        VALUES ($1,$2) ON CONFLICT (account_key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext`,[accountKey,ciphertext]);
      await client.query(`INSERT INTO meetab_staging.meetab_oauth_sessions(session_hash,account_key,expires_at,ciphertext)
        VALUES ($1,$2,$3,$4)`,[sessionHash,accountKey,expires,session]);
    }));},
    authenticate(sessionHash,now){return protect(async()=>{
      const {rows}=await pool.query(`SELECT s.account_key,s.expires_at,s.ciphertext AS session_ciphertext,a.ciphertext
        FROM meetab_staging.meetab_oauth_sessions s
        JOIN meetab_staging.meetab_oauth_accounts a USING (account_key)
        WHERE s.session_hash=$1 AND s.expires_at>$2`,[sessionHash,now]);
      if(!rows[0])return null;
      const row=rows[0],session=JSON.parse(decrypt(row.session_ciphertext,sessionAAD(sessionHash)));
      if(hash(session.accountId)!==row.account_key||session.expires!==Number(row.expires_at))throw unavailable();
      if(session.expires<=now)return null;
      return {session,account:readAccount(row.ciphertext,row.account_key)};
    });},
    updateAccount(id,account){return protect(async()=>{
      const previous=revisions.get(account);if(!previous)throw unavailable();
      const accountKey=hash(id),ciphertext=encrypt(JSON.stringify({...account,id}),accountAAD(accountKey));
      readAccount(ciphertext,accountKey);
      const result=await pool.query('UPDATE meetab_staging.meetab_oauth_accounts SET ciphertext=$2 WHERE account_key=$1 AND ciphertext=$3',[accountKey,ciphertext,previous]);
      if(result.rowCount===1)return readAccount(ciphertext,accountKey);
      const current=await getAccount(id);if(!current)throw unavailable();return current;
    });},
    logout(sessionHash){return protect(()=>pool.query('DELETE FROM meetab_staging.meetab_oauth_sessions WHERE session_hash=$1',[sessionHash]));},
    prune(now){return protect(()=>pool.query('DELETE FROM meetab_staging.meetab_oauth_sessions WHERE expires_at<=$1',[now]));},
    async close(){} // Shared pool belongs to the backend, not this store.
  };
};
