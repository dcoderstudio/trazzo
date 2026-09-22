'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse,save}=require('../chat-tasks.js');
const data={teamMembers:[{id:'gon',name:'Gon'},{id:'ale',name:'Ale Martinez'}],workAreas:[{name:'Diseño'}],standaloneTasks:[],projects:[{id:1,docs:['keep']}],other:{keep:true}};
const text='Tarea | Fecha | Responsable | Área\nPropuesta | 2026-09-25 | Gon | Diseño\nLlamar | - | - | -';
function mock(initial){let value=structuredClone(initial),queue=Promise.resolve();return {get value(){return value;},runTransaction(fn){const task=queue.then(async()=>{let update;const out=await fn({get:async()=>({exists:true,data:()=>structuredClone(value)}),update:(doc,patch)=>{update=patch;}});if(update)value={...value,...update};return out;});queue=task.catch(()=>{});return task;}};}
test('resolves dates and names, preserves blank assignments',()=>{const r=parse(text,data);assert.deepEqual(r.errors,[]);assert.equal(r.tasks[0].resp,'gon');assert.equal(r.tasks[0].deadline,'2026-09-25');assert.equal(r.tasks[1].resp,null);assert.equal(r.tasks[1].deadline,null);});
test('rejects invalid and relative dates, unknown and ambiguous names, malformed rows',()=>{for(const t of ['T | 2026-02-30 | - | -','T | viernes | - | -','T | - | Desconocido | -','T | - | - | Inexistente','T | -'])assert.ok(parse(t,data).errors.length);assert.ok(parse('T | - | Gon | -',{...data,teamMembers:[{id:1,name:'Gon'},{id:2,name:'Gón'}]}).errors.length);});
test('normalizes accents and marks identical lines',()=>{const r=parse('T | - | gon | diseno\nT | - | Gon | Diseño',data);assert.equal(r.tasks[0].area,'Diseño');assert.equal(r.tasks[1].duplicate,true);});
test('rejects empty and excessive batches',()=>{assert.ok(parse(' ',data).errors.length);assert.ok(parse(Array.from({length:101},(_,i)=>'T'+i+' | - | - | -').join('\n'),data).errors.length);});
test('atomic batch, unrelated fields retained, replays and concurrent batches do not duplicate',async()=>{const db=mock(data);const results=await Promise.all([save(db,{},text,['a','b']),save(db,{},text,['c','d'])]);assert.equal(results[0].created,2);assert.equal(results[1].created,0);assert.equal(db.value.standaloneTasks.length,2);assert.deepEqual(db.value.projects,data.projects);assert.deepEqual(db.value.other,data.other);assert.equal((await save(db,{},text,['a','b'])).created,0);});
test('validates against current members, fails without partial writes',async()=>{const db=mock({...data,teamMembers:[]});await assert.rejects(save(db,{},text,['a','b']));assert.equal(db.value.standaloneTasks.length,0);});
test('propagates permission failure',async()=>{await assert.rejects(save({runTransaction:async()=>{throw Error('permission-denied');}}, {},text,['a','b']),/permission-denied/);});
test('existing same title with different date remains a distinct task',()=>{const r=parse(text,{...data,standaloneTasks:[{text:'Propuesta',deadline:'2026-09-24',resp:'gon',area:'Diseño'}]});assert.equal(r.tasks[0].duplicate,false);});
