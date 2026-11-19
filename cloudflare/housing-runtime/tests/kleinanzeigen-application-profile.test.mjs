import test from "node:test";
import assert from "node:assert/strict";
import { prepareKleinanzeigenApplicantForm, describeKleinanzeigenForm } from "../src/kleinanzeigen-application-profile.js";
import { providerDynamicReadiness } from "../src/telegram-legacy/application-profile-adapters.js";

const applicant = {
  first_name: "Sona", last_name: "Testname", email: "sona@example.test",
  phone: "+49 151 0000000", street: "Beispielweg", house_number: "8",
  postcode: "20099", city: "Hamburg", household_type: "SINGLE",
  employment_status: "EMPLOYEE", income_range: "2000_3000", pets: "NO",
};
const form = (fields, required=Object.keys(fields)) => ({
  schema: {type:"object",properties:fields,required},
  uiSchema: {type:"VerticalLayout",elements:required.map(field=>({
    type:"Control",scope:"#/properties/"+field,label:"Kleinanzeigen: "+field,
  }))},
});
test("maps the shared applicant profile to dynamic required fields, not an extra Kleinanzeigen profile",()=>{
  const f=form({contactFirstName:{type:"string"},contactLastName:{type:"string"},
    email:{type:"string"},contactMessage:{type:"string"},
    postalCode:{type:"string"},houseNumber:{type:"string"},city:{type:"string"}});
  const result=prepareKleinanzeigenApplicantForm(f,applicant,"Guten Tag, ich interessiere mich für Ihre Wohnung.");
  assert.equal(result.ok,true);
  assert.deepEqual(result.payload,{
    contactFirstName:"Sona",contactLastName:"Testname",email:"sona@example.test",
    contactMessage:"Guten Tag, ich interessiere mich für Ihre Wohnung.",
    postalCode:"20099",houseNumber:"8",city:"Hamburg",
  });
  assert.equal(result.fields.length,7);
});
test("missing account-independent address is reported as a profile gap",()=>{
  const {street,...incomplete}=applicant;
  const result=prepareKleinanzeigenApplicantForm(form({
    street:{type:"string"},message:{type:"string"},
  }),incomplete,"Guten Tag");
  assert.equal(result.ok,false);
  assert.equal(result.error,"required_profile_data_missing");
  assert.deepEqual(result.missing.map(x=>x.id),["street"]);
  assert.deepEqual(result.payload,{});
});
test("unknown mandatory advertiser questions remain manual, never fabricated",()=>{
  const result=prepareKleinanzeigenApplicantForm(form({
    message:{type:"string"},besichtigungstermin:{type:"string"},
    acceptsMarketing:{type:"boolean"},
  }),applicant,"Guten Tag");
  assert.equal(result.ok,false);
  assert.equal(result.error,"required_field_contract_unverified");
  assert.deepEqual(result.unsupported.map(x=>x.id),["besichtigungstermin","acceptsMarketing"]);
  assert.deepEqual(result.payload,{});
});
test("honors provider enum values and never invents unsupported values",()=>{
  const a=prepareKleinanzeigenApplicantForm(form({salutation:{type:"string",enum:["MALE","FEMALE"]},
    message:{type:"string"}}),{...applicant,salutation:"MS"},"Hallo");
  assert.equal(a.ok,true);
  assert.equal(a.payload.salutation,"FEMALE");
  const b=prepareKleinanzeigenApplicantForm(form({salutation:{type:"string",enum:["LADY","GENTLEMAN"]},
    message:{type:"string"}}),{...applicant,salutation:"MS"},"Hallo");
  assert.equal(b.ok,false);
  assert.deepEqual(b.missing.map(x=>x.id),["salutation"]);
});
test("required consent and unverified conditional schemas fail closed",()=>{
  const unknown=prepareKleinanzeigenApplicantForm(form({consent:{type:"boolean"},
    message:{type:"string"}}),{...applicant,consent:true},"Text");
  assert.equal(unknown.ok,false, "consent must be granted to that advertiser explicitly");
  assert.deepEqual(unknown.unsupported.map(x=>x.id),["consent"]);
  const conditional=form({message:{type:"string"}});
  conditional.schema.if={properties:{pets:{const:"YES"}}};
  assert.equal(prepareKleinanzeigenApplicantForm(conditional,applicant,"Text").error,"form_schema_unverified");
});
test("optional fields are never treated as compulsory and invalid dates are reported",()=>{
  const f=form({moveInDate:{type:"string",format:"date"},message:{type:"string"},
    marketing:{type:"boolean"}},["moveInDate","message"]);
  assert.equal(prepareKleinanzeigenApplicantForm(f,{...applicant,move_in_preference:"FLEXIBLE"},"Hallo").ok,false);
  assert.equal(prepareKleinanzeigenApplicantForm(f,{...applicant,move_in_date:"2026-12-01"},"Hallo").ok,true);
});

test("unified applicant profile exposes provider dynamic readiness",()=>{
  const sample=form({message:{type:"string"},contactFirstName:{type:"string"}});
  const result=providerDynamicReadiness("kleinanzeigen",sample,applicant,"Hallo");
  assert.equal(result.ok,true);
  assert.equal(result.payload.contactFirstName,"Sona");
  assert.equal(result.payload.message,"Hallo");
  assert.deepEqual(result.missing,[]);
});

test("form diagnostics persist only bounded schema keys, never account values or messages",()=>{
  const f={schema:{type:"object",required:["message","customField"],properties:{
    message:{type:"string"},customField:{type:"string",enum:["private@example.test","different@example.test"]}
  }},data:{message:"Hi, my email is private@example.test",email:"operator@example.test"},uiSchema:{type:"Control",scope:"#/properties/customField",label:"Custom: private@example.test"},access_token:"SECRET"};
  const diagnostic=describeKleinanzeigenForm(f);
  assert.deepEqual(diagnostic.required_ids,["message","customField"]);
  assert.deepEqual(diagnostic.form_data_keys,["message","email"]);
  assert.equal(diagnostic.fields.find(x=>x.id==="customField")?.enum_count,2);
  assert.doesNotMatch(JSON.stringify(diagnostic),/private@example|operator@example|SECRET|Hi, my email/);
});

test("actual Kleinanzeigen XCF salutation/Schufa enum choices map from shared profile",()=>{
  const f=form({
    contactFirstName:{type:"string"},
    contactLastName:{type:"string"},
    currentSchufaInformation:{
      type:"string",enum:["CURRENT","NOT_AVAILABLE","NO_ANSWER"],
      oneOf:[
        {const:"CURRENT",title:"Vorhanden (< 3 Monate)"},
        {const:"NOT_AVAILABLE",title:"Nicht vorhanden"},
        {const:"NO_ANSWER",title:"Keine Angabe"},
      ],
    },
    salutation:{type:"string",enum:["HERR","FRAU","DIVERS","OHNE"],
      oneOf:[
        {const:"HERR",title:"Herr"},{const:"FRAU",title:"Frau"},
        {const:"DIVERS",title:"Divers"},{const:"OHNE",title:"Keine Angabe"},
      ],
    },
    message:{type:"string"},
  });
  const r=prepareKleinanzeigenApplicantForm(f,{...applicant,salutation:"MR",schufa_status:"AVAILABLE"},"Guten Tag");
  assert.equal(r.ok,true);
  assert.equal(r.payload.salutation,"HERR");
  assert.equal(r.payload.currentSchufaInformation,"CURRENT");
  assert.equal(r.payload.message,"Guten Tag");
  assert.deepEqual(r.unsupported,[]);
});

test("advertiser's conditional phone callback fields are evaluated, not ignored",()=>{
  const f=form({
    contactFirstName:{type:"string"},message:{type:"string"},
    phoneCallDesired:{type:"boolean"},
    phoneNumber:{type:"string"}
  },["contactFirstName","message","phoneCallDesired"]);
  f.schema.allOf=[{if:{properties:{phoneCallDesired:{const:true}}},
    then:{required:["phoneNumber"]}}];
  const noCall=prepareKleinanzeigenApplicantForm(f,applicant,"Guten Tag");
  assert.equal(noCall.ok,true);
  assert.equal(noCall.payload.phoneCallDesired,false);
  const wantsCall=prepareKleinanzeigenApplicantForm(f,{...applicant,phone_call_desired:true},"Guten Tag");
  assert.equal(wantsCall.ok,true);
  assert.equal(wantsCall.payload.phoneCallDesired,true);
  assert.equal(wantsCall.payload.phoneNumber,applicant.phone);
  const noPhone=prepareKleinanzeigenApplicantForm(f,{...applicant,phone:undefined,phone_call_desired:true},"Guten Tag");
  assert.equal(noPhone.ok,false);
  assert.deepEqual(noPhone.missing.map(x=>x.id),["phoneNumber"]);
});
test("unrecognized allOf branches and unsupported Schufa options block submission",()=>{
  const f=form({message:{type:"string"},salutation:{type:"string",enum:["UNRELATED"]}});
  f.schema.allOf=[{if:{not:{properties:{message:{const:"X"}}}},then:{required:["salutation"]}}];
  assert.equal(prepareKleinanzeigenApplicantForm(f,applicant,"Guten Tag").error,"form_schema_unverified");
  delete f.schema.allOf;
  const out=prepareKleinanzeigenApplicantForm(f,{...applicant,salutation:"MR"},"Guten Tag");
  assert.equal(out.ok,false);
  assert.deepEqual(out.missing.map(x=>x.id),["salutation"]);
});
