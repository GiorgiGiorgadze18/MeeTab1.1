'use strict';
// Real PostgreSQL integration test, strictly restricted to the disposable CI container.
// This must never point to a Render or production database.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const createITStore=require('../backend/it-store');
const url=process.env.PG_TEST_DATABASE_URL;
if(!url)throw Error('PG_TEST_DATABASE_URL required; no production fallback');
const parsed=new URL(url);
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/meetab_ci')
  throw Error('Refusing to run write tests against a non-local or non-CI database');
const roomA='ci-room-'+crypto.randomBytes(5).toString('hex');
const roomB='ci-room-'+crypto.randomBytes(5).toString('hex');
const store=createITStore(url);
let restarted;
(async()=>{
  assert.equal(await store.get(roomA),null,'Absent room must have no inbox');
  await store.set(roomA,'it-a@example.test');
  await store.set(roomB,'it-b@example.test');
  assert.equal(await store.get(roomA),'it-a@example.test');
  assert.equal(await store.get(roomB),'it-b@example.test');
  await store.set(roomA,'updated-a@example.test');
  // Simulate another Node server process with an independent connection pool.
  restarted=createITStore(url);
  assert.equal(await restarted.get(roomA),'updated-a@example.test','Must persist across pools');
  assert.equal(await restarted.get(roomB),'it-b@example.test','Rooms remain isolated');
  const badId="' OR '1'='1";
  assert.equal(await restarted.get(badId),null,'Parameterization must not return unrelated rows');
  console.log('PASS real PostgreSQL: write, read, update, room isolation, new-pool persistence, SQL parameters');
})().catch(e=>{console.error('FAIL PostgreSQL integration:',e.message);process.exitCode=1;})
  .finally(async()=>{
    await Promise.allSettled([store.close(),restarted?.close()]);
  });
