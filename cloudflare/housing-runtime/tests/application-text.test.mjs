import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPLICATION_TEXT, resolveApplicationText, effectiveApplicationMessages } from "../src/application-text.js";

test("apartment and house templates insert only the current candidate first name",()=>{
 const a=effectiveApplicationMessages({first_name:"Ada",message_apartment:"Ich bin [[Vorname]].",message_house:"Haus für [[Vorname]]."});
 const b=effectiveApplicationMessages({first_name:"Ben"});
 assert.equal(a.message_apartment,"Ich bin Ada.");
 assert.equal(a.message_house,"Haus für Ada.");
 assert.match(b.message_apartment,/Ben/);
 assert.match(b.message_house,/Ben/);
 assert.doesNotMatch(b.message_apartment,/Ada/);
 assert.equal(a.message_temporary_wg,undefined);
 assert.equal(a.message_swap,undefined);
});
test("unknown or missing name is never fabricated",()=>{
 assert.equal(resolveApplicationText("Hallo [[Vorname]]",null),"Hallo [[Vorname]]");
 assert.match(DEFAULT_APPLICATION_TEXT,/\[\[Vorname\]\]/);
 assert.equal(resolveApplicationText("Hallo [[vorname]]","Aria"),"Hallo Aria");
});
