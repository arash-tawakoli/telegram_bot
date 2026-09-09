import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('bootstrap refuses an existing registry before resetting any live configuration',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create table sources(id int, baseline text); create table source_connectors(id int); insert into sources values(8,\'keep-baseline\'); insert into source_connectors values(42);');
  const sql=await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8');
  await assert.rejects(db.exec(sql),/Bootstrap refused: source registry already exists/);
  await db.exec('rollback');
  assert.deepEqual((await db.query('select * from sources')).rows,[{id:8,baseline:'keep-baseline'}]);
  assert.equal((await db.query('select id from source_connectors')).rows[0].id,42);
 }finally{await db.close();}
});
