import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const category=readFileSync(new URL('../supabase/functions/source-worker/category.ts',import.meta.url),'utf8');
const categoryPersist=readFileSync(new URL('../supabase/functions/source-worker/category-persist.ts',import.meta.url),'utf8');
const policy=readFileSync(new URL('../supabase/functions/source-worker/search-policy.ts',import.meta.url),'utf8');

test('category discovery retains only the allowed housing adapters',()=>{
 assert.match(category,/stream\.adapter==='scout'/);
 assert.match(category,/stream\.adapter==='immowelt'/);
 assert.doesNotMatch(category,/ohne-makler|kleinanzeigen|wg-gesucht|WG-Gesucht/i);
 assert.match(categoryPersist,/category_stream:category/);
 assert.match(categoryPersist,/86400000/);
});

test('search policy contains only the retained source families',()=>{
 for(const id of [1,3,23,28,29,30,32,34,35,36,37,39,65,66,69,71])assert.match(policy,new RegExp('\\b'+id+'\\b'));
 assert.doesNotMatch(policy,/kleinanzeigen|wg_gesucht|ohne-makler|wunderflats|nestpick/i);
});
