import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../schema/d1/0001_housing_core.sql",import.meta.url),"utf8");
const migration=readFileSync(new URL("../schema/d1/0024_prune_non_delivering_cooperatives.sql",import.meta.url),"utf8");
const keep=[1,3,23,29,35,66,69,71],retire=[30,32,34,36,39];
function fixture(){
 const db=new DatabaseSync(":memory:");
 db.exec(schema);
 db.prepare("INSERT INTO participants(id,first_name,last_name) VALUES('user','A','B')").run();
 db.prepare("INSERT INTO search_profiles(id,participant_id) VALUES('search','user')").run();
 for(const id of [...keep,...retire]){
  db.prepare("INSERT INTO source_registry(id,name,family,connector,enabled) VALUES(?,?,?,?,?)")
   .run(id,"Quelle "+id,keep.includes(id)?"immomio":"immomio","immomio_tenant",id===71?0:1);
  db.prepare("INSERT INTO source_links(search_profile_id,source_id) VALUES('search',?)").run(id);
 }
 db.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES('offer-23',23,'unique-23','https://tenant.immomio.com/apply/00000000-0000-4000-8000-000000000023','{}')").run();
 db.prepare("INSERT INTO deliveries(id,participant_id,offer_identity_id,idempotency_key,status) VALUES('delivered','user','offer-23','user:unique-23','sent')").run();
 db.prepare("INSERT INTO applications(id,participant_id,offer_identity_id,provider,idempotency_key,status) VALUES('application','user','offer-23','immomio','user:immomio:unique-23','sent')").run();
 return db;
}

test("remove only non-delivering cooperatives, preserving all profiles, delivery and applications",()=>{
 const db=fixture();
 try{
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_links").get().n,13);
  db.exec(migration);
  const ids=db.prepare("SELECT id FROM source_registry ORDER BY id").all().map(x=>x.id);
  assert.deepEqual(ids,[...keep].sort((a,b)=>a-b));
  const links=db.prepare("SELECT source_id FROM source_links ORDER BY source_id").all().map(x=>x.source_id);
  assert.deepEqual(links,[...keep].sort((a,b)=>a-b));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM search_profiles").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM participants").get().n,1);
  assert.deepEqual({ ...db.prepare("SELECT offer_identity_id,status FROM deliveries WHERE id='delivered'").get() },
    {offer_identity_id:"offer-23",status:"sent"});
  assert.deepEqual({ ...db.prepare("SELECT offer_identity_id,status FROM applications WHERE id='application'").get() },
    {offer_identity_id:"offer-23",status:"sent"});
  assert.equal(db.prepare("SELECT enabled FROM source_registry WHERE id=71").get().enabled,0,
    "the disabled non-cooperative Immowelt SH remains untouched");
  db.exec(migration);
  assert.deepEqual(db.prepare("SELECT id FROM source_registry ORDER BY id").all().map(x=>x.id),ids);
 }finally{db.close();}
});

test("an unexpected retained offer blocks all cooperative cleanup without touching links",()=>{
 const db=fixture();
 try{
  db.prepare("INSERT INTO offer_identities(id,source_id,identity_hash,canonical_url,facts) VALUES('historical',34,'old-34','https://tenant.immomio.com/apply/00000000-0000-4000-8000-000000000034','{}')").run();
  db.exec(migration);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_links").get().n,13);
  assert.equal(db.prepare("SELECT id FROM source_registry WHERE id=34").get().id,34);
  assert.equal(db.prepare("SELECT source_id FROM offer_identities WHERE id='historical'").get().source_id,34);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_registry").get().n,13);
 }finally{db.close();}
});
