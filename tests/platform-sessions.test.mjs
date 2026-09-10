import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {privateApplicant} from '../supabase/functions/telegram-ui/dossier-rules.js';
const source=readFileSync(new URL('../supabase/functions/telegram-ui/platform-sessions.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const user={id:'owner',is_active:true,is_premium:true,telegram_user_id:1,chat_id:1};
function harness(){
 const calls=[],scope={privateApplicant,AbortSignal,SUPABASE_URL:'https://project.supabase.co',secret:async()=> 'test',
  fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({status:'login',url:'https://www.browserbase.com/session/test'});},
  send:async(chat,text,markup)=>calls.push({chat,text,markup}),edit:async(chat,id,text,markup)=>calls.push({chat,text,markup}),button:(text,callback_data)=>({text,callback_data})};
 vm.runInNewContext(source,scope);return {...scope,calls};
}
test('personal login links never reach foreign/group chats or users without Premium',async()=>{
 for(const [u,chat] of [[user,{id:2,type:'private'}],[user,{id:1,type:'group'}],[{...user,is_premium:false},{id:1,type:'private'}]]){
  const h=harness();await h.platformSessions(u,chat,null,'platforms:login:1');assert.ok(h.calls.every(c=>!c.action&&!c.markup?.inline_keyboard.some(row=>row.some(b=>b.url))));
 }
});
test('platform login uses the server-resolved owner and disconnect remains possible after Premium expires',async()=>{
 const h=harness();await h.platformSessions(user,{id:1,type:'private'},null,'platforms:login:2');
 assert.deepEqual(h.calls[0],{action:'login',userId:'owner',source:2});assert.equal(h.calls[1].chat,1);
 const expired=harness();await expired.platformSessions({...user,is_premium:false},{id:1,type:'private'},null,'platforms:disconnect:1');
 assert.deepEqual(expired.calls[0],{action:'disconnect',userId:'owner',source:1});
});
