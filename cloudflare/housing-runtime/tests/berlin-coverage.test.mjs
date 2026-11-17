import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { berlinCoverageQuery, splitBerlinCoverageJob, runBerlinCoverage } from "../src/berlin-coverage.js";

function setup() {
  const db = new DatabaseSync(":memory:");
  const folder = new URL("../schema/d1/", import.meta.url);
  for (const name of readdirSync(folder).filter(name=>name.endsWith(".sql")).sort())
    db.exec(readFileSync(new URL(name,folder),"utf8"));
  const sql = {
    unsafe:async (query, params=[])=>{
      const normalized=query.replaceAll("housing.","");
      const statement=db.prepare(normalized);
      if (/^\s*SELECT\b/i.test(normalized) || /\bRETURNING\b/i.test(normalized))
        return statement.all(...params);
      statement.run(...params);
      return [];
    },
  };
  return {db,sql,done(){db.close()}};
}

test("Berlin coverage migration seeds all borough and locality discovery queries exactly once",()=>{
  const {db,done}=setup();
  try {
    const row=db.prepare("SELECT COUNT(*) n,COUNT(DISTINCT query) unique_queries FROM scout_coverage_jobs WHERE source_id=72").get();
    assert.equal(row.n,103); // 97 Ortsteile + 12 Bezirke, minus shared name queries
    assert.equal(row.unique_queries,103);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM offer_identities WHERE source_id=72").get().n,0);
  }finally{done()}
});

test("adaptive subdivision only completes searches whose MCP count is fully retrieved",()=>{
  const root={area:"Moabit",stage:0};
  const price=splitBerlinCoverageJob(root);
  assert.equal(price.length,5);
  assert.deepEqual(price.map(x=>[x.rent_min,x.rent_max]),[[null,750],[750,1250],[1250,1750],[1750,2500],[2500,null]]);
  const room=splitBerlinCoverageJob(price[2]);
  assert.deepEqual(room.map(x=>x.rooms),[1,2,3,4,5]);
  assert.match(berlinCoverageQuery(room[4]),/Kaltmiete 1250 bis 1750 Euro, ab 5 Zimmer$/);
  const narrow=splitBerlinCoverageJob(room[1]);
  assert.equal(narrow.length,2);
  assert.equal(narrow[0].rent_max,narrow[1].rent_min);
  assert.equal(splitBerlinCoverageJob({...room[1],rent_min:750,rent_max:800,stage:3}).length,0);
  assert.deepEqual(splitBerlinCoverageJob({...room[1],stage:6}),[]);
});

test("Berlin crawler persists new subdivisions and never claims a 20-of-80 scan is complete",async()=>{
  const x=setup();
  try{
    const calls=[];
    const mock=async (_sql,_source,{query})=>{
      calls.push(query);
      return {fetched:80,valid:20,missing_from_response:60,newly_discovered_in_response:20};
    };
    const result=await runBerlinCoverage(x.sql,{id:72},4,mock);
    assert.equal(result.processed.length,4);
    assert.ok(result.processed.every(r=>r.status==="split"&&r.children===5));
    assert.equal(calls.length,4);
    const counts=x.db.prepare("SELECT status,COUNT(*) n FROM scout_coverage_jobs GROUP BY status ORDER BY status").all();
    assert.deepEqual(counts,[{status:"pending",n:119},{status:"split",n:4}]);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE reported_total=80 AND returned_count=20").get().n,4);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE status='covered'").get().n,0);
  }finally{x.done()}
});

test("fully returned MCP partitions are scheduled for a later refresh without splitting",async()=>{
  const x=setup();
  try{
    const old=x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs").get().n;
    const result=await runBerlinCoverage(x.sql,{id:72},2,async()=>({
      fetched:13,valid:13,missing_from_response:0,newly_discovered_in_response:13,
    }));
    assert.equal(result.processed.length,2);
    assert.ok(result.processed.every(r=>r.status==="covered"&&r.children===0));
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs").get().n,old);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE status='covered'").get().n,2);
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE datetime(next_run_at)>datetime('now')").get().n,2);
    assert.equal(await runBerlinCoverage(x.sql,{id:1},4,async()=>{throw Error("not called")}),null);
  }finally{x.done()}
});

test("MCP rate limiting backs off without marking queries as covered",async()=>{
  const x=setup();
  try{
    let called=0;
    const result=await runBerlinCoverage(x.sql,{id:72},4,async()=>{
      called++;
      return {fetched:100,valid:20,map_error:"immoscout_mcp_http_429"};
    });
    assert.equal(called,1);
    assert.equal(result.processed[0].status,"retry");
    assert.equal(x.db.prepare("SELECT COUNT(*) n FROM scout_coverage_jobs WHERE status='retry' AND datetime(next_run_at)>datetime('now')").get().n,1);
  }finally{x.done()}
});
