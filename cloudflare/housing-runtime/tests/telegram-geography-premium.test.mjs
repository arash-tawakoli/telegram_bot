import test from "node:test";
import assert from "node:assert/strict";
import {configureLegacyRuntime, geography, withPlan} from "../src/telegram-legacy/runtime.js";
import {profileLocation} from "../src/telegram-legacy/profiles.js";
import {createD1Supabase} from "../src/telegram-legacy/d1-supabase.js";

const fixture = {
  boroughs: [{ id: 1, name: "Hamburg-Mitte" }],
  neighborhoods: [{ id: 1, name: "Hamburg-Altstadt", borough_id: 1 }],
  schleswigHolsteinAreas: [{ area_code: "01002", area_type: "independent_city", name: "Kiel" }]
};
function fakeD1(payload = fixture) {
  let reads = 0;
  const data = payload === null ? null : JSON.stringify(payload);
  return {
    get reads() { return reads; },
    prepare(sql) {
      assert.match(sql, /SELECT payload FROM coach_geo_snapshot WHERE id='de-hh-sh'/);
      return {
        async first() { reads++; return data === null ? null : {payload:data}; },
        async all() { reads++; return {results:data===null?[]:[{payload:data}],meta:{changes:0}}; },
        bind() { return this; }
      };
    }
  };
}

test("Telegram geography resolves the live D1 snapshot and caches it", async () => {
  const d1=fakeD1();
  configureLegacyRuntime({},d1);
  assert.deepEqual(await geography(),fixture);
  assert.deepEqual(await geography(),fixture);
  assert.equal(d1.reads,1);
});
test("saved Schleswig-Holstein profiles rebuild area labels from compact codes", async () => {
  configureLegacyRuntime({},fakeD1());
  assert.equal(await profileLocation({
    location_mode: "schleswig_holstein_areas",
    location_area_codes: ["01002"],
    districts: [],
  }), "Kiel");
});

test("Telegram geography fails explicitly for missing data instead of showing empty menus", async () => {
  configureLegacyRuntime({},fakeD1(null));
  await assert.rejects(geography(),/geography_snapshot_missing/);
  configureLegacyRuntime({},fakeD1({boroughs:[],neighborhoods:[],schleswigHolsteinAreas:[]}));
  await assert.rejects(geography(),/geography_snapshot_incomplete/);
});
test("D1 legacy RPC supplies real Schleswig-Holstein areas",async()=>{
  const api=createD1Supabase(fakeD1(),{});
  const r=await api.rpc("get_schleswig_holstein_areas");
  assert.equal(r.error,null);
  assert.deepEqual(r.data,fixture.schleswigHolsteinAreas);
});
test("D1 legacy RPC rejects a missing geography snapshot",async()=>{
  const r=await createD1Supabase(fakeD1(null),{}).rpc("get_schleswig_holstein_areas");
  assert.equal(r.data,null);
  assert.match(r.error.message,/geography_snapshot_missing/);
});
test("expired free overrides no longer suppress a paid subscription",async()=>{
  const past=new Date(Date.now()-86400000).toISOString();
  const user={id:"participant-1",plan_override:"free",plan_override_expires_at:past};
  const subscription={status:"active",current_period_end:new Date(Date.now()+86400000).toISOString()};
  assert.equal((await withPlan(user,subscription)).is_premium,true);
});
test("current free overrides take precedence over paid subscriptions",async()=>{
  const user={id:"participant-1",plan_override:"free",plan_override_expires_at:new Date(Date.now()+86400000).toISOString()};
  assert.equal((await withPlan(user,{status:"active"})).is_premium,false);
});
test("expired subscription is not premium without another entitlement",async()=>{
  const yesterday=new Date(Date.now()-86400000).toISOString();
  assert.equal((await withPlan({id:"participant-1"},{status:"active",current_period_end:yesterday})).is_premium,false);
});
test("active referral bonus grants premium without a Stripe subscription",async()=>{
  const tomorrow=new Date(Date.now()+86400000).toISOString();
  assert.equal((await withPlan({id:"participant-1",referral_bonus_until:tomorrow},null)).is_premium,true);
});
