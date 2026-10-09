'use strict';
// PostgreSQL-backed room IT recipients. All SQL inputs are parameterized.
const {Pool}=require('pg');
module.exports=function createITStore(connectionString){
  const pool=new Pool({connectionString,connectionTimeoutMillis:5000,max:3,
    idleTimeoutMillis:30000,statement_timeout:10000});
  let setup;
  async function ready(){
    if(!setup)setup=pool.query(`CREATE TABLE IF NOT EXISTS meetab_it_recipients (
      room_id VARCHAR(128) PRIMARY KEY,
      recipient VARCHAR(254) NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(e=>{setup=null;throw e});
    await setup;
  }
  return {
    async get(roomId){
      await ready();
      const result=await pool.query('SELECT recipient FROM meetab_it_recipients WHERE room_id=$1',[roomId]);
      return result.rows[0]?.recipient||null;
    },
    async set(roomId,email){
      await ready();
      await pool.query(`INSERT INTO meetab_it_recipients(room_id,recipient,updated_at)
        VALUES ($1,$2,NOW()) ON CONFLICT (room_id)
        DO UPDATE SET recipient=EXCLUDED.recipient,updated_at=NOW()`,[roomId,email]);
    }
  };
};
